/**
 * Customers: the people who came and what customers said, against a throwaway
 * store (`APP_DATA_FILE` in a temporary folder, removed afterwards). Records
 * functions and their addresses, each refusal at its edge and one each side,
 * the owner condition on every read, change and removal, the month's totals at
 * the month's first and last day, the screenshot through the kept-file rules
 * and the spreadsheet file's formula guard. Nothing reaches the network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'customers-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction, DataError } = await import('../lib/data/index.js');
const { keepFile } = await import('../lib/data/files.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { getLocale, t } = await import('../lib/i18n/index.js');
const customers = await import('../lib/data/customers.js');
const enquiriesRoute = await import('../app/api/enquiries/route.js');
const enquiryRoute = await import('../app/api/enquiries/[id]/route.js');
const commentsRoute = await import('../app/api/comments/route.js');
const commentRoute = await import('../app/api/comments/[id]/route.js');
const screenshotRoute = await import('../app/api/comments/[id]/screenshot/route.js');
const exportRoute = await import('../app/api/export/enquiries/route.js');
const downloadsRoute = await import('../app/api/downloads/route.js');
const { unzipStored } = await import('../lib/plan/zip.js');

const OTHER = 'someone-else';
const NOW = () => new Date('2026-10-21T09:00:00.000Z');
/** A 1 by 1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/** @param {string} key */
async function refusedWith(promise, key) {
  await assert.rejects(promise, (error) => error instanceof DataError && error.messageKey === key);
}

async function keep(bytes) {
  return (await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body: bytes }))).file;
}

async function addPost(owner, name, day = '2026-10-05') {
  const at = NOW().toISOString();
  const row = await modelAction('Post', 'create', { data: { ownerId: owner, name, day, createdAt: at, updatedAt: at } });
  return Number(row.id);
}

const jsonRequest = (method, body, address = 'http://app.test/api') =>
  new Request(address, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id: String(id) }) });

/* ---------------------------------------------------------------- enquiries */

test('an enquiry is saved with its defaults and read back only by its owner', async () => {
  const added = await customers.addEnquiryFor(OWNER, { name: '  Ayşe K. ', contact: '0532 000 00 00 or ayse@x', askedAbout: 'Saturday class' }, { now: NOW, today: '2026-10-21' });
  assert.equal(added.name, 'Ayşe K.');
  assert.equal(added.contact, '0532 000 00 00 or ayse@x');
  assert.equal(added.channel, 'other');
  assert.equal(added.status, 'new');
  assert.equal(added.amount, null);
  assert.equal(added.postId, null);
  assert.equal(added.receivedOn, '2026-10-21');
  assert.equal(added.createdAt, NOW().toISOString());

  assert.equal((await customers.getEnquiryFor(OTHER, added.id)), null);
  assert.equal((await customers.updateEnquiryFor(OTHER, added.id, { status: 'bought' })), null);
  assert.equal((await customers.removeEnquiryFor(OTHER, added.id)), false);
  assert.deepEqual(await customers.listEnquiriesFor(OTHER, '2026-10'), { items: [], next: null });
  assert.equal((await customers.getEnquiryFor(OWNER, added.id))?.status, 'new');

  const changed = await customers.updateEnquiryFor(OWNER, added.id, { status: 'talking', notes: 'line one\nline two' });
  assert.equal(changed?.status, 'talking');
  assert.equal(changed?.notes, 'line one\nline two');
  assert.equal(changed?.name, 'Ayşe K.', 'a change keeps the fields it was not sent');
  assert.equal(await customers.removeEnquiryFor(OWNER, added.id), true);
  assert.equal(await customers.getEnquiryFor(OWNER, added.id), null);
});

test('an enquiry needs a name, and each field is refused with its own words', async () => {
  await refusedWith(customers.addEnquiryFor(OWNER, {}), 'refuse.customers.name');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: '   ' }), 'refuse.customers.name');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'x'.repeat(LIMITS.name + 1) }), 'refuse.customers.name');
  assert.equal((await customers.addEnquiryFor(OWNER, { name: 'x'.repeat(LIMITS.name), receivedOn: '2025-01-01' })).name.length, LIMITS.name);
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'A', contact: 'c'.repeat(LIMITS.profileField + 1) }), 'refuse.customers.contact');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'A', notes: 'n'.repeat(LIMITS.notes + 1) }), 'refuse.customers.notes');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'A', status: 'maybe' }), 'refuse.customers.status');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'A', receivedOn: '2026-02-30' }), 'refuse.customers.day');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'A', receivedOn: '21.10.2026' }), 'refuse.customers.day');
});

test('where they came from is a network or one of the other places', async () => {
  for (const channel of ['instagram', 'tiktok', 'google', 'word', 'website', 'walk-in', 'other']) {
    assert.equal((await customers.addEnquiryFor(OWNER, { name: 'C', channel, receivedOn: '2025-02-01' })).channel, channel);
  }
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'C', channel: 'fax' }), 'refuse.customers.channel');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'C', channel: 'Instagram' }), 'refuse.customers.channel');
});

