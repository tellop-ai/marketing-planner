/**
 * The zip writer (`lib/plan/zip.js`): its CRC-32 against the known vector,
 * the bytes it writes (stored files, UTF-8 names, one fixed date), its limits
 * at the edge and one past, the names it cleans, its own reader, and a real
 * unzip program reading what it wrote (the Mac's `/usr/bin/unzip`; skipped,
 * and said so, where there is none).
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';

import { cleanZipName, crc32, downloadAddress, unzipStored, ZIP_LIMITS, ZIP_START, zipDate, zipFiles } from '../lib/plan/zip.js';
const LOCAL_SIZE = 30;

const scratch = mkdtempSync(path.join(os.tmpdir(), 'zip-checks-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const text = (value) => new TextEncoder().encode(value);
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
/** Bytes a zip of files with these name and data sizes takes: each file's header, its central entry and the end record. */
const zipSize = (entries) => 22 + entries.reduce((total, [name, data]) => total + 30 + 46 + 2 * name + data, 0);

test('the CRC-32 is the standard one: the known vector, nothing, and one byte', () => {
  assert.equal(crc32(text('123456789')).toString(16), 'cbf43926');
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(new Uint8Array([0])).toString(16), 'd202ef8d');
  assert.equal(crc32(text('The quick brown fox jumps over the lazy dog')).toString(16), '414fa339');
});

test('one empty file: a header, a central entry and the end record, stored, dated its day at 00:00, the name flagged UTF-8', () => {
  // The moment is passed in, so the check never depends on the clock or the time zone it runs in.
  const today = new Date(2026, 9, 22, 15, 30);
  const zip = zipFiles([{ name: 'empty.txt', bytes: new Uint8Array(0) }], { now: today });
  assert.equal(zip.length, zipSize([[9, 0]]));
  assert.deepEqual([...zip.subarray(0, 4)], [...ZIP_START]);
  const bytes = view(zip);
  assert.equal(bytes.getUint16(6, true), 0x0800, 'general purpose bit 11: UTF-8 names');
  assert.equal(bytes.getUint16(8, true), 0, 'stored, no compression');
  assert.equal(bytes.getUint16(10, true), 0, '00:00');
  assert.equal(bytes.getUint16(12, true), (46 << 9) | (10 << 5) | 22, '2026-10-22 on this computer’s clock');
  assert.equal(bytes.getUint32(14, true), 0, 'the CRC-32 of nothing');
  assert.equal(bytes.getUint32(18, true), 0);
  const end = zip.length - 22;
  assert.equal(bytes.getUint32(end, true), 0x06054b50);
  assert.equal(bytes.getUint16(end + 10, true), 1);
  assert.deepEqual(unzipStored(zip).map((file) => [file.name, file.bytes.length]), [['empty.txt', 0]]);
});

test('two files keep their order, their bytes and their CRC-32, and the same files give the same bytes', () => {
  const files = [{ name: 'a.csv', bytes: text('a,b\r\n1,2\r\n') }, { name: 'b.ics', bytes: text('BEGIN:VCALENDAR\r\n') }];
  const zip = zipFiles(files);
  assert.equal(zip.length, zipSize([[5, 10], [5, 17]]));
  assert.equal(view(zip).getUint32(14, true), crc32(files[0].bytes));
  const read = unzipStored(zip);
  assert.deepEqual(read.map((file) => file.name), ['a.csv', 'b.ics']);
  assert.deepEqual(read.map((file) => new TextDecoder().decode(file.bytes)), ['a,b\r\n1,2\r\n', 'BEGIN:VCALENDAR\r\n']);
  assert.deepEqual(zipFiles(files), zip, 'the same files on the same day give the same bytes');
});

