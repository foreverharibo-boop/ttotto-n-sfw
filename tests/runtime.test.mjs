import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRuntime, SETTINGS_KEY, META_KEY, PROMPT_KEY } from '../runtime.js';

globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const sfw = { location: 'Room || 방', time: 'Morning || 아침', environment: 'Rain || 비',
    important_objects: { key: 'Desk || 책상' }, characters: { A: { appearance: 'Coat || 코트', position: 'Chair || 의자', holding: 'Cup || 컵', condition: 'Tired || 피곤함' } },
    acts: ['Talk || 대화'], dialogue_beats: ['Question || 질문'], dialogue_flow: { topic: 'Trip || 여행', last_question: 'When? || 언제?', new_facts: ['Tomorrow || 내일'] },
    scene_type: 'conversation', intensity: 4, stage: 2, next: ['Plan || 계획'] };
const nsfw = { location: 'Room || 방', characters: { A: { clothing: 'Coat || 코트', position: 'Chair || 의자', contact: 'Hand || 손' } }, acts: ['Talk || 대화'], dialogue_beats: ['Question || 질문'], heat: 8, stage: 4, next: ['Listen || 듣기'] };
const tags = (heat = 8) => `<scene_state>${JSON.stringify({ ...nsfw, heat })}</scene_state><sfw_scene>${JSON.stringify(sfw)}</sfw_scene>`;
function setup({ chat = [], autoRefine = false } = {}) {
    const source = new EventEmitter(), prompts = {}, toasts = [];
    const eventTypes = Object.fromEntries(['GENERATION_STARTED', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHAT_CHANGED', 'CHAT_CREATED', 'CONNECTION_PROFILE_LOADED'].map(name => [name, name]));
    const context = { chat, chatMetadata: {}, extensionSettings: {
        'ttotto-sfw': { enabled: true, settingsSchemaVersion: 4, autoRefine, slowBurnEnabled: false, futureField: { keep: 42 } },
        'ttotto-nsfw': { enabled: true, settingsSchemaVersion: 3, adultConfirmed: true, armMode: 'auto', autoRefine, slowBurnEnabled: false },
    }, eventSource: source, eventTypes, setExtensionPrompt(key, value) { prompts[key] = value; },
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveChat() {}, generateRaw: async () => { throw Error('Unexpected AI call'); } };
    const runtime = createRuntime(() => context, { notify: Object.fromEntries(['info', 'warning', 'error', 'success'].map(level => [level, text => toasts.push([level, text])])) });
    return { runtime, context, source, prompts, toasts };
}

test('all report fields survive dual capture, native tag stripping, and separate stage meanings', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.source.emit('GENERATION_STARTED', 'normal');
        r.context.chat.push({ mes: 'A quiet exchange.' + tags(), is_user: false });
        r.source.emit('MESSAGE_RECEIVED', 0);
        const message = r.context.chat[0];
        const s = message.extra.ttottoUnifiedSfw.swipes['0'].state;
        const n = message.extra.ttottoUnifiedNsfw.swipes['0'].state;
        assert.equal(s.characters.A.condition.ko, '피곤함'); assert.equal(s.characters.A.holding.ko, '컵');
        assert.equal(n.characters.A.contact.ko, '손'); assert.equal(n.characters.A.clothing.ko, '코트');
        assert.equal(s.time.ko, '아침'); assert.equal(s.environment.ko, '비'); assert.equal(s.importantObjects.key.ko, '책상');
        assert.equal(s.dialogueFlow.lastQuestion.ko, '언제?'); assert.equal(s.dialogueFlow.newFacts[0].ko, '내일');
        assert.equal(s.intensity, 4); assert.equal(n.heat, 8); assert.equal(s.stage, 2); assert.equal(n.stage, 4);
        assert.equal(s.next[0].ko, '계획'); assert.equal(n.next[0].ko, '듣기');
        assert.equal(message.mes, 'A quiet exchange.');
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.equal(r.runtime.engines.sfw.summary().valid, true);
        assert.equal(r.runtime.engines.nsfw.summary().valid, true);
    } finally { r.runtime.stop(); }
});

