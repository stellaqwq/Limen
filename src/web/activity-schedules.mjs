export const activitySchedulesPanel=String.raw`
    <section class="plugin-test activity-schedules" id="activity-schedules" aria-labelledby="activity-schedules-title" hidden>
      <div class="activity-schedule-head"><h3 id="activity-schedules-title">定时自由活动</h3><button class="button small" id="activity-schedule-refresh" type="button">刷新定时</button></div>
      <p class="help-text">聊天指令与这里共用定时。时间按北京时间；定时单独保存，保存后立即生效。QQ 离线或会话忙碌时等待。</p>
      <p id="activity-schedule-status" class="help-text" role="status">正在读取定时…</p>
      <p id="activity-schedule-error" class="banner error" role="alert" tabindex="-1" hidden></p>
      <div id="activity-schedule-list" aria-live="polite"></div>
      <form id="activity-schedule-form" class="plugin-form" autocomplete="off">
        <h4 id="activity-schedule-editor-title">新增定时</h4>
        <div class="plugin-fields">
          <label>执行会话<select id="activity-schedule-target" required aria-describedby="activity-schedule-target-help"></select><small id="activity-schedule-target-help">QQ 好友须同时属于管理员、AI 白名单及已保存的插件范围。</small></label>
          <label>定时方式<select id="activity-schedule-mode"><option value="interval">每隔一段时间</option><option value="daily">每天固定时间</option><option value="once">延后执行一次</option></select></label>
          <label id="activity-schedule-interval-label">间隔（分钟）<input id="activity-schedule-interval" type="number" min="1" max="43200" step="1" value="30" required></label>
          <label id="activity-schedule-daily-label" hidden>每天执行时间<input id="activity-schedule-daily" type="time" value="20:30" required disabled><small>北京时间</small></label>
          <label id="activity-schedule-delay-label" hidden>延后（分钟）<input id="activity-schedule-delay" type="number" min="1" max="527040" step="1" value="10" required disabled></label>
          <label class="plugin-full">活动方向<textarea id="activity-schedule-focus" rows="2" maxlength="1000" placeholder="留空时按照插件兴趣自主选择"></textarea></label>
        </div>
        <div class="plugin-checks"><label><input id="activity-schedule-enabled" type="checkbox" checked>启用此定时</label></div>
        <div class="activity-schedule-save"><p id="activity-schedule-draft" class="help-text" role="status">新增定时从保存时开始计时。</p><div class="inline-actions"><button id="activity-schedule-reset" class="button" type="button">取消编辑</button><button id="activity-schedule-save" class="button primary" type="submit">新增定时</button></div></div>
      </form>
    </section>`;
