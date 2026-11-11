import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLoginServer } from '../src/web/login-server.mjs';
import { backgroundConfig, backgroundTemplate } from '../../../plugins/background/config.mjs';
import { app, cleanup, request } from './helpers.mjs';
import { png, gif } from './image-fixture.mjs';

const data = bytes => 'data:image/png;base64,' + bytes.toString('base64');

async function install(bot) {
  const row = await bot.plugins.install({ kind: 'background' });
  return bot.plugins.toggle({ id: row.id, revision: row.revision, enabled: true });
}

test('background plugin installs disabled, validates display settings and enables without a chat scope', async t => {
  const bot = await app(t);
  const first = await bot.plugins.install({ kind: 'background' });
  assert.equal(first.kind, 'background');
  assert.equal(first.enabled, false);
  assert.equal(first.config.mode, 'cover');
  assert.equal(first.config.blur, 0);
  assert.equal(first.config.veil, 0.34);
  assert.equal(first.config.panel, 0.9);
  // The wallpaper never handles messages, so enabling must not require a QQ scope.
  const enabled = await bot.plugins.toggle({ id: first.id, revision: first.revision, enabled: true });
  assert.equal(enabled.enabled, true);
  assert.equal((await bot.plugins.install({ kind: 'background' })).id, first.id);
  await assert.rejects(bot.plugins.save({ plugin: backgroundTemplate }), /已安装/);
  for (const config of [{ mode: 'zoom' }, { blur: 30 }, { blur: 1.5 }, { veil: 1.4 }, { panel: 0.2 }, { enabled: 'yes' }]) {
    await assert.rejects(bot.plugins.save({ id: first.id, revision: enabled.revision, plugin: { ...enabled, config } }));
  }
  const saved = await bot.plugins.save({ id: first.id, revision: enabled.revision,
    plugin: { ...enabled, config: { ...enabled.config, mode: 'contain', blur: 6, veil: 0.5, panel: 0.75 } } });
  assert.deepEqual({ mode: saved.config.mode, blur: saved.config.blur, veil: saved.config.veil, panel: saved.config.panel },
    { mode: 'contain', blur: 6, veil: 0.5, panel: 0.75 });
  assert.equal(backgroundConfig({}).panel, 0.9);
});

