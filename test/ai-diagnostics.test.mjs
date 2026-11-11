import { replyBody } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIClient, describeAIFailure } from '../src/ai.mjs';
import { createLogger } from '../src/logger.mjs';
import { ReplyWorker } from '../src/worker.mjs';
import { Store } from '../src/store.mjs';
import { Settings } from '../src/settings.mjs';
import { config, withTestTimeout } from './helpers.mjs';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {observationContactSheet} from '../src/agent/image-input.mjs';
import {BotError} from '../src/errors.mjs';

const successful = () => new Response(JSON.stringify({ choices: [{ message: { content: '正常回复' } }] }));

test('continuous observations present all frames in a numbered contact sheet with bounded dimensions',async()=>{
  const colors=['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'],frames=[];
  for(const color of colors){const canvas=createCanvas(960,720),ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,960,720);frames.push(canvas.toDataURL('image/jpeg'));}
  const images=await observationContactSheet(frames);assert.equal(images.length,1);
  const decoded=await loadImage(Buffer.from(images[0].split(',')[1],'base64')),canvas=createCanvas(decoded.width,decoded.height),ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0);
  assert.equal(decoded.width,960);assert.ok(decoded.height<=1280);
  for(const [index,color] of colors.entries()){
    const pixel=ctx.getImageData(index%2*480+240,Math.floor(index/2)*384+24+180,1,1).data;
    for(let channel=0;channel<3;channel++)assert.ok(Math.abs(pixel[channel]-parseInt(color.slice(1+channel*2,3+channel*2),16))<15);
  }
  assert.deepEqual(await observationContactSheet([frames[0]]),[frames[0]]);
  await assert.rejects(observationContactSheet(['data:image/jpeg;base64,/9j/','data:image/jpeg;base64,/9j/']),/Invalid observation JPEG/);
});

test('contact sheets replace only transient model pictures and preserve original tool evidence metadata',async()=>{
  const original=globalThis.fetch,canvas=createCanvas(80,60),frames=Array.from({length:6},()=>canvas.toDataURL('image/jpeg'));let requests=0;
  try{
    globalThis.fetch=async(_,options)=>{
      requests++;if(requests===1)return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'observe',type:'function',function:{name:'observe',arguments:'{}'}}]}}]}));
      const body=JSON.parse(options.body),images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'):[]);
      assert.equal(images.length,1);assert.ok(JSON.stringify(body.messages).includes('Frame'));
      assert.deepEqual(JSON.parse(body.messages.find(m=>m.role==='tool').content).samples,[1,2,3,4,5,6]);return successful();
    };
    const result=await new AIClient(config('unused').ai).reply('看当前采样',[],undefined,{tools:[{type:'function',function:{name:'observe'}}],observationContactSheet:true,maxSteps:2,invokeTool:async()=>({result:{ok:true,samples:[1,2,3,4,5,6]},images:frames,imageContext:'按时间顺序的6幅采样'})});
    assert.equal(result,'正常回复');assert.equal(requests,2);
  }finally{globalThis.fetch=original;}
});

test('continuous decisions reuse a successful visual note without processing images again, while a failed archive retains them',async()=>{
  const original=globalThis.fetch,canvas=createCanvas(80,60),frames=[canvas.toDataURL('image/jpeg'),canvas.toDataURL('image/jpeg')],names=['observe','video_knowledge_save','decide'],tools=names.map(name=>({type:'function',function:{name}}));
  try{
    for(const saved of [true,false]){
      let completed=0,requests=0;
      globalThis.fetch=async(_,options)=>{requests++;const body=JSON.parse(options.body),images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'):[]);
        assert.equal(images.length,requests===1||!saved?1:0);
        const observation=JSON.parse(body.messages.find(m=>m.role==='tool').content);assert.deepEqual(observation.samples,[1,2]);assert.equal(observation.observation_id,'actual-observation');
        if(requests===2){assert.ok(JSON.stringify(body.messages).includes('本轮实际观看记录'));assert.equal(JSON.stringify(body.messages).includes('画面附件已移除'),saved);}
        return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'call-'+requests,type:'function',function:{name:names[completed],arguments:'{}'}}]}}]}));
      };
      const result=await new AIClient(config('unused').ai).reply('browse',[],undefined,{tools,maxSteps:3,maxToolCalls:3,observationContactSheet:true,reuseArchivedObservation:true,requiredToolForStep:()=>names[completed],automaticToolCallForStep:()=>completed===0?{name:'observe',arguments:{}}:undefined,invokeTool:async name=>{completed++;return name==='observe'?{result:{ok:true,observation_id:'actual-observation',samples:[1,2]},images:frames}:name==='video_knowledge_save'?{result:{ok:saved,item:{summary:'本轮实际观看记录'}}}:{finish:true,reply:'完成'};}});
      assert.equal(result,'完成');assert.equal(requests,2);
    }
  }finally{globalThis.fetch=original;}
});

