/**
 * The data side of the growth plan's wave 1: a post's ask and video plan, "Mark scheduled" and the scheduled state,
 * sets of pictures and words-picture layouts, follow-ups and offer codes on
 * enquiries, followers. A throwaway store (`APP_DATA_FILE` in a temporary
 * folder, removed afterwards); rows of another owner are written straight
 * into the store and must never be read, changed or counted. Each limit is
 * tested at its edge and one past it, through the addresses where a page
 * sends it.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'wave1-data-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const posts = await import('../lib/data/posts.js');
const customers = await import('../lib/data/customers.js');
const followers = await import('../lib/data/followers.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { NETWORK_KEYS, networkByKey, SET_LIMITS, setMostOf } = await import('../lib/plan/networks.js');
const { ASKS, askOf, isAsk } = await import('../lib/plan/asks.js');
const { readVideoPlan, videoPlanOf, videoPlanSeconds, VIDEO_PLAN } = await import('../lib/plan/video-plan.js');
const { isAhead, postState } = await import('../lib/plan/state.js');
const { readCalendar } = await import('../app/calendar/read.js');
const postsRoute = await import('../app/api/posts/route.js');
const postRoute = await import('../app/api/posts/[id]/route.js');
const versionRoute = await import('../app/api/posts/[id]/versions/[network]/route.js');
const postPicturesRoute = await import('../app/api/posts/[id]/pictures/route.js');
const pictureRoute = await import('../app/api/pictures/[id]/route.js');
const setsRoute = await import('../app/api/posts/[id]/sets/[kind]/route.js');
const followersRoute = await import('../app/api/followers/route.js');
const enquiriesRoute = await import('../app/api/enquiries/route.js');
const enquiryRoute = await import('../app/api/enquiries/[id]/route.js');
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const stamp = () => new Date().toISOString();
const digest = (n) => n.toString(16).padStart(64, '0');
/** An instant on a civil day at a time of this computer's clock. */
const at = (day, hour = 12, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
};
const refusedWith = (key) => (error) => {
  assert.ok(error instanceof DataError, `expected a refusal, got ${String(error)}`);
  assert.equal(error.messageKey, key);
  return true;
};