test('an amount is a whole number from 0 to the most, or empty', async () => {
  const base = { name: 'Amount', receivedOn: '2025-03-01' };
  await refusedWith(customers.addEnquiryFor(OWNER, { ...base, amount: -1 }), 'refuse.customers.amount');
  assert.equal((await customers.addEnquiryFor(OWNER, { ...base, amount: 0 })).amount, 0);
  assert.equal((await customers.addEnquiryFor(OWNER, { ...base, amount: 1 })).amount, 1);
  assert.equal((await customers.addEnquiryFor(OWNER, { ...base, amount: LIMITS.amount })).amount, LIMITS.amount);
  await refusedWith(customers.addEnquiryFor(OWNER, { ...base, amount: LIMITS.amount + 1 }), 'refuse.customers.amount');
  await refusedWith(customers.addEnquiryFor(OWNER, { ...base, amount: 12.5 }), 'refuse.customers.amount');
  await refusedWith(customers.addEnquiryFor(OWNER, { ...base, amount: '150' }), 'refuse.customers.amount');
  assert.equal((await customers.addEnquiryFor(OWNER, { ...base, amount: '' })).amount, null);
  const cleared = await customers.addEnquiryFor(OWNER, { ...base, amount: 40 });
  assert.equal((await customers.updateEnquiryFor(OWNER, cleared.id, { amount: null }))?.amount, null);
});

test('the post that brought them must be one of the owner’s posts', async () => {
  const mine = await addPost(OWNER, 'Paint your own mug');
  const theirs = await addPost(OTHER, 'Not yours');
  const added = await customers.addEnquiryFor(OWNER, { name: 'P', postId: mine, receivedOn: '2025-04-01' });
  assert.equal(added.postId, mine);
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'P', postId: theirs }), 'refuse.customers.post');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'P', postId: 999999 }), 'refuse.customers.post');
  await refusedWith(customers.addEnquiryFor(OWNER, { name: 'P', postId: 'abc' }), 'refuse.customers.post');
  await refusedWith(customers.updateEnquiryFor(OWNER, added.id, { postId: theirs }), 'refuse.customers.post');
  assert.equal((await customers.updateEnquiryFor(OWNER, added.id, { postId: null }))?.postId, null);
  assert.deepEqual(await customers.postNamesFor(OWNER, [mine, theirs]), { [mine]: 'Paint your own mug' });
});

test('the month’s totals count its first and last day and nothing either side', async () => {
  const month = '2027-03';
  const add = (fields) => customers.addEnquiryFor(OWNER, { name: 'T', ...fields });
  await add({ receivedOn: '2027-02-28', status: 'bought', amount: 1000, channel: 'instagram' });
  await add({ receivedOn: '2027-03-01', status: 'bought', amount: 150, channel: 'instagram' });
  await add({ receivedOn: '2027-03-01', status: 'new', amount: 999, channel: 'word' });
  await add({ receivedOn: '2027-03-15', status: 'bought', channel: 'word' });
  await add({ receivedOn: '2027-03-31', status: 'bought', amount: 50, channel: 'walk-in' });
  await add({ receivedOn: '2027-04-01', status: 'bought', amount: 1000, channel: 'instagram' });
  await customers.addEnquiryFor(OTHER, { name: 'T', receivedOn: '2027-03-10', status: 'bought', amount: 5000, channel: 'instagram' });

  const totals = await customers.enquiryTotalsFor(OWNER, month);
  assert.deepEqual(totals, { count: 4, bought: 3, amount: 200, byChannel: { instagram: 1, word: 2, 'walk-in': 1 } });
  const { items: list, next } = await customers.listEnquiriesFor(OWNER, month);
  assert.deepEqual(list.map((enquiry) => enquiry.receivedOn), ['2027-03-31', '2027-03-15', '2027-03-01', '2027-03-01']);
  assert.equal(next, null, 'nothing left');
  assert.ok(list[2].id > list[3].id, 'the same day lists the newest first');
  const firstTwo = await customers.listEnquiriesFor(OWNER, month, { take: 2 });
  assert.deepEqual(firstTwo.items.map((item) => item.id), list.slice(0, 2).map((item) => item.id));
  const lastTwo = await customers.listEnquiriesFor(OWNER, month, { take: 2, after: firstTwo.next });
  assert.deepEqual(lastTwo.items.map((item) => item.id), list.slice(2).map((item) => item.id), 'the page after starts after the last one, inside a day too');
  assert.equal(lastTwo.next, null, 'exactly the last ones: nothing left');
  assert.deepEqual(await customers.enquiryTotalsFor(OWNER, '2027-05'), { count: 0, bought: 0, amount: 0, byChannel: {} });
  await refusedWith(customers.enquiryTotalsFor(OWNER, '2027-13'), 'refuse.customers.month');

  const span = await customers.listEnquiriesBetweenFor(OWNER, '2027-03-31', '2027-04-01');
  assert.deepEqual(span.map((enquiry) => enquiry.receivedOn), ['2027-04-01', '2027-03-31'], 'both days of a span are included');
  await refusedWith(customers.listEnquiriesBetweenFor(OWNER, '2027-04-02', '2027-04-01'), 'refuse.customers.span');
});

