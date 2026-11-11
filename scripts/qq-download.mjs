// 手动准备官方运行时：下载 → 校验腾讯签名 → 解包 → 复制 → 编译宿主。
// 下载与校验逻辑在 src/qq/kernel/download.mjs，首次启动的自动准备也复用它。
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { downloadOfficialInstaller, unpackOfficialInstaller, removeUnpacked } from '../src/qq/kernel/download.mjs';
import { bundleQQ } from '../src/qq/kernel/runtime.mjs';

const notify = line => process.stdout.write(line + '\n');
try {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Official QQ preparation currently supports Windows x64');
  const download = await downloadOfficialInstaller({ downloadsDirectory: 'runtime/downloads', notify });
  notify(`Tencent signature verified; SHA256 ${download.provenance.sha256}`);
  if (process.argv.includes('--prepare')) {
    const target = resolve(`runtime/qq-${download.version}`);
    if (!existsSync(target)) {
      const installation = await unpackOfficialInstaller({ installer: download.file, version: download.version,
        downloadsDirectory: 'runtime/downloads', sevenZip: process.env.QQ_7ZIP || '', notify });
      await bundleQQ({ source: installation.executable, destination: target });
      await removeUnpacked(installation.unpacked);
    }
    const kernel = resolve(`runtime/kernel-${download.version}`);
    const build = spawnSync(process.execPath, [resolve('scripts/qq-build.mjs')], { windowsHide: true, stdio: 'inherit',
      env: { ...process.env, QQ_RUNTIME_DIR: target, QQ_KERNEL_DIR: kernel } });
    if (build.status !== 0) throw new Error('QQ native host adaptation failed');
    if (process.argv.includes('--activate')) {
      if (!existsSync('.env')) throw new Error('Run npm run init before activating the QQ runtime');
      let env = await readFile('.env', 'utf8');
      for (const [key, value] of Object.entries({ QQ_DRIVER: 'kernel', QQ_RUNTIME_DIR: target, QQ_KERNEL_DIR: kernel })) {
        const pattern = new RegExp(`^${key}=.*$`, 'm'); env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : env + `\n${key}=${value}\n`;
      }
      await writeFile('.env', env, { mode: 0o600 });
    }
    process.stdout.write(JSON.stringify({ version: download.version, runtime: target, kernel, activated: process.argv.includes('--activate'), restart_required: true }, null, 2) + '\n');
  }
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
