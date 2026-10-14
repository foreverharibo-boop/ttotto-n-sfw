import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createRuntime, SETTINGS_KEY, META_KEY, PROMPT_KEY } from '../runtime.js';

globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const sfw = { location: 'Room || 방', time: 'Morning || 아침', environment: 'Rain || 비',
    important_objects: { key: 'Desk || 책상' }, characters: { A: { appearance: 'Coat || 코트', position: 'Chair || 의자', holding: 'Cup || 컵', condition: 'Tired || 피곤함' } },
    acts: ['Talk || 대화'], dialogue_beats: ['Question || 질문'], dialogue_flow: { topic: 'Trip || 여행', last_question: 'When? || 언제?', new_facts: ['Tomorrow || 내일'] },
    scene_type: 'conversation', intensity: 4, stage: 2, next: ['Plan || 계획'] };
const nsfw = { location: 'Room || 방', characters: { A: { clothing: 'Coat || 코트', position: 'Chair || 의자', contact: 'Hand || 손' } }, acts: ['Talk || 대화'], dialogue_beats: ['Question || 질문'], heat: 8, stage: 4, next: ['Listen || 듣기'] };
const tags = (heat = 8) => `<scene_state>${JSON.stringify({ ...nsfw, heat })}</scene_state><sfw_scene>${JSON.stringify(sfw)}</sfw_scene>`;

test('Archive cleanup during recovered-message hooks keeps both records and narrative diagnostics valid', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.setDiagnosticsEnabled(true);
        const narrative = 'A opens the window.\n<Info_panel>Morning</Info_panel>';
        const auxiliary = '\n\n<charm_now>{"operations":[]}</charm_now>\n';
        const message = { mes: narrative + tags(8) + auxiliary, swipe_id: 0 };
        r.context.chat.push(message);
        // Reproduce the poll-before-receive order captured during Relay recovery.
        r.runtime.poll();
        const snapshots = Object.fromEntries(['sfw', 'nsfw'].map(kind => [kind, r.runtime.features[kind].snapshotForMessage(message)]));
        assert.match(message.mes, /<charm_now>/, 'comparison must leave the foreign report for its owner');
        for (const kind of ['sfw', 'nsfw']) assert.equal(r.runtime.features[kind].snapshotMatchesMessage(message), true);
        message.mes = narrative; // Archive's completed-block cleanup
        r.source.emit('MESSAGE_RECEIVED', 0);
        for (const kind of ['sfw', 'nsfw']) {
            const feature = r.runtime.features[kind];
            assert.equal(feature.snapshotForMessage(message), snapshots[kind]);
            assert.equal(feature.snapshotMatchesMessage(message), true);
            const events = r.runtime.diagnostics()[kind].events;
            assert.ok(!events.some(e => e.stage === 'cache_invalidated'));
            assert.ok(events.some(e => e.stage === 'body_write' && !e.data.ownWrite && e.data.sameSceneBody));
        }
        await r.runtime.intercept([], 0, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /Room/);
        assert.equal(r.runtime.core.commonSummary().valid, true);
        message.mes = 'A closes the window.\n<Info_panel>Morning</Info_panel>';
        r.source.emit('MESSAGE_EDITED', 0);
        for (const kind of ['sfw', 'nsfw']) assert.equal(r.runtime.features[kind].snapshotMatchesMessage(message), false);
    } finally { r.runtime.stop(); }
});

test('both modes ignore every tag name and contents, while retaining outside text and swipe identity', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        for (const kind of ['sfw', 'nsfw']) {
            const signature = mes => r.runtime.features[kind].messageStateSignature({ mes, swipe_id: 0 });
            const baseline = signature('Before.\nAfter.');
            for (const tag of ['charm_now', 'charm-now', 'charmnow', 'CHARM_NOW']) {
                assert.equal(signature(`Before.\n<${tag}>{"operations":[]}</${tag}>\nAfter.`), baseline);
                assert.equal(signature(`Before.\n<${tag}>changed internal data</${tag}>\nAfter.`), baseline);
            }
            assert.equal(signature('Before.\nAfter.' + tags(8)), baseline);
            assert.equal(signature('Before.\nAfter.' + tags(1)), baseline);
            for (const tag of ['Info_panel', 'dialogue', 'details', 'span', 'custom_state', 'phone-trigger', 'x:state', '기록']) {
                assert.equal(signature(`Before.<${tag}>Morning</${tag}>After.`), signature(`Before.<${tag}>Night</${tag}>After.`));
                assert.equal(signature(`Before.<${tag}>Morning</${tag}>After.`), signature('Before.After.'));
            }
            assert.equal(signature('Before.<unknown>Morning'), signature('Before.<unknown>Night'));
            assert.equal(signature('Before.<unknown>Morning</other>'), signature('Before.'));
            assert.equal(signature('Before.<unknown>Morning<unknown>data</unknown>'), signature('Before.'));
            assert.notEqual(signature('Before.<custom>data</custom>After.'), signature('Before.<custom>data</custom>Changed.'));
            assert.notEqual(signature('Before.\nAfter.'), r.runtime.features[kind].messageStateSignature({ mes: 'Before.\nAfter.', swipe_id: 1 }));
        }
    } finally { r.runtime.stop(); }
});

