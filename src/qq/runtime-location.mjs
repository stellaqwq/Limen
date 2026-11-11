import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const bundledQQRuntime=fileURLToPath(new URL('../../../qq-runtime',import.meta.url));
export function resolveQQRuntime(value,{cwd=process.cwd(),bundledDirectory=bundledQQRuntime}={}){
  const configured=resolve(cwd,value||'./runtime/qq');
  // Keep custom runtimes and existing local copies. Resolve the packaged copy
  // afresh on each launch so moving the portable folder does not stale .env.
  if(configured===resolve(cwd,'runtime/qq')&&!existsSync(join(configured,'runtime.json'))&&existsSync(join(bundledDirectory,'runtime.json')))return resolve(bundledDirectory);
  return configured;
}
