// Optional contract test against unmodified Silly source functions.
// SILLY_SOURCE_DIR must contain script.js, extensions.js, openai.js at the
// Git blob revisions below (SillyTavern/SillyTavern, retrieved 2026-10-05,
// release commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127).
// No provider request is sent: fetch captures JSON and stops at the boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRuntime, PROMPT_KEY } from '../runtime.js';
const dir = process.env.SILLY_SOURCE_DIR;
const pins = {
    'script.js': '777a2d5983a6283ef9b26726e75192da1e3f3cea',
    'extensions.js': '3c1cd876e603a64af9bc74c6e63e93470d46c2a2',
    'openai.js': 'bab82eec57e0927b809b0571534e96f1b13360e1',
};
function sourceFiles() {
    return Object.fromEntries(Object.entries(pins).map(([file, sha]) => {
        const bytes = readFileSync(`${dir}/${file}`);
        assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), sha, file);
        return [file, bytes.toString()];
    }));
}
function declaration(text, name) {
    const match = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm').exec(text);
    assert.ok(match, name);
    const end = text.indexOf('\n}', match.index);
    return text.slice(match.index, end + 2).replace(/^export /, '');
}
function constant(text, name) {
    const match = new RegExp(`^export const ${name} = \\{[\\s\\S]*?^\\};`, 'm').exec(text);
    assert.ok(match, name); return match[0].replace(/^export /, '');
}
const scene = {
    location: 'ROOM_PROBE', time: 'TIME_PROBE', environment: 'WEATHER_PROBE',
    scene_type: 'conversation', intensity: 4, stage: 2,
    important_objects: { key: 'OBJECT_PROBE' },
    characters: { A: { appearance: 'COAT_PROBE', position: 'CHAIR_PROBE', holding: 'CUP_PROBE', condition: 'TIRED_PROBE' } },
    acts: ['EVENT_PROBE'], dialogue_beats: ['QUESTION_PROBE'],
    dialogue_flow: { topic: 'TOPIC_PROBE', last_question: 'WHEN_PROBE', new_facts: ['TOMORROW_PROBE'] }, next: ['PLAN_PROBE'],
};
const intimate = { location: 'ROOM_PROBE', characters: { A: { clothing: 'COAT_PROBE', position: 'CHAIR_PROBE', contact: 'CONTACT_PROBE' } }, acts: ['EVENT_PROBE'], dialogue_beats: ['QUESTION_PROBE'], next: ['PLAN_PROBE'], stage: 4 };
const commonFacts = ['ROOM_PROBE', 'TIME_PROBE', 'WEATHER_PROBE', 'OBJECT_PROBE', 'COAT_PROBE', 'CHAIR_PROBE', 'CUP_PROBE', 'TIRED_PROBE', 'EVENT_PROBE', 'QUESTION_PROBE', 'TOPIC_PROBE', 'WHEN_PROBE', 'TOMORROW_PROBE', 'PLAN_PROBE'];
const providers = [
    ['openai', 'gpt-4.1'], ['claude', 'claude-sonnet-4'], ['makersuite', 'gemini-2.5-pro'],
    ['vertexai', 'gemini-2.5-pro', 'full'], ['vertexai', 'gemini-2.5-pro', 'express'],
];
for (const [provider, model, auth] of providers) test(`outgoing JSON: ${provider}/${auth ?? 'default'} across collection, transitions and invalidation`, { skip: !dir }, async () => {
    const files = sourceFiles();
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    const boundary = new Error('intentional stop at fetch');
    const captured = [];
    const settings = { chat_completion_source: provider, vertexai_auth_mode: auth, stream_openai: false, n: 1, openai_max_tokens: 1024, temp_openai: 1, top_p_openai: 1, seed: -1, use_sysprompt: true };
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
    const env = vm.createContext({
        console, AbortController, extension_prompts: {}, MAX_INJECTION_DEPTH: 10000,
        manifests: { ttotto: manifest }, sortManifestsByOrder: () => 0,
        substituteParams: value => value ?? '', oai_settings: settings,
        getChatCompletionModel: () => model, getCustomStoppingStrings: () => [],
        openai_max_stop_strings: 4, name1: 'User', name2: 'A', getGroupNames: () => [],
        getReasoningEffort: () => undefined, getVerbosity: () => undefined,
        ToolManager: { canPerformToolCalls: () => false }, power_user: {},
        eventSource: { emit: async () => {} }, event_types: { CHAT_COMPLETION_SETTINGS_READY: 'ready' },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        fetch: async (url, options) => { captured.push({ url, ...options, data: JSON.parse(options.body) }); throw boundary; },
    });
    vm.runInContext([
        constant(files['script.js'], 'extension_prompt_types'), constant(files['script.js'], 'extension_prompt_roles'),
        constant(files['openai.js'], 'chat_completion_sources'),
        ...['setExtensionPrompt', 'getExtensionPromptMaxDepth', 'getExtensionPrompt'].map(name => declaration(files['script.js'], name)),
        declaration(files['extensions.js'], 'runGenerationInterceptors'),
        ...['populationInjectionPrompts', 'createGenerationParameters', 'sendOpenAIRequest'].map(name => declaration(files['openai.js'], name)),
    ].join('\n'), env);
    const events = new EventEmitter();
    const context = { characterId: 0, chatId: 'boundary-chat', chat: [], chatMetadata: {},
        extensionSettings: {
            'ttotto-sfw': { enabled: true, settingsSchemaVersion: 4, autoRefine: false, slowBurnEnabled: false },
            'ttotto-nsfw': { enabled: true, settingsSchemaVersion: 3, adultConfirmed: true, armMode: 'auto', autoRefine: false, slowBurnEnabled: false },
        }, eventSource: events, eventTypes: Object.fromEntries(['MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED'].map(x => [x, x])),
        setExtensionPrompt: env.setExtensionPrompt, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveChat() {},
    };
    const runtime = createRuntime(() => context, { notify: { info() {}, warning() {}, error() {}, success() {} } });
    env[manifest.generate_interceptor] = (...args) => runtime.intercept(...args);
    await runtime.start({ withUi: false });
    const receive = (heat, nestedOnly = false) => {
        context.chat.push({ mes: `Fixture ${context.chat.length}.<scene_state>${JSON.stringify({ ...intimate, heat, ...(nestedOnly ? { scene } : {}) })}</scene_state>${nestedOnly ? '' : `<sfw_scene>${JSON.stringify(scene)}</sfw_scene>`}` });
        events.emit('MESSAGE_RECEIVED', context.chat.length - 1);
    };
    async function send(type = 'normal', stream = false) {
        settings.stream_openai = stream;
        assert.equal(await env.runGenerationInterceptors(context.chat, 32000, type), false);
        const slot = env.extension_prompts[PROMPT_KEY];
        assert.equal(slot.position, 1); assert.equal(slot.depth, 0); assert.equal(slot.role, 0);
        const messages = await env.populationInjectionPrompts([], [{ role: 'user', content: 'Continue the conversation.' }]);
        await assert.rejects(env.sendOpenAIRequest(type, messages), error => error === boundary);
        const request = captured.at(-1);
        assert.equal(request.url, '/api/backends/chat-completions/generate'); assert.equal(request.method, 'POST');
        assert.equal(request.data.chat_completion_source, provider);
        if (auth) assert.equal(request.data.vertexai_auth_mode, auth);
        assert.equal(request.data.stream, stream && type !== 'quiet');
        const injections = request.data.messages.filter(m => m.injected);
        assert.equal(injections.length, slot.value ? 1 : 0, 'one combined injection, no duplicate');
        if (slot.value) { assert.equal(injections[0].role, 'system'); assert.equal(injections[0].content, slot.value.trim()); }
        return injections.map(m => m.content).join('\n');
    }
    try {
        receive(1);
        let prompt = await send();
        assert.equal(runtime.owner(), 'sfw');
        for (const fact of commonFacts) assert.ok(prompt.includes(fact), `SFW: ${fact}`);
        receive(8);
        prompt = await send('normal', true);
        assert.equal(runtime.owner(), 'nsfw');
        for (const fact of [...commonFacts, 'CONTACT_PROBE']) assert.ok(prompt.includes(fact), `NSFW: ${fact}`);
        assert.equal(await send('quiet'), prompt, 'quiet retains the prepared composition');
        prompt = await send('continue');
        for (const fact of commonFacts) assert.ok(prompt.includes(fact), `continue: ${fact}`);
        for (const type of ['swipe', 'regenerate']) {
            events.emit('GENERATION_STARTED', type);
            const index = context.chat.length - 1;
            if (type === 'swipe') { context.chat[index].swipe_id = 1; context.chat[index].swipes = [context.chat[index].mes, 'Pending.']; context.chat[index].mes = 'Pending.'; }
            else context.chat.splice(index, 1, { mes: 'Pending.' });
            prompt = await send(type);
            assert.equal(runtime.owner(), 'nsfw'); assert.ok(!prompt.includes('OBJECT_PROBE'), 'old facts blocked on rewrite');
            events.emit('GENERATION_ENDED', type); receive(8);
        }
        runtime.settings().engines.nsfw.slowBurnEnabled = true;
        context.chat.at(-1).mes = 'Edited after collection.'; events.emit('MESSAGE_EDITED', context.chat.length - 1);
        prompt = await send(); assert.ok(!prompt.includes('OBJECT_PROBE')); assert.equal(runtime.owner(), 'nsfw');
        assert.match(prompt, /CURRENT STAGE UNCONFIRMED/);
        assert.doesNotMatch(prompt, /CURRENT STAGE \d\/6|MAXIMUM CHARACTER-INITIATED STAGE|current cap \d/);
        runtime.settings().engines.nsfw.slowBurnEnabled = false;
        receive(1); prompt = await send(); assert.equal(runtime.owner(), 'sfw');
        for (const fact of commonFacts) assert.ok(prompt.includes(fact), `return: ${fact}`);
        assert.ok(!prompt.includes('CONTACT_PROBE'));
        runtime.settings().engines.sfw.enabled = false; receive(8, true); prompt = await send();
        for (const fact of [...commonFacts, 'CONTACT_PROBE']) assert.ok(prompt.includes(fact), `NSFW-only: ${fact}`);
        context.chatId = 'new-chat'; context.chat = []; context.chatMetadata = {}; events.emit('CHAT_CHANGED');
        prompt = await send(); assert.ok(!prompt.includes('OBJECT_PROBE'));
        context.characterId = undefined; context.chatId = undefined;
        assert.equal(await send(), '');
        runtime.stop(); assert.equal(await send(), '');
        assert.equal(captured.length, 12);
    } finally { if (runtime.active) runtime.stop(); }
});
