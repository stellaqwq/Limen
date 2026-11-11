import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {VideoService} from '../../../plugins/video/service.mjs';
import {videoConfig,videoTemplate} from '../../../plugins/video/config.mjs';
import {sceneCandidates,planCells,sharpness} from '../../../plugins/video/storyboard.mjs';
import {AIClient} from '../src/ai.mjs';
import {AgentState} from '../src/agent/state.mjs';
import {Store} from '../src/store.mjs';
import {temp,cleanup,config,app,request,waitFor} from './helpers.mjs';

const mp4=Buffer.from('000000186674797069736f6d0000020069736f6d6d703432','hex');
const jpeg=Buffer.from('ffd8ffc000110800b4014003011100021101031100ffd9','hex');
const web={id:1,channel:'web'},env={AI_ENABLED:'true',AI_MODEL:'storyboard-test',AI_ALLOWED_USERS:'10001'};
function solid(width,height,color){const b=Buffer.alloc(width*height*3);for(let i=0;i<b.length;i+=3){b[i]=color[0];b[i+1]=color[1];b[i+2]=color[2];}return b;}
function fakeMedia({audio=true,duration=100}={}){
  const calls=[];
  const run=async(command,args,options)=>{
    calls.push({command,args,options});options.signal?.throwIfAborted();
    if(command.includes('ffprobe'))return {code:0,stdout:JSON.stringify({format:{duration:String(duration)},streams:[{codec_type:'video',width:320,height:180,avg_frame_rate:'25/1'},...(audio?[{codec_type:'audio'}]:[])]}),stderr:''};
    const vf=args[args.indexOf('-vf')+1]||'';
    if(vf.startsWith('fps='))return {code:0,stdout:Buffer.concat([solid(64,36,[255,0,0]),solid(64,36,[255,0,0]),solid(64,36,[0,0,255])]),stderr:''};
    if(args.includes('f32le')){const b=Buffer.alloc(400);for(let i=0;i<100;i++)b.writeFloatLE(i<50?0:0.5,i*4);return {code:0,stdout:b,stderr:''};}
    if(args.includes('mjpeg')){assert.ok(Buffer.isBuffer(options.input));return {code:0,stdout:jpeg,stderr:''};}
    if(args.at(-1).endsWith('.wav')){await writeFile(args.at(-1),Buffer.from('RIFF0000WAVE'));return {code:0,stdout:'',stderr:''};}
    const [,w,h]=/^scale=(\d+):(\d+)/.exec(vf),requested=Number(args[args.indexOf('-ss')+1]);
    return {code:0,stdout:solid(+w,+h,[60,100,180]),stderr:'pts_time:'+(requested+0.025)};
  };
  return {run,calls};
}
async function fixture(t,options={}){
  const root=await temp(t),path=join(root,'clip.mp4');await writeFile(path,mp4);
  const plugin={...structuredClone(videoTemplate),id:'storyboard',revision:1,enabled:true,config:videoConfig({allowed_roots:[root]})};
  const media=fakeMedia(options),service=new VideoService({config:config(root,env),run:media.run});
  service.pluginFor=()=>plugin;service.toolName=(_,t)=>t.name;cleanup(t,()=>service.close());
  const invoke=(name,args={},signal)=>service.tools({},web).find(t=>t.name===name).invoke({source:path,...args},signal);
  return {service,plugin,media,invoke,path};
}

test('color changes are detected, coverage spans the requested window and blurry candidates lose',()=>{
  const red=solid(64,36,[255,0,0]),blue=solid(64,36,[0,0,255]);
  assert.ok(sceneCandidates(Buffer.concat([red,red,blue,blue]),{start:10,end:12,fps:2}).some(c=>c.timestamp_seconds===11));
  assert.equal(sceneCandidates(Buffer.concat([red,red,red]),{start:0,end:3,fps:1}).length,0);
  const plan=planCells({start:20,end:80,cells:9,candidates:[{timestamp_seconds:22,score:1},{timestamp_seconds:23,score:2}]});
  assert.equal(plan[0].start_seconds,20);assert.equal(plan.at(-1).end_seconds,80);
  for(const [i,c] of plan.entries()){assert.ok(c.representative_seconds>=c.start_seconds&&c.representative_seconds<c.end_seconds);if(i)assert.equal(c.start_seconds,plan[i-1].end_seconds);}
  const sharp=solid(20,20,[100,100,100]);for(let y=0;y<20;y++)for(let x=0;x<20;x++)if((x+y)%2)sharp.fill(255,(y*20+x)*3,(y*20+x)*3+3);
  assert.ok(sharpness(sharp,20,20)>sharpness(solid(20,20,[100,100,100]),20,20));
});

