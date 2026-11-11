import test from 'node:test';
import assert from 'node:assert/strict';
import {AIClient} from '../src/ai.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {douyinConfig} from '../../../plugins/douyin-web/config.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';
import {DouyinAutoChat} from '../../../plugins/douyin-web/auto-chat.mjs';
import {app,config,waitFor,request} from './helpers.mjs';

const tool=(name,args)=>({tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
class Model extends AIClient {
  constructor(){super(config('unused').ai);this.calls=0;}
  async completion(messages){
    this.calls++;const last=messages.at(-1);
    if(last.role==='user')return tool('douyin_social_open',{operation_id:'open',surface:'messages',select_default:true});
    if(last.tool_call_id==='douyin_social_open')return tool('douyin_chat_read',{limit:12});
    if(last.tool_call_id==='douyin_chat_read')return tool('douyin_social_draft',{operation_id:'draft',kind:'private_message',content:'【本地模拟】自动聊天回复',reply_to:JSON.parse(last.content).messages.at(-1).message_ref});
    return {content:'已生成回复草稿。'};
  }
}
function browser(){
  const account={uid:'im-user:101',name:'发送账号',avatar:'self.png'},recipient={uid:'conversation:0:1:101:202',canonical_id:'user:peer',handle:'test-friend',name:'测试好友',avatar:'peer.png'};
  const b={running:true,commits:0,composer:'',messages:[],account,recipient,
    async evaluate(expression){
      if(expression===snapshotExpression)return {url:'https://www.douyin.com/',text:'',video:null,blocked:null};
      const p=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));
      if(p.phase==='open')return {ok:true};
      if(p.phase==='inspect')return {ok:true,account,contacts:[recipient],composer_empty:!b.composer,selected_uid:recipient.uid};
      if(p.phase==='read_chat')return {ok:true,messages:structuredClone(b.messages),order:'oldest_to_newest_by_server_id'};
      if(p.expected_incoming_id&&b.messages.at(-1)?.id!==p.expected_incoming_id)return {ok:false,reason:'incoming_changed'};
      if(p.phase==='focus')return b.composer&&b.composer!==p.content?{ok:false,reason:'existing_composer_text'}:{ok:true,already_filled:b.composer===p.content};
      if(p.phase==='preflight'||p.phase==='commit'){
        if(b.composer!==p.content)return {ok:false,reason:'content_changed'};
        if(p.phase==='commit'){b.commits++;if(b.unknown)throw Error('response lost');b.messages.push(message(BigInt(b.messages.at(-1).id)+1n,'self',b.composer));b.composer='';return {ok:true,submitted:true};}
      }
      return {ok:true};
    },async page(method,args){assert.equal(method,'Input.insertText');b.composer=args.text;},async screenshot(){if(b.onScreenshot)await b.onScreenshot();return 'data:image/jpeg;base64,/9j/';},async close(){b.running=false;}};
  return b;
}
const message=(id,direction='peer',text='你好')=>({id:String(id),server_id:String(id),direction,text,kind:'text'});
async function fixture(t){
  const b=browser(),model=new Model(),bot=await app(t,{AI_ENABLED:'true',AI_MODEL:'fixture',AI_ALLOWED_USERS:'10001'},{douyinBrowser:b,ai:model}),auto=bot.douyinWeb.autoChat;
  clearInterval(auto.timer);auto.timer=null;let now=Date.now();auto.now=()=>now;
  await applyDouyinSetup(bot.plugins,{social_enabled:true,chat_read_enabled:true,social_default_friend:'test-friend',chat_auto_enabled:true,chat_auto_interval_seconds:10});
  const tick=async()=>{now+=11000;await auto.tick();};
  const save=async patch=>{const p=bot.plugins.find('douyin-web');await bot.plugins.save({id:p.id,revision:p.revision,plugin:{...p,config:{...p.config,...patch}}});};
  const incoming=async(id='7703905545174140475')=>{b.messages.push(message(id));await tick();assert.ok(auto.pending,auto.reason);await waitFor(()=>bot.store.get(auto.pending.jobId)?.status==='done');};
  return {b,model,bot,auto,tick,save,incoming};
}

test('automatic chat defaults off, validates bounds, and prerequisites do not authorize a send',async t=>{
  assert.equal(douyinConfig().chat_auto_enabled,false);assert.throws(()=>douyinConfig({chat_auto_interval_seconds:0}));assert.throws(()=>douyinConfig({chat_auto_max_per_hour:121}));
  const f=await fixture(t);await f.save({chat_read_enabled:false});await f.tick();assert.equal(f.auto.phase,'waiting');assert.equal(f.b.commits,0);assert.equal(f.model.calls,0);
});

