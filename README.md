# Limen

> **独立第三方项目，与腾讯 / QQ 无隶属或授权关系。** 仅供个人学习与技术研究，禁止商业使用；仓库不包含也不分发腾讯的 QQ 程序文件——运行时由使用者本机从 QQ 官网下载并校验腾讯签名后生成。非官方接入方式可能违反《QQ 用户协议》，账号存在被限制或封禁的风险，建议使用小号。含 QQ 程序的“带内核”便携包只可自行构建自用，不得公开分发。完整边界见[法律与合规说明](docs/LEGAL.md)，许可条款见 [`LICENSE`](LICENSE)。

当前默认保留全部会话轮次与模型返回的思考，不按天清理历史。配置和数据表说明见[完整上下文保留](docs/CONTEXT-RETENTION.md)。

Windows 桌面版可完整解压后双击 `Limen.exe` 使用，已内置 Node.js。源码重新打包执行 `npm ci`、`npm run desktop:build`；日常功能已按浏览设备、分享私信、视频知识库、会话记忆分区。首次配置、复用已有项目和打包说明见 [桌面版使用说明](docs/desktop.md)。

Limen是一款基于官方 QQNT 内核、本地运行的 QQ 智能助手与管理工作台。连接模型、QQ 和本地工具。提供 OneBot v11 兼容接口、扫码登录工作台、人格与会话管理、模型工具循环、插件工具和网页试聊，支持 QQ 空间、表情包、语音、消息插件与持久化回复。项目通过自研 N-API 宿主加载官方内核，不依赖 NapCat 或其他 QQ 机器人框架。

Agent 按 AstrBot 的执行层和工具扩展思路实现，使用本项目自己的 JavaScript 插件接口。模型需支持兼容 Chat Completions 的 function calling。Web 的“对话测试”提供独立网页会话，回复与工具调用来自真实模型服务；完整说明与工具插件示例见 [Agent 使用说明](docs/AGENT.md)。

默认运行环境为 **Windows x64 + Node.js 24 或更高版本**。当前仍属于实验性适配，功能范围与验证状态见下表。

支持可选的[本机与桌面 Agent](docs/COMPUTER-AGENT.md)：在“配置文件 → 本机与桌面”启用后，网页对话可读写指定目录的文本、创建目录、观察窗口与截图，并连续执行鼠标键盘动作。PowerShell 命令和 QQ 管理员私聊入口分别开启；提供任务互斥、操作防重和持久化紧急停止。总开关默认关闭，保存后重启生效。

[视频理解插件 v2](docs/VIDEO-ANALYSIS.md)用带编号和实际时间的分镜宫格看视频结构，再局部回看细节；同时保留视频信息、逐帧采样和按需音轨转写，共五个 Agent 工具。可在插件与扩展安装，网页上传或读取允许目录的视频；模型需支持图片输入与工具调用。语音转写服务独立配置，首次安装默认停用。

[抖音分享与私信](docs/DOUYIN-SOCIAL.md)支持保存默认好友、读取默认会话最近消息并生成回复草稿，以及给指定好友准备视频分享和私信草稿，默认由管理员在管理页核对快照后确认发送；插件编辑页可另行开启默认好友自动聊天，自动回复新消息。发送结果未知时停止，不自动重发。

[视频知识库](docs/VIDEO-KNOWLEDGE.md)让模型从实际采样的视频自主整理观看记忆和知识笔记，保存来源与采样证据，之后通过本地检索召回。可在抖音网页插件的配置中开启；知识笔记保存在本机，由 Agent 工具检索。视频说法始终标为未核实。

[抖音对白转写](docs/DOUYIN-AUDIO.md)可采集当前视频的短音轨，复用已配置的 ASR，将真实转写用于理解和知识库入库；知识库保留文字和采样证据。

[抖音网页浏览](docs/DOUYIN-WEB.md)通过独立 Chrome 窗口采样画面，支持播放、暂停和切换下一条。“去刷视频”持续到叫停，“刷一会儿”让模型自主结束；指定数量的任务默认最多 5 条。可另行开启 QQ 管理员私聊观看，并配置插件好友范围。登录或验证码由用户手动处理，管理页提供浏览器入口、预览和停止开关。

[自主刷视频与分享](docs/DOUYIN-AUTONOMY.md)可接收 QQ 管理员或默认抖音好友的明确刷视频指令，由模型挑选实际观看的内容，自动通过抖音分享给已绑定的默认好友，并另发几句私信感想。新安装默认关闭，开启后按任务限额发送，同一视频持久去重。

[安卓模拟器视频浏览](docs/ANDROID-DEVICE.md)通过 ADB 固定连接指定设备，让视觉模型采样画面、打开视频 App 和上滑；每任务默认最多 5 条，并提供停止开关。插件不自带 adb，复用电脑上已有的那份：可自动查找 PATH、Android SDK 和常见模拟器目录，也可手填路径。目前只开放给已认证的网页对话，不采集手机声音。

可使用[轻量本地转写服务](docs/LOCAL-ASR.md)：SenseVoiceSmall INT8、CPU 2 线程、VAD 跳过静音、串行队列、空闲 5 分钟卸载模型。`npm run asr:start` 启动，`npm run asr:configure` 接入视频插件，`npm run asr:check` 使用公开样本试跑。

