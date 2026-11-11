import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import assert from 'node:assert/strict';
import {ChromeBrowser} from '../../../plugins/douyin-web/chrome.mjs';
import {DouyinWebService} from '../../../plugins/douyin-web/service.mjs';
import {douyinConfig,douyinTemplate} from '../../../plugins/douyin-web/config.mjs';
import {Store} from '../src/store.mjs';

// All requests to this origin are fulfilled locally. No real Douyin account,
// contact, or message is used. The real Chrome DOM/CDP path is exercised.
const root=resolve('dist/social-browser-check');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'fixture-'));
const b=new ChromeBrowser({profile:join(directory,'chrome'),headless:true}),store=new Store(join(directory,'bot.sqlite')),service=new DouyinWebService({store,config:{dataDir:directory},browser:b});
const plugin={...structuredClone(douyinTemplate),id:'fixture',revision:1,enabled:true,config:douyinConfig({social_enabled:true})};service.pluginFor=()=>plugin;
const html=`<!doctype html><html><head><title>LOCAL SOCIAL FIXTURE</title><style>body{font:14px sans-serif}section{padding:12px;margin:10px;border:1px solid #888}textarea{display:block;width:500px;height:45px}video{width:300px;height:100px}img{width:20px;height:20px}</style></head><body>
<header><b>LOCAL TEST ONLY — NO NETWORK</b><div data-e2e="account-profile" data-user-id="self" aria-label="测试发送账号"><img alt="测试发送账号" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div><button aria-label="消息">消息</button></header>
<video src="data:video/mp4;base64,AAAA"></video>
<section data-e2e="im-panel"><button data-e2e="im-contact" data-user-id="friend" data-contact-name="测试好友" aria-selected="false" onclick="this.setAttribute('aria-selected','true');document.querySelector('[data-e2e=im-chat-header]').textContent='测试好友'">测试好友</button><h3 data-e2e="im-chat-header">未选择</h3><textarea data-e2e="im-composer"></textarea><button onclick="window.outgoing.push({kind:'private_message',content:document.querySelector('[data-e2e=im-composer]').value})">发送</button></section>
<section data-e2e="share-panel"><button data-e2e="share-contact" data-user-id="friend" data-contact-name="测试好友" aria-selected="false" onclick="this.setAttribute('aria-selected','true')">测试好友</button><textarea data-e2e="share-message"></textarea><button onclick="window.outgoing.push({kind:'share_video',content:document.querySelector('[data-e2e=share-message]').value})">发送</button></section><script>window.outgoing=[];</script></body></html>`;
let buffer=Buffer.alloc(0),failure;const checks=[];
try{
  await b.start('',AbortSignal.timeout(20000));
  b.child.stdio[4].on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let end;while((end=buffer.indexOf(0))>=0){const data=buffer.subarray(0,end);buffer=buffer.subarray(end+1);let message;try{message=JSON.parse(data.toString());}catch{continue;}if(message.method==='Fetch.requestPaused'){
    const document=message.params.request.url.includes('__social_fixture__');void b.page('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:document?200:204,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:Buffer.from(document?html:'').toString('base64')}).catch(e=>{failure=e;});
  }}});
  await b.page('Fetch.enable',{patterns:[{urlPattern:'https://www.douyin.com/*'}]});
  await b.page('Page.navigate',{url:'https://www.douyin.com/__social_fixture__'});
  let ready=false;for(let i=0;i<100;i++){if(failure)throw failure;try{ready=await b.evaluate('document.title==="LOCAL SOCIAL FIXTURE"');if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(ready,true);
  for(const kind of ['private_message','share_video']){
    const surface=kind==='share_video'?'share':'messages',contacts=await service.social.inspect(surface,service.controller.signal);assert.equal(contacts.contacts[0].name,'测试好友');
    const draft=service.social.draft(plugin,{kind,recipient_ref:contacts.contacts[0].recipient_ref,source_ref:contacts.source_ref,content:kind==='share_video'?'【本地测试】分享留言':'【本地测试】你好，测试好友'});
    const count=await b.evaluate('window.outgoing.length'),prepared=await service.social.action({id:draft.id,revision:draft.revision,action:'prepare'});
    assert.equal(await b.evaluate('window.outgoing.length'),count,'preparation must not send');assert.ok(prepared.image.startsWith('data:image/jpeg;base64,'));
    if(kind==='private_message'){
      await b.evaluate('document.querySelector("[data-e2e=im-chat-header]").textContent="另一个好友"');
      await assert.rejects(service.social.action({id:draft.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token}),/聊天对象/);
      assert.equal(await b.evaluate('window.outgoing.length'),count);await b.evaluate('document.querySelector("[data-e2e=im-chat-header]").textContent="测试好友"');
    }
    const sent=await service.social.action({id:draft.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token});assert.equal(sent.draft.status,'uncertain');
    assert.equal(await b.evaluate('window.outgoing.length'),count+1);await assert.rejects(service.social.action({id:draft.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token}));assert.equal(await b.evaluate('window.outgoing.length'),count+1);
    checks.push(kind+' real DOM selection, Unicode input, screenshot, confirmation and single activation');
  }
  plugin.config.social_default_friend='测试好友';plugin.config.chat_read_enabled=true;
  await service.social.inspect('messages',service.controller.signal);
  await b.evaluate(`document.querySelector('[data-e2e="im-panel"]').insertAdjacentHTML('beforeend','<p data-e2e="chat-message" data-message-id="inbound-1" data-direction="peer">你好，测试聊天</p><p data-e2e="chat-message" data-message-id="outbound-1" data-direction="self">你好</p>')`);
  const chat=await service.social.readChat(12,service.controller.signal);assert.equal(chat.messages.length,2);assert.equal(chat.messages[0].direction,'peer');
  const reply=service.social.draft(plugin,{kind:'private_message',content:'你好！',reply_to:chat.messages[0].message_ref});assert.equal(reply.status,'draft');
  assert.equal(service.social.draft(plugin,{kind:'private_message',content:'duplicate',reply_to:chat.messages[0].message_ref}).id,reply.id);
  await b.evaluate(`document.querySelector('[data-e2e="im-chat-header"]').textContent='另一好友'`);await assert.rejects(service.social.readChat(12,service.controller.signal),/聊天对象/);
  await b.evaluate(`document.querySelector('[data-e2e="im-chat-header"]').textContent='测试好友'`);
  await b.evaluate(`(()=>{const messages=document.querySelectorAll('[data-e2e="chat-message"]');messages[0].setAttribute('data-message-id','7703905545174140100');messages[1].setAttribute('data-message-id','7703905545174140200');})()`);
  const guardedDraft=service.social.draft(plugin,{kind:'private_message',content:'【本地测试】你好，测试好友'}),guarded=await service.social.action({id:guardedDraft.id,revision:guardedDraft.revision,action:'prepare'},{expectedIncomingId:'7703905545174140200'});
  const countBefore=await b.evaluate('window.outgoing.length');
  await b.evaluate(`document.querySelector('[data-e2e="im-panel"]').insertAdjacentHTML('beforeend','<p data-e2e="chat-message" data-message-id="7703905545174140300" data-direction="peer">更新的消息</p>')`);
  await assert.rejects(service.social.action({id:guardedDraft.id,revision:guarded.draft.revision,action:'send',confirmation_token:guarded.confirmation_token},{expectedIncomingId:'7703905545174140200'}),/更新消息/);assert.equal(await b.evaluate('window.outgoing.length'),countBefore);
  checks.push('automatic reply rechecks latest incoming server ID immediately before activation');
  plugin.config.social_default_friend='';checks.push('default-only chat reads, peer reply references, deduplication and changed-header rejection');
  await b.evaluate(`(()=>{
    const panel=document.querySelector('[data-e2e="im-panel"]');panel.setAttribute('data-e2e','im-dialog');
    const row=panel.querySelector('[data-e2e="im-contact"]');row.setAttribute('data-e2e','conversation-item');row.removeAttribute('data-user-id');row.removeAttribute('data-contact-name');row.removeAttribute('aria-selected');row.innerHTML='<div class="conversationConversationItemtitle">测试好友</div>';
    const metadata={id:'0:1:101:202',type:1};row.__reactFiber$fixture={memoizedProps:{},return:{memoizedProps:{conversation:metadata}}};
    const header=panel.querySelector('[data-e2e="im-chat-header"]');header.removeAttribute('data-e2e');header.className='StackLayoutStackChatHeadertitle';header.textContent='未选择';header.__reactFiber$fixture={memoizedProps:{conversation:metadata}};
    row.onclick=null;row.addEventListener('mousedown',()=>{header.textContent='测试好友';});
    const group=row.cloneNode(true);group.__reactFiber$fixture={memoizedProps:{conversation:{id:'group-id',type:2}}};panel.append(group);
    const editor=panel.querySelector('textarea');const container=document.createElement('div');container.setAttribute('data-e2e','msg-input');container.innerHTML='<div contenteditable="true" class="messageEditorinputArea"></div>';editor.replaceWith(container);
    const button=panel.querySelector('button:not([data-e2e])');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','e2e-send-msg-btn');svg.style.cssText='display:block;width:50px;height:30px;background:#555';svg.addEventListener('click',()=>window.outgoing.push({kind:'private_message',content:container.firstChild.innerText}));button.replaceWith(svg);
    const share=document.querySelector('[data-e2e="share-panel"]');share.removeAttribute('data-e2e');share.className='lC5eOSqy';share.innerHTML='<div class="otFjqQEX"><span class="EnYt_IKl">测试好友</span><div class="xu0OjnsQ">分享</div></div>';window.shareRowClicks=0;
    const contact=share.firstChild;contact.__reactFiber$fixture={memoizedProps:{user:{sec_uid:'test-sec-friend',nickname:'测试好友'}}};contact.addEventListener('click',()=>window.shareRowClicks++);contact.querySelector('.xu0OjnsQ').addEventListener('click',event=>{event.stopPropagation();window.outgoing.push({kind:'share_video',content:''});});
  })()`);
  for(const kind of ['private_message','share_video']){
    const listing=await service.social.inspect(kind==='share_video'?'share':'messages',service.controller.signal);assert.equal(listing.contacts.length,1,'group must not appear');
    const content=kind==='share_video'?'':'【真实控件结构模拟】中文私信';const draft=service.social.draft(plugin,{kind,recipient_ref:listing.contacts[0].recipient_ref,source_ref:listing.source_ref,content});
    const count=await b.evaluate('window.outgoing.length'),prepared=await service.social.action({id:draft.id,revision:draft.revision,action:'prepare'});assert.equal(await b.evaluate('window.outgoing.length'),count);
    if(kind==='share_video')assert.equal(await b.evaluate('window.shareRowClicks'),0,'direct-share row must not activate during preparation');
    await service.social.action({id:draft.id,revision:prepared.draft.revision,action:'send',confirmation_token:prepared.confirmation_token});assert.equal(await b.evaluate('window.outgoing.length'),count+1);
    checks.push(kind+' observed Douyin control structure, group exclusion and no premature activation');
  }
  const report={success:true,real_browser:true,real_douyin:false,real_messages:false,checks,fixture_outgoing:await b.evaluate('window.outgoing')};await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  await service.close();store.close();const target=resolve(directory),child=relative(root,target);assert.ok(child&&!child.startsWith('..')&&!isAbsolute(child));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
