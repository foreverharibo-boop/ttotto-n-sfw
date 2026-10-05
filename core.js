// The sole scene engine. Feature libraries supply schemas, policy and controls;
// they cannot subscribe, collect independently, negotiate ownership or inject.
export const SCENE_STORE_KEY = 'ttottoUnifiedScene';
const MODES = ['sfw', 'nsfw'];
const GENERATION_TYPES = new Set(['normal', 'swipe', 'regenerate', 'continue']);
const normalize = type => type == null ? 'normal' : typeof type === 'string' ? type.trim().toLowerCase() || 'normal' : 'unknown';

export function createSceneCore(host, features) {
    let mode = 'waiting', phase = 'tracking', collecting = false, classifying = false;
    let events = [], rewriteMode = null, windDown = null, chatIdentity = null;
    let lastObserved = null;
    const enabled = kind => features[kind].isSupervising();
    const currentMessage = () => host.raw().chat?.filter(m => m && !m.is_user && !m.is_system).at(-1);
    const blocking = () => events.some(type => GENERATION_TYPES.has(type));
    function selection() {
        if (!host.ready()) return { mode: 'waiting', phase: 'tracking' };
        const config = features.nsfw.getSettings(), meta = features.nsfw.getChatMeta(false);
        if (enabled('nsfw') && (config.armMode === 'manual' || meta?.autoArmed || rewriteMode === 'nsfw')) return { mode: 'nsfw', phase: 'tracking' };
        if (config.enabled && config.adultConfirmed && config.exitBridge && (meta?.bridgePending || windDown)) return { mode: 'nsfw', phase: 'wind-down' };
        return { mode: enabled('sfw') ? 'sfw' : 'waiting', phase: 'tracking' };
    }
    function commitMode() {
        const next = selection();
        if (next.mode !== mode) {
            if (MODES.includes(mode)) features[mode].leaveMode();
            mode = next.mode;
        }
        phase = next.phase;
        return mode;
    }
    function isMode(kind) {
        const current = selection();
        return current.mode === kind && current.phase === 'tracking';
    }
    function messageStore(message, kind, create = true) {
        if (!message || message.is_user || message.is_system) return null;
        // Import the previous unified or stand-alone schema exactly once, without
        // changing either old copy. All subsequent reads/writes use this store.
        const old = message.extra?.[kind === 'sfw' ? 'ttottoUnifiedSfw' : 'ttottoUnifiedNsfw']
            ?? message.extra?.[kind === 'sfw' ? 'ttottoSfw' : 'ttottoNsfw'];
        if (!message.extra?.[SCENE_STORE_KEY] && !create && !old) return null;
        message.extra ??= {};
        const store = message.extra[SCENE_STORE_KEY] ??= { schemaVersion: 1, modes: {} };
        if (!store.modes[kind]) {
            if (!create && !old) return null;
            store.modes[kind] = old ? structuredClone(old) : { swipes: {} };
        }
        store.modes[kind].swipes ??= {};
        return store.modes[kind];
    }
    function clearRecords(message, kind) {
        const store = messageStore(message, kind, false);
        if (store) store.swipes = {}; // Tombstone prevents reimporting old snapshots.
        lastObserved = null;
    }
    function detect(state, message) {
        if (classifying || !host.ready() || blocking()) return;
        classifying = true;
        try { features.nsfw.detect(state, message); } finally { classifying = false; }
        commitMode();
    }
    function acceptHeat(state, message) {
        // Manual/AI repair reports have the same validity guards in their feature
        // library; committing their result still goes through this single owner.
        detect(state, message);
        host.changed();
    }
    function collect(index, { force = false } = {}) {
        if (!host.ready() || collecting || blocking()) return false;
        const message = typeof index === 'object' ? index : host.raw().chat?.[Number(index)] ?? currentMessage();
        if (!message || message.is_user || message.is_system || features.sfw.isPendingAssistant(message)) return false;
        const target = { message, text: String(message.mes ?? ''), swipe: features.sfw.currentSwipeIndex(message), metadata: host.raw().chatMetadata };
        if (!force && lastObserved && Object.keys(target).every(key => target[key] === lastObserved[key])) return false;
        collecting = true;
        try {
            const parsed = {};
            // No body mutation until both schemas have been parsed and saved.
            for (const kind of MODES) if (enabled(kind)) {
                const feature = features[kind];
                feature.diagnosticResponse(message, host.raw().chat.indexOf(message));
                parsed[kind] = feature.parseReport(message);
                const state = parsed[kind];
                if (state) messageStore(message, kind).swipes[String(target.swipe)] = {
                    state, at: Date.now(), messageSignature: feature.messageStateSignature(message), signatureVersion: 2,
                };
            }
            // A full scene in the intimate report also supplies the narrative
            // record for a same-response return to general mode.
            if (enabled('sfw') && !parsed.sfw && parsed.nsfw?.scene) {
                parsed.sfw = structuredClone(parsed.nsfw.scene);
                messageStore(message, 'sfw').swipes[String(target.swipe)] = {
                    state: parsed.sfw, at: Date.now(), messageSignature: features.sfw.messageStateSignature(message), signatureVersion: 2,
                };
            }
            detect(parsed.nsfw ?? null, message);
            const clean = text => MODES.reduce((value, kind) => features[kind].stripReport(value), String(text ?? ''));
            const text = clean(message.mes);
            let changed = text !== message.mes;
            message.mes = text;
            if (typeof message.swipes?.[target.swipe] === 'string') {
                const swipeText = clean(message.swipes[target.swipe]);
                changed ||= swipeText !== message.swipes[target.swipe];
                message.swipes[target.swipe] = swipeText;
            }
            for (const kind of MODES) if (enabled(kind)) {
                const feature = features[kind];
                const state = feature.snapshotMatchesMessage(message) ? feature.snapshotForMessage(message)?.state : null;
                feature.settleReport(message, state, Boolean(parsed[kind]));
                feature.diagnosticTrackBody(message, host.raw().chat.indexOf(message), 'after_collection');
            }
            lastObserved = { ...target, text: String(message.mes ?? '') };
            if (changed) features.sfw.rerenderMessage(host.raw().chat.indexOf(message), message);
            if (changed || Object.values(parsed).some(Boolean)) features.sfw.persistChat();
            host.changed();
            return true;
        } finally { collecting = false; }
    }
    function syncGeneration() { for (const feature of Object.values(features)) feature.syncGeneration(events); }
    function reset() {
        events = []; rewriteMode = null; windDown = null; lastObserved = null;
        mode = 'waiting'; phase = 'tracking';
        for (const feature of Object.values(features)) feature.resetFeatureSession();
        syncGeneration();
        host.publish('');
    }
    function syncChat() {
        const context = host.raw();
        const id = context.getCurrentChatId?.() ?? context.chatId;
        if (!chatIdentity || chatIdentity.metadata !== context.chatMetadata || chatIdentity.id !== id) {
            chatIdentity = { metadata: context.chatMetadata, id };
            reset();
            if (host.ready()) for (const feature of Object.values(features)) feature.getChatMeta();
        }
    }
    function refresh() {
        if (!host.ready()) { host.publish(''); return; }
        syncChat();
        if (!blocking()) {
            collect();
            detect(null, null);
        }
        commitMode();
    }
    function commonSummary({ display = false } = {}) {
        let snapshot = features.sfw.summary();
        if (!isMode('nsfw')) return snapshot;
        const intimateCurrent = features.nsfw.currentState();
        const intimateSaved = features.nsfw.summary();
        const currentScene = intimateCurrent.state?.scene;
        if (currentScene) snapshot = { valid: true, state: currentScene };
        else if (!snapshot.valid && display && intimateSaved.state?.scene) {
            snapshot = { valid: false, state: intimateSaved.state.scene };
        }
        if (!snapshot.valid && !display) return { ...snapshot, state: null };
        const state = structuredClone(snapshot.state ?? {});
        // The active mode's valid/manual facts win on overlapping fields. Do not
        // emit two contradictory locations or poses, or overwrite source reports.
        const intimate = intimateCurrent.state ?? (display ? intimateSaved.state : null);
        const present = value => typeof value === 'string' ? value.trim() : value?.en || value?.ko;
        if (present(intimate?.location)) state.location = structuredClone(intimate.location);
        for (const [name, person] of Object.entries(intimate?.characters ?? {})) {
            state.characters ??= {};
            state.characters[name] ??= { appearance: person.clothing, holding: '', condition: '', position: '' };
            if (present(person.position)) state.characters[name].position = structuredClone(person.position);
            if (!present(state.characters[name].appearance) && present(person.clothing)) state.characters[name].appearance = structuredClone(person.clothing);
        }
        return { ...snapshot, state: Object.keys(state).length ? state : null };
    }
    function compose() {
        if (!host.ready()) return '';
        const current = selection();
        const parts = [];
        if (current.phase === 'wind-down') {
            parts.push(features.nsfw.exitPrompt());
            if (enabled('sfw')) parts.push(features.sfw.commonPrompt());
        } else if (current.mode === 'nsfw') {
            parts.push(features.nsfw.buildInjection());
            if (enabled('sfw')) parts.push(features.sfw.commonPrompt());
            else parts.push(features.sfw.continuityPrompt());
        } else {
            if (current.mode === 'sfw') parts.push(features.sfw.buildInjection());
            if (enabled('nsfw')) parts.push(features.nsfw.monitorPrompt());
            // Preserve the standalone general-mode manual exit instruction.
            const meta = features.sfw.getChatMeta(false);
            if (current.mode === 'waiting' && features.sfw.getSettings().enabled && features.sfw.getSettings().exitBridge && meta?.bridgePending) parts.push(features.sfw.exitPrompt());
        }
        let prompt = parts.filter(Boolean).join('\n\n');
        if (prompt.includes('<scene_state>') && prompt.includes('<sfw_scene>')) prompt += '\n\n[Unified report coordination]\nBoth report types are requested: output exactly one scene_state block and exactly one sfw_scene block. A one-report instruction applies separately to each tag type. Report bookkeeping must not change the story. Sexual heat/stage and narrative intensity/stage are independent; never substitute one for the other.';
        return prompt;
    }
    function prepare(type = 'normal', consumeBridge = true) {
        if (normalize(type) === 'quiet') return;
        if (!host.ready()) { host.publish(''); return; }
        syncChat();
        if (!GENERATION_TYPES.has(normalize(type))) { host.publish(''); return; }
        if (!blocking()) { collect(); detect(null, null); }
        commitMode();
        if (phase === 'tracking' && MODES.includes(mode)) features[mode].startSlowBurn();
        const prompt = compose();
        host.publish(prompt);
        for (const feature of Object.values(features)) feature.diagnosticRecord('injection_registered', { mode, phase, chars: prompt.length, reportInstruction: prompt.includes('<sfw_scene>') || prompt.includes('<scene_state>') });
        if (consumeBridge) {
            if (phase === 'wind-down') {
                windDown = { metadata: host.raw().chatMetadata };
                features.nsfw.getChatMeta().bridgePending = false;
                features.nsfw.saveChatMeta();
            }
            if (mode === 'waiting') {
                const meta = features.sfw.getChatMeta(false);
                if (meta?.bridgePending) { meta.bridgePending = false; features.sfw.saveChatMeta(); }
            }
        }
    }
    function event(name, ...args) {
        if (name === 'CHAT_CHANGED') { chatIdentity = null; syncChat(); refresh(); return; }
        if (name === 'CONNECTION_PROFILE_LOADED') { for (const f of Object.values(features)) f.populateProfiles(); return; }
        if (!host.ready()) return;
        syncChat();
        const stages = { GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped', MESSAGE_RECEIVED: 'message_received', CHARACTER_MESSAGE_RENDERED: 'message_rendered', MESSAGE_SWIPED: 'message_swiped', MESSAGE_EDITED: 'message_edited' };
        for (const feature of Object.values(features)) {
            if (stages[name]) feature.diagnosticRecord(stages[name], typeof args[0] === 'number' ? { message: args[0] } : {});
            if (name === 'MESSAGE_RECEIVED' || name === 'MESSAGE_EDITED') feature.diagnosticTrackBody(host.raw().chat?.[Number(args[0])], Number(args[0]), name.toLowerCase());
        }
        if (name === 'GENERATION_STARTED') {
            if (args[2]) return;
            const type = normalize(args[0]);
            if (type !== 'quiet' && GENERATION_TYPES.has(type)) {
                if (!blocking()) { collect(); detect(null, null); }
                if (type === 'swipe' || type === 'regenerate') rewriteMode = selection().mode;
            }
            events.push(type); syncGeneration();
            prepare(type, false);
        } else if (name === 'MESSAGE_RECEIVED') {
            events = events.filter(type => type === 'quiet'); rewriteMode = null; windDown = null; syncGeneration();
            collect(args[0], { force: true }); commitMode();
        } else if (name === 'GENERATION_ENDED') {
            const type = typeof args[0] === 'string' ? normalize(args[0]) : events.at(-1);
            const index = events.lastIndexOf(type); if (index >= 0) events.splice(index, 1);
            syncGeneration();
            if (!blocking()) { rewriteMode = null; windDown = null; collect(); commitMode(); }
        } else if (name === 'GENERATION_STOPPED') {
            events = []; rewriteMode = null; windDown = null; syncGeneration(); collect(); commitMode();
        } else if (['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHAT_CREATED'].includes(name)) {
            if (name === 'MESSAGE_DELETED') lastObserved = null;
            collect(args[0]); detect(null, null);
        }
        host.changed();
    }
    return { collect, prepare, refresh, event, reset, compose, commonSummary, isMode, messageStore, clearRecords, acceptHeat,
        classifying: () => classifying, holdsRewrite: () => Boolean(rewriteMode && blocking()),
        owner: () => selection().mode,
        diagnostics: () => ({ mode: selection().mode, phase: selection().phase, pendingGenerations: events.length, rewriteMode }),
        canRefine: (kind, manual = false) => host.ready() && !blocking() && (isMode(kind) || kind === 'nsfw' && enabled('nsfw') && (manual || features.nsfw.getSettings().armMode === 'auto')),
    };
}
