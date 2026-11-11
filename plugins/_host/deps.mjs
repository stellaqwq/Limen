// Host SDK: resolve third-party packages from the host's node_modules.
// Plugin packages live outside the app folder, so a bare `import 'pkg'`
// would not resolve on Node's normal lookup path. Plugins should use
// requireFromHost('pkg') for dependencies the host already ships.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appRoot } from './paths.mjs';

const hostRequire = createRequire(join(appRoot, 'package.json'));

export function requireFromHost(id) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('requireFromHost 需要包名。');
  try { return hostRequire(id); }
  catch (error) {
    throw Object.assign(new Error('宿主未提供依赖 ' + id + '，请在插件包内自带或改用宿主 SDK。'), { status: 500, cause: error });
  }
}