test('foreign tag cleanup preserves records and is logged without scheduling another analysis', async () => {
    const r = setup({ autoRefine: true }); await r.runtime.start({ withUi: false });
    try {
        r.runtime.setDiagnosticsEnabled(true);
        const message = { mes: 'Reply.\n<phone-trigger action="notify"><data>old</data></phone-trigger>' + tags() };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        assert.match(message.mes, /<phone-trigger/, 'foreign tags stay in the live message');
        for (const next of ['Reply.\n<phone-trigger action="new">changed</phone-trigger>', 'Reply.']) {
            message.mes = next;
            r.source.emit('MESSAGE_EDITED', 0); r.runtime.poll();
            for (const kind of ['sfw', 'nsfw']) {
                assert.equal(r.runtime.features[kind].snapshotMatchesMessage(message), true);
                assert.ok(!r.runtime.diagnostics()[kind].events.some(e => ['refine_scheduled', 'cache_invalidated'].includes(e.stage)));
            }
        }
        const writes = r.runtime.diagnostics().nsfw.events.filter(e => e.stage === 'body_write' && !e.data.ownWrite);
        assert.equal(writes.length, 2);
        assert.ok(writes.every(e => e.data.sameSceneBody));
    } finally { r.runtime.stop(); }
});

for (const kind of ['sfw', 'nsfw']) test(`${kind}: foreign cleanup during analysis keeps the same target and uses one request`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const message = { mes: 'Reply.<phone-trigger>data</phone-trigger>' + tags(kind === 'sfw' ? 0 : 8) };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        let release, started, calls = 0;
        const ready = new Promise(resolve => { started = resolve; });
        r.context.generateRaw = async () => { calls++; started(); return new Promise(resolve => { release = resolve; }); };
        const work = r.runtime.features[kind].runRefine({ manual: true });
        await ready;
        message.mes = 'Reply.';
        r.source.emit('MESSAGE_EDITED', 0);
        release(JSON.stringify(kind === 'sfw' ? sfw : { ...nsfw, scene: sfw }));
        assert.equal(await work, true);
        assert.equal(calls, 1);
        assert.equal(message.mes, 'Reply.');
        assert.equal(r.runtime.features[kind].snapshotMatchesMessage(message), true);
    } finally { r.runtime.stop(); }
});

for (const kind of ['sfw', 'nsfw']) test(`${kind}: verified old signatures migrate before foreign tag removal`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const text = 'Reply.\n<Info_panel>Morning</Info_panel>';
        const message = { mes: text + tags() };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        const feature = r.runtime.features[kind], snapshot = feature.snapshotForMessage(message);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        snapshot.messageSignature = `0:${text.length}:${(hash >>> 0).toString(36)}`;
        snapshot.signatureVersion = 2;
        assert.equal(feature.snapshotMatchesMessage(message), true);
        assert.equal(snapshot.signatureVersion, 3);
        message.mes = 'Reply.';
        assert.equal(feature.snapshotMatchesMessage(message), true);
        // A stale old record must never be blindly relabelled as current.
        snapshot.messageSignature = `0:${text.length}:${(hash >>> 0).toString(36)}`;
        snapshot.signatureVersion = 2;
        message.mes = 'Different reply.\n<Info_panel>Morning</Info_panel>';
        assert.equal(feature.snapshotMatchesMessage(message), false);
        assert.equal(snapshot.signatureVersion, 2);
    } finally { r.runtime.stop(); }
});
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

