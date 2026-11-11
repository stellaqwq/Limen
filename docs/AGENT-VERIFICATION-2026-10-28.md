# Agent 改造验收记录

日期：2026-10-28（Asia/Shanghai）。运行环境：Windows、Node.js 24.20.0。

## 已完成

- 原始版本基线：279 项自动化测试通过。
- 改造后完整回归：292 项测试通过，0 失败、0 取消、0 跳过。覆盖原有登录、OneBot、QQ 内核模拟、图片、语音、表情、空间、插件、队列、隐私和恢复，以及新增 Agent。
- 新增测试覆盖多步工具任务、真实插件线程调用、JSON Schema 参数验证、人格限制、会话上下文重置、记忆隔离、持久化写入防重、未知结果阻断、发布权限和意图识别、工具预算、取消、管理接口鉴权、网页离线试聊、旧 AI 模式和保留周期。
- JavaScript 模块语法检查通过。
- 原有 Web 管理台 75 项浏览器检查通过，覆盖 1440 / 1024 / 768 / 680 / 390 / 320 像素。
- Agent 工作台 13 项浏览器检查通过，覆盖 1440 / 768 / 390 / 320 像素。验证试聊、工具完成后的记忆自动刷新、人格创建与绑定、会话隔离、执行详情及插件工具编辑器。没有 JavaScript 或 CSP 错误。
- 独立界面复核结论：`ship`。

测试日志在 `dist/agent-all-tests.log`、`dist/agent-browser.log`、`dist/agent-legacy-web.log` 和 `dist/agent-syntax.log`。结构化报告为 `dist/test-results.json`、`.impeccable/review/agent-qa.json` 和 `.impeccable/review/web-qa.json`。

## 验收边界

本轮使用独立临时 SQLite 数据、模拟 QQ 驱动、测试模型响应和无头 Chrome。没有使用真实账号发消息、发布空间或向用户实际模型服务提交请求。因此不能把这些结果视作新 Agent 组合功能的实机验收；既有功能的历史实机记录仍以 README 和各模块文档为准。

未修改 `.env`、既有账号数据、插件配置、图库或 QQ 运行目录。原始源码备份在 `dist/agent-before`，不包含真实 `.env`、会话或媒体数据。数据库新增表和 `jobs.channel` 列会在下次实际启动时增量创建，保留旧记录。

已有后台服务需要先在其启动窗口正常退出，再运行 `npm run launch` 加载新代码。模型应支持兼容 Chat Completions 的函数工具调用；不支持时，可关闭 `AGENT_ENABLED` 使用原有 AI 流程。
