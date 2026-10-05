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
    const source = new EventEmitter(), prompts = {}, toasts = [], writes = [];
    const eventTypes = Object.fromEntries(['GENERATION_STARTED', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHAT_CHANGED', 'CHAT_CREATED', 'CONNECTION_PROFILE_LOADED'].map(name => [name, name]));
    const context = { characterId: 0, chatId: 'test-chat', chat, chatMetadata: {}, extensionSettings: {
        'ttotto-sfw': { enabled: true, settingsSchemaVersion: 4, autoRefine, slowBurnEnabled: false, futureField: { keep: 42 } },
        'ttotto-nsfw': { enabled: true, settingsSchemaVersion: 3, adultConfirmed: true, armMode: 'auto', autoRefine, slowBurnEnabled: false },
    }, eventSource: source, eventTypes, setExtensionPrompt(key, value) { prompts[key] = value; writes.push({ key, value }); },
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveChat() {}, generateRaw: async () => { throw Error('Unexpected AI call'); } };
    const runtime = createRuntime(() => context, { notify: Object.fromEntries(['info', 'warning', 'error', 'success'].map(level => [level, text => toasts.push([level, text])])) });
    return { runtime, context, source, prompts, toasts, writes };
}

test('all report fields survive dual capture, native tag stripping, and separate stage meanings', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.source.emit('GENERATION_STARTED', 'normal');
        r.context.chat.push({ mes: 'A quiet exchange.' + tags(), is_user: false });
        r.source.emit('MESSAGE_RECEIVED', 0);
        const message = r.context.chat[0];
        const s = message.extra.ttottoUnifiedScene.modes.sfw.swipes['0'].state;
        const n = message.extra.ttottoUnifiedScene.modes.nsfw.swipes['0'].state;
        assert.equal(s.characters.A.condition.ko, '피곤함'); assert.equal(s.characters.A.holding.ko, '컵');
        assert.equal(n.characters.A.contact.ko, '손'); assert.equal(n.characters.A.clothing.ko, '코트');
        assert.equal(s.time.ko, '아침'); assert.equal(s.environment.ko, '비'); assert.equal(s.importantObjects.key.ko, '책상');
        assert.equal(s.dialogueFlow.lastQuestion.ko, '언제?'); assert.equal(s.dialogueFlow.newFacts[0].ko, '내일');
        assert.equal(s.intensity, 4); assert.equal(n.heat, 8); assert.equal(s.stage, 2); assert.equal(n.stage, 4);
        assert.equal(s.next[0].ko, '계획'); assert.equal(n.next[0].ko, '듣기');
        assert.equal(message.mes, 'A quiet exchange.');
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.equal(r.runtime.features.sfw.summary().valid, true);
        assert.equal(r.runtime.features.nsfw.summary().valid, true);
    } finally { r.runtime.stop(); }
});

test('body edits invalidate records without treating unknown heat as scene end; low heat releases', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'A quiet exchange with details.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        r.context.chat[0].mes = 'A quiet exchange.'; r.source.emit('MESSAGE_EDITED', 0); r.runtime.poll();
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.equal(r.runtime.features.sfw.summary().valid, false);
        assert.equal(r.runtime.features.nsfw.summary().valid, false);
        r.context.chat.push({ mes: 'Next reply.' + tags(1) }); r.source.emit('MESSAGE_RECEIVED', 1);
        assert.equal(r.runtime.owner(), 'sfw');
        assert.equal(r.runtime.features.sfw.summary().valid, true);
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
        assert.deepEqual(message.extra.ttottoUnifiedScene.modes.sfw.swipes, beforeExtra.swipes);
        r.runtime.settings().engines.sfw.futureField.keep = 5;
        message.extra.ttottoUnifiedScene.modes.sfw.swipes[1].state.location = 'Changed';
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
        assert.equal(r.runtime.features.sfw.summary().valid, false);
        assert.equal(r.runtime.features.nsfw.summary().valid, false);
        assert.ok(message.extra.ttottoUnifiedScene.modes.sfw.swipes[0]); assert.equal(message.extra.ttottoUnifiedScene.modes.sfw.swipes[1], undefined);
        r.context.chat = []; r.context.chatMetadata = {}; r.source.emit('CHAT_CHANGED');
        assert.equal(r.runtime.features.sfw.summary().state, null);
        assert.equal(r.runtime.features.nsfw.summary().state, null);
    } finally { r.runtime.stop(); }
});