test('device replay protection reports a fixed reason instead of an unknown model failure',()=>{
  const error=Object.assign(new BotError('private text'),{computerReason:'computer_task_needs_review'});
  assert.deepEqual(describeAIFailure(error),{reason:'computer_task_needs_review'});
  assert.deepEqual(describeAIFailure({computerReason:'credential'}),{reason:'ai_unknown_error'});
});

test('fixed preparation calls keep tool transcripts and budgets while only decisions request the model',async()=>{
  const original=globalThis.fetch,names=['status','observe','decide'],tools=names.map(name=>({type:'function',function:{name}}));let completed=0,requests=0,modelSteps=0;
  try{
    globalThis.fetch=async(_,options)=>{requests++;const body=JSON.parse(options.body);assert.deepEqual(body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content).name),['status','observe']);return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'decision',type:'function',function:{name:'decide',arguments:'{}'}}]}}]}));};
    const result=await new AIClient(config('unused').ai).reply('browse',[],undefined,{tools,maxSteps:3,maxToolCalls:3,requiredToolForStep:()=>names[completed],automaticToolCallForStep:()=>completed<2?{name:names[completed],arguments:{}}:undefined,onModelStep:()=>{modelSteps++;},invokeTool:async name=>{completed++;return name==='decide'?{finish:true,reply:'完成'}:{result:{ok:true,name}};}});
    assert.equal(result,'完成');assert.equal(requests,1);assert.equal(modelSteps,1);assert.equal(completed,3);
    let calls=0;
    await assert.rejects(new AIClient(config('unused').ai).reply('browse',[],undefined,{tools,maxSteps:2,maxToolCalls:1,requiredToolForStep:()=>names[calls],automaticToolCallForStep:()=>({name:names[calls],arguments:{}}),invokeTool:async name=>{calls++;return {result:{ok:true,name}};}}),e=>describeAIFailure(e).reason==='ai_tool_limit');
    assert.equal(calls,1);assert.equal(requests,1);
  }finally{globalThis.fetch=original;}
});

test('opt-in browser step recovery retries provider format errors with existing tool results and a strict bound',async()=>{
  const original=globalThis.fetch;let requests=0,writes=0;
  const tools=[{type:'function',function:{name:'browser_action',parameters:{type:'object',properties:{}}}}];
  try{
    for(const alwaysFail of [false,true]){
      requests=0;writes=0;
      globalThis.fetch=async(_,options)=>{
        requests++;const body=JSON.parse(options.body);
        if(requests===1)return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'once',type:'function',function:{name:'browser_action',arguments:'{}'}}]}}]}));
        assert.equal(body.messages.filter(m=>m.role==='tool').length,1);
        if(alwaysFail||requests===2)return new Response('data: '+JSON.stringify({error:{message:'private provider format error'}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
        return successful();
      };
      const result=new AIClient(config('unused').ai).reply('browse',[],undefined,{tools,maxSteps:6,maxSafeStepRetries:2,invokeTool:async()=>{writes++;return {result:{ok:true}};}});
      if(alwaysFail){await assert.rejects(result,e=>describeAIFailure(e).reason==='ai_stream_error');assert.equal(requests,4);}
      else{assert.equal(await result,'正常回复');assert.equal(requests,3);}
      assert.equal(writes,1);
    }
  }finally{globalThis.fetch=original;}
});

