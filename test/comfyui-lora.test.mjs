import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {app,temp} from './helpers.mjs';
import {comfyConfig,comfyTools} from '../../../plugins/comfyui/config.mjs';
import {basicWorkflow,applyInputs,workflowLoras} from '../../../plugins/comfyui/service.mjs';
import {validateArguments,validateSchema} from '../src/agent/schema.mjs';
const info={CheckpointLoaderSimple:{input:{required:{ckpt_name:[['fixture.safetensors']]}}}};
const event={post_type:'message',message_type:'private',self_id:0,user_id:0};
function graph(){
  const g=basicWorkflow(info,comfyConfig());
  g['20']={class_type:'LoraLoader',inputs:{model:['4',0],clip:['4',1],lora_name:'style.safetensors',strength_model:0.75,strength_clip:1}};
  g['21']={class_type:'LoraLoader',inputs:{model:['20',0],clip:['20',1],lora_name:'style.safetensors',strength_model:0.85,strength_clip:0.9}};
  g['22']={class_type:'LoraLoaderModelOnly',inputs:{model:['21',0],lora_name:'detail.safetensors',strength_model:0.7}};
  g['3'].inputs.model=['22',0];g['6'].inputs.clip=['21',1];g['7'].inputs.clip=['21',1];return g;
}
async function setup(t,config={}){
  const bot=await app(t);let p=await bot.plugins.install({kind:'comfyui'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,use_workflow:true,workflow_json:JSON.stringify(graph()),...config},scope:{...p.scope,private_users:['10001']}}});
  await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});return bot.agent.comfyui;
}
test('LoRA overrides are advertised for single and batch calls and reject invalid strengths',()=>{
  const schema=comfyTools.find(t=>t.name==='comfyui_generate').parameters;validateSchema(schema);
  validateArguments(schema,{prompt:'cat',loras:[{node_id:'20',strength_model:0,strength_clip:-0.5}]});
  validateArguments(schema,{requests:[{prompt:'cat',loras:[{node_id:'21',strength_model:1.2}]}]});
  for(const value of [Infinity,NaN,101,-101,'0.5'])assert.throws(()=>validateArguments(schema,{prompt:'cat',loras:[{node_id:'20',strength_model:value}]}));
});
test('node identifiers distinguish repeated LoRA names and unrequested strengths and defaults are preserved',()=>{
  const g=graph(),before=structuredClone(g);applyInputs(g,{prompt:'cat',loras:[{node_id:'20',strength_model:0.3},{node_id:'21',strength_clip:0},{node_id:'22',strength_model:-0.2}]});
  assert.equal(g['20'].inputs.strength_model,0.3);assert.equal(g['20'].inputs.strength_clip,1);
  assert.equal(g['21'].inputs.strength_model,0.85);assert.equal(g['21'].inputs.strength_clip,0);
  assert.equal(g['22'].inputs.strength_model,-0.2);assert.equal(g['3'].inputs.steps,before['3'].inputs.steps);
  assert.deepEqual(g['20'].inputs.model,before['20'].inputs.model);assert.equal(g['20'].inputs.lora_name,before['20'].inputs.lora_name);
  const unchanged=graph();applyInputs(unchanged,{prompt:'cat'});assert.deepEqual(workflowLoras(unchanged),workflowLoras(before));
});
test('invalid targets, unsupported CLIP and duplicate nodes fail before mutating any LoRA',()=>{
  for(const invalid of [{node_id:'999',strength_model:0.5},{node_id:'3',strength_model:0.5},{node_id:'22',strength_clip:0.5},{node_id:'21'}]){
    const g=graph(),before=structuredClone(g);assert.throws(()=>applyInputs(g,{prompt:'cat',loras:[{node_id:'20',strength_model:0.2},invalid]}));assert.deepEqual(g,before);
  }
  assert.throws(()=>applyInputs(graph(),{prompt:'cat',loras:[{node_id:'20',strength_model:0.2},{node_id:'20',strength_model:0.4}]}),/重复/);
  assert.throws(()=>applyInputs(basicWorkflow(info,comfyConfig()),{prompt:'cat',loras:[{node_id:'20',strength_model:0.5}]}),/找不到/);
});
test('status reports actual configured LoRAs from JSON and from a workflow file',async t=>{
  const directory=await temp(t),path=join(directory,'workflow.json');await writeFile(path,JSON.stringify(graph()));
  for(const config of [{},{workflow_json:'',workflow_path:path}]){
    const service=await setup(t,config);service.fetcher=async()=>Response.json(info);
    const result=await service.tools(event,{channel:'web',id:100}).find(t=>t.name==='comfyui_status').invoke({});
    assert.equal(result.result.ok,true);assert.deepEqual(result.result.workflow_loras.map(n=>[n.node_id,n.name,n.strength_model,n.strength_clip]),[['20','style.safetensors',0.75,1],['21','style.safetensors',0.85,0.9],['22','detail.safetensors',0.7,undefined]]);
  }
});
test('batch LoRA defaults and per-request overrides reach submitted graphs without changing stored workflow',async t=>{
  const service=await setup(t),submissions=[],ids=[];
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  service.fetcher=async(url,options={})=>{
    if(url.endsWith('/prompt')){const body=JSON.parse(options.body);submissions.push(body.prompt);ids.push(body.prompt_id);return Response.json({prompt_id:body.prompt_id});}
    if(url.includes('/history/'))return Response.json(Object.fromEntries(ids.map(id=>[id,{status:{completed:true,status_str:'success'},outputs:{9:{images:[{filename:'x.png',type:'output',subfolder:''}]}}}])));
    if(url.includes('/view?'))return new Response(png,{headers:{'content-type':'image/png'}});
    throw Error('Unexpected request');
  };
  const tool=service.tools(event,{channel:'web',id:100}).find(t=>t.name==='comfyui_generate');
  const result=await tool.invoke({loras:[{node_id:'20',strength_model:0.4}],requests:[{prompt:'cat',count:2},{prompt:'dog',loras:[{node_id:'21',strength_model:0.2,strength_clip:0.8}]}]});
  assert.equal(result.result.ok,true);assert.equal(submissions.length,3);
  assert.deepEqual(submissions.map(g=>g['20'].inputs.strength_model),[0.4,0.4,0.75]);assert.deepEqual(submissions.map(g=>g['21'].inputs.strength_model),[0.85,0.85,0.2]);assert.equal(submissions[2]['21'].inputs.strength_clip,0.8);
  assert.equal(JSON.parse(service.pluginFor(event,{channel:'web'}).config.workflow_json)['20'].inputs.strength_model,0.75);
});
test('an invalid later LoRA task rejects the entire batch before any ComfyUI submission',async t=>{
  const service=await setup(t);let submitted=0;service.fetcher=async()=>{submitted++;throw Error('No submission expected');};
  const result=await service.tools(event,{channel:'web',id:101}).find(t=>t.name==='comfyui_generate').invoke({requests:[{prompt:'cat',loras:[{node_id:'20',strength_model:0.3}]},{prompt:'dog',loras:[{node_id:'missing',strength_model:0.2}]}]});
  assert.equal(result.result.ok,false);assert.equal(submitted,0);assert.match(result.reply,/LoRA/);
});