test('disabled branch does not collect or issue new instructions', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines.nsfw.enabled = false;
        r.context.chat.push({ mes: 'New reply.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.context.chat[0].extra.ttottoUnifiedScene.modes.nsfw, undefined);
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
        assert.equal(await r.runtime.features.nsfw.runRefine({ manual: true }), true);
        assert.equal(calls.length, 1); assert.equal(calls[0].id, 'analysis-profile');
        assert.equal(calls[0].options.stream, false);
        assert.equal(r.context.chat[0].extra.ttottoUnifiedScene.modes.nsfw.swipes[0].state.heat, 8);
        assert.equal(r.context.chat[0].extra.ttottoNsfw, undefined);
    } finally { r.runtime.stop(); }
});

test('passive SFW collection keeps the exact explicit panel time while NSFW owns the reply', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: '<Info_panel>[Date: Friday | 10:15 AM]</Info_panel>' + tags() });
        r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.equal(r.runtime.features.sfw.summary().state.time.en, 'Friday | 10:15 AM');
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
        assert.doesNotMatch(shared(), /PACING:|USER-TARGET LOCK|STAGE CAP/);
        settings.dialogueFlow = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(shared(), /SCENE TRANSITION GUARD/);
        assert.doesNotMatch(shared(), /DIALOGUE CONTINUITY|Trip|When\?|Tomorrow/);
        settings.dialogueFlow = true; settings.transitionGuard = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(shared(), /DIALOGUE CONTINUITY/);
        assert.doesNotMatch(shared(), /SCENE TRANSITION GUARD/);
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


test('home screen does not collect, arm, inject or announce; opening a real chat resumes silently', async () => {
    const r = setup({ chat: [{ mes: 'Unselected report.' + tags() }] });
    r.context.characterId = undefined; r.context.chatId = undefined;
    await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().transitionNotifications = true;
        r.runtime.poll(); r.source.emit('MESSAGE_RECEIVED', 0);
        await r.runtime.intercept(r.context.chat, 0, () => {}, 'normal');
        assert.equal(r.runtime.owner(), 'waiting');
        assert.equal(r.context.chatMetadata[META_KEY], undefined);
        assert.equal(r.context.chat[0].extra, undefined);
        assert.equal(r.prompts[PROMPT_KEY], '');
        r.context.characterId = 0; r.context.chatId = 'real-chat';
        r.source.emit('CHAT_CHANGED'); r.runtime.poll();
        await new Promise(resolve => setTimeout(resolve, 230));
        assert.equal(r.runtime.owner(), 'nsfw');
        assert.ok(r.context.chat[0].extra.ttottoUnifiedScene.modes.nsfw);
        assert.deepEqual(r.toasts, []);
        r.context.characterId = undefined; r.context.chatId = undefined;
        r.source.emit('CHAT_CHANGED'); r.runtime.poll();
        assert.equal(r.runtime.owner(), 'waiting');
        assert.equal(r.prompts[PROMPT_KEY], '');
        r.context.groupId = 'group'; r.context.chatId = 'group-chat';
        assert.equal(r.runtime.chatReady(), true);
    } finally { r.runtime.stop(); }
});


