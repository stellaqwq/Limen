import {access,lstat,readdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export async function sevenZipExecutable(){
  const candidates=[process.env.LIMEN_7ZIP,process.env.XUQIAO_7ZIP,join(process.env.ProgramFiles||'C:/Program Files','7-Zip','7z.exe')].filter(Boolean);
  for(const candidate of candidates){try{await access(candidate);return candidate;}catch{}}
  throw Error('Windows 打包需要 7-Zip。请安装 7-Zip，或通过 LIMEN_7ZIP 指定 7z.exe 路径（旧名 XUQIAO_7ZIP 仍可用）；成品应用无需安装它。');
}
async function run(executable,args,cwd){
  await new Promise((ok,fail)=>{const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','ignore','pipe']});let diagnostic='';child.stderr.on('data',bytes=>{if(diagnostic.length<4096)diagnostic+=bytes.toString();});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(Error('ZIP 操作失败 ('+code+'): '+diagnostic.trim())));});
}
export async function verifyWindowsZip(archive,{executable}={}){
  await run(executable||await sevenZipExecutable(),['t','-bso0','-bsp0','-bse1',resolve(archive)],process.cwd());
}
export async function createWindowsZip(directory,target){
  directory=resolve(directory);target=resolve(target);
  try{await lstat(target);throw Error('ZIP output already exists: '+target);}catch(error){if(error.code!=='ENOENT')throw error;}
  const files=[];
  async function visit(current){for(const entry of (await readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(current,entry.name);if(entry.isSymbolicLink())throw Error('ZIP refuses symbolic links.');if(entry.isDirectory())await visit(path);else if(entry.isFile()){if(resolve(path)===target)throw Error('ZIP output must be outside its input directory.');files.push(relative(directory,path).replaceAll('\\','/'));}}}
  await visit(directory);if(!files.length)throw Error('ZIP input is empty.');
  const executable=await sevenZipExecutable(),list=join(tmpdir(),'limen-zip-'+randomUUID()+'.txt');
  await writeFile(list,files.join('\n')+'\n',{flag:'wx'});
  try{
    // Native Deflate with finalized file headers, compatible with Explorer.
    await run(executable,['a','-tzip','-mm=Deflate','-mx=6','-mcu=on','-scsUTF-8','-sse','-bso0','-bsp0','-bse1',target,'@'+list],directory);
    await verifyWindowsZip(target,{executable});
  }finally{await unlink(list);}
}
