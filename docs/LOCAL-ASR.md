# 轻量本地语音转写

本项目已配置 SenseVoiceSmall INT8 + sherpa-onnx 的本地 CPU 服务，接入视频理解插件。模型、Python 环境和配置位于 `runtime/asr`，不修改系统 Python，不录制麦克风，也不向外部服务上传待识别音频。

## 当前配置

| 项目 | 配置 |
| --- | --- |
| 模型 | `sensevoice-small-int8` |
| 推理 | CPU，2 个推理线程，Windows 低于普通优先级 |
| 调度 | 单任务串行，最多额外排队 1 个请求 |
| 静音处理 | Silero VAD 跳过静音，语音段前后保留少量上下文 |
| 输入 | 单声道 16 kHz PCM16 WAV，最长 120 秒 |
| 接口 | `http://127.0.0.1:8766/v1/audio/transcriptions` |
| 权限 | 只监听本机，独立随机 Bearer Token，不允许浏览器跨域请求 |
| 加载方式 | 第一次有人声的请求加载识别模型；空闲 300 秒终止模型工作进程树，释放模型内存 |

HTTP 主进程保持轻量；VAD 与识别在独立工作进程中运行。Windows 的虚拟环境可能包含 Python 重定向父进程，因此卸载时终止整棵自有工作进程树，并检查真实识别进程已经退出。服务不使用 GPU。

时间戳是 VAD 语音段的边界，带少量前后缓冲，**不是逐词强制对齐**。识别仍可能出现同音字或英文词错误，应按实际音频验收。

## 视频插件配置如何生效

已运行 `npm run asr:configure`。当前仍在运行的旧版机器人尚未加载视频插件类型，配置已保存为针对当前数据目录的一次性安装记录：`runtime/asr/video-setup.pending.json`。

**完整退出旧机器人进程，再运行 `npm run launch` 或 `start.cmd`。** 新版启动时自动安装并配置视频理解插件，使用本地服务及独立 Key；新装插件只开放已认证网页入口，不自动扩展到 QQ 好友或群。已有视频插件保留原来的启停状态、QQ 范围、目录和抽帧设置。安装记录成功应用后改名为 `video-setup.applied.json`，后续启动不会覆盖手动修改。

插件使用对应本地服务时，机器人启动会检查并按需启动该服务。后台服务独立运行；关闭机器人后，可用下列命令停止或卸载。

```powershell
npm run asr:status       # 状态、实际进程内存与最近一次耗时，不返回识别正文或密钥
npm run asr:start        # 启动或复用本地服务，默认不加载大模型
npm run asr:unload       # 立即释放空闲识别进程，保留 HTTP 服务
npm run asr:stop         # 停止本地服务；繁忙时会明确拒绝
npm run asr:configure    # 配置视频插件；旧服务则保存为下次完整启动时应用
npm run asr:check        # 使用公开中英文样本验证本地识别及真实视频插件链路
```

配置文件 `runtime/asr/settings.json` 中包含本地 Key，请勿分享。它与视频插件导出遵循现有明文配置约定。`threads` 可调为 1 或 2；`idle_seconds` 可设为 1–3600 秒。修改服务设置后先停止再启动 ASR；不要改动端口或 Key 后遗漏运行 `asr:configure`。

## 本机试跑结果

在 Ryzen 5 5600、16 GB 内存电脑上，用模型发布者附带的公开语音样本测得：

| 测试 | 音频长度 | HTTP 总耗时 |
| --- | --- | --- |
| 中文首次请求，含加载 | 5.592 秒 | 约 2.10 秒 |
| 中文模型已加载 | 5.592 秒 | 约 0.22 秒 |
| 英文模型已加载 | 7.152 秒 | 约 0.27 秒 |

识别进程工作集约 365 MiB；主动卸载后识别进程已退出，服务主进程工作集约 27 MiB。首次请求、不同音频、后台负载和长视频的占用可能不同；这些是此机样本实测，不能当作所有视频的性能保证。

中文样本输出：`开放时间早上9点至下午5点。` 英文样本能识别主要句子，但测试中出现过 `gold` / `code` 的词语差异。2 秒纯静音返回空文字，没有调用识别模型生成对白。

已验证真实视频中的音轨经过 FFmpeg 提取后，能调用本地服务，并由 `video_transcript` 返回文字及 VAD 时间边界。报告：`dist/asr-check/report.json`。测试只使用公开样本，不使用用户的聊天录音。Windows 中文 JSON 管道已显式设为 UTF-8，避免系统 ANSI 编码损坏识别结果。

## 文件与可复现安装

- 模型：`runtime/asr/models/sensevoice/model.int8.onnx`，239233841 字节。
- 词表、许可与公开样本：`runtime/asr/models/sensevoice/`。
- Silero VAD：`runtime/asr/models/silero_vad.onnx`。
- 独立环境：`runtime/asr/venv/`。
- 服务实现：`plugins/video/asr/server.py`，控制与插件配置：`plugins/video/asr/local.mjs`。

SenseVoice 模型来自[发布者的模型仓库](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17)，已与其 LFS SHA-256 核对：`c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51`。推理方法依据 [sherpa-onnx 官方示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/offline-sense-voice-ctc-decode-files.py)，VAD 分段依据[官方字幕示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/generate-subtitles.py)。

当前依赖锁定为 `sherpa-onnx==2.0.1`、`sherpa-onnx-core==2.0.1`、`numpy==2.5.4`。源码导出不包含运行时和模型；新电脑需准备 Python 3.12 后执行：

```powershell
py -3.12 -m venv runtime/asr/venv
./runtime/asr/venv/Scripts/python.exe -m pip install sherpa-onnx==2.0.1 numpy==2.5.4
./runtime/asr/venv/Scripts/python.exe scripts/asr-download.py
npm run asr:start
npm run asr:configure
npm run asr:check
```

下载脚本使用发布者提供的模型文件与哈希，并按 HTTP Range 分块重试，避免大文件连接中断产生看似下载完成的损坏文件。不会执行模型仓库中的 Python 脚本。

验证命令：

497 / 497 全项目 JavaScript 测试通过（`dist/asr-full-tests.json`），另有 4 项 Python 单元测试通过，覆盖 WAV / multipart 限制、空闲清理及 Windows 工作进程树释放。真实识别与视频链路报告为 `dist/asr-check/report.json`。

```powershell
./runtime/asr/venv/Scripts/python.exe -m unittest test/local_asr_test.py
node scripts/test.mjs test/local-asr.test.mjs test/video.test.mjs
```
