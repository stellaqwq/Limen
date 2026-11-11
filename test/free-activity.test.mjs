import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {AIClient} from '../src/ai.mjs';
import {FreeActivity,activityIntent,activityTemplate,nextDaily} from '../../../plugins/free-activity/service.mjs';
import {app,config,incoming,waitFor,temp} from './helpers.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',COMPUTER_ENABLED:'true',COMPUTER_QQ_ADMIN_ENABLED:'true',COMPUTER_SHELL_ENABLED:'true'};
const event=text=>({post_type:'message',message_type:'private',self_id:10000,user_id:10001,message_id:randomUUID(),message:[{type:'text',data:{text}}]});
const call=(name,args)=>({tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const plan={candidates:[{title:'检查工作目录',reason:'了解当前文件',tools:['computer_list_directory']},{title:'画画',reason:'练习配色',tools:['comfyui_status']}],selected:[1]};
class Model extends AIClient{
  constructor(fn){super(config('unused',env).ai);this.fn=fn;this.requests=[];}
  async completion(messages,signal,tools,choice){this.requests.push({messages:structuredClone(messages),tools,choice});return this.fn(messages,signal,tools,this.requests.length);}
}
async function install(bot){let p=await bot.plugins.install({kind:'free-activity'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}
const done=(bot,id)=>waitFor(()=>['done','failed','ignored'].includes(bot.store.get(id)?.status)&&bot.store.get(id));

test('recognizes immediate, interval, daily, delayed and control commands without matching unrelated conversation',()=>{
  const now=Date.parse('2026-11-07T12:30:00Z');
  assert.equal(activityIntent('请自由活动一下').action,'now');
  assert.equal(activityIntent('自由活动：画一幅秋天的画').focus,'画一幅秋天的画');
  assert.equal(activityIntent('定时 每隔30分钟 自由活动',now).interval_ms,1800000);
  assert.equal(activityIntent('每两小时自由活动',now).interval_ms,7200000);
  assert.equal(activityIntent('定时 每天20:30 自由活动',now).next_at,Date.parse('2026-11-08T12:30:00Z'));
  assert.equal(activityIntent('定时 10分钟后 自由活动',now).next_at,now+600000);
  assert.equal(activityIntent('查看自由活动定时').action,'list');
  assert.equal(activityIntent('取消自由活动定时 全部').id,'全部');
  assert.equal(activityIntent('/free stop').action,'stop');
  assert.equal(activityIntent('自由活动是什么？'),null);
  assert.equal(activityIntent('不要自由活动'),null);
  assert.equal(activityIntent('他说“自由活动”'),null);
  assert.equal(activityIntent('10分钟后见'),null);
  assert.equal(activityIntent('每30分钟喝水'),null);
  assert.throws(()=>nextDaily('25:00',now));
});

test('builtin install, defaults, singleton, export and configured scope work through existing plugin service',async t=>{
  const bot=await app(t,env),p=await install(bot);
  assert.equal(bot.plugins.list().builtins.find(p=>p.kind==='free-activity').version,activityTemplate.version);
  assert.equal((await bot.plugins.install({kind:'free-activity'})).id,p.id);
  assert.equal(bot.agent.freeActivity.allowed(event('自由活动'),{channel:'qq'}),true);
  assert.equal(bot.agent.freeActivity.allowed({...event('自由活动'),user_id:10002},{channel:'qq'}),false);
  assert.equal(bot.agent.freeActivity.allowed({...event('自由活动'),message_type:'group',group_id:20001},{channel:'qq'}),false);
  await assert.rejects(bot.plugins.save({plugin:activityTemplate}),/已安装/);
  await assert.rejects(bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,max_selected:9}}}),/范围/);
});

