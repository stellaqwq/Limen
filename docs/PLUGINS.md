# 自定义插件

内置[视频理解插件](VIDEO-ANALYSIS.md)把 `video_info`、`video_frames`、`video_transcript` 统一安装、配置和启停。它支持网页对话及指定 QQ 会话，使用独立媒体执行层承载图片和较长的转写请求，普通 JavaScript 插件的返回大小及超时限制保持原样。

## 插件包目录

所有插件实现都不在 `src/` 内，而是放在项目根目录的 `plugins/` 下，每个插件一个目录：

```
xq/
├── plugins/
│   ├── _host/                 宿主 SDK（插件只能通过它引用宿主模块）
│   ├── free-activity/         plugin.json + index.mjs + service.mjs …
│   ├── comfyui/
│   ├── video/
│   ├── android/
│   ├── douyin-web/
│   ├── group-chat-plus/
│   ├── memes/
│   ├── background/            工作台背景壁纸（不处理聊天消息）
│   ├── startup-animation/     工作台启动动画（不处理聊天消息）
│   ├── voicestudio/
│   ├── living-memory/
│   ├── emotion/
│   ├── autonomous-thought/    进程外独立插件（自带安装包，不含 plugin.json）
│   └── _packages/             进程外插件的安装包（下划线目录不参与扫描）
└── resources/app/src/         宿主：不再包含任何插件实现
```

宿主启动时扫描该目录，读取每个 `plugin.json` 并动态 `import` 入口模块。目录不存在、清单无效或入口导入失败的包只记录日志，不影响其余插件启动。目录名以 `_` 或 `.` 开头的会被跳过。

`plugin.json`：

```json
{
  "api": 1,
  "id": "douyin-web",
  "kind": "douyin-web",
  "name": "抖音网页浏览",
  "version": "1.0.0",
  "description": "使用独立 Chrome 窗口采样抖音画面。",
  "entry": "index.mjs",
  "singleton": true,
  "groupOnly": false,
  "unprefixedTools": true,
  "requires": [],
  "toolHints": ["/gcp_help：管理指令"],
  "commandPattern": "^\\/gcp_(?:status|help)(?:\\s|$)",
  "panel": "groupchat",
  "capabilities": ["message", "agent-tools", "hooks"]
}
```

| 字段 | 说明 |
| --- | --- |
| `api` | 必填，当前只支持 `1`。宿主接口不兼容时拒绝加载并提示 |
| `id` / `kind` | `id` 是目录内的稳定标识；`kind` 与插件记录、工具、配置绑定，必须唯一 |
| `entry` | 入口模块，默认 `index.mjs`；不允许绝对路径或 `..` |
| `singleton` | 默认 `true`，同 `kind` 只允许安装一个插件记录 |
| `groupOnly` | 只处理群消息，且忽略“需要 @机器人”设置 |
| `unprefixedTools` | Agent 工具名不加 `plugin_<id>_` 前缀（抖音、安卓使用原始工具名） |
| `toolHints` | 管理员 `/tools` 输出中追加的指令说明 |
| `commandPattern` | 命中后即使没有插件范围也要走插件队列的指令正则 |
| `requires` | 依赖的其他 `kind`，创建实例时按需先行创建 |

`index.mjs` 约定：

| 导出 | 必填 | 说明 |
| --- | --- | --- |
| `create(ctx)` | 是 | 返回插件实例。`ctx` 提供 `store`、`config`、`log`、`adapter`、`ai`、`attachments`、`groupContext`、`overrides`，`ctx.plugins` 是插件服务，`ctx.get(kind)` 取得其他插件实例 |
| `template()` | 安装时需要 | 返回该插件的默认定义（`kind`、`name`、`version`、`source`、`config`、`scope`…） |
| `config(value)` | 否 | 校验并合并配置默认值 |
| `schema()` | 否 | 返回配置表单定义 |
| `tools(config)` | 否 | 返回随插件启停的 Agent 工具定义 |
| `visible(plugin, { event, job, host })` | 否 | 会话/任务级可见性，默认使用范围与 @ 规则 |
| `run(service, plugin, event, opts)` | 否 | 消息处理入口；不导出表示只提供工具或时基能力 |
| `setup(ctx)` | 否 | 启动后一次性初始化（读取安装记录、拉起本地服务等） |
| `changed(service, plugin)` | 否 | 插件记录安装、保存或启停后调用，便于刷新缓存、对外快照等副作用；宿主会等待它完成 |
| `destroy(service, id)` | 否 | 删除插件记录时清理专属数据 |

