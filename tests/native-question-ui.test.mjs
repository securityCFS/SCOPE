import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import ts from "typescript";
import {JSDOM} from "jsdom";
const base = new URL('../features/conversation/',import.meta.url);
const hooks=registerHooks({resolve(specifier,context,next){
  if (context.parentURL?.startsWith(base.href) && specifier.startsWith('./') && !specifier.endsWith('.css')) return {url:new URL(`${specifier}.tsx`,context.parentURL).href,shortCircuit:true};
  return next(specifier,context);
},load(url,context,next){
  if(url.startsWith(base.href)&&url.endsWith('.css'))return {format:'module',shortCircuit:true,source:''};
  if(url.startsWith(base.href)&&url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
  return next(url,context);
}});
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createElement:h,act}=await import('react');const {createRoot}=await import('react-dom/client');
const {NativePermissionRequest}=await import(new URL('NativePermissionRequest.tsx',base));
const {NativeElicitation}=await import(new URL('NativeElicitation.tsx',base));
hooks.deregister();
const container=document.getElementById('root');
function click(label){return act(()=>[...container.querySelectorAll('button')].find(b=>b.textContent===label).click());}
test('Claude selections survive polling and emit exact labels only after submit',async()=>{
 const root=createRoot(container);const sent=[];
 const request={id:'p1',tool:'AskUserQuestion',input:{questions:[{question:'Colors?',multiSelect:true,options:[{label:'Red'},{label:'Blue'},{label:'Green'}]},{question:'Format?',options:[{label:'Short'},{label:'Detailed'}]}]}};
 const render=disabled=>act(()=>root.render(h(NativePermissionRequest,{request,disabled,respond:(...a)=>sent.push(a)})));
 try{
  await render(false);await click('提交回答');assert.equal(sent.length,0);
  for(const index of [0,2,3])await act(()=>container.querySelectorAll('input[type=checkbox],input[type=radio]')[index].click());
  assert.equal(sent.length,0);await render(false);assert.equal(container.querySelectorAll('input:checked').length,3);
  await click('提交回答');assert.deepEqual(sent,[['allow',{'Colors?':'Red, Green','Format?':'Short'}]]);
  await render(true);await click('提交回答');assert.equal(sent.length,1);
 }finally{await act(()=>root.unmount());}
});
test('AGY multi-select returns schema values as an array, never displayed labels',async()=>{
 const root=createRoot(container);const sent=[];
 try{
  await act(()=>root.render(h(NativeElicitation,{fields:[{name:'q1',title:'Colors',type:'array',required:true,minItems:2,options:[{label:'Red',value:'1'},{label:'Blue',value:'2'},{label:'Green',value:'3'}]}],disabled:false,respond:(...a)=>sent.push(a)})));
  await act(()=>container.querySelectorAll('input')[0].click());await click('提交回答');assert.equal(sent.length,0);
  await act(()=>container.querySelectorAll('input')[2].click());await click('提交回答');assert.deepEqual(sent,[['allow',{q1:['1','3']}]]);
  await click('取消');assert.equal(sent.at(-1)[0],'cancel');
 }finally{await act(()=>root.unmount());}
});
test('ACP approval keeps persistent and single-use option IDs distinct',async()=>{
 const root=createRoot(container);const sent=[];
 try{
  await act(()=>root.render(h(NativePermissionRequest,{request:{id:'1',tool:'Write',input:{path:'/tmp/test'},options:[{optionId:'once',name:'允许本次',kind:'allow_once'},{optionId:'always',name:'允许此目录',kind:'allow_always'}]},disabled:false,respond:(...a)=>sent.push(a)})));
  await click('允许本次');assert.deepEqual(sent[0],['allow',undefined,'once']);
  await click('取消');assert.equal(sent[1][0],'deny');
 }finally{await act(()=>root.unmount());}
});
