import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {launchWorkspace} from './launch.mjs';
import {config} from '../test/helpers.mjs';

const output=resolve('.impeccable/review/emotion'),root=resolve('dist/emotion-web-qa');
await mkdir(output,{recursive:true});await mkdir(root,{recursive:true});
const data=await mkdtemp(join(root,'data-')),profile=await mkdtemp(join(root,'chrome-'));
let workspace,browser,socket,sequence=0;const pending=new Map(),errors=[],checks=[];
function send(method,params={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},12000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function wait(expression) {
  for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}
  throw Error('UI condition: '+expression);
}
const click=id=>evaluate('document.getElementById('+JSON.stringify(id)+').click()');
const value=(id,value)=>evaluate('(()=>{const n=document.getElementById('+JSON.stringify(id)+');n.value='+JSON.stringify(value)+';n.dispatchEvent(new Event("input",{bubbles:true}));})()');
async function capture(width) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<681});
  await evaluate('document.getElementById("plugin-config-fields").scrollIntoView({block:"start"});document.getElementById("toast").hidden=true');await delay(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no overflow at '+width);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(output,'config-'+width+'.png'),Buffer.from(shot.data,'base64'));
}
try {
  await writeFile(join(output,'report.json'),JSON.stringify({success:false,status:'running'}));
  workspace=await launchWorkspace(config(data));
  browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-component-update','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'
  ],{windowsHide:true,stdio:'ignore'});
  browser.on('error',error=>errors.push(error.message));let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome available');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  socket.on('message',bytes=>{
    const message=JSON.parse(bytes);
    if(message.id){const p=pending.get(message.id);if(!p)return;clearTimeout(p.timer);pending.delete(message.id);if(message.error)p.reject(Error(message.error.message));else p.resolve(message.result);}
    else if(message.method==='Runtime.exceptionThrown')errors.push(message.params);
  });
  await once(socket,'open');await send('Page.enable');await send('Runtime.enable');
  await send('Page.navigate',{url:workspace.url+'#plugins'});
  await wait('document.getElementById("plugin-builtin-kind").querySelector(\'option[value="psychodynamic-emotion"]\')&&!document.getElementById("plugin-builtin-install").disabled');
  await value('plugin-builtin-kind','psychodynamic-emotion');await click('plugin-builtin-install');
  await wait('document.getElementById("plugin-name").value.includes("心绪")&&!document.getElementById("plugin-save").disabled');
  assert.equal(workspace.app.plugins.rows()[0].enabled,false);
  await value('plugin-name','心绪 · 模拟验证');await value('plugin-users','10001');await value('plugin-field-intensity','0.8');
  await click('plugin-save');await wait('document.getElementById("plugin-save-state").textContent.includes("已保存")&&!document.getElementById("plugin-save").disabled');
  assert.equal(workspace.app.plugins.rows()[0].config.intensity,0.8);
  await evaluate('document.querySelector(".plugin-row .inline-actions button:nth-child(2)").click()');
  await wait('document.querySelector(".plugin-row-title").textContent.includes("已启用")');
  await value('plugin-test-text','我今天好难过');await click('plugin-test-run');
  await wait('document.getElementById("plugin-test-result").textContent.includes("关切")');
  assert.equal(workspace.app.store.db.prepare('SELECT COUNT(*) AS n FROM emotion_states').get().n,0);
  checks.push('native installation, default disabled, configuration editing, save, enable and read-only distress preview');
  for(const width of [1440,768,390,320])await capture(width);
  await evaluate('Array.from(document.querySelectorAll("#plugin-config-fields button")).find(b=>b.textContent==="情境理解").click()');
  await wait('!document.getElementById("plugin-field-appraisal_mode").closest(".config-field").hidden');
  assert.match(await evaluate('document.getElementById("plugin-config-fields").textContent'),/额外调用模型/);
  await value('plugin-field-appraisal_mode','rules');await click('plugin-save');
  await wait('!document.getElementById("plugin-save").disabled');
  assert.equal(workspace.app.plugins.rows()[0].config.appraisal_mode,'rules');
  checks.push('responsive grouped forms at 1440/768/390/320 and selectable local-only mode');
  const p=workspace.app.plugins.rows()[0];await evaluate('openPluginBehaviors('+JSON.stringify(p.id)+')');
  await wait('!document.getElementById("plugin-behaviors").hidden');
  assert.match(await evaluate('document.getElementById("plugin-behaviors-body").textContent'),/重试不重复积累/);
  await evaluate('document.querySelector(".plugin-row .inline-actions button:nth-child(3)").click()');
  await wait('document.getElementById("confirm-dialog").open');
  assert.match(await evaluate('document.getElementById("confirm-dialog").textContent'),/情绪、信任和熟悉感/);
  await click('confirm-cancel');checks.push('behavior descriptions and clear state deletion consequence');
  assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({success:true,checks,errors},null,2));
  console.log(JSON.stringify({success:true,checks}));
} finally {
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('QA closed'));}socket?.terminate();
  if(browser&&browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited;}
  await workspace?.close();
  for(const path of [data,profile])await rm(path,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
