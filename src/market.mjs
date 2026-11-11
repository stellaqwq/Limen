// 插件市场：读一份静态 index.json，把清单里的插件包下载、校验后交给现有安装器。
//
// 设计约束：
// - 只有清单里的地址会被下载，且必须命中允许的域名（默认=清单所在域名）。
// - 不跟随重定向：redirect:'error'，避免用一次 302 绕过域名白名单（SSRF）。
// - http 只对本机回环开放，方便 `node --http-server` 本地调试清单。
// - 插件包沿用 packages.mjs 的 2 MiB/文件、24 MiB/包、32 MiB/ZIP 限制；
//   二进制资源（如 FFmpeg）走 assets 通道，落到 runtime/ 下，与插件版本解耦。
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { MAX_ZIP_BYTES } from './plugins/packages.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,16})?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const CATALOG_LIMIT = 512 * 1024;
const ASSET_LIMIT = 320 * 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 3;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
// GitHub Release 的下载地址会 302 到对象存储；这些域名只用来“接一跳”，
// 真正决定装不装的是落到盘前的 size 与 SHA-256。
const DEFAULT_REDIRECT_HOSTS = [
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'codeload.github.com'
];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const loopback = host => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
/** 私有与链路本地地址：即使域名解析到这里也不该被市场访问。 */
function privateHost(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
  }
  if (host.startsWith('[')) return /^\[(?:fc|fd|fe80|::1|::)/i.test(host);
  return false;
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const parseVersion = value => value.split(/[-+]/)[0].split('.').map(Number);
export function compareVersion(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 校验并归一化清单里的一条插件包。返回 null 表示该条无效。 */
function readPackage(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const id = text(entry.id, 40), kind = text(entry.kind || entry.id, 40);
  if (!ID.test(id) || !ID.test(kind)) return null;
  if (!VERSION.test(text(entry.version, 32))) return null;
  if (!SHA256.test(String(entry.sha256 || ''))) return null;
  if (typeof entry.url !== 'string' || !entry.url) return null;
  const size = Number(entry.size);
  if (!Number.isSafeInteger(size) || size < 1) return null;
  const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities.filter(item => typeof item === 'string').slice(0, 12) : [];
  return {
    id, kind, version: entry.version, name: text(entry.name, 80) || id, description: text(entry.description, 500),
    api: Number(entry.api ?? 1), capabilities, size, sha256: String(entry.sha256).toLowerCase(), url: entry.url,
    homepage: text(entry.homepage, 300), changelog: text(entry.changelog, 2000), yanked: entry.yanked === true
  };
}
/** 资源条目：二进制文件或 ZIP，落盘到 runtime/ 下的相对目录。 */
function readAsset(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const id = text(entry.id, 40);
  if (!ID.test(id)) return null;
  const installTo = text(entry.install_to, 120);
  if (!SAFE_RELATIVE.test(installTo) || !installTo.startsWith('runtime/')) return null;
  const files = Array.isArray(entry.files) ? entry.files.filter(file => typeof file === 'string' && SAFE_RELATIVE.test(file)).slice(0, 64) : [];
  if (!files.length) return null;
  if (!SHA256.test(String(entry.sha256 || ''))) return null;
  if (typeof entry.url !== 'string' || !entry.url) return null;
  const size = Number(entry.size);
  if (!Number.isSafeInteger(size) || size < 1) return null;
  return {
    id, name: text(entry.name, 80) || id, version: text(entry.version, 32) || '1.0.0',
    install_to: installTo.replace(/\/+$/, ''), files, size, sha256: String(entry.sha256).toLowerCase(),
    url: entry.url, archive: entry.archive === 'file' ? 'file' : 'zip',
    description: text(entry.description, 300), homepage: text(entry.homepage, 300)
  };
}

export class MarketService {
  constructor({ config, plugins, log = () => {}, fetch: fetcher = fetch, root = appRoot, workspace = process.cwd() }) {
    Object.assign(this, { config, plugins, log, fetcher, root, workspace });
    this.cache = null;
    this.pending = null;
  }
  get catalogUrl() { return this.config.market?.catalogUrl || ''; }
  get timeout() { return this.config.market?.timeout ?? 30000; }
  get maxPackageBytes() { return Math.min(this.config.market?.maxPackageBytes ?? MAX_ZIP_BYTES, MAX_ZIP_BYTES); }
  allowedHosts() {
    const configured = this.config.market?.allowedHosts || [];
    if (configured.length) return new Set(configured);
    try { return new Set([new URL(this.catalogUrl).hostname.toLowerCase()]); } catch { return new Set(); }
  }
  /** 只允许 https（回环可用 http）、无凭据、命中白名单、非私有地址的绝对地址。 */
  checkedURL(value, allowed = this.allowedHosts()) {
    let parsed;
    try { parsed = new URL(String(value)); } catch { throw fail('地址无效：' + String(value).slice(0, 120), 400); }
    if (parsed.username || parsed.password) throw fail('地址不能包含用户名或密码。');
    const host = parsed.hostname.toLowerCase(), local = loopback(host);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw fail('市场只允许 https 地址（本机调试可用 127.0.0.1）。');
    if (privateHost(host) && !local) throw fail('市场不允许访问内网地址：' + host);
    if (!local && !allowed.has(host)) throw fail('域名 ' + host + ' 不在允许列表里；请在“插件市场”设置中补充。', 403);
    return parsed;
  }
  /** 允许多跳一次到受信 CDN（GitHub Release 会 302 到对象存储）；留空时用内置清单。 */
  redirectHosts() {
    const configured = this.config.market?.redirectHosts || [];
    return new Set(configured.length ? configured : DEFAULT_REDIRECT_HOSTS);
  }
  /**
   * 跳转目标也要过同一套检查：https、无凭据、非内网，且域名在白名单或受信 CDN 里。
   * 允许跳转不等于放宽信任：落到盘前仍然要比 size 与 SHA-256。
   */
  redirectTarget(location, current, allowed) {
    let next;
    try { next = new URL(String(location), current); } catch { throw fail('跳转地址无效：' + String(location).slice(0, 120), 502); }
    const host = next.hostname.toLowerCase(), local = loopback(host);
    const localHop = local && loopback(current.hostname);
    if (next.username || next.password) throw fail('跳转地址不能包含用户名或密码。', 502);
    if (next.protocol !== 'https:' && !(next.protocol === 'http:' && localHop)) throw fail('跳转到了非 https 地址，已中止：' + next.origin, 502);
    if (privateHost(host) && !local) throw fail('跳转到了内网地址，已中止：' + host, 502);
    if (!local && !allowed.has(host) && !this.redirectHosts().has(host)) {
      throw fail('跳转域名 ' + host + ' 不在允许列表里；确需跳转请把域名填进“市场设置 → 允许跳转的域名”。', 403);
    }
    return next;
  }
  async fetchBytes(value, { maxBytes, label = '文件', allowed = this.allowedHosts(), timeout = this.timeout }) {
    let target = this.checkedURL(value, allowed);
    const deadline = Date.now() + timeout;
    let response, hops = 0;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw fail('下载' + label + '超时（' + Math.round(timeout / 1000) + ' 秒）。', 504);
      try {
        response = await this.fetcher(target, { redirect: 'manual', signal: AbortSignal.timeout(remaining),
          headers: { 'Accept': 'application/octet-stream, application/json;q=0.9, */*;q=0.5' } });
      } catch (error) {
        if (error?.name === 'TimeoutError') throw fail('下载' + label + '超时（' + Math.round(timeout / 1000) + ' 秒）。', 504);
        throw fail('无法连接 ' + target.hostname + '：' + (error?.cause?.code || error.message), 502);
      }
      if (!REDIRECT_CODES.has(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel?.().catch(() => {});
      if (!location) throw fail('下载' + label + '失败：服务器返回了跳转但没有目标地址。', 502);
      if (++hops > MAX_REDIRECTS) throw fail('下载' + label + '跳转次数超过上限（' + MAX_REDIRECTS + ' 次），已中止。', 502);
      target = this.redirectTarget(location, target, allowed);
    }
    if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw fail('下载' + label + '失败（HTTP ' + response.status + '）。', 502); }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) { await response.body?.cancel?.().catch(() => {}); throw fail(label + '超过大小上限 ' + Math.round(maxBytes / 1048576) + ' MiB。', 413); }
    const chunks = []; let total = 0;
    if (!response.body) throw fail('下载' + label + '失败：响应为空。', 502);
    for await (const chunk of Readable.fromWeb(response.body)) {
      total += chunk.length;
      if (total > maxBytes) throw fail(label + '超过大小上限 ' + Math.round(maxBytes / 1048576) + ' MiB。', 413);
      chunks.push(Buffer.from(chunk));
    }
    return { bytes: Buffer.concat(chunks), url: target.toString(), redirects: hops };
  }
  async readCatalog(force = false) {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    if (!this.catalogUrl) {
      // 便携包自带离线清单：没配地址也开箱可用。装包时若包内 market/packages/ 有
      // 同名 zip（仍按 size/SHA-256 校验），连下载都不用走网络。
      const bundled = await this.readBundledCatalog();
      if (!bundled) throw fail('还没有配置市场清单地址，便携包也没有携带离线清单；请在“全部设置 → 插件市场”里填写 index.json 的地址。', 409);
      this.cache = bundled;
      return bundled;
    }
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const target = this.checkedURL(this.catalogUrl);
      let raw;
      try {
        const { bytes } = await this.fetchBytes(target.toString(), { maxBytes: CATALOG_LIMIT, label: '市场清单' });
        raw = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        // 清单读不到时保留上一份缓存，把失败原因作为 warning 交给界面。
        if (this.cache) {
          this.cache.warning = error.message + '（显示的是 ' + new Date(this.cache.at).toLocaleString('zh-CN', { hour12: false }) + ' 的缓存）';
          return this.cache;
        }
        throw error;
      }
      const parsed = this.parseCatalog(raw);
      this.cache = { at: Date.now(), source: target.toString(), ...parsed };
      return this.cache;
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
  /** 清单结构校验：网络与随包清单走同一套规则，避免离线副本放宽要求。 */
  parseCatalog(raw) {
    if (!raw || typeof raw !== 'object' || raw.schema !== 1) throw fail('市场清单格式不支持：需要 {"schema":1,...}。', 502);
    const rejected = [];
    const packages = [];
    for (const entry of Array.isArray(raw.plugins) ? raw.plugins : []) {
      const parsed = readPackage(entry);
      if (!parsed) { rejected.push({ id: text(entry?.id, 40) || '?', reason: '条目字段不完整或格式不支持' }); continue; }
      if (parsed.api !== 1) { rejected.push({ id: parsed.id, reason: '需要插件 API ' + parsed.api }); continue; }
      packages.push(parsed);
    }
    const assets = (Array.isArray(raw.assets) ? raw.assets : []).map(readAsset).filter(Boolean);
    return { plugins: packages, assets, rejected, name: text(raw.name, 80) };
  }
  get bundledCatalogPath() { return join(this.root, 'market', 'index.json'); }
  async hasBundledCatalog() { return (await stat(this.bundledCatalogPath).catch(() => null))?.isFile() === true; }
  /** 读包内离线清单；文件缺失或损坏返回 null（退回“未配置”的报错），不抛网络类异常。 */
  async readBundledCatalog() {
    const bytes = await readFile(this.bundledCatalogPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!bytes || bytes.length > CATALOG_LIMIT) return null;
    let parsed;
    try { parsed = this.parseCatalog(JSON.parse(bytes.toString('utf8'))); }
    catch { return null; }
    return { at: Date.now(), source: '随包清单（离线快照，插件包也在包内）', ...parsed, bundled: true };
  }
  /** 清单 + 已安装状态，供控制台渲染。 */
  async overview({ refresh = false } = {}) {
    const installed = await this.plugins.packages();
    const rows = this.plugins.list().plugins;
    const byKind = new Map(installed.packages.map(item => [item.kind, item]));
    const enabled = new Map(rows.map(row => [row.kind, row.enabled]));
    const decorate = entry => {
      const local = byKind.get(entry.kind) || installed.packages.find(item => item.id === entry.id) || null;
      const state = !local ? 'available' : compareVersion(entry.version, local.version) > 0 ? 'upgradable' : 'installed';
      return { ...entry, state, enabled: enabled.get(entry.kind) ?? null,
        installed_version: local?.version || null, local_id: local?.id || null,
        record: rows.some(row => row.kind === entry.kind) };
    };
    let catalog = null, error = null;
    if (this.catalogUrl || await this.hasBundledCatalog()) {
      try { catalog = await this.readCatalog(refresh); } catch (failure) { error = { message: failure.message, status: failure.status || 502 }; }
    }
    if (catalog?.warning) error = { message: catalog.warning, status: 502 };
    const results = (catalog?.plugins || []).map(decorate);
    // 已安装但清单里没有的插件也列出来，避免“装了但市场里看不到”。
    const external = installed.packages.filter(item => !results.some(entry => entry.kind === item.kind))
      .map(item => ({ id: item.id, kind: item.kind, name: item.name, version: item.version, description: item.description,
        capabilities: item.capabilities || [], state: 'local', enabled: enabled.get(item.kind) ?? null,
        installed_version: item.version, local_id: item.id, record: rows.some(row => row.kind === item.kind),
        size: 0, sha256: '', url: '', homepage: '', changelog: '', yanked: false }));
    const assets = await Promise.all((catalog?.assets || []).map(async asset => ({ ...asset, ...(await this.assetState(asset)) })));
    return {
      configured: !!this.catalogUrl || !!catalog, catalog_url: this.catalogUrl || '', bundled: catalog?.bundled === true,
      allowed_hosts: [...this.allowedHosts()],
      source: catalog?.source || '', fetched_at: catalog?.at || null, cached: !!catalog && !refresh,
      plugins: [...results, ...external], assets, rejected: catalog?.rejected || [], error
    };
  }
  async assetState(asset) {
    for (const base of [this.root, this.workspace]) {
      const directory = resolve(base, asset.install_to);
      const missing = [];
      for (const file of asset.files) {
        const path = resolve(directory, file);
        if (!path.startsWith(directory + sep)) { missing.push(file); continue; }
        const info = await stat(path).catch(() => null);
        if (!info?.isFile() || !info.size) missing.push(file);
      }
      if (!missing.length) return { ready: true, directory };
    }
    return { ready: false, directory: resolve(this.root, asset.install_to) };
  }
  /** 取插件包字节：优先随包的 market/packages/<同名 zip>（仍校验 size/SHA-256），没有才走网络。 */
  async loadPackageBytes(entry, label) {
    let name = '';
    try { name = basename(new URL(entry.url).pathname); } catch { name = ''; }
    if (/^[\w.-]+\.zip$/.test(name)) {
      const path = join(this.root, 'market', 'packages', name);
      const bytes = await readFile(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (bytes && bytes.length === entry.size && sha256(bytes) === entry.sha256) {
        return { bytes, url: '随包文件 ' + name, local: true };
      }
      if (bytes) {
        this.log('warn', 'market_bundled_package_mismatch', { plugin: entry.id, file: name, expected: entry.size, actual: bytes.length });
        if (!this.catalogUrl) throw fail('随包插件包 ' + name + ' 与清单不符（大小或校验值不一致），且没有配置市场清单地址，无法改从网络下载。', 502);
      }
    }
    const fetched = await this.fetchBytes(entry.url, { maxBytes: this.maxPackageBytes, label });
    return { ...fetched, local: false };
  }
  async install({ id, overwrite }) {
    const catalog = await this.readCatalog();
    const entry = catalog.plugins.find(item => item.id === id || item.kind === id);
    if (!entry) throw fail('市场清单里没有这个插件：' + id, 404);
    if (entry.yanked) throw fail('该插件已被作者撤回，不再提供安装。', 409);
    if (entry.size > this.maxPackageBytes) throw fail('插件包大小 ' + entry.size + ' 字节超过上限。', 413);
    const { bytes, url, local } = await this.loadPackageBytes(entry, '插件包 ' + entry.name);
    if (bytes.length !== entry.size) throw fail('插件包大小与清单不符（清单 ' + entry.size + ' 字节，实际 ' + bytes.length + ' 字节），已中止。', 502);
    if (sha256(bytes) !== entry.sha256) throw fail('插件包校验失败：SHA-256 与清单不符，已中止安装。', 502);
    // 先只校验清单，确认下载到的确实是清单里那个包，再写入 plugins/。
    const inspected = await this.plugins.inspectPackageBytes({ bytes, name: entry.id + '-' + entry.version + '.zip' });
    const manifest = inspected.manifest;
    if (manifest.id !== entry.id || manifest.kind !== entry.kind || manifest.version !== entry.version) {
      throw fail('包内清单与市场条目不一致（包内 ' + manifest.id + ' ' + manifest.version + '），已中止安装。', 502);
    }
    const existing = (await this.plugins.packages()).packages.find(item => item.kind === entry.kind);
    const result = await this.plugins.installPackageBytes({ bytes, name: entry.id + '-' + entry.version + '.zip', overwrite: overwrite === true || !!existing });
    // 包已就位：顺手创建插件记录，否则“插件管理”里看不到它（与手动导入的行为一致）。
    let plugin = null;
    try { plugin = await this.plugins.install({ kind: entry.kind }); } catch { plugin = null; }
    this.log('info', 'market_install', { plugin: entry.id, version: entry.version, source: url });
    return { installed: true, id: entry.id, kind: entry.kind, version: entry.version, replaced: !!existing,
      files: result.files, plugin: plugin ? { id: plugin.id, kind: plugin.kind, enabled: plugin.enabled } : null };
  }
  async uninstall({ id, confirm }) {
    if (confirm !== true) throw fail('卸载会删除插件目录，需要显式确认。', 400);
    const target = (await this.plugins.packages()).packages.find(item => item.id === id || item.kind === id);
    if (!target) throw fail('插件目录里没有这个包：' + id, 404);
    const rows = this.plugins.list().plugins.filter(row => row.kind === target.kind);
    for (const row of rows) await this.plugins.remove({ id: row.id, revision: row.revision }).catch(() => {});
    await this.plugins.removePackage({ id: target.id });
    this.log('info', 'market_uninstall', { plugin: target.id });
    return { removed: true, id: target.id, kind: target.kind, records: rows.length };
  }
  async installAsset({ id }) {
    const catalog = await this.readCatalog();
    const asset = catalog.assets.find(item => item.id === id);
    if (!asset) throw fail('市场清单里没有这个资源：' + id, 404);
    const maxBytes = Math.min(ASSET_LIMIT, Math.max(asset.size * 2, 8 * 1024 * 1024));
    // 媒体工具动辄上百 MB，给资源下载单独放宽超时。
    const { bytes, url } = await this.fetchBytes(asset.url, { maxBytes, label: '资源 ' + asset.name, timeout: Math.max(this.timeout, 600000) });
    if (bytes.length !== asset.size) throw fail('资源大小与清单不符（清单 ' + asset.size + ' 字节，实际 ' + bytes.length + ' 字节），已中止。', 502);
    if (sha256(bytes) !== asset.sha256) throw fail('资源校验失败：SHA-256 与清单不符，已中止。', 502);
    const files = new Map();
    if (asset.archive === 'file') {
      if (asset.files.length !== 1) throw fail('单文件资源只能配置一个文件目标。', 400);
      files.set(asset.files[0], bytes);
    } else {
      let entries;
      try { entries = unzipSync(new Uint8Array(bytes), { filter: file => asset.files.includes(file.name) || asset.files.some(name => file.name.endsWith('/' + name)) }); }
      catch { throw fail('资源不是可读取的 ZIP 文件。', 502); }
      for (const wanted of asset.files) {
        const match = entries[wanted] || Object.entries(entries).find(([name]) => name.endsWith('/' + wanted))?.[1];
        if (!match) throw fail('压缩包里缺少 ' + wanted + '，已中止。', 502);
        files.set(wanted, Buffer.from(match));
      }
    }
    // 优先写进应用目录；装在只读位置（如 Program Files）时退回工作目录，
    // 视频等插件本来就同时查找这两处 runtime/。
    const errors = [];
    for (const base of [this.root, this.workspace]) {
      const directory = resolve(base, asset.install_to);
      if (!directory.startsWith(resolve(base) + sep)) continue;
      try {
        for (const [name, data] of files) {
          const path = resolve(directory, name);
          if (!path.startsWith(directory + sep)) throw new Error('资源路径无效');
          await mkdir(resolve(path, '..'), { recursive: true });
          await writeFile(path + '.partial', data);
          await rename(path + '.partial', path);
        }
        this.log('info', 'market_asset_installed', { asset: asset.id, version: asset.version, directory });
        return { installed: true, id: asset.id, version: asset.version, directory,
          files: [...files].map(([name, data]) => ({ path: name, bytes: data.length })), source: url };
      } catch (error) { errors.push(directory + '：' + error.message); }
    }
    throw fail('资源无法写入 runtime 目录：' + errors.join('；'), 500);
  }
}
