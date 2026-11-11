import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLoginServer } from '../src/web/login-server.mjs';
import { renderLaunchPage } from '../src/web/startup-animation.mjs';
import { startupConfig, startupTemplate } from '../../../plugins/startup-animation/config.mjs';
import { app, cleanup, request } from './helpers.mjs';
import { png, gif } from './image-fixture.mjs';

const data = bytes => 'data:image/png;base64,' + bytes.toString('base64');
// Minimal containers: the service only sniffs the box/EBML header, so these
// are enough to exercise validation and byte-for-byte streaming without a codec.
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'),
  Buffer.from([0, 0, 2, 0]), Buffer.from('mdat'), Buffer.from('xuqiao-intro')]);
const webm = () => Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from([0x9f, 0x42, 0x86, 0x81, 0x01])]);

async function install(bot) {
  const row = await bot.plugins.install({ kind: 'startup-animation' });
  return bot.plugins.toggle({ id: row.id, revision: row.revision, enabled: true });
}
async function postVideo(bot, bytes, extra = {}) {
  const response = await fetch('http://127.0.0.1:' + bot.address.port + '/admin/startup-animation/video',
    { method: 'POST', headers: { Authorization: 'Bearer ' + bot.config.adminToken,
      'Content-Type': extra.type || 'video/mp4', 'X-File-Name': encodeURIComponent(extra.name || '片头.mp4') },
      body: bytes, signal: AbortSignal.timeout(10000) });
  return { code: response.status, data: await response.json() };
}
function videoHeaders(bot, extra = {}) {
  return { Authorization: 'Bearer ' + bot.config.adminToken, ...extra };
}

test('startup animation installs disabled, validates the look and enables without a chat scope', async t => {
  const bot = await app(t);
  const first = await bot.plugins.install({ kind: 'startup-animation' });
  assert.equal(first.kind, 'startup-animation');
  assert.equal(first.enabled, false);
  assert.equal(first.config.preset, 'orbit');
  assert.equal(first.config.theme, 'ink');
  assert.equal(first.config.min_ms, 1800);
  assert.equal(first.config.title, 'Limen');
  assert.equal(first.config.accent, '#8b7cf6');
  // The animation never handles messages, so enabling must not ask for a QQ scope.
  const enabled = await bot.plugins.toggle({ id: first.id, revision: first.revision, enabled: true });
  assert.equal(enabled.enabled, true);
  assert.equal((await bot.plugins.install({ kind: 'startup-animation' })).id, first.id);
  await assert.rejects(bot.plugins.save({ plugin: startupTemplate }), /已安装/);
  for (const config of [{ preset: 'zoom' }, { theme: 'dark' }, { exit: 'slide' }, { accent: 'purple' },
    { min_ms: 200 }, { min_ms: 9000 }, { title: 'x'.repeat(25) }, { caption: 'y'.repeat(41) }, { enabled: 'yes' }]) {
    await assert.rejects(bot.plugins.save({ id: first.id, revision: enabled.revision, plugin: { ...enabled, config } }));
  }
  const saved = await bot.plugins.save({ id: first.id, revision: enabled.revision,
    plugin: { ...enabled, config: { ...enabled.config, preset: 'stars', theme: 'aurora', exit: 'rise',
      accent: '#38D0D8', title: '夜深了', subtitle: '该休息了', caption: '正在连接', min_ms: 2400 } } });
  assert.deepEqual({ preset: saved.config.preset, theme: saved.config.theme, exit: saved.config.exit,
    accent: saved.config.accent, title: saved.config.title, min_ms: saved.config.min_ms },
  { preset: 'stars', theme: 'aurora', exit: 'rise', accent: '#38d0d8', title: '夜深了', min_ms: 2400 });
  assert.equal(startupConfig({}).title, 'Limen');
});

