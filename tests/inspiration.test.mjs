/**
 * Inspiration notes on the Ideas page: the records functions (a link, a note,
 * a theme; newest first), their addresses, Make it a post idea, and Give me
 * ideas sending the newest notes to AI as content. A throwaway store
 * (`APP_DATA_FILE` in a temporary folder, removed afterwards); rows of another
 * owner are written straight into the store and must never be read, changed
 * or sent.
 *
 * No check calls AI or the network: a stand-in `fetch` answers as an AI
 * service does and records what was asked; a guard `fetch` fails any check
 * that would reach further.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'inspiration-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');
for (const name of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_MODEL_QUICK', 'AI_MODEL_STANDARD', 'AI_MODEL_BEST', 'AI_MODEL_PICTURE', 'TELLOP_INTERNAL_RECORDS']) {
  delete process.env[name];
}

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const inspiration = await import('../lib/data/inspiration.js');
const posts = await import('../lib/data/posts.js');
const words = await import('../lib/plan/ai-words.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const notesRoute = await import('../app/api/inspiration/route.js');
const noteRoute = await import('../app/api/inspiration/[id]/route.js');
const ideasRoute = await import('../app/api/ai/ideas/route.js');
const rules = await import('../app/ideas/inspiration-rules.js');
const recordsBounds = await import('./records-bounds.mjs');
const { measured, mostInFlight } = recordsBounds;

const realFetch = globalThis.fetch;
const reached = [];
globalThis.fetch = async (url) => {
  reached.push(String(url));
  throw new Error('a check reached for the network');
};

after(async () => {
  globalThis.fetch = realFetch;
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const stamp = () => new Date().toISOString();
const MARK = 'Zq7-saved-words';
/** A link whose kept form takes nearly the most bytes a link may (each `ş` is kept as `%C5%9F`). */
const HEAVY_LINK = `https://a.example/${'ş'.repeat(160)}`;

let themeOrder = 10;
async function theme(owner, name, { archived = false } = {}) {
  themeOrder += 1;
  return modelAction('Theme', 'create', { data: { ownerId: owner, name, colour: themeOrder % 5, position: themeOrder, archived, createdAt: stamp(), updatedAt: stamp() } });
}
async function otherNote(fields = {}) {
  return modelAction('Inspiration', 'create', { data: { ownerId: OTHER, link: '', note: `${MARK}-theirs`, createdAt: stamp(), updatedAt: stamp(), ...fields } });
}
async function noteCount(owner) {
  return Number(await modelAction('Inspiration', 'count', { where: { ownerId: owner } }));
}
async function clearNotes() {
  await modelAction('Inspiration', 'deleteMany', { where: { ownerId: OWNER } });
}

/** The refusal a call throws, as `{ key, field }`. */
async function refusalOf(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DataError, String(error));
    return { key: error.messageKey, field: error.field };
  }
  assert.fail('expected a refusal');
}

