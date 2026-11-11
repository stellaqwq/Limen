/* 程序内前端验收：直接启动真实 login-server 与回放后端，
   验证默认入口、CSP、真实数据映射、写入、全部路由与响应式。
   不连接 QQ，不读写真实 .env。 */
import { createServer } from 'node:http';
import { createLoginServer } from '../src/web/login-server.mjs';
import { groups, fields } from '../src/settings.mjs';
import { chromium } from 'file:///D:/ai/Codex/2026-11-02/agent-room-demo/node_modules/playwright-core/index.mjs';
import { fileURLToPath } from 'node:url';

const shot = (name) => fileURLToPath(new URL('../.review/' + name, import.meta.url));
const snap = async (page, name, fullPage = true) => { await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(120); await page.screenshot({ path: shot(name), fullPage }); };
const now = Date.now();
const posts = [];
const uploads = [];

/* ------------------------------------------------------------ 回放状态 */

const values = Object.fromEntries(fields.map((field) => [field.key, field.type === 'secret' ? '' : String(field.default ?? '')]));
Object.assign(values, {
  AI_MODEL: 'qwen3-32b',
  AI_BASE_URL: 'http://127.0.0.1:11434/v1',
  AI_ENABLED: 'true',
  AI_ALLOWED_GROUPS: '1036914541',
  AI_ALLOWED_USERS: '7782014',
  AGENT_ENABLED: 'true',
  AGENT_MAX_STEPS: '8',
  QZONE_ALLOW_COOKIE_EXPORT: 'false',
  HOST: '127.0.0.1',
  PORT: '5700'
});
let revision = 'rev-0001';
let online = true;
let settingsSecrets = Object.fromEntries(fields.filter((field) => field.type === 'secret').map((field) => [field.key, field.key === 'ADMIN_ACCESS_TOKEN' || field.key === 'ONEBOT_ACCESS_TOKEN']));

const pluginList = [
  { id: '11111111-1111-4111-8111-111111111111', kind: 'group-chat-plus', name: '群聊增强 Chat Plus', description: '参考 Group Chat Plus 的设计：读空气、动态概率、注意力、情绪、消息合并。', version: '1.1.0', author: '内置', enabled: true, revision: 3, priority: 10, timeout_ms: 10000, scope: { all_private: false, all_groups: true, private_users: [], groups: ['1036914541'], require_at: true }, tools: [], runs: 42, failures: 1, last_run: now - 120000, last_error: null, updated_at: now - 300000 },
  { id: '22222222-2222-4222-8222-222222222222', kind: 'living-memory', name: '流动记忆 Living Memory', description: '长期记忆：自动总结、关键词与向量召回、衰减归档。', version: '1.0.0', author: '内置', enabled: false, revision: 1, priority: 5, timeout_ms: 12000, scope: { all_private: true, all_groups: false, private_users: [], groups: [], require_at: false }, tools: [{ name: 'recall_long_term_memory' }], runs: 7, failures: 0, last_run: now - 600000, last_error: null, updated_at: now - 600000 },
  { id: '33333333-3333-4333-8333-333333333333', kind: 'meme-manager', name: '表情包管理器', description: '本地分类图库、聊天收集审核与文案匹配。', version: '1.0.0', author: '内置', enabled: true, revision: 2, priority: 0, timeout_ms: 5000, scope: { all_private: false, all_groups: true, private_users: [], groups: ['1036914541'], require_at: false }, tools: [], runs: 21, failures: 0, last_run: now - 180000, last_error: null, updated_at: now - 900000 },
  { id: '44444444-4444-4444-8444-444444444444', kind: 'background', name: '背景壁纸', description: '上传一张本机图片作为工作台背景。', version: '1.0.0', author: '内置', enabled: true, revision: 1, priority: 0, timeout_ms: 5000, scope: { all_private: true, all_groups: true, private_users: [], groups: [], require_at: false }, tools: [], runs: 0, failures: 0, last_run: null, last_error: null, updated_at: now - 1000000 },
  { id: '55555555-5555-4555-8555-555555555555', kind: 'startup-animation', name: '启动动画', description: '桌面启动时的片头：内置动画、自定义 Logo 或视频。', version: '1.0.0', author: '内置', enabled: true, revision: 1, priority: 0, timeout_ms: 5000, scope: { all_private: true, all_groups: true, private_users: [], groups: [], require_at: false }, tools: [], runs: 0, failures: 0, last_run: null, last_error: null, updated_at: now - 1000000 }
];

