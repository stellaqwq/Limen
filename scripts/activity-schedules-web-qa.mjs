import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { launchWorkspace } from './launch.mjs';
import { config, incoming } from '../test/helpers.mjs';
import { pluginTemplate } from '../src/plugins/service.mjs';

const output = resolve('.impeccable/review/activity-schedules'), temporaryRoot = resolve('dist/activity-schedules-web-qa');
await mkdir(output, { recursive: true }); await mkdir(temporaryRoot, { recursive: true });
const profile = await mkdtemp(join(temporaryRoot, 'chrome-')), data = await mkdtemp(join(temporaryRoot, 'demo-'));
let workspace, browser, socket, sequence = 0;
const pending = new Map(), errors = [], checks = [];
const expectedHttpFailures = new Map();
let verifiedHttpFailures = 0;
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 12000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression) {
  for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await delay(100); }
  throw Error('UI condition: ' + expression);
}
const click = id => evaluate('document.getElementById(' + JSON.stringify(id) + ').click()');
const value = (id, value) => evaluate(`(()=>{const node=document.getElementById(${JSON.stringify(id)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function viewport(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 681 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 681 });
  await evaluate('window.scrollTo(0,0)'); await delay(250);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'no overflow ' + width);
}
async function screenshot(name) {
  await evaluate('window.scrollTo(0,0);document.getElementById("toast").hidden=true');
  const size = (await send('Page.getLayoutMetrics')).cssContentSize;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
  await writeFile(join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}
try {
  await writeFile(join(output, 'report.json'), JSON.stringify({ success: false, status: 'running' }));
  workspace = await launchWorkspace(config(data,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'}));
  let plugin=await workspace.app.plugins.install({kind:'free-activity'});
  plugin=await workspace.app.plugins.save({id:plugin.id,revision:plugin.revision,plugin:{...plugin,scope:{...plugin.scope,private_users:['10001']}}});
  plugin=await workspace.app.plugins.toggle({id:plugin.id,revision:plugin.revision,enabled:true});
  workspace.app.agent.freeActivity.control({action:'schedule',mode:'interval',interval_ms:3600000,next_at:Date.now()+3600000,focus:'聊天指令创建的活动：浏览灵感并画画'},
    {post_type:'message',message_type:'private',self_id:workspace.app.adapter.driver.account,user_id:10001,message:[{type:'text',data:{text:'定时 每隔60分钟 自由活动'}}]},
    {channel:'qq',conversation:workspace.app.adapter.driver.account+':private:10001'});
  browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => errors.push(error.message));
  let port;
  for (let n = 0; n < 100; n++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  assert.ok(port, 'Chrome available');
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  socket.on('message', bytes => {
    const message = JSON.parse(bytes);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const entry = message.params.entry;
      const key = [...expectedHttpFailures.keys()].find(key => {
        const [path, code] = key.split('|');
        return entry.source === 'network' && entry.url?.endsWith(path) && entry.text.includes('status of ' + code) && expectedHttpFailures.get(key) > 0;
      });
      if (key) { expectedHttpFailures.set(key, expectedHttpFailures.get(key) - 1); verifiedHttpFailures++; }
      else errors.push(entry);
    }
  });
  await once(socket, 'open'); await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await viewport(1440); await send('Page.navigate', { url: workspace.url + '#plugins' });

  await wait('document.querySelector(".plugin-row")');
  await evaluate('document.querySelector(".plugin-row button").click()');
  await wait('!document.getElementById("activity-schedules").hidden&&document.querySelectorAll(".activity-schedule-row").length===1');
  assert.match(await evaluate('document.getElementById("activity-schedule-list").textContent'),/聊天指令创建/);
  assert.equal(await evaluate('document.getElementById("activity-schedule-target").value'),'10001');
  await value('activity-schedule-interval','30');await value('activity-schedule-focus','午后灵感：看一眼工作目录，选择一项有趣的小事');
  await click('activity-schedule-save');await wait('document.querySelectorAll(".activity-schedule-row").length===2&&!document.getElementById("activity-schedule-save").disabled');
  assert.equal(workspace.app.store.db.prepare('SELECT COUNT(*) n FROM free_activity_schedules WHERE enabled=1').get().n,2);
  checks.push('existing chat schedules, scoped target and immediate create through workspace proxy');
  await evaluate('document.querySelector("[data-schedule-action=edit]").click()');
  await value('activity-schedule-mode','daily');await value('activity-schedule-daily','20:30');
  assert.equal(await evaluate('document.getElementById("activity-schedule-daily-label").hidden'),false);
  assert.equal(await evaluate('document.getElementById("activity-schedule-interval").disabled'),true);
  await click('activity-schedule-save');await wait('document.getElementById("activity-schedule-list").textContent.includes("每天 20:30")&&!document.getElementById("activity-schedule-save").disabled');
  const editedId=workspace.app.store.db.prepare("SELECT id FROM free_activity_schedules WHERE mode='daily'").get().id;
  await evaluate('document.querySelector('+JSON.stringify('[data-schedule-id="'+editedId+'"][data-schedule-action="toggle"]')+').click()');
  await wait('document.querySelector('+JSON.stringify('[data-schedule-id="'+editedId+'"][data-schedule-action="toggle"]')+').textContent==="启用"');
  checks.push('daily field validation and disabling a shared schedule');
  await evaluate('document.querySelector('+JSON.stringify('[data-schedule-id="'+editedId+'"][data-schedule-action="edit"]')+').click()');
  await value('activity-schedule-focus','未保存草稿保留');await click('plugin-save');
  await wait('document.getElementById("plugin-editor-error").textContent.includes("请先保存或取消定时编辑")');
  assert.equal(await evaluate('document.getElementById("activity-schedule-focus").value'),'未保存草稿保留');
  await click('activity-schedule-reset');
  checks.push('independent save boundary protects an unsaved schedule draft');
  for(const width of [1440,390,320]){
    await viewport(width);await evaluate('document.getElementById("activity-schedules").scrollIntoView({block:"start"})');
    await evaluate('document.getElementById("toast").hidden=true');
    const box=await evaluate('(()=>{const r=document.getElementById("activity-schedules").getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()');
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:box});
    await writeFile(join(output,'editor-'+width+'.png'),Buffer.from(shot.data,'base64'));
    assert.equal(await evaluate('document.querySelector("#activity-schedules").scrollWidth<=document.querySelector("#activity-schedules").clientWidth'),true,'schedule panel fits '+width);
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  const report={success:true,checks,javascriptOrCspErrors:errors.length,screenshots:output};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch (error) {
  if(socket?.readyState===WebSocket.OPEN){console.log(await evaluate('JSON.stringify({error:document.getElementById("activity-schedule-error").textContent,status:document.getElementById("activity-schedule-status").textContent,invalid:[...document.querySelectorAll(":invalid")].map(n=>({id:n.id,message:n.validationMessage})),list:document.getElementById("activity-schedule-list").textContent})'));}
  await writeFile(join(output, 'report.json'), JSON.stringify({ success: false, error: error.message, errors, checks }, null, 2)); throw error;
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
  if (browser && browser.exitCode === null) { await Promise.race([once(browser, 'exit'), delay(3000)]); if (browser.exitCode === null) browser.kill(); }
  await workspace?.close();
  for (const path of [profile, data]) { assert.equal(dirname(path), temporaryRoot); await rm(path, { recursive: true, force: true }); }
}