for (const kind of ['sfw', 'nsfw']) test(`${kind}: real runtime counts new reply slots through delete, regenerate, branch and legacy migration`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const report = tags(kind === 'nsfw' ? 8 : 0).replaceAll('"stage":4', '"stage":6').replaceAll('"stage":2', '"stage":6');
        const add = n => {
            r.context.chat.push({ is_user: true, send_date: `turn-${n}`, mes: 'Question.' }, { mes: `Reply ${n}.` + report });
            r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
        };
        const diag = () => r.runtime.diagnostics()[kind].current;
        add(1); add(2);
        const config = r.runtime.settings().engines[kind];
        config.slowBurnEnabled = true; config.slowBurnIntensity = 'gentle';
        await r.runtime.intercept([], 0, null, 'normal');
        assert.equal(diag().slowBurnCountedTurns, 0);
        assert.equal(diag().slowBurnSessionRemaining, 1);
        add(3);
        await r.runtime.intercept([], 0, null, 'normal');
        assert.equal(diag().slowBurnCountedTurns, 1);
        assert.equal(diag().slowBurnSessionRemaining, 0);
        assert.equal(diag().slowBurnStageRemaining, 0);
        if (kind === 'nsfw') assert.equal(diag().slowBurnConclusionBlocked, false);
        r.context.chat.splice(0, 2); // Removing old history must not subtract an earned turn.
        r.source.emit('MESSAGE_DELETED', 0);
        assert.equal(diag().slowBurnCountedTurns, 1);
        r.context.chat.pop(); r.source.emit('MESSAGE_DELETED', 3);
        r.source.emit('GENERATION_STARTED', 'regenerate');
        r.context.chat.push({ mes: 'Replacement reply.' + report });
        r.source.emit('MESSAGE_RECEIVED', 3); r.source.emit('GENERATION_ENDED', 'regenerate');
        await r.runtime.intercept([], 0, null, 'regenerate');
        assert.equal(diag().slowBurnCountedTurns, 1);
        assert.equal(diag().slowBurnStageRemaining, 0);
        // Branch before activation. Baseline identities follow the copied
        // conversation; the old absolute count must not become a debt.
        r.context.chat = structuredClone(r.context.chat.slice(0, 2));
        r.context.chatMetadata = structuredClone(r.context.chatMetadata);
        r.context.chatId = 'earlier-branch'; r.source.emit('CHAT_CHANGED');
        assert.equal(diag().slowBurnCountedTurns, 0);
        add(4); await r.runtime.intercept([], 0, null, 'normal');
        assert.equal(diag().slowBurnCountedTurns, 1);
        assert.equal(diag().slowBurnStageRemaining, 0);
        const meta = r.runtime.features[kind].getChatMeta();
        delete meta.slowBurnTurnSession; meta.slowBurnSessionStartAssistantCount = 900;
        assert.equal(diag().slowBurnLegacyRebased, true);
        assert.equal(diag().slowBurnCountedTurns, 0);
        add(5); await r.runtime.intercept([], 0, null, 'normal');
        assert.equal(diag().slowBurnSessionRemaining, 0);
        assert.equal(diag().slowBurnStageRemaining, 0);
    } finally { r.runtime.stop(); }
});

test('common diagnostics switch tracks metadata, exports safely, clears and restores all watchers', async () => {
    const message = { mes: 'PRIVATE_BODY', send_date: '2026-10-14T03:12:00+09:00', extra: { token_count: 1908, display_text: 'PRIVATE_TRANSLATION' } };
    const r = setup({ chat: [message] }); await r.runtime.start({ withUi: false });
    try {
        r.runtime.setDiagnosticsEnabled(true);
        for (const kind of ['sfw', 'nsfw']) assert.equal(r.runtime.settings().engines[kind].diagnosticsEnabled, true);
        message.extra.token_count = 3095;
        const report = r.runtime.diagnostics();
        assert.equal(report.version, '0.2.15');
        assert.ok(report.conflicts.events.some(row => row.stage === 'field_write' && row.data.after.number === 3095));
        assert.doesNotMatch(JSON.stringify(report), /PRIVATE_BODY|PRIVATE_TRANSLATION/);
        r.runtime.clearDiagnostics(); assert.equal(r.runtime.diagnostics().conflicts.events.length, 0);
        r.runtime.setDiagnosticsEnabled(false);
        assert.equal(r.runtime.diagnosticsEnabled(), false);
        for (const [target, key] of [[message, 'mes'], [message, 'send_date'], [message.extra, 'token_count']]) {
            assert.equal(Object.getOwnPropertyDescriptor(target, key).get, undefined);
        }
        assert.equal(message.mes, 'PRIVATE_BODY'); assert.equal(message.extra.token_count, 3095);
    } finally { r.runtime.stop(); }
});

