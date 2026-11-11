import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig} from '../src/config.mjs';
import {douyinRoot,stageDouyinSetup} from '../../../plugins/douyin-web/local.mjs';

const config=loadConfig(),action=process.argv[2]||'status',base='http://127.0.0.1:'+config.port;
async function call(path,body){
  const response=await fetch(base+path,{headers:{Authorization:'Bearer '+config.adminToken,'Content-Type':'application/json'},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok)throw Error(data.message||'接口尚未就绪，请完整重启新版工作台。');return data;
}
await mkdir(douyinRoot,{recursive:true});
if(action==='configure'){
  await stageDouyinSetup({},config.dataDir);console.log(JSON.stringify({ok:true,pending_restart:true,max_videos:5}));
}else if(action==='status'){
  const s=await call('/admin/agent');if(!s.douyin_web)throw Error('旧服务尚未加载网页浏览插件，请完整重启工作台。');console.log(JSON.stringify(s.douyin_web));
}else if(['stop','resume'].includes(action))console.log(JSON.stringify(await call('/admin/agent/douyin/control',{action})));
else if(action==='open')console.log(JSON.stringify(await call('/admin/agent/douyin/open',{})));
else if(action==='observe'){
  const r=await call('/admin/agent/douyin/screenshot',{}),path=join(douyinRoot,'page.jpg');await writeFile(path,Buffer.from(r.image.split(',')[1],'base64'));
  const {image,...state}=r;console.log(JSON.stringify({...state,image_path:path}));
}else if(action==='trial'){
  const limit=Number(process.argv[3]||5);if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('验收条数应为 1–5。');
  const queued=await call('/admin/agent/chat',{text:'请只使用 douyin_web_* 工具观看抖音网页，最多浏览'+limit+'条（包括当前这一条），每条采样2幅画面，下一条前简短记录可见事实，最后总结。当前没有音频输入，不猜测对白或配乐。只播放、暂停和切换下一条，不点赞、评论或关注。遇到登录、验证码、风控、弹窗或直播购物就停止并明确告诉我。'});
  console.log(JSON.stringify({started:true,...queued}));let prior='';
  for(let i=0;i<330;i++){
    const row=await call('/admin/jobs/'+queued.job_id),steps=row.agent_steps||[];const progress=JSON.stringify(steps.map(s=>({name:s.name,state:s.state})));
    if(progress!==prior){prior=progress;console.log(progress);}
    if(['done','failed','uncertain','ignored'].includes(row.status)){
      await writeFile(join(douyinRoot,'trial-result.json'),JSON.stringify({status:row.status,reply:row.reply,reason:row.reason,steps},null,2)+'\n');console.log(JSON.stringify({status:row.status,reply:row.reply,reason:row.reason}));break;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
}else throw Error('用法：douyin-web.mjs configure|status|open|observe|stop|resume|trial');
