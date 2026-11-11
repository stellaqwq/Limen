import test from 'node:test';
import assert from 'node:assert/strict';
import {AIClient} from '../src/ai.mjs';
import {memeReplyIntent} from '../../../plugins/memes/service.mjs';
import {app,config,incoming,waitFor,replyBody} from './helpers.mjs';
import {png,gif} from './image-fixture.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001',AI_ALLOWED_GROUPS:'20001',AI_GROUP_REQUIRE_AT:'false',AI_STREAM_CHUNK_CHARS:'40'};
async function install(bot,extra={}){
  let p=await bot.plugins.install({kind:'meme-manager'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001'],groups:['20001'],require_at:false},config:{...p.config,cooldown_seconds:0,...extra}}});
  return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
}
async function voice(bot,extra={}){
  let p=await bot.plugins.install({kind:'voicestudio'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001'],groups:['20001'],require_at:false},config:{...p.config,reply_probability:1,ai_tools:false,...extra}}});
  return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
}
const upload=bot=>bot.memes.upload({data:'base64://'+png().toString('base64'),category:'happy',name:'测试表情'});
const done=(bot,id)=>waitFor(()=>bot.store.get(id)?.status==='done'&&bot.store.get(id));
const texts=sent=>sent.flatMap(e=>replyBody(e.message)).filter(s=>s.type==='text').map(s=>s.data.text).join('');

test('meme intent distinguishes direct image requests from refusals, quotations, capability questions and implementation discussion',()=>{
  for(const text of ['发个表情包','给我发张可爱的表情包','请发一个开心的表情包吧','你能不能发个表情包？','来一个 meme','再发个表情包','发一个表情','请发个开心的表情给我','再来一张表情图'])assert.equal(memeReplyIntent(text),true,text);
  for(const text of ['不要发表情包','请别发表情包','你会发表情包吗','你是不是只能发文字','教我怎么发表情包','发个表情包的代码怎么写','“发个表情包”这句话','今天开心','只用语音回复','发一个表情的代码怎么写','你会发表情吗','用语音读：发一个表情'])assert.equal(memeReplyIntent(text),false,text);
});

test('meme image commands send a pure image without quote or mention in private and group chats',async t=>{
  for(const group of [false,true]){
    const bot=await app(t),sent=[];await install(bot);await upload(bot);bot.adapter.on('outgoing',e=>sent.push(e));
    bot.adapter.driver.inject(incoming(901,{...(group?{kind:'group',groupId:20001}:{}),message:'/表情 发 开心'}));
    await waitFor(()=>sent.length===1);assert.deepEqual(sent[0].message.map(s=>s.type),['image']);
  }
});

test('direct private and Chat Plus group requests require the real meme tool and send an image despite a false model caption or 100% automatic voice',async t=>{
  for(const group of [false,true]){
    let calls=0;
    class Model extends AIClient {
      constructor(){super(config('unused',env).ai);}
      async completion(messages,_signal,tools,choice){
        calls++;assert.equal(choice,'required');assert.deepEqual(tools.map(t=>t.function.name),['meme_reply']);
        assert.ok(tools[0].function.parameters.properties.category.enum.includes('happy'));assert.ok(!tools[0].function.parameters.properties.category.enum.includes('难过'));
        assert.match(messages[0].content,/真实图片/);
        return {content:'我不能发图片，只能给文字。',tool_calls:[{id:'meme',type:'function',function:{name:'meme_reply',arguments:JSON.stringify({category:group?'开心':'happy',text:'[可爱] 好呀！不过我不能真的发消息哦～只能给你发文字版的'})}}]};
      }
    }
    const bot=await app(t,env,{ai:new Model()}),sent=[];await install(bot);await voice(bot);await upload(bot);
    await bot.memes.upload({data:'base64://'+gif.toString('base64'),category:'sad',name:'未审核',status:'pending'});
    let speechCalls=0;bot.voicestudio.synthesize=async()=>{speechCalls++;throw Error('unexpected voice');};bot.adapter.on('outgoing',e=>sent.push(e));
    if(group){let p=await bot.plugins.install({kind:'group-chat-plus'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,groups:['20001']},config:{...p.config,quiet_hours_enabled:false,merge_window_ms:0,proactive_enabled:false}}});await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}
    bot.adapter.driver.inject(incoming(1,{...(group?{kind:'group',groupId:20001}:{}),message:group?[{type:'at',data:{qq:'10000'}},{type:'text',data:{text:'发一个表情'}}]:'发个表情包'}));
    const job=await done(bot,1);assert.equal(calls,1);assert.equal(speechCalls,0);assert.equal(job.reply,'[表情]');
    assert.equal(sent.length,1);assert.deepEqual(replyBody(sent[0].message).map(s=>s.type),['image']);assert.equal(bot.memes.plan(1).image_only,1);
    assert.equal(bot.voicestudio.plan(1),undefined);assert.ok(bot.agent.state.trace(1).some(step=>step.name==='meme_reply'));
    assert.equal(bot.store.history(job.conversation,10).at(-1).content,'[表情]');
  }
});

test('same-user meme follow-ups keep requiring real images after cleanup and never speak a placeholder in private or Chat Plus groups',async t=>{
  for(const group of [false,true]){
    let calls=0;
    class Model extends AIClient {
      constructor(){super(config('unused',env).ai);}
      async completion(_messages,_signal,tools,choice){
        calls++;
        // Reproduce the local model's misleading continuation when no tool is required.
        if(choice!=='required')return {content:'[表情]'};
        assert.deepEqual(tools.map(t=>t.function.name),['meme_reply']);
        return {tool_calls:[{id:'meme-'+calls,type:'function',function:{name:'meme_reply',arguments:JSON.stringify({category:'happy',text:''})}}]};
      }
    }
    const bot=await app(t,env,{ai:new Model()}),sent=[];await install(bot);await voice(bot,{ai_tools:true});await upload(bot);
    if(group){let p=await bot.plugins.install({kind:'group-chat-plus'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,groups:['20001']},config:{...p.config,quiet_hours_enabled:false,merge_window_ms:0,proactive_enabled:false}}});await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}
    let speechCalls=0;bot.voicestudio.synthesize=async()=>{speechCalls++;throw Error('unexpected voice');};bot.adapter.on('outgoing',e=>sent.push(e));
    for(const [index,text] of ['发个表情包','再发一个','换一张吧'].entries()){
      bot.adapter.driver.inject(incoming(index+1,{...(group?{kind:'group',groupId:20001}:{}),message:group?[{type:'at',data:{qq:'10000'}},{type:'text',data:{text}}]:text}));
      const job=await done(bot,index+1);assert.equal(job.reply,'[表情]');
      assert.equal(bot.memes.plan(job.id).image_only,1);assert.equal(bot.voicestudio.plan(job.id),undefined);
      bot.memes.cleanup();
    }
    assert.equal(calls,3);assert.equal(speechCalls,0);assert.equal(sent.length,3);
    assert.ok(sent.every(e=>replyBody(e.message).length===1&&replyBody(e.message)[0].type==='image'));
  }
});