test('intimate next-generation prompt contains all collected common data and native intimate data', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const message = { mes: 'Latest reply.' + tags(), swipe_id: 0, swipes: ['Latest reply.' + tags(), 'Alternative.'] };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        const shared = () => r.prompts[PROMPT_KEY].split('[Shared scene continuity]')[1]?.split('[Unified scene bookkeeping]')[0] || '';
        const settings = r.runtime.settings().engines.sfw;
        Object.assign(settings, { transitionGuard: true, dialogueFlow: true, repeatGuard: true, dialogueBeatGuard: true, nextBeatHints: true });
        r.runtime.settings().engines.nsfw.nextBeatHints = true;
        await r.runtime.intercept([], 1000, null, 'normal');
        for (const text of ['Location: Room', 'Time/context: Morning', 'Environment: Rain', 'Important object "key": Desk', 'appearance: Coat', 'position/posture: Chair', 'holding/carrying: Cup', 'physical condition: Tired', 'Current conversation topic: Trip', 'question awaiting a response: When?', 'Newly established facts: Tomorrow', 'Scene type: conversation', 'Narrative intensity: 4/10', 'Narrative stage: 2/6', '- Talk', '- Question', '): Plan']) assert.ok(shared().includes(text), text);
        assert.match(r.prompts[PROMPT_KEY], /physical contact: Hand/);
        assert.match(r.prompts[PROMPT_KEY], /clothing: Coat/);
        assert.match(r.prompts[PROMPT_KEY], /Listen/);
        assert.equal(message.extra.ttottoUnifiedScene.modes.sfw.swipes['0'].state.stage, 2);
        assert.equal(message.extra.ttottoUnifiedScene.modes.nsfw.swipes['0'].state.stage, 4);
        assert.equal(message.extra.ttottoUnifiedScene.modes.nsfw.swipes['0'].state.heat, 8);
        // Disabling scene-transition/dialogue rules must not discard object/body facts.
        settings.transitionGuard = false; settings.dialogueFlow = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(shared(), /Important object "key": Desk/); assert.match(shared(), /physical condition: Tired/);
        assert.doesNotMatch(shared(), /SCENE TRANSITION GUARD|DIALOGUE CONTINUITY|Current conversation topic:/);
        // Both engines' controls and bans apply to shared hints.
        r.runtime.features.nsfw.getChatMeta().customBans = ['Plan'];
        await r.runtime.intercept([], 1000, null, 'normal'); assert.doesNotMatch(shared(), /SHARED NEXT POSSIBILITIES/);
        r.runtime.features.nsfw.getChatMeta().customBans = [];
        settings.nextBeatHints = false; settings.repeatGuard = false; settings.dialogueBeatGuard = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.doesNotMatch(shared(), /SHARED NEXT POSSIBILITIES|SHARED RECENT EVENTS|SHARED RECENT DIALOGUE/);
        message.mes = 'Edited body.'; r.source.emit('MESSAGE_EDITED', 0);
        await r.runtime.intercept([], 1000, null, 'normal'); assert.doesNotMatch(shared(), /Desk|Cup|Tired|Morning|Plan/);
        message.swipe_id = 1; message.mes = 'Alternative.'; r.source.emit('MESSAGE_SWIPED', 0);
        await r.runtime.intercept([], 1000, null, 'normal'); assert.doesNotMatch(shared(), /Desk|Cup|Tired/);
        r.context.chat.push({ mes: 'Scene finished.' + tags(1) }); r.source.emit('MESSAGE_RECEIVED', 1);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'sfw'); assert.equal(shared(), '');
        assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        r.context.chatId = 'different-chat'; r.context.chat = []; r.context.chatMetadata = {}; r.source.emit('CHAT_CHANGED');
        await r.runtime.intercept([], 1000, null, 'normal'); assert.doesNotMatch(r.prompts[PROMPT_KEY], /Desk|Cup|Tired/);
    } finally { r.runtime.stop(); }
});


test('repeated handoffs publish one complete prompt and preserve both collected schemas', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines.sfw.globalBans = ['GENERAL_BRANCH_LIMIT'];
        r.runtime.settings().engines.nsfw.globalBans = ['INTIMATE_BRANCH_LIMIT'];
        for (const heat of [1, 8, 1, 7, 8, 1]) {
            r.source.emit('GENERATION_STARTED', 'normal');
            r.context.chat.push({ mes: `Reply ${r.context.chat.length}.` + tags(heat) });
            r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
            const expected = heat >= 7 ? 'nsfw' : 'sfw';
            assert.equal(r.runtime.owner(), expected);
            assert.equal(r.runtime.features.sfw.summary().armed, expected === 'sfw');
            assert.equal(r.runtime.features.nsfw.summary().armed, expected === 'nsfw');
            r.writes.length = 0;
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.equal(r.writes.length, 1, 'publish only the complete composition');
            assert.equal(r.writes[0].key, PROMPT_KEY);
            const prompt = r.writes[0].value;
            assert.equal((prompt.match(/\[Scene Continuity Directive\]/g) || []).length, 1);
            assert.match(prompt, new RegExp(expected === 'nsfw' ? 'INTIMATE_BRANCH_LIMIT' : 'GENERAL_BRANCH_LIMIT'));
            assert.doesNotMatch(prompt, new RegExp(expected === 'nsfw' ? 'GENERAL_BRANCH_LIMIT' : 'INTIMATE_BRANCH_LIMIT'));
            assert.match(prompt, /Important object "key": Desk/);
            assert.match(prompt, /holding\/carrying: Cup/);
            assert.equal(r.runtime.features.sfw.summary().valid, true);
            assert.equal(r.runtime.features.nsfw.summary().valid, true);
            const stable = prompt; r.writes.length = 0;
            await r.runtime.intercept([], 1000, null, 'quiet');
            assert.equal(r.writes.length, 0); assert.equal(r.prompts[PROMPT_KEY], stable);
            r.source.emit('GENERATION_ENDED');
        }
    } finally { r.runtime.stop(); }
});

