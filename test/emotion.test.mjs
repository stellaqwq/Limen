import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {EmotionService} from '../../../plugins/emotion/service.mjs';
import {emotionConfig,emotionTemplate} from '../../../plugins/emotion/config.mjs';
import {baseline,recover,appraiseRules,validateAppraisal,evolve,expressionPrompt,signalKeys} from '../../../plugins/emotion/dynamics.mjs';
import {installEmotion} from '../scripts/install-emotion.mjs';
import {installLivingMemory} from '../scripts/install-living-memory.mjs';
import {conversation} from '../src/messages.mjs';
import {app,config,incoming,request,temp,waitFor,withTestTimeout} from './helpers.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',AI_ALLOWED_GROUPS:'20001',AI_STREAM_ENABLED:'false'};
const event=(id=1,text='谢谢你，辛苦了',extra={})=>({post_type:'message',self_id:10000,user_id:10001,message_id:id,message_type:'private',message:[{type:'text',data:{text}}],...extra});
const job=(id=1,e=event())=>({id,channel:'qq',conversation:conversation(e)});
const modelSignals=patch=>({...Object.fromEntries(signalKeys.map(k=>[k,0])),confidence:0.95,...patch});
function fixture(t,{cfg={},appraisalAI,now=Date.now,path=':memory:',log=()=>{}}={}) {
  const store=new Store(path),settings=config('unused',env);
  let plugin={...structuredClone(emotionTemplate),id:'fixture',revision:1,enabled:true,config:emotionConfig({appraisal_mode:'rules',...cfg})};
  const service=new EmotionService({store,config:settings,appraisalAI,now,log});
  service.pluginFor=()=>plugin.enabled?plugin:null;service.personaFor=()=>'';service.plugins=()=>[plugin];
  t.after(async()=>{await service.close();store.close();});
  return {store,service,settings,get plugin(){return plugin;},set plugin(value){plugin=value;},ctx:(e=event())=>service.context(e),
    prepare:(id,text,extra={},options={})=>{const e=event(id,text,extra);return service.prepare(job(id,e),e,undefined,options);}};
}
async function install(bot,cfg={}) {
  let p=await installEmotion(bot.plugins,bot.config);
  return bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,appraisal_mode:'rules',...cfg}}});
}

test('psychodynamic state combines impulses, restraint and regulation with bounded changes and continuous recovery',()=>{
  const c=emotionConfig({appraisal_mode:'rules'}),now=1700000000000,initial=baseline(c,now);
  let s=initial;
  for(let n=0;n<8;n++)s=evolve(s,appraiseRules('谢谢你，你真棒'),c,now+n*1000);
  assert.ok(s.trust>initial.trust);assert.ok(s.familiarity>0);assert.equal(s.mood,'joyful');
  const hurt=evolve(s,appraiseRules('你真没用，闭嘴'),c,now+10000);
  assert.equal(hurt.mood,'guarded');assert.equal(hurt.strategy,'sublimation');assert.ok(hurt.tension>s.tension);
  assert.ok(Math.abs(hurt.valence-s.valence)<=c.max_step+0.001);
  const repaired=evolve(hurt,appraiseRules('对不起，刚才语气不好'),c,now+11000);
  assert.ok(repaired.tension<hurt.tension);assert.ok(repaired.trust>hurt.trust);
  const recovered=recover(hurt,c,now+10000+c.recovery_minutes*60000);
  assert.ok(Math.abs(recovered.tension-initial.tension)<Math.abs(hurt.tension-initial.tension));
  assert.ok(Math.abs(recovered.familiarity-hurt.familiarity)<0.01);
  const long=recover(s,c,now+400*86400000);assert.equal(long.mood,'calm');assert.ok(long.familiarity<0.001);
  for(const key of ['arousal','tension','trust','familiarity','connection','id_pressure','ego_capacity'])assert.ok(s[key]>=0&&s[key]<=1);
  const strong=evolve(initial,appraiseRules('你真没用'),{...c,ego_strength:1},now);
  const weak=evolve(initial,appraiseRules('你真没用'),{...c,ego_strength:0.1},now);
  assert.ok(strong.ego_capacity>weak.ego_capacity);assert.ok(strong.tension<weak.tension);
});

