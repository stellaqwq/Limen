import test from 'node:test';
import assert from 'node:assert/strict';
import {AIClient} from '../src/ai.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {browseIntent,DouyinRecommendations} from '../../../plugins/douyin-web/recommend.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';
import {douyinConfig} from '../../../plugins/douyin-web/config.mjs';
import {app,config,incoming,waitFor} from './helpers.mjs';

const event={post_type:'message',message_type:'private',self_id:10000,user_id:10001,message:[{type:'text',data:{text:'去抖音刷3条视频，有意思的分享给我'}}]};
const job={id:501,channel:'qq',conversation:'10000:private:10001'};
const message=(id,text='去刷1条视频')=>({id:String(id),server_id:String(id),direction:'peer',text,kind:'text'});
const call=(name,args)=>({tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
function browser(){
  const account={uid:'im-user:101',name:'发送账号',avatar:'self.png'},recipient={uid:'conversation:0:1:101:202',canonical_id:'user:peer',handle:'test-friend',name:'测试好友',avatar:'peer.png'};
  const b={running:true,surface:null,composer:'',commits:[],messages:[],video:0,account,recipient,nexts:0,
    async evaluate(expression){
      if(expression===snapshotExpression)return {url:'https://www.douyin.com/',title:'模拟视频',text:b.surface?'社交面板已打开':'模拟画面',social_panel_open:!!b.surface,blocked:null,video_id:String(7703905545174140000n+BigInt(b.video)),media_key:'media-'+b.video,video:{paused:!!b.paused,width:800,height:600,x:400,y:300,current_seconds:2}};
      if(expression.includes('active.e.pause()')){b.paused=true;return {ok:true,paused:true};}
      const p=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));
      if(p.phase==='open'){b.surface=p.surface;return {ok:true};}
      if(p.phase==='close'){if(b.composer)return {ok:false,reason:'existing_composer_text'};b.surface=null;return {ok:true,already_closed:true};}
      if(p.phase==='inspect')return {ok:true,account,contacts:[b.wrong?{...recipient,canonical_id:'user:other'}:recipient],composer_empty:!b.composer,selected_uid:recipient.uid};
      if(p.phase==='read_chat')return {ok:true,messages:structuredClone(b.messages),order:'oldest_to_newest_by_server_id'};
      if(p.phase==='focus')return b.composer&&b.composer!==p.content?{ok:false,reason:'existing_composer_text'}:{ok:true,already_filled:b.composer===p.content,no_editor:p.surface==='share'};
      if(p.phase==='preflight'||p.phase==='commit'){
        if(b.composer!==p.content)return {ok:false,reason:'content_changed'};
        if(p.phase==='commit'){
          b.commits.push({surface:p.surface,recipient:p.recipient.canonical_id,content:p.content});
          if(b.unknown)throw Error('lost response');
          if(p.surface==='messages'){const id=String(BigInt(b.messages.at(-1)?.id||'7703905545174140400')+1n);b.messages.push({...message(id,p.content),direction:'self'});b.composer='';}
          return {ok:true,submitted:true};
        }
      }
      return {ok:true};
    },async page(method,args){assert.equal(method,'Input.insertText');b.composer=args.text;},
    async screenshot(){if(b.onScreenshot)await b.onScreenshot();return 'data:image/jpeg;base64,/9j/';},
    async next(){b.video++;b.nexts++;},async close(){b.running=false;}
  };return b;
}
async function fixture(t,{ai,...patch}={}){
  const b=browser(),bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'},{douyinBrowser:b,...(ai?{ai}:{})});
  const auto=bot.douyinWeb.autoChat;clearInterval(auto.timer);auto.timer=null;
  await applyDouyinSetup(bot.plugins,{qq_private_enabled:true,browse_share_enabled:true,social_enabled:true,chat_read_enabled:true,social_default_friend:'test-friend',...patch});
  let p=bot.plugins.find('douyin-web');await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});
  p=bot.plugins.find('douyin-web');bot.douyinWeb.social.defaults.bind(p,{account:b.account,recipient:b.recipient});
  const save=async patch=>{const p=bot.plugins.find('douyin-web');return bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,...patch}}});};
  const tool=(name,e=event,j=job)=>bot.douyinWeb.tools(e,j).find(t=>t.name===name);
  const observe=async(j=job)=>(await tool('douyin_web_observe',event,j).invoke({frames:1})).result.observation_id;
  const recommend=async(id,j=job)=>{const r=(await tool('douyin_recommend_current',event,j).invoke({decision:'share',operation_id:'share-'+j.id,observation_id:id,content:'这个画面的反差挺有意思。发给你一起看看。'})).result;if(!r.ok&&!r.uncertain)throw Error(r.error);return r;};
  return {b,bot,auto,save,tool,observe,recommend};
}

