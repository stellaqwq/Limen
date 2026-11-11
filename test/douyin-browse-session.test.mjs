import test from 'node:test';
import assert from 'node:assert/strict';
import {AIClient} from '../src/ai.mjs';
import {BotError} from '../src/errors.mjs';
import {browseMode,stopBrowseIntent,DouyinBrowseSession} from '../../../plugins/douyin-web/browse-session.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';
import {app,config,incoming,waitFor} from './helpers.mjs';

const call=(name,args)=>({tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
class Model extends AIClient {
  constructor(){super(config('unused').ai);this.decisions=[];this.tools=[];this.systems=[];this.decision='next';}
  async completion(messages,signal,tools,choice,options){
    (this.generations??=[]).push(options?.generation);
    if(choice!=='required')return {content:'普通聊天正常。'};
    const name=tools[0].function.name;this.tools.push(name);this.systems.push(messages[0].content);
    if(this.before)await this.before(name,signal);
    const results=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)),obs=results.findLast(r=>r.observation_id);
    if(name==='douyin_web_status')return call(name,{});
    if(name==='douyin_web_observe')return call(name,{frames:1});
    if(name==='douyin_web_action')return call(name,{action:(results.at(-1)?.page?.video?.paused||results.at(-1)?.video?.paused)?'play':'close_social',operation_id:'action-'+this.tools.length,observation_id:obs?.observation_id});
    if(name==='video_knowledge_save'){assert.equal(Object.hasOwn(tools[0].function.parameters.properties,'observation_id'),false);return call(name,{operation_id:'note',kind:'watch_note',title:'实际画面',summary:'当前视频的实际采样记录。'});}
    assert.equal(name,'douyin_browse_decide');this.decisions.push(tools[0].function.parameters.properties.decision.enum);
    assert.equal(Object.hasOwn(tools[0].function.parameters.properties,'observation_id'),false);
    return call(name,{decision:this.decision,operation_id:'decision',content:'画面中的景色很有意思。',wait_seconds:1});
  }
}
function browser(){
  const b={running:true,video:0,nexts:0,shots:0,surface:null,composer:'',commits:[],messages:[],paused:false,
    account:{uid:'im-user:101',name:'发送账号',avatar:'self.png'},recipient:{uid:'conversation:0:1:101:202',canonical_id:'user:peer',handle:'test-friend',name:'测试好友',avatar:'peer.png'},
    async evaluate(expression){
      if(expression===snapshotExpression)return {url:'https://www.douyin.com/',title:'实际视频',text:b.surface?'社交面板已打开':'实际画面',social_panel_open:!!b.surface,blocked:b.blocked||null,video_id:String(7703905545174140000n+BigInt(b.video)),media_key:'media-'+b.video,video:b.notReady?null:{paused:b.paused,width:800,height:600,x:400,y:300,current_seconds:2}};
      if(expression.includes('await active.e.play()')){b.paused=false;return {ok:true,paused:false};}
      const p=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));
      if(p.phase==='open'){b.surface=p.surface;return {ok:true};}
      if(p.phase==='close'){b.surface=null;return {ok:true,already_closed:true};}
      if(p.phase==='inspect')return {ok:true,account:b.account,contacts:[b.recipient],composer_empty:!b.composer,selected_uid:b.recipient.uid};
      if(p.phase==='read_chat')return {ok:true,messages:structuredClone(b.messages),order:'oldest_to_newest_by_server_id'};
      if(p.phase==='focus')return {ok:true,no_editor:p.surface==='share',already_filled:b.composer===p.content};
      if(p.phase==='commit'){b.commits.push({surface:p.surface,content:p.content});b.composer='';if(b.unknown)throw Error('lost response');return {ok:true,submitted:true};}
      return {ok:true};
    },async page(method,args){assert.equal(method,'Input.insertText');b.composer=args.text;},
    async screenshot(){b.shots++;b.onShot?.();return 'data:image/jpeg;base64,/9j/';},async next(){b.nexts++;if(b.failNext)throw Error('unknown next');b.video++;},async close(){b.running=false;}
  };return b;
}
async function fixture(t,patch={}){
  const b=browser(),model=new Model(),logs=[],bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',AI_CONCURRENCY:'1'},{douyinBrowser:b,ai:model,log:(level,event,fields)=>logs.push({level,event,...fields})}),s=bot.douyinWeb.browsing;
  clearInterval(s.timer);clearInterval(bot.douyinWeb.autoChat.timer);
  await applyDouyinSetup(bot.plugins,{qq_private_enabled:true,max_videos:1,...patch,web_enabled:true});
  let p=bot.plugins.find('douyin-web');await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,...patch},scope:{...p.scope,private_users:['10001']}}});
  p=bot.plugins.find('douyin-web');if(p.config.social_enabled)bot.douyinWeb.social.defaults.bind(p,{account:b.account,recipient:b.recipient});
  const start=async(text='去刷视频')=>{const r=bot.agent.chat({text});await waitFor(()=>bot.store.get(r.job_id)?.status==='done');assert.ok(s.active);return bot.store.get(r.job_id);};
  const round=async()=>{s.active.nextAt=0;await s.tick();const id=s.active?.pending;assert.ok(id);await waitFor(()=>['done','failed','ignored','uncertain'].includes(bot.store.get(id)?.status));const job=bot.store.get(id);await s.tick();return job;};
  return {bot,b,model,s,start,round,logs};
}

