/**
 * editor.js — Visual editor tab for Listar MC admin.
 * Loaded as an ES module by admin-editor.html.
 *
 * Intentionally does NOT import github.js — this tab has no token access.
 * Only imports core.js (field registry, DOM helpers) and channel.js (cross-tab comms).
 *
 * Architecture (hub-and-spoke):
 *   - Admin tab (app.js) is the hub: owns token, canonical docs, publishes.
 *   - This tab is a view + input device: renders a sandboxed iframe copy,
 *     sends field edits to the hub, receives 'changed' messages back.
 *
 * Security:
 *   - #k= fragment is cleared from the URL after reading.
 *   - Only messages from our channel (key check) are accepted.
 *   - No GitHub code, no token, no sessionStorage access.
 */

import {
    parseHTML, esc,
    PAGE, CARD, SELECTORS,
    sanitizeRichText, stripEditorMarkup,
} from './core.js';

import { AdminChannel, parseEditorHash } from './channel.js';

// ── Parse & clear the hash ─────────────────────────────────────────────────

const { key, file: initFile } = parseEditorHash();
// Clear fragment so the key isn't in browser history
history.replaceState(null, '', location.pathname + location.search);

if (!key) {
    document.body.innerHTML = `<div class="editor-error">
        <h2>No session key</h2>
        <p>Open this editor from the admin panel ("Edit visually" button).</p>
    </div>`;
    throw new Error('No session key in URL fragment — editor aborted.');
}

// ── State ──────────────────────────────────────────────────────────────────

const E = {
    file: initFile || '',
    rev: 0,
    pending: 0,
    packs: [],
    pageData: null, // Canonical relative image paths (never use rewritten iframe URLs for edits).
    siteUrl: 'https://listar-mc.net/',
    connected: false,
    missedPings: 0,
    editMode: true,
    publishInProgress: false,
    // Unique to this tab: the hub must acknowledge edits without rebuilding their source DOM.
    clientId: crypto.randomUUID(),
};

let channel;
let pingInterval;
let pingCheckInterval;

// ── DOM refs ───────────────────────────────────────────────────────────────

const $ = sel => document.querySelector(sel);

const toolbar      = () => $('#editor-toolbar');
const iframe       = () => $('#editor-frame');
const fileSelect   = () => $('#file-select');
const pendingBadge = () => $('#pending-badge');
const undoBtn      = () => $('#undo-btn');
const redoBtn      = () => $('#redo-btn');
const publishBtn   = () => $('#publish-btn');
const connDot      = () => $('#conn-dot');
const disconnBanner= () => $('#disconnected-banner');
const editToggle   = () => $('#edit-toggle');
const pageSettingsDrawer = () => $('#page-settings-drawer');
const screenshotsDrawer  = () => $('#screenshots-drawer');

// ── Channel setup ──────────────────────────────────────────────────────────

function connect() {
    channel = new AdminChannel(key, 'editor-' + E.file, msg => handleHubMessage(msg));
    // Tell the hub we've opened
    channel.send('hello', { file: E.file });
    // Start heartbeat
    pingInterval = setInterval(() => channel.send('ping'), 5000);
    pingCheckInterval = setInterval(() => {
        E.missedPings++;
        if (E.missedPings >= 3 && E.connected) {
            E.connected = false;
            updateConnectionUI();
        }
    }, 6000);
}

function handleHubMessage(msg) {
    // Ignore our own echoes
    if (msg.origin === 'editor-' + E.file) return;

    if (msg.type === 'pong') {
        E.missedPings = 0;
        if (!E.connected) {
            E.connected = true;
            updateConnectionUI();
            // Re-request state in case we missed something while disconnected
            channel.send('hello', { file: E.file });
        }
        return;
    }

    if (msg.type === 'ping') {
        channel.send('pong');
        return;
    }

    if (msg.type === 'state') {
        E.missedPings = 0;
        E.connected = true;
        E.rev = msg.rev ?? 0;
        E.pending = msg.pending ?? 0;
        E.packs = msg.packs || [];
        E.pageData = msg.pageData || null;
        if (msg.siteUrl) E.siteUrl = msg.siteUrl;
        updateConnectionUI();
        updatePendingUI();
        buildFileSwitcher();
        if (msg.html && msg.file === E.file) {
            renderIframe(msg.html);
        }
        return;
    }

    if (msg.type === 'changed') {
        if (msg.file !== E.file) return;
        // Keep canonical field values in sync, including native relative asset paths.
        const priorSlides = E.pageData?.slides || [];
        const priorPreviews = E.pageData?.previews || [];
        const previewsFollowSlides = msg.field === 'slides' && priorPreviews.length > 0 &&
            priorPreviews.every((x, i) => x.src === priorSlides[i]?.src);
        if (E.pageData && Object.hasOwn(E.pageData, msg.field)) {
            if (msg.index == null) E.pageData[msg.field] = msg.value;
            else if (Array.isArray(E.pageData[msg.field])) {
                const arr = [...E.pageData[msg.field]];
                arr[msg.index] = msg.value;
                E.pageData[msg.field] = arr;
            } else E.pageData[msg.field] = msg.value;
        }
        if (previewsFollowSlides && Array.isArray(E.pageData?.slides)) {
            E.pageData.previews = E.pageData.slides.filter(x => x.src)
                .slice(0, priorPreviews.length).map(x => ({src:x.src, alt:x.caption || ''}));
        }
        // The live contenteditable already holds its own text. Never re-render it
        // in response to a keystroke. Structural changes and gallery changes must
        // update the iframe even when initiated by this very editor tab.
        const own = msg.clientId === E.clientId;
        if (!own || msg.structural || ['slides', 'previews'].includes(msg.field))
            applyChangedToIframe(msg);
        const drawer = screenshotsDrawer();
        if (!drawer.hidden && ['slides', 'previews'].includes(msg.field) && drawer.dataset.mode === msg.field)
            renderScreenshotsDrawer(drawer);
        return;
    }

    if (msg.type === 'pending') {
        E.pending = msg.count ?? 0;
        updatePendingUI();
        return;
    }

    if (msg.type === 'publish-step') {
        renderPublishStep(msg.step);
        return;
    }

    if (msg.type === 'bye') {
        E.connected = false;
        updateConnectionUI();
        showDisconnectedBanner();
        disableEditing();
        return;
    }
}

