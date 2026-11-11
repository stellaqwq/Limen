import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../src/store.mjs';
import {LivingMemory} from '../../../plugins/living-memory/service.mjs';
import {livingMemoryTemplate,livingMemoryConfig} from '../../../plugins/living-memory/config.mjs';
import {PluginService} from '../src/plugins/service.mjs';
import {installLivingMemory} from '../scripts/install-living-memory.mjs';
import {conversation} from '../src/messages.mjs';
import {AIClient} from '../src/ai.mjs';
import {app,config,incoming,waitFor,temp,request} from './helpers.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',AI_STREAM_ENABLED:'false'};
const event=(id=1,text='我喜欢茉莉花茶',extra={})=>({post_type:'message',self_id:10000,user_id:10001,message_id:id,message_type:'private',message:[{type:'text',data:{text}}],...extra});
const summary=memories=>JSON.stringify({memories});
function fixture(t,{cfg={},summaryAI,now,fetchImpl,path=':memory:'}={}) {
  const store=new Store(path),settings=config('unused',env);
  let plugin={...structuredClone(livingMemoryTemplate),id:'fixture',revision:1,enabled:true,config:livingMemoryConfig(cfg)};
  const service=new LivingMemory({store,config:settings,summaryAI,now,fetchImpl});
  service.pluginFor=()=>plugin.enabled?plugin:null;
  service.plugins=()=>[plugin];
  service.personaFor=()=>'';
  t.after(async()=>{await service.close();store.close();});
  return {store,service,get plugin(){return plugin;},set plugin(value){plugin=value;},ctx:(e=event())=>service.context(e),
    capture:(id,text,extra={})=>{const e=event(id,text,extra);service.capture({id,reply:'明白了',conversation:conversation(e)},e);}};
}

test('native memory package installs once, validates configuration and preserves prior settings',async t=>{
  const bot=await app(t,env);
  const installed=await request(bot,'/admin/plugins/install',{kind:'living-memory'});
  assert.equal(installed.code,200);assert.equal(installed.data.enabled,false);
  assert.ok(installed.data.config_schema.embedding_api_key.secret);
  assert.equal((await request(bot,'/admin/plugins/install',{kind:'living-memory'})).data.id,installed.data.id);
  const invalid=structuredClone(installed.data);invalid.config.summary_turns=0;
  assert.equal((await request(bot,'/admin/plugins/save',{id:invalid.id,revision:invalid.revision,plugin:invalid})).code,400);
  assert.throws(()=>livingMemoryConfig({embedding_base_url:'https://example.test/v1'}));
  assert.throws(()=>livingMemoryConfig({embedding_base_url:'https://u:p@example.test/v1',embedding_model:'m'}));
  assert.throws(()=>livingMemoryConfig({auto_summarize:'false'}));
  assert.throws(()=>livingMemoryConfig({unrecognized:true}));
  await bot.plugins.remove({id:installed.data.id,revision:installed.data.revision});
  let p=await installLivingMemory(bot.plugins,bot.config);
  assert.equal(p.enabled,true);assert.deepEqual(p.scope.private_users,['10001']);
  p=await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:false});
  assert.equal((await installLivingMemory(bot.plugins,bot.config)).enabled,false);
  const dry=await bot.plugins.test({plugin:p,text:'/lmem remember 测试 | 不应保存'});
  assert.equal(dry.handled,true);assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n,0);
  const exportedPath=join(await temp(t),'living-memory.plugin.json');
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/living-memory-plugin.mjs',import.meta.url)),exportedPath],{windowsHide:true});
  const exported=JSON.parse(await readFile(exportedPath,'utf8'));
  assert.equal(exported.kind,'living-memory');assert.equal(exported.config.embedding_api_key,'');
});

