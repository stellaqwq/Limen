import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {AndroidService,foreground} from '../../../plugins/android/service.mjs';
import {androidConfig,androidTemplate,androidTools} from '../../../plugins/android/config.mjs';
import {validateSchema} from '../src/agent/schema.mjs';
import {app,temp,cleanup,request,waitFor,withTestTimeout} from './helpers.mjs';
import {png} from './image-fixture.mjs';
import {join} from 'node:path';

const pkg='com.ss.android.ugc.aweme',job={id:1,channel:'web',conversation:'web:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},jpg=Buffer.from('ffd8ffc000110800b4014003011100021101031100ffd9','hex');
const env={AI_ENABLED:'true',AI_MODEL:'android-test',AI_ALLOWED_USERS:'10001'};
async function fixture(t,patch={}){
  const root=await temp(t),store=new Store(join(root,'bot.sqlite'));cleanup(t,()=>store.close());
  const plugin={...structuredClone(androidTemplate),id:'android-test',revision:1,enabled:true,config:androidConfig({serial:'127.0.0.1:16416',...patch})};
  let focus=pkg;const calls=[];
  const run=async(exe,args,opts)=>{
    opts?.signal?.throwIfAborted();calls.push({exe,args,opts});
    if(args.includes('pipe:1'))return {code:0,stdout:jpg,stderr:''};
    assert.deepEqual(args.slice(0,2),['-s',plugin.config.serial]);
    const cmd=args.slice(2).join(' ');
    const stdout=cmd==='get-state'?'device':cmd==='shell dumpsys window'?`mCurrentFocus=Window{abc u0 ${focus}/.Main}`:cmd.includes('resolve-activity')?pkg+'/.Main':cmd==='exec-out screencap -p'?png(1080,1920):'';
    return {code:0,stdout,stderr:''};
  };
  const service=new AndroidService({store,run});service.pluginFor=()=>plugin;cleanup(t,()=>service.close());
  const tools=service.tools({},job),invoke=async(name,args={})=>tools.find(t=>t.name===name).invoke(args);
  return {store,service,plugin,calls,tools,invoke,setFocus:v=>focus=v,run};
}
async function install(bot){let p=await bot.plugins.install({kind:'android-device'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,serial:'emulator-5554'}}});return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}

test('android schema restricts device identifiers, package, actions, limits and tool permissions',()=>{
  for(const t of androidTools)validateSchema(t.parameters);
  assert.deepEqual(androidTools.map(t=>t.name),['android_status','android_observe','android_action']);
  for(const config of [{serial:'x; reboot'},{app_package:'pkg;id'},{serial:'a\nb'},{adb_path:'a\0b'},{max_videos:21},{max_task_seconds:0},{extra:true}])assert.throws(()=>androidConfig(config));
  assert.equal(foreground('mCurrentFocus=Window{abc u0 '+pkg+'/.Main}'),pkg);
  assert.equal(foreground('mFocusedApp=ActivityRecord{abc u0 '+pkg+'/.Main t1}'),pkg);
});

test('Android plugin is singleton, disabled on installation, web only, and closes stale tool permissions',async t=>{
  const bot=await app(t,env);let p=await bot.plugins.install({kind:'android-device'});
  assert.equal(p.enabled,false);assert.equal((await bot.plugins.install({kind:'android-device'})).id,p.id);
  await assert.rejects(bot.plugins.save({plugin:androidTemplate}),/已安装/);
  p=await install(bot);const tools=bot.android.tools({},job);assert.equal(tools.length,3);
  assert.equal(bot.android.tools({message_type:'private',user_id:10001},{...job,channel:'qq'}).length,0);
  assert.equal(bot.android.tools({message_type:'group'},{...job,channel:'qq'}).length,0);
  assert.equal(bot.agent.tools({},job).tools.some(t=>t.name==='android_action'),true);
  await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:false});
  await assert.rejects(async()=>tools[0].invoke({}),/变更/);
});

test('real screenshot bytes become transient JPEG frames, with no sound claim or screenshot persistence',async t=>{
  const {service,invoke,calls,store,tools}=await fixture(t),state=new AgentState(store);state.begin(job,'test');
  const r=await state.invoke(job,tools.find(t=>t.name==='android_observe'),{frames:1});
  assert.equal(r.images.length,1);assert.ok(r.images[0].startsWith('data:image/jpeg;base64,'));assert.equal(r.result.audio,false);assert.equal(r.result.samples.length,1);
  assert.equal(r.result.videos,1);assert.equal(calls.find(c=>c.args.includes('screencap')).opts.binary,true);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM agent_receipts').get().n,0);
  assert.equal(service.owner.observation.id,r.result.observation_id);
  await assert.rejects(invoke('android_action',{action:'tap',operation_id:'tap'}));
});

