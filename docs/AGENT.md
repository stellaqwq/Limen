# Limen Agent 使用说明

当前默认保留全部会话轮次与模型返回的思考，不按天清理历史。配置和数据表说明见[完整上下文保留](CONTEXT-RETENTION.md)。

本项目按 AstrBot 的 Agent 执行方式组织：QQ / OneBot 接入 → 既有消息插件 → 会话队列 → 人格与工具注册 → 模型与工具循环 → 原有发送队列。网页试聊使用同一执行层和持久化队列，并在网页返回结果。

这里实现的是原项目自己的 JavaScript Agent 核心，不是安装 AstrBot，也不能直接加载 AstrBot 的 Python 插件。对照的官方设计见 [Agent 执行层](https://github.com/AstrBotDevs/AstrBot/wiki/en-providers-agent-runners)和[插件与 AI 工具](https://docs.astrbot.app/use/plugin.html)。

## 使用

1. 按原来的方式运行 `npm run launch`。
2. 在“全部设置 → AI 与回复”配置兼容 Chat Completions、支持 function calling 的模型。在“回复范围”启用原有好友 / 群白名单。
3. “Agent 执行”默认开启，可以调整单任务模型请求次数、工具调用次数和总超时。配置保存后重启生效。
4. 在“Agent 管理”配置人格、会话与工具；需要验证模型时，通过顶部“测试对话”切换进入网页试聊，再在 QQ 中描述任务。Web 默认保持机器人管理界面。
5. 根据需要新建人格，为会话绑定，并选择允许使用的工具。人格和插件的修改即时用于后续任务。

网页试聊不要求 QQ 在线，但仍要求启用 AI、配置模型及其原有回复范围。网页会话默认提供时间、记忆工具；启用[本机与桌面 Agent](COMPUTER-AGENT.md)后，可使用本机文件、桌面及可选命令工具。网页会话不冒用 QQ 联系人身份，不执行 QQ 插件或空间发布。试聊记录保存在同一 SQLite 数据库中，遵循原有任务和历史保留周期；浏览器只保存随机会话编号。可在会话列表中为网页会话绑定人格。

如果模型不支持工具协议，可以关闭 `AGENT_ENABLED` 恢复传统 AI 回复；原有 VoiceStudio 的工具流程仍按原设置运行。

QQ 和网页测试对话支持图片及文档附件：图片交给视觉模型，文本、PDF、DOCX、XLSX 在本机提取内容。每条消息最多 4 个附件、合计最多 10 MiB；只发附件也可处理。用法、格式限制、配置及缓存策略见 [图片与文件分析](ATTACHMENTS.md)。

## 内置能力

| 工具 | 作用与权限 |
| --- | --- |
| `current_time` | 北京时间和 UTC |
| `memory_search` | 按关键词读取当前用户在当前会话的记忆，最多返回 12 条 |
| `memory_save` / `memory_forget` | 根据用户明确提出的要求保存或删除记忆；不要保存密钥 |
| `meme_categories` / `meme_reply` | 复用表情插件的分类、审核、概率、冷却和实际发送逻辑 |
| `voicestudio_list_voices` / `voicestudio_speak` | 复用语音插件的音色、合成缓存、恢复和 QQ record 发送 |
| `qzone_status` / `qzone_draft` | 仅 QQ 聊天管理员的私聊可用 |
| `qzone_publish` | 仅管理员私聊中的明确发布请求可用；默认仅自己可见，任务编号用于发布防重 |

人格工具范围为 `*` 时允许当前会话可用的全部工具；留空列表表示禁用全部工具。人格只能缩小权限，不能扩大插件范围或空间权限。模型必须以工具的真实结果为依据，不能凭输出文本完成操作。空间发帖结果未知时仍须在空间页面人工核对。

插件先于 Agent 执行。如果消息已被既有插件处理，Agent 不再重复回复。原有 `/tools`、表情和语音指令及其管理员规则继续有效。

聊天管理员可发送 `/new` 清空当前会话的短期上下文，开始新对话；人格和已保存的记忆继续保留。群聊会重置该群共享的上下文。有排队、执行中或待核对的任务时需先处理完成，再发送 `/new`。该指令不调用模型，在未安装插件或关闭 Agent 时同样可用。

## 人格与会话记忆

基础角色仍来自 `AI_SYSTEM_PROMPT`，人格提示词作为补充规则。QQ 私聊按账号与好友隔离上下文；群聊保留原有群会话上下文，记忆进一步按发言用户隔离。不同账号、群、好友、网页会话之间不共享记忆。

另有独立的 [群聊上下文感知](GROUP-CONTEXT.md)：在原有 AI 群白名单中参考近期群内聊天，包括未 @ 的消息、成员身份、机器人发言和引用。默认最近 30 条 / 15 分钟，附加背景最多 8000 字符；记录背景不触发额外回复。`/new` 和管理台清空上下文会同时清除这部分缓存。

切换人格或清空上下文会删除所选会话的短期历史，保留显式记忆。管理台支持查看、手动编辑和单条删除记忆。每个记忆作用域最多 50 条，名称最多 60 字符、内容最多 500 字符；`HISTORY_RETENTION_DAYS=0` 时记忆永久保留；正数时在最后更新时间超过指定天数后清理。人格配置本身不会随聊天历史到期删除。

在“Agent 管理 → 会话与记忆”选择会话，在对应记忆旁点击“编辑”，可修改名称和多行内容。点击“保存记忆”后立即写入数据库，供后续任务读取，无需再次重启；点击“取消”放弃草稿。保存会更新记忆的最后更新时间，按新时间计算到期清理。

编辑期间保留草稿并暂时锁定会话选择，保存或取消后可切换；自动轮询、手动刷新和切换管理标签不会覆盖草稿。群聊行显示对应成员 QQ，编辑固定作用于该成员。若模型或另一个窗口已更新、删除该条记忆，或新名称在相同作用域内已占用，保存会被拒绝并保留草稿；可先复制需要的草稿，取消编辑后重新读取。修改单条记忆不会清空会话上下文或改动其他成员记忆。

有生成中、待发送或结果未知任务时，切换人格、重置会话和删除已绑定人格会被拒绝，处理这些任务后即可操作。编辑人格有版本检查，避免窗口之间覆盖修改。

## 把现有插件扩展为工具

原有消息插件 JSON 无需修改。需要工具时，在插件编辑器的“Agent 工具定义”填写：

```json
[
  {
    "name": "lookup_order",
    "description": "根据订单号查询配送状态",
    "effect": "read",
    "parameters": {
      "type": "object",
      "properties": { "order_id": { "type": "string", "maxLength": 20 } },
      "required": ["order_id"],
      "additionalProperties": false
    }
  }
]
```

代码需要保留默认消息处理函数，并增加命名导出：

```js
export default async function () { return null; }

export async function invokeTool({ tool, arguments: args, config, event }) {
  if (tool === 'lookup_order') {
    const order = config.orders?.[args.order_id];
    return order ? { found: true, ...order } : { found: false };
  }
  throw new Error('Unknown tool');
}
```

示例可使用 `examples/agent-tool-plugin.mjs`，在配置中填写 `{"orders":{"A01":{"status":"已发货"}}}`。保存后设置允许的好友或群聊，再启用插件；向机器人发送“查一下 A01 订单”。模型收到的实际工具名有插件编号前缀，可以在工作台查看并复制到人格工具范围。

工具调用不按消息触发前缀筛选，但仍检查插件启用状态、版本、会话范围和群 @ 规则。每个插件最多 8 个工具，名称最多 32 个 ASCII 字符。参数采用有限 JSON Schema：支持 object、array、string、number、integer、boolean、null，以及 properties、required、additionalProperties:false、items、enum、minimum / maximum、minLength / maxLength、minItems / maxItems、description。嵌套最多 6 层；不支持 `$ref`、pattern、oneOf 等结构，未知关键字会在保存时拒绝。

工具使用原有独立线程、资源限制、并发与执行超时；总执行取消会终止插件线程。插件拥有原有的本机 Node.js 权限，线程不是权限沙箱。工具结果必须可序列化为 JSON，最多 30 KB；不要返回凭据或无关私人数据。`effect:read` 只能用于无副作用查询；默认 `write`。插件导入、导出继续携带完整工具定义和配置。

## 执行与恢复

每个任务默认最多 8 次模型请求、16 次工具调用、300 秒执行时间，单次模型请求还受 `AI_TIMEOUT_MS` 约束。每批最多顺序执行 4 个工具，所有函数名和 JSON 参数先校验，再开始调用。

写入工具在执行前记录持久化凭据：同一任务、相同参数会复用先前结果；同一工具换参数再次写入会被拒绝。内置本机工具按独立 `operation_id` 记录每次操作，可连续多步；同一编号不能改变参数。进程在调用期间中断时标为结果未知，不自动重做。自定义写入插件也应使用自己的请求防重机制，因为本地记录不能与远端操作组成跨系统事务。只读查询可以重新查询，以反映任务内的最新变化。

Agent 运行状态表示“生成 / 工具处理”的状态；QQ 是否真正发送成功，继续以任务队列和原有发送确认机制为准。工作台执行记录只保存模型请求、工具名称、状态、耗时，不保存私密思维链。工具结果的写入防重缓存保存在本地数据库，随关联任务清理。日志不增加消息正文或工具返回内容。

新增表使用 `CREATE TABLE IF NOT EXISTS`，任务表只补充 `channel` 列并默认原记录为 QQ；不重建原数据库。未修改既有 `.env`、账号会话、图库、音色、插件配置或 QQ 运行目录。

## 管理接口

均使用原有独立管理员 Bearer Token；OneBot Token 无权访问。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /admin/agent` | 人格、会话、工具目录和最近执行 |
| `POST /admin/agent/chat` | `{text, session?}` 提交网页任务，返回会话及任务编号 |
| `GET /admin/agent/chat?session=...` | 最近 20 条网页任务 |
| `POST /admin/agent/persona` | `{id?, revision?, name, prompt, tools:null或数组}` |
| `POST /admin/agent/persona/delete` | `{id, revision}` |
| `POST /admin/agent/bind` | `{conversation, persona}`，空人格恢复默认 |
| `POST /admin/agent/reset` | `{conversation}` 清空上下文 |
| `GET /admin/agent/memories?conversation=...` | 读取会话记忆 |
| `POST /admin/agent/forget` | `{scope, key}` 删除记忆 |
| `GET /admin/jobs/:id` | 原有任务详情增加 `agent_steps` |

本机工作台代理这些接口，保留原有 Origin 检查与凭据隔离。网页接口的随机路径和管理员凭据不会作为模型工具提供。