test('reasoning effort is opt-in, validated, and forwarded without changing user or system messages', async () => {
  const original = globalThis.fetch, seen = [];
  try {
    globalThis.fetch = async (_, options) => { seen.push(JSON.parse(options.body)); return successful(); };
    const cfg = config('unused', { AI_REASONING_EFFORT: 'none' }).ai;
    assert.equal(await new AIClient(cfg).reply('question', []), '正常回复');
    assert.equal(seen[0].reasoning_effort, 'none');
    assert.deepEqual(seen[0].messages, [{ role: 'system', content: cfg.systemPrompt }, { role: 'user', content: 'question' }]);
    await new AIClient(config('unused').ai).reply('question', []);
    assert.equal(Object.hasOwn(seen[1], 'reasoning_effort'), false);
    assert.throws(() => config('unused', { AI_REASONING_EFFORT: 'unknown' }), /Invalid AI_REASONING_EFFORT/);
  } finally { globalThis.fetch = original; }
});

test('per-request generation settings are isolated, validated and never change the endpoint, prompts or global settings',async()=>{
  const original=globalThis.fetch,requests=[],cfg=config('unused',{AI_REASONING_EFFORT:'high',AI_MAX_OUTPUT_TOKENS:'16384'}).ai,ai=new AIClient(cfg);
  try{
    globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return successful();};
    await ai.reply('question',[],undefined,{generation:{reasoningEffort:'none',maxOutputTokens:2048}});
    await ai.reply('question',[]);
    assert.equal(requests[0].body.reasoning_effort,'none');assert.equal(requests[0].body.max_tokens,2048);
    assert.equal(requests[1].body.reasoning_effort,'high');assert.equal(requests[1].body.max_tokens,16384);
    assert.equal(requests[0].url,requests[1].url);assert.deepEqual(requests[0].body.messages,requests[1].body.messages);
    assert.equal(cfg.reasoningEffort,'high');assert.equal(cfg.maxOutputTokens,16384);
    for(const generation of [{reasoningEffort:'invalid'},{maxOutputTokens:-1},{maxOutputTokens:1.5},{baseUrl:'https://invalid.example'},[]])await assert.rejects(ai.reply('question',[],undefined,{generation}),e=>describeAIFailure(e).reason==='ai_invalid_config');
    assert.equal(requests.length,2);
  }finally{globalThis.fetch=original;}
});

test('timeouts retain safe stream progress counters while discarding private reasoning and response text',async()=>{
  const original=globalThis.fetch,cfg=config('unused',{AI_TIMEOUT_MS:'30'}).ai;
  try{
    globalThis.fetch=async(_,options)=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('data: '+JSON.stringify({choices:[{index:0,delta:{reasoning_content:'private thoughts'}}]})+'\n\n'));options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}});
    await withTestTimeout(()=>assert.rejects(new AIClient(cfg).reply('private prompt',[]),error=>{
      const d=describeAIFailure(error);assert.equal(d.reason,'ai_timeout');assert.equal(d.response_format,'sse');assert.equal(d.received_chunks,1);assert.equal(d.reasoning_chars,16);assert.equal(d.output_bytes,0);assert.ok(d.response_bytes>0);assert.ok(d.request_ms>=20);assert.ok(Number.isSafeInteger(d.response_start_ms));assert.ok(Number.isSafeInteger(d.last_chunk_age_ms));
      const lines=[],log=createLogger(line=>lines.push(JSON.parse(line)));log('warn','ai_generation_failed',{...d,reasoning_content:'private',request_ms:d.request_ms});assert.equal(lines[0].reasoning_chars,16);assert.equal(lines[0].received_chunks,1);assert.equal(JSON.stringify(lines).includes('private'),false);return true;
    }));
  }finally{globalThis.fetch=original;}
});

