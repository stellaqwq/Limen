import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {app,request,waitFor} from './helpers.mjs';
import {roomSnapshot,computerTool} from '../src/agent/room.mjs';
test('room projection is admin-only and isolates web sessions without tool arguments',async t=>{
  const bot=await app(t),a=randomUUID(),b=randomUUID();
  const event={self_id:0,user_id:0,message_id:randomUUID(),post_type:'message',message_type:'private',message:[]};
  const job=bot.store.ingest(event,'private input',100,null,a);bot.agent.state.begin(job,'test');bot.agent.state.step(job,'tool','plugin_fixture_run_command')('succeeded');
  const result=await request(bot,'/admin/agent/room?session='+a);assert.equal(result.code,200);assert.equal(result.data.current.computer,true);assert.equal(result.data.current.id,job.id);
  assert.ok(!JSON.stringify(result.data).includes('private input'));assert.equal(roomSnapshot(bot.agent,b).jobs.length,0);
  assert.equal((await request(bot,'/admin/agent/room?session='+a,undefined,'onebot')).code,401);
  assert.equal((await request(bot,'/admin/agent/room?session=bad')).code,400);
  assert.equal(computerTool('current_time'),false);assert.equal(computerTool('memory_search'),false);assert.equal(computerTool('browser_navigate'),true);
});
test('real ordinary web reply reaches completed room state and never sends QQ messages',async t=>{
  const bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'},{ai:{reply:async()=> 'ordinary chat reply'}});let sent=0;bot.adapter.on('outgoing',()=>sent++);
  const result=await request(bot,'/admin/agent/chat',{text:'hello'});assert.equal(result.code,200);
  await waitFor(()=>bot.store.get(result.data.job_id)?.status==='done');const view=roomSnapshot(bot.agent,result.data.session);
  assert.equal(view.current.status,'done');assert.equal(view.current.computer,false);assert.equal(view.current.reply,'ordinary chat reply');assert.equal(sent,0);
});