test('the posts that brought customers are counted per post, the owner’s only', async () => {
  const first = await addPost(OWNER, 'First');
  const second = await addPost(OWNER, 'Second');
  const quiet = await addPost(OWNER, 'Quiet');
  await customers.addEnquiryFor(OWNER, { name: 'A', postId: first, receivedOn: '2025-05-01' });
  await customers.addEnquiryFor(OWNER, { name: 'B', postId: first, receivedOn: '2025-05-02' });
  await customers.addEnquiryFor(OWNER, { name: 'C', postId: second, receivedOn: '2025-05-03' });
  assert.deepEqual(await customers.enquiriesByPostFor(OWNER, [first, second, quiet]), { [first]: 2, [second]: 1 });
  assert.deepEqual(await customers.enquiriesByPostFor(OTHER, [first, second]), {});
  assert.deepEqual(await customers.enquiriesByPostFor(OWNER, []), {});

  // Asked about in groups of 256: the last of the most posts is still counted; one more is refused.
  const many = Array.from({ length: customers.MOST_POST_IDS - 1 }, (_, index) => 900000 + index);
  assert.deepEqual(await customers.enquiriesByPostFor(OWNER, [...many, second]), { [second]: 1 });
  assert.deepEqual(await customers.enquiriesByPostFor(OWNER, [...many.slice(0, 256), first, ...many.slice(256, 300)]), { [first]: 2 });
  await refusedWith(customers.enquiriesByPostFor(OWNER, [...many, second, first]), 'refuse.long');
});

/* ----------------------------------------------------------------- comments */

test('a comment needs its words; stars are 1 to 5 or none', async () => {
  await refusedWith(customers.addCommentFor(OWNER, { name: 'Ayşe' }), 'refuse.customers.comment');
  await refusedWith(customers.addCommentFor(OWNER, { text: 'x'.repeat(LIMITS.comment + 1) }), 'refuse.customers.comment');
  assert.equal((await customers.addCommentFor(OWNER, { text: 'x'.repeat(LIMITS.comment) })).text.length, LIMITS.comment);
  await refusedWith(customers.addCommentFor(OWNER, { text: 'Lovely', stars: 0 }), 'refuse.customers.stars');
  assert.equal((await customers.addCommentFor(OWNER, { text: 'Lovely', stars: 1 })).stars, 1);
  assert.equal((await customers.addCommentFor(OWNER, { text: 'Lovely', stars: 5 })).stars, 5);
  await refusedWith(customers.addCommentFor(OWNER, { text: 'Lovely', stars: 6 }), 'refuse.customers.stars');
  assert.equal((await customers.addCommentFor(OWNER, { text: 'Lovely', stars: '' })).stars, null);
  await refusedWith(customers.addCommentFor(OWNER, { text: 'Lovely', permission: 'maybe' }), 'refuse.customers.permission');
  await refusedWith(customers.addCommentFor(OWNER, { text: 'Lovely', source: 'fax' }), 'refuse.customers.source');
  await refusedWith(customers.addCommentFor(OWNER, { text: 'Lovely', bestLine: 'b'.repeat(LIMITS.bestLine + 1) }), 'refuse.customers.bestLine');
  const sources = ['instagram', 'whatsapp', 'google', 'email', 'in-person', 'other', 'linkedin'];
  for (const source of sources) assert.equal((await customers.addCommentFor(OWNER, { text: 'S', source })).source, source);
});

test('a comment is read, changed and removed only by its owner', async () => {
  const added = await customers.addCommentFor(OWNER, { name: 'Ayşe K.', text: 'The nicest Saturday.\nWe will be back.', bestLine: 'The nicest Saturday', stars: 5, permission: 'yes' }, { now: NOW, today: '2026-10-12' });
  assert.equal(added.text, 'The nicest Saturday.\nWe will be back.');
  assert.equal(added.receivedOn, '2026-10-12');
  assert.equal(added.source, 'other');
  assert.equal(added.screenshot, null);
  assert.equal(await customers.getCommentFor(OTHER, added.id), null);
  assert.equal(await customers.updateCommentFor(OTHER, added.id, { permission: 'no' }), null);
  assert.equal(await customers.removeCommentFor(OTHER, added.id), false);
  assert.deepEqual(await customers.listCommentsFor(OTHER), { items: [], next: null });
  assert.equal((await customers.updateCommentFor(OWNER, added.id, { permission: 'asked' }))?.permission, 'asked');
  assert.equal((await customers.getCommentFor(OWNER, added.id))?.bestLine, 'The nicest Saturday');
  assert.equal(await customers.removeCommentFor(OWNER, added.id), true);
  assert.equal(await customers.getCommentFor(OWNER, added.id), null);
});