test('both active modes retain style, pacing, bans, hints, CardInject and slow-burn controls', async () => {
    for (const kind of ['sfw', 'nsfw']) {
        const r = setup(); await r.runtime.start({ withUi: false });
        try {
            r.context.characters = [{ name: 'A', avatar: 'a.png' }]; r.context.name1 = 'Reader';
            r.context.extensionSettings.cardinject = { perChar: { 'a.png': { categories: [{ key: 'preferences', name: 'Preferences', content: '{{char}} likes UNIQUE_CARD_FACT with {{user}}.', enabled: false }] } } };
            const config = r.runtime.settings().engines[kind];
            Object.assign(config, { globalBans: ['UNIQUE_HARD_LIMIT'], paceMode: 'hold', styleLength: 'long', styleBalance: 'dialogue', cardLinkEnabled: true, cardLinkSelected: { 'a.png': ['preferences'] }, nextBeatHints: true, dialogueBeatGuard: true });
            r.context.chat.push({ mes: 'Current.' + tags(kind === 'nsfw' ? 8 : 1) }); r.source.emit('MESSAGE_RECEIVED', 0);
            r.runtime.features[kind].getChatMeta().customBans = ['UNIQUE_CHAT_BAN'];
            await r.runtime.intercept([], 1000, null, 'normal');
            const p = r.prompts[PROMPT_KEY];
            for (const text of ['UNIQUE_HARD_LIMIT', 'UNIQUE_CHAT_BAN', 'Length: write a full', 'Balance: dialogue-forward', 'PACING:', 'UNIQUE_CARD_FACT', 'Reader', 'ALREADY HAPPENED', 'DIALOGUE INTENTS ALREADY USED', 'SUGGESTED NEXT BEATS']) assert.ok(p.includes(text), kind + ': ' + text);
            config.slowBurnEnabled = true;
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.match(r.prompts[PROMPT_KEY], /STAGE|stage/);
            assert.doesNotMatch(r.prompts[PROMPT_KEY], /PACING:/);
            assert.equal(r.runtime.owner(), kind);
        } finally { r.runtime.stop(); }
    }
});

test('disabling intimate mode releases SFW and disabling both clears directives', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'Current.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.runtime.owner(), 'nsfw');
        r.runtime.settings().engines.nsfw.enabled = false;
        r.runtime.poll(); await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'sfw');
        assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        r.runtime.settings().engines.sfw.enabled = false;
        r.runtime.poll(); await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.prompts[PROMPT_KEY], '');
        assert.equal(r.runtime.owner(), 'waiting');
    } finally { r.runtime.stop(); }
});

test('chat disable preserves the optional one-shot exit bridge, then hands off to SFW', async () => {
    for (const exitBridge of [false, true]) {
        const r = setup(); await r.runtime.start({ withUi: false });
        try {
            r.context.chat.push({ mes: 'Current.' + tags() }); r.source.emit('MESSAGE_RECEIVED', 0);
            assert.equal(r.runtime.owner(), 'nsfw');
            r.runtime.settings().engines.nsfw.exitBridge = exitBridge;
            const meta = r.runtime.features.nsfw.getChatMeta();
            // Same metadata transition as the native per-chat toggle.
            Object.assign(meta, { enabled: false, autoArmed: false, forceArmed: false, bridgePending: exitBridge });
            r.runtime.poll();
            await r.runtime.intercept([], 1000, null, 'normal');
            if (exitBridge) assert.match(r.prompts[PROMPT_KEY], /\[Scene Wind-Down\]/);
            else {
                assert.equal(r.runtime.owner(), 'sfw');
                assert.doesNotMatch(r.prompts[PROMPT_KEY], /\[Scene Wind-Down\]/);
            }
            assert.equal(meta.bridgePending, false);
            r.context.chat.push({ mes: 'Next ordinary reply.' + tags(1) });
            r.source.emit('MESSAGE_RECEIVED', 1); r.source.emit('GENERATION_ENDED');
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.equal(r.runtime.owner(), 'sfw');
            assert.doesNotMatch(r.prompts[PROMPT_KEY], /\[Scene Wind-Down\]/);
            assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        } finally { r.runtime.stop(); }
    }
});