test('local appraisal distinguishes user distress, quoted insults, negation, serious requests and contradictory cues',()=>{
  for(const input of ['我今天好难过','我不开心','我没有考过']){
    const a=appraiseRules(input);assert.ok(a.vulnerability>0.3,input);assert.equal(a.threat,0);assert.equal(a.reward,0);
    assert.equal(evolve(baseline(emotionConfig()),a,emotionConfig(),Date.now()).mood,'concerned');
  }
  for(const input of ['解释“你真没用”这句台词','老板说你真没用','我不觉得你笨','把 "shut up" 翻译成中文'])assert.equal(appraiseRules(input).threat,0,input);
  const serious=evolve(baseline(emotionConfig()),appraiseRules('严肃点，直接回答'),emotionConfig(),Date.now());
  assert.equal(serious.mood,'reflective');assert.ok(serious.expressiveness<0.2);
  assert.ok(appraiseRules('谢谢你，你真没用').confidence<0.8);
  assert.match(expressionPrompt(serious),/不生成内心独白/);
  assert.match(expressionPrompt(serious),/事实准确性和既有权限继续优先/);
});

test('native emotion plugin validates configuration, installs once, exports and simulates without state or model calls',async t=>{
  const bot=await app(t,env,{emotionAI:{reply:async()=>{throw Error('must not be called');}}});
  const p=(await request(bot,'/admin/plugins/install',{kind:'psychodynamic-emotion'})).data;
  assert.equal(p.enabled,false);assert.ok(p.config_schema.ego_strength);
  assert.equal((await bot.plugins.install({kind:'psychodynamic-emotion'})).id,p.id);
  assert.equal((await request(bot,'/admin/plugins/install',{kind:'psychodynamic-emotion'},'onebot')).code,401);
  for(const patch of [{intensity:2},{max_step:0},{recovery_minutes:0},{appraisal_mode:'invalid'},{unknown:true},{warmth:'0.5'}])assert.throws(()=>emotionConfig(patch));
  await assert.rejects(bot.plugins.save({plugin:{...p,name:'重复'}}),/已安装/);
  const dry=await bot.plugins.test({plugin:p,text:'我今天好难过'});
  assert.match(dry.reply,/关切/);assert.match(dry.reply,/不写入/);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0);
  const output=join(await temp(t),'emotion.plugin.json');
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/emotion-plugin.mjs',import.meta.url)),output],{windowsHide:true});
  assert.equal(JSON.parse(await readFile(output,'utf8')).kind,'psychodynamic-emotion');
  await bot.plugins.remove({id:p.id,revision:p.revision});
  const installed=await installEmotion(bot.plugins,bot.config);assert.equal(installed.enabled,true);
  const stopped=await bot.plugins.toggle({id:installed.id,revision:installed.revision,enabled:false});
  assert.equal((await installEmotion(bot.plugins,bot.config)).revision,stopped.revision);
});

test('emotion instructions reach both Agent and legacy replies once and stay out of saved conversation history',async t=>{
  for(const enabled of ['true','false']){
    const seen=[],bot=await app(t,{...env,AGENT_ENABLED:enabled},{ai:{reply:async(input,history,signal,options)=>{seen.push(options);return '这件事听起来让你挺难受的，愿意说说发生了什么吗？';}}});
    await install(bot);
    bot.adapter.driver.inject(incoming(99001,{message:'我今天好难过'}));await waitFor(()=>bot.store.get(1)?.status==='done');
    assert.match(seen[0].systemPromptSuffix,/先简短接住/);
    const state=JSON.parse(bot.store.db.prepare('SELECT data FROM emotion_states').get().data);
    assert.equal(state.turns,1);assert.equal(state.mood,'concerned');
    assert.ok(bot.store.history(bot.store.get(1).conversation,10).every(r=>!r.content.includes('本轮对话表达建议')));
    assert.equal((await bot.emotion.prepare(bot.store.get(1),JSON.parse(bot.store.get(1).event))).includes('本轮对话表达建议'),true);
    assert.equal(JSON.parse(bot.store.db.prepare('SELECT data FROM emotion_states').get().data).turns,1);
  }
});