test('unbounded modes distinguish explicit counts, questions, negations and stop commands',()=>{
  for(const text of ['去刷视频','去抖音刷视频，只看不分享','一直刷抖音，直到我叫停','去抖音刷视频，最多分享1条'])assert.equal(browseMode(text),'continuous',text);
  for(const text of ['去刷一会儿视频','去抖音刷一会','刷视频，什么时候结束你决定'])assert.equal(browseMode(text),'autonomous',text);
  for(const text of ['去刷3条视频','去刷三条视频','去抖音看视频10条','你能刷抖音吗','不要刷视频','解释去刷视频是什么意思','停止刷视频'])assert.equal(browseMode(text),null,text);
  for(const text of ['停止刷视频','停','别刷了','暂停抖音'])assert.ok(stopBrowseIntent(text),text);
  for(const text of ['不要停止刷视频','你能停止吗？','视频里说停止刷视频','停止分享视频'])assert.equal(stopBrowseIntent(text),false,text);
});

test('continuous browsing exceeds one-video task limits with fresh contexts, no sharing switch and a bounded recent history',async t=>{
  const f=await fixture(t);assert.match((await f.start()).reply,/持续刷视频/);
  for(let i=0;i<6;i++)assert.equal((await f.round()).status,'done');
  assert.equal(f.b.nexts,6);assert.equal(f.s.active.viewed,6);assert.equal(f.s.active.recent.length,4);
  assert.ok(f.model.decisions.every(e=>!e.includes('stop')&&!e.includes('share')));assert.deepEqual(f.b.commits,[]);
  assert.equal(f.bot.douyinWeb.status().browsing.active,true);
  const session=f.s.active.webSession;assert.equal(f.bot.store.db.prepare('SELECT COUNT(*) n FROM jobs WHERE conversation=?').get('web:'+session).n,6);
});

test('watch samples the same video again, while autonomous stop completes the whole session',async t=>{
  const f=await fixture(t);await f.start('去刷一会儿视频');f.model.decision='watch';
  await f.round();await f.round();assert.equal(f.b.nexts,0);assert.equal(f.b.shots,2);assert.equal(f.s.active.viewed,1);
  f.model.decision='stop';assert.equal((await f.round()).status,'done');assert.equal(f.s.active,null);assert.equal(f.s.status().state,'completed');
  assert.ok(f.model.decisions.every(e=>e.includes('stop')));
});

test('browser generation settings apply to notes and decisions while normal chat keeps its own reasoning and token budget',async t=>{
  const f=await fixture(t,{knowledge_enabled:true,browse_reasoning_effort:'none',browse_max_output_tokens:2048});
  f.model.config.reasoningEffort='high';f.model.config.maxOutputTokens=16384;
  await f.start('去刷一会儿视频');f.model.decision='stop';assert.equal((await f.round()).status,'done');
  assert.equal(f.bot.douyinWeb.knowledge.count(f.bot.plugins.find('douyin-web')),1);
  assert.deepEqual(f.model.generations,[{reasoningEffort:'none',maxOutputTokens:2048},{reasoningEffort:'none',maxOutputTokens:2048}]);
  const chat=f.bot.agent.chat({text:'你好，普通聊天测试。'});await waitFor(()=>f.bot.store.get(chat.job_id)?.status==='done');
  assert.equal(f.model.generations.at(-1),undefined);assert.equal(f.model.config.reasoningEffort,'high');assert.equal(f.model.config.maxOutputTokens,16384);
});