test('every file is dated the day the zip is made, on this computer’s clock, at 00:00, in its header and its central entry', () => {
  const files = [{ name: 'a.csv', bytes: text('a') }, { name: 'b.ics', bytes: text('b') }];
  const fields = (zip) => {
    const bytes = view(zip);
    const central = bytes.getUint32(zip.length - 22 + 16, true);
    const second = LOCAL_SIZE + 5 + 1;
    return [bytes.getUint16(10, true), bytes.getUint16(12, true), bytes.getUint16(second + 10, true), bytes.getUint16(second + 12, true),
      bytes.getUint16(central + 12, true), bytes.getUint16(central + 14, true)];
  };
  const date = (year, month, day) => ((year - 1980) << 9) | (month << 5) | day;
  // A day's edge, 23:59:59 and 00:00:00 local, whatever the time zone: the local day, never the UTC one.
  assert.deepEqual(fields(zipFiles(files, { now: new Date(2026, 9, 22, 23, 59, 59) })), [0, date(2026, 10, 22), 0, date(2026, 10, 22), 0, date(2026, 10, 22)]);
  assert.deepEqual(fields(zipFiles(files, { now: new Date(2026, 9, 23, 0, 0, 0) })), [0, date(2026, 10, 23), 0, date(2026, 10, 23), 0, date(2026, 10, 23)]);
  assert.deepEqual(fields(zipFiles(files, { now: new Date(2026, 9, 23, 0, 0, 0).getTime() })), [0, date(2026, 10, 23), 0, date(2026, 10, 23), 0, date(2026, 10, 23)], 'a moment as milliseconds');
  // The same day at another hour gives the same bytes; the next day does not.
  assert.deepEqual(zipFiles(files, { now: new Date(2026, 9, 22, 8) }), zipFiles(files, { now: new Date(2026, 9, 22, 21) }));
  assert.notDeepEqual(zipFiles(files, { now: new Date(2026, 9, 22, 8) }), zipFiles(files, { now: new Date(2026, 9, 23, 8) }));
  // The edges a zip's date can hold: 1980-01-01 and 2107-12-31; outside them, the nearest.
  assert.equal(zipDate(new Date(1980, 0, 1)), date(1980, 1, 1));
  assert.equal(zipDate(new Date(1979, 11, 31)), date(1980, 1, 1));
  assert.equal(zipDate(new Date(2107, 11, 31)), date(2107, 12, 31));
  assert.equal(zipDate(new Date(2108, 0, 1)), date(2107, 12, 31));
  assert.equal(zipDate(new Date(2024, 1, 29)), date(2024, 2, 29), 'a leap day');
  // Not a moment: today on the clock (read on each side, so a check run across midnight still holds).
  const dayOf = (at) => date(at.getFullYear(), at.getMonth() + 1, at.getDate());
  const before = dayOf(new Date());
  const read = zipDate('not a moment');
  const after = dayOf(new Date());
  assert.ok(read === before || read === after, String(read));
});

test('a Turkish name is written in UTF-8, and a name in decomposed letters (as a Mac names files) is written composed', () => {
  const name = 'müşteriler-ğıİçö-2026-10.csv';
  const zip = zipFiles([{ name: name.normalize('NFD'), bytes: text('x') }]);
  const written = new TextDecoder().decode(zip.subarray(30, 30 + view(zip).getUint16(26, true)));
  assert.equal(written, name.normalize('NFC'));
  assert.equal(unzipStored(zip)[0].name, name.normalize('NFC'));
});

test('a zip holds 1 to 200 files: none and 201 are refused, 200 are kept', () => {
  assert.throws(() => zipFiles([]), Error);
  assert.throws(() => zipFiles(/** @type {any} */ (null)), Error);
  const many = (count) => Array.from({ length: count }, (_, index) => ({ name: `${index}.txt`, bytes: text(String(index)) }));
  assert.equal(unzipStored(zipFiles(many(ZIP_LIMITS.files))).length, 200);
  assert.throws(() => zipFiles(many(ZIP_LIMITS.files + 1)), /at most 200/u);
});

test('a zip takes at most 64 MiB: exactly 64 MiB is written, one byte more is refused before anything is built', () => {
  assert.equal(ZIP_LIMITS.bytes, 64 * 1024 * 1024);
  const data = ZIP_LIMITS.bytes - zipSize([[1, 0]]);
  const full = new Uint8Array(data + 1);
  const exact = zipFiles([{ name: 'a', bytes: full.subarray(0, data) }]);
  assert.equal(exact.length, ZIP_LIMITS.bytes);
  assert.equal(view(exact).getUint32(18, true), data);
  assert.throws(() => zipFiles([{ name: 'a', bytes: full }]), /at most 67108864/u);
});

test('bytes must be a Uint8Array', () => {
  for (const bytes of ['words', [1, 2], new ArrayBuffer(2), null, undefined]) {
    assert.throws(() => zipFiles([{ name: 'a', bytes: /** @type {any} */ (bytes) }]), /Uint8Array/u, String(bytes));
  }
});

