import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {lockData} from '../src/data-lock.mjs';
import {PluginService} from '../src/plugins/service.mjs';

export async function installLivingMemory(service,config) {
  const existing=(await service.list()).plugins.find(p=>p.kind==='living-memory');
  // Re-running the installer preserves user configuration, scope and enablement.
  if(existing)return service.get(existing.id);
  let plugin=await service.install({kind:'living-memory'});
  plugin=await service.save({id:plugin.id,revision:plugin.revision,plugin:{...plugin,
    scope:{...plugin.scope,private_users:[...config.ai.allowedUsers],groups:[...config.ai.allowedGroups]}}});
  if(plugin.scope.private_users.length||plugin.scope.groups.length)plugin=await service.toggle({id:plugin.id,revision:plugin.revision,enabled:true});
  return plugin;
}
async function main() {
  const config=loadConfig(),base='http://127.0.0.1:'+config.port;
  const call=async(path,params)=>{
    const response=await fetch(base+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+config.adminToken,'Content-Type':'application/json'},
      ...(params?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(12000)});
    const value=await response.json();
    if(!response.ok||value.status==='failed')throw Error('管理员接口拒绝安装请求。请确认运行的是更新后的源码。');
    return value;
  };
  let online=false;
  try{online=(await fetch(base+'/healthz',{signal:AbortSignal.timeout(1500)})).ok;}catch{}
  const report=(plugin,mode)=>console.log(JSON.stringify({installed:true,mode,id:plugin.id,name:plugin.name,enabled:plugin.enabled,scope:plugin.scope}));
  if(online){
    const service={list:()=>call('/admin/plugins'),get:id=>call('/admin/plugins/detail?id='+encodeURIComponent(id)),
      install:params=>call('/admin/plugins/install',params),save:params=>call('/admin/plugins/save',params),toggle:params=>call('/admin/plugins/toggle',params)};
    report(await installLivingMemory(service,config),'online');return;
  }
  const unlock=lockData(config.dataDir);let store,plugins;
  try{
    store=new Store(join(config.dataDir,'bot.sqlite'));
    plugins=new PluginService({store,adapter:{},config,log:()=>{}});
    report(await installLivingMemory(plugins,config),'offline');
  }finally{await plugins?.close();store?.close();unlock();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  console.error('记忆插件安装失败。请检查管理员凭据和服务版本；源码更新后须先退出旧进程并重新启动。');process.exitCode=1;
});