/* 背景与启动动画的可变状态：上传/移除后返回新的快照，供页面重绘。 */
const bgState = { enabled: false, mode: 'cover', blur: 0, veil: 0.34, panel: 0.9, image: { url: '/background/image?v=seed', format: 'png', width: 1600, height: 900, size: 284000 } };
const saState = { enabled: true, preset: 'orbit', theme: 'ink', exit: 'fade', accent: '#8b7cf6', title: 'Limen', subtitle: '信号与回应之间', caption: '正在启动本机工作台', min_ms: 1800, source: 'preset', logo: null, video: null, video_fit: 'cover', video_loop: true, video_overlay: true };
const pluginRef = (kind) => {
  const plugin = pluginList.find((item) => item.kind === kind);
  return plugin ? { id: plugin.id, name: plugin.name, enabled: plugin.enabled, revision: plugin.revision, config: {} } : null;
};
const backgroundSnapshot = () => ({
  plugin: pluginRef('background'), available: true, installed: !!pluginRef('background'), plugin_enabled: true,
  enabled: !!(bgState.image && bgState.enabled), mode: bgState.mode, blur: bgState.blur, veil: bgState.veil, panel: bgState.panel,
  image: bgState.image, max_bytes: 8388608
});
const startupSnapshot = () => ({
  plugin: pluginRef('startup-animation'), available: true, installed: !!pluginRef('startup-animation'), plugin_enabled: true,
  ...saState, signature: 'qa-' + (saState.video ? 'video' : saState.logo ? 'logo' : 'preset')
});

const pluginConfigSchema = {
  initial_probability: { type: 'float', description: '基础参与概率', default: 0.06, slider: { min: 0, max: 1, step: 0.01 }, group: '参与概率', hint: '0–1，例如 0.06 表示 6%。' },
  cooldown_seconds: { type: 'int', description: '普通回复冷却（秒）', default: 90, slider: { min: 0, max: 3600, step: 1 }, group: '参与概率' },
  trigger_keywords: { type: 'list', description: '直接触发关键词', default: [], group: '触发与过滤', hint: '每行一个关键词。' },
  decision_ai_enabled: { type: 'bool', description: '启用 AI 读空气', default: true, group: 'AI 读空气' },
  neutral_style: { type: 'text', description: '中性表达建议', default: '平静、简短。', group: '注意力与情绪' }
};
const pluginConfig = {
  initial_probability: 0.06,
  cooldown_seconds: 90,
  trigger_keywords: ['在吗'],
  decision_ai_enabled: true,
  neutral_style: '平静、简短。'
};

const jobs = [
  { id: 9101, conversation: '2084117309:group:1036914541', status: 'uncertain', attempts: 1, send_attempts: 1, next_at: 0, reason: '发送结果未知，请在 QQ 中核对', created_at: now - 240000, updated_at: now - 60000 },
  { id: 9100, conversation: '2084117309:private:7782014', status: 'done', attempts: 1, send_attempts: 1, next_at: 0, reason: '已确认送达', created_at: now - 600000, updated_at: now - 540000 },
  { id: 9099, conversation: 'web:11111111-1111-1111-1111-111111111111', status: 'queued', attempts: 0, send_attempts: 0, next_at: 0, reason: '等待发送窗口', created_at: now - 120000, updated_at: now - 120000 }
];

const webSession = '11111111-1111-1111-1111-111111111111';
const chatJobs = [
  { id: 9102, input: '帮我总结今天的待办', reply: '今天有两条待办：回复群消息、检查发送队列。', status: 'done', reason: 'completed', updated_at: now - 300000 },
  { id: 9103, input: '再看一下失败的任务', reply: '有一条发送结果未知的任务，需要先到 QQ 里核对。', status: 'done', reason: 'completed', updated_at: now - 200000 }
];

const memories = [
  { id: 'm1', key: '回答偏好', content: '用户喜欢简洁、直接的回答，不喜欢客套。', status: 'active', importance: 0.82, updated_at: now - 3600000, revision: 'mr1' },
  { id: 'm2', key: '工作节奏', content: '通常在晚上处理消息，白天不常在线。', status: 'archived', importance: 0.2, updated_at: now - 86400000, revision: 'mr2' }
];

