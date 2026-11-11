// Host SDK: qq/kernel/audio-codec.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('qq/kernel/audio-codec.mjs');
export const { silkInfo, wavToPCM } = host;