test('a screenshot is a kept picture: kept, kept again on a change, removed only on Remove', async () => {
  const picture = await keep(PNG);
  const added = await customers.addCommentFor(OWNER, { text: 'With a picture', screenshot: picture });
  assert.equal(added.screenshot, picture.slice(0, 12), 'the summary carries a tag, never the digest');
  assert.equal(await customers.screenshotFileFor(OWNER, added.id), picture);
  assert.equal(await customers.screenshotFileFor(OTHER, added.id), null);

  const kept = await customers.updateCommentFor(OWNER, added.id, { bestLine: 'Still here' });
  assert.equal(kept?.screenshot, picture.slice(0, 12), 'a change that does not touch the picture keeps it');
  const removed = await customers.updateCommentFor(OWNER, added.id, { screenshot: 'remove' });
  assert.equal(removed?.screenshot, null);

  await refusedWith(customers.addCommentFor(OWNER, { text: 'x', screenshot: 'f'.repeat(64) }), 'error.fileMissing');
  await refusedWith(customers.addCommentFor(OWNER, { text: 'x', screenshot: 'not a digest' }), 'error.fileNotKept');
  const words = await keep(new TextEncoder().encode('plain words, not a picture'));
  await refusedWith(customers.addCommentFor(OWNER, { text: 'x', screenshot: words }), 'error.pictureType');
});

/* --------------------------------------------------------------- addresses */

