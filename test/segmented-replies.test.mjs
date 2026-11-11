import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyWorker} from '../src/worker.mjs';
import {Store} from '../src/store.mjs';
import {Settings} from '../src/settings.mjs';
import {config,withTestTimeout,app,cleanup,waitFor,temp} from './helpers.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'};
function fixture(t,{ai,environment={},group=false}){
 const store=new Store(':memory:'),cfg=config('unused',{...env,...environment}),sent=[];t.after(()=>store.close());
 const worker=new ReplyWorker({store,config:cfg,ai,log:()=>{},adapter:{status:()=>({online:true}),action:async(_name,params)=>{sent.push(params.message);return {message_id:sent.length};}}});
 worker.ingest({post_type:'message',message_type:group?'group':'private',...(group?{group_id:20001}:{}),message_id:1,self_id:10000,user_id:10001,message:'question'});
 return {worker,store,sent};
}
const text=message=>message.filter(s=>s.type==='text'&&!(message.some(s=>s.type==='at')&&s.data.text===' ')).map(s=>s.data.text).join('');

test('segmented reply switch sends short complete sentences live or buffers a single QQ reply without duplicating the tail',async t=>{
  for(const enabled of [true,false]){
    let release,observed;const held=new Promise(resolve=>{release=resolve;}),firstDelta=new Promise(resolve=>{observed=resolve;});cleanup(t,()=>release());
    const head='你好。',tail='这是后续内容。';
    const ai={async reply(_input,_history,_signal,options){await options.onDelta(head,head);observed();await held;await options.onDelta(tail,head+tail);return head+tail;}};
    const {worker,store,sent}=fixture(t,{ai,environment:{AI_SEGMENTED_REPLY_ENABLED:String(enabled)}});
    const pending=worker.step();await withTestTimeout(()=>firstDelta);assert.equal(store.get(1).status,'generating');assert.equal(sent.length,enabled?1:0);
    if(enabled)assert.equal(text(sent[0]),head);
    release();await pending;await worker.step();assert.equal(store.get(1).status,'done');assert.equal(sent.map(text).join(''),head+tail);assert.equal(sent.length,enabled?2:1);
  }
});

test('disabling platform segmentation preserves native live web output without QQ messages',async t=>{
  let release,observed;const held=new Promise(resolve=>{release=resolve;}),firstDelta=new Promise(resolve=>{observed=resolve;});cleanup(t,()=>release());
  const head='网页实时正文。';
  const bot=await app(t,{...env,AI_SEGMENTED_REPLY_ENABLED:'false'},{ai:{async reply(_input,_history,_signal,options){await options.onDelta(head,head);observed();await held;return head+'最终补充。';}}});
  const outgoing=[];bot.adapter.on('outgoing',e=>outgoing.push(e));const queued=bot.agent.chat({text:'测试网页'});
  await withTestTimeout(()=>firstDelta);assert.equal(bot.store.get(queued.job_id).reply,head);assert.equal(bot.store.get(queued.job_id).status,'generating');assert.equal(outgoing.length,0);
  release();await waitFor(()=>bot.store.get(queued.job_id)?.status==='done');assert.equal(outgoing.length,0);
});

test('segmented reply setting validates and persists independently of provider streaming',async t=>{
  assert.equal(config('unused').ai.segmentedReply,true);assert.throws(()=>config('unused',{AI_SEGMENTED_REPLY_ENABLED:'yes'}));
  const path=join(await temp(t),'.env'),cfg=config('unused',{...env,AI_STREAM_ENABLED:'true'});await writeFile(path,'AI_STREAM_ENABLED=true\nAI_SEGMENTED_REPLY_ENABLED=true\n');
  const settings=new Settings(cfg,{path}),before=await settings.snapshot();assert.equal(before.values.AI_SEGMENTED_REPLY_ENABLED,'true');
  const after=await settings.save({AI_SEGMENTED_REPLY_ENABLED:'false'},before.revision);assert.equal(after.values.AI_SEGMENTED_REPLY_ENABLED,'false');assert.equal(after.values.AI_STREAM_ENABLED,'true');
  assert.equal(config('unused',await settings.environment()).ai.segmentedReply,false);
});

