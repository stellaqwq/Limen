// 只读查询：本地运行时版本 vs QQ 官方最新版本。
// 用法：npm run qq:update
// 不会下载、不会改 .env，也不碰正在运行的内核。
import { resolve, isAbsolute } from 'node:path';
import { checkKernelUpdate } from '../src/qq/kernel/update.mjs';
import { resolveQQRuntime } from '../src/qq/runtime-location.mjs';

const configured = process.env.QQ_RUNTIME_DIR || './runtime/qq';
const runtime = isAbsolute(configured) ? resolve(configured) : resolveQQRuntime(configured);
try {
  const result = await checkKernelUpdate({ runtimeDirectory: runtime });
  process.stdout.write(JSON.stringify({ ...result, runtime }, null, 2) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ prepared: false, update_available: false, runtime,
    error: error.message, checked_at: new Date().toISOString() }, null, 2) + '\n');
  process.exitCode = 1;
}
