# QQ 空间：AI 文案与说说发布

管理台左侧的“QQ 空间”提供纯文字说说的 AI 生成、草稿编辑、可见范围、发布和结果核对。AI 也可以直接调用 HTTP 接口发布正文，或提交主题，由项目生成后自动发布，无需在网页确认。说说发布后会成为空间动态；日志、相册、视频及带图片说说不在当前模块范围内。

这是独立的 QQ 空间网页协议适配，不是腾讯开放平台的正式发布 API。接口或账号验证要求变化时可能需要重新适配。当前完成模拟回归及浏览器流程验证，尚未使用真实账号验收空间发布。

## 使用

1. 启动或重启项目，打开管理台的“QQ 空间”。
2. 在浏览器登录 `https://user.qzone.qq.com`，完成空间要求的验证。打开浏览器开发者工具的“网络”面板，刷新空间，选择发送到 `user.qzone.qq.com` 的请求，复制请求头中的 Cookie。
3. 展开“空间登录凭据”粘贴 Cookie 并保存。需要包含 `uin` 或 `p_uin`，以及空间域名对应的 `p_skey`。聊天扫码登录与空间网页凭据独立，页面显示的是实际空间 Cookie 所属账号。
4. 可点击“验证凭据”。服务会只读请求空间主页并检查页面令牌。验证失败时先在浏览器完成登录或验证，再更新 Cookie；这不是发布操作。
5. 在“全部设置 → AI 与回复”配置兼容 Chat Completions 的服务、模型和 API Key，保存后重启。无需启用聊天自动回复，也不需要聊天白名单。空间 Cookie 保存后立即生效。
6. 输入主题与素材，点击“AI 生成草稿”，检查和编辑正文，选择“仅自己 / QQ 好友 / 所有人”，再点击“发布到 QQ 空间”。确认框展示空间账号、可见范围和完整正文。默认仅自己可见。

没有模型服务时也可手写说说。正文上限 2000 个 Unicode 字符。网页“AI 生成草稿”和 `/generate` 只生成草稿，关闭页面不会自动发布；回到页面后可以从记录中载入已生成草稿。`/send` 的主题模式会在生成完成后自动发布。AI 不自动读取聊天历史。

`qzonetoken` 是可选项。服务会在发布前检查空间主页，优先使用页面令牌；页面明确返回匹配的已登录账号时，也接受空令牌。Cookie 或令牌失效时需要更新，不会自动刷新或重新登录。请求会补齐与账号一致的 `p_uin`，防止重组 Cookie 时丢失空间身份字段。

`npm run launch -- --demo` 中，空间账号、AI 生成、凭据验证与发布都是模拟操作，不调用真实空间或模型服务，也不保存真实 Cookie；记录会明确标记“模拟”。

## 让 AI 直接调用端口发布

默认地址为 `http://127.0.0.1:5700`，端口沿用现有 `PORT`。先在管理台保存空间 Cookie；外部 AI 已写好正文时无需配置项目内的 AI 模型。调用者需要发送管理员 Token 请求头。

以下调用会直接发布，不等待网页确认。`account` 使用空间 Cookie 对应的真实 QQ 号；示例中的 QQ 号和 Token 是占位符。

```http
POST /admin/qzone/send HTTP/1.1
Host: 127.0.0.1:5700
Authorization: Bearer <ADMIN_ACCESS_TOKEN>
Content-Type: application/json

{
  "request_id": "qzone-post-20261026-001",
  "account": 123456,
  "content": "给忙碌的日常留一点空白。",
  "visibility": "friends"
}
```

如果希望使用项目内的模型生成后直接发，把 `content` 换成 `prompt`：

```json
{
  "request_id": "qzone-post-20261026-002",
  "account": 123456,
  "prompt": "写一条轻松的周末心情，80 字以内，不编造出游经历。",
  "visibility": "private"
}
```

`content` 和 `prompt` 必须且只能提供一个。`visibility` 可选 `private`、`friends`、`public`，默认 `private`。主题模式在后台生成，返回时可能仍为 `generating`；生成完成后自动调用空间发布。生成期间更换空间账号、服务退出或遇到发送限流时，不会自动延迟发布，而是保留失败状态供调用方查看。

结果查询使用 `GET /admin/qzone/request?request_id=qzone-post-20261026-002`，同样携带管理员请求头。发送请求成功时结果位于 `data`，查询请求直接返回对象；检查记录的 `status` 是否为 `published`。`generating` 和 `publishing` 表示还在处理；`uncertain` 表示必须去空间核对。

