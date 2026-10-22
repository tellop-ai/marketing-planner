/**
 * The posts and pictures addresses, called the way Next calls them: a real
 * `Request` and `{ params }` as a promise. A throwaway store and file folder
 * (`APP_DATA_FILE` in a temporary folder, removed afterwards).
 *
 * Each address is checked for what it answers, for every refusal it gives,
 * and for never reading, changing or removing a row of another owner, which
 * is written straight into the store.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'posts-routes-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const { keepFile } = await import('../lib/data/files.js');
const { OWNER } = await import('../lib/plan/owner.js');
const postsRoute = await import('../app/api/posts/route.js');
const postRoute = await import('../app/api/posts/[id]/route.js');
const versionRoute = await import('../app/api/posts/[id]/versions/[network]/route.js');
const postPicturesRoute = await import('../app/api/posts/[id]/pictures/route.js');
const pictureRoute = await import('../app/api/pictures/[id]/route.js');
const pictureFileRoute = await import('../app/api/pictures/[id]/file/route.js');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const stamp = () => new Date().toISOString();

/**
 * Calls a handler with a real request. `body` is sent as JSON unless `raw` is given.
 *
 * @param {Function} handler
 * @param {{ url?: string, method?: string, body?: unknown, raw?: string, type?: string, params?: Record<string, string> }} [options]
 */
async function call(handler, { url = 'http://localhost/api/test', method = 'GET', body, raw, type = 'application/json', params = {} } = {}) {
  const sent = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const request = new Request(url, { method, headers: sent === undefined ? {} : { 'content-type': type }, body: sent });
  const response = await handler(request, { params: Promise.resolve(params) });
  const text = await response.clone().text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, status: response.status, json };
}

/** A kept file whose bytes read as a PNG picture. */
async function keptPicture(seed) {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 64 }, (_, index) => (index * seed) % 256)]);
  const kept = await keepFile(new Request('http://localhost/api/files', { method: 'POST', body: bytes }));
  return { digest: kept.file, bytes };
}

async function newPost(body = {}) {
  const { status, json } = await call(postsRoute.POST, { method: 'POST', body });
  assert.equal(status, 201, JSON.stringify(json));
  return json.post;
}

async function otherPost() {
  return modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', createdAt: stamp(), updatedAt: stamp() } });
}

