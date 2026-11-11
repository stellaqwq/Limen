import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config.mjs';
import {Store} from '../src/store.mjs';
import {AndroidService} from '../../../plugins/android/service.mjs';
import {androidConfig,androidTemplate} from '../../../plugins/android/config.mjs';
import {androidRoot,stageAndroidSetup,applyAndroidSetup} from '../../../plugins/android/local.mjs';
import {createApp} from '../src/app.mjs';

const action=process.argv[2]||'status',argv=process.argv.slice(3);
const option=name=>{const i=argv.indexOf('--'+name);return i<0?undefined:argv[i+1];};
await mkdir(androidRoot,{recursive:true});
let setup={};try{setup=JSON.parse(await readFile(join(androidRoot,'device.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const c=androidConfig({...setup,...(option('adb')?{adb_path:option('adb')}:{ }),...(option('serial')?{serial:option('serial')}:{ })});
if(action==='configure'){
  if(!c.serial)throw Error('请提供 --serial（--adb 可留空，会自动查找 PATH、Android SDK 和常见模拟器目录）。');
  const config=loadConfig();await writeFile(join(androidRoot,'device.json'),JSON.stringify(c,null,2)+'\n');await stageAndroidSetup(c,config.dataDir);
  console.log(JSON.stringify({ok:true,pending_restart:true,serial:c.serial,max_videos:c.max_videos}));
}else if(action==='trial'){
  // Isolated web job: no real QQ driver, desktop, shell, or outgoing messages.
  const base=loadConfig(),dataDir=join(androidRoot,'trial-'+randomUUID());
  const config={...base,dataDir,driver:'demo',port:0,host:'127.0.0.1',computer:{...base.computer,enabled:false},agent:{...base.agent,enabled:true,maxSteps:20,maxToolCalls:40,timeout:300000}};
  const bot=await createApp(config,{log:()=>{}});
  try{
    await applyAndroidSetup(bot.plugins,c);
    const queued=bot.agent.chat({text:'请用安卓视频工具观看抖音，最多浏览5条（包括第一条）。只观看、上滑，采样每条2幅图片，简短记录每条可见事实，然后总结。不要点赞、评论、关注或处理协议、登录、验证码、系统权限；出现任何弹窗或直播购物就停止并告诉我。没有音频不要猜对白。'});
    console.log(JSON.stringify({started:true,job_id:queued.job_id,serial:c.serial,max_videos:5}));
    let previous='';
    const timer=setInterval(()=>{const text=JSON.stringify(bot.agent.state.trace(queued.job_id).map(s=>({name:s.name,state:s.state})));if(text!==previous){previous=text;console.log(text);}},2000);
    try{
      for(let i=0;i<330;i++){
        const row=bot.store.db.prepare('SELECT status,reply,reason FROM jobs WHERE id=?').get(queued.job_id);
        if(['done','failed','uncertain','ignored'].includes(row.status)){
          await writeFile(join(androidRoot,'trial-result.json'),JSON.stringify({schema:1,...row,steps:bot.agent.state.trace(queued.job_id)},null,2)+'\n');console.log(JSON.stringify(row));break;
        }
        await new Promise(r=>setTimeout(r,1000));
      }
    }finally{clearInterval(timer);bot.android.control({action:'stop'});}
  }finally{await bot.close();}
}else{
  const store=new Store(join(androidRoot,'control.sqlite')),service=new AndroidService({store});
  service.pluginFor=()=>({...structuredClone(androidTemplate),id:'local',revision:1,enabled:true,config:c});
  const job={id:'cli'};
  try{
    if(['stop','resume'].includes(action))console.log(JSON.stringify(service.control({action})));
    else{
      const tools=service.tools({},{...job,channel:'web'}),invoke=(name,args={})=>tools.find(t=>t.name===name).invoke(args);
      if(action==='open')console.log(JSON.stringify((await invoke('android_action',{action:'open_app',operation_id:'manual-open'})).result));
      else if(action==='observe'){
        const result=await invoke('android_observe',{frames:1});const path=join(androidRoot,'phone.jpg');await writeFile(path,Buffer.from(result.images[0].split(',')[1],'base64'));console.log(JSON.stringify({...result.result,image_path:path}));
      }else if(action==='status')console.log(JSON.stringify((await invoke('android_status')).result));
      else throw Error('用法：android-device.mjs configure|status|open|observe|stop|resume|trial');
    }
  }finally{service.release(job);await service.close();store.close();}
}
