export const backgroundPanel = String.raw`
<section id="view-background" aria-label="背景壁纸" hidden>
<div class="panel background-intro"><div><h2>背景壁纸 <span class="tag" id="background-status">读取中</span></h2><p id="background-hint" class="help-text">正在读取背景设置…</p></div><div class="inline-actions"><button class="button primary" id="background-install" hidden>安装背景插件</button><button class="button" id="background-toggle" hidden>启用插件</button></div></div>
<p id="background-error" class="banner error" role="alert" tabindex="-1" hidden></p>
<div class="background-layout">
<div class="panel background-stage"><div class="panel-head"><h2>效果预览</h2><span class="tag" id="background-stage-tag">未设置图片</span></div>
<div class="background-preview" id="background-preview" data-empty="true"><div class="background-preview-media" id="background-preview-media"></div><div class="background-preview-veil" id="background-preview-veil"></div><p class="background-preview-empty">还没有背景图片<br><span>选择一张本机图片后，整页会换成这张壁纸。</span></p><div class="background-preview-panel" id="background-preview-panel"><strong>示例面板</strong><p>侧栏、顶栏与内容面板保持半透明，文字仍然清晰。</p><span class="tag">标签</span></div></div>
<div class="background-actions"><button class="button primary" id="background-upload" type="button">选择图片</button><input type="file" id="background-file" accept="image/png,image/jpeg,image/webp" hidden><button class="button danger" id="background-remove" type="button" hidden>移除背景</button><span class="help-text" id="background-upload-state" role="status"></span></div>
<p class="help-text">支持 PNG、JPEG、WebP，单张不超过 8 MiB。图片只保存在本机数据目录，不会上传到网络。</p>
</div>
<div class="panel background-settings"><div class="panel-head"><h2>显示设置</h2><span class="tag" id="background-save-tag">读取中</span></div>
<form id="background-form" class="background-form">
<label class="background-field" for="background-mode">图片适应方式<select id="background-mode"><option value="cover">填满窗口（可能裁切）</option><option value="contain">完整显示</option><option value="tile">平铺重复</option></select></label>
<label class="background-field" for="background-blur">模糊 <output id="background-blur-value" for="background-blur">0 px</output><input id="background-blur" type="range" min="0" max="24" step="1" value="0"></label>
<label class="background-field" for="background-veil">白色遮罩 <output id="background-veil-value" for="background-veil">34%</output><input id="background-veil" type="range" min="0" max="90" step="1" value="34"></label>
<label class="background-field" for="background-panel">面板不透明度 <output id="background-panel-value" for="background-panel">90%</output><input id="background-panel" type="range" min="40" max="100" step="1" value="90"></label>
<p class="help-text">遮罩越浅壁纸越明显，面板越不透明文字越清晰。工作台是浅色主题，建议保留少量白色遮罩。</p>
<div class="background-form-actions"><button class="button primary" type="submit" id="background-save">保存设置</button><button class="button" type="button" id="background-reset">恢复默认</button></div>
</form>
</div>
</div>
</section>`;