async function call(handler, { url = 'http://localhost/api/test', method = 'GET', body, params = {} } = {}) {
  const sent = body === undefined ? undefined : JSON.stringify(body);
  const request = new Request(url, { method, headers: sent === undefined ? {} : { 'content-type': 'application/json' }, body: sent });
  const response = await handler(request, { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

const plan = {
  hook: 'Stop: this mug took three days',
  shots: [{ what: 'Hands shaping the clay', seconds: 4 }, { what: 'The kiln opening', seconds: 3 }],
  onScreen: ['Day 1', '  ', 'Day 3'],
  cover: 'The finished mug',
};

// --- asks and video plans ---------------------------------------------------------------

test('asks: six keys, anything else reads as none', () => {
  assert.deepEqual(ASKS, ['message', 'book', 'buy', 'visit', 'call', 'comment']);
  assert.equal(isAsk('book'), true);
  assert.equal(isAsk('Book'), false);
  assert.equal(askOf(null), '');
  assert.equal(askOf('sell'), '');
  assert.equal(askOf('call'), 'call');
});

test('a video plan keeps 1 to 6 shots of 1 to 60 seconds, 6 lines on screen, 300 letters a line, 4,000 bytes', () => {
  const read = readVideoPlan(plan);
  assert.equal(read.ok, true);
  assert.deepEqual(read.plan, { hook: plan.hook, shots: plan.shots, onScreen: ['Day 1', 'Day 3'], cover: plan.cover }, 'an empty line on screen is left out');
  assert.deepEqual(videoPlanOf(read.value), read.plan);
  assert.equal(videoPlanSeconds(read.plan), 7);
  assert.deepEqual(readVideoPlan(''), { ok: true, value: '', plan: null });
  assert.deepEqual(readVideoPlan(null), { ok: true, value: '', plan: null });
  const shots = (count, seconds = 5) => Array.from({ length: count }, (_, index) => ({ what: `Shot ${index}`, seconds }));
  assert.equal(readVideoPlan({ shots: shots(1) }).ok, true, 'a hook and a cover may stay empty');
  assert.equal(readVideoPlan({ shots: shots(VIDEO_PLAN.shots) }).ok, true);
  assert.deepEqual(readVideoPlan({ shots: shots(VIDEO_PLAN.shots + 1) }), { ok: false, problem: 'refuse.post.videoPlan' });
  assert.deepEqual(readVideoPlan({ shots: [] }), { ok: false, problem: 'refuse.post.videoPlan' });
  assert.equal(readVideoPlan({ shots: shots(1, 1) }).ok, true);
  assert.equal(readVideoPlan({ shots: shots(1, 60) }).ok, true);
  for (const seconds of [0, 61, 2.5, '5', null]) assert.deepEqual(readVideoPlan({ shots: shots(1, seconds) }), { ok: false, problem: 'refuse.post.videoPlan' }, String(seconds));
  assert.deepEqual(readVideoPlan({ shots: [{ what: '  ', seconds: 3 }] }), { ok: false, problem: 'refuse.text.missing' });
  assert.equal(readVideoPlan({ shots: shots(1), onScreen: Array(6).fill('Line') }).ok, true);
  assert.deepEqual(readVideoPlan({ shots: shots(1), onScreen: Array(7).fill('Line') }), { ok: false, problem: 'refuse.post.videoPlan' });
  assert.equal(readVideoPlan({ hook: 'a'.repeat(VIDEO_PLAN.letters), shots: shots(1) }).ok, true);
  assert.deepEqual(readVideoPlan({ hook: 'a'.repeat(VIDEO_PLAN.letters + 1), shots: shots(1) }), { ok: false, problem: 'refuse.text.long' });
  // Every line at its longest in Turkish letters passes each line's limit but not the plan's 4,000 bytes.
  const long = 'ş'.repeat(VIDEO_PLAN.letters);
  const big = { hook: long, cover: long, shots: Array.from({ length: 6 }, () => ({ what: long, seconds: 9 })), onScreen: [] };
  assert.deepEqual(readVideoPlan(big), { ok: false, problem: 'refuse.text.long' });
  const fits = { hook: long, cover: '', shots: [{ what: long, seconds: 9 }, { what: long, seconds: 9 }, { what: long, seconds: 9 }], onScreen: [] };
  const kept = readVideoPlan(fits);
  assert.equal(kept.ok, true);
  assert.ok(new TextEncoder().encode(kept.value).length <= VIDEO_PLAN.bytes);
  for (const wrong of [[], 'text', 4, { shots: 'one' }, { shots: [null] }, { hook: 5, shots: shots(1) }]) {
    assert.equal(readVideoPlan(wrong).ok, false, JSON.stringify(wrong));
  }
  assert.equal(videoPlanOf('not json'), null);
  assert.equal(videoPlanOf(''), null);
  assert.equal(videoPlanOf(JSON.stringify({ shots: [] })), null);
});

test('a post keeps its ask and video plan through its addresses, and reads null as none', async () => {
  const made = await call(postsRoute.POST, { method: 'POST', body: { name: 'Mug video', ask: 'book', videoPlan: plan } });
  assert.equal(made.status, 201);
  assert.equal(made.json.post.ask, 'book');
  assert.deepEqual(videoPlanOf(made.json.post.videoPlan), readVideoPlan(plan).plan);
  assert.equal(made.json.post.fromPostId, null);
  const id = made.json.post.id;
  const read = await call(postRoute.GET, { params: { id: String(id) } });
  assert.deepEqual([read.json.post.ask, read.json.post.videoPlan], [made.json.post.ask, made.json.post.videoPlan]);
  const cleared = await call(postRoute.PATCH, { method: 'PATCH', body: { ask: '', videoPlan: '' }, params: { id: String(id) } });
  assert.deepEqual([cleared.json.post.ask, cleared.json.post.videoPlan], ['', '']);
  assert.equal((await call(postRoute.PATCH, { method: 'PATCH', body: { ask: 'call' }, params: { id: String(id) } })).json.post.ask, 'call');
  for (const ask of ['sell', 'BOOK', 3]) {
    assert.deepEqual(await call(postRoute.PATCH, { method: 'PATCH', body: { ask }, params: { id: String(id) } }), { status: 400, json: { problem: 'refuse.request' } });
  }
  assert.deepEqual(await call(postRoute.PATCH, { method: 'PATCH', body: { videoPlan: { shots: [] } }, params: { id: String(id) } }), { status: 400, json: { problem: 'refuse.post.videoPlan' } });
  assert.equal((await posts.getPostFor(OWNER, id)).post.ask, 'call', 'a refused change keeps what was there');
  // A post kept before these fields existed has them empty: it reads as no ask, no plan, made fresh.
  const old = await modelAction('Post', 'create', { data: { ownerId: OWNER, name: 'Old', createdAt: stamp(), updatedAt: stamp() } });
  assert.equal(old.ask, null);
  const full = await posts.getPostFor(OWNER, old.id);
  assert.deepEqual([full.post.ask, full.post.videoPlan, full.post.fromPostId], ['', '', null]);
});

// --- scheduled ---------------------------------------------------------------------------

test('postState: a version shared after now is scheduled; once its moment passes it is shared', () => {
  const networks = ['instagram', 'x'];
  const version = (network, sharedAt) => ({ network, text: 'Words', sharedAt });
  const now = '2030-05-10T12:00:00.000Z';
  const later = '2030-05-10T12:00:00.001Z';
  assert.deepEqual(postState({ networks, versions: [version('x', later), version('instagram', now)], hasChosenPicture: true, now }),
    { state: 'scheduled', shared: 1, scheduled: 1, of: 2, networks }, 'a version at now is shared; one a millisecond after is still ahead');
  assert.deepEqual(postState({ networks, versions: [version('x', later), version('instagram', later)], hasChosenPicture: true, now }),
    { state: 'scheduled', shared: 0, scheduled: 2, of: 2, networks });
  assert.deepEqual(postState({ networks, versions: [version('x', later), version('instagram', null)], hasChosenPicture: true, now }),
    { state: 'partly', shared: 0, scheduled: 1, of: 2, networks }, 'partly counts a scheduled version as done');
  assert.equal(postState({ networks, versions: [version('x', later), version('instagram', later)], hasChosenPicture: true, now: Date.parse(later) }).state, 'shared', 'now in milliseconds');
  assert.equal(postState({ networks, versions: [version('x', 'not a moment'), version('instagram', now)], hasChosenPicture: true, now }).state, 'shared', 'a moment that is not one reads as shared');
  assert.equal(isAhead(later, now), true);
  assert.equal(isAhead(now, now), false);
  assert.equal(isAhead(null, now), false);
});

test('Mark scheduled keeps the post’s day and time as the moment, 12:00 when it has no time, and refuses a post with no day', async () => {
  const withTime = await posts.createPostFor(OWNER, { name: 'Timed', day: '2031-03-14', time: '18:30' });
  const scheduled = await call(versionRoute.POST, { method: 'POST', body: { action: 'scheduled' }, params: { id: String(withTime.id), network: 'instagram' } });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.json.timeAssumed, false);
  assert.equal(scheduled.json.version.sharedAt, at('2031-03-14', 18, 30), 'the post’s day and time on this computer’s clock');
  const noTime = await posts.createPostFor(OWNER, { name: 'Untimed', day: '2031-03-15' });
  const assumed = await call(versionRoute.POST, { method: 'POST', body: { action: 'scheduled' }, params: { id: String(noTime.id), network: 'x' } });
  assert.deepEqual([assumed.json.timeAssumed, assumed.json.version.sharedAt], [true, at('2031-03-15', 12, 0)]);
  const idea = await posts.createPostFor(OWNER, { name: 'No day' });
  assert.deepEqual(await call(versionRoute.POST, { method: 'POST', body: { action: 'scheduled' }, params: { id: String(idea.id), network: 'x' } }), { status: 400, json: { problem: 'refuse.post.noDay' } });
  assert.equal(await modelAction('PostVersion', 'count', { where: { postId: idea.id } }), 0, 'nothing written for it');
  const theirs = await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', day: '2031-03-14', createdAt: stamp(), updatedAt: stamp() } });
  assert.equal((await call(versionRoute.POST, { method: 'POST', body: { action: 'scheduled' }, params: { id: String(theirs.id), network: 'x' } })).status, 404);
  assert.equal(await modelAction('PostVersion', 'count', { where: { postId: theirs.id } }), 0);

  // The tiles read the state for one moment: before the moment scheduled, after it shared.
  const tile = async (now) => (await posts.listDaysFor(OWNER, '2031-03-14', '2031-03-14', ['instagram'], { now })).find((item) => item.id === withTime.id);
  assert.deepEqual([(await tile(at('2031-03-14', 18, 29))).state, (await tile(at('2031-03-14', 18, 29))).scheduled], ['scheduled', 1]);
  assert.deepEqual([(await tile(at('2031-03-14', 18, 30))).state, (await tile(at('2031-03-14', 18, 30))).scheduled], ['shared', 0]);
  const both = async (now) => (await posts.listDaysFor(OWNER, '2031-03-14', '2031-03-14', ['instagram', 'facebook'], { now })).find((item) => item.id === withTime.id);
  assert.deepEqual(await both(at('2031-03-14', 9, 0)).then((item) => [item.state, item.shared, item.scheduled, item.of]), ['partly', 0, 1, 2]);

  // "I shared it" on a version still scheduled shares it now; Undo clears either.
  const shared = await posts.markSharedFor(OWNER, withTime.id, 'instagram');
  assert.ok(Date.parse(shared.sharedAt) <= Date.now(), 'shared now, not at the planned moment');
  const again = await posts.markSharedFor(OWNER, withTime.id, 'instagram');
  assert.equal(again.sharedAt, shared.sharedAt, 'a later press keeps the moment');
  const undone = await call(versionRoute.POST, { method: 'POST', body: { action: 'unshared' }, params: { id: String(noTime.id), network: 'x' } });
  assert.equal(undone.json.version.sharedAt, null);
  const calls = await measured(() => posts.markScheduledFor(OWNER, noTime.id, 'x'));
  bounded(calls, 'Mark scheduled', 2);
});

// --- sets of pictures ----------------------------------------------------------------------

test('networks say how many pictures a set takes and whether they have stories', () => {
  const most = Object.fromEntries(NETWORK_KEYS.map((key) => [key, networkByKey(key).setMost]));
  assert.deepEqual(most, { instagram: 20, facebook: 10, linkedin: 20, x: 4, threads: 10, bluesky: 4, tiktok: 35, youtube: 1, pinterest: 5, whatsapp: 1, telegram: 10, google: 1 });
  assert.deepEqual(NETWORK_KEYS.filter((key) => networkByKey(key).storyOk), ['instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp']);
  assert.deepEqual([setMostOf('tiktok'), setMostOf('x'), setMostOf('myspace')], [SET_LIMITS.slide, 4, 1]);
  assert.deepEqual(SET_LIMITS, { slide: 20, story: 10 });
});

/** A post with `count` words pictures (the first chosen). */
async function postWithPictures(count, name = 'Set') {
  const post = await posts.createPostFor(OWNER, { name });
  const ids = [];
  for (let index = 0; index < count; index += 1) ids.push((await posts.addPictureFor(OWNER, post.id, { source: 'words', words: `Picture ${index}` })).id);
  return { post, ids };
}
const setOf = (full, kind) => full.pictures.filter((picture) => picture[kind] !== null).sort((a, b) => a[kind] - b[kind]).map((picture) => picture.id);

test('a words picture keeps its layout and subline; a picture kept before them reads as words with none', async () => {
  const { post } = await postWithPictures(0);
  const made = await call(postPicturesRoute.POST, { method: 'POST', body: { source: 'words', words: '20% off', layout: 'offer', subline: 'Until Friday' }, params: { id: String(post.id) } });
  assert.equal(made.status, 201);
  assert.deepEqual([made.json.picture.layout, made.json.picture.subline, made.json.picture.slide, made.json.picture.story], ['offer', 'Until Friday', null, null]);
  for (const layout of ['words', 'tip', 'offer', 'quote', 'event']) assert.equal((await posts.updatePictureFor(OWNER, made.json.picture.id, { layout })).layout, layout);
  assert.deepEqual(await call(pictureRoute.PATCH, { method: 'PATCH', body: { layout: 'poster' }, params: { id: String(made.json.picture.id) } }), { status: 400, json: { problem: 'refuse.request' } });
  assert.equal((await posts.updatePictureFor(OWNER, made.json.picture.id, { subline: 'a'.repeat(posts.SUBLINE_MOST) })).subline.length, posts.SUBLINE_MOST);
  await assert.rejects(posts.updatePictureFor(OWNER, made.json.picture.id, { subline: 'a'.repeat(posts.SUBLINE_MOST + 1) }), refusedWith('refuse.text.long'));
  // A new layout or subline clears the kept copies (they are drawn with them); the same one does not.
  await posts.updatePictureFor(OWNER, made.json.picture.id, { shapes: { square: digest(5) } });
  assert.equal((await posts.updatePictureFor(OWNER, made.json.picture.id, { layout: 'event' })).shapes.square, digest(5).slice(0, 12));
  assert.equal((await posts.updatePictureFor(OWNER, made.json.picture.id, { layout: 'quote' })).shapes.square, null);
  await posts.updatePictureFor(OWNER, made.json.picture.id, { shapes: { square: digest(6) } });
  assert.equal((await posts.updatePictureFor(OWNER, made.json.picture.id, { subline: 'Saturday' })).shapes.square, null);
  // Only a words picture has a layout.
  const photo = await posts.addPictureFor(OWNER, post.id, { source: 'photo', file: digest(9), width: 10, height: 10 });
  await assert.rejects(posts.updatePictureFor(OWNER, photo.id, { layout: 'tip' }), refusedWith('refuse.request'));
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'photo', file: digest(9), width: 10, height: 10, subline: 'x' }), refusedWith('refuse.request'));
  const old = await modelAction('PostPicture', 'create', { data: { ownerId: OWNER, postId: post.id, source: 'words', words: 'Old', position: 9, createdAt: stamp() } });
  const read = (await posts.getPostFor(OWNER, post.id)).pictures.find((picture) => picture.id === old.id);
  assert.deepEqual([read.layout, read.subline, read.slide, read.story], ['words', '', null, null]);
});