/** Calls a handler with a real request. */
async function call(handler, { method = 'POST', body, raw, type = 'application/json', id } = {}) {
  const sent = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const request = new Request('http://localhost/api/inspiration', { method, headers: sent === undefined ? {} : { 'content-type': type }, body: sent });
  const response = await handler(request, { params: Promise.resolve(id === undefined ? {} : { id: String(id) }) });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

// --- the records functions ---------------------------------------------------------------

test('a note keeps a link, words and a theme, and comes back newest first with its host', async () => {
  await clearNotes();
  const mine = await theme(OWNER, 'Behind the scenes');
  const first = await inspiration.addInspirationFor(OWNER, { link: 'https://www.shop.example/story?x=1', note: 'Packing video\nwith music', themeId: mine.id });
  assert.equal(first.link, 'https://www.shop.example/story?x=1');
  assert.equal(first.host, 'shop.example', 'the host leaves out www.');
  assert.equal(first.note, 'Packing video\nwith music', 'lines are kept');
  assert.equal(first.themeId, mine.id);
  const second = await inspiration.addInspirationFor(OWNER, { note: 'Only words' });
  assert.equal(second.link, '');
  assert.equal(second.host, '');
  assert.equal(second.themeId, null);
  const third = await inspiration.addInspirationFor(OWNER, { link: 'https://blog.example/a' });
  assert.equal(third.note, '');
  await otherNote();
  const listed = await inspiration.listInspirationFor(OWNER);
  assert.deepEqual(listed.map((note) => note.id), [third.id, second.id, first.id]);
  assert.ok(listed.every((note) => Object.keys(note).join() === 'id,link,host,note,themeId,createdAt'));
  assert.ok(!listed.some((note) => note.note.includes(MARK)), 'another owner’s notes are never listed');
});

test('the link is https or empty, a page on the internet, at most the link limit', async () => {
  const base = 'https://a.example/';
  const longest = base + 'p'.repeat(LIMITS.link - base.length);
  assert.equal((await inspiration.addInspirationFor(OWNER, { link: longest })).link, longest, 'at the limit');
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: `${longest}p` })), { key: 'refuse.text.long', field: 'link' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: 'http://a.example/' })), { key: 'refuse.link', field: 'link' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: 'javascript:alert(1)' })), { key: 'refuse.link', field: 'link' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: 'https://localhost/x' })), { key: 'refuse.linkPublic', field: 'link' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: 'https://192.168.1.4/' })), { key: 'refuse.linkPublic', field: 'link' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: 'https://shop.example:8443/' })), { key: 'refuse.linkPublic', field: 'link' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { link: 42 })), { key: 'refuse.text.missing', field: 'link' });
  assert.equal((await inspiration.addInspirationFor(OWNER, { link: HEAVY_LINK })).host, 'a.example');
});

test('the note holds at most 500 characters; a note with neither words nor a link is refused', async () => {
  const counted = await noteCount(OWNER);
  const longest = 'ş'.repeat(inspiration.INSPIRATION.note);
  assert.equal(inspiration.INSPIRATION.note, 500);
  assert.equal((await inspiration.addInspirationFor(OWNER, { note: longest })).note, longest, 'at the limit');
  assert.equal((await inspiration.addInspirationFor(OWNER, { note: 'ş'.repeat(499) })).note.length, 499, 'one under');
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { note: `${longest}ş` })), { key: 'refuse.text.long', field: 'note' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, {})), { key: 'refuse.inspiration.empty', field: 'note' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { note: '   \n ', link: '  ' })), { key: 'refuse.inspiration.empty', field: 'note' });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, null)), { key: 'refuse.request', field: undefined });
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor('', { note: 'x' })), { key: 'error.ownerMissing', field: undefined });
  assert.equal(await noteCount(OWNER), counted + 2, 'only the two good notes were kept');
});

test('a person keeps at most 500 notes: the 500th is saved, the 501st refused; another owner’s notes do not count', async () => {
  await clearNotes();
  const most = inspiration.INSPIRATION.most;
  assert.equal(most, 500);
  for (let index = 0; index < 3; index += 1) await otherNote();
  await modelAction('Inspiration', 'createMany', {
    data: Array.from({ length: most - 1 }, (_, index) => ({ ownerId: OWNER, link: '', note: `${MARK}-${index}`, createdAt: stamp(), updatedAt: stamp() })),
  });
  const last = await inspiration.addInspirationFor(OWNER, { note: `${MARK}-the 500th` });
  assert.equal(last.note, `${MARK}-the 500th`);
  assert.equal(await noteCount(OWNER), most);
  assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { note: `${MARK}-one more` })), { key: 'refuse.inspiration.full', field: undefined });
  assert.deepEqual(await call(notesRoute.POST, { body: { note: `${MARK}-one more` } }), { status: 400, json: { problem: 'refuse.inspiration.full' } });
  assert.equal(await noteCount(OWNER), most, 'nothing more was saved');
  // A removal makes room again.
  assert.equal(await inspiration.removeInspirationFor(OWNER, last.id), true);
  assert.equal((await inspiration.addInspirationFor(OWNER, { note: `${MARK}-in the room left` })).note, `${MARK}-in the room left`);
  await clearNotes();
});

test('the theme is optional and must be one of the owner’s themes in use', async () => {
  const counted = await noteCount(OWNER);
  const theirs = await theme(OTHER, 'Not yours');
  const old = await theme(OWNER, 'Old one', { archived: true });
  for (const themeId of [theirs.id, old.id, 999999, '3', 0, 2.5]) {
    assert.deepEqual(await refusalOf(inspiration.addInspirationFor(OWNER, { note: 'x', themeId })), { key: 'refuse.post.theme', field: 'themeId' }, String(themeId));
  }
  assert.equal(await noteCount(OWNER), counted, 'nothing kept');
  assert.equal((await inspiration.addInspirationFor(OWNER, { note: 'x', themeId: null })).themeId, null);
});