test('single core runs with all legacy controller entry points disabled and no bridge object', async () => {
    const r = setup();
    for (const feature of Object.values(r.runtime.features)) for (const key of ['registerEvents', 'observeLatestMessage', 'prepareSceneInjection', 'handleIncomingMessage', 'beginSceneGeneration', 'finishSceneGeneration', 'finishReceivedGeneration']) {
        feature[key] = () => { throw new Error(`Legacy controller invoked: ${key}`); };
    }
    await r.runtime.start({ withUi: false });
    try {
        assert.equal(r.runtime.shared, undefined);
        for (const heat of [8, 1, 8, 1]) {
            r.source.emit('GENERATION_STARTED', 'normal');
            r.context.chat.push({ mes: `Turn ${heat}.` + tags(heat) });
            r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
            r.source.emit('GENERATION_ENDED'); r.runtime.poll();
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.equal(r.runtime.owner(), heat === 8 ? 'nsfw' : 'sfw');
            assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
            assert.equal((r.prompts[PROMPT_KEY].match(/\[Scene Continuity Directive\]/g) || []).length, 1);
        }
    } finally { r.runtime.stop(); }
});

test('obsolete cross-engine handoff flags cannot suspend the single core', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'Ordinary reply.' + tags(1) }); r.source.emit('MESSAGE_RECEIVED', 0);
        Object.assign(r.runtime.features.sfw.getChatMeta(), { nsfwSuspended: true, nsfwResumePending: true, nsfwDelegatedAtAssistantCount: 999999 });
        r.runtime.poll(); await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'sfw');
        assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        assert.match(r.prompts[PROMPT_KEY], /Plan/);
        r.context.chat.push({ mes: 'New reply.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 1);
        r.runtime.settings().engines.nsfw.enabled = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'sfw');
    } finally { r.runtime.stop(); }
});

test('one generation queue blocks partial reports across nested quiet events', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.source.emit('GENERATION_STARTED', 'normal');
        const message = { mes: 'Partial.' + tags(8) }; r.context.chat.push(message);
        r.source.emit('GENERATION_STARTED', 'quiet');
        r.source.emit('CHARACTER_MESSAGE_RENDERED', 0); r.runtime.poll();
        assert.equal(message.extra?.ttottoUnifiedScene, undefined);
        r.source.emit('GENERATION_ENDED', 'quiet'); r.runtime.poll();
        assert.equal(message.extra?.ttottoUnifiedScene, undefined);
        assert.equal(r.runtime.diagnostics().core.pendingGenerations, 1);
        message.mes = 'Completed.' + tags(1); r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.runtime.owner(), 'sfw');
        assert.equal(message.extra.ttottoUnifiedScene.modes.nsfw.swipes['0'].state.heat, 1);
        assert.equal(r.runtime.diagnostics().core.pendingGenerations, 0);
    } finally { r.runtime.stop(); }
});

test('swipe and regenerate keep the mode while refusing previous body facts', async () => {
    for (const type of ['swipe', 'regenerate']) {
        const r = setup(); await r.runtime.start({ withUi: false });
        try {
            r.context.chat.push({ mes: 'Old reply.' + tags(8), swipe_id: 0, swipes: ['Old reply.' + tags(8)] }); r.source.emit('MESSAGE_RECEIVED', 0);
            r.source.emit('GENERATION_STARTED', type);
            const next = type === 'swipe' ? r.context.chat[0] : { mes: '...' };
            if (type === 'swipe') { next.swipe_id = 1; next.mes = '...'; }
            else r.context.chat.splice(0, 1, next);
            await r.runtime.intercept([], 1000, null, type);
            assert.equal(r.runtime.owner(), 'nsfw');
            assert.doesNotMatch(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
            next.mes = 'Fresh reply.' + tags(1); r.source.emit('MESSAGE_RECEIVED', 0);
            assert.equal(r.runtime.owner(), 'sfw');
            assert.equal(next.extra.ttottoUnifiedScene.modes.nsfw.swipes[String(next.swipe_id || 0)].state.heat, 1);
        } finally { r.runtime.stop(); }
    }
});

test('chat change resets generation state and never carries previous scene facts', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'Old.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        r.source.emit('GENERATION_STARTED', 'regenerate');
        r.context.chat = []; r.context.chatMetadata = {}; r.context.chatId = 'new'; r.source.emit('CHAT_CHANGED');
        assert.equal(r.runtime.owner(), 'sfw');
        assert.equal(r.runtime.diagnostics().core.pendingGenerations, 0);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /Desk|Cup|Tired/);
        assert.equal(r.runtime.features.sfw.summary().state, null);
    } finally { r.runtime.stop(); }
});

