# Limen 桌面版

## 使用 Windows 免安装版

完整解压 `Limen-Windows-x64-portable.zip` 或含内核的 `Limen-Windows-x64-with-QQ.zip`，双击文件夹内的 `Limen.exe`。不要单独移动 EXE；它依赖同目录的运行文件。应用已内置 Node.js，无须另外安装 Node.js。

含内核版已附带完整官方 QQ 程序运行文件，不需要另外安装 QQ。首次使用新配置时会自动创建本机内核宿主，进入 QQ 扫码登录；登录、账号、聊天数据保存在个人数据目录。随包内核仅包含程序文件，不含已有 QQ 登录会话。移动解压文件夹后，仍会从当前目录寻找随包内核。

普通版首次使用演示配置，切到真实 QQ 前需要先有官方运行时：默认由启动入口从 QQ 官方下载安装包并校验腾讯签名（需要已安装 7-Zip，首次会占用一次下载时间），下载失败时回退到本机已安装的 QQ；也可以把 `QQ_RUNTIME_SOURCE` 设为 `local` 直接复制本机安装。在“配置文件 → AI 与回复”填写模型地址和模型标识、在“QQ 与运行时”确认 `kernel` 驱动，保存并重启生效。已有演示配置升级到含内核版后，也可将 QQ 驱动改为 `kernel` 并重启。抖音网页功能需要 Chrome；视频转码和语音识别仍需各自的 FFmpeg / ASR 服务，模型使用你配置的外部或本机服务。

界面按「配置文件 / 服务提供商 / 平台与机器人 / 插件与扩展 / 工作台 / 对话测试 / 数据与日志 / QQ 空间 / 系统设置」组织。配置文件是首屏，消息、任务与日志合并在“数据与日志”三个标签里；每个插件有概览 / 配置 / 事件三个页签。页面不包含演示夹具，所有读数来自正在运行的服务；接口失败会显示错误与重试。

菜单“Limen → 打开数据目录”可查看当前配置和数据。默认保存在 `%APPDATA%\Limen\workspace`（以菜单实际打开位置为准）。关闭应用会关闭它启动的后台服务；若复用了已有服务，只关闭本窗口的管理连接。

应用包和源码包不含个人 `.env`、聊天数据库、登录会话、抖音浏览器数据、模型文件。迁移个人配置时请自行保管整个工作目录。

QQ 驱动启动使用独立的 `QQ_STARTUP_TIMEOUT_MS`，默认90秒，用于运行文件校验和内核加载；普通请求仍按 `QQ_RPC_TIMEOUT_MS`，默认15秒。启动失败时，工作目录中的 `desktop-startup-error.json` 记录错误阶段；官方内核数据目录中另有 `host-stderr.log`。切换新版前需完全退出旧版和旧后台，避免复用旧服务。

## 复用本机已有项目

通过快捷方式的目标参数指定已有项目的绝对路径，例如：

```powershell
.\Limen.exe --workspace="D:\Projects\Limen"
```

该目录的 `.env`、`data`、`runtime` 会直接复用。若同一后台已在运行，将复用它；保存需要重启的配置时，需重启原后台。不要同时对同一工作目录启动多个不同版本的后台。

`Limen.exe --demo` 使用退出时删除的临时演示数据，不连接真实 QQ。

## 源码开发与重新打包

需要 Windows x64、Node.js 24+、npm 和 7-Zip（仅用于打包）。7-Zip 默认位于 `C:\Program Files\7-Zip\7z.exe`，也可通过 `LIMEN_7ZIP` 指定路径（旧名 `XUQIAO_7ZIP` 仍然有效）。在源码目录执行：

```powershell
npm ci
npm install --save-dev electron@45.2.1 @electron/packager
npm run desktop:dev
npm run desktop:build
```

源码包只带运行时依赖，打包工具需要按上一行单独安装一次；`electron` 版本必须与便携版保持一致，否则 `desktop:build` 会找不到 Electron 版本。

打包含内核版可指定经过 `qq:prepare` 准备的官方程序运行时（只复制清单内的原始程序文件）：

```powershell
npm run desktop:build -- "C:\Packages\Limen-with-QQ" --qq-runtime="D:\Projects\Limen\runtime\qq"
```

`desktop:dev` 用独立演示数据打开原生窗口。正式打包输出在 `dist/desktop-时间戳/`，包括源码目录、便携版目录、两个 ZIP 及 SHA-256 清单。下载依赖、Electron 和 Node.js 许可证需要联网。

**含内核包只能自用，不要公开分发。** 它把官方 QQ 程序文件与 `wrapper.node` 复制进了发行目录，这些是腾讯的版权软件；上传到 GitHub Release、网盘或下载站都属于分发腾讯软件副本，与项目的许可条款冲突（见 [法律与合规说明](LEGAL.md)）。要分享给别人，请只发不含 QQ 程序的便携版或源码包，让使用者首次启动时自行从官网下载。

桌面程序使用隔离的 Electron 渲染进程；机器人在独立内置 Node.js 进程运行，以兼容 SQLite 与 QQ 原生模块。发布包目前没有 Windows 代码签名。