test('snapshot and save round-trip through the management surface and reject forged values', async t => {
  const bot = await app(t);
  await install(bot);
  const empty = await request(bot, '/admin/startup-animation');
  assert.equal(empty.code, 200);
  assert.equal(empty.data.installed, true);
  assert.equal(empty.data.enabled, true);
  assert.equal(empty.data.logo, null);
  assert.match(empty.data.signature, /^[a-f0-9]{12}$/);

  const status = await request(bot, '/admin/status');
  assert.equal(status.data.startup.enabled, true);
  assert.equal(status.data.startup.preset, 'orbit');

  const saved = await request(bot, '/admin/startup-animation/action',
    { action: 'save', preset: 'pulse', theme: 'paper', accent: '#ff8ac9', title: '早安', subtitle: '',
      caption: '正在唤醒', min_ms: 900, exit: 'zoom', show_progress: false, skippable: false, once_per_session: true });
  assert.equal(saved.code, 200);
  assert.equal(saved.data.preset, 'pulse');
  assert.equal(saved.data.theme, 'paper');
  assert.equal(saved.data.title, '早安');
  assert.equal(saved.data.show_progress, false);
  assert.equal(saved.data.skippable, false);
  assert.equal(saved.data.once_per_session, true);
  assert.equal(saved.data.plugin.config.preset, 'pulse');

  for (const payload of [{ action: 'save', preset: 'zoom' }, { action: 'save', accent: 'red' },
    { action: 'save', min_ms: 100 }, { action: 'save', title: 'x'.repeat(25) }, { action: 'save', enabled: 'yes' }]) {
    assert.equal((await request(bot, '/admin/startup-animation/action', payload)).code, 400, JSON.stringify(payload));
  }
  assert.equal((await request(bot, '/admin/startup-animation/action', { action: 'nope' })).code, 404);

  const off = await request(bot, '/admin/startup-animation/action', { action: 'save', enabled: false });
  assert.equal(off.data.enabled, false);
  assert.equal((await request(bot, '/admin/status')).data.startup.enabled, false);
});

