import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRuntime, PROMPT_KEY } from '../runtime.js';

globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const sfw = { location: 'Room || 방', time: 'Morning || 아침', environment: 'Rain || 비',
    important_objects: { key: 'Desk || 책상' }, characters: { A: { appearance: 'Coat || 코트', position: 'Chair || 의자', holding: 'Cup || 컵', condition: 'Tired || 피곤함' } },
    acts: ['Talk || 대화'], dialogue_beats: ['Question || 질문'], dialogue_flow: { topic: 'Trip || 여행', last_question: 'When? || 언제?', new_facts: ['Tomorrow || 내일'] },
    scene_type: 'conversation', intensity: 4, stage: 2, next: ['Plan || 계획'] };
const nsfw = { location: 'Room || 방', characters: { A: { clothing: 'Coat || 코트', position: 'Chair || 의자', contact: 'Hand || 손' } }, acts: ['Talk || 대화'], dialogue_beats: ['Question || 질문'], heat: 8, stage: 4, next: ['Listen || 듣기'] };
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


const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
test('late SFW repair cannot replace a newer valid same-body report', async () => {
 const r=setup(); await r.runtime.start({withUi:false});
 try {
  r.runtime.settings().engines.nsfw.enabled=false;
  const msg={mes:'The current reply.'}; r.context.chat.push(msg); r.source.emit('MESSAGE_RECEIVED',0);
  let finish; r.context.generateRaw=()=>new Promise(resolve=>finish=resolve);
  const pending=r.runtime.features.sfw.runRefine({manual:true}); await wait(0);
  msg.mes += '<sfw_scene>'+JSON.stringify({...sfw, location:'NEW_REPORT'})+'</sfw_scene>';
  r.source.emit('MESSAGE_EDITED',0);
  assert.equal(r.runtime.features.sfw.currentState().state.location.en,'NEW_REPORT');
  finish(JSON.stringify({...sfw, location:'OLDER_ANALYSIS'}));
  assert.equal(await pending,false);
  assert.equal(r.runtime.features.sfw.currentState().state.location.en,'NEW_REPORT');
 } finally {r.runtime.stop();}
});
test('changed body preserves stored history but excludes it from current scene and prompt', async()=>{
 const r=setup(); await r.runtime.start({withUi:false});
 try{
  r.runtime.settings().engines.nsfw.enabled=false;
  const msg={mes:'POOL_REPLY<sfw_scene>'+JSON.stringify({...sfw,dialogue_flow:{new_facts:['POOL_FACT']}})+'</sfw_scene>'};
  r.context.chat.push(msg);r.source.emit('MESSAGE_RECEIVED',0);
  msg.mes='WEEKEND_REPLY';r.source.emit('MESSAGE_EDITED',0);
  assert.equal(r.runtime.features.sfw.summary().valid,false);
  assert.equal(r.runtime.features.sfw.summary().state.dialogueFlow.newFacts[0].en,'POOL_FACT');
  assert.equal(r.runtime.core.commonSummary({display:true}).state,null);
  await r.runtime.intercept([],1000,null,'normal');
  assert.ok(!r.prompts[PROMPT_KEY].includes('POOL_FACT'));
 }finally{r.runtime.stop();}
});

test('late NSFW repair cannot replace a newer valid same-body report', async () => {
 const r=setup(); r.context.extensionSettings['ttotto-nsfw'].armMode='manual';
 await r.runtime.start({withUi:false});
 try {
  const msg={mes:'The current reply.'}; r.context.chat.push(msg); r.source.emit('MESSAGE_RECEIVED',0);
  let finish; r.context.generateRaw=()=>new Promise(resolve=>finish=resolve);
  const pending=r.runtime.features.nsfw.runRefine({manual:true}); await wait(0);
  msg.mes += '<scene_state>'+JSON.stringify({...nsfw, location:'NEW_REPORT'})+'</scene_state>';
  r.source.emit('MESSAGE_EDITED',0);
  assert.equal(r.runtime.features.nsfw.currentState().state.location.en,'NEW_REPORT');
  finish(JSON.stringify({...nsfw, location:'OLDER_ANALYSIS'}));
  assert.equal(await pending,false);
  assert.equal(r.runtime.features.nsfw.currentState().state.location.en,'NEW_REPORT');
 } finally {r.runtime.stop();}
});


