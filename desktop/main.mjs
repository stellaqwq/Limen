import {app,BrowserWindow,dialog,Menu,shell} from 'electron';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {mkdir,writeFile,mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {parseEnv} from 'node:util';
import {tmpdir} from 'node:os';
import {localWorkspaceUrl,internalNavigation,externalNavigation} from './policy.mjs';
import {renderLaunchPage} from '../src/web/startup-animation.mjs';
import {bundledQQRuntime} from '../src/qq/runtime-location.mjs';
import {PROJECT_NAME,DATA_DIR_NAME} from '../src/brand.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const flag=name=>process.argv.find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const kernelSmoke=flag('--kernel-smoke-test'),smoke=flag('--smoke-test')||kernelSmoke, demo=process.argv.includes('--demo')||!!smoke&&!kernelSmoke;
const requested=flag('--workspace');
let backend,window,quitting=false,temporary,ready=false,failing=false;
let bootServer=null,bootMinMs=0,bootStartedAt=0,bootBackground='#0a0a10';
// 应用名必须在抢占单实例锁之前设定：锁文件会先固定 userData 位置。
// Windows 路径不区分大小写，既有的 limen 数据目录继续复用，配置与会话不失效。
app.setName(DATA_DIR_NAME);
const single=app.requestSingleInstanceLock();
if(!single){app.quit();}else{
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(quitting)return;
  event.preventDefault();quitting=true;
  if(!backend||backend.exitCode!==null){void finish();return;}
  const deadline=setTimeout(()=>backend.kill(),12000);
  backend.once('exit',()=>{clearTimeout(deadline);void finish();});
  if(backend.connected)backend.send({type:'stop'});else backend.kill();
});