test('wallpaper uploads are verified, served byte-for-byte and replaced instead of accumulated', async t => {
  const bot = await app(t);
  await install(bot);
  const empty = await request(bot, '/admin/background');
  assert.equal(empty.code, 200);
  assert.equal(empty.data.image, null);
  assert.equal(empty.data.enabled, false);

  const uploaded = await request(bot, '/admin/background/action', { action: 'upload', data: data(png()) });
  assert.equal(uploaded.code, 200);
  assert.equal(uploaded.data.image.format, 'png');
  assert.equal(uploaded.data.image.width, 32);
  assert.equal(uploaded.data.enabled, true);

  const image = await fetch('http://127.0.0.1:' + bot.address.port + '/admin/background/image',
    { headers: { Authorization: 'Bearer ' + bot.config.adminToken } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());

  const replacement = await request(bot, '/admin/background/action', { action: 'upload', data: data(png(64, 48)) });
  assert.equal(replacement.data.image.width, 64);
  const files = (await readdir(join(bot.config.dataDir, 'background'))).sort();
  assert.deepEqual(files, ['state.json', 'wallpaper.png']);

  for (const bad of [
    { action: 'upload', data: 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64') },
    { action: 'upload', data: 'data:image/gif;base64,' + gif.toString('base64') },
    { action: 'upload', data: 'base64://' + png().toString('base64') },
    { action: 'upload', data: 'not-an-image' }
  ]) {
    const rejected = await request(bot, '/admin/background/action', bad);
    assert.equal(rejected.code, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await request(bot, '/admin/background/action', { action: 'nope' })).code, 404);

  const removed = await request(bot, '/admin/background/action', { action: 'remove' });
  assert.equal(removed.data.image, null);
  assert.deepEqual(await readdir(join(bot.config.dataDir, 'background')), []);
  assert.equal((await request(bot, '/admin/background/image')).code, 404);
});

test('display settings round-trip through the management surface and reject forged values', async t => {
  const bot = await app(t);
  await install(bot);
  await request(bot, '/admin/background/action', { action: 'upload', data: data(png()) });
  const saved = await request(bot, '/admin/background/action', { action: 'save', mode: 'tile', blur: 12, veil: 0.6, panel: 0.5 });
  assert.equal(saved.code, 200);
  assert.equal(saved.data.mode, 'tile');
  assert.equal(saved.data.blur, 12);
  assert.equal(saved.data.veil, 0.6);
  assert.equal(saved.data.panel, 0.5);
  assert.equal(saved.data.plugin.config.mode, 'tile');
  assert.equal((await request(bot, '/admin/background/action', { action: 'save', mode: 'zoom' })).code, 400);
  assert.equal((await request(bot, '/admin/background/action', { action: 'save', blur: -4 })).code, 400);
  assert.equal((await request(bot, '/admin/background/action', { action: 'save', enabled: 'yes' })).code, 400);

  const off = await request(bot, '/admin/background/action', { action: 'save', enabled: false });
  assert.equal(off.data.enabled, false);
  assert.equal(off.data.image.format, 'png');
  const status = await request(bot, '/admin/status');
  assert.equal(status.data.appearance.enabled, false);
  const on = await request(bot, '/admin/background/action', { action: 'save', enabled: true });
  assert.equal(on.data.enabled, true);
  assert.equal((await request(bot, '/admin/status')).data.appearance.enabled, true);
});

test('the workbench proxies the wallpaper and blocks cross-origin writes and token leaks', async t => {
  const bot = await app(t);
  await install(bot);
  await request(bot, '/admin/background/action', { action: 'upload', data: data(png()) });
  const page = await createLoginServer({ backend: 'http://127.0.0.1:' + bot.address.port, token: bot.config.adminToken });
  cleanup(t, () => page.close());

  const html = await (await fetch(page.url)).text();
  assert.ok(html.includes('view-background'));
  assert.ok(html.includes('背景壁纸'));
  assert.ok(!html.includes(bot.config.adminToken));

  const proxy = await (await fetch(page.url + '/background')).json();
  assert.equal(proxy.installed, true);
  assert.equal(proxy.image.format, 'png');

  const image = await fetch(page.url + '/background/image');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());

  const state = await (await fetch(page.url + '/state')).json();
  assert.equal(state.appearance.enabled, true);
  assert.match(state.appearance.image.url, /^\/background\/image\?v=[a-f0-9]{12}$/);

  const crossOrigin = await fetch(page.url + '/background/action',
    { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify({ action: 'remove' }) });
  assert.equal(crossOrigin.status, 403);
  const sameOrigin = await fetch(page.url + '/background/action',
    { method: 'POST', headers: { Origin: new URL(page.url).origin }, body: JSON.stringify({ action: 'save', blur: 3 }) });
  assert.equal(sameOrigin.status, 200);
  assert.equal((await sameOrigin.json()).blur, 3);
});

test('removing the plugin clears the wallpaper so a reinstall starts clean', async t => {
  const bot = await app(t);
  const plugin = await install(bot);
  await request(bot, '/admin/background/action', { action: 'upload', data: data(png()) });
  assert.deepEqual((await readdir(join(bot.config.dataDir, 'background'))).sort(), ['state.json', 'wallpaper.png']);
  await bot.plugins.remove({ id: plugin.id, revision: bot.plugins.get(plugin.id).revision });
  const after = await request(bot, '/admin/background');
  assert.equal(after.data.plugin, null);
  assert.equal(after.data.image, null);
  assert.deepEqual(await readdir(join(bot.config.dataDir, 'background')), []);
  assert.equal((await install(bot)).enabled, true);
  assert.equal((await request(bot, '/admin/background')).data.image, null);
});
