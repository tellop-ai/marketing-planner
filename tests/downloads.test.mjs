/**
 * Downloads: the address that keeps a zip the page built and hands kept zips
 * over (`app/api/downloads/route.js`), the two spreadsheet downloads now
 * inside zips (customers, shared posts), and "Add to my calendar"
 * (`app/api/export/calendar/route.js`), whose reads stay inside Tellop's
 * records bounds at the month's most posts with the longest words. A
 * throwaway store (`APP_DATA_FILE` in a temporary folder, removed afterwards);
 * rows of another owner are written straight into the store and must never be
 * read. Inside Tellop, files go to Tellop: a stand-in for its files store
 * keeps them where a check says so.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'downloads-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const { keepFile } = await import('../lib/data/files.js');
const customers = await import('../lib/data/customers.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { getLocale, t } = await import('../lib/i18n/index.js');
const { unzipStored, ZIP_LIMITS, zipFiles } = await import('../lib/plan/zip.js');
const { bounded, measured, mostInFlight, largestCall } = await import('./records-bounds.mjs');
const downloads = await import('../app/api/downloads/route.js');
const enquiriesExport = await import('../app/api/export/enquiries/route.js');
const postsExport = await import('../app/api/export/posts/route.js');
const calendarExport = await import('../app/api/export/calendar/route.js');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'someone-else';
const stamp = () => new Date().toISOString();
const ADDRESS = /^\/api\/downloads\?file=[0-9a-f]{64}$/u;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const filesFolder = path.join(scratch, 'files');
/** Files kept outside Tellop, and any still arriving (a body that was stopped leaves none). */
const keptFiles = () => (existsSync(filesFolder) ? readdirSync(filesFolder).filter((name) => name !== 'arrivals') : []);
const arriving = () => (existsSync(path.join(filesFolder, 'arrivals')) ? readdirSync(path.join(filesFolder, 'arrivals')) : []);

/** A body sent in these pieces, as a page's upload arrives. @param {Uint8Array[]} pieces */
const piecesOf = (pieces) => new ReadableStream({
  pull(controller) {
    const next = pieces.shift();
    if (next === undefined) controller.close();
    else controller.enqueue(next);
  },
});
/** `total` bytes that start as a zip does, in pieces of at most 1 MiB, made as they are read. */
function zipShaped(total) {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const piece = new Uint8Array(Math.min(1024 * 1024, total - sent));
      if (sent === 0) piece.set([0x50, 0x4b, 0x03, 0x04]);
      sent += piece.length;
      controller.enqueue(piece);
    },
  });
}
/** A `POST /api/downloads` as the page sends it. */
function keepRequest(body, headers = {}) {
  const sized = body instanceof Uint8Array ? { 'content-length': String(body.length) } : {};
  return new Request('http://app.test/api/downloads', {
    method: 'POST',
    body,
    duplex: 'half',
    headers: { 'content-type': 'application/zip', 'sec-fetch-site': 'same-origin', ...sized, ...headers },
  });
}
const jsonPost = (address, body) => new Request(`http://app.test${address}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const handOver = (address) => downloads.GET(new Request(`http://app.test${address}`));
/** The files of the zip at `address`, as the person's computer unpacks them. */
async function unpacked(address) {
  const handed = await handOver(address);
  assert.equal(handed.status, 200);
  assert.match(handed.headers.get('content-disposition') ?? '', /attachment/u);
  return unzipStored(new Uint8Array(await handed.arrayBuffer()));
}
/** The file's lines with every fold undone. */
const unfolded = (file) => file.replace(/\r\n /gu, '').split('\r\n').filter((line) => line !== '');

/**
 * A stand-in for Tellop's files store (`files.put` takes the body as it
 * arrives, `files.ref` names what is kept) for as long as `work` runs.
 */
async function withTellopFiles(work) {
  const held = new Map();
  const key = Symbol.for('tellop.internalFiles');
  globalThis[key] = {
    async put(body) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      held.set(digest, bytes);
      return { digest, size: bytes.length };
    },
    async ref(digest) {
      const bytes = held.get(digest);
      if (bytes === undefined) return null;
      return { size: bytes.length, kind: bytes[0] === 0x89 ? 'png' : 'other' };
    },
  };
  try {
    return await work(held);
  } finally {
    delete globalThis[key];
  }
}

