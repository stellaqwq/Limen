import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {douyinConfig,douyinTemplate,douyinTools} from '../../../plugins/douyin-web/config.mjs';
import {DouyinWebService} from '../../../plugins/douyin-web/service.mjs';
import {allowedPage,ChromeBrowser} from '../../../plugins/douyin-web/chrome.mjs';
import {snapshotExpression,playbackExpression} from '../../../plugins/douyin-web/page.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';
import {validateSchema,validateArguments} from '../src/agent/schema.mjs';
import {app,temp,cleanup,request,withTestTimeout,waitFor} from './helpers.mjs';

const job={id:1,channel:'web',conversation:'web:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},jpg='data:image/jpeg;base64,/9j/';
const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'};
function fakeBrowser(){return {running:true,state:{url:'https://www.douyin.com/?recommend=1',title:'抖音',text:'当前视频的可见文案',blocked:null,video:{paused:false,ready_state:4,current_seconds:3,duration_seconds:20,x:600,y:400,width:800,height:600}},actions:[],async open(){this.running=true;this.actions.push('open');},async evaluate(expression,signal){signal?.throwIfAborted();if(expression===snapshotExpression)return structuredClone(this.state);this.actions.push(expression.includes('await active.e.play()')?'play':'pause');return {ok:true,paused:!expression.includes('await active.e.play()')};},async screenshot(){return jpg;},async next(){this.actions.push('next');},async close(){this.running=false;}};}
async function fixture(t,patch={}){
  const root=await temp(t),store=new Store(join(root,'bot.sqlite'));cleanup(t,()=>store.close());const browser=fakeBrowser();
  const plugin={...structuredClone(douyinTemplate),id:'douyin',revision:1,enabled:true,config:douyinConfig(patch)},service=new DouyinWebService({store,config:{dataDir:root},browser});service.pluginFor=()=>plugin;cleanup(t,()=>service.close());
  const tools=service.tools({},job),invoke=async(name,args={})=>tools.find(t=>t.name===name).invoke(args);
  return {store,service,plugin,browser,tools,invoke};
}
function pageContext({modal='',text='',url='https://www.douyin.com/',video=true}={}){
  const rect={left:200,top:100,width:600,height:500,right:800,bottom:600};let played=0,paused=0;
  const element={getBoundingClientRect:()=>rect,innerText:modal,paused:false,readyState:4,currentTime:2,duration:20,play:async()=>{played++;},pause:()=>{paused++;}};
  return {location:new URL(url),document:{title:'抖音',body:{innerText:text},querySelectorAll:q=>q==='video'?(video?[element]:[]):modal?[element]:[]},getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),innerWidth:1280,innerHeight:800,counts:()=>({played,paused})};
}

test('Douyin tools accept only bounded site-specific controls and enforce exact HTTPS origin',()=>{
  for(const t of douyinTools)validateSchema(t.parameters);
  for(const value of [{max_videos:21},{max_task_seconds:0},{chrome_path:'a\nb'},{debug_port:9222}])assert.throws(()=>douyinConfig(value));
  assert.equal(allowedPage('https://www.douyin.com/video/123'),true);
  for(const url of ['http://www.douyin.com','https://douyin.com.evil.test','https://www.douyin.com:9222','https://user@www.douyin.com','file:///secret','chrome://settings','https://www.douyin.com@evil.test'])assert.equal(allowedPage(url),false);
});

test('expanded sampling remains bounded to eight frames and configured minimums are enforced for model jobs',async t=>{
  const schema=douyinTools.find(t=>t.name==='douyin_web_observe').parameters;
  validateArguments(schema,{frames:8,interval_seconds:10});assert.throws(()=>validateArguments(schema,{frames:9}));assert.throws(()=>douyinConfig({min_observe_frames:9}));
  const {invoke,browser}=await fixture(t,{min_observe_frames:6,min_observe_interval_seconds:0.5});
  browser.screenshot=async(signal,options)=>{assert.deepEqual(options,{maxWidth:960,maxHeight:720});browser.state.video.current_seconds++;return jpg;};
  const r=await invoke('douyin_web_observe',{frames:1,interval_seconds:0.5});
  assert.equal(r.images.length,6);assert.equal(r.result.requested_frames,6);assert.equal(r.result.sampling_interval_seconds,0.5);assert.equal(r.result.sample_span_seconds,5);assert.equal(r.result.sampling_limited,null);
});

test('larger batches stop at the existing image budget and near the video end',async t=>{
  const f=await fixture(t);f.browser.screenshot=async()=> 'data:image/jpeg;base64,/9j/'+ 'A'.repeat(1600000);
  const r=await f.invoke('douyin_web_observe',{frames:8,interval_seconds:0.5});assert.equal(r.images.length,3);assert.equal(r.result.sampling_limited,'image_budget');
  f.browser.state.video.current_seconds=19.9;
  const end=await f.invoke('douyin_web_observe',{frames:8,interval_seconds:0.5});assert.equal(end.images.length,1);assert.equal(end.result.sampling_limited,'video_end');
});

