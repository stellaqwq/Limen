// Host SDK: messages.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('messages.mjs');
export const { aiDecision, aiInput, boolean, chatCommandAllowed, chatText, conversation, eventKey, id, isChatAdmin, isChatCommand, isGroupUserBlocked, parseMessage, replyMessage, replyOptions, toCQ } = host;