test('a change keeps the fields not sent, keeps a theme that left use, and refuses another owner’s note', async () => {
  const mine = await theme(OWNER, 'Seasonal');
  const note = await inspiration.addInspirationFor(OWNER, { note: 'Autumn window', link: 'https://shop.example/a', themeId: mine.id });
  const changed = await inspiration.updateInspirationFor(OWNER, note.id, { note: 'Autumn window, take two' });
  assert.deepEqual(changed, { ...note, note: 'Autumn window, take two' });
  await modelAction('Theme', 'updateMany', { where: { id: mine.id, ownerId: OWNER }, data: { archived: true } });
  const kept = await inspiration.updateInspirationFor(OWNER, note.id, { note: 'Still autumn', themeId: mine.id, link: '' });
  assert.equal(kept.themeId, mine.id, 'its own theme stays although it left use');
  assert.equal(kept.host, '');
  const other = await theme(OWNER, 'Archived too', { archived: true });
  assert.deepEqual(await refusalOf(inspiration.updateInspirationFor(OWNER, note.id, { themeId: other.id })), { key: 'refuse.post.theme', field: 'themeId' });
  assert.deepEqual(await refusalOf(inspiration.updateInspirationFor(OWNER, note.id, { note: '' })), { key: 'refuse.inspiration.empty', field: 'note' }, 'no words and no link');
  assert.deepEqual(await refusalOf(inspiration.updateInspirationFor(OWNER, note.id, { link: 'http://a.example' })), { key: 'refuse.link', field: 'link' });
  assert.equal((await inspiration.updateInspirationFor(OWNER, note.id, { themeId: null })).themeId, null);
  const read = (await inspiration.listInspirationFor(OWNER)).find((item) => item.id === note.id);
  assert.equal(read.note, 'Still autumn', 'a refused change changed nothing');

  const theirs = await otherNote();
  assert.equal(await inspiration.updateInspirationFor(OWNER, theirs.id, { note: 'mine now' }), null);
  assert.equal(await inspiration.updateInspirationFor(OWNER, 999999, { note: 'x' }), null);
  assert.equal(await inspiration.updateInspirationFor(OWNER, '1', { note: 'x' }), null);
  const untouched = await modelAction('Inspiration', 'findFirst', { where: { id: theirs.id } });
  assert.equal(untouched.note, `${MARK}-theirs`);
});

test('removing takes only the owner’s own note', async () => {
  const note = await inspiration.addInspirationFor(OWNER, { note: 'Going soon' });
  const theirs = await otherNote();
  assert.equal(await inspiration.removeInspirationFor(OWNER, theirs.id), false);
  assert.equal(await inspiration.removeInspirationFor(OWNER, 'x'), false);
  assert.ok(await modelAction('Inspiration', 'findFirst', { where: { id: theirs.id } }), 'theirs is still there');
  assert.equal(await inspiration.removeInspirationFor(OWNER, note.id), true);
  assert.equal(await inspiration.removeInspirationFor(OWNER, note.id), false, 'gone already');
});

test('the list shows the newest hundred; Give me ideas reads the newest ten, for a theme its own and the ones with none', async () => {
  await clearNotes();
  const product = await theme(OWNER, 'Product');
  const season = await theme(OWNER, 'Season');
  for (let index = 1; index <= inspiration.INSPIRATION.shown + 5; index += 1) {
    const themeId = index % 3 === 0 ? product.id : index % 3 === 1 ? season.id : null;
    await inspiration.addInspirationFor(OWNER, { note: `Note ${index}`, themeId });
  }
  const listed = await inspiration.listInspirationFor(OWNER);
  assert.equal(listed.length, 100);
  assert.equal(listed[0].note, 'Note 105');
  assert.equal(listed.at(-1).note, 'Note 6');

  const any = await inspiration.latestInspirationFor(OWNER);
  assert.deepEqual(any.map((note) => note.note), Array.from({ length: 10 }, (_, index) => `Note ${105 - index}`));
  const forProduct = await inspiration.latestInspirationFor(OWNER, { themeId: product.id });
  assert.equal(forProduct.length, 10);
  assert.ok(forProduct.every((note) => note.themeId === product.id || note.themeId === null));
  assert.equal(forProduct[0].note, 'Note 105');
  assert.equal(forProduct[1].note, 'Note 104', 'a note with no theme goes with every theme');
  assert.equal((await inspiration.latestInspirationFor(OWNER, { most: 3 })).length, 3);
  assert.equal((await inspiration.latestInspirationFor(OWNER, { most: 50 })).length, 10, 'never more than ten');
  await otherNote({ themeId: product.id });
  assert.ok(!(await inspiration.latestInspirationFor(OWNER, { themeId: product.id })).some((note) => note.note.includes(MARK)));
});