test('four fresh observed swipes enforce five-video budget, cannot reuse observation or reset via open',async t=>{
  const {invoke,calls}=await fixture(t);
  await invoke('android_action',{action:'open_app',operation_id:'open'});
  await assert.rejects(invoke('android_action',{action:'open_app',operation_id:'open2'}),/打开过/);
  for(let i=0;i<4;i++){
    const obs=await invoke('android_observe',{frames:1});
    const args={action:'next_video',observation_id:obs.result.observation_id,operation_id:'swipe'+i};
    assert.equal((await invoke('android_action',args)).result.videos,i+2);
    await assert.rejects(invoke('android_action',{...args,operation_id:'reuse'+i}),/重新观察/);
  }
  const obs=await invoke('android_observe',{frames:1});
  await assert.rejects(invoke('android_action',{action:'next_video',observation_id:obs.result.observation_id,operation_id:'sixth'}),/条数上限/);
  assert.equal(calls.filter(c=>c.args.includes('swipe')).length,4);
  const swipe=calls.find(c=>c.args.includes('swipe'));assert.deepEqual(swipe.args.slice(-5),['540','1459','540','518','350']);
});

test('expired observations, foreground change, wrong device owner and time limits prevent input',async t=>{
  const {service,invoke,calls,setFocus,plugin}=await fixture(t);const obs=await invoke('android_observe',{frames:1});
  const args={action:'next_video',observation_id:obs.result.observation_id,operation_id:'next'};
  service.owner.observation.time-=31000;await assert.rejects(invoke('android_action',args),/重新观察/);
  service.owner.observation.time=Date.now();setFocus('com.android.settings');await assert.rejects(invoke('android_action',args),/前台 App/);
  await assert.rejects(service.tools({},{...job,id:2})[0].invoke({}),/另一个任务/);
  setFocus(pkg);service.owner.started-=plugin.config.max_task_seconds*1000+1;
  await assert.rejects(invoke('android_action',args),/时间上限/);assert.equal(calls.filter(c=>c.args.includes('swipe')).length,0);
});

test('stop persists, cancels in-flight ADB and resume never revives a captured task',async t=>{
  const {service,invoke,store,run}=await fixture(t);let started=false;
  service.run=(exe,args,opts)=>args.includes('screencap')?new Promise((resolve,reject)=>{started=true;opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true});}):run(exe,args,opts);
  const pending=invoke('android_observe',{frames:1});await waitFor(()=>started);
  service.control({action:'stop'});await assert.rejects(withTestTimeout(()=>pending),/停止/);
  assert.equal(store.db.prepare('SELECT paused FROM android_control').get().paused,1);
  const restarted=new AndroidService({store,run});assert.equal(restarted.paused,true);await restarted.close();
  service.control({action:'resume'});await assert.rejects(invoke('android_status'),/停止/);
  service.release(job);assert.equal((await service.tools({},job)[0].invoke({})).result.ok,true);
});

test('durable operation IDs cache a swipe and prevent replay after uncertainty or a model retry',async t=>{
  const {service,store,tools,calls,run}=await fixture(t),state=new AgentState(store);state.begin(job,'test');
  const observe=tools.find(t=>t.name==='android_observe'),action=tools.find(t=>t.name==='android_action');
  const obs=await state.invoke(job,observe,{frames:1}),args={action:'next_video',observation_id:obs.result.observation_id,operation_id:'once'};
  const first=await state.invoke(job,action,args);assert.deepEqual(await state.invoke(job,action,args),first);assert.equal(calls.filter(c=>c.args.includes('swipe')).length,1);
  assert.equal((await state.invoke(job,action,{...args,action:'open_app'})).result.ok,false);
  const next=await state.invoke(job,observe,{frames:1});service.run=(exe,args,opts)=>args.includes('swipe')?Promise.reject(Error('lost connection')):run(exe,args,opts);
  const unknown={action:'next_video',observation_id:next.result.observation_id,operation_id:'unknown'};
  assert.equal((await state.invoke(job,action,unknown)).result.uncertain,true);assert.equal((await state.invoke(job,action,unknown)).result.uncertain,true);
  const bot=await app(t,env,{ai:{reply:async()=>{throw Error('must not call model');}}});await install(bot);
  bot.store.db.prepare("INSERT INTO agent_receipts VALUES (1,'android_action:once','digest','done','{}')").run();
  await assert.rejects(bot.agent.reply('继续',[],undefined,{event:{message_type:'private'},job}),/未自动重做/);
});

