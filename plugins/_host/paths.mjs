// Host SDK: stable locations so plugin packages never hardcode the tree
// layout between plugins/ and resources/app/.
import { join, sep } from 'node:path';
import { appRoot, pluginDir } from './resolve.mjs';

export { appRoot, pluginDir };
export const runtimeRoot = join(appRoot, 'runtime');
export const pluginRoot = pluginDir;

/** Absolute path of a shared runtime directory, e.g. runtimeDir('video-tools'). */
export const runtimeDir = name => join(runtimeRoot, String(name).replace(/[\\/]+$/, '')) + sep;