test('a set is ordered as sent; its first is the cover; another post’s picture or one named twice is refused', async () => {
  const { post, ids } = await postWithPictures(5);
  const ordered = [ids[3], ids[1], ids[4]];
  const answer = await call(setsRoute.PUT, { method: 'PUT', body: { pictureIds: ordered }, params: { id: String(post.id), kind: 'slide' } });
  assert.equal(answer.status, 200);
  assert.deepEqual(setOf(answer.json.post, 'slide'), ordered);
  assert.deepEqual(answer.json.post.pictures.filter((picture) => picture.chosen).map((picture) => picture.id), [ids[3]], 'the first of the swipe set is the chosen picture');
  const story = await posts.setPictureSetFor(OWNER, post.id, 'story', [ids[0], ids[2]]);
  assert.deepEqual([setOf(story, 'story'), setOf(story, 'slide')], [[ids[0], ids[2]], ordered], 'the two sets stand apart');
  assert.equal(story.pictures.find((picture) => picture.chosen).id, ids[3], 'a story set does not change the cover');
  const reordered = await posts.setPictureSetFor(OWNER, post.id, 'slide', [ids[4], ids[3]]);
  assert.deepEqual(setOf(reordered, 'slide'), [ids[4], ids[3]], 'a picture left out leaves the set and stays a picture');
  assert.equal(reordered.pictures.length, 5);
  const { ids: foreign } = await postWithPictures(1, 'Another');
  await assert.rejects(posts.setPictureSetFor(OWNER, post.id, 'slide', [ids[0], foreign[0]]), refusedWith('refuse.request'));
  await assert.rejects(posts.setPictureSetFor(OWNER, post.id, 'slide', [ids[0], ids[0]]), refusedWith('refuse.request'));
  await assert.rejects(posts.setPictureSetFor(OWNER, post.id, 'reel', [ids[0]]), refusedWith('refuse.request'));
  assert.equal((await call(setsRoute.PUT, { method: 'PUT', body: { pictureIds: [ids[0]] }, params: { id: String(post.id), kind: 'reel' } })).status, 404);
  assert.deepEqual(setOf(await posts.getPostFor(OWNER, post.id), 'slide'), [ids[4], ids[3]], 'a refused order changes nothing');
  const theirs = await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', createdAt: stamp(), updatedAt: stamp() } });
  assert.equal(await posts.setPictureSetFor(OWNER, theirs.id, 'slide', []), null);
  assert.deepEqual(setOf(await posts.setPictureSetFor(OWNER, post.id, 'slide', []), 'slide'), [], 'an empty list empties the set');
});

