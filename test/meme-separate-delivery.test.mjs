import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {ReplyWorker} from '../src/worker.mjs';
import {MemeService,memePluginTemplate} from '../../../plugins/memes/service.mjs';
import {BotError} from '../src/errors.mjs';
import {temp,cleanup,config} from './helpers.mjs';
import {png} from './image-fixture.mjs';

async function fixture(t,{group=false,imageOnly=false}={}){
  const directory=await temp(t),cfg=config(directory,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',AI_ALLOWED_GROUPS:'20001',AI_GROUP_REQUIRE_AT:'false'});
  const f={calls:[],delivered:[],config:cfg,caption:'前半段。后半段。',event:{post_type:'message',self_id:10000,user_id:10001,message_id:99,message_type:group?'group':'private',...(group?{group_id:20001}:{}),message:imageOnly?'发个表情包':'今天真开心'}};
  const adapter={status:()=>({online:true}),async action(name,params){const call={name,...structuredClone(params)};f.calls.push(call);const error=f.fail?.(call);if(error)throw error;f.delivered.push(call);return {message_id:f.calls.length};}};
  const open=()=>{
    f.store=new Store(join(directory,'bot.sqlite'));f.store.recover();
    f.memes=new MemeService({store:f.store,adapter,config:cfg,log:()=>{}});f.memes.pluginFor=()=>({...memePluginTemplate,enabled:true});
    f.worker=new ReplyWorker({store:f.store,adapter,config:cfg,memes:f.memes,ai:{reply:async()=>{throw Error('Unexpected regeneration');}},log:()=>{}});
  };
  const close=async()=>{await f.worker.close();await f.memes.close();f.store.close();};open();cleanup(t,close);f.restart=async()=>{await close();open();};
  const uploaded=await f.memes.upload({data:'base64://'+png().toString('base64'),name:'测试表情',category:'happy'});f.imageId=uploaded.image.id;
  const job=f.store.ingest(f.event,'今天真开心',100),reply=f.memes.planReply(f.caption+'[[表情:开心]]',f.event,job.id);f.jobId=job.id;f.store.update(job.id,'ready',{reply});
  f.retry=async()=>{f.store.db.prepare('UPDATE jobs SET next_at=0 WHERE id=?').run(f.jobId);await f.worker.step();};return f;
}

test('private and group captions precede a pure image, and explicit meme requests send only that image',async t=>{
  for(const group of [false,true])for(const imageOnly of [false,true]){
    const f=await fixture(t,{group,imageOnly});await f.worker.step();
    assert.equal(f.store.get(f.jobId).status,'done');assert.equal(f.delivered.length,imageOnly?1:2);
    const image=f.delivered.at(-1);assert.deepEqual(image.message.map(s=>s.type),['image']);assert.equal(image.name,group?'send_group_msg':'send_private_msg');
    assert.equal(group?image.group_id:image.user_id,group?20001:10001);
    if(!imageOnly){const text=f.delivered[0].message;assert.ok(text.some(s=>s.type==='reply'));assert.equal(text.some(s=>s.type==='at'),group);assert.equal(text.filter(s=>s.type==='text').map(s=>s.data.text).join('').trim(),f.caption);assert.equal(text.some(s=>s.type==='image'),false);}
    assert.equal(f.store.history(f.store.get(f.jobId).conversation,10).at(-1).content,imageOnly?'[表情]':f.caption);
  }
});

test('a known image failure retries the same picture without repeating its confirmed caption, including after restart',async t=>{
  for(const restart of [false,true]){
    const f=await fixture(t);let imageCalls=0;f.fail=call=>call.message.some(s=>s.type==='image')&&++imageCalls===1?new BotError('Known not submitted',1500,{retryable:true}):null;
    await f.worker.step();assert.equal(f.store.get(f.jobId).status,'ready');assert.equal(f.delivered.length,1);assert.equal(f.store.streamedPrefix(f.jobId),f.caption);
    if(restart)await f.restart();await f.retry();
    assert.equal(f.store.get(f.jobId).status,'done');assert.equal(f.delivered.length,2);assert.deepEqual(f.delivered.at(-1).message.map(s=>s.type),['image']);
    const images=f.calls.filter(c=>c.message.some(s=>s.type==='image'));assert.equal(images.length,2);assert.deepEqual(images[0].message,images[1].message);assert.equal(f.memes.image(f.imageId).picks,1);
  }
});

test('unknown text or image delivery is retained for review without automatically resending either message',async t=>{
  for(const image of [false,true]){
    const f=await fixture(t);f.fail=call=>call.message.some(s=>s.type==='image')===image?new BotError('Unknown outcome',1502,{retryable:true,uncertain:true}):null;
    await f.worker.step();assert.equal(f.store.get(f.jobId).status,'uncertain');const count=f.calls.length;await f.worker.step();assert.equal(f.calls.length,count);
    assert.equal(f.delivered.length,image?1:0);assert.equal(f.store.streamedPrefix(f.jobId),image?f.caption:'');assert.equal(f.calls.some(c=>c.message.some(s=>s.type==='image')),image);
  }
});

test('confirmed streamed text is skipped and only its remaining tail precedes the separate picture',async t=>{
  const f=await fixture(t),part=f.store.beginStreamPart(f.jobId,'前半段。');f.store.endStreamPart(f.jobId,part,'sent',98);
  await f.worker.step();assert.equal(f.store.get(f.jobId).status,'done');assert.equal(f.delivered.length,2);
  assert.equal(f.delivered[0].message.filter(s=>s.type==='text').map(s=>s.data.text).join(''),'后半段。');assert.deepEqual(f.delivered[1].message.map(s=>s.type),['image']);assert.equal(f.store.streamedPrefix(f.jobId),f.caption);
});
