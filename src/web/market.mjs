export const marketPanel = String.raw`
<section id="view-market" aria-label="插件市场" hidden>
  <div class="toolbar market-toolbar">
    <p class="help-text" id="market-source" role="status">正在读取市场清单…</p>
    <span class="spacer"></span>
    <button class="button" id="market-refresh" type="button">刷新清单</button>
  </div>
  <p class="banner error" id="market-error" role="alert" hidden></p>
  <div class="panel">
    <div class="panel-head"><h2>可用插件</h2><span class="tag" id="market-count">—</span></div>
    <div id="market-plugins" aria-live="polite"><div class="empty"><p>正在读取清单…</p></div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h2>运行资源</h2><span class="tag" id="market-assets-count">—</span></div>
    <div id="market-assets" aria-live="polite"></div>
    <div class="table-footer"><p>体积较大的二进制（例如 FFmpeg）单独走资源通道，和插件版本解耦：装一次，所有用到它的插件共用。</p></div>
  </div>
  <p class="plugin-hub-note help-text">市场只读取一个静态清单：清单和插件包只走 https（本机调试可用 127.0.0.1），下载后按 SHA-256 校验，包内 plugin.json 的 id、类型和版本必须与条目一致，否则整包拒绝。</p>
</section>`;

export const marketStyles = String.raw`
.market-toolbar{align-items:center}
.market-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;padding:20px 24px}
.market-row+.market-row{border-top:1px solid var(--line)}
.market-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}
.market-head h3{font-size:14px;font-weight:600}
.market-row p{max-width:72ch;font-size:12px;color:var(--muted);line-height:1.8;overflow-wrap:anywhere}
.market-changelog{margin-top:6px;font-size:12px;color:var(--muted)}
.market-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.market-actions .button{white-space:nowrap}
@media(max-width:680px){.market-row{grid-template-columns:minmax(0,1fr);padding:18px}.market-actions{justify-content:flex-start}.market-actions .button{min-height:44px}}`;

