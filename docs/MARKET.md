# 插件市场

插件市场不是一台服务器，而是一份**静态 JSON 清单**：把 `index.json` 和若干 ZIP 丢到任意静态站点，本机控制台读清单、下载插件包、校验后交给既有安装器。没有账号、没有中心服务、没有数据库；不配置清单地址时整套功能不会发出任何网络请求。

便携包还可以**自带一份离线清单**（`resources/app/market/index.json` + `market/packages/*.zip`）：没配置清单地址时直接读包内清单，安装时优先用包内同名 ZIP（读取后仍按清单核对大小与 SHA-256，不匹配会拒绝并提示），全程离线。配置了清单地址则一切以远端为准，随包目录只是兜底快照。

同一份清单还承载**运行资源**（`assets`）：FFmpeg 这类上百 MB 的二进制不进插件包（插件包单文件 2 MiB、整包 24 MiB、上传 32 MiB 的限制保持不变），而是走独立通道装到 `runtime/` 下，与插件版本解耦——装一次，所有用到它的插件共用。

## 清单格式

```json
{
  "schema": 1,
  "name": "Limen 插件市场",
  "updated_at": "2026-11-10T09:00:00.000Z",
  "plugins": [
    {
      "id": "video",
      "kind": "video-analysis",
      "api": 1,
      "name": "视频理解",
      "version": "2.0.0",
      "description": "分镜宫格、局部回看与按需转写。",
      "capabilities": ["message"],
      "size": 184320,
      "sha256": "…64 位小写十六进制…",
      "url": "https://example.com/market/packages/video-2.0.0.zip",
      "homepage": "",
      "changelog": "修了抽帧顺序",
      "yanked": false
    }
  ],
  "assets": [
    {
      "id": "ffmpeg",
      "name": "FFmpeg 运行资源",
      "version": "9.0.2",
      "description": "视频理解的抽帧与转码依赖。",
      "install_to": "runtime/video-tools",
      "files": ["bin/ffmpeg.exe", "bin/ffprobe.exe"],
      "archive": "zip",
      "size": 110100480,
      "sha256": "…",
      "url": "https://example.com/market/assets/ffmpeg-9.0.2.zip"
    }
  ]
}
```

插件条目：`id`/`kind` 与 `plugin.json` 完全一致（`^[a-z0-9][a-z0-9-]{0,39}$`），`version` 为 `x.y.z`，`api` 必须为 `1`，`size` 与 `sha256` 必须对应真实的 ZIP 字节。`yanked: true` 表示作者撤回：清单里仍然显示，但拒绝安装。

资源条目：`install_to` 必须以 `runtime/` 开头且是安全的相对路径，`files` 是 ZIP 内的相对路径白名单（最多 64 个）；`archive: "file"` 表示下载内容本身就是目标文件（此时 `files` 只能有一个）。

清单整体上限 512 KiB，超过或格式不符会被拒绝，界面会列出被拒绝的条目及原因。

## 生成清单

```bash
npm run market:catalog -- --out dist/market --base-url https://example.com/market/
```

- 遍历 `plugins/`（跳过 `_` 开头的宿主目录、`node_modules`、点目录与符号链接），给每个包含合法 `plugin.json` 的插件生成 `packages/<id>-<version>.zip`，同时计算 `size`/`sha256`；
- 单文件超过 2 MiB 或解包超过 24 MiB 直接报错——安装器会拒绝这种包，不如在生成时暴露；
- 可用参数：`--plugins <目录>`、`--name <市场名>`、`--assets <描述文件.json>`。

资源描述文件里每一项可以写 `source`（本机文件，脚本复制到 `assets/` 并自动计算校验值），也可以直接写 `url`/`size`/`sha256` 引用已发布的文件：

```json
[{ "id": "ffmpeg", "name": "FFmpeg 运行资源", "version": "9.0.2",
   "install_to": "runtime/video-tools", "files": ["bin/ffmpeg.exe", "bin/ffprobe.exe"],
   "source": "D:/downloads/ffmpeg-9.0.2-win64.zip" }]
```

输出目录结构：

```
dist/market/
├── index.json
├── packages/video-2.0.0.zip
└── assets/ffmpeg-9.0.2.zip
```

把整个目录上传到静态站点即可。要求：**https**、不要给 ZIP 加登录或防盗链（下载走本机服务，不带浏览器 Cookie）。允许 302，最多 3 跳，但目标域名要放进“允许跳转的域名”——GitHub Release 就是这样。

## 配置

在“插件市场 → 市场设置”（即配置分区 `market`）填写：