test('forces planning before tool execution and uses multiple existing tool families in one bounded run',async t=>{
  const selected={candidates:[...plan.candidates,{title:'看一眼桌面',reason:'检查窗口',tools:['desktop_observe']}],selected:[1,3]};
  let observed=0,listed=0;
  const model=new Model((messages,signal,tools,n)=>{
    if(n===1){assert.deepEqual(tools.map(t=>t.function.name),['free_activity_plan']);return call('free_activity_plan',selected);}
    if(n===2)return call('computer_list_directory',{});
    if(n===3)return call('desktop_observe',{});
    return {content:'已查看文件和窗口。'};
  });
  const bot=await app(t,env,{ai:model});await install(bot);
  bot.agent.computer.tools=()=>[{name:'computer_list_directory',description:'files',parameters:{type:'object',properties:{},additionalProperties:false},effect:'read',invoke:async()=>{listed++;return {result:{ok:true,files:['a.txt']}};}},{name:'desktop_observe',description:'desktop',parameters:{type:'object',properties:{},additionalProperties:false},effect:'read',invoke:async()=>{observed++;return {result:{ok:true,windows:[]}};}}];
  bot.agent.comfyui.tools=()=>[{name:'comfyui_status',description:'image',parameters:{type:'object',properties:{},additionalProperties:false},effect:'read',invoke:async()=>({result:{ok:true}})}];
  bot.adapter.driver.inject(incoming(99001,{message:'自由活动'}));const job=await done(bot,1);
  assert.equal(job.status,'done');assert.equal(listed,1);assert.equal(observed,1);assert.match(job.reply,/✓ 检查工作目录/);assert.match(job.reply,/· 画画/);
  const row=bot.store.db.prepare('SELECT * FROM free_activity_runs WHERE job_id=1').get();assert.equal(row.state,'completed');assert.equal(JSON.parse(row.executed).length,2);
  assert.ok(model.requests[1].tools.every(t=>!/^qq_|memory_save|qzone_/.test(t.function.name)));
});

test('persona and category restrictions apply before candidate selection',async t=>{
  const model=new Model((messages,signal,tools,n)=>{
    if(n===1)return call('free_activity_plan',{candidates:[{title:'查看时间',reason:'安排作息',tools:['current_time']}],selected:[1]});
    if(n===2){assert.deepEqual(tools.map(t=>t.function.name).sort(),['current_time','free_activity_plan']);return call('current_time',{});}
    return {content:'已查看当前时间。'};
  });
  const bot=await app(t,env,{ai:model});await install(bot);
  const p=bot.agent.state.savePersona({name:'clock',prompt:'简洁',tools:['current_time']});bot.store.db.prepare('INSERT INTO agent_sessions VALUES (?,?)').run('10000:private:10001',p.id);
  bot.adapter.driver.inject(incoming(99002,{message:'自由活动'}));assert.equal((await done(bot,1)).status,'done');
});

test('invalid and unselected tools cannot run, and saved activity is never replayed on model retry',async t=>{
  let invoked=0;
  const model=new Model((messages,signal,tools,n)=>{
    if(n===1)return call('free_activity_plan',{candidates:[{title:'看时间',reason:'休息',tools:['current_time']}],selected:[1]});
    if(n===2)return call('desktop_observe',{});
    assert.match(messages.at(-1).content,/不在本轮/);return {content:'未操作桌面。'};
  });
  const bot=await app(t,env,{ai:model});await install(bot);
  bot.agent.computer.tools=()=>[{name:'desktop_observe',description:'desktop',parameters:{type:'object',properties:{},additionalProperties:false},effect:'read',invoke:async()=>{invoked++;return {result:{ok:true}};}}];
  bot.adapter.driver.inject(incoming(99003,{message:'自由活动'}));const job=await done(bot,1);assert.equal(job.status,'done');assert.equal(invoked,0);
  await assert.rejects(bot.agent.reply(job.input,[],new AbortController().signal,{job,event:JSON.parse(job.event)}),/执行过/);
});

