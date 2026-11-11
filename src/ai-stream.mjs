// Chat Completions SSE frames may span arbitrary UTF-8/network boundaries.
export async function readCompletionStream(body, { onContent, onProgress, onFrame, invalid, limit = 2 * 1024 * 1024, wireLimit = 64 * 1024 * 1024 }) {
  const decoder = new TextDecoder(), message = { content: '' }, calls = new Map();
  let buffer = '', bytes = 0, outputBytes = 0, reasoningChars=0,chunks=0,finished = false, terminal = false, metadata = {};
  const progress=()=>({response_format:'sse',response_bytes:bytes,output_bytes:outputBytes,reasoning_chars:reasoningChars,received_chunks:chunks});
  const failure=reason=>invalid(reason,progress());
  const retain=value=>{outputBytes+=Buffer.byteLength(value,'utf8');if(outputBytes>limit)throw failure('ai_response_too_large');return value;};
  async function frame(value) {
    if(Buffer.byteLength(value,'utf8')>limit)throw failure('ai_response_too_large');
    const data = value.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return;
    await onFrame?.(data);
    if (data.trim() === '[DONE]') { finished = true; return; }
    let result;
    try { result = JSON.parse(data); } catch { throw failure('ai_invalid_stream'); }
    if (result.error) throw failure('ai_stream_error');
    if (result.usage) metadata.usage = result.usage;
    const choice = result.choices?.find(c => c.index === 0 || c.index === undefined);
    if (!choice) return;
    if (choice.finish_reason) { metadata.finish_reason = choice.finish_reason; terminal = true; }
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') {
      message.content += retain(delta.content);
      await onContent?.(delta.content);
    }
    for (const key of ['reasoning_content', 'reasoning']) if (typeof delta[key] === 'string') {message[key] = (message[key]||'')+delta[key];reasoningChars+=delta[key].length;}
    for(const [key,value] of Object.entries(delta)) {
      if(['role','content','reasoning','reasoning_content','tool_calls'].includes(key))continue;
      if(typeof value==='string')message[key]=(message[key]||'')+value;
      else if(Array.isArray(value))message[key]=[...(message[key]||[]),...value];
      else if(value!==null)message[key]=value;
    }
    for (const part of delta.tool_calls || []) {
      if (!Number.isInteger(part?.index) || part.index < 0 || part.index >= 64) throw failure('ai_invalid_stream');
      const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if([part.id,part.function?.name,part.function?.arguments].some(value=>value!==undefined&&value!==null&&typeof value!=='string'))throw failure('ai_invalid_stream');
      if (part.id) call.id += retain(part.id);
      if (part.function?.name) call.function.name += retain(part.function.name);
      if (part.function?.arguments) call.function.arguments += retain(part.function.arguments);
      calls.set(part.index, call);
    }
  }
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    chunks++;
    // SSE envelopes and discarded reasoning can be much larger than the reply.
    // Bound transport separately from retained output and any individual frame.
    if (bytes > wireLimit) throw failure('ai_response_too_large');
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
      const value = buffer.slice(0, end.index); buffer = buffer.slice(end.index + end[0].length);
      await frame(value);
      if (finished) break;
    }
    if(!finished&&Buffer.byteLength(buffer,'utf8')>limit)throw failure('ai_response_too_large');
    onProgress?.(progress());
    if (finished) break;
  }
  if (!finished) {
    buffer += decoder.decode();
    if (buffer.trim()) await frame(buffer);
  }
  if (!finished && !terminal) throw failure('ai_response_interrupted');
  if (calls.size) message.tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
  return { choices: [{ message, finish_reason: metadata.finish_reason }], usage: metadata.usage };
}
