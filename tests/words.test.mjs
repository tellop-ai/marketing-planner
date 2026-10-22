/**
 * Ready words: records and addresses, checked against a throwaway store
 * (`APP_DATA_FILE` points at a temporary folder that is removed afterwards).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'words-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction, modelBatch } = await import('../lib/data/index.js');
const words = await import('../lib/data/words.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { OWNER } = await import('../lib/plan/owner.js');
const listRoute = await import('../app/api/ready-words/route.js');
const oneRoute = await import('../app/api/ready-words/[id]/route.js');

const OTHER = 'someone-else';
const NOW = '2026-10-21T09:00:00.000Z';

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/** @param {string} address @param {string} method @param {unknown} [body] @param {Record<string, string>} [headers] */
function sending(address, method, body, headers = {}) {
  return new Request(`http://localhost${address}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** @param {string | number} id */
const at = (id) => ({ params: Promise.resolve({ id: String(id) }) });

/** @param {Response} response */
async function answer(response) {
  return { status: response.status, body: await response.json() };
}

test('with no link ready word the link sentence is empty, then it is the first link by position', async () => {
  assert.equal(await words.linkSentenceFor(OWNER), '');
  await words.addReadyWordFor(OWNER, { kind: 'bio', title: 'Short bio', text: 'Hand-made pottery in Kadıköy.' });
  assert.equal(await words.linkSentenceFor(OWNER), '');
  const first = await words.addReadyWordFor(OWNER, { kind: 'link', title: 'Profile link', text: 'Booking link in our profile.' });
  await words.addReadyWordFor(OWNER, { kind: 'link', title: 'Other link', text: 'Second sentence.' });
  assert.equal(await words.linkSentenceFor(OWNER), 'Booking link in our profile.');
  await words.addReadyWordFor(OTHER, { kind: 'link', title: 'Theirs', text: 'Not this one.' });
  assert.equal(await words.linkSentenceFor(OWNER), 'Booking link in our profile.');
  assert.equal(await words.removeReadyWordFor(OWNER, first.id), true);
  assert.equal(await words.linkSentenceFor(OWNER), 'Second sentence.');
});

test('ready words are listed by position, each added last, and copies are counted one at a time', async () => {
  const listed = await answer(await listRoute.GET());
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.readyWords.map((item) => item.title), ['Short bio', 'Other link']);
  const positions = listed.body.readyWords.map((item) => item.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  const id = listed.body.readyWords[0].id;
  const copy = async (target) => answer(await oneRoute.POST(sending(`/api/ready-words/${target}`, 'POST', { action: 'copied' }), at(target)));
  assert.deepEqual(await copy(id), { status: 200, body: { copied: 1 } });
  assert.deepEqual(await copy(id), { status: 200, body: { copied: 2 } });
  assert.equal(await words.countCopyFor(OWNER, id), 3);
  assert.deepEqual((await answer(await oneRoute.POST(sending(`/api/ready-words/${id}`, 'POST', { action: 'shared' }), at(id)))).body, { problem: 'refuse.request' });
  assert.deepEqual((await answer(await oneRoute.POST(sending(`/api/ready-words/${id}`, 'POST', { action: 'copied', copied: 99 }), at(id)))).body, { problem: 'refuse.request' });
  assert.equal((await words.listReadyWordsFor(OWNER))[0].copied, 3);
});

test('POST /api/ready-words reads each field at its edges and names the field it refuses', async () => {
  const post = async (body, headers) => answer(await listRoute.POST(sending('/api/ready-words', 'POST', body, headers)));
  const made = await post({ kind: 'answer', title: 'Price', text: 'A class is 900 TL.\nMaterials included.' });
  assert.equal(made.status, 201);
  assert.equal(made.body.readyWord.text, 'A class is 900 TL.\nMaterials included.');
  assert.equal(made.body.readyWord.network, null);
  assert.equal(made.body.readyWord.copied, 0);

  assert.deepEqual((await post({ kind: 'answer', title: 'x', text: 'y' }, { 'content-type': 'text/plain' })).body, { problem: 'refuse.request' });
  for (const kind of ['poem', '', undefined, 3]) {
    assert.deepEqual((await post({ kind, title: 'x', text: 'y' })).body, { problem: 'refuse.request', field: 'kind' }, String(kind));
  }
  for (const kind of words.READY_WORD_KINDS) assert.equal((await post({ kind, title: kind, text: 'words' })).status, 201, kind);
  assert.deepEqual((await post({ kind: 'bio', text: 'y' })).body, { problem: 'refuse.text.missing', field: 'title' });
  assert.deepEqual((await post({ kind: 'bio', title: 'x', text: '  ' })).body, { problem: 'refuse.text.missing', field: 'text' });
  assert.equal((await post({ kind: 'bio', title: 't'.repeat(LIMITS.readyTitle), text: 'y' })).status, 201);
  assert.deepEqual((await post({ kind: 'bio', title: 't'.repeat(LIMITS.readyTitle + 1), text: 'y' })).body, { problem: 'refuse.text.long', field: 'title' });
  assert.equal((await post({ kind: 'bio', title: 'x', text: 'w'.repeat(LIMITS.readyWord) })).status, 201);
  assert.deepEqual((await post({ kind: 'bio', title: 'x', text: 'w'.repeat(LIMITS.readyWord + 1) })).body, { problem: 'refuse.text.long', field: 'text' });
  assert.equal((await post({ kind: 'hashtags', title: 'x', text: '#clay', network: 'instagram' })).body.readyWord.network, 'instagram');
  assert.deepEqual((await post({ kind: 'hashtags', title: 'x', text: '#clay', network: 'myspace' })).body, { problem: 'refuse.request', field: 'network' });
  assert.deepEqual((await post({ kind: 'bio', title: 'x', text: 'y', ownerId: OTHER })).body, { problem: 'refuse.request' });
  assert.equal((await words.listReadyWordsFor(OTHER)).length, 1);
});

test('a ready word is changed and removed only by its owner', async () => {
  const mine = (await words.listReadyWordsFor(OWNER))[0];
  const theirs = (await words.listReadyWordsFor(OTHER))[0];
  const patch = async (id, body) => answer(await oneRoute.PATCH(sending(`/api/ready-words/${id}`, 'PATCH', body), at(id)));
  const changed = await patch(mine.id, { title: 'New bio', text: 'Pottery classes for beginners.' });
  assert.equal(changed.status, 200);
  assert.deepEqual([changed.body.readyWord.title, changed.body.readyWord.text, changed.body.readyWord.kind], ['New bio', 'Pottery classes for beginners.', mine.kind]);
  assert.equal((await patch(mine.id, { kind: 'signature' })).body.readyWord.kind, 'signature');
  assert.deepEqual((await patch(mine.id, {})).body, { problem: 'refuse.request' });
  assert.deepEqual((await patch(mine.id, { title: '' })).body, { problem: 'refuse.text.missing', field: 'title' });
  assert.deepEqual((await patch(mine.id, { copied: 50 })).body, { problem: 'refuse.request' });

  assert.deepEqual(await patch(theirs.id, { title: 'Taken' }), { status: 404, body: { problem: 'error.notFound' } });
  const copyTheirs = await oneRoute.POST(sending(`/api/ready-words/${theirs.id}`, 'POST', { action: 'copied' }), at(theirs.id));
  assert.equal(copyTheirs.status, 404);
  assert.equal((await oneRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(theirs.id))).status, 404);
  const still = (await words.listReadyWordsFor(OTHER))[0];
  assert.deepEqual([still.title, still.copied], [theirs.title, 0]);
  for (const id of ['abc', '0', '-2', '1e3']) assert.equal((await oneRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(id))).status, 404);

  assert.deepEqual(await answer(await oneRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(mine.id))), { status: 200, body: { ok: true } });
  assert.equal((await oneRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(mine.id))).status, 404);
});

test('an owner keeps at most the ready word limit: one under and the limit are taken, one more is refused', async () => {
  const have = await modelAction('ReadyWord', 'count', { where: { ownerId: OWNER } });
  const fill = LIMITS.readyWords - 1 - have;
  for (let start = 0; start < fill; start += 32) {
    const steps = [];
    for (let index = start; index < Math.min(fill, start + 32); index += 1) {
      steps.push({ model: 'ReadyWord', action: 'create', args: { data: { ownerId: OWNER, kind: 'answer', title: `Answer ${index}`, text: 'Yes.', position: 1000 + index, createdAt: NOW, updatedAt: NOW } } });
    }
    await modelBatch(steps);
  }
  assert.equal(await modelAction('ReadyWord', 'count', { where: { ownerId: OWNER } }), LIMITS.readyWords - 1);
  const last = await words.addReadyWordFor(OWNER, { kind: 'offer', title: 'The last one', text: 'Ten percent off.' });
  assert.equal(last.position, 1000 + fill);
  await assert.rejects(
    () => words.addReadyWordFor(OWNER, { kind: 'offer', title: 'One more', text: 'No room.' }),
    (error) => error instanceof DataError && error.messageKey === 'refuse.words.limit',
  );
  const refused = await answer(await listRoute.POST(sending('/api/ready-words', 'POST', { kind: 'bio', title: 'x', text: 'y' })));
  assert.deepEqual(refused, { status: 400, body: { problem: 'refuse.words.limit' } });
  assert.equal(await modelAction('ReadyWord', 'count', { where: { ownerId: OWNER } }), LIMITS.readyWords);
  assert.equal((await words.listReadyWordsFor(OWNER)).length, LIMITS.readyWords);
  // Another owner's ready words do not count toward this owner's.
  assert.equal((await words.addReadyWordFor(OTHER, { kind: 'bio', title: 'Theirs', text: 'Fine.' })).title, 'Theirs');
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
const { bounded, measured } = await import('./records-bounds.mjs');

/** The longest words a field takes, in two-byte letters. */
const longest = (count) => 'ş'.repeat(count);

test('the most ready words with the longest words stay within Tellop\'s bounds: the list, the address and the page', async () => {
  const { getProfileFor } = await import('../lib/data/plan.js');
  // The check before left the most ready words; two more arrive at once (two presses), and every one holds the longest words.
  assert.equal(await modelAction('ReadyWord', 'count', { where: { ownerId: OWNER } }), LIMITS.readyWords);
  await modelAction('ReadyWord', 'createMany', {
    data: [0, 1].map((index) => ({ ownerId: OWNER, kind: 'answer', title: 'x', text: 'x', position: index, createdAt: NOW, updatedAt: NOW })),
  });
  await modelAction('ReadyWord', 'updateMany', {
    where: { ownerId: OWNER }, data: { kind: 'signature', title: longest(LIMITS.readyTitle), text: longest(LIMITS.readyWord), network: 'instagram', copied: 1000000 },
  });
  // Few positions, so pages end among ready words in one place.
  const ids = (await modelAction('ReadyWord', 'findMany', { where: { ownerId: OWNER }, orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id);
  for (let group = 0; group < 4; group += 1) {
    await modelAction('ReadyWord', 'updateMany', { where: { ownerId: OWNER, id: { in: ids.filter((_, index) => index % 4 === group) } }, data: { position: 3 - group } });
  }
  const expected = (await modelAction('ReadyWord', 'findMany', {
    where: { ownerId: OWNER }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true }, take: LIMITS.readyWords,
  })).map((row) => row.id);

  const list = await measured(() => words.listReadyWordsFor(OWNER));
  bounded(list, 'the ready words', 4);
  assert.deepEqual(list.value.map((item) => item.id), expected);
  assert.equal(list.value[0].text, longest(LIMITS.readyWord));

  const address = await measured(async () => (await listRoute.GET()).json());
  bounded(address, 'GET /api/ready-words', 4);
  assert.deepEqual(address.value.readyWords.map((item) => item.id), expected);

  // The Ready words page reads what `app/ready-words/page.jsx` reads, at the same moment.
  const page = await measured(() => Promise.all([getProfileFor(OWNER), words.listReadyWordsFor(OWNER)]));
  bounded(page, 'the Ready words page', 5);
  assert.equal(page.value[1].length, LIMITS.readyWords);

  const link = await measured(() => words.linkSentenceFor(OWNER));
  bounded(link, 'the link sentence', 1);
  const copied = await measured(() => words.countCopyFor(OWNER, expected[0]));
  bounded(copied, 'a copy counted', 2);
  assert.equal(copied.value, 1000001);
  const refused = await measured(() => assert.rejects(words.addReadyWordFor(OWNER, { kind: 'bio', title: 'x', text: 'y' }), (error) => error instanceof DataError));
  bounded(refused, 'a ready word past the most', 1);
});
