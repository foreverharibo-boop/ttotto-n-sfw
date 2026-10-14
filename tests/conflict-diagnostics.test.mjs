import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createConflictDiagnostics } from '../conflict-diagnostics.js';

test('generation evidence keeps caller, safe type flags and body writes despite UI log pressure', async t => {
    const f = setup(t), original = console.log;
    console.log = () => {};
    t.after(() => { f.tracker.stop(); console.log = original; });
    f.raw.eventTypes = { GENERATION_STARTED: 'started' };
    f.raw.eventSource = { emit() { return 27; } };
    f.tracker.sync();
    const generate = vm.runInNewContext('(async function(){console.log("Generate entered");await Promise.resolve();return source.emit("started","continue",{automatic_trigger:false,quietToLoud:false,quiet_prompt:"PRIVATE_PROMPT"},false)})',
        { console, source: f.raw.eventSource }, { filename: 'http://local/script.js' });
    const task = vm.runInNewContext('generate()', { generate }, { filename: 'http://local/scripts/extensions/third-party/caller/index.js?PRIVATE' });
    assert.equal(await task, 27);
    f.tracker.bodyEvent('body_write', f.raw.chat[0], { beforeChars: 5, afterChars: 10, ownWrite: false });
    for (let i = 0; i < 1000; i++) f.tracker.event('CHARACTER_MESSAGE_RENDERED');
    const trace = f.tracker.report().generationTrace;
    assert.equal(trace.events.length, 3);
    assert.ok(trace.events[0].data.writeTrace.some(frame => frame.script?.includes('/caller/')));
    assert.equal(trace.events[0].data.nativeEntryLocated, true);
    assert.equal(trace.events[1].data.generationType, 'continue');
    assert.equal(trace.events[1].data.automatic_trigger, false);
    assert.equal(trace.events[1].data.dryRun, false);
    assert.equal(trace.events[2].stage, 'body_write');
    assert.doesNotMatch(JSON.stringify(trace), /PRIVATE|quiet_prompt/);
    f.tracker.clear();
    assert.equal(f.tracker.report().generationTrace.events.length, 0);
});

test('generation details avoid getters and unknown values, remain bounded and stop when disabled', t => {
    const f = setup(t), original = console.log;
    console.log = () => {};
    t.after(() => { f.tracker.stop(); console.log = original; });
    f.raw.eventTypes = { GENERATION_STARTED: 'started' };
    f.raw.eventSource = { emit() {} };
    f.tracker.sync();
    const options = {};
    Object.defineProperty(options, 'quietToLoud', { get() { throw Error('getter must not run'); } });
    f.raw.eventSource.emit('started', 'PRIVATE_UNKNOWN_TYPE', options, false);
    const detail = f.tracker.report().generationTrace.events[0].data;
    assert.equal(detail.generationType, 'unknown');
    assert.ok(!('quietToLoud' in detail));
    for (let i = 0; i < 180; i++) console.log('Generate entered');
    const trace = f.tracker.report().generationTrace;
    assert.equal(trace.events.length, 160);
    assert.equal(trace.dropped, 21);
    f.state.enabled = false;
    console.log('Generate entered');
    assert.equal(f.tracker.report().generationTrace.dropped, 21);
});

