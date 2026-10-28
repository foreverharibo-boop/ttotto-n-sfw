import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { filterSceneSources, extractPhysicalReference, normalizeSourceRules, sourcePanelField, sourceRuleInstructions, validSourceDelimiters } from '../scene-source-rules.js';
import { compactReportLines } from '../compact-report.js';
import { createRuntime, PROMPT_KEY } from '../runtime.js';
const rule = (mode = 'exclude', start = '<Panel>', end = '</Panel>') => ({start, end, mode, enabled:true});
const settings = (...rules) => ({sceneSourceRules:rules});
const panel = `<Scene_Info><small>
Date: 2026.10.28 | Time: 12:00 | Season: Autumn
Weather: ☀️ Sunny · 20°C
Loc: Garden
🔥 Sexual Arousal: 91%
🧠 Self-Control: 2%
👗 Reader:
• blue coat
• boots
👔 Alex:
• linen shirt
🪴 Posture: seated, cross-legged
🧠 Alex: PRIVATE_THOUGHT
📎 Alex rn: SECRET_TMI
• SECRET_BULLET
</small></Scene_Info>`;
const physical = rule('physical','<Scene_Info>','</Scene_Info>');

test('no defaults, invalid/self record delimiters rejected, duplicate rules normalized',()=>{
 assert.deepEqual(normalizeSourceRules(),[]);
 for(const [a,b] of [['','x'],['x','x'],['<sfw_scene>','</sfw_scene>'],['<scene_state>','x'],['a\nb','z'],['x'.repeat(161),'z']]) assert.equal(validSourceDelimiters(a,b),false);
 assert.deepEqual(normalizeSourceRules(settings(rule(),rule(),{...rule('bad','[.*]','[/.*]'),enabled:false})),[rule(),{...rule('exclude','[.*]','[/.*]'),enabled:false}]);
 assert.equal(normalizeSourceRules(settings(...Array.from({length:30},(_,i)=>rule('exclude',`[${i}]`,`[/${i}]`)))).length,20);
});
test('exact literal ranges, repeated blocks, disabled rules and unchanged original',()=>{
 const original='Before [.*]secret[/.*] middle [.*]secret2[/.*] after';
 assert.equal(filterSceneSources(original,{}),original);
 assert.equal(filterSceneSources(original,settings({...rule('exclude','[.*]','[/.*]'),enabled:false})),original);
 assert.equal(filterSceneSources(original,settings(rule('exclude','[.*]','[/.*]'))),'Before \n middle \n after');
 assert.match(original,/secret2/);
 assert.equal(filterSceneSources('<panel>keep</panel>',settings(rule())),'<panel>keep</panel>');
});
test('user template physical fields survive; thoughts, TMI and numerical meters do not',()=>{
 const fields=extractPhysicalReference(panel);
 assert.deepEqual(fields.map(x=>x.field),['date','time','season','weather','location','clothing','clothing','posture']);
 assert.deepEqual(fields.find(x=>x.subject==='Reader').values,['blue coat','boots']);
 assert.deepEqual(fields.find(x=>x.subject==='Alex').values,['linen shirt']);
 const output=filterSceneSources('BODY'+panel+'TAIL',settings(physical));
 assert.match(output,/BODY[\s\S]*blue coat[\s\S]*TAIL/);
 assert.doesNotMatch(output,/PRIVATE|SECRET|91%|2%|Arousal|Self-Control/);
 assert.doesNotMatch(filterSceneSources(panel,settings(physical),{physical:false}),/coat/);
});
test('recognized Korean labels, named inventory and HTML; unknown headings stop inventory',()=>{
 const data=extractPhysicalReference('<div>장소: 마당</div><div>복장(민수): 코트</div>• 모자\n속마음: 비밀\n• 제외\n소지품: 우산\n• 열쇠\nClothing: jacket | TMI: hidden\n• hidden too');
 assert.deepEqual(data,[{field:'location',values:['마당']},{field:'clothing',subject:'민수',values:['코트','모자']},{field:'holding',values:['우산','열쇠']},{field:'clothing',values:['jacket']}]);
});
test('disabled physical collection fields cannot leak into repair reference',()=>{
 const selected={...settings(physical),sceneCollection:{fields:{appearance:false,time:false}}};
 const output=filterSceneSources(panel,selected);
 assert.doesNotMatch(output,/blue coat|linen shirt|2026|12:00/);assert.match(output,/Garden/);
 assert.equal(filterSceneSources(panel,{...selected,sceneCollection:{enabled:false}}),'\n');
});
test('unclosed, crossed and nested registered regions fail closed; adjacent regions work',()=>{
 for(const source of ['<Panel>Location: hidden','<Panel>Location: hidden\n<Panel>Location: deep</Panel></Panel>','<Panel>Location: hidden<Inner>private</Inner></Panel>','<Panel>Location: hidden<Inner></Panel>private</Inner>']) {
  assert.equal(filterSceneSources(source,settings(rule('physical'),rule('exclude','<Inner>','</Inner>'))),'\n');
 }
 assert.equal(filterSceneSources('<Panel>x</Panel><Panel>y</Panel>',settings(rule())),'\n\n');
});
test('legacy direct reader respects rules, field switches and physical labeled supplements',()=>{
 const raw='<Info_panel>[Date: RP Tuesday]\n[날씨: 비]\n[Location: room]</Info_panel>';
 assert.deepEqual(sourcePanelField(raw,{},'Date','날짜'),{en:'RP Tuesday',ko:'RP Tuesday'});
 const exclude=settings(rule('exclude','<Info_panel>','</Info_panel>'));
 assert.equal(sourcePanelField(raw,exclude,'Date','날짜'),'');
 assert.deepEqual(sourcePanelField(panel,settings(physical),'Location','장소'),{en:'Garden',ko:'Garden'});
 assert.equal(sourcePanelField(panel,{...settings(physical),sceneCollection:{fields:{time:false}}},'Date','날짜'),'');
});
test('main and repair instructions use only requested mode settings',()=>{
 const options={sfw:settings(rule('exclude','<General>','</General>')),nsfw:settings(physical),monitor:true};
 for(const repair of [false,true]){
  const general=compactReportLines('sfw',options,{repair}).join('\n'),intimate=compactReportLines('nsfw',options,{repair}).join('\n');
  assert.match(general,/SFW RECORD SOURCE RULES/);assert.match(general,/<General>/);assert.doesNotMatch(general,/<Scene_Info>/);
  assert.match(intimate,/NSFW RECORD SOURCE RULES/);assert.match(intimate,/<Scene_Info>/);assert.doesNotMatch(intimate,/<General>/);
 }
 assert.deepEqual(sourceRuleInstructions({}),[]);
});

