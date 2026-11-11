import test from 'node:test';
import assert from 'node:assert/strict';
import {app,config,temp,cleanup,waitFor,incoming} from './helpers.mjs';
import {Store} from '../src/store.mjs';
import {ComfyService,basicWorkflow,expandRequests} from '../../../plugins/comfyui/service.mjs';
import {comfyConfig,comfyTools} from '../../../plugins/comfyui/config.mjs';
import {AIClient} from '../src/ai.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {validateSchema} from '../src/agent/schema.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const info={CheckpointLoaderSimple:{input:{required:{ckpt_name:[['fixture.safetensors']]}}}};
const event={post_type:'message',self_id:0,user_id:0,message_type:'private'};
async function fixture(t,options={}){
  const directory=await temp(t),store=new Store(':memory:');cleanup(t,()=>store.close());
  const plugin={id:'batch',revision:1,enabled:true,config:comfyConfig(options)},service=new ComfyService({store,config:config(directory),plugins:{find:()=>plugin.enabled?plugin:null}});
  const bodies=[],byId=new Map();let held,release;
  const blocker=new Promise(resolve=>{release=resolve;});
  service.fetcher=async(url,init={})=>{
    if(url.endsWith('/object_info'))return Response.json(info);
    if(url.endsWith('/prompt')){const body=JSON.parse(init.body);bodies.push(body);if(service.rejectAt===bodies.length)return Response.json({error:'fixture rejection'},{status:400});if(service.lostAt===bodies.length)throw Error('connection reset');byId.set(body.prompt_id,body);return Response.json({prompt_id:body.prompt_id});}
    if(url.includes('/history/')){
      const id=decodeURIComponent(url.split('/').at(-1));if(service.holdFirst&&id===bodies[0]?.prompt_id){held=true;await blocker;}
      assert.ok(byId.has(id));const images=Array.from({length:service.outputCount||1},(_,index)=>({filename:id+'-'+index+'.png',type:'output',subfolder:''}));
      return Response.json({[id]:{status:{completed:true,status_str:'success'},outputs:{a:{images},b:{images:service.duplicateOutputs?images:[]}}}});
    }
    if(url.includes('/view?')){if(service.failedDownload&&url.includes('-1.png'))return new Response('',{status:500});return new Response(png,{headers:{'content-type':'image/png'}});}
    throw Error('Unexpected URL');
  };
  cleanup(t,()=>release());
  const invoke=(args,id=1,signal)=>service.tools(event,{id,channel:'web'}).find(t=>t.name==='comfyui_generate').invoke(args,signal);
  return {service,store,plugin,bodies,invoke,release,held:()=>held};
}

test('batch schema, argument expansion and limits preserve workflow defaults and use distinct seeded variants',()=>{
  comfyTools.forEach(t=>validateSchema(t.parameters));
  const tasks=expandRequests({prompt:'cat',count:3,seed:0},comfyConfig());assert.deepEqual(tasks.map(t=>t.args.seed),[0,1,2]);
  assert.throws(()=>expandRequests({prompt:'cat',requests:[{prompt:'dog'}]},comfyConfig()),/二选一/);
  assert.throws(()=>expandRequests({prompt:'cat',count:3},comfyConfig({max_tasks:2})),/最多 2/);
});

test('same-prompt count submits separate serial workflows and returns every generated image with durable de-duplication',async t=>{
  const f=await fixture(t),tool=f.service.tools(event,{id:1,channel:'web'}).find(t=>t.name==='comfyui_generate'),state=new AgentState(f.store),args={prompt:'cat',count:3,seed:123};
  const result=await state.invoke({id:1},tool,args);assert.equal(result.result.ok,true);assert.equal(result.result.images,3);assert.equal(f.bodies.length,3);
  assert.deepEqual(f.bodies.map(b=>b.prompt['3'].inputs.seed),[123,124,125]);assert.equal(f.service.images(1).length,3);
  const messages=await f.service.messageForJob({id:1,reply:result.reply});assert.equal(messages.filter(s=>s.type==='image').length,3);
  assert.ok(messages.filter(s=>s.type==='image').every(s=>s.data.file.includes('comfyui-images')));
  assert.deepEqual(await state.invoke({id:1},tool,args),result);assert.equal(f.bodies.length,3);
});