export const backgroundStyles = String.raw`
html[data-background=on]{background:#fafafa}
html[data-background=on] body{background:transparent}
html[data-background=on] body::before{content:'';position:fixed;inset:calc(var(--wallpaper-blur) * -2 - 8px);z-index:-2;background-image:var(--wallpaper);background-position:center;background-size:cover;background-repeat:no-repeat;filter:blur(var(--wallpaper-blur))}
html[data-background=on][data-wallpaper-mode=contain] body::before{background-size:contain}
html[data-background=on][data-wallpaper-mode=tile] body::before{background-size:auto;background-repeat:repeat}
html[data-background=on] body::after{content:'';position:fixed;inset:0;z-index:-1;background:#fafafa;opacity:var(--wallpaper-veil);pointer-events:none}
html[data-background=on] .panel{background:rgba(255,255,255,var(--wallpaper-panel));backdrop-filter:blur(16px)}
html[data-background=on] .topbar{background:rgba(255,255,255,calc(var(--wallpaper-panel) + .06));backdrop-filter:blur(16px)}
html[data-background=on] .sidebar{background:rgba(245,245,248,var(--wallpaper-panel));backdrop-filter:blur(16px)}
html[data-background=on] .savebar{background:rgba(255,255,255,calc(var(--wallpaper-panel) + .06));backdrop-filter:blur(16px)}
html[data-background=on] .data-table th{background:rgba(248,248,250,var(--wallpaper-panel))}
html[data-background=on] .data-table tbody tr:hover{background:rgba(252,252,254,var(--wallpaper-panel))}
html[data-background=on] .nav button:hover{background:rgba(236,236,242,var(--wallpaper-panel))}
.background-intro{padding:20px 23px;display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:22px}.background-intro h2{font-size:15px;margin-bottom:7px}.background-intro h2 .tag{margin-left:8px}
.background-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:22px;align-items:start}
.background-preview{position:relative;margin:0 0 18px;aspect-ratio:16/10;border-radius:12px;overflow:hidden;background:#eceaf3;isolation:isolate}
.background-preview-media{position:absolute;inset:-26px;background-position:center;background-size:cover;background-repeat:no-repeat;z-index:0}
.background-preview-veil{position:absolute;inset:0;background:#fafafa;opacity:.34;z-index:1;pointer-events:none}
.background-preview-panel{position:absolute;left:9%;right:9%;top:29%;z-index:2;background:rgba(255,255,255,.9);border:1px solid #e7e7ed;border-radius:11px;padding:15px 17px;box-shadow:0 10px 28px #27233921;font-size:13px}
.background-preview-panel strong{display:block;font-size:14px;margin-bottom:5px}.background-preview-panel p{font-size:12px;line-height:1.7;color:var(--muted);margin-bottom:9px}
.background-preview-empty{position:absolute;inset:0;display:none;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:5px;z-index:2;font-size:13px;font-weight:600;color:var(--muted)}
.background-preview-empty span{font-size:12px;font-weight:400;max-width:32ch;line-height:1.7}
.background-preview[data-empty=true] .background-preview-media,.background-preview[data-empty=true] .background-preview-veil,.background-preview[data-empty=true] .background-preview-panel{display:none}
.background-preview[data-empty=true] .background-preview-empty{display:flex}
.background-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:6px}
.background-actions .help-text{margin-left:auto;font-size:11px}
.background-form{padding:4px 0 0}
.background-field{display:grid;gap:6px;font-size:12px;font-weight:600;margin:0 22px 18px}
.background-field select{min-height:39px;padding:7px 10px;border:1px solid var(--field-line);background:var(--surface);color:var(--ink);font-weight:400}
.background-field input[type=range]{width:100%;accent-color:var(--accent);height:22px}
.background-field output{font-size:11px;font-weight:400;color:var(--muted)}
.background-form .help-text{padding:0 22px;margin-bottom:18px}
.background-form-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 22px 22px}
.background-stage .help-text{padding:0 22px 20px;font-size:11px}
.background-stage .panel-head+.background-preview{margin:20px 22px 18px}
.background-stage .background-actions{padding:0 22px}
@media(max-width:1100px){.background-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:680px){.background-intro{align-items:flex-start;flex-direction:column;padding:16px}.background-preview{aspect-ratio:4/3;margin:16px 16px 14px}.background-preview-panel{left:6%;right:6%;top:26%;padding:12px 14px;font-size:12px}.background-stage .panel-head+.background-preview{margin:16px}.background-stage .background-actions{padding:0 16px}.background-stage .help-text{padding:8px 16px 16px}.background-field{margin:0 16px 18px}.background-form .help-text{padding:0 16px}.background-form-actions{padding:0 16px 18px}.background-field select{font-size:16px}.background-actions .help-text{margin-left:0}}
`;

