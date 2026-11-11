// Plugin registry: scans the external plugin directory, validates each
// package manifest and exposes a uniform definition to the host.
//
// A plugin package is a directory under PLUGIN_DIR containing:
//   plugin.json   manifest (api, id, kind, name, version, entry, ...)
//   index.mjs     entry module exporting create(ctx) and optional
//                 template() / config(value) / schema() / tools(config)
//
// The host never imports plugin internals statically; everything goes
// through this registry so a plugin can be added, updated or removed
// without touching src/.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN_API = 1;
// Plugin packages live outside src/. Three layouts are supported:
//   <app>/plugins            packaged app (resources/app/plugins)
//   <project>/plugins        development tree (xq/plugins)
//   <resources>/plugins      desktop bundle (resources/plugins)
const PLUGIN_DIRS = [
  new URL('../../plugins/', import.meta.url),
  new URL('../../../../plugins/', import.meta.url),
  new URL('../../../plugins/', import.meta.url)
];
export async function resolvePluginDir() {
  for (const url of PLUGIN_DIRS) {
    const path = fileURLToPath(url);
    try { if ((await stat(path)).isDirectory()) return path; } catch {}
  }
  return fileURLToPath(PLUGIN_DIRS[0]);
}
export const defaultPluginDir = fileURLToPath(PLUGIN_DIRS[1]);
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_ENTRY = 200;

export class PluginError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.pluginError = true; }
}
const fail = (message, status = 400) => { throw new PluginError(message, status); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseManifest(raw, dirName, source) {
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail(`${source} 不是有效的 JSON。`); }
  if (!plain(manifest)) fail(`${source} 必须是 JSON 对象。`);
  if (manifest.api !== PLUGIN_API) fail(`${source} 要求插件接口 ${manifest.api ?? '未声明'}，当前宿主支持 ${PLUGIN_API}。`);
  const id = manifest.id ?? dirName;
  if (typeof id !== 'string' || !ID.test(id)) fail(`${source} 的 id 必须是 1-40 位小写字母、数字或连字符。`);
  const kind = manifest.kind ?? id;
  if (typeof kind !== 'string' || !ID.test(kind)) fail(`${source} 的 kind 必须是 1-40 位小写字母、数字或连字符。`);
  const name = manifest.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 80) fail(`${source} 缺少插件名称或名称过长。`);
  const version = manifest.version;
  if (typeof version !== 'string' || !version.trim() || version.length > 40) fail(`${source} 缺少版本号或版本号过长。`);
  const entry = manifest.entry ?? 'index.mjs';
  if (typeof entry !== 'string' || !entry || entry.length > MAX_ENTRY || entry.startsWith('/') || entry.includes('..') || entry.includes('\\')) fail(`${source} 的入口文件无效。`);
  if (manifest.singleton !== undefined && typeof manifest.singleton !== 'boolean') fail(`${source} 的 singleton 必须是布尔值。`);
  if (manifest.capabilities !== undefined && (!Array.isArray(manifest.capabilities) || manifest.capabilities.some(item => typeof item !== 'string' || item.length > 40))) fail(`${source} 的 capabilities 无效。`);
  if (manifest.requires !== undefined && (!Array.isArray(manifest.requires) || manifest.requires.some(item => typeof item !== 'string' || !ID.test(item)))) fail(`${source} 的 requires 无效。`);
  if (manifest.toolHints !== undefined && (!Array.isArray(manifest.toolHints) || manifest.toolHints.length > 20 || manifest.toolHints.some(item => typeof item !== 'string' || item.length > 200))) fail(`${source} 的 toolHints 无效。`);
  if (manifest.commandPattern !== undefined) {
    if (typeof manifest.commandPattern !== 'string' || manifest.commandPattern.length > 400) fail(`${source} 的 commandPattern 无效。`);
    try { new RegExp(manifest.commandPattern, 'u'); } catch { fail(`${source} 的 commandPattern 不是有效的正则。`); }
  }
  return {
    api: PLUGIN_API, id, kind, name: name.trim(), version: version.trim(),
    description: typeof manifest.description === 'string' ? manifest.description.slice(0, 500) : '',
    author: typeof manifest.author === 'string' ? manifest.author.slice(0, 100) : '',
    entry, singleton: manifest.singleton !== false,
    groupOnly: manifest.groupOnly === true,
    unprefixedTools: manifest.unprefixedTools === true,
    requires: [...new Set(manifest.requires ?? [])],
    toolHints: [...new Set(manifest.toolHints ?? [])],
    commandPattern: manifest.commandPattern ?? '',
    capabilities: [...new Set(manifest.capabilities ?? [])],
    panel: typeof manifest.panel === 'string' && ID.test(manifest.panel) ? manifest.panel : '',
    runtime: 'host'
  };
}