test('missing adb, unauthorized devices and unknown serials get actionable messages',async t=>{
  const f=await fixture(t);
  assert.ok(['config','path','detected','missing'].includes(f.service.status().adb.source));
  // 完全没装 adb：拿不到可执行文件，要提示去填路径，而不是笼统说“设备不可用”。
  f.service.run=async()=>{throw Object.assign(Error('spawn adb ENOENT'),{code:'ENOENT'});};
  await assert.rejects(f.invoke('android_observe',{frames:1}),/找不到 adb 可执行文件/);
  // 配置了不存在的路径：提示指向配置项本身。
  f.plugin.config.adb_path='D:/no-such-dir/adb.exe';
  await assert.rejects(f.invoke('android_observe',{frames:1}),/配置的路径 D:\/no-such-dir\/adb\.exe 不存在/);
});

test('device diagnostics separate unauthorized, offline and wrong serial, and never hide a missing adb as uncertainty',async t=>{
  const state=stdout=>({code:0,stdout,stderr:''}),rejection=(stdout,stderr)=>({code:1,stdout,stderr});
  const runner=handlers=>async(exe,args)=>{const cmd=args.slice(2).join(' ');return (handlers[cmd]||(()=>state('')))(cmd);};
  // 未授权：要在手机上点允许，而不是去查端口。
  const unauthorized=await fixture(t);
  unauthorized.service.run=runner({'get-state':()=>rejection('','error: device unauthorized. This adbd\'s $ADB_VENDOR_KEYS is not set')});
  await assert.rejects(unauthorized.invoke('android_observe',{frames:1}),/尚未授权/);
  // 序列号填错：把 adb devices 的现状报出来，帮助对照。
  const wrongSerial=await fixture(t);
  wrongSerial.service.run=runner({'get-state':()=>rejection('',"error: device '127.0.0.1:16416' not found"),'devices -l':()=>state('List of devices attached\n\n')});
  await assert.rejects(wrongSerial.invoke('android_observe',{frames:1}),/当前没有已连接设备/);
  const offline=await fixture(t);
  offline.service.run=runner({'get-state':()=>rejection('','error: device offline'),'devices -l':()=>state('List of devices attached\nemulator-5554\tdevice\n\n')});
  await assert.rejects(offline.invoke('android_observe',{frames:1}),/离线/);
  // 动作阶段才丢 adb：不能被吞成“结果未知”，否则用户以为动作可能已生效。
  const action=await fixture(t);
  action.service.run=async(exe,args)=>{
    const cmd=args.slice(2).join(' ');
    if(cmd==='get-state')return state('device');
    if(cmd==='shell dumpsys window')return state(`mCurrentFocus=Window{abc u0 ${pkg}/.Main}`);
    if(cmd.includes('resolve-activity'))return state(pkg+'/.Main');
    throw Object.assign(Error('spawn adb ENOENT'),{code:'ENOENT'});
  };
  await assert.rejects(action.invoke('android_action',{action:'open_app',operation_id:'open'}),/找不到 adb 可执行文件/);
});

test('Android stop and preview endpoints require admin credentials; manual previews do not issue input',async t=>{
  const f=await fixture(t),bot=await app(t,env,{androidRun:f.run});await install(bot);
  // Fake runner validates the exact configured device too.
  f.plugin.config.serial='emulator-5554';
  for(const route of ['/admin/agent/android/control','/admin/agent/android/screenshot'])assert.equal((await request(bot,route,{action:'stop'},'onebot')).code,401);
  assert.equal((await request(bot,'/admin/agent/android/screenshot',{})).data.audio,false);
  assert.equal(bot.android.owner,null);assert.equal(f.calls.some(c=>c.args.includes('swipe')),false);
  assert.equal((await request(bot,'/admin/agent/android/control',{action:'stop'})).data.paused,true);
  assert.equal((await request(bot,'/admin/agent/android/screenshot',{})).code,409);
});