test('a set holds at most 20 slides and 10 story frames', async () => {
  const { post, ids } = await postWithPictures(LIMITS.picturesPerPost);
  assert.equal(setOf(await posts.setPictureSetFor(OWNER, post.id, 'slide', ids.slice(0, SET_LIMITS.slide)), 'slide').length, SET_LIMITS.slide);
  await assert.rejects(posts.setPictureSetFor(OWNER, post.id, 'slide', [...ids, 999999]), refusedWith('refuse.picture.slidesFull'));
  assert.equal(setOf(await posts.setPictureSetFor(OWNER, post.id, 'story', ids.slice(0, SET_LIMITS.story)), 'story').length, SET_LIMITS.story);
  await assert.rejects(posts.setPictureSetFor(OWNER, post.id, 'story', ids.slice(0, SET_LIMITS.story + 1)), refusedWith('refuse.picture.storyFull'));
});

test('choosing a picture makes it the first slide; removing the cover makes the next slide the cover', async () => {
  const { post, ids } = await postWithPictures(4);
  await posts.setPictureSetFor(OWNER, post.id, 'slide', [ids[0], ids[1], ids[2]]);
  await posts.choosePictureFor(OWNER, ids[2]);
  assert.deepEqual(setOf(await posts.getPostFor(OWNER, post.id), 'slide'), [ids[2], ids[0], ids[1]]);
  await posts.choosePictureFor(OWNER, ids[3]);
  let full = await posts.getPostFor(OWNER, post.id);
  assert.deepEqual(setOf(full, 'slide'), [ids[3], ids[2], ids[0], ids[1]], 'a picture out of the set joins it first');
  assert.equal(full.pictures.find((picture) => picture.chosen).id, ids[3]);
  assert.equal(await posts.deletePictureFor(OWNER, ids[3]), true);
  full = await posts.getPostFor(OWNER, post.id);
  assert.equal(full.pictures.find((picture) => picture.chosen).id, ids[2], 'the next of the set, not the next by place');
  // A post with no set: choosing changes no set.
  const plain = await postWithPictures(2, 'Plain');
  await posts.choosePictureFor(OWNER, plain.ids[1]);
  assert.deepEqual(setOf(await posts.getPostFor(OWNER, plain.post.id), 'slide'), []);
  // A full set loses its last when a picture from outside becomes the cover.
  const many = await postWithPictures(LIMITS.picturesPerPost, 'Full');
  await posts.setPictureSetFor(OWNER, many.post.id, 'slide', many.ids.slice(0, SET_LIMITS.slide));
  await assert.rejects(posts.addPictureFor(OWNER, many.post.id, { source: 'words', words: 'One more' }), refusedWith('refuse.picture.tooMany'));
  await posts.deletePictureFor(OWNER, many.ids[19]);
  const extra = await posts.addPictureFor(OWNER, many.post.id, { source: 'words', words: 'Outside' });
  await posts.setPictureSetFor(OWNER, many.post.id, 'slide', many.ids.slice(0, 19));
  await posts.choosePictureFor(OWNER, extra.id);
  const set = setOf(await posts.getPostFor(OWNER, many.post.id), 'slide');
  assert.deepEqual(set, [extra.id, ...many.ids.slice(0, 19)]);
});

