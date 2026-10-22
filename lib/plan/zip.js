/**
 * Zip files the person downloads, built the same way in the page and on the
 * server (pure: no Node-only import, nothing runs when this file loads).
 *
 * Tellop names a downloaded file by its first bytes: a text file is saved as
 * ".txt", so a calendar file (.ics) or a spreadsheet file (.csv) would lose
 * its kind. Inside a zip each file keeps the name given here, so every
 * download that is not a picture goes in one, and a set of pictures goes in
 * one too (built in the page, kept through `POST /api/downloads`).
 *
 * The zip is the plainest kind every computer opens: each file stored as it
 * is (no compression, method 0) with its CRC-32, names in UTF-8 (general
 * purpose bit 11), and the same moment on every file: the day the zip is
 * made on this computer's clock, at 00:00 (`zipDate`), so a file unpacked
 * shows today, and the same files on the same day give the same bytes. At
 * most `ZIP_LIMITS.files` files and `ZIP_LIMITS.bytes` bytes in all, the
 * most the downloads address keeps.
 */

/** The most files one zip holds, and the most bytes the whole zip may take (64 MiB). */
export const ZIP_LIMITS = Object.freeze({ files: 200, bytes: 64 * 1024 * 1024, name: 120 });

/**
 * The address that hands over a kept zip (`app/api/downloads/route.js`): what
 * every download address answers, from the page's zips and the server's.
 *
 * @param {string} digest the kept file's digest
 */
export function downloadAddress(digest) {
  return `/api/downloads?file=${digest}`;
}

/** The first four bytes of every zip this file writes (a local file header). */
export const ZIP_START = Object.freeze([0x50, 0x4b, 0x03, 0x04]);

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
/** Version 1.0 is enough to read a stored file; made on Unix (3) by zip 3.0, so a file comes out readable (0644). */
const NEEDED = 10;
const MADE_BY = (3 << 8) | 30;
const UTF8_NAMES = 0x0800;
/** The first and last years the DOS date a zip keeps can hold. */
const FIRST_YEAR = 1980;
const LAST_YEAR = 2107;
/** Every file's time of day: 00:00:00. */
const DOS_TIME = 0;
const FILE_MODE = 0o100644;

/**
 * The day of `now` on this computer's clock in the DOS form a zip keeps
 * (bits 9-15 the year since 1980, 5-8 the month, 0-4 the day); a day before
 * 1980 is 1980-01-01 and one after 2107 is 2107-12-31, the zip's first and
 * last. A `now` that is not a moment reads as now.
 *
 * @param {Date | number | string} [now]
 * @returns {number}
 */
export function zipDate(now = new Date()) {
  let at = new Date(now);
  if (!Number.isFinite(at.getTime())) at = new Date();
  const year = at.getFullYear();
  if (year < FIRST_YEAR) return (1 << 5) | 1;
  if (year > LAST_YEAR) return ((LAST_YEAR - FIRST_YEAR) << 9) | (12 << 5) | 31;
  return ((year - FIRST_YEAR) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
}

/** @type {Uint32Array | null} */
let crcTable = null;

/** The CRC-32 table, built on first use and kept. */
function table() {
  if (crcTable !== null) return crcTable;
  const built = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    built[index] = value >>> 0;
  }
  crcTable = built;
  return built;
}

/**
 * The CRC-32 of `bytes` (the zip's and PNG's checksum), as an unsigned number.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  const lookup = table();
  let crc = 0xffffffff;
  for (let at = 0; at < bytes.length; at += 1) crc = lookup[(crc ^ bytes[at]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Control characters (C0, DEL and C1) and the marks that turn text around. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
/** A file's ending kept when a long name is cut: a dot and up to ten letters or digits. */
const ENDING = /\.[\p{L}\p{N}]{1,10}$/u;

/** The first `count` characters of `text`, never half of one. @param {string} text @param {number} count */
function firstCharacters(text, count) {
  return Array.from(text).slice(0, Math.max(0, count)).join('');
}

/**
 * `name` made safe to unpack anywhere: NFC, no control characters, `\` read as
 * a folder mark, no empty, `.` or `..` part (so nothing lands outside the
 * folder it is unpacked in, and nothing starts with `/`), spaces trimmed off
 * each part, at most `ZIP_LIMITS.name` characters (a long name is cut before
 * its ending). An empty result is the file's number.
 *
 * @param {unknown} raw
 * @param {number} index
 */
export function cleanZipName(raw, index) {
  const text = typeof raw === 'string' ? raw.normalize('NFC').replace(CONTROLS, '') : '';
  const parts = text.split(/[\\/]/u).map((part) => part.trim()).filter((part) => part !== '' && !/^\.+$/u.test(part));
  const name = parts.join('/');
  if (name === '') return String(index + 1);
  return cutName(name, ZIP_LIMITS.name);
}

/** `name` at most `most` characters, cut before its ending; a cut never leaves a folder mark or a space at the end of what stays. */
function cutName(name, most) {
  if (Array.from(name).length <= most) return name;
  const ending = ENDING.exec(name)?.[0] ?? '';
  const stem = firstCharacters(name.slice(0, name.length - ending.length), most - Array.from(ending).length).replace(/[\s/.]+$/u, '');
  return `${stem}${ending}`;
}

