// QQ 官方内核版本检查：只比对「本地已准备的运行时」与「官方发版配置」，
// 不触发下载、不改文件，供控制台的「检查更新」按钮按需调用。
//
// 两边的版本号格式不同，不能直接字符串比较：
//   本地 runtime.json 的 version 来自 QQ 自己的 package.json，形如 9.9.36-53644；
//   官方发版配置的 Windows.version 只有三段，形如 9.9.36。
// 所以先拆成「三段数字 + 构建号」，先比核心版本，再比构建号。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RELEASE_CONFIG_URL } from './download.mjs';

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec(String(value || '').trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], build: match[4] ? Number(match[4]) : 0 };
}

/** 返回 -1 / 0 / 1；任何一边解析不出来都按 0 处理，避免误报「有新版本」。 */
export function compareVersion(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < a.core.length; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.build === b.build) return 0;
  return a.build < b.build ? -1 : 1;
}

/** 本地已经准备好的运行时版本；没有就返回空串（首启还没下载）。 */
export async function localRuntimeVersion(runtimeDirectory) {
  try {
    const manifest = JSON.parse(await readFile(join(runtimeDirectory, 'runtime.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '';
  } catch {
    return '';
  }
}

/** 读官方发版配置里的 Windows x64 版本；只信官方域名上的配置。 */
export async function officialRuntimeVersion({ signal } = {}) {
  const response = await fetch(RELEASE_CONFIG_URL, { signal: signal ?? AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('无法读取 QQ 官方发版配置（HTTP ' + response.status + '）');
  const release = await response.json();
  const windows = release?.Windows;
  if (!windows || !/^\d+\.\d+\.\d+$/.test(windows.version)) throw new Error('QQ 官方发版信息格式异常');
  return { version: windows.version, update_date: typeof windows.updateDate === 'string' ? windows.updateDate : '' };
}

/**
 * 检查是否有更新的官方内核。
 * 只读：不下载、不改 .env、不动已有运行时；升级仍然走 prepareKernel 的完整流程。
 */
export async function checkKernelUpdate({ runtimeDirectory, signal } = {}) {
  const current = await localRuntimeVersion(runtimeDirectory);
  const latest = await officialRuntimeVersion({ signal });
  return {
    current,
    latest: latest.version,
    update_available: Boolean(current) && compareVersion(current, latest.version) < 0,
    prepared: Boolean(current),
    release_date: latest.update_date,
    checked_at: new Date().toISOString()
  };
}
