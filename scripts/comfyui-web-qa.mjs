import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {launchWorkspace} from './launch.mjs';
import {config} from '../test/helpers.mjs';
import {png} from '../test/image-fixture.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';

const output=resolve('.impeccable/review/comfyui'),root=resolve('dist/comfyui-web-qa');
await mkdir(output,{recursive:true});await mkdir(root,{recursive:true});
const data=await mkdtemp(join(root,'data-')),profile=await mkdtemp(join(root,'chrome-'));
let workspace,browser,socket,sequence=0;const pending=new Map(),errors=[],checks=[];
function send(method,params={}){
  const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},12000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('UI condition: '+expression);}
const click=id=>evaluate('document.getElementById('+JSON.stringify(id)+').click()');
const value=(id,v)=>evaluate('(()=>{const n=document.getElementById('+JSON.stringify(id)+');n.value='+JSON.stringify(v)+';n.dispatchEvent(new Event("input",{bubbles:true}));})()');
const link=route=>evaluate('document.querySelector(\'[data-plugin-view="'+route+'"]\').click()');
const shortcut=kind=>evaluate('document.querySelector(\'[data-plugin-kind="'+kind+'"] button\').click()');
async function selected(route){
  await wait('location.hash==="#'+route+'"&&!document.getElementById("view-extensions").hidden');
  assert.equal(await evaluate('document.querySelector(".nav [aria-current=page]").dataset.view'),'extensions');
  assert.equal(await evaluate('document.querySelector("[data-plugin-view][aria-current=page]").dataset.pluginView'),route);
  assert.equal(await evaluate('document.getElementById("'+(route==='extensions'?'plugin-home':'view-'+route)+'").hidden'),false);
}
async function capture(width,name){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=680});
  await evaluate('window.scrollTo(0,0);document.getElementById("toast").hidden=true');await delay(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no overflow '+width);
  const size=(await send('Page.getLayoutMetrics')).cssContentSize;
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:size.width,height:size.height,scale:1}});
  await writeFile(join(output,name+'.png'),Buffer.from(shot.data,'base64'));
}
try{
  await writeFile(join(output,'report.json'),JSON.stringify({success:false,status:'running'}));
  workspace=await launchWorkspace(config(data));
  browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-component-update','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'
  ],{windowsHide:true,stdio:'ignore'});
  browser.on('error',error=>errors.push(error.message));let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome available');const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  socket.on('message',bytes=>{const m=JSON.parse(bytes);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);});
  await once(socket,'open');await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:workspace.url+'#extensions'});

  await wait('document.querySelectorAll(".plugin-hub-row").length===9');
  await capture(1440,'hub-desktop');await capture(390,'hub-mobile');
  await shortcut('comfyui');await wait('document.getElementById("plugin-name").value==="ComfyUI 生图"');
  const plugin=workspace.app.plugins.rows().find(p=>p.kind==='comfyui');assert.equal(plugin.enabled,false);
  for(const width of [1440,390,320]){
    await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="工作流").click()');
    await capture(width,'workflow-'+width);
  }
  assert.equal(await evaluate('document.getElementById("plugin-field-use_workflow").checked'),false);
  await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="批量与队列").click()');
  assert.equal(await evaluate('document.getElementById("plugin-field-max_tasks").value'),'8');
  for(const width of [1440,390,320])await capture(width,'batch-settings-'+width);
  await evaluate('document.querySelector(\'[aria-label="启用插件 ComfyUI 生图"]\').click()');
  await wait('document.querySelector(\'[aria-label="停用插件 ComfyUI 生图"]\')');
  checks.push('nine plugin destinations; ComfyUI installs disabled, grouped workflow fields fit 1440/390/320, and web-only enable succeeds');
  const session='11111111-1111-4111-8111-111111111111',event={self_id:0,user_id:0,message_id:'comfy-qa',post_type:'message',message_type:'private',message:[{type:'text',data:{text:'画一只白猫'}}]};
  const job=workspace.app.store.ingest(event,'画一只白猫',100,null,session);
  workspace.app.store.update(job.id,'done',{reply:'图片已生成。'});
  const image=await readFile('D:/ComfyUI/output/Anima_00001_.png'),images=join(data,'comfyui-images');
  await mkdir(images,{recursive:true});const files=[];
  for(let index=1;index<=2;index++){const file='11111111-1111-4111-8111-11111111111'+index+'.png';await writeFile(join(images,file),image);files.push({file,mime:'image/png',item_index:index-1});}
  workspace.app.store.db.prepare('INSERT INTO comfyui_generations(job_id,plugin_id,prompt_id,base_url,state,files,created_at) VALUES (?,?,?,?,?,?,?)').run(job.id,plugin.id,'qa','http://192.168.1.2:8188','ready',JSON.stringify(files),Date.now());
  for(let index=0;index<2;index++)workspace.app.store.db.prepare('INSERT INTO comfyui_generation_items(job_id,item_index,prompt_id,state,files) VALUES (?,?,?,?,?)').run(job.id,index,'qa-'+index,'ready',JSON.stringify([files[index]]));
  await evaluate('agentChatSession='+JSON.stringify(session)+';localStorage.setItem("qq-agent-web-session",agentChatSession);');
  await click('test-chat-entry');await evaluate('loadAgentChat()');
  await wait('document.querySelector("#agent-chat-feed img")?.naturalWidth===512');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#agent-chat-feed img")].map(i=>i.closest("a").download)'),[1,2].map(index=>'comfyui-'+job.id+'-'+index+'.png'));
  assert.equal(await evaluate('document.querySelector("#agent-chat-feed").textContent.includes("2/2")'),true);
  for(const width of [1440,390,320]){await evaluate('document.getElementById("agent-chat-feed").scrollTop=99999');await capture(width,'generated-image-'+width);}
  checks.push('batch settings and two numbered 512px cached image previews with 2/2 progress fit desktop and mobile widths');
  assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({success:true,checks,errors},null,2));console.log(JSON.stringify({success:true,checks}));
}catch(error){
  try{console.error(JSON.stringify({uiError:await evaluate('({pluginError:document.getElementById("plugin-error").textContent,androidMessage:document.getElementById("agent-android-message").textContent,pluginBusy,pluginDirty})')}));await capture(390,'failure');}catch{}
  throw error;
}finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('QA closed'));}socket?.terminate();
  if(browser&&browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited;}
  await workspace?.close();
  for(const path of [data,profile]){const child=relative(root,path);assert.ok(child&&!child.startsWith('..')&&!isAbsolute(child));await rm(path,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
