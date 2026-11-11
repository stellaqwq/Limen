import { aiInput, chatCommandAllowed, replyMessage, replyOptions } from './messages.mjs';
import { filterAIReply } from './reply-filter.mjs';
import { memeStreamBoundary } from './reply-markers.mjs';
import { BotError } from './errors.mjs';

// A durable receipt is written before each QQ submission. Interrupted partial
// generations are never replayed from the beginning after a restart.
export class ReplyStream {
  constructor(worker, job, event) {
    Object.assign(this, { worker, job, event });
    this.sent = '';
  }
  async delta(_delta, text) {
    const { worker: w, job, event } = this;
    text = filterAIReply(text, w.config, { partial: true }).trimStart();
    w.store.streamText(job.id, text);
    if (job.channel === 'web' || !this.qq) return;
    while (true) {
      let pending = text.slice(this.sent.length);
      // Hold potential meme tags until the existing media planner handles them.
      const tag = memeStreamBoundary(pending);
      if (tag !== -1) pending = pending.slice(0, tag);
      const leading = pending.length - pending.trimStart().length;
      const chars = Array.from(pending.trim()), limit = w.config.ai.streamChunkChars || 240;
      const candidate = chars.slice(0, limit).join('');
      const matches = [...candidate.matchAll(/[。！？!?\n](?:[”’」』])?/gu)];
      const end = matches.at(-1);
      let length = end ? end.index + end[0].length : 0;
      if (!length && chars.length >= limit) length = candidate.length;
      if (!length) return;
      length += leading;
      const content = pending.slice(0, length);
      const signal=this.signal||w.controller.signal;signal.throwIfAborted();
      if (!chatCommandAllowed(event, w.config) || !(w.groupChatPlus?.route(job)?w.groupChatPlus.scopedRoute(job,event):aiInput(event,w.config.ai))) throw new BotError('Reply permission revoked', 1403);
      const part = w.store.beginStreamPart(job.id, content);
      try {
        const result = await w.adapter.action(event.message_type === 'group' ? 'send_group_msg' : 'send_private_msg', {
          ...(event.message_type === 'group' ? { group_id: event.group_id } : { user_id: event.user_id }),
          // Receipts retain the exact source prefix; only QQ presentation is trimmed.
          message: replyMessage(event, [{ type: 'text', data: { text: content.trim() } }],this.replyOptions||replyOptions(w.config))
        }, { signal });
        w.store.endStreamPart(job.id, part, 'sent', result?.message_id);
        this.sent += content;
      } catch (error) {
        const unknown = error.uncertain || !error.code;
        w.store.endStreamPart(job.id, part, unknown ? 'uncertain' : 'failed');
        throw error;
      }
    }
  }
}