export const backgroundClient = String.raw`
let backgroundSnapshot=null,backgroundBusy=false,backgroundSignature='';
function backgroundValues(){return {mode:$('background-mode').value,blur:Number($('background-blur').value),veil:Number($('background-veil').value)/100,panel:Number($('background-panel').value)/100};}
function backgroundLabels(){$('background-blur-value').textContent=$('background-blur').value+' px';$('background-veil-value').textContent=$('background-veil').value+'%';$('background-panel-value').textContent=$('background-panel').value+'%';}
function backgroundError(error){const node=$('background-error');node.textContent=error?error.message||String(error):'';node.hidden=!error;if(error)node.focus({preventScroll:false});}
function paintWallpaper(value){
  const root=document.documentElement,image=value&&value.enabled&&value.image?value.image:null;
  const signature=image?[image.url,value.mode,value.blur,value.veil,value.panel].join('|'):'';
  if(signature===backgroundSignature)return;
  backgroundSignature=signature;
  if(!image){root.removeAttribute('data-background');root.removeAttribute('data-wallpaper-mode');root.style.removeProperty('--wallpaper');return;}
  root.dataset.background='on';
  root.dataset.wallpaperMode=value.mode||'cover';
  root.style.setProperty('--wallpaper','url("'+base+image.url+'")');
  root.style.setProperty('--wallpaper-blur',Number(value.blur||0)+'px');
  root.style.setProperty('--wallpaper-veil',String(value.veil==null?0.34:value.veil));
  root.style.setProperty('--wallpaper-panel',String(value.panel==null?0.9:value.panel));
}
function paintBackgroundPreview(value){
  const stage=$('background-preview'),media=$('background-preview-media'),veil=$('background-preview-veil'),panel=$('background-preview-panel');
  const image=value&&value.image;
  stage.dataset.empty=image?'false':'true';
  veil.style.opacity=String(value&&value.veil!=null?value.veil:0.34);
  panel.style.background='rgba(255,255,255,'+(value&&value.panel!=null?value.panel:0.9)+')';
  if(!image){media.style.backgroundImage='none';media.style.filter='none';return;}
  media.style.backgroundImage='url("'+base+image.url+'")';
  media.style.backgroundSize=value.mode==='contain'?'contain':value.mode==='tile'?'auto':'cover';
  media.style.backgroundRepeat=value.mode==='tile'?'repeat':'no-repeat';
  media.style.filter='blur('+Number(value.blur||0)+'px)';
}
function backgroundSetBusy(value){
  backgroundBusy=value;
  const root=$('view-background');if(!root)return;
  for(const node of root.querySelectorAll('button,input,select'))node.disabled=value;
  if(!value)backgroundEnableControls();
}
function backgroundEnableControls(){
  const snapshot=backgroundSnapshot;if(!snapshot)return;
  $('background-upload').disabled=!snapshot.plugin;
  $('background-remove').disabled=!snapshot.image;
  $('background-save').disabled=!snapshot.plugin;
  $('background-reset').disabled=!snapshot.plugin;
  for(const id of ['background-mode','background-blur','background-veil','background-panel'])$(id).disabled=!snapshot.plugin;
}
function renderBackground(){
  const snapshot=backgroundSnapshot,plugin=snapshot?.plugin;
  const status=$('background-status');
  status.textContent=!plugin?'未安装':plugin.enabled?'已启用':'已停用';status.className='tag '+(plugin?.enabled?'ok':'');
  $('background-install').hidden=!!plugin;$('background-toggle').hidden=!plugin;
  $('background-toggle').textContent=plugin?.enabled?'停用插件':'启用插件';
  $('background-hint').textContent=!plugin?'背景壁纸以插件形式提供。安装后即可上传图片，并随时启用或停用。':plugin.enabled?(!snapshot.image?'插件已启用，还没有图片。选择一张图片后立即生效。':snapshot.enabled?'背景已应用到工作台，保存后立即生效。':'插件配置里的“应用背景”已关闭，背景不会显示。'):'插件已停用，当前显示默认外观。启用后立即应用已保存的图片。';
  $('background-save-tag').textContent=plugin?(plugin.enabled?'已启用':'已停用'):'未安装';
  $('background-stage-tag').textContent=snapshot?.image?snapshot.image.format.toUpperCase()+' · '+Math.ceil(snapshot.image.size/1024)+' KiB':'未设置图片';
  if(plugin){const c=plugin.config;$('background-mode').value=c.mode||'cover';$('background-blur').value=c.blur??0;$('background-veil').value=Math.round((c.veil??.34)*100);$('background-panel').value=Math.round((c.panel??.9)*100);}
  backgroundLabels();paintBackgroundPreview(snapshot?{...backgroundValues(),image:snapshot.image}:null);
  backgroundEnableControls();
}
async function loadBackground(){
  const root=$('view-background');if(!root)return;
  backgroundSetBusy(true);
  try{backgroundSnapshot=await api('/background');backgroundError(null);renderBackground();}
  catch(error){backgroundSnapshot=null;backgroundError(error);$('background-hint').textContent='无法读取背景插件：'+error.message;}
  finally{backgroundBusy=false;backgroundSetBusy(false);}
}
async function backgroundApply(result){
  if(result&&typeof result==='object'&&Object.hasOwn(result,'enabled')){backgroundSnapshot=result;renderBackground();paintWallpaper(result);}
  else await loadBackground();
  void loadPlugins();
}
// A console page rendered by an older template has no panel markup; skip the
// bindings instead of throwing and leaving the rest of the console unbooted.
if($('view-background')){
$('background-install').onclick=async()=>{
  if(backgroundBusy)return;backgroundSetBusy(true);backgroundError(null);
  try{await api('/plugins/install',{kind:'background'});await loadBackground();notify('背景插件已安装。');}
  catch(error){backgroundError(error);}
  finally{backgroundSetBusy(false);}
};
$('background-toggle').onclick=async()=>{
  const plugin=backgroundSnapshot?.plugin;if(backgroundBusy||!plugin)return;backgroundSetBusy(true);backgroundError(null);
  try{await api('/plugins/toggle',{id:plugin.id,revision:plugin.revision,enabled:!plugin.enabled});await loadBackground();notify(plugin.enabled?'背景插件已停用。':'背景插件已启用。');}
  catch(error){backgroundError(error);}
  finally{backgroundSetBusy(false);}
};
$('background-upload').onclick=()=>$('background-file').click();
$('background-file').onchange=async()=>{
  const file=$('background-file').files[0];if(!file||backgroundBusy)return;
  backgroundSetBusy(true);backgroundError(null);$('background-upload-state').textContent='正在读取图片…';
  try{
    if(file.size>8*1024*1024)throw new Error('图片不能超过 8 MiB，请先压缩后再上传。');
    const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取图片文件。'));reader.readAsDataURL(file);});
    $('background-upload-state').textContent='正在保存…';
    const result=await api('/background/action',{action:'upload',data:source});
    await backgroundApply(result);notify('背景图片已更新。');
  }catch(error){backgroundError(error);}
  finally{$('background-file').value='';$('background-upload-state').textContent='';backgroundSetBusy(false);}
};
$('background-remove').onclick=async()=>{
  if(backgroundBusy||!backgroundSnapshot?.image)return;
  if(!await confirmAction('移除背景图片？','移除后工作台恢复默认外观，图片文件会从本机删除。'))return;
  backgroundSetBusy(true);backgroundError(null);
  try{const result=await api('/background/action',{action:'remove'});await backgroundApply(result);notify('背景图片已移除。');}
  catch(error){backgroundError(error);}
  finally{backgroundSetBusy(false);}
};
$('background-form').onsubmit=async event=>{
  event.preventDefault();if(backgroundBusy||!backgroundSnapshot?.plugin)return;
  backgroundSetBusy(true);backgroundError(null);
  try{const result=await api('/background/action',{action:'save',...backgroundValues()});await backgroundApply(result);notify('背景设置已保存。');}
  catch(error){backgroundError(error);}
  finally{backgroundSetBusy(false);}
};
$('background-reset').onclick=()=>{$('background-mode').value='cover';$('background-blur').value=0;$('background-veil').value=34;$('background-panel').value=90;backgroundLabels();paintBackgroundPreview({...backgroundValues(),image:backgroundSnapshot?.image||null});notify('已填入默认值，保存后生效。');};
for(const id of ['background-mode','background-blur','background-veil','background-panel'])$(id).addEventListener('input',()=>{backgroundLabels();paintBackgroundPreview({...backgroundValues(),image:backgroundSnapshot?.image||null});});
}
`;