const qzone = [
  { id: 1, content: '周末下雨，在家读书。', prompt: '周末下雨在家读书', visibility: 'private', status: 'draft', account: null, simulated: false, tid: null, url: null, reason: null, created_at: now - 120000, updated_at: now - 120000, revision: 1 },
  { id: 2, content: '今天把工作台重新整理了一遍。', prompt: '', visibility: 'friends', status: 'published', account: 2084117309, simulated: false, tid: 'tid-2', url: null, reason: null, created_at: now - 86400000, updated_at: now - 86000000, revision: 2 }
];

const telemetry = [
  { id: 1, time: new Date(now - 240000).toISOString(), kind: 'message', event: { post_type: 'message', message_type: 'group', self_id: 2084117309, user_id: 7782014, group_id: 1036914541, time: Math.floor((now - 240000) / 1000), message_id: 'm-1', message: [{ type: 'text', data: { text: '在吗，帮我看下任务' } }] } },
  { id: 2, time: new Date(now - 200000).toISOString(), kind: 'log', level: 'info', event: 'ai.queued', fields: { job: '9101', conversation: 'group' } },
  { id: 3, time: new Date(now - 60000).toISOString(), kind: 'log', level: 'warn', event: 'send.uncertain', fields: { job: '9101', reason: 'no_receipt' } },
  { id: 4, time: new Date(now - 30000).toISOString(), kind: 'message', event: { post_type: 'message_sent', message_type: 'private', self_id: 2084117309, user_id: 7782014, time: Math.floor((now - 30000) / 1000), message_id: 'm-2', message: [{ type: 'text', data: { text: '稍等，我看一下队列。' } }] } }
];

const agent = {
  enabled: true, ai_enabled: true, model: 'qwen3-32b', max_steps: 8, max_tool_calls: 16, timeout_ms: 300000,
  personas: [{ id: 'persona-1', name: '默认人格', tools: [] }],
  sessions: [{ conversation: 'web:' + webSession, jobs: 2, updated_at: now - 200000, persona: '' }],
  runs: [], tools: [{ name: 'current_time', description: '当前时间', source: '内置', enabled: true }, { name: 'memory_search', description: '会话记忆', source: '内置', enabled: true }],
  computer: { enabled: false }, android: null, douyin_web: null, qq_social: { enabled: false },
  attachments: { max_files: 4 }, max_steps: 8
};

const status = () => ({
  online, state: online ? 'online' : 'idle', account: online ? 2084117309 : 0, driver: 'kernel', simulated: false,
  kernel: { version: '9.9.36-53644', login_state: online ? 'online' : 'idle' },
  jobs: { queued: 1, generating: 1, ready: 0, sending: 0, done: 6, uncertain: 1, failed: 0, ignored: 2 },
  privacy: { retain_ignored_content: false, history_days: 30, memory_limit: 1000 },
  ai_enabled: true, appearance: null, startup: null, capabilities: ['message', 'media.image']
});

const settingsSnapshot = () => ({
  groups, fields, revision, persistent: true,
  values: Object.fromEntries(fields.map((field) => [field.key, field.type === 'secret' ? '' : values[field.key]])),
  secrets: { ...settingsSecrets },
  locked: [], pending: []
});

const json = (res, value, code = 200) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

