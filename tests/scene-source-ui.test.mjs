import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneSourceUi} from '../scene-source-ui.js';

function node(tag='div') {
 return {tag,children:[],value:'',textContent:'',events:{},attrs:{},
  append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
  setAttribute(name,value){this.attrs[name]=value;},addEventListener(name,fn){this.events[name]=fn;},
  dispatch(name){this.events[name]?.({target:this});}};
}
function panel(){
 const controls=Object.fromEntries(['list','start','end','mode','status','add'].map(key=>[key,node()]));controls.mode.value='exclude';
 return {controls,querySelector(selector){return controls[selector.match(/data-source-(\w+)/)[1]];}};
}
test('two source settings panels add/toggle/change/delete independently and persist without rendering tags as HTML',()=>{
 const old=globalThis.document;globalThis.document={createElement:node};
 try{
  const sfw=panel(),nsfw=panel(),a={},b={};let saves=0;
  const first=createSceneSourceUi(sfw,()=>a,()=>saves++);createSceneSourceUi(nsfw,()=>b,()=>saves++);
  assert.equal(a.sceneSourceRules,undefined);assert.equal(b.sceneSourceRules,undefined);
  const add=(target,start,end)=>{target.controls.start.value=start;target.controls.end.value=end;target.controls.add.dispatch('click');};
  add(sfw,'<Inner_Info>','</Inner_Info>');assert.equal(saves,1);assert.equal(a.sceneSourceRules[0].mode,'exclude');assert.equal(b.sceneSourceRules,undefined);
  assert.equal(sfw.controls.list.children[0].children[0].textContent,'<Inner_Info> … </Inner_Info>');
  add(sfw,'<Inner_Info>','</Inner_Info>');assert.equal(saves,1);assert.match(sfw.controls.status.textContent,/이미/);
  add(sfw,'same','same');assert.equal(saves,1);
  add(sfw,'<sfw_scene>','</sfw_scene>');assert.equal(saves,1);
  nsfw.controls.mode.value='physical';add(nsfw,'<Scene_Info>','</Scene_Info>');assert.equal(b.sceneSourceRules[0].mode,'physical');
  let actions=sfw.controls.list.children[0].children[1];const enabled=actions.children[0].children[0];enabled.checked=false;enabled.dispatch('change');
  assert.equal(a.sceneSourceRules[0].enabled,false);assert.equal(b.sceneSourceRules[0].enabled,true);
  actions=sfw.controls.list.children[0].children[1];actions.children[1].value='physical';actions.children[1].dispatch('change');
  assert.equal(a.sceneSourceRules[0].mode,'physical');
  first.render();sfw.controls.list.children[0].children[1].children[2].dispatch('click');
  assert.deepEqual(a.sceneSourceRules,[]);assert.equal(b.sceneSourceRules.length,1);assert.equal(saves,5);
  const reopened=panel();createSceneSourceUi(reopened,()=>b,()=>{});
  assert.equal(reopened.controls.list.children[0].children[1].children[1].value,'physical');
 }finally{globalThis.document=old;}
});
