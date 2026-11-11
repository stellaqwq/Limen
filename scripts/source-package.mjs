import { lstat, readdir, readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve, join, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const rootFiles = new Set(['package.json', 'package-lock.json', 'README.md', 'LICENSE', '.env.example', '.env.seed', '.gitignore', '.dockerignore', '.npmignore', 'Dockerfile', 'compose.yaml', 'start.cmd']);
const directories = new Set(['src', 'scripts', 'test', 'docs', 'native', 'examples']);
const contextFiles = ['PRODUCT.md','DESIGN.md','.impeccable/design.json','.impeccable/surface-briefs/workspace.md'];
// 控制台是静态 HTML/CSS/JS，必须随源码包一起导出；其余目录只收集源码与文档。
const extensions = /\.(?:mjs|md|c|py|html|css|js|svg|json)$/;
function inside(root, path) {
  const value = relative(root, path);
  return value === '' || value !== '..' && !value.startsWith('..' + '/') && !value.startsWith('..' + '\\') && !isAbsolute(value);
}
export async function sourceFiles(root) {
  const files = [];
  async function visit(path, name) {
    if (!rootFiles.has(name) && name.split('/').some(part => part.startsWith('.') || ['data', 'runtime', 'node_modules'].includes(part))) return;
    // 白名单里的顶层文件是可选的：打包目录未保留 lockfile 等文件时不应中断导出。
    const stat = await lstat(path).catch(error => {
      if (error.code === 'ENOENT' && rootFiles.has(name)) return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error('Source export refuses symbolic links: ' + name);
    if (stat.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry), `${name}/${entry}`);
    } else if (stat.isFile() && (rootFiles.has(name) || extensions.test(name))) {
      files.push(name);
    }
  }
  for (const name of [...rootFiles, ...directories]) await visit(join(root, name), name);
  // Desktop sources are optional in older source fixtures; assets are explicit.
  try { await visit(join(root,'desktop'),'desktop'); } catch(error) { if(error.code!=='ENOENT')throw error; }
  for(const name of ['desktop/assets/icon.png','desktop/assets/icon.ico']) {
    try { const stat=await lstat(join(root,name));if(stat.isSymbolicLink())throw Error('Source export refuses symbolic links: '+name);if(stat.isFile())files.push(name); } catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  for (const name of contextFiles) {
    try {
      const stat=await lstat(join(root,name));
      if(stat.isSymbolicLink())throw new Error('Source export refuses symbolic links: '+name);
      if(stat.isFile())files.push(name);
    } catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  return files.sort();
}
export async function exportSource(root, destination) {
  root = resolve(root); destination = resolve(destination);
  if (inside(destination, root) || [...directories,'desktop'].some(name => inside(join(root, name), destination))) {
    throw new Error('Source export destination must be separate from source directories');
  }
  // A fresh destination prevents leftover credentials from an earlier export.
  const files = await sourceFiles(root);
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  const manifest = [];
  for (const name of files) {
    const bytes = await readFile(join(root, name));
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await writeFile(join(destination, name), bytes, { flag: 'wx' });
    manifest.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  // Plugin packages live outside the app root in the development tree; a
  // source export must ship them so the exported project still starts.
  // 与 registry 的查找顺序一致：<app>/plugins → 上一级 → 上两级。
  // 便携版目录里插件位于 resources/app 的上两级，只看上一级会漏掉。
  let externalPlugins = null;
  for (const candidate of [join(root, 'plugins'), join(dirname(root), 'plugins'), join(dirname(dirname(root)), 'plugins')]) {
    try {
      if ((await lstat(candidate)).isDirectory()) { externalPlugins = candidate; break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (externalPlugins) {
    await cp(externalPlugins, join(destination, 'plugins'), { recursive: true, errorOnExist: true, force: false });
    // 插件文件也要进清单：否则校验和与实际 ZIP 内容对不上。
    async function visitPlugins(path, name) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name), childName = `${name}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error('Source export refuses symbolic links: ' + childName);
        if (entry.isDirectory()) await visitPlugins(child, childName);
        else if (entry.isFile()) manifest.push({ path: childName, sha256: createHash('sha256').update(await readFile(child)).digest('hex') });
      }
    }
    await visitPlugins(join(destination, 'plugins'), 'plugins');
  }
  manifest.sort((left, right) => left.path.localeCompare(right.path));
  await writeFile(join(destination, 'SOURCE-MANIFEST.json'), JSON.stringify({ schema: 1, files: manifest }, null, 2) + '\n', { flag: 'wx' });
  return { directory: destination, files: files.length, plugins: manifest.filter(entry => entry.path.startsWith('plugins/')).length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const destination = process.argv[2] || join(root, 'dist', `source-${Date.now()}`);
  process.stdout.write(JSON.stringify(await exportSource(root, destination)) + '\n');
}