| 设置项 | 环境变量 | 说明 |
| --- | --- | --- |
| 清单地址 | `MARKET_CATALOG_URL` | `index.json` 的完整地址；留空即关闭市场 |
| 允许的域名 | `MARKET_ALLOWED_HOSTS` | 逗号分隔；留空时只信任清单所在域名 |
| 允许跳转的域名 | `MARKET_REDIRECT_HOSTS` | 逗号分隔；留空时只放行 GitHub 资产域名，最多 3 跳 |
| 下载超时 | `MARKET_TIMEOUT_MS` | 默认 30000；资源下载至少给 600000 |
| 插件包上限 | `MARKET_MAX_PACKAGE_BYTES` | 默认 33554432，且不会超过安装器自身的 32 MiB |

这些设置都支持热更新，保存后无需重启。

官方清单地址填这一条即可（`允许的域名`、`允许跳转的域名` 都留空）：

```
https://raw.githubusercontent.com/stellaqwq/limen-plugin/main/market/index.json
```

## 放到 GitHub

官方市场仓库是 [`stellaqwq/limen-plugin`](https://github.com/stellaqwq/limen-plugin)，清单地址：

```
https://raw.githubusercontent.com/stellaqwq/limen-plugin/main/market/index.json
```

插件代码和清单可以就放在 GitHub 仓库里，只有大体积二进制不行。分三种地址：

| 内容 | 推荐位置 | 客户端怎么拿 |
| --- | --- | --- |
| `index.json` | 仓库 `market/` 目录 | `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/market/index.json`（直出 200，没有跳转） |
| 插件包（每个几十 KB） | 仓库 `market/packages/` | 同上，相对路径拼接 |
| FFmpeg 这类大文件 | Release 资产或对象存储 | `github.com/.../releases/download/...` 会 302 到 `release-assets.githubusercontent.com`，需要放开跳转 |

几个硬限制：

- 仓库单个文件 **100 MiB** 硬上限（超过 50 MiB 就会警告），FFmpeg 打包后约 200 MB 放不进代码仓库；
- Release 单资产上限 2 GiB，够用；
- **私有仓库不行**：下载器不带任何凭据，也不会带 Cookie；
- `github.com/<owner>/<repo>/raw/<branch>/...` 这种地址会 302，换成 `raw.githubusercontent.com` 直链，或在“允许跳转的域名”里放行。

用 Release 放资源时，两处域名都要配：

1. `MARKET_ALLOWED_HOSTS` 里加上 `github.com`（清单里写的初始地址就在这）；
2. 跳转目标 `release-assets.githubusercontent.com` 默认已放行，只有在填了 `MARKET_REDIRECT_HOSTS` 之后才需要自己带上它。

清单条目仍然要写 `size` 与 `sha256`——签名 URL 只有一小时有效期，不能预先写进静态清单，所以“先跳到哪”不重要，“下到的字节对不对”才是判定依据。

### 一键发布到官方仓库

开发树里带了一条命令，把 `plugins/` 直接发到市场仓库：

```bash
npm run market:publish                     # 打包 → 校验 → 克隆仓库 → 替换 market/ → 提交推送
npm run market:publish -- --dry-run        # 只生成 dist/market 并校验，不联网
npm run market:publish -- --repo <owner>/<repo> --branch main
```

它做四件事：用 `market:catalog` 重新打包（URL 自动指向该仓库的 raw 地址）、用 `market:validate` 比对 `size`/`sha256`、浅克隆仓库、把 `market/` 整体替换后提交推送。

几个行为值得记一下：

- ZIP 里的时间戳固定为 1980-01-01，同样的插件源码每次都压出同样的字节，`sha256` 稳定；内容没变时不刷新 `updated_at`，也不会产生空提交；
- 仓库里手工维护的 `market/assets.json` 会被保留，不被生成物覆盖；
- `scripts/validate-market.mjs` 以本仓库这份为准，发布时同步到市场仓库，两边校验逻辑不会漂移；
- 推送依赖本机 git 的 GitHub 凭据，没登录会直接失败并停在推送这一步，本地生成物不受影响。

市场仓库每次 push 到 `market/` 都会跑 `.github/workflows/validate-market.yml`，清单与包不一致时直接把这次提交标红。

### 用 Actions 自动生成清单

仓库里带了 `.github/workflows/market-catalog.yml`：推送 `plugins/**` 后自动跑 `market:catalog`，把结果提交回 `market/`。

它假设的是**开发树**布局——仓库根有 `plugins/`，应用在 `resources/app/`：

```
<repo>/
├── .github/workflows/market-catalog.yml
├── plugins/                 # 触发源
├── resources/app/           # package.json、scripts/market-catalog.mjs
└── market/                  # 工作流生成：index.json + packages/
```

如果你推的是导出的源码目录（`package.json` 就在根、插件也在根），把工作流里的 `working-directory: resources/app` 去掉、`--out ../../market` 改成 `--out market` 即可。注意 `.github/` 不会进源码包——导出只收 `src/ scripts/ test/ docs/ native/ examples/` 和根文件，所以工作流要在仓库里单独保留。

资源条目由 `market/assets.json` 维护，CI 只读不生成，所以只能写 `url`/`size`/`sha256`，不能写 `source`：

```json
[{ "id": "ffmpeg", "name": "FFmpeg 运行资源", "version": "9.0.2",
   "install_to": "runtime/video-tools", "files": ["bin/ffmpeg.exe", "bin/ffprobe.exe"],
   "url": "https://github.com/<owner>/<repo>/releases/download/ffmpeg-9.0.2/ffmpeg-9.0.2-win64.zip",
   "size": 110100480, "sha256": "…" }]
```

算这两个值：PowerShell `(Get-FileHash 文件 -Algorithm SHA256).Hash.ToLower()`、`(Get-Item 文件).Length`；Linux/macOS 用 `sha256sum` 和 `stat -c%s`。

## 安装流程

1. 读清单（缓存 5 分钟，`?refresh=1` 强制刷新；清单读不到时沿用上一份缓存并在界面提示）；
2. 下载插件包，边下边计数，超过上限立即中止；
3. 校验字节数与 SHA-256；
4. 用现有安装器**只做校验**（清单字段、路径、文件数、解包大小）；
5. 比对包内 `plugin.json` 的 `id`/`kind`/`version` 与清单条目，任何一项不一致就整包拒绝；
6. 写入 `plugins/<id>/`，并顺手建立插件记录（默认停用），随后照旧去插件页配置作用范围再启用。

“更新”等价于带 `overwrite` 的安装：先删旧目录再写新文件，插件记录、配置与启停状态保留。**插件私有数据不要放在插件目录里**，否则会被一起替换。

“卸载”会删除 `plugins/<id>` 整个目录并移除对应插件记录，需要二次确认；资源包不受影响。

## 资源通道

FFmpeg 之类的二进制走 `assets`：

- 下载、校验 `size`/`sha256` 后解包，只取 `files` 里列出的文件；
- 逐个文件先写 `<name>.partial` 再 `rename`，避免半截文件被当成可用；
- 优先写进应用目录；装在只读位置（如 `Program Files`）时回退到当前工作目录——视频插件本来就同时查找这两处；
- 视频插件的查找顺序是：`配置 → 插件自己传给 runtimeDir('video-tools/bin') → 当前工作目录的 runtime/video-tools/bin → PATH`。市场默认装到前者，因此不需要改配置。

`install_to` 必须落在 `runtime/` 下，写成 `plugins/...`、`../...` 之类会被清单层直接忽略。

## 接口

管理接口（管理员 Token）：

- `GET /admin/market[?refresh=1]`：清单 + 本机安装状态 + 资源就绪状态 + 被拒绝条目；
- `POST /admin/market/install` `{id, overwrite?}`
- `POST /admin/market/uninstall` `{id, confirm: true}`
- `POST /admin/market/asset` `{id}`

工作台把它们映射为 `/market`、`/market/install`、`/market/uninstall`、`/market/asset`，凭据不离开服务端；`/market/asset` 的超时单独放宽到约 10 分钟。

## 安全边界

- 只允许 https（本机回环可用 http 便于调试），地址不得带用户名密码；
- 重定向最多 3 跳，每一跳都重新过一遍检查：目标必须仍是 https、不是内网、域名在“允许的域名”或“允许跳转的域名”里，且不跟随到带凭据的地址；
- 解析到私有、链路本地或保留地址的域名一律拒绝；
- 域名白名单默认等于清单所在域名，清单里出现第三方 CDN 时必须显式加进“允许的域名”；
- 下载先比 `size` 再比 `sha256`，最后比对包内清单，全部通过才落盘。**跳转不是信任**：签名 URL 被换掉、被中间人改写都不影响判定，因为校验的是字节。

已知限制：清单本身没有签名，安全性依赖发布站点的 https 与你的允许域名清单；缓存期 5 分钟内清单更新不会立刻生效；市场不会替用户撤销已装插件，卸载仍然需要显式操作。

## 测试

```bash
node scripts/test.mjs test/market.test.mjs
```

覆盖：清单列出 / 安装 / 更新、校验和与域名不合规时拒绝、白名单与内网地址拦截、卸载确认、资源包落盘与越界目标忽略，以及工作台代理与控制台页面是否带上市场视图。
