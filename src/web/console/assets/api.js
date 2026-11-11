/* Limen · 控制台数据层
   只读取正在运行的服务：<prefix>/state /settings /plugins /jobs /telemetry ...
   没有任何演示夹具，也没有「读不到就回退样例」的分支。
   每个接口单独记录成功或失败；页面据此渲染真实数据、空状态或错误状态。 */
(() => {
  'use strict';

  const meta = (name) => {
    const el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.content : '';
  };
  const BASE = (window.LIMEN_API_BASE || meta('limen-api-base') || '').replace(/\/$/, '');
  const EMBEDDED = meta('limen-embedded') === '1';

  class ApiError extends Error {
    constructor(message, status = 0, path = '') {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.path = path;
    }
  }

  async function request(path, { method = 'GET', body, timeout = 25000 } = {}) {
    if (!BASE) throw new ApiError('页面没有拿到接口地址，请从桌面程序或工作台链接打开。', 0, path);
    let response;
    try {
      response = await fetch(BASE + path, {
        method,
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      const reason = error && error.name === 'TimeoutError' ? '请求超时' : '无法连接本机服务';
      throw new ApiError(reason + '，请确认机器人服务仍在运行。', 0, path);
    }
    const text = await response.text();
    let value = null;
    if (text) {
      try { value = JSON.parse(text); }
      catch { throw new ApiError('服务返回了非 JSON 响应（HTTP ' + response.status + '）。', response.status, path); }
    }
    if (!response.ok) {
      const message = value && typeof value.message === 'string' && value.message ? value.message : '请求失败（HTTP ' + response.status + '）';
      throw new ApiError(message, response.status, path);
    }
    if (value && value.status === 'failed' && typeof value.message === 'string') throw new ApiError(value.message, response.status, path);
    return value && value.status === 'ok' && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  }

  const get = (path, options) => request(path, options);
  const post = (path, body = {}, options = {}) => request(path, { ...options, method: 'POST', body });

  /** 二进制上传（启动视频走原始 body，其它接口用 data URL）。 */
  async function upload(path, file, timeout = 120000) {
    if (!BASE) throw new ApiError('页面没有拿到接口地址，请从桌面程序或工作台链接打开。', 0, path);
    let response;
    try {
      response = await fetch(BASE + path, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name || '')
        },
        body: file,
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      const reason = error && error.name === 'TimeoutError' ? '上传超时' : '无法连接本机服务';
      throw new ApiError(reason + '，请确认机器人服务仍在运行。', 0, path);
    }
    const text = await response.text();
    let value = null;
    if (text) {
      try { value = JSON.parse(text); }
      catch { throw new ApiError('服务返回了非 JSON 响应（HTTP ' + response.status + '）。', response.status, path); }
    }
    if (!response.ok) {
      const message = value && typeof value.message === 'string' && value.message ? value.message : '上传失败（HTTP ' + response.status + '）';
      throw new ApiError(message, response.status, path);
    }
    if (value && value.status === 'failed') throw new ApiError(value.message || '上传失败', response.status, path);
    return value && value.status === 'ok' && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  }

  /* 数据来自这些真实接口。键名同时用于页面的错误提示。 */
  const KEYS = [
    ['/state', 'state'],
    ['/settings', 'settings'],
    ['/plugins', 'plugins'],
    ['/jobs', 'jobs'],
    ['/job-conversations', 'conversations'],
    ['/telemetry?after=0', 'telemetry'],
    ['/qzone/status', 'qzoneStatus'],
    ['/qzone/posts', 'qzonePosts'],
    ['/agent', 'agent']
  ];

  const store = {
    loaded: false,
    loading: null,
    at: 0,
    errors: {},
    state: null,
    settings: null,
    plugins: null,
    jobs: null,
    conversations: null,
    telemetry: { entries: [], cursor: 0 },
    qzoneStatus: null,
    qzonePosts: null,
    agent: null,
    /** 额外按需读取的区块。 */
    extra: {}
  };

  function assign(key, value) {
    store[key] = value;
    delete store.errors[key];
  }

  function fail(key, error) {
    store.errors[key] = error instanceof Error ? error.message : String(error);
  }

  async function loadAll() {
    if (!BASE) {
      store.loaded = true;
      store.at = Date.now();
      store.errors.state = '页面没有拿到接口地址';
      return store;
    }
    if (store.loading) return store.loading;
    store.loading = (async () => {
      const settled = await Promise.allSettled(KEYS.map(([path]) => get(path)));
      settled.forEach((result, index) => {
        const [, key] = KEYS[index];
        if (result.status === 'fulfilled') {
          if (key === 'telemetry') {
            const value = result.value || {};
            store.telemetry = { entries: Array.isArray(value.entries) ? value.entries : [], cursor: Number(value.cursor) || 0 };
            delete store.errors[key];
          } else assign(key, result.value);
        } else fail(key, result.reason);
      });
      store.loaded = true;
      store.at = Date.now();
      store.loading = null;
      return store;
    })();
    return store.loading;
  }

  /** 增量刷新：状态、任务与事件；不触碰配置表单与插件详情。 */
  async function refreshLive() {
    const settled = await Promise.allSettled([
      get('/state'),
      get('/jobs'),
      get('/telemetry?after=' + (Number(store.telemetry.cursor) || 0)),
      get('/agent')
    ]);
    const [state, jobs, telemetry, agent] = settled;
    if (state.status === 'fulfilled') assign('state', state.value); else fail('state', state.reason);
    if (jobs.status === 'fulfilled') assign('jobs', jobs.value); else fail('jobs', jobs.reason);
    if (agent.status === 'fulfilled') assign('agent', agent.value); else fail('agent', agent.reason);
    if (telemetry.status === 'fulfilled') {
      const value = telemetry.value || {};
      const incoming = Array.isArray(value.entries) ? value.entries : [];
      if (incoming.length) {
        const merged = new Map(store.telemetry.entries.map((entry) => [entry.id, entry]));
        incoming.forEach((entry) => merged.set(entry.id, entry));
        store.telemetry.entries = [...merged.values()].sort((a, b) => a.id - b.id).slice(-1000);
      }
      store.telemetry.cursor = Number(value.cursor) || store.telemetry.cursor;
      delete store.errors.telemetry;
    } else fail('telemetry', telemetry.reason);
    store.at = Date.now();
    return store;
  }

  async function extra(path, key = path) {
    try {
      const value = await get(path);
      store.extra[key] = { value, error: null, at: Date.now() };
      return value;
    } catch (error) {
      store.extra[key] = { value: null, error: error.message, at: Date.now() };
      throw error;
    }
  }

  const forgetExtra = (key) => { delete store.extra[key]; };

  /* ------------------------------------------------------------- 写入操作 */

  const writes = {
    async saveSettings(values, revision) {
      const value = await post('/settings', { values, revision });
      if (value && Array.isArray(value.fields)) assign('settings', value);
      return value;
    },
    reveal: (key) => post('/settings/reveal', { key }),
    models: (params) => post('/models', params),
    togglePlugin: (id, revision, enabled) => post('/plugins/toggle', { id, revision, enabled }),
    savePlugin: (id, revision, plugin) => post('/plugins/save', { id, revision, plugin }),
    installPlugin: (kind) => post('/plugins/install', { kind }),
    deletePlugin: (id, revision) => post('/plugins/delete', { id, revision }),
    testPlugin: (params) => post('/plugins/test', params),
    reloadPlugins: (params) => post('/plugins/reload', params || {}),
    pluginAction: (route, params) => post(route, params),
    resolveJob: (id, outcome) => post('/resolve', { id, outcome }),
    restart: () => post('/restart', {}),
    /** 只读查询 QQ 官方最新内核版本，不会下载或改动运行时。 */
    kernelUpdate: () => get('/kernel/update', { timeout: 30000 }),
    logout: () => post('/logout', {}),
    qr: () => post('/qr', {}),
    chat: (session, text) => post('/agent/chat', { session, text }),
    qzoneSession: (cookie, token) => post('/qzone/session', { cookie, token }),
    qzoneClear: () => post('/qzone/clear', {}),
    qzoneCheck: () => post('/qzone/check', {}),
    qzoneGenerate: (prompt, visibility) => post('/qzone/generate', { prompt, visibility }),
    qzoneDraft: (params) => post('/qzone/draft', params),
    qzonePublish: (id, revision, account) => post('/qzone/publish', { id, revision, account }),
    qzoneResolve: (id, revision, outcome) => post('/qzone/resolve', { id, revision, outcome }),
    background: (params) => post('/background/action', params),
    startup: (params) => post('/startup-animation/action', params),
    startupVideo: (file) => upload('/startup-animation/video', file),
    /** 一键导入 ZIP 插件包：原始字节上传，服务端校验并写入 plugins/<id>/。 */
    uploadPluginPackage: (file, overwrite = false) =>
      upload('/plugins/packages/upload' + (overwrite ? '?overwrite=1' : ''), file, 60000),
    /* 插件市场：清单读一份静态 index.json，安装沿用服务端安装器。
       下载 + 校验 + 写盘都在服务端完成，浏览器只等结果，因此超时按动作分别放宽。 */
    market: (refresh = false) => get('/market' + (refresh ? '?refresh=1' : ''), { timeout: 60000 }),
    marketInstall: (id, overwrite = false) => post('/market/install', { id, overwrite }, { timeout: 150000 }),
    marketRemove: (id) => post('/market/uninstall', { id, confirm: true }, { timeout: 150000 }),
    /** FFmpeg 这类资源上百 MB，给足 10 分钟。 */
    marketAsset: (id) => post('/market/asset', { id }, { timeout: 620000 }),
    memes: (route, params) => post('/memes/' + route, params),
    memory: (params) => post('/plugins/memory/action', params),
    groupchat: (params) => post('/plugins/groupchat/action', params)
  };

  /* ------------------------------------------------------------- 长连接 */

  function chatStream(session, onData, onError) {
    if (!BASE) return () => {};
    let source;
    try {
      source = new EventSource(BASE + '/agent/chat/stream?session=' + encodeURIComponent(session));
    } catch (error) {
      if (onError) onError(error);
      return () => {};
    }
    source.onmessage = (event) => {
      try { onData(JSON.parse(event.data)); }
      catch { /* 心跳或非 JSON 事件忽略 */ }
    };
    source.onerror = (event) => { if (onError) onError(event); };
    return () => source.close();
  }

  window.LIMEN = {
    BASE,
    EMBEDDED,
    ApiError,
    store,
    get,
    post,
    loadAll,
    refreshLive,
    extra,
    forgetExtra,
    ...writes,
    chatStream
  };
})();
