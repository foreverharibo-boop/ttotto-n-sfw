// Shared by the standalone NSFW engine and the unified NSFW adapter.
// Identity is card-avatar -> UUID, never a display name or mutable array index.
const CUSTOM_IDENTITY_KEY = 'ttotto-nsfw-identities';
const CUSTOM_FIELDS = ['prompt', 'kinks'];
let customInjectionEditorUuid = '';

function customObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function customOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function customUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const value = Math.floor(Math.random() * 16);
        return (char === 'x' ? value : (value & 3) | 8).toString(16);
    });
}

function customInjectionStore() {
    const settings = getSettings();
    if (!customObject(settings.customInjection)) settings.customInjection = {};
    const store = settings.customInjection;
    if (!customObject(store.common)) store.common = {};
    if (!customObject(store.characters)) store.characters = {};
    return store;
}

function customInjectionCharacters() {
    const context = getContext();
    const characters = Array.isArray(context.characters) ? context.characters : [];
    const present = value => value !== undefined && value !== null && value !== '';
    let cards = [];
    if (present(context.groupId)) {
        const group = context.groups?.find(item => String(item.id) === String(context.groupId));
        const disabled = new Set(group?.disabled_members ?? []);
        cards = (group?.members ?? []).filter(avatar => !disabled.has(avatar))
            .map(avatar => characters.find(card => card?.avatar === avatar));
    } else if (present(context.characterId) && Number.isInteger(Number(context.characterId))) {
        cards = [characters[Number(context.characterId)]];
    }
    cards = cards.filter(card => typeof card?.avatar === 'string' && card.avatar.trim());
    if (!cards.length) return [];
    const settings = context.extensionSettings;
    if (!customObject(settings[CUSTOM_IDENTITY_KEY])) settings[CUSTOM_IDENTITY_KEY] = {};
    const registry = settings[CUSTOM_IDENTITY_KEY];
    if (!customObject(registry.byAvatar)) registry.byAvatar = {};
    const seen = new Set(), entries = [];
    let changed = false;
    for (const card of cards) {
        const avatar = card.avatar;
        if (seen.has(avatar)) continue;
        seen.add(avatar);
        let uuid = customOwn(registry.byAvatar, avatar) ? registry.byAvatar[avatar] : '';
        if (typeof uuid !== 'string' || !uuid || Object.entries(registry.byAvatar).some(([key, value]) => key !== avatar && value === uuid)) {
            uuid = customUuid();
            Object.defineProperty(registry.byAvatar, avatar, { value: uuid, writable: true, enumerable: true, configurable: true });
            changed = true;
        }
        entries.push({ uuid, avatar, name: String(card.name || card.data?.name || 'Unnamed Character') });
    }
    if (changed) context.saveSettingsDebounced?.();
    return entries;
}

function customInjectionProfile(uuid, create = false) {
    const profiles = customInjectionStore().characters;
    if (!uuid) return null;
    if (!customOwn(profiles, uuid) || !customObject(profiles[uuid])) {
        if (!create) return null;
        Object.defineProperty(profiles, uuid, { value: {}, writable: true, enumerable: true, configurable: true });
    }
    return profiles[uuid];
}

function customInjectionScope(profile, field) {
    const scope = profile?.[field + 'Scope'];
    return ['off', 'common', 'character'].includes(scope) ? scope : 'common';
}

function customInjectionText(container, field) {
    return typeof container?.[field] === 'string' ? container[field] : '';
}

function buildCustomInjectionLines() {
    const entries = customInjectionCharacters();
    if (!entries.length) return [];
    const store = customInjectionStore(), lines = [];
    for (const field of CUSTOM_FIELDS) {
        const title = field === 'prompt' ? 'Additional Instructions' : 'Kink Preferences';
        const common = entries.filter(entry => customInjectionScope(customInjectionProfile(entry.uuid), field) === 'common');
        const text = customInjectionText(store.common, field).trim();
        if (common.length && text) {
            lines.push('', `[${title}${entries.length > 1 ? ' — ' + common.map(entry => `${entry.name} (${entry.avatar})`).join(', ') : ''}]`, text);
        }
        for (const entry of entries) {
            const profile = customInjectionProfile(entry.uuid);
            const text = customInjectionText(profile, field).trim();
            if (customInjectionScope(profile, field) === 'character' && text) {
                lines.push('', `[${title}${entries.length > 1 ? ` — ${entry.name} (${entry.avatar})` : ''}]`, text);
            }
        }
    }
    return lines;
}