const backend = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  if (req.method === 'POST') posts.push({ path: url.pathname, body });
  const path = url.pathname;

  if (path === '/admin/status') return json(res, status());
  if (path === '/admin/settings' && req.method === 'GET') return json(res, settingsSnapshot());
  if (path === '/admin/settings' && req.method === 'POST') {
    Object.assign(values, body.values || {});
    for (const [key, value] of Object.entries(body.values || {})) {
      if (fields.some((field) => field.key === key && field.type === 'secret')) settingsSecrets[key] = !!value;
    }
    revision = 'rev-' + String(Number(revision.slice(4)) + 1).padStart(4, '0');
    return json(res, settingsSnapshot());
  }
  if (path === '/admin/settings/reveal') return json(res, { key: body.key, value: 'hidden-' + body.key });
  if (path === '/admin/models') return json(res, { models: ['qwen3-32b', 'qwen3-14b-instruct', 'qwen2.5-vl-32b'] });

  if (path === '/admin/jobs') return json(res, jobs);
  if (path === '/admin/jobs/conversations') return json(res, [...new Set(jobs.map((job) => job.conversation))]);
  if (/^\/admin\/jobs\/\d+$/.test(path) && req.method === 'GET') {
    const id = Number(path.split('/').pop());
    const job = jobs.find((item) => item.id === id);
    if (!job) return json(res, { message: 'Job not found' }, 404);
    return json(res, { ...job, event: { post_type: 'message', message_type: 'group', self_id: 2084117309, user_id: 7782014, group_id: 1036914541, message: [{ type: 'text', data: { text: '在吗，帮我看下任务' } }] }, reply: job.status === 'done' ? '稍等，我看一下队列。' : '正在处理。', group_chat_decision: { participate: true, reason: '被 @', confidence: 0.92 }, stream_parts: [], agent_steps: [{ kind: 'model', name: 'reply', state: 'completed', duration_ms: 820 }, { kind: 'tool', name: 'current_time', state: 'completed', duration_ms: 12 }], command_failures: [] });
  }
  if (/^\/admin\/jobs\/\d+\/resolve$/.test(path)) {
    const id = Number(path.split('/')[3]);
    const job = jobs.find((item) => item.id === id);
    if (job) job.status = body.outcome === 'sent' ? 'done' : 'failed';
    return json(res, { status: 'ok', data: null });
  }

  if (path === '/admin/plugins' && req.method === 'GET') {
    return json(res, { plugins: pluginList.map(({ ...plugin }) => plugin), template: {}, limit: 32, builtins: [], packages: [
      { id: 'group-chat-plus', kind: 'group-chat-plus', name: '群聊增强', version: '1.1.0', capabilities: ['message', 'hooks', 'admin-api'], panel: 'groupchat' },
      { id: 'living-memory', kind: 'living-memory', name: '流动记忆', version: '1.0.0', capabilities: ['message', 'agent-tools', 'hooks', 'admin-api'], panel: 'memory' },
      { id: 'meme-manager', kind: 'meme-manager', name: '表情包管理器', version: '1.0.0', capabilities: ['message', 'agent-tools', 'admin-api', 'hooks'], panel: 'memes' },
      { id: 'background', kind: 'background', name: '背景壁纸', version: '1.0.0', capabilities: ['admin-api'], panel: 'background' },
      { id: 'startup-animation', kind: 'startup-animation', name: '启动动画', version: '1.0.0', capabilities: ['admin-api'], panel: 'startup' }
    ], rejected: [], skipped: [] });
  }
  if (path === '/admin/plugins/detail') {
    const plugin = pluginList.find((item) => item.id === url.searchParams.get('id'));
    if (!plugin) return json(res, { message: '插件不存在' }, 404);
    return json(res, { ...plugin, config_schema: pluginConfigSchema, config: pluginConfig, source: '// replay' });
  }
  if (path === '/admin/plugins/toggle') {
    const plugin = pluginList.find((item) => item.id === body.id);
    if (!plugin) return json(res, { message: '插件不存在' }, 404);
    plugin.enabled = body.enabled === true;
    plugin.revision += 1;
    return json(res, plugin);
  }
  if (path === '/admin/plugins/save') {
    const plugin = pluginList.find((item) => item.id === body.id);
    if (!plugin) return json(res, { message: '插件不存在' }, 404);
    Object.assign(pluginConfig, (body.plugin || {}).config || {});
    plugin.revision += 1;
    return json(res, { ...plugin, config_schema: pluginConfigSchema, config: pluginConfig, source: '// replay' });
  }
  if (path === '/admin/plugins/delete') {
    const index = pluginList.findIndex((item) => item.id === body.id);
    if (index >= 0) pluginList.splice(index, 1);
    return json(res, { removed: true });
  }
  if (path === '/admin/plugins/groupchat') {
    return json(res, { plugin: pluginList[0], schema: {}, ai_enabled: true, context_enabled: true, online: true, checked_at: now, groups: [{ id: '1036914541', conversation: '2084117309:group:1036914541', allowed: true, paused: false, probability: 0.06, last_probability: 0.11, last_reason: '被 @', active_jobs: 1, members: 3, images: 4, proactive: true }] });
  }
  if (path === '/admin/plugins/memory') {
    return json(res, { plugin: pluginList[1], scopes: [{ scope: '2084117309:private:7782014', persona: '', count: 2 }], selected: { scope: '2084117309:private:7782014', persona: '', count: 2 }, memories, counts: { total: 2, active: 1, archived: 1 } });
  }
  if (path === '/admin/plugins/memory/action') {
    return json(res, { ok: true });
  }
  if (path === '/admin/memes') {
    return json(res, { plugin: pluginList[2], categories: [{ id: 'other', name: '其他', count: 1 }], images: [{ id: 'a'.repeat(64), name: '示例表情', category: 'other', format: 'png', size: 1024, tags: '' }], total: 1, page: 1, pages: 1, counts: { approved: 1, pending: 0 }, max_bytes: 4194304, limit: 2000, ai_ready: true });
  }
  if (path === '/admin/memes/image') {
    if (!res.destroyed) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1ZrAAAAABJRU5ErkJggg==', 'base64');
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' });
      res.end(png);
    }
    return;
  }
  if (path === '/admin/memes/edit') return json(res, { ok: true });

  if (path === '/admin/telemetry') return json(res, { entries: telemetry, cursor: telemetry.length, oldest: 1 });
  if (path === '/admin/qzone/status') return json(res, { configured: true, account: 2084117309, simulated: false, credential_error: false, cookie_export_enabled: false, ai_ready: true, max_chars: 2000, retention_days: 30, uncertain_retention_days: 30 });
  if (path === '/admin/qzone/posts') return json(res, qzone);
  if (path === '/admin/qzone/generate') {
    const row = { id: qzone.length + 1, content: '', prompt: body.prompt, visibility: body.visibility, status: 'generating', account: null, simulated: false, tid: null, url: null, reason: null, created_at: now, updated_at: now, revision: 1 };
    qzone.unshift(row);
    setTimeout(() => { row.content = '【回放草稿】' + body.prompt; row.status = 'draft'; row.updated_at = Date.now(); }, 1200);
    return json(res, row);
  }
  if (path === '/admin/qzone/publish') {
    const row = qzone.find((item) => item.id === body.id);
    if (row) { row.status = 'published'; row.account = body.account; row.updated_at = Date.now(); row.revision += 1; }
    return json(res, row || {});
  }
  if (path === '/admin/qzone/draft') {
    const row = qzone.find((item) => item.id === body.id);
    if (row) { row.content = body.content; row.visibility = body.visibility; row.status = 'draft'; row.revision += 1; }
    return json(res, row || {});
  }
  if (path === '/admin/qzone/session') return json(res, { configured: true, account: 2084117309, simulated: false, ai_ready: true, max_chars: 2000 });
  if (path === '/admin/qzone/check') return json(res, { configured: true, account: 2084117309, verified: true, simulated: false, ai_ready: true });
  if (path === '/admin/qzone/clear') return json(res, { configured: false, account: 0, simulated: false, ai_ready: true });
  if (path === '/admin/qzone/resolve') return json(res, { ok: true });

  if (path === '/admin/agent' && req.method === 'GET') return json(res, agent);
  if (path === '/admin/agent/chat' && req.method === 'GET') return json(res, { session: url.searchParams.get('session'), jobs: chatJobs });
  if (path === '/admin/agent/chat' && req.method === 'POST') {
    const job = { id: 9104, input: body.text, reply: '这是回放回复：任务已收到。', status: 'done', reason: 'completed', updated_at: Date.now() };
    chatJobs.push(job);
    agent.sessions = [{ conversation: 'web:' + body.session, jobs: chatJobs.length, updated_at: Date.now(), persona: '' }];
    return json(res, { session: body.session, job_id: job.id });
  }
  if (path === '/admin/agent/chat/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify({ session: url.searchParams.get('session'), jobs: chatJobs }) + '\n\n');
    const timer = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
    res.once('close', () => clearInterval(timer));
    return;
  }

  if (path === '/admin/background') return json(res, backgroundSnapshot());
  if (path === '/admin/startup-animation') return json(res, startupSnapshot());
  if (path === '/admin/background/image' || path === '/admin/startup-animation/media') {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1ZrAAAAABJRU5ErkJggg==', 'base64'));
  }
  if (path === '/admin/background/action') {
    if (body.action === 'upload') bgState.image = { url: '/background/image?v=up', format: 'png', width: 800, height: 600, size: 12000 };
    if (body.action === 'remove') bgState.image = null;
    if (body.action === 'save') {
      if (Object.hasOwn(body, 'enabled')) bgState.enabled = !!body.enabled;
      for (const key of ['mode', 'blur', 'veil', 'panel']) if (Object.hasOwn(body, key)) bgState[key] = body[key];
    }
    return json(res, backgroundSnapshot());
  }
  if (path === '/admin/startup-animation/action') {
    if (body.action === 'upload-logo') saState.logo = { url: '/startup-animation/media?v=up', format: 'png', width: 512, height: 512, size: 9000 };
    if (body.action === 'remove-logo') saState.logo = null;
    if (body.action === 'remove-video') { saState.video = null; saState.source = 'preset'; }
    if (body.action === 'save') for (const key of ['enabled', 'preset', 'theme', 'min_ms', 'source']) if (Object.hasOwn(body, key)) saState[key] = body[key];
    return json(res, startupSnapshot());
  }
  if (path === '/admin/startup-animation/video' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' });
    return res.end();
  }
  if (path === '/admin/startup-animation/video' && req.method === 'POST') {
    saState.video = { url: '/startup-animation/video?v=up', format: 'mp4', mime: 'video/mp4', size: raw.length, name: 'intro.mp4' };
    saState.source = 'video';
    uploads.push({ path, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0), type: req.headers['content-type'] || '' });
    return json(res, startupSnapshot());
  }

  if (path === '/admin/login/start') return json(res, { handle: 'qr-handle', qrcode: 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1ZrAAAAABJRU5ErkJggg==', state: 'waiting_scan', expires_at: Date.now() + 120000 });
  if (path === '/admin/login/poll') return json(res, { state: 'waiting_scan', account: 0, expires_at: Date.now() + 90000 });
  if (path === '/admin/login/logout') return json(res, { status: 'ok', data: null });

  return json(res, { message: 'not found: ' + path }, 404);
});