test('a video change during a wider sample cannot be attributed to one video or saved as valid evidence',async t=>{
  const f=await fixture(t);f.browser.state.video_id='7702712508074822975';
  f.browser.screenshot=async()=>{f.browser.state.video_id='7702712508074822976';return jpg;};
  const r=await f.invoke('douyin_web_observe',{frames:6,interval_seconds:0.5});assert.equal(r.images.length,1);assert.equal(r.result.mixed_video,true);assert.equal(r.result.sampling_limited,'video_changed');assert.equal(r.result.sample_span_seconds,null);
});

test('fixed page reader detects login and verification, keeps ordinary login buttons usable, playback cannot handle challenges',async()=>{
  const normal=pageContext({text:'登录 下载客户端 普通视频'});assert.equal(runInNewContext(snapshotExpression,normal).blocked,null);
  const login=pageContext({modal:'扫码登录 验证码登录',text:'扫码登录'});assert.equal(runInNewContext(snapshotExpression,login).blocked,'login_required');
  const challenge=pageContext({text:'请完成安全验证 拖动滑块'});assert.equal(runInNewContext(snapshotExpression,challenge).blocked,'verification_required');
  assert.equal((await runInNewContext(playbackExpression('play'),challenge)).ok,false);assert.deepEqual(challenge.counts(),{played:0,paused:0});
  assert.equal((await runInNewContext(playbackExpression('play'),normal)).ok,true);assert.equal(normal.counts().played,1);
  const foreign=pageContext({url:'https://example.com/'});assert.equal((await runInNewContext(playbackExpression('pause'),foreign)).ok,false);assert.equal(foreign.counts().paused,0);
});

test('current feed video class supplies stable ID when the page has no permalink anchor',()=>{
  const ctx=pageContext(),base=ctx.document.querySelectorAll;
  const container={className:'sliderVideo video_7702712508074822975 active',querySelector:()=>null};
  const element=base('video')[0];element.closest=()=>container;
  assert.equal(runInNewContext(snapshotExpression,ctx).video_id,'7702712508074822975');
});

test('plugin installs disabled, is singleton and web only, setup disables emulator without losing settings',async t=>{
  const bot=await app(t,env,{douyinBrowser:fakeBrowser()});const first=await bot.plugins.install({kind:'douyin-web'});assert.equal(first.enabled,false);
  await assert.rejects(bot.plugins.save({plugin:douyinTemplate}),/已安装/);assert.equal((await bot.plugins.install({kind:'douyin-web'})).id,first.id);
  let android=await bot.plugins.install({kind:'android-device'});await bot.plugins.toggle({id:android.id,revision:android.revision,enabled:true});
  const result=await applyDouyinSetup(bot.plugins);assert.equal(result.enabled,false);
  assert.equal(bot.plugins.find('android-device').enabled,false);
  let p=bot.plugins.find('douyin-web');p=await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
  const tools=bot.douyinWeb.tools({},job);assert.equal(tools.length,3);assert.ok(bot.agent.tools({},job).tools.some(t=>t.name==='douyin_web_observe'));
  assert.equal(bot.douyinWeb.tools({message_type:'group'},{...job,channel:'qq'}).length,0);
  assert.equal(bot.douyinWeb.tools({message_type:'private',user_id:10001},{...job,channel:'qq'}).length,0);
  await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:false});await assert.rejects(async()=>tools[0].invoke({}),/变更/);
});

test('five positions require fresh observations, four next commands, screenshots are transient and open does not reset budget',async t=>{
  const {invoke,browser,store,tools}=await fixture(t),state=new AgentState(store);state.begin(job,'test');
  await invoke('douyin_web_action',{action:'open_home',operation_id:'open'});
  await assert.rejects(invoke('douyin_web_action',{action:'open_home',operation_id:'again'}),/打开过/);
  for(let i=0;i<4;i++){
    const obs=await state.invoke(job,tools[1],{frames:1});assert.equal(obs.images[0],jpg);assert.equal(obs.result.audio,false);
    const args={action:'next_video',operation_id:'next'+i,observation_id:obs.result.observation_id};
    const first=await state.invoke(job,tools[2],args);assert.equal(first.result.videos,i+2);assert.equal(first.result.observe_after_action,true);assert.equal(first.result.verification_required,undefined);assert.deepEqual(await state.invoke(job,tools[2],args),first);
    await assert.rejects(invoke('douyin_web_action',{...args,operation_id:'reuse'+i}),/重新观察/);
  }
  const obs=await invoke('douyin_web_observe',{frames:1});await assert.rejects(invoke('douyin_web_action',{action:'next_video',operation_id:'sixth',observation_id:obs.result.observation_id}),/条数上限/);
  assert.equal(browser.actions.filter(a=>a==='next').length,4);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM agent_receipts WHERE result LIKE '%base64%'").get().n,0);
});

