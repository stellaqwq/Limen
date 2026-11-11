# GPT-SoVITS / AstrBot 语音发送

内核驱动支持 OneBot `record` 语音消息段。私聊和群聊使用现有 `send_private_msg`、`send_group_msg`，`can_send_record` 返回 `yes: true`。AI 可调用 AstrBot GPT-SoVITS 插件的 `gsv_tts` 工具：插件合成音频后发送 record，本项目读取音频、转成 QQ SILK、提交给官方内核，等待匹配消息与会话的终态回执。

当前已完成真实 WAV/SILK 编解码及模拟 SDK / HTTP / WebSocket 回归，尚待当前 QQ 版本的真实账号收发验收。此功能是发送语音，不包含语音识别或 `get_record` 下载转换接口。

## 使用

1. 在项目目录安装或更新依赖：`npm install --ignore-scripts`。本次已为当前工作区安装 `silk-wasm` 固定版本，源码使用锁文件可通过 `npm ci --ignore-scripts` 复现。
2. 完整关闭机器人启动窗口，再运行 `start.cmd` 加载新增发送代码。运行中的旧进程不会因刷新网页加载新模块。
3. 在 AstrBot 的 GPT-SoVITS 插件配置中填写可访问的本机服务地址、模型与参考音频，开启插件。项目本身不启动或配置 GPT-SoVITS 模型服务。
4. 在 AstrBot 中使用 `说 你好，这是一条语音测试`，或让 AI 调用 `gsv_tts`。插件的自动语音转换也使用相同 record 链路。

本机安装的 `astrbot_plugin_GPT_SoVITS` v3.1.1 使用 `Record.fromFileSystem` 或 `Record.fromBase64`。两种输入均已覆盖；Base64 同时接受标准编码和插件使用的 URL-safe 编码。AstrBot 与 QQ 机器人在不同主机或容器时，需要发送 Base64 或可访问的 HTTP(S) 音频地址，远端本地路径不能被 QQ 主机读取。

## 输入与限制

- 支持 PCM WAV（8/16/24/32 位整数）、IEEE float WAV（32/64 位）和 SILK V3。WAV 自动混合声道、重采样至 24 kHz 单声道并编码为 Tencent SILK。
- MP3、OGG、FLAC 等压缩音频目前不直接支持；将 GPT-SoVITS 输出设为 WAV。该 WAV/SILK 路径不依赖 FFmpeg。
- `file` 接受本机绝对路径、`file://`、`base64://`、音频 data URL 或 HTTP(S)。HTTP 重定向最多 3 次，不接受 URL 用户名密码，不允许 HTTPS 降级至 HTTP。
- 一次发送一条独立语音；不把语音与文字、图片放在同一条 OneBot 消息链中。
- 输入大小使用 `MEDIA_MAX_BYTES`（默认 10 MiB），处理、下载和发送超时使用 `MEDIA_TIMEOUT_MS`（默认 90 秒），最长音频 300 秒。
- 编码在可终止的 Worker 中执行。音频缓存位于 `QQ_KERNEL_DATA/media-voice`，遵循 `MEDIA_CACHE_DAYS`；正在上传的文件不会被清理。界面消息和日志不保留 Base64 音频内容。

发送参数示例：

```json
{
  "user_id": 123456,
  "message": [
    {"type": "record", "data": {"file": "file:///D:/audio/test.wav"}}
  ]
}
```

`user_id` 替换为目标 QQ 号，路径替换为 QQ 主机上的实际 WAV。群聊使用 `send_group_msg` 和 `group_id`。

## 发送结果

接口只有在内核返回匹配会话与消息编号的成功终态后才返回 `message_id`。本地读取、转换、SDK 管理目录写入失败时不会继续提交。提交后连接中断或未收到确认，返回结果未知，不自动重发；应先在 QQ 核对。

原版 AstrBot 插件的语音工具不会经过项目内置 AI 文本回复队列。是否调用语音、调用频率和模型输出由 AstrBot 配置控制。

## 验证

```powershell
node scripts/test.mjs test/audio.test.mjs test/image.test.mjs
npm run check
```

回归覆盖真实 SILK 编码和解码、WAV 格式校验、文件/Base64/HTTP 输入、缓存路径、私聊与群聊 PTT、WebSocket 调用、终态确认及不确定发送处理。真实账号验收应从较短 WAV 开始，并在 QQ 手机端确认语音可播放。

协议研究参考：[QQNT PTT 字段定义](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-core/types/element.ts)、[silk-wasm 编码接口](https://github.com/idranme/silk-wasm)。本项目继续使用自研官方内核宿主，不安装或依赖其他 QQ 机器人框架。