test('successful QQ replies automatically summarize and inject relevant memories without persisting injected text',async t=>{
  const requests=[],sources=[];
  const model={reply:async(input,history,signal,options)=>{requests.push({input,history,suffix:options.systemPromptSuffix});return '好的。';}};
  const bot=await app(t,env,{ai:model,memoryAI:{reply:async input=>{sources.push(JSON.parse(input));return summary([{key:'饮品偏好',content:'用户喜欢茉莉花茶',tags:['饮品','茶']}]);}}});
  let p=await installLivingMemory(bot.plugins,bot.config);
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,summary_turns:2}}});
  for(let id=1;id<=2;id++){
    bot.adapter.driver.inject(incoming(98000+id,{message:id===1?'我喜欢茉莉花茶':'以后饮品推荐可以考虑茉莉花茶'}));
    await waitFor(()=>bot.store.get(id)?.status==='done');
  }
  await waitFor(()=>bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n===1);
  assert.equal(sources[0].length,2);
  bot.adapter.driver.inject(incoming(98003,{message:'我的饮品偏好是什么？'}));
  await waitFor(()=>bot.store.get(3)?.status==='done');
  assert.match(requests[2].suffix,/用户喜欢茉莉花茶/);
  assert.ok(bot.store.history(bot.store.get(3).conversation,10).every(row=>!row.content.includes('长期记忆（仅作资料')));
  assert.equal(bot.store.db.prepare('SELECT accesses FROM living_memories').get().accesses,1);
  // Duplicate completion notification cannot create a second turn.
  const job=bot.store.get(3);bot.livingMemory.capture(job,JSON.parse(job.event));
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns').get().n,1);
});

test('memory capture follows confirmed delivery and ignores failures, web jobs and proactive input',async t=>{
  const bot=await app(t,env,{ai:{reply:async()=> '回复'}});
  await installLivingMemory(bot.plugins,bot.config);
  const original=bot.adapter.action.bind(bot.adapter);
  bot.adapter.action=async(name,...args)=>{if(name.startsWith('send_'))throw Object.assign(Error('failed'),{code:1500,retryable:false,uncertain:false});return original(name,...args);};
  bot.adapter.driver.inject(incoming(98101,{message:'我喜欢红茶'}));
  await waitFor(()=>bot.store.get(1)?.status==='failed');
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns').get().n,0);
  const e=event();
  bot.livingMemory.capture({id:99,channel:'web',reply:'test',conversation:'web:fixture'},e);
  bot.livingMemory.capture({id:98,reply:'test',conversation:conversation(e)},e,{proactive:true});
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns').get().n,0);
});

test('account, conversation, group speaker and persona boundaries apply before retrieval and mutations',async t=>{
  const f=fixture(t);
  const group=event(1,'记住我喜欢乌龙茶',{message_type:'group',group_id:20001});
  const ctx=f.ctx(group),row=await f.service.memorize(ctx,{key:'茶',content:'喜欢乌龙茶'});
  assert.equal((await f.service.search(ctx,'乌龙茶')).length,1);
  for(const other of [event(),{...group,user_id:10002},{...group,group_id:20002},{...group,self_id:10009}]){
    assert.equal((await f.service.search(f.ctx(other),'乌龙茶')).length,0);
    assert.throws(()=>f.service.change(f.ctx(other),row.id,'forget'));
  }
  f.service.personaFor=()=> 'different';
  assert.equal((await f.service.search(f.ctx(group),'乌龙茶')).length,0);
  await assert.rejects(()=>f.service.memorize(ctx,{key:'旧人格',content:'禁止写入'}));
  // Only the triggering speaker's text is captured from a merged group job.
  f.service.capture({id:4,conversation:conversation(group),input:'另一个用户喜欢咖啡',reply:'另一个用户喜欢咖啡'},group);
  const buffered=f.service.turns(f.ctx(group))[0];
  assert.equal(buffered.input,'记住我喜欢乌龙茶');assert.equal(buffered.reply,'');
});

