---
name: Limen 本机机器人管理台
description: 清楚管理机器人、配置与运行情况的中文工作台。
colors:
  bg: "#fafafa"
  surface: "#fff"
  surface-muted: "#f4f4f7"
  ink: "#272936"
  muted: "#666978"
  line: "#e7e7ed"
  accent: "#5650bd"
  accent-hover: "#443d9d"
  accent-soft: "#efedf9"
  rail: "#f5f5f8"
  rail-text: "#575b6b"
  nav-hover: "#ececf2"
  nav-selected: "#e9e6f5"
  nav-selected-ink: "#49419e"
  ok: "#217252"
  ok-bg: "#edf7f1"
  warn: "#8a5c16"
  warn-bg: "#fff7e8"
  bad: "#b63746"
  bad-bg: "#fff0f2"
  field-line: "#8a8d9d"
  field-line-hover: "#636779"
  focus: "#625bc5"
  button-line: "#d9dae3"
  button-line-hover: "#b7b8c7"
typography:
  headline:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "27px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.4
  panel-title:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  field-label:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.65
  button:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.65
  label:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
  meta:
    fontFamily: "'Segoe UI Variable Text','Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.65
  mono:
    fontFamily: "'Cascadia Code',Consolas,monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  tag: "5px"
  control: "8px"
  banner: "9px"
  floating: "10px"
  message: "12px"
  composer: "13px"
  panel: "14px"
  dialog: "16px"
spacing:
  compact: "6px"
  action-gap: "8px"
  inline-gap: "12px"
  mobile-x: "16px"
  mobile-panel-x: "18px"
  group: "20px"
  stack: "22px"
  panel: "24px"
  field-gap: "26px"
  settings-panel: "28px"
  content-y: "34px"
  content-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-muted}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.bad}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  button-danger-hover:
    backgroundColor: "{colors.bad-bg}"
  button-text:
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    width: "100%"
  nav-item:
    textColor: "{colors.rail-text}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
    width: "100%"
  nav-item-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.nav-selected-ink}"
  tag:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.tag}"
    padding: "3px 8px"
  tag-ok:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok}"
  tag-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
  tag-bad:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  agent-tab:
    textColor: "{colors.muted}"
    padding: "0 1px 15px"
  agent-tab-selected:
    textColor: "{colors.accent}"
  mode-switch:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  mode-switch-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
---

# Design System: Limen 本机机器人管理台

## Overview

**Creative North Star: "本机工作台"**

浅灰侧栏、近白工作区与白色内容面组成安静的操作环境。深灰文字、中文系统字体、清楚的分组和细分隔承担层级；蓝紫色集中在主操作、当前选择、链接与焦点。熟悉的管理控件服务于长时间查看与修改配置。

本次视觉世界来自用户授权的 Web 重做，取代旧深松绿版本。页面策略与默认入口写在对应 surface brief；这里记录可复用的视觉规范。代码与浏览器验收构成实际依据，未生成装饰图片、随机视觉方案或批准稿。

**Key Characteristics:**

- 冷中性浅色面与深灰文字，蓝紫强调用途明确。
- 表单、标签、表格与真实状态构成主体。
- 静态内容以细边框分隔，临时浮层才使用阴影。
- 状态同时使用文字和颜色，桌面密度与手机触控尺寸分别处理。

抽取依据：`src/web/theme.mjs` 的根变量、通用组件、媒体查询与最终 `touchStyles`；`src/web/agent-ui.mjs` 的页签、人格编辑与测试对话；`src/web/page.mjs` 的结构和样式顺序。行为依据为 `client.mjs`、`agent.mjs`。视觉对照为 `.impeccable/review/desktop.png`、`agent-desktop.png`、`mobile-320.png`。前置 tokens 是原始值的规范来源；sidecar 只补充 schema 以外的扩展。其 tonalRamp 是按源色计算的面板预览色阶，不扩展生产色板。

## Colors

中性灰白支撑文字与表单，蓝紫表达可操作与已选择，语义状态色独立使用。

### Primary

- **操作蓝紫**（`accent` / `accent-hover`）：主按钮、链接、勾选控件与流程标记，悬停加深。
- **浅蓝紫选择面**（`accent-soft` / `nav-selected` / `nav-selected-ink`）：设置分组、测试模式和当前导航。
- **焦点蓝紫**（`focus`）：标记键盘位置，不由悬停代替。