test('one indexed sheet reaches the model with actual timestamps; zoom reuses analysis and evicts older images',async t=>{
  const f=await fixture(t);let turns=0;
  const call=(name,args)=>({tool_calls:[{id:'call'+turns,type:'function',function:{name,arguments:JSON.stringify({source:f.path,...args})}}]});
  class Model extends AIClient{async completion(messages){
    if(++turns===1)return call('video_storyboard',{start_seconds:0,end_seconds:60,cells:9});
    const parts=messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);assert.equal(parts.filter(p=>p.type==='image_url').length,1);
    const result=JSON.parse(messages.findLast(m=>m.role==='tool').content);assert.ok(result.cells[0].timestamp_seconds>result.cells[0].requested_seconds);assert.equal(result.cells.length,turns===2?9:4);
    return turns===2?call('video_zoom',{start_seconds:10,end_seconds:15}):{content:'已根据宫格及局部回看分析。'};
  }}
  const tools=f.service.tools({},web);
  assert.equal(await new Model(config('unused',env).ai).reply('看视频',[],undefined,{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}})),invokeTool:f.invoke,maxSteps:4}),'已根据宫格及局部回看分析。');
  assert.equal(f.media.calls.filter(c=>String(c.args[c.args.indexOf('-vf')+1]).startsWith('fps=')).length,1);
  assert.equal(f.media.calls.filter(c=>c.args.includes('f32le')).length,1);
  assert.equal(f.media.calls.filter(c=>c.args.at(-1).endsWith('.wav')).length,0);
  f.service.release(web);assert.equal(f.service.cache.size,0);
});

test('storyboard metadata and continuation stay bounded and images are transient through AgentState',async t=>{
  const f=await fixture(t,{duration:240}),store=new Store(':memory:');cleanup(t,()=>store.close());
  const state=new AgentState(store),tool=f.service.tools({},web).find(t=>t.name==='video_storyboard');
  const result=await state.invoke(web,tool,{source:f.path,cells:16});
  assert.equal(result.result.ok,true);assert.equal(result.images.length,1);assert.equal(result.result.next_start_seconds,120);
  assert.equal(result.result.cells.at(-1).end_seconds,120);assert.equal(result.result.transcript.status,'off');assert.equal(result.result.scan.sampled,true);
  assert.ok(Buffer.byteLength(JSON.stringify({...result,images:undefined}))<32768);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM agent_receipts').get().n,0);
  for(const args of [{cells:17},{cells:0},{start_seconds:120,end_seconds:100},{start_seconds:0,end_seconds:121}])assert.equal((await f.invoke('video_storyboard',args)).result.ok,false);
  assert.equal((await f.invoke('video_zoom')).result.ok,false);
  f.service.config.ai.visionEnabled=false;assert.deepEqual(f.service.tools({},web).map(t=>t.name),['video_info','video_transcript']);
});

test('ASR is explicit, sliced to 45 seconds, timestamped against the video and cached',async t=>{
  const f=await fixture(t),requests=[];f.plugin.config.asr_url='http://127.0.0.1/asr';
  f.service.fetcher=async(url,options)=>{requests.push(options.body);return new Response(JSON.stringify({text:'真实接口对白',segments:[{start:0,end:1,text:'真实接口对白'}]}));};
  const result=await f.invoke('video_storyboard',{start_seconds:10,end_seconds:100,cells:4,transcript:'auto'});
  assert.equal(result.result.ok,true);assert.equal(requests.length,2);assert.equal(result.result.transcript.status,'timestamped');
  assert.equal(result.result.cells[0].dialogue,'真实接口对白');assert.equal(result.result.cells[2].dialogue,'真实接口对白');
  await f.invoke('video_storyboard',{start_seconds:10,end_seconds:100,cells:4,transcript:'auto'});assert.equal(requests.length,2);
  const offsets=f.media.calls.filter(c=>c.args.at(-1).endsWith('.wav')).map(c=>Number(c.args[c.args.indexOf('-ss')+1]));assert.deepEqual(offsets,[10,55]);
});

test('silent, unconfigured, untimed and failed speech do not invent per-cell dialogue',async t=>{
  const silent=await fixture(t,{audio:false});const a=await silent.invoke('video_storyboard',{cells:1,transcript:'auto'});assert.equal(a.result.audio.status,'no_audio');assert.equal(a.result.transcript.status,'no_audio');
  const f=await fixture(t);assert.equal((await f.invoke('video_storyboard',{cells:1,transcript:'auto'})).result.transcript.status,'not_configured');
  f.plugin.config.asr_url='http://127.0.0.1/asr';f.service.fetcher=async()=>new Response(JSON.stringify({text:'没有逐句时间'}));
  const untimed=await f.invoke('video_storyboard',{cells:1,transcript:'auto'});assert.equal(untimed.result.transcript.status,'text_without_timestamps');assert.equal(untimed.result.cells[0].dialogue,'');
  f.service.release(web);f.service.fetcher=async()=>{throw Error('secret-key');};
  const failed=await f.invoke('video_storyboard',{cells:1,transcript:'auto'});assert.equal(failed.result.ok,true);assert.equal(failed.result.transcript.status,'failed');assert.ok(!JSON.stringify(failed).includes('secret-key'));
});