test('Make slides keeps words pictures as a set in one batch, all or nothing, within 20 pictures a post', async () => {
  const { post, ids } = await postWithPictures(1);
  const items = [{ words: 'Stop scrolling' }, { words: 'Three days of work', layout: 'tip' }, { words: 'Book a class', layout: 'event', subline: 'Saturday 10:00' }];
  const made = await call(setsRoute.POST, { method: 'POST', body: { items }, params: { id: String(post.id), kind: 'slide' } });
  assert.equal(made.status, 201);
  const slides = setOf(made.json.post, 'slide');
  assert.equal(slides.length, 4);
  assert.equal(slides[0], ids[0], 'the chosen picture stays the cover and the first slide');
  const created = slides.slice(1).map((id) => made.json.post.pictures.find((picture) => picture.id === id));
  assert.deepEqual(created.map((picture) => [picture.source, picture.words, picture.layout, picture.subline]), [
    ['words', 'Stop scrolling', 'words', ''], ['words', 'Three days of work', 'tip', ''], ['words', 'Book a class', 'event', 'Saturday 10:00'],
  ]);
  // A story set on a post with no picture: its first frame becomes the chosen picture.
  const bare = await posts.createPostFor(OWNER, { name: 'Bare' });
  const story = await posts.saveWordsSetFor(OWNER, bare.id, 'story', [{ words: 'One' }, { words: 'Two' }]);
  assert.deepEqual(setOf(story, 'story').map((id) => story.pictures.find((picture) => picture.id === id).words), ['One', 'Two']);
  assert.equal(story.pictures.find((picture) => picture.chosen).words, 'One');
  // All or nothing: one item refused, nothing written.
  const count = async () => modelAction('PostPicture', 'count', { where: { postId: post.id } });
  const before = await count();
  await assert.rejects(posts.saveWordsSetFor(OWNER, post.id, 'slide', [{ words: 'Fine' }, { words: '' }]), refusedWith('refuse.text.missing'));
  await assert.rejects(posts.saveWordsSetFor(OWNER, post.id, 'slide', [{ words: 'Fine', layout: 'poster' }]), refusedWith('refuse.request'));
  await assert.rejects(posts.saveWordsSetFor(OWNER, post.id, 'slide', []), refusedWith('refuse.request'));
  assert.equal(await count(), before);
  // The 20-picture limit: 4 now; 16 more fit, 17 do not, refused before anything is written.
  await assert.rejects(posts.saveWordsSetFor(OWNER, post.id, 'slide', Array.from({ length: 17 }, (_, index) => ({ words: `${index}` }))), refusedWith('refuse.picture.tooMany'));
  assert.equal(await count(), before);
  // A swipe set of the cover and 19 more is full: 20 new ones are refused before the picture limit is even reached.
  const empty = await postWithPictures(1, 'Cover only');
  await assert.rejects(posts.saveWordsSetFor(OWNER, empty.post.id, 'slide', Array.from({ length: 20 }, (_, index) => ({ words: `${index}` }))), refusedWith('refuse.picture.slidesFull'));
  assert.equal(setOf(await posts.saveWordsSetFor(OWNER, empty.post.id, 'slide', Array.from({ length: 19 }, (_, index) => ({ words: `${index}` }))), 'slide').length, 20);
  await assert.rejects(posts.saveWordsSetFor(OWNER, bare.id, 'story', Array.from({ length: 11 }, () => ({ words: 'x' }))), refusedWith('refuse.picture.storyFull'));
  // Make slides again with replace: the old set's own words pictures go (not the cover, not one in the story set).
  await posts.setPictureSetFor(OWNER, post.id, 'story', [slides[1]]);
  const again = await call(setsRoute.POST, { method: 'POST', body: { items: [{ words: 'New one' }], replace: true }, params: { id: String(post.id), kind: 'slide' } });
  const left = again.json.post.pictures.map((picture) => picture.id);
  assert.ok(left.includes(ids[0]) && left.includes(slides[1]), 'the cover and the story frame stay');
  assert.ok(!left.includes(slides[2]) && !left.includes(slides[3]), 'the old slides go');
  assert.equal(setOf(again.json.post, 'slide').length, 2);
  // Without replace the old slides stay pictures, out of the set.
  const kept = await posts.saveWordsSetFor(OWNER, post.id, 'slide', [{ words: 'Newer' }]);
  assert.equal(kept.pictures.length, again.json.post.pictures.length + 1);
  assert.equal((await call(setsRoute.POST, { method: 'POST', body: { items: [{ words: 'x' }], replace: 'yes' }, params: { id: String(post.id), kind: 'slide' } })).status, 400);
  const theirs = await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', createdAt: stamp(), updatedAt: stamp() } });
  assert.equal((await call(setsRoute.POST, { method: 'POST', body: { items: [{ words: 'x' }] }, params: { id: String(theirs.id), kind: 'slide' } })).status, 404);
  assert.equal(await modelAction('PostPicture', 'count', { where: { postId: theirs.id } }), 0);
});