test('explicit browsing intent and default-off switch do not grant automatic sending for questions, negations, or ordinary chat',async t=>{
  assert.equal(douyinConfig().browse_share_enabled,false);assert.throws(()=>douyinConfig({browse_share_max_per_task:6}));
  for(const text of ['去刷视频','去抖音看3条视频','刷一会抖音，有意思的发给我','帮我看几个视频','去抖音刷1条视频，不感兴趣可以不分享。遇到登录或验证就停止。','去刷视频，别点赞，不要猜音频'])assert.equal(browseIntent(text),true,text);
  for(const text of ['你能刷抖音吗？','不要刷视频','去抖音看3条，只观看和切换','你好','解释一下去刷视频是什么意思'])assert.equal(browseIntent(text),false,text);
  const f=await fixture(t,{browse_share_enabled:false});assert.equal(f.tool('douyin_recommend_current'),undefined);assert.deepEqual(f.b.commits,[]);
});

test('QQ tools require administrator and private scope; automatic recommendation exposes no recipient argument',async t=>{
  const f=await fixture(t);assert.ok(f.tool('douyin_recommend_current'));assert.equal(f.tool('douyin_social_draft'),undefined);
  assert.equal(f.tool('douyin_recommend_current',{...event,user_id:10002}),undefined);
  assert.equal(f.tool('douyin_recommend_current',{...event,message_type:'group',group_id:123}),undefined);
  assert.equal(f.tool('douyin_recommend_current',{...event,message:'你能刷抖音吗？'}),undefined);
  assert.equal(f.tool('douyin_recommend_current',{...event,douyin_reply:true},{...job,channel:'web'}),undefined);
  assert.equal(f.tool('douyin_social_draft',event,{...job,channel:'web'}),undefined);
  assert.throws(()=>f.tool('douyin_recommend_current').invoke({operation_id:'x',observation_id:'x',content:'a',recipient_ref:'other'}));
});

test('sampled video is shared once with a separate message to the same bound peer, then browsing continues',async t=>{
  const f=await fixture(t),id=await f.observe(),r=await f.recommend(id);
  assert.equal(r.state,'submitted');assert.equal(r.delivery_confirmed,false);assert.equal(r.message_observed,true);
  assert.deepEqual(f.b.commits.map(c=>[c.surface,c.recipient]),[['share','user:peer'],['messages','user:peer']]);assert.equal(f.b.surface,null);
  const obs=await f.observe();await f.tool('douyin_web_action').invoke({action:'next_video',operation_id:'next',observation_id:obs});assert.equal(f.b.nexts,1);
});

test('same video stays deduplicated across new jobs and controller restart',async t=>{
  const f=await fixture(t);await f.recommend(await f.observe());f.bot.douyinWeb.release(job);
  f.bot.douyinWeb.recommendations=new DouyinRecommendations(f.bot.douyinWeb);
  const nextJob={...job,id:502};const r=await f.recommend(await f.observe(nextJob),nextJob);
  assert.equal(r.cached,true);assert.equal(f.b.commits.length,2);
});

