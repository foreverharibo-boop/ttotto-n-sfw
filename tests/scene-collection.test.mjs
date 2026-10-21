import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const env={structuredClone};vm.createContext(env);
vm.runInContext(fs.readFileSync(new URL('../compact-report.js',import.meta.url),'utf8').replaceAll('export function ','function ')+';globalThis.api={sceneCollectionFields,filterSceneCollection,compactReportLines};',env);
const {sceneCollectionFields,filterSceneCollection,compactReportLines}=env.api;
const record={_v:2,heat:8,stage:4,scene:{location:'LOC',time:'TIME',environment:'ENV',important_objects:{a:'OBJECT'},characters:{A:{appearance:'CLOTHES',position:'POSE',holding:'HELD',condition:'CONDITION',contact:'CONTACT'}},scene_type:'romance',intensity:4,acts:['EVENT'],dialogue_beats:['INTENT'],dialogue_flow:{topic:'TOPIC'},next:['NEXT']}};
const values={location:'LOC',time:'TIME',environment:'ENV',objects:'OBJECT',appearance:'CLOTHES',position:'POSE',holding:'HELD',condition:'CONDITION',contact:'CONTACT'};
for(const key of Object.keys(values))test('select only '+key+' without relocating other fields',()=>{
 const fields=Object.fromEntries(Object.keys(values).map(k=>[k,k===key]));
 const settings={sceneCollection:{fields}};
 const filtered=JSON.stringify(filterSceneCollection(record,settings));
 for(const [k,value]of Object.entries(values))assert.equal(filtered.includes(value),k===key,k);
 assert.ok(filtered.includes('EVENT'));assert.ok(filtered.includes('TOPIC'));assert.ok(filtered.includes('NEXT'));
 const lines=compactReportLines('nsfw',{nsfw:settings},{repair:true});
 const schema=JSON.parse(lines[1]);assert.equal('time' in schema.scene,key==='time');
 assert.equal(lines.some(line=>line.startsWith('Use RP time only')),key==='time');
});
test('defaults preserve original data and SFW schemas ignore NSFW selections',()=>{
 assert.equal(filterSceneCollection(record,{}),record);
 const full=compactReportLines('sfw',{nsfw:{sceneCollection:{enabled:false}}},{repair:true});
 assert.ok(JSON.parse(full[1]).scene.characters.name.appearance!==undefined);
 const off=filterSceneCollection(record,{sceneCollection:{enabled:false}});
 assert.equal(off.heat,8);assert.equal(off.stage,4);assert.ok(record.scene.location);
 const legacy=filterSceneCollection({location:'L',characters:{A:{clothing:'C',position:'P',contact:'X'}}},{sceneCollection:{enabled:false}});
 assert.equal(legacy.location,undefined);assert.equal(Object.keys(legacy.characters).length,0);
});

test('selection controls persist independently; master off preserves individual choices',()=>{
 const nodes=new Map(),settings={};let saved=0;
 const element=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(type,fn){this.change=fn;}});return nodes.get(id);};
 const box={...env,element,getSettings:()=>settings,getContext:()=>({saveSettingsDebounced(){saved++;}}),clearInjectedPrompt(){},updateUi(){box.renderSceneCollectionUi();}};
 vm.createContext(box);
 vm.runInContext(fs.readFileSync(new URL('../scene-collection-ui.js',import.meta.url),'utf8'),box);
 box.renderSceneCollectionUi();box.bindSceneCollectionUi();
 const time=element('tns-scene-collect-time'),master=element('tns-scene-collection-enabled');
 assert.equal(time.checked,true);time.checked=false;time.change();
 master.checked=false;master.change();assert.equal(time.disabled,true);
 master.checked=true;master.change();assert.equal(time.disabled,false);assert.equal(time.checked,false);
 assert.equal(element('tns-scene-collect-location').checked,true);assert.equal(saved,3);
});
test('deployed character renderer preserves selected inputs and hides disabled ones',()=>{
 const candidates=['../modes/nsfw/index.js','../index.js'];
 const path=candidates.map(p=>new URL(p,import.meta.url)).find(p=>fs.existsSync(p));
 const source=fs.readFileSync(path,'utf8');
 const start=source.indexOf('    const collectionFields = sceneCollectionFields(settings);');
 const body=source.slice(start,source.indexOf('    const actsList =',start));
 assert.ok(start>0);
 const make=()=>({children:[],value:'',hidden:false,append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(){},closest(){return this;}});
 const nodes=new Map();const element=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
 const state={location:'LOC',characters:{A:{clothing:'C',position:'P',contact:'X'}}};
 const common={characters:{A:{appearance:'C',position:'P',holding:'H',condition:'D',contact:'X'}}};
 const settings={};
 const ctx={sceneCollectionFields,settings,state,element,document:{createElement:make},unifiedHost:{commonState:()=>common},hasBi:v=>Boolean(v),biText:v=>v??''};
 vm.createContext(ctx);vm.runInContext('function render(){'+body+'};',ctx);
 ctx.render();const inputs=()=>element('tns-char-list').children[0].children.slice(1).map(wrap=>wrap.children[0].textContent);
 assert.ok(inputs().includes('자세·위치'));assert.ok(inputs().includes('접촉'));
 settings.sceneCollection={fields:{position:false,contact:false}};ctx.render();
 assert.equal(inputs().includes('자세·위치'),false);assert.equal(inputs().includes('접촉'),false);
 assert.ok(inputs().some(label=>label.includes('복장')));
 settings.sceneCollection={enabled:false};ctx.render();assert.deepEqual(inputs(),[]);assert.equal(element('tns-state-location').hidden,true);
});

test('production updateUi refreshes collection checkboxes on open and after each change',()=>{
 const path=['../modes/nsfw/index.js','../index.js'].map(p=>new URL(p,import.meta.url)).find(p=>fs.existsSync(p));
 const source=fs.readFileSync(path,'utf8');const start=source.indexOf('function updateUi() {');
 const end=source.indexOf('        const settings = getSettings();',start);
 const head=source.slice(start,end);let calls=0;
 vm.runInNewContext(head+'} catch(e){throw e;} }; updateUi();',{unifiedHost:{uiChanged(){}},uiReady:true,syncDiagnosticFetch(){},renderCustomInjectionUi(){},renderSceneCollectionUi(){calls++;}});
 assert.equal(calls,1);
});
