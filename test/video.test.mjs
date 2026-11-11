import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile,readdir,symlink,utimes,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {videoConfig,videoTemplate,videoTools} from '../../../plugins/video/config.mjs';
import {VideoService} from '../../../plugins/video/service.mjs';
import {videoType} from '../src/attachments/video-types.mjs';
import {attachmentType} from '../src/attachments/files.mjs';
import {validateSchema} from '../src/agent/schema.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {AIClient} from '../src/ai.mjs';
import {Store} from '../src/store.mjs';
import {installVideo} from '../scripts/install-video.mjs';
import {app,config,temp,request,waitFor,cleanup,withTestTimeout} from './helpers.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'video-fixture',AI_ALLOWED_USERS:'10001'};
const event={post_type:'message',message_type:'private',self_id:10000,user_id:10001,message_id:100,message:[{type:'text',data:{text:'分析视频'}}]};
const web={id:1,channel:'web',conversation:'web:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
const mp4=Buffer.from('000000186674797069736f6d0000020069736f6d6d703432','hex');
const jpg=Buffer.from('ffd8ffc000110800b4014003011100021101031100ffd9','hex');
const probe={format:{duration:'10',format_name:'mov,mp4',start_time:'0'},streams:[{codec_type:'video',width:320,height:180,avg_frame_rate:'25/1',start_time:'0'},{codec_type:'audio',codec_name:'aac',sample_rate:'16000',channels:1}]};
function fakeRun(onRun=()=>{}){return async(command,args,options)=>{
  await onRun(command,args,options);options?.signal?.throwIfAborted();
  if(command.includes('ffprobe'))return {code:0,stdout:JSON.stringify(probe),stderr:''};
  const path=args.at(-1);await writeFile(path,path.endsWith('.wav')?Buffer.concat([Buffer.from('RIFF0000WAVE'),Buffer.alloc(100)]):jpg);
  return {code:0,stdout:'',stderr:'n: 0 pts: 0 pts_time:'+args[args.indexOf('-ss')+1]};
};}
async function fixture(t,extra={}){
  const root=await temp(t),path=join(root,'clip.mp4');await writeFile(path,mp4);
  const plugin={...structuredClone(videoTemplate),id:'video-test',revision:1,enabled:true,config:videoConfig({allowed_roots:[root],...extra})};
  const service=new VideoService({config:config(root,env),run:fakeRun()});service.pluginFor=()=>plugin;service.toolName=(_,t)=>t.name;cleanup(t,()=>service.close());
  return {root,path,plugin,service,invoke:(name,args={})=>service.tools(event,web).find(t=>t.name===name).invoke(args)};
}
async function install(bot,config={}){let p=await bot.plugins.install({kind:'video-analysis'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,...config}}});return bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});}
const call=(name,args)=>({tool_calls:[{id:'call',type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('video plugin unifies five bounded read tools and validates configuration',()=>{
  assert.deepEqual(videoTools.map(t=>t.name),['video_info','video_frames','video_transcript','video_storyboard','video_zoom']);for(const t of videoTools){assert.equal(t.effect,'read');validateSchema(t.parameters);}
  for(const value of [{max_frames:9},{interval_seconds:0},{asr_url:'file:///secret'},{asr_url:'http://user:pass@localhost/asr'},{asr_api_key:'key\nheader'},{allowed_roots:['']},{asr_format:'srt'},{extra:true}])assert.throws(()=>videoConfig(value));
  assert.equal(videoType('clip.mp4',mp4).kind,'video');assert.equal(videoType('fake.mp4',Buffer.from('not video')),null);
  assert.throws(()=>attachmentType('clip.mp4',mp4));assert.equal(attachmentType('clip.mp4',mp4,{allowVideo:true}).kind,'video');
});

test('installation is idempotent, defaults disabled, web-only activation works and configuration survives reinstall',async t=>{
  const bot=await app(t,env),first=await installVideo(bot.plugins,bot.config);assert.equal(first.enabled,false);assert.equal(first.tools.length,5);
  let p=await bot.plugins.save({id:first.id,revision:first.revision,plugin:{...first,scope:{...first.scope,private_users:[],groups:[]},config:{...first.config,max_frames:2}}});
  p=await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});assert.ok(bot.video.tools(event,web).length===5);
  assert.equal(bot.video.tools({...event,user_id:10002},{...web,channel:'qq'}).length,0);
  assert.equal(bot.video.tools(event,{...web,channel:'qq'}).length,0);
  assert.equal((await installVideo(bot.plugins,bot.config)).config.max_frames,2);
  await assert.rejects(bot.plugins.save({plugin:structuredClone(videoTemplate)}),/已安装/);
  assert.equal((await request(bot,'/admin/plugins/install',{kind:'video-analysis'},'onebot')).code,401);
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001'],groups:['20001']}}});
  assert.equal(bot.video.tools(event,{...web,channel:'qq'}).length,5);
  assert.equal(bot.video.tools({...event,message_type:'group',group_id:20001},{...web,channel:'qq'}).length,0);
  assert.equal(bot.video.tools({...event,message_type:'group',group_id:20001,message:[{type:'at',data:{qq:'10000'}}]},{...web,channel:'qq'}).length,5);
});

test('video source checks reject URLs, traversal, oversized files and escaping junctions',async t=>{
  const {service,plugin,root,path,invoke}=await fixture(t),c=plugin.config;
  assert.equal((await invoke('video_info',{source:path})).result.duration_seconds,10);
  for(const source of ['https://example.com/movie.mp4','file:///secret','../secret.mp4','clip.mp4:stream','\\\\server\\file.mp4'])await assert.rejects(service.source(source,event,web,c));
  const outside=await temp(t);await writeFile(join(outside,'secret.mp4'),mp4);await symlink(outside,join(root,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(service.source(join(root,'link','secret.mp4'),event,web,c));
  await writeFile(join(root,'large.mp4'),Buffer.alloc(1048577));await assert.rejects(service.source('large.mp4',event,web,{...c,max_file_mb:1}),/大小上限/);
  assert.equal((await invoke('video_frames',{source:path,start_seconds:9,end_seconds:20})).result.ok,false);
});

test('frames carry real timestamps and images, remain transient and obey sampling budgets',async t=>{
  const {service,path,invoke,root}=await fixture(t),store=new Store(':memory:');cleanup(t,()=>store.close());const state=new AgentState(store);
  const tool=service.tools(event,web).find(t=>t.name==='video_frames');
  const outcome=await state.invoke(web,tool,{source:path,start_seconds:1,end_seconds:8,interval_seconds:2,max_frames:3});
  assert.equal(outcome.images.length,3);assert.deepEqual(outcome.result.frames.map(f=>f.timestamp_seconds),[1,3,5]);assert.equal(outcome.result.truncated,true);assert.match(outcome.imageContext,/图片 2 = 3 秒/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM agent_receipts').get().n,0);assert.ok(!JSON.stringify(state.trace(web.id)).includes('base64'));
  assert.equal((await readdir(join(root,'video-work'))).length,0);
  assert.equal((await invoke('video_frames',{source:path,max_frames:9})).result.ok,false);
  service.config.ai.visionEnabled=false;assert.ok(!service.tools(event,web).some(t=>t.name==='video_frames'));
});

test('default file sampling covers eight ordered frames across thirty-five seconds and reaches the model together',async t=>{
  const {service,path,invoke}=await fixture(t),run=service.run;service.run=(command,args,options)=>command.includes('ffprobe')?Promise.resolve({code:0,stdout:JSON.stringify({...probe,format:{...probe.format,duration:'60'}}),stderr:''}):run(command,args,options);
  let turns=0;class Model extends AIClient{async completion(messages){
    if(++turns===1)return call('video_frames',{source:path});
    const images=messages.at(-1).content.filter(p=>p.type==='image_url');assert.equal(images.length,8);assert.match(JSON.stringify(messages),/图片 8 = 35 秒/);return {content:'已按八帧观察前后变化。'};
  }}
  const model=new Model(config('unused').ai);assert.equal(await model.reply('分析视频',[],undefined,{tools:[{type:'function',function:videoTools.find(t=>t.name==='video_frames')}],invokeTool:(name,args)=>invoke(name,args)}),'已按八帧观察前后变化。');assert.equal(turns,2);
});

test('multiple video images reach a model turn with matching timestamps and older frames are evicted',async t=>{
  const {path,invoke}=await fixture(t);let turns=0;
  class Model extends AIClient{async completion(messages){turns++;if(turns===1)return call('video_frames',{source:path,start_seconds:0,end_seconds:3,interval_seconds:1,max_frames:3});
    const parts=messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);assert.equal(parts.filter(p=>p.type==='image_url').length,3);assert.match(parts.map(p=>p.text||'').join(''),/图片 3 = 2 秒/);return turns===2?call('video_frames',{source:path,start_seconds:0,end_seconds:3,interval_seconds:1,max_frames:3}):{content:'已按采样帧分析。'};}}
  assert.equal(await new Model(config('unused',env).ai).reply('分析视频',[],undefined,{tools:videoTools.map(t=>({type:'function',function:t})),maxSteps:4,invokeTool:invoke}),'已按采样帧分析。');
});

test('transcription uploads only selected audio, offsets returned timestamps and caches repeated calls',async t=>{
  const {service,path,plugin,invoke}=await fixture(t);let calls=0;
  plugin.config.asr_url='http://127.0.0.1:12345/asr';plugin.config.asr_api_key='private-asr-key';
  service.fetcher=async(url,options)=>{calls++;assert.equal(url,plugin.config.asr_url);assert.equal(options.headers.Authorization,'Bearer private-asr-key');assert.equal(options.redirect,'error');assert.equal(options.body.get('model'),'whisper-1');assert.equal(options.body.get('response_format'),'verbose_json');assert.equal(options.body.get('timestamp_granularities[]'),'segment');assert.equal(options.body.get('file').type,'audio/wav');return new Response(JSON.stringify({text:'测试对白',segments:[{start:0.2,end:1,text:'测试对白'}]}));};
  const result=await invoke('video_transcript',{source:path,start_seconds:3,end_seconds:5});assert.equal(result.result.segments[0].start_seconds,3.2);assert.equal(result.result.segments[0].end_seconds,4);
  assert.deepEqual(await invoke('video_transcript',{source:path,start_seconds:3,end_seconds:5}),result);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('private-asr-key'));
  service.release(web);await invoke('video_transcript',{source:path,start_seconds:3,end_seconds:5});assert.equal(calls,2);
});

test('missing ASR, silent video, malformed timestamps and non-timestamped JSON have honest results',async t=>{
  const {service,path,plugin,invoke}=await fixture(t);
  const missing=await invoke('video_transcript',{source:path});assert.equal(missing.result.ok,false);assert.match(missing.result.error,/尚未配置/);
  service.run=async()=>({code:0,stdout:JSON.stringify({...probe,streams:[probe.streams[0]]}),stderr:''});service.release(web);
  assert.match((await invoke('video_transcript',{source:path})).result.error,/没有音轨/);
  service.run=fakeRun();service.release(web);plugin.config.asr_url='http://127.0.0.1:12345/asr';
  service.fetcher=async()=>new Response(JSON.stringify({text:'fake',segments:[{start:-1,end:2,text:'fake'}]}));assert.equal((await invoke('video_transcript',{source:path})).result.ok,false);
  service.fetcher=async()=>new Response(JSON.stringify({text:'只有正文'}));plugin.config.asr_format='json';const plain=await invoke('video_transcript',{source:path});assert.equal(plain.result.timestamps,false);assert.deepEqual(plain.result.segments,[]);
});

test('disabling the plugin cancels in-flight processing and revoked tool closures cannot read files',async t=>{
  const {service,path,plugin}=await fixture(t);let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  service.run=async(_,__,{signal})=>{entered();await new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
  const tools=service.tools(event,web),task=tools[0].invoke({source:path});await started;
  service.pluginFor=()=>null;service.cancel(plugin.id);const result=await withTestTimeout(()=>task);assert.equal(result.result.ok,false);assert.equal(service.active.size,0);
  assert.equal((await tools[0].invoke({source:path})).result.ok,false);
  service.pluginFor=()=>plugin;await service.close();assert.equal((await tools[0].invoke({source:path})).result.ok,false);
});

test('web video attachments are opt-in, scoped to their job, and traverse the real Agent queue as image parts',async t=>{
  let turns=0;
  class Model extends AIClient{async completion(messages,_,tools){turns++;if(turns===1){assert.match(JSON.stringify(messages.at(-1).content),/video_ref=attachment:/);const name=tools.find(t=>t.function.name.endsWith('_video_frames')).function.name;return call(name,{start_seconds:0,end_seconds:2,interval_seconds:1,max_frames:2});}assert.equal(messages.at(-1).content.filter(p=>p.type==='image_url').length,2);return {content:'根据两张采样画面完成分析。'};}}
  const bot=await app(t,env,{ai:new Model(config('unused',env).ai)});bot.video.run=fakeRun();
  assert.equal((await request(bot,'/admin/agent/attachments',{name:'clip.mp4',data:mp4.toString('base64')})).data.status,'failed');
  await install(bot);
  const uploaded=(await request(bot,'/admin/agent/attachments',{name:'clip.mp4',data:mp4.toString('base64')})).data;
  assert.equal(uploaded.kind,'video');const reply=await request(bot,'/admin/agent/chat',{attachments:[uploaded.id]});
  await waitFor(()=>bot.store.get(reply.data.job_id).status==='done');assert.equal(turns,2);
  const wrong=await bot.video.tools(event,{id:999,channel:'web'}).find(t=>t.name.endsWith('_video_info')).invoke({source:'attachment:'+uploaded.id});assert.equal(wrong.result.ok,false);
  assert.ok(!bot.store.history('web:'+reply.data.session,5).some(h=>JSON.stringify(h).includes('base64')));
  const run=bot.agent.state.trace(reply.data.job_id).find(s=>s.kind==='tool');assert.match(run.name,/_video_frames$/);assert.equal(run.state,'succeeded');
});

test('actual HTTP transcription protocol handles authentication, audio multipart and JSON response',async t=>{
  const {service,path,plugin,invoke}=await fixture(t);let received=0;
  const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer fixture-key');const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();assert.match(body,/filename="audio.wav"/);assert.match(body,/timestamp_granularities/);received++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'模拟接口结果',segments:[{start:0,end:1,text:'模拟接口结果'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>new Promise(resolve=>server.close(resolve)));
  plugin.config.asr_url='http://127.0.0.1:'+server.address().port+'/v1/audio/transcriptions';plugin.config.asr_api_key='fixture-key';
  const result=await invoke('video_transcript',{source:path,start_seconds:2,end_seconds:4});assert.equal(result.result.ok,true);assert.equal(result.result.segments[0].start_seconds,2);assert.equal(received,1);
});

test('stale video work is cleaned after recovery without deleting active or unrelated directories',async t=>{
  const {service}=await fixture(t);await mkdir(service.root,{recursive:true});
  const old=join(service.root,'task-old'),active=join(service.root,'task-active'),other=join(service.root,'user-files');
  for(const path of [old,active,other]){await mkdir(path);await utimes(path,new Date(0),new Date(0));}
  service.directories.add(active);await service.cleanup();await assert.rejects(access(old));await access(active);await access(other);
  assert.match(service.prompt(event,web),/事实和时间/);service.pluginFor=()=>null;assert.equal(service.prompt(event,web),'');
});

test('cancellation during frame extraction removes partial images before returning',async t=>{
  const {service,path,root}=await fixture(t);let entered;const started=new Promise(resolve=>{entered=resolve;});
  service.run=fakeRun(async(command,__,{signal})=>{if(!command.includes('ffprobe')){entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const controller=new AbortController(),tool=service.tools(event,web).find(t=>t.name==='video_frames'),task=tool.invoke({source:path},controller.signal);await started;controller.abort();
  await assert.rejects(withTestTimeout(()=>task));assert.equal(service.active.size,0);assert.deepEqual(await readdir(join(root,'video-work')),[]);
});
