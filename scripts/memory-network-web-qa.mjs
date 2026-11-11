import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {launchWorkspace} from './launch.mjs';
import {config} from '../test/helpers.mjs';

const output=resolve('.impeccable/review/memory-network'),root=resolve('dist/memory-network-web-qa');
await mkdir(output,{recursive:true});await mkdir(root,{recursive:true});
const data=await mkdtemp(join(root,'data-')),profile=await mkdtemp(join(root,'chrome-'));
let workspace,browser,socket,sequence=0;const pending=new Map(),errors=[],checks=[];
function send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('UI condition: '+expression);}
const click=id=>evaluate('document.getElementById('+JSON.stringify(id)+').click()');
const value=(id,v)=>evaluate('(()=>{const n=document.getElementById('+JSON.stringify(id)+');n.value='+JSON.stringify(v)+';n.dispatchEvent(new Event("input",{bubbles:true}));})()');
async function capture(width,name){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=680});
  await evaluate('window.scrollTo(0,0);document.getElementById("toast").hidden=true');await delay(400);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no overflow '+width);
  const size=(await send('Page.getLayoutMetrics')).cssContentSize;
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});
  await writeFile(join(output,name+'.png'),Buffer.from(shot.data,'base64'));
}
try{
  await writeFile(join(output,'report.json'),JSON.stringify({success:false,status:'running'}));
  workspace=await launchWorkspace(config(data,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001,10002'}));
  let plugin=await workspace.app.plugins.install({kind:'living-memory'});
  plugin=await workspace.app.plugins.save({id:plugin.id,revision:plugin.revision,plugin:{...plugin,scope:{...plugin.scope,private_users:['10001','10002']},config:{...plugin.config,auto_summarize:false}}});
  const save=(key,content,type='fact',scope='10000:private:10001')=>workspace.app.plugins.admin('memory').action({action:'save',plugin_revision:plugin.revision,scope,persona:'',key,content,type,tags:[]});
  browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
    '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',
    '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'
  ],{windowsHide:true,stdio:'ignore'});browser.on('error',error=>errors.push(error.message));let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome available');const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  socket.on('message',bytes=>{const m=JSON.parse(bytes);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);});
  await once(socket,'open');await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:workspace.url+'#memory'});
  await wait('document.getElementById("memory-canvas").dataset.renderer==="webgl"&&document.getElementById("memory-canvas").dataset.edges==="0"');
  assert.equal(await evaluate('document.querySelector(".nav [aria-current=page]").dataset.view'),'extensions');
  assert.equal(await evaluate('document.getElementById("memory-stage-empty").hidden'),false);await capture(1440,'empty-desktop');
  const fixtures=[['饮品偏好','喜欢茉莉花茶，不太喜欢太甜的饮料。','preference'],['正在做的项目','正在开发一个本地 QQ 智能助手。','fact'],['周末计划','周末想去植物园拍照。','plan'],['交流风格','喜欢简洁直接的解释，也愿意听有趣的延伸。','preference'],['朋友小林','小林是一起研究开源项目的朋友。','relationship'],['上周的分享','上周完成了一次关于本地 AI 的分享。','event'],['创意笔记','想把零散的灵感整理成可搜索的笔记。','fact'],['喜欢的音乐','工作时喜欢轻音乐。','preference'],['下一步','准备为机器人补充更好的记忆管理。','plan'],['合作伙伴','与同事一起维护项目文档。','relationship'],['植物观察','开始记录窗台植物的生长。','event'],['学习方向','正在学习计算机图形学。','fact'],['习惯','习惯先了解原理，再动手实现。','preference'],['新想法','让记忆像神经连接一样逐渐生长。','fact'],['旅行计划','准备一次轻松的短途旅行。','plan'],['项目里程碑','已经完成基础消息流程和插件系统。','event']];
  for(const row of fixtures)await save(...row);
  await save('另一位用户','此内容只属于用户 10002。','fact','10000:private:10002');
  await click('memory-refresh');await wait('document.getElementById("memory-canvas").dataset.edges==="16"');
  await delay(850);await click('memory-motion');
  const pixels=await evaluate('(()=>{memoryScene.render();const gl=memoryScene.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);let lit=0;for(let i=0;i<p.length;i+=4)if(p[i]>35||p[i+1]>35||p[i+2]>50)lit++;return {lit,error:gl.getError(),nodes:memoryScene.graph.nodes.length,edges:memoryScene.graph.edges.length};})()');
  assert.equal(pixels.error,0);assert.ok(pixels.lit>150);assert.equal(pixels.nodes,17);checks.push('real software WebGL frame, zero fake memories and one edge per stored memory');
  await evaluate('document.getElementById("memory-canvas").scrollIntoView({block:"center"})');
  const target=await evaluate('(()=>{const n=memoryScene.graph.nodes.filter(n=>n.id!=="__root__").map(n=>({id:n.id,...memoryScene.screenPoint(n.id)}));const r=document.getElementById("memory-canvas").getBoundingClientRect();return n.find(p=>p.x>r.left+25&&p.x<r.right-25&&p.y>r.top+75&&p.y<r.bottom-75);})()');assert.ok(target);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
  await wait('memorySelected!==null');assert.equal(await evaluate('document.getElementById("memory-detail").hidden'),false);
  const before=await evaluate('({yaw:memoryScene.yaw,distance:memoryScene.distance})');
  await evaluate('document.getElementById("memory-canvas").focus()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight'});
  assert.ok(await evaluate('memoryScene.yaw')>before.yaw);await click('memory-zoom-in');assert.ok(await evaluate('memoryScene.distance')<before.distance);await click('memory-camera-reset');
  checks.push('canvas point selection, keyboard rotation, zoom, reset and pause');
  await click('memory-create');await value('memory-name','【模拟】新增连接');await value('memory-body','每增加一条记忆，就新增一条对应连接。');await click('memory-save');
  await wait('document.getElementById("memory-canvas").dataset.edges==="17"&&!document.getElementById("memory-save").disabled');
  await click('memory-edit');await value('memory-name','【模拟】已编辑连接');await click('memory-save');await wait('document.getElementById("memory-detail-title").textContent==="【模拟】已编辑连接"');
  assert.equal(await evaluate('memoryScene.graph.edges.length'),17);
  await click('memory-archive');await wait('document.getElementById("memory-archive").textContent==="恢复记忆"');
  await value('memory-status','archived');await evaluate('document.getElementById("memory-status").dispatchEvent(new Event("change"))');assert.equal(await evaluate('memoryScene.graph.edges.length'),1);
  await value('memory-status','all');await evaluate('document.getElementById("memory-status").dispatchEvent(new Event("change"))');
  await click('memory-delete');await wait('document.getElementById("confirm-dialog").open');await click('confirm-ok');await wait('document.getElementById("memory-canvas").dataset.edges==="16"');
  await value('memory-scope','10000:private:10002');await evaluate('document.getElementById("memory-scope").dispatchEvent(new Event("change"))');await wait('document.getElementById("memory-canvas").dataset.edges==="1"');
  assert.match(await evaluate('document.getElementById("memory-list").textContent'),/只属于用户 10002/);
  await value('memory-scope','10000:private:10001');await evaluate('document.getElementById("memory-scope").dispatchEvent(new Event("change"))');await wait('document.getElementById("memory-canvas").dataset.edges==="16"');
  checks.push('create grows one edge, edit preserves count, archive/filter/delete synchronize, scopes remain isolated');
  await evaluate('document.querySelector(".memory-list-row").click()');await wait('!document.getElementById("memory-detail").hidden');
  for(const width of [1440,1024,768,680,390,320])await capture(width,width===1440?'desktop':width===390?'mobile':'width-'+width);
  await click('memory-edit');await value('memory-body','未保存的记忆草稿');
  await evaluate('location.hash="extensions"');await wait('memoryScene.active===false');assert.equal(await evaluate('memoryScene.frame'),0);
  await evaluate('location.hash="memory"');await wait('memoryScene.active===true');assert.equal(await evaluate('document.getElementById("memory-body").value'),'未保存的记忆草稿');
  await click('memory-cancel');checks.push('six responsive widths, idle renderer off-page and retained editing draft');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await send('Page.reload');
  await wait('memoryScene&&memoryScene.paused&&document.getElementById("memory-canvas").dataset.edges==="16"');assert.equal(await evaluate('memoryScene.frame'),0);
  checks.push('reduced-motion starts parked with complete geometry');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'const nativeContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==="webgl"?null:nativeContext.call(this,kind,...args);};'});
  await send('Page.reload');await wait('!document.getElementById("memory-stage-fallback").hidden&&document.querySelectorAll(".memory-list-row").length===16');
  await evaluate('document.querySelector(".memory-list-row").click()');await wait('!document.getElementById("memory-detail").hidden');
  checks.push('WebGL-unavailable fallback retains list selection and full memory detail');assert.deepEqual(errors,[]);
  await writeFile(join(output,'report.json'),JSON.stringify({success:true,checks,pixels,errors,rendering:'Chromium software WebGL (SwiftShader), isolated demo data'},null,2));
  console.log(JSON.stringify({success:true,checks,pixels}));
}catch(error){let diagnostic;try{diagnostic=await evaluate('({sceneError:memoryScene?.error,failed:memoryScene?.failed,active:memoryScene?.active,renderer:document.getElementById("memory-canvas").dataset.renderer,edges:document.getElementById("memory-canvas").dataset.edges,message:document.getElementById("memory-error").textContent})');await capture(1440,'failure-desktop');}catch{}console.log(JSON.stringify({diagnostic,errors}));await writeFile(join(output,'report.json'),JSON.stringify({success:false,message:error.message,diagnostic,errors,checks},null,2));throw error;}
finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('QA closed'));}socket?.terminate();if(browser&&browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited;}await workspace?.close();for(const path of [data,profile]){const child=relative(root,path);assert.ok(child&&!child.startsWith('..')&&!isAbsolute(child));await rm(path,{recursive:true,force:true,maxRetries:10,retryDelay:200});}}
