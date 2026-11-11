import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {bundleDesktopQQ} from '../scripts/desktop-qq-runtime.mjs';
import {bundleQQ,verifyRuntime} from '../src/qq/kernel/runtime.mjs';
import {resolveQQRuntime} from '../src/qq/runtime-location.mjs';
import {temp} from './helpers.mjs';

async function fixture(root){
  const source=join(root,'official-install'),app=join(source,'resources','app'),runtime=join(root,'runtime');
  await mkdir(app,{recursive:true});await writeFile(join(source,'QQ.exe'),'fixture-executable');
  await writeFile(join(app,'package.json'),JSON.stringify({name:'qq-chat',version:'fixture-qq',main:'original.js',eleArch:'x64'}));
  await writeFile(join(app,'wrapper.node'),'fixture-native-module');
  await bundleQQ({source:join(source,'QQ.exe'),destination:runtime});return runtime;
}
test('desktop QQ export contains inventoried official program bytes and omits adjacent account files',async t=>{
  const root=await temp(t),runtime=await fixture(root),target=join(root,'portable-qq');
  await writeFile(join(runtime,'unlisted-account-secret.json'),'private account data');
  const result=await bundleDesktopQQ(runtime,target),manifest=await verifyRuntime(target);
  assert.equal(result.version,'fixture-qq');assert.equal(result.files,manifest.files.length);
  assert.equal(manifest.source_executable,undefined);assert.equal(manifest.entry_modified,false);assert.equal(manifest.binary_modified,false);
  assert.equal(await readFile(join(target,'resources','app','wrapper.node'),'utf8'),'fixture-native-module');
  await assert.rejects(access(join(target,'unlisted-account-secret.json')),{code:'ENOENT'});
  const moved=join(root,'moved-runtime');await rename(target,moved);assert.equal((await verifyRuntime(moved)).root,moved);
});
test('desktop QQ export rejects corrupted programs and private inventory entries',async t=>{
  const root=await temp(t),runtime=await fixture(root),module=join(runtime,'resources','app','wrapper.node');
  await writeFile(module,'tampered');await assert.rejects(bundleDesktopQQ(runtime,join(root,'bad-copy')),/integrity mismatch/);
  await writeFile(module,'fixture-native-module');
  const path=join(runtime,'runtime.json'),manifest=JSON.parse(await readFile(path,'utf8')),secret=Buffer.from('private');
  await writeFile(join(runtime,'.env'),secret);manifest.files.push({path:'.env',bytes:secret.length,sha256:createHash('sha256').update(secret).digest('hex')});
  await writeFile(path,JSON.stringify(manifest));await assert.rejects(bundleDesktopQQ(runtime,join(root,'private-copy')),/private or invalid path/);
});
test('portable QQ runtime follows the application folder while preserving custom and existing runtimes',async t=>{
  const root=await temp(t),cwd=join(root,'profile'),bundledDirectory=join(root,'application','qq-runtime');
  await mkdir(bundledDirectory,{recursive:true});await writeFile(join(bundledDirectory,'runtime.json'),'{}');
  const options={cwd,bundledDirectory};
  assert.equal(resolveQQRuntime(undefined,options),bundledDirectory);assert.equal(resolveQQRuntime('./runtime/qq',options),bundledDirectory);
  assert.equal(resolveQQRuntime('./custom-runtime',options),resolve(cwd,'custom-runtime'));
  const relocated=join(root,'relocated-qq');await rename(bundledDirectory,relocated);
  assert.equal(resolveQQRuntime('./runtime/qq',{cwd,bundledDirectory:relocated}),relocated);
  const existing=join(cwd,'runtime','qq');await mkdir(existing,{recursive:true});await writeFile(join(existing,'runtime.json'),'{}');
  assert.equal(resolveQQRuntime(undefined,{cwd,bundledDirectory:relocated}),existing);
});
