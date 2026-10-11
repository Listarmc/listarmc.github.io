/**
 * app.js — Listar MC admin panel main logic.
 * Loaded as an ES module by admin.html.
 *
 * Imports core (field registry, DOM helpers), github (API), channel (cross-tab).
 * The visual tab is admin-editor.html / editor.js; this file is the HUB.
 */

import {
    parseHTML, serialize, esc,
    text, setText, attr, setAttr,
    wsBefore, indentOf, removeWithWs, frag,
    replaceChildren, replaceMatching,
    CARD, PAGE, stripEditorMarkup,
} from './core.js';

import {
    gh, fileToBase64, repoPath, refPath,
    loadTree, readText, publish as ghPublish, watchDeploy,
} from './github.js';

import { AdminChannel, makeKey, editorUrl } from './channel.js';

// ── State ──────────────────────────────────────────────────────────────────

const DEFAULTS = { owner: 'Listarmc', repo: 'listarmc.github.io', branch: 'main' };
const STORE_KEY = 'lmc_admin_cfg';
const UPLOAD_DIR = 'thumbnails/';
const WORKFLOW_FILE = 'static.yml';

const S = {
    cfg: null,
    headSha: null,
    tree: new Map(),
    files: new Map(),
    uploads: new Map(),
    deletes: new Set(),
    packs: [],
    current: null,
    tab: 'card',
    siteUrl: 'https://listar-mc.net/',
    editedCards: new WeakSet(),
    // Visual editor hub state
    sessionKey: makeKey(),
    channel: null,          // AdminChannel | null
    editorTabs: new Map(),  // file -> 'open' | 'closed'
    rev: 0,                 // monotone counter per change
    undoStack: [],          // [{file, field, index, before, after}]
    redoStack: [],
};

const $ = (sel, root = document) => root.querySelector(sel);

// ── General helpers ────────────────────────────────────────────────────────

function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
}

function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), bad ? 6000 : 2500);
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

// ── Config & connect ───────────────────────────────────────────────────────