test('different prompts share root defaults, override individual parameters and preflight all work before submitting',async t=>{
  const f=await fixture(t);
  const result=await f.invoke({width:768,requests:[{prompt:'cat',cfg:1.1},{prompt:'dog',count:2,steps:12,seed:8}]});
  assert.equal(result.result.images,3);assert.deepEqual(f.bodies.map(b=>b.prompt['6'].inputs.text),['cat','dog','dog']);
  assert.ok(f.bodies.every(b=>b.prompt['5'].inputs.width===768));assert.equal(f.bodies[0].prompt['3'].inputs.cfg,1.1);assert.equal(f.bodies[1].prompt['3'].inputs.cfg,7);
  const before=f.bodies.length;const failed=await f.invoke({requests:[{prompt:'cat'},{prompt:'dog',use_workflow:true}]},2);assert.equal(failed.result.ok,false);assert.equal(f.bodies.length,before);
});

test('native multi-image outputs are all returned, duplicate artifact references are skipped and the output cap is explicit',async t=>{
  const f=await fixture(t,{max_images:2});f.service.outputCount=3;f.service.duplicateOutputs=true;
  const result=await f.invoke({prompt:'cat'});assert.equal(result.result.images,2);assert.equal(f.service.images(1).length,2);assert.match(result.reply,/额外图片/);assert.equal(f.bodies.length,1);
});

test('concurrent conversations wait in FIFO order and a full queue never submits an extra workflow',async t=>{
  const f=await fixture(t,{max_queue:1});f.service.holdFirst=true;
  const first=f.invoke({prompt:'first'},1);await waitFor(f.held);
  const second=f.invoke({prompt:'second'},2);await waitFor(()=>f.service.progress(2)?.queue_position===1);
  const third=await f.invoke({prompt:'third'},3);assert.equal(third.result.ok,false);assert.match(third.reply,/队列已满/);assert.equal(f.bodies.length,1);
  f.service.holdFirst=false;f.release();assert.equal((await first).result.ok,true);assert.equal((await second).result.ok,true);
  assert.deepEqual(f.bodies.map(b=>b.prompt['6'].inputs.text),['first','second']);assert.equal(f.service.running,null);assert.equal(f.service.waiters.length,0);
});

test('cancelling a waiting conversation removes it without affecting the active job or submitting it',async t=>{
  const f=await fixture(t);f.service.holdFirst=true;
  const first=f.invoke({prompt:'first'},1);await waitFor(f.held);const controller=new AbortController();
  const second=f.invoke({prompt:'second'},2,controller.signal);await waitFor(()=>f.service.progress(2)?.queue_position===1);controller.abort();
  const cancelled=await second;assert.equal(cancelled.result.ok,false);assert.equal(f.service.items(2)[0].state,'cancelled');assert.equal(f.service.waiters.length,0);
  f.service.holdFirst=false;f.release();assert.equal((await first).result.ok,true);assert.equal(f.bodies.length,1);
});

test('a known validation rejection allows other items, while an unknown submission stops all later work and preserves earlier pictures',async t=>{
  for(const unknown of [false,true]){
    const f=await fixture(t);f.service[unknown?'lostAt':'rejectAt']=2;
    const result=await f.invoke({prompt:'cat',count:3});assert.equal(result.result.state,'partial');assert.equal(result.result.ok,false);assert.equal(result.result.images,unknown?1:2);assert.equal(f.bodies.length,unknown?2:3);
    if(unknown){assert.equal(result.result.uncertain,true);assert.equal(f.service.items(1)[2].state,'cancelled');}
    assert.equal((await f.service.messageForJob({id:1,reply:result.reply})).filter(s=>s.type==='image').length,unknown?1:2);
    await f.invoke({prompt:'cat',count:3});assert.equal(f.bodies.length,unknown?2:3);
  }
});

test('a later download failure retains the earlier image instead of reporting that no images exist',async t=>{
  const f=await fixture(t);f.service.outputCount=2;f.service.failedDownload=true;
  const result=await f.invoke({prompt:'cat'});assert.equal(result.result.state,'partial');assert.equal(result.result.images,1);assert.equal(f.service.images(1).length,1);assert.match(result.reply,/下载失败/);
});

test('restart preserves old single-image records and never silently replays queued or uncertain batch work',async t=>{
  const f=await fixture(t);await f.invoke({prompt:'cat'},1);
  f.store.db.prepare("INSERT INTO comfyui_generations(job_id,plugin_id,prompt_id,base_url,state,created_at) VALUES (2,'batch','queued','http://localhost','queued',0)").run();
  f.store.db.prepare("INSERT INTO comfyui_generation_items(job_id,item_index,prompt_id,state) VALUES (2,0,'queued','queued')").run();
  const restarted=new ComfyService({store:f.store,plugins:{find:()=>f.plugin},config:f.service.config,fetcher:()=>assert.fail('must not submit on startup')});
  assert.equal(restarted.plan(1).state,'ready');assert.equal(restarted.images(1).length,1);assert.equal(restarted.items(2)[0].state,'cancelled');
  assert.equal((await restarted.generate({prompt:'cat'},f.plugin.config,f.plugin,event,{id:2})).result.ok,false);
});

