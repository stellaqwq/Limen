export const pluginHubNavigation=String.raw`
<nav class="plugin-navigation" id="plugin-navigation" aria-label="插件内导航">
  <a href="#extensions" data-plugin-view="extensions" aria-current="page">插件概览</a>
  <a href="#plugins" data-plugin-view="plugins">插件管理</a>
  <a href="#market" data-plugin-view="market">插件市场</a>
  <a href="#groupchat" data-plugin-view="groupchat">群聊增强</a>
  <a href="#memes" data-plugin-view="memes">表情图库</a>
  <a href="#memory" data-plugin-view="memory">流动记忆</a>
  <a href="#startup" data-plugin-view="startup">启动动画</a>
  <a href="#background" data-plugin-view="background">背景壁纸</a>
</nav>`;

export const pluginHubHome=String.raw`
<section id="plugin-home" aria-label="插件概览">
  <div class="plugin-hub-toolbar"><p class="help-text" id="plugin-hub-summary" role="status">正在读取已安装插件…</p><div class="inline-actions"><button class="button" id="plugin-hub-refresh" type="button">刷新状态</button><a class="button primary" href="#plugins">管理全部插件</a></div></div>
  <p class="banner error" id="plugin-hub-error" role="alert" hidden></p>
  <div class="plugin-hub-caption"><h2>按用途找到功能</h2><p>外观、浏览与自动化、聊天与记忆、图片与语音分别管理。高级参数保留在插件配置中。</p></div><div id="plugin-hub-list" aria-live="polite"><div class="empty"><p>正在读取插件入口…</p></div></div>
  <p class="plugin-hub-note help-text">自定义脚本、导入导出和启停统一在“插件管理”中操作。安装新插件后，先配置会话范围，再启用。</p>
</section>`;

export const pluginHubStyles=String.raw`
.plugin-navigation{display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:24px}
.plugin-navigation a{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 15px;border-radius:8px;text-decoration:none;font-size:13px;color:var(--muted)}
.plugin-navigation a:hover{background:var(--nav-hover);color:var(--ink)}.plugin-navigation a[aria-current=page]{background:var(--accent-soft);color:var(--accent);font-weight:600}
.plugin-hub-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.plugin-hub-toolbar p{min-width:0}
.plugin-hub-toolbar a.button,.plugin-hub-row a.button{border-radius:8px}.plugin-hub-row a.button{color:var(--ink)}
.plugin-hub-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;padding:22px 24px}.plugin-hub-row+.plugin-hub-row{border-top:1px solid var(--line)}
.plugin-hub-title{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-bottom:6px}.plugin-hub-title h3{font-size:14px;font-weight:600}.plugin-hub-row p{max-width:72ch;font-size:12px;color:var(--muted);line-height:1.8;overflow-wrap:anywhere}.plugin-hub-row .button{white-space:nowrap}.plugin-hub-note{margin-top:18px;max-width:85ch}
@media(max-width:680px){.plugin-navigation{gap:4px;margin-bottom:20px}.plugin-navigation a{min-height:44px;flex:1 0 calc(50% - 4px);padding:9px 10px}.plugin-hub-toolbar{align-items:stretch;flex-direction:column;gap:12px}.plugin-hub-toolbar .inline-actions{display:flex}.plugin-hub-toolbar .button{flex:1;justify-content:center;min-height:44px}.plugin-hub-row{grid-template-columns:minmax(0,1fr);padding:20px 18px;gap:12px}.plugin-hub-row .button{justify-self:start;min-height:44px}.plugin-hub-title h3{font-size:14px}}
@media(max-width:680px){
  #view-extensions:not([data-plugin-page=extensions]) .plugin-navigation{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;scrollbar-color:var(--field-line) var(--surface-muted);padding-bottom:6px;margin-bottom:10px}
  #view-extensions:not([data-plugin-page=extensions]) .plugin-navigation a{flex:1 0 auto;padding-right:8px;padding-left:8px}
  :root[data-view=memes] .page-head{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
}
`;