test('body edits invalidate records without treating unknown heat as scene end; low heat releases', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'A quiet exchange with details.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        r.context.chat[0].mes = 'A quiet exchange.'; r.source.emit('MESSAGE_EDITED', 0); r.runtime.poll();
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.equal(r.runtime.engines.sfw.summary().valid, false);
        assert.equal(r.runtime.engines.nsfw.summary().valid, false);
        r.context.chat.push({ mes: 'Next reply.' + tags(1) }); r.source.emit('MESSAGE_RECEIVED', 1);
        assert.equal(r.runtime.owner(), 'sfw');
        assert.equal(r.runtime.engines.sfw.summary().valid, true);
        assert.deepEqual(r.toasts, []);
    } finally { r.runtime.stop(); }
});

test('settings, chat metadata and all swipes migrate by value; old records stay unchanged', async () => {
    const message = { mes: 'Existing', extra: { ttottoSfw: { swipes: { 0: { state: { location: 'A' } }, 1: { state: { location: 'B' } } } }, ttottoNsfw: { swipes: { 0: { state: { heat: 7 } } } } } };
    const r = setup({ chat: [message] });
    r.context.chatMetadata.ttottoSfw = { chatSchemaVersion: 1, enabled: true, bans: ['Keep'], unknown: 99 };
    const beforeSettings = structuredClone(r.context.extensionSettings['ttotto-sfw']);
    const beforeMeta = structuredClone(r.context.chatMetadata.ttottoSfw);
    const beforeExtra = structuredClone(message.extra.ttottoSfw);
    await r.runtime.start({ withUi: false });
    try {
        assert.equal(r.runtime.settings().engines.sfw.futureField.keep, 42);
        assert.equal(r.context.chatMetadata[META_KEY].engines.sfw.unknown, 99);
        assert.deepEqual(message.extra.ttottoUnifiedSfw.swipes, beforeExtra.swipes);
        r.runtime.settings().engines.sfw.futureField.keep = 5;
        message.extra.ttottoUnifiedSfw.swipes[1].state.location = 'Changed';
        assert.deepEqual(r.context.extensionSettings['ttotto-sfw'], beforeSettings);
        assert.deepEqual(r.context.chatMetadata.ttottoSfw, beforeMeta);
        assert.deepEqual(message.extra.ttottoSfw, beforeExtra);
        r.runtime.clean();
        assert.deepEqual(message.extra.ttottoSfw, beforeExtra);
        assert.equal(r.context.extensionSettings[SETTINGS_KEY], undefined);
    } finally { if (r.runtime.active) r.runtime.stop(); }
});

test('single event subscription and prompt slot, complete bookkeeping while intimate engine owns scene', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        for (const event of Object.values(r.context.eventTypes)) assert.equal(r.source.listenerCount(event), 1, event);
        r.context.chat.push({ mes: 'A quiet exchange.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.deepEqual(Object.keys(r.prompts), [PROMPT_KEY]);
        assert.match(r.prompts[PROMPT_KEY], /<sfw_scene>/); assert.match(r.prompts[PROMPT_KEY], /<scene_state>/);
        assert.match(r.prompts[PROMPT_KEY], /dialogue_flow/); assert.match(r.prompts[PROMPT_KEY], /important_objects/);
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /If sexual activity is still ongoing, omit/);
        const before = r.prompts[PROMPT_KEY]; await r.runtime.intercept([], 1000, null, 'quiet'); assert.equal(r.prompts[PROMPT_KEY], before);
        r.runtime.stop();
        for (const event of Object.values(r.context.eventTypes)) assert.equal(r.source.listenerCount(event), 0);
        assert.equal(r.prompts[PROMPT_KEY], '');
        await r.runtime.start({ withUi: false });
        assert.equal(r.source.listenerCount('MESSAGE_RECEIVED'), 1);
    } finally { r.runtime.stop(); }
});

test('swipe selection and chat change cannot reuse another current report', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const message = { mes: 'First.' + tags(), swipe_id: 0, swipes: ['First.' + tags(), 'Unreported alternative.'] };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        message.swipe_id = 1; message.mes = message.swipes[1]; r.source.emit('MESSAGE_SWIPED', 0);
        assert.equal(r.runtime.engines.sfw.summary().valid, false);
        assert.equal(r.runtime.engines.nsfw.summary().valid, false);
        assert.ok(message.extra.ttottoUnifiedSfw.swipes[0]); assert.equal(message.extra.ttottoUnifiedSfw.swipes[1], undefined);
        r.context.chat = []; r.context.chatMetadata = {}; r.source.emit('CHAT_CHANGED');
        assert.equal(r.runtime.engines.sfw.summary().state, null);
        assert.equal(r.runtime.engines.nsfw.summary().state, null);
    } finally { r.runtime.stop(); }
});