test('QQ receives all images from a batch and web chat exposes batch progress and numbered previews',async t=>{
  const model=new AIClient({maxReplyChars:2000});model.completion=async()=>({tool_calls:[{id:'batch',type:'function',function:{name:'comfyui_generate',arguments:JSON.stringify({requests:[{prompt:'cat'},{prompt:'dog'}]})}}]});
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'},{ai:model});let p=await bot.plugins.install({kind:'comfyui'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
  const f=await fixture(t);bot.agent.comfyui.fetcher=f.service.fetcher;const sent=[];bot.adapter.on('outgoing',e=>sent.push(e));
  bot.adapter.driver.inject(incoming(77501,{message:'画猫和狗'}));await waitFor(()=>bot.store.list().some(j=>j.status==='done'));
  assert.equal(sent.flatMap(e=>e.message).filter(s=>s.type==='image').length,2);
  const queued=bot.agent.chat({text:'画猫和狗'});await waitFor(()=>bot.store.get(queued.job_id)?.status==='done');const job=bot.agent.chatHistory(queued.session).jobs[0];
  assert.equal(job.generation.completed,2);assert.equal(job.generated_images.length,2);assert.notEqual(job.generated_images[0].name,job.generated_images[1].name);
});

test('large multi-prompt argument payloads fit the batch tool without relaxing other tools',async()=>{
  const ai=new AIClient({maxReplyChars:2000}),args={requests:Array.from({length:8},()=>({prompt:'a'.repeat(6000),negative_prompt:'b'.repeat(3000)}))};let invocations=0;
  ai.completion=async()=>({tool_calls:[{id:'large',type:'function',function:{name:'comfyui_generate',arguments:JSON.stringify(args)}}]});
  assert.equal(await ai.reply('generate',[],undefined,{tools:[{type:'function',function:comfyTools[1]}],invokeTool:async()=>{invocations++;return {finish:true,reply:'batch submitted'};}}),'batch submitted');assert.equal(invocations,1);
  ai.completion=async()=>({tool_calls:[{id:'other',type:'function',function:{name:'other_tool',arguments:JSON.stringify({text:'a'.repeat(9000)})}}]});
  await assert.rejects(ai.reply('other',[],undefined,{tools:[{type:'function',function:{name:'other_tool'}}],invokeTool:()=>assert.fail('oversized unrelated tool must not run')}));
});

test('QQ splits a large batch by media size and retries only a definitely unsent part',async t=>{
  const f=await fixture(t);await f.invoke({prompt:'cat',count:3});f.service.config.media={maxBytes:png.length*2};
  const job={id:1,reply:'Three pictures'},message=await f.service.messageForJob(job),sent=[];let calls=0;
  const send=async segments=>{calls++;if(calls===2)throw Object.assign(Error('not submitted'),{code:1502,retryable:true,uncertain:false});sent.push(segments);return {message_id:calls};};
  await assert.rejects(f.service.sendForJob(job,message,send),/not submitted/);
  assert.equal(sent[0].filter(s=>s.type==='image').length,2);
  await f.service.sendForJob(job,message,send);assert.equal(calls,3);assert.equal(sent.length,2);
  assert.equal(sent[1].filter(s=>s.type==='image').length,1);assert.equal(sent[1].filter(s=>s.type==='text').length,0);
  await f.service.sendForJob(job,message,()=>assert.fail('already sent'));assert.equal(calls,3);
});

test('unknown QQ image delivery and restart prevent resending any acknowledged or ambiguous part',async t=>{
  const f=await fixture(t);await f.invoke({prompt:'cat',count:2});f.service.config.media={maxBytes:png.length};
  const job={id:1,reply:'Pictures'},message=await f.service.messageForJob(job);let calls=0;
  await assert.rejects(f.service.sendForJob(job,message,async()=>{if(++calls===2)throw Object.assign(Error('ack lost'),{code:1501,uncertain:true});return {message_id:1};}),/ack lost/);
  await assert.rejects(f.service.sendForJob(job,message,()=>assert.fail('ambiguous part must not replay')),e=>e.uncertain===true);
  f.store.db.prepare("UPDATE comfyui_deliveries SET state='sending' WHERE part_index=1").run();
  const restarted=new ComfyService({store:f.store,plugins:{find:()=>f.plugin},config:f.service.config});
  await assert.rejects(restarted.sendForJob(job,message,()=>assert.fail('restart must not replay')),e=>e.uncertain===true);
});