test('meme follow-up recognition requires the latest confirmed picture and retained context for the same sender and account',async t=>{
  const bot=await app(t);await install(bot);await upload(bot);
  const event=(message_id,text,user_id=10001,self_id=10000)=>({self_id,user_id,group_id:20001,message_id,post_type:'message',message_type:'group',message:[{type:'text',data:{text}}]});
  function complete(e,reply,image=false){
    const job=bot.store.ingest(e,'测试',100);
    if(image)reply=bot.memes.planReply('[[表情:happy]]',e,job.id);
    bot.store.update(job.id,'ready',{reply});bot.store.finish({...bot.store.get(job.id),reply},10);return bot.store.get(job.id);
  }
  const first=complete(event(1,'发个表情包'),'[表情]',true),follow=event(2,'再发一个');
  assert.equal(bot.memes.requested(follow,first.id),false,'later pictures cannot supply context to an earlier job');
  assert.equal(bot.memes.requested(follow,first.id+1),true);
  for(const text of ['不要再发一个','再发一个语音','再发一个代码示例','“再发一个”是什么意思'])assert.equal(bot.memes.requested(event(2,text),first.id+1),false,text);
  assert.equal(bot.memes.requested(event(2,'再发一个',10002),first.id+1),false);
  assert.equal(bot.memes.requested(event(2,'再发一个',10001,10009),first.id+1),false);
  bot.store.clearConversationContext(first.conversation);
  assert.equal(bot.memes.requested(follow,first.id+1),false,'/new clears follow-up context');
  const placeholder=complete(event(3,'普通消息'),'[表情]');
  assert.equal(bot.memes.requested(event(4,'再发一个'),placeholder.id+1),false,'model text alone is not a confirmed picture');
  complete(event(5,'发个表情包'),'[表情]',true);
  const ordinary=complete(event(6,'介绍一下'),'普通文字回复');
  assert.equal(bot.memes.requested(event(7,'再发一个'),ordinary.id+1),false,'an intervening reply changes the subject');
});

