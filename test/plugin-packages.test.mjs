import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createLoginServer } from '../src/web/login-server.mjs';
import { app, temp, request, incoming, waitFor, cleanup } from './helpers.mjs';

const manifest = (extra = {}) => JSON.stringify({
  api: 1, id: 'demo-echo', kind: 'demo-echo', name: '演示回声', version: '1.0.0',
  description: 'external package fixture', entry: 'index.mjs', singleton: true, ...extra
}, null, 2);

const entry = `export const template = () => ({ schema: 1, kind: 'demo-echo', name: '演示回声', version: '1.0.0',
  description: 'external package fixture', source: '// external', trigger: '/echo', priority: 0, timeout_ms: 2000,
  scope: { private_users: [], groups: [], all_private: false, all_groups: false, require_at: true },
  config: { reply: '来自外部插件包' } });
export const config = value => ({ reply: '来自外部插件包', ...value });
export const create = () => ({ handle: async () => ({ reply: 'ok' }) });
export const run = async (service, plugin) => ({ reply: plugin.config.reply, handled: true });
`;

async function makePackage(t, { dir = 'pkg', id = 'demo-echo', body = entry } = {}) {
  const root = join(await temp(t), dir);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'plugin.json'), manifest({ id, kind: id }));
  await writeFile(join(root, 'index.mjs'), body);
  return root;
}

// Installed packages are copied into the real plugins/ directory, so every
// test removes them again even when an assertion fails.
function cleanupPackage(t, bot, id) {
  cleanup(t, async () => { await request(bot, '/admin/plugins/packages/remove', { id }).catch(() => {}); });
}

test('external plugin packages are inspected, installed, loaded and removed without touching src', async t => {
  const bot = await app(t);
  cleanupPackage(t, bot, 'demo-echo');
  const source = await makePackage(t);
  const inspected = await request(bot, '/admin/plugins/packages/inspect', { source });
  assert.equal(inspected.code, 200);
  assert.equal(inspected.data.manifest.kind, 'demo-echo');
  assert.equal(inspected.data.installed, null);
  const installed = await request(bot, '/admin/plugins/packages/install', { source });
  assert.equal(installed.code, 200);
  assert.equal(installed.data.installed, true);
  assert.equal(installed.data.package.kind, 'demo-echo');
  const listing = await request(bot, '/admin/plugins/packages');
  assert.ok(listing.data.packages.some(item => item.kind === 'demo-echo'));
  let plugin = await bot.plugins.install({ kind: 'demo-echo' });
  assert.equal(plugin.kind, 'demo-echo');
  plugin = await bot.plugins.save({ id: plugin.id, revision: plugin.revision, plugin: { ...plugin, scope: { ...plugin.scope, private_users: ['10001'] } } });
  plugin = await bot.plugins.toggle({ id: plugin.id, revision: plugin.revision, enabled: true });
  const sent = []; bot.adapter.on('outgoing', item => sent.push(item));
  bot.adapter.driver.inject(incoming(9901, { message: '/echo 你好' }));
  await waitFor(() => sent.length === 1);
  assert.match(JSON.stringify(sent[0].message), /来自外部插件包/);
  await bot.plugins.remove({ id: plugin.id, revision: plugin.revision });
  const removed = await request(bot, '/admin/plugins/packages/remove', { id: 'demo-echo' });
  assert.equal(removed.code, 200);
  const after = await request(bot, '/admin/plugins/packages');
  assert.ok(!after.data.packages.some(item => item.kind === 'demo-echo'));
});

test('zip packages install, path traversal and invalid manifests are refused', async t => {
  const bot = await app(t);
  cleanupPackage(t, bot, 'zip-demo');
  const zip = zipSync({ 'plugin.json': strToU8(manifest({ id: 'zip-demo', kind: 'zip-demo', name: '压缩包插件' })), 'index.mjs': strToU8(entry) });
  const path = join(await temp(t), 'zip-demo.zip');
  await writeFile(path, Buffer.from(zip));
  const installed = await request(bot, '/admin/plugins/packages/install', { source: path });
  assert.equal(installed.code, 200);
  assert.equal(installed.data.package.kind, 'zip-demo');

  const evil = zipSync({ '../escape.mjs': strToU8('x'), 'plugin.json': strToU8(manifest({ id: 'evil', kind: 'evil', name: '越界' })) });
  const evilPath = join(await temp(t), 'evil.zip');
  await writeFile(evilPath, Buffer.from(evil));
  assert.equal((await request(bot, '/admin/plugins/packages/install', { source: evilPath })).code, 400);

  const badDir = join(await temp(t), 'bad');
  await mkdir(badDir, { recursive: true });
  await writeFile(join(badDir, 'plugin.json'), JSON.stringify({ api: 1, id: 'bad', kind: 'bad', name: '缺少版本' }));
  await writeFile(join(badDir, 'index.mjs'), entry);
  assert.equal((await request(bot, '/admin/plugins/packages/install', { source: badDir })).code, 400);

  const reserved = join(await temp(t), 'reserved');
  await mkdir(reserved, { recursive: true });
  await writeFile(join(reserved, 'plugin.json'), manifest({ id: '_hidden', kind: '_hidden' }));
  await writeFile(join(reserved, 'index.mjs'), entry);
  assert.equal((await request(bot, '/admin/plugins/packages/install', { source: reserved })).code, 400);
});

