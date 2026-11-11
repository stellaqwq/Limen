import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext,Script} from 'node:vm';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DouyinAudio,audioStartExpression,audioReadExpression,audioCancelExpression} from '../../../plugins/douyin-web/audio.mjs';
import {DouyinWebService} from '../../../plugins/douyin-web/service.mjs';
import {douyinTemplate,douyinConfig} from '../../../plugins/douyin-web/config.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {Store} from '../src/store.mjs';
import {temp,cleanup,withTestTimeout} from './helpers.mjs';

const token='fixture',page={video_id:'7703905545174140000',media_key:'media'},raw=Buffer.from('actual capture bytes');
const captured={ok:true,status:'captured',mime:'audio/webm;codecs=opus',data:raw.toString('base64'),bytes:raw.length,duration_seconds:3,captured_at:'2026-11-04T00:00:00.000Z',video_start_seconds:2,video_end_seconds:5};
function captureContext(){
  const rect={left:0,top:0,width:800,height:600,right:800,bottom:600},timers=[],intervals=[],tracks=[];let now=0,recorder;
  const track=()=>{const t={muted:false,readyState:'live',stop(){t.stopped=true;t.readyState='ended';},clone:()=>track()};tracks.push(t);return t;};
  class Stream{constructor(t){this.t=t;}getAudioTracks(){return this.t;}getTracks(){return this.t;}}
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(stream,options){recorder=this;this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob([raw])});this.onstop();}
  }
  class Reader{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:audio/webm;base64,'+Buffer.from(buffer).toString('base64');this.onload();});}}
  const video={getBoundingClientRect:()=>rect,paused:false,ended:false,readyState:4,currentTime:2,duration:20,currentSrc:'https://media.example/video',srcObject:null,closest:()=>({className:'video_'+page.video_id,querySelector:()=>null}),captureStream:()=>new Stream([track()])};
  const context={location:new URL('https://www.douyin.com/'),document:{title:'视频',body:{innerText:'普通视频画面'},querySelectorAll:q=>q==='video'?[video]:[]},getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),innerWidth:1280,innerHeight:800,MediaStream:Stream,MediaRecorder:Recorder,FileReader:Reader,Blob,Date,performance:{now:()=>now},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval:()=>{}};
  return {context,video,timers,intervals,tracks,setTime:value=>{now=value;},recorder:()=>recorder};
}

test('fixed video audio operations compile and record only an existing visible video audio track',async()=>{
  for(const expression of [audioStartExpression(token,3,page),audioReadExpression(token),audioCancelExpression(token)])new Script(expression);
  const f=captureContext();const started=runInNewContext(audioStartExpression(token,3,page),f.context);assert.equal(started.ok,true);assert.equal(f.recorder().stream.getTracks().length,1);
  f.setTime(3000);f.video.currentTime=5;f.timers[0]();await withTestTimeout(async()=>{while(!f.context.__xuqiaoAudioCapture.done)await new Promise(resolve=>setImmediate(resolve));});
  const result=runInNewContext(audioReadExpression(token),f.context);assert.equal(result.status,'captured');assert.equal(result.duration_seconds,3);assert.equal(result.data,raw.toString('base64'));assert.ok(f.tracks.every(t=>t.stopped));assert.equal(f.context.__xuqiaoAudioCapture,undefined);
});

test('capture rejects verification and social panels and discards a changed video',async()=>{
  const f=captureContext();f.context.document.body.innerText='安全验证，请完成验证';assert.equal(runInNewContext(audioStartExpression(token,3,page),f.context).ok,false);assert.equal(f.recorder(),undefined);
  const g=captureContext();g.context.document.querySelectorAll=q=>q==='video'?[g.video]:q.includes('im-dialog')?[g.video]:[];assert.equal(runInNewContext(audioStartExpression(token,3,page),g.context).status,'social_panel');
  const h=captureContext();assert.equal(runInNewContext(audioStartExpression(token,3,page),h.context).ok,true);h.setTime(2000);h.video.currentSrc='https://media.example/different';h.intervals[0]();assert.equal(runInNewContext(audioReadExpression(token),h.context).status,'source_changed');assert.ok(h.tracks.every(t=>t.stopped));
});

test('cancelling video audio releases recorder tracks and removes the owned recording state',()=>{
  const f=captureContext();runInNewContext(audioStartExpression(token,3,page),f.context);runInNewContext(audioCancelExpression(token),f.context);assert.equal(f.context.__xuqiaoAudioCapture,undefined);assert.ok(f.tracks.every(t=>t.stopped));
});

