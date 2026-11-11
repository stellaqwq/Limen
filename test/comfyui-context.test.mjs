import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadImage} from '@napi-rs/canvas';
import {app,incoming,waitFor,cleanup} from './helpers.mjs';
import {png} from './image-fixture.mjs';
import {AIClient} from '../src/ai.mjs';
import {createApp} from '../src/app.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'};
const generate=(count=1)=>({tool_calls:[{id:'generated',type:'function',function:{name:'comfyui_generate',arguments:JSON.stringify({prompt:'fixture landscape',count})}}]});
const pictures=messages=>messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'):[]);
async function install(bot){let p=await bot.plugins.install({kind:'comfyui'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}
function comfy(bot,bytes=png(960,320)){
  let submissions=0;const ids=new Set();
  bot.agent.comfyui.fetcher=async(url,init={})=>{
    if(url.endsWith('/object_info'))return Response.json({CheckpointLoaderSimple:{input:{required:{ckpt_name:[['fixture.safetensors']]}}}});
    if(url.endsWith('/prompt')){submissions++;const {prompt_id}=JSON.parse(init.body);ids.add(prompt_id);return Response.json({prompt_id});}
    if(url.includes('/history/')){const id=url.split('/').at(-1);assert.ok(ids.has(id));return Response.json({[id]:{status:{completed:true},outputs:{9:{images:[{filename:id+'.png',type:'output'}]}}}});}
    if(url.includes('/view?'))return new Response(bytes,{headers:{'content-type':'image/png'}});
    throw Error('Unexpected ComfyUI request');
  };
  return ()=>submissions;
}
async function chat(bot,text,session){const queued=bot.agent.chat({text,session});await waitFor(()=>['done','failed'].includes(bot.store.get(queued.job_id)?.status));return {...queued,...bot.store.get(queued.job_id)};}

test('generated pictures reach the review model and subsequent turns, survive restart and stay inside their conversation',async t=>{
  const model=new AIClient({maxReplyChars:2000});let calls=0,review;
  model.completion=async(messages,signal,tools,choice)=>{
    calls++;if(calls===1)return generate(2);
    if(calls===2){assert.equal(choice,'none');assert.equal(tools,undefined);assert.equal(pictures(messages).length,2);review=structuredClone(messages);return {content:'两张都是横向构图。'};}
    assert.equal(pictures(messages).length,calls===3?2:0);return {content:'后续回答'};
  };
  const bot=await app(t,env,{ai:model});await install(bot);const submitted=comfy(bot),job=await chat(bot,'画两张风景');
  assert.equal(job.status,'done');assert.match(job.reply,/两张都是横向构图/);assert.equal(submitted(),2);
  const image=await loadImage(Buffer.from(pictures(review)[0].image_url.url.split(',')[1],'base64'));assert.equal(image.width,768);assert.equal(image.height,256);
  const files=JSON.parse(bot.agent.comfyui.plan(job.id).files);assert.deepEqual(await readFile(join(bot.config.dataDir,'comfyui-images',files[0].file)),png(960,320));
  assert.equal(pictures(bot.store.history('web:'+job.session,-1)).length,2);
  const receipts=bot.store.db.prepare("SELECT result FROM agent_receipts WHERE name='comfyui_generate'").all();assert.equal(receipts.length,1);assert.doesNotMatch(receipts[0].result,/base64/);
  const config=bot.config;await bot.close();const restarted=await createApp(config,{ai:model,log:()=>{}});cleanup(t,()=>restarted.close());
  await chat(restarted,'第二张是什么构图？',job.session);await chat(restarted,'一个无关的新会话');
  assert.equal(calls,4);assert.equal(pictures(restarted.store.history('web:'+job.session,-1)).length,2);
  restarted.store.clearConversationContext('web:'+job.session);assert.deepEqual(restarted.store.history('web:'+job.session,-1),[]);
});

test('QQ receives generated images when vision is disabled and no review request is made',async t=>{
  const model=new AIClient({maxReplyChars:2000});let calls=0;model.completion=async()=>{calls++;return generate();};
  const bot=await app(t,{...env,AI_VISION_ENABLED:'false'},{ai:model});await install(bot);comfy(bot);const sent=[];bot.adapter.on('outgoing',e=>sent.push(e));
  bot.adapter.driver.inject(incoming(88901,{message:'画风景'}));await waitFor(()=>bot.store.summary().done===1);
  assert.equal(calls,1);assert.equal(sent.flatMap(e=>e.message).filter(s=>s.type==='image').length,1);assert.equal(pictures(bot.store.history('10000:private:10001',-1)).length,0);
});

test('a rejected vision request preserves generated pictures and removes unsupported visual parts from later history',async t=>{
  const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);requests.push(request);res.setHeader('Content-Type','application/json');
    if(pictures(request.messages).length){res.statusCode=400;res.end(JSON.stringify({error:'images unsupported'}));return;}
    res.end(JSON.stringify({choices:[{message:requests.length===1?generate():{content:'普通文字回答'},finish_reason:requests.length===1?'tool_calls':'stop'}]}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>server.close(resolve)));
  const bot=await app(t,{...env,AI_BASE_URL:'http://127.0.0.1:'+server.address().port});await install(bot);const submitted=comfy(bot),job=await chat(bot,'画风景');
  assert.equal(job.status,'done');assert.match(job.reply,/未能完成图片回看/);assert.equal(bot.agent.comfyui.images(job.id).length,1);assert.equal(submitted(),1);
  assert.equal(pictures(bot.store.history('web:'+job.session,-1)).length,0);await chat(bot,'继续普通聊天',job.session);
  assert.equal(requests.length,3);assert.equal(pictures(requests[2].messages).length,0);assert.equal(submitted(),1);
});

test('completed pictures remain deliverable when review fails, tries another tool, or runs out of model steps',async t=>{
  for(const mode of ['unavailable','another_tool','budget']){
    const model=new AIClient({maxReplyChars:2000});let calls=0;model.completion=async()=>{if(++calls===1)return generate();if(mode==='unavailable')throw Error('provider unavailable');return generate();};
    const bot=await app(t,{...env,...(mode==='budget'?{AGENT_MAX_STEPS:'1'}:{})},{ai:model});await install(bot);const submitted=comfy(bot),job=await chat(bot,'画风景');
    assert.equal(job.status,'done',mode);assert.match(job.reply,/未完成图片回看|未能完成图片回看/);assert.equal(submitted(),1);assert.equal(bot.agent.comfyui.images(job.id).length,1);
    assert.equal(pictures(bot.store.history('web:'+job.session,-1)).length,1);assert.equal(calls,mode==='budget'?1:2);
  }
});

test('context includes all sixteen numbered previews when the administrator raises the batch limits',async t=>{
  const model=new AIClient({maxReplyChars:2000});let calls=0;model.completion=async messages=>{if(++calls===1)return generate(16);assert.equal(pictures(messages).length,16);return {content:'已看到全部16张图片。'};};
  const bot=await app(t,env,{ai:model});let p=await install(bot);await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,max_tasks:16,max_images:16}}});
  const submitted=comfy(bot,png()),job=await chat(bot,'生成16张');assert.equal(job.status,'done');assert.equal(submitted(),16);assert.match(job.reply,/已看到全部16张图片/);
});
