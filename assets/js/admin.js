/*
 * admin.js — Listar MC admin panel (admin.html)
 *
 * Edits the site's files directly in the GitHub repo:
 *   - index.html      the pack cards on the home page (+ filter options)
 *   - Packs/*.html    the individual pack pages
 *   - sitemap.xml     pack page URLs
 *   - thumbnails/     uploaded images
 * All edits are held in memory and published together as ONE commit through the
 * GitHub Git Data API. A push to the branch triggers the Pages deploy workflow.
 *
 * Pages are parsed with DOMParser (inert: nothing in them runs), edited as DOM,
 * and serialised back. Only the parts you actually change are rewritten.
 */
(function () {
'use strict';

const API = 'https://api.github.com';
const DEFAULTS = { owner: 'Listarmc', repo: 'listarmc.github.io', branch: 'main' };
const STORE_KEY = 'lmc_admin_cfg';
const UPLOAD_DIR = 'thumbnails/';
const WORKFLOW_FILE = 'static.yml';

const S = {
    cfg: null,
    headSha: null,
    tree: new Map(),        // path -> { sha, mode }
    files: new Map(),       // path -> { kind:'html'|'text', original, baseline, doc?, text? }
    uploads: new Map(),     // path -> { base64, url }
    deletes: new Set(),     // paths
    packs: [],              // { file, cardRef } ; card element lives in index doc
    current: null,          // pack object
    tab: 'card',
    siteUrl: 'https://listar-mc.net/',
    editedCards: new WeakSet(), // card elements touched in this session (never written into the HTML)
};

const $ = (sel, root = document) => root.querySelector(sel);

// ================================================================ helpers

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

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

const parseHTML = text => new DOMParser().parseFromString(text, 'text/html');
/* Serialise a parsed page. The small clean-ups keep diffs readable; none change the DOM. */
const serialize = doc => ('<!DOCTYPE html>\n' + doc.documentElement.outerHTML)
    .replace(/^(<!DOCTYPE html>\n<html[^>]*>)<head>/, '$1\n<head>')
    .replace(/ (async|defer|hidden|disabled|required|checked|selected|multiple|readonly|autofocus|nomodule)=""/g, ' $1')
    .replace(/\s*<\/body><\/html>$/, '\n</body>\n</html>') + '\n';

// ================================================================ GitHub API

async function gh(method, path, body) {
    const res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: Object.assign({
            Authorization: 'Bearer ' + S.cfg.token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).message || msg; } catch (e) { /* ignore */ }
        const err = new Error(res.status + ' ' + msg);
        err.status = res.status;
        throw err;
    }
    return res.status === 204 ? null : res.json();
}

const repoPath = () => `/repos/${encodeURIComponent(S.cfg.owner)}/${encodeURIComponent(S.cfg.repo)}`;
const refPath = () => `${repoPath()}/git/ref/heads/${S.cfg.branch.split('/').map(encodeURIComponent).join('/')}`;

async function loadTree(commitSha) {
    const commit = await gh('GET', `${repoPath()}/git/commits/${commitSha}`);
    const tree = await gh('GET', `${repoPath()}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('Repository tree is too large to list.');
    const map = new Map();
    for (const t of tree.tree) if (t.type === 'blob') map.set(t.path, { sha: t.sha, mode: t.mode });
    return map;
}

async function readText(path) {
    const entry = S.tree.get(path);
    if (!entry) return null;
    const blob = await gh('GET', `${repoPath()}/git/blobs/${entry.sha}`);
    return b64ToText(blob.content);
}

async function loadHtmlFile(path) {
    if (S.files.has(path)) return S.files.get(path);
    const text = await readText(path);
    if (text == null) throw new Error('File not found in repo: ' + path);
    const doc = parseHTML(text);
    const f = { kind: 'html', original: text, baseline: serialize(parseHTML(text)), doc };
    S.files.set(path, f);
    return f;
}

async function loadTextFile(path) {
    if (S.files.has(path)) return S.files.get(path);
    const text = await readText(path);
    if (text == null) return null;
    const f = { kind: 'text', original: text, text };
    S.files.set(path, f);
    return f;
}

// ================================================================ config / connect

function readStoredCfg() {
    for (const store of [sessionStorage, localStorage]) {
        try {
            const raw = store.getItem(STORE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
    }
    return null;
}

function storeCfg(cfg, remember) {
    try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(cfg));
        if (remember) localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
        else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* ignore */ }
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
    const repo = await gh('GET', repoPath());
    if (repo.permissions && repo.permissions.push === false) {
        throw new Error('This account has no write access to ' + repo.full_name + '.');
    }
    await reloadAll();
}

async function reloadAll() {
    const ref = await gh('GET', refPath());
    S.headSha = ref.object.sha;
    S.tree = await loadTree(S.headSha);
    S.files.clear();
    S.uploads.forEach(u => URL.revokeObjectURL(u.url));
    S.uploads.clear();
    S.deletes.clear();
    if (!S.tree.has('index.html')) throw new Error('index.html not found on branch ' + S.cfg.branch + '.');
    await loadHtmlFile('index.html');
    await loadTextFile('sitemap.xml');
    const cname = await readText('CNAME').catch(() => null);
    if (cname && cname.trim()) S.siteUrl = 'https://' + cname.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') + '/';
    buildPackList();
    S.editedCards = new WeakSet();
    S.current = null;
    renderShell();
    renderList();
    renderEditor();
    updatePending();
}

// ================================================================ model: packs

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

const pageExists = file => S.tree.has(file) && !S.deletes.has(file) || (S.files.has(file) && S.files.get(file).original === null);

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

// ================================================================ DOM editing helpers (operate on parsed docs)

function text(root, sel) {
    const el = root.querySelector(sel);
    return el ? el.textContent.trim() : '';
}

function setText(root, sel, v) {
    const el = root.querySelector(sel);
    if (el) el.textContent = v;
}

function attr(root, sel, name) {
    const el = root.querySelector(sel);
    return el ? el.getAttribute(name) || '' : '';
}

function setAttr(root, sel, name, v) {
    const el = root.querySelector(sel);
    if (el) el.setAttribute(name, v);
}

function wsBefore(el) {
    const p = el.previousSibling;
    return p && p.nodeType === 3 && !p.data.trim() ? p : null;
}

function indentOf(el, fallback) {
    const ws = wsBefore(el);
    const m = ws && ws.data.match(/\n([ \t]*)$/);
    return m ? m[1] : fallback;
}

function containerIndent(container) {
    return indentOf(container, '');
}

function removeWithWs(el) {
    const ws = wsBefore(el);
    if (ws) ws.remove();
    el.remove();
}

/* Parse an HTML snippet (written with 4-space relative indentation) into an element
   of `doc`, re-indenting every line after the first by `indent`. */
function frag(doc, html, indent) {
    const t = doc.createElement('template');
    t.innerHTML = html.trim().split('\n').map((l, i) => (i ? indent + l : l)).join('\n');
    return t.content.firstElementChild;
}

/* Replace ALL element children of a container. */
function replaceChildren(container, items, unit) {
    const doc = container.ownerDocument;
    const outer = containerIndent(container);
    const first = container.firstElementChild;
    const inner = first ? indentOf(first, outer + unit) : outer + unit;
    while (container.firstChild) container.firstChild.remove();
    for (const el of items) {
        container.append(doc.createTextNode('\n' + inner));
        container.append(typeof el === 'string' ? frag(doc, el, inner) : el);
    }
    container.append(doc.createTextNode('\n' + outer));
}

/* Replace the children of `container` matching `match`, inserting the new ones where the
   first old one was (or before `anchor`). */
function replaceMatching(container, match, items, anchor, unit) {
    const doc = container.ownerDocument;
    const olds = [...container.children].filter(match);
    const inner = olds.length ? indentOf(olds[0], '') : (anchor ? indentOf(anchor, '') : containerIndent(container) + unit);
    let ref = olds.length ? olds[olds.length - 1].nextSibling : anchor;
    if (!olds.length && anchor && wsBefore(anchor)) ref = wsBefore(anchor);
    if (!olds.length && !anchor) ref = container.lastChild && container.lastChild.nodeType === 3 ? container.lastChild : null;
    for (const el of items) {
        container.insertBefore(doc.createTextNode('\n' + inner), ref);
        container.insertBefore(typeof el === 'string' ? frag(doc, el, inner) : el, ref);
    }
    olds.forEach(removeWithWs);
}

// ================================================================ field definitions: home page card

const CARD = {
    get(card) {
        const ribbon = card.querySelector('.pack-ribbon');
        return {
            title: text(card, '.pack-title'),
            description: text(card, '.pack-description'),
            image: attr(card, 'img.pack-image', 'src'),
            imageAlt: attr(card, 'img.pack-image', 'alt'),
            date: card.getAttribute('data-date') || '',
            versions: card.getAttribute('data-version') || '',
            versionLabel: text(card, '.pack-version'),
            theme: card.getAttribute('data-theme') || '',
            scale: card.getAttribute('data-scale') || '256x256',
            downloads: card.getAttribute('data-downloads') || '',
            ribbon: ribbon ? ribbon.textContent.trim() : '',
            tags: [...card.querySelectorAll('.pack-tag')].map(t => t.textContent.trim()),
        };
    },
    set: {
        title: (c, v) => setText(c, '.pack-title', v),
        description: (c, v) => setText(c, '.pack-description', v),
        image: (c, v) => setAttr(c, 'img.pack-image', 'src', v),
        imageAlt: (c, v) => setAttr(c, 'img.pack-image', 'alt', v),
        date: (c, v) => c.setAttribute('data-date', v),
        versions: (c, v) => { c.setAttribute('data-version', v.trim().split(/[\s,]+/).filter(Boolean).join(' ')); syncFilterOptions(); },
        versionLabel: (c, v) => setText(c, '.pack-version', v),
        theme: (c, v) => { c.setAttribute('data-theme', v.trim().toLowerCase()); syncFilterOptions(); },
        scale: (c, v) => c.setAttribute('data-scale', v),
        downloads: (c, v) => { if (v === '') c.removeAttribute('data-downloads'); else c.setAttribute('data-downloads', String(parseInt(v, 10) || 0)); },
        ribbon: (c, v) => {
            let r = c.querySelector(':scope > .pack-ribbon');
            if (!v) { if (r) removeWithWs(r); return; }
            if (!r) {
                const doc = c.ownerDocument;
                r = doc.createElement('div');
                r.className = 'pack-ribbon';
                const first = c.firstElementChild;
                c.insertBefore(doc.createTextNode('\n' + indentOf(first, '  ')), wsBefore(first) || first);
                c.insertBefore(r, wsBefore(first) || first);
            }
            r.textContent = v;
        },
        tags: (c, list) => {
            const box = c.querySelector('.pack-tags');
            if (box) replaceChildren(box, list.filter(Boolean).map(t => `<span class="pack-tag">${esc(t)}</span>`), '  ');
        },
    },
};

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

/* Keep the home page's Version / Theme filter dropdowns in step with the cards. */
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
    const verCmp = (a, b) => { // newest first
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

// ================================================================ field definitions: pack page

const DL_SITES = {
    curseforge: { icon: 'curseforge-svgrepo-com.png', label: 'CurseForge' },
    modrinth: { icon: 'modrinth.png', label: 'Modrinth' },
};

const PAGE = {
    get(d) {
        const meta = d.querySelector('meta[name="description"]');
        const feats = [...d.querySelectorAll('.features-list li')].map(li => {
            const c = li.cloneNode(true);
            const i = c.querySelector('i');
            if (i) i.remove();
            return c.innerHTML.trim();
        });
        return {
            title: d.title.trim(),
            metaDescription: meta ? meta.getAttribute('content').trim() : '',
            heading: text(d, '#pack-details .section-title'),
            cover: attr(d, '.pack-cover', 'src'),
            coverAlt: attr(d, '.pack-cover', 'alt'),
            version: text(d, '.pack-meta-badges .pack-badge.version'),
            themes: [...d.querySelectorAll('.pack-meta-badges .pack-badge.theme')].map(e => e.textContent.trim()),
            features: feats,
            descIcon: (attr(d, '.description-icon i', 'class').match(/fa-[\w-]+/g) || []).filter(c => c !== 'fa').join(' '),
            animeTitle: text(d, '.description-banner .anime-title'),
            packType: text(d, '.description-banner .pack-type'),
            paragraphs: [...d.querySelectorAll('.description-content > p')].map(p => p.innerHTML.trim()),
            highlights: [...d.querySelectorAll('.description-highlights .highlight-item')].map(it => ({
                icon: (attr(it, '.highlight-icon i', 'class').match(/fa-[\w-]+/g) || []).join(' '),
                title: text(it, '.highlight-text h4'),
                text: text(it, '.highlight-text p'),
            })),
            curseforge: attr(d, '.download-btn.curseforge', 'href'),
            modrinth: attr(d, '.download-btn.modrinth', 'href'),
            compat: [...d.querySelectorAll('.compatibility-badges .compatibility-badge')].map(e => e.textContent.trim()),
            previews: [...d.querySelectorAll('.thumbnails-grid .thumbnail-item img')].map(i => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '' })),
            slides: [...d.querySelectorAll('#myModal .mySlides')].map(s => ({ src: attr(s, 'img', 'src'), caption: text(s, '#caption, .caption') })),
        };
    },
    set: {
        title: (d, v) => { let t = d.querySelector('title'); if (!t) { t = d.createElement('title'); d.head.prepend(t); } t.textContent = v; },
        metaDescription: (d, v) => {
            let m = d.querySelector('meta[name="description"]');
            if (!m) {
                const t = d.querySelector('title');
                m = d.createElement('meta');
                m.setAttribute('name', 'description');
                t.after(d.createTextNode('\n' + indentOf(t, '    ')), m);
            }
            m.setAttribute('content', v);
        },
        heading: (d, v) => setText(d, '#pack-details .section-title', v),
        cover: (d, v) => setAttr(d, '.pack-cover', 'src', v),
        coverAlt: (d, v) => setAttr(d, '.pack-cover', 'alt', v),
        version: (d, v) => setText(d, '.pack-meta-badges .pack-badge.version', v),
        themes: (d, list) => {
            const box = d.querySelector('.pack-meta-badges');
            replaceMatching(box, e => e.classList.contains('theme'), list.filter(Boolean).map(t => `<span class="pack-badge theme">${esc(t)}</span>`), null, '    ');
        },
        features: (d, list) => {
            const box = d.querySelector('.features-list');
            const icon = attr(box, 'li i', 'class') || 'fa fa-check-circle';
            replaceChildren(box, list.filter(Boolean).map(f => `<li><i class="${esc(icon)}"></i> ${f}</li>`), '    ');
        },
        descIcon: (d, v) => setAttr(d, '.description-icon i', 'class', 'fa ' + v.trim()),
        animeTitle: (d, v) => setText(d, '.description-banner .anime-title', v),
        packType: (d, v) => setText(d, '.description-banner .pack-type', v),
        paragraphs: (d, list) => {
            const box = d.querySelector('.description-content');
            replaceMatching(box, e => e.tagName === 'P', list.filter(p => p.trim()).map(p => `<p>${p}</p>`), box.querySelector('.description-highlights'), '    ');
        },
        highlights: (d, list) => {
            const box = d.querySelector('.description-highlights');
            replaceChildren(box, list.map(x => `
<div class="highlight-item">
    <div class="highlight-icon">
        <i class="fa ${esc(x.icon)}"></i>
    </div>
    <div class="highlight-text">
        <h4>${esc(x.title)}</h4>
        <p>${esc(x.text)}</p>
    </div>
</div>`), '    ');
        },
        downloads: (d, v) => {
            const box = d.querySelector('.download-buttons');
            const items = [];
            for (const site of ['curseforge', 'modrinth']) {
                if (!v[site]) continue;
                const s = DL_SITES[site];
                items.push(`
<a href="${esc(v[site])}" class="download-btn ${site}" target="_blank">
    <img src="${s.icon}" alt="${s.label}" class="button-icon">
    <div class="download-btn-text">
        <span class="btn-label">Download from</span>
        <span class="btn-site">${s.label}</span>
    </div>
</a>`);
            }
            replaceChildren(box, items, '    ');
        },
        compat: (d, list) => {
            const box = d.querySelector('.compatibility-badges');
            replaceChildren(box, list.filter(Boolean).map(c => `<span class="compatibility-badge">${esc(c)}</span>`), '    ');
        },
        previews: (d, list) => {
            const box = d.querySelector('.thumbnails-grid');
            replaceChildren(box, list.filter(x => x.src).map((x, i) => `
<div class="thumbnail-item" onclick="openModal();currentSlide(${i + 1})">
    <img src="${esc(x.src)}" alt="${esc(x.alt)}">
</div>`), '    ');
        },
        slides: (d, list) => {
            const box = d.querySelector('#myModal .modal-content');
            const anchor = box.querySelector('a.prev');
            let ref = anchor;
            // keep the "Next/previous controls" comment attached to the arrows
            for (let n = anchor && anchor.previousSibling; n; n = n.previousSibling) {
                if (n.nodeType === 8) { ref = n; break; }
                if (n.nodeType === 1) break;
            }
            replaceMatching(box, e => e.classList.contains('mySlides'), list.filter(x => x.src).map(x => `
<div class="mySlides">
    <img src="${esc(x.src)}" style="width:100%">${x.caption ? `
    <div id="caption">${esc(x.caption)}</div>` : ''}
</div>`), ref, '    ');
        },
    },
};

// ================================================================ sitemap

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

// ================================================================ images

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

// ================================================================ pending changes

function pendingChanges() {
    const out = [];
    for (const [path, f] of S.files) {
        if (S.deletes.has(path)) continue;
        if (f.kind === 'html') {
            const now = serialize(f.doc);
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
    const n = pendingChanges().length;
    $('#pending-count').textContent = n;
    $('#publish-btn').disabled = n === 0;
    renderList();
}, 250);

window.addEventListener('beforeunload', e => {
    if (S.headSha && pendingChanges().length) { e.preventDefault(); e.returnValue = ''; }
});

// ================================================================ rendering: shell + list

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
        ul.append(h('li', { class: S.current === p ? 'active' : '', onclick: () => openPack(p) },
            h('img', { src: img || 'data:,', alt: '', loading: 'lazy' }),
            h('span', { class: 'name' }, name, h('span', { class: 'sub' }, p.card ? (p.card.getAttribute('data-date') || '') + ' · ' + (text(p.card, '.pack-version') || '') : p.file)),
            st && h('span', { class: 'badge ' + st }, st),
            warn && h('span', { class: 'badge warn', title: warn === 'no card' ? 'Page exists but is not listed on the home page' : 'Home page card links to a page that does not exist' }, warn)
        ));
    }
}

// ================================================================ rendering: editor

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
            hasPage && h('button', { class: 'btn small', onclick: () => previewPage(p) }, h('i', { class: 'fa fa-eye' }), ' Preview page'),
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

function missingBox(msg, btn, fn) {
    return h('div', { class: 'section' }, h('p', {}, msg), btn && h('button', { class: 'btn primary', onclick: fn }, btn));
}

// ---- generic inputs

function field(label, value, onInput, opts = {}) {
    const input = opts.textarea
        ? h('textarea', { rows: opts.rows || 3, placeholder: opts.placeholder || '' })
        : opts.options
            ? h('select', {}, opts.options.map(o => h('option', { value: o[0] }, o[1])))
            : h('input', { type: opts.type || 'text', placeholder: opts.placeholder || '', list: opts.list || null });
    input.value = value ?? '';
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

/* Editable list. `make(item, update)` renders one row's fields. */
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

const changed = () => updatePending();

// ---- card form

function themeOptions() {
    const sel = indexDoc().getElementById('theme-filter');
    return sel ? [...sel.options].filter(o => o.value !== 'all').map(o => o.value) : [];
}

function cardForm(p) {
    const c = p.card;
    const v = CARD.get(c);
    const set = (k) => val => { CARD.set[k](c, val); S.editedCards.add(c); };
    const themes = themeOptions();
    const dl = h('datalist', { id: 'theme-list' }, themes.map(t => h('option', { value: t })));
    return h('div', {},
        section('Card', 'What visitors see in the Texture Packs grid on the home page.',
            h('div', { class: 'grid' },
                field('Title', v.title, set('title'), { wide: true }),
                field('Short description', v.description, set('description'), { textarea: true, rows: 2, wide: true }),
                imageField('Thumbnail image', v.image, false, set('image'), { wide: true }),
                field('Image alt text', v.imageAlt, set('imageAlt')),
                field('Release date', v.date, set('date'), { type: 'date' }),
                field('Ribbon', v.ribbon, set('ribbon'), { options: [['', 'None'], ['New', 'New'], ['Updated', 'Updated']] }))),
        section('Filters & sorting', 'Used by the home page search, filters, “Most Popular” and sorting.',
            h('div', { class: 'grid' },
                field('Version label (shown on card)', v.versionLabel, set('versionLabel'), { placeholder: '1.21 - 1.21.1' }),
                field('Versions for the filter (space separated)', v.versions, set('versions'), { placeholder: '1.21 1.21.1' }),
                field('Theme', v.theme, set('theme'), { list: 'theme-list', placeholder: themes.join(', ') }),
                field('Scale', v.scale, set('scale'), { options: [['256x256', '256x256'], ['512x512+', '512x512+']] }),
                field('Downloads (for “Most Popular”)', v.downloads, set('downloads'), { type: 'number' })),
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
    if (pg.version) { CARD.set.versionLabel(c, pg.version); if (!c.getAttribute('data-version')) CARD.set.versions(c, pg.version); }
    if (pg.themes.length) { CARD.set.tags(c, pg.themes); CARD.set.theme(c, pg.themes[0]); }
    S.editedCards.add(c);
    changed();
}

// ---- page form

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
                field('Browser title', v.title, set('title'), { wide: true }),
                field('Meta description (Google snippet)', v.metaDescription, set('metaDescription'), { textarea: true, rows: 2, wide: true }),
                field('Heading', v.heading, set('heading'), { wide: true }),
                imageField('Cover image', v.cover, true, set('cover'), { wide: true }),
                field('Cover alt text', v.coverAlt, set('coverAlt')),
                field('Version badge', v.version, set('version'), { placeholder: '1.21.8' }))),
        section('Theme badges', 'Shown under the cover.', stringList(v.themes, set('themes'), 'Fantasy')),
        section('Preview thumbnails', 'The small images under the cover. Clicking one opens that screenshot number in the lightbox.', previewList),
        section('Screenshots (lightbox)', 'Everything shown in the “View All Screenshots” popup, in order.', slideEditor),
        section('Features', 'Bullet list under “Features”. HTML allowed.', stringList(v.features, set('features'), 'Custom hotbar and crosshair')),
        section('Description', null,
            h('div', { class: 'grid' },
                field('Anime title (banner)', v.animeTitle, set('animeTitle')),
                field('Banner label', v.packType, set('packType')),
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
                field('CurseForge URL', v.curseforge, setDl('curseforge'), { placeholder: 'https://www.curseforge.com/minecraft/texture-packs/…' }),
                field('Modrinth URL', v.modrinth, setDl('modrinth'), { placeholder: 'https://modrinth.com/resourcepack/…' }))),
        section('Compatibility', 'Badges under “Compatibility”.', stringList(v.compat, set('compat'), 'Minecraft Java Edition 1.21.8'))
    );
}

function htmlForm(p, page) {
    const ta = h('textarea', { class: 'html-editor', spellcheck: 'false' });
    ta.value = serialize(page.doc);
    return section('Raw HTML', 'Advanced: edit the whole page by hand. “Apply” replaces the page with this HTML; the other tabs then show the result.',
        ta,
        h('div', { class: 'list-foot' },
            h('button', { class: 'btn primary', onclick: () => {
                page.doc = parseHTML(ta.value);
                changed();
                toast('HTML applied.');
            } }, h('i', { class: 'fa fa-check' }), ' Apply'),
            h('button', { class: 'btn', onclick: () => { ta.value = serialize(page.doc); } }, 'Reset textarea')));
}

function previewPage(p) {
    const f = S.files.get(p.file);
    if (!f) return;
    const doc = parseHTML(serialize(f.doc));
    // Point relative URLs at the deployed site, and show staged uploads.
    const base = doc.createElement('base');
    base.href = new URL(p.file.replace(/[^/]+$/, ''), location.protocol.startsWith('http') ? location.href : S.siteUrl).href;
    doc.head.prepend(base);
    // Visual preview only: no page scripts, ads or analytics run.
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

// ================================================================ pack actions

function discardPack(p) {
    const f = S.files.get(p.file);
    if (f && f.original === null) { toast('This is a new pack — use Delete to remove it.'); return; }
    if (f) S.files.delete(p.file);
    if (p.card && S.editedCards.has(p.card)) {
        // Restore the card from the original index.html
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
        h('h2', {}, 'Delete “' + name + '”?'),
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
                toast('Deleted “' + name + '” (publish to apply).');
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
    // Layouts to copy: pages already using the shared assets/js/pack.js
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
        h('p', { class: 'muted' }, 'The new page uses the same layout as the chosen pack; all text, images and links start empty for you to fill in.'),
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
    CARD.set.versions(c, version);
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

// ================================================================ modal

function modal(content) {
    $('#modal-body').replaceChildren(content);
    $('#modal').hidden = false;
}

function closeModal() {
    if (closeModal.locked) return;
    $('#modal').hidden = true;
    $('#modal-body').replaceChildren();
}

// ================================================================ publish

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
            await publish(changes, msg.value.trim() || 'Update site', steps);
        } catch (ex) {
            step(steps, 'fa-times', ex.message + (ex.status === 403 || ex.status === 404 ? ' — does the token have Contents: Read and write on this repo?' : ''));
            btn.disabled = false;
        } finally {
            closeModal.locked = false;
        }
    });
    modal(h('div', {}, h('h2', {}, 'Publish ' + changes.length + ' change' + (changes.length > 1 ? 's' : '')), form));
}

function step(list, icon, label) {
    const li = h('li', {}, h('i', { class: 'fa ' + icon }), h('span', {}, label));
    list.append(li);
    return { done: (ic, txt) => { li.firstChild.className = 'fa ' + ic; if (txt) li.lastChild.textContent = txt; } };
}

async function publish(changes, message, steps) {
    let s = step(steps, 'fa-spinner fa-spin', 'Checking for newer changes on GitHub…');
    const ref = await gh('GET', refPath());
    let parent = ref.object.sha;
    if (parent !== S.headSha) {
        const cmp = await gh('GET', `${repoPath()}/compare/${S.headSha}...${parent}`);
        const remote = new Set((cmp.files || []).map(f => f.filename));
        const clash = changes.filter(c => remote.has(c.path)).map(c => c.path);
        if (clash.length) {
            s.done('fa-times', 'These files changed on GitHub since you loaded them: ' + clash.join(', ') + '. Copy your edits, reload the page and try again.');
            throw new Error('Publish stopped to avoid overwriting newer changes.');
        }
        s.done('fa-check', 'GitHub has newer commits, none touching your files — publishing on top of them.');
    } else {
        s.done('fa-check', 'Up to date with GitHub.');
    }

    s = step(steps, 'fa-spinner fa-spin', 'Uploading files…');
    const entries = [];
    let i = 0;
    for (const c of changes) {
        i++;
        s.done('fa-spinner fa-spin', `Uploading files… (${i}/${changes.length})`);
        if (c.status === 'D') {
            entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
            continue;
        }
        const blob = await gh('POST', `${repoPath()}/git/blobs`, c.base64 != null ? { content: c.base64, encoding: 'base64' } : { content: c.content, encoding: 'utf-8' });
        entries.push({ path: c.path, mode: (S.tree.get(c.path) || {}).mode || '100644', type: 'blob', sha: blob.sha });
    }
    s.done('fa-check', `Uploaded ${changes.length} file${changes.length > 1 ? 's' : ''}.`);

    s = step(steps, 'fa-spinner fa-spin', 'Creating commit…');
    const parentCommit = await gh('GET', `${repoPath()}/git/commits/${parent}`);
    const tree = await gh('POST', `${repoPath()}/git/trees`, { base_tree: parentCommit.tree.sha, tree: entries });
    const commit = await gh('POST', `${repoPath()}/git/commits`, { message, tree: tree.sha, parents: [parent] });
    await gh('PATCH', `${repoPath()}/git/refs/heads/${S.cfg.branch.split('/').map(encodeURIComponent).join('/')}`, { sha: commit.sha, force: false });
    const commitUrl = `https://github.com/${S.cfg.owner}/${S.cfg.repo}/commit/${commit.sha}`;
    s.done('fa-check', 'Committed ' + commit.sha.slice(0, 7) + '.');
    steps.lastChild.append(' ', h('a', { href: commitUrl, target: '_blank', rel: 'noopener' }, 'View on GitHub'));

    // Fold the published state in as the new baseline.
    for (const c of changes) {
        if (c.status === 'D') { S.tree.delete(c.path); S.files.delete(c.path); continue; }
        const f = S.files.get(c.path);
        if (f && f.kind === 'html') { f.original = c.content; f.doc = parseHTML(c.content); f.baseline = serialize(f.doc); }
        else if (f) { f.original = c.content; f.text = c.content; }
        S.tree.set(c.path, { sha: null, mode: '100644' });
    }
    S.deletes.clear();
    S.uploads.clear();
    S.headSha = commit.sha;
    // Card element references now point at the old index doc — rebuild.
    S.editedCards = new WeakSet();
    const cur = S.current && S.current.file;
    buildPackList();
    S.current = S.packs.find(p => p.file === cur) || null;
    S.tree = await loadTree(commit.sha);
    renderShell();
    renderEditor();
    changed();

    await watchDeploy(commit.sha, steps);
}

async function watchDeploy(sha, steps, event, since) {
    const s = step(steps, 'fa-spinner fa-spin', 'Waiting for the GitHub Pages deploy to start…');
    const actionsUrl = `https://github.com/${S.cfg.owner}/${S.cfg.repo}/actions`;
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
        let runs;
        try {
            const q = event ? `event=${event}&branch=${encodeURIComponent(S.cfg.branch)}&per_page=5` : `head_sha=${sha}&per_page=5`;
            runs = (await gh('GET', `${repoPath()}/actions/runs?${q}`)).workflow_runs || [];
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                s.done('fa-exclamation-triangle', 'Published. This token can’t read GitHub Actions, so deploy progress isn’t shown here — check the Actions tab.');
                steps.lastChild.append(' ', h('a', { href: actionsUrl, target: '_blank', rel: 'noopener' }, 'Open Actions'));
                return;
            }
            throw e;
        }
        const run = since ? runs.find(r => Date.parse(r.created_at) >= since - 10000) : runs[0];
        if (!run) {
            if (Date.now() - started > 90 * 1000) {
                s.done('fa-exclamation-triangle', 'No deploy started. Make sure .github/workflows/static.yml is in the repo and Settings → Pages → Source is “GitHub Actions”.');
                return;
            }
        } else if (run.status === 'completed') {
            if (run.conclusion === 'success') s.done('fa-check', 'Deployed — the live site is updated (browsers may cache for a few minutes).');
            else s.done('fa-times', 'Deploy finished with “' + run.conclusion + '”.');
            steps.lastChild.append(' ', h('a', { href: run.html_url, target: '_blank', rel: 'noopener' }, 'Details'));
            return;
        } else {
            s.done('fa-spinner fa-spin', 'Deploying… (' + run.status.replace('_', ' ') + ')');
        }
        await new Promise(r => setTimeout(r, 5000));
    }
    s.done('fa-exclamation-triangle', 'Still deploying after 10 minutes — check the Actions tab.');
}