test('names are cleaned: no leading /, no .. or . part, no control character, folders kept, an empty name is its number', () => {
  assert.equal(cleanZipName('/etc/passwd', 0), 'etc/passwd');
  assert.equal(cleanZipName('../../a.txt', 0), 'a.txt');
  assert.equal(cleanZipName('a/../b/./c.txt', 0), 'a/b/c.txt');
  assert.equal(cleanZipName('..\\..\\windows.txt', 0), 'windows.txt');
  assert.equal(cleanZipName('in\u0000side\u001f\u007f\u0085.txt', 0), 'inside.txt');
  assert.equal(cleanZipName('evil\u202egnp.exe', 0), 'evilgnp.exe', 'a mark that turns text around is removed');
  assert.equal(cleanZipName(' slides / 1.jpg ', 0), 'slides/1.jpg');
  assert.equal(cleanZipName('a..b.txt', 0), 'a..b.txt', 'two dots inside a name are no folder step');
  assert.equal(cleanZipName('', 4), '5');
  assert.equal(cleanZipName('../', 0), '1');
  assert.equal(cleanZipName(/** @type {any} */ (42), 1), '2');
});

test('a name holds at most 120 characters: 120 stay, 121 are cut before the ending, and a Turkish letter is one character', () => {
  const exact = `${'ş'.repeat(116)}.jpg`;
  assert.equal(Array.from(exact).length, 120);
  assert.equal(cleanZipName(exact, 0), exact);
  const over = `${'ş'.repeat(117)}.jpg`;
  assert.equal(cleanZipName(over, 0), exact);
  const emoji = `${'😀'.repeat(130)}`;
  assert.equal(Array.from(cleanZipName(emoji, 0)).length, 120, 'never half of a character');
  const read = unzipStored(zipFiles([{ name: over, bytes: text('x') }]));
  assert.equal(read[0].name, exact);
});

test('a name already used gets (2), (3): upper and lower case count as the same, as on a Mac', () => {
  const zip = zipFiles([
    { name: 'photo.jpg', bytes: text('1') },
    { name: 'Photo.jpg', bytes: text('2') },
    { name: 'photo.jpg', bytes: text('3') },
    { name: 'photo (2).jpg', bytes: text('4') },
    { name: '/photo.jpg', bytes: text('5') },
  ]);
  assert.deepEqual(unzipStored(zip).map((file) => file.name), ['photo.jpg', 'Photo (2).jpg', 'photo (3).jpg', 'photo (2) (2).jpg', 'photo (4).jpg']);
  const long = `${'a'.repeat(116)}.jpg`;
  const both = unzipStored(zipFiles([{ name: long, bytes: text('1') }, { name: long, bytes: text('2') }])).map((file) => file.name);
  assert.equal(Array.from(both[1]).length, 120);
  assert.ok(both[1].endsWith(' (2).jpg'), both[1]);
});

test('the reader refuses a file whose bytes do not match their CRC-32, a compressed file and bytes that are no zip', () => {
  const zip = zipFiles([{ name: 'a.txt', bytes: text('hello') }]);
  const changed = zip.slice();
  changed[30 + 5] ^= 0xff;
  assert.throws(() => unzipStored(changed), /CRC-32/u);
  const packed = zip.slice();
  view(packed).setUint16(packed.length - 22 - 51 + 10, 8, true);
  assert.throws(() => unzipStored(packed), /not stored/u);
  assert.throws(() => unzipStored(text('not a zip at all, just words')), /no end record/u);
});

test('the download address names the kept file', () => {
  assert.equal(downloadAddress('a'.repeat(64)), `/api/downloads?file=${'a'.repeat(64)}`);
});

test('the Mac’s own unzip reads what was written: every CRC-32, every name and every byte', (t) => {
  const unzip = '/usr/bin/unzip';
  if (!existsSync(unzip)) {
    t.skip(`unproven here: a real unzip program reading these zips. ${unzip} is missing; run this file on a Mac (node --test tests/zip.test.mjs)`);
    return;
  }
  const files = [
    { name: 'posts-2026-10.csv', bytes: text('\ufeffDay,Post\r\n2026-10-01,Ürün\r\n') },
    { name: 'müşteriler-2026-10.csv', bytes: text('a,b\r\n') },
    { name: 'empty.txt', bytes: new Uint8Array(0) },
    { name: 'slides/1.bin', bytes: Uint8Array.from({ length: 70_000 }, (_, index) => (index * 31) & 0xff) },
  ];
  const file = path.join(scratch, 'written.zip');
  writeFileSync(file, zipFiles(files));
  const tested = spawnSync(unzip, ['-t', file], { encoding: 'utf8' });
  assert.equal(tested.status, 0, `${tested.stdout}${tested.stderr}`);
  assert.match(tested.stdout, /No errors detected/u);
  const folder = path.join(scratch, 'out');
  const unpacked = spawnSync(unzip, ['-q', file, '-d', folder], { encoding: 'utf8' });
  assert.equal(unpacked.status, 0, `${unpacked.stdout}${unpacked.stderr}`);
  for (const { name, bytes } of files) assert.deepEqual(new Uint8Array(readFileSync(path.join(folder, name))), bytes, name);
});
