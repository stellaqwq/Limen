// 首启驱动与 .env.seed 模板。
// 便携包可以预置 .env.seed（一般写 QQ_DRIVER=kernel），桌面入口按这里的规则落盘：
//   1) 工作区还没有 .env：用模板里的驱动，没有模板才按「包里有没有 QQ 运行时」猜；
//   2) 工作区已有 .env（旧包把驱动猜成了 demo）：一次性纠正回来并写标记，之后尊重手工设置。
// 只读模板里的 QQ_DRIVER 一项，令牌和密钥始终由 initializeEnv 随机生成。
// 每次判定都会在工作区写 driver-seed.json（只含驱动、判定原因和配置路径），
// 远端机器上「为什么进了模拟驱动」看这个文件就知道。
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// 值可能带引号（.env.example 里就是 QQ_DRIVER="kernel"），也可能裸写。
const DRIVER = /^QQ_DRIVER=(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/m;
const marker = directory => join(directory, '.env.seed.applied');

export function driverOf(text) {
  const match = String(text ?? '').match(DRIVER);
  return match ? String(match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
}

async function decide({ directory, settingsPath, appRoot, demo, includesQQ, created }) {
  if (demo) return { driver: 'demo', changed: false, reason: 'demo-flag', seed: '' };
  const seeded = driverOf(await readFile(join(appRoot, '.env.seed'), 'utf8').catch(() => ''));
  const text = await readFile(settingsPath, 'utf8');

  if (created) {
    const driver = seeded || (includesQQ ? 'kernel' : 'demo');
    await writeFile(settingsPath, text.replace(/^QQ_DRIVER=.*$/m, 'QQ_DRIVER=' + driver).replace(/^PORT=.*$/m, 'PORT=0'));
    await writeFile(marker(directory), JSON.stringify({ at: new Date().toISOString(), driver, reason: 'first-run' }) + '\n').catch(() => {});
    return { driver, changed: true, reason: 'first-run', seed: seeded };
  }

  const current = driverOf(text);
  if (!seeded) return { driver: current, changed: false, reason: 'no-seed', seed: '' };
  if (existsSync(marker(directory))) return { driver: current, changed: false, reason: 'already-applied', seed: seeded };
  if (current !== 'demo') {
    await writeFile(marker(directory), JSON.stringify({ at: new Date().toISOString(), driver: current, reason: 'kept' }) + '\n').catch(() => {});
    return { driver: current, changed: false, reason: 'kept', seed: seeded };
  }
  // 旧包的首次初始化把驱动猜成了 demo；这里纠正一次，写标记后不再干预。
  await writeFile(settingsPath, text.replace(/^QQ_DRIVER=.*$/m, 'QQ_DRIVER=' + seeded));
  await writeFile(marker(directory), JSON.stringify({ at: new Date().toISOString(), driver: seeded, reason: 'migrated-from-demo' }) + '\n').catch(() => {});
  return { driver: seeded, changed: true, reason: 'migrated-from-demo', seed: seeded };
}

/** @returns {{driver:string, changed:boolean, reason:string, seed:string}} */
export async function applySeedDriver(input) {
  const result = await decide({ demo: false, includesQQ: false, created: false, ...input });
  if (!result.seed) result.seed = driverOf(await readFile(join(input.appRoot, '.env.seed'), 'utf8').catch(() => ''));
  await writeFile(join(input.directory, 'driver-seed.json'), JSON.stringify({
    at: new Date().toISOString(), driver: result.driver, changed: result.changed, reason: result.reason,
    seed_driver: result.seed, env: input.settingsPath
  }, null, 2) + '\n').catch(() => {});
  return result;
}
