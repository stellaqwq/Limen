import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { client } from '../src/web/client.mjs';

async function check(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const target = `${path}/${item.name}`;
    if (item.isDirectory()) await check(target);
    else if (item.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
    }
  }
}
for (const path of ['src', 'scripts', 'test', 'examples', 'desktop']) await check(path);
new Script(client, { filename: 'workspace-browser-client.js' });
if (!process.exitCode) process.stdout.write('All JavaScript modules passed syntax checks.\n');
