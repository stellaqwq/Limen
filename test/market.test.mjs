import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { app, temp, request, cleanup, config } from './helpers.mjs';
import { launchWorkspace } from '../scripts/launch.mjs';
import { MarketService, compareVersion } from '../src/market.mjs';

const ID = 'market-demo';
const manifest = (extra = {}) => ({
  api: 1, id: ID, kind: ID, name: '市场演示', version: '1.0.0',
  description: 'market fixture', entry: 'index.mjs', singleton: true, capabilities: ['agent-tools'], ...extra
});
const entrySource = `export const template = () => ({ schema: 1, kind: '${ID}', name: '市场演示', version: '1.0.0',
  description: 'market fixture', source: '// market', trigger: '', priority: 0, timeout_ms: 2000,
  scope: { private_users: [], groups: [], all_private: false, all_groups: false, require_at: true }, config: {} });
export const config = value => ({ ...value });
export const create = () => ({});
export const run = async () => ({ handled: true });
`;
const buildArchive = (version, extra = {}) => Buffer.from(zipSync({
  'plugin.json': strToU8(JSON.stringify(manifest({ version, ...extra }), null, 2)),
  'index.mjs': strToU8(entrySource)
}));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** 一个只认文件名的静态站点，够用来托管 index.json 与插件包。 */
async function serve(t, directory) {
  const server = createServer(async (req, res) => {
    const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.json';
    try {
      const bytes = await readFile(join(directory, name));
      res.writeHead(200, { 'Content-Length': bytes.length }); res.end(bytes);
    } catch { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  cleanup(t, () => new Promise(ok => server.close(() => ok())));
  return 'http://127.0.0.1:' + server.address().port + '/';
}

async function writeCatalog(directory, base, { version = '1.0.0', sha256, url, assets = [] } = {}) {
  const archive = buildArchive(version);
  await mkdir(join(directory, 'packages'), { recursive: true });
  const name = `${ID}-${version}.zip`;
  await writeFile(join(directory, 'packages', name), archive);
  await writeFile(join(directory, 'index.json'), JSON.stringify({
    schema: 1, name: '测试市场', updated_at: new Date().toISOString(), assets,
    plugins: [{ id: ID, kind: ID, api: 1, name: '市场演示', version, description: '来自静态清单',
      capabilities: ['agent-tools'], size: archive.length, sha256: sha256 || digest(archive),
      url: url || new URL('packages/' + name, base).toString() }]
  }));
  return archive;
}

// 安装会写进真实的 plugins/ 目录，无论断言是否失败都要清掉。
const removeInstalled = (t, bot) => cleanup(t, async () => {
  await request(bot, '/admin/market/uninstall', { id: ID, confirm: true }).catch(() => {});
});

test('market: 清单列出、安装、更新都走现有安装器', async t => {
  const directory = await temp(t);
  const base = await serve(t, directory);
  await writeCatalog(directory, base);
  const bot = await app(t, { MARKET_CATALOG_URL: new URL('index.json', base).toString() });
  removeInstalled(t, bot);

  const listed = await request(bot, '/admin/market');
  assert.equal(listed.code, 200);
  assert.equal(listed.data.configured, true);
  const entry = listed.data.plugins.find(item => item.id === ID);
  assert.equal(entry.state, 'available');
  assert.equal(entry.version, '1.0.0');
  assert.equal(listed.data.error, null);

  const installed = await request(bot, '/admin/market/install', { id: ID });
  assert.equal(installed.code, 200);
  assert.equal(installed.data.version, '1.0.0');
  assert.equal(installed.data.kind, ID);
  assert.ok(installed.data.plugin, '安装后应自动建立插件记录');
  const packages = await request(bot, '/admin/plugins/packages');
  assert.ok(packages.data.packages.some(item => item.kind === ID));
  assert.ok((await request(bot, '/admin/plugins')).data.plugins.some(item => item.kind === ID));

  assert.equal((await request(bot, '/admin/market')).data.plugins.find(item => item.id === ID).state, 'installed');

  await writeCatalog(directory, base, { version: '1.1.0' });
  const refreshed = await request(bot, '/admin/market?refresh=1');
  const upgraded = refreshed.data.plugins.find(item => item.id === ID);
  assert.equal(upgraded.state, 'upgradable');
  assert.equal(upgraded.installed_version, '1.0.0');
  assert.equal(upgraded.version, '1.1.0');

  const update = await request(bot, '/admin/market/install', { id: ID });
  assert.equal(update.code, 200);
  assert.equal(update.data.version, '1.1.0');
  assert.equal(update.data.replaced, true);
  assert.ok((await request(bot, '/admin/plugins/packages')).data.packages.find(item => item.kind === ID));
});

test('market: 校验和与域名不合规时拒绝安装，目录不受影响', async t => {
  const directory = await temp(t);
  const base = await serve(t, directory);
  await writeCatalog(directory, base, { sha256: 'f'.repeat(64) });
  const bot = await app(t, { MARKET_CATALOG_URL: new URL('index.json', base).toString() });
  removeInstalled(t, bot);

  const rejected = await request(bot, '/admin/market/install', { id: ID });
  assert.equal(rejected.code, 502);
  assert.match(rejected.data.message, /SHA-256/);
  assert.ok(!(await request(bot, '/admin/plugins/packages')).data.packages.some(item => item.kind === ID));
});

test('market: 白名单、内网地址与协议都在下载前拦掉', async t => {
  const service = new MarketService({
    config: { market: { catalogUrl: 'https://market.example.com/index.json', allowedHosts: ['market.example.com', 'cdn.example.com'] } },
    plugins: null
  });
  assert.equal(service.checkedURL('https://cdn.example.com/a.zip').hostname, 'cdn.example.com');
  assert.throws(() => service.checkedURL('https://other.example.com/a.zip'), /不在允许列表/);
  assert.throws(() => service.checkedURL('http://cdn.example.com/a.zip'), /只允许 https/);
  assert.throws(() => service.checkedURL('https://10.0.0.5/a.zip'), /不在允许列表|内网/);
  assert.throws(() => service.checkedURL('https://user:pass@cdn.example.com/a.zip'), /用户名或密码/);
  // 本机回环允许 http，方便本地调试清单。
  assert.equal(service.checkedURL('http://127.0.0.1:8080/index.json').port, '8080');
  // 私有地址即使命中白名单也不放行。
  const local = new MarketService({ config: { market: { catalogUrl: 'https://10.1.2.3/index.json', allowedHosts: ['10.1.2.3'] } }, plugins: null });
  assert.throws(() => local.checkedURL('https://10.1.2.3/index.json'), /内网/);

  assert.equal(compareVersion('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersion('2.0.0', '2.0.0'), 0);
});

test('market: 卸载需要显式确认，并删掉包目录', async t => {
  const directory = await temp(t);
  const base = await serve(t, directory);
  await writeCatalog(directory, base);
  const bot = await app(t, { MARKET_CATALOG_URL: new URL('index.json', base).toString() });
  removeInstalled(t, bot);
  assert.equal((await request(bot, '/admin/market/install', { id: ID })).code, 200);

  const unconfirmed = await request(bot, '/admin/market/uninstall', { id: ID });
  assert.equal(unconfirmed.code, 400);
  assert.ok((await request(bot, '/admin/plugins/packages')).data.packages.some(item => item.kind === ID));

  const removed = await request(bot, '/admin/market/uninstall', { id: ID, confirm: true });
  assert.equal(removed.code, 200);
  assert.ok(!(await request(bot, '/admin/plugins/packages')).data.packages.some(item => item.kind === ID));
  assert.ok(!(await request(bot, '/admin/plugins')).data.plugins.some(item => item.kind === ID));
});

test('market: 工作台代理市场接口，控制台页面自带市场视图', async t => {
  const workspace = await launchWorkspace(config(await temp(t)));
  cleanup(t, () => workspace.close());

  const listed = await fetch(workspace.url + '/market');
  assert.equal(listed.status, 200);
  const overview = await listed.json();
  assert.equal(overview.configured, false, '没配清单时也要返回可渲染的概览');
  assert.deepEqual(overview.assets, []);
  // 清单没配，随程序提供的插件包应以“不在清单”出现，而不是让页面空白。
  assert.ok(overview.plugins.length > 0);
  assert.ok(overview.plugins.every(item => item.state === 'local' && item.size === 0));

  // 没配清单时安装被拒，状态码要透传，前端才能给出准确提示。
  // POST 需要同源 Origin（浏览器同源 POST 也会带），否则工作台直接 403。
  const blocked = await fetch(workspace.url + '/market/install', { method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(workspace.url).origin },
    body: JSON.stringify({ id: ID }) });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).message, /清单地址/);

  const page = await (await fetch(workspace.url + '/console')).text();
  assert.ok(page.includes('assets/app.js'), '控制台要带上脚本入口');
  const script = await (await fetch(workspace.url + '/assets/app.js')).text();
  for (const marker of ['插件市场', 'viewMarket', 'market-install', 'market-uninstall', 'market-asset']) {
    assert.ok(script.includes(marker), '控制台市场视图缺少 ' + marker);
  }
  const layer = await (await fetch(workspace.url + '/assets/api.js')).text();
  assert.ok(layer.includes("post('/market/install'") && layer.includes('620000'));
});

test('market: 下载允许跳转到受信 CDN，落地前仍然校验', async t => {
  const directory = await temp(t);
  const base = await serve(t, directory);
  // 模拟 GitHub Release：真正的包在别处，清单里的地址先 302。
  const hop = createServer((req, res) => {
    const name = (req.url || '/').split('?')[0].replace(/^\//, '');
    res.writeHead(302, { Location: new URL(name, base).toString() });
    res.end();
  });
  await new Promise(ok => hop.listen(0, '127.0.0.1', ok));
  cleanup(t, () => new Promise(ok => hop.close(() => ok())));
  const hopBase = 'http://127.0.0.1:' + hop.address().port + '/';
  await writeCatalog(directory, base, { url: hopBase + `packages/${ID}-1.0.0.zip` });

  const bot = await app(t, { MARKET_CATALOG_URL: new URL('index.json', base).toString() });
  removeInstalled(t, bot);
  const installed = await request(bot, '/admin/market/install', { id: ID });
  assert.equal(installed.code, 200);
  assert.equal(installed.data.version, '1.0.0');
  assert.ok((await request(bot, '/admin/plugins/packages')).data.packages.some(item => item.kind === ID));

  // 跳转本身不构成信任：校验和不对仍然拒绝（清单有 5 分钟缓存，先强制刷新）。
  await writeCatalog(directory, base, { sha256: 'e'.repeat(64), url: hopBase + `packages/${ID}-1.0.0.zip` });
  await request(bot, '/admin/market?refresh=1');
  const rejected = await request(bot, '/admin/market/install', { id: ID });
  assert.equal(rejected.code, 502);
  assert.match(rejected.data.message, /SHA-256/);
});

test('market: 跳转目标、协议与跳转次数都在下载前拦掉', async t => {
  const catalog = new URL('https://raw.githubusercontent.com/u/r/main/index.json');
  const service = new MarketService({ config: { market: { catalogUrl: catalog.toString(), allowedHosts: ['github.com'] } }, plugins: null });
  // GitHub Release 的资产域名默认放行。
  const asset = service.redirectTarget('https://release-assets.githubusercontent.com/x?sig=1', new URL('https://github.com/u/r/releases/download/v1/a.zip'), new Set(['github.com']));
  assert.equal(asset.hostname, 'release-assets.githubusercontent.com');
  assert.throws(() => service.redirectTarget('https://evil.example.com/a.zip', new URL('https://github.com/u/r/a.zip'), new Set(['github.com'])), /不在允许列表/);
  assert.throws(() => service.redirectTarget('http://cdn.example.com/a.zip', new URL('https://github.com/u/r/a.zip'), new Set(['github.com'])), /非 https/);
  assert.throws(() => service.redirectTarget('https://10.1.2.3/a.zip', new URL('https://github.com/u/r/a.zip'), new Set(['github.com'])), /内网/);
  assert.throws(() => service.redirectTarget('https://user:pass@github.com/a.zip', new URL('https://github.com/u/r/a.zip'), new Set(['github.com'])), /用户名或密码/);
  // 自定义清单可以覆盖默认放行列表。
  const strict = new MarketService({ config: { market: { catalogUrl: catalog.toString(), redirectHosts: ['cdn.example.com'] } }, plugins: null });
  assert.throws(() => strict.redirectTarget('https://release-assets.githubusercontent.com/x', new URL('https://raw.githubusercontent.com/u/r/a.zip'), new Set(['raw.githubusercontent.com'])), /不在允许列表/);

  // 自己跳自己：3 跳之后必须停下。
  const loop = createServer((req, res) => { res.writeHead(302, { Location: req.url }); res.end(); });
  await new Promise(ok => loop.listen(0, '127.0.0.1', ok));
  cleanup(t, () => new Promise(ok => loop.close(() => ok())));
  const loopBase = 'http://127.0.0.1:' + loop.address().port + '/';
  const local = new MarketService({ config: { market: { catalogUrl: loopBase, timeout: 5000 } }, plugins: null });
  await assert.rejects(local.fetchBytes(loopBase + 'a.zip', { maxBytes: 4096, label: '测试包' }), /跳转次数超过上限/);
});

test('market: 资源包校验后落到 runtime 目录，越界目标被忽略', async t => {
  const directory = await temp(t);
  const root = await temp(t), workspace = await temp(t);
  const base = await serve(t, directory);
  await writeCatalog(directory, base);
  const assetBytes = Buffer.from(zipSync({
    'ffmpeg-9.0.2/bin/ffmpeg.exe': new Uint8Array([1, 2, 3, 4]),
    'ffmpeg-9.0.2/bin/ffprobe.exe': new Uint8Array([5, 6, 7])
  }));
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'assets', 'ffmpeg.zip'), assetBytes);
  const catalog = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
  catalog.assets = [
    { id: 'ffmpeg', name: 'FFmpeg', version: '9.0.2', install_to: 'runtime/video-tools',
      files: ['bin/ffmpeg.exe', 'bin/ffprobe.exe'], size: assetBytes.length, sha256: digest(assetBytes),
      url: new URL('assets/ffmpeg.zip', base).toString() },
    { id: 'escape', name: '越界资源', version: '1.0.0', install_to: 'plugins/evil',
      files: ['bin/ffmpeg.exe'], size: assetBytes.length, sha256: digest(assetBytes),
      url: new URL('assets/ffmpeg.zip', base).toString() }
  ];
  await writeFile(join(directory, 'index.json'), JSON.stringify(catalog));

  const stubs = { packages: async () => ({ packages: [] }), list: () => ({ plugins: [] }), install: async () => null };
  const service = new MarketService({ config: { market: { catalogUrl: new URL('index.json', base).toString(), allowedHosts: [], timeout: 5000, maxPackageBytes: 33554432 } },
    plugins: stubs, root, workspace });
  const overview = await service.overview();
  assert.equal(overview.assets.length, 1, 'install_to 不在 runtime/ 下的资源必须被忽略');
  assert.equal(overview.assets[0].ready, false);

  const result = await service.installAsset({ id: 'ffmpeg' });
  assert.equal(result.installed, true);
  assert.equal(result.directory, join(root, 'runtime', 'video-tools'));
  assert.deepEqual([...(await readFile(join(root, 'runtime', 'video-tools', 'bin', 'ffmpeg.exe')))], [1, 2, 3, 4]);
  assert.equal((await stat(join(root, 'runtime', 'video-tools', 'bin', 'ffprobe.exe'))).size, 3);
  assert.equal((await service.overview()).assets[0].ready, true);
});
