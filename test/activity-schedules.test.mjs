import test from 'node:test';
import assert from 'node:assert/strict';
import {app,request} from './helpers.mjs';
const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'};
async function setup(t){
  const bot=await app(t,env);let p=await bot.plugins.install({kind:'free-activity'});
  p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});p=await bot.plugins.toggle({id:p.id,revision:p.revision,enabled:true});
  clearInterval(bot.agent.freeActivity.timer);await bot.worker.close();
  const get=()=>request(bot,'/admin/plugins/free-activity?id='+p.id);
  const act=values=>request(bot,'/admin/plugins/free-activity/action',{plugin_id:p.id,plugin_revision:p.revision,action:'save',mode:'interval',interval_minutes:30,focus:'查看天气灵感',user_id:'10001',enabled:true,...values});
  return {bot,p,get,act};
}
test('schedule management requires admin authentication and target scope, and returns the real shared schedule table',async t=>{
  const f=await setup(t),path='/admin/plugins/free-activity?id='+f.p.id;
  assert.equal((await request(f.bot,path,undefined,false)).code,401);assert.equal((await request(f.bot,path,undefined,'onebot')).code,401);
  assert.equal((await request(f.bot,'/admin/plugins/free-activity/action',{},'onebot')).code,401);
  assert.deepEqual((await f.get()).data.targets,['10001']);assert.equal((await f.act({user_id:'10002'})).code,400);
  const added=await f.act({});assert.equal(added.code,200);const row=added.data.schedules[0];assert.equal(row.enabled,true);assert.match(row.conversation,/:private:10001$/);
  assert.equal(f.bot.store.db.prepare('SELECT COUNT(*) n FROM free_activity_schedules').get().n,1);
});
test('daily and one-shot schedules validate inputs and expose correct Beijing next times',async t=>{
  const f=await setup(t);
  for(const values of [{interval_minutes:0},{mode:'daily',daily:'26:00'},{mode:'once',delay_minutes:0},{mode:'other'},{focus:'x'.repeat(1001)}])assert.notEqual((await f.act(values)).code,200);
  const daily=await f.act({mode:'daily',daily:'20:30'});assert.equal(daily.code,200);const row=daily.data.schedules[0];assert.equal(new Date(row.next_at).getUTCHours(),12);assert.equal(new Date(row.next_at).getUTCMinutes(),30);
  const before=Date.now(),once=await f.act({mode:'once',delay_minutes:10});assert.equal(once.code,200);assert.ok(once.data.schedules.find(s=>s.mode==='once').next_at>=before+600000);
});
test('offline drafts remain disabled until login and bind to the real account when enabled',async t=>{
  const f=await setup(t),account=f.bot.adapter.driver.account;f.bot.adapter.driver.account=0;
  const result=await f.act({enabled:false});assert.equal(result.code,200);let row=result.data.schedules[0];assert.match(row.conversation,/^0:private:/);assert.equal(row.enabled,false);
  assert.equal((await f.act({action:'toggle',id:row.id,revision:row.revision,enabled:true})).code,400);
  f.bot.adapter.driver.account=account;
  const resumed=await f.act({action:'toggle',id:row.id,revision:row.revision,enabled:true});assert.equal(resumed.code,200);row=resumed.data.schedules[0];assert.equal(row.enabled,true);assert.equal(row.conversation,account+':private:10001');
});
test('editing cancels queued work and stale edits and chat cancellations cannot overwrite newer changes',async t=>{
  const f=await setup(t);let row=(await f.act({interval_minutes:1})).data.schedules[0];
  f.bot.agent.freeActivity.tick(row.next_at+1);const dbrow=f.bot.store.db.prepare('SELECT * FROM free_activity_schedules WHERE id=?').get(row.id);assert.equal(f.bot.store.get(dbrow.pending_job).status,'queued');
  const edited=await f.act({id:row.id,revision:row.revision,interval_minutes:60});assert.equal(edited.code,200);assert.equal(f.bot.store.get(dbrow.pending_job).status,'ignored');assert.equal(edited.data.schedules[0].interval_minutes,60);
  assert.equal((await f.act({id:row.id,revision:row.revision,interval_minutes:90})).code,409);
  row=edited.data.schedules[0];const e=JSON.parse(f.bot.store.db.prepare('SELECT event FROM free_activity_schedules WHERE id=?').get(row.id).event);
  f.bot.agent.freeActivity.control({action:'cancel',id:row.id},e,{channel:'qq',conversation:row.conversation});
  assert.equal((await f.act({id:row.id,revision:row.revision})).code,409);assert.equal((await f.get()).data.schedules[0].enabled,false);
});
test('timers survive plugin configuration saves and reloads, while disabling stops them',async t=>{
  const f=await setup(t);const row=(await f.act({})).data.schedules[0];
  let p=await f.bot.plugins.save({id:f.p.id,revision:f.p.revision,plugin:{...f.p,config:{...f.p.config,interests:'画画'}}});
  assert.equal((await f.get()).data.schedules[0].enabled,true);
  p=await f.bot.plugins.reload({id:p.id,revision:p.revision});assert.equal((await f.get()).data.schedules[0].enabled,true);
  assert.equal((await f.act({id:row.id,revision:row.revision})).code,409);
  await f.bot.plugins.toggle({id:p.id,revision:p.revision,enabled:false});assert.equal((await f.get()).data.schedules[0].enabled,false);
});
test('toggle and delete use schedule revisions and safely limit active schedules per conversation',async t=>{
  const f=await setup(t);for(let i=0;i<5;i++)assert.equal((await f.act({})).code,200);assert.equal((await f.act({})).code,400);
  let row=(await f.get()).data.schedules[0];const stopped=await f.act({action:'toggle',id:row.id,revision:row.revision,enabled:false});assert.equal(stopped.code,200);row=stopped.data.schedules.find(s=>s.id===row.id);assert.equal(row.enabled,false);
  assert.equal((await f.act({action:'toggle',id:row.id,revision:row.revision,enabled:true})).code,200);
  row=(await f.get()).data.schedules.find(s=>s.id===row.id);assert.equal((await f.act({action:'delete',id:row.id,revision:row.revision})).code,200);assert.equal((await f.get()).data.schedules.length,4);
});
