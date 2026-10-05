import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const report = heat => ({ location: 'Room', characters: { A: { clothing: 'Coat', position: 'Standing', contact: 'None' } }, acts: ['Read the note'], heat, next: ['Check the timetable'] });
const message = mes => ({ mes, is_user: false });
function setup({ autoRefine = false, mode = 'auto', heat = 8, fail = false } = {}) {
    const timers = new Map(); let timerId = 0, calls = 0;
    const context = {
        chat: [message('Current test reply.')],
        chatMetadata: { ttottoNsfw: { chatSchemaVersion: 1, enabled: true } },
        extensionSettings: { 'ttotto-nsfw': { settingsSchemaVersion: 3, enabled: true, adultConfirmed: true, autoRefine, armMode: mode, slowBurnEnabled: false } },
        saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveChat() {}, setExtensionPrompt() {},
        async generateRaw() { calls++; if (fail) throw new Error('Unavailable'); return JSON.stringify(report(heat)); },
    };
    const env = { SillyTavern: { getContext: () => context }, URL, structuredClone, AbortController,
        document: { getElementById: () => null }, window: {}, console: { log() {}, warn() {}, error() {}, debug() {} },
        toastr: { info() {}, warning() {}, error() {}, success() {} },
        setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    };
    vm.createContext(env);
    const script = source.slice(0, source.indexOf('const bootContext = getContext();'))
        .replaceAll('export function ', 'function ').replace('import.meta.url', "'file:///extension/index.js'");
    vm.runInContext(script + '\nglobalThis.api={getSettings,getChatMeta,handleIncomingMessage,effectiveState,stateForDisplay,runRefine,scheduleAutoRefine,autoRefineNeeded,isFullyArmed,beginSceneGeneration,finishReceivedGeneration,onDisable,onClean,observeLatestMessage,recentActs,legacyMessageStateSignature};', env);
    env.api.getSettings(); env.api.getChatMeta();
    return { env, api: env.api, context, timers, get calls() { return calls; }, get meta() { return context.chatMetadata.ttottoNsfw; } };
}

test('latest missing report never presents the previous temperature as current', () => {
    const r = setup();
    r.context.chat[0].mes += '<scene_state>{"heat":5}</scene_state>';
    r.api.handleIncomingMessage(0);
    assert.equal(r.api.effectiveState().state.heat, 5);
    r.context.chat.push(message('New reply without a report.'));
    r.api.handleIncomingMessage(1);
    assert.equal(r.api.effectiveState().source, 'missing-report');
    assert.equal(r.api.effectiveState().state, null);
    assert.equal(r.api.stateForDisplay().state, null);
    assert.equal(r.timers.size, 0);
    assert.equal(r.calls, 0);
});

test('manual repair applies recovered heat immediately without enabling automatic calls', async () => {
    const r = setup();
    assert.equal(await r.api.runRefine({ manual: true }), true);
    assert.equal(r.calls, 1);
    assert.equal(r.api.isFullyArmed(), true);
    assert.equal(r.meta.armSource, 'heat');
    assert.equal(r.api.effectiveState().state.heat, 8);
    assert.equal(r.api.effectiveState().source, 'ai-refine');
    assert.equal(r.api.getSettings().autoRefine, false);
    assert.equal(r.timers.size, 0);
});

test('a recovered low temperature stays in monitoring', async () => {
    const r = setup({ heat: 2 });
    assert.equal(await r.api.runRefine({ manual: true }), true);
    assert.equal(r.api.isFullyArmed(), false);
    assert.equal(r.api.effectiveState().state.heat, 2);
});

test('enabled monitoring repair schedules once and applies its result', async () => {
    const r = setup({ autoRefine: true });
    r.api.handleIncomingMessage(0); r.api.handleIncomingMessage(0);
    assert.equal(r.timers.size, 1);
    assert.equal(await r.api.runRefine(), true);
    r.api.handleIncomingMessage(0); r.api.scheduleAutoRefine();
    assert.equal(r.calls, 1);
    assert.equal(r.timers.size, 0);
    assert.equal(r.api.isFullyArmed(), true);
});

test('failed automatic repair does not loop on repeated render events', async () => {
    const r = setup({ autoRefine: true, fail: true });
    r.api.handleIncomingMessage(0);
    assert.equal(await r.api.runRefine(), false);
    for (let i = 0; i < 5; i++) r.api.handleIncomingMessage(0);
    assert.equal(await r.api.runRefine(), false);
    assert.equal(r.calls, 1);
    assert.equal(r.timers.size, 0);
    assert.equal(await r.api.runRefine({ manual: true }), false);
    assert.equal(r.calls, 2);
});

test('idle stealth and valid low-temperature monitoring do not schedule unnecessary repairs', () => {
    const stealth = setup({ autoRefine: true, mode: 'stealth' });
    stealth.api.handleIncomingMessage(0);
    assert.equal(stealth.timers.size, 0);
    const low = setup({ autoRefine: true });
    low.context.chat[0].mes += '<scene_state>{"heat":2}</scene_state>';
    low.api.handleIncomingMessage(0);
    assert.equal(low.timers.size, 0);
});