// --- Make it a post idea -------------------------------------------------------------------

test('a note becomes an idea post: its first line names it, the note and link are its main words, its theme stays', async () => {
  const mine = await theme(OWNER, 'Shop');
  const note = await inspiration.addInspirationFor(OWNER, { note: 'Show the new mugs\nin morning light', link: 'https://shop.example/mugs', themeId: mine.id });
  const post = await inspiration.postFromInspirationFor(OWNER, note.id);
  assert.equal(post.name, 'Show the new mugs');
  assert.equal(post.mainText, 'Show the new mugs\nin morning light\n\nhttps://shop.example/mugs');
  assert.equal(post.themeId, mine.id);
  assert.equal(post.day, null, 'an idea has no day');
  assert.equal(post.madeBy, 'person');
  assert.ok(await modelAction('Inspiration', 'findFirst', { where: { id: note.id, ownerId: OWNER } }), 'the note stays');
  const ideas = await posts.listIdeasFor(OWNER, [], 5);
  assert.equal(ideas[0].id, post.id);

  await modelAction('Theme', 'updateMany', { where: { id: mine.id, ownerId: OWNER }, data: { archived: true } });
  assert.equal((await inspiration.postFromInspirationFor(OWNER, note.id)).themeId, null, 'a theme no longer in use is not given to a new post');

  const theirs = await otherNote();
  assert.equal(await inspiration.postFromInspirationFor(OWNER, theirs.id), null);
  assert.equal(await inspiration.postFromInspirationFor(OWNER, 0), null);
});

test('the idea’s name and words: a link-only note, a note that holds its link, a long first line', () => {
  assert.deepEqual(inspiration.ideaFromNote({ link: 'https://www.blog.example/post', note: '' }), { name: 'blog.example', mainText: 'https://www.blog.example/post' });
  assert.deepEqual(inspiration.ideaFromNote({ link: 'https://a.example/', note: 'See https://a.example/ for this' }), { name: 'See https://a.example/ for this', mainText: 'See https://a.example/ for this' });
  assert.deepEqual(inspiration.ideaFromNote({ link: '', note: '\n\n  Second line first  \nmore' }), { name: 'Second line first', mainText: 'Second line first  \nmore' });
  const long = `${'word '.repeat(30)}end`;
  const { name } = inspiration.ideaFromNote({ link: '', note: long });
  assert.ok(Array.from(name).length <= LIMITS.name, `${name.length}`);
  assert.ok(name.endsWith('word'), 'cut at a word end');
  const edge = 'a'.repeat(LIMITS.name);
  assert.equal(inspiration.ideaFromNote({ link: '', note: edge }).name, edge, 'a first line at the limit stays whole');
  assert.equal(inspiration.hostOf('not a link'), '');
  assert.equal(inspiration.hostOf(''), '');
});

// --- the addresses ----------------------------------------------------------------------------

