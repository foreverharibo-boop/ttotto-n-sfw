import { diagnosticWriteTrace } from './diagnostics.js';
const define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
const ERROR_NAMES = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'AbortError', 'TimeoutError']);
const FIELDS = new Set(('schemaVersion engines nsfw sfw enabled adultConfirmed developerMode settingsSchemaVersion transitionNotifications featurePreset repeatGuard dialogueBeatGuard dialogueFlow transitionGuard dialogueWindow cardLinkEnabled cardLinkSelected armMode stealthSensitivity stealthKeywords nextBeatHints repeatWindow maxBannedActs paceMode slowBurnEnabled slowBurnIntensity slowBurnUserOverride globalBans styleLength styleBalance exitBridge autoRefine diagnosticsEnabled refineProfileId refineVertexAuthMode refineMaxTokens refineContextMessages manualState state at source target message index swipe swipeIndex swipes signatureVersion messageSignature characters location time environment importantObjects important_objects appearance clothing position holding condition contact acts dialogueBeats dialogue_beats dialogueFlow dialogue_flow topic lastQuestion last_question newFacts new_facts sceneType scene_type intensity heat stage next slowBurnStageOverride slowBurnLocked slowBurnTarget slowBurnTargetTurns slowBurnSessionStart slowBurnSessionStartedAt slowBurnSessionStartCount slowBurnSessionActive slowBurnSessionStartAssistantCount slowBurnRecoveryPending slowBurnTurnSession legacyRebased customBans ignoredActs autoArmed forceArmed armSource bridgePending nsfwSuspended nsfwResumePending pendingGenerations rewriteMode mode phase generationEvents refineRunning refineTimer queuedRefineTarget lastAutoRefineTarget activeRefineTarget refineFailure refineAbortController runtimeActive uiReady').split(' '));
const NUMBERS = new Set(('schemaVersion settingsSchemaVersion dialogueWindow repeatWindow maxBannedActs refineMaxTokens refineContextMessages intensity heat stage at index message swipe swipeIndex signatureVersion slowBurnStageOverride slowBurnTargetTurns slowBurnSessionStartCount slowBurnSessionStartAssistantCount pendingGenerations').split(' '));
const DICTIONARIES = new Set(['characters', 'importantObjects', 'important_objects', 'cardLinkSelected', 'swipes']);
const SECRET = /(?:api.?key|secret|password|credential|authorization|cookie|access.?token|refresh.?token)/i;
const REASONS = new Set('mode_or_generation_guard chat_not_ready disabled_or_busy automatic_off main_generation_pending other_mode no_assistant target_pending cancelled_or_disabled target_changed record_changed saved aborted failed disabled automatic_not_needed busy adult_unconfirmed same_automatic_target target_changed_or_disabled'.split(' '));
const ENUMS = {
    armMode: ['always', 'stealth', 'auto', 'manual'], paceMode: ['auto', 'hold', 'slow', 'push'],
    featurePreset: ['continuity', 'basic', 'narrative', 'slowburn', 'custom'],
    stealthSensitivity: ['high', 'normal', 'low'], slowBurnIntensity: ['gentle', 'slow', 'verySlow'],
    styleLength: ['tight', 'normal', 'long'], styleBalance: ['dialogue', 'balanced', 'sensory', 'internal'],
    refineVertexAuthMode: ['profile', 'express', 'full'], armSource: ['heat', 'local', 'manual'],
};
const NOTE = 'Owned settings, chat metadata, recent scene records and engine checkpoints only. Text and dynamic field names are opaque local IDs; secrets are omitted. Direct watched writes have stacks; sampled changes do not prove a writer. Readonly/accessor/oversize/deep fields and old history have explicit coverage limits. Operation IDs link instrumented await paths, not arbitrary promises. Save scheduling/host return is not disk durability. No server-terminal access or cross-device locking. Memory-only; export before reload.';

