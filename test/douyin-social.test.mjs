import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {DouyinWebService} from '../../../plugins/douyin-web/service.mjs';
import {DouyinSocial,socialTools} from '../../../plugins/douyin-web/social.mjs';
import {douyinConfig,douyinTemplate} from '../../../plugins/douyin-web/config.mjs';
import {snapshotExpression} from '../../../plugins/douyin-web/page.mjs';
import {validateSchema} from '../src/agent/schema.mjs';
import {app,temp,cleanup,request,waitFor} from './helpers.mjs';
import {applyDouyinSetup} from '../../../plugins/douyin-web/local.mjs';

const env={AI_ENABLED:'true',AI_MODEL:'social-test',AI_ALLOWED_USERS:'10001'};
function browser(){
  const account={uid:'self',name:'测试账号',avatar:'self.png'},recipient={uid:'friend-1',name:'测试好友',avatar:'friend.png'};
  const b={running:true,commits:0,phase:[],account,recipient,source:'media-current',async evaluate(expression,signal){
    signal?.throwIfAborted();if(expression===snapshotExpression)return {url:'https://www.douyin.com/',text:'测试视频',video:{width:800,height:600},media_key:b.source,blocked:null};
    const p=JSON.parse(expression.slice(expression.lastIndexOf(')(')+2,-1));b.phase.push(p.phase);
    if(p.phase==='inspect')return {ok:true,account,contacts:[recipient],ambiguous:false};
    if(b.rejectPhase===p.phase)return {ok:false,reason:'recipient_changed'};
    if(p.phase==='read_chat')return {ok:true,messages:b.messages||[]};
    if(p.phase==='commit'){b.commits++;if(b.commitWait)return b.commitWait(signal);return b.commitResult||{ok:true,submitted:true};}
    if(b.rejectPhase===p.phase)return {ok:false,reason:'recipient_changed'};
    return {ok:true};
  },async page(method,params){assert.equal(method,'Input.insertText');b.inserted=params.text;},async screenshot(){return 'data:image/jpeg;base64,/9j/';},async close(){b.running=false;}};
  return b;
}
async function fixture(t){const root=await temp(t),store=new Store(join(root,'bot.sqlite'));cleanup(t,()=>store.close());const b=browser(),service=new DouyinWebService({store,config:{dataDir:root},browser:b}),p={...structuredClone(douyinTemplate),id:'social',revision:1,enabled:true,config:douyinConfig({social_enabled:true})};service.pluginFor=()=>p;cleanup(t,()=>service.close());return {store,b,service,p,social:service.social};}
async function draft(f,kind='private_message'){
  const listing=await f.social.inspect(kind==='share_video'?'share':'messages',f.service.controller.signal);
  return f.social.draft(f.p,{kind,recipient_ref:listing.contacts[0].recipient_ref,content:kind==='share_video'?'看看这条视频':'你好，这是待确认的测试草稿。',source_ref:listing.source_ref});
}

test('social tools are opt-in and contain no model send or confirmation-token capability',async t=>{
  for(const t of socialTools)validateSchema(t.parameters);assert.equal(douyinConfig().social_enabled,false);
  assert.equal(socialTools.some(t=>/send|publish|confirm/.test(t.name)),false);
  const f=await fixture(t),d=await draft(f);assert.equal(d.status,'draft');assert.equal(f.b.commits,0);assert.ok(!JSON.stringify(f.social.list()).includes('token_hash'));
});

test('contact and source references are required, surface-scoped and expire without sending',async t=>{
  const f=await fixture(t);assert.throws(()=>f.social.draft(f.p,{kind:'private_message',recipient_ref:'invented',content:'x'}),/过期/);
  const listing=await f.social.inspect('messages',f.service.controller.signal),ref=listing.contacts[0].recipient_ref;
  assert.throws(()=>f.social.draft(f.p,{kind:'share_video',recipient_ref:ref,content:'',source_ref:listing.source_ref}),/不属于/);
  f.social.contacts.get(ref).expires=0;assert.throws(()=>f.social.draft(f.p,{kind:'private_message',recipient_ref:ref,content:'x'}),/过期/);
  assert.equal(f.b.commits,0);
});