test('QQ segments discard boundary whitespace and blank tails while preserving receipts and history',async t=>{
  for(const group of [false,true])for(const environment of [{},{AI_STRIP_EMOJI:'false'},{AI_SEGMENTED_REPLY_ENABLED:'false'}])for(const deltas of [
    ['第一句。','\n','  \n','第二句。','\r\n \t'],
    ['第一句。',' \n\t未带句号的尾句\n  '],
    [' \t\r\n','第一句。','\n\n第二句。','\n  '],
    ['第一句。','\n 😀 \n'],
    ['首行\n  中间行\n尾行。','\n'],
    ['甲'.repeat(40),'  \r\n','乙'.repeat(45),' \n']
  ]){
    const raw=deltas.join('');
    const ai={async reply(_input,_history,_signal,options){let accumulated='';for(const delta of deltas){accumulated+=delta;await options.onDelta(delta,accumulated);}return raw;}};
    const {worker,store,sent}=fixture(t,{ai,group,environment:{AI_STREAM_CHUNK_CHARS:'40',AI_ALLOWED_GROUPS:'20001',AI_GROUP_REQUIRE_AT:'false',...environment}});
    await worker.step();await worker.step();
    assert.equal(store.get(1).status,'done',JSON.stringify({environment,raw,job:store.get(1)}));
    for(const message of sent){const content=text(message);assert.ok(content.trim(),'blank QQ message');assert.equal(content,content.trim(),'QQ segment has boundary whitespace');}
    const expected=(environment.AI_STRIP_EMOJI==='false'?raw:raw.replace('😀','')).trimStart();
    assert.equal(sent.map(text).join('').replace(/\s/gu,''),expected.replace(/\s/gu,''),'text lost or duplicated');
    assert.equal(store.history(store.get(1).conversation,10).at(-1).content,expected);
    assert.ok(expected.startsWith(store.streamedPrefix(1)),'receipt is not an exact source prefix');
  }
});

test('trimming a meme caption preserves its raw receipt so an image retry cannot duplicate the caption',async t=>{
  const {worker,store,sent}=fixture(t,{ai:{reply:()=>assert.fail('ready job regenerated')}});
  const raw=' \n第一行\n  第二行\n ';
  store.update(1,'ready',{reply:raw});
  worker.memes={plan:()=>({image_id:'fixture'}),messageForJob:job=>[{type:'text',data:{text:job.reply}},{type:'image',data:{file:'fixture'}}],sent:()=>{}};
  const original=worker.adapter.action;let images=0;
  worker.adapter.action=async(name,params)=>{
    if(params.message.some(s=>s.type==='image')&&++images===1)throw Object.assign(Error('not submitted'),{code:1500,retryable:true});
    return original(name,params);
  };
  await worker.step();assert.equal(store.get(1).status,'ready');assert.equal(store.streamedPrefix(1),raw);
  assert.deepEqual(sent.map(text),[raw.trim()]);
  store.db.prepare('UPDATE jobs SET next_at=0 WHERE id=1').run();await worker.step();
  assert.equal(store.get(1).status,'done');assert.equal(sent.length,2);assert.deepEqual(sent[1].map(s=>s.type),['image']);
});

test('resumed QQ replies skip whitespace-only tails and trim unsent text without changing receipts',async t=>{
  for(const tail of [' \t\r\n',' \r\n未发送正文\n  ']){
    const {worker,store,sent}=fixture(t,{ai:{reply:()=>assert.fail('ready job regenerated')}});
    const prefix=' \n已发送正文。\n';const part=store.beginStreamPart(1,prefix);store.endStreamPart(1,part,'sent',10);
    store.update(1,'ready',{reply:prefix+tail});await worker.step();
    assert.equal(store.get(1).status,'done');assert.deepEqual(sent.map(text),tail.trim()?[tail.trim()]:[]);assert.equal(store.streamedPrefix(1),prefix);
  }
});

