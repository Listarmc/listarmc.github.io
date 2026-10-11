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
    siteUrl: 'https://listar-mc.net/',
    connected: false,
    missedPings: 0,
    editMode: true,
    publishInProgress: false,
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
        // Don't update a field if we sent this change ourselves
        // (hub already applied it and sent it back; the iframe already reflects it)
        applyChangedToIframe(msg);
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
    fr.srcdoc = html;
    fr.addEventListener('load', () => {
        // Hide the loading overlay once the iframe has content
        const loading = document.getElementById('editor-loading');
        if (loading) loading.hidden = true;
        if (E.editMode) annotateIframe();
    }, { once: true });
}

function iframeDoc() {
    const fr = iframe();
    try { return fr.contentDocument; } catch (e) { return null; }
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
    const style = doc.createElement('style');
    style.textContent = EDITOR_IFRAME_CSS;
    doc.head.appendChild(style);

    if (!E.editMode) return;

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
        img.closest('.thumbnail-item')?.classList.add('lmc-editable', 'lmc-preview');
        img.closest('.thumbnail-item')?.setAttribute('data-lmc-index', i);
        img.closest('.thumbnail-item')?.addEventListener('click', e => {
            e.preventDefault();
            openScreenshotsDrawer(i);
        });
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

        // Paste as plain text
        el.addEventListener('paste', e => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
        });

        let debounceT;
        const commit = () => {
            clearTimeout(debounceT);
            const val = sanitizeRichText(getValue(el));
            // Send the whole array
            const allEls = [...doc.querySelectorAll(selector)];
            const arr = allEls.map((e2, j) => {
                if (j === i) return val;
                return sanitizeRichText(getValue(e2));
            });
            sendEdit(field, arr);
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
    const addBtn = doc.createElement('button');
    addBtn.className = 'lmc-add-btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
        sendListOp(field, 'insert', els.length, null, '');
    });
    const container = els[0]?.parentElement;
    if (container) container.append(addBtn);
}

