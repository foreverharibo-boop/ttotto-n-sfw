import test from 'node:test';
import assert from 'node:assert/strict';
import { createBodyDiagnostics, diagnosticWriteTrace, sanitizeWriteTrace } from '../diagnostics.js';

function setup() {
    const raw = { chat: [], chatMetadata: {}, chatId: 'one' }, rows = [];
    const options = { active: true };
    const observer = createBodyDiagnostics({ raw: () => raw, ready: () => true, enabled: () => options.active,
        swipe: message => message.swipe_id ?? 0, body: text => text,
        record: (stage, message, data) => rows.push({ stage, message: raw.chat.indexOf(message), data }) });
    return { raw, rows, options, observer };
}
test('shared observer preserves accessors, foreign replacements, serialization and inherited writes', () => {
    const r = setup(); let value = 'Original';
    const getter = () => value, setter = next => { value = next; }, message = {};
    Object.defineProperty(message, 'mes', { get: getter, set: setter, configurable: true, enumerable: true });
    r.raw.chat.push(message); r.observer.watch(message);
    assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').get, getter);
    Object.defineProperty(message, 'mes', { value: 'Plain', writable: true, configurable: true, enumerable: true });
    r.observer.watch(message);
    const child = Object.create(message); child.mes = 'Child'; assert.equal(message.mes, 'Plain');
    message.mes = 'Latest'; assert.equal(structuredClone(message).mes, 'Latest');
    assert.equal(JSON.stringify(message), '{"mes":"Latest"}');
    Object.defineProperty(message, 'mes', { get: getter, set: setter, configurable: true });
    r.observer.reset(); assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').get, getter);
    Object.defineProperty(message, 'mes', { configurable: false }); r.observer.watch(message);
    assert.ok(r.rows.some(e => e.data.reason === 'unsupported_descriptor'));
});
test('shared observer bounds watchers, excludes swipe replacement and stops after recording is disabled', () => {
    const r = setup();
    for (let i = 0; i < 13; i++) { const message = { mes: 'Reply', swipe_id: 0 }; r.raw.chat.push(message); r.observer.watch(message); }
    assert.equal(Object.getOwnPropertyDescriptor(r.raw.chat[0], 'mes').get, undefined);
    const message = r.raw.chat[12]; message.mes = message.mes;
    assert.ok(!r.rows.some(e => e.stage === 'body_write'));
    message.swipe_id = 1; message.mes = 'Other swipe';
    assert.ok(r.rows.some(e => e.data.reason === 'swipe_changed'));
    assert.ok(!r.rows.some(e => e.stage === 'body_write'));
    r.observer.watch(message); message.mes = 'Edited';
    assert.equal(r.rows.filter(e => e.stage === 'body_write').length, 1);
    r.options.active = false; r.observer.sync();
    assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').get, undefined);
    assert.equal(message.mes, 'Edited');
});
test('oversized/non-string writes and detached targets are not attributed or retained', () => {
    const r = setup(), message = { mes: 'Small' }; r.raw.chat.push(message); r.observer.watch(message);
    message.mes = 'x'.repeat(65537); assert.equal(message.mes.length, 65537);
    assert.equal(Object.getOwnPropertyDescriptor(message, 'mes').get, undefined);
    message.mes = 'Again'; r.observer.watch(message); message.mes = null; assert.equal(message.mes, null);
    message.mes = 'Another'; r.observer.watch(message); r.raw.chat[0] = { mes: 'Replacement' }; message.mes = 'Detached';
    assert.ok(!r.rows.some(e => e.stage === 'body_write')); assert.ok(!JSON.stringify(r.rows).includes('xxxxx'));
});
test('Chrome/Firefox traces omit secrets and never promote a known ancestor to unknown direct writer', () => {
    const previous = globalThis.location; globalThis.location = { origin: 'http://localhost:8000' };
    try {
        const own = 'http://localhost:8000/scripts/extensions/third-party/ttotto-n-sfw/diagnostics.js:1:2';
        for (const stack of [`Error\n at set (${own})\n at PRIVATE_FUNCTION (http://localhost:8000/script.js?key=PRIVATE_KEY#SECRET:30:4)`,
            `set@${own}\nPRIVATE_FUNCTION@http://localhost:8000/script.js?key=PRIVATE_KEY#SECRET:30:4`]) {
            const frames = sanitizeWriteTrace(diagnosticWriteTrace(stack));
            assert.equal(frames[0].script, '/script.js'); assert.equal(frames[0].line, 30);
            assert.doesNotMatch(JSON.stringify(frames), /PRIVATE|SECRET|localhost/);
        }
        for (const unknown of ['/home/PRIVATE_NAME/index.js:1:2', 'http://foreign.example/scripts/index.js:1:2', 'http://localhost:8000/private/PRIVATE_KEY.js:1:2']) {
            const frames = diagnosticWriteTrace(`Error\n at set (${own})\n at ${unknown}\n at http://localhost:8000/script.js:5:6`);
            assert.equal(frames[0].source, 'unknown'); assert.equal(frames[1].script, '/script.js');
            assert.doesNotMatch(JSON.stringify(frames), /PRIVATE|foreign/);
        }
    } finally { globalThis.location = previous; }
});