test('the enquiry addresses refuse with keys and answer only the owner’s records', async () => {
  const wrongType = await enquiriesRoute.POST(new Request('http://app.test/api/enquiries', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"A"}' }));
  assert.equal(wrongType.status, 400);
  assert.deepEqual(await wrongType.json(), { problem: 'refuse.request' });

  const badChannel = await enquiriesRoute.POST(jsonRequest('POST', { name: 'A', channel: 'fax' }));
  assert.equal(badChannel.status, 400);
  assert.deepEqual(await badChannel.json(), { problem: 'refuse.customers.channel' });

  const created = await enquiriesRoute.POST(jsonRequest('POST', { name: 'Route person', receivedOn: '2028-06-15', status: 'bought', amount: 300, channel: 'website' }));
  assert.equal(created.status, 200);
  const { enquiry } = await created.json();
  assert.equal(enquiry.name, 'Route person');

  const month = await enquiriesRoute.GET(new Request('http://app.test/api/enquiries?month=2028-06'));
  const listed = await month.json();
  assert.deepEqual(listed.items.map((item) => item.id), [enquiry.id]);
  assert.equal(listed.next, null);
  assert.deepEqual(listed.totals, { count: 1, bought: 1, amount: 300, byChannel: { website: 1 } });
  for (const after of ['nope', '2028-06-15', '2028-13-01.5', '2028-06-15.0', '2028-06-15.1x']) {
    const refusedPage = await enquiriesRoute.GET(new Request(`http://app.test/api/enquiries?month=2028-06&after=${encodeURIComponent(after)}`));
    assert.deepEqual([refusedPage.status, await refusedPage.json()], [400, { problem: 'refuse.request' }], after);
  }
  const badMonth = await enquiriesRoute.GET(new Request('http://app.test/api/enquiries?month=2028-6'));
  assert.equal(badMonth.status, 400);
  assert.deepEqual(await badMonth.json(), { problem: 'refuse.customers.month' });

  const changed = await enquiryRoute.PATCH(jsonRequest('PATCH', { status: 'not-now' }), context(enquiry.id));
  assert.equal((await changed.json()).enquiry.status, 'not-now');
  const refusedChange = await enquiryRoute.PATCH(jsonRequest('PATCH', { amount: -5 }), context(enquiry.id));
  assert.deepEqual(await refusedChange.json(), { problem: 'refuse.customers.amount' });

  const theirs = await customers.addEnquiryFor(OTHER, { name: 'Not yours' });
  assert.equal((await enquiryRoute.GET(new Request('http://app.test/x'), context(theirs.id))).status, 404);
  assert.equal((await enquiryRoute.PATCH(jsonRequest('PATCH', { name: 'Mine now' }), context(theirs.id))).status, 404);
  assert.equal((await enquiryRoute.DELETE(new Request('http://app.test/x', { method: 'DELETE' }), context(theirs.id))).status, 404);
  assert.equal((await customers.getEnquiryFor(OTHER, theirs.id))?.name, 'Not yours');
  assert.equal((await enquiryRoute.GET(new Request('http://app.test/x'), context('12abc'))).status, 404);

  assert.deepEqual(await (await enquiryRoute.DELETE(new Request('http://app.test/x', { method: 'DELETE' }), context(enquiry.id))).json(), { ok: true });
  assert.equal((await enquiryRoute.DELETE(new Request('http://app.test/x', { method: 'DELETE' }), context(enquiry.id))).status, 404);
});

test('the comment addresses keep the screenshot rules and the owner condition', async () => {
  const picture = await keep(PNG);
  const created = await commentsRoute.POST(jsonRequest('POST', { text: 'Loved it', name: 'Mert', stars: 4, permission: 'yes', screenshot: picture }));
  assert.equal(created.status, 200);
  const { comment } = await created.json();
  assert.equal(comment.screenshot, picture.slice(0, 12));
  assert.equal(JSON.stringify(comment).includes(picture), false, 'the digest never leaves in an answer');

  const shown = await screenshotRoute.GET(new Request(`http://app.test/api/comments/${comment.id}/screenshot`), context(comment.id));
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('content-type'), 'image/png');
  const download = await screenshotRoute.GET(new Request(`http://app.test/api/comments/${comment.id}/screenshot?download=1`), context(comment.id));
  assert.match(download.headers.get('content-disposition') ?? '', /attachment/u);

  const theirs = await customers.addCommentFor(OTHER, { text: 'Not yours', screenshot: picture });
  assert.equal((await screenshotRoute.GET(new Request('http://app.test/x'), context(theirs.id))).status, 404);
  assert.equal((await commentRoute.GET(new Request('http://app.test/x'), context(theirs.id))).status, 404);
  assert.equal((await commentRoute.PATCH(jsonRequest('PATCH', { text: 'Mine now' }), context(theirs.id))).status, 404);
  assert.equal((await commentRoute.DELETE(new Request('http://app.test/x', { method: 'DELETE' }), context(theirs.id))).status, 404);
  assert.equal((await customers.getCommentFor(OTHER, theirs.id))?.text, 'Not yours');

  const refusedStars = await commentRoute.PATCH(jsonRequest('PATCH', { stars: 6 }), context(comment.id));
  assert.deepEqual(await refusedStars.json(), { problem: 'refuse.customers.stars' });
  const removed = await commentRoute.PATCH(jsonRequest('PATCH', { screenshot: 'remove' }), context(comment.id));
  assert.equal((await removed.json()).comment.screenshot, null);
  assert.equal((await screenshotRoute.GET(new Request('http://app.test/x'), context(comment.id))).status, 404);

  const listed = await (await commentsRoute.GET(new Request('http://app.test/api/comments'))).json();
  assert.ok(listed.items.length > 0 && listed.items.every((item) => item.text !== 'Not yours'));
  const badPage = await commentsRoute.GET(new Request('http://app.test/api/comments?after=1'));
  assert.deepEqual([badPage.status, await badPage.json()], [400, { problem: 'refuse.request' }]);
});

test('the spreadsheet file guards formulas, uses the app’s words and hands over only itself', async () => {
  const locale = getLocale();
  await customers.addEnquiryFor(OWNER, { name: '=HYPERLINK("https://x.invalid","press")', contact: '+90 532', askedAbout: '@everyone', receivedOn: '2029-01-05', status: 'bought', amount: 120, channel: 'walk-in' });
  await customers.addEnquiryFor(OWNER, { name: 'Plain, with a comma', receivedOn: '2029-01-31' });
  await customers.addEnquiryFor(OWNER, { name: 'Outside the span', receivedOn: '2029-02-01' });
  await customers.addEnquiryFor(OTHER, { name: 'Not yours', receivedOn: '2029-01-10' });

  const made = await exportRoute.POST(jsonRequest('POST', { from: '2029-01-01', to: '2029-01-31' }));
  assert.equal(made.status, 200);
  const { address } = await made.json();
  assert.match(address, /^\/api\/downloads\?file=[0-9a-f]{64}$/u);
  const handed = await downloadsRoute.GET(new Request(`http://app.test${address}`));
  assert.equal(handed.status, 200);
  assert.match(handed.headers.get('content-disposition') ?? '', /attachment/u);
  const [csv, ...more] = unzipStored(new Uint8Array(await handed.arrayBuffer()));
  assert.deepEqual([csv.name, more.length], [t('export.fileName', locale, { month: '2029-01' }), 0], 'a zip holding the one file');
  const text = new TextDecoder().decode(csv.bytes);
  const lines = text.replace(/^﻿/u, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3, 'headings and the two rows of the span, the owner’s only');
  assert.equal(lines[0].split(',')[0], t('export.enquiries.day', locale));
  assert.ok(lines[1].startsWith('2029-01-05,"\'=HYPERLINK('), lines[1]);
  assert.ok(lines[1].includes(`,'+90 532,`), 'a contact starting with + is guarded');
  assert.ok(lines[1].includes(`,'@everyone,`), 'words starting with @ are guarded');
  assert.ok(lines[1].includes(`,${t('customers.status.bought', locale)},120,`));
  assert.ok(lines[2].includes('"Plain, with a comma"'));
  assert.equal(text.includes('Not yours') || text.includes('Outside the span'), false);

  const picture = await keep(PNG);
  assert.equal((await downloadsRoute.GET(new Request(`http://app.test/api/downloads?file=${picture}`))).status, 404, 'a kept picture is not handed over here');
  assert.equal((await downloadsRoute.GET(new Request('http://app.test/api/downloads?file=../app.db'))).status, 404);
  assert.equal((await downloadsRoute.GET(new Request(`http://app.test/api/downloads?file=${'0'.repeat(64)}`))).status, 404);

  const backwards = await exportRoute.POST(jsonRequest('POST', { from: '2029-02-01', to: '2029-01-31' }));
  assert.deepEqual(await backwards.json(), { problem: 'refuse.customers.span' });
  const notDays = await exportRoute.POST(jsonRequest('POST', { from: '2029-01', to: '2029-01-31' }));
  assert.deepEqual(await notDays.json(), { problem: 'refuse.customers.span' });
});