test('QQ schedule and help commands bypass model generation, duplicate QQ messages do not duplicate schedules',async t=>{
  const model=new Model(()=>{throw Error('must not call model');});const bot=await app(t,env,{ai:model});await install(bot);
  bot.adapter.driver.inject(incoming(99004,{message:'定时 每隔30分钟 自由活动'}));
  await waitFor(()=>bot.store.db.prepare('SELECT COUNT(*) n FROM free_activity_schedules').get().n===1);
  bot.adapter.driver.inject(incoming(99004,{message:'定时 每隔30分钟 自由活动'}));
  await new Promise(r=>setTimeout(r,100));assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM free_activity_schedules').get().n,1);assert.equal(model.requests.length,0);
});

test('interval scheduling collapses missed ticks, avoids overlapping conversations and cancels queued tasks',async t=>{
  const bot=await app(t,env);await install(bot);await bot.worker.close();clearInterval(bot.agent.freeActivity.timer);
  const f=bot.agent.freeActivity,e=event('定时'),j={channel:'qq',conversation:'10000:private:10001'},now=Date.now();
  assert.match(f.control({action:'schedule',mode:'interval',interval_ms:60000,next_at:now+60000,focus:'检查时间'},e,j),/已创建/);
  f.tick(now+3600000);f.tick(now+3600000);
  assert.equal(bot.store.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='queued'").get().n,1);
  const r=bot.store.db.prepare('SELECT * FROM free_activity_schedules').get();assert.equal(r.next_at,now+3660000);
  f.control({action:'cancel',id:r.id},e,j);assert.equal(bot.store.get(r.pending_job).status,'ignored');
});

test('one-shot schedule enqueues exactly once, can be cancelled before execution, and cannot fall back to normal Agent',async t=>{
  const model=new Model(()=>{throw Error('no model call');}),bot=await app(t,env,{ai:model});const p=await install(bot);await bot.worker.close();clearInterval(bot.agent.freeActivity.timer);
  const f=bot.agent.freeActivity,e=event('定时'),j={channel:'qq',conversation:'10000:private:10001'},now=Date.now();
  f.control({action:'schedule',mode:'once',next_at:now+60000,focus:'查看时间'},e,j);f.tick(now+60001);const s=bot.store.db.prepare('SELECT * FROM free_activity_schedules').get(),job=bot.store.get(s.pending_job);
  f.control({action:'cancel',id:s.id},e,j);await assert.rejects(bot.agent.reply(job.input,[],new AbortController().signal,{job,event:JSON.parse(job.event)}),/定时已取消/);
  await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:false});await assert.rejects(bot.agent.reply(job.input,[],new AbortController().signal,{job,event:JSON.parse(job.event)}),/权限已撤销/);
  assert.equal(model.requests.length,0);
});

test('scheduled execution reuses the current QQ conversation and persists its plan and ordinary reply',async t=>{
  const model=new Model((messages,signal,tools,n)=>n===1?call('free_activity_plan',{candidates:[{title:'看时间',reason:'作息',tools:['current_time']}],selected:[1]}):n===2?call('current_time',{}):{content:'已经检查当前时间。'});
  const bot=await app(t,env,{ai:model});await install(bot);clearInterval(bot.agent.freeActivity.timer);
  const f=bot.agent.freeActivity,e=event('定时'),j={channel:'qq',conversation:'10000:private:10001'},now=Date.now();
  f.control({action:'schedule',mode:'once',next_at:now+60000,focus:'检查时间'},e,j);f.tick(now+60001);
  const job=await done(bot,1);assert.equal(job.status,'done');assert.equal(job.conversation,j.conversation);assert.match(job.reply,/检查当前时间/);
  f.tick(now+120000);assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);assert.equal(bot.store.db.prepare('SELECT enabled FROM free_activity_schedules').get().enabled,0);
});