/**
 * Names made unique the way a folder needs them (upper and lower case count
 * as the same, as on a Mac): the second `photo.jpg` is `photo (2).jpg`.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
function uniqueNames(names) {
  const taken = new Set();
  return names.map((name) => {
    let chosen = name;
    for (let copy = 2; taken.has(chosen.toLowerCase()); copy += 1) {
      const ending = ENDING.exec(name)?.[0] ?? '';
      const mark = ` (${copy})`;
      const stem = name.slice(0, name.length - ending.length);
      chosen = `${firstCharacters(stem, ZIP_LIMITS.name - Array.from(mark).length - Array.from(ending).length)}${mark}${ending}`;
    }
    taken.add(chosen.toLowerCase());
    return chosen;
  });
}

/**
 * A zip holding `files`, each `{ name, bytes }` (`bytes` a `Uint8Array`), in
 * the order given. Throws a plain `Error` for no file, more than
 * `ZIP_LIMITS.files` files, bytes that are not a `Uint8Array`, or a zip that
 * would pass `ZIP_LIMITS.bytes`; names are cleaned (`cleanZipName`) and made
 * unique. Every file is dated `now`'s day at 00:00 (`zipDate`; today when
 * none is given).
 *
 * @param {Array<{ name: string, bytes: Uint8Array }>} files
 * @param {{ now?: Date | number | string }} [options]
 * @returns {Uint8Array}
 */
export function zipFiles(files, { now } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('zipFiles: no file to put in the zip');
  if (files.length > ZIP_LIMITS.files) throw new Error(`zipFiles: ${files.length} files, at most ${ZIP_LIMITS.files}`);
  for (const file of files) {
    if (!(file?.bytes instanceof Uint8Array)) throw new Error('zipFiles: a file’s bytes are not a Uint8Array');
  }
  const encoder = new TextEncoder();
  const names = uniqueNames(files.map((file, index) => cleanZipName(file.name, index))).map((name) => encoder.encode(name));
  let total = END_SIZE;
  files.forEach((file, index) => {
    total += LOCAL_SIZE + CENTRAL_SIZE + 2 * names[index].length + file.bytes.length;
  });
  if (total > ZIP_LIMITS.bytes) throw new Error(`zipFiles: ${total} bytes, at most ${ZIP_LIMITS.bytes}`);
  const DOS_DATE = zipDate(now);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets = [];
  const crcs = [];
  let at = 0;
  files.forEach((file, index) => {
    const name = names[index];
    const crc = crc32(file.bytes);
    offsets.push(at);
    crcs.push(crc);
    view.setUint32(at, LOCAL, true);
    view.setUint16(at + 4, NEEDED, true);
    view.setUint16(at + 6, UTF8_NAMES, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, crc, true);
    view.setUint32(at + 18, file.bytes.length, true);
    view.setUint32(at + 22, file.bytes.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + LOCAL_SIZE);
    out.set(file.bytes, at + LOCAL_SIZE + name.length);
    at += LOCAL_SIZE + name.length + file.bytes.length;
  });
  const central = at;
  files.forEach((file, index) => {
    const name = names[index];
    view.setUint32(at, CENTRAL, true);
    view.setUint16(at + 4, MADE_BY, true);
    view.setUint16(at + 6, NEEDED, true);
    view.setUint16(at + 8, UTF8_NAMES, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, crcs[index], true);
    view.setUint32(at + 20, file.bytes.length, true);
    view.setUint32(at + 24, file.bytes.length, true);
    view.setUint16(at + 28, name.length, true);
    // Extra field, comment, disk number and inside attributes stay zero.
    view.setUint32(at + 38, (FILE_MODE << 16) >>> 0, true);
    view.setUint32(at + 42, offsets[index], true);
    out.set(name, at + CENTRAL_SIZE);
    at += CENTRAL_SIZE + name.length;
  });
  view.setUint32(at, END, true);
  view.setUint16(at + 8, files.length, true);
  view.setUint16(at + 10, files.length, true);
  view.setUint32(at + 12, at - central, true);
  view.setUint32(at + 16, central, true);
  return out;
}

/**
 * The files of a zip whose files are stored as they are (what `zipFiles`
 * writes): `[{ name, bytes }]` in the zip's order. Throws a plain `Error` for
 * anything else: no end record, a compressed file, a header that does not
 * match its central entry, or a file whose CRC-32 is not the one recorded.
 *
 * @param {Uint8Array} zip
 * @returns {Array<{ name: string, bytes: Uint8Array }>}
 */
export function unzipStored(zip) {
  if (!(zip instanceof Uint8Array)) throw new Error('unzipStored: not bytes');
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let at = zip.length - END_SIZE; at >= Math.max(0, zip.length - END_SIZE - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('unzipStored: no end record');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = [];
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_SIZE > end || view.getUint32(at, true) !== CENTRAL) throw new Error('unzipStored: a central entry is missing');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (method !== 0 || packed !== size) throw new Error('unzipStored: a file is not stored as it is');
    const name = decoder.decode(zip.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength));
    if (local + LOCAL_SIZE > zip.length || view.getUint32(local, true) !== LOCAL) throw new Error('unzipStored: a file header is missing');
    if (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 22, true) !== size) throw new Error('unzipStored: a file header differs from its entry');
    const start = local + LOCAL_SIZE + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > zip.length) throw new Error('unzipStored: a file runs past the end');
    const bytes = zip.slice(start, start + size);
    if (crc32(bytes) !== crc) throw new Error(`unzipStored: ${name} does not match its CRC-32`);
    files.push({ name, bytes });
    at += CENTRAL_SIZE + nameLength + skip;
  }
  return files;
}