test('POST /api/posts makes a post from nothing or from a day, and refuses what it cannot keep', async () => {
  const empty = await newPost({});
  assert.equal(empty.name, '');
  assert.equal(empty.day, null);
  const dated = await newPost({ day: '2026-11-03', name: 'Autumn', madeBy: 'ai', ownerId: OTHER });
  assert.deepEqual([dated.day, dated.name, dated.madeBy], ['2026-11-03', 'Autumn', 'person']);
  assert.equal((await modelAction('Post', 'findFirst', { where: { id: dated.id } })).ownerId, OWNER, 'the owner is never the request\'s');
  let answer = await call(postsRoute.POST, { method: 'POST', body: { day: '2026-11-31' } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.post.day' }]);
  answer = await call(postsRoute.POST, { method: 'POST', raw: 'day=2026-11-03', type: 'text/plain' });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.request' }]);
  answer = await call(postsRoute.POST, { method: 'POST', raw: '[]' });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.request' }]);
  const theirTheme = await modelAction('Theme', 'create', { data: { ownerId: OTHER, name: 'Theirs', colour: 1, position: 1, createdAt: stamp(), updatedAt: stamp() } });
  answer = await call(postsRoute.POST, { method: 'POST', body: { themeId: theirTheme.id } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.post.theme' }]);
  answer = await call(postsRoute.POST, { method: 'POST', body: { campaignId: 424242 } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.post.campaign' }]);
  answer = await call(postsRoute.POST, { method: 'POST', body: { specialDay: '../x' } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.post.specialDay' }]);
  answer = await call(postsRoute.POST, { method: 'POST', body: { name: 'a'.repeat(81) } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.text.long' }]);
});

test('GET, PATCH and DELETE /api/posts/[id] answer this owner\'s post only', async () => {
  const post = await newPost({ name: 'Mine', day: '2026-11-04' });
  const theirs = await otherPost();
  for (const id of ['abc', '0', '01', '-3', '1.5', String(theirs.id), '99999999']) {
    const read = await call(postRoute.GET, { params: { id } });
    assert.deepEqual([read.status, read.json], [404, { problem: 'error.notFound' }], `GET ${id}`);
  }
  const read = await call(postRoute.GET, { params: { id: String(post.id) } });
  assert.equal(read.status, 200);
  assert.deepEqual(Object.keys(read.json).sort(), ['pictures', 'post', 'versions']);
  assert.equal(read.json.post.name, 'Mine');

  let answer = await call(postRoute.PATCH, { method: 'PATCH', params: { id: String(post.id) }, body: { name: 'Renamed', day: null, time: '18:00', mainText: 'What it says' } });
  assert.equal(answer.status, 200);
  assert.deepEqual([answer.json.post.name, answer.json.post.day, answer.json.post.time, answer.json.post.mainText], ['Renamed', null, '18:00', 'What it says']);
  answer = await call(postRoute.PATCH, { method: 'PATCH', params: { id: String(post.id) }, body: { time: '7:00' } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.post.time' }]);
  answer = await call(postRoute.PATCH, { method: 'PATCH', params: { id: String(theirs.id) }, body: { name: 'Taken' } });
  assert.deepEqual([answer.status, answer.json], [404, { problem: 'error.notFound' }]);
  assert.equal((await modelAction('Post', 'findFirst', { where: { id: theirs.id } })).name, 'Theirs');

  answer = await call(postRoute.DELETE, { method: 'DELETE', params: { id: String(theirs.id) } });
  assert.equal(answer.status, 404);
  assert.notEqual(await modelAction('Post', 'findFirst', { where: { id: theirs.id } }), null);
  answer = await call(postRoute.DELETE, { method: 'DELETE', params: { id: String(post.id) } });
  assert.deepEqual([answer.status, answer.json], [200, { ok: true }]);
  answer = await call(postRoute.DELETE, { method: 'DELETE', params: { id: String(post.id) } });
  assert.equal(answer.status, 404);
});

test('a version is the person\'s edit with PUT, and shared, unshared or given results with POST', async () => {
  const post = await newPost({ name: 'Versions' });
  const theirs = await otherPost();
  const at = (network, id = post.id) => ({ id: String(id), network });
  let answer = await call(versionRoute.PUT, { method: 'PUT', params: at('myspace'), body: { text: 'Hi' } });
  assert.deepEqual([answer.status, answer.json], [404, { problem: 'error.notFound' }]);
  answer = await call(versionRoute.PUT, { method: 'PUT', params: at('x', theirs.id), body: { text: 'Hi' } });
  assert.equal(answer.status, 404);
  assert.equal(await modelAction('PostVersion', 'count', { where: { postId: theirs.id } }), 0);
  answer = await call(versionRoute.PUT, { method: 'PUT', params: at('x'), body: { text: 'My words', hashtags: '#cake', changedByPerson: false } });
  assert.equal(answer.status, 200);
  assert.deepEqual([answer.json.version.text, answer.json.version.hashtags, answer.json.version.changedByPerson], ['My words', '#cake', true]);
  answer = await call(versionRoute.PUT, { method: 'PUT', params: at('x'), body: { link: 'ftp://example.com' } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.link' }]);

  answer = await call(versionRoute.POST, { method: 'POST', params: at('x'), body: { action: 'shared', sharedLink: 'https://x.com/me/status/2' } });
  assert.equal(answer.status, 200);
  assert.equal(answer.json.version.sharedLink, 'https://x.com/me/status/2');
  assert.match(answer.json.version.sharedAt, /T/u);
  answer = await call(versionRoute.POST, { method: 'POST', params: at('x'), body: { action: 'results', views: 40, clicks: 3, resultNote: 'Good day' } });
  assert.deepEqual([answer.json.version.views, answer.json.version.clicks, answer.json.version.resultNote], [40, 3, 'Good day']);
  answer = await call(versionRoute.POST, { method: 'POST', params: at('x'), body: { action: 'results', views: -2 } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.number' }]);
  answer = await call(versionRoute.POST, { method: 'POST', params: at('x'), body: { action: 'unshared' } });
  assert.deepEqual([answer.json.version.sharedAt, answer.json.version.sharedLink], [null, null]);
  answer = await call(versionRoute.POST, { method: 'POST', params: at('x'), body: { action: 'deleted' } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.request' }]);
  answer = await call(versionRoute.POST, { method: 'POST', params: at('instagram'), body: { action: 'results', views: 1 } });
  assert.equal(answer.status, 404, 'no version for that network yet');
  answer = await call(versionRoute.POST, { method: 'POST', params: at('x', theirs.id), body: { action: 'shared' } });
  assert.equal(answer.status, 404);
});

test('POST /api/posts/[id]/pictures adds a photo, a words picture or a card', async () => {
  const post = await newPost({ name: 'Pictures' });
  const theirs = await otherPost();
  const add = (body, id = post.id) => call(postPicturesRoute.POST, { method: 'POST', params: { id: String(id) }, body });
  const { digest } = await keptPicture(3);
  let answer = await add({ source: 'photo', file: digest, width: 1200, height: 800, description: 'A shop window' });
  assert.equal(answer.status, 201, JSON.stringify(answer.json));
  assert.deepEqual([answer.json.picture.source, answer.json.picture.chosen, answer.json.picture.original, answer.json.picture.description], ['photo', true, digest.slice(0, 12), 'A shop window']);
  assert.equal(JSON.stringify(answer.json).includes(digest), false, 'an answer names a tag, never the digest');
  answer = await add({ source: 'photo', file: 'f'.repeat(64), width: 10, height: 10 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'error.fileMissing' }]);
  answer = await add({ source: 'photo', file: 'not-a-digest', width: 10, height: 10 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'error.fileNotKept' }]);
  answer = await add({ source: 'photo', width: 10, height: 10 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.file' }]);
  answer = await add({ source: 'photo', file: digest, width: 10 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.size' }]);
  const notPicture = await keepFile(new Request('http://localhost/api/files', { method: 'POST', body: new TextEncoder().encode('just words, not a picture') }));
  answer = await add({ source: 'photo', file: notPicture.file, width: 10, height: 10 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'error.pictureType' }]);
  answer = await add({ source: 'drawn', file: digest, width: 10, height: 10 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.source' }], 'AI pictures come through the AI addresses');
  answer = await add({ source: 'words', words: 'Open on Sunday' });
  assert.equal(answer.status, 201);
  assert.deepEqual([answer.json.picture.words, answer.json.picture.chosen, answer.json.picture.position], ['Open on Sunday', false, 2]);
  const yes = await modelAction('CustomerComment', 'create', { data: { ownerId: OWNER, name: 'Can', text: 'Great service', bestLine: 'Great', receivedOn: '2026-10-02', permission: 'yes', createdAt: stamp(), updatedAt: stamp() } });
  const no = await modelAction('CustomerComment', 'create', { data: { ownerId: OWNER, name: 'Deniz', text: 'Fine', receivedOn: '2026-10-02', permission: 'no', createdAt: stamp(), updatedAt: stamp() } });
  answer = await add({ source: 'card', commentId: yes.id });
  assert.equal(answer.status, 201);
  assert.deepEqual(answer.json.picture.card, { bestLine: 'Great', text: 'Great service', name: 'Can', stars: null });
  answer = await add({ source: 'card', commentId: no.id });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.noPermission' }]);
  answer = await add({ source: 'words', words: 'Theirs' }, theirs.id);
  assert.deepEqual([answer.status, answer.json], [404, { problem: 'error.notFound' }]);
  assert.equal(await modelAction('PostPicture', 'count', { where: { postId: theirs.id } }), 0);
  answer = await add({ source: 'words', words: 'Nowhere' }, 'x1');
  assert.equal(answer.status, 404);
});

test('PATCH and DELETE /api/pictures/[id] change and remove this owner\'s pictures only', async () => {
  const post = await newPost({ name: 'Picture changes' });
  const add = (body) => call(postPicturesRoute.POST, { method: 'POST', params: { id: String(post.id) }, body });
  const first = (await add({ source: 'words', words: 'First' })).json.picture;
  const second = (await add({ source: 'words', words: 'Second' })).json.picture;
  const patch = (id, body) => call(pictureRoute.PATCH, { method: 'PATCH', params: { id: String(id) }, body });
  let answer = await patch(second.id, { chosen: true });
  assert.equal(answer.json.picture.chosen, true);
  const pictures = (await call(postRoute.GET, { params: { id: String(post.id) } })).json.pictures;
  assert.deepEqual(pictures.map((picture) => picture.chosen), [false, true]);
  answer = await patch(second.id, { chosen: false });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.request' }]);
  answer = await patch(second.id, { focusX: 2 });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.focus' }]);
  answer = await patch(second.id, { fit: 'stretch' });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.fit' }]);
  const { digest } = await keptPicture(5);
  answer = await patch(second.id, { shapes: { square: digest } });
  assert.equal(answer.status, 200);
  assert.equal(answer.json.picture.shapes.square, digest.slice(0, 12));
  answer = await patch(second.id, { shapes: { story: 'e'.repeat(64) } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'error.fileMissing' }]);
  answer = await patch(second.id, { shapes: { round: digest } });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.shape' }]);
  answer = await patch(second.id, { shapes: [digest] });
  assert.deepEqual([answer.status, answer.json], [400, { problem: 'refuse.picture.shape' }]);
  answer = await patch(second.id, { words: 'Second, changed', focusY: 0.25 });
  assert.deepEqual([answer.json.picture.words, answer.json.picture.focusY, answer.json.picture.shapes.square], ['Second, changed', 0.25, null]);
  answer = await patch(first.id, {});
  assert.equal(answer.json.picture.id, first.id);

  const theirs = await otherPost();
  const theirPicture = await modelAction('PostPicture', 'create', { data: { ownerId: OTHER, postId: theirs.id, source: 'words', words: 'Theirs', chosen: false, position: 1, createdAt: stamp() } });
  answer = await patch(theirPicture.id, { chosen: true, description: 'taken' });
  assert.equal(answer.status, 404);
  const still = await modelAction('PostPicture', 'findFirst', { where: { id: theirPicture.id } });
  assert.deepEqual([still.chosen, still.description], [false, '']);
  answer = await call(pictureRoute.DELETE, { method: 'DELETE', params: { id: String(theirPicture.id) } });
  assert.equal(answer.status, 404);
  assert.notEqual(await modelAction('PostPicture', 'findFirst', { where: { id: theirPicture.id } }), null);

  answer = await call(pictureRoute.DELETE, { method: 'DELETE', params: { id: String(second.id) } });
  assert.deepEqual([answer.status, answer.json], [200, { ok: true }]);
  const left = (await call(postRoute.GET, { params: { id: String(post.id) } })).json.pictures;
  assert.deepEqual(left.map((picture) => [picture.id, picture.chosen]), [[first.id, true]]);
  answer = await call(pictureRoute.DELETE, { method: 'DELETE', params: { id: String(second.id) } });
  assert.equal(answer.status, 404);
});

test('GET /api/pictures/[id]/file hands over the original or a kept shape, and nothing of another owner', async () => {
  const post = await newPost({ name: 'Files' });
  const { digest, bytes } = await keptPicture(7);
  const photo = (await call(postPicturesRoute.POST, { method: 'POST', params: { id: String(post.id) }, body: { source: 'photo', file: digest, width: 100, height: 100 } })).json.picture;
  const file = (id, query = '') => call(pictureFileRoute.GET, { url: `http://localhost/api/pictures/${id}/file${query}`, params: { id: String(id) } });
  let answer = await file(photo.id, `?shape=original&v=${photo.original}`);
  assert.equal(answer.status, 200);
  assert.equal(answer.response.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await answer.response.arrayBuffer()), bytes, 'the person\'s photo is handed over whole, unchanged');
  answer = await file(photo.id);
  assert.equal(answer.status, 200, 'the original is the default');
  answer = await file(photo.id, '?shape=original&download=1');
  assert.equal(answer.status, 200);
  assert.equal(answer.response.headers.get('content-disposition'), 'attachment');
  answer = await file(photo.id, '?shape=square');
  assert.deepEqual([answer.status, answer.json], [404, { problem: 'error.notFound' }]);
  const square = await keptPicture(11);
  await call(pictureRoute.PATCH, { method: 'PATCH', params: { id: String(photo.id) }, body: { shapes: { square: square.digest } } });
  answer = await file(photo.id, '?shape=square');
  assert.equal(answer.status, 200);
  assert.deepEqual(new Uint8Array(await answer.response.arrayBuffer()), square.bytes);
  answer = await file(photo.id, '?shape=round');
  assert.equal(answer.status, 404);
  answer = await file('x', '?shape=original');
  assert.equal(answer.status, 404);
  const words = (await call(postPicturesRoute.POST, { method: 'POST', params: { id: String(post.id) }, body: { source: 'words', words: 'Hi' } })).json.picture;
  answer = await file(words.id, '?shape=original');
  assert.deepEqual([answer.status, answer.json], [404, { problem: 'error.notFound' }]);
  const theirs = await otherPost();
  const theirPicture = await modelAction('PostPicture', 'create', { data: { ownerId: OTHER, postId: theirs.id, source: 'photo', file: digest, chosen: true, position: 1, createdAt: stamp() } });
  answer = await file(theirPicture.id, '?shape=original');
  assert.deepEqual([answer.status, answer.json], [404, { problem: 'error.notFound' }]);
  const head = await pictureFileRoute.HEAD(new Request(`http://localhost/api/pictures/${photo.id}/file`, { method: 'HEAD' }), { params: Promise.resolve({ id: String(photo.id) }) });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

// --- Tellop's records bounds (`tests/records-bounds.mjs`) ----------------------------------

test('each post address at its largest stays within Tellop\'s records bounds', async (t) => {
  const { bounded, largestCall, measured } = await import('./records-bounds.mjs');
  const { LIMITS } = await import('../lib/plan/limits.js');
  const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
  const { SHAPE_KEYS } = await import('../lib/plan/shapes.js');
  const posts = await import('../lib/data/posts.js');
  const longest = (count) => 'ş'.repeat(count);
  const link = `https://example.com/${'a'.repeat(LIMITS.link - 20)}`;
  const post = await newPost({ name: longest(LIMITS.name), day: '2033-09-01' });
  await posts.updatePostFor(OWNER, post.id, { mainText: longest(LIMITS.mainText) });
  await posts.saveVersionsFor(OWNER, post.id, NETWORK_KEYS.map((network) => ({
    network, text: longest(LIMITS.versionText), hashtags: Array.from({ length: LIMITS.hashtags }, (_, index) => `#${String(index).padStart(2, '0')}${longest(LIMITS.hashtagLength - 3)}`),
    link, firstComment: longest(LIMITS.firstComment),
  })), { replace: true });
  const at = stamp();
  await modelAction('CustomerComment', 'createMany', {
    data: Array.from({ length: 19 }, (_, index) => ({ ownerId: OWNER, name: longest(LIMITS.name), text: longest(LIMITS.comment), bestLine: longest(LIMITS.bestLine), permission: 'yes', receivedOn: '2033-01-01', createdAt: at, updatedAt: `${at}#${index}` })),
  });
  const comments = (await modelAction('CustomerComment', 'findMany', { where: { ownerId: OWNER, updatedAt: { startsWith: at } }, select: { id: true }, orderBy: { id: 'asc' } })).map((row) => row.id);
  const shapes = Object.fromEntries(SHAPE_KEYS.map((key, index) => [`${key}File`, String(index + 1).padStart(64, 'a')]));
  await modelAction('PostPicture', 'createMany', {
    data: comments.map((commentId, index) => ({ ownerId: OWNER, postId: post.id, source: 'card', commentId, chosen: index === 0, description: longest(LIMITS.description), position: index + 1, ...shapes, createdAt: at })),
  });
  const id = String(post.id);
  const runs = {
    'GET /api/posts/[id]': [() => call(postRoute.GET, { params: { id } }), 3],
    'PATCH /api/posts/[id]': [() => call(postRoute.PATCH, { method: 'PATCH', body: { name: longest(LIMITS.name), day: '2033-09-02' }, params: { id } }), 3],
    'PUT /api/posts/[id]/versions/[network]': [() => call(versionRoute.PUT, { method: 'PUT', body: { text: longest(LIMITS.versionText), firstComment: longest(LIMITS.firstComment) }, params: { id, network: 'instagram' } }), 2],
    'POST .../versions/[network] shared': [() => call(versionRoute.POST, { method: 'POST', body: { action: 'shared', sharedLink: link }, params: { id, network: 'instagram' } }), 2],
    'POST .../versions/[network] results': [() => call(versionRoute.POST, { method: 'POST', body: { action: 'results', views: LIMITS.result, resultNote: longest(posts.RESULT_NOTE_MOST) }, params: { id, network: 'instagram' } }), 2],
    'POST /api/posts/[id]/pictures': [() => call(postPicturesRoute.POST, { method: 'POST', body: { source: 'words', words: longest(LIMITS.pictureWords) }, params: { id } }), 4],
  };
  for (const [what, [run, most]] of Object.entries(runs)) {
    const result = await measured(run);
    assert.ok(result.value.status < 300, `${what}: ${result.value.status} ${JSON.stringify(result.value.json)?.slice(0, 200)}`);
    bounded(result, what, most);
    t.diagnostic(`${what}: ${result.calls.length} calls, largest ${largestCall(result)} bytes`);
  }
  const full = await measured(() => call(postRoute.GET, { params: { id } }));
  assert.equal(full.value.json.versions.length, NETWORK_KEYS.length);
  assert.equal(full.value.json.pictures.length, 20);
  const card = full.value.json.pictures.find((picture) => picture.source === 'card' && picture.chosen === false);
  const pictureRuns = {
    'PATCH /api/pictures/[id]': [() => call(pictureRoute.PATCH, { method: 'PATCH', body: { chosen: true, description: longest(LIMITS.description) }, params: { id: String(card.id) } }), 5],
    'GET /api/pictures/[id]/file': [() => call(pictureFileRoute.GET, { url: `http://localhost/api/pictures/${card.id}/file?shape=square`, params: { id: String(card.id) } }), 1],
    'DELETE /api/pictures/[id]': [() => call(pictureRoute.DELETE, { method: 'DELETE', params: { id: String(card.id) } }), 3],
    'DELETE /api/posts/[id]': [() => call(postRoute.DELETE, { method: 'DELETE', params: { id } }), 1],
  };
  for (const [what, [run, most]] of Object.entries(pictureRuns)) {
    const result = await measured(run);
    bounded(result, what, most);
    t.diagnostic(`${what}: ${result.calls.length} calls, largest ${largestCall(result)} bytes`);
  }
});

test('POST /api/posts keeps the words it is given as the words box does, and refuses a day in a full month', async () => {
  const { LIMITS } = await import('../lib/plan/limits.js');
  const made = await newPost({ day: '2035-01-05', mainText: '  Line one\r\nLine two  ', specialDay: 'newYear' });
  assert.equal(made.mainText, 'Line one\nLine two');
  assert.equal((await call(postRoute.GET, { params: { id: String(made.id) } })).json.post.mainText, 'Line one\nLine two');
  assert.equal((await newPost({ mainText: 'ş'.repeat(LIMITS.mainText) })).mainText.length, LIMITS.mainText, 'exactly the most');
  const long = await call(postsRoute.POST, { method: 'POST', body: { mainText: 'a'.repeat(LIMITS.mainText + 1) } });
  assert.deepEqual([long.status, long.json], [400, { problem: 'refuse.text.long' }]);
  const wrong = await call(postsRoute.POST, { method: 'POST', body: { mainText: 5 } });
  assert.equal(wrong.status, 400);

  await modelAction('Post', 'createMany', {
    data: Array.from({ length: 255 }, (_, index) => ({ ownerId: OWNER, name: `Filler ${index}`, day: `2035-02-${String((index % 28) + 1).padStart(2, '0')}`, createdAt: stamp(), updatedAt: stamp() })),
  });
  assert.ok((await newPost({ day: '2035-02-10' })).id > 0, 'the 256th is taken');
  const full = await call(postsRoute.POST, { method: 'POST', body: { day: '2035-02-11' } });
  assert.deepEqual([full.status, full.json], [400, { problem: 'refuse.post.monthFull' }]);
  const moved = await call(postRoute.PATCH, { method: 'PATCH', body: { day: '2035-02-12' }, params: { id: String(made.id) } });
  assert.deepEqual([moved.status, moved.json], [400, { problem: 'refuse.post.monthFull' }]);
});
