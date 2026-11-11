import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {app,cleanup} from './helpers.mjs';

const session='10000:private:10001';
const event=(id,text)=>({post_type:'message',message_type:'private',self_id:10000,user_id:10001,message_id:id,message:[{type:'text',data:{text}}]});
const result=JSON.stringify({memories:[{key:'饮品偏好',content:'用户喜欢茉莉花茶',type:'preference',importance:0.7,tags:['茶'],ttl_days:180}]});
async function setup(t,{persona=false,delayed=false}={}){
  const requests=[];let release,arrived;
  const seen=new Promise(resolve=>arrived=resolve),gate=delayed?new Promise(resolve=>release=resolve):Promise.resolve();
  const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;requests.push(JSON.parse(text));arrived();await gate;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:result},finish_reason:'stop'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>server.close(resolve)));
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'main-model',AI_ALLOWED_USERS:'10001',AI_STREAM_ENABLED:'false',AI_BASE_URL:'http://127.0.0.1:'+server.address().port,AI_SYSTEM_PROMPT:'你是默认角色小桥。称呼用户为搭档，关系记录应区分用户和小桥。'});
  let p=await bot.plugins.install({kind:'living-memory'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']},config:{...p.config,auto_summarize:false,summary_model:'memory-model',summary_turns:2}}});await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
  let role;
  if(persona){role=bot.agent.state.savePersona({name:'蓝鲸',prompt:'当前会话角色是蓝鲸，用户是船长。只用角色语气回答。'});bot.store.db.prepare('INSERT INTO agent_sessions VALUES (?,?)').run(session,role.id);}
  for(const [id,text] of [[1,'我喜欢茉莉花茶'],[2,'以后聊饮品可以参考这个偏好']])bot.livingMemory.capture({id,conversation:session,reply:'收到，搭档。'},event(id,text));
  return {bot,requests,role,seen,release,ctx:bot.livingMemory.context(event(3,'整理记忆'),{channel:'qq',conversation:session})};
}
test('default summary uses the real system prompt followed by one copy of extraction rules, with its own summary model',async t=>{
  const f=await setup(t);await f.bot.livingMemory.summarize(f.ctx,new AbortController().signal,{force:true});
  assert.equal(f.requests.length,1);const r=f.requests[0],system=r.messages[0].content;
  assert.equal(r.model,'memory-model');assert.equal(r.stream,false);assert.equal(r.tools,undefined);assert.equal(r.messages.length,2);
  assert.ok(system.startsWith(f.bot.config.ai.systemPrompt));assert.match(system,/当前角色的身份整理长期记忆/);assert.equal(system.split('只输出 JSON：').length-1,1);
  assert.match(system,/不得把角色设定当成本批对话中新发生的事实/);assert.match(system,/助手回复仅作语境/);
  assert.equal(JSON.parse(r.messages[1].content).length,2);assert.doesNotMatch(r.messages[1].content,/默认角色小桥/);
  assert.equal(f.bot.livingMemory.rows(f.ctx)[0].content,'用户喜欢茉莉花茶');assert.equal(f.bot.livingMemory.turns(f.ctx).length,0);
});
test('bound session persona supplements the system prompt without leaking another session persona',async t=>{
  const f=await setup(t,{persona:true});const other=f.bot.agent.state.savePersona({name:'其他角色',prompt:'不应进入本次总结的陌生角色'});f.bot.store.db.prepare('INSERT INTO agent_sessions VALUES (?,?)').run('10000:private:10002',other.id);
  await f.bot.livingMemory.summarize(f.ctx,new AbortController().signal,{force:true});
  const system=f.requests[0].messages[0].content;assert.ok(system.includes(f.bot.config.ai.systemPrompt));assert.ok(system.includes(f.role.prompt));assert.ok(system.indexOf(f.role.prompt)<system.indexOf('本轮任务是以当前角色'));assert.doesNotMatch(system,/陌生角色/);
  assert.equal(f.bot.livingMemory.rows(f.ctx)[0].persona,f.role.id);
});
test('editing the same persona while a summary is running keeps buffers and rejects the old result',async t=>{
  const f=await setup(t,{persona:true,delayed:true}),task=f.bot.livingMemory.summarize(f.ctx,new AbortController().signal,{force:true});await f.seen;
  f.bot.agent.state.savePersona({...f.role,prompt:'同一个人格的新设定'});f.release();await task;
  assert.equal(f.bot.livingMemory.rows(f.ctx).length,0);assert.equal(f.bot.livingMemory.turns(f.ctx).length,2);
});
test('changing the default system prompt during a summary prevents stale results from committing',async t=>{
  const f=await setup(t,{delayed:true}),task=f.bot.livingMemory.summarize(f.ctx,new AbortController().signal,{force:true});await f.seen;
  f.bot.config.ai.systemPrompt='新的默认角色';f.release();await task;assert.equal(f.bot.livingMemory.rows(f.ctx).length,0);assert.equal(f.bot.livingMemory.turns(f.ctx).length,2);
});