test('the set addresses at their largest stay within Tellop’s records bounds', async () => {
  const longest = 'ş'.repeat(LIMITS.pictureWords);
  const post = await posts.createPostFor(OWNER, { name: 'ş'.repeat(LIMITS.name) });
  const items = Array.from({ length: SET_LIMITS.slide }, () => ({ words: longest, layout: 'quote', subline: 'ş'.repeat(posts.SUBLINE_MOST) }));
  const made = await measured(() => call(setsRoute.POST, { method: 'POST', body: { items }, params: { id: String(post.id), kind: 'slide' } }));
  assert.equal(made.value.status, 201);
  bounded(made, 'POST /api/posts/[id]/sets/slide', 5);
  assert.ok(mostInFlight(made) <= 1);
  const ids = setOf(made.value.json.post, 'slide');
  const order = await measured(() => call(setsRoute.PUT, { method: 'PUT', body: { pictureIds: [...ids].reverse() }, params: { id: String(post.id), kind: 'slide' } }));
  assert.equal(order.value.status, 200);
  bounded(order, 'PUT /api/posts/[id]/sets/slide', 5);
  const choose = await measured(() => call(pictureRoute.PATCH, { method: 'PATCH', body: { chosen: true }, params: { id: String(ids[10]) } }));
  bounded(choose, 'PATCH /api/pictures/[id] chosen', 5);
});