test('prepare fills but never sends, confirmation is single use and a UI click is not treated as delivery',async t=>{
  const f=await fixture(t),d=await draft(f),prepared=await f.social.action({id:d.id,revision:d.revision,action:'prepare'});
  assert.equal(f.b.commits,0);assert.equal(f.b.inserted,d.content);assert.equal(prepared.draft.status,'prepared');assert.ok(prepared.confirmation_token);
  const result=await f.social.action({id:d.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token});
  assert.equal(f.b.commits,1);assert.equal(result.draft.status,'uncertain');
  await assert.rejects(f.social.action({id:d.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token}),/更新/);
  assert.equal(f.b.commits,1);assert.equal(f.social.list().drafts[0].status,'uncertain');
});

test('bad or expired confirmation, changed recipient or changed shared video never activate send',async t=>{
  const f=await fixture(t),d=await draft(f,'share_video'),prepared=await f.social.action({id:d.id,revision:d.revision,action:'prepare'}),send={id:d.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token};
  await assert.rejects(f.social.action({...send,confirmation_token:'forged'}),/确认/);
  f.b.rejectPhase='preflight';await assert.rejects(f.social.action(send),/聊天对象/);f.b.rejectPhase=null;
  f.b.source='another-video';await assert.rejects(f.social.action(send),/视频已变化/);f.b.source='media-current';
  f.store.db.prepare('UPDATE douyin_social_drafts SET prepared_at=1 WHERE id=?').run(d.id);await assert.rejects(f.social.action(send),/过期/);
  assert.equal(f.b.commits,0);
});

