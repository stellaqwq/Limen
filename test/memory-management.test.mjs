import test from 'node:test';
import assert from 'node:assert/strict';
import {app,request,config,temp,cleanup} from './helpers.mjs';
import {launchWorkspace} from '../scripts/launch.mjs';
import {buildMemoryGraph} from '../src/web/memory-graph.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001,10002'};
async function setup(t){const bot=await app(t,env);let p=await bot.plugins.install({kind:'living-memory'});p=await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001','10002']}}});return {bot,p};}
const scope='10000:private:10001';
const save=(p,patch={})=>({action:'save',scope,persona:'',plugin_revision:p.revision,key:'饮品偏好',content:'喜欢茉莉花茶',type:'preference',tags:['茶'],...patch});

test('one memory owns one stable 3D node and one connection; appending does not rewrite old connections',()=>{
  const rows=Array.from({length:60},(_,i)=>({id:'memory-'+i,key:'记忆'+i,type:['fact','preference','relationship','plan','event'][i%5],created_at:i,status:'active'}));
  const graph=buildMemoryGraph(rows),extended=buildMemoryGraph([...rows,{id:'new-memory',type:'fact',created_at:100,status:'active'}]);
  assert.equal(graph.nodes.length,61);assert.equal(graph.edges.length,60);assert.equal(extended.edges.length,61);
  assert.deepEqual(extended.edges.slice(0,60),graph.edges);assert.equal(new Set(graph.edges.map(e=>e.id)).size,rows.length);
  const ids=new Set(graph.nodes.map(n=>n.id));assert.ok(graph.edges.every(e=>ids.has(e.from)&&ids.has(e.to)&&e.to===e.id));
  assert.ok(graph.nodes.some(n=>Math.abs(n.position[2])>1));assert.ok(graph.edges.every(e=>e.points.length===37));
  assert.equal(buildMemoryGraph([]).edges.length,0);
});

test('memory admin overview is authenticated, isolates users/personas and does not expose embedding credentials or source bodies',async t=>{
  const {bot,p}=await setup(t);
  assert.equal((await request(bot,'/admin/plugins/memory',undefined,'onebot')).code,401);
  assert.equal((await request(bot,'/admin/plugins/memory',undefined,false)).code,401);
  const first=await request(bot,'/admin/plugins/memory/action',save(p));assert.equal(first.code,200);
  await request(bot,'/admin/plugins/memory/action',save(p,{scope:'10000:private:10002',content:'另一位用户的偏好'}));
  const view=await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope));
  assert.equal(view.data.memories.length,1);assert.equal(view.data.memories[0].content,'喜欢茉莉花茶');assert.equal(view.data.memories[0].pinned,true);
  assert.ok(!JSON.stringify(view.data).includes('embedding_api_key'));assert.ok(!Object.hasOwn(view.data.memories[0],'source'));
  const otherId=bot.store.db.prepare('SELECT id FROM living_memories WHERE scope=?').get('10000:private:10002').id;
  assert.equal((await request(bot,'/admin/plugins/memory/action',{...save(p),id:otherId,revision:'bad',action:'forget'})).code,404);
  assert.equal((await request(bot,'/admin/plugins/memory?scope=10000:private:99999')).code,404);
  assert.equal((await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope)+'&persona=other')).code,404);
});