function readStoredCfg() {
    // Phase 6: sessionStorage only (no localStorage token)
    try {
        const raw = sessionStorage.getItem(STORE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
}

function storeCfg(cfg) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

function forgetCfg() {
    try { sessionStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
}

function showConnect(error) {
    $('#app').hidden = true;
    $('#connect-screen').hidden = false;
    const c = S.cfg || readStoredCfg() || {};
    $('#cfg-owner').value = c.owner || DEFAULTS.owner;
    $('#cfg-repo').value = c.repo || DEFAULTS.repo;
    $('#cfg-branch').value = c.branch || DEFAULTS.branch;
    $('#cfg-token').value = '';
    $('#connect-error').textContent = error || '';
}

async function connect(cfg) {
    S.cfg = cfg;
    const repo = await gh('GET', repoPath(cfg), null, cfg.token);
    if (repo.permissions && repo.permissions.push === false) {
        throw new Error('This account has no write access to ' + repo.full_name + '.');
    }
    await reloadAll();
}

async function reloadAll() {
    const ref = await gh('GET', refPath(S.cfg), null, S.cfg.token);
    S.headSha = ref.object.sha;
    S.tree = await loadTree(S.cfg, S.headSha);
    S.files.clear();
    S.uploads.forEach(u => URL.revokeObjectURL(u.url));
    S.uploads.clear();
    S.deletes.clear();
    S.undoStack = [];
    S.redoStack = [];
    if (!S.tree.has('index.html')) throw new Error('index.html not found on branch ' + S.cfg.branch + '.');
    await loadHtmlFile('index.html');
    await loadTextFile('sitemap.xml');
    const cname = await readText(S.cfg, S.tree, 'CNAME').catch(() => null);
    if (cname && cname.trim()) S.siteUrl = 'https://' + cname.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') + '/';
    buildPackList();
    S.editedCards = new WeakSet();
    S.current = null;
    renderShell();
    renderList();
    renderEditor();
    updatePending();
}

// ── File loading ───────────────────────────────────────────────────────────

async function loadHtmlFile(path) {
    if (S.files.has(path)) return S.files.get(path);
    const text2 = await readText(S.cfg, S.tree, path);
    if (text2 == null) throw new Error('File not found in repo: ' + path);
    const doc = parseHTML(text2);
    const f = { kind: 'html', original: text2, baseline: serialize(parseHTML(text2)), doc };
    S.files.set(path, f);
    return f;
}

async function loadTextFile(path) {
    if (S.files.has(path)) return S.files.get(path);
    const text2 = await readText(S.cfg, S.tree, path);
    if (text2 == null) return null;
    const f = { kind: 'text', original: text2, text: text2 };
    S.files.set(path, f);
    return f;
}

// ── Pack model ─────────────────────────────────────────────────────────────

const indexDoc = () => S.files.get('index.html').doc;
const packsContainer = () => indexDoc().getElementById('packs-container');

function cardFile(card) {
    const a = card.querySelector('a.overlay-btn');
    const href = a ? a.getAttribute('href') || '' : '';
    return href.split('#')[0].replace(/^\.?\//, '');
}

function buildPackList() {
    const cards = [...packsContainer().querySelectorAll('.pack-card')];
    const byFile = new Map();
    S.packs = [];
    for (const card of cards) {
        const p = { file: cardFile(card), card };
        S.packs.push(p);
        byFile.set(p.file, p);
    }
    for (const path of [...S.tree.keys()].filter(p => /^Packs\/[^/]+\.html$/.test(p)).sort()) {
        if (!byFile.has(path)) S.packs.push({ file: path, card: null });
    }
}

const pageExists = file => (S.tree.has(file) && !S.deletes.has(file)) || (S.files.has(file) && S.files.get(file).original === null);

function packName(p) {
    if (p.card) return text(p.card, '.pack-title') || p.file;
    const f = S.files.get(p.file);
    if (f && f.doc) return f.doc.title || p.file;
    return p.file.replace(/^Packs\//, '').replace(/\.html$/, '').replace(/-/g, ' ');
}

function packStatus(p) {
    const f = S.files.get(p.file);
    if (f && f.original === null) return 'new';
    if (f && serialize(f.doc) !== f.baseline) return 'edited';
    if (p.card && S.editedCards.has(p.card)) return 'edited';
    return '';
}

// ── Images ────────────────────────────────────────────────────────────────

function resolveImg(src, fromPage) {
    if (!src) return '';
    if (/^(https?:)?\/\//.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src.startsWith('//') ? 'https:' + src : src;
    const base = fromPage ? 'Packs/' : '';
    const path = new URL(src, 'https://x/' + base).pathname.slice(1);
    const up = S.uploads.get(decodeURIComponent(path));
    if (up) return up.url;
    return `https://raw.githubusercontent.com/${S.cfg.owner}/${S.cfg.repo}/${S.headSha}/${path}`;
}

async function stageUpload(file) {
    if (!file.type.startsWith('image/')) throw new Error('Not an image file.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Image is larger than 25 MB.');
    const dot = file.name.lastIndexOf('.');
    const stem = (dot > 0 ? file.name.slice(0, dot) : file.name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
    const ext = (dot > 0 ? file.name.slice(dot + 1) : 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    let path = UPLOAD_DIR + stem + '.' + ext;
    for (let i = 2; S.tree.has(path) || S.uploads.has(path); i++) path = `${UPLOAD_DIR}${stem}-${i}.${ext}`;
    S.uploads.set(path, { base64: await fileToBase64(file), url: URL.createObjectURL(file) });
    updatePending();
    return path;
}

async function stageUploadBytes(name, mime, bytes) {
    // Used when the editor tab sends a file as ArrayBuffer
    const blob = new Blob([bytes], { type: mime });
    const file = new File([blob], name, { type: mime });
    return stageUpload(file);
}

// ── Pending changes ────────────────────────────────────────────────────────

function pendingChanges() {
    const out = [];
    for (const [path, f] of S.files) {
        if (S.deletes.has(path)) continue;
        if (f.kind === 'html') {
            const now = serialize(f.doc);
            // Guard: no editor artifacts in committed HTML
            if (now.includes('data-lmc-') || now.includes('contenteditable')) {
                console.error('Editor markup found in serialized HTML for', path, '— stripping');
                f.doc = parseHTML(stripEditorMarkup(now));
                const clean = serialize(f.doc);
                if (f.original === null) out.push({ path, status: 'A', content: clean });
                else if (clean !== f.baseline) out.push({ path, status: 'M', content: clean });
                continue;
            }
            if (f.original === null) out.push({ path, status: 'A', content: now });
            else if (now !== f.baseline) out.push({ path, status: 'M', content: now });
        } else if (f.text !== f.original) {
            out.push({ path, status: f.original === null ? 'A' : 'M', content: f.text });
        }
    }
    for (const [path, u] of S.uploads) out.push({ path, status: 'A', base64: u.base64 });
    for (const path of S.deletes) if (S.tree.has(path)) out.push({ path, status: 'D' });
    return out;
}

const updatePending = debounce(() => {
    const changes = pendingChanges();
    const n = changes.length;
    $('#pending-count').textContent = n;
    $('#publish-btn').disabled = n === 0;
    // Highlight pack list entries with editor tabs open
    renderList();
    // Broadcast pending count to editor tabs
    if (S.channel) {
        const files = [...new Set(changes.map(c => c.path))];
        S.channel.send('pending', { count: n, files });
    }
}, 250);

window.addEventListener('beforeunload', e => {
    if (S.headSha && pendingChanges().length) { e.preventDefault(); e.returnValue = ''; }
    if (S.channel) S.channel.send('bye');
});

// ── BroadcastChannel hub ───────────────────────────────────────────────────

function startHub() {
    if (S.channel) S.channel.close();
    S.channel = new AdminChannel(S.sessionKey, 'hub', msg => handleEditorMessage(msg));
    // Heartbeat
    setInterval(() => { if (S.channel) S.channel.send('ping'); }, 5000);
}

function handleEditorMessage(msg) {
    if (msg.origin === 'hub') return; // echo guard

    if (msg.type === 'pong') return; // heartbeat ack

    if (msg.type === 'ping') {
        S.channel.send('pong');
        return;
    }

    if (msg.type === 'hello') {
        // Editor opened: send full state snapshot
        sendState(msg.file || S.current?.file || '');
        return;
    }

    if (msg.type === 'edit') {
        applyEdit(msg, true);
        return;
    }

    if (msg.type === 'list-op') {
        applyListOp(msg, true);
        return;
    }

    if (msg.type === 'upload') {
        (async () => {
            try {
                const path = await stageUploadBytes(msg.name, msg.mime, msg.bytes);
                // Apply the field change with the new path
                const fromPage = msg.file !== 'index.html';
                const newSrc = (fromPage ? '../' : '') + path;
                applyEdit({ file: msg.file, field: msg.field, value: newSrc, index: msg.index ?? null, card: msg.card ?? null, rev: S.rev }, true);
                toast('Image staged: ' + path);
            } catch (e) { toast(e.message, true); }
        })();
        return;
    }

    if (msg.type === 'publish') {
        const changes = pendingChanges();
        if (!changes.length) return;
        runPublish(changes, msg.message || 'Update site');
        return;
    }

    if (msg.type === 'discard') {
        const p = S.packs.find(x => x.file === msg.file);
        if (p) discardPack(p);
        return;
    }

    if (msg.type === 'undo') {
        doUndo();
        return;
    }

    if (msg.type === 'redo') {
        doRedo();
        return;
    }
}

function sendState(file) {
    if (!S.channel) return;
    let html = '';
    if (file && S.files.has(file)) {
        const f = S.files.get(file);
        if (f.kind === 'html') {
            // Strip scripts/ads for the editor display copy
            const doc2 = parseHTML(serialize(f.doc));
            doc2.querySelectorAll('script').forEach(s => s.remove());

            // Helper: resolve a relative URL to an absolute one (raw GitHub or upload blob)
            const pageDir = 'https://x/' + file.replace(/[^/]+$/, '');
            const resolveRelative = src => {
                if (!src || /^(https?:)?\/\//.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
                const path = new URL(src, pageDir).pathname.slice(1);
                const up = S.uploads.get(decodeURIComponent(path));
                if (up) return up.url;
                return `https://raw.githubusercontent.com/${S.cfg.owner}/${S.cfg.repo}/${S.headSha}/${path}`;
            };

            // Resolve stylesheet hrefs so they load cross-origin inside the iframe
            doc2.querySelectorAll('link[rel="stylesheet"][href], link[rel~="stylesheet"][href]').forEach(link => {
                const resolved = resolveRelative(link.getAttribute('href'));
                if (resolved) link.setAttribute('href', resolved);
            });

            // Resolve images
            doc2.querySelectorAll('img[src]').forEach(img => {
                const resolved = resolveRelative(img.getAttribute('src'));
                if (resolved) img.setAttribute('src', resolved);
            });

            // No <base> needed — all URLs are now absolute
            html = serialize(doc2);
        }
    }
    const changes = pendingChanges();
    S.channel.send('state', {
        file,
        rev: S.rev,
        html,
        pending: changes.length,
        packs: S.packs.map(p => ({ file: p.file, name: packName(p) })),
        siteUrl: S.siteUrl,
    });
}

function applyEdit(msg, broadcast) {
    const { file, field, value, index, card: cardFile2 } = msg;
    if (!file) return;

    // Push undo
    const before = getFieldValue(file, field, index, cardFile2);
    S.undoStack.push({ file, field, index: index ?? null, card: cardFile2 ?? null, before, after: value });
    S.redoStack = [];

    _applyFieldSet(file, field, value, index, cardFile2);

    S.rev++;
    if (broadcast && S.channel) {
        S.channel.send('changed', { file, field, value, index: index ?? null, card: cardFile2 ?? null, rev: S.rev });
    }
    // Refresh admin form if we're showing this pack
    const p = S.current;
    if (p && (p.file === file || (file === 'index.html' && cardFile2 === p.file))) {
        flashFormField(field);
    }
    updatePending();
}

function applyListOp(msg, broadcast) {
    const { file, field, op, index, to, value } = msg;
    if (!file) return;
    const f = S.files.get(file);
    if (!f || f.kind !== 'html') return;

    const current = getFieldValue(file, field, null, null);
    if (!Array.isArray(current)) return;

    const arr = [...current];
    if (op === 'insert') arr.splice(index, 0, value ?? '');
    else if (op === 'remove') arr.splice(index, 1);
    else if (op === 'move' && to != null) { const [item] = arr.splice(index, 1); arr.splice(to, 0, item); }

    S.undoStack.push({ file, field, index: null, card: null, before: current, after: arr });
    S.redoStack = [];

    _applyFieldSet(file, field, arr, null, null);
    S.rev++;
    if (broadcast && S.channel) {
        S.channel.send('changed', { file, field, value: arr, index: null, card: null, rev: S.rev });
    }
    updatePending();
}

function getFieldValue(file, field, index, cardFile2) {
    if (file === 'index.html' && cardFile2) {
        const p = S.packs.find(x => x.file === cardFile2);
        if (!p || !p.card) return null;
        const v = CARD.get(p.card);
        return index != null ? (v[field] || [])[index] : v[field];
    }
    const f = S.files.get(file);
    if (!f || f.kind !== 'html') return null;
    const v = PAGE.get(f.doc);
    return index != null ? (v[field] || [])[index] : v[field];
}

function _applyFieldSet(file, field, value, index, cardFile2) {
    if (file === 'index.html' && cardFile2) {
        const p = S.packs.find(x => x.file === cardFile2);
        if (!p || !p.card) return;
        if (index != null) {
            const arr = [...(CARD.get(p.card)[field] || [])];
            arr[index] = value;
            CARD.set[field]?.(p.card, arr, syncFilterOptions);
        } else {
            CARD.set[field]?.(p.card, value, syncFilterOptions);
        }
        S.editedCards.add(p.card);
        return;
    }
    const f = S.files.get(file);
    if (!f || f.kind !== 'html') return;
    if (index != null) {
        const arr = [...(PAGE.get(f.doc)[field] || [])];
        arr[index] = value;
        PAGE.set[field]?.(f.doc, arr);
    } else {
        PAGE.set[field]?.(f.doc, value);
    }
}

function doUndo() {
    const item = S.undoStack.pop();
    if (!item) return;
    S.redoStack.push(item);
    _applyFieldSet(item.file, item.field, item.before, item.index, item.card);
    S.rev++;
    if (S.channel) S.channel.send('changed', { file: item.file, field: item.field, value: item.before, index: item.index, card: item.card, rev: S.rev });
    updatePending();
}

function doRedo() {
    const item = S.redoStack.pop();
    if (!item) return;
    S.undoStack.push(item);
    _applyFieldSet(item.file, item.field, item.after, item.index, item.card);
    S.rev++;
    if (S.channel) S.channel.send('changed', { file: item.file, field: item.field, value: item.after, index: item.index, card: item.card, rev: S.rev });
    updatePending();
}

function flashFormField(fieldName) {
    // Find the input/textarea related to this field and briefly highlight it
    const sel = `[data-field="${fieldName}"]`;
    const el = document.querySelector(sel);
    if (!el || document.activeElement === el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 600);
}

// ── Sitemap ────────────────────────────────────────────────────────────────

const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sitemapAdd(path) {
    const f = S.files.get('sitemap.xml');
    if (!f) return;
    const loc = xmlEsc(S.siteUrl + path);
    if (f.text.includes('<loc>' + loc + '</loc>')) return;
    const block = `    <url>\n        <loc>${loc}</loc>\n        <changefreq>weekly</changefreq>\n        <priority>0.7</priority>\n    </url>\n`;
    const re = new RegExp('<url>\\s*<loc>' + reEsc(xmlEsc(S.siteUrl)) + 'Packs/[^<]*</loc>[\\s\\S]*?</url>\\n?', 'g');
    let last = null, m;
    while ((m = re.exec(f.text))) last = m;
    const at = last ? last.index + last[0].length : f.text.lastIndexOf('</urlset>');
    f.text = f.text.slice(0, at) + block + f.text.slice(at);
}

function sitemapRemove(path) {
    const f = S.files.get('sitemap.xml');
    if (!f) return;
    const re = new RegExp('[ \\t]*<url>\\s*<loc>' + reEsc(xmlEsc(S.siteUrl + path)) + '</loc>[\\s\\S]*?</url>\\n?', 'g');
    f.text = f.text.replace(re, '');
}

// ── Sync filter dropdowns ──────────────────────────────────────────────────

function syncFilterOptions() {
    const doc = indexDoc();
    const cards = [...packsContainer().querySelectorAll('.pack-card')];
    const addMissing = (select, values, compare) => {
        if (!select) return;
        const have = new Set([...select.options].map(o => o.value));
        for (const v of values) {
            if (!v || have.has(v)) continue;
            const opts = [...select.options].filter(o => o.value !== 'all');
            const before = opts.find(o => compare(v, o.value) < 0) || null;
            const opt = doc.createElement('option');
            opt.value = v;
            opt.textContent = select.id === 'theme-filter' ? v.replace(/(^|[-\s])\w/g, m => m.toUpperCase()).replace('Sci-fi', 'Sci-Fi') : v;
            const inner = opts.length ? indentOf(opts[0], '') : '';
            const ref = before ? (wsBefore(before) || before) : (select.lastChild && select.lastChild.nodeType === 3 ? select.lastChild : null);
            select.insertBefore(doc.createTextNode('\n' + inner), ref);
            select.insertBefore(opt, ref);
            have.add(v);
        }
    };
    const vers = new Set(cards.flatMap(c => (c.getAttribute('data-version') || '').split(/\s+/)));
    const themes = new Set(cards.map(c => c.getAttribute('data-theme') || ''));
    const verCmp = (a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pb[i] || 0) - (pa[i] || 0);
            if (d) return d;
        }
        return 0;
    };
    addMissing(doc.getElementById('version-filter'), [...vers].filter(v => /^\d+(\.\d+)*$/.test(v)), verCmp);
    addMissing(doc.getElementById('theme-filter'), [...themes], (a, b) => a.localeCompare(b));
}

// ── Card element creation ──────────────────────────────────────────────────

function newCardElement(file) {
    const doc = indexDoc();
    const container = packsContainer();
    const first = container.querySelector('.pack-card');
    const indent = first ? indentOf(first, '            ') : '            ';
    const html = `
<div class="pack-card fade-in" data-date="" data-downloads="0" data-scale="256x256" data-theme="" data-version="">
  <div class="pack-ribbon">New</div>
  <div class="pack-image-container">
    <img alt="" class="pack-image" src=""/>
    <div class="pack-overlay">
      <a class="overlay-btn" href="${esc(file)}">View Details</a>
    </div>
  </div>
  <div class="pack-content">
    <div class="pack-tags">
    </div>
    <h3 class="pack-title"></h3>
    <p class="pack-description"></p>
    <div class="pack-meta">
      <div class="pack-info">
        <span class="pack-version"></span>
      </div>
    </div>
  </div>
</div>`;
    const card = frag(doc, html, indent);
    const ref = first ? (wsBefore(first) || first) : container.lastChild;
    container.insertBefore(doc.createTextNode('\n' + indent), ref);
    container.insertBefore(card, ref);
    return card;
}

// ── Rendering: shell + list ────────────────────────────────────────────────

function renderShell() {
    $('#connect-screen').hidden = true;
    $('#app').hidden = false;
    const repoUrl = `https://github.com/${S.cfg.owner}/${S.cfg.repo}`;
    const info = $('#repo-info');
    info.replaceChildren(
        h('a', { href: repoUrl, target: '_blank', rel: 'noopener' }, h('code', {}, `${S.cfg.owner}/${S.cfg.repo}`)),
        ' · branch ', h('code', {}, S.cfg.branch),
        ' · at ', h('a', { href: `${repoUrl}/commit/${S.headSha}`, target: '_blank', rel: 'noopener' }, h('code', {}, S.headSha.slice(0, 7)))
    );
    $('#live-link').href = S.siteUrl;
}

function renderList() {
    if (!S.headSha) return;
    const q = $('#pack-search').value.trim().toLowerCase();
    const ul = $('#pack-list');
    ul.replaceChildren();
    for (const p of S.packs) {
        const name = packName(p);
        if (q && !name.toLowerCase().includes(q) && !p.file.toLowerCase().includes(q)) continue;
        const st = packStatus(p);
        const warn = !p.card ? 'no card' : !pageExists(p.file) ? 'no page' : '';
        const img = p.card ? resolveImg(attr(p.card, 'img.pack-image', 'src'), false) : '';
        const editorOpen = S.editorTabs.get(p.file) === 'open';
        ul.append(h('li', { class: S.current === p ? 'active' : '', onclick: () => openPack(p) },
            h('img', { src: img || 'data:,', alt: '', loading: 'lazy' }),
            h('span', { class: 'name' }, name,
                h('span', { class: 'sub' }, p.card ? (p.card.getAttribute('data-date') || '') + ' · ' + (text(p.card, '.pack-version') || '') : p.file)),
            editorOpen && h('span', { class: 'badge editor-open', title: 'Open in visual editor' }, '● editor'),
            st && h('span', { class: 'badge ' + st }, st),
            warn && h('span', { class: 'badge warn', title: warn === 'no card' ? 'Page exists but not listed on home page' : 'Card links to a page that does not exist' }, warn)
        ));
    }
}

// ── Rendering: editor ─────────────────────────────────────────────────────

async function openPack(p) {
    S.current = p;
    renderList();
    const ed = $('#editor');
    ed.replaceChildren(h('div', { class: 'empty-state' }, h('i', { class: 'fa fa-spinner fa-spin' }), h('p', {}, 'Loading…')));
    try {
        if (pageExists(p.file)) await loadHtmlFile(p.file);
    } catch (e) {
        toast(e.message, true);
    }
    if (S.current !== p) return;
    if (!p.card && S.tab === 'card') S.tab = 'page';
    renderEditor();
}

function renderEditor() {
    const ed = $('#editor');
    const p = S.current;
    if (!p) {
        ed.replaceChildren(h('div', { class: 'empty-state' }, h('i', { class: 'fa fa-hand-o-left' }), h('p', {}, 'Pick a pack to edit, or create a new one.')));
        return;
    }
    const page = S.files.get(p.file);
    const hasPage = page && pageExists(p.file);
    const tabs = [['card', 'Home page card'], ['page', 'Pack page'], ['html', 'Page HTML']];
    const head = h('div', { class: 'editor-head' },
        h('div', {}, h('h2', {}, packName(p)), h('div', { class: 'path' }, p.file)),
        h('div', { class: 'actions' },
            hasPage && h('button', { class: 'btn small', onclick: () => openVisualEditor(p) }, h('i', { class: 'fa fa-pencil-square' }), ' Edit visually'),
            hasPage && h('button', { class: 'btn small', onclick: () => previewPage(p) }, h('i', { class: 'fa fa-eye' }), ' Quick preview'),
            pageExists(p.file) && S.tree.has(p.file) && h('a', { class: 'btn small', href: S.siteUrl + p.file.split('/').map(encodeURIComponent).join('/'), target: '_blank', rel: 'noopener' }, h('i', { class: 'fa fa-external-link' }), ' Live'),
            h('button', { class: 'btn small', onclick: () => discardPack(p) }, h('i', { class: 'fa fa-undo' }), ' Discard changes'),
            h('button', { class: 'btn small danger', onclick: () => deletePack(p) }, h('i', { class: 'fa fa-trash' }), ' Delete pack')
        )
    );
    const tabBar = h('div', { class: 'tabs' }, tabs.map(([id, label]) =>
        h('button', { class: 'tab' + (S.tab === id ? ' active' : ''), onclick: () => { S.tab = id; renderEditor(); } }, label)));
    let body;
    if (S.tab === 'card') body = p.card ? cardForm(p) : missingBox('This page has no card on the home page.', 'Add a card', () => addCardFor(p));
    else if (S.tab === 'page') body = hasPage ? pageForm(p, page.doc) : missingBox('This card links to ' + p.file + ', which does not exist.', null);
    else body = hasPage ? htmlForm(p, page) : missingBox('No page file.', null);
    ed.replaceChildren(head, tabBar, body);
}

function openVisualEditor(p) {
    if (!S.channel) startHub();
    // Pre-load the file so state is ready when the editor sends 'hello'
    loadHtmlFile(p.file).catch(() => {});
    const url = editorUrl(S.sessionKey, p.file);
    const win = window.open(url, '_blank', 'noopener');
    if (win) {
        S.editorTabs.set(p.file, 'open');
        renderList();
    }
}

function missingBox(msg, btn, fn) {
    return h('div', { class: 'section' }, h('p', {}, msg), btn && h('button', { class: 'btn primary', onclick: fn }, btn));
}

// ── Form helpers ───────────────────────────────────────────────────────────

function field(label, value, onInput, opts = {}) {
    const input = opts.textarea
        ? h('textarea', { rows: opts.rows || 3, placeholder: opts.placeholder || '' })
        : opts.options
            ? h('select', {}, opts.options.map(o => h('option', { value: o[0] }, o[1])))
            : h('input', { type: opts.type || 'text', placeholder: opts.placeholder || '', list: opts.list || null });
    input.value = value ?? '';
    if (opts.fieldName) input.setAttribute('data-field', opts.fieldName);
    input.addEventListener(opts.options ? 'change' : 'input', () => { onInput(input.value); changed(); });
    return h('label', { class: opts.wide ? 'wide' : null }, label, input);
}

function imageField(label, value, fromPage, onInput, opts = {}) {
    const thumb = h('div', { class: 'thumb' });
    const setThumb = v => { const u = resolveImg(v, fromPage); thumb.style.backgroundImage = u ? `url("${u.replace(/"/g, '%22')}")` : ''; };
    const input = h('input', { type: 'text', placeholder: 'https://i.imgur.com/… or upload' });
    input.value = value || '';
    setThumb(input.value);
    input.addEventListener('input', () => { onInput(input.value); setThumb(input.value); changed(); });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', async () => {
        if (!file.files[0]) return;
        try {
            const path = await stageUpload(file.files[0]);
            input.value = (fromPage ? '../' : '') + path;
            input.dispatchEvent(new Event('input'));
            toast('Image staged: ' + path + ' (uploaded when you publish)');
        } catch (e) { toast(e.message, true); }
        file.value = '';
    });
    return h('div', { class: 'img-field' + (opts.wide ? ' wide' : '') },
        h('label', {}, label, input),
        h('div', { style: 'display:flex;gap:6px;align-items:center' },
            thumb,
            h('button', { class: 'btn small', type: 'button', title: 'Upload image', onclick: () => file.click() }, h('i', { class: 'fa fa-upload' }), ' Upload'),
            file));
}

function listEditor(items, blank, make, onChange, opts = {}) {
    const wrap = h('div', {});
    const list = h('div', { class: 'list' });
    const commit = () => { onChange(items.map(x => (typeof x === 'object' ? Object.assign({}, x) : x))); changed(); };
    const draw = () => {
        list.replaceChildren();
        items.forEach((item, i) => {
            const update = v => { items[i] = v; commit(); };
            const patch = o => { items[i] = Object.assign({}, items[i], o); commit(); };
            const move = d => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; commit(); draw(); };
            list.append(h('div', { class: 'list-row' },
                h('div', { class: 'fields' }, make(item, update, patch)),
                h('div', { class: 'row-actions' },
                    h('button', { class: 'btn small', type: 'button', title: 'Move up', onclick: () => move(-1) }, '↑'),
                    h('button', { class: 'btn small', type: 'button', title: 'Move down', onclick: () => move(1) }, '↓'),
                    h('button', { class: 'btn small danger', type: 'button', title: 'Remove', onclick: () => { items.splice(i, 1); commit(); draw(); } }, '✕'))));
        });
    };
    draw();
    wrap.append(list, h('div', { class: 'list-foot' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { items.push(typeof blank === 'object' ? Object.assign({}, blank) : blank); commit(); draw(); } }, h('i', { class: 'fa fa-plus' }), ' ', opts.addLabel || 'Add'),
        opts.extra || null));
    wrap.redraw = arr => { items.splice(0, items.length, ...arr); draw(); };
    return wrap;
}

function stringList(items, onChange, placeholder, opts = {}) {
    return listEditor(items.slice(), '', (item, update) =>
        opts.textarea
            ? (() => { const t = h('textarea', { rows: 3, class: 'wide', placeholder }); t.value = item; t.addEventListener('input', () => update(t.value)); return t; })()
            : (() => { const t = h('input', { type: 'text', class: 'wide', placeholder, list: opts.list || null }); t.value = item; t.addEventListener('input', () => update(t.value)); return t; })(),
    onChange, opts);
}

function section(title, hint, ...kids) {
    return h('div', { class: 'section' }, h('h3', {}, title), hint && h('p', { class: 'hint' }, hint), kids);
}

const changed = () => {
    updatePending();
    // If an editor tab is open for the current file, send the updated state
    if (S.channel && S.current && S.editorTabs.get(S.current.file) === 'open') {
        // Send a minimal 'changed' notification; editor will re-render affected field
        // For form edits we send the full state on next 'hello' from editor
    }
};

// ── Card form ─────────────────────────────────────────────────────────────

function themeOptions() {
    const sel = indexDoc().getElementById('theme-filter');
    return sel ? [...sel.options].filter(o => o.value !== 'all').map(o => o.value) : [];
}

function cardForm(p) {
    const c = p.card;
    const v = CARD.get(c);
    const set = (k) => val => { CARD.set[k](c, val, syncFilterOptions); S.editedCards.add(c); };
    const themes = themeOptions();
    const dl = h('datalist', { id: 'theme-list' }, themes.map(t => h('option', { value: t })));
    return h('div', {},
        section('Card', 'What visitors see in the Texture Packs grid on the home page.',
            h('div', { class: 'grid' },
                field('Title', v.title, set('title'), { wide: true, fieldName: 'title' }),
                field('Short description', v.description, set('description'), { textarea: true, rows: 2, wide: true, fieldName: 'description' }),
                imageField('Thumbnail image', v.image, false, set('image'), { wide: true }),
                field('Image alt text', v.imageAlt, set('imageAlt')),
                field('Release date', v.date, set('date'), { type: 'date' }),
                field('Ribbon', v.ribbon, set('ribbon'), { options: [['', 'None'], ['New', 'New'], ['Updated', 'Updated']] }))),
        section('Filters & sorting', 'Used by the home page search, filters, "Most Popular" and sorting.',
            h('div', { class: 'grid' },
                field('Version label (shown on card)', v.versionLabel, set('versionLabel'), { placeholder: '1.21 - 1.21.1', fieldName: 'versionLabel' }),
                field('Versions for the filter (space separated)', v.versions, set('versions'), { placeholder: '1.21 1.21.1' }),
                field('Theme', v.theme, set('theme'), { list: 'theme-list', placeholder: themes.join(', ') }),
                field('Scale', v.scale, set('scale'), { options: [['256x256', '256x256'], ['512x512+', '512x512+']] }),
                field('Downloads (for "Most Popular")', v.downloads, set('downloads'), { type: 'number' })),
            dl),
        section('Tags', 'Small labels on the card.', stringList(v.tags, set('tags'), 'Romance')),
        section('Link', null, h('p', { class: 'muted' }, 'Opens ', h('code', {}, cardFile(c)))),
        pageExists(p.file) && h('button', { class: 'btn', onclick: () => { copyPageToCard(p); renderEditor(); } }, h('i', { class: 'fa fa-clone' }), ' Fill card from pack page')
    );
}

function copyPageToCard(p) {
    const f = S.files.get(p.file);
    if (!f || !p.card) return;
    const pg = PAGE.get(f.doc);
    const c = p.card;
    CARD.set.title(c, pg.heading || pg.title);
    if (pg.metaDescription) CARD.set.description(c, pg.metaDescription);
    if (pg.cover) { CARD.set.image(c, pg.cover.replace(/^\.\.\//, '')); CARD.set.imageAlt(c, pg.coverAlt || pg.heading); }
    if (pg.version) { CARD.set.versionLabel(c, pg.version); if (!c.getAttribute('data-version')) CARD.set.versions(c, pg.version, syncFilterOptions); }
    if (pg.themes.length) { CARD.set.tags(c, pg.themes); CARD.set.theme(c, pg.themes[0], syncFilterOptions); }
    S.editedCards.add(c);
    changed();
}

// ── Page form ─────────────────────────────────────────────────────────────

function pageForm(p, d) {
    const v = PAGE.get(d);
    const set = k => val => PAGE.set[k](d, val);
    const dl = { curseforge: v.curseforge, modrinth: v.modrinth };
    const setDl = k => val => { dl[k] = val.trim(); PAGE.set.downloads(d, dl); };

    let previewList;
    const slideEditor = listEditor(v.slides.slice(), { src: '', caption: '' }, (item, update, patch) => [
        imageField('Image', item.src, true, val => patch({ src: val })),
        field('Caption', item.caption, val => patch({ caption: val })),
    ], set('slides'), { addLabel: 'Add screenshot' });
    previewList = listEditor(v.previews.slice(), { src: '', alt: '' }, (item, update, patch) => [
        imageField('Image', item.src, true, val => patch({ src: val })),
        field('Alt text', item.alt, val => patch({ alt: val })),
    ], set('previews'), {
        addLabel: 'Add preview',
        extra: h('button', { class: 'btn small', type: 'button', onclick: () => {
            const n = parseInt(prompt('Use how many of the first screenshots as previews?', '4'), 10);
            if (!n) return;
            const slides = PAGE.get(d).slides.slice(0, n).map(s => ({ src: s.src, alt: s.caption }));
            PAGE.set.previews(d, slides);
            previewList.redraw(slides);
            changed();
        } }, h('i', { class: 'fa fa-magic' }), ' Use first screenshots'),
    });

    return h('div', {},
        section('Page basics', 'Browser tab title, Google description and the big heading.',
            h('div', { class: 'grid' },
                field('Browser title', v.title, set('title'), { wide: true, fieldName: 'title' }),
                field('Meta description (Google snippet)', v.metaDescription, set('metaDescription'), { textarea: true, rows: 2, wide: true, fieldName: 'metaDescription' }),
                field('Heading', v.heading, set('heading'), { wide: true, fieldName: 'heading' }),
                imageField('Cover image', v.cover, true, set('cover'), { wide: true }),
                field('Cover alt text', v.coverAlt, set('coverAlt')),
                field('Version badge', v.version, set('version'), { placeholder: '1.21.8', fieldName: 'version' }))),
        section('Theme badges', 'Shown under the cover.', stringList(v.themes, set('themes'), 'Fantasy')),
        section('Preview thumbnails', 'The small images under the cover.', previewList),
        section('Screenshots (lightbox)', 'Everything shown in the "View All Screenshots" popup.', slideEditor),
        section('Features', 'Bullet list under "Features". HTML allowed.', stringList(v.features, set('features'), 'Custom hotbar and crosshair')),
        section('Description', null,
            h('div', { class: 'grid' },
                field('Anime title (banner)', v.animeTitle, set('animeTitle'), { fieldName: 'animeTitle' }),
                field('Banner label', v.packType, set('packType'), { fieldName: 'packType' }),
                field('Icon (Font Awesome 4 class)', v.descIcon, set('descIcon'), { placeholder: 'fa-snowflake-o' })),
            h('p', { class: 'hint muted' }, 'Paragraphs — HTML allowed, e.g. <strong>bold</strong>.'),
            stringList(v.paragraphs, set('paragraphs'), 'Paragraph text…', { textarea: true, addLabel: 'Add paragraph' })),
        section('Highlights', 'The three icon boxes under the description.',
            listEditor(v.highlights.slice(), { icon: 'fa-star', title: '', text: '' }, (item, update, patch) => [
                field('Icon', item.icon, val => patch({ icon: val }), { placeholder: 'fa-paint-brush' }),
                field('Heading', item.title, val => patch({ title: val })),
                field('Text', item.text, val => patch({ text: val }), { wide: true }),
            ], set('highlights'), { addLabel: 'Add highlight' })),
        section('Download links', 'Leave a link empty to hide that button.',
            h('div', { class: 'grid' },
                field('CurseForge URL', v.curseforge, setDl('curseforge'), { placeholder: 'https://www.curseforge.com/minecraft/texture-packs/…', fieldName: 'curseforge' }),
                field('Modrinth URL', v.modrinth, setDl('modrinth'), { placeholder: 'https://modrinth.com/resourcepack/…', fieldName: 'modrinth' }))),
        section('Compatibility', 'Badges under "Compatibility".', stringList(v.compat, set('compat'), 'Minecraft Java Edition 1.21.8'))
    );
}

// ── HTML form ─────────────────────────────────────────────────────────────

function htmlForm(p, page) {
    const ta = h('textarea', { class: 'html-editor', spellcheck: 'false' });
    ta.value = serialize(page.doc);
    return section('Raw HTML', 'Advanced: edit the whole page by hand. "Apply" replaces the page with this HTML.',
        ta,
        h('div', { class: 'list-foot' },
            h('button', { class: 'btn primary', onclick: () => {
                page.doc = parseHTML(ta.value);
                changed();
                toast('HTML applied.');
            } }, h('i', { class: 'fa fa-check' }), ' Apply'),
            h('button', { class: 'btn', onclick: () => { ta.value = serialize(page.doc); } }, 'Reset textarea')));
}

// ── Read-only preview ─────────────────────────────────────────────────────

function previewPage(p) {
    const f = S.files.get(p.file);
    if (!f) return;
    const doc = parseHTML(serialize(f.doc));
    const base = doc.createElement('base');
    base.href = new URL(p.file.replace(/[^/]+$/, ''), location.protocol.startsWith('http') ? location.href : S.siteUrl).href;
    doc.head.prepend(base);
    doc.querySelectorAll('script').forEach(el => el.remove());
    doc.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src');
        if (!/^(https?:)?\/\//.test(src)) {
            const path = new URL(src, 'https://x/' + p.file).pathname.slice(1);
            const up = S.uploads.get(decodeURIComponent(path));
            if (up) img.setAttribute('src', up.url);
        }
    });
    const blob = new Blob([serialize(doc)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── Pack actions ──────────────────────────────────────────────────────────

function discardPack(p) {
    const f = S.files.get(p.file);
    if (f && f.original === null) { toast('This is a new pack — use Delete to remove it.'); return; }
    if (f) S.files.delete(p.file);
    if (p.card && S.editedCards.has(p.card)) {
        const orig = parseHTML(S.files.get('index.html').original);
        const fresh = [...orig.querySelectorAll('#packs-container .pack-card')].find(c => cardFile(c) === p.file);
        if (fresh) {
            const node = indexDoc().importNode(fresh, true);
            p.card.replaceWith(node);
            p.card = node;
        }
    }
    openPack(p);
    changed();
    toast('Changes to this pack discarded.');
}

function deletePack(p) {
    const name = packName(p);
    modal(h('div', {},
        h('h2', {}, 'Delete "' + name + '"?'),
        h('p', {}, 'This removes:'),
        h('ul', {},
            p.card && h('li', {}, 'its card on the home page'),
            pageExists(p.file) && h('li', {}, 'the page ', h('code', {}, p.file)),
            h('li', {}, 'its sitemap entry')),
        h('p', { class: 'muted' }, 'Nothing changes on GitHub until you Publish.'),
        h('div', { class: 'modal-actions' },
            h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
            h('button', { class: 'btn danger', onclick: () => {
                if (p.card) removeWithWs(p.card);
                const f = S.files.get(p.file);
                if (f && f.original === null) S.files.delete(p.file);
                if (S.tree.has(p.file)) S.deletes.add(p.file);
                sitemapRemove(p.file);
                S.packs = S.packs.filter(x => x !== p);
                S.current = null;
                closeModal();
                renderEditor();
                changed();
                toast('Deleted "' + name + '" (publish to apply).');
            } }, h('i', { class: 'fa fa-trash' }), ' Delete'))));
}

function addCardFor(p) {
    p.card = newCardElement(p.file);
    CARD.set.date(p.card, new Date().toISOString().slice(0, 10));
    copyPageToCard(p);
    S.editedCards.add(p.card);
    S.packs = [p, ...S.packs.filter(x => x !== p)];
    S.tab = 'card';
    renderEditor();
    changed();
}

function slugify(name) {
    return name.trim().replace(/[\s_/]+/g, '-').replace(/[^A-Za-z0-9!'.-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function newPackDialog() {
    const bases = S.packs.filter(p => S.tree.has(p.file) && !S.deletes.has(p.file));
    const name = h('input', { required: true, placeholder: 'Call of the Night' });
    const fileIn = h('input', { required: true, spellcheck: 'false' });
    let touched = false;
    name.addEventListener('input', () => { if (!touched) fileIn.value = name.value.trim() ? slugify(name.value) + '-Custom-GUI-Pack.html' : ''; });
    fileIn.addEventListener('input', () => { touched = true; });
    const version = h('input', { placeholder: '1.21.11' });
    const baseSel = h('select', {}, bases.map(p => h('option', { value: p.file }, packName(p))));
    const pref = bases.find(p => p.file.includes('ReZero')) || bases[0];
    if (pref) baseSel.value = pref.file;
    const err = h('p', { class: 'error' });
    const form = h('form', {},
        h('label', {}, 'Anime / pack name', name),
        h('label', {}, 'File name (Packs/…)', fileIn),
        h('label', {}, 'Minecraft version', version),
        h('label', {}, 'Copy layout from', baseSel),
        h('p', { class: 'muted' }, 'The new page uses the same layout as the chosen pack; all text, images and links start empty.'),
        err,
        h('div', { class: 'modal-actions' },
            h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Cancel'),
            h('button', { class: 'btn primary', type: 'submit' }, h('i', { class: 'fa fa-plus' }), ' Create')));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        let file = fileIn.value.trim();
        if (!/\.html$/i.test(file)) file += '.html';
        file = 'Packs/' + file.replace(/^Packs\//, '');
        if (!/^Packs\/[A-Za-z0-9!'._-]+\.html$/.test(file)) { err.textContent = 'File name may only use letters, numbers and - . _ ! \''; return; }
        if (pageExists(file) || S.packs.some(p => p.file === file)) { err.textContent = 'A pack with that file name already exists.'; return; }
        try {
            await createPack(name.value.trim(), file, version.value.trim(), baseSel.value);
            closeModal();
        } catch (ex) { err.textContent = ex.message; }
    });
    modal(h('div', {}, h('h2', {}, 'New pack'), form));
    name.focus();
}

async function createPack(name, file, version, baseFile) {
    const base = await loadHtmlFile(baseFile);
    const d = parseHTML(serialize(base.doc));
    const title = name + ' Custom GUI Pack';
    const desc = `Transform your Minecraft interface with the ${name} Custom GUI Pack.`;
    PAGE.set.title(d, title);
    PAGE.set.metaDescription(d, desc);
    PAGE.set.heading(d, title);
    PAGE.set.cover(d, '');
    PAGE.set.coverAlt(d, title);
    PAGE.set.version(d, version);
    PAGE.set.themes(d, []);
    PAGE.set.previews(d, []);
    PAGE.set.slides(d, []);
    PAGE.set.features(d, []);
    PAGE.set.animeTitle(d, name);
    PAGE.set.packType(d, 'GUI Resource Pack');
    PAGE.set.paragraphs(d, [desc]);
    PAGE.set.highlights(d, [
        { icon: 'fa-paint-brush', title: 'Beautiful Design', text: '' },
        { icon: 'fa-cog', title: 'Complete GUI', text: '' },
        { icon: 'fa-gamepad', title: 'Custom Hotbar', text: '' },
    ]);
    PAGE.set.downloads(d, { curseforge: '', modrinth: '' });
    PAGE.set.compat(d, version ? ['Minecraft Java Edition ' + version] : []);
    S.files.set(file, { kind: 'html', original: null, baseline: null, doc: d });
    S.deletes.delete(file);

    const p = { file, card: newCardElement(file) };
    const c = p.card;
    CARD.set.title(c, title);
    CARD.set.description(c, desc);
    CARD.set.imageAlt(c, title);
    CARD.set.date(c, new Date().toISOString().slice(0, 10));
    CARD.set.versions(c, version, syncFilterOptions);
    CARD.set.versionLabel(c, version);
    CARD.set.ribbon(c, 'New');
    S.editedCards.add(c);
    sitemapAdd(file);
    S.packs.unshift(p);
    S.tab = 'page';
    S.current = p;
    renderList();
    renderEditor();
    changed();
    toast('Created ' + file + '. Fill in the page, then the card.');
}

// ── Modal ─────────────────────────────────────────────────────────────────

function modal(content) {
    $('#modal-body').replaceChildren(content);
    $('#modal').hidden = false;
}

function closeModal() {
    if (closeModal.locked) return;
    $('#modal').hidden = true;
    $('#modal-body').replaceChildren();
}

// ── Publish ───────────────────────────────────────────────────────────────

function publishDialog() {
    const changes = pendingChanges();
    if (!changes.length) return;
    const names = [...new Set(changes.filter(c => c.path.startsWith('Packs/')).map(c => c.path.slice(6).replace(/\.html$/, '').replace(/-/g, ' ')))];
    const msg = h('input', { value: names.length ? 'Update ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '') : 'Update site' });
    const steps = h('ul', { class: 'steps' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, h('i', { class: 'fa fa-cloud-upload' }), ' Publish');
    const form = h('form', {},
        h('ul', { class: 'file-list' }, changes.map(c => h('li', {},
            h('span', { class: 'st ' + c.status }, c.status),
            h('span', { class: 'p', title: c.path }, c.path)))),
        h('label', {}, 'Commit message', msg),
        steps,
        h('div', { class: 'modal-actions' },
            h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Close'),
            btn));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        btn.disabled = true;
        closeModal.locked = true;
        try {
            await runPublish(changes, msg.value.trim() || 'Update site', steps);
        } catch (ex) {
            addStep(steps, 'fa-times', ex.message + (ex.status === 403 || ex.status === 404 ? ' — does the token have Contents: Read and write on this repo?' : ''));
            btn.disabled = false;
        } finally {
            closeModal.locked = false;
        }
    });
    modal(h('div', {}, h('h2', {}, 'Publish ' + changes.length + ' change' + (changes.length > 1 ? 's' : '')), form));
}

function addStep(list, icon, label, link) {
    const li = h('li', {}, h('i', { class: 'fa ' + icon }), h('span', {}, label));
    if (link) li.append(' ', h('a', { href: link, target: '_blank', rel: 'noopener' }, 'View'));
    list.append(li);
    return {
        done: (ic, txt, lnk) => {
            li.firstChild.className = 'fa ' + ic;
            if (txt) li.lastChild.textContent = txt;
            if (lnk) li.append(' ', h('a', { href: lnk, target: '_blank', rel: 'noopener' }, 'View'));
        }
    };
}

async function runPublish(changes, message, steps) {
    // Build onStep callback that writes into DOM steps list and broadcasts progress
    const stepEls = {};
    const onStep = ({ id, state, text: stepText, link }) => {
        const icon = state === 'running' ? 'fa-spinner fa-spin' : state === 'done' ? 'fa-check' : 'fa-times';
        if (!stepEls[id]) {
            if (steps) stepEls[id] = addStep(steps, icon, stepText, link);
        } else {
            stepEls[id].done(icon, stepText, link);
        }
        if (S.channel) S.channel.send('publish-step', { step: { id, state, text: stepText, link } });
    };

    const { commitSha } = await ghPublish(S.cfg, S.headSha, changes, message, onStep, S.tree);

    // Fold published state in as new baseline
    for (const c of changes) {
        if (c.status === 'D') { S.tree.delete(c.path); S.files.delete(c.path); continue; }
        const f = S.files.get(c.path);
        if (f && f.kind === 'html') { f.original = c.content; f.doc = parseHTML(c.content); f.baseline = serialize(f.doc); }
        else if (f) { f.original = c.content; f.text = c.content; }
        S.tree.set(c.path, { sha: null, mode: '100644' });
    }
    S.deletes.clear();
    S.uploads.clear();
    S.headSha = commitSha;
    S.editedCards = new WeakSet();
    S.undoStack = [];
    S.redoStack = [];
    const cur = S.current && S.current.file;
    buildPackList();
    S.current = S.packs.find(p => p.file === cur) || null;
    S.tree = await loadTree(S.cfg, commitSha);
    renderShell();
    renderEditor();
    updatePending();

    await watchDeploy(S.cfg, commitSha, onStep);
}

async function redeploy() {
    const steps = h('ul', { class: 'steps' });
    modal(h('div', {}, h('h2', {}, 'Redeploy'),
        h('p', { class: 'muted' }, 'Re-runs the GitHub Pages deploy for the current ' + S.cfg.branch + ' branch.'),
        steps,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    const onStep = ({ id, state, text: stepText, link }) => {
        const icon = state === 'running' ? 'fa-spinner fa-spin' : state === 'done' ? 'fa-check' : 'fa-times';
        if (!redeploy._stepEls) redeploy._stepEls = {};
        if (!redeploy._stepEls[id]) redeploy._stepEls[id] = addStep(steps, icon, stepText, link);
        else redeploy._stepEls[id].done(icon, stepText, link);
    };
    redeploy._stepEls = {};
    try {
        const since = Date.now();
        await gh('POST', `${repoPath(S.cfg)}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: S.cfg.branch }, S.cfg.token);
        onStep({ id: 'start', state: 'done', text: 'Deploy requested.' });
        await new Promise(r => setTimeout(r, 4000));
        await watchDeploy(S.cfg, null, onStep, 'workflow_dispatch', since);
    } catch (e) {
        onStep({ id: 'start', state: 'error', text: e.status === 403 ? 'This token needs "Actions: Read and write" to redeploy.' : e.status === 404 ? `Workflow .github/workflows/${WORKFLOW_FILE} not found.` : e.message });
    }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { doUndo(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { doRedo(); e.preventDefault(); }
});

// ── Boot ──────────────────────────────────────────────────────────────────

function bind() {
    $('#connect-form').addEventListener('submit', async e => {
        e.preventDefault();
        const cfg = {
            token: $('#cfg-token').value.trim(),
            owner: $('#cfg-owner').value.trim(),
            repo: $('#cfg-repo').value.trim(),
            branch: $('#cfg-branch').value.trim() || 'main',
        };
        const btn = $('#connect-btn');
        btn.disabled = true;
        $('#connect-error').textContent = '';
        try {
            await connect(cfg);
            storeCfg(cfg);
        } catch (ex) {
            S.headSha = null;
            $('#connect-error').textContent = ex.status === 401 ? 'GitHub rejected the token (expired or mistyped).' : ex.status === 404 ? 'Repository or branch not found — or the token has no access to it.' : ex.message;
        } finally {
            btn.disabled = false;
        }
    });
    $('#pack-search').addEventListener('input', renderList);
    $('#new-pack-btn').addEventListener('click', newPackDialog);
    $('#publish-btn').addEventListener('click', publishDialog);
    $('#redeploy-btn').addEventListener('click', redeploy);
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
    $('#discard-all-btn').addEventListener('click', async () => {
        if (!pendingChanges().length) { toast('Nothing to discard.'); return; }
        if (!confirm('Discard all unpublished changes?')) return;
        try { await reloadAll(); toast('All changes discarded.'); } catch (e) { toast(e.message, true); }
    });
    $('#logout-btn').addEventListener('click', () => {
        if (pendingChanges().length && !confirm('You have unpublished changes. Disconnect anyway?')) return;
        forgetCfg();
        if (S.channel) { S.channel.send('bye'); S.channel.close(); S.channel = null; }
        S.cfg = null;
        S.headSha = null;
        showConnect();
    });
}

async function boot() {
    bind();
    startHub();
    // Web Lock: only one admin tab can be the hub
    if (navigator.locks) {
        navigator.locks.request('lmc-admin-hub', { ifAvailable: true }, lock => {
            if (!lock) {
                // Already locked by another tab
                document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#ccc;background:#1a1a2e"><p>Admin is already open in another tab.<br><a href="" onclick="location.reload()" style="color:#9c5fe6">Try again</a></p></div>';
                return;
            }
            return new Promise(() => {}); // hold the lock for the life of the tab
        });
    }
    const cfg = readStoredCfg();
    if (!cfg || !cfg.token) { showConnect(); return; }
    try {
        await connect(cfg);
    } catch (e) {
        showConnect(e.status === 401 ? 'Saved token was rejected — paste a new one.' : e.message);
    }
}

boot();