test('full global queue defers scheduled work and can recover without poisoned deduplication receipts',async t=>{
  const bot=await app(t,env);await install(bot);await bot.worker.close();clearInterval(bot.agent.freeActivity.timer);bot.config.maxPending=1;
  const f=bot.agent.freeActivity,e=event('定时'),j={channel:'qq',conversation:'10000:private:10001'},now=Date.now();
  const blocker=bot.store.ingest({...event('other'),user_id:10002},'other',1);
  f.control({action:'schedule',mode:'once',next_at:now+60000},e,j);f.tick(now+60001);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
  bot.store.update(blocker.id,'failed');f.tick(now+60002);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,2);assert.equal(bot.store.get(2).status,'queued');
});

test('schedule permission and persona changes disable future execution',async t=>{
  const bot=await app(t,env);await install(bot);await bot.worker.close();clearInterval(bot.agent.freeActivity.timer);
  const f=bot.agent.freeActivity,e=event('定时'),j={channel:'qq',conversation:'10000:private:10001'},now=Date.now();
  f.control({action:'schedule',mode:'interval',interval_ms:60000,next_at:now+60000},e,j);
  const p=bot.agent.state.savePersona({name:'new',prompt:'new'});bot.store.db.prepare('INSERT INTO agent_sessions VALUES (?,?)').run(j.conversation,p.id);f.tick(now+60001);
  assert.equal(bot.store.db.prepare('SELECT enabled FROM free_activity_schedules').get().enabled,0);assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
});

test('schedules survive restart and a dispatched one-shot is never replayed after recovery',async t=>{
  const directory=await temp(t),path=join(directory,'test.sqlite'),cfg=config(directory,env),p={...activityTemplate,id:'fixture',enabled:true,revision:1,scope:{...activityTemplate.scope,private_users:['10001']}};
  let store=new Store(path);const args={config:cfg,plugins:{rows:()=>[p]},adapter:{status:()=>({online:true})},log:()=>{}};
  let f=new FreeActivity({...args,store});f.agent={state:{persona:()=>null}};const e=event('定时'),j={channel:'qq',conversation:'10000:private:10001'},now=Date.now();
  f.control({action:'schedule',mode:'once',next_at:now+60000},e,j);f.close();store.close();
  store=new Store(path);f=new FreeActivity({...args,store});f.agent={state:{persona:()=>null}};
  try{f.tick(now+60001);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);store.update(1,'failed');f.tick(now+180000);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);}finally{f.close();store.close();}
});

test('stopping a running activity aborts its model signal immediately and cancels schedules',async t=>{
  let started;const ready=new Promise(r=>started=r);
  const model=new Model(async(messages,signal)=>{started();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});});
  const bot=await app(t,env,{ai:model});await install(bot);
  bot.adapter.driver.inject(incoming(99005,{message:'自由活动'}));await ready;
  bot.adapter.driver.inject(incoming(99006,{message:'停止自由活动'}));
  await waitFor(()=>bot.agent.freeActivity.active.size===0);assert.equal((await done(bot,1)).status,'failed');
});

test('web immediate and delayed controls stay in the same web session and never send QQ messages',async t=>{
  const model=new Model((messages,signal,tools,n)=>n===1?call('free_activity_plan',{candidates:[{title:'看时间',reason:'安排',tools:['current_time']}],selected:[1]}):n===2?call('current_time',{}):{content:'已查看。'});
  const bot=await app(t,env,{ai:model});await install(bot);let sends=0;bot.adapter.on('outgoing',()=>sends++);
  const started=bot.agent.chat({text:'自由活动'});assert.equal((await done(bot,started.job_id)).status,'done');
  const scheduled=bot.agent.chat({session:started.session,text:'定时 10分钟后 自由活动'});assert.match((await done(bot,scheduled.job_id)).reply,/已创建/);assert.equal(sends,0);
  const cancelled=bot.agent.chat({session:started.session,text:'取消自由活动定时 全部'});assert.match((await done(bot,cancelled.job_id)).reply,/已取消/);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) n FROM free_activity_schedules WHERE enabled=1').get().n,0);
});
