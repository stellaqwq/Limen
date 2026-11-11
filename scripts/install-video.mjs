import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {lockData} from '../src/data-lock.mjs';
import {PluginService} from '../src/plugins/service.mjs';
export async function installVideo(service,config){
  const existing=(await service.list()).plugins.find(p=>p.kind==='video-analysis');
  if(existing)return service.get(existing.id);
  let p=await service.install({kind:'video-analysis'});
  p=await service.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:[...config.ai.allowedUsers],groups:[...config.ai.allowedGroups]}}});
  return p;
}
async function main(){
  const config=loadConfig(),base='http://127.0.0.1:'+config.port;
  const call=async(path,params)=>{
    const response=await fetch(base+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+config.adminToken,'Content-Type':'application/json'},...(params?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(12000)});
    const value=await response.json();if(!response.ok||value.status==='failed')throw Error('安装接口拒绝请求；请先退出旧服务并启动更新后的项目。');return value;
  };
  let online=false;try{online=(await fetch(base+'/healthz',{signal:AbortSignal.timeout(1500)})).ok;}catch{}
  const report=(plugin,mode)=>console.log(JSON.stringify({installed:true,mode,id:plugin.id,name:plugin.name,enabled:plugin.enabled,tools:plugin.tools.map(t=>t.name)}));
  if(online){report(await installVideo({list:()=>call('/admin/plugins'),get:id=>call('/admin/plugins/detail?id='+encodeURIComponent(id)),install:p=>call('/admin/plugins/install',p),save:p=>call('/admin/plugins/save',p)},config),'online');return;}
  const unlock=lockData(config.dataDir);let store,plugins;
  try{store=new Store(join(config.dataDir,'bot.sqlite'));plugins=new PluginService({store,config,adapter:{},log:()=>{}});report(await installVideo(plugins,config),'offline');}
  finally{await plugins?.close();store?.close();unlock();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
