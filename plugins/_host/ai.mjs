// Host SDK: ai.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('ai.mjs');
export const { AIClient, describeAIFailure } = host;
