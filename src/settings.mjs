import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { loadConfig, environmentOf, decodeEnvironment, encodedPrefix } from './config.mjs';
import { PROJECT_NAME } from './brand.mjs';

export const groups = [
  { id: 'ai', title: 'AI 与回复', description: '连接模型服务，定义助手如何回答。' },
  { id: 'agent', title: 'Agent 执行', description: '启用连续工具调用，限制单个任务的执行步数与时间。人格、记忆和插件工具在 Agent 工作台管理。' },
  { id: 'computer', title: '本机与桌面', description: '让 Agent 访问指定目录并操作 Windows 桌面。先配置访问范围，保存后即时生效。' },
  { id: 'access', title: '回复范围', description: '设置 AI 回复白名单、群成员屏蔽规则和聊天指令的管理员权限。' },
  { id: 'qq', title: 'QQ 与运行时', description: '账号、驱动与官方内核目录。' },
  { id: 'connection', title: 'OneBot 与推送', description: '配置插件接入、反向连接和事件推送。' },
  { id: 'market', title: '插件市场', description: '从一个静态清单安装插件包；只有清单里的地址会被下载，且必须命中允许的域名。' },
  { id: 'queue', title: '队列与发送', description: '控制并发、发送频率和失败重试。' },
  { id: 'storage', title: '数据与保留', description: '数据目录、历史保留与会话加密。' },
  { id: 'advanced', title: '实验驱动', description: '仅 native 驱动需要的服务器与签名设置。' }
];
const field = (key, group, label, type, fallback, help = '', extra = {}) => ({ key, group, label, type, default: String(fallback), help, ...extra });
export const fields = [
  field('COMPUTER_ENABLED','computer','启用本机 Agent','boolean',false,'允许已认证的网页对话使用本机工具。模型读取的本地内容和截图会发送到所配置的模型服务。'),
  field('COMPUTER_ROOTS','computer','允许访问的文件目录','textarea','./workspace','每行一个绝对路径，或相对项目根目录的路径；也支持分号分隔。文件工具仅访问这些目录。目录必须已存在。'),
  field('COMPUTER_DESKTOP_ENABLED','computer','允许桌面控制','boolean',true,'提供截图、窗口与控件读取、鼠标键盘操作；需要 Windows 已登录且桌面未锁屏。桌面应用能够访问文件工具目录以外的数据。'),
  field('COMPUTER_SHELL_ENABLED','computer','允许 PowerShell 命令','boolean',false,'命令以当前 Windows 用户身份执行，工作目录从允许目录中选择；命令本身不受文件目录限制。'),
  field('COMPUTER_QQ_ADMIN_ENABLED','computer','允许 QQ 管理员私聊控制本机','boolean',false,'仅 BOT_ADMIN_IDS 中且位于 AI 回复白名单的管理员私聊可用；群聊始终不提供本机工具。'),
  field('COMPUTER_COMMAND_TIMEOUT_MS','computer','命令超时','number',15000,'毫秒；超时或紧急停止会终止命令进程树，已发生的操作不会回滚。',{min:1000,max:240000}),
  field('AGENT_ENABLED','agent','启用 Agent','boolean',true,'AI 开启后使用 Agent 处理白名单消息；关闭可恢复原有 AI 回复流程。'),
  field('AGENT_MAX_STEPS','agent','模型请求步数上限','number',8,'每个任务最多请求模型的次数，包含工具调用后的继续生成。',{min:1,max:24}),
  field('AGENT_MAX_TOOL_CALLS','agent','工具调用次数上限','number',16,'每个任务最多执行的工具调用次数。',{min:1,max:64}),
  field('AGENT_TIMEOUT_MS','agent','单次任务执行超时','number',300000,'毫秒；总执行预算。单次模型请求同时受 AI_TIMEOUT_MS 限制。',{min:1000,max:600000}),
  field('AI_ENABLED','ai','启用 AI 自动回复','boolean',false,'启用前填写模型，并设置好友或群白名单。'),
  field('AI_STRIP_EMOJI','ai','过滤 AI 回复中的 Emoji','boolean',true,'发送前删除 Unicode 表情，包括组合表情、肤色、旗帜和键帽。适用于普通 AI、Chat Plus、流式输出、网页试聊及 AI 语音合成文本；过滤后无正文则不发送。保存后即时生效。'),
  field('REPLY_AT_SENDER','ai','群聊回复时 @发送人','boolean',true,'控制普通 AI、Chat Plus 和消息插件的回复样式；私聊不 @。不改变是否需要被 @才触发回复。保存后即时生效。'),
  field('REPLY_QUOTE_MESSAGE','ai','回复时引用原消息','boolean',true,'私聊和群聊回复引用触发回复的原消息，流式各段也遵循此设置。语音仍独立发送；定时主动聊天不引用旧消息。保存后即时生效。'),
  field('AI_STREAM_ENABLED','ai','模型流式输出','boolean',true,'向模型请求流式数据，网页边生成边显示；关闭后等待模型返回完整正文。'),
  field('AI_SEGMENTED_REPLY_ENABLED','ai','非流式平台实时分段回复','boolean',true,'QQ 等不支持原生流式展示的平台，收到完整句子就分段发送，长句按分段长度拆分。需同时开启模型流式输出；关闭时等待完整正文后发送，网页流式显示不受影响。'),
  field('AI_STREAM_CHUNK_CHARS','ai','流式分段长度','number',240,'QQ 每段的目标字符数；遇到完整句子可提前发送。仍遵守发送频率限制。',{min:40,max:1000}),
  field('AI_BASE_URL','ai','模型服务地址','url','http://127.0.0.1:11434/v1','兼容 Chat Completions，自动追加 /chat/completions。'),
  field('AI_MODEL','ai','模型标识','text','','填写模型服务提供的准确名称。'),
  field('AI_REASONING_EFFORT','ai','模型推理强度','text','','留空使用模型默认；可选 none、minimal、low、medium、high、xhigh，需模型服务支持。高强度推理需要足够的生成 Token 和请求时间。'),
  field('AI_MAX_OUTPUT_TOKENS','ai','生成 Token 上限','number',0,'包含推理与最终正文，与回复字符上限不同。0 使用服务默认；high 建议预留充足额度，如 16384。',{min:0,max:131072}),
  field('AI_TEMPERATURE','ai','采样温度','text','','0–2；留空使用服务默认。Qwen3.5 通用推理建议 1。'),
  field('AI_TOP_P','ai','Top P','text','','0–1；留空使用服务默认。Qwen3.5 通用推理建议 0.95。'),
  field('AI_PRESENCE_PENALTY','ai','话题重复惩罚','text','','-2–2；留空使用服务默认。Qwen3.5 通用推理建议 1.5，可缓解重复推理。'),
  field('AI_VISION_ENABLED','ai','图片理解','boolean',true,'将收到的图片交给当前模型分析；需要模型服务支持视觉输入。每条消息最多 4 个附件，总大小受媒体大小限制且不超过 10 MiB。'),
  field('AI_ATTACHMENT_MAX_CHARS','ai','文档提取文字上限','number',24000,'单条消息的全部文档合计；超出部分明确标记截断。支持文本、PDF、DOCX、XLSX。',{min:1000,max:100000}),
  field('AI_PDF_MAX_PAGES','ai','PDF 读取页数上限','number',40,'每个 PDF 仅提取前 N 页文字；扫描版请将相关页面作为图片发送。',{min:1,max:200}),
  field('AI_API_KEY','ai','模型 API Key','secret','','本机保存；留空保留已有密钥。'),
  field('AI_SYSTEM_PROMPT','ai','系统提示词','textarea','你是用户的 QQ AI 助手。简洁、诚实地回答，不要声称自己是人类。','定义角色、语气和回答规则。'),
  field('AI_TIMEOUT_MS','ai','模型请求超时','number',45000,'毫秒，包含响应正文读取。',{min:10}),
  field('AI_CONTEXT_TURNS','ai','上下文轮数','number',-1,'-1 表示保留全部对话；0 不保留；正数限制最近轮数。包含接口返回的思考、工具调用及结果。',{min:-1}),
  field('AI_GROUP_CONTEXT_ENABLED','ai','群聊上下文感知','boolean',true,'仅在 AI 群白名单中缓存近期群聊，包含未 @机器人的消息，供触发回复时参考。不开启额外自动回复；/new 会清空缓存。'),
  field('AI_GROUP_CONTEXT_MESSAGES','ai','近期群消息条数','number',30,'每次回复最多参考的群内近期消息数，区分 QQ、昵称、@ 和引用。',{min:1,max:200}),
  field('AI_GROUP_CONTEXT_TTL_MS','ai','群聊背景保留时间','number',900000,'毫秒；默认 15 分钟。超时消息不用于背景，取用及定期维护时清理。',{min:1000,max:86400000}),
  field('AI_GROUP_CONTEXT_MAX_CHARS','ai','群聊背景长度上限','number',8000,'每次请求附加的群聊背景字符上限，与输入长度、问答上下文独立。',{min:1000,max:32000}),
  field('AI_MAX_INPUT_CHARS','ai','输入长度上限','number',8000,'字符。',{min:1}),
  field('AI_MAX_REPLY_CHARS','ai','回复长度上限','number',1800,'字符。',{min:1}),
  field('AI_ALLOWED_USERS','access','允许回复的好友 QQ','ids','','多个 QQ 号使用逗号分隔；留空不回复私聊。'),
  field('AI_ALLOWED_GROUPS','access','允许回复的群号','ids','','多个群号使用逗号分隔；留空不回复群聊。'),
  field('GROUP_BLOCKED_USERS','access','固定屏蔽群成员消息','textarea','','每行填写“群号:QQ号”，例如 1036914541:123456789；“*:QQ号”表示所有群。最多 500 条，也可用逗号分隔。命中后跳过 AI、消息插件、管理员指令、近期群聊背景和后台识图，@机器人也不会触发。私聊不受影响；保存后即时生效，清空规则可解除屏蔽。'),
  field('AI_GROUP_REQUIRE_AT','access','群聊仅在被 @ 时回复','boolean',true,'开启后，群白名单中的消息仍需 @机器人。'),
  field('BOT_ADMIN_IDS','access','聊天管理员 QQ ID','ids','','多个 QQ 号用逗号分隔。只有这些账号可使用聊天 / 指令；留空禁用全部 / 指令。插件会话范围仍需匹配，保存后即时生效。'),
  field('BOT_PROMPT_OWNER_IDS','access','角色卡专属称呼的主人 QQ','ids','','多个 QQ 号用逗号分隔。只有这些账号会沿用 AI 系统提示词或人格里写的专属称呼；其他成员一律按 QQ 昵称称呼，不能改称主人。留空时等同聊天管理员；两者都留空则无人享有专属称呼。保存后即时生效。'),
  field('QQ_DRIVER','qq','QQ 驱动','text','kernel','kernel：官方内核；native：实验协议；demo：模拟；也可填自定义 .mjs 路径。'),
  field('QQ_ACCOUNT','qq','登录 QQ 号','number',0,'0 表示由扫码登录确定。',{min:0}),
  field('QQ_RUNTIME_DIR','qq','官方 QQ 运行目录','text','./runtime/qq','已准备的 QQNT 程序目录。'),
  field('QQ_RUNTIME_SOURCE','qq','运行时来源','text','download','download：首次启动从 QQ 官方下载安装包并校验腾讯签名；local：复制本机已安装的 QQ。仅在还没有运行时时生效。'),
  field('QQ_KERNEL_DIR','qq','宿主桥接目录','text','./runtime/kernel','构建生成的内核桥接所在目录。'),
  field('QQ_KERNEL_DATA','qq','QQ 内核数据目录','text','./data/qq-kernel','保存官方内核的账号和缓存数据。'),
  field('QQ_RPC_TIMEOUT_MS','qq','驱动调用超时','number',15000,'毫秒。',{min:10}),
  field('QQ_STARTUP_TIMEOUT_MS','qq','驱动启动超时','number',90000,'毫秒；单独覆盖运行文件校验与内核加载，不延长普通请求或发送超时。',{min:10,max:150000}),
  field('QQ_SHUTDOWN_TIMEOUT_MS','qq','内核退出等待','number',5000,'毫秒；超时后强制停止宿主。',{min:100,max:20000}),
  field('MEDIA_MAX_BYTES','qq','图片大小上限','number',10485760,'字节；限制单张图片及同条消息图片总量，默认 10 MiB。',{min:1024,max:52428800}),
  field('MEDIA_TIMEOUT_MS','qq','图片收发超时','number',90000,'毫秒；包含读取、下载、上传与终态确认。',{min:1000,max:300000}),
  field('MEDIA_CACHE_DAYS','storage','收发图片缓存保留','number',7,'天；控制 media-inbox 和 media-outbox，自动清理到期图片。',{min:1,max:365}),
  field('MEDIA_BASE_URL','connection','图片访问地址','url','','留空自动使用 OneBot 本机地址。AstrBot 在其他主机或容器时，填其能访问的 HTTP(S) 域名或 IP 与端口，不含路径。图片链接仅授权读取对应图片。'),
  field('HOST','connection','OneBot 监听地址','text','127.0.0.1','127.0.0.1 仅本机；0.0.0.0 监听全部 IPv4 网卡。'),
  field('PORT','connection','OneBot 端口','number',5700,'0 表示自动分配端口；工作台使用独立本机端口。',{min:0,max:65535}),
  field('ONEBOT_MAX_REQUEST_BYTES','connection','OneBot 请求大小上限','number',16777216,'字节；HTTP / WS 共用，Base64 图片约为原图的 4/3。默认 16 MiB。',{min:1048576,max:134217728}),
  field('ONEBOT_ACCESS_TOKEN','connection','OneBot 访问 Token','secret','','至少 24 字符，供插件使用。'),
  field('ADMIN_ACCESS_TOKEN','connection','管理员 Token','secret','','至少 24 字符，必须与插件 Token 不同。'),
  field('QZONE_ALLOW_COOKIE_EXPORT','connection','允许 AstrBot 获取空间 Cookie','boolean',false,'开启后，持有 OneBot Token 的插件可通过 get_cookies 获取已保存的空间 Cookie，仅支持 user.qzone.qq.com 和 qzone.qq.com。用于 AstrBot QQ 空间插件；保存后即时生效。'),
  field('HEARTBEAT_MS','connection','心跳间隔','number',30000,'毫秒。',{min:100}),
  field('REVERSE_WS_URLS','connection','反向 WebSocket 地址','textarea','','ws:// 或 wss://，多个地址使用逗号分隔。'),
  field('REVERSE_WS_TOKEN','connection','反向 WS Token','secret','','未设置时使用 OneBot Token。'),
  field('WEBHOOK_URL','connection','Webhook 地址','url','','HTTP(S) 事件推送地址；留空关闭。'),
  field('WEBHOOK_SECRET','connection','Webhook 签名密钥','secret','','用于事件请求的 HMAC 签名。'),
  field('AI_CONCURRENCY','queue','AI 会话并发数','number',4,'不同会话可并行，同一会话始终按顺序处理。',{min:1,max:16}),
  field('AI_MAX_ATTEMPTS','queue','AI 生成尝试次数','number',3,'包含首次请求。',{min:1,max:10}),
  field('SEND_INTERVAL_MS','queue','全局发送间隔','number',1500,'毫秒。',{min:0}),
  field('SESSION_INTERVAL_MS','queue','同会话发送间隔','number',3000,'毫秒。',{min:0}),
  field('SEND_CONCURRENCY','queue','发送并发数','number',4,'不同会话最多同时发送的数量。',{min:1,max:16}),
  field('MAX_PENDING_SENDS','queue','待发送上限','number',1000,'达到上限后拒绝新增发送。',{min:1,max:10000}),
  field('SEND_MAX_ATTEMPTS','queue','发送尝试次数','number',5,'包含首次发送；结果未知的任务不会自动重发。',{min:1,max:16}),
  field('JOB_MAX_AGE_MS','queue','任务最长等待','number',600000,'毫秒；超过此时间的任务不再发送。',{min:1000}),
  field('MAX_PENDING_JOBS','queue','待处理任务上限','number',1000,'包含发送结果未知的任务。',{min:1}),
  field('DATA_DIR','storage','机器人数据目录','text','./data','SQLite 队列、历史和加密会话所在目录。'),
  field('HISTORY_RETENTION_DAYS','storage','消息与历史保留','number',0,'天；0 表示永久保留任务、上下文、显式记忆和 OneBot 消息查询缓存。模型请求及响应档案永久保留；页面消息与日志另用 1000 条进程内缓冲。',{min:0}),
  field('RETAIN_IGNORED_JOB_CONTENT','storage','保留忽略任务正文','boolean',false,'关闭时只保留任务防重与身份信息；下次启动会脱敏既有 ignored 任务正文、输入和回复。脱敏不可恢复，重新开启此开关也无法恢复旧正文。开启时按消息与历史保留天数保存全文。此开关不控制群聊上下文缓存、OneBot 查询缓存、页面 1000 条内存缓冲或 QQ / AstrBot 自身数据。'),
  field('UNCERTAIN_RETENTION_DAYS','storage','结果未知任务保留','number',30,'天；到期清理前应人工核对。',{min:1,max:3650}),
  field('SESSION_KEY','storage','会话加密密钥','secret','','64 位十六进制。替换后旧加密会话无法读取，需重新扫码。'),
  field('QQ_SERVER_HOST','advanced','QQ 协议服务器','text','msfwifi.3g.qq.com','native 驱动使用。'),
  field('QQ_SERVER_PORT','advanced','QQ 协议端口','number',8080,'native 驱动使用。',{min:1,max:65535}),
  field('QQ_PROFILE','advanced','协议 Profile 路径','text','','留空使用内置研究 Profile。'),
  field('QQ_SIGN_URL','advanced','签名服务地址','url','','受信任的 HTTP(S) 签名端点，需匹配 QQ 版本。'),
  field('QQ_SIGN_TOKEN','advanced','签名服务 Token','secret','','签名端点的访问凭据。'),
  field('QQ_7ZIP','qq','7-Zip 程序路径','text','','留空使用 C:/Program Files/7-Zip/7z.exe；下载解包时使用。'),
  field('MARKET_CATALOG_URL','market','市场清单地址','text','','指向市场 index.json 的完整地址，支持 https（本机调试可用 127.0.0.1）。留空时用便携包自带的离线清单（resources/app/market/，连插件包一起离线安装）；既没配置也没带清单时市场页才提示未配置。保存后即时生效。'),
  field('MARKET_ALLOWED_HOSTS','market','允许下载的域名','text','','逗号分隔的主机名。留空时只允许清单所在域名；填了以后清单里的包与资源也只能来自这些域名。'),
  field('MARKET_REDIRECT_HOSTS','market','允许跳转的域名','text','','逗号分隔的主机名，最多允许 3 跳。留空时只放行 GitHub 的资产域名（release-assets.githubusercontent.com 等）；Release 下载会跳到这里。'),
  field('MARKET_TIMEOUT_MS','market','下载超时','number',30000,'毫秒；安装插件包与媒体资源的单次下载上限。',{min:1000,max:600000}),
  field('MARKET_MAX_PACKAGE_BYTES','market','插件包大小上限','number',33554432,'字节；默认 32 MiB，与手动导入 ZIP 的上限一致。',{min:1024,max:33554432})
];
const keys = new Set(fields.map(f => f.key));
const defaults = Object.fromEntries(fields.map(f => [f.key, f.default]));
function fallbackEnvironment(c) {
  return { ...defaults, HOST:c.host, PORT:String(c.port), ONEBOT_ACCESS_TOKEN:c.token, ADMIN_ACCESS_TOKEN:c.adminToken,
    SESSION_KEY:c.sessionKey, DATA_DIR:c.dataDir, QQ_DRIVER:c.driver, QQ_ACCOUNT:String(c.account),
    QQ_RUNTIME_SOURCE:c.kernel?.source || 'download',
    QZONE_ALLOW_COOKIE_EXPORT:String(c.qzone?.allowCookieExport === true), BOT_ADMIN_IDS:[...(c.adminIds || [])].join(','), BOT_PROMPT_OWNER_IDS:[...(c.promptOwnerIds || [])].join(','),
    GROUP_BLOCKED_USERS:[...(c.blockedGroupUsers||[])].flatMap(([group,users])=>[...users].map(user=>group+':'+user)).join('\n'),
    AGENT_ENABLED:String(c.agent?.enabled ?? true), AGENT_MAX_STEPS:String(c.agent?.maxSteps ?? 8),
    AGENT_MAX_TOOL_CALLS:String(c.agent?.maxToolCalls ?? 16), AGENT_TIMEOUT_MS:String(c.agent?.timeout ?? 300000),
    COMPUTER_ENABLED:String(c.computer?.enabled ?? false), COMPUTER_DESKTOP_ENABLED:String(c.computer?.desktop ?? true),
    COMPUTER_SHELL_ENABLED:String(c.computer?.shell ?? false), COMPUTER_QQ_ADMIN_ENABLED:String(c.computer?.qq ?? false),
    COMPUTER_ROOTS:(c.computer?.roots || ['./workspace']).join('\n'), COMPUTER_COMMAND_TIMEOUT_MS:String(c.computer?.commandTimeout ?? 15000),
    AI_ENABLED:String(c.ai.enabled), AI_STRIP_EMOJI:String(c.ai.stripEmoji !== false), AI_SEGMENTED_REPLY_ENABLED:String(c.ai.segmentedReply!==false), AI_MODEL:c.ai.model, AI_API_KEY:c.ai.apiKey, AI_BASE_URL:c.ai.baseUrl,
    AI_ALLOWED_USERS:[...c.ai.allowedUsers].join(','), AI_ALLOWED_GROUPS:[...c.ai.allowedGroups].join(',') };
}
function revision(text) { return createHash('sha256').update(text).digest('hex'); }
function encode(value) {
  if (!value.startsWith(encodedPrefix)) {
    for (const quote of ['"', "'", '`']) if (!value.includes(quote)) return quote + value + quote;
  }
  // Node's dotenv parser has no quote escaping. Encode only values that
  // cannot be represented literally; loadConfig decodes this single layer.
  return '"'+encodedPrefix+Buffer.from(value,'utf8').toString('base64')+'"';
}
export class Settings {
  constructor(config, { path, lockedKeys = [] } = {}) {
    this.path = path;
    this.lockedKeys = lockedKeys.filter(key => keys.has(key));
    const original = environmentOf(config) || fallbackEnvironment(config);
    this.active = { ...defaults, ...Object.fromEntries(Object.entries(original).filter(([key]) => keys.has(key))) };
    this.memory = { ...this.active }; this.busy = false;
  }
  async source() {
    if (!this.path) return { values: this.memory, text: JSON.stringify(this.memory) };
    const text = await readFile(this.path, 'utf8');
    return { text, values: decodeEnvironment(parseEnv(text)) };
  }
  async environment() {
    const { values } = await this.source();
    return { ...this.active, ...values, ...Object.fromEntries(this.lockedKeys.map(key => [key, this.active[key]])) };
  }
  async snapshot() {
    const source = await this.source(), values = { ...this.active, ...source.values,
      ...Object.fromEntries(this.lockedKeys.map(key => [key, this.active[key]])) };
    return { groups, fields, revision: revision(source.text), persistent: !!this.path,
      values: Object.fromEntries(fields.map(f => [f.key, f.type === 'secret' ? '' : values[f.key]])),
      secrets: Object.fromEntries(fields.filter(f => f.type === 'secret').map(f => [f.key, !!values[f.key]])),
      locked: this.lockedKeys, pending: fields.filter(f => String(values[f.key]) !== String(this.active[f.key])).map(f => f.key) };
  }
  async save(patch, expected) {
    if (this.busy) throw Object.assign(new Error('配置正在保存，请稍后重试。'), { status:409 });
    this.busy = true;
    try {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('配置必须是键值对象。');
      const source = await this.source();
      if (expected !== revision(source.text)) throw Object.assign(new Error('配置已被其他窗口修改，请重新加载后再保存。'), { status:409 });
      for (const [key, value] of Object.entries(patch)) {
        if (!keys.has(key) || typeof value !== 'string' || value.length > 64000 || value.includes('\0')) throw new Error('未知配置项或无效配置值：' + key);
        if (this.lockedKeys.includes(key)) throw new Error(key + ' 由启动环境变量覆盖，请先移除该环境变量。');
        const f = fields.find(f => f.key === key);
        if (f.type === 'number' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error(key + ' 必须是非负整数。');
        if (['HOST','QQ_DRIVER','DATA_DIR','QQ_RUNTIME_DIR','QQ_KERNEL_DIR','QQ_KERNEL_DATA','QQ_SERVER_HOST'].includes(key) && !value.trim()) throw new Error(key + ' 不能为空。');
      }
      const values = { ...source.values, ...patch }, effective = { ...this.active, ...values };
      loadConfig(effective);
      if (this.path) {
        const text = '# Managed by '+PROJECT_NAME+'. Most changes apply immediately; the few startup-only keys take effect after a restart.\n' + Object.entries(values).map(([key,value]) => key + '=' + encode(value)).join('\n') + '\n';
        const parsed = decodeEnvironment(parseEnv(text));
        if (Object.entries(values).some(([key,value]) => parsed[key] !== value)) throw new Error('无法无损保存配置，请检查引号与换行。');
        const temporary = this.path + '.' + randomUUID() + '.tmp';
        try { await writeFile(temporary, text, { mode:0o600, flag:'wx' }); await rename(temporary, this.path); }
        finally { await unlink(temporary).catch(() => {}); }
      } else this.memory = values;
      return this.snapshot();
    } finally { this.busy = false; }
  }
  // 配置就地生效后，把已应用的键写回 active，令 snapshot().pending 只保留仍需重启的项。
  adopt(values, applied = []) {
    for (const key of applied) if (key in defaults) this.active[key] = values[key] ?? defaults[key];
    return this.active;
  }
  async reveal(key) {
    if (!fields.some(f => f.key === key && f.type === 'secret')) throw new Error('未知密钥项。');
    return { key, value:(await this.environment())[key] };
  }
  async models(params) {
    const saved = await this.environment();
    const base = params.AI_BASE_URL ?? saved.AI_BASE_URL, key = params.AI_API_KEY ?? saved.AI_API_KEY;
    if (typeof base!=='string' || typeof key!=='string') throw new Error('模型服务地址或密钥格式无效。');
    let url;
    try { url = new URL(base.replace(/\/$/,'')+'/models'); }
    catch { throw new Error('请输入完整的 HTTP(S) 模型服务地址。'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('模型服务地址必须为 HTTP(S)，不能在地址内填写凭据。');
    let response;
    try { response = await fetch(url, { headers:key?{ Authorization:'Bearer '+key }:{}, redirect:'error', signal:AbortSignal.timeout(10000) }); }
    catch { throw new Error('无法连接模型服务，请检查地址、网络和服务状态。'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error('模型服务返回 HTTP '+response.status+'，请检查地址和 API Key。'); }
    const chunks=[]; let size=0;
    for await (const chunk of response.body) { size+=chunk.length; if(size>262144)throw new Error('模型列表响应过大。'); chunks.push(chunk); }
    let data;
    try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('模型服务未返回有效 JSON。'); }
    if(!Array.isArray(data.data))throw new Error('该服务未提供兼容的模型列表；仍可手动填写模型标识。');
    return { models:data.data.map(model=>model.id).filter(id=>typeof id==='string').slice(0,200) };
  }
}
