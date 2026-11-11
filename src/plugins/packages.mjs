// Installs external plugin packages into the plugin directory.
//
// A package is either a directory, a .zip on disk, or a .zip uploaded from the
// console (bytes), always with plugin.json at its root. Nothing is loaded from
// the package until it has been validated and written into PLUGIN_DIR, where
// the registry picks it up on the next scan.
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { validateManifest, PluginError } from './registry.mjs';

const MAX_FILES = 400, MAX_FILE_BYTES = 2 * 1024 * 1024, MAX_TOTAL_BYTES = 24 * 1024 * 1024;
// Uploaded archives are capped a little above the unpacked budget so a highly
// compressed package still fails on content, not on transport.
export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const RESERVED = /^_/;
const fail = (message, status = 400) => { throw new PluginError(message, status); };
const safeRelative = name => {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '')) return false;
  return !/^[A-Za-z]:/.test(name);
};

async function readTree(root) {
  const files = []; let total = 0;
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, item.name), rel = relative(root, full).split(sep).join('/');
      if (item.isDirectory()) { await walk(full); continue; }
      if (!item.isFile()) continue;
      if (!safeRelative(rel)) fail('插件包包含无效路径。');
      const info = await stat(full);
      if (info.size > MAX_FILE_BYTES) fail(`插件包文件 ${rel} 超过 2 MiB。`);
      if (files.length >= MAX_FILES) fail(`插件包最多包含 ${MAX_FILES} 个文件。`);
      total += info.size;
      if (total > MAX_TOTAL_BYTES) fail('插件包总大小超过 24 MiB。');
      files.push({ path: rel, bytes: await readFile(full) });
    }
  }
  await walk(root);
  return files;
}

function unzipPackage(buffer, label = '插件包') {
  if (!buffer.length) fail(`${label}为空。`);
  if (buffer.length > MAX_ZIP_BYTES) fail(`${label}超过 32 MiB，请精简后再导入。`, 413);
  // fflate also parses gzip and raw deflate; require the ZIP signature so a
  // renamed file fails with a readable message instead of a stray error.
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) fail(`${label}不是 ZIP 文件，请选择 .zip 格式的插件包。`);
  let entries;
  try { entries = unzipSync(new Uint8Array(buffer)); }
  catch { fail('无法读取该 ZIP 插件包。'); }
  const files = []; let total = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    if (!safeRelative(name)) fail('插件包包含无效路径 ' + name.slice(0, 80) + '。');
    if (bytes.length > MAX_FILE_BYTES) fail(`插件包文件 ${name} 超过 2 MiB。`);
    if (files.length >= MAX_FILES) fail(`插件包最多包含 ${MAX_FILES} 个文件。`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) fail('插件包总大小超过 24 MiB。');
    files.push({ path: name, bytes: Buffer.from(bytes) });
  }
  return files;
}

/** Strip a single wrapping directory, e.g. my-plugin/plugin.json. */
function normalizeRoot(files) {
  if (files.some(file => file.path === 'plugin.json')) return files;
  const roots = new Set(files.map(file => file.path.split('/')[0]));
  if (roots.size !== 1) fail('插件包根目录必须包含 plugin.json。');
  const [root] = roots;
  const stripped = files
    .filter(file => file.path.startsWith(root + '/'))
    .map(file => ({ path: file.path.slice(root.length + 1), bytes: file.bytes }));
  if (!stripped.some(file => file.path === 'plugin.json')) fail('插件包根目录必须包含 plugin.json。');
  return stripped;
}

export async function inspectPackage({ source, bytes, name = '', pluginDir }) {
  let files, origin, zip = true;
  if (bytes !== undefined) {
    // Console upload: the archive never touches disk before validation.
    if (!(bytes instanceof Uint8Array) || !bytes.length) fail('请选择要导入的 ZIP 插件包。');
    origin = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : '上传的插件包';
    files = unzipPackage(Buffer.from(bytes), origin);
  } else {
    if (typeof source !== 'string' || !source.trim()) fail('请填写插件包路径。');
    const target = resolve(source.trim());
    if (target === resolve(pluginDir)) fail('请选择插件目录中的插件包，而不是插件目录本身。');
    const entry = await stat(target).catch(() => null);
    if (!entry) fail('找不到插件包路径。', 404);
    origin = target;
    zip = !entry.isDirectory();
    files = entry.isDirectory() ? await readTree(target) : unzipPackage(await readFile(target));
  }
  if (!files.length) fail('插件包为空。');
  const normalized = normalizeRoot(files);
  const raw = normalized.find(file => file.path === 'plugin.json');
  const manifest = validateManifest(raw.bytes.toString('utf8'), 'plugin.json');
  if (RESERVED.test(manifest.id)) fail('插件包 id 不能以下划线开头。');
  if (manifest.kind === 'script') fail('插件包不能使用保留类型 script；请使用自己的 kind。');
  return { manifest, files: normalized, source: origin, zip };
}

export async function installPackage({ source, bytes, name, pluginDir, overwrite = false }) {
  const pkg = await inspectPackage({ source, bytes, name, pluginDir });
  const { manifest } = pkg;
  const destination = join(pluginDir, manifest.id);
  const existing = await stat(destination).catch(() => null);
  if (existing && !overwrite) fail(`插件 ${manifest.id} 已存在于 plugins 目录；如需覆盖请选择覆盖安装。`, 409);
  await mkdir(pluginDir, { recursive: true });
  if (existing) await rm(destination, { recursive: true, force: true });
  for (const file of pkg.files) {
    const path = join(destination, ...file.path.split('/'));
    if (!path.startsWith(destination + sep)) fail('插件包包含无效路径。');
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, file.bytes);
  }
  return { installed: true, id: manifest.id, kind: manifest.kind, name: manifest.name, version: manifest.version, files: pkg.files.length, replaced: !!existing };
}

export async function removePackage({ id, pluginDir }) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) fail('插件包 id 无效。');
  const target = join(pluginDir, id);
  if (!target.startsWith(resolve(pluginDir) + sep)) fail('插件包路径无效。');
  const existing = await stat(target).catch(() => null);
  if (!existing) fail('插件包不存在。', 404);
  await rm(target, { recursive: true, force: true });
  return { removed: true, id };
}
