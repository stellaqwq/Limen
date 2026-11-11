# Python 网页抓取插件

为支持 function calling 的本地模型提供 `fetch_webpage` 只读工具。模型把网址作为参数传给插件，插件在本机启动 Python 3，以标准库 `urllib.request` 抓取并提取标题、正文和链接，再将结果交回模型继续回答。无需 requests、BeautifulSoup、浏览器或第三方网页 API。

## 当前项目

安装脚本会检测 Python，并按项目 AI 好友 / 群白名单建立插件范围：

```powershell
npm run webfetch:install

# Python 无法自动检测时：
npm run webfetch:install -- --python "C:/实际路径/python.exe"
```

服务运行时通过管理员接口安装；未运行时在同一个运行锁保护下写入本地插件库，不启动 QQ。新插件在存在明确回复范围时自动启用；没有范围时保存为停用。重复安装会更新同一个插件，并保留已有范围、配置及启停状态。

启动机器人后，在允许的 QQ 会话中发送：

> 请读取 https://www.python.org/ ，总结网页的主要内容并给出来源链接。

不登录 QQ 时也可单独检查已安装插件的实际抓取结果：

```powershell
npm run webfetch:check -- https://www.python.org/
```

群聊还需符合当前 AI 与插件的 @ 规则。模型需启用 Agent 且支持 Chat Completions 工具协议；如果会话人格只允许部分工具，需要在工具范围中加入实际注册的 `plugin_插件编号_fetch_webpage`，或使用默认全部工具。

网页“测试对话”沿用项目原有的时间 / 记忆工具范围，不执行 QQ 插件；请在 QQ 会话中验证此插件。插件本身不会接管普通消息、单独发送 QQ 回复或改变 AI 白名单。

## 导入到其他实例

```powershell
npm run webfetch:export
```

得到 `dist/python-web-fetch.plugin.json`。在“插件管理 → 导入”选择此文件，设置允许的好友 / 群号，保存并启用即可。JSON 包已嵌入 Python 源码，目标电脑无需复制辅助脚本或安装第三方库，但必须有 Python 3。保存插件只校验 JavaScript 模块，不抓取网页。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `python_path` | 空 | 自动查找 Python；Windows 优先查找当前用户的 Python 安装目录，再使用 `py -3`；也可填写 `python.exe` 的绝对路径 |
| `timeout_ms` | `6000` | 单次抓取期限，限制为 500–7000 毫秒；进程内外都有退出期限，插件线程总期限为 10000 毫秒 |
| `max_bytes` | `1048576` | 下载及解压后的大小上限，最高 2 MiB |
| `max_chars` | `4000` | 返回正文的字符上限，最高 5000；模型可在调用时指定较小值 |
| `max_links` | `6` | 返回链接数，最高 10；0 不返回链接 |
| `use_proxy` | `true` | 使用 Python / 系统代理设置；设为 false 直接连接目标网站 |

工具返回最终 URL、标题、正文、HTTP 状态、编码、链接及 `truncated` 截断标识。结果最多 28 KB，符合项目工具结果 30 KB 的限制。支持最多 5 次 HTTP 重定向、gzip、UTF-8 和常见中文编码；移除 script / style 等隐藏内容，只返回 HTTP(S) 链接。网址通过标准输入传入，不拼接 shell 命令，也不接受模型提供的 Python 代码或文件路径。

此插件读取服务器返回的网页 HTML / 文本，不执行 JavaScript。需要登录、验证码或浏览器渲染的页面可能无法取得正文；失败会返回明确状态，供模型说明原因。没有接入搜索引擎，用户或模型需提供实际网址。

源码：`examples/python-web-fetch.py`、`examples/python-web-fetch-plugin.mjs`；导出器：`scripts/python-web-fetch-plugin.mjs`。实现使用 [Python 官方 urllib.request](https://docs.python.org/3/library/urllib.request.html) 与 HTMLParser。

## 验证

```powershell
node scripts/test.mjs test/python-web-fetch.test.mjs
```

使用本机临时网页和真实 Python 进程验证中文 / emoji、相对链接、重定向、gzip、GBK、文本 JSON、大小限制、超时、错误信息、插件安装幂等和完整的模型工具调用流程，不登录真实 QQ 或调用真实模型服务。