export const pluginHubClient=String.raw`
const pluginViews=['extensions','plugins','market','groupchat','memes','memory','startup','background'];
const pluginDestinations=[
  {kind:'startup-animation',name:'启动动画',description:'打开工作台时播放自定义开场：内置样式或上传本机视频片头，配合自己的文案、Logo 与平滑过渡。',route:'startup'},
  {kind:'background',name:'背景壁纸',description:'用一张本机图片作为工作台背景，调整适应方式、模糊与面板透明度。',route:'background'},
  {kind:'comfyui',name:'ComfyUI 生图',description:'让模型生成图片并返回聊天，可选择基础流程或提供的 API 工作流。'},
  {kind:'douyin-web',name:'抖音网页浏览',description:'按配置观看抖音、筛选分享和管理默认好友私信。登录和验证在专用浏览器中完成。'},
  {kind:'android-device',name:'安卓视频浏览',description:'指定一台 ADB 设备，让视觉模型采样手机画面、打开视频 App 和上滑。每个任务限制条数和时长。'},
  {kind:'video-analysis',name:'视频理解',description:'查询视频信息、按时间或指定时刻抽取画面、读取内嵌字幕或转写对白，并生成带对白的分镜宫格。'},
  {kind:'group-chat-plus',name:'群聊增强 Chat Plus',description:'管理群聊参与策略、群专属配置、互动状态与上下文。',route:'groupchat'},
  {kind:'meme-manager',name:'表情图库',description:'整理表情分类、上传图片，审核聊天收集的表情。',route:'memes'},
  {kind:'living-memory',name:'流动记忆 Living Memory',description:'在 3D 神经网络中浏览记忆，查看、编辑和维护每一条连接。',route:'memory'},
  {kind:'psychodynamic-emotion',name:'心绪 · 心理动力情绪',description:'调整温暖、活泼、自我调节与情绪延续，模拟不同情境下的表达。'},
  {kind:'voicestudio',name:'VoiceStudio',description:'配置本地语音服务、默认音色、语音回复概率与触发范围。'}
];
function renderPluginHub(){
  if(!pluginSnapshot)return;
  const all=pluginSnapshot.plugins,root=$('plugin-hub-list');
  $('plugin-hub-summary').textContent='已安装 '+all.length+' 个插件 · '+all.filter(p=>p.enabled).length+' 个已启用';
  root.replaceChildren();
  const groups=[['界面与外观',['startup-animation','background']],['视频与自动化',['douyin-web','android-device','video-analysis']],['聊天与记忆',['group-chat-plus','living-memory','psychodynamic-emotion']],['图片与语音',['comfyui','meme-manager','voicestudio']]];
  for(const [label,kinds] of groups){
    const section=el('section','plugin-hub-group'),head=el('div','plugin-hub-group-head'),entries=el('div','plugin-hub-entries');
    head.append(el('h2','',label),el('p','',kinds.filter(k=>all.some(p=>p.kind===k&&p.enabled)).length+' 项已启用'));section.append(head,entries);root.append(section);
    for(const item of pluginDestinations.filter(item=>kinds.includes(item.kind))){
    const installed=all.find(p=>p.kind===item.kind),row=el('article','plugin-hub-row'),body=el('div'),title=el('div','plugin-hub-title');
    row.dataset.pluginKind=item.kind;title.append(el('h3','',item.name),badge(installed?(installed.enabled?'已启用':'已停用'):'未安装',installed?.enabled?'ok':''));
    body.append(title,el('p','',item.description));
    let action;
    if(item.route){action=el('a','button','打开管理页');action.href='#'+item.route;}
    else {action=el('button','button',installed?'配置插件':'安装并配置');action.type='button';action.disabled=pluginBusy;action.onclick=()=>openPluginFromHub(item.kind);}
    action.setAttribute('aria-label',(item.route?'打开管理页 ':installed?'配置插件 ':'安装并配置 ')+item.name);row.append(body,action);entries.append(row);
  }
}
}
async function openPluginFromHub(kind){
  if(pluginBusy||!await discardPluginDraft())return;
  pluginSetBusy(true);problem('plugin-hub-error',null);
  const origin=view;
  try{
    const current=pluginSnapshot?.plugins.find(p=>p.kind===kind);
    const p=current?await api('/plugins/detail?id='+encodeURIComponent(current.id)):await api('/plugins/install',{kind});
    // Do not redirect a user who moved elsewhere while the request was pending.
    if(view!==origin)return;
    navigate('plugins');fillPlugin(p);await loadPlugins();
    $('plugin-editor').scrollIntoView({block:'start'});$('plugin-name').focus({preventScroll:true});
  }catch(error){problem('plugin-hub-error',error);}
  finally{pluginSetBusy(false);renderPluginHub();}
}
$('plugin-hub-refresh').onclick=()=>loadPlugins();
`;