插件之间只通过 `ctx.get(kind)` 或同级相对路径互访；宿主模块必须经 `plugins/_host/*.mjs` 引用，例如 `_host/messages.mjs`、`_host/schema.mjs`、`_host/config-schema.mjs`、`_host/paths.mjs`。`_host` 是唯一的宿主适配层，宿主内部结构调整只需改这一处。

管理台左侧 **插件 → 插件管理** 支持本地 JavaScript 消息插件，不需要安装额外依赖。插件概览集中提供各插件的专属管理或配置入口；群聊增强、表情图库和流动记忆可在同一工作区切换。代码、JSON 配置、会话范围、启用状态及运行统计保存在 `DATA_DIR/bot.sqlite` 中，重启后保留。

## 独立性边界与跨机器复用

一个插件包只应依赖**自己的目录 + `plugins/_host`**，不依赖其他插件、不写死本机绝对路径。宿主侧已按这个边界约束：

- `plugins/_host/resolve.mjs` 在加载时探测宿主源码位置，因此 `plugins/` 与 `resources/app/` 同级、`plugins/` 位于应用目录内、或应用被整体复制到别的路径，都能正常工作；
- `_host/paths.mjs` 的 `appRoot`、`runtimeRoot`、`runtimeDir()`、`pluginDir` 都由同一次探测得出，插件不要自己拼 `../../..`；
- `_host/deps.mjs` 的 `requireFromHost(pkg)` 从宿主 `node_modules` 解析第三方包；插件目录不在应用的依赖查找路径上，裸 `import 'pkg'` 会失败；
- 内置插件之间没有任何相互 import，单独放一个插件目录（连同 `_host`）启动时其余功能降级为不可用，但不会报错。

把一个插件搬到另一台机器，需要同时满足：

| 条件 | 说明 |
| --- | --- |
| 宿主接口一致 | 目标机器的 `plugin.json` 支持的 `api` 相同（当前为 1）；`api` 不符会被拒绝加载并记录日志 |
| 目录就位 | 放到目标机器的插件目录（便携版解压目录下的 `plugins/`，开发目录为 `xq/plugins/`），目录名建议与 `id` 一致 |
| 不跨包引用 | 插件只能 `import` 自己目录内的文件和 `../_host/*.mjs` |
| 不写死路径 | 需要数据目录用 `ctx.config.dataDir`，需要运行时目录用 `_host/paths.mjs` 的 `runtimeDir()` |
| 依赖可解析 | 第三方包要么由宿主提供（`requireFromHost`），要么在插件内自带并随包分发 |
| 重新登记 | 复制完成后重启宿主，或在“插件管理 → 插件包”里用路径安装；已保存的插件记录按 `kind` 关联，换机器需重新安装记录并配置范围 |

`plugin.json` 里的 `kind` 是跨机器识别的关键：同一插件在不同机器上应保持相同 `kind`，否则已保存的配置与统计不会沿用。

## 安装与卸载插件包

“插件管理 → 插件包”填写本机目录或 `.zip` 路径后点击“安装插件包”：

1. 宿主先校验清单（`api`、`id`、`kind`、`name`、`version`、入口），并拒绝绝对路径、`..`、Windows 盘符路径、超过 400 个文件或 24 MiB 的包；
2. 复制到 `plugins/<id>/`；同名目录已存在时需勾选“覆盖同名插件”；
3. 重新扫描注册表并实例化，新插件类型立刻出现在“内置插件”下拉框与插件包列表中；
4. 安装只新增可用类型，仍要在列表中安装记录、配置会话范围、启用后才会处理消息。

`.zip` 允许把插件放在单层包装目录内（如 `my-plugin/plugin.json`）。卸载只会删除 `plugins/<id>` 目录，不会自动删除已经保存的插件配置；需要保留记忆或统计时请先备份数据目录。zip 内的路径必须使用 `/`：Windows 的 `Compress-Archive` 等工具会写成 `background\config.mjs`，会被“包含无效路径”拒绝（防路径穿越），请改用 7-Zip 或 `tar -a -c -f name.zip 目录` 打包。

不想手工拷 ZIP 时，可以发布一份静态清单让“插件市场”页面统一安装与更新，并让 FFmpeg 这类大体积二进制走独立的资源通道：[插件市场与资源通道](MARKET.md)。

## 聊天指令与管理员

