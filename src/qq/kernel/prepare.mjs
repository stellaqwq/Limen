import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { bundleQQ, discoverQQ } from './runtime.mjs';
import { buildKernel } from './build.mjs';
import { fetchOfficialRuntime, removeUnpacked } from './download.mjs';
import { explainWriteError, requireSpace } from '../disk.mjs';

async function exists(path) {
  try { await access(path); return true; }
  catch(error) { if(error.code==='ENOENT')return false; throw error; }
}
/** 首次启动准备失败时的统一指引：默认走官方下载，也给出本机 QQ 的退路。 */
function firstRunHelp(reason) {
  return new Error('首次启动尚未准备 QQ 官方运行时。\n' + reason + '\n' +
    '默认会从 QQ 官方下载安装包并校验腾讯签名；也可以改用本机已安装的 QQ：\n' +
    '  npm run qq:prepare -- --from "你的 QQ.exe 完整路径"（或在设置里把 QQ_RUNTIME_SOURCE 改为 local）\n' +
    '手动准备：安装 7-Zip 后运行 npm run qq:download -- --prepare --activate\n' +
    '完成后再次双击 start.cmd。仅体验界面可运行 npm run launch -- --demo。');
}
export async function prepareKernel(config, { source='', notify=()=>{}, download=fetchOfficialRuntime, discover=discoverQQ,
  bundle=bundleQQ, build=buildKernel, platform=process.platform, architecture=process.arch, cleanup=removeUnpacked,
  fingerprint=async()=>createHash('sha256').update(await readFile(process.execPath)).digest('hex') } = {}) {
  if(config.driver!=='kernel')return { prepared:false, reason:'other_driver' };
  if(platform!=='win32'||architecture!=='x64')throw new Error('官方 QQ 内核需要 Windows x64。仅体验管理台请运行 npm run launch -- --demo。');
  if(!await exists(join(config.kernel.runtime,'runtime.json'))) {
    // 默认从 QQ 官方下载，不再要求本机装过 QQ；显式 --from 或 local 才复制本机安装。
    let installation;
    if(source) {
      installation=discover(source);
    } else if(config.kernel.source==='local') {
      notify('首次启动：正在从本机已安装的 QQ 准备独立运行时，请稍候…');
      try { installation=discover(''); }
      catch(error) { throw firstRunHelp('本机没有找到可用的 QQ 安装（'+error.message+'）。'); }
    } else {
      // 安装包加解包目录约 2.5 GB，先看一眼剩余空间，别下到一半才 ENOSPC。
      const downloads=join(dirname(config.kernel.runtime),'downloads');
      await requireSpace(downloads, 2600 * 1024 * 1024, { what: 'QQ 官方安装包与解包目录' });
      notify('首次启动：正在从 QQ 官方下载运行时，首次需要完整下载安装包…');
      try {
        installation=await download({ downloadsDirectory:downloads, notify });
      } catch(error) {
        // 磁盘写不进去时别再退到「用本机 QQ」，直接给可执行的处理办法。
        const explained=explainWriteError(error,{path:downloads,what:'QQ 官方安装包'});
        if(explained!==error)throw explained;
        notify('从 QQ 官方下载未完成：'+error.message);
        try { installation=discover(''); notify('改用本机已安装的 QQ 继续准备运行时。'); }
        catch { throw firstRunHelp('从 QQ 官方下载失败（'+error.message+'），本机也没有可用的 QQ 安装。'); }
      }
    }
    if(!installation?.executable)throw firstRunHelp('没有找到可用的 QQ 安装。');
    notify('正在复制 QQ 官方程序文件到工作目录（约 1.2 GB，首次会慢一些）…');
    try { await bundle({source:installation.executable,destination:config.kernel.runtime}); }
    catch(error) { throw explainWriteError(error, { path: config.kernel.runtime, what: 'QQ 运行时' }); }
    // 解包目录只用于复制；安装包与来源记录保留在 downloads 里便于重装。
    if(installation.unpacked)await cleanup?.(installation.unpacked);
  }
  let metadata;
  try { metadata=JSON.parse(await readFile(join(config.kernel.directory,'adapter.json'),'utf8')); }
  catch(error) { if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error; }
  const binaries=await Promise.all(['wrapper.node','QQNT.dll'].map(name=>exists(join(config.kernel.directory,name))));
  // 换了 QQ 内核（版本号变了）必须重建桥接：wrapper.node 的导出表跟着官方程序变，
  // 旧的 adapter 配上新内核会在加载阶段直接失败，报错还看不出原因。
  let runtimeVersion='';
  try { runtimeVersion=JSON.parse(await readFile(join(config.kernel.runtime,'runtime.json'),'utf8')).version||''; }
  catch(error) { if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error; }
  const kernelChanged=Boolean(runtimeVersion)&&metadata?.version!==runtimeVersion;
  const stale=!metadata||metadata.schema!==1||metadata.runtime_root!==resolve(config.kernel.runtime)||
    metadata.host_sha256!==await fingerprint()||binaries.some(present=>!present)||kernelChanged;
  if(!stale)return {prepared:false,reason:'ready'};
  notify('正在为当前 Node.js 和项目目录生成 QQ 内核宿主…');
  try {
    const result=await build({runtimeDirectory:config.kernel.runtime,directory:config.kernel.directory});
    return {prepared:true,...result};
  } catch(error) {
    throw new Error('QQ 运行时准备失败：'+error.message+'\n请检查 QQ_RUNTIME_DIR；可运行 npm run qq:download -- --prepare --activate 重新准备。',{cause:error});
  }
}