test('pausing the same verified video does not discard evidence needed for its recommendation',async t=>{
  const f=await fixture(t),id=await f.observe();await f.tool('douyin_web_action').invoke({action:'pause',operation_id:'pause',observation_id:id});
  assert.equal(f.b.paused,true);assert.equal((await f.recommend(id)).state,'submitted');assert.equal(f.b.commits.length,2);
});

test('unknown share stops before private message and never replays after restart',async t=>{
  const f=await fixture(t);f.b.unknown=true;const r=await f.recommend(await f.observe());assert.equal(r.uncertain,true);assert.equal(f.b.commits.length,1);
  assert.equal(f.bot.store.db.prepare('SELECT state FROM douyin_recommendations').get().state,'uncertain');
  f.bot.douyinWeb.release(job);f.b.surface=null;f.b.unknown=false;f.bot.douyinWeb.recommendations=new DouyinRecommendations(f.bot.douyinWeb);
  const nextJob={...job,id:502};const retry=await f.recommend(await f.observe(nextJob),nextJob);assert.equal(retry.uncertain,true);assert.equal(f.b.commits.length,1);
});

test('task limit, changed video, missing binding, and manual composer text prevent automatic sending',async t=>{
  const f=await fixture(t,{browse_share_max_per_task:1});await f.recommend(await f.observe());f.b.video++;
  const id=await f.observe();assert.equal((await f.recommend(id)).limited,true);assert.equal(f.b.commits.length,2);
  const g=await fixture(t);const old=await g.observe();g.b.video++;await assert.rejects(()=>g.recommend(old),/变化/);assert.equal(g.b.commits.length,0);
  const h=await fixture(t);h.bot.store.db.prepare('DELETE FROM douyin_default_friends').run();const hi=await h.observe();await assert.rejects(()=>h.recommend(hi),/绑定/);assert.equal(h.b.commits.length,0);
  const k=await fixture(t);k.b.composer='手动内容';const ki=await k.observe();await assert.rejects(()=>k.recommend(ki),/文字/);assert.equal(k.b.commits.length,0);assert.equal(k.b.composer,'手动内容');
});

test('revoking the switch during preparation prevents send activation',async t=>{
  const f=await fixture(t),id=await f.observe();f.b.onScreenshot=()=>f.save({browse_share_enabled:false});
  await assert.rejects(()=>f.recommend(id),/停止|权限/);assert.equal(f.b.commits.length,0);
});

test('queued Douyin browsing grants are revoked by settings changes and stop/resume',async t=>{
  const f=await fixture(t),s=f.bot.douyinWeb,j={...job,channel:'web'},e={...event,douyin_browse:true,douyin_browse_grant:s.browseGeneration};
  assert.ok(s.tools(e,j).some(t=>t.name==='douyin_recommend_current'));
  s.control({action:'stop'});s.control({action:'resume'});assert.equal(s.tools(e,j).length,0);
  const fresh={...e,douyin_browse_grant:s.browseGeneration};assert.ok(s.tools(fresh,j).length);
  await f.save({browse_share_enabled:false});assert.equal(s.tools(fresh,j).length,0);assert.deepEqual(f.b.commits,[]);
});

test('slow reasoning may reuse a verified same-video sample within the task budget; missing stable identity cannot send',async t=>{
  const f=await fixture(t),id=await f.observe();f.bot.douyinWeb.owner.observation.time-=150000;
  await f.tool('douyin_web_action').invoke({action:'next_video',operation_id:'slow-next',observation_id:id});assert.equal(f.b.nexts,1);
  const g=await fixture(t),gi=await g.observe();g.bot.douyinWeb.owner.observations.get(gi).video_id=null;
  await assert.rejects(()=>g.recommend(gi),/唯一标识|变化/);assert.deepEqual(g.b.commits,[]);
});