[快速开始](#快速开始) · [AI 配置](#配置-ai-回复) · [日常使用](#日常使用) · [接口认证](#onebot-与管理员接口) · [任务恢复](#任务重试与恢复) · [故障排查](#数据与故障排查)

## 功能与验证状态

| 功能 | 当前状态 |
| --- | --- |
| 手机 QQ 扫码登录 | 已完成实机验证 |
| 私聊文本发送、接收及本地消息查询 | 已完成实机验证；发送成功需匹配内核终态确认 |
| 群聊文本 | 已实现，尚未完成实机验收 |
| 好友列表、群列表、QQ 号到 UID 的主动解析 | 已接入 SDK 并有模拟回归，待补充实机验收 |
| 本地登录恢复、断线重连、宿主恢复 | 已实现并有模拟回归，待长期实机验证 |
| AI 回复 | 支持兼容 Chat Completions 的模型服务、会话白名单和持久化任务 |
| Agent | 连续工具调用、人格与工具范围、会话记忆、写入防重、执行记录、无需 QQ 在线的网页试聊；`AGENT_ENABLED=false` 可恢复传统 AI 流程 |
| 本机与桌面 Agent | 可选文件读写、建目录、Windows 窗口 / 控件 / 截图、鼠标键盘与命令工具；原生观察及独立窗口中的点击、中文多行输入、Ctrl+A 已验证，见 [使用说明](docs/COMPUTER-AGENT.md) |
| QQ 空间 / AI 说说 | 支持 AI 通过 HTTP 直接发布正文或生成后自动发布，也支持网页草稿、可见范围、加密 Cookie、请求防重及未知结果核对；待真实账号验收，见 [QQ 空间使用说明](docs/QZONE.md) |
| Web 管理台 | 全量分组配置、密钥管理、扫码与退出、保存后重启、消息、日志检索和任务核对 |
| 自定义插件 | JavaScript 消息插件、Schema 分组表单、会话范围、优先级、即时启停与重载、行为查看、文件更新及模拟测试；见 [插件说明](docs/PLUGINS.md) |
| 聊天指令权限 | 设置 `BOT_ADMIN_IDS` 管理员 QQ 号后才可使用聊天 `/` 指令；`/tools` 查看工具说明，普通聊天不自动弹出说明 |
| 表情包管理器 | 本地分类图库、上传去重、聊天收集审核、分类发图与 AI 标签选图；见 [使用说明](docs/MEMES.md) |
| 背景壁纸 | 插件形式的本机图片背景，可调适应方式、模糊、白色遮罩与面板不透明度；见 [使用说明](docs/BACKGROUND.md) |
| 启动动画 | 覆盖桌面启动窗口与工作台首屏的自定义开场：轨道 / 涟漪 / 星屑 / 幕启四种风格、三套底色、标题文案、强调色、动态 Logo 与时序，首帧渲染、就绪退出；见 [使用说明](docs/STARTUP-ANIMATION.md) |
| 本地 VoiceStudio | 模型工具查询音色与合成语音、独立 QQ 语音回复、缓存及任务恢复；见 [使用说明](docs/VOICESTUDIO.md) |
| OneBot 接入 | HTTP、正向 / 反向 WebSocket、webhook；具体动作受驱动能力限制 |
| 图片与表情包收发 | 发送支持 PNG / JPEG / GIF / WebP、Base64 / 本地路径 / HTTP(S) 和图文混排；接收先下载再推送可访问链接，支持 get_image；验收状态见 docs/IMAGES.md |
| GPT-SoVITS / 语音发送 | 支持 WAV / SILK、record 消息段、私聊与群聊、文件 / Base64 / HTTP 输入；已完成编解码及模拟回归，待真实账号验收，见 [语音说明](docs/VOICE.md) |
| 文件、撤回、群管理 | 默认内核驱动尚不支持 |

文本收发实机验证使用 **QQ 9.9.36-53644，日期为 2026-10-24**；2026-10-25 在运行的 **QQ 9.9.27-45758** 上完成向机器人自身发送 Base64 PNG 的实机验证。版本、发送确认与接收记录见 [官方内核适配与实机验证](docs/KERNEL.md)和[图片与 AstrBot](docs/IMAGES.md)。这些记录不代表其他图片格式或后续 QQ 版本已完成实机验证。

## 快速开始

以下命令在项目根目录的 PowerShell 中执行。

### 1. 安装依赖并生成配置

```powershell
npm ci
npm run init
```

`init` 会创建 `.env`，生成独立的 OneBot Token、管理员 Token 和会话加密密钥。再次执行会保留已有有效配置；旧配置中缺失、过短或与其他接口复用的管理员 Token 会单独更新。

### 2. 准备官方 QQ 运行时

首次使用源码时，需要准备官方程序和宿主桥接。源码 ZIP 不包含 QQ 官方程序，`runtime/kernel/adapter.json` 由当前电脑生成，无需手工创建或从其他电脑复制。已准备好运行时的工作区可以跳过这一步。

**首次启动默认从 QQ 官方下载**：启动入口读取 QQ 官网发布配置，下载对应安装包，验证腾讯 Authenticode 签名后解包，再构建桥接。它不会运行安装器，也不会替换系统已安装的 QQ。这一步需要 7-Zip，并会占用一次完整下载安装包的时间。

7-Zip 不在默认位置时，先指定可执行文件：

```powershell
$env:QQ_7ZIP = 'D:/Tools/7-Zip/7z.exe'
```

也可以不启动服务，只把运行时准备好；`--activate` 会把带版本的运行目录写回 `.env`：

```powershell
npm run qq:download -- --prepare --activate
```

下载失败时（网络不通、签名校验不通过等），启动入口会自动回退到本机已安装的 QQ；两者都不可用则提示如何处理并不再继续。

如果本机已经安装 QQ、希望省掉下载，把运行时来源改成 `local`：

```powershell
$env:QQ_RUNTIME_SOURCE = 'local'
npm run launch
```

或在 `.env` 中写 `QQ_RUNTIME_SOURCE=local` 后重启。也可以在已安装 QQ 的机器上直接指定程序位置生成运行时：

```powershell
npm run qq:prepare -- --from "C:/Program Files/Tencent/QQNT/QQ.exe"
```

上面的路径需替换为实际 `QQ.exe`。此过程不修改已安装的 QQ，也不复制账号数据。运行时已准备、仅缺失宿主或更换了 Node.js / 项目位置时，启动入口自动重新生成宿主文件。

`QQ_RUNTIME_SOURCE` 只在还没有运行时的时候生效，取值：

| 值 | 行为 |
| --- | --- |
| `download` | 默认。从 QQ 官方下载安装包，校验腾讯签名后解包，失败时回退本机已安装的 QQ |
| `local` | 不联网，直接复制本机已安装的 QQ |

自研桥接由项目内的 PE 生成器构建，无需额外安装 C/C++ 编译器。运行时目录约定见下文的[运行时维护](#运行时维护)。

### 3. 启动并扫码

```powershell
npm run launch
```

也可以双击根目录的 [start.cmd](start.cmd)。启动入口会初始化缺失的配置、启动机器人，并在默认浏览器中打开本机工作台。

使用手机 QQ 扫描页面上的二维码，再在手机上确认登录。管理台提供工作台、消息、日志、任务和配置文件；二维码过期后可手动刷新。

打开“配置文件”即可管理 AI 模型、系统提示词、好友与群白名单、QQ 驱动和运行目录、接口 Token、反向 WS、Webhook、并发与发送限制、数据目录和保留周期。支持搜索页面与配置项、读取模型列表、查看当前分区的 JSON（密钥替换为占位符），密钥默认隐藏。保存后点击“重启生效”；详情见 [Web 管理台使用说明](docs/WEB.md)。

- 默认 OneBot 地址：`http://127.0.0.1:5700`。
- 工作台使用另一个随机本机端口和随机访问路径，以启动窗口打印的地址为准。
- 已有服务使用相同管理员凭据运行时，启动入口会复用该服务。
- 按 `Ctrl+C` 安全退出；只关闭浏览器标签页不会停止服务。复用已有服务时，退出启动入口仅关闭本次工作台。

通过 Web 保存配置或手动修改 `.env` 后都需要重启机器人服务。由当前工作台管理的服务可直接点击“重启生效”，工作台地址保持可用；若启动入口复用了其他进程的服务，应在原服务窗口停止它，再重新启动。环境变量覆盖的配置会标为不可编辑。

### 只体验界面或模拟流程

```powershell
# 工作台演示：不使用真实 QQ 账号，不调用模型服务
npm run launch -- --demo

# 不自动打开浏览器，手动访问打印的地址
npm run launch -- --demo --no-open

# 自动执行一次模拟消息 → 模拟 AI → 模拟回复流程，完成后退出
npm run demo
```

两个演示入口都使用独立临时数据；正常退出后清理演示数据。`--demo` 与 `--no-open` 可同时使用。

## 配置 AI 回复

推荐在 Web“配置文件 → AI 与回复”填写模型地址、模型标识和 API Key，再在“回复范围”填写实际的好友或群号，保存并重启。也可编辑 `.env`，将下面的模型标识和示例 QQ 号替换为实际值：

```dotenv
AI_ENABLED=true
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=your-model-id
AI_API_KEY=
AI_ALLOWED_USERS=10001,10002
AI_ALLOWED_GROUPS=
AI_GROUP_REQUIRE_AT=true
```

`AI_BASE_URL` 填写模型服务的基础地址，程序会追加 `/chat/completions`；项目本身不提供模型服务。服务要求认证时填写 `AI_API_KEY`。

AI 默认关闭。启用时必须填写模型标识，并至少配置一个允许回复的好友或群聊。白名单使用逗号分隔的正整数 QQ 号；群聊默认还要求 @机器人。自身发送的消息不会再次触发 AI，模型输出始终按纯文本发送。

AI 回复默认在发送前过滤 Unicode Emoji，包括组合表情、肤色、旗帜和键帽，不依赖提示词。普通 AI、Chat Plus、Agent、流式分段、网页试聊及 AI 语音合成文本使用同一规则；过滤后没有正文则跳过发送，任务详情会说明原因。可在“配置文件 → AI 与回复 → 过滤 AI 回复中的 Emoji”（`AI_STRIP_EMOJI`）切换，保存后重启生效。

群聊上下文感知默认开启：回复时会参考白名单群最近 30 条、15 分钟内的聊天，包含未 @机器人的消息，并区分发言人、@ 对象与引用。不会扩大回复范围或取消 @ 要求；管理员 `/new` 同时清空近期背景。可在“AI 与回复”调整开关、消息条数、时限和长度，详细说明与保留策略见 [群聊上下文感知](docs/GROUP-CONTEXT.md)。

固定屏蔽群成员：在“配置文件 → 回复范围 → 固定屏蔽群成员消息”按行填写 `群号:QQ号`，例如 `1036914541:123456789`；`*:QQ号` 表示所有群。保存并重启后，该成员在指定群的消息会跳过 AI、消息插件、管理员指令、近期群聊背景和后台识图，@机器人也不触发；私聊不受影响。清空对话不会取消规则，移除对应规则并重启可解除屏蔽。详细边界见 [Web 管理台](docs/WEB.md#固定屏蔽群成员)。

内置 AI、Chat Plus、消息插件与聊天指令的文字 / 图文回复默认引用触发消息，且仅群聊回复 @ 发送人。可在“配置文件 → AI 与回复”独立调整“群聊回复时 @发送人”和“回复时引用原消息”，对应 `REPLY_AT_SENDER` / `REPLY_QUOTE_MESSAGE`，默认均为 true，保存后重启生效，流式各段也遵循设置。默认内核驱动支持 `at` 和 `reply` 消息段，引用来源必须属于当前账号和同一会话。语音仍按 QQ 要求独立发送；定时主动聊天不 @ 或引用旧消息。群 webhook 的 @ 行为继续由 `at_sender` 控制。

默认开启流式输出：模型正文边生成，QQ 边按句子或目标长度分段发送，网页“对话测试”实时显示。同一会话保持顺序，QQ 每段仍遵守全局和会话发送间隔。配置入口为“配置文件 → AI 与回复”；保存后重启生效。不支持流式请求的模型服务可关闭“流式输出”；返回普通 JSON 的兼容服务也可正常使用。

已发送的流式段会持久化记录。生成中断或发送结果未知时不自动从头重试，避免重复回复；在任务详情中查看已发送段并核对。明确语音请求或启用概率语音转换时，先生成完整内容，再走原有语音发送流程。新加的流式、@ 和引用能力已覆盖模拟测试，仍需真实 QQ 验收。

详细行为与限制见 [流式输出与引用回复](docs/STREAMING.md)。

常用模型配置：

支持 QQ 图片理解与文件分析，可直接在 QQ 中发送图片、文本、PDF、DOCX、XLSX。图片需要视觉模型，扫描版 PDF 需将相关页面作为图片发送。格式、大小和配置说明见 [图片与文件分析](docs/ATTACHMENTS.md)。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_STREAM_ENABLED` | `true` | 流式模型请求和网页实时显示；关闭后等待模型返回完整正文 |
| `AI_SEGMENTED_REPLY_ENABLED` | `true` | QQ 等非流式平台收到完整句子即分段发送；关闭时等待完整回复，网页流式不受影响。需要同时开启模型流式输出 |
| `AI_STREAM_CHUNK_CHARS` | `240` | QQ 每段目标字符数，范围 40–1000；完整句子可提前发送 |
| `AI_CONCURRENCY` | `4` | 不同会话的处理并发数，范围 1–16；同一会话保持顺序 |
| `AI_TIMEOUT_MS` | `45000` | 单次模型请求超时，包含响应正文读取 |
| `AI_REASONING_EFFORT` | 留空 | 可选的模型推理强度；不为空时发送 `reasoning_effort`。支持 none / minimal / low / medium / high / xhigh，具体取值需模型服务支持 |
| `AI_MAX_OUTPUT_TOKENS` | 0 | 包含推理与正文的生成 Token 上限；0 使用服务默认，与回复字符上限独立 |
| `AI_TEMPERATURE` | 留空 | 可选采样温度，0–2；留空使用服务默认 |
| `AI_TOP_P` | 留空 | 可选 Top P，0–1；留空使用服务默认 |
| `AI_PRESENCE_PENALTY` | 留空 | 可选话题重复惩罚，-2–2；留空使用服务默认 |
| `AI_MAX_ATTEMPTS` | `3` | 生成尝试总次数，范围 1–10；可重试错误采用指数退避 |
| `AI_CONTEXT_TURNS` | `-1` | 每个会话保留的上下文轮数；-1 不限制，0 不保留 |
| `AI_MAX_INPUT_CHARS` | `8000` | 单条 AI 输入长度上限 |
| `AI_MAX_REPLY_CHARS` | `1800` | 模型回复长度上限 |
| `AI_SYSTEM_PROMPT` | 见配置示例 | 模型系统提示词 |

如果日志中的 `ai_generation_failed` 每次都接近 `AI_TIMEOUT_MS`，先查看 `reason`、`duration_ms`、`timeout_ms` 和可选的 `http_status`。返回只有推理时还会记录服务提供的 `finish_reason` 和 Token 用量；`length` 表示生成上限截断，应检查推理与正文的总额度。保留 high 时还需预留足够的请求时间，并按模型建议设置采样参数。程序只发送非空正文；只有推理时按 `AI_MAX_ATTEMPTS` 有限重试。当前本机验证见 [保留 high 的修复记录](docs/AI-REASONING-2026-10-28.md)，此前的超时诊断见 [历史记录](docs/AI-TIMEOUT-2026-10-27.md)。

完整配置见 [.env.example](.env.example)，实际默认值和校验范围以 [src/config.mjs](src/config.mjs) 为准。

### AstrBot 与表情包

在 AstrBot 创建 OneBot v11 机器人，本项目“配置文件 → OneBot 与推送”填写对应反向 WS 地址（同机通常为 `ws://127.0.0.1:6199/ws`）及相同 Token，保存后重启。由 AstrBot 负责回复时关闭本项目内置 AI。

使用 AstrBot 的 QQ 空间插件 `llm_publish_feed` 时，先在本项目保存空间 Cookie，再开启“配置文件 → OneBot 与推送 → 允许 AstrBot 获取空间 Cookie”，保存并重启。该插件发布前会调用 `get_cookies`；详情与权限范围见 [QQ 空间说明](docs/QZONE.md)。

图片发送支持 `image` 消息段、Base64、本机绝对路径、`file://` 和 HTTP(S) URL；GIF 保留原始字节。AstrBot 与 QQ 机器人不共享文件系统时，表情插件应启用 Base64 图片发送。图片读取、SDK 上传和终态确认完成后才返回成功，结果未知时不会自动重发。详情及限制见 [图片与 AstrBot 接入](docs/IMAGES.md)。

## 日常使用

### 自定义消息插件

进入管理台左侧“插件”，在概览中打开各插件的专属管理或配置；可新建脚本插件、编辑源码与 JSON 配置，并在配置页的“作用范围”里设置好友或群聊、是否要求 @机器人。启用前必须至少设置一个范围（或勾选“全部”）。插件先于 AI 执行；未处理的消息继续进入原有 AI 规则。保存及启停即时生效，新插件默认停用。

聊天管理员可发送 `/new` 开启新对话，清空当前会话上下文并保留人格和已保存的记忆。群聊会清空该群共享的上下文；如仍有排队、执行中或待核对的任务，会提示处理后重试。`/tools` 可查看管理员指令说明。

本地模型读取网页可使用 [Python 网页抓取插件](docs/PYTHON-WEB-FETCH.md)：`npm run webfetch:install` 按现有 AI 白名单安装；`npm run webfetch:export` 生成可导入的插件 JSON。使用本机 Python 标准库，无需额外 Python 依赖。

需要机器人自然参与群聊，可安装 [群聊增强 Chat Plus](docs/GROUP-CHAT-PLUS.md)：`npm run groupchat:install -- --groups 群号`。支持 AI 读空气、概率与注意力、短消息合并、情绪、主动话题和图片描述缓存；管理指令入口为 `/gcp_help`。

需要跨对话保留偏好和事实，可安装 [流动记忆 Living Memory](docs/LIVING-MEMORY.md)：`npm run memory:install`。“插件 → 流动记忆”提供独立 3D 神经网络管理页，每多一条记忆增加一条连接，可直接查看和增删改记忆。支持自动总结、中文关键词与可选向量召回、按用户及人格隔离、衰减归档和 Agent 记忆工具；`npm run memory:export` 导出插件包，`/lmem help` 查看指令。

需要更自然连贯的情绪表达，可安装 [心绪 · 心理动力情绪](docs/EMOTION.md)：`npm run emotion:install`。借鉴本我、自我与超我的协调机制，支持情绪积累、恢复、关系熟悉感及情境共情；`npm run emotion:export` 导出插件包，`/emotion help` 查看指令。

插件使用独立线程执行并有超时限制，具有本机 Node.js 权限，请仅运行可信代码。完整编写约定、导入导出和管理 API 见 [自定义插件](docs/PLUGINS.md)。

以下命令连接已运行的机器人服务，并从 `.env` 读取对应接口凭据：

```powershell
# 查看运行状态与最近任务
npm run cli -- status
npm run cli -- jobs

# 查看联系人和群列表
npm run cli -- friends
npm run cli -- groups

# 发送文本；示例目标需替换为实际 QQ 号或群号
npm run cli -- send 10001 "你好"
npm run cli -- send-group 20001 "群聊测试"

# 查看消息与监听事件
npm run cli -- get 123
npm run cli -- watch 60
```

`get` 使用本项目返回的 OneBot 消息 ID。`watch` 的时长单位为秒，范围 1–3600。群聊发送命令已接入，但仍属于待实机验收能力。

### 分开运行服务与工作台

需要分别管理两个进程时：

```powershell
# 终端一：只启动机器人服务
npm start

# 终端二：只启动本机工作台
npm run login
```

也可不用网页，通过 CLI 申请二维码：

```powershell
npm run cli -- login --wait
npm run cli -- poll HANDLE
npm run cli -- logout
```

CLI 会把二维码写入 `DATA_DIR/qrcode-<标识>.png` 并打印文件路径。`poll` 的 `HANDLE` 使用登录接口返回的句柄。

默认内核驱动的 `logout` 会停止本地宿主并取消重连，**不会删除内核凭据，也不代表撤销远程授权**。

## OneBot 与管理员接口

默认监听 `127.0.0.1:5700`，由 `HOST` 和 `PORT` 配置。CLI 和独立工作台通过本机回环地址及 `PORT` 访问服务；一般保留默认 `HOST` 即可。

### 凭据分工

| 凭据 | 用途 |
| --- | --- |
| `ONEBOT_ACCESS_TOKEN` | 普通 OneBot HTTP 与正向 WebSocket 接入 |
| `ADMIN_ACCESS_TOKEN` | 运行状态、任务管理、扫码与本地退出 |
| `REVERSE_WS_TOKEN` | 反向 WebSocket 认证；留空时使用 OneBot Token |
| `WEBHOOK_SECRET` | webhook 的 OneBot v11 HMAC 签名 |
| `SESSION_KEY` | 实验性 native 驱动的本地票据加密；需为 64 位十六进制字符串 |

OneBot Token 和管理员 Token 均至少 24 个字符。管理员 Token 必须与 OneBot Token、反向 WS Token 不同，并且只接受 `Authorization` 请求头；不能用 URL 查询参数传入。管理员 Token 也不能作为普通 OneBot 接口凭据使用。

外部插件使用 OneBot 或反向 WS 凭据。工作台在本机服务端使用管理员凭据，不将其嵌入网页。默认内核驱动的账号凭据由官方 QQ 内核管理，不经过 `SESSION_KEY` 二次加密。

### 接口入口

| 入口 | 说明 |
| --- | --- |
| `GET /healthz` | 无需认证；检查进程存活 |
| `GET /readyz` | 无需认证；消息会话在线时返回 200，离线时返回 503 |
| `GET/POST /:action` | OneBot 动作，如 `/get_status`、`/send_private_msg` |
| `WS /` | OneBot API 与事件共用连接 |
| `WS /api`、`WS /event` | 分别用于 API 调用和事件接收 |
| `GET /admin/status` | 运行状态、账号、能力及任务概况 |
| `GET /admin/jobs` | 最近 50 条任务，包含会话、生成次数、发送次数和下一次执行时间；可带 `conversation` 参数精确筛选后取该会话最新 50 条 |
| `GET /admin/jobs/conversations` | 保留中任务的全部会话编号，供任务按群聊、私聊或网页试聊筛选；仅管理员可用 |
| `POST /admin/login/{start,poll,logout}` | 分别申请二维码、轮询状态和本地退出 |
| `POST /admin/jobs/:id/resolve` | 人工核对未知发送结果 |

普通 OneBot 请求使用 `Authorization: Bearer <ONEBOT_ACCESS_TOKEN>`。例如，将占位符替换为实际 Token 后执行：

```powershell
curl.exe "http://127.0.0.1:5700/get_status" -H "Authorization: Bearer <ONEBOT_ACCESS_TOKEN>"
```

OneBot 动作采用 `status/retcode/data` 响应结构；`/admin/status` 直接返回对象，`/admin/jobs` 直接返回数组。接口存在不代表当前驱动支持该动作，具体能力可通过 `status` 查看。

设置 `REVERSE_WS_URLS` 可连接逗号分隔的反向 WebSocket 地址；设置 `WEBHOOK_URL` 可推送事件。协议与驱动扩展说明见 [驱动契约](docs/DRIVER.md)。

## 任务、重试与恢复

AI 任务与上下文保存在 SQLite 中。Worker 由消息入库、任务状态变化和连接状态变化唤醒；空闲时不循环查询任务，有延迟重试或等待任务将要过期时，按最早期限唤醒。即使关闭 AI 或 QQ 离线，`queued` / `ready` 任务仍按 `JOB_MAX_AGE_MS` 转为 `failed / expired`，释放容量和同会话阻塞；正在执行的生成、发送及 `uncertain` 不被此过期流程改写。

| 状态 | 含义 |
| --- | --- |
| `queued` | 等待生成回复 |
| `generating` | 正在请求模型 |
| `ready` | 已保存回复，等待发送或安全重试 |
| `sending` | 发送处理中，可能仍在限流器中排队 |
| `done` | 已确认发送成功 |
| `uncertain` | 发送结果未知，等待人工核对 |
| `failed` | 永久失败、重试耗尽、任务过期或人工丢弃 |
| `ignored` | 不符合 AI 策略或入队时容量已满 |

生成与发送分别限制尝试次数。`/admin/jobs` 中的 `attempts` 表示生成次数，`send_attempts` 表示发送次数，`next_at` 为下一次执行时间的毫秒时间戳。

发送侧只重试明确未送达且允许重试的错误，间隔为 1、2、4、8…秒，最高 30 秒。达到 `SEND_MAX_ATTEMPTS` 后记录为 `failed / send_attempts_exhausted`。同一会话串行，不同会话可并发，发送开始时间同时受全局与会话间隔约束。

优雅停机时，明确尚未提交的排队回复回到 `ready`，保留原回复且不消耗发送预算，重启后继续发送。已提交但结果不明的任务保持 `uncertain`，不会因超时、停机或重启自动重发。进程异常退出时遗留的 `sending` 也会保守恢复为 `uncertain`。

### 人工核对未知发送

先查看真实 QQ 记录，再选择处理结果：

```powershell
npm run cli -- jobs

# 已确认送达：标记完成并写入上下文
npm run cli -- resolve 123 sent

# 放弃这条回复：标记失败
npm run cli -- resolve 123 discard
```

`123` 为任务 ID。接口不提供自动重发选项，避免因确认丢失造成重复消息。

### 容量与保留期

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `MAX_PENDING_JOBS` | `1000` | AI 未完成任务容量，包含 `uncertain` |
| `MAX_PENDING_SENDS` | `1000` | 发送限流器的等待队列上限 |
| `SEND_CONCURRENCY` | `4` | 并行发送上限，范围 1–16 |
| `SEND_INTERVAL_MS` | `1500` | 全局发送开始间隔 |
| `SESSION_INTERVAL_MS` | `3000` | 同一会话的发送开始间隔 |
| `SEND_MAX_ATTEMPTS` | `5` | 每条回复的发送尝试总次数，范围 1–16 |
| `JOB_MAX_AGE_MS` | `600000` | 等待任务的有效期，默认 10 分钟；关闭 AI、QQ 离线或延迟重试时仍按时过期 |
| `HISTORY_RETENTION_DAYS` | `7` | 已完成、忽略、失败任务，以及上下文和消息缓存的保留天数 |
| `RETAIN_IGNORED_JOB_CONTENT` | `false` | 是否保留 ignored 任务正文；关闭时只保留防重和任务身份信息，并在启动时脱敏旧 ignored 记录 |
| `UNCERTAIN_RETENTION_DAYS` | `30` | 未知发送记录的保留天数，范围 1–3650 |

未知任务积累到容量上限时，新 AI 任务会以 `queue_full` 忽略，直到人工处理或清理释放容量。

清理在服务启动时和此后每小时执行。`uncertain` 按进入未知状态的更新时间保留；异常退出后恢复的任务从恢复时间起获得完整核对周期。**超期清理会删除记录中的消息与回复正文，不会补发。** 活跃任务不会被历史保留期清理直接删除。

旧数据库会自动补充发送计数字段，已有生成次数、回复和重试时间保留；历史发送次数无法追溯，新字段从 0 开始。

### 未回复消息如何保存

任务防重使用独立的 `event_key`，不需要保留消息正文。默认 `RETAIN_IGNORED_JOB_CONTENT=false` 时，`ignored` 任务的 `event` 只保存账号、会话、消息 ID、时间等身份字段及 `content_retained:false`；不保存 `message`、`raw_message`、昵称、附件，也清空 `input` / `reply`。容量不足而忽略的输入、策略变更后转为 ignored 的任务同样处理。事件仍会完整推送到 OneBot 和进程内消息页。

**升级后首次启动会按此默认值脱敏已有 ignored 任务正文，不能通过重新开启开关恢复。** 如需保留原有全文，应在启动新版前设置 `RETAIN_IGNORED_JOB_CONTENT=true`；开启后按 `HISTORY_RETENTION_DAYS`（默认 7 天）保留全文。开关可在 Web“数据与保留 → 保留忽略任务正文”修改，重启生效。脱敏保留事件键、状态、原因和时间，不影响防重；防重记录自身在保留期结束后删除。

这个开关只控制 `jobs` 表中 ignored 任务的正文。待处理、失败等其他任务、上下文及 OneBot 查询缓存仍可能保存原文；其中查询缓存独立于 AI 是否启用，同样默认保留 7 天。管理台消息只保存在进程内，QQ 官方 SDK、AstrBot 的数据由各自管理。数据库脱敏不等同于擦除已有备份或 WAL 中的旧内容。

管理台任务详情会分别解释筛选原因、正文未记录、正文已脱敏、原消息无文本等状态。脱敏改写条数、时间和环节会与改写操作一起写入持久审计表，并输出不含正文的日志；可在“日志”中搜索 `ignored_job_content_redacted` 查看。新记录从未保存正文时不算一次脱敏删除，旧版本未留下的审计不能补造。

## 运行时维护

官方运行时、桥接和账号数据分开保存：

| 配置项 | 默认路径 | 内容 |
| --- | --- | --- |
| `QQ_RUNTIME_DIR` | `./runtime/qq` | 官方 QQ 程序文件 |
| `QQ_KERNEL_DIR` | `./runtime/kernel` | 自研宿主桥接及构建元数据 |
| `QQ_KERNEL_DATA` | `./data/qq-kernel` | 官方内核管理的账号数据和诊断信息 |
| `DATA_DIR` | `./data` | 消息数据库、任务与本地运行锁 |

从 QQ 官方下载并更新运行时（启动入口默认做的就是这件事）：

```powershell
npm run qq:download -- --prepare --activate
```

脚本读取 QQ 官网发布配置，下载安装包，验证腾讯 Authenticode 签名，然后解包到 `runtime/qq-<版本>`、构建 `runtime/kernel-<版本>`，并把 `.env` 中的实际路径改为新目录（保留已有密钥）。下载的安装包保留在 `runtime/downloads` 下可复用，解包目录在构建完成后自动清理。它不会运行安装器或替换系统已安装的 QQ。带 `--activate` 时先停止服务，执行完再重新启动；新版本是否兼容仍需验证。

只想下载安装包、不动现有运行时，去掉参数即可：

```powershell
npm run qq:download
```

手动指定本机已安装的 QQ：

```powershell
npm run qq:setup -- --from "C:/Program Files/Tencent/QQNT/QQ.exe" --to ./runtime/qq
npm run qq:build
```

将示例路径替换为实际位置，并确保 `.env` 的 `QQ_RUNTIME_DIR` 指向目标目录。`qq:setup` 不覆盖已有目标目录，也不复制账号数据或日志。

宿主桥接绑定构建时使用的 Node 可执行文件和 QQ 运行时。更换 Node 或移动运行目录后，需要停止服务并重新执行 `npm run qq:build`。官方程序和原始 `wrapper.node` 保持不变，启动时会校验运行文件与构建元数据。

`QQ_ACCOUNT=0` 表示由扫码确定账号；指定 QQ 号后会拒绝其他账号。启动时会尝试恢复唯一可快速登录的本地账号，有多个候选账号时需指定账号或重新扫码。

## 数据与故障排查

同一个 `DATA_DIR` 只允许一个机器人实例，以防重复消费和发送。正常停机释放运行锁；不要通过删除运行中的锁文件来启动第二个实例。

备份前先停止服务，再备份 `.env`、`DATA_DIR` 和自定义位置的 `QQ_KERNEL_DATA`。这些目录可能包含密钥、登录凭据和消息正文。

常见现象：

| 现象 | 检查方式 |
| --- | --- |
| Node 版本不符或缺少依赖 | 确认使用 Node.js 24+；在项目根目录执行 `npm ci` |
| 缺少运行时或桥接校验失败 | 检查 `QQ_RUNTIME_DIR`、`QQ_KERNEL_DIR` 和 `QQ_KERNEL_DATA`；按需重新准备运行时或构建桥接 |
| 首次启动提示需要 7-Zip，或反复提示下载失败 | 安装 7-Zip 或把 `QQ_7ZIP` 指向 `7z.exe`；网络受限时改设 `QQ_RUNTIME_SOURCE=local` 用本机已装的 QQ |
| 端口被占用或管理员凭据不一致 | 查看原服务窗口；确认 `PORT` 与 `.env` 一致，重启旧服务后再试 |
| `/healthz` 正常但 `/readyz` 返回 503 | 服务存活但消息会话未在线，查看工作台扫码和连接状态 |
| QQ 已连接但 AI 不回复 | 检查 `AI_ENABLED`、模型服务、白名单、群聊 @ 条件及任务 |
| 任务以 `queue_full` 忽略 | 查看 `jobs`，核对积累的未知发送记录或调整容量 |
| `login_required` | 本地凭据无法继续恢复，需要重新扫码 |
| 宿主退出或初始化失败 | 查看内核数据目录的 `validation.json` 与 `host-stderr.log` |

`validation.json` 记录登录和消息链路的里程碑，不包含消息正文、二维码或票据。`host-stderr.log` 最多保留 256 KiB，重连前保留上一份为 `host-stderr.previous.log`；这些仍属于本地诊断数据。

宿主默认有 5 秒完成正常关闭，超时后才强制终止，可通过 `QQ_SHUTDOWN_TIMEOUT_MS` 调整。网络或宿主异常的恢复采用 1–30 秒退避；凭据失效时等待扫码，不无限重试认证。

## 测试与源码导出

```powershell
npm run check
npm test

# 检查当前 QQ 运行时、宿主和 Node 的完整性与接口兼容性
npm run qq:check

# 使用全新临时数据验证真实内核加载、二维码获取和正常退出
npm run qq:check -- --qr --report dist/qq-runtime-check.json

# 只运行调度与停机回归文件
npm test -- test/worker-scheduling.test.mjs test/worker-shutdown.test.mjs

# 导出可分享的源码目录
npm run source:export
```

2026-10-27 修复本机模型生成超时后，最近一次完整回归为 **237 项全部通过**。测试包含模拟驱动、合成协议端和宿主状态机，覆盖认证隔离、消息确认、AI 队列、重试、停机、数据库迁移与数据保留；它们不替代实机验证。

本次将 `ws` 从 8.18.3 更新到 8.22.0，`silk-wasm` 保持已发布最新版 3.7.1；QQ 官方运行时从 9.9.27-45758 更新为 9.9.36-53644。`qq:check -- --qr` 已验证新版真实内核和二维码链路；该命令不会恢复现有账号，会在检查后清理临时数据，不打印或保存二维码。本轮未重新进行扫码认证和真实消息收发，完整范围与回退方式见 [运行库升级与兼容性记录](docs/RUNTIME-UPDATE-2026-10-26.md)。

`npm test` 将严格结果写入 `dist/test-results.json`。只有所有选中测试完成且全部通过，失败、取消、跳过及待办数均为 0，才返回成功。每次运行会先将旧报告标记为未完成；CI 应同时检查退出码和报告的 `success/complete`。

源码导出会创建新的 `dist/source-<时间戳>` 目录及 SHA256 清单。导出范围按白名单选择，排除 `.env`、账号数据、运行时、数据库、票据和日志，并拒绝源码中的符号链接。分享时压缩导出目录，不要直接打包原始工作目录。

### Docker 与其他驱动

默认 `kernel` 驱动仅支持 Windows x64，不能放入仓库提供的 Linux 镜像中运行。Compose 要求显式设置 `QQ_DOCKER_DRIVER=native`、`demo` 或 `scaffold`；容器使用独立数据卷，通过 `/readyz` 做健康检查。

`native` 是仍需匹配签名服务的实验性协议研究路线，尚无真实账号验收；`demo` 是模拟驱动，`scaffold` 仅提供离线骨架。Docker 构建和真实 QQ 容器运行尚未验收。

## 项目文档

- [法律与合规说明](docs/LEGAL.md)
- [插件市场与资源通道](docs/MARKET.md)
- [官方内核适配与实机验证](docs/KERNEL.md)
- [驱动接口契约](docs/DRIVER.md)
- [研发进度与待验收项目](docs/ROADMAP.md)
- [native 协议研究](docs/NATIVE.md)
- [历史 OneBot / AI 运维说明](docs/LEGACY_PROTOCOL.md)
