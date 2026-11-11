import { ContextStatus } from '../agent/context-status.mjs';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { conversation, eventKey, chatText, isChatCommand, isChatAdmin, isGroupUserBlocked, aiInput, replyMessage, replyOptions } from '../messages.mjs';
import { normalizeTools } from '../agent/schema.mjs';
import { normalizeConfigSchema, applyConfigSchema } from './config-schema.mjs';
import { PluginRegistry, resolvePluginDir } from './registry.mjs';

const MAX_PLUGINS = 32, MAX_SOURCE = 49152, MAX_QUEUE = 100;
export const pluginErrors = {
  syntax_error: '代码加载失败，请检查 JavaScript 语法和导入。',
  invalid_export: '代码必须使用 export default 导出一个函数。',
  runtime_error: '插件执行失败，请检查代码和配置。',
  invalid_result: '返回值应为 { reply: "文本" }、{ message: [文本或图片消息段] } 或 null；文本最多 2000 字，消息段最多 5 个。',
  timeout: '插件执行超时，已终止线程。', stopped: '插件执行已取消。',
  send_failed: '回复发送失败，未自动重试。', delivery_unknown: '发送结果未知，请在 QQ 中核对；不会自动重发。'
};
export const pluginTemplate = {
  schema: 1, name: '指令回复', description: '收到 /ping 时返回自定义文本。', version: '1.0.0',
  trigger: '/', priority: 0, timeout_ms: 3000,
  scope: { private_users: [], groups: [], all_private: false, all_groups: false, require_at: true },
  config: { command: '/ping', response: 'pong！插件运行正常。' },
  source: `export default async function ({ text, config, event }) {
  if (text.trim() !== config.command) return null;
  return { reply: config.response, handled: true };
}
`
};
function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function boundedText(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw problem(label + '无效或超过长度限制。');
  return value;
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 500 || value.some(id => !/^[1-9]\d{0,15}$/.test(String(id)) || !Number.isSafeInteger(Number(id)))) throw problem('会话范围必须为有效 QQ 号数组（最多 500 项）。');
  return [...new Set(value.map(String))];
}
function textOf(event) {
  return Array.isArray(event.message) ? event.message.filter(s => s.type === 'text').map(s => s.data?.text || '').join('').trim() : '';
}

