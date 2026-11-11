// 磁盘空间：复制官方运行文件（约 1 GB）前先算一遍，别等 copyfile 抛 ENOSPC 才报错。
// 报错文本直接给可执行的动作：清盘，或用 --workspace 换盘。
import { lstat, readdir, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BotError } from '../errors.mjs';

export const formatBytes = bytes => bytes >= 1024 ** 3
  ? (bytes / 1024 ** 3).toFixed(1) + ' GB'
  : Math.max(1, Math.round(bytes / 1024 ** 2)) + ' MB';

/** 找最近一个存在的目录再问剩余空间；拿不到就返回 null（让调用方跳过检查）。 */
export async function freeBytes(path) {
  let current = String(path);
  for (;;) {
    try { const stat = await statfs(current); return Number(stat.bavail) * Number(stat.bsize); }
    catch (error) {
      if (error.code !== 'ENOENT') return null;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function directoryBytes(path) {
  let total = 0;
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, item.name);
      if (item.isDirectory()) { await visit(child); continue; }
      if (item.isFile()) total += (await lstat(child)).size;
    }
  }
  await visit(path);
  return total;
}

export function diskFullHelp(path, { needed = 0, free = 0, what = '运行文件' } = {}) {
  const lines = [`${what}写入失败：磁盘空间不足。`, `目标目录 ${path}`];
  if (needed && free) lines.push(`需要约 ${formatBytes(needed)}，当前只剩 ${formatBytes(free)}。`);
  else if (needed) lines.push(`需要约 ${formatBytes(needed)}。`);
  else if (free) lines.push(`当前只剩 ${formatBytes(free)}。`);
  lines.push('可以：清理该磁盘；或用 Limen.exe --workspace="D:\\某个空间更大的目录" 把工作目录换到别的盘。');
  return lines.join('\n');
}

/** 复制前检查：剩余空间要够 needed 再留 256 MB 余量。 */
export async function requireSpace(path, needed, { what = '运行文件' } = {}) {
  const free = await freeBytes(path);
  if (free === null) return { free: null, ok: true };
  const margin = 256 * 1024 * 1024;
  if (free < needed + margin) throw new BotError(diskFullHelp(path, { needed, free, what }), 1507);
  return { free, ok: true };
}

/** 把 ENOSPC 之类的写入错误翻译成同一段说明；其他错误原样返回。 */
export function explainWriteError(error, { path = '', what = '运行文件' } = {}) {
  if (!['ENOSPC', 'EDQUOT'].includes(error?.code)) return error;
  return new BotError(diskFullHelp(path, { what }), 1507, { cause: error });
}
