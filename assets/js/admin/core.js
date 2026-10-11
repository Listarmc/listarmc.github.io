/**
 * core.js — field registries, DOM helpers, serialization
 * Imported by app.js (admin) and editor.js (visual tab).
 * No GitHub code, no BroadcastChannel, no DOM references to admin.html.
 */

export const parseHTML = text => new DOMParser().parseFromString(text, 'text/html');

/** Serialize a parsed page back to HTML string. */
export function serialize(doc) {
    return ('<!DOCTYPE html>\n' + doc.documentElement.outerHTML)
        .replace(/^(<!DOCTYPE html>\n<html[^>]*>)<head>/, '$1\n<head>')
        .replace(/ (async|defer|hidden|disabled|required|checked|selected|multiple|readonly|autofocus|nomodule)=""/g, ' $1')
        .replace(/\s*<\/body><\/html>$/, '\n</body>\n</html>') + '\n';
}

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── DOM editing helpers (operate on any Document) ──────────────────────────

export function text(root, sel) {
    const el = root.querySelector(sel);
    return el ? el.textContent.trim() : '';
}
export function setText(root, sel, v) {
    const el = root.querySelector(sel);
    if (el) el.textContent = v;
}
export function attr(root, sel, name) {
    const el = root.querySelector(sel);
    return el ? el.getAttribute(name) || '' : '';
}
export function setAttr(root, sel, name, v) {
    const el = root.querySelector(sel);
    if (el) el.setAttribute(name, v);
}

export function wsBefore(el) {
    const p = el.previousSibling;
    return p && p.nodeType === 3 && !p.data.trim() ? p : null;
}
export function indentOf(el, fallback) {
    const ws = wsBefore(el);
    const m = ws && ws.data.match(/\n([ \t]*)$/);
    return m ? m[1] : fallback;
}
export function containerIndent(container) { return indentOf(container, ''); }
export function removeWithWs(el) {
    const ws = wsBefore(el);
    if (ws) ws.remove();
    el.remove();
}

export function frag(doc, html, indent) {
    const t = doc.createElement('template');
    t.innerHTML = html.trim().split('\n').map((l, i) => (i ? indent + l : l)).join('\n');
    return t.content.firstElementChild;
}

export function replaceChildren(container, items, unit) {
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

export function replaceMatching(container, match, items, anchor, unit) {
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

// ── Selectors (shared between form and visual editor) ─────────────────────

export const SELECTORS = {
    title: 'title',
    metaDescription: 'meta[name="description"]',
    heading: '#pack-details .section-title',
    cover: '.pack-cover',
    version: '.pack-meta-badges .pack-badge.version',
    themes: '.pack-meta-badges .pack-badge.theme',
    featuresList: '.features-list',
    featuresItems: '.features-list li',
    descIcon: '.description-icon i',
    animeTitle: '.description-banner .anime-title',
    packType: '.description-banner .pack-type',
    paragraphs: '.description-content > p',
    highlightsBox: '.description-highlights',
    highlightItems: '.description-highlights .highlight-item',
    downloadsBox: '.download-buttons',
    compatBox: '.compatibility-badges',
    compatItems: '.compatibility-badges .compatibility-badge',
    thumbnailsGrid: '.thumbnails-grid',
    thumbnailItems: '.thumbnails-grid .thumbnail-item img',
    modalContent: '#myModal .modal-content',
    slides: '#myModal .mySlides',
};

// ── Field registry: pack page (Packs/*.html) ──────────────────────────────

const DL_SITES = {
    curseforge: { icon: 'curseforge-svgrepo-com.png', label: 'CurseForge' },
    modrinth: { icon: 'modrinth.png', label: 'Modrinth' },
};

export const PAGE = {
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
        curseforge: (d, v) => { const dl = { curseforge: v, modrinth: attr(d, '.download-btn.modrinth', 'href') }; PAGE.set.downloads(d, dl); },
        modrinth: (d, v) => { const dl = { curseforge: attr(d, '.download-btn.curseforge', 'href'), modrinth: v }; PAGE.set.downloads(d, dl); },
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

// ── Field registry: home page card ────────────────────────────────────────

export const CARD = {
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
        versions: (c, v, syncFn) => { c.setAttribute('data-version', v.trim().split(/[\s,]+/).filter(Boolean).join(' ')); if (syncFn) syncFn(); },
        versionLabel: (c, v) => setText(c, '.pack-version', v),
        theme: (c, v, syncFn) => { c.setAttribute('data-theme', v.trim().toLowerCase()); if (syncFn) syncFn(); },
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

/** Strip editor annotations from an HTML string (safety guard). */
export function stripEditorMarkup(html) {
    return html
        .replace(/ contenteditable="[^"]*"/g, '')
        .replace(/ data-lmc-field="[^"]*"/g, '')
        .replace(/ data-lmc-index="[^"]*"/g, '')
        .replace(/ data-lmc-card="[^"]*"/g, '')
        .replace(/ class="lmc-editable[^"]*"/g, (m) => {
            // strip lmc-* classes but keep others
            const cleaned = m.replace(/ class="/, '').replace(/"$/, '')
                .split(' ').filter(c => !c.startsWith('lmc-')).join(' ');
            return cleaned ? ` class="${cleaned}"` : '';
        })
        .replace(/<base [^>]*>/g, '')
        .replace(/class="([^"]*)"/g, (m, c) => {
            const cleaned = c.split(' ').filter(x => !x.startsWith('lmc-')).join(' ');
            return cleaned ? `class="${cleaned}"` : '';
        });
}

/** Sanitize rich-text innerHTML: keep only allowed tags and attributes. */
export function sanitizeRichText(html) {
    const dp = new DOMParser();
    const doc = dp.parseFromString('<div>' + html + '</div>', 'text/html');
    const root = doc.querySelector('div');
    function walk(node) {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === 3) continue; // text
            if (child.nodeType === 1) {
                const tag = child.tagName.toLowerCase();
                if (['strong', 'em', 'b', 'i', 'br'].includes(tag)) {
                    // strip all attributes
                    [...child.attributes].forEach(a => child.removeAttribute(a.name));
                    walk(child);
                } else if (tag === 'a') {
                    const href = child.getAttribute('href') || '';
                    [...child.attributes].forEach(a => child.removeAttribute(a.name));
                    if (/^https?:\/\//i.test(href)) child.setAttribute('href', href);
                    walk(child);
                } else {
                    // replace disallowed element with its children
                    while (child.firstChild) child.before(child.firstChild);
                    child.remove();
                }
            }
        }
    }
    walk(root);
    return root.innerHTML;
}