test('scan failures degrade honestly; cancellation and revoked closures stop visual work',async t=>{
  const f=await fixture(t),original=f.service.run;
  f.service.run=async(command,args,options)=>String(args[args.indexOf('-vf')+1]).startsWith('fps=')?{code:1,stderr:'bad scan'}:original(command,args,options);
  const fallback=await f.invoke('video_storyboard',{cells:1});assert.equal(fallback.result.ok,true);assert.equal(fallback.result.scan.status,'failed');assert.match(fallback.result.warnings.join(''),/均匀覆盖/);
  const tool=f.service.tools({},web).find(t=>t.name==='video_storyboard');f.service.pluginFor=()=>null;assert.equal((await tool.invoke({source:f.path})).result.ok,false);
  f.service.pluginFor=()=>f.plugin;f.service.release(web);let entered;const started=new Promise(resolve=>{entered=resolve;});
  f.service.run=async(command,args,options)=>{if(command.includes('ffprobe'))return original(command,args,options);entered();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));};
  const controller=new AbortController(),pending=f.invoke('video_storyboard',{cells:1},controller.signal);await started;controller.abort();await assert.rejects(pending);assert.equal(f.service.active.size,0);
});

test('stored v1 plugins expose v2 defaults and tools without losing scope or ASR configuration',async t=>{
  const bot=await app(t,env),p=await bot.plugins.install({kind:'video-analysis'}),legacy={...p,version:'1.0.0',config:{...p.config,asr_url:'http://127.0.0.1/asr'}};
  delete legacy.config.storyboard_cells;delete legacy.config.storyboard_cell_width;delete legacy.config.storyboard_scan;legacy.tools=legacy.tools.slice(0,3);
  bot.store.db.prepare('UPDATE plugins SET definition=? WHERE id=?').run(JSON.stringify(legacy),p.id);
  const upgraded=bot.plugins.get(p.id);assert.equal(upgraded.version,'2.0.0');assert.equal(upgraded.tools.length,5);assert.equal(upgraded.config.storyboard_cells,9);assert.equal(upgraded.config.asr_url,legacy.config.asr_url);assert.deepEqual(upgraded.scope,p.scope);
});

test('probe normalizes a nonzero stream origin and phone rotation metadata',async t=>{
  const f=await fixture(t);f.service.run=async()=>({code:0,stdout:JSON.stringify({format:{duration:'8',start_time:'5'},streams:[{codec_type:'video',width:320,height:180,start_time:'5',avg_frame_rate:'10/1',side_data_list:[{rotation:90}]}]}),stderr:''});
  const result=await f.invoke('video_info');assert.equal(result.result.duration_seconds,3);assert.equal(result.result.width,180);assert.equal(result.result.height,320);assert.ok(!Object.hasOwn(result.result,'origin'));
});

test('uploaded video uses storyboard through the authenticated web Agent queue',async t=>{
  let turns=0;
  class Model extends AIClient{async completion(messages,signal,tools){
    if(++turns===1){assert.match(JSON.stringify(messages.at(-1).content),/video_storyboard/);const name=tools.find(t=>t.function.name.endsWith('_video_storyboard')).function.name;return {tool_calls:[{id:'sheet',type:'function',function:{name,arguments:'{"cells":4}'}}]};}
    assert.equal(messages.at(-1).content.filter(p=>p.type==='image_url').length,1);assert.match(JSON.stringify(messages),/格 4/);return {content:'已经观察视频分镜。'};
  }}
  const bot=await app(t,env,{ai:new Model(config('unused',env).ai)});bot.video.run=fakeMedia({duration:10}).run;
  let p=await bot.plugins.install({kind:'video-analysis'});await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
  const upload=(await request(bot,'/admin/agent/attachments',{name:'clip.mp4',data:mp4.toString('base64')})).data;
  const chat=(await request(bot,'/admin/agent/chat',{attachments:[upload.id]})).data;await waitFor(()=>bot.store.get(chat.job_id).status==='done');assert.equal(turns,2);
  assert.equal(bot.agent.state.trace(chat.job_id).find(s=>s.kind==='tool').state,'succeeded');
});
