import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('boot and enable wait for APP_READY; late loading replays readiness', async () => {
    const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ');
    for (const replay of [false, true]) {
        let starts = 0;
        const callbacks = new Map();
        const sandbox = { console, document: { body: {}, readyState: 'complete' },
            createUi: () => ({ refresh() {}, ensureButton() {} }),
            createRuntime: () => ({ start: async () => { starts++; }, stop() {} }),
            SillyTavern: { getContext: () => ({ eventTypes: { APP_READY: 'ready', APP_INITIALIZED: 'initialized' },
                eventSource: { on(event, fn) { callbacks.set(event, fn); if (replay && event === 'ready') fn(); } } }) } };
        vm.createContext(sandbox); vm.runInContext(source, sandbox);
        if (!replay) {
            await vm.runInContext('onEnable()', sandbox);
            assert.equal(starts, 0);
            assert.equal(callbacks.has('initialized'), false);
            await callbacks.get('ready')();
        }
        assert.equal(starts, 1);
    }
});
