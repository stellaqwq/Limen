// Read-only projection of real task/trace state. Never classify user wording or
// expose tool arguments, credentials, private reasoning, or other sessions.
export const computerTool = name => /(?:^|[_./:-])(?:exec(?:ute)?|shell|bash|terminal|command|computer|desktop|browser|playwright|python|run_code|run_command|read_file|file_write|write_file|edit_file|str_replace_editor|apply_patch)(?:$|[_./:-])/i.test(name);
export function roomSnapshot(agent,session) {
  session=agent.webSession(session);
  const jobs=agent.store.db.prepare("SELECT id,status,reply,created_at,updated_at FROM jobs WHERE conversation=? AND channel='web' ORDER BY id DESC LIMIT 16").all('web:'+session).reverse().map(job=>{
    const tools=agent.state.trace(job.id).filter(step=>step.kind==='tool').map(step=>({name:step.name,state:step.state,computer:computerTool(step.name)}));
    return {id:job.id,status:job.status,createdAt:job.created_at,updatedAt:job.updated_at,computer:tools.some(t=>t.computer),tools,
      reply:job.status==='done'?String(job.reply||'').slice(0,1600):''};
  });
  const active=jobs.find(j=>['generating','ready','sending'].includes(j.status))||jobs.find(j=>j.status==='queued');
  return {version:1,source:'qq-agent',session,jobs,current:active||jobs.at(-1)||null};
}
