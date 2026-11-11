import {mkdir,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {VideoService,videoExecutable} from '../../../plugins/video/service.mjs';
import {videoTemplate,videoConfig} from '../../../plugins/video/config.mjs';
import {runProcess} from '../src/computer/process.mjs';
const root=resolve('dist/video-check');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'fixture-'));
let service,server,wavBytes=0;
await writeFile(join(root,'report.json'),JSON.stringify({ok:false,stage:'running'}));
try{
  const c=videoConfig({allowed_roots:[directory]}),path=join(directory,'fixture.mp4');
  const generation=await runProcess(videoExecutable(c,'ffmpeg'),['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','testsrc=size=320x180:rate=5','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','4','-c:v','mpeg4','-q:v','4','-c:a','aac','-shortest','-y',path],{timeout:15000});
  assert.equal(generation.code,0,generation.stderr);
  server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);assert.ok(bytes.includes(Buffer.from('RIFF')));assert.ok(bytes.includes(Buffer.from('WAVE')));wavBytes=bytes.length;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'模拟转写接口验收',segments:[{start:0.25,end:0.75,text:'模拟转写接口验收'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const plugin={...structuredClone(videoTemplate),id:'native-video-check',revision:1,enabled:true,config:{...c,asr_url:'http://127.0.0.1:'+server.address().port+'/audio/transcriptions'}};
  service=new VideoService({config:{dataDir:directory,ai:{visionEnabled:true}}});service.pluginFor=()=>plugin;service.toolName=(_,tool)=>tool.name;
  const tools=service.tools({},{id:1,channel:'web'}),invoke=(name,args)=>tools.find(t=>t.name===name).invoke(args);
  const info=await invoke('video_info',{source:path});assert.equal(info.result.ok,true,JSON.stringify(info));assert.ok(Math.abs(info.result.duration_seconds-4)<0.2);assert.ok(info.result.audio);
  const frames=await invoke('video_frames',{source:path,start_seconds:0,end_seconds:3,interval_seconds:1,max_frames:3});assert.equal(frames.result.ok,true,JSON.stringify(frames));assert.equal(frames.images.length,3);assert.deepEqual(frames.result.frames.map(f=>f.timestamp_seconds),[0,1,2]);
  const transcript=await invoke('video_transcript',{source:path,start_seconds:1,end_seconds:3});assert.equal(transcript.result.ok,true,JSON.stringify(transcript));assert.equal(transcript.result.segments[0].start_seconds,1.25);assert.ok(wavBytes>32000);
  const report={ok:true,real_ffmpeg:true,real_ffprobe:true,real_model:false,asr_endpoint:'simulated',duration_seconds:info.result.duration_seconds,dimensions:[info.result.width,info.result.height],frame_times:frames.result.frames.map(f=>f.timestamp_seconds),images:frames.images.length,audio_uploaded_bytes:wavBytes,transcript_offset_verified:true};
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  await service?.close();if(server)await new Promise(resolve=>server.close(resolve));
  const child=relative(root,resolve(directory));if(!child||child.startsWith('..')||isAbsolute(child))throw Error('Invalid video fixture cleanup path');
  await rm(directory,{recursive:true,force:true,maxRetries:3});
}
