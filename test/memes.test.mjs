import { replyBody } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';
import { memePluginTemplate, textWithoutMemeTags } from '../../../plugins/memes/service.mjs';
import { createLoginServer } from '../src/web/login-server.mjs';
import { app, temp, config, cleanup, incoming, request, waitFor } from './helpers.mjs';
import { png, gif } from './image-fixture.mjs';

const data = bytes => 'base64://' + bytes.toString('base64');
async function install(bot, options = {}) {
  const original = await bot.plugins.install({ kind: 'meme-manager' });
  const row = await bot.plugins.save({ id: original.id, revision: original.revision, plugin: { ...original,
    scope: { ...original.scope, private_users: ['10001'] }, config: { ...original.config, cooldown_seconds: 0, ...options } } });
  return bot.plugins.toggle({ id: row.id, revision: row.revision, enabled: true });
}
const event = (id, value = '你好') => ({ post_type: 'message', self_id: 10000, user_id: 10001, message_id: id,
  message_type: 'private', message: [{ type: 'text', data: { text: value } }] });

test('meme installation is idempotent, starts disabled, validates configuration and keeps the normal script engine working', async t => {
  const bot = await app(t);
  const first = await bot.plugins.install({ kind: 'meme-manager' });
  assert.equal(first.enabled, false); assert.equal(first.kind, 'meme-manager');
  assert.equal((await bot.plugins.install({ kind: 'meme-manager' })).id, first.id);
  await assert.rejects(bot.plugins.save({ plugin: memePluginTemplate }), /已安装/);
  for (const config of [{ auto_collect: 'yes' }, { cooldown_seconds: -1 }, { send_probability: 2 }, { admin_users: ['../x'] }]) {
    await assert.rejects(bot.plugins.save({ id: first.id, revision: first.revision, plugin: { ...first, config } }));
  }
  assert.equal((await bot.plugins.test({ plugin: { ...first, config: first.config }, text: '/表情 帮助' })).handled, true);
  const preview = await bot.plugins.test({ plugin: { name: 'script', source: 'export default () => ({reply:"ok"})' } });
  assert.equal(preview.reply, 'ok');
});

test('catalog validates actual image bytes, deduplicates concurrent uploads, preserves GIF bytes and supports moderation and moves', async t => {
  const bot = await app(t);
  const uploaded = await Promise.all(Array.from({ length: 3 }, () => bot.memes.upload({ data: data(png()), name: '开心', category: 'happy' })));
  assert.equal(uploaded.filter(r => !r.duplicate).length, 1);
  const id = uploaded[0].image.id;
  assert.equal(bot.memes.snapshot().total, 1);
  await assert.rejects(bot.memes.upload({ data: 'base64://' + Buffer.from('<svg></svg>').toString('base64') }));
  await assert.rejects(bot.memes.upload({ data: data(png()), category: '../x' }));
  const added = await bot.memes.upload({ data: data(gif), name: '动图', category: 'happy', status: 'pending' });
  assert.deepEqual((await bot.memes.bytes(added.image.id)).bytes, gif);
  assert.equal(bot.memes.snapshot({ status: 'pending' }).total, 1);
  assert.equal(bot.memes.select('happy').id, id);
  await bot.memes.edit({ ids: [added.image.id], action: 'approve', category: 'sad', tags: '委屈、可爱' });
  assert.equal(bot.memes.snapshot({ category: 'sad' }).total, 1);
  assert.equal(bot.memes.snapshot({ search: '可爱' }).total, 1);
  const category = bot.memes.saveCategory({ name: '测试分类', description: '模拟分类' });
  await bot.memes.edit({ ids: [id], category: category.id, name: '更新名称' });
  bot.memes.deleteCategory({ id: category.id }); assert.equal(bot.memes.image(id).category, 'other');
  await assert.rejects(bot.memes.edit({ ids: [id, 'missing'], action: 'delete' }));
  assert.ok(bot.memes.image(id));
  await bot.memes.edit({ ids: [id], action: 'delete', ignore: true });
  assert.throws(() => bot.memes.image(id));
  assert.equal((await bot.memes.upload({ data: data(png()), source: 'chat' })).rejected, true);
});