// ── Iframe rendering ───────────────────────────────────────────────────────

function renderIframe(html) {
    const fr = iframe();
    // Use srcdoc to avoid navigation history entries and cross-origin issues
    const scrollTop = (() => { try { return fr.contentWindow?.scrollY || 0; } catch { return 0; } })();
    fr.srcdoc = html;
    fr.addEventListener('load', () => {
        if (scrollTop) fr.contentWindow?.scrollTo(0, scrollTop);
        // Hide the loading overlay once the iframe has content
        const loading = document.getElementById('editor-loading');
        if (loading) loading.hidden = true;
        attachIframePreviewInteractions();
        if (E.editMode) annotateIframe();
    }, { once: true });
}

function iframeDoc() {
    const fr = iframe();
    try { return fr.contentDocument; } catch (e) { return null; }
}

/**
 * The editor iframe intentionally does not allow scripts. Provide a minimal
 * gallery preview through listeners installed by the trusted parent instead.
 * Delegation handles galleries whose thumbnail nodes change while editing.
 */
function attachIframePreviewInteractions() {
    const doc = iframeDoc();
    if (!doc || doc.documentElement.dataset.lmcGalleryBound) return;
    doc.documentElement.dataset.lmcGalleryBound = 'true';
    const modal = doc.getElementById('myModal');
    if (!modal) return;
    let slideIndex = 0;
    const show = idx => {
        const slides = [...modal.querySelectorAll('.mySlides')];
        if (!slides.length) return;
        slideIndex = (idx % slides.length + slides.length) % slides.length;
        slides.forEach((x, i) => x.style.display = i === slideIndex ? 'flex' : 'none');
    };
    const open = idx => {
        show(idx);
        modal.style.display = 'block';
        doc.body.style.overflow = 'hidden';
    };
    const close = () => {
        modal.style.display = 'none';
        doc.body.style.overflow = '';
    };
    show(0);
    doc.addEventListener('click', e => {
        const thumb = e.target.closest('.thumbnails-grid .thumbnail-item');
        const all = e.target.closest('.view-all-btn');
        if ((thumb && !E.editMode) || all) {
            e.preventDefault();
            e.stopPropagation();
            let idx = 0;
            if (thumb) {
                const slides = [...modal.querySelectorAll('.mySlides img')];
                const source = thumb.querySelector('img')?.src;
                const matching = slides.findIndex(img => img.src === source);
                idx = matching >= 0 ? matching : [...thumb.parentElement.children].indexOf(thumb);
            }
            open(idx);
            return;
        }
        if (e.target.closest('#myModal .close')) { e.preventDefault(); close(); }
        else if (e.target.closest('#myModal .prev')) { e.preventDefault(); show(slideIndex - 1); }
        else if (e.target.closest('#myModal .next')) { e.preventDefault(); show(slideIndex + 1); }
        else if (e.target === modal) close();
    }, true);
    doc.addEventListener('keydown', e => {
        if (modal.style.display !== 'block') return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') show(slideIndex - 1);
        if (e.key === 'ArrowRight') show(slideIndex + 1);
    });
}

/** Mark editable elements in the iframe and attach input/click handlers. */
function annotateIframe() {
    const doc = iframeDoc();
    if (!doc) return;

    // Prevent links from navigating away
    doc.querySelectorAll('a[href]').forEach(a => {
        a.addEventListener('click', e => {
            if (!e.ctrlKey && !e.metaKey) e.preventDefault();
        });
    });

    // Inject editor CSS
    if (!doc.getElementById('lmc-editor-style')) {
        const style = doc.createElement('style');
        style.id = 'lmc-editor-style';
        style.textContent = EDITOR_IFRAME_CSS;
        doc.head.appendChild(style);
    }

    if (!E.editMode) return;
    doc.querySelectorAll('.lmc-list-controls, .lmc-add-btn').forEach(el => el.hidden = false);

    // Plain text fields
    makePlainText(doc, SELECTORS.heading, 'heading');
    makePlainText(doc, SELECTORS.version, 'version');
    makePlainText(doc, SELECTORS.animeTitle, 'animeTitle');
    makePlainText(doc, SELECTORS.packType, 'packType');

    // Rich text fields (features, paragraphs)
    makeRichList(doc, SELECTORS.featuresItems, 'features', el => {
        const clone = el.cloneNode(true);
        const icon = clone.querySelector('i');
        if (icon) icon.remove();
        return clone.innerHTML.trim();
    });
    makeRichList(doc, SELECTORS.paragraphs, 'paragraphs', el => el.innerHTML.trim());

    // Cover image
    makeImageElement(doc, SELECTORS.cover, 'cover');

    // Themes (plain text list)
    makeTagList(doc, SELECTORS.themes, 'themes');

    // Compatibility badges
    makeTagList(doc, SELECTORS.compatItems, 'compat');

    // Highlights
    makeHighlightFields(doc);

    // Previews: click thumbnails to open screenshots drawer
    doc.querySelectorAll(SELECTORS.thumbnailItems).forEach((img, i) => {
        const thumb = img.closest('.thumbnail-item');
        if (!thumb) return;
        thumb.classList.add('lmc-editable', 'lmc-preview');
        thumb.setAttribute('data-lmc-index', i);
        if (thumb.dataset.lmcBound !== 'previews') {
            thumb.dataset.lmcBound = 'previews';
            // Preview thumbnails are a separate field from the full-size slides.
            thumb.addEventListener('click', e => {
                if (!E.editMode) return;
                e.preventDefault(); e.stopPropagation();
                openPreviewsDrawer();
            }, true);
        }
    });

    // Download links
    makeDownloadLink(doc, '.download-btn.curseforge', 'curseforge');
    makeDownloadLink(doc, '.download-btn.modrinth', 'modrinth');
}

