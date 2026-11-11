import test from 'node:test';
import assert from 'node:assert/strict';
import {AIClient} from '../src/ai.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';
import {app,config,incoming,waitFor} from './helpers.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'};
const event={post_type:'message',message_type:'private',self_id:10000,user_id:10001,message:[{type:'text',data:{text:'去抖音看看'}}]};
const job={id:1,channel:'qq',conversation:'10000:private:10001'};
const call=(name,args)=>({tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
function browser(){return {running:true,actions:[],async evaluate(expression){if(expression!==snapshotExpression)throw Error('Unexpected DOM mutation');return {url:'https://www.douyin.com/',text:'【本地模拟】视频画面',title:'抖音',blocked:null,video_id:'7703905545174140001',media_key:'fixture-video',video:{paused:false,ready_state:4,current_seconds:3,duration_seconds:20,width:800,height:600,x:400,y:300}};},async screenshot(){return 'data:image/jpeg;base64,/9j/';},async open(){this.actions.push('open');},async next(){this.actions.push('next');},async close(){this.running=false;}};}
async function setup(bot){await applyDouyinSetup(bot.plugins,{qq_private_enabled:true,social_enabled:true,chat_read_enabled:true,knowledge_enabled:true,knowledge_auto_archive:false});const p=bot.plugins.find('douyin-web');return bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:['10001']}}});}

test('QQ browsing requires enabled switch, administrator, private scope and QQ job; social tools stay web-scoped',async t=>{
  const b=browser(),bot=await app(t,env,{douyinBrowser:b});await applyDouyinSetup(bot.plugins);let p=bot.plugins.find('douyin-web');
  assert.equal(bot.douyinWeb.tools(event,job).length,0);await setup(bot);
  const tools=bot.douyinWeb.tools(event,job);assert.ok(tools.some(t=>t.name==='douyin_web_observe'));assert.ok(tools.some(t=>t.name==='video_knowledge_save'));assert.ok(!tools.some(t=>/social|chat_read/.test(t.name)));
  assert.doesNotMatch(bot.douyinWeb.prompt(event,job),/分享与私信：/);assert.match(bot.douyinWeb.prompt(event,job),/当前具备抖音网页浏览能力/);
  for(const [e,j] of [[{...event,user_id:10002},job],[{...event,message_type:'group',group_id:20001},job],[event,{...job,channel:'other'}]])assert.equal(bot.douyinWeb.tools(e,j).length,0);
  p=bot.plugins.find('douyin-web');await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,scope:{...p.scope,private_users:[]}}});assert.equal(bot.douyinWeb.tools(event,job).length,0);await assert.rejects(async()=>tools[0].invoke({}),/变更/);assert.deepEqual(b.actions,[]);
});
test('QQ capability question sees current tools, answers can browse, and does not start browser actions',async t=>{
  let requests=0;class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages,signal,tools){requests++;assert.ok(tools.some(t=>t.function.name==='douyin_web_observe'));assert.match(messages[0].content,/当前具备抖音网页浏览能力/);return {content:'可以，我能通过专用浏览器观看抖音并总结画面。'};}}
  const b=browser(),bot=await app(t,env,{douyinBrowser:b,ai:new Model()});await setup(bot);
  bot.adapter.driver.inject(incoming(81001,{message:'你能去刷抖音吗？'}));await waitFor(()=>bot.store.get(1)?.status==='done');assert.match(bot.store.get(1).reply,/可以/);assert.equal(requests,1);assert.deepEqual(b.actions,[]);
});
test('QQ task samples images, switches once and summarizes through the existing Agent queue',async t=>{
  let requests=0;class Model extends AIClient{constructor(){super(config('unused').ai);}async completion(messages,signal,tools){requests++;assert.ok(!tools.some(t=>/douyin_social|douyin_chat/.test(t.function.name)));
    if(requests===1)return call('douyin_web_status',{});
    if(requests===2)return call('douyin_web_observe',{frames:1});
    if(requests===3){assert.ok(Array.isArray(messages.at(-1).content)&&messages.at(-1).content.some(p=>p.type==='image_url'));const result=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('douyin_web_action',{action:'next_video',operation_id:'next-one',observation_id:result.observation_id});}
    if(requests===4)return call('douyin_web_observe',{frames:1});
    return {content:'已观看两条视频并根据采样画面完成总结。'};
  }}
  const b=browser(),bot=await app(t,env,{douyinBrowser:b,ai:new Model()});await setup(bot);
  bot.adapter.driver.inject(incoming(81002,{message:'去抖音看两条视频并总结，只观看和切换。'}));
  const result=await waitFor(()=>{const r=bot.store.get(1);return ['done','failed'].includes(r?.status)&&r;});assert.equal(result.status,'done',JSON.stringify({reason:result.reason,requests,trace:bot.agent.state.trace(1)}));assert.deepEqual(b.actions,['next']);assert.equal(requests,5);
  assert.deepEqual(bot.agent.state.trace(1).filter(s=>s.kind==='tool').map(s=>s.name),['douyin_web_status','douyin_web_observe','douyin_web_action','douyin_web_observe']);
  assert.equal(bot.store.db.prepare("SELECT COUNT(*) n FROM agent_receipts WHERE result LIKE '%base64%'").get().n,0);assert.equal(bot.douyinWeb.owner,null);
});
