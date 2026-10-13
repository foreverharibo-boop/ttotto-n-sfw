import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createConflictDiagnostics } from '../conflict-diagnostics.js';

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
