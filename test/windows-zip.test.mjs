import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {unzipSync} from 'fflate';
import {createWindowsZip} from '../scripts/windows-zip.mjs';
import {temp} from './helpers.mjs';

test('Windows ZIP archives pass CRC checks and native extraction for binary, Unicode and empty files',async t=>{
  const root=await temp(t),source=join(root,'input'),target=join(root,'application.zip'),extracted=join(root,'extracted');
  await mkdir(join(source,'nested'),{recursive:true});
  const bytes=Buffer.alloc(1024*1024+17);let seed=0x12345678;for(let i=0;i<bytes.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bytes[i]=i%3===0?seed&255:i%251;}
  const files={'icudtl.dat':bytes,'nested/中文说明.txt':Buffer.from('完整解压后运行应用。'),'empty.txt':Buffer.alloc(0),'.env.example':Buffer.from('TOKEN=\n')};
  for(const [name,data]of Object.entries(files))await writeFile(join(source,name),data);
  await createWindowsZip(source,target);
  assert.deepEqual(Object.keys(unzipSync(await readFile(target))).sort(),Object.keys(files).sort());
  await new Promise((ok,fail)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:XUQIAO_ZIP_TEST_ARCHIVE,$env:XUQIAO_ZIP_TEST_EXTRACT)'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,XUQIAO_ZIP_TEST_ARCHIVE:target,XUQIAO_ZIP_TEST_EXTRACT:extracted}});
    let error='';child.stderr.on('data',bytes=>error+=bytes);child.once('error',fail);child.once('exit',code=>code===0?ok():fail(Error(error)));
  });
  for(const [name,data]of Object.entries(files))assert.deepEqual(await readFile(join(extracted,name)),data);
  const before=await readFile(target);await assert.rejects(createWindowsZip(source,target),/already exists/);assert.deepEqual(await readFile(target),before);
});
