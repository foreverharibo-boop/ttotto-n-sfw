import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createInternalDiagnostics } from '../internal-diagnostics.js';

function fixture(t) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
    globalThis.location = { origin: 'http://local' };
    const state = { live: true, scope: {}, settings: { enabled: true, autoRefine: true, apiKey: 'PRIVATE_KEY',
        refineProfileId: 'PRIVATE_PROFILE', globalBans: ['PRIVATE_BAN'] }, metadata: { manualState: {
        state: { stage: 2, location: 'PRIVATE_LOCATION', characters: { PRIVATE_NAME: { condition: 'PRIVATE_CONDITION' } } },
    } } };
    const tracker = createInternalDiagnostics({ live: () => state.live, scope: () => state.scope,
        roots: () => ({ settings: state.settings, metadata: state.metadata }) });
    t.after(() => { tracker.stop(); if (previous) Object.defineProperty(globalThis, 'location', previous); else delete globalThis.location; });
    return { tracker, state };
}

test('deep settings and scene writes retain immediate writer, preserve values and exclude text/names/secrets', t => {
    const f = fixture(t), before = JSON.stringify([f.state.settings, f.state.metadata]); f.tracker.resume();
    assert.equal(JSON.stringify([f.state.settings, f.state.metadata]), before);
    vm.runInNewContext('state.settings.autoRefine=false;state.metadata.manualState.state.stage=4;', { state: f.state },
        { filename: 'http://local/scripts/extensions/third-party/writer/index.js?PRIVATE_KEY' });
    const report = f.tracker.report();
    const rows = report.events.filter(row => row.stage === 'owned_state_write');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].data.writeTrace[0].script, '/scripts/extensions/third-party/writer/index.js');
    assert.equal(rows[1].data.after.value, 4);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|http:|\?key=/);
    assert.ok(Object.values(report.current).some(value => value.redacted === true && value.present === true));
    f.tracker.stop(); assert.equal(Object.getOwnPropertyDescriptor(f.state.settings, 'autoRefine').get, undefined);
    assert.equal(f.state.metadata.manualState.state.stage, 4);
});

test('record replacement rebinds nested writes immediately and releases detached records', t => {
    const f = fixture(t); f.tracker.resume(); const old = f.state.metadata.manualState;
    f.state.metadata.manualState = { state: { stage: 3 } };
    f.state.metadata.manualState.state.stage = 5;
    const count = f.tracker.report().events.length; old.state.stage = 6;
    assert.equal(f.tracker.report().events.length, count);
    assert.equal(Object.getOwnPropertyDescriptor(old.state, 'stage').get, undefined);
    assert.equal(f.tracker.report().events.filter(row => row.stage === 'owned_state_write').at(-1).data.after.value, 5);
});

test('direct deletion is sampled, foreign getters are never invoked, and readonly values are not changed', t => {
    const f = fixture(t); let getterCalls = 0;
    Object.defineProperty(f.state.settings, 'custom', { get() { getterCalls++; throw Error('PRIVATE'); }, enumerable: true, configurable: true });
    Object.defineProperty(f.state.settings, 'locked', { value: 9, enumerable: true });
    f.tracker.resume(); delete f.state.settings.autoRefine; f.tracker.sample();
    assert.equal(getterCalls, 0); assert.equal(f.state.settings.locked, 9);
    assert.ok(f.tracker.report().coverage.accessors > 0);
    assert.ok(f.tracker.report().events.some(row => row.stage === 'owned_state_changed' && row.data.changes.some(change => change.path === 'settings.autoRefine' && !change.after)));
});

test('idle sampling does not emit changes; cyclic and oversized objects report explicit limits', t => {
    const f = fixture(t); f.state.settings.loop = f.state.settings; f.tracker.resume();
    const count = f.tracker.report().events.length;
    for (let i = 0; i < 5; i++) f.tracker.sample();
    assert.equal(f.tracker.report().events.length, count);
    f.state.settings.large = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`PRIVATE_${i}`, 'x'.repeat(1000)]));
    f.tracker.sample(); const report = f.tracker.report();
    assert.ok(report.coverage.textLimit > 0); assert.ok(report.coverage.nodeLimit > 0);
    assert.ok(report.coverage.watched <= 600); assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
});