### Neutral

- **近白工作区与白色内容面**（`bg` / `surface`）：区分页面底与内容容器。
- **冷灰侧栏**（`rail` / `rail-text` / `nav-hover`）：持续导航的位置层。
- **柔灰容器与细线**（`surface-muted` / `line`）：代码、次要块与分隔。
- **深灰正文与次级灰字**（`ink` / `muted`）：任务内容和说明。
- **字段边界**（`field-line` / `field-line-hover`）：输入边界与悬停；按钮另用 `button-line` / `button-line-hover`。

成功绿（`ok` / `ok-bg`）、警告琥珀（`warn` / `warn-bg`）、错误红（`bad` / `bad-bg`）只表达对应语义。

**The 状态有字 Rule.** 连接、暂停、失败与待核对都写出文字；色点和色面只辅助识别。

## Typography

标题与正文共用前置 `body` 的中文系统字体栈，无远程字体依赖。变量名、地址、原始事件与诊断字段使用 `mono`；时间和统计使用等宽数字。

- 页面标题使用 `headline`，手机缩为（23px）。内容标题使用 `title`，设置分组标题为（19px）；面板标题使用 `panel-title`，手机缩为（14px）。
- 正文使用 `body`；消息正文仍为（14px），行高（1.85）。帮助文字使用（12px）及较松行高（1.8–1.85）；页面说明最大宽（72ch）。
- 字段标签使用 `field-label`，Agent 标签为（12px / 600）。字段键名独立成行，等宽字（10px）。
- 按钮、标签与元数据分别使用 `button`、`label`、`meta`。手机文本输入与选择使用（16px），保留完整状态文字。

## Layout

固定侧栏宽（232px），白色顶栏高（66px），工作区同步留出侧栏位置。内容居中，最大宽（1580px），默认内边距（34px 36px 90px）。面板正文内边距（24px），面板间距（24px）；设置使用（180px）分组导航与两列表单，字段间距（26px）。消息、日志和任务使用列表或可横向滚动的表格。

| 实际媒体条件 | 布局变化 |
| --- | --- |
| ≥1650px | 内容上边距（40px），概览间距（28px）。 |
| ≤1190px | 侧栏（208px），内容左右（26px），隐藏全局搜索，设置导航（150px）。 |
| ≤1100px | Agent 会话记忆与工具执行各自改为单列。 |
| ≤940px | 概览和设置单列，设置分组成为可换行按钮。 |
| ≤760px | 人格编辑单列，提示词区使用上分隔。 |
| ≤680px | 侧栏为（232px）抽屉，顶栏高（61px），内容左右（16px）；表单单列、流程纵排、过滤搜索独占一行；保存栏铺满视口。 |
| ≤380px | 登录区单列、账号区可换行，保存栏收紧元数据。 |

最终 `touchStyles` 在功能样式后装载：手机按钮、文字操作、页签和导航最小（44px × 44px），菜单和关闭按钮为（44px × 44px）；密钥操作、布尔标签与折叠摘要至少（44px）高。长工具名、正文与地址允许换行，表格和长正文局部滚动。底部保存栏对应页面预留底部空间；窄屏通过减少并列数量保持可读。

## Elevation & Depth

静态面板用白面、冷灰底、细边框和分隔线建立深度，没有卡片阴影。短暂提示使用（`0 8px 28px #25223926`），确认框使用（`0 18px 70px #2723393d`）；对话框和手机抽屉使用半透明深灰遮罩（`#24233266`）。这些扩展值记录于 sidecar。

常规交互过渡背景、边框与文字色（0.16s）；手机抽屉沿水平轴移动（0.2s ease-out）。测试记录设为平滑滚动。减少动态效果偏好关闭 CSS 动画和过渡，不声称该规则同时关闭所有滚动行为。

## Shapes

细边框、小圆角和规则矩形形成熟悉的操作界面。控件使用 `rounded.control`，面板使用 `rounded.panel`，标签使用 `rounded.tag`；横幅、浮层、用户消息、输入容器与对话框各使用已实现半径。Agent 页签保持直角下划线，边框通常为（1px），状态圆点为圆形。

内联 SVG 线条图标：通用（19px）、导航（18px）、按钮（16px），线宽（1.65），圆头圆连接。二维码与用户表情保持功能性用途，界面层级不依赖装饰插画或渐变。

## Components

### Buttons

