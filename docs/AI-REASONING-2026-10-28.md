# 保留 high 的推理无正文修复

用户要求保留 `AI_REASONING_EFFORT=high`。本次没有关闭推理或把推理文本作为回复发送。

## 诊断范围

任务 7815 的历史日志为 `ai_reasoning_only`，耗时 3135 ms，低于当时 100000 ms 的请求超时。只读查询确认任务为 failed，生成尝试 1 次，发送 0 次，没有保存回复。本次未读取或重放原消息，也未重新入队该任务。

旧 AIClient 丢弃 `finish_reason` 和 usage，无法从旧日志判断该次请求是生成上限、模型提前结束还是其他模型行为。不能把后续独立测试的结果当作任务 7815 的确切结束原因。

用独立问候测试本机 Qwen3.5-9b，并只记录长度和数字元数据：

| 测试 | 结果 |
| --- | --- |
| high、max_tokens=512，流式诊断 | 约 10.8 秒；finish_reason=length，512 个生成 Token 全为推理，正文为 0 |
| high、max_tokens=4096，temperature=1、top_p=0.95、presence_penalty=1.5 | 约 19 秒；finish_reason=stop，902 个推理 Token，取得非空正文 |
| 修复后的非流式 AIClient，当前保存的系统提示词与配置 | 约 61.5 秒；正文非空，未发送 QQ |
| 修复后的 AIClient，强制调用一次无副作用的加法测试工具，再生成正文 | 约 5.8 秒；工具恰好执行一次，正文非空，未发送 QQ |

实际模型测试结果保存在 `dist/reasoning-high-live-results.json`，仅包含耗时、字符数、调用数和参数，不含推理或回复正文。

## 改动

- 新增 `AI_MAX_OUTPUT_TOKENS`，请求映射到 `max_tokens`，包含推理和正文；0 不发送该参数。它与只限制最终发送字符数的 `AI_MAX_REPLY_CHARS` 不同。
- 新增可选 `AI_TEMPERATURE`、`AI_TOP_P`、`AI_PRESENCE_PENALTY`，支持小数并校验范围。留空不覆盖服务默认值；管理台“AI 与回复”可修改。
- 当前本机配置保存为 high、16384 个生成 Token、temperature=1、top_p=0.95、presence_penalty=1.5，请求超时 240000 ms。Agent 总预算仍为 300000 ms。没有修改 LM Studio 的全局配置。
- 只有推理的响应进入原有任务队列有限重试，仍受 `AI_MAX_ATTEMPTS` 控制；当前为最多 3 次生成尝试。标记为 content_filter 的响应不重试。
- 保留并安全记录 `finish_reason`、`prompt_tokens`、`completion_tokens`、`reasoning_tokens`。结束原因只接受固定枚举，Token 数只接受非负安全整数；不记录服务错误正文、凭据、提示词或推理文本。
- 最终发送仍要求非空 `message.content`；推理不写入回复、聊天上下文或发送内容。

采样依据：[Qwen3.5-9B 官方模型说明](https://huggingface.co/Qwen/Qwen3.5-9B/blob/main/README.md) 的通用推理建议；本次覆盖其中三个兼容采样参数，未覆盖 top_k。生成额度参数见 [LM Studio Chat Completions 文档](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)。这些参数改善已验证的独立测试，不保证任何复杂任务都会在预算内完成；以后无正文时可从新增的结束原因与 Token 元数据继续判断。

## 验证与生效

49 项针对性回归通过；完整 302 项回归全部通过，失败、取消、跳过、待办均为 0；全部 JavaScript 语法检查通过。完整报告为 `dist/reasoning-high-all-results.json`。

回归覆盖 high 与采样参数传递、不改写提示词、默认参数不覆盖服务行为、设置原子校验、推理失败有限重试、成功后仅发送一次、推理不进入上下文或日志，以及原有 Agent 和 VoiceStudio 功能。

关闭原来的启动窗口，再运行项目根目录 `start.cmd`，使整个 Node 进程重新载入代码。仅在网页中重建服务实例不能刷新已经缓存的 JavaScript 模块。高强度推理的回复可能需要几十秒，当前模型测试普通问候约 61 秒。

修改前源码与本地配置备份位于 `dist/reasoning-high-before`。其中 `.env` 含本机密钥，不应分享或提交。任务 7815 保持原状态；重启后使用新消息验收 QQ 实际回复。