function makePlainText(doc, selector, field) {
    const el = doc.querySelector(selector);
    if (!el) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('data-lmc-field', field);
    el.classList.add('lmc-editable');
    if (el.dataset.lmcBound === field) return;
    el.dataset.lmcBound = field;
    let debounceT;
    el.addEventListener('input', () => {
        clearTimeout(debounceT);
        debounceT = setTimeout(() => sendEdit(field, el.textContent.trim()), 250);
    });
    el.addEventListener('blur', () => {
        clearTimeout(debounceT);
        sendEdit(field, el.textContent.trim());
    });
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
}

function makeRichList(doc, selector, field, getValue) {
    const els = [...doc.querySelectorAll(selector)];
    els.forEach((el, i) => {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('data-lmc-field', field);
        el.setAttribute('data-lmc-index', i);
        el.classList.add('lmc-editable', 'lmc-rich');
        if (el.dataset.lmcBound === field) return;
        el.dataset.lmcBound = field;

        // Paste as plain text
        el.addEventListener('paste', e => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            doc.execCommand('insertText', false, text);
        });

        let debounceT;
        const commit = () => {
            clearTimeout(debounceT);
            const val = sanitizeRichText(getValue(el));
            // Index-based changes don't rebuild siblings (and preserve the caret).
            sendEdit(field, val, i);
        };
        el.addEventListener('input', () => { clearTimeout(debounceT); debounceT = setTimeout(commit, 250); });
        el.addEventListener('blur', commit);

        // List controls
        const controls = makeListControls(i, els.length, {
            onMove: (dir) => sendListOp(field, 'move', i, i + dir),
            onRemove: () => sendListOp(field, 'remove', i),
        });
        el.after(controls);
    });

    // Add button
    const container = els[0]?.parentElement || doc.querySelector(field === 'features' ? SELECTORS.featuresList : '.description-content');
    if (container && !container.querySelector(`[data-lmc-add-for="${field}"]`)) {
        const addBtn = doc.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'lmc-add-btn';
        addBtn.dataset.lmcAddFor = field;
        addBtn.textContent = '+ Add ' + (field === 'paragraphs' ? 'paragraph' : 'feature');
        addBtn.addEventListener('click', e => {
            e.preventDefault();
            const val = prompt('New ' + (field === 'paragraphs' ? 'paragraph' : 'feature') + ':');
            if (val?.trim()) sendListOp(field, 'insert', doc.querySelectorAll(selector).length, null, sanitizeRichText(val.trim()));
        });
        container.append(addBtn);
    }
}

function makeTagList(doc, selector, field) {
    const els = [...doc.querySelectorAll(selector)];
    els.forEach((el, i) => {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.setAttribute('data-lmc-field', field);
        el.setAttribute('data-lmc-index', i);
        el.classList.add('lmc-editable', 'lmc-tag');
        if (el.dataset.lmcBound === field) return;
        el.dataset.lmcBound = field;

        let debounceT;
        el.addEventListener('input', () => {
            clearTimeout(debounceT);
            debounceT = setTimeout(() => {
                sendEdit(field, el.textContent.trim(), i);
            }, 250);
        });
        el.addEventListener('blur', () => {
            clearTimeout(debounceT);
            sendEdit(field, el.textContent.trim(), i);
        });
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        });

        const controls = makeListControls(i, els.length, {
            onMove: (dir) => sendListOp(field, 'move', i, i + dir),
            onRemove: () => sendListOp(field, 'remove', i),
        });
        el.after(controls);
    });
    const box = doc.querySelector(field === 'themes' ? '.pack-meta-badges' : '.compatibility-badges');
    if (box && !box.querySelector(`[data-lmc-add-for="${field}"]`)) {
        const btn = doc.createElement('button');
        btn.type = 'button'; btn.className = 'lmc-add-btn lmc-add-tag';
        btn.dataset.lmcAddFor = field;
        btn.textContent = '+ Add ' + (field === 'themes' ? 'theme' : 'version');
        btn.addEventListener('click', e => {
            e.preventDefault();
            const val = prompt('New ' + (field === 'themes' ? 'theme' : 'compatibility version') + ':');
            if (val?.trim()) sendListOp(field, 'insert', doc.querySelectorAll(selector).length, null, val.trim());
        });
        box.append(btn);
    }
}