test('catalog permissions, MIME handling, ID validation and origin checks protect management images', async t => {
  const bot = await app(t);
  assert.equal((await request(bot, '/admin/memes', undefined, 'onebot')).code, 401);
  assert.equal((await request(bot, '/admin/memes/upload', { data: data(png()) }, false)).code, 401);
  const created = await request(bot, '/admin/memes/upload', { data: data(png()), name: '模拟上传', category: 'happy' });
  assert.equal(created.code, 200);
  const id = created.data.image.id;
  const denied = await fetch(`http://127.0.0.1:${bot.address.port}/admin/memes/image?id=${id}`);
  assert.equal(denied.status, 401);
  const page = await createLoginServer({ backend: `http://127.0.0.1:${bot.address.port}`, token: bot.config.adminToken });
  cleanup(t, () => page.close());
  const image = await fetch(page.url + '/memes/image?id=' + id);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png());
  assert.equal((await fetch(page.url + '/memes/image?id=../secret')).status, 400);
  const crossOrigin = await fetch(page.url + '/memes/upload', { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify({ data: data(png()) }) });
  assert.equal(crossOrigin.status, 403);
  assert.ok(!(await (await fetch(page.url)).text()).includes(bot.config.adminToken));
});

test('native commands send approved images through the existing adapter without allowing unauthorized chat upload', async t => {
  const bot = await app(t); const plugin = await install(bot);
  await bot.memes.upload({ data: data(png()), name: '开心表情', category: 'happy' });
  const sent = []; bot.adapter.on('outgoing', item => sent.push(item));
  bot.adapter.driver.inject(incoming(811, { message: '/表情 发 开心' }));
  await waitFor(() => sent.length === 1);
  assert.equal(replyBody(sent[0].message)[0].type, 'image');
  assert.equal(bot.store.list()[0].reason, 'plugin_handled');
  const denied = await bot.memes.handle(plugin, event(812, '/表情 添加 开心'));
  assert.match(denied.reply, /没有聊天上传权限/);
  const preview = await bot.plugins.test({ plugin, text: '/表情 发 开心' });
  assert.match(preview.reply, /将发送表情/); assert.equal(sent.length, 1);
});

test('auto collection is opt-in, accepts only adapter-resolved cached images, queues review and does not consume normal AI messages', async t => {
  const bot = await app(t), path = join(await temp(t), 'fixture.png'); await writeFile(path, png());
  let imageReads = 0;
  const action = bot.adapter.action.bind(bot.adapter);
  bot.adapter.action = (name, params, context) => {
    if (name === 'get_image') { imageReads++; assert.equal(params.file, 'cached-key'); return { file: path }; }
    return action(name, params, context);
  };
  const plugin = await install(bot);
  const imageEvent = { ...event(821), message: [{ type: 'image', data: { file: 'cached-key', url: 'http://untrusted.invalid/image' } }] };
  assert.equal((await bot.memes.handle(plugin, imageEvent)).handled, false); assert.equal(imageReads, 0);
  const result = await bot.memes.handle({ ...plugin, config: { ...plugin.config, auto_collect: true } }, imageEvent);
  assert.equal(result.handled, false); assert.equal(imageReads, 1);
  assert.equal(bot.memes.snapshot({ status: 'pending' }).total, 1);
  assert.equal(bot.memes.snapshot().total, 0);
  await bot.memes.handle({ ...plugin, config: { ...plugin.config, auto_collect: true } }, imageEvent);
  assert.equal(imageReads, 1, 'per-source cooldown bounds collection');
});

test('AI receives only approved category hints, stores clean text and sends the selected image separately', async t => {
  let options;
  const bot = await app(t, { AI_ENABLED: 'true', AI_MODEL: 'fixture', AI_ALLOWED_USERS: '10001' }, { ai: { reply: async (_input, _history, _signal, opt) => { options = opt; return '真为你开心！[[表情:开心]]'; } } });
  await install(bot);
  await bot.memes.upload({ data: data(png()), name: '开心表情', category: 'happy' });
  await bot.memes.upload({ data: data(gif), name: '待审核难过表情', category: 'sad', status: 'pending' });
  const sent = []; bot.adapter.on('outgoing', item => sent.push(item));
  bot.adapter.driver.inject(incoming(831, { message: '我成功了' }));
  await waitFor(() => bot.store.list().some(j => j.status === 'done'));
  assert.match(options.systemPromptSuffix, /开心/); assert.ok(!options.systemPromptSuffix.includes('难过'));
  assert.equal(sent.length, 2); assert.equal(replyBody(sent[0].message)[0].data.text, '真为你开心！'); assert.deepEqual(sent[1].message.map(s=>s.type),['image']);
  assert.equal(bot.store.history('private:10001', 10).some(item => item.content.includes('[[表情:')), false);
});

