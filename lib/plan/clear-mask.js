/**
 * The mask for "Change this picture…": a PNG the size of a picture the app
 * makes (1536 by 1024), clear everywhere, so the whole picture may change.
 * `lib/ai.js` `editPicture` takes it as `mask`; it must stay under 48 KB, and
 * one colour with no edges compresses to about 6 KB.
 *
 * Built here byte by byte (signature, IHDR, IDAT, IEND) with `node:zlib`, so it
 * runs only on the server.
 */

import { crc32, deflateSync } from 'node:zlib';

export const MASK_WIDTH = 1536;
export const MASK_HEIGHT = 1024;

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

let made = null;

/** One PNG chunk: length, type, data and the CRC of type and data. */
function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBytes, data]);
  const out = Buffer.alloc(4 + body.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, 4 + body.length);
  return out;
}

function build() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(MASK_WIDTH, 0);
  header.writeUInt32BE(MASK_HEIGHT, 4);
  header[8] = 8; // bits per sample
  header[9] = 6; // red, green, blue and alpha
  header[10] = 0; // deflate
  header[11] = 0; // filter method 0
  header[12] = 0; // not interlaced
  // Each row: filter 0 (none), then every pixel 0, 0, 0, 0 (fully clear).
  const rows = Buffer.alloc(MASK_HEIGHT * (1 + MASK_WIDTH * 4));
  const png = Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

/**
 * The clear mask's PNG bytes (a fresh copy each call).
 *
 * @returns {Uint8Array}
 */
export function clearMask() {
  made ??= build();
  return made.slice();
}