test('0.1.x records migrate into one store, survive serialization and never reimport after clear', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const message = { mes: 'Snapshot.' + tags(8) }; r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        const s = structuredClone(message.extra.ttottoUnifiedScene.modes.sfw);
        const n = structuredClone(message.extra.ttottoUnifiedScene.modes.nsfw);
        s.swipes['3'] = structuredClone(s.swipes['0']);
        message.extra = { ttottoUnifiedSfw: s, ttottoUnifiedNsfw: n };
        assert.equal(r.runtime.features.sfw.summary().valid, true);
        assert.ok(message.extra.ttottoUnifiedScene.modes.sfw.swipes['3']);
        assert.equal(r.runtime.features.nsfw.summary().valid, true);
        message.extra = JSON.parse(JSON.stringify(message.extra));
        r.runtime.core.clearRecords(message, 'nsfw');
        assert.equal(r.runtime.features.nsfw.summary().state, null);
        assert.equal(r.runtime.features.sfw.summary().valid, true);
        message.extra = JSON.parse(JSON.stringify(message.extra));
        assert.equal(r.runtime.features.nsfw.summary().state, null);
        assert.deepEqual(message.extra.ttottoUnifiedSfw, s);
        assert.deepEqual(message.extra.ttottoUnifiedNsfw, n);
    } finally { r.runtime.stop(); }
});

test('late repair cannot restore a mode or records after that mode was disabled', async () => {
    const r = setup({ chat: [{ mes: 'Current.' + tags(8) }] });
    let resolve; const response = new Promise(done => { resolve = done; });
    r.context.extensionSettings['ttotto-nsfw'].refineProfileId = 'profile';
    r.context.ConnectionManagerRequestService = { sendRequest: () => response };
    await r.runtime.start({ withUi: false });
    try {
        const pending = r.runtime.features.nsfw.runRefine({ manual: true });
        r.runtime.settings().engines.nsfw.enabled = false; r.runtime.poll();
        resolve(JSON.stringify({ ...nsfw, location: 'INVALID_LATE_FACT' }));
        assert.equal(await pending, false);
        assert.equal(r.runtime.owner(), 'sfw');
        assert.doesNotMatch(JSON.stringify(r.context.chat[0].extra.ttottoUnifiedScene), /INVALID_LATE_FACT/);
    } finally { r.runtime.stop(); }
});

test('exit completion without MESSAGE_RECEIVED cannot leave the core in wind-down', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'First.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        const meta = r.runtime.features.nsfw.getChatMeta();
        Object.assign(meta, { enabled: false, autoArmed: false, bridgePending: true });
        r.source.emit('GENERATION_STARTED', 'normal');
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /\[Scene Wind-Down\]/);
        r.context.chat.push({ mes: 'Settled.' + tags(1) });
        r.source.emit('GENERATION_ENDED', 'normal');
        assert.equal(r.runtime.owner(), 'sfw');
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /\[Scene Wind-Down\]/);
        assert.match(r.prompts[PROMPT_KEY], /Desk/);
    } finally { r.runtime.stop(); }
});

test('automatic repair still runs through the selected profile and saves central records', async () => {
    const r = setup({ autoRefine: true, chat: [{ mes: 'Missing state.' }] });
    r.context.extensionSettings['ttotto-nsfw'].enabled = false;
    r.context.extensionSettings['ttotto-sfw'].refineProfileId = 'repair-profile';
    const calls = [];
    r.context.ConnectionManagerRequestService = { async sendRequest(id) { calls.push(id); return JSON.stringify(sfw); } };
    await r.runtime.start({ withUi: false });
    try {
        await new Promise(resolve => setTimeout(resolve, 1050));
        assert.deepEqual(calls, ['repair-profile']);
        assert.equal(r.runtime.features.sfw.summary().valid, true);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        assert.ok(r.context.chat[0].extra.ttottoUnifiedScene.modes.sfw.swipes['0']);
    } finally { r.runtime.stop(); }
});