function makeImageElement(doc, selector, field) {
    const el = doc.querySelector(selector);
    if (!el) return;
    el.classList.add('lmc-editable', 'lmc-img');
    el.setAttribute('data-lmc-field', field);
    if (el.dataset.lmcBound === field) return;
    el.dataset.lmcBound = field;
    el.addEventListener('click', e => {
        e.preventDefault();
        showImagePopover(el, field, null);
    });
}

function makeHighlightFields(doc) {
    const items = [...doc.querySelectorAll(SELECTORS.highlightItems)];
    items.forEach((item, i) => {
        const h4 = item.querySelector('.highlight-text h4');
        const p  = item.querySelector('.highlight-text p');
        if (h4) {
            h4.setAttribute('contenteditable', 'plaintext-only');
            h4.setAttribute('data-lmc-field', 'highlights');
            h4.setAttribute('data-lmc-index', i);
            h4.classList.add('lmc-editable');
            if (h4.dataset.lmcBound === 'highlights') return;
            h4.dataset.lmcBound = 'highlights';
            let t;
            h4.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => commitHighlights(doc, items), 250); });
            h4.addEventListener('blur', () => { clearTimeout(t); commitHighlights(doc, items); });
            h4.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); h4.blur(); } });
        }
        if (p) {
            p.setAttribute('contenteditable', 'plaintext-only');
            p.setAttribute('data-lmc-field', 'highlights');
            p.setAttribute('data-lmc-index', i);
            p.classList.add('lmc-editable');
            if (p.dataset.lmcBound === 'highlights') return;
            p.dataset.lmcBound = 'highlights';
            let t;
            p.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => commitHighlights(doc, items), 250); });
            p.addEventListener('blur', () => { clearTimeout(t); commitHighlights(doc, items); });
        }
    });
}

function commitHighlights(doc, items) {
    const arr = items.map(item => ({
        icon: (item.querySelector('.highlight-icon i')?.getAttribute('class') || '').replace(/^fa /, ''),
        title: item.querySelector('.highlight-text h4')?.textContent.trim() || '',
        text: item.querySelector('.highlight-text p')?.textContent.trim() || '',
    }));
    sendEdit('highlights', arr);
}

function makeDownloadLink(doc, selector, field) {
    const el = doc.querySelector(selector);
    if (!el) return;
    el.classList.add('lmc-editable', 'lmc-link');
    el.setAttribute('data-lmc-field', field);
    if (el.dataset.lmcBound === field) return;
    el.dataset.lmcBound = field;
    el.addEventListener('click', e => {
        e.preventDefault();
        showLinkPopover(el, field, el.getAttribute('href') || '');
    });
}

function makeListControls(index, total, { onMove, onRemove }) {
    const doc = iframeDoc();
    const wrap = doc.createElement('span');
    wrap.className = 'lmc-list-controls';
    if (index > 0) {
        const up = doc.createElement('button');
        up.className = 'lmc-ctrl';
        up.textContent = '↑';
        up.title = 'Move up';
        up.addEventListener('click', e => { e.preventDefault(); onMove(-1); });
        wrap.append(up);
    }
    if (index < total - 1) {
        const dn = doc.createElement('button');
        dn.className = 'lmc-ctrl';
        dn.textContent = '↓';
        dn.title = 'Move down';
        dn.addEventListener('click', e => { e.preventDefault(); onMove(1); });
        wrap.append(dn);
    }
    const rm = doc.createElement('button');
    rm.className = 'lmc-ctrl lmc-ctrl-remove';
    rm.textContent = '✕';
    rm.title = 'Remove';
    rm.addEventListener('click', e => { e.preventDefault(); onRemove(); });
    wrap.append(rm);
    return wrap;
}

// ── Apply remote changes to iframe ─────────────────────────────────────────

function applyChangedToIframe(msg) {
    const { field, value, index } = msg;
    const doc = iframeDoc();
    if (!doc) return;

    // Never destroy a list being edited while it has focus.
    const active = doc.activeElement;
    if (active?.dataset?.lmcField === field) return;

    // For array fields with an index, only update that element if it's not focused
    if (index != null) {
        const el = doc.querySelector(`[data-lmc-field="${field}"][data-lmc-index="${index}"]`);
        if (el && el !== active) {
            if (['features', 'paragraphs'].includes(field)) el.innerHTML = sanitizeRichText(String(value ?? ''));
            else el.textContent = typeof value === 'object' ? (value?.[index] || '') : String(value ?? '');
        }
        return;
    }

    // For full array replacements, re-render the whole field
    // Use the PAGE setter on a fresh copy, then patch only the DOM nodes
    if (['features', 'paragraphs', 'themes', 'compat', 'previews', 'slides', 'highlights', 'downloads'].includes(field)) {
        if (Array.isArray(value)) {
            // Re-render via the setter then re-annotate
            const iDoc = iframeDoc();
            if (!iDoc) return;
            try {
                // The PAGE setters remove their own target elements. The editor's
                // injected +/- controls are siblings, so remove them first to avoid
                // accumulating duplicate controls after repeated list operations.
                const containers = {
                    features: SELECTORS.featuresList,
                    paragraphs: '.description-content',
                    themes: '.pack-meta-badges',
                    compat: SELECTORS.compatBox,
                    highlights: SELECTORS.highlightsBox,
                    previews: SELECTORS.thumbnailsGrid,
                    slides: SELECTORS.modalContent,
                };
                const scope = iDoc.querySelector(containers[field] || 'nonexistent-selector');
                scope?.querySelectorAll('.lmc-list-controls, .lmc-add-btn').forEach(el => el.remove());
                PAGE.set[field]?.(iDoc, value);
                annotateIframe();
            } catch (e) { /* ignore */ }
        }
        return;
    }

    // Scalar fields
    const el = doc.querySelector(`[data-lmc-field="${field}"]`);
    if (el && el !== active) {
        if (el.hasAttribute('contenteditable')) {
            el.textContent = String(value ?? '');
        } else if (el.tagName === 'IMG') {
            el.setAttribute('src', value);
        } else if (el.tagName === 'A') {
            el.setAttribute('href', value);
        }
    }
}