function bindEntry(manifest, mod, dir) {
  if (!plain(mod)) fail(`插件 ${manifest.id} 的入口没有导出模块。`);
  const create = mod.create ?? mod.default;
  if (typeof create !== 'function') fail(`插件 ${manifest.id} 必须导出 create(ctx) 函数。`);
  const template = () => {
    if (typeof mod.template !== 'function') return null;
    const value = mod.template();
    return plain(value) ? structuredClone(value) : null;
  };
  return {
    ...manifest, dir,
    template,
    config: value => typeof mod.config === 'function' ? mod.config(value ?? {}) : plain(value) ? structuredClone(value) : {},
    schema: () => typeof mod.schema === 'function' ? mod.schema() : undefined,
    tools: config => typeof mod.tools === 'function' ? mod.tools(config) : [],
    visible: typeof mod.visible === 'function' ? (plugin, context) => mod.visible(plugin, context) : null,
    run: typeof mod.run === 'function' ? (service, plugin, event, options) => mod.run(service, plugin, event, options) : null,
    destroy: typeof mod.destroy === 'function' ? (service, id) => mod.destroy(service, id) : null,
    changed: typeof mod.changed === 'function' ? (service, plugin) => mod.changed(service, plugin) : null,
    setup: typeof mod.setup === 'function' ? context => mod.setup(context) : null,
    create: ctx => mod.create(ctx)
  };
}

export class PluginRegistry {
  constructor(dir) { this.dir = dir; this.packages = new Map(); this.warnings = []; this.skipped = []; }
  static async load({ dir, log } = {}) {
    dir = dir || await resolvePluginDir();
    const registry = new PluginRegistry(dir);
    let names;
    try { names = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') { log?.('warn', 'plugin_dir_missing', { dir }); return registry; }
      throw error;
    }
    for (const item of names.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!item.isDirectory() || item.name.startsWith('_') || item.name.startsWith('.')) continue;
      const packageDir = join(dir, item.name);
      const manifestPath = join(packageDir, 'plugin.json');
      let raw;
      try { raw = await readFile(manifestPath, 'utf8'); }
      catch (error) {
        if (error.code !== 'ENOENT') registry.warn(log, 'plugin_manifest_unreadable', item.name);
        else registry.note(item.name, 'portable');
        continue;
      }
      let manifest;
      try { manifest = parseManifest(raw, item.name, `plugins/${item.name}/plugin.json`); }
      catch (error) { registry.warn(log, 'plugin_manifest_invalid', item.name, error.message); continue; }
      if (registry.packages.has(manifest.kind)) { registry.warn(log, 'plugin_kind_duplicate', manifest.kind); continue; }
      const entryPath = join(packageDir, manifest.entry);
      try { if (!(await stat(entryPath)).isFile()) throw new Error('missing'); }
      catch { registry.warn(log, 'plugin_entry_missing', item.name); continue; }
      let mod;
      try { mod = await import(pathToFileURL(entryPath).href); }
      catch (error) { registry.warn(log, 'plugin_entry_failed', item.name, error.message); continue; }
      try { registry.packages.set(manifest.kind, bindEntry(manifest, mod, packageDir)); }
      catch (error) { registry.warn(log, 'plugin_contract_invalid', item.name, error.message); }
    }
    return registry;
  }
  note(dirName, reason) { this.skipped.push({ dir: dirName, reason }); }
  warn(log, event, dirName, detail) {
    this.note(dirName, event);
    log?.('warn', event, detail ? { plugin: dirName, detail: String(detail).slice(0, 200) } : { plugin: dirName });
  }
  get(kind) { return this.packages.get(kind) ?? null; }
  has(kind) { return this.packages.has(kind); }
  kinds() { return [...this.packages.keys()]; }
  list() { return [...this.packages.values()].map(({ dir, create, config, ...rest }) => rest); }
  templates() { return [...this.packages.values()].map(entry => entry.template()).filter(Boolean); }
}

export { fail as pluginProblem, plain as isPlainObject };
export const validateManifest = (raw, source = 'plugin.json') => parseManifest(raw, 'package', source);