主按钮实心蓝紫，次按钮白底灰边，危险操作红字且悬停为浅红底。标准最小高度（38px），小按钮（31px），手机由触控规则提升为（44px）。禁用透明度（0.5），无位移反馈；文字操作悬停出现下划线。

### Inputs / Fields

白底、可见灰边、完整标签，标准设置输入最小高（42px），悬停加深边界。全局焦点为（3px）蓝紫轮廓，偏移（3px）。被环境覆盖的字段显示禁用底色；密钥用密码输入与独立查看、生成、清空动作。校验沿用原生约束和可见反馈，不虚构未实现的字段错误样式。

### Cards / Containers

白面、细灰边、`rounded.panel`，标题与正文以细线分隔。消息、日志、执行记录按内容组织，长内容局部滚动；空状态以标题、说明和已有 SVG 呈现。

### Chips

非交互状态标签使用柔灰底；成功、警告、错误有各自文字与底色。执行动作使用按钮，不借标签暗示可点击。

### Navigation

浅灰侧栏分组，当前页采用浅蓝紫面、蓝紫文字与（650）字重，`aria-current` 标记位置。手机抽屉打开时聚焦当前页，Tab 留在抽屉内；Esc、遮罩、关闭按钮和选页均可关闭，焦点回菜单按钮。

Agent 页签以 `aria-selected` 和活动下划线表达选中，支持左右箭头、Home、End 切换和聚焦。页面任务与测试入口规则记录在 Agent surface brief。

### Mode Switch / Test Conversation

顶栏切换采用小型描边按钮，激活后浅蓝紫底与蓝紫字，`aria-pressed` 同步状态。手机只显示图标，保留动态无障碍名称与（44px）目标。测试对话为居中白色容器，用户消息用浅灰面，助手消息以文字组织。输入区聚焦改变外框边色；Enter 发送，Shift+Enter 换行，处理中禁用重复提交。

### Operational Feedback

心绪插件沿用内置插件选择、分组配置与模拟预览。风格、心理动力、情绪延续、情境理解及保留分组使用现有字段控件；情境理解说明额外模型请求及回退。删除提示明确清除情绪、信任及熟悉感。已检查 1440/768/390/320px 布局，见 `.impeccable/review/emotion/`。

流动记忆沿用插件管理的内置安装入口与分组配置表单，不新增视觉规则。行为面板说明召回、后台整理和 Agent 工具；删除确认明确长期记忆及原文将一并删除，导出插件配置不替代数据备份。桌面与 320px 手机布局已用模拟数据验证，记录见 `.impeccable/review/living-memory/`。

横幅用于错误、演示与待重启，短暂提示用于一般结果。底栏区分未保存、已保存、待重启及正在操作；发送结果未知必须核对。消息与日志暂停只冻结显示，进程内缓冲与磁盘保留分别说明。

**The 保存与生效 Rule.** 保存成功后仍明确展示待重启，重启生效是独立动作。

## Do's and Don'ts

### Do:

- **Do** 使用中性灰白与蓝紫操作强调，成功绿只表达真实成功。
- **Do** 沿用中文系统字体、可见字段边界、可换行元数据和完整状态文字。
- **Do** 保留键盘焦点、抽屉焦点管理、页签键盘操作和手机（44px）目标。
- **Do** 明确模拟环境、未保存、待重启和结果未知的真实状态。

### Don't:

- **Don't** 用旧深绿侧栏或绿色主操作替换本轮确认的视觉世界。
- **Don't** 增加装饰图片、渐变、假指标或静态卡片阴影。
- **Don't** 单靠颜色表达状态，或将保存成功表述为配置已生效。
- **Don't** 在示例和导出说明中填入真实凭据、私人消息或私密路径。

## 2026-11-04 工作区布局

延续灰白与蓝紫视觉，侧栏以管理任务分组。概览优先提供抖音自动化、分享私信入口，底层消息处理流程收起。Agent 页签置于设备控制上方，默认打开“浏览与设备”，并将分享私信、视频知识库、会话记忆、人格配置、工具执行分区；桌面与安卓控制采用可展开明细。手动草稿收起，默认好友状态和最近消息优先。插件按视频自动化、聊天记忆、图片语音组织。

Windows 桌面版沿用同一页面与配置行为，不增加另一套设置。桌面提供打开数据目录、缩放和退出等系统菜单。移动端标签为两列，保留 44px 操作目标。
