import { opendir, realpath, stat, lstat, open, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parameters, validateArguments } from '../agent/schema.mjs';
import { isChatAdmin } from '../messages.mjs';
import { problem } from '../agent/state.mjs';
import { windowsDesktop } from './windows.mjs';
import { powershell, runProcess } from './process.mjs';

const str = maxLength => ({ type: 'string', minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const schema = (properties, required = Object.keys(properties)) => ({ ...parameters(properties), required });
const inside = (root, target) => { const r = relative(root, target); return !r || !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
const hash = data => createHash('sha256').update(data).digest('hex');
const operation = str(64);
const keys = /^(?:(?:CTRL|ALT|SHIFT|WIN)\+){0,3}(?:[A-Z0-9]|F[1-9]|F1[0-2]|ENTER|TAB|ESC|BACKSPACE|DELETE|SPACE|UP|DOWN|LEFT|RIGHT|HOME|END|PAGEUP|PAGEDOWN)$/i;
function bounded(data) {
  while(Buffer.byteLength(JSON.stringify(data))>28000){
    if(data.controls?.length)data.controls.pop();else if(data.windows?.length)data.windows.pop();
    else if(data.stdout?.length||data.stderr?.length){data.stdout=data.stdout.slice(0,Math.floor(data.stdout.length/2));data.stderr=data.stderr.slice(0,Math.floor(data.stderr.length/2));}
    else throw problem('本机结果超过大小限制。');
    data.truncated=true;
  }
  return data;
}

export class ComputerService {
  constructor(config, store, { desktop = windowsDesktop, run = runProcess } = {}) {
    this.config = config; this.store = store; this.desktop = desktop; this.run = run;
    this.controller = new AbortController(); this.owner = null; this.observations = new Map();
    store.db.exec('CREATE TABLE IF NOT EXISTS computer_control (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL); INSERT OR IGNORE INTO computer_control VALUES (1,0)');
    this.paused = !!store.db.prepare('SELECT paused FROM computer_control WHERE id=1').get().paused;
    if (this.paused) this.controller.abort(Object.assign(Error('本机 Agent 已紧急停止。'),{computerReason:'computer_stopped'}));
  }
  allowed(event, job) {
    return this.config.computer?.enabled === true && (job.channel === 'web' ||
      this.config.computer.qq && event.message_type === 'private' && isChatAdmin(event, this.config));
  }
  status() {
    const c = this.config.computer || {};
    return { enabled: c.enabled === true, paused: this.paused, platform: process.platform,
      desktop: c.enabled === true && c.desktop === true && process.platform === 'win32',
      shell: c.enabled === true && c.shell === true && process.platform === 'win32',
      qq_admin: c.qq === true, roots: c.roots || [], busy_job: this.owner,command_timeout_ms:c.commandTimeout||15000 };
  }
  control({ action } = {}) {
    if (!['stop', 'resume'].includes(action)) throw problem('请选择停止或恢复本机 Agent。');
    this.paused = action === 'stop';
    this.store.db.prepare('UPDATE computer_control SET paused=? WHERE id=1').run(Number(this.paused));
    if (this.paused) { this.controller.abort(Object.assign(Error('本机 Agent 已紧急停止。请核对已发生的操作。'),{computerReason:'computer_stopped'})); this.observations.clear(); }
    else if (this.controller.signal.aborted) this.controller = new AbortController();
    return this.status();
  }
  assertAvailable(event, job) {
    if (!this.allowed(event, job)) throw problem('当前会话无本机访问权限。', 403);
    if (this.paused) throw problem('本机 Agent 已停止，请在管理台恢复后发起新任务。', 409);
  }
  acquire(event, job) {
    this.assertAvailable(event, job);
    if (this.owner !== null && this.owner !== job.id) throw problem('另一个任务正在使用本机，请稍后发起新任务。', 409);
    this.owner = job.id;
  }
  release(job) { if (this.owner === job.id) this.owner = null; this.observations.delete(job.id); }
  async path(value, { creating = false } = {}) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 2048 ||
        value.split(/[\\/]/).some(part => !['.', '..'].includes(part) && /[. ]$/.test(part)) || /:(?![\\/])/.test(value) || /(?:^|[\\/])(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) throw problem('文件路径无效；不支持设备路径、备用数据流或尾随空格。');
    if (/^(?:\\\\|\/\/)/.test(value)) throw problem('文件工具不支持网络或设备路径。');
    const roots = this.config.computer.roots;
    const target = resolve(roots[0], value);
    const candidates = roots.filter(root => inside(root, target));
    for (const root of candidates) {
      const actualRoot = await realpath(root);
      let actual;
      try { actual = await realpath(target); }
      catch (error) { if (!creating || error.code !== 'ENOENT') throw error; actual = join(await realpath(dirname(target)), relative(dirname(target), target)); }
      if (!inside(actualRoot, actual)) continue;
      // Reject junctions/symlinks below a root, including existing write targets.
      const parts = relative(root, target).split(sep).filter(Boolean); let cursor = root;
      for (let i = 0; i < parts.length; i++) {
        cursor = join(cursor, parts[i]);
        try { if ((await lstat(cursor)).isSymbolicLink()) throw problem('文件工具不跟随符号链接或目录联接。', 403); }
        catch (error) { if (!creating || i !== parts.length - 1 || error.code !== 'ENOENT') throw error; }
      }
      return actual;
    }
    throw problem('路径超出允许的文件目录，请在“本机与桌面”配置范围。', 403);
  }
  async list({ path = '.' }) {
    const target = await this.path(path), directory = await opendir(target), entries = [];
    let truncated = false;
    for await (const entry of directory) {
      if (entries.length >= 100) { truncated = true; break; }
      entries.push({ name: entry.name, type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file' });
    }
    return { ok: true, path: target, entries, truncated };
  }
  async read({ path }) {
    const target = await this.path(path), file = await open(target, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 24000) throw problem('仅支持读取不超过 24 KB 的 UTF-8 文本文件。');
      const bytes = Buffer.alloc(24001), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 24000) throw problem('文件超过 24 KB。');
      const data = bytes.subarray(0, bytesRead), text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      if (text.includes('\0')) throw problem('文件不是普通文本。');
      return { ok: true, path: target, text, sha256: hash(data) };
    } finally { await file.close(); }
  }
  async write({ path, text, expected_sha256 }, signal) {
    const target = await this.path(path, { creating: true }); signal?.throwIfAborted();
    if (!expected_sha256) {
      let file;
      try { file = await open(target, 'wx'); } catch(error) { if(error.code==='EEXIST')throw problem('文件已存在，请先读取，再提供 expected_sha256 修改。',409); throw error; }
      try { await file.writeFile(text, 'utf8'); } finally { await file.close(); }
    } else {
      // Optimistic concurrency: never overwrite a file the model has not read.
      const current = await this.read({ path });
      if (current.sha256 !== expected_sha256) throw problem('文件已变化，请重新读取后再修改。', 409);
      const temporary = join(dirname(target), '.limen-' + randomUUID() + '.tmp');
      const file = await open(temporary, 'wx');
      try {
        await file.writeFile(text, 'utf8'); await file.close(); signal?.throwIfAborted();
        if ((await this.read({ path })).sha256 !== expected_sha256) throw problem('文件已变化，请重新读取。', 409);
        await this.path(path); await rename(temporary, target);
      } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
    }
    return { ok: true, path: target, bytes: Buffer.byteLength(text), sha256: hash(text) };
  }
  async observe(kind, job, signal) {
    const data = await this.desktop(kind, {}, signal);
    const image = data.image; delete data.image;
    bounded(data);
    if (image && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image) || image.length > 1800000)) throw problem('桌面截图过大或格式无效。');
    const id = randomUUID(); this.observations.set(job.id, { id, time: Date.now(), foreground: data.foreground?.handle, screen: data.screen });
    return { result: { ...data, observation_id: id, coordinate_note: '动作使用原始屏幕坐标；截图像素坐标按 screen.width/image_width、screen.height/image_height 缩放后加 screen.x/y。每次动作后重新观察。' }, ...(image ? { images: [image] } : {}) };
  }
  async act(args, job, signal) {
    const observation = this.observations.get(job.id);
    if (!observation || observation.id !== args.observation_id || Date.now() - observation.time > 30000) return { ok: false, error: '请先重新截图或读取控件，使用最新 observation_id。' };
    const point = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= observation.screen.x && y >= observation.screen.y && x < observation.screen.x + observation.screen.width && y < observation.screen.y + observation.screen.height;
    if (['click', 'double_click', 'right_click', 'move', 'drag', 'scroll'].includes(args.action) && !point(args.x, args.y) || args.action === 'drag' && !point(args.to_x, args.to_y)) return { ok: false, error: '请提供已观察屏幕范围内的坐标。滚动也需指定 x/y。' };
    if (args.action === 'type' && typeof args.text !== 'string' || args.action === 'key' && !keys.test(args.key || '') || args.action === 'focus' && !/^\d{1,20}$/.test(args.window || '') || args.action === 'scroll' && !Number.isInteger(args.amount) || args.action === 'wait' && !Number.isInteger(args.milliseconds)) return { ok: false, error: '缺少动作参数或按键不受支持。' };
    this.observations.delete(job.id);
    return this.desktop('action', { arguments: args, expected_window: observation.foreground }, signal);
  }
  async preview() {
    if (!this.status().desktop || this.paused) throw problem('请先启用桌面控制并恢复本机 Agent。', 409);
    return this.desktop('screenshot', {}, this.controller.signal);
  }
  tools(event, job) {
    if (!this.allowed(event, job)) return [];
    const tools = [];
    const add = (name, description, parameters, effect, fn) => tools.push({ name, description, parameters, effect, transientImages: name === 'desktop_screenshot', ...(effect === 'write' ? { repeatable: true } : {}),
      invoke: async (args, signal) => {
        try {
          this.acquire(event, job); validateArguments(parameters, args);
          const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
          combined.throwIfAborted();
          return await fn(args, combined);
        }
        catch(error) { if(error.status) return {result:{ok:false,error:error.message}}; if(error.code==='ENOENT')return {result:{ok:false,error:'路径不存在，请检查允许目录与父目录是否已创建。'}}; throw error; }
      } });
    add('computer_list_files', '列出允许目录内的文件（最多 100 项）。相对路径基于第一个允许目录。', schema({ path: str(2048) }, []), 'read', async args => ({ result: await this.list(args) }));
    add('computer_read_file', '读取允许目录内最多 24 KB 的 UTF-8 文本，返回 sha256 供后续修改。', schema({ path: str(2048) }), 'read', async args => ({ result: await this.read(args) }));
    add('computer_write_file', '创建或修改 UTF-8 文件；修改必须提供读取时的 expected_sha256。每次新操作使用新的 operation_id，重试同一操作沿用原 ID。', schema({ operation_id: operation, path: str(2048), text: { type: 'string', maxLength: 6000 }, expected_sha256: str(64) }, ['operation_id', 'path', 'text']), 'write', async (args, signal) => ({ result: await this.write(args, signal) }));
    add('computer_make_directory', '在允许目录内新建一层目录；父目录必须存在。每次新操作使用新的 operation_id。', schema({ operation_id: operation, path: str(2048) }), 'write', async ({path}, signal) => {
      const target = await this.path(path,{creating:true}); signal.throwIfAborted();
      try { await mkdir(target); } catch(error) { if(error.code!=='EEXIST'||!(await stat(target)).isDirectory()) throw error; }
      return {result:{ok:true,path:target}};
    });
    if (this.status().desktop) {
      add('desktop_windows', '列出可见窗口及句柄、原始屏幕坐标。', parameters({}), 'read', async (_, signal) => ({ result: bounded(await this.desktop('windows', {}, signal)) }));
      add('desktop_screenshot', '观察当前桌面：返回截图给视觉模型、前台窗口、屏幕坐标和 observation_id；每次动作后需重新观察。', parameters({}), 'read', (_, signal) => this.observe('screenshot', job, signal));
      add('desktop_inspect', '读取前台窗口的可访问控件名称和坐标（不读取密码框），获取新的 observation_id；适用于无视觉能力的模型。', parameters({}), 'read', (_, signal) => this.observe('inspect', job, signal));
      add('desktop_action', '根据最近 30 秒内的观察操作桌面。每次新动作使用新的 operation_id；同一操作重试沿用 ID。focus 需要 window；点击/拖动使用原始屏幕坐标；type 输入文字；key 如 CTRL+S、ALT+TAB；scroll 正数向上。动作完成后重新观察核对。', schema({ operation_id: operation, observation_id: str(36), action: { type: 'string', enum: ['focus', 'click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key', 'wait'] }, window: str(20), x: integer(-100000, 100000), y: integer(-100000, 100000), to_x: integer(-100000, 100000), to_y: integer(-100000, 100000), text: str(2000), key: str(50), amount: integer(-10, 10), milliseconds: integer(100, 3000) }, ['operation_id', 'observation_id', 'action']), 'write', async (args, signal) => ({ result: await this.act(args, job, signal) }));
    }
    if (this.status().shell) add('computer_run_command', '以本机用户身份执行 PowerShell 命令。命令不受文件目录限制，cwd 必须是允许目录。检索先限定相关子目录，避免递归扫描整个磁盘或安装目录。命令受配置的超时和输出限制；超时/停止后先核对，不能自动重复。', schema({ operation_id: operation, command: str(4000), cwd: str(2048) }, ['operation_id', 'command']), 'write', async ({ command, cwd = '.' }, signal) => {
      const directory = await this.path(cwd);
      if (!(await stat(directory)).isDirectory()) throw problem('命令工作目录必须是目录。');
      const script = "$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\n$OutputEncoding=[Console]::OutputEncoding\n" + command;
      let data;
      try{data = await this.run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: directory, signal, timeout: this.config.computer.commandTimeout, maxBytes: 20000 });}
      catch(error){
        if(!['timeout','output_limit'].includes(error.processReason))throw error;
        return {result:bounded({ok:false,uncertain:true,reason:error.processReason==='timeout'?'command_timeout':'command_output_limit',
          error:error.processReason==='timeout'?'PowerShell 命令超过执行时限，进程已终止；已发生的操作需要核对，未自动重跑。':'PowerShell 命令输出超过限制，进程已终止；已发生的操作需要核对，未自动重跑。',
          timeout_ms:this.config.computer.commandTimeout,elapsed_ms:error.elapsed_ms,exit_code:error.exit_code,stdout:error.stdout||'',stderr:error.stderr||''})};
      }
      return { result: bounded({ ok: data.code === 0, exit_code: data.code, stdout: data.stdout, stderr: data.stderr }) };
    });
    return tools;
  }
}
