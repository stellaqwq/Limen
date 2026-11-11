import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {verifyRuntime} from '../src/qq/kernel/runtime.mjs';
import {verifyWindowsZip} from './windows-zip.mjs';

const output=resolve(process.argv[2]),manifest=JSON.parse(await readFile(join(output,'ARTIFACTS.json'),'utf8'));
for(const item of manifest.files){await verifyWindowsZip(join(output,item.name));const hash=createHash('sha256');let size=0;for await(const bytes of createReadStream(join(output,item.name))){hash.update(bytes);size+=bytes.length;}assert.equal(size,item.bytes);assert.equal(hash.digest('hex'),item.sha256);}
const source=unzipSync(await readFile(join(output,'Limen-source.zip'))),names=Object.keys(source);
assert.ok(names.includes('desktop/main.mjs'));assert.ok(names.includes('desktop/assets/icon.ico'));assert.ok(names.includes('src/web/workspace-layout.mjs'));
assert.ok(names.every(name=>!/(?:^|\/)(?:data|runtime|node_modules)\//.test(name)&&!/(?:^|\/)\.env$|\.sqlite|\.session/.test(name)));
const entries=JSON.parse(Buffer.from(source['SOURCE-MANIFEST.json']).toString('utf8')).files;
assert.equal(names.length,entries.length+1);
for(const entry of entries)assert.equal(createHash('sha256').update(source[entry.path]).digest('hex'),entry.sha256);
let appFiles=0;
async function inspect(directory,prefix=''){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const name=prefix+entry.name,path=join(directory,entry.name);
    assert.ok(!entry.isSymbolicLink());
    assert.ok(!/(?:^|\/)\.env$|\.sqlite(?:$|-)|\.session$/.test(name),'Private file: '+name);
    assert.ok(!/^resources\/app\/(?:data|runtime\/(?!desktop(?:\/|$)))/.test(name),'Private directory: '+name);
    if(entry.isDirectory())await inspect(path,name+'/');else appFiles++;
  }
}
const app=join(output,'Limen-win32-x64');await inspect(app);
const selected=new Set(['Limen.exe','resources/app/runtime/desktop/node.exe','resources/app/desktop/main.mjs','resources/app/package.json']);
let qq;
if(manifest.qqRuntime){
  assert.equal(manifest.qqRuntime.directory,'resources/qq-runtime');
  qq=await verifyRuntime(join(app,manifest.qqRuntime.directory));
  assert.equal(qq.version,manifest.qqRuntime.version);assert.equal(qq.files.length,manifest.qqRuntime.files);
  selected.add('resources/qq-runtime/runtime.json');selected.add('resources/qq-runtime/'+qq.app+'/wrapper.node');
}
const archive=manifest.files.find(file=>/^Limen-Windows-x64-/.test(file.name));assert.ok(archive);
const qqArchive=new Set();
const extracted=unzipSync(await readFile(join(output,archive.name)),{filter:file=>{if(file.name.startsWith('resources/qq-runtime/'))qqArchive.add(file.name.slice('resources/qq-runtime/'.length));return selected.has(file.name);}});
if(qq)assert.deepEqual([...qqArchive].sort(),[...qq.files.map(file=>file.path),'runtime.json'].sort());
for(const name of selected){assert.ok(extracted[name],'Missing ZIP entry '+name);assert.deepEqual(Buffer.from(extracted[name]),await readFile(join(app,name)));}
const report={success:true,source_files:entries.length,app_files:appFiles,sha256_verified:true,all_files_crc_verified:true,archive_extraction_verified:true,private_files:0,...(qq?{bundled_qq:{version:qq.version,files:qq.files.length,binaries_modified:false}}:{})};
await writeFile(join(output,'VERIFICATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