test('a zip the page built is kept and handed back as a download, byte for byte', async () => {
  const zip = zipFiles([{ name: 'slides/1.txt', bytes: new TextEncoder().encode('one') }, { name: 'slides/2.txt', bytes: new TextEncoder().encode('two') }]);
  const kept = await downloads.POST(keepRequest(zip));
  assert.equal(kept.status, 200);
  const { address } = await kept.json();
  assert.match(address, ADDRESS);
  const handed = await handOver(address);
  assert.equal(handed.status, 200);
  assert.equal(handed.headers.get('content-type'), 'application/octet-stream');
  assert.match(handed.headers.get('content-disposition') ?? '', /^attachment/u);
  assert.deepEqual(new Uint8Array(await handed.arrayBuffer()), zip);

  const unsaid = await downloads.POST(keepRequest(zip, { 'sec-fetch-site': '' }));
  assert.equal(unsaid.status, 403, 'an empty site is not an absent one');
  const plain = new Request('http://app.test/api/downloads', { method: 'POST', body: zip, headers: { 'content-type': 'Application/Zip; charset=binary' } });
  assert.equal((await downloads.POST(plain)).status, 200, 'no site said (an older browser) and the type in any case');
  const inPieces = await downloads.POST(keepRequest(piecesOf([zip.subarray(0, 1), zip.subarray(1, 3), zip.subarray(3, 9), zip.subarray(9)]), { 'content-length': String(zip.length) }));
  assert.deepEqual(await inPieces.json(), { address }, 'its first bytes read across pieces; the same zip is the same file');
});

test('only this app’s own pages keep a zip: another site, a sibling site and an address typed by hand are refused', async () => {
  const zip = zipFiles([{ name: 'a.txt', bytes: new Uint8Array([1]) }]);
  const before = keptFiles().length;
  for (const site of ['cross-site', 'same-site', 'none']) {
    const answer = await downloads.POST(keepRequest(zip, { 'sec-fetch-site': site }));
    assert.equal(answer.status, 403, site);
    assert.deepEqual(await answer.json(), { problem: 'refuse.request' });
  }
  assert.equal(keptFiles().length, before, 'nothing kept');
});

test('only a zip is kept: another type, a body that does not start as a zip, an empty or short body are refused before anything is kept', async () => {
  const zip = zipFiles([{ name: 'a.txt', bytes: new Uint8Array([2]) }]);
  const before = keptFiles().length;
  for (const type of ['application/octet-stream', 'text/plain', 'multipart/form-data; boundary=x', 'application/x-www-form-urlencoded', 'application/json', '']) {
    const answer = await downloads.POST(keepRequest(zip, { 'content-type': type }));
    assert.deepEqual([answer.status, await answer.json()], [400, { problem: 'refuse.request' }], type);
  }
  const notZips = [PNG, new TextEncoder().encode('PK no'), Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Uint8Array(18)]), Uint8Array.from([0x50, 0x4b, 0x03]), new Uint8Array(0)];
  for (const body of notZips) {
    const answer = await downloads.POST(keepRequest(body));
    assert.deepEqual([answer.status, await answer.json()], [400, { problem: 'refuse.request' }], `${body.length} bytes`);
  }
  const noBody = await downloads.POST(new Request('http://app.test/api/downloads', { method: 'POST', headers: { 'content-type': 'application/zip' } }));
  assert.equal(noBody.status, 400);
  const badLength = await downloads.POST(keepRequest(zip, { 'content-length': '12x' }));
  assert.equal(badLength.status, 400);
  assert.equal(keptFiles().length, before, 'nothing kept');
  assert.deepEqual(arriving(), [], 'nothing left arriving');
});

test('a body cut on the way (shorter than it said) is not kept as the zip', async () => {
  const zip = zipFiles([{ name: 'a.txt', bytes: new Uint8Array(100) }]);
  const before = keptFiles().length;
  const cut = await downloads.POST(keepRequest(piecesOf([zip.subarray(0, 50)]), { 'content-length': String(zip.length) }));
  assert.deepEqual([cut.status, await cut.json()], [400, { problem: 'error.fileNotKept' }]);
  assert.equal(keptFiles().length, before);
});

