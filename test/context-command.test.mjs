import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {app,incoming,waitFor,replyBody,cleanup} from './helpers.mjs';

const session='10000:private:10001';
const body=event=>replyBody(event.message).filter(s=>s.type==='text').map(s=>s.data.text).join('');
function seed(bot,conversation=session,turns=2){const add=bot.store.db.prepare('INSERT INTO history(conversation,role,content,created_at) VALUES (?,?,?,?)');for(let i=0;i<turns;i++){add.run(conversation,'user','问题',Date.now());add.run(conversation,'assistant','回答',Date.now());}}
async function receive(bot,id,message,extra={}){bot.adapter.driver.inject(incoming(id,{message,...extra}));return waitFor(()=>bot.store.db.prepare("SELECT * FROM jobs WHERE json_extract(event,'$.message_id')=?").get(id));}
function sent(bot){const events=[];bot.adapter.on('outgoing',e=>events.push(e));return events;}

test('/context aliases work without AI or plugins and query only the current conversation without consuming history',async t=>{
  const bot=await app(t,{AI_CONTEXT_TURNS:'4'},{ai:{reply:()=>assert.fail('query must not invoke AI')}}),events=sent(bot);
  seed(bot);seed(bot,'10000:private:10002',3);
  for(const [index,command] of ['/context','/ctx','/上下文'].entries()){
    await receive(bot,100+index,command);assert.match(body(events.at(-1)),/已用 2 \/ 4 轮，剩余 2 轮/);assert.match(body(events.at(-1)),/暂无.*token/);
  }
  assert.equal(bot.store.history(session,4).length,4);assert.equal(bot.store.history('10000:private:10002',4).length,6);
  bot.adapter.driver.inject(incoming(100,{message:'/context'}));await receive(bot,110,'/tools');assert.equal(events.length,4);assert.match(body(events.at(-1)),/\/context/);
});

test('context command remains admin-only, respects blocked group users, reports group window and preserves empty-history settings',async t=>{
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10002',AI_ALLOWED_GROUPS:'20001',AI_GROUP_REQUIRE_AT:'false',AI_CONTEXT_TURNS:'3'},
    {ai:{reply:()=>assert.fail('command must not reach AI')}}),events=sent(bot);
  bot.plugins.contextStatus.fetcher=async()=>Response.json({data:[]});seed(bot,'10000:group:20001',1);
  await receive(bot,200,'/context',{sender:{user_id:10002}});assert.match(body(events.at(-1)),/仅聊天管理员/);
  await receive(bot,201,'/上下文',{kind:'group',groupId:20001});assert.match(body(events.at(-1)),/已用 1 \/ 3 轮，剩余 2 轮/);
  assert.equal(events.at(-1).group_id,20001);assert.ok(events.at(-1).message.some(s=>s.type==='at'));
  const empty=await app(t,{AI_CONTEXT_TURNS:'0'}),emptySent=sent(empty);await receive(empty,210,'/context');assert.match(body(emptySent[0]),/当前未保留历史对话/);
});

test('real streaming usage and model metadata produce remaining tokens; reset invalidates usage and model changes cannot reuse it',async t=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture',context_window:1000}]}));return;}
    let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
    res.setHeader('Content-Type','text/event-stream');
    for(const frame of [{choices:[{index:0,delta:{content:'测试回答'}}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:100,completion_tokens:30}}])res.write('data: '+JSON.stringify(frame)+'\n\n');
    res.end('data: [DONE]\n\n');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>server.close(resolve)));
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_BASE_URL:'http://127.0.0.1:'+server.address().port+'/v1',AI_ALLOWED_USERS:'10001'}),events=sent(bot);
  await receive(bot,300,'你好');await waitFor(()=>bot.store.summary().done===1);
  assert.deepEqual(requests[0].stream_options,{include_usage:true});
  await receive(bot,301,'/context');assert.match(body(events.at(-1)),/输入 100 \/ 输出 30 token/);assert.match(body(events.at(-1)),/剩余参考：870 token（87.0%）/);assert.equal(requests.length,1);
  bot.config.ai.model='other';await receive(bot,302,'/context');assert.match(body(events.at(-1)),/暂无.*token/);bot.config.ai.model='fixture';
  await receive(bot,303,'/new');await receive(bot,304,'/context');assert.match(body(events.at(-1)),/已保存 0 轮.*不限制轮数/);assert.match(body(events.at(-1)),/暂无.*token/);
  assert.equal(bot.store.db.prepare('SELECT count(*) n FROM conversation_token_usage').get().n,0);
});

test('metadata lookup failures and partial usage never invent token capacity; in-flight jobs are identified',async t=>{
  const bot=await app(t,{AI_MODEL:'fixture'}),service=bot.plugins.contextStatus;
  let queries=0;service.fetcher=async()=>{queries++;throw Error('private credential error');};
  service.record({id:10,conversation:session},{prompt_tokens:123});
  const pending=bot.store.ingest({post_type:'message',self_id:10000,user_id:10001,message_id:399,message_type:'private',message:'待处理'},'待处理',100);
  const text=await service.report({self_id:10000,user_id:10001,message_type:'private'});
  assert.match(text,/输出 未返回/);assert.match(text,/无法计算剩余 token/);assert.match(text,/未完成任务/);assert.doesNotMatch(text,/private credential|剩余参考/);
  await service.report({self_id:10000,user_id:10001,message_type:'private'});assert.equal(queries,1);bot.store.update(pending.id,'failed');
});
