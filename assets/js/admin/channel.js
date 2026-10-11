/**
 * channel.js — BroadcastChannel wrapper for admin ↔ editor communication.
 *
 * Security: The channel name includes an unguessable per-session key so that
 * same-origin ad scripts cannot intercept or fake messages. Every message also
 * carries the key; the hub drops anything with a wrong key.
 *
 * All messages: { key, origin, type, ...payload }
 * Valid types: hello, state, edit, list-op, upload, changed, publish,
 *              publish-step, pending, discard, bye, ping, pong, undo, redo
 */

const VALID_TYPES = new Set([
    'hello', 'state', 'edit', 'list-op', 'upload', 'changed',
    'publish', 'publish-step', 'pending', 'discard', 'bye', 'ping', 'pong',
    'undo', 'redo',
]);

const FILE_RE = /^(index\.html|Packs\/[A-Za-z0-9!'._-]+\.html)$/;

/** Generate a 128-bit hex key. */
export function makeKey() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class AdminChannel {
    /**
     * @param {string} key         - The shared session key.
     * @param {string} originId    - A string identifying this tab ('hub' or 'editor-<file>').
     * @param {function} onMessage - Called with validated message objects.
     */
    constructor(key, originId, onMessage) {
        this._key = key;
        this._origin = originId;
        this._on = onMessage;
        this._ch = new BroadcastChannel('lmc-admin-' + key);
        this._ch.addEventListener('message', e => this._recv(e.data));
    }

    _recv(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.key !== this._key) return;                  // wrong session
        if (!VALID_TYPES.has(msg.type)) return;             // unknown type
        if (msg.file && !FILE_RE.test(msg.file)) return;    // path injection guard
        this._on(msg);
    }

    send(type, payload = {}) {
        this._ch.postMessage({ key: this._key, origin: this._origin, type, ...payload });
    }

    close() { this._ch.close(); }
}

/** Build the URL fragment for opening the editor tab. */
export function editorUrl(key, file) {
    return `admin-editor.html#k=${encodeURIComponent(key)}&file=${encodeURIComponent(file)}`;
}

/** Parse the #k=…&file=… fragment in the editor tab. */
export function parseEditorHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const key = params.get('k') || '';
    const file = params.get('file') || '';
    return { key, file };
}
