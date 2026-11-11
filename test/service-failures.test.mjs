import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {AIClient,describeAIFailure} from '../src/ai.mjs';
import {createLoginServer} from '../src/web/login-server.mjs';
import {formatJobDetail} from '../src/web/job-detail.mjs';
import {config,temp,cleanup,app,waitFor,request} from './helpers.mjs';

const query={type:'function',function:{name:'current_time',parameters:{type:'object',properties:{},additionalProperties:false}}};
const call=()=>({tool_calls:[{id:'clock',type:'function',function:{name:'current_time',arguments:'{}'}}]});

test('workspace returns failed job details as data and still rejects real backend errors',async t=>{
  const backend=createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/admin/jobs/1'){res.end(JSON.stringify({id:1,status:'failed',reason:'ai_generation_failed',agent_steps:[{name:'computer_run_command'}]}));return;}
    if(req.url==='/admin/jobs/2'){res.end(JSON.stringify({status:'failed',retcode:1500,message:'fixture backend error'}));return;}
    res.writeHead(404);res.end(JSON.stringify({message:'fixture missing job'}));
  });await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>backend.close(resolve)));
  const web=await createLoginServer({backend:'http://127.0.0.1:'+backend.address().port,token:'fixture-admin'});cleanup(t,()=>web.close());
  const failed=await fetch(web.url+'/job?id=1');assert.equal(failed.status,200);assert.equal((await failed.json()).status,'failed');
  const actualError=await fetch(web.url+'/job?id=2');assert.equal(actualError.status,502);assert.equal((await actualError.json()).message,'fixture backend error');
  assert.equal((await fetch(web.url+'/job?id=3')).status,502);
});

test('last permitted model request summarizes completed tools without expanding either execution limit',async()=>{
  for(const stream of [false,true]){
    const model=new AIClient(config('unused').ai),requests=[],deltas=[];let calls=0;
    model.completion=async(messages,signal,tools,choice)=>{
      requests.push({messages,tools,choice});
      if(requests.length<3)return call();
      assert.equal(tools,undefined);assert.equal(choice,'none');assert.match(messages[0].content,/尚未完成/);
      assert.equal(messages.filter(m=>m.role==='tool').length,2);return {content:'已完成两次查询，其余查询尚未执行。'};
    };
    const reply=await model.reply('查询很多次',[],undefined,{tools:[query],maxSteps:3,maxToolCalls:10,finalReplyOnLimit:true,invokeTool:async()=>{calls++;return {result:{time:'fixture'}};},...(stream?{onDelta:(delta)=>deltas.push(delta)}:{})});
    assert.equal(calls,2);assert.equal(requests.length,3);assert.match(reply,/已停止新增操作/);assert.match(reply,/尚未执行/);if(stream)assert.equal(deltas.join(''),reply);
  }
});

test('tool budget exhaustion reserves a reply and an invalid summary tool call cannot perform extra actions',async()=>{
  const model=new AIClient(config('unused').ai);let calls=0,steps=0;
  model.completion=async(_m,_s,tools)=>{steps++;return tools?call():{content:'执行上限内完成一次查询。'};};
  await model.reply('查询',[],undefined,{tools:[query],maxSteps:8,maxToolCalls:1,finalReplyOnLimit:true,invokeTool:async()=>{calls++;return {result:{ok:true}};}});
  assert.equal(calls,1);assert.equal(steps,2);
  model.completion=async()=>call();calls=0;
  await assert.rejects(model.reply('查询',[],undefined,{tools:[query],maxSteps:2,finalReplyOnLimit:true,invokeTool:async()=>{calls++;return {result:{ok:true}};}}),e=>describeAIFailure(e).reason==='ai_tool_limit');assert.equal(calls,1);
});

test('Agent uses its last request for a reply and model tool-limit failures have an actionable stored reason',async t=>{
  const cfg=config('unused').ai,model=new AIClient(cfg);let steps=0;
  model.completion=async(_m,_s,tools)=>{steps++;return tools?call():{content:'已查询一次时间，任务尚未全部完成。'};};
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',AGENT_MAX_STEPS:'2'},{ai:model});
  const queued=bot.agent.chat({text:'查询时间'});await waitFor(()=>bot.store.get(queued.job_id)?.status==='done');assert.equal(steps,2);assert.match(bot.store.get(queued.job_id).reply,/已停止新增操作/);
  model.completion=async()=>({tool_calls:Array.from({length:5},(_,i)=>({...call().tool_calls[0],id:'call'+i}))});
  const bad=bot.agent.chat({text:'查询时间'});await waitFor(()=>bot.store.get(bad.job_id)?.status==='failed');
  assert.equal(bot.store.get(bad.job_id).reason,'ai_tool_limit');
  assert.match(formatJobDetail((await request(bot,'/admin/jobs/'+bad.job_id)).data),/达到模型请求或工具调用上限/);
});
