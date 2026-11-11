import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {initializeEnv} from '../scripts/init.mjs';
import {launchWorkspace} from '../scripts/launch.mjs';
import {loadConfig} from '../src/config.mjs';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {bundledQQRuntime} from '../src/qq/runtime-location.mjs';
import {applySeedDriver} from './env-seed.mjs';

const directory=process.argv[2];
const appRoot=fileURLToPath(new URL('..',import.meta.url));
if(!directory||!isAbsolute(directory))throw Error('桌面数据目录必须是绝对路径。');
await mkdir(directory,{recursive:true});process.chdir(directory);
let workspace,seeded,stopping=false;
const send=message=>{if(process.connected)process.send(message);};
async function stop(){if(stopping)return;stopping=true;await workspace?.close();process.exit(0);}
process.on('message',message=>{if(message?.type==='stop')void stop();});
process.once('disconnect',()=>void stop());
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
try{
  const demo=process.argv.includes('--demo'),settingsPath=join(directory,'.env');
  const initialized=initializeEnv(directory);
  const includesQQ=existsSync(join(bundledQQRuntime,'runtime.json'));
  seeded=await applySeedDriver({directory,settingsPath,appRoot,demo,includesQQ,created:initialized.created});
  if(seeded.changed)send({type:'progress',text:'QQ 驱动已设为 '+seeded.driver});
  const env=parseEnv(await readFile(settingsPath,'utf8'));
  if(demo)Object.assign(env,{QQ_DRIVER:'demo',QQ_ACCOUNT:'10000',AI_ENABLED:'false',PORT:'0',DATA_DIR:'./demo-data'});
  const config=loadConfig(env);
  workspace=await launchWorkspace(config,{settingsPath,prepareRuntime:!demo,notify:line=>send({type:'progress',text:line||'正在准备 QQ 运行环境…'})});
  if(stopping){await workspace.close();process.exit(0);}
  const kernel=workspace.app?.adapter.status().kernel;
  send({type:'ready',url:workspace.url,reused:workspace.reused,demo:demo||env.QQ_DRIVER==='demo',driver:config.driver,driver_source:seeded?.reason||'',bundledKernel:config.kernel.runtime===bundledQQRuntime,kernelLoaded:kernel?.core_loaded===true,qqVersion:kernel?.version});
}catch(error){
  // Persist only fixed diagnostic fields, never environment values or a stack.
  await writeFile(join(directory,'desktop-startup-error.json'),JSON.stringify({time:new Date().toISOString(),reason:error.reason||'desktop_startup_failed',code:error.code||1500,stage:error.startupStage||'launch_workspace'},null,2)+'\n').catch(()=>{});
  stopping=true;send({type:'failure',text:error.message});process.exitCode=1;process.disconnect?.();
}