// ── Popovers ───────────────────────────────────────────────────────────────

function closePopovers() {
    document.querySelectorAll('.lmc-popover').forEach(p => p.remove());
}

function showImagePopover(anchorEl, field, index) {
    closePopovers();
    const pop = document.createElement('div');
    pop.className = 'lmc-popover';
    const currentSrc = anchorEl.getAttribute('src') || anchorEl.getAttribute('href') || '';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'https://… or upload';
    inp.value = currentSrc;
    const uploadBtn = document.createElement('button');
    uploadBtn.textContent = '↑ Upload';
    uploadBtn.onclick = () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = () => {
            const file = fileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = reader.result.split(',')[1];
                const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
                channel.send('upload', { file: E.file, field, index: index ?? null, name: file.name, mime: file.type, bytes });
                pop.remove();
            };
            reader.readAsDataURL(file);
        };
        fileInput.click();
    };
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => {
        if (index != null) sendEdit(field, inp.value.trim(), index);
        else sendEdit(field, inp.value.trim());
        pop.remove();
    };
    pop.append(inp, uploadBtn, applyBtn);
    positionPopover(pop, anchorEl);
    document.body.appendChild(pop);
}

function showLinkPopover(anchorEl, field, currentHref) {
    closePopovers();
    const pop = document.createElement('div');
    pop.className = 'lmc-popover';
    const inp = document.createElement('input');
    inp.type = 'url';
    inp.placeholder = 'https://… (leave empty to hide button)';
    inp.value = currentHref;
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => {
        sendEdit(field, inp.value.trim());
        pop.remove();
    };
    pop.append(inp, applyBtn);
    positionPopover(pop, anchorEl);
    document.body.appendChild(pop);
}

function positionPopover(pop, anchor) {
    // Position near the anchor element in the iframe
    const fr = iframe();
    const frRect = fr.getBoundingClientRect();
    const doc = iframeDoc();
    if (doc) {
        const rect = anchor.getBoundingClientRect();
        // getBoundingClientRect in iframe is relative to iframe's viewport
        pop.style.position = 'fixed';
        pop.style.top = (frRect.top + rect.bottom + 8) + 'px';
        pop.style.left = Math.min(frRect.left + rect.left, window.innerWidth - 320) + 'px';
    } else {
        pop.style.position = 'fixed';
        pop.style.top = '80px';
        pop.style.left = '80px';
    }
}

// ── Drawers ────────────────────────────────────────────────────────────────

function openPageSettingsDrawer() {
    closePopovers();
    const drawer = pageSettingsDrawer();
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) renderPageSettingsDrawer(drawer);
}

function renderPageSettingsDrawer(drawer) {
    // Request state so we have fresh values
    // The fields are in the hub's canonical doc; send via channel
    // For now show inputs that send edit messages
    drawer.innerHTML = `
        <div class="drawer-inner"><div class="drawer-head"><h3>Page settings</h3><button id="ps-close" type="button">✕</button></div><div class="drawer-body">
        <div class="drawer-field"><label>Browser title</label>
            <input id="ps-title" type="text" placeholder="Pack Name | Listar MC"></div>
        <p class="ps-hint">~50–60 characters recommended. <span id="ps-title-count">0</span></p>
        <div class="drawer-field"><label>Meta description</label><textarea id="ps-meta" rows="3" placeholder="Describe the pack for Google…"></textarea></div>
        <p class="ps-hint">~140–160 characters recommended. <span id="ps-meta-count">0</span></p>
        </div></div>
    `;
    const titleInp = drawer.querySelector('#ps-title');
    const metaInp = drawer.querySelector('#ps-meta');
    const currentDoc = iframeDoc();
    titleInp.value = currentDoc?.title || '';
    metaInp.value = currentDoc?.querySelector('meta[name="description"]')?.content || '';
    const titleCount = drawer.querySelector('#ps-title-count');
    const metaCount = drawer.querySelector('#ps-meta-count');
    titleCount.textContent = titleInp.value.length;
    metaCount.textContent = metaInp.value.length;

    titleInp.addEventListener('input', () => {
        titleCount.textContent = titleInp.value.length;
        sendEdit('title', titleInp.value);
    });
    metaInp.addEventListener('input', () => {
        metaCount.textContent = metaInp.value.length;
        sendEdit('metaDescription', metaInp.value);
    });
    drawer.querySelector('#ps-close').addEventListener('click', () => {
        drawer.hidden = true;
    });
}

