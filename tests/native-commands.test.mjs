import test from 'node:test';
import assert from 'node:assert/strict';
import {commandName,normalizeCommands,NativeCommands} from '../bridge/providers/native-commands.mjs';
test('command parsing preserves namespaced skills and excludes paths/prose',()=>{
 assert.equal(commandName('/plugin:review current file'),'plugin:review');
 assert.equal(commandName('/data/research/paper.tex'),null);
 assert.equal(commandName('Please /compact later'),null);
 assert.deepEqual(normalizeCommands(['compact',{name:'plugin:review',description:'review'}, {name:'../bad'}]).map(c=>c.name),['compact','plugin:review']);
});
test('catalog cache is scoped by host, provider, directory; unknown slash never reaches model',async()=>{
 const calls=[];const service=new NativeCommands({hosts:()=>[{alias:'h',reachable:true}],settings:()=>({executable:'claude', preLaunchCommand:'source ~/.env.sh'}),run:async(...args)=>{calls.push(args);return {code:0,stdout:'{"commands":[{"name":"compact"}]}'};}});
 await service.list('h','claude','/work');await service.list('h','claude','/work');assert.equal(calls.length,1);
 await service.list('h','claude','/other');assert.equal(calls.length,2);
 await service.validate('h','claude','/work','/compact');
 await assert.rejects(service.validate('h','claude','/work','/login'),/不在/);
 await assert.rejects(service.validate('h','antigravity','/work','/compact',[]),/不在/);
 await assert.rejects(service.list('h','antigravity','/work'),/首次建立/);
 assert.equal(calls.length,2,'opening the AGY menu must never create a probe session');
 assert.ok(calls[0][1].includes('source ~/.env.sh'));
});
