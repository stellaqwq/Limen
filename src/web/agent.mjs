export { agentPanel, agentStyles } from './agent-ui.mjs';

export const agentClient = String.raw`
let agentTab='devices',agentReturnView='overview';
const agentEmptyState=$('agent-chat-feed').firstElementChild.cloneNode(true);
let agentSnapshot=null,agentLoading=false,agentEditing=null,agentDirty=false,agentSaving=false,agentSession='',agentMemoryTicket=0,agentBindingDirty=false;
let agentMemoryEdit=null;
let agentChatSession='',agentChatBusy=false,agentChatPending=false,agentChatSignature='';
let agentChatStream=null,agentChatStreamSession='';
function agentWatchChat(){
  if(agentChatStreamSession===agentChatSession&&agentChatStream)return;
  agentChatStream?.close();agentChatStream=null;agentChatStreamSession=agentChatSession;
  if(!agentChatSession||!window.EventSource)return;
  const session=agentChatSession,source=new EventSource(base+'/agent/chat/stream?session='+encodeURIComponent(session));agentChatStream=source;
  source.onmessage=event=>{if(session!==agentChatSession)return;try{agentRenderChat(JSON.parse(event.data));}catch{}};
}
window.addEventListener('pagehide',()=>{agentChatStream?.close();agentChatStream=null;});
let agentChatUploading=false;const agentChatAttachments=[];
const agentFileSize=value=>value>=1048576?(value/1048576).toFixed(1)+' MiB':Math.max(1,Math.ceil(value/1024))+' KiB';
function agentRenderAttachments(){const box=$('agent-attachments');box.replaceChildren();box.hidden=!agentChatAttachments.length;for(const file of agentChatAttachments){const row=el('div','agent-attachment'),info=el('div','agent-attachment-info'),name=el('strong','',file.name);name.title=file.name;info.append(name,el('small','',(file.kind==='image'?'图片':file.kind==='video'?'视频':'文件')+' · '+agentFileSize(file.size)));if(file.preview){const image=el('img');image.src=file.preview;image.alt='待发送图片：'+file.name;row.append(image);}const remove=el('button','button small','移除');remove.type='button';remove.disabled=agentChatUploading||agentChatBusy;remove.setAttribute('aria-label','移除附件 '+file.name);remove.addEventListener('click',()=>{agentChatAttachments.splice(agentChatAttachments.indexOf(file),1);agentRenderAttachments();$('agent-attach').focus();});row.append(info,remove);box.append(row);}$('agent-attach').disabled=agentChatUploading||agentChatBusy;$('agent-chat-send').disabled=agentChatPending||agentChatBusy||agentChatUploading;const max=agentSnapshot?.attachments?.max_bytes||10485760;$('agent-attachment-limit').textContent=(agentChatAttachments.length?agentChatAttachments.length+'/4 个 · '+agentFileSize(agentChatAttachments.reduce((n,f)=>n+f.size,0))+' / ':'最多 4 个附件 · 合计 ')+agentFileSize(max);}
async function agentAddFiles(files){if(agentChatUploading||agentChatBusy)return;files=Array.from(files);if(!files.length)return;const max=agentSnapshot?.attachments?.max_bytes||10485760;if(files.length+agentChatAttachments.length>4){$('agent-chat-state').textContent='每条消息最多 4 个附件，请分批添加。';return;}if(files.reduce((n,f)=>n+f.size,0)+agentChatAttachments.reduce((n,f)=>n+f.size,0)>max){$('agent-chat-state').textContent='附件总大小不能超过 '+agentFileSize(max)+'，请分批发送。';return;}agentChatUploading=true;agentRenderAttachments();$('agent-chat-state').textContent='正在上传附件…';try{for(const file of files){if(!file.size)throw Error('“'+file.name+'”为空，请选择有内容的文件。');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取附件失败，请重新选择。'));reader.readAsDataURL(file);});const saved=await api('/agent/attachments',{name:file.name,data});agentChatAttachments.push({...saved,preview:saved.kind==='image'?'data:'+saved.mime+';base64,'+data.slice(data.indexOf(',')+1):''});}$('agent-chat-state').textContent='附件已准备好，可以添加问题后发送。';}catch(error){$('agent-chat-state').textContent=error.message;}finally{agentChatUploading=false;$('agent-attachment-input').value='';agentRenderAttachments();}}
$('agent-attach').addEventListener('click',()=>$('agent-attachment-input').click());$('agent-attachment-input').addEventListener('change',event=>{const files=Array.from(event.target.files);event.target.value='';void agentAddFiles(files);});
for(const name of ['dragenter','dragover'])$('agent-chat-form').addEventListener(name,event=>{if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;event.preventDefault();$('agent-chat-form').dataset.drag='true';});
$('agent-chat-form').addEventListener('dragleave',event=>{if(!$('agent-chat-form').contains(event.relatedTarget))delete $('agent-chat-form').dataset.drag;});$('agent-chat-form').addEventListener('drop',event=>{delete $('agent-chat-form').dataset.drag;if(!event.dataTransfer?.files.length)return;event.preventDefault();void agentAddFiles(event.dataTransfer.files);});
$('agent-chat-input').addEventListener('paste',event=>{if(!event.clipboardData?.files.length)return;event.preventDefault();void agentAddFiles(event.clipboardData.files);});
try{agentChatSession=localStorage.getItem('qq-agent-web-session')||'';}catch{}
$('agent-room-open').addEventListener('click',()=>{
  if(!agentChatSession){agentChatSession=crypto.randomUUID();try{localStorage.setItem('qq-agent-web-session',agentChatSession);}catch{}}
  const room=new URL('http://127.0.0.1:4177/');room.searchParams.set('source','qq');room.searchParams.set('session',agentChatSession);
  window.open(room.href,'_blank','noopener');
  $('agent-chat-state').textContent='房间跟随当前测试会话；请先启动本地 3D 房间服务。';
});
const agentRunStates={running:'执行中',completed:'生成完成',failed:'生成失败',interrupted:'执行已中断'};
const agentStepStates={running:'执行中',succeeded:'成功',cached:'复用既有结果',failed:'失败',uncertain:'结果未知',interrupted:'已中断'};
function agentOptions(node,items,first){const value=node.value;node.replaceChildren();const option=el('option','',first);option.value='';node.append(option);for(const item of items){const opt=el('option','',item.label);opt.value=item.id;node.append(opt);}if([...node.options].some(o=>o.value===value))node.value=value;}
function agentEdit(id){agentEditing=agentSnapshot?.personas.find(p=>p.id===id)||null;$('agent-persona-select').value=agentEditing?.id||'';$('agent-persona-name').value=agentEditing?.name||'';$('agent-persona-prompt').value=agentEditing?.prompt||'';$('agent-persona-tools').value=agentEditing?.tools==null?'*':agentEditing.tools.join(', ');agentDirty=false;$('agent-persona-state').textContent='';$('agent-delete-persona').disabled=!agentEditing;}
function renderAgent(){
  if(!agentSnapshot)return;const s=agentSnapshot;$('agent-chat-model').textContent=s.model||'尚未配置模型';agentRenderAttachments();
  renderComputer(s.computer);renderAndroid(s.android);renderDouyin(s.douyin_web);
  $('agent-status').textContent=(!s.ai_enabled?'AI 尚未启用 · 请先设置模型和回复白名单':!s.enabled?'Agent 已关闭 · 当前使用传统 AI 回复':'Agent 已启用 · '+s.model)+' · 最多 '+s.max_steps+' 次模型请求 / '+s.max_tool_calls+' 次工具调用';
  agentOptions($('agent-session'),s.sessions.map(x=>({id:x.conversation,label:(x.conversation.startsWith('web:')?'网页试聊 · '+x.conversation.slice(-8):(x.conversation.split(':')[1]==='group'?'群聊 · ':'私聊 · QQ ')+x.conversation.split(':')[2])+' · '+x.jobs+' 条任务'})),'选择会话');
  if(!agentSession&&s.sessions.length)agentSession=s.sessions[0].conversation;$('agent-session').value=agentSession;
  agentOptions($('agent-binding'),s.personas.map(p=>({id:p.id,label:p.name})),'默认人格 · 使用 AI 系统提示词');
  const session=s.sessions.find(x=>x.conversation===agentSession);if(!agentBindingDirty)$('agent-binding').value=session?.persona||'';
  $('agent-bind').disabled=!session;$('agent-reset').disabled=!session;
  agentOptions($('agent-persona-select'),s.personas.map(p=>({id:p.id,label:p.name})),'新建人格');
  if(!agentDirty&&!agentSaving)agentEdit(agentEditing?.id||'');
  $('agent-tool-list').replaceChildren();for(const tool of s.tools){const row=el('div','agent-tool');row.append(el('code','',tool.name),badge(tool.source+(tool.enabled===false?' · 已停用':'')),el('p','',tool.description));$('agent-tool-list').append(row);}
  const runs=$('agent-runs'),old=new Set([...runs.querySelectorAll('details[open]')].map(d=>d.dataset.run));runs.replaceChildren();
  if(!s.runs.length)empty(runs,'等待第一条任务','连接 QQ、启用 AI 并设置回复范围后，即可在 QQ 中自然描述任务。');
  for(const run of s.runs){const details=el('details','agent-run');details.dataset.run=String(run.job_id);const summary=el('summary');summary.append(el('strong','','#'+run.job_id+' · '+run.persona),badge(agentRunStates[run.state]||run.state,run.state==='failed'?'bad':run.state==='completed'?'ok':''),el('span','muted',dateTime(run.updated_at)),el('span','muted','回复：'+(statusLabels[run.job_status]||run.job_status)));const body=el('div');details.append(summary,body);const load=async()=>{body.replaceChildren(el('p','help-text','正在读取执行过程…'));try{const job=await api('/job?id='+run.job_id);body.replaceChildren();const list=el('ol','agent-trace');for(const step of job.agent_steps||[]){const item=el('li');item.append(document.createTextNode((step.kind==='tool'?'工具 · ':'')+step.name+' · '+(agentStepStates[step.state]||step.state)+' '),el('small','',step.duration_ms+' ms'));list.append(item);}body.append(list,el('pre','',formatJobDetail({...job,agent_steps:[]})));}catch(error){body.replaceChildren(el('p','stream-error',error.message));}};details.addEventListener('toggle',()=>{if(details.open)void load();});runs.append(details);if(old.has(details.dataset.run))details.open=true;}
}
let computerPreviewBusy=false,computerControlBusy=false;
function renderComputer(c){
  if(!c)return;
  $('agent-computer-status').textContent=!c.enabled?'尚未启用 · 在本机设置中开放文件或桌面能力':c.paused?'已紧急停止 · 核对已发生的操作后，可恢复并发起新任务':(c.busy_job?'任务 #'+c.busy_job+' 正在使用本机':'已就绪')+' · 文件访问'+(c.desktop?' / 桌面控制':'')+(c.shell?' / 命令执行':'')+(c.qq_admin?' · 网页与管理员私聊':' · 仅网页对话');
  $('agent-computer-stop').disabled=!c.enabled||c.paused||computerControlBusy;
  $('agent-computer-resume').hidden=!c.paused;$('agent-computer-resume').disabled=computerControlBusy;
  $('agent-computer-preview').disabled=!c.desktop||c.paused||computerPreviewBusy;
  if(c.paused||!c.enabled){$('agent-computer-image').removeAttribute('src');$('agent-computer-screen').hidden=true;}
}
for(const [id,action] of [['agent-computer-stop','stop'],['agent-computer-resume','resume']])$(id).addEventListener('click',async()=>{
  if(computerControlBusy)return;computerControlBusy=true;renderComputer(agentSnapshot?.computer);
  try{const c=await api('/agent/computer/control',{action});if(agentSnapshot)agentSnapshot.computer=c;renderComputer(c);$('agent-computer-message').textContent=action==='stop'?'已请求停止本机操作。正在执行的操作可能已经生效，请核对；停止状态会在重启后保留。':'已恢复本机能力。之前的任务不会续做，请发送新的请求。';}
  catch(error){$('agent-computer-message').textContent=error.message;}
  finally{computerControlBusy=false;renderComputer(agentSnapshot?.computer);}
});
$('agent-computer-preview').addEventListener('click',async()=>{
  if(computerPreviewBusy)return;computerPreviewBusy=true;renderComputer(agentSnapshot?.computer);$('agent-computer-message').textContent='正在获取桌面截图…';
  try{const data=await api('/agent/computer/screenshot',{});if(agentSnapshot?.computer?.paused)return;$('agent-computer-image').src=data.image;$('agent-computer-screen').hidden=false;$('agent-computer-caption').textContent='桌面快照 · '+new Date().toLocaleTimeString()+' · '+(data.foreground?.title||'无前台窗口');$('agent-computer-message').textContent='截图按需获取；再次点击“查看桌面”可刷新。';}
  catch(error){$('agent-computer-message').textContent=error.message;}
  finally{computerPreviewBusy=false;renderComputer(agentSnapshot?.computer);}
});
$('agent-computer-hide').addEventListener('click',()=>{$('agent-computer-image').removeAttribute('src');$('agent-computer-screen').hidden=true;});

let socialBusy=false,socialReferences=null;const socialPreparations=new Map();
const socialSurface=()=>$('agent-social-kind').value==='share_video'?'share':'messages';
async function loadDouyinSocial(clear=true){
  try{const s=await api('/agent/social');if(clear)problem('agent-social-error',null);$('agent-social-status').textContent=s.enabled?(s.browse_share_enabled?'分享与私信已启用 · 刷视频时可自动分享给默认好友':s.auto_chat?.enabled?'分享与私信已启用 · 默认好友自动聊天已开启':'分享与私信已启用 · 手动草稿由你确认发送'):'分享与私信未启用 · 请在社交设置中开启';
    $('agent-auto-chat-status').textContent=s.auto_chat?.listening_enabled||s.auto_chat?.enabled?'默认好友消息监听：'+s.auto_chat.message:'默认好友消息监听未开启';const f=s.default_friend||{};$('agent-social-default-status').textContent=f.configured?'默认好友：'+f.requested+(f.bound?' · 已绑定 '+f.name:' · 待核对身份'):'尚未设置默认好友';
    for(const id of ['agent-chat-default-open','agent-chat-default-read','agent-chat-default-reply'])$(id).disabled=!s.enabled||!f.configured||socialBusy||(id!=='agent-chat-default-open'&&!f.chat_enabled);
    for(const id of ['agent-social-open','agent-social-contacts','agent-social-create','agent-social-default'])$(id).disabled=!s.enabled||socialBusy;
    const root=$('agent-social-drafts');root.replaceChildren();if(!s.drafts.length){empty(root,'还没有待发送草稿','选择好友并保存草稿，或在测试对话中让模型为指定好友准备分享和私信。');return;}
    const names={draft:'草稿',prepared:'待确认发送',sending:'正在提交',sent:'已人工核对送达',uncertain:'需在抖音核对',cancelled:'已取消'};
    for(const d of s.drafts){const row=el('article','agent-social-draft');row.dataset.id=d.id;row.append(el('h3','',(d.kind==='share_video'?'分享视频给 ':'私信给 ')+d.recipient),badge(names[d.status]||d.status),el('p','help-text','发送账号：'+d.account),el('p','agent-social-content',d.content||'（无附言）'));
      if(d.source)row.append(el('p','help-text',d.source.video_id?'视频 ID：'+d.source.video_id:'分享当前页面的视频，准备后请在快照中核对内容。'));
      if(d.reason)row.append(el('p','help-text',d.reason));const prepared=socialPreparations.get(d.id);if(prepared&&prepared.revision!==d.revision)socialPreparations.delete(d.id);
      const current=socialPreparations.get(d.id);if(current?.image){const figure=el('figure'),img=el('img');img.src=current.image;img.alt='待发送页面快照';figure.append(el('figcaption','','请核对账号、好友、内容和视频，再确认发送。'),img);row.append(figure);}
      const actions=el('div','inline-actions');const add=(label,action,primary=false)=>{const button=el('button','button'+(primary?' primary':''),label);button.type='button';button.disabled=socialBusy;button.onclick=async()=>{
        if(socialBusy)return;socialBusy=true;button.disabled=true;problem('agent-social-error',null);
        try{const r=await api('/agent/social/action',{id:d.id,revision:d.revision,action,...(action==='send'?{confirmation_token:socialPreparations.get(d.id)?.token}: {})});
          if(r.confirmation_token)socialPreparations.set(d.id,{token:r.confirmation_token,revision:r.draft.revision,image:r.image});else socialPreparations.delete(d.id);
        }catch(error){problem('agent-social-error',error);}finally{socialBusy=false;await loadDouyinSocial(false);}
      };actions.append(button);};
      if(d.status==='draft'||d.status==='prepared'){add(d.status==='prepared'?'重新准备':'准备并核对','prepare');if(d.status==='prepared'&&current)add('确认发送给 '+d.recipient,'send',true);add('取消草稿','cancel');}
      if(d.status==='uncertain'){add('已核对：已送达','resolve_sent');add('已核对：未送达','resolve_cancelled');}
      row.append(actions);root.append(row);
    }
  }catch(error){problem('agent-social-error',error);}
}
$('agent-social-refresh').addEventListener('click',()=>void loadDouyinSocial());
$('agent-social-settings').addEventListener('click',async()=>{try{navigate('plugins');await loadPlugins();await openPluginFromHub('douyin-web');}catch(error){problem('agent-social-error',error);}});
$('agent-social-kind').addEventListener('change',()=>{socialReferences=null;$('agent-social-recipient').replaceChildren(el('option','','请重新读取对应面板联系人'));});
for(const [id,path] of [['agent-social-open','open'],['agent-social-contacts','inspect']])$(id).addEventListener('click',async()=>{
  if(socialBusy)return;socialBusy=true;problem('agent-social-error',null);
  try{const data=await api('/agent/social/'+path,{surface:socialSurface()});if(path==='inspect'){socialReferences=data;const select=$('agent-social-recipient');select.replaceChildren();for(const c of data.contacts){const option=el('option','',c.name+' · '+String(c.identifier).slice(-18));option.value=c.recipient_ref;select.append(option);}if(data.default_friend?.recipient_ref)select.value=data.default_friend.recipient_ref;if(!data.contacts.length)select.append(el('option','','没有可确认的单个好友，请检查抖音面板。'));$('agent-social-status').textContent='已读取 '+data.contacts.length+' 位好友 · '+data.account+' · 未读取聊天历史';}else $('agent-social-status').textContent='已请求打开抖音面板，请检查专用浏览器后读取联系人。';}
  catch(error){problem('agent-social-error',error);}finally{socialBusy=false;}
});
$('agent-social-form').addEventListener('submit',async event=>{
  event.preventDefault();if(socialBusy)return;socialBusy=true;problem('agent-social-error',null);
  try{await api('/agent/social/draft',{kind:$('agent-social-kind').value,recipient_ref:$('agent-social-recipient').value,content:$('agent-social-content').value,source_ref:socialReferences?.source_ref||undefined});$('agent-social-content').value='';await loadDouyinSocial();}
  catch(error){problem('agent-social-error',error);}finally{socialBusy=false;await loadDouyinSocial(false);}
});
$('agent-social-default').addEventListener('click',async()=>{
  if(socialBusy)return;socialBusy=true;try{await api('/agent/social/default',{recipient_ref:$('agent-social-recipient').value});}catch(error){problem('agent-social-error',error);}finally{socialBusy=false;await loadDouyinSocial(false);}
});
for(const [id,path] of [['agent-chat-default-open','open'],['agent-chat-default-read','chat'],['agent-chat-default-reply','reply']])$(id).addEventListener('click',async()=>{
  if(socialBusy)return;socialBusy=true;problem('agent-social-error',null);$('agent-chat-default-status').textContent=path==='reply'?'模型正在读取会话并拟回复…':'正在处理…';await loadDouyinSocial(false);
  try{const r=await api('/agent/social/'+path,path==='open'?{surface:'messages',select_default:true}:{});
    if(path==='chat'){const root=$('agent-chat-default-messages');root.replaceChildren();for(const m of r.messages){const row=el('article','agent-chat-message');row.dataset.role=m.direction==='self'?'user':'assistant';row.append(el('strong','',m.direction==='self'?'我':m.direction==='peer'?r.recipient:'方向未确认'),el('p','',m.text||'（附件，未下载）'));root.append(row);}$('agent-chat-default-status').textContent='已读取 '+r.recipient+' 的 '+r.messages.length+' 条最近可见消息';}
    else if(path==='reply'){let completed=false;for(let i=0;i<90;i++){await new Promise(resolve=>setTimeout(resolve,1000));const job=await api('/job?id='+encodeURIComponent(r.job_id));if(['done','failed','uncertain','ignored'].includes(job.status)){$('agent-chat-default-status').textContent=job.reply||job.reason||'任务已结束，请核对下方草稿';completed=true;break;}}if(!completed)$('agent-chat-default-status').textContent='任务仍在运行，可在任务队列查看；不会自动发送。';}
    else $('agent-chat-default-status').textContent='已选择默认好友会话，可读取最近消息。';
  }catch(error){problem('agent-social-error',error);$('agent-chat-default-status').textContent='操作未完成，请检查上方提示。';}finally{socialBusy=false;await loadDouyinSocial(false);}
});
let knowledgeBusy=false;
async function loadVideoKnowledge(){
  if(knowledgeBusy)return;knowledgeBusy=true;$('agent-knowledge-refresh').disabled=true;
  try{const q=$('agent-knowledge-query').value,show=$('agent-knowledge-archived').checked;const s=await api('/agent/knowledge?query='+encodeURIComponent(q)+'&archived='+(show?'1':'0'));problem('agent-knowledge-error',null);
    $('agent-knowledge-status').textContent=(s.enabled?'知识库已启用'+(s.auto_archive?' · 观看后自动归档':' · 按需保存'):'知识库未启用 · 在学习设置中开启')+' · 有效笔记 '+s.count+' / '+s.max_entries;
    const root=$('agent-knowledge-list');root.replaceChildren();if(!s.items.length){empty(root,q?'没有找到相关笔记':'还没有视频笔记',q?'换个关键词试试。':'开启知识库后，让 Agent 观看视频，它会保存带采样来源的观看记忆和知识笔记。');return;}
    for(const item of s.items){const row=el('details','agent-knowledge-entry'),title=el('summary');row.dataset.id=item.id;title.append(el('strong','',item.title),badge(item.kind==='knowledge_note'?'知识笔记':'观看记忆'),badge(item.status==='archived'?'已归档':'未核实'));
      row.append(title,el('p','agent-knowledge-summary',item.summary));const source=el('div','agent-knowledge-source'),link=el('a','',item.source.video_id?'查看原视频':'查看抖音推荐页');link.href=item.source.url;link.target='_blank';link.rel='noopener noreferrer';
      const audioLabels={transcribed:'已转写对白',no_speech:'已采样音频，未识别出对白',unconfigured:'语音转写未配置',capture_restricted:'音轨采集受限',unsupported:'当前音轨无法采集',capture_failed:'音轨采集失败',too_large:'音轨超过采集大小限制',empty:'未采集到有效音轨',no_audio_track:'播放器没有可采集音轨',blocked:'页面被阻挡，未采用音轨',paused:'播放器暂停，未采集音频',transcription_failed:'音频转写失败',source_changed:'音频来源变化，未采用',redacted:'转写含敏感格式，未保留'};
      const observations=item.source.observations||[],times=observations.flatMap(o=>o.samples||[]).map(s=>s.video_seconds).filter(t=>t!==null&&t!==undefined);source.append(link,document.createTextNode(' · '+(item.source.video_id?'视频来源已定位':'仅保存推荐页快照，未定位原视频')+' · '+dateTime(item.updated_at)),el('p','',observations.length+' 批画面采样'+(times.length?' · 视频位置 '+times.slice(0,12).map(t=>t+'s').join('、'):'')+' · '+(audioLabels[item.source.audio_status]||'仅画面，未采集音频')),el('p','',item.source.limitations),el('p','',item.tags.join(' · ')));
      if(item.source.transcript){const t=item.source.transcript;source.append(el('p','','对白转写（'+(t.video_start_seconds??'未知')+' 秒起，采集 '+t.duration_seconds+' 秒，机器识别可能有误）：'),el('p','',t.text));}
      row.append(source);
      const actions=el('div','inline-actions'),button=el('button','button small',item.status==='archived'?'恢复笔记':'归档笔记');button.type='button';button.onclick=async()=>{button.disabled=true;try{await api('/agent/knowledge/action',{id:item.id,revision:item.revision,action:item.status==='archived'?'restore':'archive'});await loadVideoKnowledge();}catch(error){problem('agent-knowledge-error',error);}finally{button.disabled=false;}};actions.append(button);row.append(actions);root.append(row);
    }
  }catch(error){problem('agent-knowledge-error',error);}finally{knowledgeBusy=false;$('agent-knowledge-refresh').disabled=false;}
}
$('agent-knowledge-search').addEventListener('submit',event=>{event.preventDefault();void loadVideoKnowledge();});
$('agent-knowledge-refresh').addEventListener('click',()=>void loadVideoKnowledge());
$('agent-knowledge-archived').addEventListener('change',()=>void loadVideoKnowledge());
$('agent-knowledge-settings').addEventListener('click',async()=>{try{navigate('plugins');await loadPlugins();await openPluginFromHub('douyin-web');}catch(error){problem('agent-knowledge-error',error);}});
let douyinBusy=false,douyinControlBusy=false;
function renderDouyin(c){
  if(!c)return;
  $('agent-douyin-status').textContent=!c.enabled?'尚未启用 · 安装抖音网页浏览插件':c.paused?'已停止 · 核对浏览器后可恢复':(c.busy_job?'任务 #'+c.busy_job+' 正在使用网页':c.browser_open?'专用浏览器已打开':'专用浏览器尚未打开')+' · 每任务最多 '+c.max_videos+' 条'+(c.qq_private_enabled?' · 网页与 QQ 管理员私聊':' · 仅网页对话')+(c.knowledge_enabled?' · 视频知识库 '+c.knowledge_count+' 条':'')+(c.browse_share_enabled?' · 自动分享给默认好友':'')+((c.auto_chat?.listening_enabled||c.auto_chat?.enabled)?' · 消息监听：'+c.auto_chat.message:'');
  $('agent-douyin-open').disabled=!c.enabled||c.paused||douyinBusy;
  if(c.browsing?.active)$('agent-douyin-status').textContent+=' · '+(c.browsing.mode==='continuous'?'持续刷视频':'自主刷一会儿')+'：已采样 '+c.browsing.viewed+' 条，分享 '+c.browsing.shares+' 次 · '+c.browsing.message;
  $('agent-douyin-preview').disabled=!c.enabled||c.paused||!c.browser_open||douyinBusy;
  $('agent-douyin-stop').disabled=!c.enabled||c.paused||douyinControlBusy;
  $('agent-douyin-resume').hidden=!c.paused;$('agent-douyin-resume').disabled=douyinControlBusy;
  if(c.paused||!c.enabled){$('agent-douyin-image').removeAttribute('src');$('agent-douyin-screen').hidden=true;}
}
$('agent-douyin-settings').addEventListener('click',async()=>{try{navigate('plugins');await loadPlugins();await openPluginFromHub('douyin-web');}catch(error){$('agent-douyin-message').textContent=error.message;}});
for(const [id,action] of [['agent-douyin-stop','stop'],['agent-douyin-resume','resume']])$(id).addEventListener('click',async()=>{
  if(douyinControlBusy)return;douyinControlBusy=true;renderDouyin(agentSnapshot?.douyin_web);
  try{const c=await api('/agent/douyin/control',{action});if(agentSnapshot)agentSnapshot.douyin_web=c;renderDouyin(c);$('agent-douyin-message').textContent=action==='stop'?'已停止网页控制。已发出的动作可能生效，请核对页面；浏览器保留供手动处理。':'已恢复网页工具。之前的任务不会续做，请发起新任务。';}
  catch(error){$('agent-douyin-message').textContent=error.message;}
  finally{douyinControlBusy=false;renderDouyin(agentSnapshot?.douyin_web);}
});
for(const [id,path] of [['agent-douyin-open','open'],['agent-douyin-preview','screenshot']])$(id).addEventListener('click',async()=>{
  if(douyinBusy)return;douyinBusy=true;renderDouyin(agentSnapshot?.douyin_web);$('agent-douyin-message').textContent=path==='open'?'正在打开专用 Chrome 窗口…':'正在获取网页画面…';
  try{const d=await api('/agent/douyin/'+path,{});if(agentSnapshot?.douyin_web?.paused)return;if(d.ok===false)throw Error(d.error||'网页操作未完成，请检查专用浏览器。');
    if(d.image){$('agent-douyin-image').src=d.image;$('agent-douyin-screen').hidden=false;$('agent-douyin-caption').textContent='网页快照 · '+new Date().toLocaleTimeString();}
    $('agent-douyin-message').textContent=d.blocked?'网页要求登录或验证，请在专用浏览器中手动处理后发送新任务。':path==='open'?'专用浏览器已打开。请先完成需要的登录或验证，再从测试对话发起观看任务。':'截图只显示采样画面，没有音频。';await loadAgent();
  }catch(error){$('agent-douyin-message').textContent=error.message;}
  finally{douyinBusy=false;renderDouyin(agentSnapshot?.douyin_web);}
});
$('agent-douyin-hide').addEventListener('click',()=>{$('agent-douyin-image').removeAttribute('src');$('agent-douyin-screen').hidden=true;});
let androidPreviewBusy=false,androidControlBusy=false;
function renderAndroid(c){
  if(!c)return;
  $('agent-android-status').textContent=!c.enabled?'尚未启用 · 安装并配置安卓视频浏览插件':c.paused?'已停止 · 核对手机后可恢复':!c.configured?'请先配置 ADB 设备序列号':(c.busy_job?'任务 #'+c.busy_job+' 正在使用手机':'已配置 '+c.serial)+' · 每任务最多 '+c.max_videos+' 条 · 仅网页对话';
  $('agent-android-stop').disabled=!c.enabled||c.paused||androidControlBusy;
  $('agent-android-resume').hidden=!c.paused;$('agent-android-resume').disabled=androidControlBusy;
  $('agent-android-preview').disabled=!c.enabled||!c.configured||c.paused||androidPreviewBusy;
  if(c.paused||!c.enabled){$('agent-android-image').removeAttribute('src');$('agent-android-screen').hidden=true;}
}
$('agent-android-settings').addEventListener('click',async()=>{
  try{navigate('plugins');await loadPlugins();await openPluginFromHub('android-device');}
  catch(error){$('agent-android-message').textContent=error.message;}
});
for(const [id,action] of [['agent-android-stop','stop'],['agent-android-resume','resume']])$(id).addEventListener('click',async()=>{
  if(androidControlBusy)return;androidControlBusy=true;renderAndroid(agentSnapshot?.android);
  try{const c=await api('/agent/android/control',{action});if(agentSnapshot)agentSnapshot.android=c;renderAndroid(c);$('agent-android-message').textContent=action==='stop'?'已请求停止安卓操作。已发出的上滑可能生效，请核对手机；停止状态会保留。':'已恢复安卓工具。之前的任务不会续做，请发起新任务。';}
  catch(error){$('agent-android-message').textContent=error.message;}
  finally{androidControlBusy=false;renderAndroid(agentSnapshot?.android);}
});
$('agent-android-preview').addEventListener('click',async()=>{
  if(androidPreviewBusy)return;androidPreviewBusy=true;renderAndroid(agentSnapshot?.android);$('agent-android-message').textContent='正在获取手机画面…';
  try{const d=await api('/agent/android/screenshot',{});if(agentSnapshot?.android?.paused)return;$('agent-android-image').src=d.image;$('agent-android-screen').hidden=false;$('agent-android-caption').textContent='手机快照 · '+new Date().toLocaleTimeString();$('agent-android-message').textContent='截图按需获取，只显示画面，没有音频。';}
  catch(error){$('agent-android-message').textContent=error.message;}
  finally{androidPreviewBusy=false;renderAndroid(agentSnapshot?.android);}
});
$('agent-android-hide').addEventListener('click',()=>{$('agent-android-image').removeAttribute('src');$('agent-android-screen').hidden=true;});
async function loadAgent(){if(agentLoading||agentSaving)return;agentLoading=true;try{const next=await api('/agent');problem('agent-error',null);if(JSON.stringify(next)!==JSON.stringify(agentSnapshot)){agentSnapshot=next;renderAgent();if(agentSession)await loadAgentMemories(true);}await loadAgentChat();}catch(error){problem('agent-error',error);}finally{agentLoading=false;}}
function editAgentMemory(memory,row){
  if(agentMemoryEdit)return;
  const draft={...memory,dirty:false,saving:false};agentMemoryEdit=draft;++agentMemoryTicket;
  $('agent-session').disabled=true;for(const button of $('agent-memories').querySelectorAll('button'))button.disabled=true;
  const form=el('form','agent-memory-editor'),name=el('input'),value=el('textarea'),nameLabel=el('label','','记忆名称（最多 60 字符）'),valueLabel=el('label','','记忆内容（最多 500 字符）');
  form.setAttribute('aria-label','编辑已保存的记忆');name.id='agent-memory-name';name.maxLength=60;name.required=true;name.value=memory.key;nameLabel.htmlFor=name.id;
  value.id='agent-memory-value';value.maxLength=500;value.required=true;value.rows=5;value.value=memory.value;valueLabel.htmlFor=value.id;
  const actions=el('div','agent-memory-actions'),save=el('button','button primary','保存记忆'),cancel=el('button','button','取消'),state=el('p','help-text');
  save.id='agent-memory-save';save.type='submit';save.disabled=true;cancel.id='agent-memory-cancel';cancel.type='button';state.id='agent-memory-state';state.setAttribute('role','status');
  form.addEventListener('input',()=>{draft.dirty=name.value!==memory.key||value.value!==memory.value;save.disabled=!draft.dirty;state.textContent=draft.dirty?'有未保存的修改':'';state.className='help-text';});
  cancel.addEventListener('click',()=>{if(draft.saving)return;agentMemoryEdit=null;$('agent-session').disabled=false;void loadAgentMemories();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(draft.saving||!draft.dirty)return;
    if(!name.value.trim()||!value.value.trim()){state.className='stream-error';state.textContent='记忆名称和内容不能为空。';return;}
    draft.saving=true;for(const control of form.elements)control.disabled=true;state.className='help-text';state.textContent='正在保存…';
    try{
      await api('/agent/memory/update',{scope:memory.scope,key:memory.key,newKey:name.value,value:value.value,revision:memory.revision});
      agentMemoryEdit=null;$('agent-session').disabled=false;await loadAgentMemories();notify('记忆已保存，后续任务使用更新后的内容。');
    }catch(error){state.className='stream-error';state.textContent=error.message;}
    finally{draft.saving=false;if(agentMemoryEdit===draft){for(const control of form.elements)control.disabled=false;save.disabled=!draft.dirty;}}
  });
  actions.append(cancel,save);form.append(nameLabel,name,valueLabel,value,el('small','','保存后用于后续任务。保存或取消后可切换会话。'),state,actions);
  row.replaceChildren(el('strong','','编辑记忆'),el('small','',memory.scope.includes(':user:')?'QQ '+memory.scope.split(':user:')[1]:'当前会话'),form);name.focus();
}
async function loadAgentMemories(quiet=false){
  if(agentMemoryEdit)return;
  const ticket=++agentMemoryTicket,box=$('agent-memories'),session=agentSession;
  if(!session){box.replaceChildren(el('p','help-text','开始网页试聊或收到 QQ 消息后，即可查看会话记忆。'));return;}
  if(!quiet)box.replaceChildren(el('p','help-text','正在读取记忆…'));
  try{
    const items=await api('/agent/memories?conversation='+encodeURIComponent(session));
    if(ticket!==agentMemoryTicket||session!==agentSession||agentMemoryEdit)return;
    box.replaceChildren();if(!items.length)box.append(el('p','help-text','尚无记忆。可以在 QQ 中说“记住我喜欢简洁回答”。'));
    for(const memory of items){
      const row=el('div','agent-memory'),actions=el('div','agent-memory-actions'),edit=el('button','button small','编辑'),remove=el('button','button small','删除');
      row.dataset.scope=memory.scope;row.dataset.key=memory.key;edit.dataset.action='edit';remove.dataset.action='delete';
      edit.addEventListener('click',()=>editAgentMemory(memory,row));
      remove.addEventListener('click',async()=>{
        if(agentMemoryEdit||!await confirmAction('删除这条记忆？','删除后无法恢复，不影响会话上下文。'))return;
        remove.disabled=true;try{await api('/agent/forget',{scope:memory.scope,key:memory.key});await loadAgentMemories();}catch(error){notify(error.message,true);remove.disabled=false;}
      });
      actions.append(edit,remove);row.append(el('strong','',memory.key),actions,el('p','',memory.value),el('small','',(memory.scope.includes(':user:')?'QQ '+memory.scope.split(':user:')[1]:'当前会话')+' · '+dateTime(memory.updated_at)));box.append(row);
    }
  }catch(error){if(ticket===agentMemoryTicket&&!agentMemoryEdit)box.replaceChildren(el('p','stream-error',error.message));}
}
$('agent-binding').addEventListener('change',()=>{agentBindingDirty=true;});
$('agent-session').addEventListener('change',()=>{if(agentMemoryEdit){$('agent-session').value=agentSession;return;}agentBindingDirty=false;agentSession=$('agent-session').value;const row=agentSnapshot?.sessions.find(s=>s.conversation===agentSession);$('agent-binding').value=row?.persona||'';$('agent-bind').disabled=!row;$('agent-reset').disabled=!row;void loadAgentMemories();});
$('agent-refresh').addEventListener('click',async()=>{await loadAgent();await loadAgentMemories();});
$('agent-bind').addEventListener('click',async()=>{if(!agentSession||!await confirmAction('应用人格并清空上下文？','后续消息将使用所选人格。已保存记忆继续保留。'))return;try{await api('/agent/bind',{conversation:agentSession,persona:$('agent-binding').value});agentBindingDirty=false;await loadAgent();notify('会话人格已更新。');}catch(error){notify(error.message,true);}});
$('agent-reset').addEventListener('click',async()=>{if(!agentSession||!await confirmAction('清空会话上下文？','此前的聊天不再提供给模型。已保存记忆继续保留。'))return;try{await api('/agent/reset',{conversation:agentSession});notify('会话上下文已清空。');}catch(error){notify(error.message,true);}});
async function agentSwitch(id){if(agentDirty&&!await confirmAction('放弃未保存的人格修改？','当前编辑内容尚未保存。')){$('agent-persona-select').value=agentEditing?.id||'';return;}agentEdit(id);}
$('agent-persona-select').addEventListener('change',()=>void agentSwitch($('agent-persona-select').value));$('agent-new-persona').addEventListener('click',()=>void agentSwitch(''));
$('agent-persona-form').addEventListener('input',()=>{agentDirty=true;$('agent-persona-state').textContent='有未保存的修改';});
$('agent-persona-form').addEventListener('submit',async event=>{event.preventDefault();if(agentSaving)return;agentSaving=true;for(const node of $('agent-persona-form').elements)node.disabled=true;try{const names=$('agent-persona-tools').value.trim();const saved=await api('/agent/persona',{id:agentEditing?.id,revision:agentEditing?.revision,name:$('agent-persona-name').value,prompt:$('agent-persona-prompt').value,tools:names==='*'?null:names.split(/[,，\s]+/).filter(Boolean)});agentDirty=false;agentEditing=saved;agentSaving=false;await loadAgent();$('agent-persona-state').textContent='人格已保存，绑定后用于后续任务';}catch(error){notify(error.message,true);}finally{agentSaving=false;for(const node of $('agent-persona-form').elements)node.disabled=false;$('agent-delete-persona').disabled=!agentEditing;}});
$('agent-delete-persona').addEventListener('click',async()=>{if(!agentEditing||!await confirmAction('删除人格？','绑定该人格的会话将恢复默认人格，并清空短期上下文。'))return;try{await api('/agent/persona/delete',{id:agentEditing.id,revision:agentEditing.revision});agentDirty=false;agentEditing=null;await loadAgent();notify('人格已删除。');}catch(error){notify(error.message,true);}});
window.addEventListener('beforeunload',event=>{if(agentDirty||agentMemoryEdit?.dirty){event.preventDefault();event.returnValue='';}});
function agentRenderChat(result){
  if(result.session!==agentChatSession)return;
  const signature=JSON.stringify(result);if(signature===agentChatSignature)return;agentChatSignature=signature;
  const feed=$('agent-chat-feed'),scroll=feed.scrollTop,follow=feed.scrollHeight-scroll-feed.clientHeight<60;
  feed.replaceChildren();if(!result.jobs.length)feed.append(agentEmptyState.cloneNode(true));
  agentChatPending=result.jobs.some(j=>['queued','generating','ready','sending'].includes(j.status));
  for(const job of result.jobs){
    const computerReasons={computer_stopped:'本机操作已停止。请核对电脑状态；恢复后发送新任务。',computer_task_needs_review:'此任务执行过本机操作，已阻止自动重做。请核对后发送新任务。',computer_operation_uncertain:'本机操作结果未知，已停止本任务。请核对电脑状态后发送新任务。'};
    const fallback=computerReasons[job.reason]||(job.reason==='douyin_browse_rejected'?'抖音页面状态或任务条件发生变化，本轮决定未执行，已停止。请检查专用浏览器后发起新任务。':job.reason==='ai_reply_empty_after_filter'?'回复只包含表情，过滤后没有可显示的正文。':
      ['failed','ignored','uncertain'].includes(job.status)?'任务未完成：'+(job.reason||job.status):'正在处理…');
    for(const [label,text] of [['你',job.input||'消息正文未保留。'],['Agent',job.reply||fallback]]){
      const row=el('article','agent-chat-message');row.dataset.role=label==='你'?'user':'assistant';
      row.append(el('strong','',label),el('p','',text));
      if(label==='Agent'&&job.generation){const g=job.generation;row.append(el('small','help-text',g.state==='queued'?(g.queue_position?'生图排队中，前面还有 '+g.queue_position+' 个对话任务':'生图任务正在准备'):'生图进度：完成 '+g.completed+'/'+g.total+' 项 · 已返回 '+g.images+' 张图片'));}
      if(label==='Agent')for(const [index,file] of (job.generated_images||[]).entries()){const link=el('a'),image=el('img');link.href=file.data;link.download='comfyui-'+job.id+'-'+(index+1)+'.'+(file.mime==='image/jpeg'?'jpg':file.mime==='image/webp'?'webp':'png');link.title='下载原图';image.src=file.data;image.alt=file.name+'，点击下载原图';image.loading='lazy';image.style.cssText='display:block;max-width:100%;max-height:360px;width:auto;height:auto;border-radius:12px;margin-top:12px';link.append(image);row.append(link,el('small','help-text',file.name+' · 点击图片下载原图'));}
      if(label==='你'&&job.attachments?.length){const names=el('div','agent-chat-files');for(const file of job.attachments)names.append(el('span','',file.name+' · '+agentFileSize(file.size)));row.append(names);}
      if(label==='Agent'&&['failed','uncertain'].includes(job.status)&&job.reply)row.append(el('small','help-text','回复已中断：'+(job.reason||job.status)));
      feed.append(row);
    }
  }
  feed.scrollTop=follow?feed.scrollHeight:scroll;
  if(!agentChatUploading&&!agentChatAttachments.length)$('agent-chat-state').textContent=agentChatPending?'Agent 正在生成回复…':'';
  $('agent-chat-send').disabled=agentChatPending||agentChatBusy||agentChatUploading;
}
async function loadAgentChat(){agentWatchChat();if(!agentChatSession)return;const session=agentChatSession;try{const result=await api('/agent/chat?session='+encodeURIComponent(session));if(session===agentChatSession)agentRenderChat(result);}catch(error){$('agent-chat-state').textContent=error.message;}}
$('agent-chat-form').addEventListener('submit',async event=>{event.preventDefault();if(agentChatBusy||agentChatPending||agentChatUploading)return;if(!$('agent-chat-input').value.trim()&&!agentChatAttachments.length){$('agent-chat-state').textContent='请输入消息或添加图片、文件。';return;}agentChatBusy=true;agentRenderAttachments();$('agent-chat-state').textContent='正在提交任务…';try{const result=await api('/agent/chat',{session:agentChatSession||undefined,text:$('agent-chat-input').value,attachments:agentChatAttachments.map(file=>file.id)});if(!agentChatSession&&!agentMemoryEdit){agentSession='web:'+result.session;agentBindingDirty=false;}agentChatSession=result.session;try{localStorage.setItem('qq-agent-web-session',agentChatSession);}catch{}$('agent-chat-input').value='';agentChatAttachments.length=0;agentChatBusy=false;agentRenderAttachments();await loadAgentChat();await loadAgent();}catch(error){$('agent-chat-state').textContent=error.message;}finally{agentChatBusy=false;agentRenderAttachments();}});
$('agent-chat-new').addEventListener('click',()=>{if(agentChatBusy||agentChatUploading)return;agentChatSession='';agentWatchChat();agentChatSignature='';agentChatPending=false;agentChatAttachments.length=0;agentRenderAttachments();try{localStorage.removeItem('qq-agent-web-session');}catch{}$('agent-chat-feed').replaceChildren(agentEmptyState.cloneNode(true));$('agent-chat-state').textContent='';$('agent-chat-send').disabled=false;});

function agentSyncMode(){const active=view==='agent'&&agentTab==='chat';$('test-chat-entry').setAttribute('aria-pressed',String(active));$('test-chat-entry').setAttribute('aria-label',active?'返回机器人管理':'切换到测试对话');$('test-chat-entry').querySelector('span').textContent=active?'返回管理':'测试对话';}
function agentSetTab(name){if(!['devices','sessions','personas','activity','knowledge','social','chat'].includes(name))return;agentTab=name;for(const pane of document.querySelectorAll('[data-agent-pane]'))pane.hidden=pane.dataset.agentPane!==name;for(const tab of document.querySelectorAll('[data-agent-tab]')){const selected=tab.dataset.agentTab===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}document.querySelector('.agent-tabs').hidden=name==='chat';agentSyncMode();if(name==='knowledge')void loadVideoKnowledge();if(name==='social')void loadDouyinSocial();}
for(const tab of document.querySelectorAll('[data-agent-tab]')){tab.addEventListener('click',()=>agentSetTab(tab.dataset.agentTab));tab.addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-agent-tab]')];let index=tabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%tabs.length;else if(event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabs.length-1;else return;event.preventDefault();tabs[index].click();tabs[index].focus();});}
for(const button of document.querySelectorAll('[data-agent-open]'))button.addEventListener('click',()=>{if(view!=='agent')navigate('agent');agentSetTab(button.dataset.agentOpen);});
$('test-chat-entry').addEventListener('click',()=>{if(view==='agent'&&agentTab==='chat'){agentSetTab('sessions');navigate(agentReturnView);}else{agentReturnView=view;navigate('agent');agentSetTab('chat');$('agent-chat-input').focus({preventScroll:true});}});
$('agent-chat-feed').addEventListener('click',event=>{const button=event.target.closest('[data-agent-prompt]');if(!button)return;$('agent-chat-input').value=button.dataset.agentPrompt;$('agent-chat-input').focus();});
$('agent-chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('agent-chat-send').disabled&&($('agent-chat-input').value.trim()||agentChatAttachments.length))$('agent-chat-form').requestSubmit();}});
`;