for (const kind of ['sfw', 'nsfw']) test(`${kind}: internal operation links survive await and identify stale record rejection`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.context.chat.push({ mes: 'PRIVATE_BODY' + tags(kind === 'sfw' ? 0 : 8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        r.runtime.setDiagnosticsEnabled(true);
        let release, started;
        const ready = new Promise(resolve => { started = resolve; });
        r.context.generateRaw = async () => { started(); return new Promise(resolve => { release = resolve; }); };
        const work = r.runtime.features[kind].runRefine({ manual: true }); await ready;
        let report = r.runtime.diagnostics().internal;
        const run = report.events.find(row => row.stage === 'operation_started' && row.data.kind === kind && row.data.name === 'runRefine');
        const request = report.events.find(row => row.stage === 'operation_started' && row.data.kind === kind && row.data.name === 'requestRefine');
        assert.ok(run && request); assert.equal(request.data.parent, run.data.id);
        assert.equal(report.current[`engine_${kind}.refineRunning`].value, true);
        r.runtime.features[kind].getChatMeta().manualState = { state: { location: 'PRIVATE_MANUAL' }, at: Date.now() };
        release(JSON.stringify(kind === 'sfw' ? sfw : { ...nsfw, scene: sfw }));
        assert.equal(await work, false);
        report = r.runtime.diagnostics().internal;
        assert.ok(report.events.some(row => row.stage === 'operation_checkpoint' && row.data.id === run.data.id && row.data.stage === 'return' && row.data.accepted === false));
        assert.ok(report.events.some(row => row.stage === 'operation_finished' && row.data.id === request.data.id));
        assert.equal(report.current[`engine_${kind}.refineRunning`].value, false);
        assert.doesNotMatch(JSON.stringify(r.runtime.diagnostics()), /PRIVATE_BODY|PRIVATE_MANUAL/);
        r.runtime.setDiagnosticsEnabled(false);
        assert.equal(Object.getOwnPropertyDescriptor(r.runtime.features[kind].getChatMeta(), 'manualState').get, undefined);
    } finally { r.runtime.stop(); }
});

test('internal diagnostics record save completion and caught asynchronous failure without changing save results', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.setDiagnosticsEnabled(true);
        r.context.saveChat = async () => 17;
        r.runtime.features.sfw.persistChat(); await new Promise(resolve => setImmediate(resolve));
        assert.ok(r.runtime.diagnostics().internal.events.some(row => row.stage === 'operation_checkpoint' && row.data.stage === 'save_promise_resolved'));
        const error = new Error('PRIVATE_SAVE_ERROR'); error.status = 503;
        r.context.saveChat = async () => { throw error; };
        r.runtime.features.sfw.persistChat(); await new Promise(resolve => setImmediate(resolve));
        const report = r.runtime.diagnostics().internal;
        assert.ok(report.events.some(row => row.stage === 'operation_caught_error' && row.data.status === 503));
        assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SAVE_ERROR/);
    } finally { r.runtime.stop(); }
});

test('NSFW main and existing repair share the observed-stage rule without extra requests or rationale fields', async () => {
    const r = setup({ autoRefine: true }); await r.runtime.start({ withUi: false });
    try {
        const config = r.runtime.settings().engines.nsfw;
        config.slowBurnEnabled = true; config.diagnosticsEnabled = true;
        const message = { mes: 'PRIVATE_SCENE_BODY' + tags(8).replace('"stage":4', '"stage":6') };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        let requests = 0, repairPrompt = '';
        r.context.generateRaw = async ({ prompt }) => {
            requests++; repairPrompt = prompt.map(row => row.content).join('\n');
            return JSON.stringify({ ...nsfw, stage: 5, scene: sfw });
        };
        await r.runtime.intercept([], 1000, null, 'normal');
        const mainPrompt = r.prompts[PROMPT_KEY];
        assert.match(mainPrompt, /Stage 6 requires clear on-page evidence/);
        assert.doesNotMatch(mainPrompt, /peak or conclusion permitted/i);
        assert.equal(requests, 0);
        assert.equal(r.runtime.diagnostics().nsfw.current.stageApplied, 6); // No silent migration.
        assert.equal(await r.runtime.features.nsfw.runRefine({ manual: true }), true);
        assert.equal(requests, 1);
        for (const line of mainPrompt.split('\n').filter(line => /^(Sexual stage scale:|Stage 6 requires|Report observed progress)/.test(line))) {
            assert.ok(repairPrompt.includes(line), line);
        }
        assert.match(repairPrompt, /do not add a rationale field/);
        assert.equal(r.runtime.diagnostics().nsfw.current.stageApplied, 5);
        assert.equal(message.mes, 'PRIVATE_SCENE_BODY');
        r.runtime.poll(); r.runtime.poll();
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.equal(requests, 1);
        assert.doesNotMatch(JSON.stringify(r.runtime.diagnostics()), /PRIVATE_SCENE_BODY/);
        assert.ok(r.runtime.diagnostics().nsfw.events.some(e => e.stage === 'slow_burn_policy_composed' && e.data.stageApplied === 6));
    } finally { r.runtime.stop(); }
});