test('generation retries reuse emotion receipts rather than repeatedly increasing trust or tension',async t=>{
  let calls=0;const seen=[],bot=await app(t,env,{ai:{reply:async(input,history,signal,options)=>{
    seen.push(options.systemPromptSuffix);if(++calls===1)throw Object.assign(Error('retry fixture'),{retryable:true});return '谢谢，我们继续。';
  }}});
  await install(bot);bot.adapter.driver.inject(incoming(99002,{message:'谢谢你，你真棒'}));
  await waitFor(()=>bot.store.get(1)?.status==='queued'&&bot.store.get(1).attempts===1);
  bot.store.update(1,'queued',{nextAt:0});await waitFor(()=>bot.store.get(1)?.status==='done');
  assert.equal(calls,2);assert.equal(seen[0],seen[1]);
  assert.equal(JSON.parse(bot.store.db.prepare('SELECT data FROM emotion_states').get().data).turns,1);
});

test('per-account, conversation, group speaker and persona isolation precedes emotional state reads',async t=>{
  const f=fixture(t),group={message_type:'group',group_id:20001};
  await f.prepare(1,'你真没用',group);
  assert.equal(f.service.read(f.ctx(event(1,'',group))).mood,'guarded');
  for(const other of [event(),event(2,'',{...group,user_id:10002}),event(3,'',{...group,group_id:20002}),event(4,'',{...group,self_id:10009})])assert.equal(f.service.read(f.ctx(other)).turns,0);
  f.service.personaFor=()=> 'different';assert.equal(f.service.read(f.ctx(event(1,'',group))).turns,0);
  assert.equal((await f.prepare(1,'谢谢你',group)),'');
});

test('hybrid appraisal validates every numeric signal and falls back without logging private inputs or provider errors',async t=>{
  const logs=[];let response=JSON.stringify(modelSignals({vulnerability:0.8})),calls=0;
  const f=fixture(t,{cfg:{appraisal_mode:'hybrid'},log:(...args)=>logs.push(args),appraisalAI:{reply:async input=>{
    calls++;assert.equal(JSON.parse(input).current_message,'复杂而私密的隐喻');return response;
  }}});
  await f.prepare(1,'复杂而私密的隐喻');let s=f.service.read(f.ctx());assert.equal(s.mood,'concerned');assert.equal(s.appraisal_source,'model');
  response=JSON.stringify(modelSignals({threat:5}));await f.prepare(2,'复杂而私密的隐喻');s=f.service.read(f.ctx());assert.equal(s.appraisal_source,'fallback');
  response='private-provider-body';await f.prepare(3,'复杂而私密的隐喻');
  assert.equal(calls,3);assert.ok(!JSON.stringify(logs).includes('私密'));assert.ok(!JSON.stringify(logs).includes('private-provider-body'));
  assert.throws(()=>validateAppraisal(modelSignals({repair:'0.5'})));
  assert.throws(()=>validateAppraisal(modelSignals({confidence:NaN})));
});

test('optional appraisal timeout falls back while main cancellation never commits a partial state',async t=>{
  const blocked={reply:async(input,history,signal)=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})};
  const f=fixture(t,{cfg:{appraisal_mode:'hybrid',appraisal_timeout_ms:100},appraisalAI:blocked});
  await withTestTimeout(()=>f.prepare(1,'无法直接判断的表达'),1000);
  assert.equal(f.service.read(f.ctx()).appraisal_source,'fallback');
  const controller=new AbortController(),e=event(2,'无法直接判断的表达');
  const pending=f.service.prepare(job(2,e),e,controller.signal);controller.abort();assert.equal(await pending,'');
  assert.equal(f.service.read(f.ctx()).turns,1);
});

