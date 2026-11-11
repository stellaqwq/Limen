import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {app,cleanup,incoming,waitFor,temp,config} from './helpers.mjs';
import {createApp} from '../src/app.mjs';
import {Store} from '../src/store.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {AIClient} from '../src/ai.mjs';

test('unlimited history and zero-day retention preserve old turns, jobs and explicit memory across restart',async t=>{
  const directory=await temp(t),path=join(directory,'bot.sqlite');let store=new Store(path);
  const old=Date.now()-400*86400000,session='10000:private:10001';
  const env=config(directory);assert.equal(env.ai.contextTurns,-1);assert.equal(env.retentionDays,0);
  for(let n=0;n<125;n++){
    const event={self_id:10000,user_id:10001,message_type:'private',post_type:'message',message_id:n,message:'旧消息'+n};
    const {id}=store.ingest(event,event.message,1000);store.update(id,'ready',{reply:'旧回答'+n});store.finish(store.get(id),-1);
  }
  store.db.prepare('UPDATE history SET created_at=?').run(old);store.db.prepare('UPDATE jobs SET created_at=?,updated_at=?').run(old,old);
  const state=new AgentState(store);state.remember(session,'事实','需要长期保留');store.db.prepare('UPDATE agent_memories SET updated_at=?').run(old);
  store.cleanup(0);state.cleanup(0);assert.equal(store.history(session,-1).length,250);assert.equal(state.memories(session).length,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,125);store.close();
  store=new Store(path);cleanup(t,()=>store.close());assert.equal(store.history(session,-1)[0].content,'旧消息0');assert.equal(store.history(session,-1).length,250);
});

test('real QQ worker persists full SSE thoughts, tool results and untrimmed JSON responses and replays them after restart',async t=>{
  const requests=[],full='完整回答'.repeat(30),thought='先读取时间，再结合结果回答。';
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
    if(requests.length===1){
      res.setHeader('Content-Type','text/event-stream');
      for(const delta of [{reasoning_content:'先读取时间，'},{reasoning_content:'再结合结果回答。'},{tool_calls:[{index:0,id:'time_1',type:'function',function:{name:'current_time',arguments:'{}'}}]}])res.write('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\n');
      res.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
    }else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:requests.length===2?full:'下一轮回答',reasoning:'接口提供的完整思考',reasoning_details:[{type:'reasoning.text',text:'结构化思考'}]},finish_reason:'stop'}]}));}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>server.close(resolve)));
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_BASE_URL:'http://127.0.0.1:'+server.address().port,AI_ALLOWED_USERS:'10001',AI_MAX_REPLY_CHARS:'12'});
  bot.adapter.driver.inject(incoming(700,{message:'先看看时间再回答'}));await waitFor(()=>bot.store.summary().done===1);
  const session='10000:private:10001',history=bot.store.history(session,-1);
  assert.deepEqual(history.map(m=>m.role),['user','assistant','tool','assistant']);
  assert.equal(history[1].reasoning_content,thought);assert.equal(history[2].tool_call_id,'time_1');assert.equal(history[3].content,full);
  assert.equal(history[3].reasoning,'接口提供的完整思考');assert.equal(history[3].reasoning_details[0].text,'结构化思考');
  const saved=bot.store.db.prepare('SELECT * FROM model_requests ORDER BY id').all();assert.equal(saved.length,2);assert.equal(saved[0].state,'completed');
  assert.equal(JSON.parse(saved[0].request).tools.some(tool=>tool.function.name==='current_time'),true);
  assert.ok(bot.store.db.prepare('SELECT data FROM model_response_frames').all().some(row=>row.data.includes('先读取时间')));
  const cfg=bot.config;await bot.close();const restarted=await createApp(cfg,{log:()=>{}});cleanup(t,()=>restarted.close());
  restarted.adapter.driver.inject(incoming(701,{message:'接着聊'}));await waitFor(()=>restarted.store.summary().done===2);
  assert.equal(requests[2].messages[2].reasoning_content,thought);assert.equal(requests[2].messages[4].content,full);
  assert.equal(requests[2].messages[4].reasoning,'接口提供的完整思考');
  restarted.store.clearConversationContext(session);assert.deepEqual(restarted.store.history(session,-1),[]);
  assert.equal(restarted.store.db.prepare('SELECT COUNT(*) AS n FROM model_requests').get().n,3);
});

test('interrupted streams preserve received thinking in the archive without converting it into reply text',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const server=createServer((req,res)=>{req.resume();res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'中断前已经返回的思考'}}]})+'\n\n');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>server.close(resolve)));
  const cfg=config('unused',{AI_BASE_URL:'http://127.0.0.1:'+server.address().port,AI_MODEL:'fixture'});
  await assert.rejects(new AIClient(cfg.ai).reply('问题',[],undefined,{observeRequest:request=>store.observeModelRequest({id:1,conversation:'session'},request)}));
  assert.equal(store.db.prepare('SELECT state FROM model_requests').get().state,'interrupted');
  assert.ok(store.db.prepare('SELECT data FROM model_response_frames').get().data.includes('中断前已经返回的思考'));
});
