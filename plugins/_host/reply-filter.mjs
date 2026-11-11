// Host SDK: reply-filter.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('reply-filter.mjs');
export const { filterAIReply } = host;
