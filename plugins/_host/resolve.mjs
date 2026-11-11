// Host SDK locator. Plugin packages may be installed in several layouts:
//
//   <root>/plugins/_host            next to <root>/resources/app   (development, portable build)
//   <app>/plugins/_host             inside the packaged Electron app
//   <root>/vendor/plugins/_host     custom installs
//
// Every _host module resolves the host source tree through this file instead
// of hardcoding one relative depth, so a plugin package keeps working when the
// whole install folder is copied to another machine.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const candidates = [
  resolve(here, '..', '..', 'resources', 'app', 'src'),
  resolve(here, '..', '..', 'src'),
  resolve(here, '..', '..', '..', 'src'),
  resolve(here, '..', '..', '..', 'resources', 'app', 'src'),
  resolve(here, '..', '..', '..', '..', 'resources', 'app', 'src')
];

export const hostSrc = candidates.find(candidate => existsSync(join(candidate, 'messages.mjs'))) || '';

if (!hostSrc) {
  throw new Error('插件 SDK 无法定位宿主源码目录；请确认 plugins 与 resources/app 处于安装包中的原始相对位置，或重新安装Limen。');
}

export const appRoot = dirname(hostSrc);
export const pluginDir = dirname(here);

export const hostModule = name => import(pathToFileURL(join(hostSrc, name)).href);
