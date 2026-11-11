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

const output=resolve('.impeccable/review/plugin-hub'),root=resolve('dist/plugin-hub-web-qa');
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
  await wait('document.querySelectorAll(".plugin-hub-row").length===9');await selected('extensions');
  assert.equal(await evaluate('document.querySelectorAll(".nav [data-view=plugins],.nav [data-view=groupchat],.nav [data-view=memes]").length'),0);
  assert.equal(workspace.app.plugins.rows().length,0);checks.push('one Plugins sidebar entry, nine native destinations and no implicit installation');
  await link('groupchat');await selected('groupchat');await wait('!document.getElementById("gcp-empty").hidden');
  assert.match(await evaluate('document.getElementById("breadcrumb").textContent'),/插件 \/ 群聊增强/);
  await evaluate('history.back()');await selected('extensions');await evaluate('history.forward()');await selected('groupchat');
  await evaluate('location.hash="memes"');await selected('memes');
  await send('Page.reload');await wait('document.querySelector("[data-plugin-view=memes][aria-current=page]")');await selected('memes');
  assert.equal(workspace.app.plugins.rows().length,0);checks.push('legacy routes, browser back/forward, reload and plugin owner selection');
  await link('extensions');await wait('document.querySelectorAll(".plugin-hub-row").length===9');
  await evaluate('document.querySelector(\'[data-plugin-kind="living-memory"] a\').click()');await selected('memory');
  await wait('!document.getElementById("memory-not-installed").hidden');assert.equal(workspace.app.plugins.rows().length,0);
  await click('memory-install');await wait('document.getElementById("memory-not-installed").hidden');
  await click('memory-config');await selected('plugins');
  await wait('document.getElementById("plugin-name").value.includes("流动记忆")&&!document.getElementById("plugin-save").disabled');
  assert.equal(workspace.app.plugins.rows()[0].enabled,false);await value('plugin-description','未保存的记忆插件草稿');
  await link('groupchat');await selected('groupchat');await link('plugins');await selected('plugins');
  assert.equal(await evaluate('document.getElementById("plugin-description").value'),'未保存的记忆插件草稿');
  await link('extensions');await shortcut('psychodynamic-emotion');await wait('document.getElementById("confirm-dialog").open');
  await click('confirm-cancel');assert.equal(workspace.app.plugins.rows().length,1);
  await shortcut('psychodynamic-emotion');await wait('document.getElementById("confirm-dialog").open');await click('confirm-ok');
  await wait('document.getElementById("plugin-name").value.includes("心绪")&&!document.getElementById("plugin-save").disabled');
  assert.equal(workspace.app.plugins.rows().find(p=>p.kind==='psychodynamic-emotion').enabled,false);
  checks.push('native configuration shortcut installs disabled, preserves cross-page drafts and confirms replacement');
  let group=await workspace.app.plugins.install({kind:'group-chat-plus'});
  group=await workspace.app.plugins.save({id:group.id,revision:group.revision,plugin:{...group,scope:{...group.scope,groups:['20001']}}});
  await workspace.app.plugins.toggle({id:group.id,revision:group.revision,enabled:true});
  await link('extensions');await wait('document.getElementById("plugin-hub-summary").textContent.includes("已安装 3 个插件")');
  const originalList=workspace.app.plugins.list.bind(workspace.app.plugins);
  workspace.app.plugins.list=()=>{throw Object.assign(Error('模拟读取失败'),{status:503});};
  await click('plugin-hub-refresh');await wait('!document.getElementById("plugin-hub-error").hidden&&!document.getElementById("plugin-hub-refresh").disabled');
  workspace.app.plugins.list=originalList;await click('plugin-hub-refresh');
  await wait('document.getElementById("plugin-hub-error").hidden&&document.getElementById("plugin-hub-summary").textContent.includes("1 个已启用")');
  checks.push('real installation/enablement counts and recoverable API failure');
  for(const width of [1440,1024,768,680,390,320])await capture(width,width===1440?'desktop':width===390?'mobile':'width-'+width);
  await click('menu');assert.equal(await evaluate('document.activeElement.dataset.view'),'extensions');
  await evaluate('document.querySelector(".nav [data-view=overview]").click()');
  await wait('document.getElementById("view-extensions").hidden');assert.equal(await evaluate('document.getElementById("sidebar").inert'),true);
  await click('menu');await evaluate('document.querySelector(".nav [data-view=extensions]").click()');await selected('extensions');
  checks.push('six responsive widths, mobile menu focus and selected owner after returning');
  await shortcut('video-analysis');await wait('document.getElementById("plugin-name").value==="视频理解"&&!document.getElementById("plugin-save").disabled');
  const video=workspace.app.plugins.rows().find(p=>p.kind==='video-analysis');assert.equal(video.enabled,false);assert.deepEqual(video.tools.map(t=>t.name),['video_info','video_frames','video_transcript']);
  assert.equal(await evaluate('document.getElementById("plugin-field-web_enabled").checked'),true);
  assert.equal(await evaluate('document.getElementById("plugin-source").closest("label").hidden'),true);
  for(const width of [1440,390,320]){
    await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="访问范围").click()');await capture(width,'video-access-'+width);
    await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="语音转写").click()');await capture(width,'video-asr-'+width);
  }
  assert.equal(await evaluate('document.getElementById("plugin-field-asr_api_key").type'),'password');
  await evaluate('document.querySelector(\'[aria-label="启用插件 视频理解"]\').click()');await wait('document.querySelector(\'[aria-label="停用插件 视频理解"]\')');
  assert.equal(workspace.app.plugins.get(video.id).enabled,true);assert.equal(workspace.app.video.tools({},{id:999,channel:'web'}).length,3);
  checks.push('video plugin installs disabled, exposes three tools and grouped configuration, masks ASR key and enables for web-only use');
  await evaluate('document.querySelector(".nav [data-view=agent]").click()');await wait('!document.getElementById("view-agent").hidden');await click('test-chat-entry');
  await evaluate('(()=>{const file=new File([Uint8Array.from(atob("AAAAGGZ0eXBpc29tAAACAGlzb21tcDQy"),c=>c.charCodeAt(0))],"【演示】上传测试.mp4",{type:"video/mp4"});const transfer=new DataTransfer();transfer.items.add(file);const input=document.getElementById("agent-attachment-input");input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait('document.querySelector("#agent-attachments .agent-attachment-info small")?.textContent.startsWith("视频")');
  assert.equal(workspace.app.store.db.prepare("SELECT kind FROM agent_attachments WHERE job_id IS NULL").get().kind,'video');
  await capture(320,'video-upload-320');await evaluate('document.querySelector("#agent-attachments button").click()');assert.equal(await evaluate('document.getElementById("agent-attachments").hidden'),true);
  checks.push('web video file selection uploads through the authenticated proxy and shows a removable video attachment');
  await evaluate('document.querySelector(".nav [data-view=extensions]").click()');await selected('extensions');await shortcut('android-device');
  await wait('document.getElementById("plugin-name").value==="安卓视频浏览"&&!document.getElementById("plugin-save").disabled');
  await value('plugin-field-serial','emulator-5554');await click('plugin-save');await wait('!pluginBusy&&!pluginDirty');
  await evaluate('document.querySelector(\'[aria-label="启用插件 安卓视频浏览"]\').click()');await wait('document.querySelector(\'[aria-label="停用插件 安卓视频浏览"]\')');
  assert.equal(workspace.app.plugins.find('android-device').enabled,true);
  for(const width of [1440,390])await capture(width,'android-config-'+width);
  await evaluate('document.querySelector(".nav [data-view=agent]").click()');await wait('document.getElementById("agent-android-status").textContent.includes("emulator-5554")');
  await click('agent-android-stop');await wait('document.getElementById("agent-android-status").textContent.includes("已停止")');
  assert.equal(workspace.app.android.paused,true);assert.equal(await evaluate('document.getElementById("agent-android-preview").disabled'),true);
  await click('agent-android-resume');await wait('document.getElementById("agent-android-resume").hidden');assert.equal(workspace.app.android.paused,false);
  for(const width of [1440,390,320])await capture(width,'android-controls-'+width);
  await click('agent-android-settings');await selected('plugins');await wait('document.getElementById("plugin-name").value==="安卓视频浏览"');
  checks.push('Android web-only plugin configuration, device serial, stop/resume, settings shortcut and responsive controls');
  await evaluate('document.querySelector(".nav [data-view=extensions]").click()');await selected('extensions');await shortcut('douyin-web');
  await wait('document.getElementById("plugin-name").value==="抖音网页浏览"&&!document.getElementById("plugin-save").disabled');
  assert.equal(workspace.app.plugins.find('douyin-web').enabled,false);
  assert.equal(await evaluate('document.getElementById("plugin-field-max_videos").value'),"5");
  await evaluate('document.querySelector(\'[aria-label="启用插件 抖音网页浏览"]\').click()');await wait('document.querySelector(\'[aria-label="停用插件 抖音网页浏览"]\')');
  assert.equal(await evaluate('document.getElementById("plugin-field-qq_private_enabled").checked'),false);
  await evaluate('(()=>{const n=document.getElementById("plugin-field-qq_private_enabled");n.checked=true;n.dispatchEvent(new Event("input",{bubbles:true}));})()');await click('plugin-save');await wait('!pluginBusy&&!pluginDirty');assert.equal(workspace.app.plugins.find('douyin-web').config.qq_private_enabled,true);
  checks.push('QQ administrator private browsing switch persists in the existing Douyin editor');
  workspace.app.douyinWeb.browser={running:false,async open(){this.running=true;},async close(){this.running=false;},async evaluate(){return {url:'https://www.douyin.com/',title:'抖音',text:'扫码登录',blocked:'login_required',video:null};},async screenshot(){return 'data:image/png;base64,'+png(64,36).toString('base64');}};
  for(const width of [1440,390])await capture(width,'douyin-config-'+width);
  await evaluate('document.querySelector(".nav [data-view=agent]").click()');await wait('document.getElementById("agent-douyin-status").textContent.includes("尚未打开")');
  await click('agent-douyin-open');await wait('document.getElementById("agent-douyin-message").textContent.includes("专用浏览器已打开")&&!douyinBusy');
  await click('agent-douyin-preview');await wait('!document.getElementById("agent-douyin-screen").hidden&&!douyinBusy');assert.match(await evaluate('document.getElementById("agent-douyin-message").textContent'),/登录或验证/);
  await click('agent-douyin-stop');await wait('document.getElementById("agent-douyin-status").textContent.includes("已停止")');assert.equal(workspace.app.douyinWeb.paused,true);
  assert.equal(await evaluate('document.getElementById("agent-douyin-screen").hidden'),true);
  await click('agent-douyin-resume');await wait('document.getElementById("agent-douyin-resume").hidden');
  for(const width of [1440,390,320])await capture(width,'douyin-controls-'+width);
  await click('agent-douyin-settings');await selected('plugins');await wait('document.getElementById("plugin-name").value==="抖音网页浏览"');
  checks.push('Douyin dedicated browser open, screenshot, manual login notice, stop/resume, configuration shortcut and responsive controls');
  await wait('!pluginBusy&&!pluginLoading&&document.getElementById("plugin-name").value==="抖音网页浏览"');
  await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="抖音聊天").click()');
  assert.equal(await evaluate('document.getElementById("plugin-field-chat_auto_enabled").checked'),false);
  await evaluate('(()=>{const n=document.getElementById("plugin-field-chat_auto_enabled");n.checked=true;n.dispatchEvent(new Event("input",{bubbles:true}));})()');await click('plugin-save');await wait('!pluginBusy&&!pluginDirty');assert.equal(workspace.app.plugins.find('douyin-web').config.chat_auto_enabled,true);
  await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="抖音聊天").click()');
  for(const width of [1440,390,320])await capture(width,'douyin-auto-chat-'+width);
  await evaluate('(()=>{const n=document.getElementById("plugin-field-chat_auto_enabled");n.checked=false;n.dispatchEvent(new Event("input",{bubbles:true}));})()');await click('plugin-save');await wait('!pluginBusy&&!pluginDirty');assert.equal(workspace.app.plugins.find('douyin-web').config.chat_auto_enabled,false);
  checks.push('Automatic chat option in plugin editor, saved on/off values, default-off behavior and desktop/mobile configuration layout');
  await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="视频学习").click()');
  await evaluate('(()=>{const n=document.getElementById("plugin-field-knowledge_enabled");n.checked=true;n.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await click('plugin-save');await wait('!pluginBusy&&!pluginDirty');assert.equal(workspace.app.plugins.find('douyin-web').config.knowledge_enabled,true);
  workspace.app.douyinWeb.browser.evaluate=async()=>({url:'https://www.douyin.com/',title:'【演示】科普视频',text:'【演示】水循环示意',video_id:'1234567890123456789',media_key:'demo-water',blocked:null,video:{current_seconds:2,width:800,height:600,x:600,y:400,paused:false}});
  const learningJob={id:9999,channel:'web'},learningTools=workspace.app.douyinWeb.tools({},learningJob),observed=await learningTools.find(t=>t.name==='douyin_web_observe').invoke({frames:1});
  const saved=await learningTools.find(t=>t.name==='video_knowledge_save').invoke({operation_id:'demo-save',observation_id:observed.result.observation_id,kind:'knowledge_note',title:'【演示】水循环画面记录',summary:'【演示数据】画面展示蒸发、凝结和降水箭头。仅为测试笔记，未经核实。',tags:['水循环','示例']});assert.equal(saved.result.ok,true);workspace.app.douyinWeb.release(learningJob);
  await evaluate('document.querySelector(".nav [data-view=agent]").click()');await wait('!document.getElementById("view-agent").hidden');await click('agent-tab-knowledge');
  await wait('document.querySelectorAll(".agent-knowledge-entry").length===1');await evaluate('document.querySelector(".agent-knowledge-entry").open=true');
  assert.match(await evaluate('document.getElementById("agent-knowledge-list").textContent'),/未核实/);
  assert.equal(await evaluate('document.querySelector(".agent-knowledge-source a").href'),'https://www.douyin.com/video/1234567890123456789');
  for(const width of [1440,390,320])await capture(width,'knowledge-'+width);
  await evaluate('document.querySelector(".agent-knowledge-entry button").click()');await wait('document.querySelectorAll(".agent-knowledge-entry").length===0');
  await click('agent-knowledge-archived');await wait('document.querySelectorAll(".agent-knowledge-entry").length===1');await evaluate('document.querySelector(".agent-knowledge-entry").open=true');
  assert.match(await evaluate('document.querySelector(".agent-knowledge-entry").textContent'),/已归档/);await evaluate('document.querySelector(".agent-knowledge-entry button").click()');await wait('document.querySelector(".agent-knowledge-entry button").textContent==="归档笔记"');
  await value('agent-knowledge-query','完全不存在的主题');await evaluate('document.getElementById("agent-knowledge-search").requestSubmit()');await wait('document.getElementById("agent-knowledge-list").textContent.includes("没有找到相关笔记")');
  await value('agent-knowledge-query','水循环');await evaluate('document.getElementById("agent-knowledge-search").requestSubmit()');await wait('document.querySelectorAll(".agent-knowledge-entry").length===1');
  await click('agent-knowledge-settings');await selected('plugins');await wait('document.getElementById("plugin-name").value==="抖音网页浏览"');
  checks.push('Video knowledge opt-in settings, grounded source display, search, archive/restore and desktop/mobile layouts');
  await wait('!pluginBusy&&!pluginLoading&&document.getElementById("plugin-name").value==="抖音网页浏览"');
  await evaluate('[...document.querySelectorAll("#plugin-config-fields .config-nav button")].find(b=>b.textContent==="分享与私信").click()');
  await evaluate('(()=>{const n=document.getElementById("plugin-field-social_enabled");n.checked=true;n.dispatchEvent(new Event("input",{bubbles:true}));})()');await click('plugin-save');await wait('!pluginBusy&&!pluginDirty');
  assert.equal(workspace.app.plugins.find('douyin-web').config.social_enabled,true);
  let socialCommits=0;
  workspace.app.douyinWeb.browser.evaluate=async expression=>{
    if(expression===snapshotExpression)return {url:'https://www.douyin.com/',title:'【演示】视频',text:'【演示】页面',media_key:'demo-video',video:{width:800,height:600},blocked:null};
    const p=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));
    if(p.phase==='inspect')return {ok:true,account:{uid:'demo-self',name:'【演示】发送账号',avatar:'self.png'},contacts:[{uid:'demo-friend',name:'【演示】好友',avatar:'friend.png'}],ambiguous:false};
    if(p.phase==='read_chat')return {ok:true,messages:[{id:'fixture-incoming',direction:'peer',text:'【演示】测试收到'}]};
    if(p.phase==='commit'){socialCommits++;return {ok:true,submitted:true};}return {ok:true};
  };
  workspace.app.douyinWeb.browser.page=async()=>({});
  await evaluate('document.querySelector(".nav [data-view=agent]").click()');await wait('!document.getElementById("view-agent").hidden');await click('agent-tab-social');await wait('document.getElementById("agent-social-status").textContent.includes("已启用")');
  await click('agent-social-contacts');await wait('document.querySelector("#agent-social-recipient option")?.textContent.includes("演示")&&!socialBusy');
  await click('agent-social-default');await wait('document.getElementById("agent-social-default-status").textContent.includes("已绑定")&&!socialBusy');
  {const p=workspace.app.plugins.find('douyin-web');await workspace.app.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,chat_read_enabled:true}}});}
  await click('agent-social-refresh');await wait('!document.getElementById("agent-chat-default-read").disabled');await click('agent-chat-default-read');await wait('document.getElementById("agent-chat-default-messages").textContent.includes("测试收到")&&!socialBusy');
  await value('agent-social-content','【演示】这是一份未发送的测试草稿。');await evaluate('document.getElementById("agent-social-form").requestSubmit()');await wait('document.querySelectorAll(".agent-social-draft").length===1&&!socialBusy');assert.equal(socialCommits,0);
  await evaluate('[...document.querySelectorAll(".agent-social-draft button")].find(b=>b.textContent==="准备并核对").click()');await wait('document.querySelector(".agent-social-draft img")&&!socialBusy');assert.equal(socialCommits,0);
  for(const width of [1440,390,320])await capture(width,'social-confirm-'+width);
  await evaluate('[...document.querySelectorAll(".agent-social-draft button")].find(b=>b.textContent.startsWith("确认发送给")).click()');await wait('document.querySelector(".agent-social-draft").textContent.includes("需在抖音核对")&&!socialBusy');assert.equal(socialCommits,1);
  await evaluate('[...document.querySelectorAll(".agent-social-draft button")].find(b=>b.textContent==="已核对：已送达").click()');await wait('document.querySelector(".agent-social-draft").textContent.includes("已人工核对送达")&&!socialBusy');assert.equal(socialCommits,1);
  checks.push('Social draft, contact selection, preparation screenshot, explicit single-send confirmation and manual delivery resolution in a mocked page');
  assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({success:true,checks,errors},null,2));
  console.log(JSON.stringify({success:true,checks}));
}catch(error){
  try{console.error(JSON.stringify({uiError:await evaluate('({pluginError:document.getElementById("plugin-error").textContent,androidMessage:document.getElementById("agent-android-message").textContent,pluginBusy,pluginDirty})')}));await capture(390,'failure');}catch{}
  throw error;
}finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('QA closed'));}socket?.terminate();
  if(browser&&browser.exitCode===null){const exited=once(browser,'exit');browser.kill();await exited;}
  await workspace?.close();
  for(const path of [data,profile]){const child=relative(root,path);assert.ok(child&&!child.startsWith('..')&&!isAbsolute(child));await rm(path,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