test('provider errors retain safe HTTP status and retry policy without recording provider bodies', async () => {
  const original = globalThis.fetch, cfg = config('unused').ai;
  try {
    for (const status of [400, 401, 429, 503]) {
      globalThis.fetch = async () => new Response('private prompt and credential', { status });
      await assert.rejects(new AIClient(cfg).reply('question', []), error => {
        assert.deepEqual(describeAIFailure(error), { reason: 'ai_http_error', http_status: status });
        assert.equal(error.retryable, status === 429 || status >= 500);
        assert.ok(!error.message.includes('private')); return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test('high reasoning and optional generation controls are forwarded independently without changing prompts', async () => {
  const original = globalThis.fetch, seen = [];
  try {
    globalThis.fetch = async (_, options) => { seen.push(JSON.parse(options.body)); return successful(); };
    const cfg = config('unused', { AI_REASONING_EFFORT: 'high', AI_MAX_OUTPUT_TOKENS: '16384',
      AI_TEMPERATURE: '1', AI_TOP_P: '0.95', AI_PRESENCE_PENALTY: '1.5' }).ai;
    const history = [{ role: 'user', content: 'earlier question' }, { role: 'assistant', content: 'earlier answer' }];
    await new AIClient(cfg).reply('question', history);
    assert.equal(seen[0].reasoning_effort, 'high'); assert.equal(seen[0].max_tokens, 16384);
    assert.equal(seen[0].temperature, 1); assert.equal(seen[0].top_p, 0.95); assert.equal(seen[0].presence_penalty, 1.5);
    assert.deepEqual(seen[0].messages, [{ role: 'system', content: cfg.systemPrompt }, ...history, { role: 'user', content: 'question' }]);
    await new AIClient(config('unused').ai).reply('question', []);
    for (const key of ['max_tokens', 'temperature', 'top_p', 'presence_penalty']) assert.equal(Object.hasOwn(seen[1], key), false);
    await new AIClient(config('unused', { AI_TEMPERATURE: '0', AI_TOP_P: '0', AI_PRESENCE_PENALTY: '-2' }).ai).reply('question', []);
    assert.equal(seen[2].temperature, 0); assert.equal(seen[2].top_p, 0); assert.equal(seen[2].presence_penalty, -2);
  } finally { globalThis.fetch = original; }
});

test('generation settings validate ranges and persist decimal sampling values atomically', async () => {
  for (const [key, invalid] of Object.entries({ AI_MAX_OUTPUT_TOKENS: ['-1', '1.5', '131073'],
    AI_TEMPERATURE: ['-0.1', '2.1', 'NaN', 'Infinity', ' ', '0x1'], AI_TOP_P: ['-0.1', '1.1'], AI_PRESENCE_PENALTY: ['-2.1', '2.1'] })) {
    for (const value of invalid) assert.throws(() => config('unused', { [key]: value }), new RegExp('Invalid ' + key));
  }
  const settings = new Settings(config('unused', { AI_REASONING_EFFORT: 'high' }));
  const before = await settings.snapshot();
  const after = await settings.save({ AI_MAX_OUTPUT_TOKENS: '16384', AI_TEMPERATURE: '1', AI_TOP_P: '0.95', AI_PRESENCE_PENALTY: '1.5' }, before.revision);
  assert.equal(after.values.AI_TOP_P, '0.95'); assert.equal(after.values.AI_REASONING_EFFORT, 'high');
  await assert.rejects(settings.save({ AI_PRESENCE_PENALTY: 'secret' }, after.revision), /Invalid AI_PRESENCE_PENALTY/);
  assert.equal((await settings.snapshot()).revision, after.revision);
});

test('response timeouts and caller cancellation have distinct diagnostics before headers and during body reads', async () => {
  const original = globalThis.fetch, cfg = { ...config('unused').ai, timeout: 20 };
  try {
    for (const body of [false, true]) {
      globalThis.fetch = async (_, options) => body ? new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
      } })) : new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      await withTestTimeout(() => assert.rejects(new AIClient(cfg).reply('question', []), error => {
        assert.equal(describeAIFailure(error).reason, 'ai_timeout'); assert.equal(error.retryable, true); return true;
      }));
      const controller = new AbortController();
      const pending = new AIClient({ ...cfg, timeout: 1000 }).reply('question', [], controller.signal);
      setTimeout(() => controller.abort(), 1);
      await assert.rejects(pending, error => {
        assert.equal(describeAIFailure(error).reason, 'ai_cancelled'); assert.equal(error.retryable, false); return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test('reasoning-only responses never become QQ replies and invalid JSON is classified separately', async () => {
  const original = globalThis.fetch, cfg = config('unused').ai;
  try {
    for (const field of ['reasoning_content', 'reasoning']) {
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '', [field]: 'private reasoning' } }] }));
      await assert.rejects(new AIClient(cfg).reply('question', []), error => {
        assert.deepEqual(describeAIFailure(error), { reason: 'ai_reasoning_only', finish_reason: 'length' });
        assert.equal(error.retryable, true); assert.ok(!error.message.includes('private')); return true;
      });
    }
    globalThis.fetch = async () => new Response('invalid');
    await assert.rejects(new AIClient(cfg).reply('question', []), error => describeAIFailure(error).reason === 'ai_invalid_json');
    globalThis.fetch = async () => new Response('null');
    await assert.rejects(new AIClient(cfg).reply('question', []), error => describeAIFailure(error).reason === 'ai_empty_reply');
  } finally { globalThis.fetch = original; }
});

test('reasoning-only retry keeps high, logs safe usage, and sends only the final reply once', async () => {
  const original = globalThis.fetch, store = new Store(':memory:'), logs = [], requests = [], sent = [];
  try {
    globalThis.fetch = async (_, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1 ? new Response(JSON.stringify({ choices: [{ finish_reason: 'length',
        message: { content: null, reasoning_content: 'private reasoning' } }],
        usage: { prompt_tokens: 100, completion_tokens: 16384, completion_tokens_details: { reasoning_tokens: 16384 } } })) : successful();
    };
    const cfg = config('unused', { AI_ENABLED: 'true', AI_MODEL: 'fixture', AI_ALLOWED_USERS: '10001', AI_REASONING_EFFORT: 'high', AI_MAX_OUTPUT_TOKENS: '16384' });
    const worker = new ReplyWorker({ adapter: { status: () => ({ online: true }), action: async (name, params) => { sent.push(params.message); } },
      store, ai: new AIClient(cfg.ai), config: cfg, log: createLogger(line => logs.push(JSON.parse(line))) });
    worker.ingest({ post_type: 'message', message_type: 'private', self_id: 10000, user_id: 10001, message_id: 1, message: 'private prompt' });
    await worker.step();
    assert.equal(store.get(1).status, 'queued'); assert.equal(store.get(1).reply, null); assert.equal(sent.length, 0);
    const failure = logs.find(entry => entry.event === 'ai_generation_failed');
    assert.equal(failure.reason, 'ai_reasoning_only'); assert.equal(failure.finish_reason, 'length');
    assert.equal(failure.completion_tokens, 16384); assert.equal(failure.reasoning_tokens, 16384); assert.equal(failure.prompt_tokens, 100);
    store.db.prepare('UPDATE jobs SET next_at=0 WHERE id=1').run();
    await worker.step(); await worker.step();
    assert.equal(store.get(1).status, 'done'); assert.equal(sent.length, 1); assert.equal(replyBody(sent[0])[0].data.text, '正常回复');
    assert.ok(requests.every(body => body.reasoning_effort === 'high' && body.max_tokens === 16384));
    assert.ok(!JSON.stringify(logs).includes('private')); assert.ok(!JSON.stringify(requests).includes('private reasoning'));
  } finally { globalThis.fetch = original; store.close(); }
});

test('persistent reasoning-only failures exhaust bounded attempts and filtered responses are never retried', async () => {
  const original = globalThis.fetch, store = new Store(':memory:'); let requests = 0, sends = 0;
  try {
    globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning: 'private' } }] })); };
    const cfg = config('unused', { AI_ENABLED: 'true', AI_MODEL: 'fixture', AI_ALLOWED_USERS: '10001', AI_MAX_ATTEMPTS: '2' });
    const worker = new ReplyWorker({ adapter: { status: () => ({ online: true }), action: async () => { sends++; } }, store,
      ai: new AIClient(cfg.ai), config: cfg, log: () => {} });
    worker.ingest({ post_type: 'message', message_type: 'private', self_id: 10000, user_id: 10001, message_id: 1, message: 'question' });
    await worker.step(); store.db.prepare('UPDATE jobs SET next_at=0 WHERE id=1').run();
    await worker.step(); await worker.step();
    assert.equal(store.get(1).status, 'failed'); assert.equal(store.get(1).attempts, 2); assert.equal(requests, 2); assert.equal(sends, 0);
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { reasoning: 'private' } }] }));
    await assert.rejects(new AIClient(cfg.ai).reply('question', []), error => error.retryable === false && describeAIFailure(error).finish_reason === 'content_filter');
  } finally { globalThis.fetch = original; store.close(); }
});

