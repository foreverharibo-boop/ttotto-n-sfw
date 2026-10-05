import { createEngine as createSfw } from './engines/sfw/index.js';
import { createEngine as createNsfw } from './engines/nsfw/index.js';

export const SETTINGS_KEY = 'ttotto-unified';
export const META_KEY = 'ttottoUnified';
export const PROMPT_KEY = 'ttotto_unified_continuity';
const kinds = ['nsfw', 'sfw'];
const legacy = { sfw: 'ttottoSfw', nsfw: 'ttottoNsfw' };
const extraKey = { sfw: 'ttottoUnifiedSfw', nsfw: 'ttottoUnifiedNsfw' };

// Copy whole objects, including settings unknown to this release. Never mutate the
// original extensions' settings/metadata/snapshots during migration or cleanup.
export function migratedContainer(parent, key, oldKeys, changed = () => {}) {
    if (!parent[key]) {
        parent[key] = { schemaVersion: 1, engines: {} };
        for (const kind of kinds) if (parent[oldKeys[kind]]) {
            parent[key].engines[kind] = structuredClone(parent[oldKeys[kind]]);
        }
        changed();
    }
    parent[key].engines ??= {};
    return parent[key];
}

export function createRuntime(getContext, { onUi = () => {}, open = () => {}, notify = globalThis.toastr } = {}) {
    let active = false, pollTimer = null, uiQueued = false, capturing = false;
    let owner = null, transitionTimer = null;
    const upstream = new Map(), listeners = new Map(), promptSlots = new Map();
    const metadataViews = new WeakMap(), settingsViews = new WeakMap();
    const shared = {};
    const settings = () => migratedContainer(getContext().extensionSettings, SETTINGS_KEY,
        { sfw: 'ttotto-sfw', nsfw: 'ttotto-nsfw' }, () => getContext().saveSettingsDebounced?.());
    function view(parent, key, oldKeys, cache, save) {
        if (cache.has(parent)) return cache.get(parent);
        const names = Object.fromEntries(kinds.map(kind => [oldKeys[kind], kind]));
        const proxy = new Proxy(parent, {
            get(target, name) {
                return names[name] ? migratedContainer(target, key, oldKeys, save).engines[names[name]] : target[name];
            },
            set(target, name, value) {
                if (names[name]) migratedContainer(target, key, oldKeys, save).engines[names[name]] = value;
                else target[name] = value;
                return true;
            },
            deleteProperty(target, name) {
                if (names[name]) delete migratedContainer(target, key, oldKeys, save).engines[names[name]];
                else delete target[name];
                return true;
            },
        });
        cache.set(parent, proxy);
        return proxy;
    }
    function uiChanged() {
        if (!active || uiQueued) return;
        uiQueued = true;
        queueMicrotask(() => { uiQueued = false; if (active) { updateOwner(); onUi(); } });
    }
    function publishPrompt() {
        const context = getContext();
        let prompt = active ? kinds.map(kind => promptSlots.get(kind) || '').filter(Boolean).join('\n\n') : '';
        if (prompt.includes('<scene_state>') && prompt.includes('<sfw_scene>')) prompt += '\n\n[Unified report coordination]\nBoth report types are requested: output exactly one scene_state block and exactly one sfw_scene block. A one-report instruction applies separately to each tag type. Report bookkeeping must not change the story. Sexual heat/stage and narrative intensity/stage are independent; never substitute one for the other.';
        context.setExtensionPrompt(PROMPT_KEY, prompt, 1, 0, false, 0);
    }
    function ensureSubscription(event) {
        if (!active || upstream.has(event)) return;
        const source = getContext().eventSource;
        const handler = (...args) => dispatch(event, ...args);
        source.on(event, handler);
        upstream.set(event, { source, handler });
    }
    function bus(kind) {
        return {
            on(event, handler) {
                if (!listeners.has(event)) listeners.set(event, new Map());
                if (!listeners.get(event).has(kind)) listeners.get(event).set(kind, new Set());
                listeners.get(event).get(kind).add(handler);
                ensureSubscription(event);
            },
            removeListener(event, handler) { listeners.get(event)?.get(kind)?.delete(handler); },
            off(event, handler) { this.removeListener(event, handler); },
        };
    }
    const buses = Object.fromEntries(kinds.map(kind => [kind, bus(kind)]));
    function context(kind) {
        const raw = getContext();
        return new Proxy(raw, {
            get(target, name) {
                if (name === 'eventSource') return buses[kind];
                if (name === 'setExtensionPrompt') return (_key, value) => {
                    promptSlots.set(kind, value); publishPrompt();
                };
                if (name === 'extensionSettings') return view(target.extensionSettings, SETTINGS_KEY,
                    { sfw: 'ttotto-sfw', nsfw: 'ttotto-nsfw' }, settingsViews, () => raw.saveSettingsDebounced?.());
                if (name === 'chatMetadata' && target.chatMetadata) return view(target.chatMetadata, META_KEY,
                    legacy, metadataViews, () => raw.saveMetadataDebounced?.());
                return target[name];
            },
        });
    }
    function migrateMessage(message, kind) {
        if (!message?.extra || message.is_user || message.is_system) return;
        const extra = message.extra;
        if (extra.ttottoUnifiedImported?.[kind]) return;
        if (!extra[extraKey[kind]] && extra[legacy[kind]]) extra[extraKey[kind]] = structuredClone(extra[legacy[kind]]);
        (extra.ttottoUnifiedImported ??= {})[kind] = true;
    }
    function capture(message) {
        if (!active || capturing) return;
        capturing = true;
        try {
            // Save both native schemas before any report stripping. Do not map
            // narrative intensity/stage to sexual heat/stage.
            let changed = false;
            for (const kind of kinds) changed = engines[kind].capturePassive(message) || changed;
            if (changed) engines.sfw.persistChat();
        } finally { capturing = false; }
    }
    const transitionText = /장면 온도 .*연속성 개입|장면 온도 .*개입을 해제|NSFW 신호 감지|현재 성적 행동이 끝난|NSFW 장면을 감지해 또또SFW|장면이 잦아들어 또또SFW/;
    const toasts = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, (...args) => {
        if (level === 'info' && transitionText.test(String(args[0]))) { uiChanged(); return; }
        return notify?.[level]?.(...args);
    }]));
    const host = { shared, context, migrateMessage, capture, toasts, uiChanged, open,
        anyEnabled: () => kinds.some(kind => engines[kind].getSettings().enabled) };
    const engines = { nsfw: createNsfw(host), sfw: createSfw(host) };
    function latestAssistant() {
        return getContext().chat?.filter(message => message && !message.is_user && !message.is_system).at(-1);
    }
    function ownerNow() {
        if (!active) return 'off';
        if (engines.nsfw.summary().armed) return 'nsfw';
        if (engines.sfw.summary().armed) return 'sfw';
        return 'waiting';
    }
    function updateOwner() {
        const next = ownerNow();
        if (next === owner) return;
        const previous = owner; owner = next;
        clearTimeout(transitionTimer);
        if (previous !== null && settings().transitionNotifications) transitionTimer = setTimeout(() => {
            if (active && owner === next) notify?.info?.({ sfw: '일반 장면 추적 중', nsfw: '친밀 장면 추적 중', waiting: '장면 감지 대기 중', off: '사용 중지' }[next], '또또(N)SFW');
        }, 200);
    }
    function dispatch(event, ...args) {
        if (!active) return;
        const types = getContext().eventTypes ?? getContext().event_types ?? {};
        if (event === types.MESSAGE_RECEIVED) {
            // Both generation guards must be released before passive capture.
            for (const kind of kinds) engines[kind].finishReceivedGeneration();
            capture(getContext().chat?.[Number(args[0])] ?? latestAssistant());
        }
        for (const kind of kinds) for (const handler of listeners.get(event)?.get(kind) ?? []) {
            try { handler(...args); } catch (error) { console.error('[또또(N)SFW] 이벤트 처리 실패', kind, error); }
        }
        if (event === types.CHAT_CHANGED) { owner = null; clearTimeout(transitionTimer); }
        uiChanged();
    }
    function poll() {
        if (!active) return;
        capture(latestAssistant());
        for (const kind of kinds) engines[kind].observeLatestMessage();
        uiChanged();
    }
    async function start({ withUi = true } = {}) {
        if (active) return;
        active = true;
        settings();
        for (const kind of kinds) {
            engines[kind].getSettings(); engines[kind].getChatMeta();
            // After disable, restore the engine runtime without launching an
            // independent boot lifecycle or independent observer.
            engines[kind].activateRuntime();
            if (withUi) await engines[kind].initialize();
            else engines[kind].registerEvents();
            if (!active) return;
        }
        poll();
        pollTimer = setInterval(poll, 800);
        uiChanged();
    }
    function stop() {
        active = false;
        clearInterval(pollTimer); pollTimer = null;
        clearTimeout(transitionTimer);
        // Reverse order unwinds the two opt-in diagnostic observers safely.
        engines.sfw.onDisable(); engines.nsfw.onDisable();
        for (const [event, { source, handler }] of upstream) {
            if (source.removeListener) source.removeListener(event, handler);
            else source.off?.(event, handler);
        }
        upstream.clear(); listeners.clear(); promptSlots.clear();
        owner = null;
        publishPrompt();
    }
    async function intercept(chat, size, abort, type) {
        if (!active) return;
        await shared.ttottoNsfwGenerationInterceptor(chat, size, abort, type);
        await shared.ttottoSfwGenerationInterceptor(chat, size, abort, type);
        updateOwner();
    }
    function clean() {
        stop();
        // Clean only the unified copy; legacy data is deliberately retained.
        delete getContext().extensionSettings[SETTINGS_KEY];
        if (getContext().chatMetadata) delete getContext().chatMetadata[META_KEY];
        for (const message of getContext().chat ?? []) if (message?.extra) {
            for (const kind of kinds) delete message.extra[extraKey[kind]];
        }
        getContext().saveSettingsDebounced?.(); getContext().saveMetadataDebounced?.();
        engines.sfw.persistChat();
    }
    return { engines, shared, settings, context, capture, dispatch, poll, start, stop, clean,
        intercept, owner: ownerNow, get active() { return active; },
        diagnostics: () => ({ extension: SETTINGS_KEY, version: '0.1.1', owner: ownerNow(),
            sfw: JSON.parse(engines.sfw.diagnosticReport()), nsfw: JSON.parse(engines.nsfw.diagnosticReport()) }) };
}
