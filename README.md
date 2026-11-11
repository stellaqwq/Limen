# Limen

> **独立第三方项目，与腾讯 / QQ 无隶属或授权关系。** 仅供个人学习与技术研究，禁止商业使用。本仓库不包含、也不分发腾讯的 QQ 程序文件——运行时由使用者本机从 QQ 官网下载并校验腾讯签名后生成。非官方接入方式可能违反《QQ 用户协议》，账号存在被限制或封禁的风险，建议使用小号。含 QQ 程序文件的“带内核”便携包只可自行构建自用，**不得公开分发**。完整边界见[法律与合规说明](docs/LEGAL.md)，许可条款见 [`LICENSE`](LICENSE)。

Limen 是一款基于官方 QQNT 内核、完全本地运行的 QQ 智能助手与管理工作台：连接模型、QQ 和本地工具，提供 OneBot v11 兼容接口、扫码登录工作台、人格与会话管理、Agent 工具循环、插件工具和网页试聊。通过自研 N-API 宿主加载官方内核，不依赖其他 QQ 机器人框架。

数据全部留在本机：消息、任务与配置保存在工作区目录的 SQLite 里，模型服务由你自己指定（任何兼容 Chat Completions + function calling 的服务），项目本身不提供也不代理模型。

[快速开始](#快速开始) · [桌面便携版](#桌面便携版) · [配置 AI 回复](#配置-ai-回复) · [插件与市场](#插件与市场) · [接口认证](#onebot-与管理员接口) · [故障排查](#数据与故障排查) · [文档索引](#项目文档)

## 三种上手方式

| 方式 | 适合 | 说明 |
| --- | --- | --- |
| **桌面便携版** | 直接使用 | 解压后双击 `Limen.exe`，内置 Node.js 与工作台。首次启动自动从 QQ 官方下载运行环境并校验签名，见[桌面便携版](#桌面便携版) |
| **源码运行** | 开发与定制 | Node.js 24+（Windows x64），`npm ci && npm run init && npm run launch`，见[快速开始](#快速开始) |
| **Docker / 其他平台** | 部署实验 | 内核驱动仅支持 Windows x64；容器需显式设置 `QQ_DOCKER_DRIVER=native`、`demo` 或 `scaffold`，见[驱动契约](docs/DRIVER.md) |

## 功能总览

- **QQ 消息**：手机扫码登录、私聊 / 群聊文本收发、图片与表情包收发、消息查询；发送成功需匹配内核终态确认，结果未知时不自动重发，进入人工核对。
- **AI 回复**：会话白名单、群聊 @ 条件、流式分段输出、@ 与引用、群聊上下文感知、Emoji 过滤、并发与限流、SQLite 持久化任务队列。
- **Agent**：连续工具调用、人格与工具范围、会话记忆、执行记录，以及无需 QQ 在线的网页试聊；`AGENT_ENABLED=false` 可恢复传统 AI 流程。
- **插件**：JavaScript 消息插件（独立线程 + 超时）、Schema 配置表单、模拟测试、即时启停；**插件市场**支持远程清单，便携包自带离线清单与插件包，断网也能装。
- **扩展能力**（可选安装）：视频理解与知识库、QQ 空间说说、表情包管理器、本地 VoiceStudio 语音、抖音网页浏览与分享、安卓模拟器视频浏览、本机与桌面 Agent、轻量本地 ASR 等。
- **可观测**：Web 管理台全量分组配置、密钥管理、消息与日志检索、任务核对；结构化 JSON 日志。

实机验证范围与待验收项见[功能与验证状态](#功能与验证状态)和[研发进度](docs/ROADMAP.md)。

## 快速开始

以下命令在项目根目录的 PowerShell 中执行，需要 Node.js 24+（Windows x64）。

### 1. 安装依赖并生成配置

```powershell
npm ci
npm run init
```

`init` 创建 `.env`，生成独立的 OneBot Token、管理员 Token 和会话加密密钥；再次执行会保留已有有效配置。

### 2. 准备官方 QQ 运行时

**首次启动默认从 QQ 官方下载**：启动入口读取 QQ 官网发布配置，下载对应安装包，验证腾讯 Authenticode 签名后解包，再构建自研桥接。它不会运行安装器，也不会替换系统已安装的 QQ。这一步需要 [7-Zip](https://www.7-zip.org/)（不在默认位置时先设 `$env:QQ_7ZIP = 'D:/Tools/7-Zip/7z.exe'`）。

磁盘空间要求：安装包 + 解包目录 + 独立副本合计峰值约 **2.7 GB**（复制完成后解包目录自动清理）。启动前会做预检查，空间不足会直接给出清理或换盘的建议，而不是等到复制到一半才失败。

```powershell
# 不启动服务，只准备运行时；--activate 把带版本的目录写回 .env
npm run qq:download -- --prepare --activate
```

不想下载时，也可以复制本机已安装的 QQ（不修改已安装的 QQ，不复制账号数据）：

```powershell
$env:QQ_RUNTIME_SOURCE = 'local'   # 或写入 .env；只在还没有运行时时生效
npm run launch

# 或直接指定本机 QQ.exe 的位置
npm run qq:prepare -- --from "C:/Program Files/Tencent/QQNT/QQ.exe"
```

| `QQ_RUNTIME_SOURCE` | 行为 |
| --- | --- |
| `download` | 默认。从 QQ 官方下载安装包，校验腾讯签名后解包；失败时回退本机已安装的 QQ |
| `local` | 不联网，直接复制本机已安装的 QQ |

### 3. 启动并扫码

```powershell
npm run launch          # 或双击 start.cmd
```

启动入口会初始化缺失的配置、启动机器人，并在默认浏览器打开本机工作台。用手机 QQ 扫描页面二维码并在手机上确认即可。

- 默认 OneBot 地址 `http://127.0.0.1:5700`；工作台使用随机本机端口和随机路径，以启动窗口打印的地址为准。
- 打开“配置文件”管理 AI 模型、白名单、QQ 驱动、接口 Token、数据保留等；保存后点击“重启生效”。见 [Web 管理台说明](docs/WEB.md)。
- `Ctrl+C` 安全退出；复用已有服务时退出启动入口仅关闭本次工作台。

只想看界面或模拟流程：

```powershell
npm run launch -- --demo   # 模拟驱动，独立临时数据，不碰真实账号
npm run demo               # 自动跑一遍 模拟消息 → 模拟 AI → 模拟回复 后退出
```

### 4. 检查内核是否有新版本

QQ 官方持续发版；内置的版本检查只读比对、不下载不改文件：

```powershell
npm run qq:update         # 输出 current / latest / update_available
```

也可以在控制台“系统设置 → 服务与账号”点击**检查内核更新**。确认要升级时运行 `npm run qq:download -- --prepare --activate`，详见[运行时维护](#运行时维护)。

## 桌面便携版

Windows 桌面版可完整解压后双击 `Limen.exe` 使用，已内置 Node.js，无需安装依赖。详见[桌面版使用说明](docs/desktop.md)。

- **数据与程序分离**：配置、数据库和 QQ 运行时都在工作区（默认 `%APPDATA%\limen\workspace`），覆盖解压新版本不会丢配置、不用重新下载运行时。
- **首次启动**：底部会显示“正在下载 QQ 运行环境（首次启动约 1.2 GB）…”和各阶段进度；需要网络畅通、磁盘空间充足（见上文 2.7 GB 峰值）。
- **换盘**：`Limen.exe --workspace="D:\某个空间更大的目录"` 把工作目录换到别的盘。
- **驱动**：便携包固定按 `QQ_DRIVER=kernel` 首启（`.env.seed`）；旧版本包把工作区写成 `demo` 的，会在下次启动时一次性纠正回来并写标记，之后尊重手工设置。`--demo` 仍是纯演示模式。
- **插件市场**：便携包自带离线市场清单和插件包，不配置清单地址也能浏览和安装；填了 `MARKET_CATALOG_URL` 则以远端为准，见[插件与市场](#插件与市场)。
- **分发包的边界**：公开发布的包不含腾讯 QQ 程序文件、也不含插件包（只带宿主 SDK `plugins/_host`）。含 QQ 程序文件的“带内核”版只能自行构建自用。

## 配置 AI 回复

推荐在 Web“配置文件 → AI 与回复”里填写，也可以直接编辑 `.env`：

```dotenv
AI_ENABLED=true
AI_BASE_URL=http://127.0.0.1:11434/v1     # 程序自动追加 /chat/completions
AI_MODEL=your-model-id
AI_API_KEY=
AI_ALLOWED_USERS=10001,10002              # 逗号分隔的 QQ 号白名单
AI_ALLOWED_GROUPS=
AI_GROUP_REQUIRE_AT=true                  # 群聊默认要求 @机器人
```

要点：

- AI 默认关闭；启用必须填模型标识，且至少配置一个允许回复的好友或群聊。
- 模型需支持兼容 Chat Completions 的 function calling（Agent 与工具插件依赖它）。
- 默认流式输出、QQ 端按句分段发送；不支持流式的服务可关闭。
- 默认过滤回复中的 Unicode Emoji（`AI_STRIP_EMOJI` 可关）。
- 群聊上下文感知默认开启：参考白名单群最近 30 条 / 15 分钟聊天，含未 @ 机器人的消息；见[群聊上下文感知](docs/GROUP-CONTEXT.md)。

常用配置项（完整清单见 [.env.example](.env.example)，实际默认值与校验范围以 [src/config.mjs](src/config.mjs) 为准）：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_STREAM_ENABLED` | `true` | 流式模型请求与网页实时显示 |
| `AI_SEGMENTED_REPLY_ENABLED` | `true` | QQ 端按句子分段发送 |
| `AI_CONCURRENCY` | `4` | 不同会话的处理并发数（1–16），同一会话保持顺序 |
| `AI_TIMEOUT_MS` | `45000` | 单次模型请求超时 |
| `AI_MAX_ATTEMPTS` | `3` | 生成尝试总次数（1–10），可重试错误指数退避 |
| `AI_CONTEXT_TURNS` | `-1` | 每会话保留的上下文轮数；-1 不限制 |
| `AI_MAX_REPLY_CHARS` | `1800` | 模型回复长度上限 |
| `AI_SYSTEM_PROMPT` | 见配置示例 | 模型系统提示词 |

图片与文件分析：可直接在 QQ 中发送图片、PDF、DOCX、XLSX；图片需要视觉模型，见[附件说明](docs/ATTACHMENTS.md)。

## 插件与市场

**插件**：管理台“插件”页可新建脚本插件、编辑源码与配置、设置作用范围（好友 / 群聊 / 是否要求 @）。插件先于 AI 执行，未处理的消息继续进入 AI 规则；保存与启停即时生效。插件有本机 Node.js 权限，只运行可信代码。编写约定见[自定义插件](docs/PLUGINS.md)。

**市场**：读一份静态 `index.json` 清单，下载插件包、校验大小与 SHA-256 后交给安装器；没有账号、没有中心服务。

- 配置 `MARKET_CATALOG_URL` 指向远端清单（https）。
- **便携包自带离线清单**（`resources/app/market/`）：没配置地址时直接使用，安装优先读包内 `market/packages/*.zip`——读取后仍按清单校验大小与哈希，全程可离线。
- 资源通道（`assets`）负责 FFmpeg 这类大体积二进制，装到 `runtime/` 下与插件版本解耦。

机制与清单格式见[插件市场与资源通道](docs/MARKET.md)。特色插件：[流动记忆](docs/LIVING-MEMORY.md)（`npm run memory:install`）、[群聊增强 Chat Plus](docs/GROUP-CHAT-PLUS.md)（`npm run groupchat:install`）、[心绪情绪](docs/EMOTION.md)（`npm run emotion:install`）、[表情包管理器](docs/MEMES.md)、[启动动画](docs/STARTUP-ANIMATION.md)、[视频理解 v2](docs/VIDEO-ANALYSIS.md) 等。

## 运行时维护

官方运行时、桥接与账号数据分开保存：

| 配置项 | 默认路径 | 内容 |
| --- | --- | --- |
| `QQ_RUNTIME_DIR` | `./runtime/qq` | 官方 QQ 程序文件 |
| `QQ_KERNEL_DIR` | `./runtime/kernel` | 自研宿主桥接及构建元数据 |
| `QQ_KERNEL_DATA` | `./data/qq-kernel` | 官方内核管理的账号数据和诊断信息 |
| `DATA_DIR` | `./data` | 消息数据库、任务与本地运行锁 |

```powershell
# 下载最新官方运行时并切换（启动入口首启做的就是这件事）
npm run qq:download -- --prepare --activate

# 只下载安装包，不动现有运行时
npm run qq:download

# 用本机已安装的 QQ 生成运行时并构建桥接
npm run qq:setup -- --from "C:/Program Files/Tencent/QQNT/QQ.exe" --to ./runtime/qq
npm run qq:build

# 只读检查：本地运行时版本 vs 官方最新版本
npm run qq:update

# 校验当前运行时、宿主与 Node 的完整性（可加 --qr 验证真实内核与二维码链路）
npm run qq:check
```

- 下载的安装包保留在 `runtime/downloads` 供复用；解包目录在构建完成后自动清理。整个过程不运行安装器、不替换系统已安装的 QQ。
- 宿主桥接绑定构建时的 Node 可执行文件与 QQ 运行时；更换 Node、移动目录或**更换 QQ 内核版本**后，启动时会检测到并自动重建桥接（`wrapper.node` 的导出表跟着官方程序变，旧桥接不能复用）。
- `QQ_ACCOUNT=0` 由扫码确定账号；指定 QQ 号后会拒绝其他账号。

## OneBot 与管理员接口

默认监听 `127.0.0.1:5700`（`HOST` / `PORT`）。凭据分工：

| 凭据 | 用途 |
| --- | --- |
| `ONEBOT_ACCESS_TOKEN` | 普通 OneBot HTTP 与正向 WebSocket（至少 24 字符） |
| `ADMIN_ACCESS_TOKEN` | 运行状态、任务管理、扫码与本地退出；与 OneBot Token 不同，仅接受 `Authorization` 头 |
| `REVERSE_WS_TOKEN` | 反向 WebSocket 认证；留空时使用 OneBot Token |
| `WEBHOOK_SECRET` | webhook 的 OneBot v11 HMAC 签名 |

主要入口：`GET /healthz`（存活）、`GET /readyz`（消息会话在线时 200）、OneBot 动作（`/get_status`、`/send_private_msg` 等）、`WS /`、`WS /api`、`WS /event`、`GET /admin/status`、`GET /admin/jobs`、`POST /admin/login/{start,poll,logout}`、`POST /admin/jobs/:id/resolve`。

```powershell
curl.exe "http://127.0.0.1:5700/get_status" -H "Authorization: Bearer <ONEBOT_ACCESS_TOKEN>"
```

CLI 连接已运行的服务（凭据从 `.env` 读取）：

```powershell
npm run cli -- status | jobs | friends | groups
npm run cli -- send 10001 "你好"
npm run cli -- send-group 20001 "群聊测试"
npm run cli -- watch 60                 # 监听事件，单位秒
```

反向 WS / webhook 与驱动扩展见[驱动接口契约](docs/DRIVER.md)。

## 任务、重试与恢复

AI 任务与上下文保存在 SQLite。同一会话串行、不同会话可并发；生成与发送分别限制尝试次数，发送只重试明确未送达且允许重试的错误。

| 状态 | 含义 |
| --- | --- |
| `queued` / `generating` / `ready` / `sending` | 等待生成 → 请求模型 → 待发送 → 发送中 |
| `done` | 已确认发送成功 |
| `uncertain` | 发送结果未知，等待人工核对（**不自动重发**，避免重复消息） |
| `failed` / `ignored` | 永久失败、重试耗尽、过期或被策略忽略 |

- 优雅停机时未提交的排队回复回到 `ready`，重启后继续；结果不明的保持 `uncertain`。
- 人工核对：`npm run cli -- resolve 123 sent|discard`（也可在任务详情页操作）。
- 等待任务按 `JOB_MAX_AGE_MS`（默认 10 分钟）过期，释放容量与同会话阻塞。
- 默认保留全部会话轮次与模型思考，不按天清理；保留与脱敏策略见[完整上下文保留](docs/CONTEXT-RETENTION.md)。

## 数据与故障排查

同一个 `DATA_DIR` 只允许一个机器人实例。备份前先停止服务，再备份 `.env`、`DATA_DIR` 与自定义位置的 `QQ_KERNEL_DATA`——它们包含密钥、登录凭据和消息正文。

| 现象 | 处理 |
| --- | --- |
| 提示磁盘空间不足 / `ENOSPC` | 首启峰值约需 2.7 GB；清理该磁盘，或用 `Limen.exe --workspace="D:\空间更大的目录"` 换盘后重试 |
| 首启进了“模拟驱动” | 便携包首启固定 `QQ_DRIVER=kernel`；老工作区会在下次启动自动纠正（写 `.env.seed.applied` 标记）。也可在 `.env` 手工设置 |
| 首次启动提示需要 7-Zip，或反复下载失败 | 安装 7-Zip 或设 `QQ_7ZIP`；网络受限改 `QQ_RUNTIME_SOURCE=local` |
| Node 版本不符或缺少依赖 | 使用 Node.js 24+，项目根目录 `npm ci` |
| `/healthz` 正常但 `/readyz` 503 | 服务存活但消息会话未在线，检查扫码与连接状态 |
| QQ 已连接但 AI 不回复 | 检查 `AI_ENABLED`、模型服务、白名单、群聊 @ 条件与任务队列 |
| 任务以 `queue_full` 忽略 | 核对积累的未知发送记录，或调整 `MAX_PENDING_JOBS` |
| `login_required` | 本地凭据无法恢复，重新扫码 |
| 宿主退出或初始化失败 | 查看内核数据目录的 `validation.json` 与 `host-stderr.log` |
| 启动失败对话框 | 首行是原因；磁盘类错误会附带清理 / 换盘指引，其余见工作目录的 `desktop-startup-error.json` |

## 功能与验证状态

| 功能 | 状态 |
| --- | --- |
| 扫码登录、私聊文本收发与本地查询 | 已完成实机验证 |
| 群聊文本、好友 / 群列表、QQ 号解析 | 已实现，待实机验收 |
| AI 回复 / Agent / 插件 / Web 管理台 | 可用；Agent 支持连续工具调用与会话记忆 |
| 图片发送（PNG/JPEG/GIF/WebP、Base64、图文混排）与接收 | 部分已实机验证，见 [docs/IMAGES.md](docs/IMAGES.md) |
| QQ 空间、语音、流式引用 | 已实现并回归，待真实账号验收 |
| 文件、撤回、群管理 | 默认内核驱动尚不支持 |

历史实机验证记录见[官方内核适配与实机验证](docs/KERNEL.md)。这些记录不代表后续 QQ 版本已完成实机验证；**升级 QQ 内核前先跑 `npm run qq:check -- --qr`**。

## 测试与打包

```powershell
npm run check            # 快速体检
npm test                 # 全量回归；严格结果写入 dist/test-results.json
npm run qq:check -- --qr # 全新临时数据验证真实内核加载、二维码与正常退出
npm run source:export    # 导出白名单源码目录（排除密钥、数据、运行时）
```

测试覆盖模拟驱动、合成协议端与宿主状态机（认证隔离、消息确认、AI 队列、重试、停机、数据库迁移与保留策略）；它们不替代实机验证。

分发包构建说明（默认不含 QQ 程序文件与插件包，`--with-qq` 产出自用的含内核版）：

```powershell
node dist/pack-20261111/stage-packs.mjs            # 暂存源码包与便携包目录
node dist/pack-20261111/zip-packs.mjs              # 压缩并生成 ARTIFACTS.json
node dist/pack-20261111/zip-packs.mjs --with-qq    # 含内核内部版，不得公开分发
```

便携包自带离线插件市场：更新插件市场后重新发布（`npm run market:publish`），再重跑打包脚本即可带入最新快照。

## 项目文档

**核心**：[法律与合规](docs/LEGAL.md) · [桌面版](docs/desktop.md) · [Web 管理台](docs/WEB.md) · [插件](docs/PLUGINS.md) · [插件市场](docs/MARKET.md) · [官方内核](docs/KERNEL.md) · [驱动契约](docs/DRIVER.md) · [Agent](docs/AGENT.md) · [研发进度](docs/ROADMAP.md)

**功能**：[附件分析](docs/ATTACHMENTS.md) · [流式输出](docs/STREAMING.md) · [群聊上下文](docs/GROUP-CONTEXT.md) · [图片与 AstrBot](docs/IMAGES.md) · [语音](docs/VOICE.md) / [VoiceStudio](docs/VOICESTUDIO.md) / [本地 ASR](docs/LOCAL-ASR.md) · [QQ 空间](docs/QZONE.md) · [表情包](docs/MEMES.md) · [背景壁纸](docs/BACKGROUND.md) · [启动动画](docs/STARTUP-ANIMATION.md) · [流动记忆](docs/LIVING-MEMORY.md) · [Chat Plus](docs/GROUP-CHAT-PLUS.md) · [情绪](docs/EMOTION.md) · [视频理解](docs/VIDEO-ANALYSIS.md) / [知识库](docs/VIDEO-KNOWLEDGE.md) · [抖音系列](docs/DOUYIN-WEB.md)（[分享私信](docs/DOUYIN-SOCIAL.md) / [自主刷视频](docs/DOUYIN-AUTONOMY.md) / [对白转写](docs/DOUYIN-AUDIO.md)）· [安卓设备](docs/ANDROID-DEVICE.md) · [本机与桌面 Agent](docs/COMPUTER-AGENT.md) · [免费活动](docs/FREE-ACTIVITY.md) · [ComfyUI](docs/COMFYUI.md)

**研究与其他**：[native 协议](docs/NATIVE.md) · [历史 OneBot / AI 运维](docs/LEGACY_PROTOCOL.md) · [Python 网页抓取](docs/PYTHON-WEB-FETCH.md) · [上下文保留](docs/CONTEXT-RETENTION.md) · 其余 `docs/` 下的时间戳文档为修复与验收记录。