test('logo uploads are verified, served byte-for-byte and replaced instead of accumulated', async t => {
  const bot = await app(t);
  await install(bot);

  const uploaded = await request(bot, '/admin/startup-animation/action', { action: 'upload-logo', data: data(png()) });
  assert.equal(uploaded.code, 200);
  assert.equal(uploaded.data.logo.format, 'png');
  assert.equal(uploaded.data.logo.width, 32);
  assert.equal(uploaded.data.enabled, true);

  const image = await fetch('http://127.0.0.1:' + bot.address.port + '/admin/startup-animation/media',
    { headers: { Authorization: 'Bearer ' + bot.config.adminToken } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());

  const replacement = await request(bot, '/admin/startup-animation/action', { action: 'upload-logo', data: data(png(64, 48)) });
  assert.equal(replacement.data.logo.width, 64);
  assert.deepEqual((await readdir(join(bot.config.dataDir, 'startup-animation'))).sort(), ['boot.json', 'logo.png', 'state.json']);

  // Animated GIF logos are allowed here (unlike the wallpaper) because the whole
  // surface is already a short animation.
  const animated = await request(bot, '/admin/startup-animation/action',
    { action: 'upload-logo', data: 'data:image/gif;base64,' + gif.toString('base64') });
  assert.equal(animated.code, 200);
  assert.equal(animated.data.logo.format, 'gif');
  const animation = await fetch('http://127.0.0.1:' + bot.address.port + '/admin/startup-animation/media',
    { headers: { Authorization: 'Bearer ' + bot.config.adminToken } });
  assert.equal(animation.headers.get('content-type'), 'image/gif');
  assert.deepEqual(Buffer.from(await animation.arrayBuffer()), gif);
  assert.deepEqual((await readdir(join(bot.config.dataDir, 'startup-animation'))).sort(), ['boot.json', 'logo.gif', 'state.json']);

  for (const bad of [
    { action: 'upload-logo', data: 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64') },
    { action: 'upload-logo', data: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') },
    { action: 'upload-logo', data: 'base64://' + png().toString('base64') },
    { action: 'upload-logo', data: 'not-an-image' }
  ]) assert.equal((await request(bot, '/admin/startup-animation/action', bad)).code, 400, JSON.stringify(bad).slice(0, 60));

  const removed = await request(bot, '/admin/startup-animation/action', { action: 'remove-logo' });
  assert.equal(removed.data.logo, null);
  assert.deepEqual(await readdir(join(bot.config.dataDir, 'startup-animation')), ['boot.json']);
  assert.equal((await request(bot, '/admin/startup-animation/media')).code, 404);
});

test('the workbench renders the animation on the first paint and proxies its controls', async t => {
  const bot = await app(t);
  await install(bot);
  await request(bot, '/admin/startup-animation/action', { action: 'upload-logo', data: data(png()) });
  await request(bot, '/admin/startup-animation/action',
    { action: 'save', preset: 'curtain', theme: 'aurora', accent: '#38d0d8', title: '开场', min_ms: 1200 });

  const page = await createLoginServer({ backend: 'http://127.0.0.1:' + bot.address.port, token: bot.config.adminToken });
  cleanup(t, () => page.close());

  const html = await (await fetch(page.url)).text();
  assert.ok(html.includes('id="sa-overlay"'));
  assert.ok(html.includes('data-preset="curtain"'));
  assert.ok(html.includes('data-theme="aurora"'));
  assert.ok(html.includes('开场'));
  assert.ok(html.includes('--sa-accent:#38d0d8'));
  assert.ok(html.includes('data-min="1200"'));
  assert.ok(html.includes('/startup-animation/media?v='));
  assert.ok(html.includes('id="sa-template"'));
  assert.ok(!html.includes(bot.config.adminToken));
  assert.ok(!/nonce="NONCE"/.test(html));

  const proxy = await (await fetch(page.url + '/startup-animation')).json();
  assert.equal(proxy.installed, true);
  assert.equal(proxy.logo.format, 'png');

  const image = await fetch(page.url + '/startup-animation/media');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());

  const state = await (await fetch(page.url + '/state')).json();
  assert.equal(state.startup.enabled, true);
  assert.equal(state.startup.preset, 'curtain');
  assert.match(state.startup.logo.url, /^\/login\/[a-f0-9]+\/startup-animation\/media\?v=[a-f0-9]{12}$/);
  // The exact URL shipped to the browser must really decode as an image.
  const overlayLogo = await fetch(new URL(state.startup.logo.url, page.url));
  assert.equal(overlayLogo.status, 200);
  assert.equal(overlayLogo.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await overlayLogo.arrayBuffer()), png());

  const crossOrigin = await fetch(page.url + '/startup-animation/action',
    { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify({ action: 'remove-logo' }) });
  assert.equal(crossOrigin.status, 403);
  const sameOrigin = await fetch(page.url + '/startup-animation/action',
    { method: 'POST', headers: { Origin: new URL(page.url).origin }, body: JSON.stringify({ action: 'save', title: '新标题' }) });
  assert.equal(sameOrigin.status, 200);
  assert.equal((await sameOrigin.json()).title, '新标题');
});

test('disabling the animation removes the overlay but keeps the workbench usable', async t => {
  const bot = await app(t);
  await install(bot);
  await request(bot, '/admin/startup-animation/action', { action: 'save', enabled: false });
  const page = await createLoginServer({ backend: 'http://127.0.0.1:' + bot.address.port, token: bot.config.adminToken });
  cleanup(t, () => page.close());
  const html = await (await fetch(page.url)).text();
  assert.ok(!html.includes('id="sa-overlay"'));
  assert.ok(html.includes('id="view-startup"'));
  assert.ok(html.includes('id="sa-template"'));
  assert.ok((await fetch(page.url)).ok);
});

test('removing the plugin clears the logo and a reinstall starts from the built-in mark', async t => {
  const bot = await app(t);
  const plugin = await install(bot);
  await request(bot, '/admin/startup-animation/action', { action: 'upload-logo', data: data(png()) });
  assert.deepEqual((await readdir(join(bot.config.dataDir, 'startup-animation'))).sort(), ['boot.json', 'logo.png', 'state.json']);
  await bot.plugins.remove({ id: plugin.id, revision: bot.plugins.get(plugin.id).revision });
  const after = await request(bot, '/admin/startup-animation');
  assert.equal(after.code, 200);
  assert.equal(after.data.plugin, null);
  assert.equal(after.data.installed, false);
  assert.equal(after.data.enabled, false);
  const status = await request(bot, '/admin/status');
  assert.equal(status.data.startup.installed, false);
  assert.equal(status.data.startup.enabled, false);
  assert.deepEqual(await readdir(join(bot.config.dataDir, 'startup-animation')), []);
  assert.equal((await install(bot)).enabled, true);
  assert.equal((await request(bot, '/admin/startup-animation')).data.logo, null);
});

test('the desktop boot snapshot follows install, save, toggle, logo upload and removal', async t => {
  const bot = await app(t);
  const folder = join(bot.config.dataDir, 'startup-animation');
  const snapshot = async () => JSON.parse(await readFile(join(folder, 'boot.json'), 'utf8'));

  const plugin = await bot.plugins.install({ kind: 'startup-animation' });
  assert.equal((await snapshot()).enabled, false);
  await bot.plugins.toggle({ id: plugin.id, revision: plugin.revision, enabled: true });
  assert.equal((await snapshot()).enabled, true);

  const row = bot.plugins.get(plugin.id);
  await bot.plugins.save({ id: row.id, revision: row.revision,
    plugin: { ...row, config: { ...row.config, title: '夜航', preset: 'curtain', theme: 'aurora', min_ms: 4200 } } });
  const saved = await snapshot();
  assert.equal(saved.title, '夜航');
  assert.equal(saved.preset, 'curtain');
  assert.equal(saved.theme, 'aurora');
  assert.equal(saved.min_ms, 4200);
  assert.notEqual(saved.signature, '');

  const uploaded = await request(bot, '/admin/startup-animation/action', { action: 'upload-logo', data: data(png()) });
  assert.equal(uploaded.code, 200);
  assert.equal((await snapshot()).logo.file, 'logo.png');
  assert.match((await snapshot()).logo.mime, /^image\//);

  const pageHtml = renderLaunchPage({ ...await snapshot(), logo: { url: '/logo' } });
  assert.ok(pageHtml.includes('id="sa-overlay"'));
  assert.ok(pageHtml.includes('__xuqiaoBootExit'));
  assert.ok(!pageHtml.includes('__xuqiaoStartup'));
  assert.ok(pageHtml.includes('src="/logo"'));
  assert.ok(!pageHtml.includes('点击任意处跳过'));
  assert.ok(pageHtml.includes('夜航'));
  assert.ok(pageHtml.includes('--sa-accent:#8b7cf6'));
  // The launch page shares the animation background and can freeze the frame.
  const theme = (await snapshot()).theme;
  const background = theme === 'paper' ? '#f6f6f9' : theme === 'aurora' ? '#05060e' : '#0a0a10';
  assert.ok(pageHtml.includes('background:' + background));
  assert.ok(pageHtml.includes('sa-hold'));

  await bot.plugins.toggle({ id: plugin.id, revision: bot.plugins.get(plugin.id).revision, enabled: false });
  assert.equal((await snapshot()).enabled, false);

  await bot.plugins.remove({ id: plugin.id, revision: bot.plugins.get(plugin.id).revision });
  assert.deepEqual(await readdir(folder), []);
});

test('the desktop hand-off keeps the animation frame and dissolves into the workbench', async t => {
  const bot = await app(t);
  await install(bot);
  await request(bot, '/admin/startup-animation/action', { action: 'save', title: '开场' });
  const page = await createLoginServer({ backend: 'http://127.0.0.1:' + bot.address.port, token: bot.config.adminToken });
  cleanup(t, () => page.close());
  const handed = await (await fetch(page.url + '?boot=1')).text();
  // The frame stays on screen instead of replaying the entrance, and the page
  // still drops the flag so a manual reload plays the animation again.
  assert.ok(handed.includes('id="sa-overlay"'));
  assert.ok(handed.includes('data-handoff="1" data-instant='));
  assert.ok(handed.includes('id="view-startup"'));
  assert.ok(handed.includes('history.replaceState'));
  assert.ok(handed.includes('开场'));
  const normal = await (await fetch(page.url)).text();
  assert.ok(normal.includes('id="sa-overlay"'));
  assert.ok(normal.includes('data-handoff="0" data-instant='));
  assert.ok(normal.includes('开场'));
});

test('video uploads are sniffed, byte-served with ranges and switch the intro immediately', async t => {
  const bot = await app(t);
  await install(bot);
  const folder = join(bot.config.dataDir, 'startup-animation');
  const bytes = mp4();

  const uploaded = await postVideo(bot, bytes, { name: '我的片头.mp4' });
  assert.equal(uploaded.code, 200);
  assert.equal(uploaded.data.source, 'video');
  assert.equal(uploaded.data.plugin.config.source, 'video');
  assert.equal(uploaded.data.video.format, 'mp4');
  assert.equal(uploaded.data.video.mime, 'video/mp4');
  assert.equal(uploaded.data.video.name, '我的片头.mp4');
  assert.equal(uploaded.data.video.size, bytes.length);
  assert.match(uploaded.data.video.url, /^\/startup-animation\/video\?v=[a-f0-9]{12}$/);
  assert.equal(uploaded.data.max_video_bytes, 40 * 1024 * 1024);
  assert.match((await request(bot, '/admin/status')).data.startup.signature, /^[a-f0-9]{12}$/);

  const url = 'http://127.0.0.1:' + bot.address.port + '/admin/startup-animation/video';
  const whole = await fetch(url, { headers: videoHeaders(bot) });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes);

  const partial = await fetch(url, { headers: videoHeaders(bot, { Range: 'bytes=0-7' }) });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 0-7/' + bytes.length);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 8));
  assert.equal((await fetch(url, { headers: videoHeaders(bot, { Range: 'bytes=999-' }) })).status, 416);

  const boot = JSON.parse(await readFile(join(folder, 'boot.json'), 'utf8'));
  assert.equal(boot.source, 'video');
  assert.equal(boot.video.file, 'video.mp4');
  assert.equal(boot.video.mime, 'video/mp4');
  assert.deepEqual((await readdir(folder)).sort(), ['boot.json', 'video.json', 'video.mp4']);

  for (const bad of [
    postVideo(bot, Buffer.from('<svg onload="alert(1)"/>')),
    postVideo(bot, Buffer.from('RIFF0000AVI LIST')),
    postVideo(bot, Buffer.alloc(0)),
    postVideo(bot, bytes, { type: 'image/png' })
  ]) assert.ok([400, 413].includes((await bad).code));
  assert.equal((await fetch(url, { headers: videoHeaders(bot) })).status, 200);
  assert.equal((await request(bot, '/admin/startup-animation/action', { action: 'upload-video' })).code, 400);

  const replaced = await postVideo(bot, webm(), { type: 'video/webm', name: 'loop.webm' });
  assert.equal(replaced.code, 200);
  assert.equal(replaced.data.video.format, 'webm');
  assert.equal(replaced.data.video.mime, 'video/webm');
  assert.deepEqual((await readdir(folder)).sort(), ['boot.json', 'video.json', 'video.webm']);
  assert.equal((await fetch(url, { headers: videoHeaders(bot) })).headers.get('content-type'), 'video/webm');

  const removed = await request(bot, '/admin/startup-animation/action', { action: 'remove-video' });
  assert.equal(removed.data.video, null);
  assert.equal(removed.data.source, 'preset');
  assert.deepEqual(await readdir(folder), ['boot.json']);
  assert.equal((await fetch(url, { headers: videoHeaders(bot) })).status, 404);
});

test('video settings are validated and removing the plugin clears the stored clip', async t => {
  const bot = await app(t);
  await install(bot);
  for (const payload of [{ action: 'save', source: 'movie' }, { action: 'save', video_fit: 'stretch' },
    { action: 'save', video_loop: 'yes' }, { action: 'save', video_overlay: 'no' }]) {
    assert.equal((await request(bot, '/admin/startup-animation/action', payload)).code, 400, JSON.stringify(payload));
  }
  const saved = await request(bot, '/admin/startup-animation/action',
    { action: 'save', source: 'video', video_fit: 'contain', video_loop: false, video_overlay: false });
  assert.equal(saved.code, 200);
  // Without a clip the intro falls back to the built-in composition, never a blank frame.
  assert.equal(saved.data.source, 'preset');
  assert.equal(saved.data.video_fit, 'contain');
  assert.equal(saved.data.video_loop, false);
  assert.equal(saved.data.video_overlay, false);

  await postVideo(bot, mp4());
  const folder = join(bot.config.dataDir, 'startup-animation');
  assert.deepEqual((await readdir(folder)).sort(), ['boot.json', 'video.json', 'video.mp4']);
  const plugin = bot.plugins.find('startup-animation');
  await bot.plugins.remove({ id: plugin.id, revision: bot.plugins.get(plugin.id).revision });
  assert.deepEqual(await readdir(folder), []);
  const after = await request(bot, '/admin/startup-animation');
  assert.equal(after.data.video, null);
  assert.equal(after.data.installed, false);
});

test('the workbench plays the video on the first paint and the desktop hand-off never replays it', async t => {
  const bot = await app(t);
  await install(bot);
  await postVideo(bot, mp4());
  const page = await createLoginServer({ backend: 'http://127.0.0.1:' + bot.address.port, token: bot.config.adminToken });
  cleanup(t, () => page.close());

  const response = await fetch(page.url);
  const html = await response.text();
  assert.match(response.headers.get('content-security-policy'), /media-src 'self'/);
  assert.ok(html.includes('id="sa-overlay"'));
  assert.ok(html.includes('data-video="1"'));
  assert.ok(html.includes('<video class="sa-video"'));
  assert.ok(html.includes('src="/login/'));
  assert.equal((html.match(/class="sa-video"/g) || []).length, 1, 'the preview template must not carry a second video');
  assert.ok(html.includes('sa-video-curtain'));
  assert.ok(html.includes('sa-video-exit'));

  const state = await (await fetch(page.url + '/state')).json();
  assert.match(state.startup.video.url, /^\/login\/[a-f0-9]+\/startup-animation\/video\?v=[a-f0-9]{12}$/);
  const media = await fetch(new URL(state.startup.video.url, page.url));
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), mp4());
  const partial = await fetch(new URL(state.startup.video.url, page.url), { headers: { Range: 'bytes=0-3' } });
  assert.equal(partial.status, 206);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), mp4().subarray(0, 4));

  const handed = await (await fetch(page.url + '?boot=1')).text();
  assert.ok(handed.includes('data-handoff="1"'));
  assert.ok(!handed.includes('class="sa-video"'), 'a second video element would restart the intro');
  assert.ok(handed.includes('data-video="0"'));
  assert.ok(handed.includes('id="view-startup"'));

  const crossOrigin = await fetch(page.url + '/startup-animation/video',
    { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'video/mp4' }, body: mp4() });
  assert.equal(crossOrigin.status, 403);

  const boot = JSON.parse(await readFile(join(bot.config.dataDir, 'startup-animation', 'boot.json'), 'utf8'));
  assert.equal(boot.source, 'video');
  const launch = renderLaunchPage({ ...boot, video: { url: '/video' }, logo: null });
  assert.match(launch, /media-src 'self'/);
  assert.ok(launch.includes('src="/video"'));
  assert.ok(launch.includes('data-video="1"'));
  assert.ok(launch.includes('sa-video-exit'));
  assert.ok(launch.includes('__xuqiaoBootExit'));
});
