import { diagnosticSafeScript, diagnosticWriteTrace } from './diagnostics.js';
import { createDiagnosticHooks } from './diagnostic-hooks.js';
const define = Object.defineProperty;

export const CONFLICT_NOTE = 'Write traces identify synchronous callers, not proven root causes. Watched chat-slot replacements and hooked DOM/descriptor operations retain caller stacks. Async parents cover timers, animation frames, microtasks and synchronous event dispatch while recording; native await continuations and previously registered callbacks may have no parent. Poll-only observations remain unattributed. Saved native references, direct delete, whole chat-array replacement, other realms/devices, changes before recording and silently handled errors can bypass hooks. Loaded scripts are not an enabled-extension inventory. Only the latest assistant reply is watched. No dialogue, translation, prompts, error messages, request bodies, keys, or full URLs are exported. Records stay in page memory and disappear on reload.';
const FIELDS = ['send_date', 'gen_started', 'gen_finished', 'swipe_id'];
const EXTRA_FIELDS = ['token_count', 'display_text', 'reasoning_duration', 'time_to_first_token'];
const ERROR_NAMES = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createConflictDiagnostics(host) {
    const rows = [], slots = new Map(), identities = new WeakMap(), textIds = new Map();
    let nextIdentity = 1, nextTextId = 1, current = null, metadata = null, chatId = null, index = -1, watchedChat = null;
    let lastData = null, lastDom = null, started = false, writing = false, observer = null, root = null;
    let dropped = 0, bucket = 0, inBucket = 0, sequence = 0;
    const salt = Math.random().toString(36);
    const live = () => host.ready() && host.enabled();
    const hooks = createDiagnosticHooks({ live, raw: host.raw, domRelevant, domSnapshot,
        arrayRelevant: target => target === watchedChat,
        arrayOperation: (operation, beforeLength, afterLength, writeTrace, asyncParents) => {
            record('chat_array_operation', { operation, beforeLength, afterLength, writeTrace, asyncParents,
                writerLocated: writeTrace[0]?.source === 'client_script' });
            sync();
        },
        domOperation: (operation, before, writeTrace, asyncParents) => {
            const after = domSnapshot();
            if (!before || !after || equal(before, after)) return;
            record('dom_write', { operation, before, after, data: snapshot(), writeTrace, asyncParents,
                writerLocated: writeTrace[0]?.source === 'client_script' });
            lastDom = after;
        },
        targetFields: target => {
            if (target !== watchedChat && target !== current && target !== current?.extra) return [];
            if (!belongs()) return [];
            if (target === host.raw().chat) return [String(index)];
            if (target === current) return [...FIELDS, 'extra', 'mes'];
            if (target === current?.extra) return EXTRA_FIELDS;
            return [];
        },
        descriptorOperation: (operation, target, fields, writeTrace, asyncParents) => {
            record('descriptor_write', { operation, target: target === host.raw().chat ? 'chat_slot' : target === current ? 'message' : 'extra',
                fields, writeTrace, asyncParents, writerLocated: writeTrace[0]?.source === 'client_script' });
            sync();
        },
        eventOperation: (name, writeTrace, asyncParents) => record('event_dispatch', { name, writeTrace, asyncParents }),
        consoleOperation: (kind, writeTrace, asyncParents, errorTrace) => record('console_report', { kind, writeTrace, asyncParents, errorTrace }),
    });
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
        if (field === 'extra' || field === 'chat_slot') return { objectId: id(value) };
        return { number: number(value) };
    }
    function record(stage, data = {}) {
        if (!live()) return;
        const now = Date.now(), nextBucket = Math.floor(now / 1000);
        if (bucket !== nextBucket) { bucket = nextBucket; inBucket = 0; }
        if (++inBucket > 100) { dropped++; return; }
        rows.push({ seq: ++sequence, at: now, stage, message: index, objectId: id(current), data: { ...data,
            ...(data.writeTrace && !data.asyncParents ? { asyncParents: hooks.parents() } : {}) } });
        if (rows.length > 500) { rows.shift(); dropped++; }
    }
    function restore(slot) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(slot.target, slot.key);
            if (descriptor?.get === slot.get && descriptor?.set === slot.set && descriptor.configurable) {
                define(slot.target, slot.key, { ...slot.original, value: slot.value });
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
            if (this !== target) { define(this, key, { value, writable: true, configurable: true, enumerable: true }); return; }
            let slotBelongs = false;
            if (field === 'chat_slot') try { slotBelongs = belongs(); } catch { /* Preserve assignment. */ }
            const before = slot.value; slot.value = value;
            if (writing || before === value) return;
            writing = true;
            try {
                if (field === 'chat_slot' ? !slotBelongs : !belongs() || field.startsWith('extra.') && current.extra !== target) return;
                const writeTrace = diagnosticWriteTrace(new Error().stack);
                record(field === 'chat_slot' ? 'message_slot_write' : 'field_write', { field, before: valueInfo(field, before), after: valueInfo(field, value),
                    writerLocated: writeTrace[0]?.source === 'client_script', writeTrace });
                if (field === 'extra') installExtra();
                if (field === 'chat_slot') sync();
            } catch { /* Diagnostics must not reject the original assignment. */ }
            finally { writing = false; }
        };
        try {
            define(target, key, { configurable: true, enumerable: descriptor.enumerable, get: slot.get, set: slot.set });
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
    function domRelevant(node) {
        if (!belongs()) return false;
        const chatRoot = globalThis.document?.querySelector?.('#chat');
        const target = node?.commonAncestorContainer ?? node;
        return Boolean(chatRoot && target && (target === chatRoot || chatRoot.contains?.(target) || target.contains?.(chatRoot)));
    }
    function domSnapshot() {
        try {
            if (!belongs()) return null;
            const element = globalThis.document?.querySelector?.(`#chat .mes[mesid="${index}"]`);
            const info = selector => {
                const text = element?.querySelector(selector)?.textContent;
                const numeric = typeof text === 'string' && text.match(/^\s*(\d+(?:\.\d+)?)\s*([st])\s*$/);
                return (selector === '.mes_timer' || selector === '.tokenCounterDisplay') && numeric
                    ? { number: Number(numeric[1]), unit: numeric[2] } : textInfo(text);
            };
            return element ? { elementId: id(element), timer: info('.mes_timer'), tokens: info('.tokenCounterDisplay'),
                timestamp: info('.timestamp'), body: info('.mes_text'), markup: textInfo(element.innerHTML),
                swipe: textInfo(element.getAttribute('swipeid')) } : { present: false };
        } catch { return null; }
    }
    function sampleDom() {
        try {
            const value = domSnapshot();
            if (!value) return;
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
        hooks.start();
        globalThis.addEventListener?.('error', onError); globalThis.addEventListener?.('unhandledrejection', onError);
        record('recording_started');
    }
    function stop() {
        hooks.stop();
        detach(); observer?.disconnect(); observer = null; root = null;
        globalThis.removeEventListener?.('error', onError); globalThis.removeEventListener?.('unhandledrejection', onError);
        started = false; current = null; metadata = null; chatId = null; index = -1; watchedChat = null; lastData = lastDom = null;
    }
    function sync() {
        try {
            if (!live()) { if (started) stop(); return; }
            if (!started) start();
            const raw = host.raw(), nextId = raw.getCurrentChatId?.() ?? raw.chatId;
            if (watchedChat && watchedChat !== raw.chat) record('chat_array_replaced', {
                beforeObjectId: id(watchedChat), afterObjectId: id(raw.chat), writerLocated: false,
            });
            watchedChat = raw.chat;
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
                install(raw.chat, String(index), 'chat_slot');
                for (const key of FIELDS) install(current, key, key);
                install(current, 'extra', 'extra'); installExtra();
                sampleData();
            }
            listenDom(); sampleDom();
            host.onTarget?.();
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
            if (!['field_write', 'message_slot_write', 'descriptor_write', 'dom_write', 'body_write'].includes(row.stage)) continue;
            const direct = row.data.writeTrace?.[0];
            const path = direct?.source === 'client_script' ? direct.script : 'unknown';
            observedWriters[path] = (observedWriters[path] ?? 0) + 1;
        }
        return { recording: live(), note: CONFLICT_NOTE, limit: 500, dropped, observedWriters, hooks: hooks.status(),
            loadedScripts: [...new Set(loadedScripts)], events: structuredClone(rows) };
    }
    function bodyEvent(stage, message, data) {
        if (stage === 'body_write' && message === current && belongs()) record(stage, data);
    }
    return { sync, event, stop, clear, report, bodyEvent };
}
