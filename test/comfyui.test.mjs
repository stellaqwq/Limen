import test from 'node:test';
import assert from 'node:assert/strict';
import {app,incoming,waitFor} from './helpers.mjs';
import {AIClient} from '../src/ai.mjs';
import {apiWorkflow,comfyConfig} from '../../../plugins/comfyui/config.mjs';
import {basicWorkflow,applyInputs} from '../../../plugins/comfyui/service.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const info={CheckpointLoaderSimple:{input:{required:{ckpt_name:[['test.safetensors']]}}}};
const graph=()=>basicWorkflow(info,comfyConfig());
const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'};
function mock(service,{lost=false,pending=false}={}){
  const calls=[];let id;
  service.fetcher=async(url,options={})=>{
    calls.push(url);
    if(url.endsWith('/object_info'))return Response.json(info);
    if(url.endsWith('/prompt')){const body=JSON.parse(options.body);id=body.prompt_id;if(lost)throw Error('connection reset');return Response.json({prompt_id:id});}
    if(url.includes('/history/'))return Response.json(pending?{}:{[id]:{status:{completed:true,status_str:'success'},outputs:{9:{images:[{filename:'x.png',type:'output',subfolder:''}]}}}});
    if(url.includes('/view?'))return new Response(png,{headers:{'content-type':'image/png'}});
    throw Error('unexpected URL');
  };
  return calls;
}
async function install(bot){let p=await bot.plugins.install({kind:'comfyui'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}

test('API workflow validation and mappings preserve negative prompt and unrequested workflow values',()=>{
  assert.throws(()=>apiWorkflow({nodes:[],links:[]}),/API/);
  assert.throws(()=>comfyConfig({base_url:'file:///tmp'}),/HTTP/);
  const g=graph();g['6']._meta={title:'positive'};g['3'].inputs.steps=42;
  applyInputs(g,{prompt:'a cat',seed:123});
  assert.equal(g['6'].inputs.text,'a cat');assert.equal(g['7'].inputs.text,'low quality, blurry');assert.equal(g['3'].inputs.steps,42);assert.equal(g['3'].inputs.seed,123);
  assert.throws(()=>applyInputs(g,{prompt:'cat'},{prompt:['100.text']}),/映射不存在/);
});

test('ComfyUI tools obey web and QQ scope; lost submission is not resubmitted',async t=>{
  const bot=await app(t,env);await install(bot);const service=bot.agent.comfyui;
  assert.equal(service.tools({post_type:'message',message_type:'private',user_id:10002},{channel:'qq'}).length,0);
  const web={self_id:0,user_id:0,post_type:'message',message_type:'private'},job={id:999,channel:'web'};
  assert.equal(service.tools(web,job).length,2);
  const calls=mock(service,{lost:true});const tool=service.tools(web,job).find(t=>t.name==='comfyui_generate');
  const result=await tool.invoke({prompt:'a cat'});assert.equal(result.result.ok,false);assert.equal(service.plan(job.id).state,'uncertain');
  await tool.invoke({prompt:'another cat'});assert.equal(calls.filter(u=>u.endsWith('/prompt')).length,1);
});

test('QQ model generation sends a real image through queue and web generation exposes the cached image',async t=>{
  const model=new AIClient({maxReplyChars:2000});
  model.completion=async()=>({tool_calls:[{id:'image',type:'function',function:{name:'comfyui_generate',arguments:JSON.stringify({prompt:'a cat',width:256,height:256,steps:1})}}]});
  const bot=await app(t,env,{ai:model});await install(bot);const calls=mock(bot.agent.comfyui),sent=[];
  bot.adapter.on('outgoing',e=>sent.push(e));bot.adapter.driver.inject(incoming(92001,{message:'画一只猫'}));
  await waitFor(()=>bot.store.list().some(j=>j.status==='done'));
  assert.ok(sent.some(e=>e.message.some(s=>s.type==='image')));
  const web=bot.agent.chat({text:'画一只猫'});await waitFor(()=>bot.store.get(web.job_id)?.status==='done');
  const history=bot.agent.chatHistory(web.session);assert.match(history.jobs[0].generated_images[0].data,/^data:image\/png;base64,/);
  assert.equal(calls.filter(u=>u.endsWith('/prompt')).length,2);
});

test('provided workflow can be selected per call and disabling plugin cancels pending wait',async t=>{
  const bot=await app(t,env);let p=await install(bot);const g=graph();g['3'].inputs.steps=37;
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,workflow_json:JSON.stringify(g)}}});
  const service=bot.agent.comfyui,calls=mock(service,{pending:true});let submitted;
  const fetcher=service.fetcher;service.fetcher=(url,options)=>{if(url.endsWith('/prompt'))submitted=JSON.parse(options.body).prompt;return fetcher(url,options);};
  const event={self_id:0,user_id:0,post_type:'message',message_type:'private'},job={id:998,channel:'web'};
  const pending=service.tools(event,job).find(t=>t.name==='comfyui_generate').invoke({prompt:'a cat',use_workflow:true});
  await waitFor(()=>calls.some(u=>u.includes('/history/')));assert.equal(submitted['3'].inputs.steps,37);
  await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:false});
  assert.match((await pending).reply,/取消|超时/);assert.equal(calls.filter(u=>u.endsWith('/prompt')).length,1);
});
