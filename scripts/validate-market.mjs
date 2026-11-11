// 校验市场清单与 packages/ 是否一致：条目字段、版本号、字节数与 SHA-256。
// 发布前先跑一遍，CI 里也跑同一份：
//   node scripts/validate-market.mjs --dir dist/market
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/, VERSION = /^\d+\.\d+\.\d+$/;
const argument = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const dir = resolve(argument('dir', 'dist/market'));
const problems = [];
const catalog = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));

if (catalog.schema !== 1) problems.push('schema 必须是 1');
if (!Array.isArray(catalog.plugins)) problems.push('plugins 必须是数组');
if (!Array.isArray(catalog.assets ?? [])) problems.push('assets 必须是数组');

const expected = new Set();
for (const item of catalog.plugins ?? []) {
  const label = item?.id ?? '(缺少 id)';
  if (!ID.test(item?.id ?? '')) problems.push(label + ': id 不合规');
  if (!ID.test(item?.kind ?? '')) problems.push(label + ': kind 不合规');
  if (item?.api !== 1) problems.push(label + ': api 必须是 1');
  if (!VERSION.test(item?.version ?? '')) problems.push(label + ': version 必须是 x.y.z');
  if (!Number.isSafeInteger(item?.size) || item.size <= 0) problems.push(label + ': size 不合法');
  if (!/^[0-9a-f]{64}$/.test(item?.sha256 ?? '')) problems.push(label + ': sha256 必须是 64 位小写十六进制');
  if (!/^https:\/\//.test(item?.url ?? '')) problems.push(label + ': url 必须是 https');

  const file = item.id + '-' + item.version + '.zip';
  expected.add(file);
  let bytes;
  try { bytes = await readFile(join(dir, 'packages', file)); }
  catch { problems.push(label + ': 缺少 packages/' + file); continue; }
  if (bytes.length !== item.size) problems.push(label + ': size 与实际不符（清单 ' + item.size + '，实际 ' + bytes.length + '）');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== item.sha256) problems.push(label + ': sha256 与实际不符（清单 ' + item.sha256 + '，实际 ' + digest + '）');
  if (!String(item.url).endsWith('/packages/' + file)) problems.push(label + ': url 没有指向 packages/' + file);
}

let present = [];
try { present = await readdir(join(dir, 'packages')); } catch { problems.push('缺少 packages 目录'); }
for (const name of present) {
  if (!name.endsWith('.zip')) problems.push('packages/' + name + ': 不是 .zip');
  else if (!expected.has(name)) problems.push('packages/' + name + ': 清单里没有对应条目');
}

for (const asset of catalog.assets ?? []) {
  if (!ID.test(asset?.id ?? '')) problems.push((asset?.id ?? '(资源)') + ': id 不合规');
  if (!String(asset?.install_to ?? '').startsWith('runtime/')) problems.push(asset?.id + ': install_to 必须以 runtime/ 开头');
  if (!Array.isArray(asset?.files) || !asset.files.length) problems.push(asset?.id + ': files 不能为空');
  if (!/^https:\/\//.test(asset?.url ?? '')) problems.push(asset?.id + ': url 必须是 https');
  if (!/^[0-9a-f]{64}$/.test(asset?.sha256 ?? '')) problems.push(asset?.id + ': sha256 必须是 64 位小写十六进制');
}

if (problems.length) {
  process.stderr.write('清单校验失败：\n' + problems.map(problem => '  - ' + problem).join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('清单校验通过：' + (catalog.plugins?.length ?? 0) + ' 个插件、' + (catalog.assets?.length ?? 0) + ' 个资源\n');
}