请求编号使用 UUID 或独立业务编号，长度 8–128。相同编号、正文或主题、账号、可见范围的重复调用只返回原记录，不会重新生成或重新发布；同一编号换用不同参数会报错。网络超时应查询或重试原编号，不能换一个编号重新发布未知结果。失败记录不会因重试原编号自动执行第二次。

### 接入 AI 工具调用

`GET /admin/qzone/tools` 提供两项工具的 JSON Schema 和接口映射：`send_qzone_post` 与 `get_qzone_post_result`。AI 运行程序需要把定义注册到所用框架，并在工具调用时执行对应 HTTP 请求；模型本身不能仅凭提示词建立 HTTP 连接。

项目提供不依赖模型 SDK 的 Node 适配器：

```javascript
import { createQzoneTools } from './examples/qzone-tool.mjs';

const tools = createQzoneTools({
  baseUrl: 'http://127.0.0.1:5700',
  adminToken: process.env.ADMIN_ACCESS_TOKEN
});

// 把 name、description、inputSchema 注册到 AI 框架，
// 收到工具调用时，把参数交给对应的 execute。
const result = await tools.send_qzone_post.execute({
  request_id: 'qzone-tool-20261026-001',
  account: 123456,
  content: 'AI 写好的说说正文',
  visibility: 'friends'
});
```

Token 由工具执行程序在本地读取，不放进模型提示词或工具参数。接口仍使用管理员认证，普通 OneBot Token 不能直接发布。

### AstrBot 原版 QQ 空间插件

`astrbot_plugin_qzone` 的 `llm_publish_feed` 在发布前会先调用 OneBot `get_cookies(domain="user.qzone.qq.com")`。旧版本机器人没有这个动作，因而会返回 `OneBot action is not implemented`。这一步发生在发布请求之前。

已保存空间 Cookie 后，在“全部设置 → OneBot 与推送”开启“允许 AstrBot 获取空间 Cookie”，保存并重启机器人。对应配置为 `QZONE_ALLOW_COOKIE_EXPORT=true`；默认关闭。AstrBot 继续使用原有 OneBot 或反向 WebSocket Token，无需使用管理员 Token。HTTP、正向 WS、反向 WS 均支持此动作。

开启后，持有 OneBot Token 的插件可以取得 `uin`、`skey`（若有）、`p_skey`，仅接受 `user.qzone.qq.com` 和 `qzone.qq.com`；空间账号必须与当前 QQ 账号一致。接口不返回其他域名或其他登录字段，日志和状态接口不记录导出的 Cookie。移除空间 Cookie 或关闭开关后，不再提供这些凭据。

原版 AstrBot 插件取得 Cookie 后自行向 QQ 空间发送请求，其说说权限和发布记录由该插件管理，不经过本项目的发布队列。此兼容入口不会替插件改变可见范围或自动重试策略。若要使用本项目的草稿、可见范围和持久化防重，请接入上面的 `/admin/qzone/send` 工具。

