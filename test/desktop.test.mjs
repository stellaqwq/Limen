import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {localWorkspaceUrl,internalNavigation,externalNavigation} from '../desktop/policy.mjs';
import {config} from './helpers.mjs';

test('desktop navigation keeps local credentials within its workspace',()=>{
  const base='http://127.0.0.1:1027/login/abcdef';
  assert.equal(localWorkspaceUrl(base),true);
  for(const bad of ['https://example.com/login/abc','http://localhost/login/abc','http://secret@127.0.0.1/login/abc','file:///tmp/login/abc'])assert.equal(localWorkspaceUrl(bad),false);
  assert.equal(internalNavigation(base+'#agent',base),true);assert.equal(internalNavigation(base+'/admin/status',base),true);
  for(const bad of ['http://127.0.0.1:1027/login/abcdef-copy','https://example.com','file:///etc/passwd'])assert.equal(internalNavigation(bad,base),false);
  assert.equal(externalNavigation('https://www.douyin.com/'),true);
  for(const bad of ['javascript:alert(1)','file:///C:/secret','https://key@example.com/'])assert.equal(externalNavigation(bad),false);
});
test('desktop backend runs with independent data and stops through IPC',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'xuqiao-desktop-test-'));
  const child=fork(resolve('desktop/server.mjs'),[directory,'--demo'],{stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  t.after(async()=>{if(child.exitCode===null)child.kill();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const message=await Promise.race([new Promise((ok,fail)=>child.on('message',m=>m.type==='ready'?ok(m):m.type==='failure'?fail(Error(m.text)):null)),once(child,'exit').then(()=>{throw Error(stderr||'backend exited');})]);
  assert.equal(localWorkspaceUrl(message.url),true);assert.equal(message.demo,true);
  const response=await fetch(message.url);assert.equal(response.status,200);assert.match(await response.text(),/浏览与设备/);
  const text=await readFile(join(directory,'.env'),'utf8');assert.match(text,/QQ_DRIVER=demo/);assert.match(text,/ADMIN_ACCESS_TOKEN=[a-f0-9]{64}/);
  const exited=once(child,'exit');child.send({type:'stop'});assert.equal((await exited)[0],0);
  await assert.rejects(fetch(message.url));
});

test('desktop startup failures leave a bounded diagnostic record without credentials or exception text',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'xuqiao-desktop-failure-')),c=config(directory);
  await writeFile(join(directory,'.env'),`QQ_DRIVER=./missing-driver.mjs\nPORT=0\nONEBOT_ACCESS_TOKEN=${c.token}\nADMIN_ACCESS_TOKEN=${c.adminToken}\nSESSION_KEY=${c.sessionKey}\n`);
  const child=fork(resolve('desktop/server.mjs'),[directory],{stdio:['ignore','ignore','ignore','ipc']}),exited=once(child,'exit');
  t.after(async()=>{if(child.exitCode===null)child.kill();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  assert.equal((await exited)[0],1);
  const text=await readFile(join(directory,'desktop-startup-error.json'),'utf8'),report=JSON.parse(text);
  assert.equal(report.stage,'launch_workspace');assert.equal(report.reason,'desktop_startup_failed');
  for(const secret of [c.token,c.adminToken,c.sessionKey,'missing-driver.mjs'])assert.equal(text.includes(secret),false);
});