for (const kind of ['sfw', 'nsfw']) {
 for (const change of ['replace-manual', 'edit-in-place', 'clear-records', 'none']) {
  test(`${kind}: pending repair respects ${change}`, async () => {
   const record = kind === 'sfw' ? sfw : nsfw;
   const tag = kind === 'sfw' ? 'sfw_scene' : 'scene_state';
   const message = { mes: `Reply.<${tag}>${JSON.stringify(record)}</${tag}>` };
   const r = setup({ chat: [message] });
   if (kind === 'sfw') r.context.extensionSettings['ttotto-nsfw'].enabled = false;
   else r.context.extensionSettings['ttotto-nsfw'].armMode = 'manual';
   await r.runtime.start({ withUi: false });
   try {
    const feature = r.runtime.features[kind];
    const meta = feature.getChatMeta();
    const initial = feature.summary().state;
    if (change === 'edit-in-place') meta.manualState = { state: structuredClone(initial), at: Date.now(), source: 'manual' };
    let finish;
    r.context.generateRaw = () => new Promise(resolve => { finish = resolve; });
    const pending = feature.runRefine({ manual: true });
    await wait(0);
    if (change === 'replace-manual') meta.manualState = { state: { ...initial, location: { en: 'Manual', ko: '' } }, at: Date.now(), source: 'manual' };
    if (change === 'edit-in-place') meta.manualState.state.location.en = 'Manual';
    if (change === 'clear-records') r.runtime.core.clearRecords(message, kind);
    finish(JSON.stringify({ ...record, location: 'Refined' }));
    assert.equal(await pending, change === 'none');
    if (change === 'none') assert.equal(feature.currentState().state.location.en, 'Refined');
    else if (change === 'clear-records') assert.equal(feature.summary().state, null);
    else {
     assert.equal(meta.manualState.state.location.en, 'Manual');
     assert.equal(feature.summary().state.location.en, 'Room');
    }
   } finally { r.runtime.stop(); }
  });
 }
 test(`${kind}: display uses only the current validated state, preserving current-body and manual fallbacks`, () => {
  const source = readFileSync(new URL(`../modes/${kind}/index.js`, import.meta.url), 'utf8');
  const start = source.indexOf('function stateForDisplay() {');
  const fn = source.slice(start, source.indexOf('\n}', start) + 2);
  let current = { state: null, source: 'body-changed' };
  const sandbox = { effectiveState: () => current, snapshotForMessage: () => ({ state: { location: 'OLD' } }), assistantMessages: () => [{}] };
  vm.runInNewContext(fn + '\nthis.display = stateForDisplay;', sandbox);
  assert.equal(sandbox.display().state, null);
  for (const reason of ['manual', 'ai-refine', 'body-changed']) {
   current = { state: { location: 'Current body or manual' }, source: reason };
   assert.equal(sandbox.display(), current);
  }
 });
}

test('SFW candidate display never reuses a mismatched saved report', () => {
 const source = readFileSync(new URL('../modes/sfw/index.js', import.meta.url), 'utf8');
 const start = source.indexOf('function nextBeatReport(');
 const fn = source.slice(start, source.indexOf('\n}', start) + 2);
 let valid = false;
 const state = { next: ['OLD_CANDIDATE'] };
 const sandbox = { getChatMeta: () => ({}), assistantMessages: () => [{}], unifiedHost: { isMode: () => true },
  isPendingAssistant: () => false, snapshotForMessage: () => ({ state }), snapshotMatchesMessage: () => valid };
 vm.runInNewContext(fn + '\nthis.report = nextBeatReport;', sandbox);
 assert.equal(sandbox.report({ forDisplay: true }).state, null);
 assert.equal(sandbox.report().state, null);
 valid = true;
 assert.equal(sandbox.report({ forDisplay: true }).state, state);
});
