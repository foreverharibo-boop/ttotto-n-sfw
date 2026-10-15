import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRuntime, PROMPT_KEY } from '../runtime.js';
import { compactReportLines, expandCompactReport, readCompactReport } from '../compact-report.js';

globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
const scene = { location: '거실', time: 'RP 6월 3일 오후 2시', environment: '비', important_objects: { 열쇠: '책상' },
    characters: { A: { appearance: '코트', position: '의자', holding: '컵', condition: '피곤함', contact: '손잡음' } },
    scene_type: 'conversation', intensity: 4, stage: 2, acts: ['새 약속을 정함'], dialogue_beats: ['질문'],
    dialogue_flow: { topic: '여행', last_question: '언제?', new_facts: ['내일 출발'] }, next: ['짐 챙기기'] };
const record = (heat = 8) => ({ _v: 2, scene: structuredClone(scene), heat, stage: heat >= 6 ? 4 : null });
const tag = (kind, data) => `<${kind === 'sfw' ? 'sfw_scene' : 'scene_state'}>${JSON.stringify(data)}</${kind === 'sfw' ? 'sfw_scene' : 'scene_state'}>`;
function setup({ sfw = true, nsfw = true, mode = 'auto', autoRefine = false } = {}) {
    const source = new EventEmitter(), prompts = {};
    const context = { characterId: 0, chatId: 'a', chat: [], chatMetadata: {}, extensionSettings: {
        'ttotto-sfw': { enabled: sfw, settingsSchemaVersion: 4, autoRefine, slowBurnEnabled: false },
        'ttotto-nsfw': { enabled: nsfw, settingsSchemaVersion: 3, adultConfirmed: true, armMode: mode, autoRefine, slowBurnEnabled: false },
    }, eventSource: source, eventTypes: Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_SWIPED','MESSAGE_EDITED','CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),
    setExtensionPrompt: (key, text) => { prompts[key] = text; }, saveSettingsDebounced(){}, saveMetadataDebounced(){}, saveChat(){},
    generateRaw: async () => { throw new Error('Unexpected paid request'); } };
    const runtime = createRuntime(() => context, { notify: {} });
    return { runtime, context, source, prompt: () => prompts[PROMPT_KEY],
        receive(kind, data) { const m = { mes: '본문.' + tag(kind, data), swipe_id: 0 }; context.chat.push(m); source.emit('MESSAGE_RECEIVED', context.chat.length-1); return m; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('one Korean record carries common facts through SFW -> NSFW -> SFW without another AI call', async () => {
    const r=setup({autoRefine:true}); await r.runtime.start({withUi:false});
    try {
        r.runtime.setDiagnosticsEnabled(true);
        for (const [kind, heat, owner] of [['sfw',0,'sfw'],['sfw',8,'nsfw'],['nsfw',8,'nsfw'],['nsfw',0,'sfw']]) {
            const m=r.receive(kind,record(heat));
            assert.equal(m.mes,'본문.'); assert.equal(r.runtime.owner(),owner);
            const common=r.runtime.core.commonSummary(); assert.equal(common.valid,true);
            assert.equal(common.state.time.ko,scene.time); assert.equal(common.state.importantObjects.열쇠.ko,'책상');
            assert.equal(common.state.characters.A.holding.ko,'컵'); assert.equal(common.state.characters.A.condition.ko,'피곤함');
            const intimate=r.runtime.features.nsfw.currentState().state;
            assert.equal(intimate.heat,heat); assert.equal(intimate.stage,heat>=6?4:null);
            assert.equal(intimate.characters.A.contact.ko,'손잡음');
            assert.equal(r.runtime.features.sfw.currentState().state.stage,2);
            await r.runtime.intercept([],0,null,'normal');
            const p=r.prompt();
            assert.equal((p.match(/<(?:sfw_scene|scene_state)>/g)??[]).length,1);
            assert.doesNotMatch(p,/English \|\||bilingual|Unified report coordination/);
            assert.match(p,/Korean only/); assert.ok(p.includes('컵')); assert.ok(p.includes('피곤함'));
        }
        await tick();
        for (const kind of ['sfw','nsfw']) assert.ok(!r.runtime.diagnostics()[kind].events.some(e=>e.stage==='refine_started'));
    } finally {r.runtime.stop();}
});

for (const config of [{sfw:true,nsfw:false},{sfw:false,nsfw:true,mode:'manual'},{sfw:true,nsfw:true,mode:'stealth'}]) test(`single/off/stealth mode contract ${JSON.stringify(config)}`,async()=>{
    const r=setup(config);await r.runtime.start({withUi:false});
    try{
        r.receive(config.sfw?'sfw':'nsfw',record(config.sfw?0:8));
        await r.runtime.intercept([],0,null,'normal');
        assert.equal((r.prompt().match(/<(?:sfw_scene|scene_state)>/g)??[]).length,1);
        const schema=readCompactReport(r.prompt());
        assert.ok(schema?.scene.characters);
        if (!config.nsfw || config.mode==='stealth') assert.equal(schema.heat,undefined);
        if (!config.sfw) {
            assert.equal(r.context.chat[0].extra.ttottoUnifiedScene.modes.sfw,undefined);
            assert.ok(r.prompt().includes('컵')); assert.ok(r.prompt().includes('손잡음'));
        }
    }finally{r.runtime.stop();}
});

for (const kind of ['sfw','nsfw']) test(`${kind}: compact repair updates both views and uses one Korean schema`,async()=>{
    const r=setup();await r.runtime.start({withUi:false});
    try {
        const m=r.receive(kind,record(kind==='sfw'?0:8)); let calls=0;
        r.context.generateRaw=async({prompt})=>{
            calls++; assert.match(prompt[0].content,/Korean only/); assert.doesNotMatch(prompt[0].content,/bilingual|English \|\|/);
            const next=record(kind==='sfw'?0:1);next.scene.location='주방';return JSON.stringify(next);
        };
        assert.equal(await r.runtime.features[kind].runRefine({manual:true}),true);
        assert.equal(calls,1);assert.equal(m.mes,'본문.');
        assert.equal(r.runtime.features.sfw.snapshotForMessage(m).state.location.ko,'주방');
        assert.equal(r.runtime.features.nsfw.snapshotForMessage(m).state.location.ko,'주방');
        assert.equal(r.runtime.core.commonSummary().state.location.ko,'주방');
        if(kind==='nsfw') assert.equal(r.runtime.owner(),'sfw');
    }finally{r.runtime.stop();}
});

test('compact swipe/chat/body guards remain intact; legacy bilingual records still load',async()=>{
    const r=setup();await r.runtime.start({withUi:false});
    try{
        const m=r.receive('nsfw',record());m.swipes=[m.mes,'다른 답변.'];m.swipe_id=1;m.mes=m.swipes[1];r.source.emit('MESSAGE_SWIPED',0);
        assert.equal(r.runtime.core.commonSummary().state,null);
        m.mes='새 본문.'+tag('sfw',{...scene,location:'Kitchen || 주방'});r.source.emit('MESSAGE_RECEIVED',0);
        assert.equal(r.runtime.features.sfw.currentState().state.location.ko,'주방');
        m.mes='편집.';r.source.emit('MESSAGE_EDITED',0);assert.equal(r.runtime.core.commonSummary().state,null);
        r.context.chat=[];r.context.chatMetadata={};r.context.chatId='b';r.source.emit('CHAT_CHANGED');assert.equal(r.runtime.core.commonSummary().state,null);
    }finally{r.runtime.stop();}
});

test('a malformed/truncated compact record cannot be mistaken for a complete one',()=>{
    const value=tag('sfw',record());assert.equal(readCompactReport(value.slice(0,-5)),null);
    assert.equal(readCompactReport(value+'<scene_state>{broken}</scene_state>'),null);
    assert.equal(expandCompactReport({_v:2,scene:null},'sfw'),null);
});

test('report schema omits disabled optional fields and does not instruct both pacing modes',()=>{
    const off={repeatGuard:false,dialogueBeatGuard:false,dialogueFlow:false,nextBeatHints:false,slowBurnEnabled:false};
    const p=compactReportLines('sfw',{sfw:off,nsfw:off,monitor:false}).join('\n');
    const raw=readCompactReport(p); assert.deepEqual(Object.keys(raw),['_v','scene']);
    for(const field of ['acts','dialogue_beats','dialogue_flow','next','stage'])assert.equal(raw.scene[field],undefined);
    assert.doesNotMatch(p,/sexual stage scale|STAGE CAP|stage residence/i);
});

for (const kind of ['sfw','nsfw']) test(`${kind}: a companion edit during repair rejects the stale shared result`, async()=>{
    const r=setup();await r.runtime.start({withUi:false});
    try{
        const m=r.receive(kind,record(kind==='sfw'?0:8));let release;
        r.context.generateRaw=()=>new Promise(resolve=>{release=resolve;});
        const pending=r.runtime.features[kind].runRefine({manual:true});await tick();
        const other=kind==='sfw'?'nsfw':'sfw';
        const snap=r.runtime.features[other].snapshotForMessage(m);snap.state.location={en:'사용자 수정',ko:'사용자 수정'};
        const newer=record();newer.scene.location='오래된 보정';release(JSON.stringify(newer));
        assert.equal(await pending,false);assert.equal(r.runtime.features[other].snapshotForMessage(m).state.location.ko,'사용자 수정');
        assert.doesNotMatch(JSON.stringify(m.extra),/오래된 보정/);
    }finally{r.runtime.stop();}
});