test('NSFW stage policy is absent when disabled or monitoring, including repair requests', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        let prompt = '', requests = 0;
        r.context.generateRaw = async (args) => {
            requests++; prompt = args.prompt.map(row => row.content).join('\n');
            const state = { ...nsfw, heat: 0, scene: sfw }; delete state.stage;
            return JSON.stringify(state);
        };
        r.context.chat.push({ mes: 'Monitoring.' + tags(0) }); r.source.emit('MESSAGE_RECEIVED', 0);
        r.runtime.settings().engines.nsfw.slowBurnEnabled = true;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /Stage 6 requires clear on-page evidence/);
        assert.equal(await r.runtime.features.nsfw.runRefine({ manual: true }), true);
        assert.doesNotMatch(prompt, /Stage 6 requires clear on-page evidence/);
        r.runtime.settings().engines.nsfw.slowBurnEnabled = false;
        r.context.chat.push({ mes: 'Active.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 1);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /Stage 6 requires clear on-page evidence/);
        assert.equal(await r.runtime.features.nsfw.runRefine({ manual: true }), true);
        assert.doesNotMatch(prompt, /Stage 6 requires clear on-page evidence/);
        assert.equal(requests, 2); // Only the two explicitly requested repairs.
    } finally { r.runtime.stop(); }
});

test('NSFW diagnostics distinguish report, manual selection, progression cap and conclusion gate', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const config = r.runtime.settings().engines.nsfw;
        config.slowBurnEnabled = true; config.diagnosticsEnabled = true;
        r.context.chat.push({ mes: 'Reply.' + tags(8) }); r.source.emit('MESSAGE_RECEIVED', 0);
        const meta = r.runtime.features.nsfw.getChatMeta();
        meta.slowBurnStageOverride = 5; meta.slowBurnLocked = true;
        await r.runtime.intercept([], 1000, null, 'normal');
        let diag = r.runtime.diagnostics().nsfw.current;
        assert.equal(diag.currentStage, 4); assert.equal(diag.stageApplied, 5);
        assert.equal(diag.stageSource, 'manual'); assert.equal(diag.stageManualOverride, true);
        assert.equal(diag.stageCap, 5); assert.equal(diag.slowBurnConclusionBlocked, true);
        assert.equal(diag.slowBurnLimitReason, 'manual_lock');
        meta.slowBurnLocked = false; meta.slowBurnStageOverride = null;
        await r.runtime.intercept([], 1000, null, 'normal');
        diag = r.runtime.diagnostics().nsfw.current;
        assert.equal(diag.stageApplied, 4); assert.equal(diag.slowBurnLimitReason, 'minimum_turns');
        config.slowBurnEnabled = false;
        diag = r.runtime.diagnostics().nsfw.current;
        assert.equal(diag.slowBurnPolicyActive, false); assert.equal(diag.stageCapPresent, false);
        assert.equal(diag.slowBurnConclusionBlocked, false); assert.equal(diag.slowBurnLimitReason, 'disabled');
    } finally { r.runtime.stop(); }
});