// The plugin mirrors the saved animation into the data directory because the
// backend cannot answer before it has started. The boot window renders that
// snapshot, then hands off to the workspace with ?boot=1 so the overlay does
// not restart when the real page loads.
const bootPresets=new Set(['orbit','pulse','stars','curtain']),bootThemes=new Set(['ink','paper','aurora']),bootExits=new Set(['fade','rise','zoom']);
const bootText=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
function closeBootServer(){try{bootServer?.close();}catch{}bootServer=null;}
function bootThemeColor(record){
  return record?.theme === 'paper' ? '#f6f6f9' : record?.theme === 'aurora' ? '#05060e' : '#0a0a10';
}
/** Chromium probes MP4 files with byte ranges; answering 206 keeps seeking fast. */
function serveBootVideo(req,res,media){
  if(!media||res.destroyed||res.writableEnded)return;
  const bytes=media.bytes;
  const headers={'Content-Type':media.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
  let start=0,end=bytes.length-1,status=200;
  const range=/^bytes=(\d*)-(\d*)$/.exec((req.headers.range||'').trim());
  if(range){
    const first=range[1]?Number(range[1]):null,last=range[2]?Number(range[2]):null;
    if(first===null)start=last===null?0:Math.max(0,bytes.length-last);
    else {start=first;if(last!==null)end=Math.min(last,bytes.length-1);}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length){
      res.writeHead(416,{...headers,'Content-Range':'bytes */'+bytes.length,'Content-Length':0});res.end();return;
    }
    status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+bytes.length;
  }
  headers['Content-Length']=end-start+1;
  res.writeHead(status,headers);res.end(bytes.subarray(start,end+1));
}
async function bootSnapshot(directory){
  let dataDir=demo?'demo-data':'data';
  if(!demo){
    try{const env=parseEnv(await readFile(join(directory,'.env'),'utf8'));if(env.DATA_DIR)dataDir=env.DATA_DIR;}catch{}
  }
  const folder=resolve(directory,dataDir,'startup-animation');
  let record;
  try{record=JSON.parse(await readFile(join(folder,'boot.json'),'utf8'));}catch{return null;}
  if(record?.enabled!==true)return null;
  let logo=null;
  const file=record.logo?.file;
  if(typeof file==='string'&&/^logo\.(?:png|jpg|webp|gif)$/.test(file)){
    try{
      const bytes=await readFile(join(folder,file));
      const mime={png:'image/png',jpg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[file.split('.').pop()];
      if(bytes.length<=4*1024*1024&&mime)logo={bytes,mime};
    }catch{}
  }
  // A missing or oversized video simply falls back to the built-in look.
  let video=null;
  const videoFile=record.video?.file;
  if(record.source==='video'&&typeof videoFile==='string'&&/^video\.(?:mp4|webm)$/.test(videoFile)){
    try{
      const bytes=await readFile(join(folder,videoFile));
      const mime={mp4:'video/mp4',webm:'video/webm'}[videoFile.split('.').pop()];
      if(bytes.length<=42*1024*1024&&mime)video={bytes,mime};
    }catch{}
  }
  return {record,logo,video};
}
function bootAppearance(record,logo,video){
  const accent=/^#[0-9a-f]{6}$/i.test(record.accent||'')?record.accent.toLowerCase():'#8b7cf6';
  const min=Number.isSafeInteger(record.min_ms)?Math.min(8000,Math.max(600,record.min_ms)):1800;
  return {enabled:true,preset:bootPresets.has(record.preset)?record.preset:'orbit',
    theme:bootThemes.has(record.theme)?record.theme:'ink',exit:bootExits.has(record.exit)?record.exit:'fade',
    accent,title:bootText(record.title,24),subtitle:bootText(record.subtitle,60),caption:bootText(record.caption,40),
    min_ms:min,show_progress:record.show_progress!==false,skippable:false,once_per_session:false,
    source:record.source==='video'&&video?'video':'preset',
    video_fit:record.video_fit==='contain'?'contain':'cover',
    video_loop:record.video_loop!==false,video_overlay:record.video_overlay!==false,
    video:video?{url:'/video'}:null,
    signature:typeof record.signature==='string'&&/^[a-f0-9]{12}$/.test(record.signature)?record.signature:'',
    logo:logo?{url:'/logo'}:null};
}
async function startBootPage(directory, known){
  const snapshot=known||await bootSnapshot(directory);
  if(!snapshot)return null;
  const appearance=bootAppearance(snapshot.record,snapshot.logo,snapshot.video);
  let html;
  try{html=renderLaunchPage(appearance);}catch{return null;}
  const server=createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const path=(req.url||'/').split('?')[0];
    if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(html);return;}
    if(path==='/logo'&&snapshot.logo){res.writeHead(200,{'Content-Type':snapshot.logo.mime,'Content-Length':snapshot.logo.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(snapshot.logo.bytes);return;}
    if(path==='/video'&&snapshot.video){serveBootVideo(req,res,snapshot.video);return;}
    res.writeHead(404);res.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  bootServer=server;bootMinMs=appearance.min_ms;bootStartedAt=Date.now();
  bootBackground=bootThemeColor(appearance);
  return 'http://127.0.0.1:'+server.address().port+'/';
}
async function finish(){closeBootServer();if(temporary)await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});app.quit();}
// 启动进度写在页面底部：标题栏太窄，而且启动动画页也需要能看到「正在下载」。
// 用半透明胶囊而不是纯文字，启动动画是深色底、兜底页是浅色底，两种都读得清。
function showStatus(text){
  try{window?.setTitle(PROJECT_NAME+' · '+text);}catch{}
  const value=JSON.stringify(String(text||''));
  window?.webContents.executeJavaScript(`(()=>{let el=document.getElementById('limen-status');if(!el){el=document.createElement('div');el.id='limen-status';el.style.cssText='position:fixed;left:50%;bottom:30px;transform:translateX(-50%);max-width:min(720px,84vw);padding:7px 16px;border-radius:999px;background:rgba(14,16,24,.62);color:#eceef6;font:13px/1.55 system-ui,-apple-system,"Microsoft YaHei",sans-serif;text-align:center;z-index:2147483647;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.2)';document.body.appendChild(el);}el.textContent=${value};return true;})()`).catch(()=>{});
}
// 首次启动要先把约 1.2 GB 的 QQ 运行环境拉下来，这时候底部应该讲下载而不是「正在启动」。
// 只看默认位置和包内位置：自定义 QQ_RUNTIME_DIR 的用户不会看到误导性的下载提示。
function runtimeReady(directory){
  try{
    if(existsSync(join(bundledQQRuntime,'runtime.json')))return true;
    let env={};
    try{env=parseEnv(readFileSync(join(directory,'.env'),'utf8'));}catch{}
    // 演示驱动不下载内核，别给它配一条「正在下载」的提示。
    if(String(env.QQ_DRIVER||'').trim()==='demo')return true;
    const configured=env.QQ_RUNTIME_DIR?resolve(directory,env.QQ_RUNTIME_DIR):join(directory,'runtime','qq');
    return existsSync(join(configured,'runtime.json'));
  }catch{return true;}
}
async function failed(text){
  if(failing||quitting)return;failing=true;closeBootServer();
  if(smoke){await mkdir(resolve(smoke),{recursive:true});await writeFile(join(resolve(smoke),'report.json'),JSON.stringify({success:false,error:text},null,2));}
  else {
    // 首行当标题，其余放详情；磁盘/下载这类问题直接给可执行的动作，别让人去翻配置。
    const [headline,...rest]=String(text).split('\n').filter(line=>line.trim());
    const hint=/磁盘|空间不足|ENOSPC/.test(text)
      ? '磁盘空间不足：清理该磁盘，或用 Limen.exe --workspace="D:\\空间更大的目录" 把工作目录换到别的盘后重试。'
      : '可检查工作目录中的配置；首次使用请先在演示界面配置 AI 与 QQ。';
    await dialog.showMessageBox({type:'error',title:PROJECT_NAME+'启动失败',message:headline||'启动失败',detail:[...rest,hint].join('\n\n')});
  }
  app.quit();
}
app.whenReady().then(async()=>{
  if(demo||kernelSmoke)temporary=await mkdtemp(join(tmpdir(),'limen-desktop-'));
  const directory=temporary|| (requested?resolve(requested):join(app.getPath('userData'),'workspace'));
  await mkdir(directory,{recursive:true});
  const needsRuntime=!demo&&!runtimeReady(directory);
  const node=app.isPackaged?join(root,'runtime','desktop','node.exe'):process.env.XUQIAO_NODE||'node';
  // The window only appears once the first page has painted, so the launcher
  // never flashes an empty frame before the animation starts.
  let snapshot=null;
  try{snapshot=await bootSnapshot(directory);}catch{}
  const windowBackground=snapshot?bootThemeColor(snapshot.record):'#fafafa';
  // The window is shown immediately: a hidden window can pause the entrance
  // animations and would leave an empty frame behind. The background colour
  // matches the animation, so the pre-paint frame reads as its first frame.
  window=new BrowserWindow({width:1360,height:960,minWidth:800,minHeight:640,show:!smoke,title:PROJECT_NAME,backgroundColor:windowBackground,icon:join(root,'desktop','assets','icon.png'),webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:PROJECT_NAME,submenu:[{label:'打开数据目录',click:()=>shell.openPath(directory)},{type:'separator'},{role:'quit',label:'退出'}]},
    {label:'查看',submenu:[{role:'reload',label:'重新加载'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]}
  ]));
  let bootUrl=null;
  try{bootUrl=await startBootPage(directory,snapshot);}catch{bootUrl=null;closeBootServer();}
  if(bootUrl){
    try{await window.loadURL(bootUrl);}catch{bootUrl=null;closeBootServer();}
    // Match the window background to the animation so no white frame appears.
    try{window.setBackgroundColor(bootBackground);}catch{}
  }
  // 没有启动动画插件时用一个极简页顶着，别让窗口停在空白帧上。
  if(!bootUrl){
    const note=needsRuntime?'首次启动会从 QQ 官方下载运行环境（约 1.2 GB）并校验腾讯签名，耗时取决于网络；请保持网络畅通、磁盘空间充足。':'';
    const page='<!doctype html><meta charset="utf-8"><title>'+PROJECT_NAME+'</title><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font:16px system-ui;color:#272936;background:#fafafa"><h1 style="font-size:26px;margin:0">'+PROJECT_NAME+'</h1>'+(note?'<p style="margin:0;max-width:520px;padding:0 24px;text-align:center;font-size:13px;line-height:1.7;color:#8b90a0">'+note+'</p>':'')+'</body>';
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(page));
  }
  const startingText=needsRuntime?'正在下载 QQ 运行环境（首次启动约 1.2 GB）…':'正在启动本机工作台…';
  // 启动动画自带「正在启动本机工作台」的说明文案，没必要再叠一行同样的字；
  // 但首次启动要讲下载，这条必须显示出来。
  if(!bootUrl||needsRuntime)showStatus(startingText);

  // 首次启动可能要从 QQ 官方下载安装包（数百 MB），所以超时按进度续期：
  // 只在长时间没有任何进展时才判定卡死。
  const bootTimeoutText='启动超时，请检查 QQ 运行环境和网络（首次启动需要下载官方安装包）。';
  let timer=setTimeout(()=>void failed(bootTimeoutText),600000);
  const keepWaiting=()=>{clearTimeout(timer);timer=setTimeout(()=>void failed(bootTimeoutText),600000);};
  backend=fork(join(root,'desktop','server.mjs'),[directory,...(demo?['--demo']:[])],{execPath:node,cwd:directory,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,NODE_OPTIONS:undefined}});
  backend.once('error',error=>{clearTimeout(timer);void failed('无法启动内置运行时：'+error.message);});
  backend.once('exit',()=>{if(!ready&&!quitting){clearTimeout(timer);void failed('后台服务在启动完成前退出。');}else if(ready&&!quitting)void failed('后台服务已退出，请重新打开应用。');});
  backend.on('message',async message=>{
    if(quitting||window.isDestroyed())return;
    if(message?.type==='progress'){keepWaiting();showStatus(message.text||'正在准备 QQ 运行环境…');return;}
    if(message?.type==='failure'){clearTimeout(timer);await failed(message.text);return;}
    if(message?.type!=='ready'||ready)return;
    clearTimeout(timer);ready=true;
    if(!localWorkspaceUrl(message.url)){await failed('后台返回了无效的本机工作台地址。');return;}
    const base=message.url;
    if(bootUrl){
      // Let the boot animation run to its configured minimum, then fade it out
      // before navigating. The workspace render skips its own overlay.
      const remaining=Math.max(0,bootMinMs-(Date.now()-bootStartedAt));
      if(remaining)await new Promise(resolve=>setTimeout(resolve,remaining));
      // Freeze the running animation, fade it quickly and hand over. The
      // workspace keeps the same frame and dissolves into the console.
      try{await window.webContents.executeJavaScript('window.__xuqiaoBootExit && window.__xuqiaoBootExit(true)',true);}catch{}
      await new Promise(resolve=>setTimeout(resolve,240));
    }
    const consoleBase=base.replace(/\/$/,'')+'/console';
    const target=bootUrl?consoleBase+'?boot=1':consoleBase;
    window.webContents.setWindowOpenHandler(({url})=>{if(externalNavigation(url))void shell.openExternal(url);return {action:'deny'};});
    window.webContents.on('will-navigate',(event,url)=>{if(!internalNavigation(url,base)){event.preventDefault();if(externalNavigation(url))void shell.openExternal(url);}});
    window.webContents.on('will-redirect',(event,url)=>{if(!internalNavigation(url,base))event.preventDefault();});
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    try{
      await window.loadURL(target);
      if(bootUrl){
        closeBootServer();bootUrl=null;
        // Release the hand-off frame from the main process. A backgrounded
        // renderer can freeze its own timers, so the overlay may never lift by
        // itself; asking from here keeps the console reachable either way.
        for(let attempt=0;attempt<12;attempt++){
          const released=await window.webContents.executeJavaScript('(() => { const el=document.getElementById("sa-overlay"); if(!el)return true; if(window.__xuqiaoStartupExit)return window.__xuqiaoStartupExit(); el.remove(); return true; })()',true).catch(()=>false);
          if(released)break;
          await new Promise(resolve=>setTimeout(resolve,120));
        }
      }
      if(!smoke){if(window.isMinimized())window.restore();window.show();window.focus();}
      if(smoke){
        await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{const note=document.getElementById("profile-note");if(note&&note.textContent&&note.textContent!=="正在读取连接状态…"){clearInterval(t);resolve(true);}else if(++n>200){clearInterval(t);reject(Error("控制台数据未就绪"));}},100);})');
        await new Promise(r=>setTimeout(r,400));
        const report=await window.webContents.executeJavaScript('(async()=>({title:document.title,page:document.querySelector("#main h1")?.textContent.trim()||"",nav:document.querySelectorAll("#nav a").length,isolated:typeof require==="undefined",overflow:document.documentElement.scrollWidth>innerWidth,ready:document.getElementById("profile-note")?.textContent||""}))()');
        if(kernelSmoke){const qr=await window.webContents.executeJavaScript('(async()=>{const base=document.querySelector(\'meta[name="limen-api-base"]\').content;const r=await fetch(base+"/qr",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});return r.json();})()');report.qr_generated=typeof qr.qrcode==='string'&&qr.qrcode.startsWith('data:image/');}
        await mkdir(resolve(smoke),{recursive:true});await writeFile(join(resolve(smoke),'desktop.png'),(await window.webContents.capturePage()).toPNG());
        await writeFile(join(resolve(smoke),'report.json'),JSON.stringify({success:report.page.length>0&&report.nav>=8&&report.isolated&&!report.overflow&&!report.ready.includes('无法连接')&&(!kernelSmoke||message.driver==='kernel'&&message.bundledKernel&&message.kernelLoaded&&report.qr_generated),packaged:app.isPackaged,bundled_node:app.isPackaged,demo:message.demo,driver:message.driver,bundled_kernel:message.bundledKernel,kernel_loaded:message.kernelLoaded,qq_version:message.qqVersion,...report},null,2));app.quit();
      }
    }catch(error){await failed(error.message);}
  });
}).catch(error=>void failed(error.message));
}