function audioService(){
  const service={calls:[],audioReady:()=>true,transcribeAudio:async()=>({text:'真实对白',segments:[{start_seconds:0,end_seconds:1,text:'真实对白'}],model:'fixture',note:'机器识别'}),browser:{async evaluate(expression){service.calls.push(expression);if(expression.includes('const initial='))return {ok:true};if(expression.includes('const result=s.result'))return captured;return {ok:true};}}};return service;
}
test('captured bytes are transcribed with provenance but raw audio and credentials are not returned',async()=>{
  const service=audioService();service.transcribeAudio=async(bytes,metadata)=>{assert.deepEqual(bytes,raw);assert.equal(metadata.mime,captured.mime);return {text:'真实对白',segments:[{start_seconds:0,end_seconds:1,text:'真实对白'}],model:'fixture',note:'机器识别'};};
  const lease=await new DouyinAudio(service).begin({config:{audio_enabled:true,audio_sample_seconds:3}},page,new AbortController().signal),result=await lease.finish({blocked:false,mixed:false});
  assert.equal(result.status,'transcribed');assert.equal(result.audio_sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(result.text,'真实对白');assert.equal(result.segments[0].offset_start_seconds,0);assert.equal(Object.hasOwn(result,'data'),false);assert.equal(Object.hasOwn(result,'bytes'),false);
});

test('disabled, unconfigured, mixed, and failed audio never becomes invented dialogue',async()=>{
  const plugin={config:{audio_enabled:true,audio_sample_seconds:3}},service=audioService();assert.equal(await new DouyinAudio(service).begin({config:{audio_enabled:false}},page),null);
  service.audioReady=()=>false;assert.equal((await (await new DouyinAudio(service).begin(plugin,page)).finish({})).status,'unconfigured');assert.equal(service.calls.length,0);
  service.audioReady=()=>true;let calls=0;service.transcribeAudio=async()=>{calls++;throw Error('Bearer private-key');};
  const mixed=await new DouyinAudio(service).begin(plugin,page,new AbortController().signal);assert.equal((await mixed.finish({mixed:true})).status,'source_changed');assert.equal(calls,0);
  const failed=await new DouyinAudio(service).begin(plugin,page,new AbortController().signal);const result=await failed.finish({});assert.equal(result.status,'transcription_failed');assert.equal(JSON.stringify(result).includes('private-key'),false);
});

test('observation passes captured speech to the model and knowledge while manual previews remain picture-only',async t=>{
  const directory=await temp(t),store=new Store(join(directory,'bot.sqlite'));cleanup(t,()=>store.close());
  const audio=audioService(),browser={running:true,...audio.browser,async screenshot(){return 'data:image/jpeg;base64,/9j/';},async close(){}};const original=browser.evaluate;browser.evaluate=async expression=>expression===snapshotExpression?{url:'https://www.douyin.com/',text:'当前画面',title:'视频',...page,blocked:null,video:{paused:false,ready_state:4,current_seconds:2,duration_seconds:30,width:800,height:600,x:400,y:300}}:original(expression);
  const plugin={...structuredClone(douyinTemplate),id:'audio-plugin',enabled:true,revision:1,config:douyinConfig({audio_enabled:true,audio_sample_seconds:3,knowledge_enabled:true})},service=new DouyinWebService({store,config:{dataDir:directory},browser});service.pluginFor=()=>plugin;service.audioReady=audio.audioReady;service.transcribeAudio=audio.transcribeAudio;cleanup(t,()=>service.close());
  const job={id:1,channel:'web'},invoke=(name,args)=>service.tools({},job).find(t=>t.name===name).invoke(args),observation=await invoke('douyin_web_observe',{frames:1});
  assert.equal(observation.result.audio,true);assert.equal(observation.result.audio_transcript.text,'真实对白');
  const saved=await invoke('video_knowledge_save',{operation_id:'save',observation_id:observation.result.observation_id,kind:'watch_note',title:'有对白的观看记忆',summary:'画面及转写中提供的内容。'});assert.equal(saved.result.item.source.audio,true);assert.equal(saved.result.item.source.transcript.text,'真实对白');assert.equal(service.knowledge.recall(plugin,'观看').includes('真实对白'),true);
  assert.equal(service.knowledge.search(plugin,'真实对白').length,1);
  service.release(job);const before=audio.calls.length;await service.manual('preview');assert.equal(audio.calls.length,before);
});
