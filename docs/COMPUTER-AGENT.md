# 本机与桌面 Agent

Limen可通过现有 Agent 工具循环访问本机文件，并在 Windows 上观察和操控桌面。在管理台顶部打开“测试对话”描述任务；也可单独开放给 QQ 管理员私聊。群聊不提供本机工具。

## 启用

1. 退出旧服务，重新运行 `npm run launch` 加载新增代码。
2. 在“全部设置 → AI 与回复”配置支持 function calling 的模型。根据截图操作桌面还需支持图片输入；文字模型可使用窗口列表和可访问控件。
3. 在“全部设置 → 本机与桌面”打开“启用本机 Agent”，填写允许访问的目录。每行一个，也可分号分隔；目录必须已存在。相对路径基于项目启动目录，模型的相对文件路径基于第一个允许目录。
4. 按需开启“允许桌面控制”与“允许 PowerShell 命令”。桌面控制默认允许，但总开关默认关闭；命令执行和 QQ 私聊入口默认关闭。
5. 保存后重启生效。在“Agent 管理”确认本机状态为已就绪，通过“测试对话”发送任务。

例如将允许目录设为 `D:/AgentWorkspace`，先在本机创建该目录，再发送：

> 查看工作目录里的文件，创建一个 notes 文件夹，把今天的待办写入 notes/todo.md，再读回来确认。

桌面任务示例：

> 看看当前桌面，列出打开的窗口。

> 在我已经打开的记事本窗口里输入“测试本机 Agent”，先不要保存。

桌面任务需要多轮“观察 → 操作 → 再观察”。建议在“Agent 执行”将模型请求步数调至 24、工具调用次数调至 48、总超时调至 600000 毫秒。人格的工具白名单仍会限制本机工具。

QQ 入口需开启“允许 QQ 管理员私聊控制本机”，在 `BOT_ADMIN_IDS` 填入管理员 QQ，并满足现有 AI 私聊白名单。网页入口继续使用独立管理员凭据，不要求 QQ 在线。

## 桌面与停止控制

“查看桌面”按需获取快照，不持续录屏；“隐藏截图”移除页面快照。手动预览仅返回给本机管理台，不调用模型。Agent 自己调用截图工具时，图像发送到已配置的模型服务。截图和控件内容不写入执行日志，截图不进入聊天历史或数据库工具缓存。

“紧急停止”撤销本机操作信号，终止正在运行的桥接 / 命令进程树，并阻止后续操作。停止状态持久保存，服务重启后仍需手动恢复。已经提交的输入、文件写入或外部程序行为不会回滚。恢复只开放后续新请求，不续做旧任务。本机任务独占租约直到任务结束或取消清理完成，其他任务不能穿插操作。

桌面控制需要 Windows 登录用户的交互桌面；锁屏、Windows 服务、断开的远程桌面及 UAC 安全桌面可能无法操作。普通权限进程无法向部分管理员窗口注入输入，不会自动提权。输入限制见 [Microsoft SendInput 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。

## 工具

| 工具 | 能力 |
| --- | --- |
| `computer_list_files` | 单层列出最多 100 项 |
| `computer_read_file` | 最多 24 KB 的 UTF-8 文本，返回 SHA-256 |
| `computer_write_file` | 新建 / 修改文本，单次最多 6000 字符；修改需提供读取时的 SHA-256，默认拒绝覆盖 |
| `computer_make_directory` | 新建一层目录，父目录必须存在 |
| `desktop_windows` | 可见窗口标题、句柄与位置 |
| `desktop_screenshot` | 虚拟桌面 JPEG，等比缩小至宽度最多 1280，提供图像和原始屏幕坐标信息 |
| `desktop_inspect` | Windows UI Automation 前台控件名称与坐标，最多 100 项、深度 5，跳过密码控件；部分应用不提供控件 |
| `desktop_action` | 聚焦、点击 / 双击 / 右击、移动 / 拖动、滚动、Unicode 文字、组合键、短暂等待 |
| `computer_run_command` | 可选 PowerShell 命令，限定初始工作目录、执行时间和输出大小 |

动作使用原始屏幕坐标，支持负坐标的多显示器。截图像素转换：`x = screen.x + px * screen.width / image_width`，`y = screen.y + py * screen.height / image_height`。截图和控件读取返回有效期 30 秒的 `observation_id`；每次动作后失效，需重新观察。输入前核对前台窗口句柄，窗口变化时拒绝输入。滚动也需提供 `x/y`。文字通过 Unicode 输入事件发送，不占用剪贴板；组合键例如 `CTRL+S`、`ALT+TAB`、`ENTER`。

本机写入 / 动作用独立 `operation_id`：同任务、同编号、同参数复用结果，同编号改变参数会被拒绝。连续新动作使用新编号；既有记忆、QQ 发布及插件仍保留一次写入限制。操作抛错且结果未知时终止本任务。任务出现本机写入后，模型失败或进程恢复不会重新执行该任务，应核对后发起新请求。

## 访问范围

文件工具校验允许目录、真实路径、符号链接 / 目录联接、网络 / 设备路径及备用数据流，不提供删除工具。修改前后核对哈希，减少覆盖外部修改的可能；这不是与其他进程之间的文件锁，也不是操作系统沙箱。

**文件工具的目录范围不限制桌面应用或 PowerShell 命令**，它们以启动Limen的 Windows 用户身份运行，可以访问当前用户能访问的其他数据和程序。仅对信任的模型和管理员开启。文件、窗口和网页中的文字作为资料，不能扩大权限。Agent 读取的文件 / 控件内容及截图会成为所配置模型的请求输入。

## 验证与接口

```powershell
# 只读原生检查，不移动鼠标、不输入、不保存或上传截图
npm run computer:check

# 临时目录、模拟桌面与模拟模型的回归
node scripts/test.mjs test/computer.test.mjs

# 解锁后可选：独立临时窗口中的真实鼠标和中文输入检查，结束自动关闭
npm run computer:input-check
```

本机已验证窗口枚举、UI Automation 控件及 2560×1440 → 1280×720 截图。解锁后在独立 WinForms 测试窗口完成真实输入验收：窗口聚焦、鼠标点击、中文多行 Unicode 输入、Ctrl+A 选择并替换、按钮点击事件均通过；未向用户已有窗口注入测试输入。验收中修正了 Windows PowerShell 的 UInt16 类型兼容问题。连续动作、坐标校验、防重、停止 / 恢复及文件任务另有自动化模拟覆盖。原生桥接检测安全桌面及 LockApp / LogonUI，在截图或输入前返回需解锁的提示。拖动、滚动及其他应用中的输入行为仍需按实际任务验证。

全项目回归 483 / 483 通过，报告 `dist/computer-full-tests.json`；浏览器通过 1440 / 768 / 390 / 320 宽度的 Agent 验收，包含手动预览、停止 / 恢复、截图移除及本机设置，JavaScript / CSP 错误为 0，报告 `.impeccable/review/agent-qa.json`。解锁后的五项真实输入验收报告为 `dist/computer-input-check/report.json`，原生类型兼容修正后的专项回归为 `dist/computer-native-final-tests.json`。

管理接口沿用独立管理员 Bearer Token 和本机工作台 Origin 校验：`POST /admin/agent/computer/control` 接收 `{action:"stop"}` 或 `{action:"resume"}`；`POST /admin/agent/computer/screenshot` 接收空对象并返回快照；`GET /admin/agent` 增加 `computer` 状态。模型不能调用管理接口修改自身权限。