test('fixed observation waits for the player to load before collecting evidence',async t=>{
  const f=await fixture(t);await f.start('去刷一会儿视频');f.b.notReady=true;const ready=setTimeout(()=>{f.b.notReady=false;},100);t.after(()=>clearTimeout(ready));
  f.model.decision='stop';assert.equal((await f.round()).status,'done');assert.equal(f.s.status().viewed,1);assert.equal(f.s.status().state,'completed');
});

test('a transient mixed sample is observed again before requesting the model or archiving',async t=>{
  const f=await fixture(t,{knowledge_enabled:true,knowledge_auto_archive:true});await f.start('去刷一会儿视频');f.model.decision='stop';
  f.b.onShot=()=>{if(f.b.shots===1)f.b.video++;};
  const job=await f.round();assert.equal(job.status,'done');assert.equal(f.b.shots,2);assert.equal(f.s.status().viewed,1);assert.equal(f.model.tools[0],'video_knowledge_save');assert.equal(f.bot.douyinWeb.knowledge.count(f.bot.plugins.find('douyin-web')),1);
});

test('autonomous stopping after archiving remains local even if the visible video has since changed',async t=>{
  const f=await fixture(t,{knowledge_enabled:true,knowledge_auto_archive:true});await f.start('去刷一会儿视频');f.model.decision='stop';f.model.before=async name=>{if(name==='douyin_browse_decide')f.b.video++;};
  assert.equal((await f.round()).status,'done');assert.equal(f.s.status().state,'completed');assert.equal(f.b.nexts,0);assert.deepEqual(f.b.commits,[]);
});

test('persistently mixed samples stop after a bounded number of observations without requesting the model',async t=>{
  const f=await fixture(t);await f.start();f.b.onShot=()=>{f.b.video++;};
  assert.equal((await f.round()).status,'failed');assert.equal(f.b.shots,3);assert.equal(f.model.tools.length,0);
});