test('AI image plans survive restart and retry without reselecting, and deletion falls back to text', async t => {
  const c = config(await temp(t)); let bot = await createApp(c, { log: () => {} }); cleanup(t, () => bot.close());
  await install(bot);
  const image = await bot.memes.upload({ data: data(png()), name: '开心', category: 'happy' });
  const e = event(841), job = bot.store.ingest(e, '你好', 100);
  const reply = bot.memes.planReply('你好[[表情:开心]]', e, job.id);
  bot.store.update(job.id, 'ready', { reply });
  const original = await bot.memes.messageForJob(bot.store.get(job.id), e);
  await bot.close(); bot = await createApp(c, { log: () => {} });
  assert.deepEqual(await bot.memes.messageForJob(bot.store.get(job.id), e), original);
  assert.equal(bot.memes.image(image.image.id).picks, 1);
  await bot.memes.edit({ ids: [image.image.id], action: 'delete' });
  assert.deepEqual(await bot.memes.messageForJob(bot.store.get(job.id), e), [{ type: 'text', data: { text: '你好' } }]);
});

test('localized meme markers from real model replies select images and are cleaned consistently in preview and delivery', async t => {
  const bot = await app(t); await install(bot);
  await bot.memes.upload({ data: data(png()), name: '疑惑表情', category: 'confused' });
  for (const [i, marker] of ['[[表情：疑惑]]', '[[表情:疑惑]]', '[[ 表情 ： 疑惑 ]]'].entries()) {
    const e = event(860 + i), job = bot.store.ingest(e, '测试', 100);
    const value = '听不懂。' + marker;
    const reply = bot.memes.planReply(value, e, job.id);
    assert.equal(reply, '听不懂。'); bot.store.update(job.id, 'ready', { reply });
    const message = await bot.memes.messageForJob(bot.store.get(job.id), e);
    assert.deepEqual(message.map(s => s.type), ['text', 'image']);
    const preview = bot.memes.preview({ text: value });
    assert.equal(preview.text, reply); assert.equal(preview.image.category, 'confused');
  }
  const e = event(869), job = bot.store.ingest(e, '测试', 100);
  assert.equal(bot.memes.planReply('正常回答[[表情：不存在]]', e, job.id), '正常回答');
  assert.deepEqual((await bot.memes.messageForJob({ ...bot.store.get(job.id), reply: '正常回答' }, e)).map(s => s.type), ['text']);
});

test('custom category UUID markers work in ordinary replies and localized previews without leaking markers', async t => {
  const bot = await app(t); await install(bot);
  const category=bot.memes.saveCategory({name:'自建分类',description:'测试自建分类编号'});
  const uploaded=await bot.memes.upload({data:data(png()),name:'自建分类表情',category:category.id});
  for(const [i,marker] of [`[[表情:${category.id}]]`,`[[ 表情 ： ${category.id} ]]`,`[[表情: ${category.name} ]]`].entries()){
    const e=event(880+i),job=bot.store.ingest(e,'测试',100),raw='配文。'+marker;
    const reply=bot.memes.planReply(raw,e,job.id);
    assert.equal(reply,'配文。');assert.equal(bot.memes.plan(job.id).image_id,uploaded.image.id);
    assert.equal(bot.memes.planReply('新配文。[[表情:不存在]]',e,job.id),'新配文。');
    assert.equal(bot.memes.plan(job.id).image_id,uploaded.image.id);
    assert.deepEqual((await bot.memes.messageForJob({...job,reply},e)).map(s=>s.type),['text','image']);
    const preview=bot.memes.preview({text:raw});
    assert.equal(preview.text,'配文。');assert.equal(preview.image.id,uploaded.image.id);assert.equal(preview.category,category.name);
  }
  assert.equal(bot.adapter.driver.messages.size,0);
});