test('the addresses save, change, remove and make an idea, and name the refused field', async () => {
  const added = await call(notesRoute.POST, { body: { note: 'From the market', link: 'https://market.example/' } });
  assert.equal(added.status, 201);
  assert.equal(added.json.note.host, 'market.example');
  const id = added.json.note.id;
  assert.deepEqual(await call(notesRoute.POST, { body: { link: 'http://x.example' } }), { status: 400, json: { problem: 'refuse.link', field: 'link' } });
  assert.deepEqual(await call(notesRoute.POST, { body: {} }), { status: 400, json: { problem: 'refuse.inspiration.empty', field: 'note' } });
  assert.deepEqual(await call(notesRoute.POST, { raw: '{"note":"x"}', type: 'text/plain' }), { status: 400, json: { problem: 'refuse.request' } });
  assert.deepEqual(await call(notesRoute.POST, { raw: '[1]' }), { status: 400, json: { problem: 'refuse.request' } });

  const patched = await call(noteRoute.PATCH, { method: 'PATCH', id, body: { note: 'From the Sunday market' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.note.note, 'From the Sunday market');
  assert.equal(patched.json.note.link, 'https://market.example/');
  assert.deepEqual(await call(noteRoute.PATCH, { method: 'PATCH', id, body: { themeId: 'x' } }), { status: 400, json: { problem: 'refuse.post.theme', field: 'themeId' } });
  const theirs = await otherNote();
  assert.equal((await call(noteRoute.PATCH, { method: 'PATCH', id: theirs.id, body: { note: 'x' } })).status, 404);
  assert.equal((await call(noteRoute.PATCH, { method: 'PATCH', id: 'abc', body: { note: 'x' } })).status, 404);

  const made = await call(noteRoute.POST, { id, body: { action: 'post' } });
  assert.equal(made.status, 201);
  assert.equal(made.json.post.name, 'From the Sunday market');
  assert.equal(made.json.post.mainText, 'From the Sunday market\n\nhttps://market.example/');
  assert.deepEqual(await call(noteRoute.POST, { id, body: { action: 'remove' } }), { status: 400, json: { problem: 'refuse.request' } });
  assert.deepEqual(await call(noteRoute.POST, { id, body: { action: 'post', extra: 1 } }), { status: 400, json: { problem: 'refuse.request' } });
  assert.equal((await call(noteRoute.POST, { id: theirs.id, body: { action: 'post' } })).status, 404);

  assert.equal((await call(noteRoute.DELETE, { method: 'DELETE', id: theirs.id })).status, 404);
  assert.deepEqual(await call(noteRoute.DELETE, { method: 'DELETE', id }), { status: 200, json: { ok: true } });
  assert.equal((await call(noteRoute.DELETE, { method: 'DELETE', id })).status, 404);
  assert.equal(Number(await modelAction('Post', 'count', { where: { ownerId: OTHER } })), 0, 'nothing was made for the other owner');
});

// --- the records bounds --------------------------------------------------------------------

test('every function and address stays inside the records bounds, one call at a time, with the heaviest notes', async () => {
  await clearNotes();
  const mine = await theme(OWNER, 'Heavy');
  const heavy = { note: '"'.repeat(inspiration.INSPIRATION.note), link: HEAVY_LINK, themeId: mine.id };
  for (let index = 0; index < inspiration.INSPIRATION.shown + 2; index += 1) await inspiration.addInspirationFor(OWNER, heavy);

  const list = await measured(() => inspiration.listInspirationFor(OWNER));
  assert.equal(list.value.length, 100);
  recordsBounds.bounded(list, 'listing the notes', 2);
  const latest = await measured(() => inspiration.latestInspirationFor(OWNER, { themeId: mine.id }));
  recordsBounds.bounded(latest, 'the newest notes', 1);

  const add = await measured(() => call(notesRoute.POST, { body: heavy }));
  assert.equal(add.value.status, 201);
  recordsBounds.bounded(add, 'adding a note', 3);
  const id = add.value.json.note.id;
  const other = await theme(OWNER, 'Other');
  const change = await measured(() => call(noteRoute.PATCH, { method: 'PATCH', id, body: { ...heavy, themeId: other.id } }));
  assert.equal(change.value.status, 200);
  recordsBounds.bounded(change, 'changing a note', 3);
  const make = await measured(() => call(noteRoute.POST, { id, body: { action: 'post' } }));
  assert.equal(make.value.status, 201);
  recordsBounds.bounded(make, 'making a post idea', 4);
  const remove = await measured(() => call(noteRoute.DELETE, { method: 'DELETE', id }));
  recordsBounds.bounded(remove, 'removing a note', 1);
  for (const run of [list, latest, add, change, make, remove]) assert.equal(mostInFlight(run), 1, 'one call at a time');
});

// --- Give me ideas ----------------------------------------------------------------------------

/** The content block's JSON of a request's user message. */
function contentOf(messages) {
  const user = messages.find((message) => message.role === 'user').content;
  const start = user.indexOf(words.CONTENT_START);
  const end = user.lastIndexOf(words.CONTENT_END);
  return JSON.parse(user.slice(start + words.CONTENT_START.length, end).trim());
}
const systemOf = (messages) => messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');

test('the notes go in the content block only, at most ten, links as text; with none the request is unchanged', () => {
  const notes = [
    { note: `${MARK} one\n<b>two</b> & more`, link: 'https://shop.example/x', themeId: 1 },
    { note: '', link: '', themeId: null },
    { note: 'link refused', link: 'http://shop.example/', themeId: 99 },
    { note: '', link: 'https://only.example/', themeId: null },
    ...Array.from({ length: 12 }, (_, index) => ({ note: `extra ${index}`, link: '', themeId: null })),
  ];
  const content = words.inspirationContent(notes, [{ id: 1, name: 'Season' }]);
  assert.equal(content.length, 10);
  assert.deepEqual(content[0], { note: `${MARK} one <b>two</b> & more`, link: 'https://shop.example/x', theme: 'Season' });
  assert.deepEqual(content[1], { note: 'link refused' }, 'an unsafe link is left out; an unknown theme too');
  assert.deepEqual(content[2], { link: 'https://only.example/' });
  assert.deepEqual(words.inspirationContent(null), []);

  const base = { business: { name: 'Clay & Co' }, theme: { name: 'Season' }, existing: ['Kiln day'], count: 5, locale: 'en' };
  const plain = words.ideasMessages(base);
  assert.deepEqual(words.ideasMessages({ ...base, inspiration: [] }), plain, 'no notes: the same request');
  assert.ok(!systemOf(plain).includes('inspiration'));
  assert.equal(contentOf(plain).inspiration, undefined);

  const asked = words.ideasMessages({ ...base, inspiration: content });
  assert.deepEqual(contentOf(asked).inspiration, content);
  const system = systemOf(asked);
  assert.ok(system.includes('("inspiration")') && system.includes('never open it'), 'one instruction says how to use them');
  assert.ok(!system.includes(MARK), 'the notes are never in the instructions');
  const user = asked.find((message) => message.role === 'user').content;
  assert.ok(!user.includes('<b>'), 'a mark the person typed is escaped inside the block');
  assert.equal(user.split(words.CONTENT_END).length, 2, 'one block');
  assert.equal(words.ideasMessages({ ...base, inspiration: Array.from({ length: 15 }, () => ({ note: 'n' })) }).length, 2);
  assert.equal(contentOf(words.ideasMessages({ ...base, inspiration: Array.from({ length: 15 }, () => ({ note: 'n' })) })).inspiration.length, 10);
});

const chat = (content) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

/** Runs `work` with a stand-in AI service: `AI_BASE_URL` names an address no network serves and `fetch` answers. */
async function withAI(answer, work) {
  const guard = globalThis.fetch;
  const calls = [];
  process.env.AI_BASE_URL = 'http://ai.stand-in.invalid/v1';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    return answer();
  };
  try {
    return await work(calls);
  } finally {
    globalThis.fetch = guard;
    delete process.env.AI_BASE_URL;
  }
}

test('Give me ideas sends the newest notes for its theme as content, and none when there are none', async () => {
  await clearNotes();
  const product = await theme(OWNER, 'Product line');
  const season = await theme(OWNER, 'Season line');
  const answer = () => chat(JSON.stringify({ ideas: ['A brand new idea'] }));

  await withAI(answer, async (calls) => {
    const { status } = await call(ideasRoute.POST, { body: { themeId: product.id } });
    assert.equal(status, 200);
    const sent = calls[0].body.messages;
    assert.equal(contentOf(sent).inspiration, undefined, 'no notes: none sent');
    assert.ok(!systemOf(sent).includes('inspiration'));
  });

  await inspiration.addInspirationFor(OWNER, { note: 'Season only', themeId: season.id });
  for (let index = 1; index <= 11; index += 1) await inspiration.addInspirationFor(OWNER, { note: `Product ${index}`, themeId: product.id });
  await inspiration.addInspirationFor(OWNER, { note: 'For any theme', link: 'https://any.example/page' });
  await otherNote();

  await withAI(answer, async (calls) => {
    assert.equal((await call(ideasRoute.POST, { body: { themeId: product.id } })).status, 200);
    const sent = contentOf(calls[0].body.messages).inspiration;
    assert.equal(sent.length, 10);
    assert.deepEqual(sent[0], { note: 'For any theme', link: 'https://any.example/page' });
    assert.deepEqual(sent[1], { note: 'Product 11', theme: 'Product line' });
    assert.ok(!sent.some((note) => note.note === 'Season only'), 'another theme’s note is not sent for this theme');
    assert.ok(!JSON.stringify(calls[0].body).includes(MARK), 'another owner’s note is never sent');

    assert.equal((await call(ideasRoute.POST, { body: { themeId: null } })).status, 200);
    const whole = contentOf(calls[1].body.messages).inspiration;
    assert.equal(whole.length, 10);
    assert.equal(whole[0].note, 'For any theme');
    assert.equal(calls.length, 2, 'one AI request a press, and the link was never opened');
  });
  assert.equal(reached.length, 0, 'nothing reached for the network');
});

/** Runs `work` as inside Tellop (AI through Tellop's own route, answered by `answer`) and measures its records calls. */
async function insideTellop(answer, work) {
  const AI = Symbol.for('tellop.ai');
  const guard = globalThis.fetch;
  const asked = [];
  globalThis[AI] = {};
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    return answer();
  };
  try {
    return { ...(await measured(work)), asked };
  } finally {
    delete globalThis[AI];
    globalThis.fetch = guard;
  }
}