await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
const backendURL = 'http://127.0.0.1:' + backend.address().port;
const login = await createLoginServer({ backend: backendURL, token: 'qa-token', port: 0 });
const base = login.url;
console.log('workbench:', base.replace(/\/login\/.*/, '/login/<token>'));

/* ------------------------------------------------------------ 静态入口 */

const checks = {};
const consolePage = await fetch(base + '/console');
const consoleHtml = await consolePage.text();
checks.consoleEntry = consolePage.status === 200 && consoleHtml.includes('Limen') && consoleHtml.includes('assets/app.js') && !consoleHtml.includes('data.js');
checks.injected = new RegExp('(?:src|href)="' + new URL(base).pathname.replace(/\//g, '\\/') + '\\/assets\\/app\\.js"').test(consoleHtml)
  && /meta name="limen-api-base" content="\/login\/[a-f0-9]+"/.test(consoleHtml)
  && consoleHtml.includes('name="limen-embedded" content="1"')
  && !consoleHtml.includes('<base href=');
checks.csp = consolePage.headers.get('content-security-policy') || '';
checks.cspOk = checks.csp.includes("script-src 'self'") && checks.csp.includes("connect-src 'self'");
const asset = await fetch(base + '/console/assets/app.js');
checks.asset = asset.status === 200 && (asset.headers.get('content-type') || '').includes('text/javascript');
const state = await fetch(base + '/state');
checks.state = state.status === 200 && (await state.json()).online === true;

/* ------------------------------------------------------------ 浏览器 */

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push('PAGE: ' + error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push('CONSOLE: ' + message.text()); });
page.on('response', (response) => { if (response.status() >= 500) errors.push('HTTP ' + response.status() + ' ' + response.url()); });

await page.goto(base + '/console', { waitUntil: 'load' });
await page.waitForFunction(() => { const note = document.getElementById('profile-note'); return note && note.textContent && note.textContent !== '正在读取连接状态…'; }, null, { timeout: 15000 });
await page.waitForTimeout(600);
checks.noFixture = await page.evaluate(() => typeof window.DEMO === 'undefined' && !document.querySelector('script[src*="data.js"]'));
checks.defaultPage = await page.$eval('#main h1', (el) => el.textContent.trim());
checks.model = await page.$eval('#f-AI_MODEL', (el) => el.value);
checks.fields = await page.$$eval('#main [data-field]', (list) => list.length);
await snap(page, 'console-config.png');

/* 配置保存 */
await page.fill('#f-AI_MODEL', 'qwen3-14b-instruct');
checks.dirtyText = await page.$eval('#save-text', (el) => el.textContent);
await page.click('[data-act="save-config"]');
await page.waitForTimeout(700);
checks.saved = posts.find((post) => post.path === '/admin/settings' && post.body.values && post.body.values.AI_MODEL === 'qwen3-14b-instruct') || null;
checks.saveText = await page.$eval('#save-text', (el) => el.textContent);

/* 服务提供商 */
await page.goto(base + '/console#/providers', { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.click('[data-act="probe-models"]');
await page.waitForTimeout(700);
checks.models = await page.$$eval('.meme-chip b', (list) => list.map((el) => el.textContent));
checks.providerModel = await page.$eval('.provider-head b', (el) => el.textContent);

/* 插件列表与启停 */
await page.goto(base + '/console#/plugins', { waitUntil: 'load' });
await page.waitForTimeout(600);
checks.pluginCards = await page.$$eval('.plugin-card .plugin-name a', (list) => list.map((el) => el.textContent));
await page.click('.plugin-card .switch');
await page.waitForTimeout(700);
checks.toggled = posts.find((post) => post.path === '/admin/plugins/toggle') || null;
await snap(page, 'console-plugins.png');

/* 插件详情：概览 + 配置 */
await page.goto(base + '/console#/plugins/living-memory', { waitUntil: 'load' });
await page.waitForTimeout(900);
checks.memoryRows = await page.$$eval('.table tbody tr', (list) => list.length);
await snap(page, 'console-plugin-overview.png');
await page.goto(base + '/console#/plugins/group-chat-plus/config', { waitUntil: 'load' });
await page.waitForTimeout(800);
checks.pluginFields = await page.$$eval('#plugin-form [data-schema]', (list) => list.length);
await page.fill('#p-cooldown_seconds', '120');
await page.click('[data-act="save-plugin"]');
await page.waitForTimeout(700);
checks.pluginSaved = posts.find((post) => post.path === '/admin/plugins/save' && post.body.plugin && post.body.plugin.config.cooldown_seconds === 120) || null;
checks.pluginScopeCard = await page.$$eval('#main h2', (list) => list.some((el) => el.textContent.includes('作用范围')));
await snap(page, 'console-plugin-config.png');

/* 纯界面插件（背景壁纸/启动动画）不显示作用范围 */
await page.goto(base + '/console#/plugins/background/config', { waitUntil: 'load' });
await page.waitForTimeout(700);
checks.visualNoScope = await page.$eval('#main', (el) => !el.innerText.includes('作用范围'));
await page.goto(base + '/console#/plugins/startup-animation/config', { waitUntil: 'load' });
await page.waitForTimeout(700);
checks.startupNoScope = await page.$eval('#main', (el) => !el.innerText.includes('作用范围'));

/* 背景壁纸与启动动画：素材上传留在插件页 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1ZrAAAAABJRU5ErkJggg==', 'base64');
await page.goto(base + '/console#/plugins/background', { waitUntil: 'load' });
await page.waitForTimeout(800);
checks.bgPanel = await page.$eval('#main', (el) => el.innerText.includes('上传图片') && el.innerText.includes('适应方式'));
await page.setInputFiles('#bg-file', { name: 'wall.png', mimeType: 'image/png', buffer: PNG });
await page.waitForTimeout(900);
checks.bgUpload = posts.find((post) => post.path === '/admin/background/action' && post.body.action === 'upload') || null;
await snap(page, 'console-background.png');

await page.goto(base + '/console#/plugins/startup-animation', { waitUntil: 'load' });
await page.waitForTimeout(800);
checks.saPanel = await page.$eval('#main', (el) => el.innerText.includes('上传视频') && el.innerText.includes('上传 Logo'));
await page.setInputFiles('#sa-video-file', { name: 'intro.mp4', mimeType: 'video/mp4', buffer: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]) });
await page.waitForTimeout(1200);
checks.videoUpload = uploads.find((item) => item.path === '/admin/startup-animation/video') || null;
await snap(page, 'console-startup.png');

/* 系统设置不再承载插件能力 */
await page.goto(base + '/console#/settings', { waitUntil: 'load' });
await page.waitForTimeout(600);
checks.settingsClean = await page.$eval('#main', (el) => !el.innerText.includes('背景壁纸') && !el.innerText.includes('启动动画') && el.innerText.includes('明暗主题'));

/* 数据与日志：任务抽屉与核对 */
await page.goto(base + '/console#/data/jobs', { waitUntil: 'load' });
await page.waitForTimeout(700);
checks.jobRows = await page.$$eval('.table tbody tr', (list) => list.length);
await page.click('tr[data-select="job:9101"]');
await page.waitForTimeout(600);
checks.jobDrawer = await page.$eval('#drawer-title', (el) => el.textContent);
await page.click('[data-act="resolve-job"][data-outcome="sent"]');
await page.waitForTimeout(300);
await page.click('[data-act="do-resolve-job"]');
await page.waitForTimeout(700);
checks.resolved = posts.find((post) => post.path === '/admin/jobs/9101/resolve') || null;
await snap(page, 'console-data.png');

/* 空间草稿生成 */
await page.goto(base + '/console#/qzone', { waitUntil: 'load' });
await page.waitForTimeout(700);
await page.click('[data-act="qzone-new"]');
await page.fill('#qzone-prompt', '回放主题：下雨的周末');
await page.click('[data-act="do-qzone-new"]');
await page.waitForTimeout(600);
checks.qzoneGenerated = posts.find((post) => post.path === '/admin/qzone/generate' && post.body.prompt === '回放主题：下雨的周末') || null;
await page.waitForTimeout(4800);
checks.qzoneRows = await page.$$eval('.table tbody tr', (list) => list.map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
checks.qzoneStore = await page.evaluate(() => (window.LIMEN.store.qzonePosts || []).map((post) => [post.id, post.status, post.content]));
checks.qzoneDraft = checks.qzoneRows.some((row) => row.includes('回放草稿'));

/* 对话测试 */
await page.goto(base + '/console#/chat', { waitUntil: 'load' });
await page.waitForTimeout(800);
checks.chatHistory = await page.$$eval('.msg', (list) => list.length);
await page.fill('#chat-input', '回放一条网页消息');
await page.click('[data-act="chat-send"]');
await page.waitForTimeout(900);
checks.chatPost = posts.find((post) => post.path === '/admin/agent/chat' && post.body.text === '回放一条网页消息') || null;
checks.chatReply = await page.$eval('#chat-thread', (el) => el.innerText.includes('这是回放回复'));
await snap(page, 'console-chat.png');

/* 工作台 */
await page.goto(base + '/console#/dashboard', { waitUntil: 'load' });
await page.waitForTimeout(700);
checks.dashboardStats = await page.$$eval('.stat b', (list) => list.map((el) => el.textContent));
checks.readiness = await page.$$eval('.ready-item', (list) => list.map((el) => el.dataset.done));
await snap(page, 'console-dashboard.png');

/* 全部路由 */
const routes = ['config/ai', 'config/agent', 'config/computer', 'config/access', 'config/qq', 'config/connection', 'config/queue', 'config/storage', 'config/advanced', 'providers', 'platforms', 'plugins', 'dashboard', 'chat', 'data/messages', 'data/jobs', 'data/logs', 'qzone', 'settings'];
const routeReport = {};
for (const route of routes) {
  await page.evaluate((value) => { location.hash = '#/' + value; }, route);
  await page.waitForTimeout(350);
  routeReport[route] = await page.evaluate(() => ({
    h1: document.querySelector('#main h1')?.textContent?.trim() || '',
    error: document.querySelectorAll('.state-error').length,
    overflow: document.documentElement.scrollWidth > innerWidth
  }));
  if (route === 'settings' || route === 'qzone' || route === 'providers') await snap(page, 'console-' + route + '.png');
}
checks.routes = routeReport;
checks.routeErrors = Object.entries(routeReport).filter(([, value]) => !value.h1 || value.error).map(([key]) => key);

/* 扫码面板（离线状态） */
online = false;
await page.goto(base + '/console?offline=1#/platforms', { waitUntil: 'load' });
await page.waitForTimeout(900);
checks.qrPageText = await page.$eval('#main', (el) => el.innerText.slice(0, 400));
const qrButton = await page.$('[data-act="qr-start"]');
if (qrButton) {
  await qrButton.click();
  await page.waitForTimeout(900);
}
checks.qrPost = posts.find((post) => post.path === '/admin/login/start') || null;
checks.qrImage = await page.$eval('.qr-frame img', (el) => el.src.startsWith('data:image/')).catch(() => false);
checks.qrState = await page.$eval('#main', (el) => el.innerText.includes('扫码登录'));
await snap(page, 'console-qr.png');
online = true;

/* 响应式 */
checks.responsive = {};
for (const width of [1440, 1280, 1024, 768, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(base + '/console#/dashboard', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  checks.responsive[width] = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  if (width === 390) {
    checks.mobile = await page.evaluate(() => ({
      menu: !!document.getElementById('side-open'),
      statusRow: !document.body.innerText.includes('服务运行中') && !document.body.innerText.includes('实时连接'),
      savebar: !!document.querySelector('.savebar')
    }));
    await snap(page, 'console-mobile.png');
  }
}

/* 深色主题：确认分区条、面板、表格在暗色下仍可读 */
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + '/console#/dashboard', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('limen-console-theme', 'dark'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(600);
checks.darkTheme = await page.evaluate(() => document.documentElement.dataset.theme === 'dark');
await snap(page, 'console-dark.png');
await page.evaluate(() => localStorage.removeItem('limen-console-theme'));

checks.errors = errors;
console.log(JSON.stringify(checks, null, 2));
await browser.close();
backend.close();
await login.close();