test('initial page loading retries bounded UI reads without sending or calling the model',async t=>{
  const f=await fixture(t),evaluate=f.b.evaluate;let attempts=0;
  f.b.evaluate=async expression=>{if(expression!==snapshotExpression){const p=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));if(p.phase==='open'&&attempts++<2)return {ok:false,reason:'open_manually'};}return evaluate(expression);};
  await f.tick();assert.equal(f.auto.phase,'waiting');assert.equal(f.auto.blocked,false);
  await f.tick();assert.equal(f.auto.phase,'waiting');assert.equal(f.auto.blocked,false);
  await f.tick();assert.equal(f.auto.phase,'watching');assert.equal(f.model.calls,0);assert.equal(f.b.commits,0);
});
test('baseline skips history, new inbound runs restricted model and one automatic send, then verifies and deduplicates',async t=>{
  const f=await fixture(t);f.b.messages=[message('7703905545174140400')];await f.tick();assert.equal(f.model.calls,0);
  await f.incoming();assert.equal(f.model.calls,4);await f.tick();assert.equal(f.b.commits,1);assert.equal(f.auto.phase,'checking');
  await f.tick();assert.equal(f.auto.pending,null);assert.equal(f.auto.phase,'watching');
  await f.tick();await f.tick();assert.equal(f.b.commits,1);assert.equal(f.model.calls,4);
  assert.equal(f.bot.store.db.prepare("SELECT state FROM douyin_auto_chat_attempts").get().state,'observed');
  assert.equal((await request(f.bot,'/admin/agent')).data.douyin_web.auto_chat.enabled,true);
});
test('turning off, stopping browser controls, or configuration change revokes a generated auto reply',async t=>{
  for(const action of ['disable','stop','change']){
    const f=await fixture(t);await f.tick();await f.incoming();
    if(action==='disable')await f.save({chat_auto_enabled:false});else if(action==='stop')f.bot.douyinWeb.control({action:'stop'});else await f.save({social_default_friend:'other'});
    await f.tick();assert.equal(f.b.commits,0,action);
  }
});
test('messages arriving during generation prevent a stale reply and typed text is never overwritten',async t=>{
  const f=await fixture(t);await f.tick();await f.incoming();f.b.messages.push(message('7703905545174140500'));await f.tick();assert.equal(f.b.commits,0);assert.equal(f.auto.pending,null);
  f.b.composer='手动未发送的文字';await f.tick();assert.equal(f.auto.phase,'waiting');assert.equal(f.b.composer,'手动未发送的文字');assert.equal(f.b.commits,0);
});
test('a settings revocation during preparation cannot reach final activation',async t=>{
  const f=await fixture(t);await f.tick();await f.incoming();f.b.onScreenshot=()=>f.save({chat_auto_enabled:false});await f.tick();assert.equal(f.b.commits,0);
});
test('uncertain sends are latched and never retried, including after restart',async t=>{
  const f=await fixture(t);await f.tick();await f.incoming();f.b.unknown=true;await f.tick();assert.equal(f.b.commits,1);assert.equal(f.auto.blocked,true);
  await f.tick();assert.equal(f.b.commits,1);const restarted=new DouyinAutoChat(f.bot.douyinWeb);assert.equal(f.bot.store.db.prepare('SELECT state FROM douyin_auto_chat_attempts').get().state,'interrupted');await restarted.close();assert.equal(f.b.commits,1);
});
test('hourly limit suppresses further generation, and browser lease prevents background interference',async t=>{
  const f=await fixture(t);await f.save({chat_auto_max_per_hour:1});await f.tick();await f.incoming();await f.tick();await f.tick();
  f.b.messages.push(message('7703905545174140600'));await f.tick();assert.equal(f.auto.phase,'limited');assert.equal(f.b.commits,1);assert.equal(f.model.calls,4);
  f.bot.douyinWeb.owner={id:'another-task'};await f.tick();assert.equal(f.b.commits,1);f.bot.douyinWeb.owner=null;
});

test('existing installed plugin editor receives new schema and default-off configuration without reinstalling',async t=>{
  const f=await fixture(t),p=f.bot.plugins.find('douyin-web'),db=f.bot.store.db;
  const definition=JSON.parse(db.prepare('SELECT definition FROM plugins WHERE id=?').get(p.id).definition);
  for(const k of ['chat_auto_enabled','chat_auto_interval_seconds','chat_auto_max_per_hour']){delete definition.config[k];delete definition.config_schema[k];}
  db.prepare('UPDATE plugins SET definition=? WHERE id=?').run(JSON.stringify(definition),p.id);
  const refreshed=f.bot.plugins.get(p.id);assert.equal(refreshed.config_schema.chat_auto_enabled.description,'自动聊天');assert.equal(refreshed.config.chat_auto_enabled,false);assert.equal(refreshed.config.chat_auto_interval_seconds,15);assert.equal(refreshed.config.social_default_friend,'test-friend');
});

test('rotating official avatar CDN preserves exact asset identity and migrates legacy binding hashes',async t=>{
  const {accountKey}=await import('../../../plugins/douyin-web/default-friend.mjs'),{createHash}=await import('node:crypto');const f=await fixture(t);
  f.b.account.avatar='https://p3-pc-sign.douyinpic.com/aweme/avatar/unique.jpeg';await f.tick();
  const legacy=createHash('sha256').update(JSON.stringify({name:f.b.account.name,avatar:f.b.account.avatar})).digest('hex');
  f.bot.store.db.prepare('UPDATE douyin_default_friends SET account_hash=?').run(legacy);
  const first=accountKey(f.b.account);f.b.account.avatar=f.b.account.avatar.replace('p3-pc-sign','p9-pc-sign');assert.equal(accountKey(f.b.account),first);
  await f.tick();assert.equal(f.auto.blocked,false);assert.equal(f.bot.store.db.prepare('SELECT account_hash FROM douyin_default_friends').get().account_hash,first);
  f.b.account.avatar=f.b.account.avatar.replace('unique.jpeg','different.jpeg');await f.tick();assert.equal(f.auto.blocked,true);assert.equal(f.b.commits,0);
});
