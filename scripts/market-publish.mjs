// 一键把本机 plugins/ 发布到插件市场仓库：重新打包 → 校验 → 克隆仓库 → 替换 market/ → 提交推送。
//
//   npm run market:publish                 # 生成 dist/market 并推送到 stellaqwq/limen-plugin
//   npm run market:publish -- --dry-run    # 只生成与校验，不联网、不推送
//   npm run market:publish -- --repo <owner>/<name> --branch main
//
// 清单里的 URL 由 --repo/--branch 推出（raw.githubusercontent.com 直连，不经过 302），
// 因此改仓库名后重新发布一次即可，不需要手改 index.json。
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_REPO = 'stellaqwq/limen-plugin';

function argument(name, fallback = '') {
  const index = process.argv.indexOf('--' + name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1];
  const inline = process.argv.find(value => value.startsWith('--' + name + '='));
  return inline ? inline.slice(name.length + 3) : fallback;
}
const flag = name => process.argv.includes('--' + name);

async function git(cwd, args) {
  try { return (await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout; }
  catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error('git ' + args[0] + ' 失败：' + detail);
  }
}

async function exists(path) {
  try { await readFile(path); return true; } catch { return false; }
}

/** 忽略 updated_at 的清单指纹：用来判断这次发布是否真的有内容变化。 */
function stable(text) {
  const catalog = JSON.parse(text);
  return JSON.stringify({ schema: catalog.schema, name: catalog.name, plugins: catalog.plugins, assets: catalog.assets });
}

async function main() {
  const repo = argument('repo', DEFAULT_REPO).replace(/\.git$/, '');
  const branch = argument('branch', 'main');
  const outDir = resolve(root, argument('out', 'dist/market'));
  const plugins = argument('plugins');
  const catalogUrl = `https://raw.githubusercontent.com/${repo}/${branch}/market/index.json`;

  process.stdout.write(`市场仓库 ${repo}@${branch}\n清单地址 ${catalogUrl}\n\n`);

  // 1. 打包插件、生成清单（URL 直接指向发布仓库的 raw 地址）
  const catalogArgs = [join(root, 'scripts', 'market-catalog.mjs'), '--out', outDir,
    '--base-url', `https://raw.githubusercontent.com/${repo}/${branch}/market/`,
    '--name', argument('name', 'Limen 插件市场')];
  if (plugins) catalogArgs.push('--plugins', resolve(plugins));
  try { process.stdout.write((await run(process.execPath, catalogArgs, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout); }
  catch (error) { throw new Error(String(error.stderr || error.message).trim()); }

  // 2. 本地先校验：字段、字节数、SHA-256 全对得上才值得推送
  process.stdout.write('\n' + (await run(process.execPath, [join(root, 'scripts', 'validate-market.mjs'), '--dir', outDir], { cwd: root })).stdout);

  if (flag('dry-run')) {
    process.stdout.write(`\n--dry-run：只生成到 ${outDir}，没有推送。\n把上面的清单地址填进「插件市场 → 市场设置」即可本地试用。\n`);
    return;
  }

  // 3. 浅克隆发布仓库；没有权限或没登录时会在这里停下
  const work = await mkdtemp(join(tmpdir(), 'limen-market-'));
  try {
    await git(work, ['clone', '--depth', '1', '--branch', branch, `https://github.com/${repo}.git`, 'repo']);
    const clone = join(work, 'repo');

    // 手动维护的资源条目（assets.json）不属于生成物，替换前先留住
    const assetsPath = join(clone, 'market', 'assets.json');
    const assets = await exists(assetsPath) ? await readFile(assetsPath, 'utf8') : '';

    // 内容没变就别刷新 updated_at，否则每次发布都是一个空提交
    const previousText = await exists(join(clone, 'market', 'index.json')) ? await readFile(join(clone, 'market', 'index.json'), 'utf8') : '';
    const generatedText = await readFile(join(outDir, 'index.json'), 'utf8');
    const same = previousText && stable(previousText) === stable(generatedText);
    if (same) {
      const previous = JSON.parse(previousText), generated = JSON.parse(generatedText);
      generated.updated_at = previous.updated_at;
      await writeFile(join(outDir, 'index.json'), JSON.stringify(generated, null, 2) + '\n');
    }

    await rm(join(clone, 'market'), { recursive: true, force: true });
    await mkdir(join(clone, 'market'), { recursive: true });
    await cp(join(outDir, 'index.json'), join(clone, 'market', 'index.json'));
    await cp(join(outDir, 'packages'), join(clone, 'market', 'packages'), { recursive: true });
    if (await exists(join(outDir, 'assets'))) await cp(join(outDir, 'assets'), join(clone, 'market', 'assets'), { recursive: true });
    if (assets) await writeFile(assetsPath, assets);

    // 校验脚本以本仓库这份为准，发布时顺手同步过去
    await mkdir(join(clone, 'scripts'), { recursive: true });
    await cp(join(root, 'scripts', 'validate-market.mjs'), join(clone, 'scripts', 'validate-market.mjs'));

    await git(clone, ['add', '-A']);
    const staged = (await git(clone, ['diff', '--cached', '--name-only'])).trim();
    if (!staged) {
      process.stdout.write('\n清单与上次发布一致，没有需要推送的变更。\n');
      return;
    }
    process.stdout.write('\n变更文件：\n' + staged.split('\n').map(name => '  ' + name).join('\n') + '\n');

    const message = argument('message', `chore(market): 重新生成清单（${new Date().toISOString().slice(0, 10)}）`);
    await git(clone, ['-c', `user.name=${argument('author', 'stellaqwq')}`,
      '-c', `user.email=${argument('email', 'stellaqwq@users.noreply.github.com')}`,
      'commit', '-m', message]);
    await git(clone, ['push', 'origin', 'HEAD:' + branch]).catch(async error => {
      // 浅克隆偶尔会和远端抢一次引用：远端已经收到提交却报 cannot lock ref，
      // 或者远端被别处推进了一步。同步一次再快进重推，仍然失败就如实报错。
      if (!/cannot lock ref|stale info|non-fast-forward|fetch first/i.test(error.message)) throw error;
      process.stdout.write('\n推送被拒绝，同步远端后重试一次…\n');
      await git(clone, ['fetch', '--depth', '1', 'origin', branch]);
      await git(clone, ['rebase', 'origin/' + branch]);
      await git(clone, ['push', 'origin', 'HEAD:' + branch]);
    });
    process.stdout.write(`\n已推送到 ${repo}@${branch}\n`);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }

  process.stdout.write(`\n把清单地址填进「插件市场 → 市场设置」：\n  ${catalogUrl}\n`);
}

main().catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