export const activitySchedulesStyles=String.raw`
.activity-schedules{scroll-margin-top:92px}.activity-schedules .plugin-fields{align-items:start}
.activity-schedule-head,.activity-schedule-save{display:flex;align-items:center;justify-content:space-between;gap:12px}.activity-schedules h4{font-size:14px;font-weight:600;margin:24px 0 16px}.activity-schedules .plugin-form{padding:0}.activity-schedule-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:18px 0;border-bottom:1px solid var(--line)}.activity-schedule-row p{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.7;overflow-wrap:anywhere}.activity-schedule-row strong{font-size:13px}.activity-schedules .plugin-checks{margin:16px 0}.activity-schedule-save{margin-top:18px}.activity-schedule-empty{padding:20px 0;color:var(--muted);font-size:13px}.activity-schedule-row .inline-actions{flex-wrap:wrap}
@media(max-width:680px){.activity-schedule-row{grid-template-columns:minmax(0,1fr);gap:10px}.activity-schedule-save{align-items:stretch;flex-direction:column}.activity-schedule-save .inline-actions{display:flex}.activity-schedule-save .button{flex:1}.activity-schedules .button{min-height:44px}.activity-schedule-head{align-items:flex-start}}
`;
export const activitySchedulesClient=String.raw`
let activityScheduleSnapshot=null,activityScheduleEditing=null,activityScheduleDirty=false,activityScheduleBusy=false,activityScheduleTicket=0;
const activityScheduleTime=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const activityScheduleSummary=r=>r.mode==='interval'?'每隔 '+r.interval_minutes+' 分钟':r.mode==='daily'?'每天 '+r.daily:'延后执行一次';
function activityScheduleControls(){
  const busy=activityScheduleBusy||pluginBusy;
  for(const node of document.querySelectorAll('#activity-schedules button,#activity-schedule-form input,#activity-schedule-form select,#activity-schedule-form textarea'))node.disabled=busy;
  const mode=$('activity-schedule-mode').value;
  for(const name of ['interval','daily','delay']){const show=name===(mode==='once'?'delay':mode);$('activity-schedule-'+name+'-label').hidden=!show;$('activity-schedule-'+name).disabled=busy||!show;}
  $('activity-schedule-target').disabled=busy||activityScheduleEditing?.channel==='web';
  $('activity-schedule-enabled').disabled=busy||!activityScheduleSnapshot?.enabled;
  $('activity-schedule-save').disabled=busy||!activityScheduleSnapshot||!$('activity-schedule-target').options.length;
}
function activityScheduleReset(row=null){
  activityScheduleEditing=row;activityScheduleDirty=false;const snapshot=activityScheduleSnapshot;
  const target=$('activity-schedule-target');target.replaceChildren();
  if(row?.channel==='web'){const option=el('option','','原网页试聊会话');option.value=row.user_id;target.append(option);}
  else for(const id of snapshot?.targets||[]){const option=el('option','','QQ 私聊 · '+id);option.value=id;target.append(option);}
  if(row)target.value=row.user_id;
  $('activity-schedule-mode').value=row?.mode||'interval';$('activity-schedule-interval').value=row?.interval_minutes||30;$('activity-schedule-daily').value=row?.daily||'20:30';$('activity-schedule-delay').value=row?.delay_minutes||10;$('activity-schedule-focus').value=row?.focus||'';$('activity-schedule-enabled').checked=row?row.enabled:!!snapshot?.enabled;
  $('activity-schedule-editor-title').textContent=row?'编辑定时 · '+row.id:'新增定时';$('activity-schedule-save').textContent=row?'保存定时':'新增定时';$('activity-schedule-reset').hidden=!row;
  $('activity-schedule-draft').textContent=row?'修改后从保存时重新计时；旧轮次会停止，已完成的操作保留。':'新增定时从保存时开始计时。';
  activityScheduleControls();
}
function activityScheduleRender(){
  const snapshot=activityScheduleSnapshot,root=$('activity-schedule-list');root.replaceChildren();if(!snapshot)return;
  $('activity-schedule-status').textContent=!snapshot.enabled?'插件已停用。可保存停用的定时；启用插件后再开启定时。':!snapshot.targets.length?'没有可选的 QQ 会话。请先保存插件好友范围，并检查管理员与 AI 白名单。':'当前 '+snapshot.schedules.filter(r=>r.enabled).length+' 个定时已启用 · 每个会话最多 '+snapshot.max_schedules+' 个。';
  if(!snapshot.schedules.length)root.append(el('p','activity-schedule-empty','还没有定时。在下方选择会话和执行时间，即可新增。'));
  for(const row of snapshot.schedules){
    const item=el('article','activity-schedule-row'),body=el('div'),title=el('div','inline-actions'),buttons=el('div','inline-actions');
    title.append(el('strong','',activityScheduleSummary(row)),badge(row.enabled?'已启用':'已停用',row.enabled?'ok':''));
    body.append(title,el('p','',(row.channel==='web'?'网页试聊':'QQ 私聊 · '+row.user_id)+' · '+(row.enabled?'下次 '+activityScheduleTime(row.next_at):'定时 '+row.id)),el('p','',row.focus));
    if(['queued','generating','ready','sending','uncertain'].includes(row.pending_status))body.append(el('p','',row.pending_status==='uncertain'?'上一轮结果待核对；暂不安排新轮次。':'已有一轮排队或执行中。'));
    for(const [label,action] of [['编辑','edit'],[row.enabled?'停用':'启用','toggle'],['删除','delete']]){
      const button=el('button','button small'+(action==='delete'?' danger':''),label);button.type='button';button.setAttribute('aria-label',label+'定时 '+row.id);button.dataset.scheduleAction=action;button.dataset.scheduleId=row.id;
      button.onclick=async()=>{if(activityScheduleBusy||pluginBusy)return;if(activityScheduleDirty&&!await confirmAction('放弃未保存的定时修改？','当前定时草稿尚未保存。'))return;
        if(action==='edit'){activityScheduleReset(row);$('activity-schedule-form').scrollIntoView({block:'nearest'});$('activity-schedule-focus').focus();return;}
        if(action==='delete'&&!await confirmAction('删除此定时？','会停止它尚未完成的轮次，已提交的操作可能已经生效。'))return;
        await activityScheduleAction({action,id:row.id,revision:row.revision,...(action==='toggle'?{enabled:!row.enabled}:{})});
      };buttons.append(button);
    }
    item.append(body,buttons);root.append(item);
  }
  activityScheduleControls();
}
async function activityScheduleLoad(){
  const id=pluginEditing?.id;if(pluginDraftKind!=='free-activity'||!id)return;
  const ticket=++activityScheduleTicket;activityScheduleBusy=true;activityScheduleControls();$('activity-schedule-status').textContent='正在读取定时…';problem('activity-schedule-error',null);
  try{const snapshot=await api('/plugins/free-activity?id='+encodeURIComponent(id));if(ticket!==activityScheduleTicket||id!==pluginEditing?.id)return;activityScheduleSnapshot=snapshot;activityScheduleReset();activityScheduleRender();}
  catch(error){if(ticket===activityScheduleTicket){problem('activity-schedule-error',error);$('activity-schedule-status').textContent='读取失败，请刷新重试。';}}
  finally{if(ticket===activityScheduleTicket){activityScheduleBusy=false;activityScheduleControls();}}
}
function activityScheduleOpen(p){
  activityScheduleTicket++;activityScheduleBusy=false;activityScheduleSnapshot=null;activityScheduleDirty=false;activityScheduleEditing=null;$('activity-schedules').hidden=p.kind!=='free-activity';
  if(p.kind!=='free-activity')return;
  $('activity-schedule-list').replaceChildren();activityScheduleReset();
  if(p.id)void activityScheduleLoad();else $('activity-schedule-status').textContent='先保存插件并设置好友范围，再配置定时。';
}
async function activityScheduleAction(values){
  const id=pluginEditing?.id,ticket=activityScheduleTicket;activityScheduleBusy=true;activityScheduleControls();problem('activity-schedule-error',null);
  try{const snapshot=await api('/plugins/free-activity/action',{plugin_id:id,plugin_revision:activityScheduleSnapshot.plugin_revision,...values});if(id!==pluginEditing?.id||ticket!==activityScheduleTicket)return;activityScheduleSnapshot=snapshot;activityScheduleReset();activityScheduleRender();notify(values.action==='delete'?'定时已删除。':'定时已保存并生效。');}
  catch(error){if(id===pluginEditing?.id&&ticket===activityScheduleTicket){problem('activity-schedule-error',error);$('activity-schedule-error').focus();}}
  finally{if(ticket===activityScheduleTicket){activityScheduleBusy=false;activityScheduleControls();}}
}
$('activity-schedule-form').addEventListener('input',()=>{activityScheduleDirty=true;$('activity-schedule-draft').textContent='定时有未保存修改。点击“保存定时”或“新增定时”生效。';activityScheduleControls();});
$('activity-schedule-mode').addEventListener('change',activityScheduleControls);
$('activity-schedule-form').addEventListener('submit',async event=>{event.preventDefault();if(activityScheduleBusy||pluginBusy||!activityScheduleSnapshot)return;
  await activityScheduleAction({action:'save',...(activityScheduleEditing?{id:activityScheduleEditing.id,revision:activityScheduleEditing.revision}:{}),user_id:$('activity-schedule-target').value,mode:$('activity-schedule-mode').value,interval_minutes:Number($('activity-schedule-interval').value),daily:$('activity-schedule-daily').value,delay_minutes:Number($('activity-schedule-delay').value),focus:$('activity-schedule-focus').value,enabled:$('activity-schedule-enabled').checked});
});
$('activity-schedule-reset').onclick=()=>activityScheduleReset();
$('activity-schedule-refresh').onclick=async()=>{if(activityScheduleBusy||pluginBusy)return;if(activityScheduleDirty&&!await confirmAction('放弃未保存的定时修改？','刷新会读取最新定时并替换草稿。'))return;await activityScheduleLoad();};
`;
