// 生成插件市场的静态清单：把 plugins/ 下的插件打包成 ZIP，算出 SHA-256，写 index.json。
//
// 发布时把整个输出目录丢到任意静态站点（对象存储、GitHub Pages、自己的 VPS），
// 再把 index.json 的完整地址填进“全部设置 → 插件市场”。
//
//   node scripts/market-catalog.mjs --out dist/market --base-url https://example.com/market/
//
// 资源（FFmpeg 这类二进制）用 --assets 指定一份 JSON 描述，条目里可以写本机 zip 路径
// 让脚本复制、压缩并自动计算校验值；也可以直接写 url/sha256/size 引用已有文件。
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const MAX_FILE = 2 * 1024 * 1024, MAX_TOTAL = 24 * 1024 * 1024;
// 固定 ZIP 里的时间戳，让同样的插件源码每次都压出同样的字节：sha256 稳定，
// 重新发布时没有真实改动就不会产生新的包，也不会刷掉客户端的缓存。
const ZIP_MTIME = new Date(Date.UTC(1980, 0, 1));
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** 开发树里插件在 <root> 的上一级甚至上两级；与 registry 的查找顺序保持一致。 */
async function findPluginsDir() {
  for (const candidate of [join(root, 'plugins'), join(dirname(root), 'plugins'), join(dirname(dirname(root)), 'plugins')]) {
    try { if ((await stat(candidate)).isDirectory()) return candidate; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('找不到 plugins 目录，请用 --plugins 指定。');
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf('--' + name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1];
  const inline = process.argv.find(value => value.startsWith('--' + name + '='));
  return inline ? inline.slice(name.length + 3) : fallback;
}

/** 递归收集插件目录里的文件，保持相对路径；符号链接一律拒绝。 */
async function collect(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('插件目录里不能有符号链接：' + name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...await collect(join(directory, entry.name), name));
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = await readFile(join(directory, entry.name));
    if (bytes.length > MAX_FILE) throw new Error(`${name} 超过 2 MiB，安装器会拒绝这个包。`);
    files.push({ name, bytes });
  }
  return files;
}

async function packagePlugins({ pluginsDir, outDir, baseUrl }) {
  const entries = [];
  const packagesDir = join(outDir, 'packages');
  await mkdir(packagesDir, { recursive: true });
  const skipped = [];
  for (const item of await readdir(pluginsDir, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('_')) continue;
    let manifest;
    try { manifest = JSON.parse(await readFile(join(pluginsDir, item.name, 'plugin.json'), 'utf8')); }
    catch { skipped.push({ directory: item.name, reason: '没有可读的 plugin.json' }); continue; }
    if (!ID.test(manifest.id || '') || !ID.test(manifest.kind || '')) { skipped.push({ directory: item.name, reason: 'id/kind 不合规' }); continue; }
    if (!/^\d+\.\d+\.\d+/.test(manifest.version || '')) { skipped.push({ directory: item.name, reason: 'version 不是 x.y.z' }); continue; }
    const files = await collect(join(pluginsDir, item.name));
    const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
    if (!files.length) { skipped.push({ directory: item.name, reason: '目录里没有文件' }); continue; }
    if (total > MAX_TOTAL) throw new Error(manifest.id + ' 解包后超过 24 MiB，安装器会拒绝这个包。');
    const archive = zipSync(Object.fromEntries(files.map(file => [file.name, new Uint8Array(file.bytes)])), { level: 6, mtime: ZIP_MTIME });
    const name = `${manifest.id}-${manifest.version}.zip`;
    await writeFile(join(packagesDir, name), archive);
    entries.push({
      id: manifest.id, kind: manifest.kind, api: Number(manifest.api ?? 1), name: manifest.name || manifest.id,
      version: manifest.version, description: manifest.description || '',
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      size: archive.length, sha256: sha256(archive), url: new URL('packages/' + name, baseUrl).toString()
    });
    process.stdout.write(`打包 ${manifest.id} ${manifest.version} · ${files.length} 个文件 · ${(archive.length / 1024).toFixed(1)} KB\n`);
  }
  return { entries, skipped };
}

async function readAssets({ outDir, baseUrl, descriptor }) {
  if (!descriptor) return [];
  const list = JSON.parse(await readFile(resolve(descriptor), 'utf8'));
  const assets = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !ID.test(item.id || '') || !item.install_to || !Array.isArray(item.files) || !item.files.length) {
      throw new Error('资源条目至少需要 id、install_to、files：' + JSON.stringify(item).slice(0, 120));
    }
    let { url, size, sha256: digest } = item;
    if (item.source) {
      // 本机文件：复制到输出目录并重新计算校验值，避免手写 sha256 写错。
      const source = resolve(item.source);
      const info = await stat(source);
      if (!info.isFile()) throw new Error('资源源文件不存在：' + item.source);
      await mkdir(join(outDir, 'assets'), { recursive: true });
      const name = `${item.id}-${item.version || '1.0.0'}${extname(source) || '.bin'}`;
      const target = join(outDir, 'assets', name);
      await copyFile(source, target);
      const bytes = await readFile(target);
      url = new URL('assets/' + name, baseUrl).toString();
      size = bytes.length; digest = sha256(bytes);
      process.stdout.write(`资源 ${item.id} · ${(bytes.length / 1048576).toFixed(1)} MB · ${target}\n`);
    }
    if (!url || !size || !digest) throw new Error('资源条目缺少 url/size/sha256（或提供 source）：' + item.id);
    assets.push({
      id: item.id, name: item.name || item.id, version: item.version || '1.0.0',
      description: item.description || '', homepage: item.homepage || '',
      install_to: String(item.install_to).replace(/\/+$/, ''), files: item.files,
      archive: item.archive === 'file' ? 'file' : 'zip', size, sha256: String(digest).toLowerCase(), url
    });
  }
  return assets;
}

async function main() {
  const outDir = resolve(argument('out', join(root, 'dist', 'market')));
  const baseUrl = argument('base-url');
  if (!baseUrl) throw new Error('请用 --base-url 指定发布地址，例如 --base-url https://example.com/market/');
  if (!baseUrl.endsWith('/')) throw new Error('--base-url 需要以 / 结尾，这样相对路径才能拼对。');
  const pluginsDir = resolve(argument('plugins') || await findPluginsDir());
  await mkdir(outDir, { recursive: true });
  const { entries, skipped } = await packagePlugins({ pluginsDir, outDir, baseUrl });
  const assets = await readAssets({ outDir, baseUrl, descriptor: argument('assets') });
  const catalog = {
    schema: 1, name: argument('name', 'Limen 插件市场'), updated_at: new Date().toISOString(),
    plugins: entries.sort((left, right) => left.id.localeCompare(right.id)), assets
  };
  await writeFile(join(outDir, 'index.json'), JSON.stringify(catalog, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    out: outDir, index: join(outDir, 'index.json'), catalog_url: new URL('index.json', baseUrl).toString(),
    plugins: entries.length, assets: assets.length, skipped
  }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