function openScreenshotsDrawer(focusIndex = 0, mode = 'slides') {
    closePopovers();
    const drawer = screenshotsDrawer();
    drawer.dataset.mode = mode;
    drawer.hidden = false;
    renderScreenshotsDrawer(drawer, focusIndex);
}
function openPreviewsDrawer() { openScreenshotsDrawer(0, 'previews'); }

function renderScreenshotsDrawer(drawer, focusIndex = -1) {
    // Never derive paths from the iframe; its URLs were rewritten for previewing
    // and would permanently replace ../images/foo.png with raw GitHub URLs.
    const mode = drawer.dataset.mode === 'previews' ? 'previews' : 'slides';
    const previews = mode === 'previews';
    const field = mode;
    const labelKey = previews ? 'alt' : 'caption';
    const entries = (E.pageData?.[field] || []).map(x => ({...x}));
    drawer.innerHTML = `
        <div class="drawer-inner"><div class="ss-header">
            <h3>Images (${entries.length})</h3>
            <button id="ss-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="ss-tabs" role="group" aria-label="Image collection">
            <button type="button" data-mode="previews" class="${previews ? 'active' : ''}">Preview thumbnails</button>
            <button type="button" data-mode="slides" class="${previews ? '' : 'active'}">Full screenshots</button>
        </div>
        <p class="ss-hint">${previews ? 'These are the small thumbnails visible on the pack page.' : 'These appear in the View All Screenshots popup.'}</p>
        <div class="ss-list" id="ss-list"></div>
        <div class="ss-footer">
            ${previews ? '<button type="button" id="ss-sync" class="lmc-add-btn">↻ Use first 4 full screenshots</button>' : ''}
            <button type="button" id="ss-upload-new" class="lmc-add-btn">↑ Upload image</button>
            <button type="button" id="ss-add" class="lmc-add-btn">+ Add by URL</button>
        </div></div>`;
    drawer.querySelector('#ss-close').onclick = () => { drawer.hidden = true; };
    drawer.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
        drawer.dataset.mode = b.dataset.mode;
        renderScreenshotsDrawer(drawer);
    });
    const list = drawer.querySelector('#ss-list');
    const renderRows = () => {
        list.replaceChildren();
        entries.forEach((item, i) => {
            const row = document.createElement('div');
            row.className = 'ss-row' + (i === focusIndex ? ' ss-focus' : '');
            row.innerHTML = `
                <img alt="Preview ${i + 1}">
                <div class="ss-fields">
                    <input type="text" aria-label="Image URL" placeholder="Image URL">
                    <input type="text" aria-label="Image description" placeholder="${previews ? 'Alt text (optional)' : 'Caption (optional)'}">
                </div>
                <div class="ss-actions">
                    ${i > 0 ? '<button type="button" class="lmc-ctrl" data-dir="-1" title="Move up">↑</button>' : ''}
                    ${i < entries.length-1 ? '<button type="button" class="lmc-ctrl" data-dir="1" title="Move down">↓</button>' : ''}
                    <button type="button" class="lmc-ctrl" data-upload>↑ Replace</button>
                    <button type="button" class="lmc-ctrl lmc-ctrl-remove" data-rm>✕ Remove</button>
                </div>`;
            const srcInp = row.querySelector('input[aria-label="Image URL"]');
            const textInp = row.querySelector('input[aria-label="Image description"]');
            srcInp.value = item.src || '';
            textInp.value = item[labelKey] || '';
            // Show an image from the current iframe when possible; otherwise
            // resolve a relative source from its pack page directory.
            const canonical = item.src || '';
            const iframeSelector = previews ? SELECTORS.thumbnailItems : SELECTORS.slides + ' img';
            const matching = iframeDoc()?.querySelectorAll(iframeSelector)[i];
            row.querySelector('img').src = matching?.src || new URL(canonical, new URL(E.file.replace(/[^/]+$/, ''), E.siteUrl)).href;
            const commit = () => sendEdit(field, entries.map(x => ({...x})));
            srcInp.addEventListener('change', () => { entries[i].src = srcInp.value.trim(); commit(); });
            textInp.addEventListener('change', () => { entries[i][labelKey] = textInp.value.trim(); commit(); });
            row.querySelectorAll('[data-dir]').forEach(btn => btn.onclick = () => {
                const j = i + Number(btn.dataset.dir);
                [entries[i], entries[j]] = [entries[j], entries[i]];
                commit(); renderRows();
            });
            row.querySelector('[data-rm]').onclick = () => {
                entries.splice(i, 1); commit(); renderRows();
            };
            row.querySelector('[data-upload]').onclick = () => pickImage(i);
            list.append(row);
        });
    };
    function pickImage(index) {
        const picker = document.createElement('input');
        picker.type = 'file'; picker.accept = 'image/*';
        picker.onchange = async () => {
            const f = picker.files?.[0]; if (!f) return;
            channel.send('upload', { file: E.file, field, clientId: E.clientId,
                index, name: f.name, mime: f.type, bytes: await f.arrayBuffer() });
        };
        picker.click();
    }
    renderRows();
    drawer.querySelector('#ss-upload-new').onclick = () => pickImage(entries.length);
    drawer.querySelector('#ss-add').onclick = () => {
        const src = prompt('Image URL:', '');
        if (!src?.trim()) return;
        entries.push({src: src.trim(), [labelKey]: ''});
        sendEdit(field, entries.map(x => ({...x})));
        renderRows();
        list.lastElementChild?.scrollIntoView({ block: 'nearest' });
    };
    if (previews) drawer.querySelector('#ss-sync').onclick = () => {
        const slides = E.pageData?.slides || [];
        if (!slides.length) { alert('Add full screenshots first.'); return; }
        sendEdit('previews', slides.slice(0, 4).filter(x => x.src).map(x => ({ src: x.src, alt: x.caption || '' })));
    };
}