test('standalone memory CRUD works while plugin is disabled and protects revisions, unique names and lifecycle metadata',async t=>{
  const {bot,p}=await setup(t);assert.equal(p.enabled,false);
  const added=await request(bot,'/admin/plugins/memory/action',save(p));assert.equal(added.code,200);
  let m=(await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope))).data.memories[0];
  const changed=await request(bot,'/admin/plugins/memory/action',{...save(p),id:m.id,revision:m.revision,key:'茶饮',content:'现在偏爱乌龙茶'});
  assert.equal(changed.code,200);assert.equal(changed.data.id,m.id);
  assert.equal(bot.store.db.prepare('SELECT COUNT(*) AS n FROM living_memories').get().n,1);
  assert.equal((await request(bot,'/admin/plugins/memory/action',{...save(p),id:m.id,revision:m.revision,content:'过期草稿'})).code,409);
  assert.equal((await request(bot,'/admin/plugins/memory/action',save(p,{key:'茶饮'}))).code,409);
  m=(await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope))).data.memories[0];
  assert.equal((await request(bot,'/admin/plugins/memory/action',{...save(p),action:'archive',id:m.id,revision:m.revision})).code,200);
  m=(await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope))).data.memories[0];assert.equal(m.status,'archived');
  assert.equal((await request(bot,'/admin/plugins/memory/action',{...save(p),id:m.id,revision:m.revision,key:'茶饮',content:'归档内容已编辑'})).code,200);
  m=(await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope))).data.memories[0];assert.equal(m.status,'archived');assert.equal(m.pinned,true);
  await request(bot,'/admin/plugins/memory/action',{...save(p),action:'restore',id:m.id,revision:m.revision});
  m=(await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope))).data.memories[0];assert.equal(m.status,'active');
  await request(bot,'/admin/plugins/memory/action',{...save(p),action:'forget',id:m.id,revision:m.revision});
  assert.equal((await request(bot,'/admin/plugins/memory')).data.counts.total,0);
});

test('management rejects unsafe content, stale plugin configuration and overlapping model updates during embedding',async t=>{
  const {bot,p}=await setup(t);
  assert.equal((await request(bot,'/admin/plugins/memory/action',save(p,{content:'api_key: do-not-save'}))).code,400);
  assert.equal((await request(bot,'/admin/plugins/memory/action',save(p,{plugin_revision:999}))).code,409);
  await request(bot,'/admin/plugins/memory/action',save(p));
  const m=(await request(bot,'/admin/plugins/memory?scope='+encodeURIComponent(scope))).data.memories[0];
  let release;bot.livingMemory.embed=()=>new Promise(resolve=>{release=resolve;});
  const pending=bot.plugins.admin('memory').action({...save(p),id:m.id,revision:m.revision,content:'后台编辑'});
  bot.store.db.prepare('UPDATE living_memories SET content=?,updated_at=updated_at+1 WHERE id=?').run('模型刚刚更新',m.id);release(null);
  await assert.rejects(pending,error=>error.status===409);
  assert.equal(bot.store.db.prepare('SELECT content FROM living_memories WHERE id=?').get(m.id).content,'模型刚刚更新');
});

test('editing discards pending summary turns atomically while creation and failed edits retain them',async t=>{
  const {bot,p}=await setup(t),db=bot.store.db;
  const turn=db.prepare('INSERT INTO living_memory_turns(plugin_id,scope,persona,conversation,job_id,input,reply,created_at) VALUES (?,?,?,?,?,?,?,?)');
  turn.run(p.id,scope,'',scope,1,'旧偏好','已记录',Date.now());
  turn.run(p.id,'10000:private:10002','','10000:private:10002',2,'其他用户','保留',Date.now());
  await bot.plugins.admin('memory').action(save(p));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns').get().n,2);
  const m=bot.plugins.admin('memory').overview(scope).memories[0],params={...save(p),id:m.id,revision:m.revision,key:'改名后的偏好',content:'纠正后的偏好'};
  const put=bot.livingMemory.put;bot.livingMemory.put=()=>{throw Error('simulated database write failure');};
  await assert.rejects(bot.plugins.admin('memory').action(params),/simulated database write failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns').get().n,2);
  assert.equal(db.prepare('SELECT key FROM living_memories WHERE id=?').get(m.id).key,'饮品偏好');
  bot.livingMemory.put=put;
  await bot.plugins.admin('memory').action(params);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns WHERE scope=?').get(scope).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM living_memory_turns WHERE scope=?').get('10000:private:10002').n,1);
});

test('new memory management proxy preserves local origin and independent admin authentication',async t=>{
  const workspace=await launchWorkspace(config(await temp(t),env));cleanup(t,()=>workspace.close());
  const p=await workspace.app.plugins.install({kind:'living-memory'});await workspace.app.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});
  assert.equal((await fetch(workspace.url+'/plugins/memory')).status,200);
  assert.equal((await fetch(workspace.url+'/plugins/memory/action',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'{}'})).status,403);
  const html=await(await fetch(workspace.url)).text();assert.ok(html.includes('memory-canvas'));assert.ok(!html.includes(workspace.app.config.adminToken));
});
