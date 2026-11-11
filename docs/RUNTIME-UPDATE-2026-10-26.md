# 2026-10-26 运行库升级与兼容性记录

## 版本与来源

| 项目 | 升级前 | 升级后 |
| --- | --- | --- |
| Node.js（验证环境） | 24.20.0 / Windows x64 | 24.20.0 / Windows x64 |
| ws | 8.18.3 | 8.22.0，精确锁定版本 |
| silk-wasm | 3.7.1 | 3.7.1，官方 npm registry 确认仍为最新版 |
| QQ 官方运行时 | 9.9.27-45758 | 9.9.36-53644 |
| 宿主所需接口 | 98 | 99，已重新构建并验证 |
| getBuddyListV2 参数个数 | 3 | 3，现有版本检测已兼容 |

`package-lock.json` 使用 `registry.npmjs.org`，保留包的 SHA512 完整性校验。未更新系统 Node 安装。

官方来源：[ws 8.22.0 发布说明](https://github.com/websockets/ws/releases/tag/8.22.0)、[ws npm 元数据](https://registry.npmjs.org/ws/latest)、[silk-wasm npm 元数据](https://registry.npmjs.org/silk-wasm/latest)、[QQ 官网发布配置](https://qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json)。

QQ 官网 Windows 发布版本为 9.9.36，更新日期 2026-09-24。使用 x64 安装包 `QQ_9.9.36_260924_x64_01.exe`，大小 330446512 字节；未执行安装器。

- Authenticode：`Valid`，签名主体为 Tencent Technology (Shenzhen) Company Limited。
- 安装包 SHA256：`63255c70c7ff523e7eed7d52d9708ed7a77ea346ece6474c65dded406edb3155`。
- QQ SDK 应用标识：`537391628`，从当前官方 `major.node` 提取。
- 官方 `wrapper.node` 未修改；桥接针对当前 Node 和项目最终路径重新生成。

## 已完成验证

| 验证项 | 结果 |
| --- | --- |
| 升级前基线 | 231 / 231 通过，失败、取消、跳过、待办均为 0 |
| 按锁文件重新安装 | `npm ci --ignore-scripts` 成功 |
| 依赖审计 | npm 审计 0 漏洞 |
| 全部 JavaScript 语法检查 | 通过 |
| 升级后完整回归 | 231 / 231 通过，失败、取消、跳过、待办均为 0 |
| 模拟端到端链路 | 消息 → 模拟 AI → 回复完成 |
| QQ 文件与桥接完整性 | 所有清单文件、Node、wrapper、major 和桥接哈希校验通过 |
| 真实 QQ 内核 | 在全新临时数据目录中加载成功 |
| 真实登录服务器 | 返回有效 PNG 二维码；轮询状态为 `waiting_scan`，账号为 0 |
| 正常停机 | QQ 宿主退出码 0；临时数据已清理 |

测试包含 HTTP、WebSocket、反向 WS、认证隔离、SQLite、队列、内核状态机、图片及真实 SILK/WASM 编解码等现有回归。最初沙箱内基线受到临时文件重命名权限限制；在允许所需文件操作的环境重跑后基线与升级版本均全部通过。

本轮没有扫描二维码，没有读取或修改既有账号数据，没有向真实 QQ 联系人发送消息。扫码认证、真实文本/图片/语音收发、好友群列表和长期重连未在本轮重新验收；2026-10-24 的同版本历史实机结果见 [KERNEL.md](KERNEL.md)，不能将本轮二维码验证等同于这些功能的新验收。

## 复现

在项目根目录运行：

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run demo
npm run qq:check
npm run qq:check -- --qr --report dist/qq-runtime-check.json
```

`qq:check` 默认只做本地完整性和版本接口检查；`--qr` 会连接 QQ 登录服务器，但始终使用新生成的临时设备和数据目录，不使用 `.env` 中的账号、内核数据目录或接口密钥。它不打印或保存二维码，结束时关闭宿主并清理临时数据。报告明确保留认证和真实收发为 `false`。

## 切换与回退

当前 `.env` 的 `QQ_RUNTIME_DIR` 和 `QQ_KERNEL_DIR` 指向 `./runtime/qq-9.9.36` 与 `./runtime/kernel-9.9.36`。原来的 `runtime/qq`、`runtime/kernel` 和账号数据保留。

升级前的配置、依赖及本次改动文件保存在项目的 `dist/runtime-update-backup-20261026`。停止服务后，可用下列命令恢复升级前文件和依赖；回退不会删除新版运行时或账号数据：

```powershell
node dist/runtime-update-backup-20261026/rollback.mjs
```

备份中的 `.env` 含有原有密钥，保存在本机；分享代码请使用 `npm run source:export`，不要分享 `dist` 备份目录。