test('memory tool writes require actual user intent and are revoked immediately on plugin changes',async t=>{
  const f=fixture(t),e=event(1,'记住我喜欢蓝色'),job={id:1,conversation:conversation(e)};
  const tools=f.service.tools(e,job),saved=await tools.find(t=>t.name==='memorize_long_term_memory').invoke({key:'颜色',content:'喜欢蓝色'});
  assert.equal(saved.result.key,'颜色');
  const noIntent=f.service.tools(event(2,'你好'),job);
  assert.equal((await noIntent[1].invoke({key:'其他',content:'不允许'})).result.ok,false);
  assert.equal((await noIntent[2].invoke({id:saved.result.id})).result.ok,false);
  for(const text of ['请不要记住这个','怎么记住偏好？','Do not remember this']){
    assert.equal((await f.service.tools(event(3,text),job)[1].invoke({key:'禁止',content:'不应保存'})).result.ok,false);
  }
  for(const text of ['别忘记我','请不要忘记蓝色','How to forget memories?']){
    assert.equal((await f.service.tools(event(4,text),job)[2].invoke({id:saved.result.id})).result.ok,false);
  }
  f.capture(5,'请忘记我喜欢蓝色');f.capture(6,'不要记录这段对话');
  assert.equal(f.service.turns(f.ctx()).length,0);
  f.plugin={...f.plugin,enabled:false};
  assert.equal((await tools[0].invoke({query:'蓝色'})).result.ok,false);
  assert.equal(f.service.tools(e,job).length,0);
});

test('Agent exposes long-term tools, honors persona tool lists and persists write receipts',async t=>{
  let n=0;
  class Model extends AIClient {
    constructor(){super(config('unused',env).ai);}
    async completion(messages,signal,tools){
      assert.ok(tools.some(t=>t.function.name==='recall_long_term_memory'));
      if(++n===1)return {tool_calls:[{id:'memory-call',type:'function',function:{name:'memorize_long_term_memory',arguments:JSON.stringify({key:'风格',content:'喜欢简洁回答'})}}]};
      return {content:'已记住。'};
    }
  }
  const bot=await app(t,env,{ai:new Model()});await installLivingMemory(bot.plugins,bot.config);
  bot.adapter.driver.inject(incoming(98201,{message:'记住我喜欢简洁回答'}));
  await waitFor(()=>bot.store.get(1)?.status==='done');
  assert.equal(bot.store.db.prepare('SELECT key,pinned FROM living_memories').get().pinned,1);
  assert.equal(bot.agent.state.trace(1).find(s=>s.name==='memorize_long_term_memory').state,'succeeded');
  const e=JSON.parse(bot.store.get(1).event),job=bot.store.get(1);
  const persona=bot.agent.state.savePersona({name:'时间',prompt:'只报时',tools:['current_time']});
  bot.agent.state.bind({conversation:job.conversation,persona:persona.id});
  let checked=false;
  bot.agent.ai={reply:async(input,history,signal,options)=>{checked=true;assert.deepEqual(options.tools.map(t=>t.function.name),['current_time']);return '当前时间';}};
  await bot.agent.reply('你好',[],undefined,{event:e,job});assert.equal(checked,true);
});

test('malformed summaries preserve buffers and atomic batches roll back if the quota is exhausted',async t=>{
  let result='not JSON';
  const f=fixture(t,{cfg:{auto_summarize:false,max_memories:10},summaryAI:{reply:async()=>result}});
  f.capture(1,'我喜欢游泳');f.capture(2,'周末通常游泳');
  const ctx=f.ctx();
  f.service.schedule(ctx,{force:true});await f.service.tasks.get(ctx.key).promise;
  assert.equal(f.service.states.get(ctx.key),'failed');assert.equal(f.service.turns(ctx).length,2);assert.equal(f.service.rows(ctx).length,0);
  for(let n=0;n<9;n++)f.service.put(ctx,{key:'已有'+n,content:'内容'+n});
  result=summary([{key:'新增1',content:'第一条'},{key:'新增2',content:'第二条'}]);
  f.service.schedule(ctx,{force:true});await f.service.tasks.get(ctx.key).promise;
  assert.equal(f.service.rows(ctx).length,9);assert.equal(f.service.turns(ctx).length,2);
  result=summary([{key:'运动',content:'用户喜欢游泳'}]);
  f.service.schedule(ctx,{force:true});await f.service.tasks.get(ctx.key).promise;
  assert.equal(f.service.rows(ctx).length,10);assert.equal(f.service.turns(ctx).length,0);
});