test('QQ queue runs the real observation, recommendation and next-video tool loop',async t=>{
  let round=0;class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages,signal,tools,choice){
    round++;if(choice==='auto')assert.ok(tools.some(t=>t.function.name==='douyin_recommend_current'));
    if(round===1)return call('douyin_web_status',{});
    if(round===2)return call('douyin_web_observe',{frames:1});
    if(round===3){const obs=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('douyin_recommend_current',{decision:'share',operation_id:'recommend',observation_id:obs.observation_id,content:'画面挺有趣的。一起看看。'});}
    if(round===4)return call('douyin_web_observe',{frames:1});
    if(round===5){const obs=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('douyin_web_action',{action:'next_video',operation_id:'next',observation_id:obs.observation_id});}
    if(round===6)return call('douyin_web_observe',{frames:1});
    if(round===7){const obs=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('douyin_recommend_current',{decision:'skip',operation_id:'skip',observation_id:obs.observation_id,content:'这条没有特别感兴趣的画面。'});}
    return {content:'已提交一条视频分享和私信，并继续看了下一条。'};
  }}
  const f=await fixture(t,{ai:new Model()});f.bot.adapter.driver.inject(incoming(88001,{message:'去抖音刷2条视频，有意思的发给我'}));
  const done=await waitFor(()=>{const j=f.bot.store.get(1);return ['done','failed','uncertain'].includes(j?.status)&&j;});
  assert.equal(done.status,'done',JSON.stringify(done));assert.equal(f.b.commits.length,2);assert.equal(f.b.nexts,1);assert.equal(f.bot.douyinWeb.owner,null);
});

test('a reasoning-only model turn retries its transcript once without repeating a browser write',async t=>{
  let round=0;class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages){
    round++;if(round===1)return call('douyin_web_status',{});
    if(round===2||round===5)return call('douyin_web_observe',{frames:1});
    const obs=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).findLast(m=>m.observation_id);
    if(round===3)return call('douyin_recommend_current',{decision:'skip',operation_id:'skip',observation_id:obs.observation_id,content:'这条没兴趣。'});
    if(round===4)return call('douyin_web_action',{action:'next_video',operation_id:'next',observation_id:obs.observation_id});
    if(round===6)return {content:'',reasoning_content:'private reasoning'};
    assert.equal(messages.filter(m=>m.role==='tool').length,5);return call('douyin_recommend_current',{decision:'stop',operation_id:'stop',observation_id:obs.observation_id,content:'结束本次观看。'});
  }}
  const f=await fixture(t,{ai:new Model()});f.bot.adapter.driver.inject(incoming(88002,{message:'去抖音刷2条视频'}));
  const done=await waitFor(()=>{const j=f.bot.store.get(1);return ['done','failed','uncertain'].includes(j?.status)&&j;});
  assert.equal(done.status,'done');assert.equal(round,7);assert.equal(f.b.nexts,1);assert.deepEqual(f.b.commits,[]);
});

test('successful recommendation on the last allowed video ends with an execution receipt without another model turn',async t=>{
  let round=0;class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages){
    round++;if(round===1)return call('douyin_web_status',{});if(round===2)return call('douyin_web_observe',{frames:1});
    assert.equal(round,3);const obs=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('douyin_recommend_current',{decision:'share',operation_id:'last',observation_id:obs.observation_id,content:'这个画面很有意思。分享给你一起看看。'});
  }}
  const f=await fixture(t,{ai:new Model(),max_videos:1});f.bot.adapter.driver.inject(incoming(88003,{message:'去抖音刷1条视频'}));
  const done=await waitFor(()=>{const j=f.bot.store.get(1);return ['done','failed','uncertain'].includes(j?.status)&&j;});
  assert.equal(done.status,'done');assert.equal(round,3);assert.match(done.reply,/提交 1 条视频分享及对应私信/);assert.equal(f.b.commits.length,2);
});