依据：本机安装的 `astrbot_plugin_qzone/core/qzone/session.py`，以及[插件上游的 Cookie 获取实现](https://github.com/Zhalslar/astrbot_plugin_qzone/blob/main/core/qzone/session.py)。

#### 插件提示“登录失效”或“发布说说失败：{}”

2026-10-26 的只读实测发现：保留 `p_uin` 的已保存 Cookie 可读取当前账号空间主页；插件原先重组为 `uin/skey/p_skey` 后被重定向到登录页。补回与 `uin` 一致的 `p_uin` 后，主页恢复 HTTP 200。插件原来的“登录成功”日志只是本地读取 Cookie 成功，并不验证远程登录。

本机 AstrBot 插件已修补 `QzoneContext.cookies()`，加入 `p_uin`；重新读取凭据的日志也不再声称已完成远程登录。POST 不再因登录错误自动重复提交，空响应或缺少说说编号会明确提示“结果未知，请先在空间核对”，明确拒绝则显示服务端原因。修改后需重载 QQ 空间插件或重启 AstrBot。

这些只读结果证明 Cookie 的登录身份字段可以生效；真实发布仍应以空间页面出现对应说说为准，不能把空响应当作确定失败而反复重发。

## 发布结果

- `generating`：后台生成文案；成功后成为 `draft`。
- `draft`：可修改的草稿。
- `publishing`：已记录发布意图，正在提交。相同记录的并发或重复请求只返回现有状态，不再次发布。
- `published`：空间返回成功且有有效说说编号，或用户已人工核对。
- `failed`：生成失败、发布前校验失败，或空间明确拒绝；可以修改并重新保存为草稿。
- `uncertain`：提交后超时、断网、收到不可识别响应、成功但没有编号，或服务在发布中断开。禁止再次发布此记录；先在空间检查，再标记已发布或放弃。
- `discarded`：人工放弃的未知记录，不再发布。

同一时间最多发布一条；两次新发布至少间隔 3 秒，或更长的 `SEND_INTERVAL_MS`。生成并发上限为 2。系统不自动重试发布。草稿修订号防止多个页面覆盖文案，发布请求同时校验空间账号，防止凭据切换后误发。

## 数据与凭据

Cookie 只保留所需字段，经现有 `SESSION_KEY` 使用 AES-256-GCM 加密后写入 `DATA_DIR/qzone-session/1.session`。管理员状态与草稿接口不返回 Cookie、令牌或加密密钥；单独授权的 `get_cookies` 仅导出插件所需空间字段。输入框保存成功后清空，日志只记录任务编号、状态和固定原因。

草稿正文、生成素材与发布记录保存在现有 `bot.sqlite` 的 `qzone_posts` 表。完成、失败、放弃记录及草稿遵循 `HISTORY_RETENTION_DAYS`；未知记录遵循 `UNCERTAIN_RETENTION_DAYS`。启动和每小时清理，界面显示最近 50 条，数据库最多保留 5000 条。请在未知记录保留期内完成核对。移除空间凭据保留草稿，不删除远程空间内容。

直接调用的 `request_id`、参数摘要和记录编号单独保存在 `qzone_requests` 表，不保存正文副本。防重映射在正文清理后继续保留；此时原编号返回 `expired`，不会再次发布。映射上限 100000 条，达到上限拒绝新请求，需归档或迁移历史数据库；迁移后仍须使用新的业务编号。

## 管理员接口

下面的 `/admin/qzone/*` 扩展使用独立管理员 Token，仅支持请求头认证。`get_cookies` 是另一个默认关闭、需单独启用的 OneBot 兼容动作。工作台本机代理另有同源校验。

| 请求 | 输入 / 输出 |
| --- | --- |
| `GET /admin/qzone/status` | 账号、凭据是否已配置、AI 是否可用及保留周期；已配置不等于远程验证通过 |
| `GET /admin/qzone/posts` | 最近 50 条草稿与记录 |
| `GET /admin/qzone/tools` | AI 工具定义及接口映射，不含 Token |
| `GET /admin/qzone/request?request_id=...` | 按调用方请求编号查询单条记录 |
| `POST /admin/qzone/session` | `{ "cookie": "uin=...; p_skey=...", "token": "" }`，保存加密凭据 |
| `POST /admin/qzone/clear` | `{}`，移除本机空间凭据 |
| `POST /admin/qzone/check` | `{}`，只读验证主页，成功返回 `verified: true` |
| `POST /admin/qzone/generate` | `{ "prompt": "主题与真实素材", "visibility": "private" }`，立即返回生成记录；轮询 posts 查看结果 |
| `POST /admin/qzone/send` | `{ "request_id": "唯一业务编号", "account": 123456, "content": "直接发布的正文", "visibility": "private" }`，或将 content 换成 prompt，生成后自动发布 |
| `POST /admin/qzone/draft` | 新建：`{ "content": "正文", "visibility": "private" }`；修改额外传入 `id`、`revision` |
| `POST /admin/qzone/publish` | `{ "id": 1, "revision": 2, "account": 123456 }`，发布已保存草稿 |
| `POST /admin/qzone/resolve` | `{ "id": 1, "revision": 4, "outcome": "published" }` 或 `outcome: "discard"` |

POST 使用现有 `status/retcode/data` 信封，GET 直接返回对象或数组。发布 POST 的 `data.status` 才是持久化发布状态；HTTP 200 本身不代表发布成功。网络客户端重试发布时必须使用同一记录 ID，不能通过新建记录重试未知结果。

实现参考来源：[空间发布协议的原始适配记录](https://github.com/Gu-Heping/onebot-qzone/blob/main/doc/emotion-api.md)、[可见范围取值的适配者记录](https://github.com/huanxin996/qzone_api/blob/main/changes.md)。这些记录用于协议研究，不构成本项目真实账号验收证据。

## 验证

```powershell
node scripts/test.mjs test/qzone.test.mjs
npm run check
npm run web:qa
```

测试只使用合成 Cookie、模拟空间响应和独立临时数据库。正式账号首次验收可手写一条仅自己可见的说说，再检查空间页面与发布记录是否一致。
