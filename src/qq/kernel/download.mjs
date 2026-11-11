// 从 QQ 官方下载并解包运行时。
//
// 与“复制本机已安装的 QQ”不同，这条路径不依赖用户机器上装过 QQ：
// 读官方发版配置 → 换取带签名的下载地址 → 断点续传 → 校验腾讯 Authenticode
// 签名 → 用 7-Zip 解包 → 交给 bundleQQ 复制成独立运行时。
//
// 下载的安装包、来源记录与解包目录都放在 <runtime>/downloads，方便重装时复用。
import { stat, mkdir, rename, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, createWriteStream, createReadStream } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { discoverQQ } from './runtime.mjs';

export const RELEASE_CONFIG_URL = 'https://qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json';
export const DOWNLOAD_SIGN_URL = 'https://im.qq.com/http2rpc/gotrpc/noauth/trpc.qqntv2.urlsign.UrlSign/GetSign';
const DEFAULT_SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';

/** 只信任 qqdl.gtimg.cn 的 https 地址，防止发版配置或签名接口被改写。 */
export function officialURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'qqdl.gtimg.cn' || url.username || url.password) throw new Error('官方下载地址来源异常，已拒绝');
  return url;
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function sevenZipPath(custom = '') {
  const candidate = custom || process.env.QQ_7ZIP || DEFAULT_SEVEN_ZIP;
  if (!existsSync(candidate)) throw new Error('解包官方 QQ 需要 7-Zip：请安装 7-Zip，或在“QQ 与运行时”里填写 7-Zip 程序路径（QQ_7ZIP）。');
  return candidate;
}
/** 校验安装包的数字签名确实是腾讯签发的正版 QQ。 */
export function verifyPublisher(file) {
  const code = '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $s = Get-AuthenticodeSignature -LiteralPath $env:QQ_VERIFY_FILE; [pscustomobject]@{ status=$s.Status.ToString(); subject=$s.SignerCertificate.Subject; thumbprint=$s.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress';
  const environment = { ...process.env, QQ_VERIFY_FILE: file };
  delete environment.PSModulePath;
  const modernShell = join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  const result = execFileSync(existsSync(modernShell) ? modernShell : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
    env: environment, windowsHide: true, encoding: 'utf8', timeout: 30000
  });
  const signature = JSON.parse(result.trim());
  if (signature.status !== 'Valid' || !/Tencent Technology/.test(signature.subject || '')) throw new Error('下载的 QQ 安装包没有有效的腾讯签名，已中止');
  return signature;
}

/**
 * 下载官方 QQ 安装包（存在则复用），返回安装包路径与来源记录。
 */
export async function downloadOfficialInstaller({ downloadsDirectory = 'runtime/downloads', notify = () => {}, signal } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('官方 QQ 运行时目前仅支持 Windows x64');
  const release = await fetch(RELEASE_CONFIG_URL, { signal: signal ?? AbortSignal.timeout(20000) })
    .then(response => { if (!response.ok) throw new Error('无法读取 QQ 官方发版配置（HTTP ' + response.status + '）'); return response.json(); });
  const windows = release.Windows;
  if (!windows || !/^\d+\.\d+\.\d+$/.test(windows.version)) throw new Error('QQ 官方发版信息格式异常');
  const url = officialURL(windows.ntDownloadX64Url), name = basename(url.pathname);
  if (!/^[\w.-]+\.exe$/.test(name)) throw new Error('QQ 官方安装包文件名异常');

  const directory = resolve(downloadsDirectory);
  await mkdir(directory, { recursive: true });
  const file = join(directory, name), partial = file + '.partial';
  if (!existsSync(file)) {
    const signed = await fetch(DOWNLOAD_SIGN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'x-oidb': JSON.stringify({ uint32_command: '0x9b8e', uint32_service_type: 1 }), Referer: 'https://im.qq.com/' },
      body: JSON.stringify({ url: url.toString() }), signal: signal ?? AbortSignal.timeout(20000) }).then(response => response.json());
    if (signed.retcode !== 0 || !signed.data?.url) throw new Error('QQ 官方下载地址签名失败');
    const signedURL = officialURL(signed.data.url);
    let complete = false;
    for (let attempt = 0; attempt < 3 && !complete; attempt++) {
      try {
        const offset = await stat(partial).then(value => value.size).catch(() => 0);
        const response = await fetch(signedURL, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: AbortSignal.timeout(300000) });
        if (!response.ok) throw new Error('QQ 安装包下载失败（HTTP ' + response.status + '）');
        if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('QQ 安装包续传位置异常');
        notify(`正在从 QQ 官方下载 ${windows.version}（${response.headers.get('content-length') || '?'} 字节）…`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: response.status === 206 ? 'a' : 'w' }));
        await rename(partial, file); complete = true;
      } catch (error) { if (attempt === 2) throw error; }
    }
  }
  const signature = verifyPublisher(file);
  const provenance = { version: windows.version, update_date: windows.updateDate, source_config: RELEASE_CONFIG_URL,
    url: url.toString(), sha256: await sha256(file), bytes: (await stat(file)).size, signature,
    verified_at: new Date().toISOString() };
  await writeFile(file + '.json', JSON.stringify(provenance, null, 2) + '\n');
  return { file, version: windows.version, provenance };
}

async function findQQ(directory, depth = 0) {
  if (depth > 8) return null;
  const executable = join(directory, 'QQ.exe');
  if (existsSync(executable)) { try { return discoverQQ(executable); } catch {} }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) { const found = await findQQ(join(directory, entry.name), depth + 1); if (found) return found; }
  }
  return null;
}

/**
 * 解包已下载的官方安装包，返回可被 bundleQQ 复制的 QQNT 安装目录。
 */
export async function unpackOfficialInstaller({ installer, version, downloadsDirectory = 'runtime/downloads', sevenZip = '', notify = () => {} }) {
  const directory = resolve(downloadsDirectory);
  const unpacked = join(directory, `unpacked-${version}`);
  let installation = existsSync(unpacked) ? await findQQ(unpacked) : null;
  if (!installation) {
    notify('正在解包官方 QQ 安装包…');
    const executable = sevenZipPath(sevenZip);
    const extraction = spawnSync(executable, ['x', '-y', '-bd', `-o${unpacked}`, installer], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    if (extraction.error || extraction.status !== 0) throw new Error('7-Zip 解包失败：' + (extraction.error?.message || '请确认 QQ_7ZIP 指向 7z.exe'));
    installation = await findQQ(unpacked);
  }
  if (!installation) throw new Error('官方安装包结构无法识别，未找到 QQNT 程序目录');
  return { ...installation, unpacked };
}

/**
 * 一步到位：下载 + 校验 + 解包，返回可直接 bundle 的安装。
 */
export async function fetchOfficialRuntime({ downloadsDirectory = 'runtime/downloads', sevenZip = '', notify = () => {}, signal } = {}) {
  const download = await downloadOfficialInstaller({ downloadsDirectory, notify, signal });
  const installation = await unpackOfficialInstaller({ installer: download.file, version: download.version, downloadsDirectory, sevenZip, notify });
  return { ...installation, installer: download.file, version: download.version, provenance: download.provenance };
}

/** 装好（已 bundle）之后清掉解包目录，只保留安装包与来源记录。 */
export async function removeUnpacked(unpacked) {
  if (unpacked) await rm(unpacked, { recursive: true, force: true }).catch(() => {});
}