test('Give me ideas stays inside the records bounds with the notes read', async () => {
  const mine = await theme(OWNER, 'Bounded');
  for (let index = 0; index < 10; index += 1) await inspiration.addInspirationFor(OWNER, { note: '"'.repeat(inspiration.INSPIRATION.note), link: HEAVY_LINK, themeId: mine.id });
  const run = await insideTellop(() => chat(JSON.stringify({ ideas: ['Bounded idea'] })), () => call(ideasRoute.POST, { body: { themeId: mine.id } }));
  assert.equal(run.value.status, 200, JSON.stringify(run.value.json));
  assert.equal(run.asked.length, 1);
  assert.equal(contentOf(run.asked[0].body.messages).inspiration.length, 10, 'the notes were read inside Tellop too');
  recordsBounds.bounded(run, 'Give me ideas', 8);
  assert.ok(mostInFlight(run) <= 2, `${mostInFlight(run)} calls at once`);
});

// --- the page's rules ---------------------------------------------------------------------------

test('the section’s rules: Save rests until a note has words or a link, three show until Show all, a theme out of use stays a choice', () => {
  assert.equal(rules.canSaveNote('', ''), false);
  assert.equal(rules.canSaveNote('  ', ' \n '), false);
  assert.equal(rules.canSaveNote('https://a.example', ''), true);
  assert.equal(rules.canSaveNote('', 'x'), true);
  assert.equal(rules.NOTE_MOST, 500);
  const list = [1, 2, 3, 4].map((id) => ({ id }));
  assert.deepEqual(rules.shownNotes(list, false).map((note) => note.id), [1, 2, 3]);
  assert.deepEqual(rules.shownNotes(list.slice(0, 3), false).length, 3, 'at the fold nothing is hidden');
  assert.deepEqual(rules.shownNotes(list, true).length, 4);
  const inUse = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const archived = [{ id: 9, name: 'Old' }];
  assert.deepEqual(rules.noteThemeChoices(inUse, archived, null).map((item) => item.id), [1, 2]);
  assert.deepEqual(rules.noteThemeChoices(inUse, archived, 2).map((item) => item.id), [1, 2]);
  assert.deepEqual(rules.noteThemeChoices(inUse, archived, 9).map((item) => item.id), [1, 2, 9]);
  assert.deepEqual(rules.noteThemeChoices(inUse, archived, 7).map((item) => item.id), [1, 2], 'a theme that is gone is not offered');
  assert.equal(rules.noteThemeOf({ themeId: 9 }, [...inUse, ...archived]).name, 'Old');
  assert.equal(rules.noteThemeOf({ themeId: 7 }, inUse), null);
  assert.equal(rules.noteThemeOf({ themeId: null }, inUse), null);
});