// ── Publish dialog ─────────────────────────────────────────────────────────

function openPublishDialog() {
    if (!E.pending) return;
    const existing = document.getElementById('lmc-publish-dialog');
    if (existing) { existing.remove(); return; }

    const dialog = document.createElement('div');
    dialog.id = 'lmc-publish-dialog';
    dialog.className = 'lmc-dialog';
    dialog.innerHTML = `
        <h3>Publish ${E.pending} change${E.pending !== 1 ? 's' : ''}</h3>
        <label>Commit message
            <input id="pub-msg" type="text" placeholder="Update site">
        </label>
        <ul id="pub-steps" class="pub-steps"></ul>
        <div class="lmc-dialog-actions">
            <button id="pub-cancel">Cancel</button>
            <button id="pub-go" class="lmc-primary">Publish</button>
        </div>
    `;
    document.body.appendChild(dialog);

    dialog.querySelector('#pub-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#pub-go').addEventListener('click', () => {
        const msg = dialog.querySelector('#pub-msg').value.trim() || 'Update site';
        dialog.querySelector('#pub-go').disabled = true;
        dialog.querySelector('#pub-cancel').textContent = 'Close';
        E.publishInProgress = true;
        channel.send('publish', { message: msg });
    });
}

function renderPublishStep(step) {
    const steps = document.getElementById('pub-steps');
    if (!steps) return;
    let li = steps.querySelector(`[data-step-id="${step.id}"]`);
    if (!li) {
        li = document.createElement('li');
        li.setAttribute('data-step-id', step.id);
        steps.appendChild(li);
    }
    const icon = step.state === 'running' ? '⏳' : step.state === 'done' ? '✅' : '❌';
    li.innerHTML = `${icon} ${esc(step.text)}` + (step.link ? ` <a href="${esc(step.link)}" target="_blank" rel="noopener">View</a>` : '');
    if (step.id === 'deploy' && step.state !== 'running') {
        E.publishInProgress = false;
        // Re-request state after publish completes
        setTimeout(() => channel.send('hello', { file: E.file }), 1000);
    }
}

// ── UI updates ─────────────────────────────────────────────────────────────

function updateConnectionUI() {
    const dot = connDot();
    if (!dot) return;
    dot.className = 'conn-dot ' + (E.connected ? 'connected' : 'disconnected');
    dot.title = E.connected ? 'Admin tab connected' : 'Admin tab not responding';
}

function updatePendingUI() {
    const badge = pendingBadge();
    if (badge) {
        badge.textContent = E.pending ? E.pending + ' pending' : '';
        badge.hidden = !E.pending;
    }
    const pb = publishBtn();
    if (pb) pb.disabled = !E.pending || !E.connected;
}

function buildFileSwitcher() {
    const sel = fileSelect();
    if (!sel) return;
    const cur = sel.value || E.file;
    sel.innerHTML = '';
    for (const p of E.packs) {
        const opt = document.createElement('option');
        opt.value = p.file;
        opt.textContent = p.name;
        if (p.file === cur) opt.selected = true;
        sel.appendChild(opt);
    }
    // Add index.html
    if (!E.packs.find(p => p.file === 'index.html')) {
        const opt = document.createElement('option');
        opt.value = 'index.html';
        opt.textContent = 'Home page (index.html)';
        if (E.file === 'index.html') opt.selected = true;
        sel.prepend(opt);
    }
}

function showDisconnectedBanner() {
    const b = disconnBanner();
    if (b) b.hidden = false;
}

function disableEditing() {
    E.editMode = false;
    const doc = iframeDoc();
    if (doc) {
        doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        doc.querySelectorAll('.lmc-editable').forEach(el => el.classList.remove('lmc-editable'));
    }
    const et = editToggle();
    if (et) et.checked = false;
}

// ── Send helpers ───────────────────────────────────────────────────────────

function sendEdit(field, value, index) {
    if (!channel || !E.connected) return;
    channel.send('edit', {
        clientId: E.clientId,
        file: E.file,
        field,
        value,
        index: index ?? null,
    });
}

function sendListOp(field, op, index, to, value) {
    if (!channel || !E.connected) return;
    channel.send('list-op', {
        clientId: E.clientId,
        file: E.file,
        field,
        op,
        index,
        to: to ?? null,
        value: value ?? null,
    });
}

// ── Toolbar events ─────────────────────────────────────────────────────────

