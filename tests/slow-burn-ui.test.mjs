import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the deployed renderer with DOM stubs; null stages used to be
// indistinguishable from 1. Verify both the unknown label and usable controls.
for (const kind of ['sfw', 'nsfw']) test(`${kind}: unknown slow-burn stage renders without inventing a stage or locking it`, () => {
    const source = readFileSync(new URL(`../modes/${kind}/index.js`, import.meta.url), 'utf8');
    const start = source.indexOf('function renderSlowBurnPanel(settings) {');
    const renderer = source.slice(start, source.indexOf('\n}', start) + 2);
    const nodes = new Map();
    const element = id => {
        if (!nodes.has(id)) nodes.set(id, { textContent: '', disabled: false, hidden: false, querySelector: () => null, closest: () => null });
        return nodes.get(id);
    };
    const progress = { stage: null, source: 'unknown', sessionTurns: 1, requiredTurns: 3, turns: 0, locked: false,
        target: { target: '', requiredTurns: 3, completedTurns: 0, active: false } };
    const stages = { 5: { ko: '확인된 단계' } };
    const sandbox = { element, document: {}, slowBurnProgress: () => progress,
        effectiveState: () => ({ state: null }), sceneTypeDef: () => ({ ko: '일반', stages }), SLOW_BURN_STAGES: stages };
    vm.runInNewContext(renderer + '\nthis.render = renderSlowBurnPanel;', sandbox);
    const prefix = kind === 'sfw' ? 'tsf' : 'tns';
    sandbox.render({ slowBurnEnabled: true });
    assert.equal(element(`${prefix}-slow-burn-stage`).textContent, '단계 확인 대기');
    assert.equal(element(`${prefix}-slow-burn-lock`).disabled, true);
    assert.equal(element(`${prefix}-slow-burn-prev`).disabled, true);
    assert.equal(element(`${prefix}-slow-burn-next`).disabled, false);
    assert.equal(element(`${prefix}-slow-burn-next`).textContent, '1단계 직접 선택');
    progress.stage = 5; progress.source = 'reported';
    sandbox.render({ slowBurnEnabled: true });
    assert.match(element(`${prefix}-slow-burn-stage`).textContent, /5단계/);
    assert.equal(element(`${prefix}-slow-burn-lock`).disabled, false);
    assert.equal(element(`${prefix}-slow-burn-next`).textContent, '다음 ▶');
});