test('login, verification, expired observations, missing player and navigation changes prevent mutation',async t=>{
  const {invoke,browser,service}=await fixture(t);
  for(const blocked of ['login_required','verification_required']){
    browser.state.blocked=blocked;const obs=await invoke('douyin_web_observe',{frames:3});assert.equal(obs.images.length,1);assert.equal(obs.result.blocked,blocked);
    await assert.rejects(invoke('douyin_web_action',{action:'next_video',operation_id:'blocked',observation_id:obs.result.observation_id}),/用户/);
  }
  browser.state.blocked=null;const obs=await invoke('douyin_web_observe',{frames:1}),args={action:'play',operation_id:'play',observation_id:obs.result.observation_id};
  service.owner.observation.time-=31000;await assert.rejects(invoke('douyin_web_action',args),/重新观察/);
  service.owner.observation.time=Date.now();browser.state.url+='&changed=1';await assert.rejects(invoke('douyin_web_action',args),/重新观察/);
  browser.state.url='https://example.com/';await assert.rejects(invoke('douyin_web_observe',{frames:1}),/状态无效/);
  assert.deepEqual(browser.actions,[]);
});

test('stop cancels pending reads, persists across restarts, captured tools never revive and owner cannot be replaced',async t=>{
  const {service,invoke,browser,store}=await fixture(t);let started=false;
  browser.screenshot=signal=>new Promise((resolve,reject)=>{started=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const pending=invoke('douyin_web_observe',{frames:1});await waitFor(()=>started);
  await assert.rejects(async()=>service.tools({},{...job,id:2})[0].invoke({}),/另一个任务/);
  service.control({action:'stop'});await assert.rejects(withTestTimeout(()=>pending),/停止/);assert.equal(store.db.prepare('SELECT paused FROM douyin_web_control').get().paused,1);
  const restarted=new DouyinWebService({store,config:{dataDir:'unused'},browser:fakeBrowser()});assert.equal(restarted.paused,true);await restarted.close();
  service.control({action:'resume'});await assert.rejects(invoke('douyin_web_status'),/停止/);service.release(job);assert.equal((await service.tools({},job)[0].invoke({})).result.ok,true);
});

test('uncertain action is not repeated, failed model task cannot resume with new operation IDs',async t=>{
  const f=await fixture(t),state=new AgentState(f.store);state.begin(job,'test');const obs=await f.invoke('douyin_web_observe',{frames:1});
  let count=0;f.browser.next=async()=>{count++;throw Error('lost reply');};const args={action:'next_video',operation_id:'unknown',observation_id:obs.result.observation_id};
  assert.equal((await state.invoke(job,f.tools[2],args)).result.uncertain,true);assert.equal((await state.invoke(job,f.tools[2],args)).result.uncertain,true);assert.equal(count,1);
  const bot=await app(t,env,{douyinBrowser:fakeBrowser(),ai:{reply:async()=>{throw Error('must not run');}}});
  bot.store.db.prepare("INSERT INTO agent_receipts VALUES (1,'douyin_web_action:once','digest','done','{}')").run();
  await assert.rejects(bot.agent.reply('继续',[],undefined,{event:{message_type:'private'},job}),/未自动重做/);
});

test('manual open, screenshot and stop require admin auth and never start a model or touch QQ',async t=>{
  const browser=fakeBrowser(),bot=await app(t,env,{douyinBrowser:browser});await applyDouyinSetup(bot.plugins);
  for(const route of ['/admin/agent/douyin/open','/admin/agent/douyin/screenshot','/admin/agent/douyin/control'])assert.equal((await request(bot,route,{action:'stop'},'onebot')).code,401);
  assert.equal((await request(bot,'/admin/agent/douyin/open',{})).data.ok,true);
  const shot=await request(bot,'/admin/agent/douyin/screenshot',{});assert.equal(shot.data.image,jpg);assert.equal(shot.data.audio,false);assert.equal(bot.douyinWeb.owner,null);
  assert.equal((await request(bot,'/admin/agent/douyin/control',{action:'stop'})).data.paused,true);
  assert.equal((await request(bot,'/admin/agent/douyin/open',{})).code,409);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
});

test('browser guard refuses unrelated tabs before reading or taking screenshots',async()=>{
  const browser=new ChromeBrowser({profile:'unused'});browser.url=async()=> 'https://example.com/';
  let called=false;browser.page=async()=>{called=true;};
  await assert.rejects(browser.evaluate(snapshotExpression),/不是抖音/);await assert.rejects(browser.screenshot(),/不是抖音/);assert.equal(called,false);
});

test('open social panels redact status text and block ordinary video screenshots or navigation',async t=>{
  const f=await fixture(t);f.browser.state.social_panel_open=true;f.browser.state.text='PRIVATE CHAT MUST NOT REACH MODEL';
  let screenshots=0;f.browser.screenshot=async()=>{screenshots++;return jpg;};
  const status=await f.invoke('douyin_web_status');assert.ok(!JSON.stringify(status).includes('PRIVATE CHAT'));
  await assert.rejects(f.invoke('douyin_web_observe',{frames:1}),/聊天画面/);
  await assert.rejects(f.invoke('douyin_web_action',{action:'open_home',operation_id:'open'}),/关闭消息/);
  assert.equal(screenshots,0);assert.deepEqual(f.browser.actions,[]);
});