test('disable, reload, reset and persona changes invalidate a late model appraisal',async t=>{
  for(const action of ['disable','revision','reset','persona']){
    let release;const f=fixture(t,{cfg:{appraisal_mode:'hybrid'},appraisalAI:{reply:()=>new Promise(resolve=>{release=resolve;})}});
    const pending=f.prepare(1,'暧昧而复杂的语气');
    if(action==='disable'){f.service.cancel(f.plugin.id);f.plugin={...f.plugin,enabled:false};}
    if(action==='revision'){f.service.cancel(f.plugin.id);f.plugin={...f.plugin,revision:2};}
    if(action==='reset')f.service.reset(f.ctx());
    if(action==='persona')f.service.personaFor=()=> 'changed';
    release(JSON.stringify(modelSignals({reward:1})));
    assert.equal(await pending,'',action);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0,action);
  }
});

test('duplicate concurrent preparation and restart share a durable receipt and state transaction',async t=>{
  const f=fixture(t);
  const [a,b]=await Promise.all([f.prepare(1,'谢谢你'),f.prepare(1,'谢谢你')]);assert.equal(a,b);assert.equal(f.service.read(f.ctx()).turns,1);
  const path=join(await temp(t),'emotion.sqlite');let store,service;
  try{
    store=new Store(path);service=new EmotionService({store,config:f.settings});service.pluginFor=()=>f.plugin;
    await service.prepare(job(),event());await service.close();store.close();
    store=new Store(path);service=new EmotionService({store,config:f.settings});service.pluginFor=()=>f.plugin;
    assert.equal(await service.prepare(job(),event()),a);assert.equal(service.read(service.context(event())).turns,1);
  }finally{await service?.close();store?.close();}
  const failed=fixture(t);
  failed.store.db.exec("CREATE TRIGGER receipt_failure BEFORE INSERT ON emotion_receipts BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.equal(await failed.prepare(1,'谢谢你'),'');
  assert.equal(failed.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0);
});

test('memory resonance only adds gentle familiarity and never replays old negative memories as current emotion',async t=>{
  const c=emotionConfig({appraisal_mode:'rules'}),s=baseline(c),a=appraiseRules('你好');
  const without=evolve(s,a,c,s.updated_at),withMemory=evolve(s,a,c,s.updated_at,{hasMemory:true});
  assert.ok(withMemory.familiarity>without.familiarity);assert.ok(withMemory.familiarity-without.familiarity<0.05);
  assert.equal(withMemory.tension,without.tension);
  const seen=[],bot=await app(t,env,{ai:{reply:async(input,history,signal,options)=>{seen.push(options.systemPromptSuffix);return '记得你的项目。';}}});
  await install(bot);await installLivingMemory(bot.plugins,bot.config);
  bot.adapter.driver.inject(incoming(99003,{message:'/lmem remember 项目 | 之前因为项目失败很难过'}));
  await waitFor(()=>bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n===1);
  bot.adapter.driver.inject(incoming(99004,{message:'你好，项目'}));await waitFor(()=>bot.store.list().some(r=>r.status==='done'));
  const state=JSON.parse(bot.store.db.prepare('SELECT data FROM emotion_states').get().data);
  assert.notEqual(state.mood,'concerned');assert.ok(state.familiarity>0.04);assert.match(seen[0],/之前因为项目失败很难过/);
});

test('Chat Plus keeps routing and reply style while its older mood prompt yields to the emotion plugin',async t=>{
  const seen=[],bot=await app(t,env,{ai:{reply:async(input,history,signal,options)=>{seen.push(options.systemPromptSuffix);return '有意思，我们一起看看。';}}});
  let g=await bot.plugins.install({kind:'group-chat-plus'});
  g=await bot.plugins.save({id:g.id,revision:g.revision,plugin:{...g,scope:{...g.scope,groups:['20001']},config:{...g.config,
    merge_window_ms:0,quiet_hours_enabled:false,proactive_enabled:false,decision_ai_enabled:false,reply_style:'简短参与讨论。',happy_style:'旧开心语气',neutral_style:'旧中性语气'}}});
  await bot.plugins.toggle({id:g.id,revision:g.revision,enabled:true});await install(bot);
  bot.adapter.driver.inject(incoming(99005,{kind:'group',groupId:20001,message:[{type:'at',data:{qq:'10000'}},{type:'text',data:{text:'谢谢你，太好了'}}]}));
  await waitFor(()=>bot.store.get(1)?.status==='done');
  assert.match(seen[0],/本轮对话表达建议/);assert.match(seen[0],/简短参与讨论/);assert.doesNotMatch(seen[0],/旧开心语气|旧中性语气/);
});

test('emotion admin commands enforce permissions; preview is read-only and reset preserves long-term memories',async t=>{
  const bot=await app(t,env,{ai:{reply:async()=> '你好'}});let p=await install(bot);
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001','10002']}}});
  await installLivingMemory(bot.plugins,bot.config);
  bot.adapter.driver.inject(incoming(99006,{message:'谢谢你'}));await waitFor(()=>bot.store.get(1)?.status==='done');
  const before=bot.store.db.prepare('SELECT data FROM emotion_states').get().data;
  const preview=await bot.emotion.handle(p,event(2,'/emotion preview 你真没用'));assert.match(preview.reply,/模拟/);
  assert.equal(bot.store.db.prepare('SELECT data FROM emotion_states').get().data,before);
  bot.adapter.driver.inject(incoming(99007,{sender:{user_id:10002},message:'/emotion reset'}));
  await waitFor(()=>bot.store.list().some(r=>r.reason==='command_forbidden'));assert.equal(bot.store.db.prepare('SELECT data FROM emotion_states').get().data,before);
  const e=event(3,'/emotion reset'),ctx=bot.livingMemory.context(e);bot.livingMemory.put(ctx,{key:'项目',content:'开发絮桥'});
  await bot.emotion.handle(p,e);assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n,1);
  assert.equal(await bot.emotion.prepare(bot.store.get(1),JSON.parse(bot.store.get(1).event)),'');
});