export const marketClient = String.raw`
let marketSnapshot=null,marketBusy=false;
const marketLabels={available:'可安装',installed:'已安装',upgradable:'可更新',local:'本地插件'};
async function marketPost(path,params,budget=150000){
  const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(budget)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data&&data.message||'请求失败，请稍后重试。');
  return data;
}
function marketVersion(label,value){return el('span','tag',label+' '+value);}
function renderMarket(){
  if(!marketSnapshot)return;
  const data=marketSnapshot,plugins=data.plugins||[],assets=data.assets||[];
  $('market-source').textContent=data.configured
    ? (data.source?'清单：'+data.source+(data.fetched_at?' · 更新于 '+time(data.fetched_at):''):'清单地址：'+data.catalog_url)
    : '还没有配置市场清单。到“全部设置 → 插件市场”填写 index.json 的地址后回来刷新。';
  $('market-count').textContent=plugins.length?plugins.length+' 项':'—';
  $('market-assets-count').textContent=assets.length?assets.filter(a=>a.ready).length+' / '+assets.length+' 已就绪':'—';
  const list=$('market-plugins');
  if(!data.configured){empty(list,'未配置市场清单','填写清单地址后可以在这里搜索、安装和更新插件。');}
  else if(data.error&&!plugins.length){empty(list,'暂时读不到清单',data.error.message);}
  else if(!plugins.length){empty(list,'清单里还没有插件','用 npm run market:catalog 生成 index.json 并把它发布到静态站点。');}
  else{
    list.replaceChildren();
    for(const item of plugins){
      const row=el('article','market-row'),body=el('div'),head=el('div','market-head');
      head.append(el('h3','',item.name),badge(marketLabels[item.state]||item.state,item.state==='upgradable'?'ok':item.state==='available'?'':''),marketVersion('清单',item.version));
      if(item.installed_version&&item.state==='upgradable')head.append(marketVersion('本机',item.installed_version));
      if(item.yanked)head.append(badge('已撤回',''));
      body.append(head,el('p','',item.description||'（这个条目没有写说明）'));
      if(item.changelog)body.append(el('p','market-changelog','更新说明：'+item.changelog));
      const actions=el('div','market-actions');
      if(item.state==='available'||item.state==='upgradable'){
        const label=item.state==='upgradable'?'更新到 '+item.version:'安装';
        const install=el('button','button primary',marketBusy?'处理中…':label);install.type='button';install.disabled=marketBusy;
        install.onclick=()=>marketInstall(item,install);actions.append(install);
      }else if(item.state==='local'){
        const hint=el('span','help-text','不在当前清单里');actions.append(hint);
      }else{
        const open=el('a','button','打开插件管理');open.href='#plugins';actions.append(open);
      }
      const remove=el('button','button danger','卸载');remove.type='button';remove.disabled=marketBusy;
      remove.onclick=()=>marketRemove(item,remove);actions.append(remove);
      row.append(body,actions);list.append(row);
    }
  }
  const box=$('market-assets');
  if(!assets.length){empty(box,'清单里没有资源','资源用于 FFmpeg 这类大体积二进制，不需要时留空即可。');return;}
  box.replaceChildren();
  for(const asset of assets){
    const row=el('article','market-row'),body=el('div'),head=el('div','market-head');
    head.append(el('h3','',asset.name),badge(asset.ready?'已就绪':'未安装',asset.ready?'ok':''),marketVersion('版本',asset.version));
    body.append(head,el('p','',asset.description||('安装到 '+asset.install_to+'：'+asset.files.join('、'))));
    const actions=el('div','market-actions');
    if(asset.ready){actions.append(el('span','help-text',asset.directory||''));}
    else{
      const button=el('button','button primary','下载并安装');button.type='button';button.disabled=marketBusy;
      button.onclick=()=>marketAsset(asset,button);actions.append(button);
    }
    row.append(body,actions);box.append(row);
  }
}
async function loadMarket(force=false){
  if(marketBusy)return;
  marketBusy=true;problem('market-error',null);
  const refresh=$('market-refresh');if(refresh)refresh.disabled=true;
  try{marketSnapshot=await api('/market'+(force?'?refresh=1':''));renderMarket();}
  catch(error){problem('market-error',error);if(!marketSnapshot)empty($('market-plugins'),'市场不可用',error.message);}
  finally{marketBusy=false;if(refresh)refresh.disabled=false;renderMarket();}
}
function marketSetBusy(busy,button,label){marketBusy=busy;if(button){button.disabled=busy;if(label)button.textContent=label;}}
async function marketInstall(item,button){
  if(marketBusy)return;
  if(item.state==='upgradable'&&!await confirmAction('更新 '+item.name+'？','会用清单里的 '+item.version+' 覆盖当前 '+item.installed_version+' 的插件目录，插件私有数据不要放在插件目录里。'))return;
  marketSetBusy(true,button,'正在安装…');problem('market-error',null);
  try{
    const result=await marketPost('/market/install',{id:item.id,overwrite:item.state==='upgradable'});
    notify('已安装 '+item.name+' '+result.version+(result.plugin?'，可在插件管理里配置范围后启用':''));
    await loadMarket(true);void loadPlugins();
  }catch(error){problem('market-error',error);}
  finally{marketSetBusy(false,null);renderMarket();}
}
async function marketRemove(item,button){
  if(marketBusy)return;
  if(!await confirmAction('卸载 '+item.name+'？','会删除 plugins/'+item.id+' 整个目录并移除对应插件记录，插件配置一起丢失。'))return;
  marketSetBusy(true,button,'正在卸载…');problem('market-error',null);
  try{
    await marketPost('/market/uninstall',{id:item.id,confirm:true});
    notify('已卸载 '+item.name);await loadMarket(true);void loadPlugins();
  }catch(error){problem('market-error',error);}
  finally{marketSetBusy(false,null);renderMarket();}
}
async function marketAsset(asset,button){
  if(marketBusy)return;
  const size=asset.size?(asset.size/1048576).toFixed(1)+' MB':'未知大小';
  if(!await confirmAction('下载 '+asset.name+'？','需要下载约 '+size+'，校验 SHA-256 后写入 '+asset.install_to+'。下载期间请保持服务运行。'))return;
  marketSetBusy(true,button,'正在下载…');problem('market-error',null);
  try{
    const result=await marketPost('/market/asset',{id:asset.id},620000);
    notify(asset.name+' 已安装到 '+result.directory);
    await loadMarket(true);
  }catch(error){problem('market-error',error);}
  finally{marketSetBusy(false,null);renderMarket();}
}
$('market-refresh').onclick=()=>loadMarket(true);
`;