globalThis.document = {getElementById:()=>null,querySelectorAll:()=>[]};
const record=(heat=0,time='BODY_TIME')=>({_v:2,heat,scene:{location:'BODY_ROOM',time,environment:'Clear',important_objects:{},characters:{Alex:{appearance:'shirt',position:'standing',holding:'',condition:'',contact:''}},scene_type:'conversation',intensity:0,acts:['Agreed to meet'],dialogue_beats:['greeting'],dialogue_flow:{topic:'greeting',last_question:'',new_facts:[]},next:['Plan a meeting']}});
function fixture(kind){
 const source=new EventEmitter(),prompts={};let calls=0;
 const context={characterId:0,chatId:'a',chat:[],chatMetadata:{},extensionSettings:{
  'ttotto-sfw':{enabled:true,settingsSchemaVersion:4,autoRefine:false,slowBurnEnabled:false},
  'ttotto-nsfw':{enabled:true,settingsSchemaVersion:3,adultConfirmed:true,armMode:kind==='nsfw'?'manual':'stealth',autoRefine:false,slowBurnEnabled:false}
 },eventSource:source,eventTypes:Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_SWIPED','MESSAGE_EDITED','CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),
 setExtensionPrompt:(key,text)=>prompts[key]=text,saveSettingsDebounced(){},saveMetadataDebounced(){},saveChat(){},generateRaw:async()=>{calls++;throw new Error('Unexpected API call');}};
 const runtime=createRuntime(()=>context,{notify:{}});
 const receive=(body,data=record(kind==='nsfw'?8:0))=>{
  const tag=kind==='nsfw'?'scene_state':'sfw_scene';const m={mes:body+`<${tag}>${JSON.stringify(data)}</${tag}>`,swipe_id:0};context.chat.push(m);source.emit('MESSAGE_RECEIVED',context.chat.length-1);return m;
 };
 return {runtime,context,receive,prompt:()=>prompts[PROMPT_KEY],calls:()=>calls};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const kind of ['sfw','nsfw']){
 test(`${kind}: deployed repair filters copies, scopes requests, retains visible body and other settings`,async()=>{
  const r=fixture(kind);await r.runtime.start({withUi:false});
  try{
   const active=r.runtime.features[kind].getSettings(),other=r.runtime.features[kind==='sfw'?'nsfw':'sfw'].getSettings();
   active.sceneSourceRules=[physical,rule('exclude','<Inner_Info>','</Inner_Info>')];other.sceneSourceRules=[rule('exclude','<OTHER>','</OTHER>')];
   const body='ON_PAGE_BODY'+panel+'<Inner_Info>PRIVATE_EXCLUDED</Inner_Info><OTHER>KEEP_OTHER</OTHER>';
   const message=r.receive(body);const old=JSON.stringify(message.extra),otherSaved=JSON.stringify(other.sceneSourceRules);
   await r.runtime.intercept([],1000,null,'normal');
   assert.match(r.prompt(),/<Scene_Info>/);assert.doesNotMatch(r.prompt(),/<OTHER>/);
   assert.equal(message.mes,body);assert.equal(JSON.stringify(message.extra),old);assert.equal(r.calls(),0);
   let requests=0;r.context.generateRaw=async({prompt})=>{
    requests++;assert.match(prompt[0].content,new RegExp(kind.toUpperCase()+' RECORD SOURCE RULES'));
    const input=prompt[1].content;assert.match(input,/ON_PAGE_BODY/);assert.match(input,/blue coat/);assert.match(input,/KEEP_OTHER/);assert.doesNotMatch(input,/PRIVATE|SECRET|91%|2%/);
    return JSON.stringify(record(kind==='nsfw'?8:0));
   };
   assert.equal(await r.runtime.features[kind].runRefine({manual:true}),true);
   assert.equal(requests,1);assert.equal(message.mes,body);assert.equal(JSON.stringify(other.sceneSourceRules),otherSaved);
  }finally{r.runtime.stop();}
 });
 test(`${kind}: changing source rules during repair rejects the old result`,async()=>{
  const r=fixture(kind);await r.runtime.start({withUi:false});
  try{
   const message=r.receive('Body'),before=JSON.stringify(message.extra);let finish;
   r.context.generateRaw=()=>new Promise(resolve=>finish=resolve);
   const pending=r.runtime.features[kind].runRefine({manual:true});await tick();assert.ok(finish);
   r.runtime.features[kind].getSettings().sceneSourceRules=[rule()];
   const next=record(kind==='nsfw'?8:0);next.scene.location='STALE_REPAIR';finish(JSON.stringify(next));
   assert.equal(await pending,false);assert.equal(JSON.stringify(message.extra),before);
  }finally{r.runtime.stop();}
 });
 test(`${kind}: shared SFW direct reader follows active mode exclusions`,async()=>{
  const r=fixture(kind);await r.runtime.start({withUi:false});
  try{
   r.runtime.features[kind].getSettings().sceneSourceRules=[rule('exclude','<Info_panel>','</Info_panel>')];
   r.runtime.features[kind==='sfw'?'nsfw':'sfw'].getSettings().sceneSourceRules=[];
   r.receive('<Info_panel>[Date: FORBIDDEN_DATE]</Info_panel>',record(kind==='nsfw'?8:0,''));
   assert.doesNotMatch(JSON.stringify(r.runtime.core.commonSummary()),/FORBIDDEN_DATE/);
   assert.equal(r.calls(),0);
  }finally{r.runtime.stop();}
 });
}
test('physical panel supplements missing time but does not overwrite current body time',async()=>{
 const r=fixture('sfw');await r.runtime.start({withUi:false});
 try{
  r.runtime.features.sfw.getSettings().sceneSourceRules=[physical];
  r.receive(panel,record(0,'BODY_TIME'));assert.equal(r.runtime.core.commonSummary().state.time.ko,'BODY_TIME');
  r.receive(panel,record(0,''));assert.match(r.runtime.core.commonSummary().state.time.ko,/2026.10.28.*12:00/);
 }finally{r.runtime.stop();}
});

test('NSFW local detection ignores registered panels, still detects ordinary prose, independent of SFW rules',async()=>{
 for(const treatment of ['exclude','physical']){
  const r=fixture('sfw');await r.runtime.start({withUi:false});
  try{
   const intimate=r.runtime.features.nsfw.getSettings();intimate.stealthKeywords='TOKEN_A,TOKEN_B,TOKEN_C';
   intimate.sceneSourceRules=[rule(treatment)];r.runtime.features.sfw.getSettings().sceneSourceRules=[];
   r.receive('<Panel>Clothing: TOKEN_A TOKEN_B TOKEN_C</Panel>');
   assert.equal(r.runtime.owner(),'sfw');
   r.context.chat.push({is_user:true,mes:'TOKEN_A TOKEN_B TOKEN_C'});
   await r.runtime.intercept([],1000,null,'normal');assert.equal(r.runtime.owner(),'nsfw');
   assert.equal(r.calls(),0);
  }finally{r.runtime.stop();}
 }
});
