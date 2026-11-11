/* Limen · 控制台
   视觉与信息架构沿用 limen-console 演示；数据全部来自正在运行的本机服务。
   没有演示夹具：读不到就显示读取失败，读到空就显示空状态。 */
(() => {
  'use strict';

  const API = window.LIMEN;
  const S = API.store;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
  const dotBadge = (text, kind = 'ok') => `<span class="badge badge-${kind}"><span class="dot"></span>${esc(text)}</span>`;
  // 官方内核版本只在用户点过「检查内核更新」之后才有值：启动时不联网查。
  const kernelUpdateNote = (info) => {
    if (info && info.error) return `<span style="color:var(--muted)">检查失败：${esc(info.error)}</span>`;
    if (!info || !info.prepared) return `<span style="color:var(--muted)">还没有准备运行时</span>`;
    return info.update_available
      ? dotBadge('有新版 ' + info.latest, 'warn')
      : dotBadge('已是最新', 'ok');
  };

  /* ------------------------------------------------------------- 格式化 */

  const toDate = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') {
      const ms = value < 1e12 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (value) => {
    const d = toDate(value);
    return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '—';
  };
  const stamp = (value) => {
    const d = toDate(value);
    return d ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
  };
  const rel = (value) => {
    const d = toDate(value);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    if (diff < 0) return '刚刚';
    if (diff < 60000) return Math.max(1, Math.round(diff / 1000)) + ' 秒前';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    if (diff < 7 * 86400000) return Math.round(diff / 86400000) + ' 天前';
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const mask = (value, keep = 3) => {
    const text = String(value ?? '').trim();
    if (!text || text === '0' || text === 'undefined' || text === 'null') return '—';
    if (text.length <= keep * 2) return text;
    return text.slice(0, keep) + '***' + text.slice(-keep);
  };
  const size = (bytes) => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KiB';
    return (n / 1024 / 1024).toFixed(1) + ' MiB';
  };
  const count = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('zh-CN') : '0';
  const pct = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) + '%' : '—';
  };
  const pretty = (value) => {
    try { return JSON.stringify(value, null, 2); }
    catch { return String(value); }
  };
  const safeUrl = (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : '');
  const clip = (text, max = 12000) => {
    const value = String(text ?? '');
    return value.length > max ? value.slice(0, max) + '\n…（已截断 ' + (value.length - max) + ' 字符）' : value;
  };

  const textOf = (message) => {
    if (typeof message === 'string') return message;
    if (!Array.isArray(message)) return message && message.text ? String(message.text) : '';
    return message.map((seg) => {
      if (typeof seg === 'string') return seg;
      if (!seg || typeof seg !== 'object') return '';
      if (seg.type === 'text') return (seg.data && seg.data.text) || '';
      if (seg.type === 'image') return '[图片]';
      if (seg.type === 'record') return '[语音]';
      if (seg.type === 'video') return '[视频]';
      if (seg.type === 'file') return '[文件]';
      return '[' + (seg.type || '消息') + ']';
    }).join('');
  };

  const conversationLabel = (value) => {
    const text = String(value || '');
    if (!text) return '—';
    if (text.startsWith('web:')) return '网页试聊 · ' + text.slice(4, 10);
    const parts = text.split(':');
    if (parts.length >= 3) {
      const type = parts[1], peer = parts[2];
      if (type === 'group') return '群聊 · ' + mask(peer);
      if (type === 'private') return '私聊 · ' + mask(peer);
    }
    return text;
  };

  const STATE_LABEL = {
    online: '在线', idle: '未连接', waiting_scan: '等待扫码', waiting_confirm: '等待确认',
    requesting_qr: '正在获取二维码', qr_failed: '二维码获取失败', reconnecting: '正在重连',
    connecting: '正在连接', offline: '离线'
  };
  const JOB_STATUS = {
    queued: ['待处理', 'badge'],
    generating: ['生成中', 'badge-primary'],
    ready: ['待发送', 'badge'],
    sending: ['发送中', 'badge-primary'],
    done: ['已完成', 'badge-ok'],
    uncertain: ['需要核对', 'badge-warn'],
    failed: ['失败', 'badge-bad'],
    ignored: ['已忽略', 'badge']
  };
  const QZONE_STATUS = {
    generating: ['生成中', 'badge-primary'],
    draft: ['草稿', 'badge'],
    failed: ['生成失败', 'badge-bad'],
    publishing: ['发布中', 'badge-primary'],
    published: ['已发布', 'badge-ok'],
    uncertain: ['需要核对', 'badge-warn'],
    discarded: ['已放弃', 'badge']
  };
  const VISIBILITY = { public: '所有人', friends: '好友', private: '仅自己' };

  const jobStatus = (status) => JOB_STATUS[status] || [status || '未知', 'badge'];
  const qzoneStatus = (status) => QZONE_STATUS[status] || [status || '未知', 'badge'];

  const stateOnline = () => !!(S.state && S.state.online);
  const jobsList = () => (Array.isArray(S.jobs) ? S.jobs : (S.jobs && Array.isArray(S.jobs.jobs) ? S.jobs.jobs : []));
  const pluginsList = () => (S.plugins && Array.isArray(S.plugins.plugins) ? S.plugins.plugins : []);
  const settingsValues = () => (S.settings && S.settings.values) || {};
  const currentValues = () => form || settingsValues();
  const logsOf = () => (S.telemetry.entries || []).filter((e) => e.kind === 'log');
  const messagesOf = () => (S.telemetry.entries || []).filter((e) => e.kind === 'message');
  const qzonePosts = () => (Array.isArray(S.qzonePosts) ? S.qzonePosts : (S.qzonePosts && Array.isArray(S.qzonePosts.posts) ? S.qzonePosts.posts : []));
  const pluginOf = (kind) => pluginsList().find((p) => p.kind === kind) || null;
  /** 路由键：内置插件用 kind；脚本插件可能有多条，必须用 id。 */
  const pluginKey = (plugin) => (plugin && plugin.kind === 'script' ? plugin.id : plugin && plugin.kind) || '';
  const pluginByKey = (key) => pluginsList().find((p) => p.kind === key) || pluginsList().find((p) => p.id === key) || null;
  /** 是否处理聊天消息：脚本插件总是处理；包插件看声明的能力。启动动画、背景壁纸等纯界面插件不显示作用范围。 */
  const handlesMessages = (plugin) => {
    if (!plugin) return true;
    if (plugin.kind === 'script') return true;
    const pkg = ((S.plugins && S.plugins.packages) || []).find((item) => item.kind === plugin.kind);
    return pkg ? (pkg.capabilities || []).includes('message') : true;
  };

  const logDetail = (entry) => {
    const fields = entry && entry.fields;
    if (!fields || typeof fields !== 'object') return '—';
    const text = Object.entries(fields).map(([key, value]) => key + '=' + (value && typeof value === 'object' ? JSON.stringify(value) : String(value))).join(' ');
    return text || '—';
  };

  /* ------------------------------------------------------------- 组件 */

  const btn = (label, { kind = '', iconName = '', act = '', go = '', attrs = '', small = false, disabled = false } = {}) =>
    `<button type="button" class="btn ${kind} ${small ? 'btn-sm' : ''}" ${act ? `data-act="${act}"` : ''} ${go ? `data-go="${go}"` : ''} ${attrs} ${disabled ? 'disabled' : ''}>${iconName ? icon(iconName) : ''}${esc(label)}</button>`;
  const linkBtn = (label, go, { iconName = '', small = false } = {}) =>
    `<a class="btn ${small ? 'btn-sm' : ''}" href="#/${go}">${iconName ? icon(iconName) : ''}${esc(label)}</a>`;

  /* 辅助说明文字总开关。开着，但每条都压到一句话以内；
     排障信息（错误、告警）、空状态引导、危险操作与取值规则不属于“说明”，不受开关影响。 */
  const HINTS = true;

  function pageHead({ title, desc = '', actions = '', meta = [] }) {
    return `<header class="page-head">
      <div class="lead">
        <h1>${title}</h1>
        ${HINTS && desc ? `<p class="desc">${desc}</p>` : ''}
        ${meta.length ? `<div class="head-meta">${meta.filter(Boolean).map((m, i) => `${i ? '<span class="sep"></span>' : ''}<span>${m}</span>`).join('')}</div>` : ''}
      </div>
      ${actions ? `<div class="head-actions">${actions}</div>` : ''}
    </header>`;
  }

  function card(title, { desc = '', actions = '', body = '', foot = '', tight = false } = {}) {
    return `<section class="card">
      ${title ? `<div class="card-head"><div><h2>${title}</h2>${HINTS && desc ? `<p class="desc">${desc}</p>` : ''}</div>${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>` : ''}
      <div class="card-body ${tight ? 'tight' : ''}">${body}</div>
      ${foot ? `<div class="card-foot">${foot}</div>` : ''}
    </section>`;
  }

  /** 主面板：一个页面只保留一层边框，内部分区靠分隔线与分区条切分。 */
  function panel(blocks) {
    return `<section class="panel">${blocks.filter(Boolean).map((block) => {
      const desc = HINTS ? block.desc : '';
      const hasHead = !!(block.title || desc || block.actions);
      const head = hasHead
        ? `<header class="sec-head">${block.title ? `<h2>${block.title}</h2>` : ''}${desc ? `<p class="sec-desc">${desc}</p>` : ''}${block.actions ? `<div class="btn-row">${block.actions}</div>` : ''}</header>`
        : '';
      return `<section class="panel-section ${block.tight ? 'is-tight' : ''}">${head}<div class="sec-body">${block.body || ''}</div>${block.foot ? `<div class="sec-foot">${block.foot}</div>` : ''}</section>`;
    }).join('')}</section>`;
  }

  const skeleton = (rows = 4) => `<div aria-busy="true" aria-label="正在加载">${Array.from({ length: rows }, (_, i) => `<div class="sk-row"><span class="sk"></span><span class="sk" style="opacity:${1 - i * 0.1}"></span><span class="sk"></span></div>`).join('')}</div>`;
  const formSkeleton = () => `<div class="stack">${Array.from({ length: 3 }, () => `<div class="card"><div class="card-head"><div class="sk" style="width:132px;height:13px"></div></div><div class="card-body"><div class="fields">${Array.from({ length: 4 }, () => `<div class="field"><div class="sk" style="width:34%;height:9px;margin-bottom:8px"></div><div class="sk" style="height:34px"></div></div>`).join('')}</div></div></div>`).join('')}</div>`;

  function emptyState({ iconName = 'inbox', title, body = '', action = '' }) {
    return `<div class="state"><span class="glyph">${icon(iconName)}</span><h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}${action}</div>`;
  }
  function errorState({ title = '读取失败', body = '', code = '' }) {
    return `<div class="state state-error" role="alert">
      <span class="glyph">${icon('alert')}</span>
      ${code ? `<span class="code">${esc(code)}</span>` : ''}
      <h3>${esc(title)}</h3>
      <p>${esc(body || '服务没有返回数据。')}</p>
      <div class="btn-row">${btn('重试', { act: 'retry', iconName: 'refresh', small: true })}${btn('查看日志', { go: 'data/logs', small: true, kind: 'btn-ghost' })}</div>
    </div>`;
  }

  const region = (key, body, opt = {}) => {
    if (S.errors[key]) return errorState({ title: opt.title || '读取失败', body: S.errors[key], code: key });
    if (!S.loaded) return opt.skeleton || skeleton(opt.rows || 4);
    if (S[key] === null || S[key] === undefined) return errorState({ title: opt.title || '没有读到数据', body: '接口已连接，但没有返回这一部分。可以重试或查看运行日志。', code: key });
    return body;
  };

  function table(head, rows, { emptyHtml = '', rowAttr = () => '' } = {}) {
    if (!rows.length) return emptyHtml || '';
    return `<div class="table-wrap"><table class="table">
      <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => {
        const attrs = row.attr || rowAttr(row) || '';
        return `<tr ${attrs}>${row.cells.map((cell, i) => `<td data-label="${esc(head[i] || '')}">${cell}</td>`).join('')}</tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  const kv = (pairs, cls = '') => `<dl class="kv ${cls}">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const extraOf = (route) => {
    const entry = S.extra[route];
    return { loading: !entry || !!entry.loading, error: entry && entry.error, value: entry && entry.value };
  };

  /* ------------------------------------------------------------- 路由 */

  const CONFIG_ORDER = ['ai', 'agent', 'computer', 'access', 'qq', 'connection', 'queue', 'storage', 'advanced', 'market'];
  const NAV = [
    { group: '配置', items: [
      { path: 'config/ai', label: '配置文件', icon: 'sliders' },
      { path: 'providers', label: '服务提供商', icon: 'server' },
      { path: 'platforms', label: '平台与机器人', icon: 'plug' }
    ] },
    { group: '扩展', items: [
      { path: 'plugins', label: '插件与扩展', icon: 'grid' },
      { path: 'market', label: '插件市场', icon: 'download' }
    ] },
    { group: '运行', items: [
      { path: 'dashboard', label: '工作台', icon: 'layers' },
      { path: 'chat', label: '对话测试', icon: 'chat' },
      { path: 'data/messages', label: '数据与日志', icon: 'inbox' }
    ] },
    { group: '内容', items: [
      { path: 'qzone', label: 'QQ 空间', icon: 'send' }
    ] },
    { group: '系统', items: [
      { path: 'settings', label: '系统设置', icon: 'settings' }
    ] }
  ];
  const META = {
    'config/ai': ['配置', '配置文件'],
    providers: ['配置', '服务提供商'],
    platforms: ['配置', '平台与机器人'],
    plugins: ['扩展', '插件与扩展'],
    market: ['扩展', '插件市场'],
    dashboard: ['运行', '工作台'],
    chat: ['运行', '对话测试'],
    'data/messages': ['运行', '数据与日志'],
    'data/jobs': ['运行', '数据与日志'],
    'data/logs': ['运行', '数据与日志'],
    qzone: ['内容', 'QQ 空间'],
    settings: ['系统', '系统设置']
  };

  const knownConfig = (id) => {
    const groups = S.settings && S.settings.groups;
    return Array.isArray(groups) && groups.length ? groups.some((g) => g.id === id) : CONFIG_ORDER.includes(id);
  };
  const parsePath = () => {
    let raw = location.hash.replace(/^#\/?/, '').trim();
    const legacy = { messages: 'data/messages', jobs: 'data/jobs', logs: 'data/logs' };
    if (legacy[raw]) raw = legacy[raw];
    if (!raw || raw === 'config') return 'config/ai';
    if (raw.startsWith('config/')) {
      const id = raw.split('/')[1];
      return knownConfig(id) ? 'config/' + id : 'config/ai';
    }
    if (raw === 'data') return 'data/messages';
    if (raw.startsWith('data/')) {
      const tab = raw.split('/')[1];
      return ['messages', 'jobs', 'logs'].includes(tab) ? raw : 'data/messages';
    }
    if (raw.startsWith('plugins/')) {
      const [, kind, tab] = raw.split('/');
      const found = pluginsList().some((p) => p.kind === kind || p.id === kind);
      if (!found && S.loaded) return 'plugins';
      return tab && ['overview', 'config', 'events'].includes(tab) ? 'plugins/' + kind + '/' + tab : 'plugins/' + kind;
    }
    return META[raw] ? raw : 'config/ai';
  };

  let path = parsePath();
  let theme = localStorage.getItem('limen-console-theme') || 'light';
  let form = null, formRevision = null;
  let secretTouched = new Set(), dirtyKeys = new Set();
  let lastSave = null;
  let chatSession = localStorage.getItem('limen-chat-session') || '';
  let chatHistory = null, chatClose = null, chatPoll = null, chatBusy = false;
  let qr = null, qrPoll = null, qrClock = null;
  let probe = { base: '', key: '', busy: false, models: null, error: null, ms: 0 };
  let qzonePoll = null, qzoneSignature = '';
  let paletteState = { q: '', index: 0, items: [] };
  let toastTimer = null;
  let jsonDraft = null;

  if (!/^[a-f0-9-]{36}$/.test(chatSession)) chatSession = '';

  const ui = {
    messages: { q: '', kind: 'all', dir: 'all' },
    jobs: { q: '', status: 'all' },
    logs: { q: '', level: 'all' },
    plugins: { q: '', status: 'all' },
    market: { q: '', state: 'all' }
  };

  const cfgId = () => (path.startsWith('config/') ? path.split('/')[1] : CONFIG_ORDER[0]);

  /* ------------------------------------------------------------- 配置分区 */

  const CONFIG_CARDS = {
    ai: [
      ['模型服务', '地址、密钥与模型名。', ['AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY', 'AI_TIMEOUT_MS', 'AI_MAX_OUTPUT_TOKENS', 'AI_REASONING_EFFORT']],
      ['开关与回复样式', '回复开关与群聊呈现。', ['AI_ENABLED', 'AI_STRIP_EMOJI', 'REPLY_AT_SENDER', 'REPLY_QUOTE_MESSAGE']],
      ['流式与分段', '边生成边显示、按句分段。', ['AI_STREAM_ENABLED', 'AI_SEGMENTED_REPLY_ENABLED', 'AI_STREAM_CHUNK_CHARS']],
      ['上下文与群聊背景', '历史轮数与群聊参考范围。', ['AI_CONTEXT_TURNS', 'AI_GROUP_CONTEXT_ENABLED', 'AI_GROUP_CONTEXT_MESSAGES', 'AI_GROUP_CONTEXT_TTL_MS', 'AI_GROUP_CONTEXT_MAX_CHARS']],
      ['采样与长度', '留空用服务默认。', ['AI_TEMPERATURE', 'AI_TOP_P', 'AI_PRESENCE_PENALTY', 'AI_MAX_INPUT_CHARS', 'AI_MAX_REPLY_CHARS']],
      ['附件与图片理解', '图片与文档会发给模型。', ['AI_VISION_ENABLED', 'AI_ATTACHMENT_MAX_CHARS', 'AI_PDF_MAX_PAGES']],
      ['系统提示词', '角色、语气与规则。', ['AI_SYSTEM_PROMPT']]
    ],
    agent: [
      ['执行开关', '用 Agent 处理白名单消息。', ['AGENT_ENABLED']],
      ['步数与超时', '步数、工具调用与总时长上限。', ['AGENT_MAX_STEPS', 'AGENT_MAX_TOOL_CALLS', 'AGENT_TIMEOUT_MS']]
    ],
    computer: [
      ['访问范围', '仅限列出的目录。', ['COMPUTER_ENABLED', 'COMPUTER_ROOTS']],
      ['桌面与命令', '以当前用户身份执行。', ['COMPUTER_DESKTOP_ENABLED', 'COMPUTER_SHELL_ENABLED', 'COMPUTER_COMMAND_TIMEOUT_MS']],
      ['QQ 管理员', '仅管理员私聊可用。', ['COMPUTER_QQ_ADMIN_ENABLED']]
    ],
    access: [
      ['回复范围', '留空不回复对应类型。', ['AI_ALLOWED_USERS', 'AI_ALLOWED_GROUPS', 'AI_GROUP_REQUIRE_AT']],
      ['权限与屏蔽', '屏蔽优先于 AI 与插件。', ['BOT_ADMIN_IDS', 'BOT_PROMPT_OWNER_IDS', 'GROUP_BLOCKED_USERS']]
    ],
    qq: [
      ['账号与驱动', 'kernel 官方内核，native 实验。', ['QQ_DRIVER', 'QQ_ACCOUNT']],
      ['运行时目录', '程序、桥接与数据分开放。', ['QQ_RUNTIME_DIR', 'QQ_KERNEL_DIR', 'QQ_KERNEL_DATA', 'QQ_7ZIP']],
      ['超时与图片', '收发超时与图片上限。', ['QQ_RPC_TIMEOUT_MS', 'QQ_STARTUP_TIMEOUT_MS', 'QQ_SHUTDOWN_TIMEOUT_MS', 'MEDIA_MAX_BYTES', 'MEDIA_TIMEOUT_MS']]
    ],
    connection: [
      ['OneBot 接入', '管理员 Token 不要外泄。', ['HOST', 'PORT', 'ONEBOT_ACCESS_TOKEN', 'ADMIN_ACCESS_TOKEN', 'ONEBOT_MAX_REQUEST_BYTES', 'HEARTBEAT_MS']],
      ['图片访问', '跨主机取图时填写。', ['MEDIA_BASE_URL']],
      ['事件推送', '反向 WS 与 Webhook。', ['REVERSE_WS_URLS', 'REVERSE_WS_TOKEN', 'WEBHOOK_URL', 'WEBHOOK_SECRET']],
      ['空间授权', '允许插件读取空间 Cookie。', ['QZONE_ALLOW_COOKIE_EXPORT']]
    ],
    queue: [
      ['并发', '不同会话并行，同会话串行。', ['AI_CONCURRENCY', 'SEND_CONCURRENCY']],
      ['间隔与重试', '全局与会话两档间隔。', ['SEND_INTERVAL_MS', 'SESSION_INTERVAL_MS', 'AI_MAX_ATTEMPTS', 'SEND_MAX_ATTEMPTS']],
      ['容量与等待', '达到上限后拒绝新任务。', ['MAX_PENDING_SENDS', 'JOB_MAX_AGE_MS', 'MAX_PENDING_JOBS']]
    ],
    storage: [
      ['数据目录', '队列、历史与会话所在目录。', ['DATA_DIR']],
      ['保留策略', '0 天表示永久保留。', ['HISTORY_RETENTION_DAYS', 'RETAIN_IGNORED_JOB_CONTENT', 'UNCERTAIN_RETENTION_DAYS', 'MEDIA_CACHE_DAYS']],
      ['会话加密', '替换后需重新扫码。', ['SESSION_KEY']]
    ],
    advanced: [
      ['native 服务器', '仅 native 驱动使用。', ['QQ_SERVER_HOST', 'QQ_SERVER_PORT', 'QQ_PROFILE']],
      ['签名服务', '需与 QQ 版本匹配。', ['QQ_SIGN_URL', 'QQ_SIGN_TOKEN']]
    ],
    market: [
      ['清单来源', '一份静态 index.json 的公开地址。', ['MARKET_CATALOG_URL']],
      ['访问限制', '留空时只信任清单所在域名。', ['MARKET_ALLOWED_HOSTS', 'MARKET_REDIRECT_HOSTS']],
      ['超时与大小', '下载插件包的限值。', ['MARKET_TIMEOUT_MS', 'MARKET_MAX_PACKAGE_BYTES']]
    ]
  };

  /* ------------------------------------------------------------- 只读派生 */

  function readiness() {
    const values = currentValues();
    const plugins = pluginsList();
    const enabled = plugins.filter((p) => p.enabled).length;
    const groups = String(values.AI_ALLOWED_GROUPS || '').split(',').filter((v) => v.trim());
    const users = String(values.AI_ALLOWED_USERS || '').split(',').filter((v) => v.trim());
    return [
      { key: 'ai', label: 'AI 与模型', done: !!(values.AI_MODEL && values.AI_BASE_URL), note: values.AI_MODEL || '未配置模型', go: 'config/ai' },
      { key: 'platform', label: '平台与机器人', done: stateOnline(), note: stateOnline() ? '已登录 · ' + (S.state.driver || '驱动') : 'QQ 未登录', go: 'platforms' },
      { key: 'access', label: '回复范围', done: groups.length + users.length > 0, note: `${users.length} 个好友 · ${groups.length} 个群`, go: 'config/access' },
      { key: 'agent', label: 'Agent 执行', done: String(values.AGENT_ENABLED) === 'true', note: `步数上限 ${values.AGENT_MAX_STEPS || '—'}`, go: 'config/agent' },
      { key: 'plugins', label: '插件与扩展', done: plugins.length > 0 && enabled > 0, note: `${enabled}/${plugins.length} 已启用`, go: 'plugins' }
    ];
  }
  const READY_ICONS = { ai: 'spark', platform: 'plug', access: 'shield', agent: 'branch', plugins: 'grid' };
  function readyStrip() {
    return `<div class="ready">${readiness().map((item) => `<button type="button" class="ready-item" data-done="${item.done}" data-go="${item.go}">
      <span class="r-icon">${icon(READY_ICONS[item.key] || 'check')}</span>
      <span class="r-text"><b>${esc(item.label)}</b><small>${esc(item.note)}</small></span>
      <span class="r-check">${icon(item.done ? 'check' : 'chevron')}</span>
    </button>`).join('')}</div>`;
  }

  const jobCounts = () => {
    const summary = (S.state && S.state.jobs) || {};
    const keys = ['queued', 'generating', 'ready', 'sending', 'done', 'uncertain', 'failed', 'ignored'];
    const counts = Object.fromEntries(keys.map((key) => [key, Number(summary[key]) || 0]));
    counts.pending = counts.queued + counts.generating + counts.ready + counts.sending;
    counts.total = keys.reduce((sum, key) => sum + counts[key], 0);
    return counts;
  };

  /* ------------------------------------------------------------- 配置文件 */

  /** 取值规则并进标签或占位符：开关关掉说明后，这些信息仍要能被看到。 */
  const FIELD_RULE = {
    AI_CONTEXT_TURNS: '（-1 全部，0 不保留）',
    AI_MAX_OUTPUT_TOKENS: '（0 = 服务默认）',
    AI_TEMPERATURE: '（0–2，空 = 默认）',
    AI_TOP_P: '（0–1，空 = 默认）',
    AI_PRESENCE_PENALTY: '（-2–2，空 = 默认）',
    AI_REASONING_EFFORT: '（none / low / medium / high）',
    QQ_ACCOUNT: '（0 = 扫码确定）',
    PORT: '（0 = 自动分配）',
    HISTORY_RETENTION_DAYS: '（0 = 永久）'
  };
  const FIELD_PLACEHOLDER = {
    AI_ALLOWED_USERS: '多个 QQ 号，逗号分隔；留空不回复私聊',
    AI_ALLOWED_GROUPS: '多个群号，逗号分隔；留空不回复群聊',
    BOT_ADMIN_IDS: '多个 QQ 号，逗号分隔；留空禁用 / 指令',
    BOT_PROMPT_OWNER_IDS: '多个 QQ 号，逗号分隔；留空同管理员',
    GROUP_BLOCKED_USERS: '多个 QQ 号，逗号分隔',
    COMPUTER_ROOTS: '多个目录，逗号分隔',
    REVERSE_WS_URLS: '多个地址，逗号分隔',
    MEDIA_BASE_URL: '留空使用 OneBot 本机地址',
    WEBHOOK_URL: '留空关闭推送',
    QQ_PROFILE: '留空使用内置 Profile',
    QQ_7ZIP: '留空使用 C:\\Program Files\\7-Zip\\7z.exe',
    AI_REASONING_EFFORT: '留空使用模型默认'
  };

  /* 字段说明只保留一句短语；完整说明挂在 title 上。没列出的字段不显示说明。 */
  const FIELD_HINT = {
    AI_ENABLED: '总开关',
    AI_STRIP_EMOJI: '含组合与肤色表情',
    REPLY_AT_SENDER: '回复时带上 @',
    REPLY_QUOTE_MESSAGE: '引用原消息',
    AI_STREAM_ENABLED: '边生成边显示',
    AI_SEGMENTED_REPLY_ENABLED: '按整句分段发送',
    AI_STREAM_CHUNK_CHARS: '每段字符数',
    AI_MODEL: '服务端返回的模型名',
    AI_TIMEOUT_MS: '含读取响应正文',
    AI_VISION_ENABLED: '图片会发给模型',
    AI_ATTACHMENT_MAX_CHARS: '超出的部分丢弃',
    AI_SYSTEM_PROMPT: '角色、语气与规则',
    AI_CONTEXT_TURNS: '轮数越大越费 Token',
    AI_GROUP_CONTEXT_ENABLED: '缓存未 @ 的群消息',
    AI_GROUP_CONTEXT_MESSAGES: '每次参考条数',
    AI_GROUP_CONTEXT_TTL_MS: '超时不再参与',
    AI_GROUP_CONTEXT_MAX_CHARS: '超出部分截断',
    AGENT_ENABLED: '处理白名单消息',
    AGENT_MAX_STEPS: '单任务模型请求数',
    COMPUTER_ENABLED: '本机工具总开关',
    COMPUTER_ROOTS: '每行一个目录',
    COMPUTER_DESKTOP_ENABLED: '截屏与操作窗口',
    COMPUTER_SHELL_ENABLED: '以当前用户执行命令',
    COMPUTER_QQ_ADMIN_ENABLED: '仅管理员私聊可用',
    AI_GROUP_REQUIRE_AT: '关掉后普通群消息也会触发',
    BOT_ADMIN_IDS: '可用 / 指令',
    BOT_PROMPT_OWNER_IDS: '留空时等同管理员',
    GROUP_BLOCKED_USERS: '这些人的消息不处理',
    QQ_DRIVER: 'kernel 官方，native 实验',
    MEDIA_MAX_BYTES: '单张与同条消息合计',
    MEDIA_BASE_URL: '插件取图用这个地址',
    ONEBOT_MAX_REQUEST_BYTES: 'HTTP 与 WS 共用',
    HEARTBEAT_MS: 'OneBot 心跳周期',
    QZONE_ALLOW_COOKIE_EXPORT: '仅本机插件可用',
    REVERSE_WS_URLS: '多个用逗号分隔',
    AI_CONCURRENCY: '同会话始终串行',
    AI_MAX_ATTEMPTS: '失败后的重试次数',
    SEND_MAX_ATTEMPTS: '发送失败重试次数',
    MAX_PENDING_SENDS: '达到上限后拒绝发送',
    MAX_PENDING_JOBS: '达到上限后拒绝新任务',
    JOB_MAX_AGE_MS: '超时不再发送',
    DATA_DIR: '队列、历史与会话',
    RETAIN_IGNORED_JOB_CONTENT: '保留被忽略消息正文',
    SESSION_KEY: '替换后旧会话失效'
  };

  function configField(field) {
    const key = field.key;
    const value = currentValues()[key];
    const locked = (S.settings.locked || []).includes(key);
    const hasSecret = !!(S.settings.secrets && S.settings.secrets[key]);
    const id = 'f-' + key;
    const wide = ['textarea', 'secret'].includes(field.type) || (field.type === 'ids' && String(value || '').length > 24);
    const shortHint = HINTS ? (FIELD_HINT[key] || '') : '';
    const help = shortHint ? `<p class="help" title="${esc(field.help || shortHint)}">${esc(shortHint)}</p>` : '';
    const label = `${esc(field.label)}${FIELD_RULE[key] ? ` <span class="label-rule">${esc(FIELD_RULE[key])}</span>` : ''}`;

    if (field.type === 'boolean') {
      return `<div class="field wide">
        <div class="toggle-row">
          <input class="switch" type="checkbox" id="${id}" data-field="${esc(key)}" ${String(value) === 'true' ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span class="toggle-text"><label for="${id}">${label}${locked ? ' ' + badge('由启动环境变量覆盖', 'badge-outline') : ''}</label>${shortHint ? `<span class="help">${esc(shortHint)}</span>` : ''}</span>
        </div>
      </div>`;
    }

    let control;
    if (field.type === 'textarea') {
      control = `<textarea class="textarea" id="${id}" data-field="${esc(key)}" rows="4" ${locked ? 'disabled' : ''}>${esc(value ?? '')}</textarea>`;
    } else if (field.type === 'secret') {
      const revealed = (form && form.__revealed && form.__revealed[key]) || false;
      control = `<div class="input-group">
        <input class="input" id="${id}" data-field="${esc(key)}" data-secret="1" type="${revealed ? 'text' : 'password'}" value="${revealed ? esc(value ?? '') : ''}" placeholder="${hasSecret ? '已保存，留空不变' : '未设置'}" autocomplete="new-password" ${locked ? 'disabled' : ''}>
        <button class="btn" type="button" data-act="reveal-secret" data-key="${esc(key)}" ${locked ? 'disabled' : ''}>${revealed ? '隐藏' : '显示'}</button>
        <button class="btn" type="button" data-act="clear-secret" data-key="${esc(key)}" ${locked ? 'disabled' : ''}>清空</button>
      </div>`;
    } else {
      const inputType = field.type === 'number' ? 'text' : field.type === 'url' ? 'url' : 'text';
      const placeholder = FIELD_PLACEHOLDER[key] ? `placeholder="${esc(FIELD_PLACEHOLDER[key])}"` : '';
      control = `<input class="input" id="${id}" data-field="${esc(key)}" type="${inputType}" ${field.type === 'number' ? 'inputmode="numeric"' : ''} value="${esc(value ?? '')}" ${placeholder} ${locked ? 'disabled' : ''} autocomplete="off">`;
    }
    const secretNote = field.type === 'secret'
      ? `<span class="secret-state">${hasSecret ? '已保存密钥' : '尚未设置'}${(form && form.__cleared && form.__cleared[key]) ? ' · 保存后清空' : ''}</span>`
      : '';
    return `<div class="field ${wide ? 'wide' : ''}">
      <label for="${id}">${label} ${locked ? badge('覆盖', 'badge-outline') : ''}${secretNote}</label>
      ${control}
      ${help}
    </div>`;
  }

  function configCards(group) {
    const fields = (S.settings.fields || []).filter((f) => f.group === group.id);
    const layout = CONFIG_CARDS[group.id] || [];
    const used = new Set();
    const blocks = [];
    layout.forEach(([title, desc, keys]) => {
      const list = keys.map((key) => fields.find((f) => f.key === key)).filter((f) => f && !used.has(f.key));
      list.forEach((f) => used.add(f.key));
      if (!list.length) return;
      blocks.push({ title, desc, body: `<div class="fields">${list.map(configField).join('')}</div>` });
    });
    const rest = fields.filter((f) => !used.has(f.key));
    if (rest.length) blocks.push({ title: '其他设置', desc: '未归入分区的键。', body: `<div class="fields">${rest.map(configField).join('')}</div>` });
    return blocks.length ? panel(blocks) : emptyState({ iconName: 'sliders', title: '这个分区没有配置项', body: '配置版本可能较旧，或该分组已被移除。' });
  }

  function viewConfig() {
    if (!S.settings) return { html: pageHead({ title: '配置文件', desc: '按分区维护运行参数。' }) + region('settings', '') };
    const groups = S.settings.groups || [];
    const id = cfgId();
    const group = groups.find((g) => g.id === id) || groups[0];
    if (!group) return { html: pageHead({ title: '配置文件' }) + emptyState({ iconName: 'sliders', title: '配置版本没有分组', body: '服务返回了配置项，但没有可显示的分组信息。' }) };
    if (!form || formRevision !== S.settings.revision) {
      form = { ...S.settings.values };
      formRevision = S.settings.revision;
      secretTouched = new Set();
      dirtyKeys = new Set();
    }
    const countOf = (id) => (S.settings.fields || []).filter((f) => f.group === id).length;
    const subnav = `<nav class="subnav" aria-label="配置分区">${groups.map((g) => `<a href="#/config/${esc(g.id)}" ${g.id === group.id ? 'aria-current="page"' : ''}><b>${esc(g.title)}</b><span class="n">${countOf(g.id)}</span></a>`).join('')}</nav>`;
    const pending = (S.settings.pending || []).length;
    const savedText = lastSave && lastSave.revision === S.settings.revision
      ? (lastSave.pending ? `已保存 · ${lastSave.pending} 项需要重启生效` : '已保存 · 全部生效')
      : (pending ? `${pending} 项等待重启生效` : '所有改动已保存');
    const savebar = `<div class="savebar" id="savebar" data-dirty="false">
      <div class="state-line"><span class="dot"></span><span id="save-text">${esc(savedText)}</span></div>
      <div class="btn-row">
        <span class="inline-note" id="dirty-note"></span>
        ${pending ? btn('重启生效', { act: 'restart', small: true, iconName: 'power' }) : ''}
        ${btn('放弃修改', { act: 'discard-config', small: true, kind: 'btn-ghost' })}
        ${btn('保存', { act: 'save-config', small: true, kind: 'btn-primary', iconName: 'check' })}
      </div>
    </div>`;
    const actions = btn('查看 JSON', { act: 'show-json', small: true, iconName: 'file' });
    const meta = [
      `版本 <code>${esc(String(S.settings.revision || '').slice(0, 8) || '—')}</code>`,
      S.settings.persistent ? '已写入本机 .env' : '仅内存配置（演示工作区）',
      pending ? `${pending} 项待重启` : '无待重启项'
    ];
    return {
      html: pageHead({ title: '配置文件', desc: '密钥不回显，留空保持不变。', actions, meta }) +
        readyStrip() +
        `<div class="config-layout">${subnav}<div class="config-body">${configCards(group)}${savebar}</div></div>`,
      mount: mountConfig
    };
  }

  function mountConfig() {
    recomputeDirty();
    updateSavebar();
    const main = $('#main');
    main.oninput = (event) => {
      const el = event.target.closest('[data-field]');
      if (!el) return;
      const key = el.dataset.field;
      if (el.dataset.secret) {
        form[key] = el.value;
        if (el.value) secretTouched.add(key);
        else if (!(form.__cleared && form.__cleared[key])) secretTouched.delete(key);
        if (form.__cleared) delete form.__cleared[key];
      } else if (el.type === 'checkbox') form[key] = el.checked ? 'true' : 'false';
      else form[key] = el.value;
      recomputeDirty();
      updateSavebar();
    };
    main.onchange = (event) => {
      const el = event.target.closest('[data-field]');
      if (!el || el.type !== 'checkbox') return;
      form[el.dataset.field] = el.checked ? 'true' : 'false';
      recomputeDirty();
      updateSavebar();
    };
  }

  function recomputeDirty() {
    dirtyKeys = new Set();
    if (!S.settings || !form) return;
    (S.settings.fields || []).forEach((field) => {
      if (field.type === 'secret') return;
      if (String(form[field.key] ?? '') !== String(S.settings.values[field.key] ?? '')) dirtyKeys.add(field.key);
    });
  }

  function updateSavebar() {
    const bar = $('#savebar');
    if (!bar) return;
    const total = dirtyKeys.size + secretTouched.size;
    bar.dataset.dirty = total ? 'true' : 'false';
    const text = $('#save-text');
    if (text) {
      if (total) text.textContent = `${total} 项改动未保存`;
      else if ((S.settings.pending || []).length) text.textContent = `${S.settings.pending.length} 项已保存，等待重启生效`;
      else text.textContent = '所有改动已保存';
    }
    const note = $('#dirty-note');
    if (note) note.textContent = total ? '保存会写入本机配置' : '';
    $$('#main [data-act="save-config"]').forEach((button) => { button.disabled = total === 0; });
    $$('#main [data-act="discard-config"]').forEach((button) => { button.disabled = total === 0; });
  }

  async function saveConfig() {
    if (!S.settings) return;
    recomputeDirty();
    const values = {};
    dirtyKeys.forEach((key) => { values[key] = String(form[key] ?? ''); });
    secretTouched.forEach((key) => { values[key] = String(form[key] ?? ''); });
    if (!Object.keys(values).length) { toast('没有需要保存的改动', 'info'); return; }
    for (const key of Object.keys(values)) {
      const field = (S.settings.fields || []).find((f) => f.key === key);
      if (field && field.type === 'number' && !/^\d+$/.test(values[key])) { toast(`${field.label} 必须是非负整数`, 'alert'); return; }
    }
    try {
      const snapshot = await API.saveSettings(values, S.settings.revision);
      S.settings = snapshot;
      form = { ...snapshot.values };
      formRevision = snapshot.revision;
      secretTouched = new Set();
      dirtyKeys = new Set();
      lastSave = { revision: snapshot.revision, pending: (snapshot.pending || []).length, at: Date.now() };
      toast(lastSave.pending ? `已保存，${lastSave.pending} 项需要重启生效` : '配置已保存并生效', 'check');
      render({ keepScroll: true });
    } catch (error) {
      if (error.status === 409) {
        openModal({
          title: '配置已在其他窗口修改',
          body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">本页的草稿还在。重新加载会放弃草稿并显示最新配置。</p>',
          actions: `${btn('保留草稿', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('重新加载', { act: 'reload-settings', small: true, kind: 'btn-primary' })}`
        });
      } else toast('保存失败：' + error.message, 'alert');
    }
  }

  /* ------------------------------------------------------------- 服务提供商 */

  function viewProviders() {
    if (!S.settings) return { html: pageHead({ title: '服务提供商' }) + region('settings', '') };
    const values = currentValues();
    const base = values.AI_BASE_URL || '';
    const model = values.AI_MODEL || '';
    const keyState = S.settings.secrets && S.settings.secrets.AI_API_KEY;
    const used = !!(base && model);
    if (!probe.base) probe.base = base;
    const chips = (probe.models || []).map((name) => `<button type="button" class="meme-chip" data-act="use-model" data-model="${esc(name)}"><b>${esc(name)}</b><span>${name === model ? '当前模型' : '设为当前模型'}</span></button>`).join('');
    const result = probe.error
      ? `<div class="banner banner-bad" role="alert">${icon('alert')}<div><b>连接失败。</b>${esc(probe.error)}</div></div>`
      : probe.models
        ? `<div class="banner banner-info" role="status">${icon('check')}<div><b>连接成功。</b>读取到 ${probe.models.length} 个模型，用时 ${probe.ms} ms。选择一个即可写入配置。</div></div><div class="grid-3">${chips || '<p class="inline-note">服务返回了空列表。</p>'}</div>`
        : '';
    const providerCard = `<section class="provider" data-used="${used ? 'true' : 'false'}">
      <div class="provider-head">
        <span class="p-logo">${icon('server')}</span>
        <div><b>${esc(model || '尚未选择模型')}</b>${used ? '' : `<small>${model ? '缺少服务地址' : '等待配置'}</small>`}</div>
        ${used ? badge('使用中', 'badge-primary') : badge('未完成', 'badge-outline')}
      </div>
      <div class="p-meta">
        <span>基础地址</span><code>${esc(base || '未填写')}</code>
        <span>API Key</span><span>${keyState ? '已保存（不回显）' : '未设置'}</span>
        <span>超时</span><span>${esc(values.AI_TIMEOUT_MS || '—')} ms</span>
      </div>
      <div class="p-foot">${btn('编辑参数', { go: 'config/ai', small: true })}${btn('读取模型', { act: 'probe-models', small: true, kind: 'btn-primary' })}</div>
    </section>`;
    const body = `<div class="providers" style="grid-template-columns:minmax(0,460px)">${providerCard}</div>
      <section class="card" style="margin-top:14px"><div class="card-head"><div><h2>连接测试</h2></div></div>
      <div class="card-body">
        <div class="fields">
          <div class="field wide"><label for="probe-base">模型服务地址</label><input class="input" id="probe-base" value="${esc(probe.base || base)}" placeholder="http://127.0.0.1:11434/v1" autocomplete="off"><p class="help">兼容 Chat Completions；测试时会自动追加 /models。</p></div>
          <div class="field wide"><label for="probe-key">API Key（可留空）</label><input class="input" id="probe-key" type="password" value="${esc(probe.key || '')}" placeholder="${keyState ? '留空使用已保存的密钥' : '未设置'}" autocomplete="new-password"><p class="help">仅在本次测试中使用，不会保存。</p></div>
        </div>
        <div class="btn-row" style="margin-top:14px">${btn(probe.busy ? '正在连接…' : '测试并读取模型', { act: 'probe-models', kind: 'btn-primary', iconName: 'spark', disabled: probe.busy })}${model ? `<span class="inline-note">当前模型：<code>${esc(model)}</code></span>` : ''}</div>
        <div style="margin-top:14px">${result}</div>
      </div></section>
      <p class="foot-links">${icon('info')} 当前版本只维护一组模型服务。Embedding 等插件各自的模型配置在插件页里设置。<span class="sep">·</span><a class="link-btn" href="#/config/ai">打开完整配置</a></p>`;
    return { html: pageHead({ title: '服务提供商', desc: '真实读取可用模型。', actions: linkBtn('编辑配置', 'config/ai', { iconName: 'sliders' }) }) + body };
  }

  async function probeModels() {
    const base = ($('#probe-base') && $('#probe-base').value.trim()) || '';
    const key = ($('#probe-key') && $('#probe-key').value) || '';
    probe = { ...probe, base, key, busy: true, error: null, models: null, ms: 0 };
    render({ keepScroll: true });
    const started = performance.now();
    try {
      const params = { AI_BASE_URL: base };
      if (key) params.AI_API_KEY = key;
      const value = await API.models(params);
      probe = { ...probe, busy: false, models: Array.isArray(value && value.models) ? value.models : [], ms: Math.max(1, Math.round(performance.now() - started)) };
      toast(`连接成功，读取到 ${probe.models.length} 个模型`, 'check');
    } catch (error) {
      probe = { ...probe, busy: false, error: error.message };
      toast('连接失败：' + error.message, 'alert');
    }
    render({ keepScroll: true });
  }

  async function useModel(name) {
    if (!S.settings) return;
    try {
      const snapshot = await API.saveSettings({ AI_MODEL: name }, S.settings.revision);
      S.settings = snapshot;
      form = { ...snapshot.values };
      formRevision = snapshot.revision;
      lastSave = { revision: snapshot.revision, pending: (snapshot.pending || []).length, at: Date.now() };
      toast(`已把模型设为 ${name}`, 'check');
      render({ keepScroll: true });
    } catch (error) { toast('保存失败：' + error.message, 'alert'); }
  }

  /* ------------------------------------------------------------- 平台与机器人 */

  function viewPlatforms() {
    const state = S.state || {};
    if (!S.loaded && !S.errors.state) {
      return { html: pageHead({ title: '平台与机器人', desc: '登录、接入与推送。' }) + skeleton(6) };
    }
    if (S.errors.state) {
      return { html: pageHead({ title: '平台与机器人', desc: '登录、接入与推送。' }) + region('state', '') };
    }
    const values = settingsValues();
    const online = !!state.online;
    const accounts = state.account ? mask(state.account) : '未登录';
    const qrMeta = kv([
      ['状态', online ? dotBadge('在线', 'ok') : dotBadge(STATE_LABEL[state.state] || '离线', 'warn')],
      ['账号', `<code>${esc(accounts)}</code>`],
      ['驱动', `<code>${esc(state.driver || '—')}</code>${state.simulated ? ' ' + badge('模拟', 'badge-outline') : ''}`],
      ['内核版本', `<code>${esc(state.version || '—')}</code>`],
      ['服务地址', `<code>${esc(state.endpoint || '—')}</code>`],
      ['最近检查', `${esc(clock(state.checked_at))} · ${esc(rel(state.checked_at))}`]
    ]);
    const qrPanel = qr && qr.qrcode
      ? `<div class="qr-panel">
          <div class="qr-frame"><img src="${esc(qr.qrcode)}" alt="QQ 登录二维码"></div>
          <div class="qr-copy">
            <h3>用手机 QQ 扫码登录</h3>
            <p class="meta-line"><span id="qr-countdown">${qr.expires_at ? '有效期至 ' + clock(qr.expires_at) : '等待扫码'}</span></p>
            <div class="btn-row">${btn('刷新二维码', { act: 'qr-start', small: true, iconName: 'refresh' })}${btn('取消', { act: 'qr-cancel', small: true, kind: 'btn-ghost' })}</div>
            ${qrMeta}
          </div>
        </div>`
      : `<div class="qr-panel">
          <div class="qr-frame"><span class="qr-idle">${icon(online ? 'check' : 'qr')}${online ? '已登录' : '等待获取二维码'}</span></div>
          <div class="qr-copy">
            <h3>${online ? '当前账号已在线' : '需要扫码登录'}</h3>
            <div class="btn-row">${online ? btn('退出登录', { act: 'logout', small: true, kind: 'btn-danger' }) : btn('获取登录二维码', { act: 'qr-start', small: true, kind: 'btn-primary', iconName: 'qr' })}</div>
            ${qrMeta}
          </div>
        </div>`;
    const qqCard = {
      title: 'QQ 账号',
      desc: '官方内核的连接、账号与版本。',
      body: `${online ? '' : `<div class="banner banner-warn" role="status">${icon('info')}<div><b>QQ 尚未登录。</b>登录后才能收发消息。</div></div>`}
        ${qrPanel}`,
      foot: online ? `${btn('退出登录', { act: 'logout', small: true, kind: 'btn-danger' })}<span class="inline-note">${state.can_restart ? '需要应用新配置时，可在页头重启服务。' : '当前工作台复用了其他进程的服务，不能代为重启。'}</span>` : ''
    };

    const onebot = {
      title: 'OneBot 接入',
      desc: '插件用独立端口连接。',
      actions: linkBtn('编辑接入参数', 'config/connection', { small: true }),
      body: kv([
        ['监听地址', `<code>${esc(values.HOST || '127.0.0.1')}</code>`],
        ['端口', `<code>${esc(String(values.PORT ?? '—') === '0' ? '0（自动分配）' : (values.PORT || '—'))}</code>`],
        ['接口地址', `<code>${esc(state.endpoint ? state.endpoint + '/onebot/v11' : '—')}</code>`],
        ['访问 Token', (S.settings && S.settings.secrets && S.settings.secrets.ONEBOT_ACCESS_TOKEN) ? badge('已保存', 'badge-ok') : badge('未设置', 'badge-warn')],
        ['管理员 Token', (S.settings && S.settings.secrets && S.settings.secrets.ADMIN_ACCESS_TOKEN) ? badge('已保存', 'badge-ok') : badge('未设置', 'badge-warn')],
        ['请求上限', `${esc(values.ONEBOT_MAX_REQUEST_BYTES ? size(values.ONEBOT_MAX_REQUEST_BYTES) : '—')}`]
      ])
    };

    const push = {
      title: '事件推送',
      desc: '反向 WS 与 Webhook。',
      body: (String(values.REVERSE_WS_URLS || '').trim() || String(values.WEBHOOK_URL || '').trim())
        ? kv([
          ['反向 WS', `<code>${esc(values.REVERSE_WS_URLS || '未配置')}</code>`],
          ['反向 WS Token', (S.settings && S.settings.secrets && S.settings.secrets.REVERSE_WS_TOKEN) ? badge('已保存', 'badge-ok') : badge('继承 OneBot Token', 'badge-outline')],
          ['Webhook', `<code>${esc(values.WEBHOOK_URL || '未配置')}</code>`],
          ['Webhook 密钥', (S.settings && S.settings.secrets && S.settings.secrets.WEBHOOK_SECRET) ? badge('已保存', 'badge-ok') : badge('未设置', 'badge-outline')]
        ])
        : emptyState({ iconName: 'send', title: '没有配置事件推送', body: '插件使用 OneBot 主动连接时不需要推送；需要被动接收事件时再填写。', action: linkBtn('去配置', 'config/connection', { small: true }) })
    };

    const privacy = (S.state && S.state.privacy) || {};
    const privacyCard = {
      title: '隐私与保留',
      desc: '缓冲在进程内，库按天数清理。',
      actions: linkBtn('调整保留策略', 'config/storage', { small: true }),
      body: kv([
        ['保留忽略任务正文', privacy.retain_ignored_content ? badge('开启', 'badge-warn') : badge('关闭 · 忽略任务只保留身份信息', 'badge-ok')],
        ['消息与历史保留', privacy.history_days === 0 ? '永久保留' : `${esc(privacy.history_days ?? '—')} 天`],
        ['页面事件缓冲', `最近 ${esc(privacy.memory_limit ?? '—')} 条（进程内）`]
      ])
    };

    return {
      html: pageHead({
        title: '平台与机器人',
        desc: '登录、接入与推送。',
        actions: `${btn('刷新状态', { act: 'refresh', small: true, iconName: 'refresh' })}${state.can_restart ? btn('重启服务', { act: 'restart', small: true, kind: 'btn-primary', iconName: 'power' }) : ''}`
      }) +
        (S.errors.state ? region('state', '') : '') +
        (S.errors.settings ? `<div class="banner banner-warn" role="status">${icon('info')}<div><b>配置读取失败。</b>OneBot 参数、Token 状态与保留策略可能不准确。</div></div>` : '') +
        panel([qqCard, onebot, push, privacyCard]),
      mount: () => { if (qr) { startQrClock(); startQrPoll(); } }
    };
  }

  function startQrPoll() {
    if (qrPoll) clearInterval(qrPoll);
    qrPoll = setInterval(async () => {
      if (!location.hash.includes('platforms')) { clearInterval(qrPoll); qrPoll = null; return; }
      try { await API.refreshLive(); } catch { /* 保持当前二维码 */ }
      if (stateOnline()) {
        clearInterval(qrPoll); qrPoll = null; qr = null;
        if (qrClock) { clearInterval(qrClock); qrClock = null; }
        toast('QQ 已登录', 'check');
        await API.loadAll();
        render({ keepScroll: true });
      }
    }, 2000);
  }

  async function startQr() {
    try {
      const value = await API.qr();
      qr = value && value.qrcode ? value : null;
      if (!qr) throw new Error('内核没有返回二维码。');
      toast('已获取二维码，请用手机 QQ 扫码', 'qr');
      render({ keepScroll: true });
      startQrPoll();
    } catch (error) { toast('获取二维码失败：' + error.message, 'alert'); }
  }

  function startQrClock() {
    if (qrClock) clearInterval(qrClock);
    qrClock = setInterval(() => {
      const el = $('#qr-countdown');
      if (!el || !qr) { clearInterval(qrClock); qrClock = null; return; }
      el.textContent = qr.expires_at ? '有效期至 ' + clock(qr.expires_at) : '等待扫码';
    }, 1000);
  }

  /* ------------------------------------------------------------- 插件 */

  function pluginCards() {
    const list = pluginsList().filter((plugin) => {
      const q = ui.plugins.q.trim().toLowerCase();
      if (q && !(plugin.name + ' ' + plugin.kind + ' ' + (plugin.description || '')).toLowerCase().includes(q)) return false;
      if (ui.plugins.status === 'on' && !plugin.enabled) return false;
      if (ui.plugins.status === 'off' && plugin.enabled) return false;
      return true;
    });
    if (!list.length) {
      if (!pluginsList().length) return emptyState({ iconName: 'grid', title: '还没有安装插件', body: '当前工作区没有插件记录。下方列出了可安装的内置插件。' });
      return emptyState({ iconName: 'grid', title: '没有匹配的插件', body: '调整搜索词或状态筛选。' });
    }
    return `<div class="plugin-grid">${list.map((plugin) => `<article class="plugin-card" data-on="${plugin.enabled}">
      <div class="pc-head">
        <span class="plugin-icon">${icon(pluginIcon(plugin.kind))}</span>
        <div style="min-width:0;flex:1">
          <div class="plugin-name"><a href="#/plugins/${esc(pluginKey(plugin))}">${esc(plugin.name)}</a>${plugin.enabled ? badge('已启用', 'badge-ok') : badge('已停用', 'badge-outline')}</div>
          <div class="pc-meta"><span>${esc(plugin.kind)}</span><span>v${esc(plugin.version || '—')}</span><span>${esc(plugin.author || '未知作者')}</span></div>
        </div>
      </div>
      <p>${esc(plugin.description || '该插件没有提供说明。')}</p>
      <div class="pc-foot">
        <label class="pc-switch"><input class="switch" type="checkbox" data-act="toggle-plugin" data-id="${esc(plugin.id)}" data-kind="${esc(plugin.kind)}" data-revision="${esc(plugin.revision)}" ${plugin.enabled ? 'checked' : ''}>${plugin.enabled ? '运行中' : '已停止'}</label>
        <span class="spacer"></span>
        ${btn('管理', { go: 'plugins/' + pluginKey(plugin), small: true })}
      </div>
    </article>`).join('')}</div>`;
  }

  function pluginIcon(kind) {
    const map = {
      'group-chat-plus': 'chat', 'living-memory': 'branch', 'meme-manager': 'image', 'startup-animation': 'play',
      background: 'image', voicestudio: 'activity', 'douyin-web': 'device', 'android-device': 'device',
      'video-analysis': 'file', 'psychodynamic-emotion': 'spark', 'free-activity': 'clock', comfyui: 'image'
    };
    return map[kind] || 'plug';
  }

  function viewPlugins() {
    if (!S.plugins) return { html: pageHead({ title: '插件与扩展' }) + region('plugins', '') };
    const installed = pluginsList();
    const enabled = installed.filter((p) => p.enabled).length;
    const builtins = (S.plugins.builtins || []).filter((entry) => entry && !installed.some((p) => p.kind === entry.kind));
    const packages = S.plugins.packages || [];
    const toolbar = `<div class="toolbar">
      <div class="search">${icon('search')}<input class="input" id="plugin-search" placeholder="搜索名称、类型或说明" value="${esc(ui.plugins.q)}" aria-label="搜索插件"></div>
      <select class="select" id="plugin-status" aria-label="状态筛选">
        <option value="all" ${ui.plugins.status === 'all' ? 'selected' : ''}>全部状态</option>
        <option value="on" ${ui.plugins.status === 'on' ? 'selected' : ''}>已启用</option>
        <option value="off" ${ui.plugins.status === 'off' ? 'selected' : ''}>已停用</option>
      </select>
      <span class="spacer"></span>
      <span class="toolbar-count">${enabled}/${installed.length} 已启用 · 上限 ${esc(S.plugins.limit || '—')}</span>
    </div>`;
    const installCard = builtins.length ? card('可安装的内置插件', {
      desc: '随程序提供，安装后默认停用。',
      body: `<div class="stack" style="gap:8px">${builtins.map((entry) => `<div class="plugin-row" style="border:1px solid var(--border);border-radius:8px">
        <span class="plugin-icon">${icon(pluginIcon(entry.kind))}</span>
        <div><div class="plugin-name">${esc(entry.name || entry.kind)} ${badge('未安装', 'badge-outline')}</div><div class="plugin-desc">${esc(entry.description || '')}</div></div>
        <div class="btn-row">${btn('安装', { act: 'install-plugin', attrs: `data-kind="${esc(entry.kind)}"`, small: true })}</div>
      </div>`).join('')}</div>`
    }) : '';
    const packageFoot = `<div class="foot-links">${icon('layers')} 已发现 ${packages.length} 个插件包${packages.length ? ' · ' + btn('查看清单', { act: 'show-packages', small: true, kind: 'btn-ghost' }) : ''}${S.plugins.rejected && S.plugins.rejected.length ? ' · ' + badge(S.plugins.rejected.length + ' 个被拒绝', 'badge-warn') : ''}</div>`;
    return {
      html: pageHead({ title: '插件与扩展', desc: '启停立即生效。', actions: `${btn('导入 ZIP 插件包', { act: 'pick-plugin-package', small: true, iconName: 'download' })}${btn('新建脚本插件', { act: 'new-script-plugin', small: true, iconName: 'plus' })}<input type="file" id="plugin-package-file" accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream" hidden>` }) +
        region('plugins', `${toolbar}<div id="plugin-grid">${pluginCards()}</div>${packageFoot}${installCard}`),
      mount: () => {
        const packageInput = $('#plugin-package-file');
        if (packageInput) {
          packageInput.onchange = () => {
            const file = packageInput.files && packageInput.files[0];
            packageInput.value = '';
            if (file) void importPluginPackage(file);
          };
        }
        const search = $('#plugin-search');
        if (search) {
          search.addEventListener('input', () => {
            ui.plugins.q = search.value;
            const grid = $('#plugin-grid');
            if (grid) grid.innerHTML = pluginCards();
          });
        }
        const status = $('#plugin-status');
        if (status) status.addEventListener('change', () => { ui.plugins.status = status.value; render({ keepScroll: true }); });
      }
    };
  }

  /* -------------------------------------------------- 一键导入 ZIP 插件包 */
  let pendingPackageFile = null, packageImportBusy = false;
  async function importPluginPackage(file, { overwrite = false } = {}) {
    if (packageImportBusy) return;
    if (!/\.zip$/i.test(file.name || '')) { toast('请选择 .zip 格式的插件包', 'alert'); return; }
    if (file.size > 32 * 1024 * 1024) { toast('ZIP 插件包不能超过 32 MiB', 'alert'); return; }
    packageImportBusy = true;
    toast(overwrite ? '正在覆盖安装 ' + file.name + '…' : '正在校验并安装 ' + file.name + '…', 'info');
    try {
      const result = await API.uploadPluginPackage(file, overwrite);
      const info = result && result.package ? result.package : null;
      // 一键导入：包写盘后顺手建立插件记录（默认停用）。记录已存在或模板
      // 不可用时不影响包本身，只提示到“可安装的内置插件”里手动安装。
      let recordNote = '';
      if (info && info.kind && !pluginsList().some((plugin) => plugin.kind === info.kind)) {
        try { await API.installPlugin(info.kind); }
        catch { recordNote = '；插件记录未自动创建，请在下方手动安装'; }
      }
      await API.loadAll(); refreshIndex();
      toast(info ? '已导入 ' + info.name + ' v' + info.version + (result.replaced ? '（已覆盖同名包）' : '') + '，配置会话范围后可启用' + recordNote : '插件包已导入', recordNote ? 'alert' : 'check');
      render({ keepScroll: true });
    } catch (error) {
      if (error.status === 409) {
        pendingPackageFile = file;
        openModal({
          title: '已存在同名插件包',
          body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">plugins 目录中已有这个插件。覆盖会先删除旧目录再写入新文件，插件记录、配置与启停状态保留。</p>',
          actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('覆盖安装', { act: 'do-import-package-overwrite', small: true, kind: 'btn-danger' })}`
        });
      } else toast('导入失败：' + error.message, 'alert');
    } finally { packageImportBusy = false; }
  }

  async function togglePlugin(id, revision, enabled) {
    const plugin = pluginsList().find((p) => p.id === id);
    try {
      const saved = await API.togglePlugin(id, Number(revision), enabled);
      if (plugin) {
        plugin.enabled = saved && typeof saved.enabled === 'boolean' ? saved.enabled : enabled;
        if (saved && saved.revision !== undefined) plugin.revision = saved.revision;
      }
      toast(`${plugin ? plugin.name : '插件'}已${enabled ? '启用' : '停用'}`, enabled ? 'check' : 'info');
    } catch (error) {
      toast('启停失败：' + error.message, 'alert');
      if (plugin && /允许触发|作用范围/.test(error.message)) {
        openModal({
          title: '先设置插件作用范围',
          body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">这个插件还没有允许触发的好友或群。到它的配置页勾选范围后保存，再回来启用。</p>',
          actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${linkBtn('去配置', 'plugins/' + pluginKey(plugin) + '/config', { small: true })}`
        });
      }
    }
    render({ keepScroll: true });
  }

  /* ------------------------------------------------------------- 插件市场 */
  /* 清单是静态 JSON：一条插件包一个 {id,kind,version,size,sha256,url}。
     下载、SHA-256 校验、包内清单比对、写盘全在服务端；这里只负责呈现状态与触发动作。
     大体积二进制（FFmpeg）走 assets 通道落到 runtime/，和插件版本互不影响。 */

  const MARKET_STATE = {
    available: ['可安装', ''],
    upgradable: ['可更新', 'badge-primary'],
    installed: ['已安装', 'badge-ok'],
    local: ['不在清单', 'badge-outline']
  };
  let marketBusy = false;

  const marketValue = () => {
    const state = extraOf('market');
    return state.value && typeof state.value === 'object' ? state.value : null;
  };
  const marketPlugins = () => {
    const value = marketValue();
    const q = ui.market.q.trim().toLowerCase();
    return ((value && value.plugins) || []).filter((item) => {
      if (ui.market.state !== 'all' && item.state !== ui.market.state) return false;
      if (!q) return true;
      return `${item.name} ${item.id} ${item.kind} ${item.description || ''}`.toLowerCase().includes(q);
    });
  };

  function marketRow(item) {
    const [label, tone] = MARKET_STATE[item.state] || [item.state || '未知', 'badge-outline'];
    const marks = [badge(label, tone), badge('清单 v' + item.version, 'badge-outline')];
    if (item.state === 'upgradable' && item.installed_version) marks.push(badge('本机 v' + item.installed_version, 'badge-outline'));
    if (item.enabled === true) marks.push(badge('已启用', 'badge-ok'));
    if (item.yanked) marks.push(badge('已撤回', 'badge-bad'));
    const detail = [
      item.description ? esc(item.description) : '（条目没有写说明）',
      item.size ? '包 ' + esc(size(item.size)) : '',
      item.changelog ? '更新说明：' + esc(item.changelog) : ''
    ].filter(Boolean).join(' · ');
    const actions = [];
    if (item.state === 'available' || item.state === 'upgradable') {
      actions.push(btn(item.state === 'upgradable' ? '更新到 ' + item.version : '安装', {
        act: 'market-install', small: true, kind: 'btn-primary',
        attrs: `data-id="${esc(item.id)}" data-name="${esc(item.name)}" data-state="${esc(item.state)}"`
      }));
    } else {
      actions.push(linkBtn(item.record ? '打开插件' : '去插件页', 'plugins', { small: true }));
    }
    if (item.state === 'installed' || item.state === 'local' || item.state === 'upgradable') {
      actions.push(btn('卸载', {
        act: 'market-uninstall', small: true, kind: 'btn-danger',
        attrs: `data-id="${esc(item.id)}" data-name="${esc(item.name)}"`
      }));
    }
    return `<div class="plugin-row" data-on="${item.enabled === true}">
      <span class="plugin-icon">${icon(pluginIcon(item.kind))}</span>
      <div><div class="plugin-name">${esc(item.name)}${marks.join('')}</div><div class="plugin-desc">${detail}</div></div>
      <div class="btn-row">${actions.join('')}</div>
    </div>`;
  }

  function assetRow(asset) {
    const marks = [
      badge(asset.ready ? '已就绪' : '未安装', asset.ready ? 'badge-ok' : 'badge-outline'),
      badge('v' + (asset.version || '—'), 'badge-outline'),
      asset.size ? badge(size(asset.size), 'badge-outline') : ''
    ].filter(Boolean);
    const detail = asset.description
      ? esc(asset.description)
      : '写入 ' + asset.install_to + '：' + (asset.files || []).join('、');
    const actions = asset.ready
      ? `<span class="inline-note mono" style="overflow-wrap:anywhere">${esc(asset.directory || '')}</span>`
      : btn('下载并安装', {
        act: 'market-asset', small: true, kind: 'btn-primary',
        attrs: `data-id="${esc(asset.id)}" data-name="${esc(asset.name)}" data-size="${esc(asset.size || 0)}"`
      });
    return `<div class="plugin-row">
      <span class="plugin-icon">${icon('terminal')}</span>
      <div><div class="plugin-name">${esc(asset.name || asset.id)}${marks.join('')}</div><div class="plugin-desc">${detail}</div></div>
      <div class="btn-row">${actions}</div>
    </div>`;
  }

  function viewMarket() {
    const state = extraOf('market');
    const value = marketValue();
    const head = pageHead({
      title: '插件市场',
      desc: '从一个静态清单安装与更新插件；FFmpeg 这类大体积资源单独下载，不占插件包。',
      actions: `${btn('刷新清单', { act: 'market-reload', small: true, iconName: 'refresh' })}${linkBtn('市场设置', 'config/market', { small: true, iconName: 'settings' })}`
    });
    if (!value) {
      return {
        html: head + (state.error
          ? card('市场清单', { body: errorState({ title: '读不到市场清单', body: state.error, code: 'market' }) })
          : card('市场清单', { desc: '正在读取 index.json…', body: skeleton(4) })),
        mount: () => { if (!state.error) void loadMarket(false); }
      };
    }
    const plugins = marketPlugins();
    const total = (value.plugins || []).length;
    const assets = value.assets || [];
    const installable = (value.plugins || []).filter((item) => item.state === 'available' || item.state === 'upgradable').length;
    const source = value.configured
      ? (value.source || value.catalog_url) + (value.fetched_at ? ' · 读取于 ' + rel(value.fetched_at) : '') + (value.cached ? ' · 缓存' : '')
      : '';
    const warning = value.error
      ? `<div style="padding:10px 16px;border-bottom:1px solid var(--border)"><p class="inline-note" style="color:var(--bad)">${esc(value.error.message)}</p></div>`
      : '';
    const rejected = (value.rejected || []).length
      ? `<p class="inline-note">${esc((value.rejected || []).map((item) => item.id + '：' + item.reason).join('；'))}</p>`
      : '';
    const empty = value.configured
      ? emptyState({ iconName: 'download', title: '清单里没有匹配的插件', body: total ? '换个筛选条件或清空搜索词。' : '用 npm run market:catalog 生成 index.json，再发布到静态站点。' })
      : emptyState({
        iconName: 'download', title: '还没有配置市场清单',
        body: '在“市场设置”里填写 index.json 的地址，回来点刷新即可读取。清单与插件包只走 https。',
        action: linkBtn('去市场设置', 'config/market', { small: true })
      });
    return {
      html: head + card('可用插件', {
        desc: source ? esc(source) : '清单地址还没填。',
        actions: installable ? `<span class="toolbar-count">${installable} 项可安装或更新</span>` : '',
        tight: true,
        body: `${warning}<div class="toolbar">
          <div class="search">${icon('search')}<input class="input" id="market-search" placeholder="搜索名称、类型或说明" value="${esc(ui.market.q)}" aria-label="搜索市场插件"></div>
          <select class="select" id="market-state" aria-label="状态筛选">
            <option value="all" ${ui.market.state === 'all' ? 'selected' : ''}>全部状态</option>
            <option value="available" ${ui.market.state === 'available' ? 'selected' : ''}>可安装</option>
            <option value="upgradable" ${ui.market.state === 'upgradable' ? 'selected' : ''}>可更新</option>
            <option value="installed" ${ui.market.state === 'installed' ? 'selected' : ''}>已安装</option>
            <option value="local" ${ui.market.state === 'local' ? 'selected' : ''}>不在清单</option>
          </select>
          <span class="spacer"></span>
          <span class="toolbar-count">${plugins.length}/${total} 项</span>
        </div>
        <div id="market-grid">${plugins.length ? plugins.map(marketRow).join('') : empty}</div>
        ${rejected ? `<div style="padding:10px 16px;border-top:1px solid var(--border)">${rejected}</div>` : ''}`
      }) + card('运行资源', {
        desc: 'FFmpeg 这类二进制单独下载，装一次所有插件共用，插件升级时不用重下。',
        tight: true,
        body: assets.length
          ? assets.map(assetRow).join('')
          : emptyState({ iconName: 'terminal', title: '清单里没有资源条目', body: '不需要大体积二进制时，assets 留空即可。' })
      }),
      mount: () => {
        const search = $('#market-search');
        if (search) search.addEventListener('input', () => {
          ui.market.q = search.value;
          const grid = $('#market-grid');
          if (grid) grid.innerHTML = marketPlugins().length ? marketPlugins().map(marketRow).join('') : emptyState({ iconName: 'download', title: '没有匹配的插件', body: '换个关键词或清空筛选。' });
        });
        const picker = $('#market-state');
        if (picker) picker.addEventListener('change', () => { ui.market.state = picker.value; render({ keepScroll: true }); });
      }
    };
  }

  async function loadMarket(force = false) {
    if (marketBusy) return;
    marketBusy = true;
    try { S.extra.market = { value: await API.market(force), error: null, at: Date.now() }; }
    catch (error) { S.extra.market = { value: null, error: error.message, at: Date.now() }; }
    finally { marketBusy = false; }
    render({ keepScroll: true });
  }
  /** 动作完成后静默拉一次最新清单，失败不覆盖已有视图。 */
  async function refreshMarketQuiet() {
    try { S.extra.market = { value: await API.market(true), error: null, at: Date.now() }; } catch { /* 保留旧视图 */ }
  }

  async function marketInstall(item) {
    if (marketBusy) return;
    const upgrade = item.state === 'upgradable' && item.installed_version;
    openModal({
      title: `${upgrade ? '更新' : '安装'}「${item.name}」？`,
      body: `<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">${upgrade
        ? `会用清单里的 v${esc(item.version)} 覆盖当前 v${esc(item.installed_version)} 的插件目录。插件私有的数据不要放在插件目录里，否则会一起被替换。`
        : '下载后会先按 SHA-256 校验，再比对包内 plugin.json 的 id、类型与版本，任何一项不符都会整包拒绝。安装后默认停用，需要去插件页设置作用范围再启用。'}</p>`,
      actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn(upgrade ? '更新' : '安装', { act: 'do-market-install', small: true, kind: 'btn-primary', attrs: `data-id="${esc(item.id)}" data-name="${esc(item.name)}" data-overwrite="${upgrade ? '1' : '0'}"` })}`
    });
  }

  async function doMarketInstall(target) {
    const id = target.dataset.id, name = target.dataset.name || id, overwrite = target.dataset.overwrite === '1';
    closeModal();
    if (marketBusy) return;
    marketBusy = true;
    toast('正在下载并校验 ' + name + '…', 'download');
    try {
      const result = await API.marketInstall(id, overwrite);
      await API.loadAll(); refreshIndex();
      await refreshMarketQuiet();
      toast(`${name} ${result && result.version ? 'v' + result.version : ''}已安装${result && result.plugin ? '，去插件页设置范围后启用' : ''}`, 'check');
    } catch (error) { toast('安装失败：' + error.message, 'alert'); }
    finally { marketBusy = false; render({ keepScroll: true }); }
  }

  async function marketUninstall(item) {
    openModal({
      title: `卸载「${item.name || item.id}」？`,
      body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">会删除 <code>plugins/' + esc(item.id) + '</code> 整个目录并移除对应插件记录，插件配置一起丢失。资源包（如 FFmpeg）不受影响。</p>',
      actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('卸载', { act: 'do-market-uninstall', small: true, kind: 'btn-danger', attrs: `data-id="${esc(item.id)}" data-name="${esc(item.name || item.id)}"` })}`
    });
  }

  async function doMarketUninstall(target) {
    const id = target.dataset.id, name = target.dataset.name || id;
    closeModal();
    if (marketBusy) return;
    marketBusy = true;
    try {
      await API.marketRemove(id);
      await API.loadAll(); refreshIndex();
      await refreshMarketQuiet();
      toast(name + ' 已卸载', 'trash');
    } catch (error) { toast('卸载失败：' + error.message, 'alert'); }
    finally { marketBusy = false; render({ keepScroll: true }); }
  }

  async function marketAsset(asset) {
    const label = asset.dataset.name || asset.dataset.id;
    const bytes = Number(asset.dataset.size) || 0;
    openModal({
      title: `下载「${label}」？`,
      body: `<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">需要下载约 ${esc(size(bytes))}，按 SHA-256 校验后写入清单指定的 runtime 目录。下载期间请保持服务运行，中断会留下未完成状态，重试即可。</p>`,
      actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('开始下载', { act: 'do-market-asset', small: true, kind: 'btn-primary', attrs: `data-id="${esc(asset.dataset.id)}" data-name="${esc(label)}"` })}`
    });
  }

  async function doMarketAsset(target) {
    const id = target.dataset.id, name = target.dataset.name || id;
    closeModal();
    if (marketBusy) return;
    marketBusy = true;
    toast('正在下载 ' + name + '，大文件需要几分钟…', 'download');
    try {
      const result = await API.marketAsset(id);
      await refreshMarketQuiet();
      toast(name + ' 已安装到 ' + (result && result.directory ? result.directory : 'runtime 目录'), 'check');
    } catch (error) { toast('下载失败：' + error.message, 'alert'); }
    finally { marketBusy = false; render({ keepScroll: true }); }
  }

  /* ------------------------------------------------------- 插件专属管理 */

  function memoryPanel() {
    const route = '/plugins/memory';
    const state = extraOf(route);
    if (state.error) return card('流动记忆', { body: errorState({ title: '记忆读取失败', body: state.error, code: route }) });
    if (!state.value) return card('流动记忆', { desc: '正在读取真实记忆…', body: skeleton(3) });
    const value = state.value || {};
    if (!value.plugin) return card('流动记忆', { body: emptyState({ iconName: 'branch', title: '插件尚未安装', body: '安装并启用流动记忆后，这里会显示真实记忆条目。' }) });
    const scopes = Array.isArray(value.scopes) ? value.scopes : [];
    const selected = value.selected || scopes[0];
    const memories = Array.isArray(value.memories) ? value.memories : [];
    const counts = value.counts || {};
    const scopeButtons = scopes.slice(0, 12).map((scope) => {
      const active = selected && scope.scope === selected.scope && (scope.persona || '') === (selected.persona || '');
      return `<button type="button" class="link-btn" data-act="memory-scope" data-scope="${esc(scope.scope)}" data-persona="${esc(scope.persona || '')}">${active ? '● ' : ''}${esc(conversationLabel(scope.scope))}${scope.persona ? ' · ' + esc(scope.persona) : ''} (${esc(scope.count ?? '')})</button>`;
    }).join('<span style="color:var(--border-strong)"> · </span>');
    const rows = memories.slice(0, 30).map((memory) => {
      const params = `data-scope="${esc(selected ? selected.scope : '')}" data-persona="${esc(selected ? selected.persona || '' : '')}" data-id="${esc(memory.id)}" data-revision="${esc(memory.revision)}"`;
      return {
        cells: [
          `<div class="t-main">${esc(memory.key || '记忆')}</div><div class="t-sub memory-text">${esc(memory.content || memory.value || '')}</div>`,
          `${badge(memory.status || 'active', memory.status === 'archived' ? 'badge-outline' : 'badge-ok')}`,
          `<span class="t-time">${esc(rel(memory.updated_at))}</span>`,
          `<div class="btn-row">${memory.status === 'archived' ? btn('恢复', { act: 'memory-action', attrs: params + ' data-op="restore"', small: true }) : btn('归档', { act: 'memory-action', attrs: params + ' data-op="archive"', small: true })}${btn('删除', { act: 'memory-action', attrs: params + ' data-op="forget"', small: true, kind: 'btn-danger' })}</div>`
        ]
      };
    });
    return card('流动记忆', {
      desc: `${esc(value.plugin.name)} · ${esc(counts.active ?? 0)} 条生效 · ${esc(counts.archived ?? 0)} 条归档 · 上限 ${esc(value.plugin.max_memories ?? '—')}`,
      body: `${scopeButtons ? `<div class="meta-line" style="margin-bottom:10px">${scopeButtons}</div>` : '<p class="inline-note">还没有任何会话记忆。</p>'}
        ${scopes.length
          ? table(['记忆', '状态', '更新', ''], rows, { emptyHtml: emptyState({ iconName: 'branch', title: '这个会话还没有记忆', body: 'Agent 在对话中保存的长期记忆会出现在这里。' }) })
          : emptyState({ iconName: 'branch', title: '还没有可管理的记忆', body: '产生过对话并写入记忆后，这里会按会话列出。' })}`
    });
  }

  function memesPanel() {
    const route = '/memes';
    const state = extraOf(route);
    if (state.error) return card('表情图库', { body: errorState({ title: '图库读取失败', body: state.error, code: route }) });
    if (!state.value) return card('表情图库', { desc: '正在读取真实图库…', body: skeleton(3) });
    const value = state.value || {};
    if (!value.plugin) return card('表情图库', { body: emptyState({ iconName: 'image', title: '插件尚未安装', body: '安装表情包管理器后可以上传和审核表情。' }) });
    const images = Array.isArray(value.images) ? value.images : [];
    const counts = value.counts || {};
    return card('表情图库', {
      desc: `${esc(value.total ?? 0)} 张表情 · ${esc(counts.pending ?? 0)} 张待审核 · 上限 ${esc(value.limit ?? '—')} 张`,
      actions: `${counts.pending ? btn('审核待处理', { act: 'show-memes', small: true, kind: 'btn-primary' }) : ''}${btn('打开图库', { act: 'show-memes', small: true })}`,
      body: images.length
        ? `<div class="meme-grid">${images.slice(0, 8).map((image) => `<button type="button" class="meme-thumb" data-act="show-memes" title="${esc(image.name)}"><img src="${esc(API.BASE + '/memes/image?id=' + image.id)}" alt="${esc(image.name)}" loading="lazy"><span>${esc(image.name)}</span></button>`).join('')}</div>`
        : emptyState({ iconName: 'image', title: '图库还是空的', body: '上传图片，或在聊天中收集后再审核。' })
    });
  }

  function groupChatPanel() {
    const route = '/plugins/groupchat';
    const state = extraOf(route);
    if (state.error) return card('群聊增强', { body: errorState({ title: '群聊增强读取失败', body: state.error, code: route }) });
    if (!state.value) return card('群聊增强', { desc: '正在读取群覆盖…', body: skeleton(3) });
    const value = state.value || {};
    if (!value.plugin) return card('群聊增强', { body: emptyState({ iconName: 'chat', title: '插件尚未安装', body: '安装群聊增强后，这里会显示每个群的参与概率与最近判断。' }) });
    const groups = Array.isArray(value.groups) ? value.groups : [];
    const rows = groups.map((group) => ({
      cells: [
        `<div class="t-main">${esc(mask(group.id))}</div><div class="t-sub">${esc(group.conversation || '')}</div>`,
        `<span class="t-num">${esc(pct(group.probability))}</span><div class="t-sub">最近 ${group.last_probability == null ? '—' : esc(pct(group.last_probability))}</div>`,
        `<div class="t-main" style="font-weight:400">${esc(group.last_reason || '—')}</div>`,
        `${group.paused ? badge('已暂停', 'badge-warn') : badge('参与中', 'badge-ok')}`,
        `<span class="t-num">${esc(group.active_jobs ?? 0)}</span>`,
        `<span class="t-num">${esc(group.members ?? 0)}</span>`
      ]
    }));
    return card('群聊增强', {
      desc: `AI ${value.ai_enabled ? '已开启' : '未开启'} · 群聊背景${value.context_enabled ? '已开启' : '未开启'} · 在线 ${value.online ? '是' : '否'}`,
      actions: linkBtn('编辑参与策略', 'plugins/group-chat-plus/config', { small: true }),
      body: groups.length
        ? table(['群', '参与概率', '最近判断', '状态', '任务', '成员'], rows)
        : emptyState({ iconName: 'chat', title: '还没有覆盖的群', body: '在插件配置里把群加入使用范围后，这里会出现真实状态。' })
    });
  }

  /* 背景壁纸与启动动画：都由插件提供，上传与预览留在插件页，参数在插件的配置页。 */
  function visualPanel(kind) {
    const isStartup = kind === 'startup-animation';
    const route = isStartup ? '/startup-animation' : '/background';
    const title = isStartup ? '启动动画' : '背景壁纸';
    const state = extraOf(route);
    if (state.error) return card(title, { body: errorState({ title: '读取失败', body: state.error, code: route }) });
    if (!state.value) return card(title, { desc: '正在读取…', body: skeleton(3) });
    const value = state.value || {};
    if (!value.installed) {
      return card(title, { body: emptyState({ iconName: 'image', title: '插件尚未安装', body: '安装后可以在这里上传素材。', action: btn('安装插件', { act: 'install-plugin', attrs: `data-kind="${esc(kind)}"`, small: true, kind: 'btn-primary' }) }) });
    }

    const src = (item) => (item && item.url ? API.BASE + item.url : '');
    const bgUrl = src(value.image);
    const logoUrl = src(value.logo);
    const videoUrl = src(value.video);
    const preview = isStartup
      ? (videoUrl
        ? `<div class="preview-image preview-video"><video src="${esc(videoUrl)}" controls muted playsinline preload="metadata"></video></div>`
        : logoUrl
          ? `<div class="preview-image"><img src="${esc(logoUrl)}" alt="启动 Logo"></div>`
          : `<div class="preview-image is-empty"><span>未上传 Logo 或视频，使用内置动画</span></div>`)
      : (bgUrl
        ? `<div class="preview-image"><img src="${esc(bgUrl)}" alt="背景图片"></div>`
        : `<div class="preview-image is-empty"><span>未上传背景图片</span></div>`);

    const upload = isStartup
      ? `${btn('上传 Logo', { act: 'visual-pick', attrs: 'data-target="sa-logo-file"', small: true, iconName: 'image' })}${logoUrl ? btn('移除 Logo', { act: 'visual-remove', attrs: `data-kind="${esc(kind)}" data-what="logo"`, small: true, kind: 'btn-ghost' }) : ''}
         ${btn('上传视频', { act: 'visual-pick', attrs: 'data-target="sa-video-file"', small: true, iconName: 'play' })}${videoUrl ? btn('移除视频', { act: 'visual-remove', attrs: `data-kind="${esc(kind)}" data-what="video"`, small: true, kind: 'btn-ghost' }) : ''}
         <input type="file" id="sa-logo-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
         <input type="file" id="sa-video-file" accept="video/mp4,video/webm" hidden>`
      : `${btn('上传图片', { act: 'visual-pick', attrs: 'data-target="bg-file"', small: true, iconName: 'image' })}${bgUrl ? btn('移除图片', { act: 'visual-remove', attrs: `data-kind="${esc(kind)}" data-what="image"`, small: true, kind: 'btn-ghost' }) : ''}
         <input type="file" id="bg-file" accept="image/png,image/jpeg,image/webp" hidden>`;

    const facts = isStartup ? [
      ['状态', value.enabled ? badge('已启用', 'badge-ok') : badge('未启用', 'badge-outline')],
      ['素材', value.video ? '自定义视频' : value.logo ? '自定义 Logo' : '内置动画'],
      ['预设', `<code>${esc(value.preset || '—')}</code>`],
      ['主题', `<code>${esc(value.theme || '—')}</code>`],
      ['最短时长', `${esc(value.min_ms ?? '—')} ms`],
      ['视频', value.video ? `${esc(value.video.format || 'mp4')} · ${esc(size(value.video.size || 0))}` : '—']
    ] : [
      ['状态', value.enabled ? badge('已应用', 'badge-ok') : badge('未应用', 'badge-outline')],
      ['尺寸', value.image ? `${esc(value.image.width)} × ${esc(value.image.height)}` : '—'],
      ['文件', value.image ? `${esc(String(value.image.format || '').toUpperCase())} · ${esc(size(value.image.size || 0))}` : '—'],
      ['适应方式', `<code>${esc(value.mode || '—')}</code>`],
      ['模糊 / 遮罩', `${esc(value.blur ?? 0)} / ${esc(value.veil ?? 0)}`],
      ['面板不透明度', `${esc(value.panel ?? '—')}`]
    ];

    return card(title, {
      desc: isStartup ? '桌面启动时播放；下次启动生效。' : '工作台背景，仅存本机。',
      actions: linkBtn('参数设置', 'plugins/' + kind + '/config', { small: true }),
      body: `<div class="visual-panel">
        <div class="visual-media">${preview}</div>
        <div class="visual-body">
          <div class="btn-row">${upload}</div>
          ${kv(facts)}
        </div>
      </div>`
    });
  }

  /** 上传按钮与文件输入的绑定；只在插件概览页存在这些元素时生效。 */
  let visualBusy = false;
  function mountVisual() {
    const readAsDataUrl = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取这个文件。'));
      reader.readAsDataURL(file);
    });
    const refresh = (route, result, message) => {
      S.extra[route] = { value: result, error: null, at: Date.now() };
      toast(message, 'check');
      render({ keepScroll: true });
    };

    const bind = (inputId, handler) => {
      const input = $('#' + inputId);
      if (!input) return;
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file || visualBusy) return;
        visualBusy = true;
        try { await handler(file); }
        catch (error) { toast(error.message || '上传失败', 'alert'); }
        finally { input.value = ''; visualBusy = false; }
      };
    };

    bind('bg-file', async (file) => {
      if (file.size > 8 * 1024 * 1024) throw new Error('背景图片不能超过 8 MiB。');
      const data = await readAsDataUrl(file);
      refresh('/background', await API.background({ action: 'upload', data }), '背景图片已更新');
    });

    bind('sa-logo-file', async (file) => {
      if (file.size > 2 * 1024 * 1024) throw new Error('Logo 不能超过 2 MiB。');
      const data = await readAsDataUrl(file);
      refresh('/startup-animation', await API.startup({ action: 'upload-logo', data }), 'Logo 已更新');
    });

    bind('sa-video-file', async (file) => {
      if (file.size > 40 * 1024 * 1024) throw new Error('视频不能超过 40 MiB。');
      if (!/^video\//i.test(file.type || '')) throw new Error('请选择 MP4 或 WebM 视频。');
      refresh('/startup-animation', await API.startupVideo(file), '视频已上传，下次启动生效');
    });
  }

  function pluginEvents(plugin) {
    const entries = logsOf().filter((entry) => {
      const fields = entry.fields || {};
      const text = JSON.stringify(fields);
      return fields.plugin === plugin.id || fields.plugin === plugin.kind || text.includes(plugin.kind) || text.includes(plugin.name) || String(entry.event || '').includes(plugin.kind);
    }).slice(-30).reverse();
    return entries.length
      ? `<div>${entries.map((entry) => `<div class="log-line"><span class="time">${esc(clock(entry.time))}</span><span class="lvl" data-l="${esc(entry.level || 'info')}">${esc(String(entry.level || 'info').toUpperCase())}</span><span class="ev">${esc(entry.event || 'event')}</span><span class="detail">${esc(logDetail(entry))}</span></div>`).join('')}</div>`
      : emptyState({ iconName: 'activity', title: '还没有这个插件的事件', body: '进程内事件缓冲最多保留 1000 条；插件运行后会在这里出现诊断记录。' });
  }

  function viewPluginDetail() {
    const [, key, tab = 'overview'] = path.split('/');
    const plugin = pluginByKey(key);
    if (!plugin) {
      return {
        html: pageHead({ title: '插件与扩展' }) + emptyState({
          iconName: 'grid', title: '这个插件不在当前工作区',
          body: S.loaded ? '它可能已被删除或尚未安装。' : '正在读取插件列表。',
          action: S.loaded ? linkBtn('返回插件列表', 'plugins', { small: true }) : ''
        })
      };
    }
    const extraKey = 'plugin:' + plugin.id;
    const extra = S.extra[extraKey];
    if (!extra || extra.loading || !extra.value) {
      if (extra && extra.error) return { html: pluginHero(plugin, tab) + card('插件详情', { body: errorState({ title: '详情读取失败', body: extra.error, code: extraKey }) }) };
      return {
        html: pluginHero(plugin, tab) + card('正在读取插件详情', { body: formSkeleton() }),
        mount: () => {
          const entry = S.extra[extraKey];
          if (!entry || (!entry.loading && !entry.value)) loadPluginDetail(plugin).catch(() => {});
        }
      };
    }
    const detail = extra.value;
    let body = '';
    if (tab === 'overview') body = pluginOverview(plugin, detail);
    else if (tab === 'config') body = pluginConfig(plugin, detail);
    else body = card('事件', { desc: '只含这个插件的事件。', body: pluginEvents(plugin) });
    const mount = tab === 'config' ? mountPluginConfig : tab === 'overview' ? mountVisual : null;
    return { html: pluginHero(plugin, tab) + body, mount };
  }

  function pluginHero(plugin, tab) {
    const tabs = [['overview', '概览'], ['config', '配置'], ['events', '事件']];
    const isSpecial = ['group-chat-plus', 'living-memory', 'meme-manager', 'startup-animation', 'background', 'voicestudio'].includes(plugin.kind);
    return `<div class="plugin-hero">
        <span class="plugin-hero-icon">${icon(pluginIcon(plugin.kind))}</span>
        <div class="hero-text">
          <h1>${esc(plugin.name)} ${plugin.enabled ? badge('已启用', 'badge-ok') : badge('已停用', 'badge-outline')}</h1>
          <p>${esc(plugin.description || '该插件没有提供说明。')}</p>
          <div class="pc-meta"><span>${esc(plugin.kind)}</span><span>v${esc(plugin.version || '—')}</span><span>${esc(plugin.author || '未知作者')}</span>${isSpecial ? '<span>专属管理</span>' : ''}</div>
        </div>
        <div class="hero-actions">
          <label class="pc-switch"><input class="switch" type="checkbox" data-act="toggle-plugin" data-id="${esc(plugin.id)}" data-kind="${esc(plugin.kind)}" data-revision="${esc(plugin.revision)}" ${plugin.enabled ? 'checked' : ''}>${plugin.enabled ? '运行中' : '已停止'}</label>
        </div>
      </div>
      <div class="tabs" role="tablist">${tabs.map(([id, label]) => `<a role="tab" href="#/plugins/${esc(pluginKey(plugin))}${id === 'overview' ? '' : '/' + id}" aria-selected="${id === tab}">${label}</a>`).join('')}</div>`;
  }

  function pluginOverview(plugin, detail) {
    const scope = detail.scope || plugin.scope || {};
    const scopeText = [
      scope.all_private ? '全部私聊' : (scope.private_users || []).length ? `${(scope.private_users || []).length} 个好友` : '不接收私聊',
      scope.all_groups ? '全部群聊' : (scope.groups || []).length ? `${(scope.groups || []).length} 个群` : '不接收群聊',
      scope.require_at ? '群聊需 @' : '群聊无需 @'
    ].join(' · ');
    const tools = Array.isArray(detail.tools) ? detail.tools : [];
    let special = '';
    if (plugin.kind === 'group-chat-plus') { loadExtra('/plugins/groupchat'); special = groupChatPanel(); }
    else if (plugin.kind === 'living-memory') { loadExtra('/plugins/memory'); special = memoryPanel(); }
    else if (plugin.kind === 'meme-manager') { loadExtra('/memes'); special = memesPanel(); }
    else if (plugin.kind === 'startup-animation') { loadExtra('/startup-animation'); special = visualPanel(plugin.kind); }
    else if (plugin.kind === 'background') { loadExtra('/background'); special = visualPanel(plugin.kind); }
    return `${special}
    <div class="grid-2" style="margin-top:12px">
      <div>
        ${card('安装信息', {
          body: kv([
            ['插件编号', `<code>${esc(plugin.id)}</code>`],
            ['类型', `<code>${esc(plugin.kind)}</code>`],
            ['版本', esc(plugin.version || '—')],
            ['作者', esc(plugin.author || '—')],
            ['优先级', esc(plugin.priority ?? '—')],
            ['执行时限', `${esc(plugin.timeout_ms ?? '—')} ms`],
            ['触发前缀', plugin.trigger ? `<code>${esc(plugin.trigger)}</code>` : '无'],
            ['更新时间', esc(stamp(plugin.updated_at))]
          ])
        })}
        ${card('运行统计', {
          body: kv([
            ['累计运行', `${esc(plugin.runs ?? 0)} 次`],
            ['失败', `${esc(plugin.failures ?? 0)} 次`],
            ['最近运行', plugin.last_run ? esc(stamp(plugin.last_run)) : '还没有运行'],
            ['最近错误', plugin.last_error ? badge(plugin.last_error, 'badge-bad') : badge('无', 'badge-ok')]
          ])
        })}
      </div>
      <div>
        ${handlesMessages(plugin) ? card('作用范围', { desc: '范围不匹配不会被调用。', actions: btn('编辑范围', { go: 'plugins/' + pluginKey(plugin) + '/config', small: true }), body: `<p class="inline-note">${esc(scopeText)}</p>` }) : ''}
        ${card('可用工具', { desc: `${tools.length} 个工具注册给 Agent。`, body: tools.length ? `<div class="tool-list">${tools.map((tool) => `<code>${esc(tool.name || tool)}</code>`).join('')}</div>` : '<p class="inline-note">这个插件没有向 Agent 提供工具。</p>' })}
        ${card('危险操作', { body: `<p class="inline-note">删除会移除插件配置与注册，已产生的数据不会自动清理。</p><div class="btn-row" style="margin-top:10px">${btn('删除插件', { act: 'delete-plugin', attrs: `data-id="${esc(plugin.id)}" data-revision="${esc(plugin.revision)}" data-name="${esc(plugin.name)}"`, small: true, kind: 'btn-danger', iconName: 'trash' })}</div>` })}
      </div>
    </div>
    ${card('最近事件', { desc: '按时间倒序。', actions: btn('查看全部日志', { go: 'data/logs', small: true }), body: pluginEvents(plugin) })}`;
  }

  function pluginConfig(plugin, detail) {
    const schema = detail.config_schema || {};
    const config = detail.config || {};
    const scope = detail.scope || {};
    const groupOnly = plugin.kind === 'group-chat-plus';
    const sourceEditor = plugin.kind === 'script'
      ? card('插件源码', {
        desc: '拥有本机 Node.js 权限，只运行可信代码。',
        body: `<textarea class="textarea" data-plugin-source="1" rows="18" spellcheck="false" style="font-family:var(--mono);font-size:11.5px;line-height:1.7">${esc(detail.source || '')}</textarea><p class="help">入口需使用 <code>export default async function</code>，返回 <code>{ reply }</code>、<code>{ message }</code> 或 <code>null</code>。</p>`
      })
      : '';
    const scriptMeta = plugin.kind === 'script'
      ? card('执行参数', {
        desc: '触发前缀、优先级与执行时限。',
        body: `<div class="fields">
          <div class="field"><label for="ps-trigger">触发前缀</label><input class="input" id="ps-trigger" data-plugin-trigger value="${esc(detail.trigger || '')}" autocomplete="off"></div>
          <div class="field"><label for="ps-priority">优先级</label><input class="input" id="ps-priority" data-plugin-priority inputmode="numeric" value="${esc(detail.priority ?? 0)}"></div>
          <div class="field"><label for="ps-timeout">执行时限（毫秒）</label><input class="input" id="ps-timeout" data-plugin-timeout inputmode="numeric" value="${esc(detail.timeout_ms ?? 3000)}"></div>
        </div>`
      })
      : '';
    const scopeCard = handlesMessages(plugin) ? card('作用范围', {
      desc: '启用前至少选一个好友、群或“全部”。',
      body: `<div class="fields">
        ${groupOnly ? '' : `
          <div class="field"><div class="toggle-row"><input class="switch" type="checkbox" id="scope-all-private" data-plugin-all-private ${scope.all_private ? 'checked' : ''}><span class="toggle-text"><label for="scope-all-private">全部私聊</label>${HINTS ? '<span class="help">所有私聊消息都交给插件。</span>' : ''}</span></div></div>
          <div class="field"><label for="scope-users">好友 QQ</label><input class="input" id="scope-users" data-plugin-users value="${esc((scope.private_users || []).join(','))}" placeholder="QQ 号，逗号分隔" autocomplete="off"></div>`}
        <div class="field"><div class="toggle-row"><input class="switch" type="checkbox" id="scope-all-groups" data-plugin-all-groups ${scope.all_groups ? 'checked' : ''}><span class="toggle-text"><label for="scope-all-groups">全部群聊</label>${HINTS ? '<span class="help">仍会遵守 AI 群白名单与屏蔽规则。</span>' : ''}</span></div></div>
        <div class="field"><label for="scope-groups">群号</label><input class="input" id="scope-groups" data-plugin-groups value="${esc((scope.groups || []).join(','))}" placeholder="群号，逗号分隔" autocomplete="off"></div>
        <div class="field wide"><div class="toggle-row"><input class="switch" type="checkbox" id="scope-require-at" data-plugin-require-at ${scope.require_at !== false ? 'checked' : ''}><span class="toggle-text"><label for="scope-require-at">群聊需要 @机器人</label>${HINTS ? '<span class="help">关闭后，范围内的普通群消息也会触发插件。</span>' : ''}</span></div></div>
      </div>`
    }) : '';
    const groups = {};
    Object.entries(schema).forEach(([key, field]) => {
      const group = field.group || '常规';
      (groups[group] = groups[group] || []).push([key, field]);
    });
    if (!Object.keys(schema).length) {
      return `<form id="plugin-form" data-id="${esc(plugin.id)}" data-revision="${esc(detail.revision ?? plugin.revision)}" data-kind="${esc(plugin.kind)}">
        ${card('插件配置（JSON）', {
          desc: '没有 schema，直接编辑配置对象。',
          body: `<textarea class="textarea" data-plugin-json="1" rows="14" spellcheck="false" style="font-family:var(--mono);font-size:11.5px;line-height:1.7">${esc(pretty(config))}</textarea>`
        })}
        ${sourceEditor}
        ${scriptMeta}
        ${scopeCard}
        <div class="savebar savebar-static" data-dirty="false"><div class="state-line"><span class="dot"></span><span>保存前请确认 JSON 合法</span></div><div class="btn-row">${btn('重新载入', { act: 'reload-plugin', small: true, kind: 'btn-ghost' })}${btn('保存插件配置', { act: 'save-plugin', small: true, kind: 'btn-primary', iconName: 'check' })}</div></div>
      </form>`;
    }
    const rendered = Object.entries(groups).map(([name, fields]) => `<div class="schema-group"><h3>${esc(name)}</h3><div class="fields">${fields.map(([key, field]) => schemaControl(key, field, config[key])).join('')}</div></div>`).join('');
    return `<form id="plugin-form" data-id="${esc(plugin.id)}" data-revision="${esc(detail.revision ?? plugin.revision)}" data-kind="${esc(plugin.kind)}">
      ${card('插件配置', { desc: '由插件 schema 生成，保存时校验。', body: rendered })}
      ${sourceEditor}
      ${scriptMeta}
      ${scopeCard}
      <div class="savebar savebar-static" data-dirty="false"><div class="state-line"><span class="dot"></span><span id="plugin-save-text">保存后立即调用插件校验</span></div><div class="btn-row">${btn('重新载入', { act: 'reload-plugin', small: true, kind: 'btn-ghost' })}${btn('保存插件配置', { act: 'save-plugin', small: true, kind: 'btn-primary', iconName: 'check' })}</div></div>
    </form>`;
  }

  function schemaControl(key, field, value) {
    const id = 'p-' + key;
    const label = field.description || key;
    const hint = HINTS && field.hint ? `<p class="hint">${esc(field.hint)}</p>` : '';
    const wide = ['text', 'list', 'object'].includes(field.type);
    if (field.type === 'bool') {
      return `<div class="schema-field wide"><div class="toggle-row"><input class="switch" type="checkbox" id="${id}" data-schema="${esc(key)}" data-type="bool" ${value === true ? 'checked' : ''}><span class="toggle-text"><label for="${id}">${esc(label)}</label>${HINTS && field.hint ? `<span class="help">${esc(field.hint)}</span>` : ''}</span></div></div>`;
    }
    if (field.type === 'object') {
      return `<div class="schema-field wide"><label>${esc(label)}</label><textarea class="textarea" id="${id}" data-schema="${esc(key)}" data-type="object" rows="4">${esc(pretty(value || {}))}</textarea><p class="hint">${esc(field.hint || 'JSON 对象；保存前会校验。')}</p></div>`;
    }
    let control;
    if (field.type === 'text') control = `<textarea class="textarea" id="${id}" data-schema="${esc(key)}" data-type="text" rows="4">${esc(value ?? '')}</textarea>`;
    else if (field.type === 'list') control = `<textarea class="textarea" id="${id}" data-schema="${esc(key)}" data-type="list" rows="3">${esc((Array.isArray(value) ? value : []).join('\n'))}</textarea>`;
    else if (field.options) control = `<select class="select" id="${id}" data-schema="${esc(key)}" data-type="string">${field.options.map((option) => `<option value="${esc(option)}" ${String(value) === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
    else if (field.type === 'int' || field.type === 'float') {
      const slider = field.slider ? `<input type="range" min="${esc(field.slider.min)}" max="${esc(field.slider.max)}" step="${esc(field.slider.step)}" value="${esc(value ?? field.default ?? 0)}" data-range="${esc(key)}">` : '';
      control = `${slider}<div class="row"><input class="input" id="${id}" data-schema="${esc(key)}" data-type="${field.type}" inputmode="decimal" value="${esc(value ?? field.default ?? 0)}">${field.slider ? `<span class="range-hint">${esc(field.slider.min)} – ${esc(field.slider.max)}</span>` : ''}</div>`;
    } else if (field.secret) control = `<input class="input" id="${id}" data-schema="${esc(key)}" data-type="string" data-secret="1" type="password" value="${esc(value ?? '')}" autocomplete="new-password">`;
    else control = `<input class="input" id="${id}" data-schema="${esc(key)}" data-type="string" value="${esc(value ?? '')}" autocomplete="off">`;
    return `<div class="schema-field ${wide || field.type === 'text' ? 'wide' : ''}"><label for="${id}">${esc(label)}${field.secret ? ' ' + badge('敏感', 'badge-outline') : ''}</label>${control}${hint}</div>`;
  }

  async function loadPluginDetail(plugin) {
    const key = 'plugin:' + plugin.id;
    S.extra[key] = { ...(S.extra[key] || {}), loading: true };
    try {
      const value = await API.get('/plugins/detail?id=' + encodeURIComponent(plugin.id));
      S.extra[key] = { value, error: null, at: Date.now() };
      if (path.startsWith('plugins/')) render({ keepScroll: true });
    } catch (error) {
      S.extra[key] = { value: null, error: error.message, at: Date.now() };
      if (path.startsWith('plugins/')) render({ keepScroll: true });
    }
  }

  function loadExtra(route) {
    const current = S.extra[route];
    if (current && (current.loading || Date.now() - (current.at || 0) < 15000)) return;
    S.extra[route] = { ...(current || {}), loading: true };
    API.get(route).then((value) => {
      S.extra[route] = { value, error: null, at: Date.now() };
    }).catch((error) => {
      S.extra[route] = { value: null, error: error.message, at: Date.now() };
    }).finally(() => {
      if (path.startsWith('plugins/') || path === 'settings') render({ keepScroll: true });
    });
  }

  function mountPluginConfig() {
    const formEl = $('#plugin-form');
    if (!formEl) return;
    formEl.addEventListener('submit', (event) => event.preventDefault());
    formEl.addEventListener('input', (event) => {
      const range = event.target.closest('[data-range]');
      if (range) {
        const key = range.dataset.range;
        const input = formEl.querySelector(`[data-schema="${CSS.escape(key)}"]`);
        if (input) input.value = range.value;
      }
    });
  }

  async function savePlugin() {
    const formEl = $('#plugin-form');
    if (!formEl) return;
    const id = formEl.dataset.id, revision = Number(formEl.dataset.revision);
    const detail = (S.extra['plugin:' + id] || {}).value;
    if (!detail) return;
    let config = { ...(detail.config || {}) };
    try {
      const rawEditor = formEl.querySelector('[data-plugin-json]');
      if (rawEditor) {
        config = JSON.parse(rawEditor.value || '{}');
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是 JSON 对象');
      } else {
        $$('[data-schema]', formEl).forEach((el) => {
          const key = el.dataset.schema, type = el.dataset.type;
          if (type === 'bool') config[key] = el.checked;
          else if (type === 'int') {
            const number = Number(el.value);
            if (!Number.isSafeInteger(number)) throw new Error(key + ' 必须是整数');
            config[key] = number;
          } else if (type === 'float') {
            const number = Number(el.value);
            if (!Number.isFinite(number)) throw new Error(key + ' 必须是数字');
            config[key] = number;
          } else if (type === 'list') config[key] = el.value.split('\n').map((v) => v.trim()).filter(Boolean);
          else if (type === 'object') {
            try { config[key] = JSON.parse(el.value || '{}'); }
            catch { throw new Error(key + ' 不是有效的 JSON'); }
          } else config[key] = el.value;
        });
      }
      const sourceEl = formEl.querySelector('[data-plugin-source]');
      const payload = { ...detail, config, ...(sourceEl ? { source: sourceEl.value } : {}) };
      const groupsEl = formEl.querySelector('[data-plugin-groups]');
      if (groupsEl) {
        const split = (value) => String(value || '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
        const usersEl = formEl.querySelector('[data-plugin-users]');
        payload.trigger = (formEl.querySelector('[data-plugin-trigger]') || {}).value ?? payload.trigger;
        if (formEl.querySelector('[data-plugin-priority]')) payload.priority = Number(formEl.querySelector('[data-plugin-priority]').value || 0);
        if (formEl.querySelector('[data-plugin-timeout]')) payload.timeout_ms = Number(formEl.querySelector('[data-plugin-timeout]').value || 3000);
        payload.scope = {
          ...(detail.scope || {}),
          all_private: !!(formEl.querySelector('[data-plugin-all-private]') || {}).checked,
          private_users: usersEl ? split(usersEl.value) : [],
          all_groups: !!(formEl.querySelector('[data-plugin-all-groups]') || {}).checked,
          groups: split(groupsEl.value),
          require_at: !!(formEl.querySelector('[data-plugin-require-at]') || {}).checked
        };
      } else if (formEl.querySelector('[data-plugin-trigger]')) {
        payload.trigger = formEl.querySelector('[data-plugin-trigger]').value;
        if (formEl.querySelector('[data-plugin-priority]')) payload.priority = Number(formEl.querySelector('[data-plugin-priority]').value || 0);
        if (formEl.querySelector('[data-plugin-timeout]')) payload.timeout_ms = Number(formEl.querySelector('[data-plugin-timeout]').value || 3000);
      }
      const saved = await API.savePlugin(id, revision, payload);
      S.extra['plugin:' + id] = { value: saved, error: null, at: Date.now() };
      await API.loadAll();
      toast('插件配置已保存', 'check');
      render({ keepScroll: true });
    } catch (error) { toast('保存失败：' + error.message, 'alert'); }
  }

  /* ------------------------------------------------------------- 工作台 */

  function viewDashboard() {
    const counts = jobCounts();
    const state = S.state || {};
    if (!S.loaded && !S.errors.state) {
      return { html: pageHead({ title: '工作台', desc: '在线、队列与待核对。' }) + skeleton(6) };
    }
    if (S.errors.state) {
      return { html: pageHead({ title: '工作台', desc: '在线、队列与待核对。' }) + region('state', '') };
    }
    const online = !!state.online;
    const logs = logsOf().slice(-8).reverse();
    const recent = jobsList().slice(0, 6);
    const stat = (label, value, note, tone = '') => `<div class="stat" data-tone="${tone}"><span class="k">${esc(label)}</span><b>${esc(value)}</b><small>${esc(note)}</small></div>`;
    const stats = `<div class="stats">
      ${stat('待处理', count(counts.pending), '排队 / 生成 / 待发送')}
      ${stat('已完成', count(counts.done), '已确认送达', counts.done ? 'ok' : '')}
      ${stat('需要核对', count(counts.uncertain), '结果未知，需人工确认', counts.uncertain ? 'warn' : '')}
      ${stat('失败', count(counts.failed), '含过期与生成失败', counts.failed ? 'bad' : '')}
    </div>`;
    const statusBlock = {
      title: '运行状态',
      desc: online ? '服务正在处理消息。' : 'QQ 未登录；配置与插件仍可维护。',
      actions: `${btn('刷新', { act: 'refresh', small: true, iconName: 'refresh' })}${state.can_restart ? btn('重启', { act: 'restart', small: true }) : ''}`,
      body: `<div class="grid-2">
        <div>${kv([
          ['QQ', online ? dotBadge('在线', 'ok') : dotBadge(STATE_LABEL[state.state] || '离线', 'warn')],
          ['账号', `<code>${esc(state.account ? mask(state.account) : '未登录')}</code>`],
          ['驱动', `<code>${esc(state.driver || '—')}</code>`],
          ['内核版本', `<code>${esc(state.version || '—')}</code>`]
        ])}</div>
        <div>${kv([
          ['AI 回复', state.ai_enabled ? badge('已启用', 'badge-ok') : badge('未启用', 'badge-outline')],
          ['模型', `<code>${esc((S.settings && S.settings.values.AI_MODEL) || '未配置')}</code>`],
          ['服务地址', `<code>${esc(state.endpoint || '—')}</code>`],
          ['任务总数', `${esc(count(counts.total))} 条`],
          ['已忽略', `${esc(count(counts.ignored))} 条`]
        ])}</div>
      </div>`
    };
    const activity = logs.length
      ? `<div class="log-list">${logs.map((entry) => `<div class="log-line"><span class="time">${esc(clock(entry.time))}</span><span class="lvl" data-l="${esc(entry.level || 'info')}">${esc(String(entry.level || 'info').toUpperCase())}</span><span class="ev">${esc(entry.event || 'event')}</span><span class="detail">${esc(logDetail(entry))}</span></div>`).join('')}</div>`
      : emptyState({ iconName: 'activity', title: '还没有运行事件', body: '服务启动、配置保存、消息收发都会记录在进程内缓冲里。' });
    const recentTable = recent.length ? table(['任务', '会话', '状态', '更新'], recent.map((job) => {
      const [label, kind] = jobStatus(job.status);
      return { attr: `data-select="job:${esc(job.id)}" style="cursor:pointer"`, cells: [`<span class="t-mono">#${esc(job.id)}</span>`, `<span class="t-main">${esc(conversationLabel(job.conversation))}</span>`, badge(label, kind), `<span class="t-time">${esc(rel(job.updated_at))}</span>`] };
    })) : emptyState({ iconName: 'inbox', title: '还没有任务', body: '收到白名单消息后，任务会出现在这里。' });

    return {
      html: pageHead({
        title: '工作台',
        desc: '在线、队列与待核对。',
        actions: `${linkBtn('数据与日志', 'data/jobs', { small: true, iconName: 'inbox' })}${linkBtn('对话测试', 'chat', { small: true, iconName: 'chat' })}`
      }) +
        (S.errors.state ? region('state', '') : '') +
        (S.errors.settings ? `<div class="banner banner-warn" role="status">${icon('info')}<div><b>配置读取失败。</b>就绪检查可能不准确；其余运行读数仍来自服务。</div></div>` : '') +
        readyStrip() + stats +
        `<div style="margin-top:16px">${panel([
          statusBlock,
          { title: '最近任务', desc: '最近 6 条，点击看详情。', actions: linkBtn('全部任务', 'data/jobs', { small: true }), body: recentTable },
          { title: '最近活动', desc: `进程内事件缓冲，最多 ${esc((state.privacy && state.privacy.memory_limit) || 1000)} 条。`, actions: linkBtn('全部日志', 'data/logs', { small: true }), body: activity }
        ])}</div>`
    };
  }

  /* ------------------------------------------------------------- 对话测试 */

  function webSessions() {
    const sessions = (S.agent && Array.isArray(S.agent.sessions)) ? S.agent.sessions : [];
    return sessions.filter((session) => String(session.conversation || '').startsWith('web:'));
  }

  function chatJobs() {
    return chatHistory && Array.isArray(chatHistory.jobs) ? chatHistory.jobs : [];
  }

  function webSessionListHTML() {
    const sessions = webSessions();
    if (!sessions.length) return '<p class="inline-note" style="padding:10px">还没有网页会话。发送第一条消息后会自动创建。</p>';
    return sessions.map((session) => {
      const id = String(session.conversation).slice(4);
      return `<button type="button" class="session-item" data-act="chat-pick" data-session="${esc(id)}" aria-current="${chatSession === id}"><b>网页试聊 · ${esc(id.slice(0, 6))}</b><small>${esc(count(session.jobs))} 条任务 · ${esc(rel(session.updated_at))}</small></button>`;
    }).join('');
  }

  function chatThread() {
    const jobs = chatJobs();
    if (!chatHistory) return `<div class="thread-empty">正在读取会话…</div>`;
    if (!jobs.length) return `<div class="thread-empty">这是一个新的网页会话。<br>发送一条消息后，Agent 会在这里回复；不会发送到 QQ。</div>`;
    return jobs.map((job) => {
      const [label, kind] = jobStatus(job.status);
      const pending = ['queued', 'generating', 'ready', 'sending'].includes(job.status);
      const user = `<div class="msg" data-role="user"><span class="who">我</span><div><div class="m-head"><b>你</b><span>${esc(stamp(job.updated_at))}</span></div><div class="m-text">${esc(job.input || '（空消息）')}</div></div></div>`;
      const replyText = job.reply ? esc(job.reply) : pending ? '' : job.status === 'failed' ? `生成失败：${esc(job.reason || '未知原因')}` : job.status === 'ignored' ? `未回复：${esc(job.reason || '已忽略')}` : '（没有正文）';
      const assistant = `<div class="msg ${pending ? 'pending' : ''}" data-role="assistant"><span class="who">AI</span><div>
        <div class="m-head"><b>Agent</b><span>#${esc(job.id)}</span>${badge(label, kind)}</div>
        <div class="m-text">${replyText}</div>
        <div class="m-foot"><button type="button" class="link-btn" data-act="chat-job" data-id="${esc(job.id)}">查看执行步骤</button>${job.generation && job.generation.total ? `<span>生图 ${esc(job.generation.done ?? 0)}/${esc(job.generation.total)}</span>` : ''}</div>
      </div></div>`;
      return user + assistant;
    }).join('');
  }

  function viewChat() {
    if (!S.agent) return { html: pageHead({ title: '对话测试' }) + region('agent', '') };
    const agent = S.agent || {};
    const sessions = webSessions();
    if (!chatSession && sessions.length) chatSession = sessions[0].conversation.slice(4);
    if (!chatSession) {
      chatSession = crypto.randomUUID();
      localStorage.setItem('limen-chat-session', chatSession);
    }
    const list = webSessionListHTML();
    const model = agent.model || (S.settings && S.settings.values.AI_MODEL) || '';
    const aiReady = !!(agent.ai_enabled && model && agent.enabled);
    const disabled = !aiReady || chatBusy;
    const banner = !aiReady
      ? `<div class="banner banner-warn" role="status">${icon('info')}<div><b>还不能对话。</b>${!agent.enabled ? 'Agent 执行未启用。' : agent.ai_enabled ? '尚未配置模型标识。' : 'AI 自动回复未启用。'}这些开关只影响网页试聊与 QQ 回复，测试消息不会发到 QQ。<a class="link-btn" href="#/config/ai">去配置</a></div></div>`
      : '';
    const side = `<div class="side-card">
      <h3>本次会话</h3>
      <p>${esc(model || '未配置模型')}</p>
      ${kv([
        ['Agent', agent.enabled ? badge('已启用', 'badge-ok') : badge('已关闭', 'badge-outline')],
        ['步数上限', esc(agent.max_steps ?? '—')],
        ['工具上限', esc(agent.max_tool_calls ?? '—')],
        ['超时', `${esc(Math.round((agent.timeout_ms || 0) / 1000))} 秒`]
      ])}
      <div class="btn-row">${btn('新会话', { act: 'chat-new', small: true, iconName: 'plus' })}${btn('刷新', { act: 'chat-refresh', small: true, iconName: 'refresh' })}</div>
    </div>
    <div class="side-card">
      <h3>可用工具</h3>
      <p>${esc((agent.tools || []).filter((tool) => tool.enabled !== false).length)} 个工具</p>
      <a class="link-btn" href="#/plugins">管理插件</a>
    </div>`;
    return {
      html: pageHead({
        title: '对话测试',
        desc: '用当前配置试聊，不发 QQ。',
        actions: `${btn('新会话', { act: 'chat-new', small: true, iconName: 'plus' })}`
      }) + banner +
        `<div class="chat-shell">
          <section class="card chat-sessions" style="margin:0">
            <div class="card-head"><div><h2>网页会话</h2></div></div>
            <div class="session-list">${list}</div>
          </section>
          <section class="card" style="margin:0">
            <div class="card-head"><div><h2>${chatSession ? '会话 · ' + esc(chatSession.slice(0, 6)) : '网页试聊'}</h2>${chatBusy ? '<p class="desc">Agent 正在生成回复…</p>' : ''}</div><div class="btn-row">${btn('清空输入', { act: 'chat-clear', small: true, kind: 'btn-ghost' })}</div></div>
            <div class="thread" id="chat-thread">${chatThread()}</div>
            <div class="composer">
              <textarea id="chat-input" placeholder="${aiReady ? '描述你想让 Agent 做的事…' : '先配置模型与 AI 开关'}" ${disabled ? 'disabled' : ''}></textarea>
              <div class="composer-foot"><span>${aiReady ? '不会发送到 QQ · 生成过程可在任务详情查看' : '当前不可发送'}</span><div class="btn-row">${btn(chatBusy ? '生成中…' : '发送', { act: 'chat-send', small: true, kind: 'btn-primary', iconName: 'send', disabled })}</div></div>
            </div>
          </section>
          <aside class="stack chat-side" style="gap:12px">
            ${side}
          </aside>
        </div>`,
      mount: mountChat
    };
  }

  async function mountChat() {
    if (!chatSession) {
      chatSession = crypto.randomUUID();
      localStorage.setItem('limen-chat-session', chatSession);
    }
    await loadChat();
    const thread = $('#chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (chatClose) { chatClose(); chatClose = null; }
    chatClose = API.chatStream(chatSession, (value) => {
      if (!value || value.session !== chatSession) return;
      chatHistory = value;
      updateChatThread();
    }, () => {});
    if (chatPoll) clearInterval(chatPoll);
    chatPoll = setInterval(async () => {
      if (!location.hash.includes('chat')) { clearInterval(chatPoll); chatPoll = null; return; }
      if (document.hidden) return;
      try {
        const value = await API.get('/agent/chat?session=' + encodeURIComponent(chatSession));
        if (value) { chatHistory = value; updateChatThread(); }
      } catch { /* SSE 仍可用 */ }
    }, 4000);
    const input = $('#chat-input');
    if (input) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          sendChat();
        }
      });
      input.focus();
    }
  }

  async function loadChat() {
    if (!chatSession) { chatHistory = { session: '', jobs: [] }; updateChatThread(); return; }
    try {
      chatHistory = await API.get('/agent/chat?session=' + encodeURIComponent(chatSession));
    } catch (error) {
      if (error.status === 400) { chatHistory = { session: chatSession, jobs: [] }; return; }
      chatHistory = null;
      toast('读取会话失败：' + error.message, 'alert');
    }
    updateChatThread();
  }

  function updateChatThread() {
    const thread = $('#chat-thread');
    if (!thread) return;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    thread.innerHTML = chatThread();
    if (nearBottom) thread.scrollTop = thread.scrollHeight;
  }

  async function sendChat() {
    if (chatBusy) return;
    const input = $('#chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    chatBusy = true;
    input.value = '';
    const send = $('[data-act="chat-send"]');
    if (send) { send.disabled = true; send.textContent = '生成中…'; }
    try {
      await API.chat(chatSession, text);
      await loadChat();
      try {
        S.agent = await API.get('/agent');
        const list = $('.session-list');
        if (list) list.innerHTML = webSessionListHTML();
      } catch { /* 会话列表下次轮询会更新 */ }
      const thread = $('#chat-thread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    } catch (error) {
      toast('发送失败：' + error.message, 'alert');
      input.value = text;
    } finally {
      chatBusy = false;
      const button = $('[data-act="chat-send"]');
      if (button) { button.disabled = false; button.innerHTML = icon('send') + '发送'; }
      const box = $('#chat-input');
      if (box) box.focus();
    }
  }

  async function openChatJob(id) {
    try {
      const value = await API.get('/job?id=' + encodeURIComponent(id));
      openJobDrawer(value);
    } catch (error) { toast('读取任务失败：' + error.message, 'alert'); }
  }

  /* ------------------------------------------------------------- 数据与日志 */

  const dataTab = () => (path.startsWith('data/') ? path.split('/')[1] : 'messages');

  function viewData() {
    const tab = dataTab();
    if (!S.loaded) {
      return { html: pageHead({ title: '数据与日志', desc: '同一链路的三个截面。' }) + skeleton(6) };
    }
    const counts = jobCounts();
    const messages = messagesOf().slice().reverse();
    const jobs = jobsList();
    const logs = logsOf().slice().reverse();
    const stateError = S.errors.state
      ? `<div class="banner banner-bad" role="status">${icon('alert')}<div><b>运行状态读取失败。</b>下面的任务与事件缓冲可能不是最新；统计数字来自上一次成功读取。</div></div>`
      : '';
    const strip = `<div class="stats">
      <div class="stat"><span class="k">缓冲消息</span><b>${esc(count(messages.length))}</b></div>
      <div class="stat"><span class="k">待处理任务</span><b>${esc(count(counts.pending))}</b></div>
      <div class="stat" data-tone="warn"><span class="k">需要核对</span><b>${esc(count(counts.uncertain))}</b></div>
      <div class="stat" data-tone="bad"><span class="k">失败任务</span><b>${esc(count(counts.failed))}</b></div>
    </div>`;
    const tabs = `<div class="tabs" role="tablist">
      ${[['messages', '消息', messages.length], ['jobs', '任务', jobs.length], ['logs', '日志', logs.length]].map(([id, label, n]) => `<a role="tab" href="#/data/${id}" aria-selected="${tab === id}">${label}<span class="count">${esc(count(n))}</span></a>`).join('')}
    </div>`;
    let body = '';
    if (tab === 'messages') body = messagesView(messages);
    else if (tab === 'jobs') body = jobsView(jobs);
    else body = logsView(logs);
    return {
      html: pageHead({
        title: '数据与日志',
        desc: '同一链路的三个截面。',
        actions: `${btn('刷新', { act: 'refresh', small: true, iconName: 'refresh' })}`
      }) + stateError + strip + tabs + region('telemetry', body, { skeleton: skeleton(6) }),
      mount: mountData
    };
  }

  function messagesView(messages) {
    const filtered = messages.filter((entry) => {
      const ev = entry.event || {};
      const isGroup = ev.message_type === 'group';
      const q = ui.messages.q.trim().toLowerCase();
      if (ui.messages.kind !== 'all' && (ui.messages.kind === 'group') !== isGroup) return false;
      const dir = ev.post_type === 'message_sent' ? 'out' : 'in';
      if (ui.messages.dir !== 'all' && ui.messages.dir !== dir) return false;
      if (!q) return true;
      return (textOf(ev.message || ev.raw_message) + ' ' + (ev.user_id || '') + ' ' + (ev.group_id || '')).toLowerCase().includes(q);
    });
    const rows = filtered.slice(0, 200).map((entry) => {
      const ev = entry.event || {};
      const isGroup = ev.message_type === 'group';
      const out = ev.post_type === 'message_sent';
      return {
        attr: `data-select="message:${esc(entry.id)}" style="cursor:pointer"`,
        cells: [
          `<span class="t-time">${esc(clock(ev.time ? ev.time * 1000 : entry.time))}</span>`,
          `${out ? badge('发出', 'badge-primary') : badge('收到', 'badge')}`,
          `${esc(isGroup ? '群聊' : '私聊')}`,
          `<span class="t-main">${esc(mask(isGroup ? ev.group_id : ev.user_id))}</span>`,
          `<div class="t-main" style="font-weight:400">${esc(textOf(ev.message || ev.raw_message) || '（空消息）')}</div>`
        ]
      };
    });
    const toolbar = `<div class="toolbar">
      <div class="search">${icon('search')}<input class="input" id="msg-q" placeholder="搜索正文、QQ 或群号" value="${esc(ui.messages.q)}"></div>
      <select class="select" id="msg-kind"><option value="all">全部类型</option><option value="private" ${ui.messages.kind === 'private' ? 'selected' : ''}>私聊</option><option value="group" ${ui.messages.kind === 'group' ? 'selected' : ''}>群聊</option></select>
      <select class="select" id="msg-dir"><option value="all">收发双向</option><option value="in" ${ui.messages.dir === 'in' ? 'selected' : ''}>仅收到</option><option value="out" ${ui.messages.dir === 'out' ? 'selected' : ''}>仅发出</option></select>
      <span class="spacer"></span><span class="toolbar-count">${esc(count(filtered.length))} / ${esc(count(messages.length))} 条</span>
    </div>`;
    return card('', {
      tight: true,
      body: toolbar + (filtered.length ? table(['时间', '方向', '类型', '会话', '正文'], rows) : emptyState({ iconName: 'inbox', title: messages.length ? '没有匹配的消息' : '还没有消息', body: messages.length ? '调整筛选条件。' : '收到或发出消息后，会在这里显示。图片正文不会写入缓冲。' }))
    });
  }

  function jobsView(jobs) {
    if (S.errors.jobs) return card('', { body: errorState({ title: '任务读取失败', body: S.errors.jobs, code: 'jobs' }) });
    const filtered = jobs.filter((job) => {
      const q = ui.jobs.q.trim().toLowerCase();
      if (ui.jobs.status !== 'all' && job.status !== ui.jobs.status) return false;
      if (!q) return true;
      return (job.id + ' ' + job.conversation + ' ' + (job.reason || '')).toLowerCase().includes(q);
    });
    const rows = filtered.map((job) => {
      const [label, kind] = jobStatus(job.status);
      return {
        attr: `data-select="job:${esc(job.id)}" style="cursor:pointer"`,
        cells: [
          `<span class="t-mono">#${esc(job.id)}</span>`,
          `<span class="t-main">${esc(conversationLabel(job.conversation))}</span>`,
          badge(label, kind),
          `<span class="t-num">${esc(job.attempts ?? 0)} / ${esc(job.send_attempts ?? 0)}</span>`,
          `<span class="t-time">${esc(stamp(job.updated_at))}</span>`,
          `<span class="t-sub">${esc(job.reason || '—')}</span>`
        ]
      };
    });
    const options = [['all', '全部状态'], ['queued', '待处理'], ['generating', '生成中'], ['ready', '待发送'], ['sending', '发送中'], ['done', '已完成'], ['uncertain', '需要核对'], ['failed', '失败'], ['ignored', '已忽略']];
    const toolbar = `<div class="toolbar">
      <div class="search">${icon('search')}<input class="input" id="job-q" placeholder="搜索任务号、会话或原因" value="${esc(ui.jobs.q)}"></div>
      <select class="select" id="job-status">${options.map(([value, label]) => `<option value="${value}" ${ui.jobs.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <span class="spacer"></span><span class="toolbar-count">${esc(count(filtered.length))} / ${esc(count(jobs.length))} 条</span>
    </div>`;
    return card('', {
      tight: true,
      body: toolbar + (filtered.length ? table(['任务', '会话', '状态', '生成 / 发送', '更新', '原因'], rows) : emptyState({ iconName: 'inbox', title: jobs.length ? '没有匹配的任务' : '还没有任务', body: jobs.length ? '调整筛选条件。' : '白名单消息进入队列后，会在这里显示。' }))
    });
  }

  function logsView(logs) {
    const filtered = logs.filter((entry) => {
      if (ui.logs.level !== 'all' && entry.level !== ui.logs.level) return false;
      const q = ui.logs.q.trim().toLowerCase();
      if (!q) return true;
      return (entry.event + ' ' + logDetail(entry)).toLowerCase().includes(q);
    });
    const levels = [['all', '全部级别'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR'], ['debug', 'DEBUG']];
    const toolbar = `<div class="toolbar">
      <div class="search">${icon('search')}<input class="input" id="log-q" placeholder="搜索事件或字段（例如 job=9131）" value="${esc(ui.logs.q)}"></div>
      <select class="select" id="log-level">${levels.map(([value, label]) => `<option value="${value}" ${ui.logs.level === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <span class="spacer"></span><span class="toolbar-count">${esc(count(filtered.length))} / ${esc(count(logs.length))} 条</span>
    </div>`;
    const lines = filtered.length
      ? filtered.slice(0, 300).map((entry) => `<div class="log-line" data-select="log:${esc(entry.id)}" style="cursor:pointer"><span class="time">${esc(clock(entry.time))}</span><span class="lvl" data-l="${esc(entry.level || 'info')}">${esc(String(entry.level || 'info').toUpperCase())}</span><span class="ev">${esc(entry.event || 'event')}</span><span class="detail">${esc(logDetail(entry))}</span></div>`).join('')
      : emptyState({ iconName: 'activity', title: logs.length ? '没有匹配的日志' : '还没有日志', body: logs.length ? '调整筛选条件。' : '服务启动、配置保存、任务与发送都会记录诊断事件。' });
    return card('', { tight: true, body: toolbar + lines });
  }

  function mountData() {
    const bind = (id, apply) => {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener(id.endsWith('-q') ? 'input' : 'change', () => {
        apply(el.value);
        render({ keepScroll: true });
        if (id.endsWith('-q')) setTimeout(() => { const next = $('#' + id); if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } }, 0);
      });
    };
    bind('msg-q', (v) => { ui.messages.q = v; });
    bind('msg-kind', (v) => { ui.messages.kind = v; });
    bind('msg-dir', (v) => { ui.messages.dir = v; });
    bind('job-q', (v) => { ui.jobs.q = v; });
    bind('job-status', (v) => { ui.jobs.status = v; });
    bind('log-q', (v) => { ui.logs.q = v; });
    bind('log-level', (v) => { ui.logs.level = v; });
  }

  async function openJob(id) {
    try {
      const job = await API.get('/job?id=' + encodeURIComponent(id));
      openJobDrawer(job);
    } catch (error) { toast('读取任务失败：' + error.message, 'alert'); }
  }

  function openJobDrawer(job) {
    const [label, kind] = jobStatus(job.status);
    const event = job.event && typeof job.event === 'object' ? job.event : {};
    const input = job.input || textOf(event.message || event.raw_message) || '—';
    const steps = Array.isArray(job.agent_steps) ? job.agent_steps : [];
    const parts = Array.isArray(job.stream_parts) ? job.stream_parts : [];
    const failures = Array.isArray(job.command_failures) ? job.command_failures : [];
    const decision = job.group_chat_decision || null;
    const sections = [
      { title: '任务', html: kv([
        ['任务号', `<code>#${esc(job.id)}</code>`],
        ['会话', esc(conversationLabel(job.conversation))],
        ['状态', badge(label, kind)],
        ['生成 / 发送', `${esc(job.attempts ?? 0)} / ${esc(job.send_attempts ?? 0)}`],
        ['创建', esc(stamp(job.created_at))],
        ['更新', esc(stamp(job.updated_at))],
        ['原因', esc(job.reason || '—')],
        ['正文保留', job.input || job.reply ? '有正文' : '未保留']
      ]) },
      { title: '输入', html: `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(input)}</p>` },
      { title: '回复', html: `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(job.reply || '（没有回复正文）')}</p>` }
    ];
    if (parts.length) sections.push({ title: '流式分段', html: `<div class="stack" style="gap:6px">${parts.map((part) => `<div class="tool-call"><span>#${esc(part.part)}</span><span>${esc(part.status)}</span><span class="break">${esc((part.content || '').slice(0, 200))}</span></div>`).join('')}</div>` });
    if (steps.length) sections.push({ title: 'Agent 步骤', html: `<div class="stack" style="gap:6px">${steps.map((step) => `<div class="tool-call"><span>${esc(step.kind === 'tool' ? '工具' : '模型')}</span><b>${esc(step.name || '—')}</b><span>${esc(step.state || '')}</span><span>${esc(step.duration_ms ?? 0)} ms</span></div>`).join('')}</div>` });
    if (decision) sections.push({ title: '群聊判断', html: `<pre class="code-block">${esc(clip(pretty(decision)))}</pre>` });
    if (failures.length) sections.push({ title: '命令失败', html: `<pre class="code-block">${esc(clip(pretty(failures)))}</pre>` });
    sections.push({ title: '原始事件', html: `<pre class="code-block">${esc(clip(pretty(event)))}</pre>` });
    const actions = job.status === 'uncertain'
      ? `${btn('已核实发送', { act: 'resolve-job', attrs: `data-id="${esc(job.id)}" data-outcome="sent"`, small: true, kind: 'btn-primary' })}${btn('放弃任务', { act: 'resolve-job', attrs: `data-id="${esc(job.id)}" data-outcome="discard"`, small: true, kind: 'btn-danger' })}${btn('关闭', { act: 'close-drawer', small: true, kind: 'btn-ghost' })}`
      : `${btn('按任务号筛选日志', { act: 'filter-logs', attrs: `data-id="${esc(job.id)}"`, small: true })}${btn('关闭', { act: 'close-drawer', small: true, kind: 'btn-ghost' })}`;
    openDrawer({ kicker: `JOB / ${job.id}`, title: `${label} · ${conversationLabel(job.conversation)}`, sections, actions });
  }

  /* ------------------------------------------------------------- QQ 空间 */

  function viewQZone() {
    if (!S.loaded && !S.errors.qzoneStatus) {
      return { html: pageHead({ title: 'QQ 空间', desc: '草稿与发布记录。' }) + skeleton(6) };
    }
    if (S.errors.qzoneStatus) {
      return {
        html: pageHead({ title: 'QQ 空间', desc: '草稿与发布记录。' }) + errorState({ title: '空间状态读取失败', body: S.errors.qzoneStatus, code: 'qzoneStatus' })
      };
    }
    const status = S.qzoneStatus || {};
    const posts = qzonePosts();
    const configured = !!status.configured;
    const rows = posts.map((post) => {
      const [label, kind] = qzoneStatus(post.status);
      return {
        attr: `data-select="qzone:${esc(post.id)}" style="cursor:pointer"`,
        cells: [
          `<span class="t-mono">#${esc(post.id)}</span>`,
          `<div class="t-main" style="font-weight:400">${esc((post.content || post.prompt || '（空草稿）').slice(0, 90))}</div>`,
          badge(label, kind),
          `${esc(VISIBILITY[post.visibility] || post.visibility || '—')}`,
          `<span class="t-time">${esc(stamp(post.created_at))}</span>`,
          post.simulated ? badge('演示', 'badge-outline') : ''
        ]
      };
    });
    const statusCard = card('空间状态', {
      desc: '使用本机保存的 Cookie。',
      actions: `${btn('保存 Cookie', { act: 'qzone-cookie', small: true, iconName: 'key' })}${configured ? btn('检查连接', { act: 'qzone-check', small: true, iconName: 'refresh' }) : ''}`,
      body: kv([
        ['凭据', configured ? (status.credential_error ? dotBadge('需要更新', 'bad') : dotBadge('已保存', 'ok')) : dotBadge('未配置', 'warn')],
        ['空间账号', configured ? `<code>${esc(mask(status.account))}</code>` : '—'],
        ['AI 生成', status.ai_ready ? badge('可用', 'badge-ok') : badge('需要先配置模型', 'badge-warn')],
        ['Cookie 导出', status.cookie_export_enabled ? badge('已允许', 'badge-warn') : badge('未允许', 'badge-outline')],
        ['正文字数上限', `${esc(status.max_chars ?? 2000)} 字`],
        ['保留', status.retention_days === 0 ? '永久' : `${esc(status.retention_days ?? '—')} 天`]
      ]),
      foot: `${configured ? btn('清除凭据', { act: 'qzone-clear', small: true, kind: 'btn-danger' }) : ''}`
    });
    const compose = card('写一条说说', {
      desc: '可生成也可手写。',
      actions: `${btn('手写草稿', { act: 'qzone-blank', small: true, iconName: 'file' })}${btn('新建', { act: 'qzone-new', small: true, kind: 'btn-primary', iconName: 'plus' })}`,
      body: emptyState({ iconName: 'send', title: '还没有草稿' })
    });
    return {
      html: pageHead({
        title: 'QQ 空间',
        desc: '发布是真实操作。',
        actions: `${btn('刷新', { act: 'refresh', small: true, iconName: 'refresh' })}`
      }) +
        (S.errors.qzoneStatus ? region('qzoneStatus', '') : '') +
        `<div class="stack">${statusCard}${compose}
          ${S.errors.qzonePosts ? card('', { body: errorState({ title: '空间记录读取失败', body: S.errors.qzonePosts, code: 'qzonePosts' }) }) : card('记录', { desc: '最近 50 条，可人工核对。', tight: true, body: posts.length ? table(['编号', '内容', '状态', '可见', '创建', ''], rows) : emptyState({ iconName: 'send', title: '还没有空间记录', body: '新建一条草稿后会出现在这里。' }) })}
        </div>`,
      mount: () => { if (posts.some((post) => ['generating', 'publishing'].includes(post.status))) startQzonePoll(); }
    };
  }

  function startQzonePoll() {
    if (qzonePoll) clearInterval(qzonePoll);
    qzoneSignature = qzonePosts().map((post) => post.id + ':' + post.status).join(',');
    qzonePoll = setInterval(async () => {
      if (!location.hash.includes('qzone')) { clearInterval(qzonePoll); qzonePoll = null; return; }
      try {
        const [status, posts] = await Promise.all([API.get('/qzone/status'), API.get('/qzone/posts')]);
        S.qzoneStatus = status;
        S.qzonePosts = Array.isArray(posts) ? posts : posts.posts || [];
        const signature = qzonePosts().map((post) => post.id + ':' + post.status).join(',');
        const busy = qzonePosts().some((post) => ['generating', 'publishing'].includes(post.status));
        if (signature !== qzoneSignature) {
          qzoneSignature = signature;
          render({ keepScroll: true });
        }
        if (!busy) { clearInterval(qzonePoll); qzonePoll = null; }
      } catch { /* 下一轮继续 */ }
    }, 3000);
  }

  async function refreshQzone() {
    try {
      const [status, posts] = await Promise.all([API.get('/qzone/status'), API.get('/qzone/posts')]);
      S.qzoneStatus = status;
      S.qzonePosts = Array.isArray(posts) ? posts : posts.posts || [];
      render({ keepScroll: true });
    } catch (error) { toast('刷新失败：' + error.message, 'alert'); }
  }

  function openQzonePost(post) {
    const [label, kind] = qzoneStatus(post.status);
    const sections = [
      { title: '正文', html: `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(post.content || '（空）')}</p>` },
      { title: '信息', html: kv([
        ['编号', `<code>#${esc(post.id)}</code>`],
        ['状态', badge(label, kind)],
        ['可见范围', esc(VISIBILITY[post.visibility] || post.visibility || '—')],
        ['账号', post.account ? esc(mask(post.account)) : '—'],
        ['创建', esc(stamp(post.created_at))],
        ['更新', esc(stamp(post.updated_at))],
        ['提示词', esc(post.prompt || '—')],
        ['原因', esc(post.reason || '—')]
      ]) }
    ];
    const actions = [];
    if (['draft', 'failed'].includes(post.status)) actions.push(btn('编辑', { act: 'qzone-edit', attrs: `data-id="${esc(post.id)}"`, small: true }));
    if (post.status === 'draft') actions.push(btn('发布', { act: 'qzone-publish', attrs: `data-id="${esc(post.id)}"`, small: true, kind: 'btn-primary' }));
    if (post.status === 'uncertain') actions.push(btn('已发布', { act: 'qzone-resolve', attrs: `data-id="${esc(post.id)}" data-outcome="published"`, small: true, kind: 'btn-primary' }), btn('放弃', { act: 'qzone-resolve', attrs: `data-id="${esc(post.id)}" data-outcome="discard"`, small: true, kind: 'btn-danger' }));
    if (post.url) {
      const url = safeUrl(post.url);
      if (url) actions.push(`<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noreferrer">打开</a>`);
    }
    actions.push(btn('关闭', { act: 'close-drawer', small: true, kind: 'btn-ghost' }));
    openDrawer({ kicker: `QZONE / ${post.id}`, title: (post.content || '空间记录').slice(0, 24), sections, actions: actions.join('') });
  }

  /* ------------------------------------------------------------- 系统设置 */

  function viewSettings() {
    const state = S.state || {};
    if (!S.loaded && !S.errors.state) {
      return { html: pageHead({ title: '系统设置', desc: '界面、服务与会话。' }) + skeleton(6) };
    }
    const values = settingsValues();
    // 明暗主题属于控制台自身；背景壁纸与启动动画由插件提供，入口在插件页。
    const serviceCard = card('服务与账号', {
      desc: '重启会中断生成中的任务。',
      actions: `${btn('检查内核更新', { act: 'kernel-update', small: true, iconName: 'refresh' })}${state.can_restart ? btn('重启服务', { act: 'restart', small: true, iconName: 'power' }) : ''}${stateOnline() ? btn('退出 QQ', { act: 'logout', small: true, kind: 'btn-danger' }) : ''}`,
      body: kv([
        ['服务地址', `<code>${esc(state.endpoint || API.BASE || '—')}</code>`],
        ['驱动', `<code>${esc(state.driver || '—')}</code>`],
        ['内核版本', `<code>${esc(state.version || '—')}</code>`],
        ...(S.kernelUpdate ? [['官方最新', kernelUpdateNote(S.kernelUpdate)]] : []),
        ['QQ 账号', `<code>${esc(state.account ? mask(state.account) : '未登录')}</code>`],
        ['重启可用', state.can_restart ? '是' : '否（复用了其他进程的服务）'],
        ['接口前缀', `<code>${esc(API.BASE || '—')}</code>`]
      ])
    });
    const privacy = (state.privacy || {});
    const privacyCard = card('数据与保留', {
      desc: '改值请去配置文件。',
      actions: linkBtn('调整策略', 'config/storage', { small: true }),
      body: kv([
        ['消息与历史', privacy.history_days === 0 ? '永久保留' : `${esc(privacy.history_days ?? '—')} 天`],
        ['结果未知任务', `${esc(privacy.uncertain_retention_days ?? values.UNCERTAIN_RETENTION_DAYS ?? '—')} 天`],
        ['保留忽略正文', privacy.retain_ignored_content ? badge('开启', 'badge-warn') : badge('关闭', 'badge-ok')],
        ['图片缓存', `${esc(values.MEDIA_CACHE_DAYS ?? '—')} 天`]
      ])
    });
    const aboutCard = card('关于', {
      desc: '只在本机运行。',
      body: kv([
        ['配置版本', `<code>${esc(String((S.settings && S.settings.revision) || '').slice(0, 12) || '—')}</code>`],
        ['配置文件', S.settings && S.settings.persistent ? '已持久化到 .env' : '内存配置'],
        ['插件', `${esc(pluginsList().length)} 个已安装`],
        ['配置项', `${esc((S.settings && S.settings.fields || []).length)} 个`],
        ['数据缓冲', `消息与日志各最多 ${esc((state.privacy && state.privacy.memory_limit) || 1000)} 条`],
        ['明暗主题', `${theme === 'dark' ? '深色' : '浅色'} · ${btn('切换主题', { act: 'toggle-theme', small: true })}`]
      ])
    });
    return {
      html: pageHead({ title: '系统设置', desc: '服务、数据与版本。' }) +
        (S.errors.state ? `<div class="banner banner-bad" role="status">${icon('alert')}<div><b>运行状态读取失败。</b>服务与账号信息可能不是最新。</div></div>` : '') +
        `<div class="grid-2">${serviceCard}${privacyCard}</div>
        <div style="margin-top:12px">${aboutCard}</div>`
    };
  }

  /* ------------------------------------------------------------- 抽屉/弹窗 */

  function openDrawer({ kicker, title, sections = [], actions = '' }) {
    $('#drawer-kicker').textContent = kicker || '';
    $('#drawer-title').textContent = title || '';
    $('#drawer-body').innerHTML = sections.map((section) => `<section class="d-section"><h3>${esc(section.title)}</h3>${section.html || ''}</section>`).join('');
    $('#drawer-foot').innerHTML = actions || btn('关闭', { act: 'close-drawer', small: true });
    $('#drawer').hidden = false;
    $('#scrim').hidden = false;
  }
  function closeDrawer() {
    $('#drawer').hidden = true;
    if ($('#modal').hidden && $('#palette').hidden) $('#scrim').hidden = true;
  }
  function openModal({ title, body, actions }) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    $('#modal-foot').innerHTML = actions;
    $('#modal').hidden = false;
    $('#scrim').hidden = false;
  }
  function closeModal() {
    $('#modal').hidden = true;
    if ($('#drawer').hidden && $('#palette').hidden) $('#scrim').hidden = true;
  }

  function toast(message, iconName = 'check') {
    const el = $('#toast');
    el.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  /* ------------------------------------------------------------- 导航与渲染 */

  function renderNav() {
    $('#nav').innerHTML = NAV.map((group) => `<div class="nav-group"><p class="nav-label">${esc(group.group)}</p>${group.items.map((item) => {
      const active = path === item.path
        || (item.path === 'config/ai' && path.startsWith('config/'))
        || (item.path === 'data/messages' && path.startsWith('data/'))
        || (item.path === 'plugins' && path.startsWith('plugins'));
      return `<a href="#/${item.path}" ${active ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
    }).join('')}</div>`).join('');
  }

  function renderCrumb() {
    const meta = META[path] || (path.startsWith('plugins/') ? ['扩展', '插件与扩展'] : ['配置', '配置文件']);
    let specific = '';
    let title = meta[1];
    if (path.startsWith('plugins/')) {
      const plugin = pluginByKey(path.split('/')[1]);
      if (plugin) title = `${meta[1]} · ${plugin.name}`;
    }
    if (path.startsWith('config/')) {
      const group = S.settings && (S.settings.groups || []).find((g) => g.id === cfgId());
      if (group) { specific = group.title; title = `${meta[1]} · ${group.title}`; }
    }
    // 详情页只显示「分组 / 具体项」，避免与页头 H1 重复同一层名称
    const GROUP_HOME = { '配置': 'config/ai', '扩展': 'plugins', '运行': 'dashboard', '内容': 'qzone', '系统': 'settings' };
    const home = GROUP_HOME[meta[0]] || 'config/ai';
    const tail = specific
      ? `<span class="sep">/</span><span>${esc(specific)}</span>`
      : `<span class="sep">/</span><b>${esc(meta[1])}</b>`;
    $('#crumb').innerHTML = `<a class="crumb-group" href="#/${home}">${esc(meta[0])}</a>${tail}`;
    document.title = `${title} · Limen`;
  }

  function renderShell() {
    const state = S.state || {};
    const online = !!state.online;
    const tone = S.errors.state ? 'bad' : !S.loaded ? 'idle' : online ? 'ok' : 'warn';
    $('#side-dot').dataset.state = tone;
    $('#side-version').textContent = state.version ? String(state.version).slice(0, 14) : '—';
    $('#profile-dot').dataset.state = tone;
    $('#profile-name').textContent = online && state.account ? mask(state.account) : '未登录';
    $('#profile-note').textContent = online ? `${state.driver || '驱动'} · ${STATE_LABEL[state.state] || '在线'}` : S.errors.state ? '无法连接服务' : 'QQ 未登录';
    $('#account-initial').textContent = online && state.account ? String(state.account).slice(-1) : '—';
    $('#account-name').textContent = online && state.account ? mask(state.account) : '未登录';
    $('#account-driver').textContent = state.driver ? String(state.driver) : 'QQ 内核';
  }

  function render(opts = {}) {
    const scroll = window.scrollY;
    path = parsePath();
    renderShell();
    renderNav();
    renderCrumb();
    let page;
    if (path.startsWith('config/')) page = viewConfig();
    else if (path === 'providers') page = viewProviders();
    else if (path === 'platforms') page = viewPlatforms();
    else if (path === 'plugins') page = viewPlugins();
    else if (path.startsWith('plugins/')) page = viewPluginDetail();
    else if (path === 'market') page = viewMarket();
    else if (path === 'dashboard') page = viewDashboard();
    else if (path === 'chat') page = viewChat();
    else if (path.startsWith('data/')) page = viewData();
    else if (path === 'qzone') page = viewQZone();
    else page = viewSettings();
    $('#main').innerHTML = page.html;
    if (page.mount) page.mount();
    if (opts.keepScroll) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------- 搜索 */

  function buildIndex() {
    const items = [];
    Object.entries(META).forEach(([p, [group, label]]) => {
      if (p === 'data/jobs' || p === 'data/logs') return;
      items.push({ label, group, path: p, hint: '页面' });
    });
    if (S.settings) {
      (S.settings.groups || []).forEach((group) => {
        items.push({ label: group.title, group: '配置分区', path: 'config/' + group.id, hint: group.description || '' });
        (S.settings.fields || []).filter((f) => f.group === group.id).forEach((field) => {
          items.push({ label: field.label, group: '配置项', path: 'config/' + group.id, hint: `${group.title} · ${field.key}` });
        });
      });
    }
    pluginsList().forEach((plugin) => items.push({ label: plugin.name, group: '插件', path: 'plugins/' + pluginKey(plugin), hint: plugin.kind }));
    return items;
  }
  let INDEX = [];
  const refreshIndex = () => { INDEX = buildIndex(); };

  function paletteItems() {
    const q = paletteState.q.trim().toLowerCase();
    if (!q) return INDEX.slice(0, 12);
    return INDEX.filter((item) => (item.label + ' ' + item.group + ' ' + item.hint).toLowerCase().includes(q)).slice(0, 14);
  }
  function renderPalette() {
    const items = paletteItems();
    paletteState.items = items;
    const list = $('#palette-list');
    if (!items.length) { list.innerHTML = '<li class="palette-empty">没有匹配的页面、配置项或插件</li>'; return; }
    if (paletteState.index >= items.length) paletteState.index = 0;
    list.innerHTML = items.map((item, index) => `<li role="option" aria-selected="${index === paletteState.index}" data-index="${index}" data-path="${esc(item.path)}">
      <span>${esc(item.label)}</span><span class="p-sub">${esc(item.hint)}</span><span class="p-group">${esc(item.group)}</span>
    </li>`).join('');
  }
  function openPalette() {
    refreshIndex();
    $('#palette').hidden = false;
    $('#scrim').hidden = false;
    paletteState = { q: '', index: 0, items: [] };
    $('#palette-input').value = '';
    renderPalette();
    setTimeout(() => $('#palette-input').focus(), 20);
  }
  function closePalette() {
    $('#palette').hidden = true;
    if ($('#drawer').hidden && $('#modal').hidden) $('#scrim').hidden = true;
  }

  function navigate(next, { force = false } = {}) {
    closeSide();
    const target = next.replace(/^#?\/?/, '');
    if (!force && (dirtyKeys.size || secretTouched.size) && path.startsWith('config/') && !target.startsWith('config/')) {
      openModal({
        title: '离开配置页？',
        body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">还有未保存的配置改动。离开会放弃它们，已保存的配置不受影响。</p>',
        actions: `${btn('留在这里', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('放弃并离开', { act: 'leave-config', attrs: `data-go="${esc(target)}"`, small: true, kind: 'btn-danger' })}`
      });
      return;
    }
    if (location.hash.replace(/^#\/?/, '') === target) {
      render();
      return;
    }
    location.hash = '#/' + target;
  }

  /* ------------------------------------------------------------- 事件 */

  function openSide() {
    $('#app').setAttribute('data-nav', 'open');
    $('#scrim').hidden = false;
    $('#side-open').setAttribute('aria-expanded', 'true');
  }
  function closeSide() {
    $('#app').removeAttribute('data-nav');
    if (!$('#drawer').hidden || !$('#modal').hidden || !$('#palette').hidden) return;
    $('#scrim').hidden = true;
    $('#side-open').setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', async (event) => {
    const act = event.target.closest('[data-act]');
    const go = event.target.closest('[data-go]');
    const select = event.target.closest('[data-select]');
    const anchor = event.target.closest('a[href^="#/"]');

    if (anchor && !act && !go && (dirtyKeys.size || secretTouched.size) && path.startsWith('config/')) {
      const target = anchor.getAttribute('href').replace(/^#\/?/, '');
      if (!target.startsWith('config/')) {
        event.preventDefault();
        navigate(target);
        return;
      }
    }

    if (!act && !go && select) {
      const [type, ...rest] = select.dataset.select.split(':');
      const id = rest.join(':');
      if (type === 'job') { openJob(id); return; }
      if (type === 'message') {
        const entry = messagesOf().find((item) => String(item.id) === id);
        if (entry) {
          const ev = entry.event || {};
          openDrawer({
            kicker: `MESSAGE / ${entry.id}`,
            title: `${ev.message_type === 'group' ? '群聊' : '私聊'} · ${mask(ev.message_type === 'group' ? ev.group_id : ev.user_id)}`,
            sections: [
              { title: '正文', html: `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(textOf(ev.message || ev.raw_message) || '（空消息）')}</p>` },
              { title: '元数据', html: kv([
                ['方向', ev.post_type === 'message_sent' ? '发出' : '收到'],
                ['时间', esc(clock(ev.time ? ev.time * 1000 : entry.time))],
                ['账号', `<code>${esc(mask(ev.self_id))}</code>`],
                ['会话', `<code>${esc(mask(ev.message_type === 'group' ? ev.group_id : ev.user_id))}</code>`],
                ['消息编号', `<code>${esc(mask(ev.message_id, 6))}</code>`]
              ]) },
              { title: '原始事件', html: `<pre class="code-block">${esc(clip(pretty(ev)))}</pre>` }
            ],
            actions: `${btn('复制 JSON', { act: 'copy', attrs: `data-json="message:${esc(entry.id)}"`, small: true })}${btn('关闭', { act: 'close-drawer', small: true, kind: 'btn-ghost' })}`
          });
        }
        return;
      }
      if (type === 'log') {
        const entry = logsOf().find((item) => String(item.id) === id);
        if (entry) openLogDrawer(entry);
        return;
      }
      if (type === 'qzone') {
        const post = qzonePosts().find((item) => String(item.id) === id);
        if (post) openQzonePost(post);
        return;
      }
      return;
    }

    if (go && !act) { event.preventDefault(); navigate(go.dataset.go); return; }
    if (!act) return;
    const action = act.dataset.act;

    if (action === 'retry' || action === 'refresh') {
      act.disabled = true;
      if (action === 'retry') S.extra = {};
      await API.loadAll();
      refreshIndex();
      render({ keepScroll: true });
      toast('已重新读取', 'refresh');
      return;
    }
    if (action === 'save-config') { await saveConfig(); return; }
    if (action === 'discard-config') {
      form = { ...settingsValues() }; secretTouched = new Set(); dirtyKeys = new Set(); lastSave = null;
      toast('已放弃未保存的修改', 'refresh');
      render({ keepScroll: true });
      return;
    }
    if (action === 'reload-settings') {
      closeModal();
      await API.loadAll();
      form = null; formRevision = null; secretTouched = new Set(); dirtyKeys = new Set();
      render({ keepScroll: true });
      return;
    }
    if (action === 'show-json') {
      const values = { ...currentValues() };
      (S.settings.fields || []).forEach((field) => { if (field.type === 'secret') values[field.key] = '••••••••'; });
      const group = (S.settings.groups || []).find((item) => item.id === cfgId());
      const subset = {};
      (S.settings.fields || []).filter((field) => field.group === cfgId()).forEach((field) => { subset[field.key] = values[field.key]; });
      jsonDraft = subset;
      openDrawer({
        kicker: 'CONFIG / JSON',
        title: `${group ? group.title : '配置'} · 只读预览`,
        sections: [
          { title: '当前草稿', html: `<pre class="code-block">${esc(pretty(subset))}</pre><p class="inline-note" style="margin-top:8px">密钥已替换为占位符；这里显示的是表单草稿，不一定已保存。</p>` },
          { title: '文件', html: `<p class="inline-note">${S.settings.persistent ? '保存后原子写入本机 .env；写入前会校验整份配置。' : '演示工作区没有落盘文件，配置只保存在进程内。'}</p>` }
        ],
        actions: `${btn('复制 JSON', { act: 'copy', attrs: 'data-json="config"', small: true })}${btn('关闭', { act: 'close-drawer', small: true, kind: 'btn-ghost' })}`
      });
      return;
    }
    if (action === 'reveal-secret') {
      const key = act.dataset.key;
      const input = document.getElementById('f-' + key);
      if (!input) return;
      if (input.type === 'text') {
        input.type = 'password';
        act.textContent = '显示';
        if (form && form.__revealed) delete form.__revealed[key];
        return;
      }
      try {
        const value = await API.reveal(key);
        input.type = 'text';
        input.value = (value && value.value) || '';
        act.textContent = '隐藏';
        if (form) { form.__revealed = { ...(form.__revealed || {}), [key]: true }; form[key] = input.value; }
      } catch (error) { toast('无法读取密钥：' + error.message, 'alert'); }
      return;
    }
    if (action === 'clear-secret') {
      const key = act.dataset.key;
      if (!form) return;
      form[key] = '';
      form.__cleared = { ...(form.__cleared || {}), [key]: true };
      if (form.__revealed) delete form.__revealed[key];
      secretTouched.add(key);
      recomputeDirty();
      render({ keepScroll: true });
      toast('保存后会清空这一项', 'info');
      return;
    }
    if (action === 'probe-models') { await probeModels(); return; }
    if (action === 'kernel-update') {
      toast('正在查询 QQ 官方版本…', 'refresh');
      try {
        const result = await API.kernelUpdate();
        S.kernelUpdate = result;
        render({ keepScroll: true });
        if (result.error) toast('检查失败：' + result.error, 'alert');
        else if (!result.prepared) toast('还没有准备 QQ 运行时，首次启动会自动下载', 'info');
        else if (result.update_available) toast(`官方已发布 ${result.latest}，当前是 ${result.current}`, 'info');
        else toast(`已是最新：${result.current}`, 'check');
      } catch (error) { toast('检查失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'use-model') { await useModel(act.dataset.model); return; }
    if (action === 'qr-start') { await startQr(); return; }
    if (action === 'qr-cancel') { qr = null; if (qrPoll) { clearInterval(qrPoll); qrPoll = null; } render({ keepScroll: true }); return; }
    if (action === 'restart') {      openModal({
        title: '重启机器人服务？',
        body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">正在生成与发送的任务会中断；已保存的配置会重新加载。页面地址保持不变。</p>',
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('重启', { act: 'do-restart', small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-restart') {
      closeModal();
      toast('正在重启服务…', 'refresh');
      try {
        await API.restart();
        await API.loadAll(); refreshIndex(); render({ keepScroll: true });
        toast('服务已重启', 'check');
      } catch (error) { toast('重启失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'logout') {
      openModal({
        title: '退出当前 QQ 账号？',
        body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">退出后需要重新扫码；配置、任务与记忆不受影响。</p>',
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('退出登录', { act: 'do-logout', small: true, kind: 'btn-danger' })}`
      });
      return;
    }
    if (action === 'do-logout') {
      closeModal();
      try {
        await API.logout();
        await API.loadAll(); refreshIndex(); render({ keepScroll: true });
        toast('已退出登录', 'info');
      } catch (error) { toast('退出失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'pick-plugin-package') {
      const input = $('#plugin-package-file');
      if (input) input.click();
      return;
    }
    if (action === 'do-import-package-overwrite') {
      closeModal();
      const file = pendingPackageFile; pendingPackageFile = null;
      if (file) await importPluginPackage(file, { overwrite: true });
      return;
    }
    if (action === 'new-script-plugin') {
      openModal({
        title: '新建脚本插件',
        body: `<div class="fields">
          <div class="field"><label for="ns-name">插件名称</label><input class="input" id="ns-name" placeholder="例如 指令回复" autocomplete="off"></div>
          <div class="field"><label for="ns-trigger">触发前缀</label><input class="input" id="ns-trigger" placeholder="/ping" autocomplete="off"><p class="help">消息以此前缀开头时交给插件；留空表示不按前缀过滤。</p></div>
          <div class="field"><label for="ns-priority">优先级</label><input class="input" id="ns-priority" inputmode="numeric" value="0"><p class="help">-100 至 100，数值越大越早执行。</p></div>
          <div class="field"><label for="ns-timeout">执行时限（毫秒）</label><input class="input" id="ns-timeout" inputmode="numeric" value="3000"><p class="help">100 至 10000 毫秒。</p></div>
          <div class="field"><label for="ns-users">好友范围</label><input class="input" id="ns-users" placeholder="QQ 号，逗号分隔"><p class="help">留空且不勾选全部私聊时不处理私聊。</p></div>
          <div class="field"><label for="ns-groups">群范围</label><input class="input" id="ns-groups" placeholder="群号，逗号分隔"><p class="help">群聊默认还需要 @机器人。</p></div>
          <div class="field wide"><label for="ns-source">插件源码</label><textarea class="textarea" id="ns-source" rows="12" spellcheck="false" style="font-family:var(--mono);font-size:11.5px;line-height:1.7">${esc("export default async function ({ text, event, config }) {\n  if (text.trim() !== config.command) return null;\n  return { reply: config.response };\n}")}</textarea></div>
          <div class="field wide"><label for="ns-config">插件配置（JSON）</label><textarea class="textarea" id="ns-config" rows="5" spellcheck="false" style="font-family:var(--mono);font-size:11.5px;line-height:1.7">${esc(pretty({ command: '/ping', response: 'pong！插件运行正常。' }))}</textarea></div>
        </div>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('保存并打开', { act: 'do-new-script-plugin', small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-new-script-plugin') {
      const name = (($('#ns-name') && $('#ns-name').value.trim()) || '');
      if (!name) { toast('请填写插件名称', 'alert'); return; }
      let config;
      try { config = JSON.parse(($('#ns-config') && $('#ns-config').value) || '{}'); }
      catch { toast('插件配置不是有效的 JSON', 'alert'); return; }
      const ids = (value) => String(value || '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
      const plugin = {
        schema: 1, kind: 'script', name,
        source: ($('#ns-source') && $('#ns-source').value) || '',
        config, config_schema: {},
        description: '', version: '1.0.0', author: '', repository: '', tools: [],
        trigger: ($('#ns-trigger') && $('#ns-trigger').value.trim()) || '',
        priority: Number(($('#ns-priority') && $('#ns-priority').value) || 0),
        timeout_ms: Number(($('#ns-timeout') && $('#ns-timeout').value) || 3000),
        scope: { private_users: ids($('#ns-users') && $('#ns-users').value), groups: ids($('#ns-groups') && $('#ns-groups').value), all_private: false, all_groups: false, require_at: true }
      };
      try {
        const saved = await API.savePlugin(undefined, 0, plugin);
        closeModal();
        await API.loadAll(); refreshIndex();
        toast('插件已创建，默认停用', 'check');
        location.hash = '#/plugins/' + pluginKey(saved);
        render({ keepScroll: true });
      } catch (error) { toast('创建失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'visual-pick') {
      const input = $('#' + act.dataset.target);
      if (input && !visualBusy) input.click();
      return;
    }
    if (action === 'visual-remove') {
      const kind = act.dataset.kind, what = act.dataset.what;
      const names = { image: '背景图片', logo: '启动 Logo', video: '启动视频' };
      const name = names[what] || '素材';
      openModal({
        title: `移除${name}？`,
        body: `<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">文件会从本机删除，之后可以重新上传。</p>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('移除', { act: 'do-visual-remove', attrs: `data-kind="${esc(kind)}" data-what="${esc(what)}"`, small: true, kind: 'btn-danger' })}`
      });
      return;
    }
    if (action === 'do-visual-remove') {
      closeModal();
      const kind = act.dataset.kind, what = act.dataset.what;
      const isStartup = kind === 'startup-animation';
      const route = isStartup ? '/startup-animation' : '/background';
      const payload = what === 'image' ? { action: 'remove' } : { action: what === 'logo' ? 'remove-logo' : 'remove-video' };
      try {
        const result = isStartup ? await API.startup(payload) : await API.background(payload);
        S.extra[route] = { value: result, error: null, at: Date.now() };
        toast('已移除', 'trash');
        render({ keepScroll: true });
      } catch (error) { toast('移除失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'market-reload') {
      act.disabled = true;
      await loadMarket(true);
      toast('清单已刷新', 'refresh');
      return;
    }
    if (action === 'market-install') {
      const item = ((marketValue() || {}).plugins || []).find((entry) => entry.id === act.dataset.id)
        || { id: act.dataset.id, name: act.dataset.name, state: act.dataset.state || 'available' };
      await marketInstall(item);
      return;
    }
    if (action === 'do-market-install') { await doMarketInstall(act); return; }
    if (action === 'market-uninstall') {
      await marketUninstall({ id: act.dataset.id, name: act.dataset.name });
      return;
    }
    if (action === 'do-market-uninstall') { await doMarketUninstall(act); return; }
    if (action === 'market-asset') { await marketAsset(act); return; }
    if (action === 'do-market-asset') { await doMarketAsset(act); return; }
    if (action === 'install-plugin') {
      const kind = act.dataset.kind;
      act.disabled = true;
      try {
        await API.installPlugin(kind);
        await API.loadAll(); refreshIndex(); render({ keepScroll: true });
        toast('插件已安装，默认停用', 'check');
      } catch (error) { toast('安装失败：' + error.message, 'alert'); act.disabled = false; }
      return;
    }
    if (action === 'show-packages') {
      const packages = (S.plugins && S.plugins.packages) || [];
      const rejected = (S.plugins && S.plugins.rejected) || [];
      const skipped = (S.plugins && S.plugins.skipped) || [];
      openDrawer({
        kicker: 'PLUGINS / PACKAGES', title: '本机插件包',
        sections: [
          { title: '已发现', html: packages.length ? `<div class="stack" style="gap:6px">${packages.map((item) => `<div class="tool-call"><b>${esc(item.name || item.kind)}</b><span>${esc(item.kind)}</span><span>v${esc(item.version || '—')}</span>${item.panel ? `<span>面板 ${esc(item.panel)}</span>` : ''}</div>`).join('')}</div>` : '<p class="inline-note">没有发现插件包。</p>' },
          { title: '被拒绝', html: rejected.length ? `<pre class="code-block">${esc(clip(pretty(rejected)))}</pre>` : '<p class="inline-note">没有拒绝记录。</p>' },
          { title: '跳过', html: skipped.length ? `<pre class="code-block">${esc(clip(pretty(skipped)))}</pre>` : '<p class="inline-note">没有跳过记录。</p>' },
          { title: '目录', html: `<p class="inline-note"><code>${esc((S.plugins && S.plugins.dir) || '—')}</code></p>` }
        ],
        actions: btn('关闭', { act: 'close-drawer', small: true })
      });
      return;
    }
    if (action === 'delete-plugin') {
      const id = act.dataset.id, revision = Number(act.dataset.revision), name = act.dataset.name || '插件';
      openModal({
        title: `删除「${name}」？`,
        body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">这会移除插件配置与注册，但不会清理它已经产生的数据。操作不能撤销。</p>',
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('删除', { act: 'do-delete-plugin', attrs: `data-id="${esc(id)}" data-revision="${revision}"`, small: true, kind: 'btn-danger' })}`
      });
      return;
    }
    if (action === 'do-delete-plugin') {
      closeModal();
      try {
        await API.deletePlugin(act.dataset.id, Number(act.dataset.revision));
        await API.loadAll(); refreshIndex();
        location.hash = '#/plugins';
        toast('插件已删除', 'trash');
      } catch (error) { toast('删除失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'reload-plugin') {
      const formEl = $('#plugin-form');
      if (formEl) {
        const id = formEl.dataset.id;
        delete S.extra['plugin:' + id];
        try {
          const value = await API.get('/plugins/detail?id=' + encodeURIComponent(id));
          S.extra['plugin:' + id] = { value, error: null, at: Date.now() };
          render({ keepScroll: true });
          toast('已重新载入插件配置', 'refresh');
        } catch (error) { toast('载入失败：' + error.message, 'alert'); }
      }
      return;
    }
    if (action === 'save-plugin') { await savePlugin(); return; }
    if (action === 'memory-scope') {
      const route = '/plugins/memory';
      try {
        const value = await API.get(route + '?scope=' + encodeURIComponent(act.dataset.scope) + '&persona=' + encodeURIComponent(act.dataset.persona || ''));
        S.extra[route] = { value, error: null, at: Date.now() };
        render({ keepScroll: true });
      } catch (error) { toast('读取记忆失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'memory-action') {
      const op = act.dataset.op;
      const extra = S.extra['/plugins/memory'];
      const value = extra && extra.value;
      if (!value || !value.plugin) return;
      if (op === 'forget' && !window.confirm('删除这条记忆？此操作不能撤销。')) return;
      try {
        await API.memory({
          action: op,
          plugin_revision: value.plugin.revision,
          scope: act.dataset.scope,
          persona: act.dataset.persona || '',
          id: act.dataset.id,
          revision: act.dataset.revision
        });
        const refreshed = await API.get('/plugins/memory?scope=' + encodeURIComponent(act.dataset.scope) + '&persona=' + encodeURIComponent(act.dataset.persona || ''));
        S.extra['/plugins/memory'] = { value: refreshed, error: null, at: Date.now() };
        toast(op === 'forget' ? '记忆已删除' : op === 'archive' ? '记忆已归档' : '记忆已恢复', 'check');
        render({ keepScroll: true });
      } catch (error) { toast('记忆操作失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'show-memes') {
      const extra = S.extra['/memes'];
      const value = extra && extra.value;
      if (!value) return;
      try {
        const pending = await API.get('/memes?status=pending&page=1');
        const images = Array.isArray(pending.images) ? pending.images : [];
        openDrawer({
          kicker: 'MEMES / GALLERY',
          title: `表情图库 · 待审核 ${images.length}`,
          sections: [
            { title: '统计', html: kv([
              ['已上架', `${esc(value.total ?? 0)} 张`],
              ['待审核', `${esc((value.counts && value.counts.pending) || 0)} 张`],
              ['分类', `${esc((value.categories || []).length)} 个`],
              ['上限', `${esc(value.limit ?? '—')} 张`]
            ]) },
            { title: '待审核', html: images.length ? `<div class="meme-grid">${images.map((image) => `<div class="meme-thumb"><img src="${esc(API.BASE + '/memes/image?id=' + image.id)}" alt="${esc(image.name)}" loading="lazy"><span>${esc(image.name)}</span><button type="button" class="link-btn" data-act="meme-approve" data-id="${esc(image.id)}" style="padding:4px 7px">通过</button></div>`).join('')}</div>` : '<p class="inline-note">没有待审核的表情。</p>' },
            { title: '分类', html: (value.categories || []).length ? `<div class="tool-list">${value.categories.map((category) => `<code>${esc(category.name)} · ${esc(category.count ?? 0)}</code>`).join('')}</div>` : '<p class="inline-note">还没有分类。</p>' }
          ],
          actions: btn('关闭', { act: 'close-drawer', small: true })
        });
      } catch (error) { toast('读取图库失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'meme-approve') {
      try {
        await API.memes('edit', { ids: [act.dataset.id], action: 'approve' });
        toast('表情已通过审核', 'check');
        delete S.extra['/memes'];
        closeDrawer();
        render({ keepScroll: true });
      } catch (error) { toast('审核失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'chat-send') { await sendChat(); return; }
    if (action === 'chat-new') {
      chatSession = crypto.randomUUID();
      localStorage.setItem('limen-chat-session', chatSession);
      chatHistory = null;
      if (chatClose) { chatClose(); chatClose = null; }
      render({ keepScroll: true });
      return;
    }
    if (action === 'chat-pick') {
      chatSession = act.dataset.session;
      localStorage.setItem('limen-chat-session', chatSession);
      chatHistory = null;
      if (chatClose) { chatClose(); chatClose = null; }
      render({ keepScroll: true });
      return;
    }
    if (action === 'chat-refresh') { await loadChat(); toast('会话已刷新', 'refresh'); return; }
    if (action === 'chat-clear') { const input = $('#chat-input'); if (input) { input.value = ''; input.focus(); } return; }
    if (action === 'chat-job') { await openChatJob(act.dataset.id); return; }
    if (action === 'filter-logs') { ui.logs.q = act.dataset.id; closeDrawer(); navigate('data/logs'); return; }
    if (action === 'resolve-job') {
      const id = Number(act.dataset.id), outcome = act.dataset.outcome;
      openModal({
        title: outcome === 'sent' ? '标记为已核实发送？' : '放弃这个任务？',
        body: `<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">${outcome === 'sent' ? '请先在 QQ 中确认消息已经出现。标记不会触发第二次发送。' : '任务会标记为失败，不会再次发送。'}</p>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('确认', { act: 'do-resolve-job', attrs: `data-id="${id}" data-outcome="${esc(outcome)}"`, small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-resolve-job') {
      closeModal();
      try {
        await API.resolveJob(Number(act.dataset.id), act.dataset.outcome);
        await API.loadAll(); render({ keepScroll: true }); closeDrawer();
        toast('任务已核对', 'check');
      } catch (error) { toast('操作失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-cookie') {
      openModal({
        title: '保存 QQ 空间 Cookie',
        body: `<div class="fields" style="grid-template-columns:1fr">
          <div class="field"><label for="qzone-cookie">Cookie</label><textarea class="textarea" id="qzone-cookie" rows="5" placeholder="uin=...; skey=...; p_skey=..."></textarea><p class="help">必须包含 uin、skey、p_skey；只保存在本机数据目录，页面不回显。</p></div>
          <div class="field"><label for="qzone-token">pt4_token（可选）</label><input class="input" id="qzone-token" autocomplete="off"></div>
        </div>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('保存', { act: 'do-qzone-cookie', small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-qzone-cookie') {
      const cookie = ($('#qzone-cookie') && $('#qzone-cookie').value.trim()) || '';
      const token = ($('#qzone-token') && $('#qzone-token').value.trim()) || '';
      if (!cookie) { toast('请填写 Cookie', 'alert'); return; }
      try {
        const status = await API.qzoneSession(cookie, token);
        S.qzoneStatus = status;
        closeModal();
        toast('空间 Cookie 已保存', 'check');
        render({ keepScroll: true });
      } catch (error) { toast('保存失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-check') {
      act.disabled = true;
      try {
        const status = await API.qzoneCheck();
        S.qzoneStatus = status;
        toast('空间连接正常', 'check');
        render({ keepScroll: true });
      } catch (error) { toast('检查失败：' + error.message, 'alert'); act.disabled = false; }
      return;
    }
    if (action === 'qzone-clear') {
      openModal({
        title: '清除空间凭据？',
        body: '<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">清除后不能发布，已发布的记录仍保留。重新发布需要再次保存 Cookie。</p>',
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('清除', { act: 'do-qzone-clear', small: true, kind: 'btn-danger' })}`
      });
      return;
    }
    if (action === 'do-qzone-clear') {
      closeModal();
      try {
        S.qzoneStatus = await API.qzoneClear();
        toast('空间凭据已清除', 'trash');
        render({ keepScroll: true });
      } catch (error) { toast('清除失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-blank') {
      openModal({
        title: '手写空间草稿',
        body: `<div class="fields" style="grid-template-columns:1fr">
          <div class="field"><label for="qzone-blank-content">正文</label><textarea class="textarea" id="qzone-blank-content" rows="6" placeholder="1–2000 字"></textarea><p class="help">保存为草稿，不会立即发布。</p></div>
          <div class="field"><label for="qzone-blank-visibility">可见范围</label><select class="select" id="qzone-blank-visibility"><option value="private">仅自己</option><option value="friends">好友</option><option value="public">所有人</option></select></div>
        </div>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('保存草稿', { act: 'do-qzone-blank', small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-qzone-blank') {
      const content = ($('#qzone-blank-content') && $('#qzone-blank-content').value.trim()) || '';
      const visibility = ($('#qzone-blank-visibility') && $('#qzone-blank-visibility').value) || 'private';
      if (!content) { toast('请输入正文', 'alert'); return; }
      try {
        await API.qzoneDraft({ content, visibility });
        closeModal();
        toast('草稿已保存', 'check');
        await refreshQzone();
      } catch (error) { toast('保存失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-new') {
      openModal({
        title: '新建空间说说',
        body: `<div class="fields" style="grid-template-columns:1fr">
          <div class="field"><label for="qzone-prompt">主题或素材</label><textarea class="textarea" id="qzone-prompt" rows="5" placeholder="例如：写一条关于周末下雨、在家读书的说说"></textarea><p class="help">模型会据此生成正文；生成后仍可编辑。</p></div>
          <div class="field"><label for="qzone-visibility">可见范围</label><select class="select" id="qzone-visibility"><option value="private">仅自己</option><option value="friends">好友</option><option value="public">所有人</option></select></div>
        </div>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('生成草稿', { act: 'do-qzone-new', small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-qzone-new') {
      const prompt = ($('#qzone-prompt') && $('#qzone-prompt').value.trim()) || '';
      const visibility = ($('#qzone-visibility') && $('#qzone-visibility').value) || 'private';
      if (!prompt) { toast('请填写主题或素材', 'alert'); return; }
      try {
        const post = await API.qzoneGenerate(prompt, visibility);
        closeModal();
        toast('已创建生成任务，稍后刷新结果', 'spark');
        if (post && post.id) S.qzonePosts = [post, ...qzonePosts()];
        startQzonePoll();
        render({ keepScroll: true });
      } catch (error) { toast('生成失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-edit') {
      const post = qzonePosts().find((item) => String(item.id) === act.dataset.id);
      if (!post) return;
      closeDrawer();
      openModal({
        title: '编辑说说草稿',
        body: `<div class="fields" style="grid-template-columns:1fr">
          <div class="field"><label for="qzone-content">正文</label><textarea class="textarea" id="qzone-content" rows="6">${esc(post.content || '')}</textarea></div>
          <div class="field"><label for="qzone-edit-visibility">可见范围</label><select class="select" id="qzone-edit-visibility">${Object.entries(VISIBILITY).map(([value, label]) => `<option value="${value}" ${post.visibility === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        </div>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('保存草稿', { act: 'do-qzone-edit', attrs: `data-id="${esc(post.id)}" data-revision="${esc(post.revision)}"`, small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-qzone-edit') {
      const content = ($('#qzone-content') && $('#qzone-content').value.trim()) || '';
      const visibility = ($('#qzone-edit-visibility') && $('#qzone-edit-visibility').value) || 'private';
      try {
        await API.qzoneDraft({ id: Number(act.dataset.id), revision: Number(act.dataset.revision), content, visibility });
        closeModal();
        toast('草稿已保存', 'check');
        await refreshQzone();
      } catch (error) { toast('保存失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-publish') {
      const post = qzonePosts().find((item) => String(item.id) === act.dataset.id);
      if (!post) return;
      const status = S.qzoneStatus || {};
      closeDrawer();
      openModal({
        title: '发布到 QQ 空间？',
        body: `<p style="font-size:12.5px;line-height:1.7;color:var(--muted)">会以 ${esc(status.account ? mask(status.account) : '当前空间账号')} 发布，可见范围「${esc(VISIBILITY[post.visibility] || post.visibility)}」。发布后请到空间核对结果。</p>`,
        actions: `${btn('取消', { act: 'close-modal', small: true, kind: 'btn-ghost' })}${btn('发布', { act: 'do-qzone-publish', attrs: `data-id="${esc(post.id)}" data-revision="${esc(post.revision)}" data-account="${esc(status.account || 0)}"`, small: true, kind: 'btn-primary' })}`
      });
      return;
    }
    if (action === 'do-qzone-publish') {
      try {
        await API.qzonePublish(Number(act.dataset.id), Number(act.dataset.revision), Number(act.dataset.account));
        closeModal();
        toast('已提交发布，稍后刷新结果', 'send');
        startQzonePoll();
        await refreshQzone();
      } catch (error) { toast('发布失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'qzone-resolve') {
      const post = qzonePosts().find((item) => String(item.id) === act.dataset.id);
      if (!post) return;
      try {
        await API.qzoneResolve(post.id, post.revision, act.dataset.outcome);
        closeDrawer();
        toast('记录已核对', 'check');
        await refreshQzone();
      } catch (error) { toast('操作失败：' + error.message, 'alert'); }
      return;
    }
    if (action === 'toggle-theme') {
      theme = theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('limen-console-theme', theme);
      $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
      toast(theme === 'dark' ? '已切换到深色' : '已切换到浅色', 'info');
      if (path === 'settings') render({ keepScroll: true });
      return;
    }
    if (action === 'leave-config') {
      form = { ...settingsValues() }; secretTouched = new Set(); dirtyKeys = new Set();
      closeModal();
      navigate(act.dataset.go, { force: true });
      return;
    }
    if (action === 'copy') {
      let text = '';
      if (act.dataset.json === 'config') text = pretty(jsonDraft || {});
      else if (act.dataset.json && act.dataset.json.startsWith('message:')) {
        const id = act.dataset.json.slice(8);
        const entry = messagesOf().find((item) => String(item.id) === id);
        text = entry ? pretty(entry.event) : '';
      } else text = act.dataset.text || '';
      try { await navigator.clipboard.writeText(text); toast('已复制', 'copy'); }
      catch { toast('浏览器拒绝了剪贴板访问', 'info'); }
      return;
    }
    if (action === 'close-drawer') { closeDrawer(); return; }
    if (action === 'close-modal') { closeModal(); return; }
  });

  document.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-act="toggle-plugin"]');
    if (toggle) {
      togglePlugin(toggle.dataset.id, toggle.dataset.revision, toggle.checked);
      return;
    }
    const schema = event.target.closest('[data-schema]');
    if (schema) {
      const formEl = schema.closest('form');
      const range = formEl && formEl.querySelector(`[data-range="${CSS.escape(schema.dataset.schema)}"]`);
      if (range) range.value = schema.value;
    }
  });

  function openLogDrawer(entry) {
    const match = /job[=:]?\s*(\d+)/i.exec(logDetail(entry)) || /"job":\s*(\d+)/.exec(pretty(entry.fields || {}));
    openDrawer({
      kicker: `LOG / ${String(entry.level || 'info').toUpperCase()}`,
      title: entry.event || 'event',
      sections: [
        { title: '字段', html: entry.fields && Object.keys(entry.fields).length ? `<pre class="code-block">${esc(clip(pretty(entry.fields)))}</pre>` : '<p class="inline-note">这条事件没有附加字段。</p>' },
        { title: '时间', html: `<p>${esc(stamp(entry.time))} · ${esc(clock(entry.time))}</p>` }
      ],
      actions: `${match ? btn('查看任务 #' + match[1], { act: 'open-job', attrs: `data-id="${esc(match[1])}"`, small: true }) : ''}${btn('关闭', { act: 'close-drawer', small: true, kind: 'btn-ghost' })}`
    });
  }

  document.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act="open-job"]');
    if (!act) return;
    closeDrawer();
    openJob(act.dataset.id);
  });

  /* ------------------------------------------------------------- 启动 */

  window.addEventListener('hashchange', () => {
    const previous = path;
    closeSide();
    closeDrawer();
    closeModal();
    closePalette();
    if (previous === 'chat' && parsePath() !== 'chat' && chatClose) {
      chatClose();
      chatClose = null;
    }
    if (path.startsWith('config/') && !parsePath().startsWith('config/')) {
      form = { ...settingsValues() }; secretTouched = new Set(); dirtyKeys = new Set();
    }
    render();
  });

  $('#theme-toggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('limen-console-theme', theme);
    $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  });
  $('#side-open').addEventListener('click', openSide);
  $('#side-close').addEventListener('click', closeSide);
  $('#scrim').addEventListener('click', () => { closeSide(); closeDrawer(); closeModal(); closePalette(); });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#account-btn').addEventListener('click', () => navigate('platforms'));
  $('#profile-chip').addEventListener('click', () => {
    const state = S.state || {};
    openModal({
      title: '账号与连接',
      body: `<div class="stack" style="gap:10px">${kv([
        ['QQ', state.online ? dotBadge('在线', 'ok') : dotBadge(STATE_LABEL[state.state] || '离线', 'warn')],
        ['账号', `<code>${esc(state.account ? mask(state.account) : '未登录')}</code>`],
        ['驱动', `<code>${esc(state.driver || '—')}</code>`],
        ['内核版本', `<code>${esc(state.version || '—')}</code>`],
        ['服务地址', `<code>${esc(state.endpoint || '—')}</code>`]
      ])}</div>`,
      actions: `${linkBtn('平台与机器人', 'platforms', { small: true })}${btn('关闭', { act: 'close-modal', small: true, kind: 'btn-ghost' })}`
    });
  });
  $('#refresh').addEventListener('click', async () => {
    const button = $('#refresh');
    button.disabled = true;
    await API.loadAll();
    refreshIndex();
    render({ keepScroll: true });
    button.disabled = false;
    toast('已重新读取当前页面', 'refresh');
  });

  $('#search-open').addEventListener('click', openPalette);
  $('#palette-input').addEventListener('input', (event) => { paletteState.q = event.target.value; paletteState.index = 0; renderPalette(); });
  $('#palette-list').addEventListener('click', (event) => {
    const item = event.target.closest('li[data-path]');
    if (!item) return;
    closePalette();
    navigate(item.dataset.path);
  });
  $('#palette').addEventListener('click', (event) => { if (event.target.id === 'palette') closePalette(); });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if ($('#palette').hidden) openPalette(); else closePalette();
      return;
    }
    if (event.key === 'Escape') {
      if (!$('#palette').hidden) closePalette();
      else if (!$('#modal').hidden) closeModal();
      else if (!$('#drawer').hidden) closeDrawer();
      else if ($('#app').getAttribute('data-nav') === 'open') closeSide();
      return;
    }
    if ($('#palette').hidden) return;
    const items = paletteState.items;
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteState.index = (paletteState.index + 1) % Math.max(1, items.length); renderPalette(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); paletteState.index = (paletteState.index - 1 + items.length) % Math.max(1, items.length); renderPalette(); }
    else if (event.key === 'Enter') {
      const item = items[paletteState.index];
      if (item) { closePalette(); navigate(item.path); }
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirtyKeys.size || secretTouched.size) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    const reason = event.reason;
    toast('操作失败：' + (reason && reason.message ? reason.message : '未知错误'), 'alert');
  });

  /* 实时刷新：只在工作台与数据页重绘，避免打断表单、对话与筛选输入。 */
  setInterval(async () => {
    if (document.hidden || !S.loaded) return;
    await API.refreshLive().catch(() => {});
    renderShell();
    const active = document.activeElement;
    const typing = active && active.closest && active.closest('#main') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
    const safePage = path === 'dashboard' || path === 'platforms' || path.startsWith('data/') || (path.startsWith('plugins/') && path.endsWith('/events'));
    const floating = !$('#drawer').hidden || !$('#modal').hidden || !$('#palette').hidden;
    if (safePage && !floating && !typing) render({ keepScroll: true });
  }, 5000);

  /* 初始化 */
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  render();
  API.loadAll().then(() => {
    refreshIndex();
    render({ keepScroll: true });
  }).catch(() => render({ keepScroll: true }));
})();