test('diagnostics retain receive/body/collection evidence while central state is authoritative', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        for (const kind of ['sfw', 'nsfw']) r.runtime.settings().engines[kind].diagnosticsEnabled = true;
        r.context.chat.push({ mes: 'Evidence.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        const report = r.runtime.diagnostics();
        for (const kind of ['sfw', 'nsfw']) {
            assert.ok(report[kind].events.some(e => e.stage === 'message_received'));
            assert.ok(report[kind].events.some(e => e.stage === 'response_observed'));
            assert.ok(report[kind].events.some(e => e.stage === 'collection_result'));
        }
        assert.equal(report.core.mode, 'nsfw');
        assert.doesNotMatch(JSON.stringify(report), /Evidence\./);
    } finally { r.runtime.stop(); }
});

test('intimate-only report collects and injects objects and full character facts with SFW disabled', async () => {
    const r = setup(); r.context.extensionSettings['ttotto-sfw'].enabled = false;
    await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'Full record.' + `<scene_state>${JSON.stringify({ ...nsfw, scene: sfw })}</scene_state>` });
        r.source.emit('MESSAGE_RECEIVED', 0);
        const state = r.runtime.core.commonSummary();
        assert.equal(r.runtime.owner(), 'nsfw'); assert.equal(state.valid, true);
        assert.equal(state.state.importantObjects.key.en, 'Desk');
        assert.equal(state.state.characters.A.holding.en, 'Cup');
        assert.equal(state.state.characters.A.condition.en, 'Tired');
        assert.equal(state.state.stage, 2); assert.equal(r.runtime.features.nsfw.summary().state.stage, 4);
        assert.equal(r.context.chat[0].extra.ttottoUnifiedScene.modes.sfw, undefined);
        await r.runtime.intercept([], 0, null, 'normal');
        for (const text of ['Important object "key": Desk', 'holding/carrying: Cup', 'physical condition: Tired', '"scene" object']) assert.ok(r.prompts[PROMPT_KEY].includes(text), text);
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /<sfw_scene>/);
        r.context.chat[0].mes = 'Edited record.'; r.source.emit('MESSAGE_EDITED', 0);
        assert.equal(r.runtime.core.commonSummary().state, null);
        const display = r.runtime.core.commonSummary({ display: true });
        assert.equal(display.valid, false); assert.equal(display.state.importantObjects.key.en, 'Desk');
        await r.runtime.intercept([], 0, null, 'normal');
        assert.ok(!r.prompts[PROMPT_KEY].includes('Important object "key": Desk'));
        r.context.chat[0].swipe_id = 1;
        assert.equal(r.runtime.core.commonSummary({ display: true }).state, null);
    } finally { r.runtime.stop(); }
});

test('intimate repair requests, saves and reinjects its full scene record', async () => {
    const r = setup({ chat: [{ mes: 'Scene without report.' }] });
    r.context.extensionSettings['ttotto-sfw'].enabled = false;
    r.context.extensionSettings['ttotto-nsfw'].armMode = 'manual';
    let request;
    r.context.generateRaw = async ({ prompt }) => { request = prompt; return JSON.stringify({ ...nsfw, scene: sfw }); };
    await r.runtime.start({ withUi: false });
    try {
        assert.equal(await r.runtime.features.nsfw.runRefine({ manual: true }), true);
        assert.ok(JSON.stringify(request).includes('important_objects'));
        assert.equal(r.runtime.core.commonSummary().state.characters.A.condition.en, 'Tired');
        await r.runtime.intercept([], 0, null, 'normal');
        assert.ok(r.prompts[PROMPT_KEY].includes('Important object "key": Desk'));
    } finally { r.runtime.stop(); }
});

test('full intimate report makes scene facts available on a same-response SFW return', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        for (const heat of [8, 1]) {
            r.context.chat.push({ mes: `Reply ${heat}.<scene_state>${JSON.stringify({ ...nsfw, heat, scene: sfw })}</scene_state>` });
            r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
        }
        assert.equal(r.runtime.owner(), 'sfw');
        assert.equal(r.runtime.features.sfw.summary().state.importantObjects.key.en, 'Desk');
        await r.runtime.intercept([], 0, null, 'normal');
        assert.ok(r.prompts[PROMPT_KEY].includes('Important object "key": Desk'));
    } finally { r.runtime.stop(); }
});

