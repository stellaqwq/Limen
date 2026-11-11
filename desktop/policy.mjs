export function localWorkspaceUrl(value) {
  try { const u=new URL(value); return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&/^\/login\/[a-f0-9]+$/.test(u.pathname); } catch { return false; }
}
export function internalNavigation(value, base) {
  try { const u=new URL(value), b=new URL(base); return u.origin===b.origin&&(u.pathname===b.pathname||u.pathname.startsWith(b.pathname+'/')); } catch { return false; }
}
export function externalNavigation(value) {
  try { const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password; } catch { return false; }
}