export function createInternalDiagnostics(host) {
    const rows = [], watches = new Map(), objects = new WeakMap(), opaqueIds = new Map(), signals = new WeakMap(), tasks = new Map(), aborts = new Map();
    let nextObject = 1, nextOpaque = 1, nextTask = 1, sequence = 0, epoch = 1, dropped = 0;
    let active = false, sampling = false, stopped = false, listening = false, bucket = 0, inBucket = 0, lastPoll = 0;
    let previous = {}, coverage = {}, scope = null;
    const salt = Math.random().toString(36), sessionId = Math.random().toString(36).slice(2, 14);
    const safely = fn => { try { return fn(); } catch { return undefined; } };
    const live = () => !stopped && Boolean(safely(host.live));
    const objectId = value => {
        if (!value || typeof value !== 'object') return 0;
        if (!objects.has(value)) objects.set(value, nextObject++);
        return objects.get(value);
    };
    function opaque(value) {
        if (value.length > 65536) return { chars: value.length, limited: true };
        let a = 2166136261, b = 5381;
        for (const char of salt + value) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); }
        const hash = `${value.length}:${a >>> 0}:${b >>> 0}`;
        if (!opaqueIds.has(hash)) {
            if (opaqueIds.size >= 4096) opaqueIds.delete(opaqueIds.keys().next().value);
            opaqueIds.set(hash, nextOpaque++);
        }
        return { chars: value.length, valueId: opaqueIds.get(hash) };
    }
    function summary(value, key = '') {
        if (SECRET.test(key)) return { redacted: true, present: value != null && value !== '' };
        if (value === null) return { type: 'null' };
        if (typeof value === 'string') return Object.hasOwn(ENUMS, key) && ENUMS[key].includes(value) ? { type: 'enum', value } : { type: 'string', ...opaque(value) };
        if (typeof value === 'boolean') return { type: 'boolean', value };
        if (typeof value === 'number') return NUMBERS.has(key) && Number.isFinite(value)
            ? { type: 'number', value } : { type: 'number', ...opaque(String(value)) };
        if (typeof value === 'object') return { type: Array.isArray(value) ? 'array' : 'object', objectId: objectId(value), ...(Array.isArray(value) ? { length: value.length } : {}) };
        return { type: typeof value };
    }
    function record(stage, data) {
        if (!live()) return;
        const now = Date.now(), nextBucket = Math.floor(now / 1000);
        if (bucket !== nextBucket) { bucket = nextBucket; inBucket = 0; }
        if (++inBucket > 120) { dropped++; return; }
        rows.push({ seq: ++sequence, at: now, stage, data });
        if (rows.length > 600) { rows.shift(); dropped++; }
    }
    function restore(slot) {
        safely(() => {
            const current = descriptor(slot.target, slot.key);
            if (current?.get === slot.get && current?.set === slot.set && current.configurable)
                define(slot.target, slot.key, { ...slot.original, value: slot.value });
        });
    }
    function detach() { for (const slot of watches.values()) restore(slot); watches.clear(); }
    function watch(target, key, path, own, wanted) {
        const identity = `${objectId(target)}:${key}`, old = watches.get(identity);
        if (old && own?.get === old.get && own?.set === old.set) { old.path = path; wanted.add(identity); return old.value; }
        if (old) { watches.delete(identity); record('state_watch_replaced', { path }); }
        if (!own || !Object.hasOwn(own, 'value')) { coverage.accessors++; return undefined; }
        if (!own.configurable || !own.writable || SECRET.test(key) || typeof own.value === 'function') { coverage.unwatched++; return own.value; }
        if (wanted.size >= 600) { coverage.watchLimit++; return own.value; }
        const slot = { target, key, path, original: own, value: own.value };
        slot.get = function () { return slot.value; };
        slot.set = function (value) {
            if (this !== target) { define(this, key, { value, writable: true, configurable: true, enumerable: true }); return; }
            const before = slot.value; slot.value = value;
            if (Object.is(before, value) || sampling || !live()) return;
            const writeTrace = diagnosticWriteTrace(new Error().stack);
            safely(() => {
                // Detached chat objects must not be attributed to the current conversation.
                if (host.scope() !== scope) return;
                record('owned_state_write', { path: slot.path, before: summary(before, key), after: summary(value, key), writeTrace,
                    writerLocated: writeTrace[0]?.source === 'client_script' });
                if (before && typeof before === 'object' || value && typeof value === 'object') sample('write');
                else previous[slot.path] = summary(value, key);
            });
        };
        try {
            define(target, key, { configurable: true, enumerable: own.enumerable, get: slot.get, set: slot.set });
            watches.set(identity, slot); wanted.add(identity);
        } catch { coverage.unwatched++; }
        return own.value;
    }
    function sample(reason = 'poll') {
        if (sampling) return;
        if (!live()) { if (active) pause(); return; }
        sampling = true;
        try {
            if (!active) { active = true; listen(); record('recording_started', { sessionId }); }
            const currentScope = host.scope();
            if (scope !== currentScope) { detach(); previous = {}; scope = currentScope; record('scope_changed', { scopeId: objectId(scope) }); }
            if (reason === 'poll' && lastPoll && Date.now() - lastPoll > 5000) record('observer_gap', { elapsedMs: Date.now() - lastPoll });
            if (reason === 'poll') lastPoll = Date.now();
            const next = {}, wanted = new Set(), seen = new WeakSet();
            coverage = { nodes: 0, chars: 0, accessors: 0, unwatched: 0, watchLimit: 0, depthLimit: 0, nodeLimit: 0, textLimit: 0, keyLimit: 0 };
            function visit(value, path, key, depth) {
                if (++coverage.nodes > 1600) { coverage.nodeLimit++; return; }
                if (SECRET.test(key)) { next[path] = summary(value, key); return; }
                if (typeof value === 'string') {
                    coverage.chars += Math.min(value.length, 65536);
                    if (coverage.chars > 200000) { next[path] = { type: 'string', chars: value.length, limited: true }; coverage.textLimit++; return; }
                }
                next[path] = summary(value, key);
                if (!value || typeof value !== 'object' || SECRET.test(key)) return;
                if (seen.has(value)) return;
                seen.add(value);
                if (depth >= 10) { coverage.depthLimit++; return; }
                const keys = Object.keys(value);
                for (const child of keys.slice(0, 400)) {
                    if (coverage.nodes >= 1600) { coverage.nodeLimit++; break; }
                    if (child.length > 256) { coverage.keyLimit++; continue; }
                    const label = !DICTIONARIES.has(key) && (FIELDS.has(child) || Array.isArray(value) && /^\d{1,6}$/.test(child))
                        ? child : `field_${opaque(child).valueId ?? 'oversize'}`;
                    const childPath = `${path}.${label}`, own = descriptor(value, child);
                    const item = watch(value, child, childPath, own, wanted);
                    if (own && !Object.hasOwn(own, 'value') && !watches.has(`${objectId(value)}:${child}`)) {
                        next[childPath] = { accessor: true }; continue;
                    }
                    visit(item, childPath, child, depth + 1);
                }
                if (keys.length > 400) coverage.nodeLimit += keys.length - 400;
            }
            const roots = host.roots();
            for (const [name, value] of Object.entries(roots)) visit(value, name, name, 0);
            for (const [kind, flags] of Object.entries(host.flags?.() ?? {})) {
                if (!['sfw', 'nsfw'].includes(kind)) continue;
                for (const [key, value] of Object.entries(flags)) if (FIELDS.has(key) || key === 'aborted') next[`engine_${kind}.${key}`] = summary(value, key);
            }
            for (const [identity, slot] of watches) if (!wanted.has(identity)) { restore(slot); watches.delete(identity); }
            const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(path => JSON.stringify(previous[path]) !== JSON.stringify(next[path]));
            if (changed.length) record(Object.keys(previous).length ? 'owned_state_changed' : 'owned_state_baseline', {
                reason, changes: changed.slice(0, 80).map(path => ({ path, before: previous[path], after: next[path] })), omitted: Math.max(0, changed.length - 80),
                writerLocated: false,
            });
            previous = next;
        } catch (error) { record('sampling_unavailable', errorInfo(error)); }
        finally { sampling = false; }
    }
    function errorInfo(error) {
        return safely(() => ({ name: ERROR_NAMES.has(error?.name) ? error.name : 'UnknownError',
            ...(Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? { status: error.status } : {}),
            writeTrace: diagnosticWriteTrace(typeof error?.stack === 'string' ? error.stack : '', 0) })) ?? { name: 'UnknownError' };
    }
    function begin(kind, name, parent = null) {
        if (!live()) return null;
        sample('operation');
        const task = { id: nextTask++, epoch, kind, name, started: Date.now(), scopeId: objectId(scope), parent: parent?.id ?? null,
            callTrace: diagnosticWriteTrace(new Error().stack, 0) };
        if (tasks.size >= 128) { record('operation_capacity', { pending: tasks.size }); return null; }
        tasks.set(task.id, task); record('operation_started', { ...task }); return task;
    }
    function checkpoint(task, stage, data = {}) {
        if (!task || task.epoch !== epoch || !live()) return;
        // Only fixed labels and numeric/boolean structure supplied by adapters are allowed.
        const safe = {};
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
            else if (key === 'reason' && REASONS.has(value)) safe[key] = value;
        }
        record('operation_checkpoint', { id: task.id, stage, ...safe }); sample('checkpoint');
    }
    function fail(task, error) { if (task && task.epoch === epoch) { task.failed = true; record('operation_error', { id: task.id, ...errorInfo(error) }); } }
    function caught(task, error) { if (task && task.epoch === epoch) record('operation_caught_error', { id: task.id, ...errorInfo(error) }); }
    function observePromise(task, result) {
        // Used only at owned save calls. The caller keeps handling rejection as before.
        if (!task || task.epoch !== epoch || !(result instanceof Promise)) return result;
        return Promise.prototype.then.call(result, value => {
            checkpoint(task, 'save_promise_resolved'); return value;
        }, error => { caught(task, error); throw error; });
    }
    function end(task) {
        if (!task || task.epoch !== epoch) return;
        tasks.delete(task.id);
        const abort = aborts.get(task.id);
        if (abort) { abort.signal.removeEventListener('abort', abort.listener); aborts.delete(task.id); }
        record('operation_finished', { id: task.id, failed: Boolean(task.failed), elapsedMs: Date.now() - task.started,
            scopeChanged: task.scopeId !== objectId(safely(host.scope)) });
        sample('operation');
    }
    function lifecycle(event) {
        record('page_lifecycle', { event: event.type, hidden: Boolean(globalThis.document?.hidden),
            online: globalThis.navigator?.onLine !== false, persisted: Boolean(event.persisted) });
    }
    function listen() {
        if (listening) return;
        listening = true;
        for (const name of ['pagehide', 'pageshow', 'online', 'offline', 'focus', 'blur']) globalThis.addEventListener?.(name, lifecycle);
        globalThis.document?.addEventListener?.('visibilitychange', lifecycle);
    }
    function resume() { stopped = false; sample('resume'); }
    function releaseTasks() {
        for (const { signal, listener } of aborts.values()) safely(() => signal.removeEventListener('abort', listener));
        aborts.clear(); epoch++; tasks.clear();
    }
    function pause() {
        detach(); active = false; lastPoll = 0; scope = null; releaseTasks();
        for (const name of ['pagehide', 'pageshow', 'online', 'offline', 'focus', 'blur']) globalThis.removeEventListener?.(name, lifecycle);
        globalThis.document?.removeEventListener?.('visibilitychange', lifecycle);
        listening = false;
    }
    function stop() { stopped = true; pause(); }
    function clear() { rows.length = 0; dropped = sequence = bucket = inBucket = 0; releaseTasks(); previous = {}; }
    return { sample, resume, stop, clear, begin, end, fail, caught, checkpoint, observePromise,
        bind: (signal, task) => {
            if (!signal || !task || task.epoch !== epoch) return;
            signals.set(signal, task);
            const listener = () => checkpoint(task, 'abort_requested');
            if (!aborts.has(task.id)) { signal.addEventListener('abort', listener, { once: true }); aborts.set(task.id, { signal, listener }); }
            if (signal.aborted) listener();
        },
        parent: signal => {
            if (signal && tasks.get(signal.id) === signal) return signal;
            const task = signals.get(signal); return task?.epoch === epoch ? task : null;
        },
        report: () => ({ note: NOTE, sessionId, recording: live(), limit: 600, dropped, coverage: { ...coverage, watched: watches.size, historyWindow: 8 },
            pending: [...tasks.values()].map(task => ({ ...task, elapsedMs: Date.now() - task.started })), current: structuredClone(previous), events: structuredClone(rows) }) };
}
