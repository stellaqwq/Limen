# 视频理解插件 v2

参考 [dsh-video-storyboard-hp](https://github.com/DSH-Raising-Plan/dsh-video-storyboard-hp/tree/feature/high-performance) 的“分镜宫格 → 局部回看”方法，为Limen内置插件接口重新实现。多个带格号、实际时间戳的画面拼成一张图，让当前聊天模型先看结构，再回看细节。模型需要支持**图片输入和工具调用**，不要求原生视频输入。

## 安装与启用

1. 完全退出并重新打开 `Limen.exe`，加载更新的执行层。
2. 在“插件 → 插件概览 → 视频理解”安装并配置。首次安装默认停用；已有 v1 插件重启后自动获得五个工具和新增配置，保留启停、范围、目录及 ASR 参数。
3. 按需开启“允许网页测试对话”。QQ 使用时配置允许的好友 / 群，仍遵循 AI 白名单和群 @ 要求。
4. 此安装目录已准备配套 FFmpeg / FFprobe，路径留空自动从 `resources/app/runtime/video-tools/bin` 查找，其次查工作目录及 PATH。
5. 保存并启用。人格若只允许部分工具，还需允许新增的 `video_storyboard` 和 `video_zoom`，实际名称带插件编号前缀。

在 `resources/app` 目录运行 `node scripts/video-plugin.mjs`，导出 `dist/video-analysis.plugin.json`。此文件为内置插件的配置与工具声明，依赖更新后的Limen执行层，不能单独导入旧版程序或其他框架；模板不含个人密钥。

## 发送视频

- 网页：在“测试对话”附加 MP4、M4V、MOV、WebM、MKV 或 AVI，可同时提问：“先看分镜，再回看人物拿起物品的片段；有转写服务时参考对白。”
- 本地：提供允许目录中的视频路径。相对路径基于第一个允许目录，默认 `./workspace`；本地文件默认上限 100 MiB。
- QQ：把视频**作为文件发送**，使用现有文件接收和当前消息的受管缓存。原生短视频气泡的自动下载尚未接入。

每条网页 / QQ 附件最多四个、合计 10 MiB，较大视频使用允许目录。附件仅属于当前任务，后续任务回看需重新附加。不下载任意网址，不接受网络共享、设备路径或逃逸允许目录的符号链接。

## 五个工具

| 工具 | 用法 |
| --- | --- |
| `video_info` | 查询时长、显示尺寸、帧率、音轨和转写配置；不代表已观看 |
| `video_storyboard` | 优先看结构。可选 `source`、`start_seconds`、`end_seconds`、`cells`（1–16）、`transcript`（`off` / `auto`）；返回一张带编号和实际时间的宫格及每格时间范围 |
| `video_zoom` | 必须给出起止秒数；默认四格，最多九格，以较大画面回看细节；参考宫格中的时间范围 |
| `video_frames` | 保留多张逐帧图片，支持间隔与数量；默认最多八张、间隔五秒 |
| `video_transcript` | 提取指定时间段音轨，调用独立配置的识别服务，返回正文及服务提供的时间戳 |

上传视频后可省略 `source`。默认视频时长上限两小时、每个窗口最多 120 秒；长视频按 `next_start_seconds` 继续。宫格按时间分布覆盖**当前窗口**，每格只显示一个时刻，不表示逐帧观看或看到全部镜头。顺序观看时按窗口推进，避免提前查看后续剧情。

示例：先调用 `video_storyboard`，参数为 `{"start_seconds":0,"end_seconds":60,"cells":9,"transcript":"auto"}`；选取需要细看的格，再调用 `video_zoom`，例如 `{"start_seconds":12,"end_seconds":15,"cells":4}`。跨任务不能凭格号读取旧附件。

## 画面与音量

执行层按分析、规划、渲染分工。分析最多读取 240 个 64×36 的采样点，用 HSV 差产生画面变化候选；音轨在本地计算音量包络。规划按时间分桶，保证每桶一格，桶内参考画面变化和声音突变。每格从附近三个候选中按 Laplacian 方差选较清晰的帧，再读取 FFmpeg `showinfo` 的实际解码时间。拼图使用内置像素字模，不依赖画布包、字体或外部视觉服务。

候选可能包含运镜，也可能遗漏快切；`sample_interval_seconds` 说明扫描粒度，`candidate_count` **不是镜头总数**。扫描失败明确降级为按时间覆盖，真实抽帧失败则报错。底部青色条表示音量，黄色刻度表示采样画面变化候选；它们不代表识别了对白、音乐、情绪或声源。无音轨时不绘制音量条。

宫格减少图片数量，实际视觉 token 由模型、图片尺寸和计费规则决定，不保证固定消耗或节省倍数。小字不清时减少格数、缩短窗口，用 `video_zoom` 或 `video_frames` 回看。竖屏保留比例，用黑边补齐；手机旋转元数据纳入显示尺寸。

## 对白转写

转写服务独立配置完整地址、Key、模型标识、语言、响应格式及超时，例如 `http://127.0.0.1:8000/v1/audio/transcriptions`。可使用 [本地 ASR 服务](LOCAL-ASR.md)；`verbose_json` 支持分段时间戳，只有普通正文的服务选择 `json`。

只有调用 `video_transcript`，或显式设置分镜 / 回看的 `transcript: "auto"`，才向该地址上传选定音轨。分镜默认 `off`，只计算本地音量。自动转写按最多 45 秒切片以减少长段漂移，尚未做静音切点对齐；时间偏移由执行层加回原视频起点，不按字数推算。

有时间戳的对白按重叠范围挂到对应格，每格最多 180 字。仅有正文时保留有界文本，标记 `text_without_timestamps`，不强行贴到格子。未配置、无音轨、转写失败分别标注，画面仍可分析。识别结果可能有误，不能声称直接听懂音频。Key 不复用聊天模型凭据；含个人配置的导出文件按项目原有明文存储约定自行保管。

## 缓存与验证

分析及转写只缓存在当前任务内，键包含任务、插件版本、文件路径、修改时间、大小和窗口。局部回看复用父窗口的变化候选和音量，仍重新提取图片。任务释放时清除；停用 / 更新插件取消执行，旧工具闭包失效。图片仅作临时模型输入，不存入 SQLite 工具回执；下一批替换上一批，换段前模型保留简短事实和时间摘要。

此安装已准备 [Gyan FFmpeg release essentials](https://www.gyan.dev/ffmpeg/builds/) 9.0.2，位于 `runtime/video-tools/bin`，许可证及 ZIP SHA-256 在上级目录。已验证发布 ZIP 的 SHA-256：`60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`。插件 JSON / 源码导出不含运行时二进制，其他安装需另行准备。

在 `resources/app` 运行：

```powershell
node scripts/test.mjs test/video.test.mjs test/video-storyboard.test.mjs test/local-asr.test.mjs
node scripts/video-storyboard-check.mjs
```

真实媒体报告位于 `dist/video-storyboard-check/report.json`：横屏九格合为一张约 135 KB JPEG、四格回看复用分析、竖屏及非零起始时间。预览为同目录的 `storyboard.jpg`、`zoom.jpg`、`portrait.jpg`。ASR 使用本地模拟 HTTP 服务，模型输入链路使用模拟模型；尚未使用用户配置的真实模型进行语义识别验收。