async function redeploy() {
    const steps = h('ul', { class: 'steps' });
    modal(h('div', {}, h('h2', {}, 'Redeploy'), h('p', { class: 'muted' }, 'Re-runs the GitHub Pages deploy for the current ' + S.cfg.branch + ' branch.'), steps,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    const s = step(steps, 'fa-spinner fa-spin', 'Starting deploy…');
    try {
        const since = Date.now();
        await gh('POST', `${repoPath()}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: S.cfg.branch });
        s.done('fa-check', 'Deploy requested.');
        await new Promise(r => setTimeout(r, 4000));
        await watchDeploy(null, steps, 'workflow_dispatch', since);
    } catch (e) {
        s.done('fa-times', e.status === 403 ? 'This token needs “Actions: Read and write” to redeploy.' : e.status === 404 ? `Workflow .github/workflows/${WORKFLOW_FILE} not found in the repo.` : e.message);
    }
}

// ================================================================ boot

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
            storeCfg(cfg, $('#cfg-remember').checked);
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
        S.cfg = null;
        S.headSha = null;
        showConnect();
    });
}

async function boot() {
    bind();
    const cfg = readStoredCfg();
    if (!cfg || !cfg.token) { showConnect(); return; }
    try {
        await connect(cfg);
    } catch (e) {
        showConnect(e.status === 401 ? 'Saved token was rejected — paste a new one.' : e.message);
    }
}

boot();
})();