在“全部设置 → 回复范围 → 聊天管理员 QQ ID”填写可使用聊天 `/` 指令的 QQ 号，环境变量为 `BOT_ADMIN_IDS`，多个号码用逗号分隔，保存后重启生效。留空时全部禁用。权限只按真实消息发送者的 QQ 号判断，群主或群管理员身份不会自动授予权限；插件原有会话范围及群聊 @ 要求仍需匹配。

管理员发送 `/tools` 或 `/工具` 可查看当前会话启用插件的指令说明。普通聊天中的“有哪些工具”“能调用语音吗”及函数名称不会触发内置工具说明。自定义脚本、表情和语音插件的所有聊天 `/` 指令共用这一检查；被拒绝的指令不会交给 AI 继续执行。工作台内的管理操作及模拟测试仍使用独立管理员 Token，不按聊天 QQ 号授权。

管理员发送独立的 `/new` 可开启新对话：清空当前私聊或群聊的短期上下文，保留当前人格和用户主动保存的记忆，不影响其他会话。群聊上下文由同一群共享，因此会清空该群的共同上下文。无需安装插件，AI 或 Agent 关闭时也可使用；确认消息沿用引用原消息、仅群聊 @ 发送人的规则。有排队、执行中、待发送或发送结果未知的任务时会提示处理后重试，避免旧任务把上下文写回。指令会防重，不会作为问题发送给模型。

## 创建与启用

1. 启动或重启服务，进入“插件管理”，点击“新建插件”。
2. 默认模板在收到 `/ping` 时回复 `config.response`。填写插件名称、版本，编辑代码与 JSON 配置。
3. 填写允许触发的好友 QQ 号或群号；多个号码以逗号分隔。群聊默认需要 @机器人。也可显式允许全部私聊或全部群聊。插件范围独立于 AI 白名单。
4. 使用“模拟测试”检查当前草稿的返回值。测试 QQ 号仅是模拟输入，不会经机器人接口发送消息；界面会说明模拟会话是否匹配实际触发范围。测试会执行代码本身，其文件与网络操作仍可能产生实际效果。
5. 点击“保存插件”。新插件默认停用；配置范围后，在列表点击“启用”。保存、启停与删除即时生效，无需重启服务。

首次更新项目源码后，需要在原启动窗口按 `Ctrl+C` 完全退出机器人，再重新运行 `start.cmd`。关闭网页、打开第二个工作台或网页“重启生效”仅针对现有服务或配置，不能保证加载更新后的代码。启动入口发现不支持插件接口的旧服务时会明确提示，避免将新管理台连接到旧服务。若看到“尚未加载插件管理接口”，请按上述步骤退出旧进程并重新启动。

编辑已启用的插件并保存后，新的代码和配置即时用于后续消息。更新、停用或删除会取消尚在执行的旧代码；已经提交给 QQ 的发送不能撤回。

列表还提供“重载”“查看行为”“从文件更新”。重载校验现有代码、取消旧执行并刷新修订号，保留配置、范围及启停状态；不下载新版本。脚本每次调用本来就使用新线程，内置插件执行层源码升级仍须重启项目。查看行为会展示消息触发入口、内置指令，以及 Agent 工具的说明、参数和读写属性。

“内置插件 → 安装或打开”可管理 Chat Plus、VoiceStudio 与表情包管理器；已安装时保留原配置。群聊增强还提供专门的 [管理页](GROUP-CHAT-PLUS.md)。

[流动记忆 Living Memory](LIVING-MEMORY.md) 同样可在内置插件中安装；“插件 → 流动记忆”提供独立的 3D 神经网络管理页，每条记忆一条连接，可查看和增删改记忆。支持自动总结、召回与生命周期管理，`/lmem help` 查看指令。自动召回及整理由宿主生命周期入口执行，普通脚本插件仍按下文接口运行。

[心绪 · 心理动力情绪](EMOTION.md) 提供有延续性的拟人语气与情境调节，`/emotion help` 查看指令。它通过 AI 生成前入口工作，情绪状态与长期记忆分别保存。

[启动动画](STARTUP-ANIMATION.md) 由内置 `startup-animation` 插件提供，在“插件 → 启动动画”里选择风格、底色、文案和 Logo；它同时覆盖桌面启动窗口与工作台首屏，首帧开始播放并在服务就绪后退出。它只提供管理页与首屏渲染，不处理聊天消息，启用时也不需要 QQ 会话范围。

[背景壁纸](BACKGROUND.md) 由内置 `background` 插件提供，在“插件 → 背景壁纸”上传本机图片作为工作台背景，可调适应方式、模糊、白色遮罩与面板不透明度。它只提供管理页与外观，不处理聊天消息，启用时也不需要 QQ 会话范围。

