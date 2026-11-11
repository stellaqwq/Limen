import { createServer } from 'node:http';
import {listenHTTP} from '../listen-http.mjs';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage } from './page.mjs';

// 新版控制台静态资源。默认入口走这里，旧管理台保留在 /legacy。
const consoleRoot = fileURLToPath(new URL('./console/', import.meta.url));
const consoleTypes = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const consoleCSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";
function consoleReply(res, headers, code, data, type) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { ...headers, 'Content-Security-Policy': consoleCSP, 'Content-Type': `${type}; charset=utf-8` });
  res.end(data);
}
async function consoleAsset(rel, prefix) {
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..')) throw new Error('invalid path');
  const file = join(consoleRoot, rel);
  const body = await readFile(file);
  const type = consoleTypes[extname(file)] || 'application/octet-stream';
  if (rel !== 'index.html') return { data: body, type };
  // 不用 <base>：它会把页面里的 hash 链接解析回经典管理台。直接把相对资源路径改成绝对前缀。
  const html = body.toString('utf8')
    .replace(/(src|href)="assets\//g, `$1="${prefix}/assets/`)
    .replace('<meta name="limen-embedded" content="0">', '<meta name="limen-embedded" content="1">')
    .replace('<meta name="limen-api-base" content="">', `<meta name="limen-api-base" content="${prefix}">`);
  return { data: html, type: 'text/html' };
}

export async function createLoginServer({ backend, token, port = 0, connection, restart }) {
  if (!token) throw new Error('ADMIN_ACCESS_TOKEN is missing; run npm run init first');
  const prefix = `/login/${randomBytes(24).toString('hex')}`, nonce = randomBytes(24).toString('base64');
  let qr, inFlight, closing;
  const controller = new AbortController();
  async function call(path, params, budget = 25000) {
    const current = connection ? connection() : { backend, token };
    const base = new URL(current.backend);
    const response = await fetch(new URL(path, base), { method: params === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' },
      body: params === undefined ? undefined : JSON.stringify(params),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(budget)]) });
    const value = await response.json();
    if ((path.startsWith('/admin/plugins') || path.startsWith('/admin/memes')) && response.status === 404 && value.retcode === 1404) {
      throw Object.assign(new Error('当前机器人服务仍为旧版本，尚未加载新增的插件或图库接口。请在原启动窗口按 Ctrl+C 退出机器人，再重新运行 start.cmd，然后刷新此页面；只关闭网页或打开第二个工作台不会更新旧服务。'), { status: 409 });
    }
    if (!response.ok || value.status === 'failed' && Object.hasOwn(value,'retcode')) throw Object.assign(new Error(value.message || '无法连接机器人服务'), { status:response.status });
    return value.data ?? value;
  }
  // The backend advertises admin-root media URLs; the workbench only serves
  // them under its random login prefix. Rewrite the snapshot at the boundary
  // so both the server-rendered overlay and the management preview load them.
  const workspaceStartup = value => {
    if (!value || typeof value !== 'object') return value;
    let result = value;
    const rewrite = (key, route) => {
      const item = value[key];
      if (!item || !new RegExp('^/' + route + '\\?v=[a-f0-9]{12}$').test(item.url || '')) return;
      result = { ...result, [key]: { ...item, url: prefix + item.url } };
    };
    rewrite('logo', 'startup-animation/media');
    rewrite('video', 'startup-animation/video');
    return result;
  };
  async function snapshot() {
    let status = await call('/admin/status');
    const current = qr;
    let login;
    if (!status.online && current?.handle) {
      try { login = await call('/admin/login/poll', { handle: current.handle }); }
      catch { /* Restarting the host can invalidate an earlier QR handle. */ }
      if (login?.state === 'online') status = await call('/admin/status');
    }
    return { online: status.online === true,
      state: status.online ? 'online' : login?.state || status.kernel?.login_state || status.native?.login_state || 'idle',
      account: status.account || 0, driver: status.driver, simulated: status.simulated === true,privacy:status.privacy,
      ai_enabled: status.ai_enabled === true, jobs: status.jobs || {}, version: status.kernel?.version || null,
      endpoint: new URL(connection ? connection().backend : backend).origin, can_restart:!!restart,
      appearance: status.appearance || null,
      startup: workspaceStartup(status.startup || null),
      expires_at: current === qr ? login?.expires_at ?? qr?.expires_at ?? null : null,
      handle: qr?.handle || null, checked_at: Date.now() };
  }
  const html = renderPage(nonce);
  const server = createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; img-src 'self' data:; media-src 'self'; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` };
    function reply(code, data, type = 'application/json') {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(code, { ...headers, 'Content-Type': `${type}; charset=utf-8` }); res.end(type === 'text/html' ? data : JSON.stringify(data));
    }
    const address = server.address(), origin = address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : null;
    const url = new URL(req.url, 'http://localhost');
    // The classic workbench is also reachable at <prefix>/legacy. Its inline
    // client used to build API paths from location.pathname, producing
    // <prefix>/legacy/state, which fell outside the route allowlist and was
    // rejected with 404 "Not found". Normalize here too so pages opened before
    // the client fix keep working after a simple refresh.
    const rawRoute = url.pathname.slice(prefix.length);
    const route = rawRoute === '/legacy' ? '' : rawRoute.startsWith('/legacy/') ? rawRoute.slice('/legacy'.length) : rawRoute;
    const routes = ['', '/legacy', '/qr','/state','/settings','/settings/reveal','/models','/telemetry','/jobs','/job-conversations','/job','/resolve','/logout','/restart'];
    routes.push('/qzone/status','/qzone/posts','/qzone/session','/qzone/clear','/qzone/check','/qzone/draft','/qzone/generate','/qzone/publish','/qzone/resolve');
    routes.push('/plugins/free-activity','/plugins/free-activity/action','/plugins/memory','/plugins/memory/action','/plugins/reload','/plugins/groupchat','/plugins/groupchat/action','/plugins','/plugins/detail','/plugins/save','/plugins/toggle','/plugins/delete','/plugins/test','/plugins/install','/plugins/packages','/plugins/packages/inspect','/plugins/packages/install','/plugins/packages/upload','/plugins/packages/remove');
    routes.push('/voicestudio/voices');
    routes.push('/background','/background/action','/background/image');
    routes.push('/startup-animation','/startup-animation/action','/startup-animation/media','/startup-animation/video');
    routes.push('/agent','/agent/chat','/agent/chat/stream','/agent/attachments','/agent/memories','/agent/memory/update','/agent/persona','/agent/persona/delete','/agent/bind','/agent/reset','/agent/forget');
    routes.push('/agent/social/default','/agent/social/chat','/agent/social/reply','/agent/social','/agent/social/action','/agent/social/inspect','/agent/social/open','/agent/social/draft','/agent/knowledge','/agent/knowledge/action','/agent/douyin/control','/agent/douyin/screenshot','/agent/douyin/open','/agent/android/control','/agent/android/screenshot','/agent/computer/control','/agent/computer/screenshot');
    routes.push('/memes','/memes/image','/memes/install','/memes/upload','/memes/edit','/memes/preview','/memes/category/save','/memes/category/delete','/memes/settings');
    routes.push('/market','/market/install','/market/uninstall','/market/asset');
    // 只有按钮点了才会联网查官方版本，不做后台轮询。
    routes.push('/kernel/update');
    // 根地址保持经典管理台（启动动画与既有测试依赖它）；桌面启动目标指向 /console。
    const consoleAssetHit = url.pathname.startsWith(prefix + '/console') || url.pathname.startsWith(prefix + '/assets/');
    if (consoleAssetHit) {
      if (!origin || req.headers.host !== new URL(origin).host || req.method !== 'GET') { reply(404, { message: 'Not found' }); return; }
      try {
        const directAsset = url.pathname.startsWith(prefix + '/assets/');
        const rel = directAsset ? url.pathname.slice(prefix.length + 1)
          : url.pathname.slice((prefix + '/console').length).replace(/^\//, '') || 'index.html';
        const asset = await consoleAsset(rel, prefix);
        consoleReply(res, headers, 200, asset.data, asset.type);
      } catch { reply(404, { message: 'Not found' }); }
      return;
    }
    if (!origin || req.headers.host !== new URL(origin).host || !url.pathname.startsWith(prefix) || !routes.includes(route)) { reply(404, { message: 'Not found' }); return; }
    try {
      if (req.method === 'POST' && req.headers.origin !== origin) { reply(403, { message: 'Origin rejected' }); return; }
      if (req.method === 'GET' && (route === '' || route === '/legacy')) {
        // The startup animation has to exist on the very first paint, so the
        // page is rendered per request with the current appearance. A slow or
        // restarting backend falls back to the plain page instead of blocking.
        const startup = await Promise.race([
          call('/admin/status').then(status => workspaceStartup(status?.startup || null)).catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        // The desktop window already played the animation while the backend
        // booted. It passes ?boot=1 so the workspace keeps the same frozen
        // frame and dissolves into the console instead of replaying the intro.
        const value = startup && url.searchParams.get('boot') === '1' ? { ...startup, handoff: true } : startup;
        reply(200, value ? renderPage(nonce, value) : html, 'text/html');
        return;
      }
      if (req.method === 'GET' && route === '/state') { reply(200, await snapshot()); return; }
      if (req.method === 'GET' && route === '/kernel/update') { reply(200, await call('/admin/kernel/update', undefined, 30000)); return; }
      if (req.method === 'GET' && route === '/agent/chat/stream') {
        const session=url.searchParams.get('session');
        if(!/^[a-f0-9-]{36}$/.test(session||'')){reply(400,{message:'网页会话编号无效。'});return;}
        const client=new AbortController(),current=connection?connection():{backend,token};
        res.once('close',()=>client.abort());
        try {
          const response=await fetch(new URL('/admin/agent/chat/stream?session='+encodeURIComponent(session),current.backend),{
            headers:{Authorization:`Bearer ${current.token}`},signal:AbortSignal.any([controller.signal,client.signal])});
          if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream')){
            await response.body?.cancel();reply(502,{message:'实时对话连接失败。'});return;
          }
          res.writeHead(200,{...headers,'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'});res.flushHeaders();
          for await(const chunk of response.body){
            if(res.destroyed)break;
            if(res.writableLength>1024*1024){res.destroy();break;}
            res.write(chunk);
          }
          res.end();
        } finally {client.abort();}
        return;
      }
      if (req.method === 'GET' && ['/agent','/agent/chat','/agent/memories'].includes(route)) { reply(200,await call('/admin'+route+url.search)); return; }
      if (req.method === 'GET' && route === '/settings') { reply(200, await call('/admin/settings')); return; }
      if(req.method==='GET'&&route==='/plugins/groupchat'){reply(200,await call('/admin/plugins/groupchat'+url.search));return;}
      if(req.method==='GET'&&route==='/plugins/free-activity'){reply(200,await call('/admin/plugins/free-activity'+url.search));return;}
      if(req.method==='GET'&&route==='/plugins/memory'){reply(200,await call('/admin/plugins/memory'+url.search));return;}
      if (req.method === 'GET' && route === '/background') { reply(200, await call('/admin/background')); return; }
      if (req.method === 'GET' && route === '/background/image') {
        const current = connection ? connection() : { backend, token };
        const response = await fetch(new URL('/admin/background/image', current.backend), {
          headers: { Authorization: `Bearer ${current.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const type = response.headers.get('content-type');
        if (!response.ok || !['image/png','image/jpeg','image/webp'].includes(type)) {
          await response.body?.cancel(); reply(response.status === 404 ? 404 : 502, { message: '背景图片不可用，请重新上传。' }); return;
        }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('背景图片超过大小限制。'); chunks.push(chunk); }
        if (!res.destroyed && !res.writableEnded) { res.writeHead(200, { ...headers, 'Cache-Control':'no-store', 'Content-Type': type, 'Content-Length': size }); res.end(Buffer.concat(chunks)); }
        return;
      }
      if (req.method === 'GET' && route === '/startup-animation') { reply(200, workspaceStartup(await call('/admin/startup-animation'))); return; }
      if (req.method === 'GET' && route === '/startup-animation/media') {
        const current = connection ? connection() : { backend, token };
        const response = await fetch(new URL('/admin/startup-animation/media', current.backend), {
          headers: { Authorization: `Bearer ${current.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const type = response.headers.get('content-type');
        if (!response.ok || !['image/png','image/jpeg','image/webp','image/gif'].includes(type)) {
          await response.body?.cancel(); reply(response.status === 404 ? 404 : 502, { message: '启动动画 Logo 不可用，请重新上传。' }); return;
        }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('启动动画 Logo 超过大小限制。'); chunks.push(chunk); }
        if (!res.destroyed && !res.writableEnded) { res.writeHead(200, { ...headers, 'Cache-Control':'no-store', 'Content-Type': type, 'Content-Length': size }); res.end(Buffer.concat(chunks)); }
        return;
      }
      if (req.method === 'GET' && route === '/startup-animation/video') {
        const current = connection ? connection() : { backend, token };
        const client = new AbortController();
        res.once('close', () => client.abort());
        const forward = { Authorization: `Bearer ${current.token}` };
        if (typeof req.headers.range === 'string') forward.Range = req.headers.range;
        const response = await fetch(new URL('/admin/startup-animation/video', current.backend), {
          headers: forward, signal: AbortSignal.any([controller.signal, client.signal, AbortSignal.timeout(20000)]) });
        const type = response.headers.get('content-type');
        if (!response.ok || !['video/mp4','video/webm'].includes(type)) {
          await response.body?.cancel();
          reply([404, 409].includes(response.status) ? response.status : 502, { message: '启动视频不可用，请重新上传。' }); return;
        }
        const out = { ...headers, 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        for (const name of ['content-length','content-range']) {
          const value = response.headers.get(name);
          if (value) out[name] = value;
        }
        if (!res.destroyed && !res.writableEnded) {
          res.writeHead(response.status, out);
          for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
          if (!res.destroyed && !res.writableEnded) res.end();
        }
        return;
      }
      if (req.method === 'POST' && route === '/plugins/packages/upload') {
        // 一键导入 ZIP 插件包：原始字节直接透传，避免 base64 撑大请求体。
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) { reply(413, { message:'ZIP 插件包超过 32 MiB，请精简后再导入。' }); return; }
          chunks.push(chunk);
        }
        if (!size) { reply(400, { message:'没有收到插件包内容，请重新选择文件。' }); return; }
        const current = connection ? connection() : { backend, token };
        const forward = { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/zip' };
        if (typeof req.headers['x-file-name'] === 'string') forward['X-File-Name'] = req.headers['x-file-name'];
        const overwrite = url.searchParams.get('overwrite') === '1' ? '?overwrite=1' : '';
        const response = await fetch(new URL('/admin/plugins/packages/upload' + overwrite, current.backend), {
          method: 'POST', headers: forward, body: Buffer.concat(chunks),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.status === 'failed') {
          reply([400, 409, 413].includes(response.status) ? response.status : 502,
            { message: data && data.message || '插件包导入失败，请检查 ZIP 内容后重试。' });
          return;
        }
        reply(200, data.data ?? data); return;
      }
      if (req.method === 'GET' && route === '/plugins') { reply(200, await call('/admin/plugins')); return; }
      if (req.method === 'GET' && route === '/market') { reply(200, await call('/admin/market' + url.search, undefined, 90000)); return; }
      if (req.method === 'POST' && ['/market/install','/market/uninstall','/market/asset'].includes(route)) {
        // 安装要下载插件包、装资源可能下载上百 MB，比普通管理接口慢得多，单独放宽超时。
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) { reply(413, { message: '请求超过大小限制。' }); return; } chunks.push(chunk); }
        let params;
        try { params = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { reply(400, { message: '无效 JSON。' }); return; }
        if (!params || typeof params !== 'object' || Array.isArray(params)) { reply(400, { message: '请求必须是对象。' }); return; }
        const current = connection ? connection() : { backend, token };
        const budget = route === '/market/asset' ? 620000 : 150000;
        const response = await fetch(new URL('/admin' + route, new URL(current.backend)), {
          method: 'POST', headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(params), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(budget)]) });
        const data = await response.json();
        if (!response.ok || data?.status === 'failed') {
          reply([400,403,404,409,413,502,504].includes(response.status) ? response.status : 502,
            { message: data?.message || '市场操作失败。' }); return;
        }
        reply(200, data?.data ?? data); return;
      }
      if (req.method === 'GET' && route === '/memes') { reply(200, await call('/admin/memes' + url.search)); return; }
      if (req.method === 'GET' && route === '/memes/image') {
        const id = url.searchParams.get('id');
        if (!/^[a-f0-9]{64}$/.test(id || '')) { reply(400, { message: '无效表情编号。' }); return; }
        const current = connection ? connection() : { backend, token };
        const response = await fetch(new URL('/admin/memes/image?id=' + id, current.backend), {
          headers: { Authorization: `Bearer ${current.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const type = response.headers.get('content-type');
        if (!response.ok || !['image/png','image/jpeg','image/gif','image/webp'].includes(type)) {
          await response.body?.cancel(); reply(response.status === 404 ? 404 : 502, { message: '表情文件不可用，请刷新图库。' }); return;
        }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 5 * 1024 * 1024) throw new Error('表情超过预览大小限制。'); chunks.push(chunk); }
        if (!res.destroyed && !res.writableEnded) { res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': size }); res.end(Buffer.concat(chunks)); }
        return;
      }
      if (req.method === 'GET' && route === '/plugins/detail') {
        const id = url.searchParams.get('id');
        if (!/^[a-f0-9-]{36}$/.test(id || '')) { reply(400, { message: '无效插件编号。' }); return; }
        reply(200, await call('/admin/plugins/detail?id=' + encodeURIComponent(id))); return;
      }
      if (req.method === 'GET' && ['/qzone/status','/qzone/posts'].includes(route)) { reply(200, await call('/admin' + route)); return; }
      if (req.method === 'GET' && route === '/agent/social') { reply(200,await call('/admin/agent/social'));return;}
      if (req.method === 'GET' && route === '/agent/knowledge') { reply(200,await call('/admin/agent/knowledge'+url.search)); return; }
      if (req.method === 'GET' && route === '/jobs') { reply(200, await call('/admin/jobs'+url.search)); return; }
      if (req.method === 'GET' && route === '/job-conversations') { reply(200, await call('/admin/jobs/conversations')); return; }
      if (req.method === 'GET' && route === '/job') {
        const id = url.searchParams.get('id');
        if (!/^[1-9]\d{0,14}$/.test(id||'')) { reply(400, { message:'无效任务编号。' }); return; }
        reply(200, await call('/admin/jobs/'+id)); return;
      }
      if (req.method === 'GET' && route === '/telemetry') {
        const after = url.searchParams.get('after') || '0';
        if (!/^\d{1,16}$/.test(after)) { reply(400, { message:'无效的监听游标。' }); return; }
        reply(200, await call('/admin/telemetry?after=' + after)); return;
      }
      if (req.method === 'POST' && route === '/qr') {
        if (!inFlight) inFlight = call('/admin/login/start', {}).then(value => { qr = value; return value; }).finally(() => { inFlight = null; });
        reply(200, await inFlight); return;
      }
      if (req.method === 'POST' && route === '/restart') {
        if (!restart) { reply(409, { message:'此工作台复用了其他进程的服务。请在原服务窗口重新启动。' }); return; }
        reply(200, await restart()); qr = null; return;
      }
      if (req.method === 'POST' && route === '/logout') { reply(200, await call('/admin/login/logout', {})); qr = null; return; }
      if (req.method === 'POST' && route === '/startup-animation/video') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 42 * 1024 * 1024) { reply(413, { message:'视频超过 40 MiB，请压缩后再上传。' }); return; } chunks.push(chunk); }
        const bytes = Buffer.concat(chunks);
        const current = connection ? connection() : { backend, token };
        const forward = { Authorization: `Bearer ${current.token}`,
          'Content-Type': req.headers['content-type'] || 'application/octet-stream' };
        if (typeof req.headers['x-file-name'] === 'string') forward['X-File-Name'] = req.headers['x-file-name'];
        const response = await fetch(new URL('/admin/startup-animation/video', current.backend), {
          method: 'POST', headers: forward, body: bytes,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
        const data = await response.json();
        if (!response.ok) { reply([400, 409, 413].includes(response.status) ? response.status : 502, { message: data.message || '视频上传失败。' }); return; }
        reply(200, workspaceStartup(data)); return;
      }
      if (req.method === 'POST' && ['/plugins/free-activity/action','/background/action','/startup-animation/action','/agent/social/default','/agent/social/chat','/agent/social/reply','/agent/social/action','/agent/social/inspect','/agent/social/open','/agent/social/draft','/agent/knowledge/action','/agent/douyin/control','/agent/douyin/screenshot','/agent/douyin/open','/agent/android/control','/agent/android/screenshot','/agent/computer/control','/agent/computer/screenshot','/plugins/memory/action','/plugins/reload','/plugins/groupchat/action','/agent/chat','/agent/attachments','/agent/memory/update','/agent/persona','/agent/persona/delete','/agent/bind','/agent/reset','/agent/forget','/settings','/settings/reveal','/resolve','/models','/qzone/session','/qzone/clear','/qzone/check','/qzone/draft','/qzone/generate','/qzone/publish','/qzone/resolve','/plugins/save','/plugins/toggle','/plugins/delete','/plugins/test','/plugins/install','/plugins/packages/inspect','/plugins/packages/install','/plugins/packages/remove','/voicestudio/voices','/memes/install','/memes/upload','/memes/edit','/memes/preview','/memes/category/save','/memes/category/delete','/memes/settings'].includes(route)) {
        const chunks = []; let size = 0;
        const maxSize = route === '/agent/attachments' ? 15*1024*1024 : route === '/background/action' ? 12 * 1024 * 1024 : route === '/startup-animation/action' ? 4 * 1024 * 1024 : route === '/memes/upload' ? 8 * 1024 * 1024 : 262144;
        for await (const chunk of req) { size += chunk.length; if (size > maxSize) { reply(413, { message:'请求超过大小限制。' }); return; } chunks.push(chunk); }
        const text = Buffer.concat(chunks).toString('utf8');
        let params;
        try { params = JSON.parse(text); } catch { reply(400, { message:'无效 JSON。' }); return; }
        if (!params || typeof params !== 'object' || Array.isArray(params)) { reply(400, { message:'请求必须是对象。' }); return; }
        if (route === '/resolve') {
          if (!Number.isSafeInteger(params.id) || params.id < 1 || !['sent','discard'].includes(params.outcome)) { reply(400, { message:'无效任务操作。' }); return; }
          reply(200, await call(`/admin/jobs/${params.id}/resolve`, { outcome:params.outcome })); return;
        }
        const result = await call('/admin' + route, params);
        reply(200, route === '/startup-animation/action' ? workspaceStartup(result) : result); return;
      }
      reply(405, { message: 'Method not allowed' });
    } catch (error) { reply([400,409,413].includes(error.status) ? error.status : 502, { message:error.message }); }
  });
  await listenHTTP(server,port,'127.0.0.1');
  return { server, url: `http://127.0.0.1:${server.address().port}${prefix}`, close() {
    if (!closing) closing = new Promise((resolve, reject) => { controller.abort(); server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); });
    return closing;
  } };
}