test('direct requests buffer denial text instead of streaming it to QQ before the selected picture',async t=>{
  const raw='我不能真的发图片，只能提供文字版。'.repeat(10)+'[[表情:开心]]',sent=[];
  const bot=await app(t,{...env,AGENT_ENABLED:'false'},{ai:{reply:async(_input,_history,_signal,options)=>{await options.onDelta(raw,raw);assert.equal(sent.length,0);return raw;}}});
  await install(bot);await upload(bot);bot.adapter.on('outgoing',e=>sent.push(e));bot.adapter.driver.inject(incoming(1,{message:'发个表情包'}));await done(bot,1);
  assert.equal(texts(sent),'');assert.equal(replyBody(sent[0].message)[0].type,'image');
});

test('Agent meme replies deliver approved images from custom UUID categories in private and group chats',async t=>{
  for(const group of [false,true]){
    let category;
    class Model extends AIClient {
      constructor(){super(config('unused',env).ai);}
      async completion(_messages,_signal,tools,choice){
        assert.equal(choice,'required');assert.deepEqual(tools.map(t=>t.function.name),['meme_reply']);
        assert.ok(tools[0].function.parameters.properties.category.enum.includes(category.id));
        return {tool_calls:[{id:'custom-meme',type:'function',function:{name:'meme_reply',arguments:JSON.stringify({category:group?category.name:category.id,text:''})}}]};
      }
    }
    const bot=await app(t,env,{ai:new Model()}),sent=[];await install(bot);
    category=bot.memes.saveCategory({name:'调侃整活',description:'调侃、整活'});assert.equal(category.id.length,36);
    const uploaded=await bot.memes.upload({data:'base64://'+png().toString('base64'),category:category.id,name:'自建分类测试表情'});
    bot.adapter.on('outgoing',e=>sent.push(e));
    bot.adapter.driver.inject(incoming(1,{...(group?{kind:'group',groupId:20001}:{}),message:'发个表情包'}));
    const job=await done(bot,1);
    assert.equal(job.reply,'[表情]');assert.equal(bot.memes.plan(job.id).image_id,uploaded.image.id);
    assert.equal(sent.length,1);assert.deepEqual(replyBody(sent[0].message).map(s=>s.type),['image']);
    assert.equal(bot.store.history(job.conversation,10).at(-1).content,'[表情]');
  }
});

