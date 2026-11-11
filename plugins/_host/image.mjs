// Host SDK: qq/kernel/image.mjs
// Generated facade. The host source tree is located by resolve.mjs so the
// same plugin package works after the install folder is moved or copied.
import { hostModule } from './resolve.mjs';
const host = await hostModule('qq/kernel/image.mjs');
export const { DEFAULT_IMAGE_BYTES, ImageCache, imageInfo, readImage } = host;