function makeTagList(doc, selector, field) {
    const els = [...doc.querySelectorAll(selector)];
    els.forEach((el, i) => {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.setAttribute('data-lmc-field', field);
        el.setAttribute('data-lmc-index', i);
        el.classList.add('lmc-editable', 'lmc-tag');

        let debounceT;
        el.addEventListener('input', () => {
            clearTimeout(debounceT);
            debounceT = setTimeout(() => {
                const allEls = [...doc.querySelectorAll(selector)];
                const arr = allEls.map(e2 => e2.textContent.trim());
                sendEdit(field, arr);
            }, 250);
        });
        el.addEventListener('blur', () => {
            clearTimeout(debounceT);
            const allEls = [...doc.querySelectorAll(selector)];
            const arr = allEls.map(e2 => e2.textContent.trim());
            sendEdit(field, arr);
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
}

function makeImageElement(doc, selector, field) {
    const el = doc.querySelector(selector);
    if (!el) return;
    el.classList.add('lmc-editable', 'lmc-img');
    el.setAttribute('data-lmc-field', field);
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

    // Don't patch an element that has focus (avoid clobbering the user's cursor)
    const active = doc.activeElement;

    // For array fields with an index, only update that element if it's not focused
    if (index != null) {
        const el = doc.querySelector(`[data-lmc-field="${field}"][data-lmc-index="${index}"]`);
        if (el && el !== active) {
            el.textContent = typeof value === 'object' ? (value?.[index] || '') : value;
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
                PAGE.set[field]?.(iDoc, value);
                // Re-annotate the newly rendered elements
                setTimeout(() => annotateIframe(), 50);
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
        <h3>Page settings</h3>
        <label>Browser title
            <input id="ps-title" type="text" placeholder="Pack Name | Listar MC">
        </label>
        <p class="ps-hint">~50–60 characters recommended. <span id="ps-title-count">0</span></p>
        <label>Meta description
            <textarea id="ps-meta" rows="3" placeholder="Describe the pack for Google…"></textarea>
        </label>
        <p class="ps-hint">~140–160 characters recommended. <span id="ps-meta-count">0</span></p>
        <button id="ps-close">Close</button>
    `;
    const titleInp = drawer.querySelector('#ps-title');
    const metaInp = drawer.querySelector('#ps-meta');
    const titleCount = drawer.querySelector('#ps-title-count');
    const metaCount = drawer.querySelector('#ps-meta-count');

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

function openScreenshotsDrawer(focusIndex) {
    closePopovers();
    const drawer = screenshotsDrawer();
    drawer.hidden = false;
    renderScreenshotsDrawer(drawer, focusIndex);
}

function renderScreenshotsDrawer(drawer, focusIndex) {
    // Gather current slide data from iframe
    const doc = iframeDoc();
    const slides = doc ? [...doc.querySelectorAll(SELECTORS.slides)].map(s => ({
        src: s.querySelector('img')?.getAttribute('src') || '',
        caption: s.querySelector('#caption, .caption')?.textContent.trim() || '',
    })) : [];

    drawer.innerHTML = `
        <div class="ss-header">
            <h3>Screenshots (${slides.length})</h3>
            <button id="ss-close">✕</button>
        </div>
        <div class="ss-list" id="ss-list"></div>
        <button id="ss-add" class="lmc-add-btn">+ Add screenshot</button>
    `;

    const list = drawer.querySelector('#ss-list');
    const renderSlides = () => {
        list.innerHTML = '';
        slides.forEach((slide, i) => {
            const row = document.createElement('div');
            row.className = 'ss-row' + (i === focusIndex ? ' ss-focus' : '');
            row.innerHTML = `
                <img src="${esc(slide.src)}" alt="">
                <div class="ss-fields">
                    <input type="text" placeholder="Image URL" value="${esc(slide.src)}">
                    <input type="text" placeholder="Caption (optional)" value="${esc(slide.caption)}">
                </div>
                <div class="ss-actions">
                    ${i > 0 ? '<button class="lmc-ctrl" data-dir="-1">↑</button>' : ''}
                    ${i < slides.length - 1 ? '<button class="lmc-ctrl" data-dir="1">↓</button>' : ''}
                    <button class="lmc-ctrl lmc-ctrl-remove" data-rm>✕</button>
                    <button class="lmc-ctrl" data-upload>↑ Upload</button>
                </div>
            `;
            const [srcInp, capInp] = row.querySelectorAll('input');
            srcInp.addEventListener('change', () => {
                slides[i].src = srcInp.value;
                sendEdit('slides', [...slides]);
                row.querySelector('img').src = srcInp.value;
            });
            capInp.addEventListener('change', () => {
                slides[i].caption = capInp.value;
                sendEdit('slides', [...slides]);
            });
            row.querySelectorAll('[data-dir]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dir = parseInt(btn.dataset.dir);
                    const j = i + dir;
                    [slides[i], slides[j]] = [slides[j], slides[i]];
                    sendEdit('slides', [...slides]);
                    renderSlides();
                });
            });
            row.querySelector('[data-rm]').addEventListener('click', () => {
                slides.splice(i, 1);
                sendEdit('slides', [...slides]);
                renderSlides();
            });
            row.querySelector('[data-upload]').addEventListener('click', () => {
                const fi = document.createElement('input');
                fi.type = 'file';
                fi.accept = 'image/*';
                fi.onchange = () => {
                    const file = fi.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                        const b64 = reader.result.split(',')[1];
                        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
                        channel.send('upload', { file: E.file, field: 'slides', index: i, name: file.name, mime: file.type, bytes });
                    };
                    reader.readAsDataURL(file);
                };
                fi.click();
            });
            list.append(row);
        });
    };
    renderSlides();

    drawer.querySelector('#ss-close').addEventListener('click', () => { drawer.hidden = true; });
    drawer.querySelector('#ss-add').addEventListener('click', () => {
        slides.push({ src: '', caption: '' });
        sendEdit('slides', [...slides]);
        renderSlides();
    });
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
    if (!channel) return;
    channel.send('edit', {
        file: E.file,
        field,
        value,
        index: index ?? null,
    });
}

function sendListOp(field, op, index, to, value) {
    if (!channel) return;
    channel.send('list-op', {
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
                doc.querySelectorAll('.lmc-list-controls, .lmc-add-btn').forEach(el => el.remove());
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
