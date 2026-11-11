// Host SDK: agent/schema.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('agent/schema.mjs');
export const { normalizeTools, parameters, validateArguments, validateSchema } = host;
