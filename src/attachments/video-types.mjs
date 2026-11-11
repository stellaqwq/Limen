// Container sniffing for video attachments. The host must recognise these
// even when the video plugin is not installed.
import { extname } from 'node:path';

export const videoExtension = name => /\.(?:mp4|m4v|mov|webm|mkv|avi)$/i.test(name);

export function videoType(name, bytes) {
  const extension = extname(name).slice(1).toLowerCase();
  if (['mp4', 'm4v', 'mov'].includes(extension) && bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp') return { kind: 'video', extension, mime: 'video/mp4' };
  if (['mkv', 'webm'].includes(extension) && bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return { kind: 'video', extension, mime: extension === 'webm' ? 'video/webm' : 'video/x-matroska' };
  if (extension === 'avi' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'AVI ') return { kind: 'video', extension, mime: 'video/x-msvideo' };
  return null;
}
