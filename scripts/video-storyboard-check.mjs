import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {VideoService} from '../../../plugins/video/service.mjs';
import {videoConfig,videoTemplate} from '../../../plugins/video/config.mjs';
import {runProcess} from '../src/computer/process.mjs';
import {imageInfo} from '../src/qq/kernel/image.mjs';

const root=resolve('dist/video-storyboard-check');await mkdir(root,{recursive:true});
await writeFile(join(root,'report.json'),JSON.stringify({ok:false,stage:'running'}));
const c=videoConfig({allowed_roots:[root],ffmpeg_path:process.env.VIDEO_CHECK_FFMPEG||'',ffprobe_path:process.env.VIDEO_CHECK_FFPROBE||''});
let service,server,uploads=0;
try{
  const {videoExecutable}=await import('../../../plugins/video/service.mjs');
  const ffmpeg=videoExecutable(c,'ffmpeg'),source=join(root,'fixture.mp4');
  const generated=await runProcess(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=20','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','8','-c:v','mpeg4','-q:v','4','-c:a','aac','-shortest','-y',source],{timeout:20000});
  assert.equal(generated.code,0,generated.stderr);
  server=createServer(async(req,res)=>{for await(const chunk of req)assert.ok(chunk.length);uploads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'模拟接口对白，仅用于验收',segments:[{start:0,end:1,text:'模拟接口对白，仅用于验收'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const plugin={...structuredClone(videoTemplate),id:'real-check',revision:1,enabled:true,config:{...c,asr_url:'http://127.0.0.1:'+server.address().port+'/transcriptions'}};
  service=new VideoService({config:{dataDir:root,ai:{visionEnabled:true}},run:runProcess});service.pluginFor=()=>plugin;service.toolName=(_,t)=>t.name;
  const invoke=(name,args={})=>service.tools({},{id:1,channel:'web'}).find(t=>t.name===name).invoke({source,...args});
  const sheet=await invoke('video_storyboard',{cells:9,transcript:'auto'});assert.equal(sheet.result.ok,true,JSON.stringify(sheet));assert.equal(sheet.images.length,1);assert.equal(uploads,1);
  assert.equal(sheet.result.scan.status,'ok');assert.equal(sheet.result.audio.status,'envelope_only');
  const output=Buffer.from(sheet.images[0].split(',')[1],'base64');await writeFile(join(root,'storyboard.jpg'),output);
  assert.equal(imageInfo(output).width,sheet.result.image.width);assert.equal(imageInfo(output).height,sheet.result.image.height);
  for(const cell of sheet.result.cells)assert.ok(cell.timestamp_seconds>=cell.start_seconds-0.1&&cell.timestamp_seconds<cell.end_seconds);
  const zoom=await invoke('video_zoom',{start_seconds:2,end_seconds:4,cells:4});assert.equal(zoom.result.ok,true,JSON.stringify(zoom));assert.equal(zoom.result.analysis_cached,true);assert.equal(uploads,1);
  await writeFile(join(root,'zoom.jpg'),Buffer.from(zoom.images[0].split(',')[1],'base64'));
  // A real portrait container with nonzero timestamps exercises seek origin
  // normalization and verifies the sheet's letterboxing path.
  const portrait=join(root,'portrait.mkv');
  const rendered=await runProcess(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-t','3','-i','testsrc2=size=180x320:rate=10','-vf','setpts=PTS+5/TB','-c:v','mpeg4','-y',portrait],{timeout:20000});assert.equal(rendered.code,0,rendered.stderr);
  const vertical=await invoke('video_storyboard',{source:portrait,start_seconds:0,end_seconds:2,cells:4});assert.equal(vertical.result.ok,true,JSON.stringify(vertical));
  assert.ok(Math.abs(vertical.result.total_duration_seconds-3)<0.1);assert.ok(vertical.result.cells.every(c=>c.timestamp_seconds<2));
  await writeFile(join(root,'portrait.jpg'),Buffer.from(vertical.images[0].split(',')[1],'base64'));
  const report={ok:true,real_ffmpeg:true,real_ffprobe:true,real_model:false,asr:'local_mock',uploads,storyboard:{...sheet.result,images:1,bytes:output.length},zoom:zoom.result,portrait:vertical.result};
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,cells:9,images:1,bytes:output.length,timestamps:sheet.result.cells.map(c=>c.timestamp_seconds),zoom_cached:true,portrait:true,real_model:false}));
}finally{await service?.close();if(server)await new Promise(resolve=>server.close(resolve));}
