import {conversation} from '../messages.mjs';

const valid=value=>Number.isSafeInteger(value)&&value>=0;
const count=value=>value.toLocaleString('en-US');
export class ContextStatus {
  constructor({store,config,fetcher=fetch}){
    Object.assign(this,{store,config,fetcher});this.models=new Map();
    store.db.exec(`CREATE TABLE IF NOT EXISTS conversation_token_usage (
      conversation TEXT PRIMARY KEY, model TEXT NOT NULL, base_url TEXT NOT NULL,
      job_id INTEGER NOT NULL,prompt_tokens INTEGER,completion_tokens INTEGER,updated_at INTEGER NOT NULL
    );`);
    store.on('context_reset',session=>store.db.prepare('DELETE FROM conversation_token_usage WHERE conversation=?').run(session));
  }
  record(job,metadata){
    if(!job?.conversation)return;
    if(!valid(metadata.prompt_tokens)){this.store.db.prepare('DELETE FROM conversation_token_usage WHERE conversation=?').run(job.conversation);return;}
    const c=this.config.ai;
    this.store.db.prepare(`INSERT INTO conversation_token_usage VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(conversation) DO UPDATE SET model=excluded.model,base_url=excluded.base_url,job_id=excluded.job_id,
      prompt_tokens=excluded.prompt_tokens,completion_tokens=excluded.completion_tokens,updated_at=excluded.updated_at`)
      .run(job.conversation,c.model,c.baseUrl,job.id,metadata.prompt_tokens,valid(metadata.completion_tokens)?metadata.completion_tokens:null,Date.now());
  }
  cleanup(){this.store.db.prepare('DELETE FROM conversation_token_usage WHERE job_id NOT IN (SELECT id FROM jobs)').run();}
  async window(){
    const c=this.config.ai,key=c.baseUrl+'\n'+c.model,prior=this.models.get(key);
    if(prior&&prior.expires>Date.now())return prior.window;
    let window=null;
    if(c.model&&c.baseUrl)try{
      const response=await this.fetcher(c.baseUrl.replace(/\/$/,'')+'/models',{redirect:'error',signal:AbortSignal.timeout(2500),headers:c.apiKey?{Authorization:'Bearer '+c.apiKey}:{}});
      if(response.ok){
        let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>1048576)throw Error('Model metadata too large');}
        const model=JSON.parse(text).data?.find(m=>m.id===c.model);
        const value=model?.context_window??model?.context_length??model?.max_context_length??model?.max_model_len;
        if(valid(value)&&value>0)window=value;
      }else await response.body?.cancel();
    }catch{ /* Metadata is optional; the report must still show local history. */ }
    this.models.set(key,{window,expires:Date.now()+(window?300000:30000)});return window;
  }
  async report(event){
    const session=conversation(event),c=this.config.ai,history=this.store.history(session,c.contextTurns),turns=Math.ceil(this.store.db.prepare('SELECT COUNT(*) AS n FROM history WHERE conversation=?').get(session).n/2),remaining=Math.max(0,c.contextTurns-turns);
    const lines=['当前会话上下文',c.contextTurns<0?`历史窗口：已保存 ${turns} 轮（${history.length} 条模型消息），不限制轮数`: `历史窗口：已用 ${Math.min(turns,c.contextTurns)} / ${c.contextTurns} 轮，剩余 ${remaining} 轮（${history.length} 条消息）`,
      c.contextTurns<0?'保留接口返回的思考、正文及工具过程；模型自身的 token 窗口仍有限。':c.contextTurns?'窗口满后自动滚动丢弃最旧对话，不会停止聊天。':'当前未保留历史对话。'];
    const usage=this.store.db.prepare('SELECT * FROM conversation_token_usage WHERE conversation=? AND model=? AND base_url=?').get(session,c.model,c.baseUrl);
    const window=await this.window();
    lines.push('模型：'+(c.model||'尚未配置'));
    if(window)lines.push('模型窗口：'+count(window)+' token');
    if(usage){
      lines.push('最近请求：输入 '+count(usage.prompt_tokens)+' / 输出 '+(usage.completion_tokens===null?'未返回':count(usage.completion_tokens))+' token');
      if(window&&usage.completion_tokens!==null){
        const free=Math.max(0,window-usage.prompt_tokens-usage.completion_tokens);
        lines.push('窗口剩余参考：'+count(free)+' token（'+(free/window*100).toFixed(1)+'%）');
      }
      lines.push('用量依据最近一次模型请求，包含当时的提示词和工具等内容；下一次请求会重新组装上下文。');
    }else lines.push('暂无当前会话的 token 用量（尚无请求或接口未返回）；正常模型回复后可再查询。');
    if(!window)lines.push('模型接口未返回窗口大小，暂时无法计算剩余 token。');
    const active=this.store.db.prepare("SELECT 1 FROM jobs WHERE conversation=? AND status IN ('queued','generating','ready','sending') LIMIT 1").get(session);
    if(active)lines.push('本会话还有未完成任务，历史和用量可能继续变化。');
    lines.push('/new 可清空当前会话上下文，保留人格和长期记忆。');
    return lines.join('\n');
  }
}
