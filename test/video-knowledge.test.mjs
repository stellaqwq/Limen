import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {VideoKnowledge,knowledgeTools} from '../../../plugins/douyin-web/knowledge/service.mjs';
import {DouyinWebService} from '../../../plugins/douyin-web/service.mjs';
import {douyinConfig,douyinTemplate} from '../../../plugins/douyin-web/config.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {validateSchema} from '../src/agent/schema.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';
import {app,temp,cleanup,request} from './helpers.mjs';

const job={id:1,channel:'web',conversation:'web:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},env={AI_ENABLED:'true',AI_MODEL:'knowledge-fixture',AI_ALLOWED_USERS:'10001'};
const input={operation_id:'save1',kind:'knowledge_note',title:'画面中的水循环示意',summary:'视频画面展示了蒸发、凝结和降水三个箭头；这是视频中的示意，未独立核实。',tags:['水循环','科普']};
function browser(){return {running:true,state:{url:'https://www.douyin.com/?recommend=1&secret=do-not-store',title:'抖音',text:'页面可能有相邻视频文案',video_id:'1234567890123456789',media_key:'media-sample',blocked:null,video:{paused:false,current_seconds:8.25,duration_seconds:30,width:800,height:600,x:600,y:400}},async evaluate(){return structuredClone(this.state);},async screenshot(){return 'data:image/jpeg;base64,/9j/';},async next(){},async close(){this.running=false;}};}
async function fixture(t,patch={}){
  const root=await temp(t),store=new Store(join(root,'bot.sqlite'));cleanup(t,()=>store.close());const b=browser();
  const plugin={...structuredClone(douyinTemplate),id:'video-learning',revision:1,enabled:true,config:douyinConfig({knowledge_enabled:true,...patch})},service=new DouyinWebService({store,config:{dataDir:root},browser:b});service.pluginFor=()=>plugin;cleanup(t,()=>service.close());
  const invoke=async(name,args={},current=job)=>service.tools({},current).find(t=>t.name===name).invoke(args);
  return {root,store,b,plugin,service,invoke};
}
async function note(f,args=input){const obs=await f.invoke('douyin_web_observe',{frames:1});const result=await f.invoke('video_knowledge_save',{...args,observation_id:obs.result.observation_id});return {obs,result};}

test('knowledge is opt-in, tools are bounded and do not weaken explicit personal memory rules',async t=>{
  for(const tool of knowledgeTools)validateSchema(tool.parameters);
  assert.equal(douyinConfig().knowledge_enabled,false);
  for(const patch of [{knowledge_max_entries:0},{knowledge_max_entries:5001},{knowledge_auto_archive:'yes'}])assert.throws(()=>douyinConfig(patch));
  const bot=await app(t,env,{douyinBrowser:browser()});await applyDouyinSetup(bot.plugins);assert.equal(bot.agent.tools({},job).tools.some(t=>t.name==='video_knowledge_save'),false);
  let p=bot.plugins.find('douyin-web');p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,knowledge_enabled:true}}});
  assert.equal(p.tools.length,5);assert.ok(bot.agent.tools({},job).tools.some(t=>t.name==='video_knowledge_save'));
  assert.equal(bot.agent.tools({message_type:'private',user_id:10001},{...job,channel:'qq'}).tools.some(t=>t.name==='video_knowledge_search'),false);
  assert.match(bot.agent.tools({},job).tools.find(t=>t.name==='memory_save').description,/明确要求/);
});

