import { spawn } from 'node:child_process';
import { join } from 'node:path';

export const powershell = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Wait for close, including cancellation, before releasing the desktop lease.
export function runProcess(executable, args, { input = '', cwd, signal, timeout = 15000, maxBytes = 2 * 1024 * 1024, binary = false } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = []; const started=Date.now();let bytes = 0, failure, killer, timer;
    const stop = (reason,kind) => {
      if (failure) return;
      failure = Object.assign(new Error(reason?.message||'本机操作已停止。'),{cause:reason,processReason:kind});
      if (process.platform === 'win32' && child.pid) {
        killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const abort = () => stop(signal.reason || Error('操作已停止。'),'cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => stop(Error('本机操作超时，结果可能已生效，请核对。'),'timeout'), timeout);
    const collect = chunks => chunk => { bytes += chunk.length; if (bytes > maxBytes) stop(Error('本机操作输出超过限制。'),'output_limit'); else chunks.push(chunk); };
    child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
    child.stdin.on('error', () => {});
    child.once('error', error => { failure ||= error; });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) reject(Object.assign(failure,{stdout:Buffer.concat(out).toString('utf8').replace(/^\uFEFF/,''),stderr:Buffer.concat(err).toString('utf8'),elapsed_ms:Date.now()-started,timeout_ms:timeout,exit_code:code}));
      else resolve({ code, stdout: binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8').replace(/^\uFEFF/, ''), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.end(input);
  });
}