function customEditorContext(entries) {
    const context = getContext();
    return JSON.stringify([context.groupId ?? null, context.characterId ?? null,
        context.getCurrentChatId?.() ?? context.chatId ?? null, entries.map(entry => entry.uuid)]);
}

function renderCustomInjectionUi() {
    const selector = element('tns-custom-character');
    if (!selector) return;
    const entries = customInjectionCharacters();
    if (!entries.some(entry => entry.uuid === customInjectionEditorUuid)) customInjectionEditorUuid = entries[0]?.uuid ?? '';
    const signature = JSON.stringify(entries);
    if (selector.dataset.entries !== signature) {
        selector.replaceChildren();
        for (const entry of entries) {
            const option = document.createElement('option');
            option.value = entry.uuid;
            option.textContent = `${entry.name} · ${entry.avatar} · ${entry.uuid.slice(0, 8)}`;
            selector.append(option);
        }
        selector.dataset.entries = signature;
    }
    selector.value = customInjectionEditorUuid;
    selector.disabled = entries.length < 2;
    const profile = customInjectionProfile(customInjectionEditorUuid);
    const store = customInjectionStore();
    const contextKey = customEditorContext(entries);
    element('tns-custom-note').textContent = entries.length
        ? '전용 내용과 사용 범위는 이 카드의 다른 채팅방에도 적용돼요. 공통 내용은 공통을 선택한 캐릭터들이 함께 사용해요.'
        : '캐릭터 채팅방을 열면 전용 내용과 사용 범위를 설정할 수 있어요. 지금은 공통 내용만 편집해요.';
    for (const field of CUSTOM_FIELDS) {
        const scope = customInjectionScope(profile, field);
        const select = element(`tns-custom-${field}-scope`);
        select.value = scope;
        select.disabled = !customInjectionEditorUuid;
        select.dataset.context = contextKey;
        select.dataset.uuid = customInjectionEditorUuid;
        const input = element(`tns-custom-${field}`);
        input.disabled = scope === 'off';
        input.dataset.context = contextKey;
        input.dataset.uuid = customInjectionEditorUuid;
        input.dataset.scope = scope;
        const value = customInjectionText(scope === 'character' ? profile : store.common, field);
        if (input.value !== value) input.value = value;
    }
}

function bindCustomInjectionUi() {
    element('tns-custom-character')?.addEventListener('change', event => {
        customInjectionEditorUuid = event.target.value;
        renderCustomInjectionUi();
    });
    const valid = target => {
        const entries = customInjectionCharacters();
        return target.dataset.context === customEditorContext(entries)
            && target.dataset.uuid === customInjectionEditorUuid
            && (!target.dataset.uuid || entries.some(entry => entry.uuid === target.dataset.uuid));
    };
    const saved = () => {
        getContext().saveSettingsDebounced?.();
        clearInjectedPrompt();
        updateUi();
    };
    for (const field of CUSTOM_FIELDS) {
        element(`tns-custom-${field}-scope`)?.addEventListener('change', event => {
            const target = event.target;
            if (!valid(target) || !target.dataset.uuid) { renderCustomInjectionUi(); return; }
            if (!['off', 'common', 'character'].includes(target.value)) return;
            customInjectionProfile(target.dataset.uuid, true)[field + 'Scope'] = target.value;
            saved();
        });
        element(`tns-custom-${field}`)?.addEventListener('input', event => {
            const target = event.target;
            if (!valid(target)) { renderCustomInjectionUi(); return; }
            const profile = customInjectionProfile(target.dataset.uuid);
            const scope = customInjectionScope(profile, field);
            if (scope === 'off' || scope !== target.dataset.scope) { renderCustomInjectionUi(); return; }
            const container = scope === 'character'
                ? customInjectionProfile(target.dataset.uuid, true) : customInjectionStore().common;
            if (!container) return;
            container[field] = target.value;
            saved();
        });
    }
}
