// Shared, opt-in body-write diagnostics for the single scene core.
export const DIAGNOSTIC_NOTE = 'body_write observes assignments to watched message fields, not the origin of computed text. writeTrace contains only same-origin client script paths and line/column numbers, never full URLs or raw stacks. Unknown frames and writes before observation or via object/descriptor replacement are unconfirmed. Change counts describe one enclosing difference range. No raw dialogue is exported.';
export function sanitizeWriteTrace(value) {
    return Array.isArray(value) ? value.slice(0, 6).map(frame =>
        frame?.source === 'client_script' && diagnosticSafeScript(frame.script)
            && Number.isSafeInteger(frame.line) && frame.line > 0 && Number.isSafeInteger(frame.column) && frame.column > 0
            ? { source: 'client_script', script: frame.script, line: frame.line, column: frame.column }
            : { source: 'unknown' }) : [];
}

export function createBodyDiagnostics(host) {
    const watches = new Map();
    let ownWrite = null, writing = false;
    const chatId = () => host.raw().getCurrentChatId?.() ?? host.raw().chatId;
    const live = () => host.ready() && host.enabled();
    const sameTarget = (message, entry) => entry.metadata === host.raw().chatMetadata && entry.chatId === chatId()
        && host.raw().chat?.includes(message) && !message.is_user && !message.is_system;
    function unwatch(message) {
        const entry = watches.get(message);
        if (!entry) return;
        const descriptor = Object.getOwnPropertyDescriptor(message, 'mes');
        // Leave any subsequently installed foreign descriptor alone.
        if (descriptor?.get === entry.get && descriptor?.set === entry.set && descriptor.configurable)
            Object.defineProperty(message, 'mes', { ...entry.original, value: entry.value });
        watches.delete(message);
    }
    function reset() { for (const message of watches.keys()) unwatch(message); }
    function sync() {
        if (!live()) { reset(); return; }
        for (const [message, entry] of watches) if (!sameTarget(message, entry)) unwatch(message);
    }
    function watch(message) {
        sync();
        if (!live() || !message || message.is_user || message.is_system || !host.raw().chat?.includes(message)) return;
        const current = watches.get(message), descriptor = Object.getOwnPropertyDescriptor(message, 'mes');
        if (current && descriptor?.get === current.get && descriptor?.set === current.set) {
            current.swipe = host.swipe(message); return;
        }
        if (current) watches.delete(message);
        const skip = reason => host.record('body_write_trace_unavailable', message, { reason });
        if (!descriptor?.configurable || !descriptor.writable || typeof descriptor.value !== 'string') { skip('unsupported_descriptor'); return; }
        if (descriptor.value.length > 65536) { skip('size_limit'); return; }
        const entry = { original: descriptor, value: descriptor.value, metadata: host.raw().chatMetadata, chatId: chatId(), swipe: host.swipe(message) };
        entry.get = function () { return entry.value; };
        entry.set = function (value) {
            if (this !== message) { Object.defineProperty(this, 'mes', { value, writable: true, configurable: true, enumerable: true }); return; }
            const old = entry.value;
            entry.value = value;
            if (writing || old === value) return;
            writing = true;
            try {
                if (!live() || !sameTarget(message, entry)) { unwatch(message); return; }
                if (entry.swipe !== host.swipe(message)) { skip('swipe_changed'); unwatch(message); return; }
                if (typeof old !== 'string' || typeof value !== 'string' || Math.max(old.length, value.length) > 65536) {
                    skip('size_or_type_limit'); unwatch(message); return;
                }
                const writeTrace = diagnosticWriteTrace(new Error().stack);
                host.record('body_write', message, { ownWrite: ownWrite === message, writerLocated: writeTrace[0]?.source === 'client_script',
                    writeTrace, ...diagnosticBodyDiff(old, value, host.body) });
            } catch { /* Never reject an otherwise successful write for diagnostics. */ }
            finally { writing = false; }
        };
        try {
            Object.defineProperty(message, 'mes', { configurable: true, enumerable: descriptor.enumerable, get: entry.get, set: entry.set });
            watches.set(message, entry);
            if (watches.size > 12) unwatch(watches.keys().next().value);
            host.record('body_write_trace_started', message, {});
        } catch { skip('unsupported_descriptor'); }
    }
    function write(message, text) {
        const previous = ownWrite; ownWrite = message;
        try { message.mes = text; } finally { ownWrite = previous; }
    }
    return { watch, write, reset, sync };
}
export function diagnosticStage(state, prefix = 'reported') {
    const value = state?.stage;
    const present = value !== null && value !== undefined && Number.isFinite(Number(value));
    return { [`${prefix}StagePresent`]: present, ...(present ? { [`${prefix}Stage`]: Number(value) } : {}) };
}

export function diagnosticBodyDiff(old, text, recordBody) {
    let start = 0, endOld = old.length, endNew = text.length;
    while (start < Math.min(endOld, endNew) && old[start] === text[start]) start++;
    while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) { endOld--; endNew--; }
    const withoutSpace = s => s.replace(/\s/g, '');
    const withoutMarkup = s => withoutSpace(s.replace(/<[^>]*>/g, '').replace(/[*_`]/g, ''));
    const counts = (part, prefix) => ({
        [`${prefix}Letters`]: (part.match(/\p{L}/gu) ?? []).length,
        [`${prefix}Digits`]: (part.match(/\p{N}/gu) ?? []).length,
        [`${prefix}Whitespace`]: (part.match(/\s/gu) ?? []).length,
        [`${prefix}Punctuation`]: (part.match(/\p{P}/gu) ?? []).length,
    });
    return {
        beforeChars: old.length, afterChars: text.length, changeStart: start,
        removedChars: endOld - start, addedChars: endNew - start,
        ...counts(old.slice(start, endOld), 'removed'), ...counts(text.slice(start, endNew), 'added'),
        sameSceneBody: recordBody(old) === recordBody(text),
        whitespaceOnly: withoutSpace(old) === withoutSpace(text),
        markupOnly: withoutMarkup(old) === withoutMarkup(text),
        oldOpenTag: /<scene_state\b/i.test(old), newOpenTag: /<scene_state\b/i.test(text),
    };
}

export function diagnosticSafeScript(path) {
    return typeof path === 'string' && path.length <= 200
        && /^(?:\/script\.js|\/scripts\/(?:[a-zA-Z0-9_-]{1,64}\/){0,8}[a-zA-Z0-9_.-]{1,64}\.m?js)$/.test(path);
}

export function diagnosticWriteTrace(stack) {
    const lines = String(stack ?? '').split('\n').filter(line => line.trim() && line.trim() !== 'Error');
    // The first frame is our setter. Keep the immediate caller even if unknown;
    // a recognized later frame must never be mistaken for the direct writer.
    return lines.slice(1, 7).map(line => {
        const match = line.match(/(https?:\/\/[^\s()]+):(\d+):(\d+)\)?\s*$/);
        if (!match) return { source: 'unknown' };
        try {
            const url = new URL(match[1]);
            if (url.origin !== globalThis.location?.origin || !diagnosticSafeScript(url.pathname)) return { source: 'unknown' };
            return { source: 'client_script', script: url.pathname, line: Number(match[2]), column: Number(match[3]) };
        } catch { return { source: 'unknown' }; }
    });
}