test('a zip of at most 64 MiB is kept: 64 MiB is, one byte more is refused, said or counted as it arrives, and nothing is kept', async () => {
  const before = keptFiles().length;
  const said = await downloads.POST(keepRequest(zipShaped(ZIP_LIMITS.bytes + 1), { 'content-length': String(ZIP_LIMITS.bytes + 1) }));
  assert.deepEqual([said.status, await said.json()], [413, { problem: 'refuse.long' }]);
  const counted = await downloads.POST(keepRequest(zipShaped(ZIP_LIMITS.bytes + 1)));
  assert.deepEqual([counted.status, await counted.json()], [413, { problem: 'refuse.long' }]);
  assert.equal(keptFiles().length, before, 'nothing kept');
  assert.deepEqual(arriving(), [], 'the part that arrived is gone');
  const exact = await downloads.POST(keepRequest(zipShaped(ZIP_LIMITS.bytes)));
  assert.equal(exact.status, 200);
  const { address } = await exact.json();
  const handed = await handOver(address);
  assert.equal(handed.headers.get('content-length'), String(ZIP_LIMITS.bytes));
  await handed.body?.cancel();
  rmSync(path.join(filesFolder, address.slice(-64)));
});

test('a length said to be over 64 MiB is refused before one byte of the body is read; 64 MiB said is read', async () => {
  const before = keptFiles().length;
  let pulled = 0;
  // A body read only when asked (no bytes waiting ahead): each read counts.
  const watched = () => new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const early = await downloads.POST(keepRequest(watched(), { 'content-length': String(ZIP_LIMITS.bytes + 1) }));
  assert.deepEqual([early.status, await early.json()], [413, { problem: 'refuse.long' }]);
  assert.equal(pulled, 0, 'nothing of the body was read');
  // One byte less is the limit itself: the body is read (this one is cut short, so it is refused for that, not for its length).
  const atLimit = await downloads.POST(keepRequest(watched(), { 'content-length': String(ZIP_LIMITS.bytes) }));
  assert.ok(pulled > 0, 'the body was read');
  assert.notEqual(atLimit.status, 413);
  assert.equal(keptFiles().length, before, 'nothing kept');
  assert.deepEqual(arriving(), [], 'nothing left arriving');
});

test('the address hands over only a kept download: never a kept picture, an unknown file or a name that is no digest', async () => {
  const picture = await keepFile(new Request('http://app.test/api/files', { method: 'POST', body: PNG }));
  assert.equal(picture.shows, 'picture');
  assert.equal((await handOver(`/api/downloads?file=${picture.file}`)).status, 404, 'a kept picture is not handed over here');
  for (const file of ['', '../app.db', '0'.repeat(63), '0'.repeat(65), 'A'.repeat(64), `${'0'.repeat(63)}g`, '0'.repeat(64)]) {
    assert.equal((await handOver(`/api/downloads?file=${encodeURIComponent(file)}`)).status, 404, file);
  }
  assert.equal((await handOver('/api/downloads')).status, 404);
});

test('inside Tellop the zip goes to Tellop’s files as it arrives, and the address asks Tellop to hand it over as a download', async () => {
  await withTellopFiles(async (held) => {
    const zip = zipFiles([{ name: 'a.txt', bytes: new TextEncoder().encode('inside') }]);
    const kept = await downloads.POST(keepRequest(zip));
    assert.equal(kept.status, 200);
    const { address } = await kept.json();
    const digest = address.slice(-64);
    assert.deepEqual(held.get(digest), zip);
    const handed = await handOver(address);
    assert.equal(handed.status, 200);
    assert.equal(handed.headers.get('x-tellop-file'), digest);
    assert.equal(handed.headers.get('x-tellop-file-use'), 'download');
    const tooLong = await downloads.POST(keepRequest(zipShaped(ZIP_LIMITS.bytes + 1)));
    assert.equal(tooLong.status, 413);
    assert.equal(held.size, 1, 'the long body was not kept');
  });
});

test('the customers’ download is a zip holding customers-<month>.csv: the owner’s rows only, formulas guarded', async () => {
  const locale = getLocale();
  await customers.addEnquiryFor(OWNER, { name: '=HYPERLINK("https://x.invalid","press")', contact: '+90 532', receivedOn: '2029-01-05', status: 'bought', amount: 120, channel: 'walk-in' });
  await customers.addEnquiryFor(OWNER, { name: 'Plain, with a comma', receivedOn: '2029-01-31' });
  await customers.addEnquiryFor(OWNER, { name: 'Outside the span', receivedOn: '2029-02-01' });
  await customers.addEnquiryFor(OTHER, { name: 'Not yours', receivedOn: '2029-01-10' });
  const made = await enquiriesExport.POST(jsonPost('/api/export/enquiries', { from: '2029-01-01', to: '2029-01-31' }));
  assert.equal(made.status, 200);
  const { address } = await made.json();
  assert.match(address, ADDRESS);
  const files = await unpacked(address);
  assert.deepEqual(files.map((file) => file.name), [t('export.fileName', locale, { month: '2029-01' })]);
  assert.equal(files[0].name, 'customers-2029-01.csv');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(files[0].bytes);
  assert.ok(text.startsWith('\ufeff'), 'a Mac’s spreadsheet reads Turkish letters');
  const lines = text.slice(1).split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split(',')[0], t('export.enquiries.day', locale));
  assert.ok(lines[1].startsWith('2029-01-05,"\'=HYPERLINK('), lines[1]);
  assert.equal(text.includes('Not yours') || text.includes('Outside the span'), false);
  const backwards = await enquiriesExport.POST(jsonPost('/api/export/enquiries', { from: '2029-02-01', to: '2029-01-31' }));
  assert.deepEqual(await backwards.json(), { problem: 'refuse.customers.span' });
  assert.equal(typeof enquiriesExport.GET, 'undefined', 'the download is handed over by the downloads address only');
});