test('installing an existing package requires explicit overwrite', async t => {
  const bot = await app(t);
  cleanupPackage(t, bot, 'demo-echo');
  const first = await makePackage(t, { dir: 'a' });
  assert.equal((await request(bot, '/admin/plugins/packages/install', { source: first })).code, 200);
  const second = await makePackage(t, { dir: 'b' });
  assert.equal((await request(bot, '/admin/plugins/packages/install', { source: second })).code, 409);
  const replaced = await request(bot, '/admin/plugins/packages/install', { source: second, overwrite: true });
  assert.equal(replaced.code, 200);
  assert.equal(replaced.data.replaced, true);
});

/** 一键导入走原始字节上传，模拟控制台的 fetch。 */
function uploadZip(app, bytes, { name = 'upload-demo.zip', overwrite = false, inspect = false } = {}) {
  const query = [overwrite ? 'overwrite=1' : '', inspect ? 'inspect=1' : ''].filter(Boolean).join('&');
  return fetch(`http://127.0.0.1:${app.address.port}/admin/plugins/packages/upload` + (query ? '?' + query : ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${app.config.adminToken}`, 'Content-Type': 'application/zip', 'X-File-Name': encodeURIComponent(name) },
    body: bytes, signal: AbortSignal.timeout(10000)
  }).then(async response => ({ code: response.status, data: await response.json() }));
}

test('zip packages upload straight from the console and support overwrite', async t => {
  const bot = await app(t);
  cleanupPackage(t, bot, 'upload-demo');
  // 带一层包装目录的压缩包：根目录剥离后仍能找到 plugin.json。
  const zip = zipSync({
    'upload-demo/plugin.json': strToU8(manifest({ id: 'upload-demo', kind: 'upload-demo', name: '上传插件' })),
    'upload-demo/index.mjs': strToU8(entry)
  });
  const installed = await uploadZip(bot, Buffer.from(zip));
  assert.equal(installed.code, 200);
  assert.equal(installed.data.installed, true);
  assert.equal(installed.data.package.kind, 'upload-demo');
  assert.equal(installed.data.replaced, false);
  const listing = await request(bot, '/admin/plugins/packages');
  assert.ok(listing.data.packages.some(item => item.kind === 'upload-demo'));

  // 同名包未指定覆盖时拒绝，指定后替换。
  assert.equal((await uploadZip(bot, Buffer.from(zip))).code, 409);
  const replaced = await uploadZip(bot, Buffer.from(zip), { overwrite: true });
  assert.equal(replaced.code, 200);
  assert.equal(replaced.data.replaced, true);

  // 非 ZIP 内容与越界路径都应在写入前被拒绝：走只校验不落盘的入口，避免留下半成品。
  const notZip = await uploadZip(bot, Buffer.from('这不是压缩包'), { name: 'notes.zip', inspect: true });
  assert.equal(notZip.code, 400);
  assert.match(notZip.data.message, /ZIP/);
  const evil = zipSync({ '../escape-upload.mjs': strToU8('x'), 'plugin.json': strToU8(manifest({ id: 'evil-upload', kind: 'evil-upload', name: '越界' })) });
  assert.equal((await uploadZip(bot, Buffer.from(evil), { name: 'evil.zip', inspect: true })).code, 400);
  const clutter = await readdir(join(bot.plugins.pluginDir, '..')).catch(() => []);
  assert.equal(clutter.includes('escape-upload.mjs'), false);
});

test('uploaded packages can be inspected without writing to the plugin directory', async t => {
  const bot = await app(t);
  cleanupPackage(t, bot, 'inspect-only');
  const zip = zipSync({
    'plugin.json': strToU8(manifest({ id: 'inspect-only', kind: 'inspect-only', name: '只校验' })),
    'index.mjs': strToU8(entry)
  });
  const response = await fetch(`http://127.0.0.1:${bot.address.port}/admin/plugins/packages/upload?inspect=1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bot.config.adminToken}`, 'Content-Type': 'application/zip', 'X-File-Name': 'inspect-only.zip' },
    body: Buffer.from(zip), signal: AbortSignal.timeout(10000)
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.manifest.kind, 'inspect-only');
  assert.equal(data.files, 2);
  assert.equal(data.installed, null);
  const listing = await request(bot, '/admin/plugins/packages');
  assert.ok(!listing.data.packages.some(item => item.kind === 'inspect-only'));
});

test('the workbench proxies one-click zip uploads and keeps the admin token server-side', async t => {
  const bot = await app(t);
  cleanupPackage(t, bot, 'proxy-demo');
  const page = await createLoginServer({ backend: 'http://127.0.0.1:' + bot.address.port, token: bot.config.adminToken });
  cleanup(t, () => page.close());
  const zip = zipSync({
    'plugin.json': strToU8(manifest({ id: 'proxy-demo', kind: 'proxy-demo', name: '代理导入' })),
    'index.mjs': strToU8(entry)
  });
  const origin = new URL(page.url).origin;

  const rejected = await fetch(page.url + '/plugins/packages/upload', {
    method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/zip' }, body: Buffer.from(zip)
  });
  assert.equal(rejected.status, 403);

  const response = await fetch(page.url + '/plugins/packages/upload', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/zip', 'X-File-Name': encodeURIComponent('代理导入.zip') },
    body: Buffer.from(zip)
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.installed, true);
  assert.equal(data.package.kind, 'proxy-demo');
  assert.ok(!JSON.stringify(data).includes(bot.config.adminToken));

  const duplicate = await fetch(page.url + '/plugins/packages/upload', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/zip' }, body: Buffer.from(zip)
  });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).message, /已存在/);
  const replaced = await fetch(page.url + '/plugins/packages/upload?overwrite=1', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/zip' }, body: Buffer.from(zip)
  });
  assert.equal(replaced.status, 200);
  assert.equal((await replaced.json()).replaced, true);
});