// --- follow-ups and offer codes ------------------------------------------------------------

test('an enquiry keeps a follow-up day and an offer code, and refuses one that is not', async () => {
  const made = await call(enquiriesRoute.POST, { method: 'POST', body: { name: 'Elif', followUpOn: '2026-11-02', code: 'BAHAR20' } });
  assert.equal(made.status, 200);
  assert.deepEqual([made.json.enquiry.followUpOn, made.json.enquiry.code], ['2026-11-02', 'BAHAR20']);
  const id = String(made.json.enquiry.id);
  const change = (body) => call(enquiryRoute.PATCH, { method: 'PATCH', body, params: { id } });
  assert.deepEqual([(await change({ followUpOn: null })).json.enquiry.followUpOn, (await change({ code: '' })).json.enquiry.code], [null, '']);
  assert.equal((await change({ followUpOn: '' })).json.enquiry.followUpOn, null);
  assert.equal((await change({ code: '  İNDİRİM10 ' })).json.enquiry.code, 'İNDİRİM10', 'letters of any alphabet, trimmed');
  assert.equal((await change({ code: 'ab' })).json.enquiry.code, 'ab');
  assert.equal((await change({ code: 'a'.repeat(24) })).json.enquiry.code.length, 24);
  for (const code of ['a', 'a'.repeat(25), 'SALE-20', 'SALE 20', '%20', 20]) {
    assert.deepEqual(await change({ code }), { status: 400, json: { problem: 'refuse.customers.code' } }, String(code));
  }
  for (const followUpOn of ['2026-02-30', '02-11-2026', 'tomorrow', 5]) {
    assert.deepEqual(await change({ followUpOn }), { status: 400, json: { problem: 'refuse.customers.followUpOn' } }, String(followUpOn));
  }
  assert.equal((await change({ name: 'Elif K.' })).json.enquiry.code, 'a'.repeat(24), 'a change of another field keeps them');
  const old = await modelAction('Enquiry', 'create', { data: { ownerId: OWNER, name: 'Old', receivedOn: '2026-01-01', createdAt: stamp(), updatedAt: stamp() } });
  const read = await customers.getEnquiryFor(OWNER, old.id);
  assert.deepEqual([read.followUpOn, read.code], [null, ''], 'an enquiry kept before them reads as none');
});

test('follow-ups due: new or talking, on or before today, oldest first, 20 and one more to say there are more, the owner’s only', async () => {
  const today = '2035-06-15';
  const add = (fields) => modelAction('Enquiry', 'create', { data: { ownerId: OWNER, name: 'Due', receivedOn: '2035-06-01', createdAt: stamp(), updatedAt: stamp(), ...fields } });
  const late = await add({ followUpOn: '2035-06-10', status: 'talking', contact: '+90 532 000 00 00' });
  const exactly = await add({ followUpOn: today, status: 'new' });
  await add({ followUpOn: '2035-06-16', status: 'new' });
  await add({ followUpOn: '2035-06-09', status: 'bought' });
  await add({ followUpOn: '2035-06-09', status: 'not-now' });
  await add({ followUpOn: null, status: 'new' });
  await modelAction('Enquiry', 'create', { data: { ownerId: OTHER, name: 'Theirs', followUpOn: '2035-06-01', status: 'new', receivedOn: '2035-06-01', createdAt: stamp(), updatedAt: stamp() } });
  const due = await customers.listFollowUpsDueFor(OWNER, today);
  assert.deepEqual(due.map((item) => item.id), [late.id, exactly.id]);
  assert.deepEqual(Object.keys(due[0]).sort(), ['askedAbout', 'channel', 'code', 'contact', 'followUpOn', 'id', 'name', 'postId', 'receivedOn', 'status']);
  assert.equal(due[0].contact, '+90 532 000 00 00');
  await assert.rejects(customers.listFollowUpsDueFor(OWNER, '2035-6-15'), refusedWith('refuse.request'));
  // 18 more due: 20 in all, all answered, none past the most.
  for (let index = 0; index < 18; index += 1) await add({ followUpOn: '2035-05-01', status: 'new', name: 'ş'.repeat(LIMITS.name), contact: 'ş'.repeat(LIMITS.profileField), askedAbout: 'ş'.repeat(LIMITS.profileField) });
  const { FOLLOW_UPS_LISTED, listedFollowUps } = await import('../app/calendar/follow-ups.js');
  assert.equal(FOLLOW_UPS_LISTED, customers.FOLLOW_UPS_MOST, 'the card lists as many as the read answers');
  const twenty = await customers.listFollowUpsDueFor(OWNER, today);
  assert.equal(twenty.length, customers.FOLLOW_UPS_MOST);
  assert.equal(listedFollowUps(twenty).more, false, 'exactly 20: no "and more"');
  // Two more: 22 due, 21 answered (the one past the most only says there are more), the card lists 20.
  for (let index = 0; index < 2; index += 1) await add({ followUpOn: '2035-05-01', status: 'new', name: 'ş'.repeat(LIMITS.name), contact: 'ş'.repeat(LIMITS.profileField), askedAbout: 'ş'.repeat(LIMITS.profileField) });
  const read = await measured(() => customers.listFollowUpsDueFor(OWNER, today));
  bounded(read, 'follow-ups due', 1);
  assert.equal(read.value.length, customers.FOLLOW_UPS_MOST + 1);
  assert.equal(read.value[0].followUpOn, '2035-05-01');
  const listed = listedFollowUps(read.value);
  assert.deepEqual([listed.people.length, listed.more], [customers.FOLLOW_UPS_MOST, true]);
  assert.ok(!listed.people.some((item) => item.id === exactly.id), 'the newest one waits for room');
  assert.deepEqual(listedFollowUps(null), { people: [], more: false });
});