test('repaired state expires for a changed body, new swipe, or next reply', async () => {
    const r = setup();
    await r.api.runRefine({ manual: true });
    r.context.chat[0].mes = 'Edited test reply.';
    assert.equal(r.api.effectiveState().source, 'body-changed');
    assert.equal(r.api.effectiveState().state, null);
    assert.equal(r.api.stateForDisplay().state.heat, 8);
    r.context.chat[0].swipe_id = 1;
    assert.equal(r.api.stateForDisplay().state, null);
    r.context.chat.push(message('Next test reply.'));
    assert.equal(r.api.effectiveState().state, null);
});

test('a reply changed during repair cannot receive an outdated result', async () => {
    const r = setup(); let finish;
    r.context.generateRaw = () => new Promise(resolve => { finish = resolve; });
    const request = r.api.runRefine({ manual: true });
    await new Promise(resolve => setImmediate(resolve));
    r.context.chat[0].swipe_id = 1;
    finish(JSON.stringify(report(8)));
    assert.equal(await request, false);
    assert.equal(r.context.chat[0].extra, undefined);
    assert.equal(r.api.isFullyArmed(), false);
});


test('older reports cannot change ownership of the latest reply', () => {
    for (const [oldHeat, currentHeat] of [[8, 0], [0, 8]]) {
        const r = setup();
        r.context.chat[0].mes += `<scene_state>{"heat":${oldHeat}}</scene_state>`;
        r.context.chat.push(message(`Latest reply.<scene_state>{"heat":${currentHeat}}</scene_state>`));
        r.api.handleIncomingMessage(1);
        const active = r.meta.autoArmed;
        r.api.handleIncomingMessage(0);
        assert.equal(r.meta.autoArmed, active);
        assert.equal(r.api.effectiveState().state.heat, currentHeat);
    }
});

test('removing a fenced companion report does not invalidate current NSFW facts', () => {
    const r = setup(); r.meta.autoArmed = true;
    const companion = '\n```json\n<sfw_scene>{"location":"Room"}</sfw_scene>\n```';
    r.context.chat[0].mes += '<scene_state>{"heat":8}</scene_state>' + companion;
    r.api.handleIncomingMessage(0);
    r.context.chat[0].mes = r.context.chat[0].mes.replace(companion, '');
    assert.equal(r.api.effectiveState().state?.heat, 8);
});

test('normal streaming cannot consume reports before completion', () => {
    const r = setup(); const text='Partial reply.<scene_state>{"heat":8}</scene_state>';
    r.context.chat[0].mes=text;
    r.api.beginSceneGeneration('normal', true);
    r.api.handleIncomingMessage(0);
    assert.equal(r.context.chat[0].mes,text);
    assert.equal(Boolean(r.meta.autoArmed),false);
    r.api.finishReceivedGeneration(); r.api.handleIncomingMessage(0);
    assert.equal(r.meta.autoArmed,true);
});

test('cleanup keeps later hooks inert and does not recreate deleted settings', () => {
    const r=setup(); r.api.onClean();
    r.context.chat[0].mes += '<scene_state>{"heat":8}</scene_state>';
    r.api.handleIncomingMessage(0);
    assert.equal(r.context.extensionSettings['ttotto-nsfw'],undefined);
});


test('delayed body changes are observed without extra calls when automatic repair is off', () => {
    const r=setup();r.context.chat[0].mes+='<scene_state>'+JSON.stringify(report(0))+'</scene_state>';
    r.api.observeLatestMessage();
    assert.equal(r.api.effectiveState().state.heat,0);
    r.context.chat[0].mes+=' A substantive correction.';
    r.api.observeLatestMessage();
    assert.equal(r.api.effectiveState().source,'body-changed');
    assert.equal(r.api.recentActs(5).length,0);
    assert.equal(r.calls,0);assert.equal(r.timers.size,0);
});

test('disabled extension releases a repair even if provider ignores abort', async () => {
    const r=setup();let finish;
    r.context.generateRaw=()=>new Promise(resolve=>{finish=resolve;});
    const pending=r.api.runRefine({manual:true});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof finish,'function');
    r.api.onDisable();
    const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('hung'),100))]);
    assert.equal(result,false);
    finish(JSON.stringify(report(8)));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(r.context.chat[0].extra,undefined);
});

for (const mode of ['manual','auto']) test(`manual repair waits during generation: ${mode}`,async()=>{
    const r=setup({mode});r.api.beginSceneGeneration('normal',true);
    assert.equal(await r.api.runRefine({manual:true}),false);assert.equal(r.calls,0);
});


test('missing recent reports never expand the NSFW history window into old scenes',()=>{
    const r=setup();r.context.chat[0].mes+='<scene_state>'+JSON.stringify(report(0))+'</scene_state>';
    r.api.handleIncomingMessage(0);
    for(let i=0;i<3;i++) r.context.chat.push(message('New ordinary reply '+i));
    assert.equal(r.api.recentActs(3).length,0);
});

test('unchanged legacy snapshots still validate after signature normalization',()=>{
    const r=setup();r.context.chat[0].mes='Line one.  \r\nLine two.<scene_state>'+JSON.stringify(report(0))+'</scene_state>';
    r.api.handleIncomingMessage(0);
    const stored=r.context.chat[0].extra.ttottoNsfw.swipes['0'];
    delete stored.signatureVersion;stored.messageSignature=r.api.legacyMessageStateSignature(r.context.chat[0]);
    assert.equal(r.api.effectiveState().state.heat,0);
    r.context.chat[0].mes+=' Changed fact.';
    assert.equal(r.api.effectiveState().state,null);
});