test('ordinary text with a meme keeps its caption and image ahead of automatic voice, while ordinary text-only replies still reach voice selection',async t=>{
  const caption='正常回复。'.repeat(12),sent=[];
  const bot=await app(t,env,{ai:{reply:async(input,_history,_signal,options)=>{const raw=input==='普通文本消息'?'普通文本回复':caption+'[[表情:开心]]';await options.onDelta(raw,raw);return raw;}}});
  await install(bot);await voice(bot);await upload(bot);let speechCalls=0;bot.voicestudio.synthesize=async()=>{speechCalls++;throw Error('fixture TTS failure');};bot.adapter.on('outgoing',e=>sent.push(e));
  bot.adapter.driver.inject(incoming(1,{message:'今天真开心'}));await done(bot,1);assert.equal(speechCalls,0);assert.equal(texts(sent),caption);assert.ok(sent.some(e=>e.message.some(s=>s.type==='image')));
  assert.ok(sent.filter(e=>e.message.some(s=>s.type==='image')).every(e=>e.message.length===1));
  bot.adapter.driver.inject(incoming(2,{message:'普通文本消息'}));await done(bot,2);assert.equal(speechCalls,1);
});

test('ordinary Chat Plus replies turn split bracket variants into one image with an intact caption with or without automatic voice',async t=>{
  for(const automaticVoice of [false,true])for(const format of ['[[开心]]','[表情:开心]','【表情：开心】','［表情:开心］','[表情:custom]']){
    let marker=format;
    const caption='三无又怎样，本鱼的饭碗才最重要呢。'.repeat(5),sent=[];
    const bot=await app(t,{...env,AI_GROUP_REQUIRE_AT:'true'},{groupChatDecisionAI:{reply:async()=>'{"reply":true,"confidence":1}'},ai:{reply:async(_input,_history,_signal,options)=>{
      for(const end of [1,2,3,marker.length-1,marker.length]){
        const suffix=' '+marker.slice(0,end);
        await options.onDelta(suffix,caption+suffix);
        assert.ok(!/[\[【［]/u.test(texts(sent)),'no marker may leak into an already delivered stream');
      }
      return caption+' '+marker;
    }}});
    await install(bot);await upload(bot);if(automaticVoice)await voice(bot);
    if(format==='[表情:custom]'){
      const custom=bot.memes.saveCategory({name:'自建摸鱼',description:'摸鱼、休息'});
      await bot.memes.upload({data:'base64://'+gif.toString('base64'),category:custom.id,name:'自建分类表情'});
      marker='[表情:'+custom.id+']';assert.ok(marker.length>40,'a custom ID can span an entire stream chunk');
    }
    let p=await bot.plugins.install({kind:'group-chat-plus'});
    p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,groups:['20001'],require_at:false},config:{...p.config,quiet_hours_enabled:false,merge_window_ms:0,cooldown_seconds:0,initial_probability:1,attention_enabled:false,duplicate_filter:false,proactive_enabled:false}}});
    await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
    let speechCalls=0;bot.voicestudio.synthesize=async()=>{speechCalls++;throw Error('unexpected voice');};bot.adapter.on('outgoing',e=>sent.push(e));
    bot.adapter.driver.inject(incoming(1,{kind:'group',groupId:20001,message:'还是个三无啊'}));const job=await done(bot,1);
    assert.ok(bot.groupChatPlus.route(job));assert.equal(speechCalls,0);assert.equal(texts(sent),caption);
    assert.equal(sent.flatMap(e=>e.message).filter(s=>s.type==='image').length,1);
    assert.ok(sent.filter(e=>e.message.some(s=>s.type==='image')).every(e=>e.message.length===1));
    assert.ok(!JSON.stringify(sent).includes(marker));assert.equal(job.reply,caption);
    assert.equal(bot.store.history(job.conversation,10).at(-1).content,caption);
    assert.equal(bot.voicestudio.plan(job.id),undefined);assert.ok(bot.memes.plan(job.id).image_id);
    if(!automaticVoice)assert.ok(sent.length>1,'ordinary captions keep their incremental delivery');
  }
});