test('the calendar lists the follow-ups due only when it shows today', async () => {
  const today = '2036-02-11';
  // An owner of its own, so the follow-ups of the checks above do not fill the card.
  const owner = 'calendar-owner';
  await modelAction('Enquiry', 'create', { data: { ownerId: owner, name: 'Ask again', followUpOn: '2036-02-10', status: 'new', receivedOn: '2036-02-01', createdAt: stamp(), updatedAt: stamp() } });
  const shown = await measured(() => readCalendar({ owner, query: {}, today, locale: 'en' }));
  bounded(shown, 'the calendar with follow-ups', 15);
  assert.deepEqual(shown.value.followUps.map((item) => item.name), ['Ask again']);
  const away = await readCalendar({ owner, query: { month: '2036-05' }, today, locale: 'en' });
  assert.equal(away.followUps, null);
});

// --- followers ----------------------------------------------------------------------------

test('followers: one number a month for each platform, 0 to 1,000,000,000, the owner’s only', async () => {
  const month = '2026-09';
  assert.deepEqual(await followers.followersFor(OWNER, month), {});
  const put = (body) => call(followersRoute.PUT, { method: 'PUT', body });
  assert.deepEqual(await put({ month, network: 'instagram', count: 0 }), { status: 200, json: { month, network: 'instagram', count: 0 } });
  assert.deepEqual((await put({ month, network: 'instagram', count: followers.FOLLOWERS_MOST })).json.count, followers.FOLLOWERS_MOST);
  assert.deepEqual(await put({ month, network: 'instagram', count: followers.FOLLOWERS_MOST + 1 }), { status: 400, json: { problem: 'refuse.number' } });
  for (const count of [-1, 1.5, '12', true]) assert.deepEqual(await put({ month, network: 'instagram', count }), { status: 400, json: { problem: 'refuse.number' } }, String(count));
  for (const body of [{ month: '2026-9', network: 'instagram', count: 1 }, { month, network: 'myspace', count: 1 }, { month, network: 'instagram' }]) {
    assert.deepEqual(await put(body), { status: 400, json: { problem: 'refuse.request' } }, JSON.stringify(body));
  }
  await put({ month, network: 'tiktok', count: 40 });
  await put({ month, network: 'tiktok', count: 45 });
  assert.equal(await modelAction('Followers', 'count', { where: { ownerId: OWNER, month, network: 'tiktok' } }), 1, 'kept in place of the one before');
  await modelAction('Followers', 'create', { data: { ownerId: OTHER, month, network: 'x', count: 9, createdAt: stamp(), updatedAt: stamp() } });
  const read = await call(followersRoute.GET, { url: `http://localhost/api/followers?month=${month}` });
  assert.deepEqual(read.json, { month, followers: { instagram: followers.FOLLOWERS_MOST, tiktok: 45 } });
  assert.deepEqual(await put({ month, network: 'tiktok', count: null }), { status: 200, json: { month, network: 'tiktok', count: null } });
  assert.deepEqual(await followers.followersFor(OWNER, month), { instagram: followers.FOLLOWERS_MOST });
  assert.equal((await call(followersRoute.GET, { url: 'http://localhost/api/followers?month=2026-13' })).status, 400);
  assert.equal(await modelAction('Followers', 'count', { where: { ownerId: OTHER } }), 1, 'theirs untouched');
  const measuredRead = await measured(() => followers.followersFor(OWNER, month));
  bounded(measuredRead, 'followers', 1);
});