/* ---------------------------------------------------------- Tellop's bounds */

/**
 * Inside Tellop every records call goes through its records route: at most
 * 256 rows a statement, 256 KiB a call (a `modelBatch` counted whole), 2,048
 * values in a statement's answer (a list counts one, a row its fields and two
 * more), 256 values in a list it is sent, 32 steps a batch and 16 calls a
 * request. The local store has none of these, so here the route's hook runs
 * each call on the local store and measures it.
 */
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

/** The longest words a field takes, in two-byte letters. */
const longest = (count) => 'ş'.repeat(count);

test('the largest lists with the longest words stay within Tellop\'s bounds: each read, the addresses and the page', async () => {
  const { getProfileFor } = await import('../lib/data/plan.js');
  const { addDays, todayCivil } = await import('../lib/plan/days.js');
  const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
  const { OWN_CHANNELS, ENQUIRY_STATUSES } = await import('../app/customers/choices.js');
  const at = NOW().toISOString();
  const channels = [...NETWORK_KEYS, ...OWN_CHANNELS];
  const month = '2031-05';
  const span = { from: '2031-07-01', to: '2031-07-31' };

  // Posts with the longest names: far from today (the most a names read asks about; the page reads their names), and on today.
  const post = (day) => ({ ownerId: OWNER, name: longest(LIMITS.name), day, createdAt: at, updatedAt: at });
  await modelAction('Post', 'createMany', { data: Array.from({ length: customers.MOST_POST_IDS }, () => post('2001-01-01')) });
  await modelAction('Post', 'createMany', { data: Array.from({ length: customers.MOST_CHOICES + 40 }, () => post(todayCivil())) });
  const far = (await modelAction('Post', 'findMany', { where: { ownerId: OWNER, day: '2001-01-01' }, orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id);

  // More enquiries than one list answers, each naming its own post, on few days (pages end inside a day).
  const enquiry = (index, receivedOn, postId) => ({
    ownerId: OWNER, name: longest(LIMITS.name), contact: longest(LIMITS.profileField), askedAbout: longest(LIMITS.profileField),
    notes: longest(LIMITS.notes), channel: channels[index % channels.length], status: ENQUIRY_STATUSES[index % ENQUIRY_STATUSES.length],
    amount: LIMITS.amount, postId, receivedOn, createdAt: at, updatedAt: at,
  });
  const monthDays = [`${month}-01`, `${month}-15`, `${month}-31`];
  await modelAction('Enquiry', 'createMany', {
    data: Array.from({ length: customers.LIST_ROWS + 30 }, (_, index) => enquiry(index, monthDays[index % 3], far[index])),
  });
  await modelAction('Enquiry', 'createMany', {
    data: [enquiry(0, '2031-04-30', null), enquiry(1, '2031-06-01', null), { ...enquiry(2, `${month}-10`, null), ownerId: OTHER }],
  });
  await modelAction('Enquiry', 'createMany', {
    data: Array.from({ length: customers.MOST_ROWS + 20 }, (_, index) =>
      enquiry(index, `2031-07-${String((index % 31) + 1).padStart(2, '0')}`, far[customers.LIST_ROWS + 30 + index])),
  });

  // More comments than one list answers, with the longest words and a screenshot each.
  await modelAction('CustomerComment', 'createMany', {
    data: Array.from({ length: 2 * customers.LIST_PAGE + 62 }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), text: longest(LIMITS.comment), bestLine: longest(LIMITS.bestLine), stars: 5,
      source: 'in-person', receivedOn: `2031-0${(index % 4) + 1}-01`, permission: 'not-asked', permissionNote: longest(LIMITS.profileField),
      screenshotFile: 'f'.repeat(64), createdAt: at, updatedAt: at,
    })),
  });

  /** The ids a list should answer: every match, newest day first, then the newest. */
  const expected = async (model, where, count) => (await modelAction(model, 'findMany', {
    where, orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }], select: { id: true }, take: count,
  })).map((row) => row.id);

  // Every page of a list, each read as one request ("Show more"), reaches every item once, in order.
  const allPages = async (read, what) => {
    const items = [];
    let after = null;
    for (let page = 0; page < 10; page += 1) {
      const run = await measured(() => read(after));
      bounded(run, `${what}, page ${page + 1}`, 3);
      assert.ok(mostInFlight(run) <= 1, `${what}: one call at a time`);
      assert.ok(run.value.items.length <= customers.LIST_PAGE);
      items.push(...run.value.items);
      after = run.value.next;
      if (after === null) return items;
      assert.equal(run.value.items.length, customers.LIST_PAGE, `${what}: a page with more after it is full`);
    }
    throw new Error(`${what}: never ended`);
  };
  const monthItems = await allPages((after) => customers.listEnquiriesFor(OWNER, month, { after }), 'a month of enquiries');
  assert.deepEqual(monthItems.map((item) => item.id), await expected('Enquiry', { ownerId: OWNER, receivedOn: { gte: `${month}-01`, lt: '2031-06-01' } }, 1000));
  assert.equal(monthItems.length, customers.LIST_ROWS + 30);
  assert.equal(monthItems[0].notes, longest(LIMITS.notes));

  const commentItems = await allPages((after) => customers.listCommentsFor(OWNER, { after }), 'the comments');
  assert.deepEqual(commentItems.map((item) => item.id), await expected('CustomerComment', { ownerId: OWNER }, 1000));
  assert.ok(commentItems.length >= 2 * customers.LIST_PAGE + 62, 'three pages at least (earlier checks keep comments too)');
  assert.ok(commentItems.filter((item) => item.text === longest(LIMITS.comment)).length === 2 * customers.LIST_PAGE + 62, 'the longest words came back whole');

  // The spreadsheet file reads what its address reads (its kept file is not a records call).
  const fileRead = await measured(async () => {
    const enquiries = await customers.listEnquiriesBetweenFor(OWNER, span.from, span.to, { take: customers.MOST_ROWS });
    return { enquiries, names: await customers.postNamesFor(OWNER, enquiries.map((item) => item.postId)) };
  });
  bounded(fileRead, 'the spreadsheet file', 15);
  assert.deepEqual(fileRead.value.enquiries.map((item) => item.id), await expected('Enquiry', { ownerId: OWNER, receivedOn: { gte: span.from, lte: span.to } }, customers.MOST_ROWS));
  assert.equal(Object.keys(fileRead.value.names).length, customers.MOST_ROWS);

  assert.equal(far.length, customers.MOST_POST_IDS);
  const brought = await measured(() => customers.enquiriesByPostFor(OWNER, far));
  bounded(brought, 'the posts that brought customers', 1);
  assert.equal(Object.keys(brought.value).length, customers.LIST_ROWS + 30 + customers.MOST_ROWS + 20);
  assert.ok(Object.values(brought.value).every((count) => count === 1));

  const names = await measured(() => customers.postNamesFor(OWNER, far));
  bounded(names, 'the most post names', 2);
  assert.equal(Object.keys(names.value).length, customers.MOST_POST_IDS);

  const choices = await measured(() => customers.postChoicesFor(OWNER, addDays(todayCivil(), -120), addDays(todayCivil(), 31), { take: customers.MOST_CHOICES + 1 }));
  bounded(choices, 'the post choices', 1);
  assert.equal(choices.value.length, customers.MOST_CHOICES);

  const totals = await measured(() => customers.enquiryTotalsFor(OWNER, month));
  bounded(totals, 'the month\'s totals', 1);
  assert.equal(totals.value.count, customers.LIST_ROWS + 30);

  // The addresses.
  const monthAddress = await measured(async () => (await enquiriesRoute.GET(new Request(`http://app.test/api/enquiries?month=${month}`))).json());
  bounded(monthAddress, 'GET /api/enquiries?month', 4);
  assert.equal(monthAddress.value.items.length, customers.LIST_PAGE);
  assert.equal(monthAddress.value.totals.count, customers.LIST_ROWS + 30);
  const nextAddress = await measured(async () => (await enquiriesRoute.GET(new Request(`http://app.test/api/enquiries?month=${month}&after=${monthAddress.value.next}`))).json());
  bounded(nextAddress, 'GET /api/enquiries?month&after', 3);
  assert.deepEqual(nextAddress.value.items.map((item) => item.id), monthItems.slice(customers.LIST_PAGE, 2 * customers.LIST_PAGE).map((item) => item.id));
  assert.equal(nextAddress.value.totals, undefined, 'the totals come with the first page');
  const spanAddress = await measured(async () => (await enquiriesRoute.GET(new Request(`http://app.test/api/enquiries?from=${span.from}&to=${span.to}`))).json());
  bounded(spanAddress, 'GET /api/enquiries?from&to', 4);
  assert.equal(spanAddress.value.enquiries.length, customers.LIST_ROWS);
  const commentsAddress = await measured(async () => (await commentsRoute.GET(new Request('http://app.test/api/comments'))).json());
  bounded(commentsAddress, 'GET /api/comments', 3);
  assert.equal(commentsAddress.value.items.length, customers.LIST_PAGE);
  const lastComments = await measured(async () => (await commentsRoute.GET(new Request(`http://app.test/api/comments?after=${encodeURIComponent(commentItems[2 * customers.LIST_PAGE - 1].receivedOn)}.${commentItems[2 * customers.LIST_PAGE - 1].id}`))).json());
  bounded(lastComments, 'GET /api/comments?after', 3);
  assert.deepEqual(lastComments.value.items.map((item) => item.id), commentItems.slice(2 * customers.LIST_PAGE).map((item) => item.id));
  assert.equal(lastComments.value.next, null);

  // The customers page reads what `app/customers/page.jsx` reads, in its order.
  const page = await measured(async () => {
    const today = todayCivil();
    await getProfileFor(OWNER);
    const { items: enquiries } = await customers.listEnquiriesFor(OWNER, month);
    await customers.enquiryTotalsFor(OWNER, month);
    await customers.listCommentsFor(OWNER);
    const offered = await customers.postChoicesFor(OWNER, addDays(today, -120), addDays(today, 31));
    const named = new Set(offered.map((item) => item.id));
    const missing = enquiries.map((item) => item.postId).filter((id) => id !== null && !named.has(id));
    return customers.postNamesFor(OWNER, missing);
  });
  bounded(page, 'the customers page', 11);
  assert.equal(Object.keys(page.value).length, customers.LIST_PAGE);
});