test('autonomous note is grounded in server evidence, with canonical source, actual times, hashes and unverified trust',async t=>{
  const f=await fixture(t),{obs,result}=await note(f);assert.equal(result.result.ok,true);const item=result.result.item;
  assert.equal(obs.result.knowledge_archive_required,true);assert.equal(item.trust,'unverified_video');assert.equal(item.source.audio,false);
  assert.equal(item.source.url,'https://www.douyin.com/video/1234567890123456789');assert.equal(item.source.attribution,'video_permalink');
  assert.equal(item.source.observations[0].job_id,job.id);assert.equal(item.source.observations[0].samples[0].video_seconds,8.25);
  assert.match(item.source.observations[0].frame_sha256[0],/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(item).includes('base64'));assert.ok(!JSON.stringify(item).includes('do-not-store'));
  assert.equal((await f.invoke('video_knowledge_search',{query:'水循环'})).result.items[0].id,item.id);
  const state=new AgentState(f.store);assert.equal(state.memories(job.conversation).length,0);
});

test('save requires evidence from this job; forged refs, manual previews, blocked, mixed and missing-player observations cannot enter library',async t=>{
  const f=await fixture(t);assert.equal((await f.invoke('video_knowledge_save',{...input,observation_id:'forged'})).result.ok,false);
  const obs=await f.invoke('douyin_web_observe',{frames:1});f.service.release(job);
  assert.equal((await f.invoke('video_knowledge_save',{...input,observation_id:obs.result.observation_id},{...job,id:2})).result.ok,false);f.service.release({id:2});
  f.b.state.blocked='verification_required';assert.equal((await note(f)).result.result.ok,false);f.service.release(job);
  f.b.state.blocked=null;f.b.state.video=null;assert.equal((await note(f)).result.result.ok,false);f.service.release(job);
  f.b.state.video={paused:false,current_seconds:1,width:800,height:600};const good=await f.invoke('douyin_web_observe',{frames:1});f.service.owner.observations.get(good.result.observation_id).mixed=true;
  assert.equal((await f.invoke('video_knowledge_save',{...input,observation_id:good.result.observation_id})).result.ok,false);
  assert.equal(f.service.knowledge.count(f.plugin),0);
});

test('auto archive gates next video until save, while disabled auto archive allows normal viewing',async t=>{
  const f=await fixture(t),obs=await f.invoke('douyin_web_observe',{frames:1});
  const args={action:'next_video',operation_id:'next',observation_id:obs.result.observation_id};await assert.rejects(f.invoke('douyin_web_action',args),/先调用 video_knowledge_save/);
  assert.equal((await f.invoke('video_knowledge_save',{...input,observation_id:obs.result.observation_id})).result.ok,true);
  assert.equal((await f.invoke('douyin_web_action',args)).result.ok,true);
  const normal=await fixture(t,{knowledge_auto_archive:false}),second=await normal.invoke('douyin_web_observe',{frames:1});assert.equal(second.result.knowledge_archive_required,false);
  assert.equal((await normal.invoke('douyin_web_action',{action:'next_video',operation_id:'next',observation_id:second.result.observation_id})).result.ok,true);
});

test('same video and kind deduplicate and merge bounded observations, archived notes never silently reappear',async t=>{
  const f=await fixture(t),a=await note(f),b=await note(f,{...input,operation_id:'save2',summary:'新的实际采样补充了云层和降水箭头。'});
  assert.equal(a.result.result.item.id,b.result.result.item.id);assert.equal(b.result.result.item.updated,true);assert.equal(b.result.result.item.source.observations.length,2);assert.equal(f.service.knowledge.count(f.plugin),1);
  const item=b.result.result.item;f.service.knowledgeAction({id:item.id,revision:item.revision,action:'archive'});
  assert.equal(f.service.knowledgeSnapshot().items.length,0);assert.equal(f.service.knowledgeSnapshot('',true).items[0].status,'archived');
  assert.equal((await note(f)).result.result.ok,false);
  assert.throws(()=>f.service.knowledgeAction({id:item.id,revision:item.revision,action:'restore'}),/已更新/);
  const archived=f.service.knowledgeSnapshot('',true).items[0];f.service.knowledgeAction({id:archived.id,revision:archived.revision,action:'restore'});assert.equal(f.service.knowledge.count(f.plugin),1);
});