test('reset, disable, forget and persona changes prevent delayed background summaries from writing back',async t=>{
  for(const action of ['reset','disable','forget','persona']){
    let release;
    const f=fixture(t,{cfg:{auto_summarize:false},summaryAI:{reply:()=>new Promise(resolve=>{release=resolve;})}});
    const ctx=f.ctx(),old=f.service.put(ctx,{key:'旧记忆',content:'旧事实'});
    f.capture(1,'用户的新事实');f.service.schedule(ctx,{force:true});
    const task=f.service.tasks.get(ctx.key);
    if(action==='reset')f.store.emit('context_reset',conversation(event()));
    if(action==='disable'){f.service.cancel(f.plugin.id);f.plugin={...f.plugin,enabled:false};}
    if(action==='forget')f.service.change(ctx,old.id,'forget');
    if(action==='persona')f.service.personaFor=()=> 'changed';
    release(summary([{key:'不应出现',content:'迟到的总结'}]));await task.promise;
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM living_memories WHERE key='不应出现'").get().n,0,action);
  }
});

test('decay, expiry, reinforcement, manual pinning and source retention follow configured lifecycle',async t=>{
  let now=1000000000000;
  const f=fixture(t,{now:()=>now,cfg:{decay_rate:0.1,source_days:1}}),ctx=f.ctx();
  const short=f.service.put(ctx,{key:'计划',content:'明天去看展',ttl_days:1},{source:[{user:'原文'}]});
  const weak=f.service.put(ctx,{key:'旧偏好',content:'曾经喜欢汽水',importance:0.1,ttl_days:0});
  const pinned=await f.service.memorize(ctx,{key:'永久偏好',content:'喜欢茉莉花茶',ttl_days:0,importance:1});
  now+=2*86400000;f.service.maintain(ctx);
  assert.equal(f.service.rows(ctx).find(r=>r.id===short.id).status,'archived');
  assert.equal(f.service.rows(ctx).find(r=>r.id===short.id).source,null);
  now+=2*86400000;f.service.maintain(ctx);
  assert.equal(f.service.rows(ctx).find(r=>r.id===weak.id).status,'archived');
  assert.equal(f.service.rows(ctx).find(r=>r.id===pinned.id).importance,1);
  f.service.change(ctx,short.id,'restore');
  assert.ok((await f.service.search(ctx,'明天看展')).some(r=>r.id===short.id));
  assert.equal(f.service.rows(ctx).find(r=>r.id===short.id).accesses,1);
  f.service.put(ctx,{key:'永久偏好',content:'模型不能覆盖固定事实'});
  assert.equal(f.service.rows(ctx).find(r=>r.id===pinned.id).content,'喜欢茉莉花茶');
  f.service.change(ctx,short.id,'forget');assert.ok(!f.service.rows(f.ctx()).some(r=>r.id===short.id));
});