test('proactive Chat Plus captions can select a short category marker without emitting a mention, quote or voice',async t=>{
  let clock=Date.now();const caption='今天也要好好吃饭呀。',sent=[];
  const bot=await app(t,env,{groupChatNow:()=>clock,groupChatDecisionAI:{reply:async()=>'{"reply":true,"confidence":1}'},ai:{reply:async(_input,_history,_signal,options)=>{assert.equal(options.proactive,true);return caption+' [[开心]]';}}});
  await install(bot);await upload(bot);await voice(bot);
  let p=await bot.plugins.install({kind:'group-chat-plus'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,groups:['20001'],require_at:false},config:{...p.config,quiet_hours_enabled:false,merge_window_ms:0,initial_probability:0,attention_enabled:false,proactive_enabled:true,proactive_silence_seconds:10,proactive_cooldown_seconds:10,proactive_check_seconds:5,proactive_min_user_messages:2,proactive_activity_window_seconds:120,proactive_probability:1,proactive_max_per_day:1}}});
  await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});bot.adapter.on('outgoing',e=>sent.push(e));
  bot.adapter.driver.inject(incoming(1,{kind:'group',groupId:20001,message:'第一句'}));await waitFor(()=>bot.store.get(1)?.status==='ignored');
  bot.adapter.driver.inject(incoming(2,{kind:'group',groupId:20001,message:'第二句'}));await waitFor(()=>bot.store.get(2)?.status==='ignored');
  clock+=11000;assert.equal(bot.groupChatPlus.tick(),1);const job=await done(bot,3);
  assert.equal(job.reply,caption);assert.equal(sent.length,2);assert.deepEqual(sent[0].message.map(s=>s.type),['text']);assert.deepEqual(sent[1].message.map(s=>s.type),['image']);
  assert.equal(bot.voicestudio.plan(job.id),undefined);assert.ok(bot.memes.plan(job.id).image_id);
});

test('a missed selection reports a truthful result and does not turn an explicit image request into speech',async t=>{
  const bot=await app(t,env,{ai:{reply:async()=>'只能发文字，给你这个。[[表情:开心]]'}}),sent=[];await install(bot,{send_probability:0});await voice(bot);await upload(bot);
  let speechCalls=0;bot.voicestudio.synthesize=async()=>{speechCalls++;throw Error('unexpected voice');};bot.adapter.on('outgoing',e=>sent.push(e));
  bot.adapter.driver.inject(incoming(1,{message:'发个表情包'}));const job=await done(bot,1);
  assert.equal(speechCalls,0);assert.match(job.reply,/未选出/);assert.ok(!texts(sent).includes('只能发文字'));assert.ok(!sent.some(e=>e.message.some(s=>['image','record'].includes(s.type))));
});

test('image choices are durable across replanning, and missing image-only assets produce an honest delivered fallback',async t=>{
  const bot=await app(t,{...env,AI_STREAM_ENABLED:'false'},{ai:{reply:async()=>'错误的文字版。[[表情:开心]]'}});await install(bot);const uploaded=await upload(bot);
  bot.config.ai.enabled=false;
  const event={self_id:10000,user_id:10001,message_id:99,post_type:'message',message_type:'private',message:[{type:'text',data:{text:'发个表情包'}}]};
  const job=bot.store.ingest(event,'发个表情包',100),reply=bot.memes.planReply('错误配文[[表情:开心]]',event,job.id),selected=bot.memes.plan(job.id).image_id;
  const picks=bot.memes.image(selected).picks;assert.equal(bot.memes.planReply('另一段[[表情:难过]]',event,job.id),'[表情]');assert.equal(bot.memes.plan(job.id).image_id,selected);assert.equal(bot.memes.image(selected).picks,picks);
  bot.store.update(job.id,'ready',{reply});await bot.memes.edit({ids:[uploaded.image.id],action:'delete'});const sent=[];bot.adapter.on('outgoing',e=>sent.push(e));bot.config.ai.enabled=true;bot.worker.wake();await done(bot,job.id);
  assert.match(texts(sent),/图片已不可用/);assert.equal(bot.store.get(job.id).reply,texts(sent));assert.ok(!sent.some(e=>e.message.some(s=>s.type==='image')));
});