test('intimate lists include nested scene events and hints once, retaining exclusions', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const scene = { ...sfw, acts: [...sfw.acts, 'Open window || 창문 열기'] };
        r.context.chat.push({ mes: 'Current scene.' + `<scene_state>${JSON.stringify({ ...nsfw, scene })}</scene_state>` });
        r.source.emit('MESSAGE_RECEIVED', 0);
        const before = r.runtime.features.nsfw.buildInjection();
        assert.ok(before.includes('Open window'));
        assert.ok(before.includes('Plan'));
        const meta = r.runtime.features.nsfw.getChatMeta();
        meta.ignoredActs.push('Open window', 'Plan');
        const after = r.runtime.core.compose();
        assert.ok(!after.includes('Open window'));
        assert.ok(!after.includes('Plan'));
        assert.equal(r.runtime.core.commonSummary().state.characters.A.holding.en, 'Cup');
        assert.equal(r.runtime.features.nsfw.currentState().state.characters.A.contact.en, 'Hand');
    } finally { r.runtime.stop(); }
});

test('failed injection clears old facts, preserves a pending bridge and permits recovery', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        for (const kind of ['sfw', 'nsfw']) r.runtime.settings().engines[kind].diagnosticsEnabled = true;
        r.context.chat.push({ mes: 'Before failure.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        await r.runtime.intercept([], 0, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        const feature = r.runtime.features.nsfw, original = feature.buildInjection;
        feature.buildInjection = () => { throw Error('private dialogue must not be exported'); };
        await assert.doesNotReject(r.runtime.intercept([], 0, null, 'normal'));
        assert.equal(r.prompts[PROMPT_KEY], '');
        for (const kind of ['sfw', 'nsfw']) {
            const diagnostic = r.runtime.diagnostics()[kind];
            assert.ok(diagnostic.events.some(e => e.stage === 'injection_error' && e.data.cleared));
            assert.doesNotMatch(JSON.stringify(diagnostic), /private dialogue/);
        }
        feature.buildInjection = original;
        await r.runtime.intercept([], 0, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /Important object "key": Desk/);
        const meta = feature.getChatMeta();
        r.runtime.settings().engines.nsfw.exitBridge = true;
        Object.assign(meta, { enabled: false, autoArmed: false, forceArmed: false, bridgePending: true });
        const publish = r.context.setExtensionPrompt;
        r.context.setExtensionPrompt = (key, value) => { if (value) throw Error('host write failed'); publish(key, value); };
        await assert.doesNotReject(r.runtime.intercept([], 0, null, 'normal'));
        assert.equal(r.prompts[PROMPT_KEY], '');
        assert.equal(meta.bridgePending, true);
        r.context.setExtensionPrompt = publish;
        await r.runtime.intercept([], 0, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /\[Scene Wind-Down\]/);
        assert.equal(meta.bridgePending, false);
    } finally { r.runtime.stop(); }
});

test('settled, invalidated and chat-change diagnostics reflect collection without poll flooding', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        for (const kind of ['sfw', 'nsfw']) r.runtime.settings().engines[kind].diagnosticsEnabled = true;
        r.context.chat.push({ mes: 'Collected.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        for (const kind of ['sfw', 'nsfw']) assert.ok(r.runtime.diagnostics()[kind].events.some(e => e.stage === 'collection_settled' && e.data.cached));
        r.context.chat[0].mes = 'Changed body.'; r.source.emit('MESSAGE_EDITED', 0);
        const before = r.runtime.diagnostics();
        for (const kind of ['sfw', 'nsfw']) assert.ok(before[kind].events.some(e => e.stage === 'cache_invalidated' && e.data.reason === 'body_signature_mismatch'));
        r.runtime.poll(); r.runtime.poll();
        for (const kind of ['sfw', 'nsfw']) assert.deepEqual(r.runtime.diagnostics()[kind].events.filter(e => e.stage === 'cache_invalidated'), before[kind].events.filter(e => e.stage === 'cache_invalidated'));
        r.context.chatId = 'another'; r.context.chat = []; r.context.chatMetadata = {};
        r.source.emit('CHAT_CHANGED');
        for (const kind of ['sfw', 'nsfw']) assert.ok(r.runtime.diagnostics()[kind].events.some(e => e.stage === 'chat_changed'));
        assert.equal(r.prompts[PROMPT_KEY], '');
    } finally { r.runtime.stop(); }
});
