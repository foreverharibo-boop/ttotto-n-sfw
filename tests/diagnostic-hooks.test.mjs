import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createDiagnosticHooks } from '../diagnostic-hooks.js';

function fixture(t) {
    const prior = Object.fromEntries(['Node', 'Element', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    class Node {
        constructor() { this.text = ''; }
        get textContent() { return this.text; }
        set textContent(value) { this.text = String(value); }
        appendChild(child) { if (!child) throw new TypeError('PRIVATE_ERROR'); this.text += child.text; return child; }
    }
    class Element extends Node {
        get innerHTML() { return this.text; }
        set innerHTML(value) { this.text = String(value); }
    }
    Object.assign(globalThis, { Node, Element, location: { origin: 'http://local' } });
    const node = new Element(), other = new Element(), events = [], state = { enabled: true };
    const source = Object.create({ emit(name, callback) { return callback.call(this, name); } });
    const hooks = createDiagnosticHooks({ live: () => state.enabled,
        raw: () => ({ eventSource: source, eventTypes: { MESSAGE_RECEIVED: 'received' } }),
        domRelevant: target => target === node,
        domSnapshot: () => ({ chars: node.textContent.length }),
        domOperation: (operation, before, writeTrace, asyncParents) => events.push({ operation, before, writeTrace, asyncParents }),
        targetFields: () => [], arrayRelevant: () => false,
        eventOperation: (name, writeTrace, asyncParents) => events.push({ name, writeTrace, asyncParents }),
        consoleOperation: () => {},
    });
    t.after(() => {
        hooks.stop();
        for (const [key, descriptor] of Object.entries(prior)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        }
    });
    return { hooks, node, other, source, events, state, Node, Element };
}

test('DOM setter keeps direct renderer and upstream extension frames, without raw text', t => {
    const f = fixture(t); f.hooks.start();
    const render = vm.runInNewContext('(node)=>{node.innerHTML="PRIVATE_CONTENT"}', {}, { filename: 'http://local/script.js' });
    vm.runInNewContext('render(node)', { render, node: f.node }, { filename: 'http://local/scripts/extensions/third-party/caller/index.js?PRIVATE_KEY' });
    const row = f.events.find(row => row.operation === 'Element.innerHTML');
    assert.equal(row.writeTrace[0].script, '/script.js');
    assert.ok(row.writeTrace.some(frame => frame.script === '/scripts/extensions/third-party/caller/index.js'));
    assert.doesNotMatch(JSON.stringify(f.events), /PRIVATE/);
    const count = f.events.length; f.other.textContent = 'unrelated'; assert.equal(f.events.length, count);
});

test('DOM hooks preserve return objects, thrown error and exact descriptors after stop', t => {
    const f = fixture(t), before = Object.getOwnPropertyDescriptors(f.Node.prototype); f.hooks.start();
    const child = new f.Node(); child.text = 'text';
    assert.equal(f.node.appendChild(child), child);
    assert.throws(() => f.node.appendChild(null), { name: 'TypeError', message: 'PRIVATE_ERROR' });
    f.hooks.stop(); assert.deepEqual(Object.getOwnPropertyDescriptors(f.Node.prototype), before);
    const count = f.events.length; f.node.textContent = 'after stop'; assert.equal(f.events.length, count);
});

test('synchronous event caller is linked to the DOM write without altering emitter result or listener this', t => {
    const f = fixture(t); f.hooks.start();
    const result = vm.runInNewContext('source.emit("received",function(name){if(this!==source)throw Error();node.textContent=name;return 17})',
        { source: f.source, node: f.node }, { filename: 'http://local/scripts/extensions/third-party/event-caller/index.js' });
    assert.equal(result, 17);
    const row = f.events.find(row => row.operation === 'Node.textContent');
    assert.equal(row.asyncParents[0].kind, 'event:MESSAGE_RECEIVED');
    assert.equal(row.asyncParents[0].writeTrace[0].script, '/scripts/extensions/third-party/event-caller/index.js');
    f.hooks.stop(); assert.equal(Object.hasOwn(f.source, 'emit'), false);
});

test('event return promise is untouched and await continuations are not assigned a false parent', async t => {
    const f = fixture(t); f.hooks.start();
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const expected = wait.then(() => { f.node.textContent = 'later'; });
    assert.equal(f.source.emit('received', () => expected), expected);
    release(); await expected;
    assert.deepEqual(f.events.find(row => row.operation === 'Node.textContent').asyncParents, []);
});

test('pending microtask cannot leak its scheduler context into independent writes', async t => {
    const f = fixture(t); f.hooks.start();
    await new Promise(resolve => vm.runInNewContext('queueMicrotask(()=>{node.textContent="PRIVATE";resolve()})',
        { node: f.node, queueMicrotask, resolve }, { filename: 'http://local/scripts/extensions/third-party/microtask/index.js' }));
    const row = f.events.find(row => row.operation === 'Node.textContent');
    assert.equal(row.asyncParents[0].kind, 'queueMicrotask');
    assert.equal(row.asyncParents[0].writeTrace[0].script, '/scripts/extensions/third-party/microtask/index.js');
    f.node.textContent = 'independent'; assert.deepEqual(f.events.at(-1).asyncParents, []);
});