export class PluginService {
  constructor({ store, adapter, log, config, retentionDays = 7, ai, attachments, groupContext, overrides = {} }) {
    Object.assign(this, { store, adapter, log, config, retentionDays, ai, attachments, groupContext, overrides });
    this.contextStatus = new ContextStatus({ store, config });
    this.closed = false; this.workers = new Map(); this.tasks = new Set(); this.tails = new Map(); this.mutations = Promise.resolve();
    this.registry = null; this.loading = null; this.instances = new Map(); this.admins = new Map();
    store.db.exec(`CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY, definition TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
      runs INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
      last_run INTEGER, last_error TEXT);
      CREATE TABLE IF NOT EXISTS plugin_receipts (event_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
    this.cleanup();
  }
  // ---------------------------------------------------------------- loading
  /** Load plugin packages from disk. Idempotent; safe to await repeatedly. */
  load({ dir } = {}) {
    if (!this.loading) {
      this.loading = (async () => {
        const target = dir || this.config.pluginDir || await resolvePluginDir();
        this.pluginDir = target;
        this.registry = await PluginRegistry.load({ dir: target, log: this.log });
        return this.registry;
      })();
    }
    return this.loading;
  }
  async ready() { if (!this.registry) await this.load(); return this.registry; }
  requireKind(kind) {
    const entry = this.registry?.get(kind);
    if (!entry) throw problem('插件类型 ' + kind + ' 未安装到 plugins 目录，请重新启动服务或检查插件包。', 400);
    return entry;
  }
  context() {
    if (!this.ctx) this.ctx = {
      store: this.store, config: this.config, log: this.log, adapter: this.adapter,
      ai: this.ai, attachments: this.attachments, groupContext: this.groupContext,
      overrides: this.overrides, plugins: this,
      get: kind => this.service(kind)
    };
    return this.ctx;
  }
  /** Instantiate (once) and return the runtime service object of a plugin kind. */
  service(kind) {
    if (this.instances.has(kind)) return this.instances.get(kind) || null;
    const entry = this.registry?.get(kind);
    if (!entry) { this.instances.set(kind, null); return null; }
    let instance;
    try { instance = entry.create(this.context()); }
    catch (error) { this.log('error', 'plugin_create_failed', { plugin: kind, detail: String(error.message).slice(0, 160) }); instance = null; }
    this.instances.set(kind, instance || null);
    return instance || null;
  }
  /** Load packages, instantiate services and run one-shot setup hooks. */
  async start({ dir } = {}) {
    await this.load({ dir });
    for (const entry of this.registry.packages.values()) this.service(entry.kind);
    for (const entry of this.registry.packages.values()) {
      if (!entry.setup) continue;
      try { await entry.setup(this.context()); }
      catch (error) { this.log('warn', 'plugin_setup_failed', { plugin: entry.kind, detail: String(error.message).slice(0, 160) }); }
    }
    return this.registry;
  }
  admin(name) { return this.admins.get(name) || null; }
  /** Let a package refresh side effects (snapshots, caches) after a record changes. */
  async changed(kind) {
    const entry = this.registry?.get(kind);
    if (!entry?.changed) return;
    try { await entry.changed(this.service(kind), this.find(kind)); }
    catch (error) { this.log('warn', 'plugin_changed_failed', { plugin: kind, detail: String(error.message).slice(0, 160) }); }
  }
  registryEntry(kind) { return this.registry?.get(kind) || null; }
  // Host predicates exposed to plugin visibility rules.
  isChatAdmin(event) { return isChatAdmin(event, this.config); }
  isGroupUserBlocked(event) { return isGroupUserBlocked(event, this.config); }
  // ------------------------------------------------------------ persistence
  cleanup() {
    this.contextStatus?.cleanup();
    for (const instance of this.instances.values()) instance?.cleanup?.();
    if (this.retentionDays > 0) this.store.db.prepare('DELETE FROM plugin_receipts WHERE created_at < ?').run(Date.now() - this.retentionDays * 86400000);
  }
  rows() {
    return this.store.db.prepare('SELECT * FROM plugins ORDER BY id').all().map(row => ({
      kind: 'script', ...JSON.parse(row.definition), id: row.id, enabled: !!row.enabled, revision: row.revision,
      updated_at: row.updated_at, runs: row.runs, failures: row.failures,
      last_run: row.last_run, last_error: row.last_error ? pluginErrors[row.last_error] || pluginErrors.runtime_error : null
    })).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }
  get(id) {
    if (typeof id !== 'string') throw problem('插件编号无效。');
    const row = this.rows().find(row => row.id === id);
    if (!row) throw problem('插件不存在，请刷新列表。', 404);
    return row;
  }
  list() {
    return {
      plugins: this.rows().map(({ source, config, config_schema, ...row }) => row),
      template: pluginTemplate, limit: MAX_PLUGINS,
      builtins: this.registry ? this.registry.templates() : [],
      packages: this.registry ? [...this.registry.packages.values()].map(({ id, kind, name, version, description, capabilities, panel, singleton }) => ({ id, kind, name, version, description, capabilities, panel, singleton })) : []
    };
  }
  mutate(fn) {
    const task = this.mutations.then(() => { if (this.closed) throw problem('服务正在关闭。', 409); return fn(); });
    this.mutations = task.catch(() => {}); return task;
  }
  checkRevision(row, revision) {
    if (row.revision !== revision) throw problem('插件已被其他窗口修改，请重新加载后再保存。', 409);
  }
  // ------------------------------------------------------------- definition
  normalize(value) {
    if (!object(value) || value.schema !== undefined && value.schema !== 1) throw problem('请选择版本 1 的插件 JSON。');
    const name = boundedText(value.name, '插件名称', 80, true).trim();
    const kind = value.kind ?? 'script';
    const scope = value.scope ?? pluginTemplate.scope;
    const priority = value.priority ?? 0, timeout = value.timeout_ms ?? 3000;
    if (!object(scope)) throw problem('插件会话范围无效。');
    for (const key of ['all_private', 'all_groups', 'require_at']) if (scope[key] !== undefined && typeof scope[key] !== 'boolean') throw problem('会话范围开关必须是布尔值。');
    if (!Number.isSafeInteger(priority) || priority < -100 || priority > 100) throw problem('优先级必须是 -100 至 100 的整数。');
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 10000) throw problem('执行时限必须是 100 至 10000 毫秒的整数。');
    const normalizedScope = {
      private_users: ids(scope.private_users ?? []), groups: ids(scope.groups ?? []),
      all_private: scope.all_private ?? false, all_groups: scope.all_groups ?? false, require_at: scope.require_at ?? true
    };
    if (kind === 'script') {
      const source = boundedText(value.source, '插件代码', MAX_SOURCE, true);
      if (Buffer.byteLength(source) > MAX_SOURCE) throw problem('插件代码不能超过 48 KiB。');
      const config_schema = normalizeConfigSchema(value.config_schema ?? {});
      const config = value.config ?? {};
      if (!object(config) || Buffer.byteLength(JSON.stringify(config)) > 32768) throw problem('插件配置必须为 JSON 对象且不能超过 32 KiB。');
      return this.definition({
        kind, name, source, config: applyConfigSchema(config_schema, config), config_schema,
        author: value.author, repository: value.repository, tools: normalizeTools(value.tools),
        description: value.description, version: value.version, trigger: boundedText(value.trigger ?? '', '触发前缀', 80),
        priority, timeout, scope: normalizedScope
      });
    }
    const entry = this.requireKind(kind);
    if (entry.groupOnly && (normalizedScope.all_private || normalizedScope.private_users.length)) throw problem('群聊增强只能配置群聊范围。');
    const template = entry.template() || {};
    const config = entry.config(value.config ?? {});
    if (!object(config) || Buffer.byteLength(JSON.stringify(config)) > 32768) throw problem('插件配置必须为 JSON 对象且不能超过 32 KiB。');
    const schema = entry.schema() ?? normalizeConfigSchema(value.config_schema ?? {});
    return this.definition({
      kind, name, source: template.source ?? ('// ' + entry.name + ' 插件执行层。\n'),
      config, config_schema: schema, tools: entry.tools(config),
      author: value.author, repository: value.repository,
      description: value.description || template.description, version: value.version ?? template.version,
      trigger: '', priority, timeout, scope: normalizedScope
    });
  }
  definition({ kind, name, source, config, config_schema, tools, author, repository, description, version, trigger, priority, timeout, scope }) {
    return {
      schema: 1, kind, name, source, config, config_schema,
      author: boundedText(author ?? '', '插件作者', 100),
      repository: boundedText(repository ?? '', '插件仓库', 300),
      tools: tools ?? [],
      description: boundedText(description ?? '', '插件说明', 500),
      version: boundedText(version ?? '1.0.0', '插件版本', 40, true),
      trigger, priority, timeout_ms: timeout, scope
    };
  }
  // ------------------------------------------------------------------- CRUD
  save(params) {
    return this.mutate(async () => {
      await this.ready();
      const definition = this.normalize(params.plugin), old = params.id ? this.get(params.id) : null;
      if (old && old.kind !== definition.kind) throw problem('不能更改已有插件的类型，请新建插件。');
      const entry = this.registryEntry(definition.kind);
      if (entry?.singleton && this.rows().some(row => row.kind === definition.kind && row.id !== old?.id)) throw problem(entry.name + ' 已安装，请编辑现有插件。', 409);
      if (old) this.checkRevision(old, params.revision);
      else if (this.rows().length >= MAX_PLUGINS) throw problem('最多安装 32 个插件，请先删除不再使用的插件。');
      await this.run(definition, null, 'validate');
      if (this.closed) throw problem('服务正在关闭。', 409);
      const id = old?.id || randomUUID();
      this.cancel(id, { preserveSchedules: definition.kind === 'free-activity' });
      this.store.db.prepare(`INSERT INTO plugins (id, definition, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET definition=excluded.definition, revision=plugins.revision+1,
        updated_at=excluded.updated_at, last_error=NULL`).run(id, JSON.stringify(definition), Date.now());
      this.log('info', 'plugin_saved', { plugin: id });
      await this.changed(definition.kind);
      return this.get(id);
    });
  }
  async install({ kind }) {
    await this.ready();
    const entry = this.requireKind(kind);
    if (entry.template) {
      const existing = this.find(kind);
      if (existing) return existing;
      return this.save({ plugin: structuredClone(entry.template()) });
    }
    if (!entry.singleton) throw problem('未知内置插件。');
    return this.find(kind) || this.save({ plugin: structuredClone(entry.template()) });
  }
  /** Look up the enabled plugin of a kind that applies to this event/job. */
  find(kind, event, job) {
    const entry = this.registry?.get(kind);
    const rows = this.rows().filter(row => row.kind === kind);
    if (!event) return rows[0] || null;
    return rows.find(row => entry?.visible ? entry.visible(row, { event, job, host: this }) : row.enabled && this.matches(row, event, true)) || null;
  }
  // ------------------------------------------------------- plugin packages
  /** Every package currently discovered on disk, including rejected ones. */
  packages() {
    return {
      dir: this.pluginDir,
      packages: this.registry ? [...this.registry.packages.values()].map(({ id, kind, name, version, description, capabilities, panel, singleton, dir }) => ({ id, kind, name, version, description, capabilities, panel, singleton, dir })) : [],
      rejected: this.registry ? this.registry.warnings : [],
      skipped: this.registry ? this.registry.skipped : []
    };
  }
  async resetRegistry({ kind } = {}) {
    if (kind && this.instances.has(kind)) {
      const previous = this.instances.get(kind);
      this.instances.delete(kind);
      try { await previous?.close?.(); } catch {}
    }
    this.registry = null; this.loading = null;
    await this.load();
    return this.registry;
  }
  async inspectPackage({ source }) {
    await this.ready();
    const { inspectPackage } = await import('./packages.mjs');
    return this.describePackage(await inspectPackage({ source, pluginDir: this.pluginDir }));
  }
  /** Validate a ZIP uploaded from the console without writing anything. */
  async inspectPackageBytes({ bytes, name }) {
    await this.ready();
    const { inspectPackage } = await import('./packages.mjs');
    return this.describePackage(await inspectPackage({ bytes, name, pluginDir: this.pluginDir }));
  }
  describePackage(result) {
    const installed = this.registry?.get(result.manifest.kind);
    return {
      source: result.source, zip: result.zip, files: result.files.length,
      manifest: result.manifest,
      installed: installed ? { id: installed.id, kind: installed.kind, version: installed.version } : null
    };
  }
  async installPackage({ source, overwrite = false }) {
    await this.ready();
    const { installPackage } = await import('./packages.mjs');
    return this.finishPackage(await installPackage({ source, pluginDir: this.pluginDir, overwrite: overwrite === true }));
  }
  /** One-click import: install a ZIP that arrived as a request body. */
  async installPackageBytes({ bytes, name, overwrite = false }) {
    await this.ready();
    const { installPackage } = await import('./packages.mjs');
    return this.finishPackage(await installPackage({ bytes, name, pluginDir: this.pluginDir, overwrite: overwrite === true }));
  }
  async finishPackage(result) {
    await this.resetRegistry({ kind: result.kind });
    const entry = this.registryEntry(result.kind);
    if (!entry) throw problem('插件包已复制，但接口校验失败，请检查 plugin.json 与入口文件。', 400);
    this.log('info', 'plugin_package_installed', { plugin: result.id, kind: result.kind });
    return { ...result, package: { id: entry.id, kind: entry.kind, name: entry.name, version: entry.version, capabilities: entry.capabilities } };
  }
  async removePackage({ id }) {
    await this.ready();
    const kind = this.registry?.get(id)?.kind || [...this.registry?.packages.values() || []].find(entry => entry.id === id)?.kind;
    const { removePackage } = await import('./packages.mjs');
    const result = await removePackage({ id, pluginDir: this.pluginDir });
    await this.resetRegistry({ kind });
    this.log('info', 'plugin_package_removed', { plugin: id });
    return result;
  }
  matches(plugin, event, tool = false) {
    const scope = plugin.scope, entry = this.registry?.get(plugin.kind);
    if (entry?.groupOnly && event.message_type !== 'group') return false;
    if (event.post_type !== 'message' || String(event.user_id) === String(event.self_id)) return false;
    if (event.message_type === 'private') {
      if (!scope.all_private && !scope.private_users.includes(String(event.user_id))) return false;
    } else if (event.message_type === 'group') {
      if (!scope.all_groups && !scope.groups.includes(String(event.group_id))) return false;
      if (!entry?.groupOnly && scope.require_at && !event.message?.some(s => s.type === 'at' && String(s.data?.qq) === String(event.self_id))) return false;
    } else return false;
    return tool || textOf(event).startsWith(plugin.trigger);
  }
  toggle({ id, revision, enabled }) {
    return this.mutate(async () => {
      const row = this.get(id); this.checkRevision(row, revision);
      if (typeof enabled !== 'boolean') throw problem('启用状态必须为布尔值。');
      const scope = row.scope;
      if (enabled && row.config?.web_enabled !== true && !scope.all_private && !scope.all_groups && !scope.private_users.length && !scope.groups.length) throw problem('请先设置允许触发的好友或群聊，再启用插件。');
      this.cancel(id);
      this.store.db.prepare('UPDATE plugins SET enabled=?,revision=revision+1,updated_at=? WHERE id=?').run(Number(enabled), Date.now(), id);
      this.log('info', enabled ? 'plugin_enabled' : 'plugin_disabled', { plugin: id });
      await this.changed(row.kind);
      return this.get(id);
    });
  }
  remove({ id, revision }) {
    return this.mutate(() => {
      const row = this.get(id); this.checkRevision(row, revision); this.cancel(id);
      this.store.db.prepare('DELETE FROM plugins WHERE id=?').run(id);
      this.registry?.get(row.kind)?.destroy?.(this.service(row.kind), id);
      this.log('info', 'plugin_deleted', { plugin: id }); return { removed: true };
    });
  }
  reload({ id, revision }) {
    return this.mutate(async () => {
      await this.ready();
      const row = this.get(id); this.checkRevision(row, revision);
      await this.run(this.normalize(row), null, 'validate');
      if (this.closed) throw problem('服务正在关闭。', 409);
      this.cancel(id, { preserveSchedules: row.kind === 'free-activity' });
      this.store.db.prepare('UPDATE plugins SET revision=revision+1,updated_at=?,last_error=NULL WHERE id=?').run(Date.now(), id);
      this.log('info', 'plugin_reloaded', { plugin: id }); return this.get(id);
    });
  }
  async test({ plugin, text = '/ping', message_type = 'private', user_id = '10001', group_id = '20001', at = true }) {
    await this.ready();
    const definition = this.normalize(plugin);
    boundedText(text, '测试消息', 8000, true);
    if (!['private', 'group'].includes(message_type)) throw problem('测试会话类型无效。');
    ids([user_id]); ids([group_id]);
    const event = { post_type: 'message', message_type, self_id: 10000, user_id: Number(user_id),
      ...(message_type === 'group' ? { group_id: Number(group_id) } : {}), message: [
        ...(message_type === 'group' && at ? [{ type: 'at', data: { qq: '10000' } }] : []),
        { type: 'text', data: { text } }], raw_message: text, time: Math.floor(Date.now() / 1000), message_id: 1 };
    const started = Date.now(), result = await this.run(definition, event, 'test');
    return { simulated: true, scope_matches: this.matches(definition, event), ...result, duration_ms: Date.now() - started };
  }
  toolName(plugin, tool) {
    if (this.registryEntry(plugin.kind)?.unprefixedTools) return tool.name;
    return 'plugin_' + plugin.id.replaceAll('-', '').slice(0, 24) + '_' + tool.name;
  }
  agentTools(event, signal) {
    return this.rows().filter(p => p.kind === 'script' && p.enabled && this.matches(p, event, true)).flatMap(p => (p.tools || []).map(tool => ({
      ...tool, name: this.toolName(p, tool), invoke: async args => {
        const current = this.rows().find(row => row.id === p.id);
        if (!current?.enabled || current.revision !== p.revision || !this.matches(current, event, true)) return { result: { ok: false, error: '插件已停用、更新或移出当前会话范围。' } };
        const result = await this.run(p, event, 'tool', { tool: tool.name, arguments: args }, signal);
        return { result };
      }
    })));
  }
  // -------------------------------------------------------------- execution
  async run(plugin, event, mode = 'message', extra = {}, signal) {
    if (this.closed) return Promise.reject(problem(pluginErrors.stopped, 409));
    if (signal?.aborted) return Promise.reject(problem(pluginErrors.stopped, 409));
    if (plugin.kind !== 'script') {
      // Built-in plugins validate their definition only; they never run the
      // script worker. Kinds without a message handler simply pass through.
      if (mode === 'validate') return null;
      const entry = this.requireKind(plugin.kind);
      if (!entry.run) return null;
      return entry.run(this.service(plugin.kind), plugin, event, { dryRun: mode === 'test', mode, extra, signal });
    }
    if (mode === 'validate') return this.execute(plugin, null, 'validate', {}, signal);
    return this.execute(plugin, event, mode, extra, signal);
  }
  execute(plugin, event, mode, extra, signal) {
    if (this.workers.size >= 8) return Promise.reject(problem('插件执行繁忙，请稍后再试。', 409));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./runner.mjs', import.meta.url), {
        workerData: { source: plugin.source, mode, tools: plugin.tools || [], context: event ? { event, text: textOf(event), config: plugin.config, simulated: mode === 'test', ...extra } : null },
        resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
        stdout: true, stderr: true
      });
      worker.stdout.resume(); worker.stderr.resume();
      let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); this.workers.delete(worker);
        // Wait for termination before releasing callers or the SQLite owner.
        worker.terminate().catch(() => {}).then(() => error ? reject(error) : resolve(result));
      };
      const failed = code => finish(Object.assign(problem(pluginErrors[code] || pluginErrors.runtime_error), { reason: code }));
      const aborted = () => failed('stopped');
      const timer = setTimeout(() => failed('timeout'), plugin.timeout_ms);
      this.workers.set(worker, { id: plugin.id, cancel: () => failed('stopped') });
      signal?.addEventListener('abort', aborted, { once: true });
      worker.once('message', value => value.error ? failed(value.error) : finish(null, value.result));
      worker.once('error', () => failed('runtime_error'));
      worker.once('exit', () => { if (!settled) failed('runtime_error'); });
    });
  }
  cancel(id, options) {
    for (const instance of this.instances.values()) instance?.cancel?.(id, options);
    for (const item of this.workers.values()) if (item.id === id) item.cancel();
  }
  // ---------------------------------------------------------------- events
  commandText(event) {
    const sample = chatText(event);
    const base = /^\/(?:tools|工具|new|context|ctx|上下文)$/.test(sample);
    if (base) return true;
    for (const entry of this.registry?.packages.values() || []) {
      if (!entry.commandPattern) continue;
      if (new RegExp(entry.commandPattern, 'u').test(sample)) return true;
    }
    return false;
  }
  enqueue(event, fallback) {
    if (this.closed || event.post_type !== 'message' || String(event.user_id) === String(event.self_id)) return null;
    if (isGroupUserBlocked(event, this.config)) return null;
    const receiptKey = String(event.self_id) + ':' + eventKey(event);
    // A claim survives a crash even when the plugin is subsequently disabled
    // or its scope changes. Never send the same claimed event through AI.
    if (this.store.db.prepare('SELECT 1 FROM plugin_receipts WHERE event_key=?').get(receiptKey)) return { inserted: false };
    const candidates = this.rows().filter(p => p.enabled && this.matches(p, event));
    const key = conversation(event);
    // Keep a conversation ordered even if a later message matches no plugin.
    const builtinCommand = this.commandText(event);
    if (!candidates.length && !this.tails.has(key) && !builtinCommand) return null;
    if (this.tasks.size >= MAX_QUEUE || Buffer.byteLength(JSON.stringify(event)) > 65536) {
      this.log('warn', 'plugin_queue_full'); return null;
    }
    if (this.store.db.prepare('SELECT 1 FROM jobs WHERE event_key=?').get(eventKey(event))) return { inserted: false };
    const claim = this.store.db.prepare('INSERT OR IGNORE INTO plugin_receipts VALUES (?,?)').run(receiptKey, Date.now());
    if (!claim.changes) return { inserted: false };
    const snapshot = structuredClone(event);
    const task = (this.tails.get(key) || Promise.resolve()).then(async () => {
      let handled = false;
      try { if (!this.closed) handled = await this.process(snapshot, candidates); }
      catch { this.log('error', 'plugin_processing_failed'); }
      if (!this.closed) fallback(handled);
    }).catch(() => this.log('error', 'event_persistence_failed')).finally(() => {
      this.tasks.delete(task); if (this.tails.get(key) === task) this.tails.delete(key);
    });
    this.tasks.add(task); this.tails.set(key, task);
    return { inserted: true };
  }
  async process(event, candidates) {
    if (isGroupUserBlocked(event, this.config)) return false;
    const freeActivity = this.service('free-activity');
    if (freeActivity?.allowed?.(event, { channel: 'qq', conversation: conversation(event) })) {
      try {
        const intent = freeActivity.intent(chatText(event));
        if (intent && intent.action !== 'now') {
          await this.commandReply(event, freeActivity.control(intent, event, { channel: 'qq', conversation: conversation(event) })); return true;
        }
      } catch (error) { await this.commandReply(event, error.message); return true; }
    }
    if (isChatCommand(event) && !isChatAdmin(event, this.config)) {
      // Consume denied commands before AI. Reply only inside an existing
      // plugin/AI scope; unrelated groups must not gain a new bot response.
      let inScope = candidates.length > 0;
      try { inScope ||= !!aiInput(event, this.config.ai); } catch {}
      if (inScope) await this.commandReply(event, '此指令仅聊天管理员可用。请在工作台“全部设置 → 回复范围”配置管理员 QQ ID。');
      return true;
    }
    if (/^\/(?:context|ctx|上下文)$/.test(chatText(event))) {
      await this.commandReply(event, await this.contextStatus.report(event)); return true;
    }
    if (chatText(event) === '/new') {
      const cleared = this.store.clearHistoryIfIdle(conversation(event));
      await this.commandReply(event, cleared ? '已开启新对话，当前会话上下文已清空。人格和已保存的记忆继续保留。' :
        '当前会话有排队、执行中或待核对的任务，请处理完成后再发送 /new。');
      return true;
    }
    const groupChatPlus = this.service('group-chat-plus');
    const plusCommand = groupChatPlus?.command?.(event);
    if (plusCommand !== null && plusCommand !== undefined) { await this.commandReply(event, plusCommand); return true; }
    if (/^\/(?:tools|工具)$/.test(chatText(event))) {
      await this.commandReply(event, this.toolsHelp(event).slice(0, 2000)); return true;
    }
    for (const original of candidates) {
      if (this.registryEntry(original.kind)?.groupOnly) continue;
      if (this.closed) break;
      const plugin = this.rows().find(p => p.id === original.id);
      if (!plugin?.enabled || !this.matches(plugin, event)) continue;
      let result;
      try {
        result = await this.run(plugin, event);
        const current = this.rows().find(p => p.id === plugin.id);
        if (!current?.enabled || current.revision !== plugin.revision || this.closed) continue;
        if (isChatCommand(event) && !isChatAdmin(event, this.config)) return true;
        this.record(plugin.id, null);
      } catch (error) {
        if (!this.closed) { this.record(plugin.id, error.reason || 'runtime_error'); this.log('warn', 'plugin_execution_failed', { plugin: plugin.id, reason: error.reason || 'runtime_error' }); }
        continue;
      }
      if (!result) continue;
      if (result.reply || result.message) {
        try {
          const message = [...(result.reply ? [{ type: 'text', data: { text: result.reply } }] : []), ...(result.message || [])];
          await this.adapter.action(event.message_type === 'group' ? 'send_group_msg' : 'send_private_msg', {
            message: plugin.kind === 'meme-manager' && message.length && message.every(s => s.type === 'image') ? message : replyMessage(event, message, replyOptions(this.config)),
            ...(event.message_type === 'group' ? { group_id: event.group_id } : { user_id: event.user_id })
          }, { signal: this.controller.signal });
          this.log('info', 'plugin_reply_sent', { plugin: plugin.id });
        } catch (error) {
          const reason = error.uncertain || !error.code ? 'delivery_unknown' : 'send_failed';
          if (!this.closed) {
            this.store.db.prepare('UPDATE plugins SET failures=failures+1,last_error=? WHERE id=?').run(reason, plugin.id);
            this.log('warn', 'plugin_reply_failed', { plugin: plugin.id, reason });
          }
        }
      }
      if (result.handled) return true;
    }
    const groupPlugin = this.find('group-chat-plus', event);
    if (groupPlugin && groupChatPlus) {
      try { const handled = await groupChatPlus.handle(event); if (handled) this.record(groupPlugin.id, null); return handled; }
      catch { this.record(groupPlugin.id, 'runtime_error'); this.log('warn', 'group_chat_processing_failed'); return true; }
    }
    return false;
  }
  toolsHelp(event) {
    const available = this.rows().filter(p => p.enabled && this.matches(p, event));
    const lines = ['聊天指令（仅管理员）：', '/tools 或 /工具：查看本说明', '/context 或 /上下文（/ctx）：查看历史窗口和剩余 token 参考', '/new：清空当前会话上下文，开启新对话（保留人格和已保存的记忆）'];
    for (const plugin of available) {
      const entry = this.registryEntry(plugin.kind);
      for (const hint of entry?.toolHints || []) lines.push(hint);
    }
    const scripts = available.filter(p => p.kind === 'script');
    if (scripts.length) lines.push('自定义插件：' + scripts.map(p => p.name).join('、'));
    return lines.join('\n');
  }
  controller = new AbortController();
  async commandReply(event, text) {
    if (this.closed) return;
    try {
      await this.adapter.action(event.message_type === 'group' ? 'send_group_msg' : 'send_private_msg', {
        message: replyMessage(event, [{ type: 'text', data: { text } }], replyOptions(this.config)), ...(event.message_type === 'group' ? { group_id: event.group_id } : { user_id: event.user_id })
      }, { signal: this.controller.signal });
    } catch { if (!this.closed) this.log('warn', 'chat_command_reply_failed'); }
  }
  record(id, error) {
    this.store.db.prepare('UPDATE plugins SET runs=runs+1,failures=failures+?,last_run=?,last_error=? WHERE id=?').run(Number(!!error), Date.now(), error, id);
  }
  async close() {
    this.closed = true; this.controller.abort();
    for (const item of this.workers.values()) item.cancel();
    await Promise.allSettled([...this.tasks, this.mutations]);
  }
}
