# 调整 LoRA 强度

ComfyUI 生图插件 2.2.0 支持模型调整已配置 API 工作流中的 LoRA 强度。先调用 `comfyui_status`，从 `workflow_loras` 获取节点编号、文件名称、模型强度和可用的 CLIP 强度，再在 `comfyui_generate` 中传入：

```json
{
  "prompt": "a watercolor landscape",
  "use_workflow": true,
  "loras": [
    {"node_id": "4", "strength_model": 0.5},
    {"node_id": "6", "strength_model": 0.8, "strength_clip": 0.9}
  ]
}
```

可以直接对模型说：“这次画图把 Q 版 LoRA 强度调到 0.5，其他不变。”模型会查询实际节点后设置参数。

强度允许 -100 到 100，支持 0 和小数；通常在 0–1 内调整。只覆盖指定值，省略的 LoRA 和强度保留工作流默认。变更仅作用于本次提交，不修改保存的工作流。支持标准 `LoraLoader`、`LoraLoaderModelOnly` 以及采用相同数值输入结构的 LoRA 节点；不支持的节点会报错，不会静默忽略。

批量任务可在根级设置 `loras` 作为默认值，或在每项 `requests` 中分别设置；每项列表完整替代根级列表。全部任务验证通过后才开始提交。此功能调整现有节点，不添加或更换 LoRA；基础流程没有 LoRA 时请使用已配置的工作流。
