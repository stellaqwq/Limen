import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {launchWorkspace} from './launch.mjs';
import {config} from '../test/helpers.mjs';
import {ChromeBrowser} from '../../../plugins/douyin-web/chrome.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';

const root=resolve('dist/layout-qa'),output=resolve('.impeccable/review/layout');
await mkdir(root,{recursive:true});await mkdir(output,{recursive:true});const temporary=await mkdtemp(join(root,'fixture-'));
let workspace,browser;const checks=[];
try{
  workspace=await launchWorkspace(config(join(temporary,'data'),{AI_ENABLED:'true',AI_MODEL:'【演示】布局验证',AI_ALLOWED_USERS:'10001'}));
  await applyDouyinSetup(workspace.app.plugins,{browse_share_enabled:true,social_enabled:true,chat_read_enabled:true,social_default_friend:'【演示】默认好友',min_observe_frames:6,min_observe_interval_seconds:3});
  browser=new ChromeBrowser({profile:join(temporary,'chrome'),headless:true});await browser.start('',AbortSignal.timeout(15000));
  const run=async expression=>{const r=await browser.page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await run(expression))return;await delay(100);}throw Error('UI condition failed: '+expression);};
  const shot=async name=>{await run('window.scrollTo(0,0)');await delay(150);const r=await browser.page('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'));};
  await browser.page('Page.navigate',{url:workspace.url});await wait('document.getElementById("connection")?.textContent==="已连接"');
  for(const width of [1440,1024,768,390,320]){
    await browser.page('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<681});
    if(width<681){await run('document.getElementById("menu").click()');await wait('document.getElementById("sidebar").classList.contains("open")');assert.ok(await run('document.getElementById("sidebar").getBoundingClientRect().width>=220'));await delay(250);await shot('navigation-'+width);await run('document.getElementById("shade").click()');}
    await run('location.hash="#overview"');await wait('!document.getElementById("view-overview").hidden');await shot('overview-'+width);
    await run('document.querySelector("[data-view=agent]").click()');await wait('!document.getElementById("agent-pane-devices").hidden');
    assert.equal(await run('document.querySelector("[data-view=agent]").getAttribute("aria-current")'),'page');
    await run('location.hash="#overview"');await wait('!document.getElementById("view-overview").hidden');
    await run('document.querySelector("[data-agent-open=devices]").click()');await wait('!document.getElementById("view-agent").hidden&&!document.getElementById("agent-pane-devices").hidden');
    assert.equal(await run('document.getElementById("agent-pane-sessions").hidden'),true);
    assert.equal(await run('document.getElementById("agent-desktop-details").open'),false);
    assert.equal(await run('document.querySelector(".agent-tabs").getBoundingClientRect().bottom<700'),true);
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true);await shot('devices-'+width);
    await run('document.querySelector("[data-agent-tab=social]").click()');await wait('document.getElementById("agent-social-status").textContent.includes("自动分享")');
    assert.equal(await run('document.querySelector(".agent-compose-details").open'),false);assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true);await shot('social-'+width);
    await run('document.querySelector(".agent-compose-details").open=true;document.getElementById("agent-social-content").value="【演示】保留未提交的内容";document.querySelector("[data-agent-tab=sessions]").click();document.querySelector("[data-agent-tab=social]").click()');
    assert.equal(await run('document.getElementById("agent-social-content").value'),'【演示】保留未提交的内容');
    await run('document.querySelector(".agent-compose-details").open=false;location.hash="#extensions"');await wait('document.querySelectorAll(".plugin-hub-group").length===3');
    assert.equal(await run('document.querySelectorAll(".plugin-hub-row").length'),8);assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true);await shot('plugins-'+width);
    checks.push({width,overflow:false,device_controls_separate:true,manual_composer_collapsed:true,plugin_groups:3,draft_preserved:true});
  }
  const ids=await run('[...document.querySelectorAll("[id]")].map(e=>e.id)');assert.equal(new Set(ids).size,ids.length);
  const report={success:true,checks,duplicate_ids:0,real_qq:false,real_messages:false};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  await browser?.close();await workspace?.close();const child=relative(root,temporary);assert.ok(child&&!child.startsWith('..')&&!isAbsolute(child));await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