test('worker failure logs explain timeouts and elapsed time while leaving failed generation unsent', async () => {
  const original = globalThis.fetch, store = new Store(':memory:'), logs = [];
  let sends = 0;
  try {
    globalThis.fetch = async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    const cfg = config('unused', { AI_ENABLED: 'true', AI_MODEL: 'fixture', AI_ALLOWED_USERS: '10001', AI_TIMEOUT_MS: '20', AI_MAX_ATTEMPTS: '1' });
    const worker = new ReplyWorker({ adapter: { status: () => ({ online: true }), action: async () => { sends++; } }, store,
      ai: new AIClient(cfg.ai), config: cfg, log: createLogger(line => logs.push(JSON.parse(line))) });
    worker.ingest({ post_type: 'message', message_type: 'private', self_id: 10000, user_id: 10001, message_id: 1, message: 'private prompt' });
    await withTestTimeout(() => worker.step());
    const failure = logs.find(entry => entry.event === 'ai_generation_failed');
    assert.equal(failure.reason, 'ai_timeout'); assert.equal(failure.timeout_ms, 20);
    assert.ok(Number.isSafeInteger(failure.duration_ms) && failure.duration_ms >= 0);
    assert.equal(failure.job, 1); assert.equal(failure.attempt, 1);
    assert.equal(store.get(1).status, 'failed'); assert.equal(store.get(1).send_attempts, 0); assert.equal(sends, 0);
    assert.ok(!JSON.stringify(logs).includes('private'));
  } finally { globalThis.fetch = original; store.close(); }
});