function setup(t, { enabled = true } = {}) {
    const previous = Object.fromEntries(['document', 'location', 'MutationObserver', 'addEventListener', 'removeEventListener'].map(k => [k, globalThis[k]]));
    const raw = { chat: [{ mes: 'PRIVATE_DIALOGUE', send_date: '2026-10-14T03:12:00+09:00', gen_started: '2026-10-14T03:11:07.200+09:00', gen_finished: '2026-10-14T03:12:00+09:00', swipe_id: 0, extra: { token_count: 1908, display_text: 'PRIVATE_TRANSLATION' } }], chatMetadata: {}, chatId: 'PRIVATE_CHAT' };
    const state = { enabled, callback: null, disconnected: 0 }, listeners = new Map();
    const elements = { '.mes_timer': { textContent: '52.8s' }, '.tokenCounterDisplay': { textContent: '1908t' }, '.timestamp': { textContent: 'PRIVATE_TIME' }, '.mes_text': { textContent: 'PRIVATE_DISPLAY_BODY' } };
    const root = {}, element = { querySelector: key => elements[key], getAttribute: () => '0' };
    globalThis.document = { scripts: [{ src: 'http://local/scripts/extensions/third-party/example/index.js?key=PRIVATE_KEY' }, { src: 'https://external/PRIVATE_KEY.js' }], querySelector: key => key === '#chat' ? root : element };
    globalThis.location = { href: 'http://local/', origin: 'http://local' };
    globalThis.MutationObserver = class { constructor(callback) { state.callback = callback; } observe() {} disconnect() { state.disconnected++; } };
    globalThis.addEventListener = (name, fn) => { listeners.set(name, fn); };
    globalThis.removeEventListener = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); };
    const tracker = createConflictDiagnostics({ raw: () => raw, ready: () => true, enabled: () => state.enabled });
    t.after(() => { tracker.stop(); for (const [key, value] of Object.entries(previous)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
    return { tracker, raw, state, listeners, elements };
}
test('disabled diagnostics leave descriptors untouched and install no listeners', t => {
    const f = setup(t, { enabled: false }), message = f.raw.chat[0];
    const before = Object.getOwnPropertyDescriptors(message);
    f.tracker.sync(); assert.deepEqual(Object.getOwnPropertyDescriptors(message), before);
    assert.equal(f.listeners.size, 0); assert.equal(f.tracker.report().events.length, 0);
});
test('repeated metadata writes identify the immediate caller and preserve values, cloning and JSON', t => {
    const f = setup(t), message = f.raw.chat[0], before = JSON.stringify(message); f.tracker.sync();
    assert.equal(JSON.stringify(message), before);
    vm.runInNewContext('message.extra.token_count=3095;message.gen_finished="2026-10-14T03:13:00+09:00";message.extra.token_count=1908;', { message }, { filename: 'http://local/scripts/extensions/third-party/example/index.js?PRIVATE_KEY' });
    const rows = f.tracker.report().events.filter(row => row.stage === 'field_write');
    assert.equal(rows.length, 3); assert.equal(rows[0].data.before.number, 1908); assert.equal(rows[0].data.after.number, 3095);
    assert.equal(rows[0].data.writeTrace[0].script, '/scripts/extensions/third-party/example/index.js');
    assert.equal(f.tracker.report().observedWriters['/scripts/extensions/third-party/example/index.js'], 3);
    assert.equal(structuredClone(message).extra.token_count, 1908);
    const child = Object.create(message); child.send_date = 'PRIVATE_CHILD'; assert.notEqual(message.send_date, child.send_date);
    f.tracker.stop(); assert.equal(Object.getOwnPropertyDescriptor(message, 'send_date').get, undefined);
    assert.equal(Object.getOwnPropertyDescriptor(message.extra, 'token_count').get, undefined);
    assert.equal(f.listeners.size, 0);
});
test('extra replacement rebinds counters immediately; detached extra writes are ignored', t => {
    const f = setup(t), message = f.raw.chat[0]; f.tracker.sync(); const old = message.extra;
    message.extra = { token_count: 2000, display_text: 'PRIVATE_NEW_TRANSLATION' };
    message.extra.token_count = 3095;
    const count = f.tracker.report().events.length; old.token_count = 7;
    assert.equal(f.tracker.report().events.length, count);
    assert.equal(f.tracker.report().events.filter(row => row.stage === 'field_write').at(-1).data.after.number, 3095);
});
test('object and descriptor replacement are detected without falsely assigning a writer', t => {
    const f = setup(t); f.tracker.sync(); const old = f.raw.chat[0];
    f.raw.chat[0] = structuredClone(old); f.raw.chat[0].extra.token_count = 3095; f.tracker.sync();
    assert.equal(Object.getOwnPropertyDescriptor(old, 'send_date').get, undefined);
    assert.ok(f.tracker.report().events.some(row => row.stage === 'message_object_replaced' && row.data.writerLocated === false));
    const getter = () => 111, setter = () => {};
    Object.defineProperty(f.raw.chat[0].extra, 'token_count', { get: getter, set: setter, configurable: true });
    f.tracker.sync(); f.tracker.stop();
    assert.equal(Object.getOwnPropertyDescriptor(f.raw.chat[0].extra, 'token_count').get, getter);
});
test('display-only change is recorded without raw DOM text, names, URLs or error payloads', t => {
    const f = setup(t); f.tracker.sync();
    f.elements['.mes_timer'].textContent = '95.5s'; f.elements['.mes_text'].textContent = 'PRIVATE_CHANGED_BODY'; f.state.callback();
    assert.ok(f.tracker.report().events.some(row => row.stage === 'display_observed_change' && row.data.writerLocated === false));
    f.listeners.get('error')({ type: 'error', error: { name: 'TypeError', message: 'PRIVATE_KEY', stack: 'TypeError: PRIVATE_KEY\n at PRIVATE_FUNCTION (http://local/scripts/extensions/third-party/example/index.js?secret=PRIVATE_KEY:12:3)' } });
    f.listeners.get('unhandledrejection')({ type: 'unhandledrejection', reason: 'PRIVATE_REJECTION' });
    const report = f.tracker.report(), exported = JSON.stringify(report);
    assert.doesNotMatch(exported, /PRIVATE|http:|https:|secret=|local\//);
    assert.ok(report.events.some(row => row.stage === 'uncaught_error' && row.data.writeTrace.some(frame => frame.script?.includes('example'))));
    assert.deepEqual(report.loadedScripts, ['/scripts/extensions/third-party/example/index.js']);
});
test('turning recording off releases watchers and callbacks even before the next export', t => {
    const f = setup(t); f.tracker.sync(); f.state.enabled = false; f.tracker.sync();
    const count = f.tracker.report().events.length; f.raw.chat[0].extra.token_count = 5; f.state.callback();
    assert.equal(f.tracker.report().events.length, count); assert.equal(f.listeners.size, 0); assert.equal(f.state.disconnected, 1);
});
test('storm limits are reported and clearing drops recorded evidence', t => {
    const f = setup(t); f.tracker.sync();
    for (let i = 0; i < 1200; i++) f.raw.chat[0].extra.token_count = i;
    assert.ok(f.tracker.report().events.length <= 500); assert.ok(f.tracker.report().dropped > 0);
    f.tracker.clear(); assert.equal(f.tracker.report().events.length, 0); assert.equal(f.tracker.report().dropped, 0);
});
test('missing fields are not manufactured; later additions are observed on the next poll', t => {
    const f = setup(t); delete f.raw.chat[0].extra.display_text; f.tracker.sync();
    assert.equal(Object.hasOwn(f.raw.chat[0].extra, 'display_text'), false);
    f.raw.chat[0].extra.display_text = 'PRIVATE_ADDITION'; f.tracker.sync();
    assert.ok(f.tracker.report().events.some(row => row.stage === 'data_observed_change'));
    assert.doesNotMatch(JSON.stringify(f.tracker.report()), /PRIVATE/);
});

test('direct whole-message replacement retains writer and immediately watches the new message', t => {
    const f = setup(t); f.tracker.sync();
    vm.runInNewContext('chat[0]={mes:"PRIVATE_NEW",extra:{token_count:2000}};chat[0].extra.token_count=3095;', { chat: f.raw.chat },
        { filename: 'http://local/scripts/extensions/third-party/replacer/index.js?PRIVATE_KEY' });
    const rows = f.tracker.report().events;
    const replaced = rows.find(row => row.stage === 'message_slot_write');
    assert.equal(replaced.data.writeTrace[0].script, '/scripts/extensions/third-party/replacer/index.js');
    assert.ok(rows.some(row => row.stage === 'field_write' && row.data.after.number === 3095));
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE/);
    f.tracker.stop(); assert.equal(Object.getOwnPropertyDescriptor(f.raw.chat, '0').get, undefined);
});

test('descriptor changes retain writers, native results and foreign accessors', t => {
    const f = setup(t), originalDefine = Object.defineProperty; f.tracker.sync();
    const getter = () => 3095;
    vm.runInNewContext('Object.defineProperty(message.extra,"token_count",{get:getter,configurable:true});',
        { message: f.raw.chat[0], Object, getter }, { filename: 'http://local/scripts/extensions/third-party/descriptor/index.js' });
    const row = f.tracker.report().events.find(row => row.stage === 'descriptor_write');
    assert.equal(row.data.writeTrace[0].script, '/scripts/extensions/third-party/descriptor/index.js');
    assert.deepEqual(row.data.fields, ['token_count']);
    assert.equal(Reflect.deleteProperty(f.raw.chat[0].extra, 'display_text'), true);
    const locked = {}; originalDefine(locked, 'x', { value: 1 });
    assert.equal(Reflect.defineProperty(locked, 'x', { value: 2 }), false);
    assert.throws(() => Object.defineProperty(locked, 'x', { value: 2 }), TypeError);
    f.tracker.stop(); assert.equal(Object.defineProperty, originalDefine);
    assert.equal(Object.getOwnPropertyDescriptor(f.raw.chat[0].extra, 'token_count').get, getter);
});

test('chat splice, clearing and insertion preserve array behavior and rebind immediately', t => {
    const f = setup(t), old = f.raw.chat[0], originalSplice = Array.prototype.splice; f.tracker.sync();
    const next = { mes: 'PRIVATE_NEW', extra: { token_count: 3 } };
    assert.deepEqual(f.raw.chat.splice(0, 1, next), [old]);
    assert.equal(f.raw.chat.pop(), next); assert.equal(f.raw.chat.length, 0);
    assert.equal(f.raw.chat.push(old), 1); old.extra.token_count = 7;
    assert.ok(f.tracker.report().events.some(row => row.stage === 'chat_array_operation' && row.data.operation === 'splice'));
    assert.ok(f.tracker.report().events.some(row => row.stage === 'field_write' && row.data.after.number === 7));
    f.tracker.stop(); assert.equal(Array.prototype.splice, originalSplice);
    assert.deepEqual(JSON.parse(JSON.stringify(f.raw.chat)), [JSON.parse(JSON.stringify(old))]);
});

test('timer writes retain the scheduler separately from the direct writer; disable restores timers', async t => {
    const f = setup(t), timer = globalThis.setTimeout; f.tracker.sync();
    const write = vm.runInNewContext('(function(message){message.extra.token_count=3095})', {}, { filename: 'http://local/script.js' });
    await new Promise(resolve => vm.runInNewContext('setTimeout(function(){write(message);resolve()},0)',
        { setTimeout, write, message: f.raw.chat[0], resolve }, { filename: 'http://local/scripts/extensions/third-party/scheduler/index.js' }));
    const row = f.tracker.report().events.find(row => row.stage === 'field_write');
    assert.equal(row.data.writeTrace[0].script, '/script.js');
    assert.equal(row.data.asyncParents[0].kind, 'setTimeout');
    assert.equal(row.data.asyncParents[0].writeTrace[0].script, '/scripts/extensions/third-party/scheduler/index.js');
    f.raw.chat[0].extra.token_count = 4;
    assert.deepEqual(f.tracker.report().events.filter(row => row.stage === 'field_write').at(-1).data.asyncParents, []);
    f.tracker.stop(); assert.equal(globalThis.setTimeout, timer);
});

test('scheduled callbacks preserve this, arguments, cancellation and disable generation boundaries', async t => {
    const f = setup(t), timer = globalThis.setTimeout; f.tracker.sync();
    let called = false;
    const handle = setTimeout(() => { called = true; }, 1); clearTimeout(handle);
    await new Promise(resolve => setTimeout(function (value) { assert.equal(value, 17); assert.ok(this); resolve(); }, 3, 17));
    assert.equal(called, false);
    let done;
    const completion = new Promise(resolve => { done = resolve; });
    setTimeout(() => { f.raw.chat[0].extra.token_count = 9; done(); }, 5);
    f.tracker.stop(); f.tracker.sync();
    await completion;
    assert.deepEqual(f.tracker.report().events.filter(row => row.stage === 'field_write').at(-1).data.asyncParents, []);
    f.tracker.stop(); assert.equal(globalThis.setTimeout, timer);
});

test('hook displacement is reported and disabling does not erase another extension wrapper', t => {
    const f = setup(t), original = Reflect.deleteProperty; f.tracker.sync();
    const instrumented = Reflect.deleteProperty;
    const foreign = function (...args) { return Reflect.apply(instrumented, this, args); };
    Reflect.deleteProperty = foreign;
    try {
        assert.ok(f.tracker.report().hooks.displaced.includes('Reflect.deleteProperty'));
        f.tracker.stop(); assert.equal(Reflect.deleteProperty, foreign);
        assert.equal(Reflect.deleteProperty({ x: 1 }, 'x'), true);
    } finally { Reflect.deleteProperty = original; }
});

test('scene panel and readonly input changes are observed separately from the unchanged reply', t => {
    const f = setup(t), control = { id: 'tsf-state-location', value: 'PRIVATE_OLD', checked: false };
    const panel = { innerHTML: '<input>', hidden: false, className: 'panel', querySelectorAll: () => [control] };
    globalThis.document.getElementById = name => name === 'tsf-panel-state' ? panel : null;
    f.tracker.sync(); control.value = 'PRIVATE_NEW'; f.state.callback();
    const row = f.tracker.report().events.find(row => row.stage === 'display_observed_change');
    assert.ok(row); assert.deepEqual(row.data.before.body, row.data.after.body);
    assert.notDeepEqual(row.data.before.panels[0].controls, row.data.after.panels[0].controls);
    assert.doesNotMatch(JSON.stringify(f.tracker.report()), /PRIVATE/);
});
