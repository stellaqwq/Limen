// Host SDK: plugins/config-schema.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('plugins/config-schema.mjs');
export const { applyConfigSchema, normalizeConfigSchema } = host;