test('unified core traces one write into both diagnostics and distinguishes saved stage from invalidated stage', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    const oldLocation = globalThis.location;
    globalThis.location = { origin: 'http://localhost:8000' };
    try {
        for (const kind of ['sfw', 'nsfw']) r.runtime.settings().engines[kind].diagnosticsEnabled = true;
        r.runtime.settings().engines.nsfw.slowBurnEnabled = true;
        const body = 'R'.repeat(1374) + 'X'.repeat(40);
        const message = { mes: body + tags().replace('"stage":4', '"stage":5') };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        const descriptor = Object.getOwnPropertyDescriptor(message, 'mes');
        assert.equal(typeof descriptor.set, 'function');
        for (const kind of ['sfw', 'nsfw']) {
            const diag = r.runtime.diagnostics()[kind];
            assert.equal(diag.extension, 'ttotto-unified'); assert.equal(diag.mode, kind); assert.equal(diag.version, '0.2.15');
            const writes = diag.events.filter(e => e.stage === 'body_write');
            assert.equal(writes.length, 1); assert.equal(writes[0].data.ownWrite, true);
            assert.equal(writes[0].data.sameSceneBody, true);
            assert.equal(diag.current.currentStage, kind === 'nsfw' ? 5 : 2);
        }
        r.runtime.poll(); assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').set, descriptor.set);
        vm.runInNewContext('message.mes = message.mes.slice(0, -40)', { message },
            { filename: 'http://localhost:8000/scripts/extensions/third-party/test-cleaner/index.js?key=PRIVATE_KEY#PRIVATE_FRAGMENT' });
        r.source.emit('CHARACTER_MESSAGE_RENDERED', 0);
        for (const kind of ['sfw', 'nsfw']) {
            const diag = r.runtime.diagnostics()[kind];
            const writes = diag.events.filter(e => e.stage === 'body_write'); assert.equal(writes.length, 2);
            const write = writes[1].data;
            assert.equal(write.ownWrite, false); assert.equal(write.writerLocated, true);
            assert.equal(write.writeTrace[0].script, '/scripts/extensions/third-party/test-cleaner/index.js');
            assert.equal(write.removedChars, 40); assert.equal(write.addedChars, 0);
            assert.equal(write.removedLetters, 40); assert.equal(write.beforeChars, 1414); assert.equal(write.afterChars, 1374);
            assert.equal(write.cached, false); assert.equal(write.savedStage, kind === 'nsfw' ? 5 : 2);
            assert.equal(diag.current.currentStagePresent, false); assert.equal(diag.current.stageSource, 'unknown');
            assert.equal(diag.current.displayedStage, null);
            assert.ok(diag.events.some(e => e.stage === 'cache_invalidated' && e.data.savedStagePresent));
        }
        assert.equal(r.runtime.owner(), 'nsfw'); assert.equal(r.runtime.settings().engines.nsfw.autoRefine, false);
        const exported = JSON.stringify(r.runtime.diagnostics());
        for (const secret of ['RRRRR', 'XXXXX', 'PRIVATE_KEY', 'PRIVATE_FRAGMENT', 'http://localhost']) assert.ok(!exported.includes(secret));
    } finally { r.runtime.stop(); globalThis.location = oldLocation; }
});

for (const kind of ['sfw', 'nsfw']) test(`${kind}-only diagnostics trace and restore independently of the other recording switch`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines[kind].diagnosticsEnabled = true;
        const message = { mes: 'Reply.' + tags() }; r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        assert.equal(r.runtime.diagnostics()[kind].events.filter(e => e.stage === 'body_write').length, 1);
        assert.equal(r.runtime.diagnostics()[kind === 'sfw' ? 'nsfw' : 'sfw'].events.length, 0);
        message.mes += ' Changed.';
        assert.equal(JSON.parse(JSON.stringify(message)).mes, 'Reply. Changed.');
        r.runtime.features[kind].clearDiagnostics();
        assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').get, undefined);
        r.runtime.poll(); assert.equal(typeof Object.getOwnPropertyDescriptor(message, 'mes').set, 'function');
        r.runtime.settings().engines[kind].diagnosticsEnabled = false;
        r.runtime.features[kind].syncDiagnosticFetch();
        assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').get, undefined);
        assert.equal(message.mes, 'Reply. Changed.');
    } finally { r.runtime.stop(); }
});

test('unified body watchers release on chat change, home screen and runtime shutdown', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines.nsfw.diagnosticsEnabled = true;
        const previous = { mes: 'One' + tags() }; r.context.chat.push(previous); r.source.emit('MESSAGE_RECEIVED', 0);
        r.context.chatMetadata = {}; r.context.chatId = 'other'; r.context.chat = [];
        r.source.emit('CHAT_CHANGED'); assert.equal(Object.getOwnPropertyDescriptor(previous, 'mes').get, undefined);
        const current = { mes: 'Two' + tags() }; r.context.chat.push(current); r.source.emit('MESSAGE_RECEIVED', 0);
        r.context.characterId = null; r.runtime.poll(); assert.equal(Object.getOwnPropertyDescriptor(current, 'mes').get, undefined);
        r.context.characterId = 0; r.runtime.poll(); assert.equal(typeof Object.getOwnPropertyDescriptor(current, 'mes').set, 'function');
        r.runtime.stop(); assert.equal(Object.getOwnPropertyDescriptor(current, 'mes').get, undefined);
    } finally { if (r.runtime.active) r.runtime.stop(); }
});

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