function bindToolbar() {
    const sel = fileSelect();
    if (sel) {
        sel.addEventListener('change', () => {
            E.file = sel.value;
            pageSettingsDrawer().hidden = true;
            screenshotsDrawer().hidden = true;
            // Update our origin ID
            if (channel) {
                channel.close();
                channel = new AdminChannel(key, 'editor-' + E.file, msg => handleHubMessage(msg));
            }
            channel.send('hello', { file: E.file });
            // Update title
            document.title = 'Editor — ' + E.file;
        });
    }

    const ub = undoBtn();
    if (ub) ub.addEventListener('click', () => channel?.send('undo'));

    const rb = redoBtn();
    if (rb) rb.addEventListener('click', () => channel?.send('redo'));

    const pb = publishBtn();
    if (pb) pb.addEventListener('click', openPublishDialog);

    const psBtn = document.getElementById('page-settings-btn');
    if (psBtn) psBtn.addEventListener('click', openPageSettingsDrawer);

    const ssBtn = document.getElementById('screenshots-btn');
    if (ssBtn) ssBtn.addEventListener('click', () => openScreenshotsDrawer(0));

    const et = editToggle();
    if (et) {
        et.addEventListener('change', () => {
            E.editMode = et.checked;
            const doc = iframeDoc();
            if (!doc) return;
            if (E.editMode) {
                annotateIframe();
            } else {
                // Remove edit annotations
                doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
                doc.querySelectorAll('.lmc-editable').forEach(el => el.classList.remove('lmc-editable'));
                doc.querySelectorAll('.lmc-list-controls, .lmc-add-btn').forEach(el => el.hidden = true);
            }
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            channel?.send('undo');
            e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            channel?.send('redo');
            e.preventDefault();
        }
        if (e.key === 'Escape') closePopovers();
    });

    // Close popovers on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('.lmc-popover')) closePopovers();
    });
}

// ── Editor iframe CSS (injected into srcdoc) ────────────────────────────────

const EDITOR_IFRAME_CSS = `
/* Listar MC visual editor affordances — injected into the iframe only */

.lmc-editable {
    outline: 1.5px dashed rgba(156, 95, 230, 0.35);
    border-radius: 2px;
    cursor: text;
    min-height: 1em;
    transition: outline 0.1s;
}
.lmc-editable:hover {
    outline: 1.5px dashed rgba(156, 95, 230, 0.7);
}
.lmc-editable:focus {
    outline: 2px solid #9c5fe6;
    border-radius: 2px;
}
.lmc-editable[data-lmc-field]::after {
    content: attr(data-lmc-field);
    position: absolute;
    top: -18px;
    left: 0;
    font-size: 10px;
    background: #9c5fe6;
    color: #fff;
    padding: 1px 5px;
    border-radius: 3px;
    pointer-events: none;
    opacity: 0;
    white-space: nowrap;
    transition: opacity 0.15s;
}
.lmc-editable:focus[data-lmc-field]::after {
    opacity: 1;
}
.lmc-editable:focus {
    position: relative;
}
.lmc-img.lmc-editable {
    cursor: pointer;
    outline: 1.5px dashed rgba(156, 95, 230, 0.5);
}
.lmc-img.lmc-editable:hover {
    outline: 2px solid #9c5fe6;
    filter: brightness(1.08);
}
.lmc-link.lmc-editable {
    position: relative;
}
.lmc-link.lmc-editable::before {
    content: '✎ Link';
    position: absolute;
    top: -20px;
    left: 0;
    font-size: 10px;
    background: #9c5fe6;
    color: #fff;
    padding: 1px 5px;
    border-radius: 3px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
}
.lmc-link.lmc-editable:hover::before { opacity: 1; }
a.lmc-editable { cursor: pointer; }
a.lmc-editable[href]::after { display: none; }

.lmc-list-controls {
    display: inline-flex;
    gap: 2px;
    margin-left: 6px;
    vertical-align: middle;
    opacity: 0;
    transition: opacity 0.15s;
}
*:hover > .lmc-list-controls,
li:hover .lmc-list-controls {
    opacity: 1;
}
.lmc-ctrl {
    background: rgba(156, 95, 230, 0.15);
    border: 1px solid rgba(156, 95, 230, 0.4);
    color: #9c5fe6;
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
    cursor: pointer;
    line-height: 1.4;
}
.lmc-ctrl:hover {
    background: rgba(156, 95, 230, 0.35);
}
.lmc-ctrl-remove {
    color: #e05a5a;
    border-color: rgba(224, 90, 90, 0.5);
    background: rgba(224, 90, 90, 0.1);
}
.lmc-ctrl-remove:hover { background: rgba(224, 90, 90, 0.25); }

.lmc-add-btn {
    display: block;
    margin: 6px 0;
    padding: 3px 10px;
    background: rgba(156, 95, 230, 0.1);
    border: 1px dashed rgba(156, 95, 230, 0.5);
    color: #9c5fe6;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    width: 100%;
}
.lmc-add-btn:hover { background: rgba(156, 95, 230, 0.2); }

.lmc-preview.lmc-editable {
    cursor: pointer;
}
.lmc-preview.lmc-editable::after {
    content: '✎ Screenshot';
    position: absolute;
    bottom: 4px;
    left: 4px;
    font-size: 10px;
    background: #9c5fe6;
    color: #fff;
    padding: 2px 6px;
    border-radius: 3px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
}
.lmc-preview.lmc-editable:hover::after { opacity: 1; }
.lmc-preview.lmc-editable { position: relative; }
`;

// ── Boot ───────────────────────────────────────────────────────────────────

function boot() {
    // Set page title
    document.title = 'Editor — ' + (E.file || 'Listar MC');

    // Bind toolbar
    bindToolbar();

    // Connect to hub
    connect();

    // Show loading state
    const fr = iframe();
    if (fr) {
        fr.srcdoc = `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#1a1a2e;color:#aaa"><p>Connecting to admin tab…</p></body></html>`;
    }

    // Show note if file:// is being used
    if (location.protocol === 'file:') {
        alert('The visual editor requires the site to be served over http:// or https://. Please use the live admin URL or run: npx serve');
    }
}

boot();
