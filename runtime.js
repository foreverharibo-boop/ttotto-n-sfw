import { createModeFeatures as createSfw } from './modes/sfw/index.js';
import { createSceneCore, SCENE_STORE_KEY } from './core.js';
import { createModeFeatures as createNsfw } from './modes/nsfw/index.js';

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
    let active = false, pollTimer = null, uiQueued = false;
    let owner = null, transitionTimer = null;
    const upstream = new Map();
    const metadataViews = new WeakMap(), settingsViews = new WeakMap();
    const settings = () => migratedContainer(getContext().extensionSettings, SETTINGS_KEY,
        { sfw: 'ttotto-sfw', nsfw: 'ttotto-nsfw' }, () => getContext().saveSettingsDebounced?.());
    function chatReady() {
        const context = getContext();
        const present = value => value !== undefined && value !== null && value !== '';
        const selected = present(context.groupId) || present(context.characterId);
        const id = context.getCurrentChatId?.() ?? context.chatId;
        return Boolean(active && selected && present(id) && Array.isArray(context.chat));
    }
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
        queueMicrotask(() => {
            try {
                if (active) {
                    updateOwner();
                    for (const feature of Object.values(features)) feature.updateUi();
                    onUi();
                }
            } finally { uiQueued = false; }
        });
    }
    function publishPrompt(prompt = '') {
        getContext().setExtensionPrompt(PROMPT_KEY, chatReady() ? prompt : '', 1, 0, false, 0);
    }
    function subscribe() {
        const context = getContext(), types = context.eventTypes ?? context.event_types ?? {};
        for (const name of ['GENERATION_STARTED', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHAT_CHANGED', 'CHAT_CREATED', 'CONNECTION_PROFILE_LOADED']) {
            if (!types[name] || upstream.has(types[name])) continue;
            const handler = (...args) => dispatch(types[name], ...args);
            context.eventSource.on(types[name], handler);
            upstream.set(types[name], { source: context.eventSource, handler });
        }
    }
    function context(kind) {
        const raw = getContext();
        return new Proxy(raw, {
            get(target, name) {
                if (name === 'setExtensionPrompt') return () => { throw new Error('Only the scene core may publish a prompt'); };
                if (name === 'extensionSettings') return view(target.extensionSettings, SETTINGS_KEY,
                    { sfw: 'ttotto-sfw', nsfw: 'ttotto-nsfw' }, settingsViews, () => raw.saveSettingsDebounced?.());
                if (name === 'chatMetadata' && !chatReady()) return null;
                if (name === 'chatMetadata' && target.chatMetadata) return view(target.chatMetadata, META_KEY,
                    legacy, metadataViews, () => raw.saveMetadataDebounced?.());
                return target[name];
            },
        });
    }
    function capture(message) { return core.collect(message); }
    const transitionText = /장면 온도 .*연속성 개입|장면 온도 .*개입을 해제|NSFW 신호 감지|현재 성적 행동이 끝난|NSFW 장면을 감지해 또또SFW|장면이 잦아들어 또또SFW/;
    const toasts = Object.fromEntries(['info', 'success', 'warning', 'error'].map(level => [level, (...args) => {
        if (level === 'info' && transitionText.test(String(args[0]))) { uiChanged(); return; }
        return notify?.[level]?.(...args);
    }]));
    const host = { context, chatReady, capture, toasts, uiChanged, open,
        messageStore: (...args) => core.messageStore(...args),
        clearRecords: (...args) => core.clearRecords(...args),
        isMode: kind => core.isMode(kind), collect: index => core.collect(index),
        prepare: (...args) => core.prepare(...args), invalidatePrompt: () => uiChanged(),
        holdsRewrite: () => core.holdsRewrite(), canRefine: (...args) => core.canRefine(...args),
        classifying: () => core.classifying(), acceptHeat: (...args) => core.acceptHeat(...args),
        preview: kind => core.owner() === kind ? core.compose() : '',
        commonState: options => core.commonSummary(options).state,
        sanitizeCommon: raw => features.sfw.sanitizeState(raw),
        activeActs: () => features.nsfw.recentActs(features.nsfw.getSettings().repeatWindow),
        activeDialogue: () => features.nsfw.recentDialogueBeats(),
        commonRecord: message => features.sfw.snapshotMatchesMessage(message)
            ? features.sfw.snapshotForMessage(message)?.state : null,
        allowSharedHints: () => features.nsfw.allowSharedHints(),
        filterSharedHints: beats => features.nsfw.filterSharedHints(beats),
        anyEnabled: () => kinds.some(kind => features[kind].getSettings().enabled) };
    const features = { nsfw: createNsfw(host), sfw: createSfw(host) };
    const core = createSceneCore({ raw: getContext, ready: chatReady, publish: publishPrompt, changed: uiChanged }, features);
    function ownerNow() { return active ? core.owner() : 'off'; }
    function updateOwner() {
        const next = ownerNow();
        if (next === owner) return;
        const previous = owner; owner = next;
        clearTimeout(transitionTimer);
        if (previous !== null && previous !== 'waiting' && next !== 'waiting' && chatReady() && settings().transitionNotifications) transitionTimer = setTimeout(() => {
            if (chatReady() && owner === next) notify?.info?.({ sfw: '일반 장면 추적 중', nsfw: '친밀 장면 추적 중', waiting: '장면 감지 대기 중', off: '사용 중지' }[next], '또또(N)SFW');
        }, 200);
    }
    function dispatch(event, ...args) {
        if (!active) return;
        const types = getContext().eventTypes ?? getContext().event_types ?? {};
        const name = Object.keys(types).find(key => types[key] === event);
        if (name === 'CHAT_CHANGED') { owner = null; clearTimeout(transitionTimer); }
        core.event(name, ...args);
        uiChanged();
    }
    function poll() {
        if (!active) return;
        if (!chatReady()) { owner = null; clearTimeout(transitionTimer); }
        core.refresh();
        if (ownerNow() !== owner) uiChanged();
    }
    async function start({ withUi = true } = {}) {
        if (active) return;
        active = true;
        settings();
        for (const kind of kinds) {
            features[kind].getSettings(); features[kind].getChatMeta();
            // Feature libraries have no independent lifecycle or event subscription.
            features[kind].activateRuntime();
            if (withUi) await features[kind].initialize();
            if (!active) return;
        }
        subscribe();
        poll();
        pollTimer = setInterval(poll, 800);
        uiChanged();
    }
    function stop() {
        active = false;
        clearInterval(pollTimer); pollTimer = null;
        clearTimeout(transitionTimer);
        // Reverse order unwinds the two opt-in diagnostic observers safely.
        features.sfw.onDisable(); features.nsfw.onDisable();
        for (const [event, { source, handler }] of upstream) {
            if (source.removeListener) source.removeListener(event, handler);
            else source.off?.(event, handler);
        }
        upstream.clear();
        core.reset();
        owner = null;
        publishPrompt();
    }
    async function intercept(_chat, _size, _abort, type) {
        core.prepare(type, true);
        updateOwner();
    }
    function clean() {
        stop();
        // Clean only the unified copy; legacy data is deliberately retained.
        delete getContext().extensionSettings[SETTINGS_KEY];
        if (getContext().chatMetadata) delete getContext().chatMetadata[META_KEY];
        for (const message of getContext().chat ?? []) if (message?.extra) {
            delete message.extra[SCENE_STORE_KEY];
            for (const kind of kinds) delete message.extra[extraKey[kind]];
        }
        getContext().saveSettingsDebounced?.(); getContext().saveMetadataDebounced?.();
        features.sfw.persistChat();
    }
    return { features, core, settings, context, capture, dispatch, poll, start, stop, clean,
        intercept, chatReady, owner: ownerNow, get active() { return active; },
        diagnostics: () => ({ extension: SETTINGS_KEY, version: '0.2.4', owner: ownerNow(), core: core.diagnostics(),
            sfw: JSON.parse(features.sfw.diagnosticReport()), nsfw: JSON.parse(features.nsfw.diagnosticReport()) }) };
}
