# Chat Plus 与 AstrBot 插件管理拆解

研究日期：2026-10-28。当前项目为 JavaScript / Node.js，自行实现适合现有驱动与 Agent 的能力；参考上游的配置与管理机制，没有直接运行其 Python 插件。

## 参考了哪些源码

- [Chat Plus 配置定义](https://github.com/Him666233/astrbot_plugin_group_chat_plus/blob/main/_conf_schema.json)：去除分隔标题后有 339 个配置项，包含独立 Web 服务、安全、群聊与私聊的多套设置，不能将所有项都算成群聊回复参数。
- [Chat Plus Web 服务](https://github.com/Him666233/astrbot_plugin_group_chat_plus/blob/main/web/server.py)：配置读取 / 保存 / 重载，会话列表、注意力、情绪、概率与主动聊天状态，图片缓存和聊天历史管理，以及独立认证、安全与文件管理路由。
- [Chat Plus 配置参考](https://github.com/Him666233/astrbot_plugin_group_chat_plus/blob/main/docs/CONFIG_REFERENCE.md)：概率与密度、窗口合并、注意力、情绪、主动聊天、识图、输出与过滤的行为定义。
- [AstrBot 插件管理器](https://github.com/AstrBotDevs/AstrBot/blob/master/astrbot/core/star/star_manager.py)：元数据、配置 Schema、导入与依赖检查、加载失败记录、initialize / terminate、重载时清理旧行为及工具。
- [AstrBot 插件配置文档](https://github.com/AstrBotDevs/AstrBot/blob/master/docs/zh/dev/star/guides/plugin-config.md)：配置声明驱动表单，默认值合并，类型、分组、提示、选项与嵌套对象。
- [AstrBot 插件管理文档](https://docs.astrbot.app/use/plugin.html)及 [ExtensionPage.vue](https://github.com/AstrBotDevs/AstrBot/blob/master/dashboard/src/views/ExtensionPage.vue)：安装、更新、重载、启停、失败恢复与指令 / 工具的管理入口。

## 原版为什么需要专门面板

原版不仅保存插件参数，还观察多个群的动态状态。配置回答“应该怎样参与”，运行数据回答“这次为什么沉默、在关注谁、今天主动聊了几次”。两类数据有不同保存方式与刷新周期。只有一个 JSON 编辑框无法很好地完成这些任务。

本项目原有实现有群聊参与逻辑，但大量参数写在 JSON 或代码常量里，缺少状态与配置的管理层。这次将它们分别接到配置表单、每群设置和运行管理接口。

## 本次实现

| 上游机制 | 当前项目落地 |
| --- | --- |
| 专门的 Web 管理面板 | 侧栏“群聊增强”独立页面，复用本机工作台的认证；不另开端口或维护第二份登录 |
| 大量分类配置 | 60 个实际生效参数，按参与概率、读空气、注意力与情绪、触发过滤、主动聊天、安静时段、图片描述、回复输出分为 8 组 |
| 会话状态可视化 | 查看群参与状态、概率和最近原因、主动聊天配额及无人回应次数；状态页每 10 秒刷新 |
| 细粒度管理 | 每群暂停 / 恢复、临时概率与继承、独立参数覆盖、注意力与情绪、短期上下文查看与对话重置 |
| 图片缓存管理 | 按群查看模型、时间、描述，单条删除或清空；时限与数量按群生效 |
| Schema 驱动配置 | 插件包可声明 config_schema，支持 string / text / bool / int / float / list / object；支持 default / description / hint / group / options / slider / secret |
| 生命周期操作 | 列表提供重载，校验定义并取消旧执行、更新修订号；保留配置、会话范围与启停状态 |
| 行为查看 | 查看消息处理入口、内置指令及 Agent 工具参数与读写属性 |
| 插件更新 | 从文件载入更新草稿，保留原配置、会话范围与启停状态，保存前可检查；更新包的新默认配置补到旧配置中 |
| 安装入口 | 内置插件“安装或打开”，普通 JavaScript JSON 包导入；首次安装仍默认停用 |

群专属配置持久保存在 group_chat_overrides，优先于全局默认；/new 与对话重置保留这些设置。每次覆盖变更都有独立修订号，过期窗口不能覆盖新设置；旧排队回复授权失效，生成任务可被取消。

情绪措辞、兴趣词增量、密度惩罚、低信息倍率、判断置信度、重复检查窗口、无人回应上限均从固定代码改为真实配置，不添加没有执行逻辑的占位开关。

## 仍有区别的部分

原版独立服务的公网监听、IP 管理、独立密码和任意文件编辑器没有引入：本项目沿用已存在的本机管理台与管理员边界。AstrBot 的 Python 插件、依赖安装器和插件市场需要 AstrBot 自己的运行时；这里的 Schema 支持也只是兼容其中的一个有限子集，不代表整个插件包兼容。

戳一戳、合并转发、入群欢迎事件、LivingMemory 专用集成、动态时段概率、拟人错别字、频率自适应等原版扩展尚未全部实现；部分还依赖当前 QQ 驱动未提供的事件与动作。群聊长期记忆继续由现有 Agent 记忆系统管理，不另建不互通的一套记忆。

当前脚本插件每次执行是一个新线程，不能照搬 Python 对象的 initialize / terminate 和常驻全局状态。这里的“重载”不下载版本；内置执行层或项目源码升级仍须退出旧进程后重新启动。导入与“从文件更新”接受本项目 JavaScript JSON 包，尚不提供下载并安装任意 GitHub Python 仓库的功能。

## 验证方式

后端回归覆盖 Schema 默认值与约束、原功能兼容、认证、群隔离、覆盖继承与冲突、旧任务授权失效及重启持久化。浏览器脚本 scripts/group-chat-web-qa.mjs 覆盖表单实际保存、每群管理、缓存清理、插件重载和文件更新，并在 1440 / 1024 / 768 / 680 / 390 / 320 宽度验收。原有 scripts/plugin-web-qa.mjs 继续验证脚本插件与 VoiceStudio。

最终全项目回归 383 / 383 通过，报告 dist/plugin-management-full-tests.json；两套浏览器验收通过且无 JavaScript / CSP 错误。旧群聊增强的一处概率相关测试改为固定随机输入，以直接验证触发旁路，避免随机失败；网络重连用例发生过一次超时，单独复核及最终全量均通过。