test('cancellation/unknown command outcome cannot auto-repeat, restart invalidates preparations and records uncertain sends',async t=>{
  const f=await fixture(t),d=await draft(f),prepared=await f.social.action({id:d.id,revision:d.revision,action:'prepare'});let started=false;
  f.b.commitWait=signal=>new Promise((resolve,reject)=>{started=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const sending=f.social.action({id:d.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token});await waitFor(()=>started);f.service.control({action:'stop'});await assert.rejects(sending);
  assert.equal(f.social.list().drafts[0].status,'uncertain');assert.equal(f.b.commits,1);
  const row=f.store.db.prepare('SELECT * FROM douyin_social_drafts WHERE id=?').get(d.id);f.store.db.prepare("UPDATE douyin_social_drafts SET status='sending' WHERE id=?").run(d.id);
  const restarted=new DouyinSocial(f.service);assert.equal(restarted.list().drafts[0].status,'uncertain');
  const resolved=await restarted.action({id:d.id,revision:restarted.list().drafts[0].revision,action:'resolve_cancelled'});assert.equal(resolved.draft.status,'cancelled');assert.equal(f.b.commits,1);
});

test('explicit pre-click DOM rejection stays unsent; concurrent send cannot click twice',async t=>{
  const f=await fixture(t),d=await draft(f),prepared=await f.social.action({id:d.id,revision:d.revision,action:'prepare'});f.b.commitResult={ok:false,reason:'content_changed'};
  await assert.rejects(f.social.action({id:d.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token}),/内容/);
  assert.equal(f.social.list().drafts[0].status,'draft');
  const current=f.social.list().drafts[0],again=await f.social.action({id:d.id,revision:current.revision,action:'prepare'});let release,started=false;
  f.b.commitWait=()=>new Promise(r=>{started=true;release=r;});const send={id:d.id,revision:again.draft.revision,action:'send',confirmation_token:again.confirmation_token};const first=f.social.action(send);await waitFor(()=>started);
  await assert.rejects(f.social.action(send),/另一个任务|已更新/);release({ok:true,submitted:true});await first;assert.equal(f.b.commits,2);
});

test('social admin endpoints reject OneBot credentials and browser task tools never expose a sender',async t=>{
  const b=browser(),bot=await app(t,env,{douyinBrowser:b});await applyDouyinSetup(bot.plugins,{social_enabled:true});
  for(const path of ['/admin/agent/social','/admin/agent/social/inspect','/admin/agent/social/draft','/admin/agent/social/action'])assert.equal((await request(bot,path,path.endsWith('social')?undefined:{surface:'messages'},'onebot')).code,401);
  const inspected=await request(bot,'/admin/agent/social/inspect',{surface:'messages'});assert.equal(inspected.code,200);
  const created=await request(bot,'/admin/agent/social/draft',{recipient_ref:inspected.data.contacts[0].recipient_ref,kind:'private_message',content:'等待确认的草稿'});assert.equal(created.code,200);assert.equal(b.commits,0);
  assert.equal(bot.agent.tools({}, {id:1,channel:'web',conversation:'web:test'}).tools.some(t=>t.name==='douyin_social_send'),false);
  assert.equal(bot.agent.tools({message_type:'private',user_id:10001},{id:1,channel:'qq',conversation:'test'}).tools.some(t=>t.name.startsWith('douyin_social')),false);
});

test('a concurrent cancellation cannot be revived by an in-flight preparation',async t=>{
  const f=await fixture(t),d=await draft(f);let release,started=false;
  f.b.screenshot=()=>new Promise(r=>{started=true;release=()=>r('data:image/jpeg;base64,/9j/');});
  const pending=f.social.action({id:d.id,revision:d.revision,action:'prepare'});await waitFor(()=>started);
  const current=f.social.list().drafts[0];await f.social.action({id:d.id,revision:current.revision,action:'cancel'});release();
  await assert.rejects(pending,/取消或更新/);assert.equal(f.social.list().drafts[0].status,'cancelled');assert.equal(f.b.commits,0);
});


test('default friend is exact, persistent, account-bound and supports cross-surface canonical identities',async t=>{
  const f=await fixture(t);f.p.config.social_default_friend='yirizxc';f.b.recipient.handle='yirizxc';f.b.recipient.canonical_id='user:stable';
  const first=await f.social.inspect('share',f.service.controller.signal);assert.equal(first.default_friend.bound,true);
  f.b.recipient.uid='conversation:0:1:101:202';f.b.recipient.handle='';
  await f.social.inspect('messages',f.service.controller.signal);assert.equal(f.social.draft(f.p,{kind:'private_message',content:'test'}).recipient,'测试好友');
  const restarted=new DouyinSocial(f.service);assert.equal(restarted.defaults.info(f.p).bound,true);
  f.b.account.avatar='another-account.png';await f.social.inspect('messages',f.service.controller.signal);
  assert.throws(()=>f.social.defaultContact('messages'),/账号或好友标识/);assert.equal(f.b.commits,0);
});
test('chat requires opt-in, selected default scope and live peer reply references; reply drafts deduplicate',async t=>{
  const f=await fixture(t);f.p.config.social_default_friend='测试好友';await f.social.inspect('messages',f.service.controller.signal);
  await assert.rejects(f.social.readChat(12,f.service.controller.signal),/未开启/);f.p.config.chat_read_enabled=true;
  f.b.messages=[{id:'in-1',direction:'peer',text:'你好'},{id:'out-1',direction:'self',text:'hi'}];
  const read=await f.social.readChat(12,f.service.controller.signal);assert.equal(read.messages.length,2);
  assert.throws(()=>f.social.draft(f.p,{kind:'private_message',content:'a',reply_to:read.messages[1].message_ref}),/回复引用/);
  const a=f.social.draft(f.p,{kind:'private_message',content:'你好！',reply_to:read.messages[0].message_ref}),b=f.social.draft(f.p,{kind:'private_message',content:'duplicate',reply_to:read.messages[0].message_ref});assert.equal(a.id,b.id);assert.equal(b.cached,true);
  const reread=await f.social.readChat(12,f.service.controller.signal);assert.equal(reread.messages[0].reply_draft_id,a.id);
  f.b.rejectPhase='read_chat';await assert.rejects(f.social.readChat(12,f.service.controller.signal),/聊天对象/);
  f.b.rejectPhase=null;f.social.chatContexts.get(read.messages[0].message_ref).expires=0;assert.throws(()=>f.social.draft(f.p,{kind:'private_message',content:'a',reply_to:read.messages[0].message_ref}),/回复引用/);assert.equal(f.b.commits,0);
});
test('reply task cannot select other surfaces, recipients or create unlinked drafts',async t=>{
  const f=await fixture(t);f.p.config.social_default_friend='测试好友';await f.social.inspect('messages',f.service.controller.signal);
  const call=(name,args)=>f.social.tool(name,args,f.p,f.service.controller.signal,{defaultOnly:true});
  assert.equal((await call('douyin_social_open',{surface:'share'})).result.ok,false);
  assert.equal((await call('douyin_social_draft',{kind:'private_message',content:'injected'})).result.ok,false);
  assert.equal((await call('douyin_social_draft',{kind:'private_message',content:'injected',recipient_ref:'other',reply_to:'fake'})).result.ok,false);
  assert.equal(f.social.list().drafts.length,0);assert.equal(f.b.commits,0);
});