test('unexecuted model claims cannot become a sent receipt; required decisions allow an honest skip',async t=>{
  let round=0;class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages){
    round++;if(round===1)return call('douyin_web_status',{});if(round===2)return call('douyin_web_observe',{frames:1});
    if(round<5)return {content:'已经分享并私信了。'};
    const obs=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('douyin_recommend_current',{decision:'skip',operation_id:'skip',observation_id:obs.observation_id,content:'没有特别有趣的内容。'});
  }}
  const f=await fixture(t,{ai:new Model(),max_videos:1});f.bot.adapter.driver.inject(incoming(88004,{message:'去刷1条视频'}));
  const done=await waitFor(()=>{const j=f.bot.store.get(1);return ['done','failed','uncertain'].includes(j?.status)&&j;});
  assert.equal(done.status,'done');assert.match(done.reply,/没有提交视频分享或私信/);assert.equal(round,5);assert.deepEqual(f.b.commits,[]);
});

test('enabled learning archives real observation before the per-video decision and never reports a skipped video as sent',async t=>{
  const names=[];class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages,signal,tools){
    const name=tools[0].function.name;names.push(name);const obs=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).findLast(m=>m.observation_id);
    if(name==='douyin_web_status')return call(name,{});
    if(name==='douyin_web_observe')return call(name,{frames:1});
    if(name==='video_knowledge_save')return call(name,{operation_id:'archive',observation_id:obs.observation_id,kind:'watch_note',title:'模拟画面',summary:'实际画面中的观看记录。'});
    return call(name,{decision:'skip',operation_id:'skip',observation_id:obs.observation_id,content:'这条略过。'});
  }}
  const f=await fixture(t,{ai:new Model(),max_videos:1,knowledge_enabled:true,knowledge_auto_archive:true});f.bot.adapter.driver.inject(incoming(88005,{message:'去刷1条视频'}));
  const done=await waitFor(()=>{const j=f.bot.store.get(1);return ['done','failed','uncertain'].includes(j?.status)&&j;});
  assert.equal(done.status,'done');assert.deepEqual(names,['douyin_web_status','douyin_web_observe','video_knowledge_save','douyin_recommend_current']);assert.equal(f.bot.douyinWeb.knowledge.count(f.bot.plugins.find('douyin-web')),1);assert.deepEqual(f.b.commits,[]);
});

test('Douyin commands skip baseline and ordinary messages with auto chat off, then run a restricted browsing job once',async t=>{
  let names=[];class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages,signal,tools,choice){names=tools.map(t=>t.function.name);if(choice==='required'){const name=names[0];if(name==='douyin_recommend_current'){const obs=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call(name,{decision:'stop',operation_id:'stop',observation_id:obs.observation_id,content:'模拟结束'});}return call(name,name==='douyin_web_observe'?{frames:1}:{});}return {content:'模拟刷视频任务完成'};}}
  const f=await fixture(t,{ai:new Model(),chat_auto_enabled:false}),auto=f.auto;let now=Date.now();auto.now=()=>now;
  const tick=async()=>{now+=16000;await auto.tick();};f.b.messages=[message('7703905545174140400')];await tick();assert.equal(auto.pending,null);
  f.b.messages.push(message('7703905545174140401','你好'));await tick();assert.equal(auto.pending,null);
  f.b.messages.push(message('7703905545174140402'));await tick();assert.equal(auto.pending?.kind,'browse');assert.equal(f.b.surface,null);
  const id=auto.pending.jobId;await waitFor(()=>f.bot.store.get(id)?.status==='done');assert.ok(names.includes('douyin_recommend_current'));assert.ok(!names.includes('douyin_social_draft'));assert.ok(!names.includes('memory_save'));
  await tick();await tick();assert.equal(auto.pending,null);assert.equal(f.bot.store.db.prepare('SELECT COUNT(*) n FROM douyin_auto_chat_attempts').get().n,1);
});