test('short category markers from model captions resolve approved built-in and custom images in planning and preview',async t=>{
  const bot=await app(t);await install(bot);
  const happy=await bot.memes.upload({data:data(png()),name:'开心图片',category:'happy'});
  const custom=bot.memes.saveCategory({name:'摆烂',description:'摆烂、摸鱼'});
  const laidback=await bot.memes.upload({data:data(gif),name:'摆烂图片',category:custom.id});
  for(const [i,[marker,id]] of [['[[开心]]',happy.image.id],['[[ happy ]]',happy.image.id],['[[ 摆烂 ]]',laidback.image.id],[`[[${custom.id}]]`,laidback.image.id],['[[表情：开心]]',happy.image.id],['[表情:开心]',happy.image.id],['【表情：开心】',happy.image.id],['［表情：开心］',happy.image.id],[`[表情:${custom.id}]`,laidback.image.id],['【【摆烂】】',laidback.image.id]].entries()){
    const e=event(900+i),job=bot.store.ingest(e,'普通聊天',100),caption='三无又怎样，本鱼的饭碗才最重要呢。';
    const reply=bot.memes.planReply(caption+' '+marker,e,job.id);
    assert.equal(reply,caption);assert.equal(bot.memes.plan(job.id).image_id,id);
    assert.equal(textWithoutMemeTags(caption+' '+marker,bot.memes.categories()),caption);
    const message=await bot.memes.messageForJob({...bot.store.get(job.id),reply},e);
    assert.deepEqual(message.map(s=>s.type),['text','image']);
    const preview=bot.memes.preview({text:caption+' '+marker});
    assert.equal(preview.text,caption);assert.equal(preview.image.id,id);
  }
  const empty=event(910),job=bot.store.ingest(empty,'普通聊天',100);
  assert.equal(bot.memes.planReply('保留正文 [[疲惫]]',empty,job.id),'保留正文');
  assert.equal(bot.memes.plan(job.id).image_id,null,'an empty category never sends an unapproved picture');
  assert.equal(bot.adapter.driver.messages.size,0);
});

test('unknown brackets, array syntax and code examples are preserved instead of becoming meme requests',async t=>{
  const bot=await app(t);await install(bot);await bot.memes.upload({data:data(png()),name:'开心图片',category:'happy'});
  const examples=['未知链接 [[项目说明]]','矩阵 [[1,2],[3,4]]','行内代码 `[[开心]]`','```text\n[[开心]]\n[[表情:开心]]\n```','未结束的代码 `[[开心]]','普通情绪 [开心]','模型身份说明：[表情]','单括号代码 `[表情:开心]`','括号不匹配 【表情:开心]','多余右括号 [表情:开心]]','缺少右括号 [[表情:开心]'];
  for(const [i,value] of examples.entries()){
    const e=event(920+i),job=bot.store.ingest(e,'代码问题',100);
    assert.equal(bot.memes.planReply(value,e,job.id),value);
    assert.equal(bot.memes.plan(job.id).image_id,null);
    assert.equal(textWithoutMemeTags(value,bot.memes.categories()),value);
    assert.equal(bot.memes.preview({text:value}).text,value);
  }
  const plugin=bot.plugins.find('meme-manager');await bot.plugins.toggle({id:plugin.id,revision:plugin.revision,enabled:false});
  assert.equal(bot.memes.planReply('正文 [[开心]]',event(930),999),'正文 [[开心]]','short markers cannot bypass a disabled plugin');
});

test('unknown categories and disabled meme AI fall back safely, and preview never sends', async t => {
  const bot = await app(t); await install(bot);
  await bot.memes.upload({ data: data(png()), name: '开心', category: 'happy' });
  const e = event(851), job = bot.store.ingest(e, '测试', 100);
  assert.equal(bot.memes.planReply('正常回答[[表情:不存在]]', e, job.id), '正常回答');
  assert.equal(bot.memes.preview({ text: '今天很开心' }).image.category, 'happy');
  assert.equal(bot.adapter.driver.messages.size, 0);
  const plugin = bot.plugins.find('meme-manager'); await bot.plugins.toggle({ id: plugin.id, revision: plugin.revision, enabled: false });
  assert.equal(bot.memes.prompt(e), '');
  assert.equal(bot.memes.planReply('普通文本', e, job.id), '普通文本');
});

test('script plugins can return bounded image segments while invalid segment types are rejected', async t => {
  const bot = await app(t);
  const plugin = { name: 'image script', source: 'export default () => ({message:[{type:"image",data:{file:"base64://R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"}}]})' };
  const result = await bot.plugins.test({ plugin }); assert.equal(result.message[0].type, 'image'); assert.equal(result.handled, true);
  await assert.rejects(bot.plugins.test({ plugin: { ...plugin, source: 'export default () => ({message:[{type:"record",data:{file:"x"}}]})' } }), /消息段/);
});
