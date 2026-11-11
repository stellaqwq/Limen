import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {asrRoot,readLocalASR,ensureLocalASR,localASRRequest,localVideoPatch} from '../../../plugins/video/asr/local.mjs';
import {videoTemplate,videoConfig} from '../../../plugins/video/config.mjs';
import {VideoService,videoExecutable} from '../../../plugins/video/service.mjs';
import {runProcess} from '../src/computer/process.mjs';

const root=resolve('dist/asr-check');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'fixture-'));
let video;await writeFile(join(root,'report.json'),JSON.stringify({ok:false,status:'running'}));
try{
  const c=await readLocalASR();assert.ok(c);await ensureLocalASR(c);
  const endpoint='http://127.0.0.1:'+c.port+'/v1/audio/transcriptions';
  const request=async(bytes,language='auto')=>{
    const body=new FormData();body.append('file',new Blob([bytes],{type:'audio/wav'}),'public-sample.wav');body.append('model','sensevoice-small-int8');body.append('response_format','verbose_json');body.append('language',language);
    const start=performance.now(),response=await fetch(endpoint,{method:'POST',body,headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(120000)}),result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));return {...result,http_wall_seconds:Math.round((performance.now()-start)/10)/100};
  };
  const samples=[];
  for(const language of ['zh','zh','en']){
    const bytes=await readFile(join(asrRoot,'models/sensevoice/test_wavs/'+language+'.wav')),result=await request(bytes);
    assert.ok(result.text.length>3);assert.ok(result.segments.length>0);assert.equal(result.metrics.provider,'cpu');assert.equal(result.metrics.threads,2);
    samples.push({language,run:samples.length===0?'cold':'warm',...result});
  }
  const silence=Buffer.alloc(44+16000*2*2);silence.write('RIFF');silence.writeUInt32LE(silence.length-8,4);silence.write('WAVEfmt ',8);silence.writeUInt32LE(16,16);silence.writeUInt16LE(1,20);silence.writeUInt16LE(1,22);silence.writeUInt32LE(16000,24);silence.writeUInt32LE(32000,28);silence.writeUInt16LE(2,32);silence.writeUInt16LE(16,34);silence.write('data',36);silence.writeUInt32LE(silence.length-44,40);
  const quiet=await request(silence);assert.equal(quiet.text,'');assert.deepEqual(quiet.segments,[]);
  const config=videoConfig({allowed_roots:[directory],...localVideoPatch(c)}),input=join(directory,'speech.mp4');
  const mux=await runProcess(videoExecutable(config,'ffmpeg'),['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=5','-i',join(asrRoot,'models/sensevoice/test_wavs/zh.wav'),'-c:v','mpeg4','-c:a','aac','-shortest','-y',input],{timeout:15000});assert.equal(mux.code,0,mux.stderr);
  const plugin={...structuredClone(videoTemplate),id:'real-asr-check',revision:1,enabled:true,config};video=new VideoService({config:{dataDir:directory,ai:{visionEnabled:true}}});video.pluginFor=()=>plugin;video.toolName=(_,tool)=>tool.name;
  const tools=video.tools({},{id:1,channel:'web'}),info=await tools.find(t=>t.name==='video_info').invoke({source:input});assert.equal(info.result.ok,true);
  const transcribed=await tools.find(t=>t.name==='video_transcript').invoke({source:input});assert.equal(transcribed.result.ok,true,JSON.stringify(transcribed));assert.ok(transcribed.result.text.length>3);assert.match(transcribed.result.note,/VAD/);
  const loaded=await localASRRequest(c,'/healthz');assert.equal(loaded.worker_loaded,true);
  const unauthorized=await fetch(endpoint,{method:'POST',body:'x'});assert.equal(unauthorized.status,401);
  await localASRRequest(c,'/admin/unload',{});const unloaded=await localASRRequest(c,'/healthz');assert.equal(unloaded.worker_loaded,false);
  assert.throws(()=>process.kill(loaded.worker_pid,0),error=>error.code==='ESRCH');
  const report={ok:true,real_asr:true,model:'sensevoice-small-int8',provider:'cpu',threads:2,model_idle_unload_seconds:c.idle_seconds,samples,silence_skipped:quiet.text==='',loaded_memory:loaded.worker_memory,unloaded_service_memory:unloaded.service_memory,worker_release_verified:true,video_plugin_text:transcribed.result.text,timestamp_source:'vad',authentication_verified:true};
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  await video?.close();const child=relative(root,directory);if(!child||child.startsWith('..')||isAbsolute(child))throw Error('Invalid ASR fixture cleanup path');await rm(directory,{recursive:true,force:true,maxRetries:3});
}
