/**
 * github.js — GitHub Git Data API wrapper + load/publish helpers.
 * Only imported by app.js (never by editor.js).
 */

import { parseHTML, serialize } from './core.js';

const API = 'https://api.github.com';

// ── Low-level request ──────────────────────────────────────────────────────

export async function gh(method, path, body, token) {
    const res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: Object.assign({
            Authorization: 'Bearer ' + token,
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

export const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

// ── Repo helpers ───────────────────────────────────────────────────────────

export const repoPath = (cfg) => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
export const refPath = (cfg) => `${repoPath(cfg)}/git/ref/heads/${cfg.branch.split('/').map(encodeURIComponent).join('/')}`;

export async function loadTree(cfg, commitSha) {
    const commit = await gh('GET', `${repoPath(cfg)}/git/commits/${commitSha}`, null, cfg.token);
    const tree = await gh('GET', `${repoPath(cfg)}/git/trees/${commit.tree.sha}?recursive=1`, null, cfg.token);
    if (tree.truncated) throw new Error('Repository tree is too large to list.');
    const map = new Map();
    for (const t of tree.tree) if (t.type === 'blob') map.set(t.path, { sha: t.sha, mode: t.mode });
    return map;
}

export async function readText(cfg, tree, path) {
    const entry = tree.get(path);
    if (!entry) return null;
    const blob = await gh('GET', `${repoPath(cfg)}/git/blobs/${entry.sha}`, null, cfg.token);
    return b64ToText(blob.content);
}

// ── Publish ────────────────────────────────────────────────────────────────

/**
 * Publish a set of changes as one commit.
 * @param {object} cfg          - { token, owner, repo, branch }
 * @param {string} headSha      - the sha the admin loaded from
 * @param {Array}  changes      - [{path, status:'A'|'M'|'D', content?, base64?}]
 * @param {string} message      - commit message
 * @param {function} onStep     - called with {id, state:'running'|'done'|'error', text, link?}
 * @param {Map}    tree         - current tree map (path -> {sha,mode})
 * @returns {object}            - {commitSha, newTree}
 */
export async function publish(cfg, headSha, changes, message, onStep, tree) {
    const rp = repoPath(cfg);

    onStep({ id: 'check', state: 'running', text: 'Checking for newer changes on GitHub…' });
    const ref = await gh('GET', refPath(cfg), null, cfg.token);
    let parent = ref.object.sha;
    if (parent !== headSha) {
        const cmp = await gh('GET', `${rp}/compare/${headSha}...${parent}`, null, cfg.token);
        const remote = new Set((cmp.files || []).map(f => f.filename));
        const clash = changes.filter(c => remote.has(c.path)).map(c => c.path);
        if (clash.length) {
            onStep({ id: 'check', state: 'error', text: 'These files changed on GitHub since you loaded them: ' + clash.join(', ') + '. Reload and try again.' });
            throw new Error('Publish stopped to avoid overwriting newer changes.');
        }
        onStep({ id: 'check', state: 'done', text: 'GitHub has newer commits, none touching your files — publishing on top.' });
    } else {
        onStep({ id: 'check', state: 'done', text: 'Up to date with GitHub.' });
    }

    onStep({ id: 'upload', state: 'running', text: `Uploading files… (0/${changes.length})` });
    const entries = [];
    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        onStep({ id: 'upload', state: 'running', text: `Uploading files… (${i + 1}/${changes.length})` });
        if (c.status === 'D') {
            entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
            continue;
        }
        const blob = await gh('POST', `${rp}/git/blobs`, c.base64 != null ? { content: c.base64, encoding: 'base64' } : { content: c.content, encoding: 'utf-8' }, cfg.token);
        entries.push({ path: c.path, mode: (tree.get(c.path) || {}).mode || '100644', type: 'blob', sha: blob.sha });
    }
    onStep({ id: 'upload', state: 'done', text: `Uploaded ${changes.length} file${changes.length !== 1 ? 's' : ''}.` });

    onStep({ id: 'commit', state: 'running', text: 'Creating commit…' });
    const parentCommit = await gh('GET', `${rp}/git/commits/${parent}`, null, cfg.token);
    const newTree = await gh('POST', `${rp}/git/trees`, { base_tree: parentCommit.tree.sha, tree: entries }, cfg.token);
    const commit = await gh('POST', `${rp}/git/commits`, { message, tree: newTree.sha, parents: [parent] }, cfg.token);
    await gh('PATCH', `${rp}/git/refs/heads/${cfg.branch.split('/').map(encodeURIComponent).join('/')}`, { sha: commit.sha, force: false }, cfg.token);
    const commitUrl = `https://github.com/${cfg.owner}/${cfg.repo}/commit/${commit.sha}`;
    onStep({ id: 'commit', state: 'done', text: 'Committed ' + commit.sha.slice(0, 7) + '.', link: commitUrl });

    return { commitSha: commit.sha, parentSha: parent };
}

/** Watch GitHub Actions for deploy completion. */
export async function watchDeploy(cfg, commitSha, onStep, eventFilter, since) {
    const rp = repoPath(cfg);
    const actionsUrl = `https://github.com/${cfg.owner}/${cfg.repo}/actions`;
    onStep({ id: 'deploy', state: 'running', text: 'Waiting for the GitHub Pages deploy to start…' });
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
        let runs;
        try {
            const q = eventFilter ? `event=${eventFilter}&branch=${encodeURIComponent(cfg.branch)}&per_page=5` : `head_sha=${commitSha}&per_page=5`;
            runs = (await gh('GET', `${rp}/actions/runs?${q}`, null, cfg.token)).workflow_runs || [];
        } catch (e) {
            if (e.status === 403 || e.status === 404) {
                onStep({ id: 'deploy', state: 'done', text: "Published. This token can't read Actions — check the Actions tab.", link: actionsUrl });
                return;
            }
            throw e;
        }
        const run = since ? runs.find(r => Date.parse(r.created_at) >= since - 10000) : runs[0];
        if (!run) {
            if (Date.now() - started > 90000) {
                onStep({ id: 'deploy', state: 'error', text: 'No deploy started. Check .github/workflows/static.yml and Pages settings.' });
                return;
            }
        } else if (run.status === 'completed') {
            if (run.conclusion === 'success') onStep({ id: 'deploy', state: 'done', text: 'Deployed — the live site is updated.', link: run.html_url });
            else onStep({ id: 'deploy', state: 'error', text: `Deploy finished with "${run.conclusion}".`, link: run.html_url });
            return;
        } else {
            onStep({ id: 'deploy', state: 'running', text: 'Deploying… (' + run.status.replace('_', ' ') + ')' });
        }
        await new Promise(r => setTimeout(r, 5000));
    }
    onStep({ id: 'deploy', state: 'error', text: 'Still deploying after 10 minutes — check the Actions tab.', link: actionsUrl });
}