test('the shared posts’ download is a zip holding posts-<month>.csv, the owner’s past shares only', async () => {
  const locale = getLocale();
  const at = (day) => new Date(`${day}T12:00:00`).toISOString();
  const mine = await modelAction('Post', 'create', { data: { ownerId: OWNER, name: 'Spring', day: '2025-03-02', createdAt: stamp(), updatedAt: stamp() } });
  await modelAction('PostVersion', 'create', { data: { ownerId: OWNER, postId: mine.id, network: 'instagram', text: 'Words', sharedAt: at('2025-03-02'), likes: 4, updatedAt: stamp() } });
  const theirs = await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Not yours', day: '2025-03-03', createdAt: stamp(), updatedAt: stamp() } });
  await modelAction('PostVersion', 'create', { data: { ownerId: OTHER, postId: theirs.id, network: 'instagram', text: 'Theirs', sharedAt: at('2025-03-03'), updatedAt: stamp() } });
  const made = await postsExport.POST(jsonPost('/api/export/posts', { month: '2025-03' }));
  assert.equal(made.status, 200);
  const { address } = await made.json();
  assert.match(address, ADDRESS);
  const files = await unpacked(address);
  assert.deepEqual(files.map((file) => file.name), [t('results.export.fileName', locale, { month: '2025-03' })]);
  assert.equal(files[0].name, 'posts-2025-03.csv');
  const text = new TextDecoder().decode(files[0].bytes);
  const lines = text.replace(/^\ufeff/u, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith('2025-03-02,Spring,'), lines[1]);
  assert.equal(text.includes('Not yours') || text.includes('Theirs'), false);
  for (const month of ['2025-3', '2025-13', null]) {
    const refused = await postsExport.POST(jsonPost('/api/export/posts', { month }));
    assert.deepEqual([refused.status, await refused.json()], [400, { problem: 'refuse.request' }], String(month));
  }
  assert.equal(typeof postsExport.GET, 'undefined');
});