test('a card picture\'s kept copies go when its comment\'s words change, its permission leaves yes, or it goes', async () => {
  const posts = await import('../lib/data/posts.js');
  const digestOf = (n) => n.toString(16).padStart(64, '0');
  const said = await customers.addCommentFor(OWNER, { name: 'Ece', text: 'Lovely mugs', bestLine: 'Lovely', stars: 5, permission: 'yes' });
  const other = await customers.addCommentFor(OWNER, { name: 'Can', text: 'Great', permission: 'yes' });
  const post = await posts.createPostFor(OWNER, { name: 'Cards' });
  const card = await posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: said.id });
  const beside = await posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: other.id });
  const keep = async (picture, seed) => posts.updatePictureFor(OWNER, picture.id, { shapes: { square: digestOf(seed), portrait: digestOf(seed + 1) } });
  const copies = async (picture) => (await posts.getPostFor(OWNER, post.id)).pictures.find((item) => item.id === picture.id).shapes;
  await keep(card, 700);
  await keep(beside, 710);

  // A change that leaves the card as it was keeps the copies.
  await customers.updateCommentFor(OWNER, said.id, { permissionNote: 'Said yes on the phone', receivedOn: '2026-10-02' });
  assert.ok((await copies(card)).square !== null, 'the note and the day are not on the card');
  await customers.updateCommentFor(OWNER, said.id, { permission: 'yes' });
  assert.ok((await copies(card)).square !== null, 'still yes');
  for (const change of [{ text: 'Lovely mugs, really' }, { name: 'Ece K.' }, { bestLine: 'Really lovely' }, { stars: 4 }, { permission: 'no' }]) {
    await customers.updateCommentFor(OWNER, said.id, { permission: 'yes' });
    await keep(card, 720);
    await customers.updateCommentFor(OWNER, said.id, change);
    assert.deepEqual(Object.values(await copies(card)).filter((tag) => tag !== null), [], JSON.stringify(change));
  }
  assert.ok((await copies(beside)).square !== null, 'another comment\'s card keeps its copies');
  // Another owner's change touches nothing.
  assert.equal(await customers.updateCommentFor('another-owner', other.id, { permission: 'no' }), null);
  assert.ok((await copies(beside)).square !== null);
  assert.equal(await customers.removeCommentFor(OWNER, other.id), true);
  assert.deepEqual(Object.values(await copies(beside)).filter((tag) => tag !== null), [], 'a removed comment\'s card loses its copies');
  assert.equal((await posts.getPostFor(OWNER, post.id)).pictures.length, 2, 'the pictures stay');
});