## 配置表单定义

插件 JSON 可声明 `config_schema`，也可在编辑器展开“配置表单定义”填写，点击“应用表单定义”预览。格式借鉴 AstrBot，后端负责类型、数值范围及选项校验；保存失败不会替换旧配置。支持嵌套对象和缺失参数默认值，保留未在 Schema 声明的旧配置键。

```json
{
  "command": {
    "type": "string", "description": "触发指令", "default": "/ping", "group": "基础"
  },
  "enabled": {
    "type": "bool", "description": "启用回复", "default": true, "group": "基础"
  },
  "probability": {
    "type": "float", "description": "参与概率", "default": 0.1,
    "hint": "0 到 1", "slider": {"min": 0, "max": 1, "step": 0.01}
  }
}
```

支持 `string`、`text`、`int`、`float`、`bool`、字符串 `list` 和嵌套 `object`；可使用 `description`、`hint`、`group`、`default`、`options`、`slider` 和 `secret`。表单采用输入框、复选框、下拉框或多行文本；`slider` 定义数值边界。`object.items` 是子配置定义。最多 100 项、4 层嵌套，定义最多 24 KiB。`secret` 使用密码框展示，仍以明文保存在配置中并随完整配置导出。

这是 AstrBot 配置格式的有限子集，不支持其文件上传、模板列表或 Python 插件执行。作者与仓库地址可在插件编辑器填写并随包导出；仓库信息不代表兼容或自动安装。

## 编写插件

```javascript
export default async function ({ text, event, config }) {
  if (text.trim() !== config.command) return null;
  return { reply: config.response, handled: true };
}
```

配置示例：

```json
{
  "command": "/ping",
  "response": "pong！插件运行正常。"
}
```

| 参数 / 返回值 | 说明 |
| --- | --- |
| `text` | 将 OneBot 文本消息段拼接并去除首尾空白；不含 @消息段或图片 |
| `event` | 当前 OneBot `message` 事件的独立副本，含 `message_type`、`user_id`、`group_id` 等 |
| `config` | 当前插件的 JSON 配置对象 |
| `null` / `undefined` / `{handled:false}` | 未处理，继续下一个插件；最终进入原有 AI 白名单与回复规则 |
| `{reply:"纯文本"}` | 向消息原会话回复，视为已处理；最多 2000 字，不解析 CQ 码 |
| `{message:[{type:'image',data:{file:'...'}}]}` | 发送文本/图片消息段，最多 5 个；同样视为已处理 |
| `{handled:true}` | 消费消息，不回复，并停止后续插件与 AI |

每次调用使用新的工作线程，模块全局变量不会跨消息保留。函数可使用 Node.js 内置模块及 `fetch`；代码以 data URL 模块加载，不支持相对文件导入和按项目目录解析 npm 包。不要依赖后台定时器，函数返回后线程即终止。普通消息扩展点针对收到的私聊与群聊消息；支持另行声明 Agent 工具，见 [Agent 工具插件](AGENT.md)。不包括定时任务或 OneBot 自定义动作。

需要让本地模型调用 Python 读取网页时，可使用已提供的 [Python 网页抓取插件](PYTHON-WEB-FETCH.md)，它通过现有 Agent 工具接口接入。

[群聊增强 Chat Plus](GROUP-CHAT-PLUS.md) 作为内置 `group-chat-plus` 插件提供：可导出 / 导入配置、使用中文分组表单及群专属配置、查看运行状态、即时启停；主动参与仍要求群在 AI 白名单中。`/gcp_help` 查看管理员控制指令。

**仅安装可信代码。** 插件具有当前 Node.js 进程的文件、网络和系统权限。独立线程、内存限制和超时终止用于隔离普通异常和卡死，不构成权限沙箱。保存前会加载模块检查默认导出；模块顶层语句会在保存校验和测试中运行。文件与网络副作用由插件作者负责，建议将业务逻辑放入导出的函数。

## 执行顺序与故障处理