test('operation IDs and signal parent survive await, abort is logged, and errors are sanitized', async t => {
    const f = fixture(t); f.tracker.resume();
    const parent = f.tracker.begin('sfw', 'runRefine'), controller = new AbortController();
    f.tracker.bind(controller.signal, parent); await Promise.resolve();
    const child = f.tracker.begin('sfw', 'requestRefine', f.tracker.parent(controller.signal));
    assert.equal(child.parent, parent.id); controller.abort('PRIVATE_REASON');
    const error = new Error('PRIVATE_ERROR'); error.status = 429;
    f.tracker.caught(child, error); f.tracker.checkpoint(child, 'provider_attempt', { tokens: 1000, raw: 'PRIVATE_PROMPT' });
    f.tracker.end(child); f.tracker.end(parent);
    const report = f.tracker.report(); assert.equal(report.pending.length, 0);
    assert.ok(report.events.some(row => row.stage === 'operation_checkpoint' && row.data.stage === 'abort_requested'));
    assert.ok(report.events.some(row => row.stage === 'operation_caught_error' && row.data.status === 429));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
});

test('clear and disable prevent old async completion from contaminating a new diagnostic session', t => {
    const f = fixture(t); f.tracker.resume(); const task = f.tracker.begin('nsfw', 'runRefine');
    f.tracker.clear(); f.tracker.end(task); assert.equal(f.tracker.report().events.length, 0);
    f.state.live = false; f.tracker.sample(); assert.equal(Object.getOwnPropertyDescriptor(f.state.settings, 'enabled').get, undefined);
    assert.equal(f.tracker.report().coverage.watched, 0);
    f.state.live = true; f.tracker.resume(); const count = f.tracker.report().events.length;
    f.tracker.fail(task, new Error('PRIVATE')); assert.equal(f.tracker.report().events.length, count);
});

test('scope changes release old objects and mark in-flight completion as belonging to an older scope', t => {
    const f = fixture(t); f.tracker.resume(); const task = f.tracker.begin('sfw', 'runRefine'), old = f.state.metadata;
    f.state.scope = {}; f.state.metadata = {}; f.tracker.sample();
    const count = f.tracker.report().events.length; old.manualState.state.stage = 6;
    assert.equal(f.tracker.report().events.length, count);
    f.tracker.end(task);
    assert.equal(f.tracker.report().events.findLast(row => row.stage === 'operation_finished').data.scopeChanged, true);
});

test('save observers retain values and errors, and do not wrap promises when recording is off', async t => {
    const f = fixture(t); f.tracker.resume();
    const promise = Promise.resolve(17); assert.equal(f.tracker.observePromise(null, promise), promise);
    const task = f.tracker.begin('sfw', 'persistChat');
    assert.equal(await f.tracker.observePromise(task, promise), 17);
    const error = new Error('PRIVATE');
    await assert.rejects(f.tracker.observePromise(task, Promise.reject(error)), candidate => candidate === error);
    assert.ok(f.tracker.report().events.some(row => row.stage === 'operation_caught_error'));
    f.tracker.end(task);
});

test('page visibility and resume are recorded only while enabled, and listeners are released', t => {
    const prior = Object.fromEntries(['document', 'addEventListener', 'removeEventListener'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const listeners = new Map();
    const add = (name, fn) => listeners.set(name, fn), remove = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); };
    globalThis.document = { hidden: true, addEventListener: add, removeEventListener: remove };
    globalThis.addEventListener = add; globalThis.removeEventListener = remove;
    const f = fixture(t);
    try {
        f.tracker.resume(); listeners.get('visibilitychange')({ type: 'visibilitychange' });
        listeners.get('pageshow')({ type: 'pageshow', persisted: true });
        const rows = f.tracker.report().events.filter(row => row.stage === 'page_lifecycle');
        assert.equal(rows[0].data.hidden, true); assert.equal(rows[1].data.persisted, true);
        f.tracker.stop(); assert.equal(listeners.size, 0);
    } finally {
        for (const [key, own] of Object.entries(prior)) if (own) Object.defineProperty(globalThis, key, own); else delete globalThis[key];
    }
});
