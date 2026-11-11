import {loadConfig} from '../src/config.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {initializeLocalASR,readLocalASR,ensureLocalASR,localASRRequest,applyLocalVideo,stageLocalVideo} from '../../../plugins/video/asr/local.mjs';

const action=process.argv[2]||'status';
try{
  const c=action==='start'||action==='configure'?await initializeLocalASR():await readLocalASR();if(!c)throw Error('请先准备模型并运行 npm run asr:start。');
  if(action==='start')console.log(JSON.stringify(await ensureLocalASR(c)));
  else if(action==='status')console.log(JSON.stringify(await localASRRequest(c,'/healthz')));
  else if(action==='stop'||action==='unload'){
    const result=await localASRRequest(c,action==='stop'?'/admin/shutdown':'/admin/unload',{});
    if(action==='stop')for(let i=0;i<30;i++){try{await localASRRequest(c,'/healthz');}catch{break;}await delay(100);}
    console.log(JSON.stringify(result));
  }
  else if(action==='configure'){
    await ensureLocalASR(c);const config=loadConfig(),base='http://127.0.0.1:'+config.port;
    async function call(path,params){const response=await fetch(base+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+config.adminToken,'Content-Type':'application/json'},...(params?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok||data.status==='failed')throw Error('机器人管理接口拒绝配置。');return data;}
    let list;try{list=await call('/admin/plugins');}catch{}
    if(!list?.builtins?.some(p=>p.kind==='video-analysis')){await stageLocalVideo(c,config.dataDir);console.log(JSON.stringify({configured:true,mode:'pending_restart',model:'sensevoice-small-int8',endpoint:'http://127.0.0.1:'+c.port+'/v1/audio/transcriptions',note:'本地服务已就绪；完整退出并重启机器人后自动安装、配置视频插件，仅新插件启用网页入口。'}));}
    else console.log(JSON.stringify({configured:true,mode:'online',...await applyLocalVideo({list:()=>call('/admin/plugins'),get:id=>call('/admin/plugins/detail?id='+encodeURIComponent(id)),install:p=>call('/admin/plugins/install',p),save:p=>call('/admin/plugins/save',p),toggle:p=>call('/admin/plugins/toggle',p)},c)}));
  }else throw Error('可用操作：start / status / configure / unload / stop');
}catch(error){console.error(error.message);process.exitCode=1;}