test('optional embeddings recall semantic matches, isolate provider fingerprints and fall back on failure',async t=>{
  let down=false,modelChanged=false,calls=0;
  const f=fixture(t,{cfg:{embedding_base_url:'https://embedding.example/v1',embedding_model:'fixture'},fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://embedding.example/v1/embeddings');assert.ok(!options.headers.Authorization);
    if(down)throw Error('provider private body');
    return new Response(JSON.stringify({data:[{embedding:modelChanged?[1,0,0]:[1,0]}]}));
  }});
  let ctx=f.ctx();await f.service.memorize(ctx,{key:'饮品',content:'喜欢茉莉花茶'});
  assert.equal((await f.service.search(ctx,'beverage preference')).length,1);
  down=true;assert.equal((await f.service.search(ctx,'茉莉花茶')).length,1);
  assert.equal((await f.service.search(ctx,'unrelated')).length,0);
  down=false;modelChanged=true;assert.equal((await f.service.search(ctx,'beverage preference')).length,0);
  f.plugin={...f.plugin,revision:2,config:{...f.plugin.config,embedding_model:'other'}};ctx=f.ctx();
  assert.equal((await f.service.search(ctx,'beverage preference')).length,0);
  assert.equal((await f.service.search(ctx,'茉莉花茶')).length,1);assert.ok(calls>3);
});

test('memory commands use existing admin and scope checks; new/reset retain saved facts',async t=>{
  const bot=await app(t,env);await installLivingMemory(bot.plugins,bot.config);
  bot.adapter.driver.inject(incoming(98301,{message:'/lmem remember 饮品 | 喜欢茉莉花茶'}));
  await waitFor(()=>bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n===1);
  const count=()=>bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n;
  // Expand only the plugin scope so denied slash commands reach the same permission gate.
  let p=bot.plugins.find('living-memory');p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001','10002']}}});
  bot.adapter.driver.inject(incoming(98302,{message:'/lmem remember 越权 | 不应保存',sender:{user_id:10002}}));
  await waitFor(()=>bot.store.db.prepare("SELECT 1 FROM jobs WHERE reason='command_forbidden'").get());
  assert.equal(count(),1);
  bot.adapter.driver.inject(incoming(98303,{message:'/new'}));
  await waitFor(()=>bot.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n>=3);assert.equal(count(),1);
  const e=event(4,'/lmem status');assert.match((await bot.livingMemory.handle(p,e)).reply,/1 条有效/);
  await bot.plugins.remove({id:p.id,revision:p.revision});assert.equal(count(),0);
});

test('memory rows survive process reopen independently of short-term history cleanup',async t=>{
  const path=join(await temp(t),'memory.sqlite');
  const store=new Store(path),settings=config('unused',env),plugins=new PluginService({store,config:settings,adapter:{},log:()=>{}});
  let p=await plugins.install({kind:'living-memory'});
  p=await plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});
  p=await plugins.toggle({id:p.id,revision:p.revision,enabled:true});
  const service=new LivingMemory({store,config:settings});service.pluginFor=()=>p;
  await service.memorize(service.context(event()),{key:'长期项目',content:'正在开发絮桥'});
  await service.close();await plugins.close();store.close();
  const reopened=new Store(path),next=new LivingMemory({store:reopened,config:settings});next.pluginFor=()=>p;
  try{reopened.cleanup(1,1,1000);assert.equal((await next.search(next.context(event()),'絮桥'))[0].key,'长期项目');}
  finally{await next.close();reopened.close();}
});

test('credentials are rejected, source buffers stay bounded and empty summaries advance safely',async t=>{
  const f=fixture(t,{cfg:{auto_summarize:false},summaryAI:{reply:async()=>summary([])}}),ctx=f.ctx();
  assert.throws(()=>f.service.put(ctx,{key:'API key',content:'api_key: private-value'}));
  f.capture(1,'密码：private-value');assert.equal(f.service.turns(ctx).length,0);
  for(let n=2;n<100;n++)f.capture(n,'有效偏好 '+n);
  assert.equal(f.service.turns(ctx).length,80);
  f.service.schedule(ctx,{force:true});await f.service.tasks.get(ctx.key).promise;
  assert.equal(f.service.rows(ctx).length,0);assert.ok(f.service.turns(ctx).length<80);
});