test('new conversation resets only that conversation while retention, scope limits and logs omit raw user text',async t=>{
  let now=1700000000000;const f=fixture(t,{now:()=>now,cfg:{max_scopes:10,retention_days:1}});
  for(let n=1;n<=12;n++){now+=1000;await f.prepare(n,'我今天好难过，私密测试'+n,{user_id:10000+n});}
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,10);
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM emotion_states').all()).includes('私密测试'));
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM emotion_receipts').all()).includes('私密测试'));
  f.store.emit('context_reset',conversation(event(12,'',{user_id:10012})));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,9);
  now+=2*86400000;f.service.cleanup();assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0);
});

test('web, proactive, self, blocked, slash and zero-intensity messages do not accumulate emotional state',async t=>{
  const f=fixture(t);
  const e=event();assert.equal(await f.service.prepare({...job(),channel:'web'},e),'');
  assert.equal(await f.prepare(2,'你好',{}, {proactive:true}),'');
  assert.equal(await f.prepare(3,'/tools'),'');assert.equal(await f.prepare(4,'你好',{user_id:10000}),'');
  f.plugin={...f.plugin,config:{...f.plugin.config,intensity:0}};assert.equal(await f.prepare(5,'谢谢你'),'');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0);
  const bot=await app(t,{...env,GROUP_BLOCKED_USERS:'20001:10001'},{ai:{reply:async()=> '不应调用'}});
  await install(bot);
  const group=event(6,'谢谢你',{message_type:'group',group_id:20001,message:[{type:'at',data:{qq:'10000'}},{type:'text',data:{text:'谢谢你'}}]});
  assert.ok(bot.emotion.context({...group,user_id:10002}));
  assert.equal(await bot.emotion.prepare(job(6,group),group),'');
});
