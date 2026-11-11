import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {runProcess} from '../src/computer/process.mjs';
import {AIClient} from '../src/ai.mjs';
import {ComputerService} from '../src/computer/service.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {Store} from '../src/store.mjs';
import {formatJobDetail} from '../src/web/job-detail.mjs';
import {app,temp,config,request,waitFor,cleanup} from './helpers.mjs';

test('timed-out process preserves earlier stdout, stderr, elapsed time and a fixed reason after closing',async()=>{
  await assert.rejects(runProcess(process.execPath,['-e','process.stdout.write("partial-output");process.stderr.write("partial-error");setTimeout(()=>{},10000)'],{timeout:800}),error=>{
    assert.equal(error.processReason,'timeout');assert.equal(error.stdout,'partial-output');assert.equal(error.stderr,'partial-error');assert.ok(error.elapsed_ms>=800);assert.equal(error.timeout_ms,800);return true;
  });
});

test('uncertain command diagnostics survive receipts and repeated invocations never re-execute',async t=>{
  const directory=await temp(t),cfg=config(directory,{COMPUTER_ENABLED:'true',COMPUTER_SHELL_ENABLED:'true',COMPUTER_ROOTS:directory}),store=new Store(':memory:');cleanup(t,()=>store.close());
  let runs=0;const service=new ComputerService(cfg,store,{run:async()=>{runs++;throw Object.assign(Error('not exposed'),{processReason:'timeout',stdout:'found-file.txt',stderr:'',elapsed_ms:16000,exit_code:1});}});service.status=()=>({shell:true});
  const tool=service.tools({},{id:1,channel:'web'}).find(t=>t.name==='computer_run_command'),state=new AgentState(store),args={operation_id:'search',command:'Get-ChildItem',cwd:directory};
  const result=await state.invoke({id:1},tool,args);assert.equal(result.result.reason,'command_timeout');assert.equal(result.result.stdout,'found-file.txt');assert.equal(result.result.uncertain,true);
  assert.deepEqual(await state.invoke({id:1},tool,args),result);assert.equal(runs,1);assert.equal(store.db.prepare('SELECT state FROM agent_receipts').get().state,'uncertain');
  assert.equal(state.commandFailures(1)[0].stdout,'found-file.txt');assert.equal(state.trace(1)[0].state,'uncertain');
});

test('web job reports a PowerShell timeout instead of losing the reply and only administrator detail includes partial output',async t=>{
  const directory=await temp(t);await mkdir(join(directory,'allowed'));
  const model=new AIClient(config('unused').ai);let modelCalls=0;
  model.completion=async()=>{modelCalls++;return {tool_calls:[{id:'command',type:'function',function:{name:'computer_run_command',arguments:JSON.stringify({operation_id:'slow-search',command:'Get-ChildItem'})}}]};};
  const logs=[],bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',COMPUTER_ENABLED:'true',COMPUTER_SHELL_ENABLED:'true',COMPUTER_ROOTS:directory},{ai:model,log:(level,event,fields)=>logs.push({event,fields})});
  let runs=0;bot.agent.computer.run=async()=>{runs++;throw Object.assign(Error('private details'),{processReason:'timeout',stdout:'partial fixture output',stderr:'',elapsed_ms:15100,exit_code:1});};
  const queued=bot.agent.chat({text:'列出文件'});await waitFor(()=>bot.store.get(queued.job_id)?.status==='failed');
  const job=bot.store.get(queued.job_id);assert.equal(job.reason,'computer_command_timeout');assert.match(job.reply,/超过 15 秒/);assert.equal(runs,1);assert.equal(modelCalls,1);
  const detail=await request(bot,'/admin/jobs/'+job.id);assert.equal(detail.data.command_failures[0].stdout,'partial fixture output');assert.match(formatJobDetail(detail.data),/已保留标准输出/);
  assert.equal((await request(bot,'/admin/jobs/'+job.id,undefined,'onebot')).code,401);
  assert.ok(!JSON.stringify(logs).includes('partial fixture output'));assert.ok(!JSON.stringify(logs).includes('private details'));
});