for (const kind of ['sfw', 'nsfw']) test(`${kind}: invalidated stage never becomes a stage-one prompt; fresh reports and manual choices recover`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        const config = r.runtime.settings().engines[kind];
        config.slowBurnEnabled = true;
        const stageFive = tags(kind === 'nsfw' ? 8 : 1).replace('"stage":4', '"stage":5').replace('"stage":2', '"stage":5');
        r.context.chat.push({ mes: 'Current scene. ' + 'X'.repeat(40) + stageFive });
        r.source.emit('MESSAGE_RECEIVED', 0);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 5\/6/);
        // Mirrors the logged post-collection 40-character removal, with no
        // assumption about whether a user or another script made the change.
        r.context.chat[0].mes = r.context.chat[0].mes.slice(0, -40);
        r.source.emit('CHARACTER_MESSAGE_RENDERED', 0);
        await r.runtime.intercept([], 1000, null, 'normal');
        const unknown = r.prompts[PROMPT_KEY];
        assert.match(unknown, /CURRENT STAGE UNCONFIRMED/);
        assert.doesNotMatch(unknown, /CURRENT STAGE \d\/6|MAXIMUM CHARACTER-INITIATED STAGE|current cap \d/);
        assert.equal(r.runtime.features[kind].currentState().state, null);
        assert.equal(r.context.chat[0].extra.ttottoUnifiedScene.modes[kind].swipes['0'].state.stage, 5);
        assert.equal(r.runtime.diagnostics()[kind].current.stageSource, 'unknown');
        // Existing explicit user controls still work even without a report.
        const meta = r.runtime.features[kind].getChatMeta();
        meta.slowBurnStageOverride = 4; meta.slowBurnLocked = true;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 4\/6/);
        assert.match(r.prompts[PROMPT_KEY], /STAGE LOCKED BY USER/);
        meta.slowBurnStageOverride = null; meta.slowBurnLocked = false;
        config.developerMode = true;
        Object.assign(meta, { slowBurnTarget: 'Discuss the plan', slowBurnTargetTurns: 3, slowBurnTargetActive: true });
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /USER-TARGET SLOW-BURN LOCK/);
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /CURRENT STAGE UNCONFIRMED/);
        meta.slowBurnTargetActive = false;
        r.context.chat.push({ mes: 'Verified continuation.' + stageFive }); r.source.emit('MESSAGE_RECEIVED', 1);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 5\/6/);
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /CURRENT STAGE UNCONFIRMED/);
        assert.equal(r.runtime.diagnostics()[kind].current.stageSource, 'reported');
        // A consistent new beginning remains stage 1; heat alone must not force 5.
        r.context.chat.push({ mes: 'A new beginning.' + stageFive.replaceAll('"stage":5', '"stage":1').replace('"heat":8', '"heat":5') });
        r.source.emit('MESSAGE_RECEIVED', 2);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 1\/6/);
    } finally { r.runtime.stop(); }
});