test('disabled branch does not collect or issue new instructions', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines.nsfw.enabled = false;
        r.context.chat.push({ mes: 'New reply.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.context.chat[0].extra.ttottoUnifiedNsfw, undefined);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'sfw');
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /\[NSFW/);
    } finally { r.runtime.stop(); }
});

test('manual and stealth modes retain distinct ownership and reporting behavior', async () => {
    for (const mode of ['manual', 'stealth']) {
        const r = setup({ chat: [{ mes: 'They discussed the weather.' }] });
        r.context.extensionSettings['ttotto-nsfw'].armMode = mode;
        await r.runtime.start({ withUi: false });
        try {
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.equal(r.runtime.owner(), mode === 'manual' ? 'nsfw' : 'sfw');
            if (mode === 'stealth') assert.doesNotMatch(r.prompts[PROMPT_KEY], /<scene_state>/);
            else assert.match(r.prompts[PROMPT_KEY], /<scene_state>/);
        } finally { r.runtime.stop(); }
    }
});

test('selected analysis profile survives migration and saves only into unified records', async () => {
    const r = setup({ chat: [{ mes: 'They discussed the weather.' }] });
    r.context.extensionSettings['ttotto-nsfw'].armMode = 'manual';
    r.context.extensionSettings['ttotto-nsfw'].refineProfileId = 'analysis-profile';
    const calls = [];
    r.context.ConnectionManagerRequestService = {
        async sendRequest(id, prompt, tokens, options) { calls.push({ id, options }); return JSON.stringify(nsfw); },
    };
    await r.runtime.start({ withUi: false });
    try {
        assert.equal(await r.runtime.engines.nsfw.runRefine({ manual: true }), true);
        assert.equal(calls.length, 1); assert.equal(calls[0].id, 'analysis-profile');
        assert.equal(calls[0].options.stream, false);
        assert.equal(r.context.chat[0].extra.ttottoUnifiedNsfw.swipes[0].state.heat, 8);
        assert.equal(r.context.chat[0].extra.ttottoNsfw, undefined);
    } finally { r.runtime.stop(); }
});

test('passive SFW collection keeps the exact explicit panel time while NSFW owns the reply', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: '<Info_panel>[Date: Friday | 10:15 AM]</Info_panel>' + tags() });
        r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.equal(r.runtime.engines.sfw.summary().state.time.en, 'Friday | 10:15 AM');
    } finally { r.runtime.stop(); }
});

test('intimate scenes share continuity rules and current facts, respecting each toggle and body validity', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'A quiet exchange.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        const settings = r.runtime.settings().engines.sfw;
        settings.transitionGuard = true; settings.dialogueFlow = true;
        await r.runtime.intercept([], 1000, null, 'normal');
        const shared = () => r.prompts[PROMPT_KEY].split('[Shared scene continuity]')[1]?.split('[Unified scene bookkeeping]')[0] || '';
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.match(shared(), /SCENE TRANSITION GUARD/);
        assert.match(shared(), /Time\/context: Morning/);
        assert.match(shared(), /DIALOGUE CONTINUITY/);
        assert.match(shared(), /Current conversation topic: Trip/);
        assert.match(shared(), /question awaiting a response: When\?/);
        assert.match(shared(), /Newly established facts: Tomorrow/);
        assert.match(shared(), /USER message already answered or superseded it/);
        assert.doesNotMatch(shared(), /Scene type:|SUGGESTED NEXT BEATS|USER-TARGET LOCK|STAGE CAP/);
        settings.dialogueFlow = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(shared(), /SCENE TRANSITION GUARD/);
        assert.doesNotMatch(shared(), /DIALOGUE CONTINUITY|Trip|When\?|Tomorrow/);
        settings.dialogueFlow = true; settings.transitionGuard = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(shared(), /DIALOGUE CONTINUITY/);
        assert.doesNotMatch(shared(), /SCENE TRANSITION GUARD|Time\/context:|Location:/);
        settings.transitionGuard = true;
        r.context.chat[0].mes = 'Edited reply.';
        r.source.emit('MESSAGE_EDITED', 0);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.match(shared(), /DIALOGUE CONTINUITY/);
        assert.doesNotMatch(shared(), /Trip|When\?|Tomorrow|Time\/context: Morning/);
        settings.dialogueFlow = false; settings.transitionGuard = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(shared(), '');
        assert.match(r.prompts[PROMPT_KEY], /<sfw_scene>/);
    } finally { r.runtime.stop(); }
});
