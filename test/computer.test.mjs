import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { ComputerService } from '../src/computer/service.mjs';
import { AgentRuntime } from '../src/agent/runtime.mjs';
import { AgentState } from '../src/agent/state.mjs';
import { AIClient } from '../src/ai.mjs';
import { Store } from '../src/store.mjs';
import { config, temp, app, request, waitFor, withTestTimeout } from './helpers.mjs';
import { validateSchema } from '../src/agent/schema.mjs';
import { runProcess } from '../src/computer/process.mjs';

const event = { self_id: 10000, user_id: 10001, message_type: 'private', message: [{ type: 'text', data: { text: '处理本机任务' } }] };
const web = { id: 1, channel: 'web', conversation: 'web:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const image = 'data:image/jpeg;base64,' + Buffer.from('fixture-jpeg').toString('base64');
const screen = { x: -1280, y: 0, width: 2560, height: 720 };
const desktop = async action => ({ ok: true, foreground: { handle: '1234', title: 'Fixture' }, screen,
  ...(action === 'screenshot' ? { image, image_width: 1280, image_height: 360 } : action === 'inspect' ? { controls: [] } : { windows: [] }) });
async function fixture(t, extra = {}) {
  const directory = await temp(t), root = join(directory, 'allowed'); await mkdir(root);
  const cfg = config(directory, { AI_ENABLED: 'true', AI_MODEL: 'fixture', AI_ALLOWED_USERS: '10001', BOT_ADMIN_IDS: '10001', COMPUTER_ENABLED: 'true', COMPUTER_ROOTS: root, ...extra });
  const store = new Store(':memory:'); t.after(() => store.close());
  return { cfg, store, root, service: new ComputerService(cfg, store, { desktop }) };
}
const call = (name, args) => ({ tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

test('computer capability is opt-in, web/administrator-private only, and obeys persona scopes', async t => {
  const { cfg, store, service } = await fixture(t);
  assert.equal(service.tools(event, { ...web, channel: 'qq' }).length, 0);
  cfg.computer.qq = true;
  assert.ok(service.tools(event, { ...web, channel: 'qq' }).length > 0);
  assert.equal(service.tools({ ...event, user_id: 10002 }, { ...web, channel: 'qq' }).length, 0);
  assert.equal(service.tools({ ...event, message_type: 'group' }, { ...web, channel: 'qq' }).length, 0);
  for (const tool of service.tools(event, web)) validateSchema(tool.parameters);
  assert.ok(!service.tools(event, web).some(tool => tool.name === 'computer_run_command'));
  const runtime = new AgentRuntime({ config: cfg, store, log: () => {}, ai: { reply: async (_, __, ___, options) => {
    assert.deepEqual(options.tools.map(t => t.function.name), ['computer_read_file']); return 'ok';
  } } });
  const p = runtime.state.savePersona({ name: 'files', prompt: '', tools: ['computer_read_file'] });
  store.db.prepare('INSERT INTO agent_sessions VALUES (?,?)').run(web.conversation, p.id);
  await runtime.reply('读取文件', [], null, { event, job: web });
  cfg.computer.enabled = false; assert.equal(service.tools(event, web).length, 0);
});

test('file tools create, read, compare revisions, reject overwrite and escape paths', async t => {
  const { root, service } = await fixture(t);
  assert.equal((await service.list({})).entries.length, 0);
  await service.write({ path: 'test.txt', text: '你好' });
  const read = await service.read({ path: 'test.txt' }); assert.equal(read.text, '你好');
  await assert.rejects(service.write({ path: 'test.txt', text: 'overwrite' }), /文件已存在/);
  await assert.rejects(service.write({ path: 'test.txt', text: 'bad', expected_sha256: '0'.repeat(64) }), /文件已变化/);
  await service.write({ path: 'test.txt', text: '已修改', expected_sha256: read.sha256 });
  assert.equal(await readFile(join(root, 'test.txt'), 'utf8'), '已修改');
  for (const path of ['../escape.txt', join(root + '-other', 'secret.txt'), 'test.txt:stream', '\\\\server\\share\\a', 'NUL', 'test.txt.']) await assert.rejects(service.path(path));
  await writeFile(join(root, 'too-big.txt'), 'a'.repeat(24001)); await assert.rejects(service.read({ path: 'too-big.txt' }), /24 KB/);
  await writeFile(join(root, 'binary.txt'), Buffer.from([0, 255])); await assert.rejects(service.read({ path: 'binary.txt' }));
  await assert.rejects(service.read({ path: '.' }), /UTF-8/);
});

test('file tools reject directory junctions leading outside an allowed root', async t => {
  const { root, service } = await fixture(t), outside = join(root, '..', 'private'); await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(service.read({ path: 'link/secret.txt' }));
  await assert.rejects(service.write({ path: 'link/new.txt', text: 'escape' }));
});

test('computer operations hold a task lease and emergency stop revokes old signals across resume and restart', async t => {
  const { cfg, store, service } = await fixture(t);
  const tool = service.tools(event, web).find(t => t.name === 'computer_list_files'); await tool.invoke({});
  assert.match((await service.tools(event, { ...web, id: 2 })[0].invoke({})).result.error,/另一个任务/);
  const old = service.controller.signal; service.control({ action: 'stop' }); assert.equal(old.aborted, true);
  assert.equal(new ComputerService(cfg, store).paused, true);
  assert.match((await tool.invoke({})).result.error,/已停止/);
  service.control({ action: 'resume' }); assert.equal(old.aborted, true); assert.equal(service.controller.signal.aborted, false);
  // Resume cannot let another job steal a lease while the old process exits.
  assert.match((await service.tools(event, { ...web, id: 2 })[0].invoke({})).result.error,/另一个任务/);
  service.release(web); await service.tools(event, { ...web, id: 2 })[0].invoke({});
});

test('desktop actions require fresh observation, enforce coordinates and invalidate it after each action', async t => {
  const { service } = await fixture(t); let actions = 0;
  service.desktop = async (action, args) => { if (action === 'action') { actions++; assert.equal(args.expected_window, '1234'); } return desktop(action); };
  assert.equal((await service.act({ action: 'click', x: 0, y: 0 }, web)).ok, false);
  const observed = await service.observe('screenshot', web); assert.deepEqual(observed.images, [image]);
  const args = { action: 'click', observation_id: observed.result.observation_id, x: -100, y: 200 };
  assert.equal((await service.act({ ...args, x: -2000 }, web)).ok, false);
  assert.equal((await service.act(args, web)).ok, true); assert.equal(actions, 1);
  assert.equal((await service.act(args, web)).ok, false);
  const next = await service.observe('inspect', web); assert.equal(next.images, undefined);
  service.observations.get(web.id).time -= 31000;
  assert.equal((await service.act({ ...args, observation_id: next.result.observation_id }, web)).ok, false);
  const third = await service.observe('inspect', web);
  assert.equal((await service.act({ action: 'key', key: '^{arbitrary}', observation_id: third.result.observation_id }, web)).ok, false);
});

test('repeated desktop actions use independent durable operation IDs without allowing payload changes or replay', async t => {
  const { store } = await fixture(t), state = new AgentState(store); let writes = 0;
  const tool = { name: 'desktop_action', repeatable: true, effect: 'write', invoke: async () => ({ result: { ok: true, count: ++writes } }) };
  const first = await state.invoke(web, tool, { operation_id: 'step-1', text: 'first' });
  assert.deepEqual(await state.invoke(web, tool, { operation_id: 'step-1', text: 'first' }), first);
  assert.equal((await state.invoke(web, tool, { operation_id: 'step-1', text: 'changed' })).result.ok, false);
  assert.equal((await state.invoke(web, tool, { operation_id: 'step-2', text: 'second' })).result.ok, true); assert.equal(writes, 2);
  assert.equal((await state.invoke(web, tool, { operation_id: 'illegal:id' })).result.ok, false);
  const unsafe = { ...tool, invoke: async () => { writes++; throw Error('ambiguous'); } };
  assert.equal((await state.invoke(web, unsafe, { operation_id: 'step-3' })).result.uncertain, true);
  assert.equal((await state.invoke(web, unsafe, { operation_id: 'step-3' })).result.uncertain, true); assert.equal(writes, 3);
});

test('locked desktop fails before input, and dense accessibility results fit the tool budget', async t => {
  const {service,store}=await fixture(t),state=new AgentState(store);service.status=()=>({desktop:true,shell:false});
  service.desktop=async()=>{throw Object.assign(Error('电脑已锁屏，请解锁。'),{status:409,code:'COMPUTER_DESKTOP_LOCKED'});};
  const tool=service.tools(event,web).find(t=>t.name==='desktop_screenshot');
  const rejected=await state.invoke(web,tool,{});assert.equal(rejected.result.ok,false);assert.match(rejected.result.error,/已锁屏/);assert.equal(rejected.result.uncertain,undefined);
  service.desktop=async()=>({...await desktop('inspect'),controls:Array.from({length:100},()=>({name:'中文控件'.repeat(40),x:20,y:20,width:100,height:20}))});
  const observed=await service.observe('inspect',web);assert.ok(observed.result.controls.length<100);assert.equal(observed.result.truncated,true);
  assert.ok(Buffer.byteLength(JSON.stringify(observed))<32768);
});

test('screenshots reach the next model turn, evict older screenshots and stay out of durable traces', async t => {
  const { cfg, store, service } = await fixture(t); let rounds = 0;
  class Model extends AIClient {
    async completion(messages) {
      rounds++;
      if (rounds === 1) return call('desktop_screenshot', {});
      const images = messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url') : []);
      assert.equal(images.length, 1); assert.equal(images[0].image_url.url, image);
      return rounds === 2 ? call('desktop_screenshot', {}) : { content: '已观察桌面。' };
    }
  }
  const runtime = new AgentRuntime({ config: cfg, store, ai: new Model(cfg.ai), log: () => {} });
  runtime.computer = service;
  // Run the same model path on non-Windows CI using the injected desktop.
  service.status = () => ({ desktop: true, shell: false });
  assert.equal(await runtime.reply('查看桌面', [], null, { event, job: web }), '已观察桌面。');
  assert.equal(rounds, 3); assert.equal(service.owner, null);
  assert.ok(!JSON.stringify(runtime.state.trace(web.id)).includes('base64'));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM agent_receipts').get().n, 0);
});

test('interrupted local writes stop the tool loop and recovered jobs never restart computer operations', async t => {
  const { cfg, store, service } = await fixture(t); let modelCalls = 0;
  const runtime = new AgentRuntime({ config: cfg, store, log: () => {}, ai: { reply: async (_, __, ___, options) => {
    modelCalls++; return options.invokeTool('computer_write_file', { operation_id: 'a', path: 'a.txt', text: 'hello' });
  } } });
  runtime.computer = service; service.write = async () => { throw Error('interrupted'); };
  await assert.rejects(runtime.reply('创建文件', [], null, { event, job: web }), /结果未知/);
  assert.equal(service.owner, null);
  await assert.rejects(runtime.reply('创建文件', [], null, { event, job: web }), /未自动重做/);
  assert.equal(modelCalls, 1);
});

test('computer management and screenshot routes require the independent admin credential', async t => {
  const bot = await app(t);
  for (const route of ['/admin/agent/computer/control', '/admin/agent/computer/screenshot']) {
    assert.equal((await request(bot, route, { action: 'stop' }, 'onebot')).code, 401);
    assert.equal((await request(bot, route, { action: 'stop' }, false)).code, 401);
  }
  assert.equal((await request(bot, '/admin/agent/computer/control', { action: 'stop' })).data.paused, true);
  assert.equal((await request(bot, '/admin/agent/computer/screenshot', {})).code, 409);
  assert.equal((await request(bot, '/admin/agent/computer/control', { action: 'resume' })).data.paused, false);
  assert.equal((await request(bot, '/admin/agent/computer/control', { action: 'click' })).code, 400);
});

test('web model performs multiple local file operations through the persisted job queue without QQ output', async t => {
  const directory = await temp(t); let rounds = 0, observedHash;
  class Model extends AIClient {
    async completion(messages) {
      rounds++;
      if (rounds === 1) return call('computer_make_directory', {operation_id:'directory',path:'notes'});
      if (rounds === 2) return call('computer_write_file', { operation_id: 'create', path: 'notes/agent.txt', text: 'hello' });
      if (rounds === 3) return call('computer_read_file', { path: 'notes/agent.txt' });
      if (rounds === 4) { observedHash = JSON.parse(messages.at(-1).content).sha256; return call('computer_write_file', { operation_id: 'update', path: 'notes/agent.txt', text: '你好 Agent', expected_sha256: observedHash }); }
      return { content: '文件已创建并修改。' };
    }
  }
  const env = { AI_ENABLED: 'true', AI_MODEL: 'fixture', AI_ALLOWED_USERS: '10001', COMPUTER_ENABLED: 'true', COMPUTER_ROOTS: directory, COMPUTER_DESKTOP_ENABLED: 'false' };
  const bot = await app(t, env, { ai: new Model(config(directory, env).ai) }); let sends = 0; bot.adapter.on('outgoing', () => sends++);
  const response = await request(bot, '/admin/agent/chat', { text: '创建 agent.txt，读取后修改内容。' });
  await waitFor(() => bot.store.get(response.data.job_id).status === 'done');
  assert.equal(await readFile(join(directory, 'notes', 'agent.txt'), 'utf8'), '你好 Agent'); assert.equal(sends, 0);
  assert.deepEqual(bot.agent.state.trace(response.data.job_id).filter(s => s.kind === 'tool').map(s => s.state), ['succeeded', 'succeeded', 'succeeded', 'succeeded']);
});

test('command runner bounds output, honours cancellation, and returns real exit status', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("你好");process.exitCode=3']);
  assert.equal(result.code, 3); assert.equal(result.stdout, '你好');
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxBytes: 100 }), /输出超过限制/);
  await withTestTimeout(() => assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: AbortSignal.timeout(50) })), 5000);
});