test('Add to my calendar: a zip holding plan-<month>.ics with the owner’s posts that have a day in that month', async () => {
  const locale = getLocale();
  await modelAction('Profile', 'upsert', {
    where: { ownerId: OWNER },
    create: { ownerId: OWNER, businessName: 'Lale, Ceramics', createdAt: stamp(), updatedAt: stamp() },
    update: { businessName: 'Lale, Ceramics' },
  });
  const make = (owner, fields) => modelAction('Post', 'create', { data: { ownerId: owner, name: 'A post', createdAt: stamp(), updatedAt: stamp(), ...fields } });
  const timed = await make(OWNER, { name: 'Morning post', day: '2032-05-31', time: '23:50', mainText: 'New mugs; two colours.' });
  const wholeDay = await make(OWNER, { name: '', day: '2032-05-01' });
  await make(OWNER, { name: 'An idea' });
  await make(OWNER, { name: 'Next month', day: '2032-06-01' });
  await make(OWNER, { name: 'Last month', day: '2032-04-30' });
  await make(OTHER, { name: 'Not yours', day: '2032-05-10' });

  const made = await calendarExport.POST(jsonPost('/api/export/calendar', { month: '2032-05' }));
  assert.equal(made.status, 200);
  const { address } = await made.json();
  assert.match(address, ADDRESS);
  const files = await unpacked(address);
  assert.deepEqual(files.map((file) => file.name), [t('calendar.export.fileName', locale, { month: '2032-05' })]);
  const text = new TextDecoder().decode(files[0].bytes);
  const lines = unfolded(text);
  assert.ok(lines.includes('X-WR-CALNAME:Lale\\, Ceramics'), 'the business names the calendar');
  const uids = lines.filter((line) => line.startsWith('UID:'));
  // Each event's identity carries this copy's mark, the same on every event of the file.
  const tag = /^UID:post-\d+-([0-9a-f]{8})@marketing-planner\.invalid$/u.exec(uids[0] ?? '')?.[1];
  assert.ok(tag, uids[0]);
  assert.deepEqual(uids, [`UID:post-${wholeDay.id}-${tag}@marketing-planner.invalid`, `UID:post-${timed.id}-${tag}@marketing-planner.invalid`], 'by day, the owner’s month only');
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20320501'));
  assert.ok(lines.includes(`SUMMARY:${t('post.untitled', locale)}`));
  assert.ok(lines.includes('DTSTART:20320531T235000') && lines.includes('DTEND:20320601T000500'));
  assert.ok(lines.includes('DESCRIPTION:New mugs\\; two colours.'));
  assert.equal(text.includes('Not yours') || text.includes('An idea') || text.includes('Next month') || text.includes('Last month'), false);

  const empty = await calendarExport.POST(jsonPost('/api/export/calendar', { month: '2032-07' }));
  assert.deepEqual([empty.status, await empty.json()], [400, { problem: 'calendar.export.empty' }]);
  await make(OTHER, { name: 'Theirs only', day: '2032-08-08' });
  await make(OWNER, { name: 'An idea in August' });
  const theirsOnly = await calendarExport.POST(jsonPost('/api/export/calendar', { month: '2032-08' }));
  assert.deepEqual(await theirsOnly.json(), { problem: 'calendar.export.empty' }, 'another owner’s posts are never counted');
  for (const month of ['2032-5', '2032-13', '2032-05-01', 203205, null, undefined]) {
    const refused = await calendarExport.POST(jsonPost('/api/export/calendar', { month }));
    assert.deepEqual([refused.status, await refused.json()], [400, { problem: 'refuse.request' }], String(month));
  }
  const notJson = await calendarExport.POST(new Request('http://app.test/api/export/calendar', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"month":"2032-05"}' }));
  assert.equal(notJson.status, 400);
});

test('Add to my calendar at a month’s most posts with the longest words stays inside Tellop’s records bounds, one call at a time', async (t) => {
  const month = '2033-01';
  const at = stamp();
  const two = (n) => String(n).padStart(2, '0');
  await modelAction('Post', 'createMany', {
    data: Array.from({ length: 256 }, (_, index) => ({
      ownerId: OWNER, name: 'ş'.repeat(LIMITS.name), mainText: 'ğ'.repeat(LIMITS.mainText), day: `${month}-${two((index % 31) + 1)}`,
      time: index % 2 ? '09:00' : null, createdAt: at, updatedAt: at,
    })),
  });
  const run = await withTellopFiles(() => measured(() => calendarExport.POST(jsonPost('/api/export/calendar', { month }))));
  assert.equal(run.value.status, 200);
  bounded(run, 'Add to my calendar at its largest', 12);
  assert.equal(mostInFlight(run), 1, 'one call at a time');
  assert.ok(run.calls.every((call) => /^(Post\.findMany|Profile\.findUnique)$/u.test(call.what)), run.calls.map((call) => call.what).join(' | '));
  t.diagnostic(`Add to my calendar: ${run.calls.length} calls, largest ${largestCall(run)} bytes`);
});

test('the download names: a zip and the file inside it, in both languages, the calendar’s the same in both', () => {
  const month = '2029-01';
  assert.deepEqual(['en', 'tr'].map((locale) => t('export.zipName', locale, { month })), ['customers-2029-01.zip', 'musteriler-2029-01.zip']);
  assert.deepEqual(['en', 'tr'].map((locale) => t('export.fileName', locale, { month })), ['customers-2029-01.csv', 'musteriler-2029-01.csv']);
  assert.deepEqual(['en', 'tr'].map((locale) => t('results.export.zipName', locale, { month })), ['posts-2029-01.zip', 'paylasimlar-2029-01.zip']);
  assert.deepEqual(['en', 'tr'].map((locale) => t('results.export.fileName', locale, { month })), ['posts-2029-01.csv', 'paylasimlar-2029-01.csv']);
  assert.deepEqual(['en', 'tr'].map((locale) => t('calendar.export.fileName', locale, { month })), ['plan-2029-01.ics', 'plan-2029-01.ics']);
  assert.deepEqual(['en', 'tr'].map((locale) => t('calendar.export.zipName', locale, { month })), ['plan-2029-01.zip', 'plan-2029-01.zip']);
  for (const locale of ['en', 'tr']) assert.notEqual(t('calendar.export.empty', locale), 'calendar.export.empty');
});