test('unknown permalink is explicitly a feed snapshot and never takes a model-provided URL',async t=>{
  const f=await fixture(t);f.b.state.video_id=null;
  const {result}=await note(f);assert.equal(result.result.item.source.attribution,'feed_snapshot');assert.equal(result.result.item.source.video_id,null);assert.equal(result.result.item.source.url,'https://www.douyin.com/?recommend=1');
  await assert.rejects(f.invoke('video_knowledge_save',{...input,observation_id:'fake',source_url:'https://evil.test/'}));
});

test('credentials are rejected, library cap is enforced and local lookup survives browser closure and process recreation',async t=>{
  const f=await fixture(t);assert.equal((await note(f,{...input,summary:'api_key: sk-abcdefghijklmno'})).result.result.ok,false);
  const {result}=await note(f);assert.equal(result.result.ok,true);
  f.plugin.config.knowledge_max_entries=10;const evidence=[...f.service.owner.observations.values()].at(-1);for(let i=0;i<9;i++)f.service.knowledge.save(f.plugin,{...input,title:'其他笔记'+i},{...evidence,source_key:'other-video:'+i});f.b.state.video_id='2234567890123456789';assert.equal((await note(f)).result.result.ok,false);
  await f.service.close();const db=new Store(join(f.root,'bot.sqlite'));try{const kb=new VideoKnowledge({store:db});assert.equal(kb.search(f.plugin,'水循环')[0].id,result.result.item.id);assert.match(kb.recall(f.plugin,'水循环'),/未核实/);}finally{db.close();}
});

test('automatic recall is admin web scoped, bounded, untrusted and includes provenance in actual model prompt',async t=>{
  let suffix='';const b=browser(),bot=await app(t,env,{douyinBrowser:b,ai:{reply:async(input,history,signal,options)=>{suffix=options.systemPromptSuffix;return '检索完成。';}}});
  await applyDouyinSetup(bot.plugins,{knowledge_enabled:true});
  const tools=bot.douyinWeb.tools({},job);const obs=await tools.find(t=>t.name==='douyin_web_observe').invoke({frames:1});
  await tools.find(t=>t.name==='video_knowledge_save').invoke({...input,observation_id:obs.result.observation_id});bot.douyinWeb.release(job);
  await bot.agent.reply('之前学到的水循环是什么？',[],undefined,{event:{post_type:'message',message_type:'private',user_id:0},job:{...job,id:2}});
  assert.match(suffix,/视频知识库检索资料/);assert.match(suffix,/unverified_video/);assert.match(suffix,/https:\/\/www.douyin.com\/video\//);
  assert.equal(bot.douyinWeb.knowledgePrompt({message_type:'private',user_id:10001},{...job,channel:'qq'},'水循环'),'');
});

test('admin management requires authentication and stale revisions cannot overwrite newer notes',async t=>{
  const b=browser(),bot=await app(t,env,{douyinBrowser:b});await applyDouyinSetup(bot.plugins,{knowledge_enabled:true});
  const tools=bot.douyinWeb.tools({},job),obs=await tools[1].invoke({frames:1});await tools.find(t=>t.name==='video_knowledge_save').invoke({...input,observation_id:obs.result.observation_id});bot.douyinWeb.release(job);
  assert.equal((await request(bot,'/admin/agent/knowledge',undefined,'onebot')).code,401);
  assert.equal((await request(bot,'/admin/agent/knowledge/action',{action:'archive'},'onebot')).code,401);
  const listing=await request(bot,'/admin/agent/knowledge?query='+encodeURIComponent('水循环'));assert.equal(listing.data.items.length,1);const item=listing.data.items[0];
  const action={id:item.id,revision:item.revision,action:'archive'};assert.equal((await request(bot,'/admin/agent/knowledge/action',action)).code,200);
  assert.equal((await request(bot,'/admin/agent/knowledge/action',action)).code,409);
  assert.equal((await request(bot,'/admin/agent/knowledge')).data.items.length,0);assert.equal((await request(bot,'/admin/agent/knowledge?archived=1')).data.items.length,1);
});
