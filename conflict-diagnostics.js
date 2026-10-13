import { diagnosticSafeScript, diagnosticWriteTrace } from './diagnostics.js';

export const CONFLICT_NOTE = 'Observed writes identify the immediate synchronous caller, not a proven root cause. DOM observations and replaced objects/descriptors have unknown writers. Loaded scripts are not an enabled-extension inventory. Handled errors, other devices, and changes before recording may be invisible. Only the latest assistant reply is watched. No dialogue, translation, prompts, error messages, request bodies, keys, or full URLs are exported. Records stay in this page memory and disappear on reload.';
const FIELDS = ['send_date', 'gen_started', 'gen_finished', 'swipe_id'];
const EXTRA_FIELDS = ['token_count', 'display_text', 'reasoning_duration', 'time_to_first_token'];
const ERROR_NAMES = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createConflictDiagnostics(host) {
    const rows = [], slots = new Map(), identities = new WeakMap(), textIds = new Map();
    let nextIdentity = 1, nextTextId = 1, current = null, metadata = null, chatId = null, index = -1;
    let lastData = null, lastDom = null, started = false, writing = false, observer = null, root = null;
    let dropped = 0, bucket = 0, inBucket = 0, sequence = 0;
    const salt = Math.random().toString(36);
    const live = () => host.ready() && host.enabled();
    const id = value => {
        if (!value || typeof value !== 'object') return 0;
        if (!identities.has(value)) identities.set(value, nextIdentity++);
        return identities.get(value);
    };
    function textInfo(value) {
        if (typeof value !== 'string') return { type: typeof value };
        if (value.length > 65536) return { chars: value.length, comparison: 'size_limit' };
        let a = 2166136261, b = 5381;
        for (const c of salt + value) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
        const hash = `${value.length}:${a >>> 0}:${b >>> 0}`;
        if (!textIds.has(hash)) {
            if (textIds.size >= 256) textIds.delete(textIds.keys().next().value);
            textIds.set(hash, nextTextId++);
        }
        return { chars: value.length, valueId: textIds.get(hash) };
    }
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    function valueInfo(field, value) {
        if (field === 'mes' || field === 'extra.display_text') return textInfo(value);
        if (field === 'send_date' || field.startsWith('gen_')) {
            const epoch = value instanceof Date ? value.getTime() : typeof value === 'number' ? value
                : typeof value === 'string' && value.length < 80 ? Date.parse(value) : NaN;
            return { epochMs: Number.isFinite(epoch) ? epoch : null, value: typeof value === 'string' ? textInfo(value) : undefined };
        }
        if (field === 'extra') return { objectId: id(value) };
        return { number: number(value) };
    }
    function record(stage, data = {}) {
        if (!live()) return;
        const now = Date.now(), nextBucket = Math.floor(now / 1000);
        if (bucket !== nextBucket) { bucket = nextBucket; inBucket = 0; }
        if (++inBucket > 100) { dropped++; return; }
        rows.push({ seq: ++sequence, at: now, stage, message: index, objectId: id(current), data });
        if (rows.length > 500) { rows.shift(); dropped++; }
    }
    function restore(slot) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(slot.target, slot.key);
            if (descriptor?.get === slot.get && descriptor?.set === slot.set && descriptor.configurable) {
                Object.defineProperty(slot.target, slot.key, { ...slot.original, value: slot.value });
            }
        } catch { /* A foreign proxy may have been revoked while recording. */ }
    }
    function detach() { for (const slot of slots.values()) restore(slot); slots.clear(); }
    function belongs() {
        const raw = host.raw();
        return live() && raw.chatMetadata === metadata && (raw.getCurrentChatId?.() ?? raw.chatId) === chatId
            && raw.chat?.[index] === current;
    }
    function install(target, key, field) {
        const old = slots.get(field), descriptor = target && Object.getOwnPropertyDescriptor(target, key);
        if (old && old.target === target && descriptor?.get === old.get && descriptor?.set === old.set) return;
        if (old) { restore(old); slots.delete(field); record('watch_replaced', { field, writerLocated: false }); }
        // Missing properties and foreign accessors are never manufactured/replaced.
        if (!descriptor?.configurable || !descriptor.writable || !Object.hasOwn(descriptor, 'value')) return;
        const slot = { target, key, field, original: descriptor, value: descriptor.value };
        slot.get = function () { return slot.value; };
        slot.set = function (value) {
            if (this !== target) { Object.defineProperty(this, key, { value, writable: true, configurable: true, enumerable: true }); return; }
            const before = slot.value; slot.value = value;
            if (writing || before === value) return;
            writing = true;
            try {
                if (!belongs() || field.startsWith('extra.') && current.extra !== target) return;
                const writeTrace = diagnosticWriteTrace(new Error().stack);
                record('field_write', { field, before: valueInfo(field, before), after: valueInfo(field, value),
                    writerLocated: writeTrace[0]?.source === 'client_script', writeTrace });
                if (field === 'extra') installExtra();
            } catch { /* Diagnostics must not reject the original assignment. */ }
            finally { writing = false; }
        };
        try {
            Object.defineProperty(target, key, { configurable: true, enumerable: descriptor.enumerable, get: slot.get, set: slot.set });
            slots.set(field, slot);
        } catch { record('watch_unavailable', { field }); }
    }
    function installExtra() {
        for (const key of EXTRA_FIELDS) install(current?.extra, key, `extra.${key}`);
    }
    function snapshot() {
        if (!current) return null;
        return { mes: textInfo(current.mes), ...Object.fromEntries(FIELDS.map(key => [key, valueInfo(key, current[key])])),
            extraObjectId: id(current.extra), ...Object.fromEntries(EXTRA_FIELDS.map(key => [`extra.${key}`, valueInfo(`extra.${key}`, current.extra?.[key])])) };
    }
    function sampleData() {
        const value = snapshot();
        if (lastData && !equal(value, lastData)) record('data_observed_change', {
            fields: Object.keys(value).filter(key => !equal(value[key], lastData[key])), before: lastData, after: value,
            writerLocated: false,
        });
        lastData = value;
    }
    function sampleDom() {
        try {
            if (!belongs()) return;
            const element = globalThis.document?.querySelector?.(`#chat .mes[mesid="${index}"]`);
            const info = selector => {
                const text = element?.querySelector(selector)?.textContent;
                const numeric = typeof text === 'string' && text.match(/^\s*(\d+(?:\.\d+)?)\s*([st])\s*$/);
                return (selector === '.mes_timer' || selector === '.tokenCounterDisplay') && numeric
                    ? { number: Number(numeric[1]), unit: numeric[2] } : textInfo(text);
            };
            const value = element ? { elementId: id(element), timer: info('.mes_timer'), tokens: info('.tokenCounterDisplay'),
                timestamp: info('.timestamp'), body: info('.mes_text'), swipe: textInfo(element.getAttribute('swipeid')) } : { present: false };
            if (lastDom && !equal(value, lastDom)) record('display_observed_change', {
                before: lastDom, after: value, data: snapshot(), writerLocated: false,
            });
            lastDom = value;
        } catch { /* DOM can be detached while sampling. */ }
    }
    function listenDom() {
        const nextRoot = globalThis.document?.querySelector?.('#chat');
        if (root === nextRoot) return;
        observer?.disconnect(); observer = null; root = nextRoot;
        if (root && typeof globalThis.MutationObserver === 'function') {
            observer = new MutationObserver(sampleDom);
            observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['mesid', 'swipeid'] });
        }
    }
    function onError(event) {
        try {
            if (!live()) return;
            const error = event.type === 'unhandledrejection' ? event.reason : event.error;
            let writeTrace = diagnosticWriteTrace(typeof error?.stack === 'string' ? error.stack : '', 0);
            if (!writeTrace.length && typeof event.filename === 'string') {
                writeTrace = diagnosticWriteTrace(`${event.filename}:${Number(event.lineno) || 1}:${Number(event.colno) || 1}`, 0);
            }
            record('uncaught_error', { kind: event.type === 'unhandledrejection' ? 'unhandledrejection' : 'error',
                name: ERROR_NAMES.has(error?.name) ? error.name : 'UnknownError', writeTrace,
                writerLocated: writeTrace[0]?.source === 'client_script' });
        } catch { /* Never interfere with normal browser error reporting. */ }
    }
    function start() {
        started = true;
        globalThis.addEventListener?.('error', onError); globalThis.addEventListener?.('unhandledrejection', onError);
        record('recording_started');
    }
    function stop() {
        detach(); observer?.disconnect(); observer = null; root = null;
        globalThis.removeEventListener?.('error', onError); globalThis.removeEventListener?.('unhandledrejection', onError);
        started = false; current = null; metadata = null; chatId = null; index = -1; lastData = lastDom = null;
    }
    function sync() {
        try {
            if (!live()) { if (started) stop(); return; }
            if (!started) start();
            const raw = host.raw(), nextId = raw.getCurrentChatId?.() ?? raw.chatId;
            let nextIndex = (raw.chat?.length ?? 0) - 1;
            while (nextIndex >= 0 && (!raw.chat[nextIndex] || raw.chat[nextIndex].is_user || raw.chat[nextIndex].is_system)) nextIndex--;
            const message = raw.chat?.[nextIndex] ?? null;
            if (message !== current || raw.chatMetadata !== metadata || nextId !== chatId || nextIndex !== index) {
                const replacement = current && message && nextIndex === index && raw.chatMetadata === metadata && nextId === chatId;
                const previousId = id(current); detach();
                current = message; metadata = raw.chatMetadata; chatId = nextId; index = nextIndex;
                lastData = lastDom = null;
                record(replacement ? 'message_object_replaced' : 'target_changed', { previousId, writerLocated: false });
            }
            if (current) {
                for (const key of FIELDS) install(current, key, key);
                install(current, 'extra', 'extra'); installExtra();
                sampleData();
            }
            listenDom(); sampleDom();
        } catch { /* Best-effort diagnostics cannot stop scene processing. */ }
    }
    function event(name) {
        sync();
        if (live() && /^(GENERATION_|MESSAGE_|CHARACTER_MESSAGE_RENDERED|CHAT_CHANGED)/.test(name)) {
            record('host_event', { name }); sampleData(); sampleDom();
        }
    }
    function clear() { rows.length = 0; dropped = 0; sequence = 0; bucket = inBucket = 0; textIds.clear(); nextTextId = 1; lastData = lastDom = null; }
    function report() {
        const loadedScripts = [];
        if (live()) for (const script of Array.from(globalThis.document?.scripts ?? [])) {
            try {
                const url = new URL(script.src, globalThis.location?.href);
                if (url.origin === globalThis.location?.origin && diagnosticSafeScript(url.pathname)) loadedScripts.push(url.pathname);
            } catch { /* Ignore inline/unrecognized scripts. */ }
            if (loadedScripts.length >= 128) break;
        }
        const observedWriters = {};
        for (const row of rows) {
            if (row.stage !== 'field_write') continue;
            const direct = row.data.writeTrace?.[0];
            const path = direct?.source === 'client_script' ? direct.script : 'unknown';
            observedWriters[path] = (observedWriters[path] ?? 0) + 1;
        }
        return { recording: live(), note: CONFLICT_NOTE, limit: 500, dropped, observedWriters,
            loadedScripts: [...new Set(loadedScripts)], events: structuredClone(rows) };
    }
    return { sync, event, stop, clear, report };
}