test('untrusted errors cannot inject diagnostic text and numeric log metadata is bounded', () => {
  for (const error of [new Error('credential'), { reason: 'credential', http_status: 'credential' }, null]) {
    assert.deepEqual(describeAIFailure(error), { reason: 'ai_unknown_error' });
  }
  const logs = [], log = createLogger(line => logs.push(JSON.parse(line)));
  log('warn', 'ai_generation_failed', { duration_ms: 'credential', timeout_ms: -1, http_status: 999, message: 'credential' });
  assert.ok(!Object.hasOwn(logs[0], 'duration_ms')); assert.ok(!Object.hasOwn(logs[0], 'timeout_ms'));
  assert.ok(!Object.hasOwn(logs[0], 'http_status')); assert.ok(!JSON.stringify(logs).includes('credential'));
  log('warn', 'ai_generation_failed', { duration_ms: 50, timeout_ms: 45000, http_status: 429 });
  assert.equal(logs[1].http_status, 429);
  log('warn', 'ai_generation_failed', { finish_reason: 'credential', prompt_tokens: 'credential', completion_tokens: -1,
    reasoning_tokens: Infinity, reasoning_content: 'credential' });
  assert.ok(!JSON.stringify(logs[2]).includes('credential'));
  assert.ok(!Object.hasOwn(logs[2], 'completion_tokens')); assert.ok(!Object.hasOwn(logs[2], 'reasoning_tokens'));
  log('warn','ai_generation_failed',{response_format:'sse',response_bytes:4000000,output_bytes:20});
  assert.equal(logs[3].response_format,'sse');assert.equal(logs[3].response_bytes,4000000);assert.equal(logs[3].output_bytes,20);
  log('warn','ai_generation_failed',{response_format:'credential',response_bytes:'credential',output_bytes:-1});
  assert.equal(JSON.stringify(logs[4]).includes('credential'),false);assert.equal(Object.hasOwn(logs[4],'output_bytes'),false);
});

test('browse rejection diagnostics expose only fixed reason codes',()=>{
  const error=Object.assign(new BotError('private browser contents'),{agentReason:'douyin_browse_rejected',browseReason:'video_changed'});
  assert.deepEqual(describeAIFailure(error),{reason:'douyin_browse_rejected',tool_reason:'video_changed'});
  const lines=[],log=createLogger(line=>lines.push(JSON.parse(line)));
  log('warn','ai_generation_failed',{...describeAIFailure(error),message:error.message});
  assert.equal(lines[0].tool_reason,'video_changed');assert.equal(JSON.stringify(lines).includes('private'),false);
  error.browseReason='credential';assert.deepEqual(describeAIFailure(error),{reason:'ai_unknown_error'});
  log('warn','ai_generation_failed',{tool_reason:'credential'});assert.equal(Object.hasOwn(lines[1],'tool_reason'),false);
});
