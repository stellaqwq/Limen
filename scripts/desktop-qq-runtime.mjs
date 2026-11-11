import {mkdir,readFile,writeFile,lstat,cp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {verifyRuntime} from '../src/qq/kernel/runtime.mjs';

const privatePath=/(?:^|\/)(?:nt_qq|User Data|Crashpad|crash_dumps|sessions|qq-kernel|Cookies|Login Data|Local State|\.env|bot\.sqlite|device\.json)(?:\/|$)|\.(?:log|session|sqlite)(?:$|-)/i;
export async function bundleDesktopQQ(source,destination){
  const runtime=await verifyRuntime(source),root=resolve(source);
  if(runtime.source!=='official-qq-program-files'||runtime.binary_modified!==false||runtime.entry_modified!==false)throw Error('Only an unmodified official QQ program runtime can be bundled.');
  const files=runtime.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),names=new Set();
  for(const file of files){
    const parts=file.path.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..')||file.path.includes('\\')||privatePath.test(file.path)||names.has(file.path.toLowerCase()))throw Error('QQ runtime inventory contains a private or invalid path: '+file.path);
    names.add(file.path.toLowerCase());
    let current=root;
    for(const part of ['',...parts]){if(part)current=join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('QQ runtime export refuses symbolic links.');}
  }
  await mkdir(destination);
  // Copy only inventoried program bytes, never arbitrary adjacent account data.
  for(const file of files){const target=join(destination,file.path);await mkdir(dirname(target),{recursive:true});await cp(join(root,file.path),target,{force:false,errorOnExist:true});}
  const manifest={schema:1,version:runtime.version,architecture:runtime.architecture,source:'official-qq-program-files',created_at:new Date().toISOString(),executable:runtime.executable,app:runtime.app,entry_modified:false,binary_modified:false,files,validation:{launched:false,qr_received:false,authenticated:false,messages_received:false,messages_sent:false}};
  await writeFile(join(destination,'runtime.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await verifyRuntime(destination);
  return {version:runtime.version,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),directory:'resources/qq-runtime'};
}