for (const [heat, stage] of [[7, 1], [8, 1], [10, 2]]) test(`NSFW heat ${heat}/stage ${stage}: fresh and cached conflicts cannot cap the ongoing scene`, async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    let requests = 0;
    r.context.generateRaw = async () => { requests++; throw Error('Unexpected AI call'); };
    try {
        const config = r.runtime.settings().engines.nsfw;
        config.slowBurnEnabled = true; config.diagnosticsEnabled = true;
        const report = tags(heat).replace('"stage":4', `"stage":${stage}`);
        const message = { mes: 'Ongoing scene.' + report };
        r.context.chat.push(message); r.source.emit('MESSAGE_RECEIVED', 0);
        const saved = structuredClone(message.extra.ttottoUnifiedScene);
        for (const reload of [false, true]) {
            if (reload) { r.runtime.stop(); await r.runtime.start({ withUi: false }); }
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.equal(r.runtime.owner(), 'nsfw');
            assert.equal(r.runtime.settings().engines.nsfw.autoRefine, false);
            const prompt = r.prompts[PROMPT_KEY];
            assert.match(prompt, /CURRENT STAGE UNCONFIRMED/);
            assert.match(prompt, /Reassess BOTH heat and stage/);
            assert.match(prompt, /stage value 1 is a FORMAT PLACEHOLDER/);
            assert.doesNotMatch(prompt, /CURRENT STAGE \d\/6|MAXIMUM CHARACTER-INITIATED STAGE|current cap \d/);
            assert.match(prompt, /clothing: Coat/);
            const diag = r.runtime.diagnostics().nsfw.current;
            assert.equal(diag.currentHeat, heat); assert.equal(diag.currentStage, stage);
            assert.equal(diag.stageSource, 'conflict'); assert.equal(diag.displayedStage, null);
            assert.deepEqual(message.extra.ttottoUnifiedScene, saved);
            assert.equal(requests, 0);
        }
        // Explicit user choices take priority even when the stored report conflicts.
        const meta = r.runtime.features.nsfw.getChatMeta();
        meta.slowBurnStageOverride = 1; meta.slowBurnLocked = true;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 1\/6/);
        assert.match(r.prompts[PROMPT_KEY], /STAGE LOCKED BY USER/);
        assert.equal(r.runtime.diagnostics().nsfw.current.stageSource, 'manual');
        meta.slowBurnStageOverride = 4; meta.slowBurnLocked = false;
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 4\/6/);
        meta.slowBurnStageOverride = null;
        // A fresh consistent report restores detection without rewriting the old one.
        r.context.chat.push({ mes: 'Continuation.' + tags(8).replace('"stage":4', '"stage":5') });
        r.source.emit('MESSAGE_RECEIVED', 1);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 5\/6/);
        assert.doesNotMatch(r.prompts[PROMPT_KEY], /CURRENT STAGE UNCONFIRMED/);
        assert.equal(r.runtime.diagnostics().nsfw.current.stageSource, 'reported');
        assert.deepEqual(message.extra.ttottoUnifiedScene, saved);
        assert.equal(requests, 0);
    } finally { r.runtime.stop(); }
});

test('NSFW conflicting historical reports do not satisfy stage residence after recovery', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines.nsfw.slowBurnEnabled = true;
        r.runtime.settings().engines.nsfw.slowBurnIntensity = 'slow';
        for (const heat of [8, 8, 8, 5]) {
            r.context.chat.push({ mes: 'Scene.' + tags(heat).replace('"stage":4', '"stage":1') });
            r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
            await r.runtime.intercept([], 1000, null, 'normal');
        }
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 1\/6/);
        assert.match(r.prompts[PROMPT_KEY], /MAXIMUM CHARACTER-INITIATED STAGE THIS RESPONSE: 1\/6/);
        r.context.chat.push({ mes: 'Continued scene.' + tags(5).replace('"stage":4', '"stage":1') });
        r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.match(r.prompts[PROMPT_KEY], /MAXIMUM CHARACTER-INITIATED STAGE THIS RESPONSE: 2\/6/);
    } finally { r.runtime.stop(); }
});

test('NSFW conflict guard preserves consistent stages and does not apply sexual heat rules to SFW', async () => {
    const r = setup(); await r.runtime.start({ withUi: false });
    try {
        r.runtime.settings().engines.nsfw.slowBurnEnabled = true;
        r.runtime.settings().engines.nsfw.diagnosticsEnabled = true;
        for (const [heat, stage] of [[8, 4], [8, 5], [10, 6], [5, 1], [6, 2], [8, 3]]) {
            r.context.chat.push({ mes: 'Scene.' + tags(heat).replace('"stage":4', `"stage":${stage}`) });
            r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
            await r.runtime.intercept([], 1000, null, 'normal');
            assert.match(r.prompts[PROMPT_KEY], new RegExp(`CURRENT STAGE ${stage}/6`));
            assert.equal(r.runtime.diagnostics().nsfw.current.stageSource, 'reported');
        }
        // High narrative intensity can coexist with a new SFW scene at stage 1.
        r.runtime.settings().engines.sfw.slowBurnEnabled = true;
        r.context.chat.push({ mes: 'New scene.' + tags(1).replace('"intensity":4', '"intensity":8').replace('"stage":2', '"stage":1') });
        r.source.emit('MESSAGE_RECEIVED', r.context.chat.length - 1);
        await r.runtime.intercept([], 1000, null, 'normal');
        assert.equal(r.runtime.owner(), 'sfw');
        assert.match(r.prompts[PROMPT_KEY], /CURRENT STAGE 1\/6/);
    } finally { r.runtime.stop(); }
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
        assert.equal(display.valid, false); assert.equal(display.state, null);
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