test('QQ stop aborts an in-flight model call with one worker and unauthorized callers cannot stop',async t=>{
  const f=await fixture(t);await f.start();let entered=false;
  f.model.before=async(name,signal)=>{if(name==='douyin_browse_decide'){entered=true;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
  await f.s.tick();const id=f.s.active.pending;await waitFor(()=>entered);
  f.bot.adapter.driver.inject(incoming(99001,{sender:{user_id:10002},message:'停止刷视频'}));assert.ok(f.s.active);
  f.bot.adapter.driver.inject(incoming(99002,{message:'停止刷视频'}));await waitFor(()=>!f.s.active);
  await waitFor(()=>f.bot.store.get(id)?.status==='failed');assert.equal(f.b.nexts,0);
  await f.s.tick();assert.equal(f.s.active,null);
});

test('web stop acts when submitted, and ordinary conversation can run between browser rounds',async t=>{
  const f=await fixture(t);await f.start();await f.round();
  const chat=f.bot.agent.chat({text:'你好'});await waitFor(()=>f.bot.store.get(chat.job_id)?.status==='done');assert.match(f.bot.store.get(chat.job_id).reply,/普通聊天/);
  f.bot.agent.chat({text:'停止刷视频'});assert.equal(f.s.active,null);await f.s.tick();assert.equal(f.b.nexts,1);
});

test('settings changes revoke queued rounds and stale grants cannot restart them',async t=>{
  const f=await fixture(t);await f.start();await f.s.tick();const id=f.s.active.pending,event=JSON.parse(f.bot.store.get(id).event),job=f.bot.store.get(id);
  f.bot.douyinWeb.control({action:'stop'});f.bot.douyinWeb.control({action:'resume'});
  assert.equal(f.s.active,null);assert.throws(()=>f.bot.douyinWeb.tools(event,job),/停止|权限/);
  assert.equal(f.b.nexts,0);
});

test('failed next-video mutations stop the session and are not replayed',async t=>{
  const f=await fixture(t);await f.start();f.b.failNext=true;
  const job=await f.round();assert.equal(job.status,'failed');assert.equal(job.reason,'computer_operation_uncertain');assert.equal(job.attempts,1);assert.equal(f.s.active,null);assert.equal(f.b.nexts,1);
  await f.s.tick();await f.s.tick();assert.equal(f.b.nexts,1);
});

test('browse preflight rejections retain specific reasons without an ambiguous action or automatic replay',async t=>{
  const cases={
    video_changed:f=>{f.b.video++;},
    page_blocked:f=>{f.b.blocked='verification_required';},
    social_panel_open:f=>{f.b.surface='chat';},
    video_missing:f=>{f.b.notReady=true;},
    task_time_limit:f=>{f.bot.douyinWeb.owner.started-=601000;},
    observation_invalid:f=>{[...f.bot.douyinWeb.owner.observations.values()].at(-1).samples.at(-1).captured_at='2000-01-01T00:00:00.000Z';}
  };
  for(const [reason,change] of Object.entries(cases))await t.test(reason,async t=>{
    const f=await fixture(t);await f.start();
    f.model.before=async name=>{if(name==='douyin_browse_decide')change(f);};
    const job=await f.round();assert.equal(job.status,'failed');assert.equal(job.reason,'douyin_browse_rejected');assert.equal(job.attempts,1);
    const receipt=f.bot.store.db.prepare("SELECT state,result FROM agent_receipts WHERE job_id=? AND name LIKE 'douyin_browse_decide:%'").get(job.id);
    assert.equal(receipt.state,'done');const result=JSON.parse(receipt.result).result;
    assert.equal(result.rejected,true);assert.equal(result.reason,reason);assert.equal(result.uncertain,undefined);
    assert.equal(f.logs.find(e=>e.event==='ai_generation_failed'&&e.job===job.id).tool_reason,reason);
    assert.equal(f.s.active,null);await f.s.tick();assert.equal(f.b.nexts,0);assert.deepEqual(f.b.commits,[]);
  });
});

test('a video mismatch after sharing remains uncertain and does not replay the share',async t=>{
  const f=await fixture(t,{social_enabled:true,social_default_friend:'test-friend',browse_share_enabled:true});await f.start();f.model.decision='share';
  const send=f.bot.douyinWeb.recommendations.send.bind(f.bot.douyinWeb.recommendations);
  f.bot.douyinWeb.recommendations.send=async(...args)=>{const result=await send(...args);f.b.video++;return result;};
  const job=await f.round();assert.equal(job.status,'failed');assert.equal(job.reason,'computer_operation_uncertain');
  assert.equal(f.b.commits.length,2);assert.equal(f.b.nexts,0);await f.s.tick();assert.equal(f.b.commits.length,2);
});

test('a visual model failure after playback and observation is not retried as a new task and sampled progress survives',async t=>{
  const f=await fixture(t,{knowledge_enabled:true,knowledge_auto_archive:true});f.b.paused=true;await f.start();let failedCalls=0;
  f.model.before=async name=>{if(name==='video_knowledge_save'){failedCalls++;throw new BotError('synthetic model timeout',1500,{retryable:true});}};
  const job=await f.round();assert.equal(job.status,'failed');assert.equal(job.attempts,1);assert.equal(failedCalls,1);
  assert.equal(f.s.status().viewed,1);assert.equal(f.s.active,null);assert.equal(f.b.nexts,0);assert.deepEqual(f.b.commits,[]);
});

test('restart marks sessions interrupted and replaying their original start job does not resume',async t=>{
  const f=await fixture(t),start=await f.start(),event=JSON.parse(start.event);
  const restarted=new DouyinBrowseSession(f.bot.douyinWeb);restarted.agent=f.bot.agent;
  assert.equal(restarted.active,null);assert.equal(restarted.status().state,'interrupted');
  f.s.stop();assert.match(restarted.begin(event,start,'continuous'),/已启动过/);assert.equal(restarted.active,null);await restarted.close();
});

test('per-session sharing limit spans rounds, knowledge archives before decisions, and sharing stops at the cap',async t=>{
  const f=await fixture(t,{social_enabled:true,social_default_friend:'test-friend',browse_share_enabled:true,browse_share_max_per_task:1,knowledge_enabled:true,knowledge_auto_archive:true});
  await f.start();f.model.decision='share';const first=await f.round();assert.equal(first.status,'done');
  assert.equal(f.b.commits.length,2);assert.equal(f.s.active.shares,1);assert.equal(f.b.nexts,1);
  f.model.decision='next';assert.equal((await f.round()).status,'done');assert.equal(f.b.commits.length,2);assert.equal(f.b.nexts,2);
  assert.deepEqual(f.model.decisions,[['watch','next','share'],['watch','next']]);
  assert.equal(f.bot.douyinWeb.knowledge.count(f.bot.plugins.find('douyin-web')),2);
  assert.deepEqual(f.bot.store.db.prepare("SELECT name FROM agent_steps WHERE job_id=? AND kind='tool' ORDER BY id").all(first.id).map(s=>s.name),['douyin_web_status','douyin_web_observe','video_knowledge_save','douyin_browse_decide']);
  assert.deepEqual(f.model.tools.slice(0,2),['video_knowledge_save','douyin_browse_decide']);
});

test('origin persona applies to background rounds and a persona change revokes the session',async t=>{
  const f=await fixture(t),persona=f.bot.agent.state.savePersona({name:'测试人格',prompt:'偏爱自然风景，只描述可见事实。'});
  const source=f.bot.agent.chat({text:'你好'});await waitFor(()=>f.bot.store.get(source.job_id)?.status==='done');
  f.bot.agent.state.bind({conversation:'web:'+source.session,persona:persona.id});
  const start=f.bot.agent.chat({session:source.session,text:'去刷视频'});await waitFor(()=>f.bot.store.get(start.job_id)?.status==='done');
  await f.round();assert.ok(f.model.systems.some(p=>p.includes(persona.prompt)));
  f.bot.agent.state.savePersona({...persona,prompt:'新的人格规则'});await f.s.tick();assert.equal(f.s.active,null);
});

test('QQ continuous rounds preserve the origin scope even when web conversation access is off',async t=>{
  const f=await fixture(t,{web_enabled:false});
  f.bot.adapter.driver.inject(incoming(99501,{message:'去刷视频'}));await waitFor(()=>f.s.active);
  assert.equal((await f.round()).status,'done');assert.equal(f.b.nexts,1);
});

test('an already handled stop acknowledgement and duplicate QQ events cannot stop a newer session',async t=>{
  const f=await fixture(t);await f.start();
  const stopped=f.bot.agent.chat({text:'停止刷视频'});await waitFor(()=>f.bot.store.get(stopped.job_id)?.status==='done');
  const stopJob=f.bot.store.get(stopped.job_id),event=JSON.parse(stopJob.event);assert.equal(event.douyin_stop_handled,true);
  await f.start();const newer=f.s.active;
  await f.bot.agent.reply(stopJob.input,[],undefined,{event,job:stopJob});assert.equal(f.s.active,newer);
  f.bot.adapter.driver.inject(incoming(99502,{message:'停止刷视频'}));await waitFor(()=>!f.s.active);
  await f.start();const newest=f.s.active;
  f.bot.adapter.driver.inject(incoming(99502,{message:'停止刷视频'}));assert.equal(f.s.active,newest);
});

test('the timer automatically schedules multiple rounds and stops scheduling after a web stop',async t=>{
  const f=await fixture(t);f.s.timer=null;f.s.start(f.bot.agent);await f.start();
  await waitFor(()=>f.b.nexts>=2,7000);
  f.bot.agent.chat({text:'停止刷视频'});assert.equal(f.s.active,null);
  const count=f.b.nexts;await f.s.tick();assert.equal(f.b.nexts,count);
});

test('default-friend stop messages are read between rounds even with ordinary automatic replies off',async t=>{
  const f=await fixture(t,{social_enabled:true,social_default_friend:'test-friend',chat_read_enabled:true,browse_share_enabled:true,chat_auto_enabled:false});
  const auto=f.bot.douyinWeb.autoChat;
  const message=(id,text)=>({id,server_id:id,direction:'peer',kind:'text',text});
  f.b.messages=[message('7703905545174140400','你好')];await f.start();await f.round();
  f.b.messages.push(message('7703905545174140401','停止刷视频'));auto.nextAt=0;f.s.active.nextAt=0;
  await f.s.tick();assert.equal(f.s.active,null);assert.equal(f.b.nexts,1);assert.deepEqual(f.b.commits,[]);
});