- 先按会话范围和触发前缀筛选，再按优先级从高到低执行（范围 -100 至 100，相同值按插件 ID 排序）。回复或 `handled:true` 会停止后续处理。机器人自身消息不触发插件。
- 同一会话的插件消息串行；其他会话可并行。QQ 回复仍经过原有发送限流器。最多安装 32 个插件，最多 8 个线程同时执行，最多等待 100 条消息。负载超限或超大事件会跳过插件，继续原有 AI 规则。
- 执行时限可设为 100–10000 毫秒，包含模块加载。普通异常、无效返回值或超时会记录失败，并继续后续插件与 AI。列表显示执行次数、失败次数与最近错误；日志不记录插件配置、代码、错误堆栈或回复正文。
- 插件发出的回复没有自动重试。发送失败后仍视为已处理，避免随后 AI 重复回复。显示“发送结果未知”时请先在 QQ 中核对。
- 消息在执行插件前持久化防重标识。进程中断后不重放已领取的消息，避免发送重复回复；因此中断中的插件消息可能没有回复，也不会补跑 AI。防重标识按历史保留天数清理。
- 插件已处理的消息在原有任务队列记为“已忽略”，原因显示“消息已由自定义插件处理”；正文遵循原有忽略任务保留策略。插件回复本身显示在消息监听中，运行统计位于插件列表。

## 导入、导出与备份

编辑器可导出当前草稿为版本 1 的 JSON 文件。导出包含代码、范围及完整配置，**包含配置中自行填写的密钥**，分享前请检查。导入只载入新草稿，不会自动保存或启用，也不覆盖已有插件。列表中的“从文件更新”会以原插件为目标载入新草稿，保留原会话范围、启停状态与配置；更新包中的新默认项会补齐。检查版本、代码和差异后点击保存，过期修订号会拒绝覆盖。已保存的插件随 `bot.sqlite` 一起备份。

外部插件包在控制台“插件”页点“导入 ZIP 插件包”，选择本机 `.zip` 即可一键安装：压缩包以原始字节上传，服务端解压到内存校验 `plugin.json`、入口文件、文件数量（最多 400 个）、单文件（2 MiB）与总大小（24 MiB，压缩包本身 32 MiB），通过后才写入 `plugins/<id>/` 并重新扫描。同名包默认拒绝并提示覆盖；覆盖会先删除旧目录再写入新文件，插件记录、配置与启停状态保留。导入成功后会自动建立插件记录（默认停用），配置会话范围即可启用；若该包没有可用的默认模板，包仍会装好，可在“可安装的内置插件”里手动安装。需要指定本机路径时，也可继续在旧版“插件管理”页填写目录或 ZIP 路径安装。

## 管理接口

以下接口仅接受独立 `ADMIN_ACCESS_TOKEN` 的请求头认证。OneBot Token 和查询参数凭据均不可用于插件管理。工作台代理还会检查本机来源，管理员凭据不会写入页面。

| 接口 | 参数 / 结果 |
| --- | --- |
| `GET /admin/plugins` | 返回列表（不含各插件源码与配置）、新建模板及安装数量上限 |
| `GET /admin/plugins/detail?id=ID` | 返回完整插件与 `revision` |
| `POST /admin/plugins/save` | `{plugin}` 新建；`{id,revision,plugin}` 更新；新建默认停用 |
| `POST /admin/plugins/toggle` | `{id,revision,enabled}` |
| `POST /admin/plugins/reload` | `{id,revision}`；校验并重载，保留配置与启停状态 |
| `GET /admin/plugins/groupchat?group=群号` | Chat Plus 全局配置、群列表及指定群的运行数据 |
| `POST /admin/plugins/groupchat/action` | `{revision,group,action,...}`；支持暂停 / 恢复、临时概率、配置覆盖、重置及图片缓存管理 |
| `POST /admin/plugins/delete` | `{id,revision}` |
| `POST /admin/plugins/test` | `{plugin,text,message_type,user_id,group_id}`；可直接测试未保存草稿 |
| `GET /admin/plugins/packages` | 已发现插件包、拒绝原因与插件目录位置 |
| `POST /admin/plugins/packages/inspect` | `{source}`；校验目录或 ZIP，返回清单摘要，不写入 |
| `POST /admin/plugins/packages/install` | `{source,overwrite}`；安装到 `plugins/<id>/` 并重新扫描 |
| `POST /admin/plugins/packages/upload` | 请求体为 `.zip` 原始字节，`X-File-Name` 传文件名；`?overwrite=1` 覆盖同名包，`?inspect=1` 只校验不写入；最大 32 MiB |
| `POST /admin/plugins/packages/remove` | `{id}`；删除 `plugins/<id>` 目录并重新扫描 |

`plugin` 的完整结构见接口返回的 `template`。修改操作需要当前版本号，旧版本返回 HTTP 409；此时先重新加载插件，再合并修改。插件源码最多 48 KiB，配置最多 32 KiB，请求体最多 256 KiB。
