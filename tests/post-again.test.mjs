/**
 * Post again, the posts Fill my month brings back, and the month's mix check:
 * the copy (what it takes and what it never takes), its day, its address,
 * the bring-back read and its proposals, Keep these with copies, both Fill my
 * month addresses, and the mix line's rule. Records run against a throwaway
 * store (`APP_DATA_FILE` in a temporary folder, removed afterwards); the reads
 * and the addresses also run through Tellop's records hook
 * (`tests/records-bounds.mjs`), which measures every call.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'post-again-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const posts = await import('../lib/data/posts.js');
const plan = await import('../lib/data/plan.js');
const customers = await import('../lib/data/customers.js');
const campaigns = await import('../lib/data/campaigns.js');
const proposals = await import('../app/calendar/proposals.js');
const rules = await import('../app/calendar/rules.js');
const copyRoute = await import('../app/api/posts/[id]/copy/route.js');
const planRoute = await import('../app/api/month/plan/route.js');
const keepRoute = await import('../app/api/month/keep/route.js');
const fillMonthRoute = await import('../app/api/ai/fill-month/route.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
const { SHAPE_KEYS, SHAPES } = await import('../lib/plan/shapes.js');
const { addDays, addMonths, daysInMonth, monthOf, todayCivil } = await import('../lib/plan/days.js');
const { CONTENT_END, CONTENT_START } = await import('../lib/plan/ai-words.js');
const { bounded, localBatch, measured, mostInFlight } = await import('./records-bounds.mjs');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const digest = (letter) => letter.repeat(64);
const tagOf = (letter) => letter.repeat(12);

/** A refusal with this words key. @param {string} key */
const refusedWith = (key) => (error) => error instanceof DataError && error.messageKey === key;

/** Calls an address with a real request. */
async function call(handler, { method = 'POST', body, raw, type = 'application/json', id } = {}) {
  const init = { method, headers: { 'content-type': type } };
  if (method !== 'GET') init.body = raw ?? JSON.stringify(body ?? {});
  const request = new Request('http://localhost/api/test', init);
  const response = await handler(request, { params: Promise.resolve(id === undefined ? {} : { id: String(id) }) });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

/** Every post of an owner. */
async function allPosts(owner) {
  return modelAction('Post', 'findMany', { where: { ownerId: owner }, orderBy: { id: 'asc' }, take: 256 });
}

/** Every picture row of one post, by position. */
async function pictureRows(owner, postId) {
  return modelAction('PostPicture', 'findMany', { where: { ownerId: owner, postId }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 64 });
}

/**
 * Runs `work` with a records hook that runs each call on the local store but
 * fails the calls `fails` names (by their steps), as a records route that
 * does not answer would.
 */
async function withFailingCalls(fails, work) {
  const ACTION = Symbol.for('tellop.internalRecordsAction');
  const store = globalThis[Symbol.for('tellop.template.storage')];
  const run = (records, step) => records[step.model[0].toLowerCase() + step.model.slice(1)][step.action](step.args ?? {});
  globalThis[ACTION] = async (steps) => {
    if (fails(steps)) throw new Error('records-delivery-uncertain');
    if (steps.length === 1) return [await run(store.client, steps[0])];
    return localBatch(steps);
  };
  const prior = process.env.TELLOP_INTERNAL_RECORDS;
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  try {
    return await work();
  } finally {
    if (prior === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
    else process.env.TELLOP_INTERNAL_RECORDS = prior;
    delete globalThis[ACTION];
  }
}

/** Whether a call keeps a copy's pictures (its second write). */
const keepsCopyPictures = (steps) => steps.some((step) => step.model === 'PostPicture' && step.action === 'createManyAndReturn');

// --- the copy ------------------------------------------------------------------------

/** A post with words on three networks (one switched off), a share, results, and five pictures in both sets. */
async function richPost(owner) {
  await plan.saveProfileFor(owner, { networks: 'instagram,facebook,x', postsPerWeek: 3 });
  const theme = await plan.addThemeFor(owner, { name: 'New pieces' });
  const campaign = await campaigns.addCampaignFor(owner, { name: 'Spring sale', startsOn: '2031-03-01', endsOn: '2031-03-31' });
  const source = await posts.createPostFor(owner, { name: 'Spring menu', day: '2031-03-10', time: '18:30', themeId: theme.id, campaignId: campaign.id, specialDay: 'womensDay' });
  await posts.updatePostFor(owner, source.id, {
    mainText: 'Our spring menu is here.',
    ask: 'book',
    videoPlan: { hook: 'Look at this', shots: [{ what: 'The new plate', seconds: 5 }], onScreen: ['Spring menu'], cover: 'The plate' },
  });
  await posts.saveVersionsFor(owner, source.id, [
    { network: 'instagram', text: 'Instagram words', hashtags: '#spring #menu', link: 'https://example.com/menu', firstComment: 'First!' },
    { network: 'facebook', text: 'Facebook words', link: 'https://example.com/fb' },
    { network: 'x', text: 'X words' },
  ], { replace: true });
  await posts.saveVersionFor(owner, source.id, 'x', { on: false });
  await posts.markSharedFor(owner, source.id, 'instagram', { sharedLink: 'https://instagram.com/p/abc' });
  await posts.saveResultsFor(owner, source.id, 'instagram', { views: 120, likes: 9 });
  const photo = await posts.addPictureFor(owner, source.id, { source: 'photo', file: digest('a'), width: 1200, height: 900, description: 'The plate' });
  await posts.updatePictureFor(owner, photo.id, { focusX: 0.25, focusY: 0.75, fit: 'fill' });
  await posts.updatePictureFor(owner, photo.id, { shapes: { square: digest('b'), story: digest('c') } });
  const words = await posts.addPictureFor(owner, source.id, { source: 'words', words: 'Spring is here', layout: 'offer', subline: 'From Monday' });
  const drawn = await posts.addPictureFor(owner, source.id, { source: 'drawn', file: digest('d'), prompt: 'A sunny shop window', width: 1024, height: 1024 });
  const changed = await posts.addPictureFor(owner, source.id, { source: 'changed', file: digest('e'), prompt: 'A sunny shop window', change: 'Make it warmer', fromPictureId: drawn.id, width: 1024, height: 1024 });
  const comment = await customers.addCommentFor(owner, { text: 'Lovely food', bestLine: 'Lovely', name: 'Ayşe', stars: 5, permission: 'yes' });
  const card = await posts.addPictureFor(owner, source.id, { source: 'card', commentId: comment.id });
  await posts.setPictureSetFor(owner, source.id, 'slide', [photo.id, words.id, card.id]);
  await posts.setPictureSetFor(owner, source.id, 'story', [drawn.id, changed.id]);
  return { theme, campaign, source, photo, words, drawn, changed, card, comment };
}

test('Post again copies the name, main words, theme, campaign, ask, video plan, hashtags, links and pictures, never the words for each network, shares or results', async () => {
  const owner = 'copy-owner';
  const made = await richPost(owner);
  const before = await posts.getPostFor(owner, made.source.id);

  const run = await measured(() => posts.copyPostFor(owner, made.source.id, { day: '2031-04-14' }));
  bounded(run, 'Post again', 4);
  assert.equal(mostInFlight(run), 1, 'one call at a time');
  const copy = run.value;
  assert.notEqual(copy.post.id, made.source.id);
  assert.deepEqual(
    { ...copy.post, id: 0, createdAt: '', updatedAt: '' },
    {
      id: 0, name: 'Spring menu', mainText: 'Our spring menu is here.', day: '2031-04-14', time: null, themeId: made.theme.id, campaignId: made.campaign.id,
      specialDay: null, madeBy: 'person', createdAt: '', updatedAt: '', ask: 'book', videoPlan: before.post.videoPlan, fromPostId: made.source.id,
    },
  );

  const full = await posts.getPostFor(owner, copy.post.id);
  assert.deepEqual(full.post, copy.post);
  // Instagram keeps its hashtags and link, Facebook its link, X stays switched off: no words, no share, no results, no first comment.
  assert.deepEqual(full.versions.map((version) => [version.network, version.on, version.text, version.hashtags, version.link, version.firstComment,
    version.sharedAt, version.sharedLink, version.views, version.likes, version.changedByPerson]), [
    ['instagram', true, '', '#spring #menu', 'https://example.com/menu', '', null, null, null, null, false],
    ['facebook', true, '', '', 'https://example.com/fb', '', null, null, null, null, false],
    ['x', false, '', '', '', '', null, null, null, null, false],
  ]);
  assert.deepEqual(copy.versions.map((version) => version.network), ['instagram', 'facebook', 'x']);

  const strip = (picture) => ({ ...picture, id: 0, postId: 0, createdAt: '' });
  assert.equal(full.pictures.length, 5);
  assert.deepEqual(full.pictures.map(strip), before.pictures.map(strip), 'the same files, shape copies, order, sets, layouts and card');
  assert.deepEqual(full.pictures.filter((picture) => picture.chosen).map((picture) => picture.position), [made.photo.position], 'one chosen picture: the same');
  assert.ok(full.pictures.every((picture) => !before.pictures.some((old) => old.id === picture.id)), 'new picture rows');
  assert.deepEqual(copy.pictures.map(strip), full.pictures.map((picture) => strip({ ...picture, card: null })), 'the copy answers its pictures, cards without their words');
  const rows = await pictureRows(owner, copy.post.id);
  assert.deepEqual(rows.map((row) => row.prompt), (await pictureRows(owner, made.source.id)).map((row) => row.prompt), 'the prompts come along');
  assert.ok(rows.every((row) => row.fromPictureId === null), 'a copy names no picture of another post');
  assert.equal(rows.find((row) => row.source === 'changed').change, 'Make it warmer');

  assert.deepEqual(await posts.getPostFor(owner, made.source.id), before, 'the post copied is unchanged');
  const comments = await modelAction('CustomerComment', 'count', { where: { ownerId: owner } });
  assert.equal(comments, 1, 'the comment is not copied');
});

test('a copy never links to an archived theme, keeps an idea with no day, and refuses a day that is not one', async () => {
  const owner = 'archive-owner';
  const theme = await plan.addThemeFor(owner, { name: 'Old line' });
  const source = await posts.createPostFor(owner, { name: 'Old post', day: '2030-01-05', themeId: theme.id });
  assert.equal(await plan.removeThemeFor(owner, theme.id), 'archived');
  const copy = await posts.copyPostFor(owner, source.id, { day: '2030-02-01' });
  assert.equal(copy.post.themeId, null);
  assert.deepEqual(copy.pictures, []);
  assert.deepEqual(copy.versions, []);

  const idea = await posts.copyPostFor(owner, source.id);
  assert.equal(idea.post.day, null);
  assert.equal((await posts.copyPostFor(owner, source.id, { day: null })).post.day, null);
  await assert.rejects(posts.copyPostFor(owner, source.id, { day: '2030-02-30' }), refusedWith('refuse.post.day'));
  await assert.rejects(posts.copyPostFor(owner, source.id, { day: 20300201 }), refusedWith('refuse.post.day'));

  assert.equal(await posts.copyPostFor('someone-else', source.id, { day: '2030-02-01' }), null, 'another owner\'s post is not found');
  assert.equal(await posts.copyPostFor(owner, 0), null);
  assert.equal(await posts.copyPostFor(owner, source.id + 1000), null);
  assert.equal((await allPosts('someone-else')).length, 0);
});

test('a copy goes into a month holding 255 posts, not one holding 256', async () => {
  const owner = 'full-owner';
  const source = await posts.createPostFor(owner, { name: 'Busy' });
  const at = new Date().toISOString();
  const data = Array.from({ length: 255 }, (_, index) => ({ ownerId: owner, name: `Post ${index}`, day: `2032-07-${String((index % 31) + 1).padStart(2, '0')}`, createdAt: at, updatedAt: at }));
  await modelAction('Post', 'createMany', { data });
  const copy = await posts.copyPostFor(owner, source.id, { day: '2032-07-31' });
  assert.equal(copy.post.day, '2032-07-31');
  await assert.rejects(posts.copyPostFor(owner, source.id, { day: '2032-07-01' }), refusedWith('refuse.post.monthFull'));
  assert.equal((await posts.copyPostFor(owner, source.id, { day: '2032-08-01' })).post.day, '2032-08-01', 'another month still takes it');
});

test('a copy takes at most 20 pictures, the first by position, and exactly one chosen', async () => {
  const owner = 'many-owner';
  const source = await posts.createPostFor(owner, { name: 'Many' });
  const at = new Date().toISOString();
  // 22 rows (more than a post can be given one by one), the chosen one past the twentieth.
  await modelAction('PostPicture', 'createMany', {
    data: Array.from({ length: 22 }, (_, index) => ({ ownerId: owner, postId: source.id, source: 'words', words: `Slide ${index + 1}`, position: index + 1, chosen: index === 21, createdAt: at })),
  });
  const copy = await posts.copyPostFor(owner, source.id, { day: '2033-01-01' });
  assert.equal(copy.pictures.length, LIMITS.picturesPerPost);
  assert.deepEqual(copy.pictures.map((picture) => picture.words), Array.from({ length: 20 }, (_, index) => `Slide ${index + 1}`));
  assert.deepEqual(copy.pictures.filter((picture) => picture.chosen).map((picture) => picture.words), ['Slide 1'], 'the chosen one was left out: the first is chosen');

  // Two chosen rows (two pictures added at once): only the first stays chosen.
  const twice = await posts.createPostFor(owner, { name: 'Twice' });
  await modelAction('PostPicture', 'createMany', {
    data: [3, 1, 2].map((position) => ({ ownerId: owner, postId: twice.id, source: 'words', words: `W${position}`, position, chosen: position !== 1, createdAt: at })),
  });
  const again = await posts.copyPostFor(owner, twice.id, { day: '2033-01-02' });
  assert.deepEqual(again.pictures.map((picture) => [picture.words, picture.chosen]), [['W1', false], ['W2', true], ['W3', false]]);
});

test('Post again at its largest stays within Tellop\'s bounds: the longest words, every network, 20 pictures with every shape', async () => {
  const owner = 'large-owner';
  const long = (count) => 'ş'.repeat(count);
  const source = await posts.createPostFor(owner, { name: long(LIMITS.name), day: '2034-05-05' });
  await posts.updatePostFor(owner, source.id, { mainText: long(LIMITS.mainText) });
  const tags = Array.from({ length: LIMITS.hashtags }, (_, index) => `#${String(index).padStart(2, '0')}${long(LIMITS.hashtagLength - 3)}`).join(' ');
  const link = `https://example.com/${'a'.repeat(LIMITS.link - 20)}`;
  const at = new Date().toISOString();
  await modelAction('PostVersion', 'createMany', {
    data: NETWORK_KEYS.map((network) => ({ ownerId: owner, postId: source.id, network, text: long(LIMITS.versionText), hashtags: tags, link, firstComment: long(LIMITS.firstComment), updatedAt: at })),
  });
  await modelAction('PostPicture', 'createMany', {
    data: Array.from({ length: LIMITS.picturesPerPost }, (_, index) => ({
      ownerId: owner, postId: source.id, source: 'changed', file: digest('f'), prompt: long(LIMITS.mainText), change: long(LIMITS.change), words: long(LIMITS.pictureWords),
      description: long(LIMITS.description), subline: long(posts.SUBLINE_MOST), layout: 'quote', position: index + 1, chosen: index === 0, slide: index + 1, story: index < 10 ? index + 1 : null,
      width: 4000, height: 3000, createdAt: at, ...Object.fromEntries(SHAPE_KEYS.map((key) => [SHAPES[key].field, digest('9')])),
    })),
  });
  const run = await measured(() => posts.copyPostFor(owner, source.id, { day: '2034-05-06' }));
  bounded(run, 'Post again at its largest', 4);
  assert.equal(mostInFlight(run), 1);
  assert.equal(run.value.pictures.length, LIMITS.picturesPerPost);
  assert.equal(run.value.versions.length, NETWORK_KEYS.length);
  assert.ok(run.value.versions.every((version) => version.hashtags === tags && version.link === link && version.text === ''));
  const rows = await pictureRows(owner, run.value.post.id);
  assert.ok(rows.every((row) => row.prompt === long(LIMITS.mainText) && row.squareFile === digest('9')));

  const route = await measured(() => call(copyRoute.POST, { id: source.id, body: { day: '2034-05-07' } }));
  // The address copies the owner's own posts only: this post is another owner's.
  assert.equal(route.value.status, 404);
});

test('when the copy\'s pictures cannot be kept, the new post is removed again and nothing of it stays', async () => {
  const owner = 'failing-owner';
  const source = await posts.createPostFor(owner, { name: 'Fragile', day: '2035-02-02' });
  await posts.addPictureFor(owner, source.id, { source: 'words', words: 'Hello' });
  await posts.saveVersionsFor(owner, source.id, [{ network: 'instagram', text: 'Hi', hashtags: '#hi' }], { replace: true });
  const before = (await allPosts(owner)).length;

  await assert.rejects(
    withFailingCalls(keepsCopyPictures, () => posts.copyPostFor(owner, source.id, { day: '2035-02-03' })),
    refusedWith('error.saveFailed'),
  );
  assert.equal((await allPosts(owner)).length, before, 'the new post is gone');
  assert.equal(await modelAction('PostPicture', 'count', { where: { ownerId: owner } }), 1);
  assert.equal(await modelAction('PostVersion', 'count', { where: { ownerId: owner } }), 1);

  // When the removal is not confirmed either, the press says it may or may not have been kept.
  const removal = (steps) => keepsCopyPictures(steps) || steps.some((step) => step.action === 'deleteMany');
  await assert.rejects(
    withFailingCalls(removal, () => posts.copyPostFor(owner, source.id, { day: '2035-02-03' })),
    refusedWith('error.saveUnconfirmed'),
  );
});

test('the day Post again offers is the first from today that holds no post of this owner', async () => {
  const owner = 'day-owner';
  const today = '2036-03-10';
  const source = await posts.createPostFor(owner, { name: 'Weekly', day: '2036-01-01' });
  assert.deepEqual(await posts.copyDayFor(owner, source.id, today), { day: today }, 'nothing from today on: today');
  await posts.createPostFor(owner, { name: 'Today', day: today });
  await posts.createPostFor(owner, { name: 'Tomorrow', day: addDays(today, 1) });
  await posts.createPostFor(owner, { name: 'Later', day: addDays(today, 3) });
  await posts.createPostFor('day-neighbour', { name: 'Theirs', day: addDays(today, 2) });
  const run = await measured(() => posts.copyDayFor(owner, source.id, today));
  bounded(run, 'the first free day', 1);
  assert.deepEqual(run.value, { day: addDays(today, 2) }, 'another owner\'s post does not take the day');
  assert.equal(await posts.copyDayFor('day-neighbour', source.id, today), null, 'another owner\'s post is not found');
  await assert.rejects(posts.copyDayFor(owner, source.id, 'today'), refusedWith('refuse.request'));
});

test('the Post again address answers the first free day, makes the copy and names it, and refuses what it cannot copy', async () => {
  const source = await posts.createPostFor(OWNER, { name: 'Our bread', day: '2026-01-15' });
  const theirs = await posts.createPostFor('copy-neighbour', { name: 'Theirs', day: '2026-01-15' });

  const day = await measured(() => call(copyRoute.GET, { method: 'GET', id: source.id }));
  bounded(day, 'GET Post again', 1);
  assert.equal(day.value.status, 200);
  assert.ok(day.value.json.day >= todayCivil());

  const made = await measured(() => call(copyRoute.POST, { id: source.id, body: { day: '2037-06-01' } }));
  bounded(made, 'POST Post again', 4);
  assert.equal(made.value.status, 201, JSON.stringify(made.value.json));
  assert.equal(made.value.json.id, made.value.json.post.id);
  assert.equal(made.value.json.post.fromPostId, source.id);
  assert.equal(made.value.json.post.day, '2037-06-01');

  const idea = await call(copyRoute.POST, { id: source.id, body: {} });
  assert.equal(idea.status, 201);
  assert.equal(idea.json.post.day, null);

  assert.equal((await call(copyRoute.POST, { id: source.id, body: { day: '2037-02-30' } })).json.problem, 'refuse.post.day');
  assert.equal((await call(copyRoute.POST, { id: source.id, body: { day: '2037-06-01', name: 'x' } })).json.problem, 'refuse.request');
  assert.equal((await call(copyRoute.POST, { id: source.id, raw: '[]' })).json.problem, 'refuse.request');
  assert.equal((await call(copyRoute.POST, { id: source.id, raw: 'day=1', type: 'text/plain' })).json.problem, 'refuse.request');
  for (const id of [theirs.id, '0', 'abc', source.id + 5000]) {
    const answer = await call(copyRoute.POST, { id, body: { day: '2037-06-01' } });
    assert.equal(answer.status, 404, `POST ${id}`);
    assert.equal((await call(copyRoute.GET, { method: 'GET', id })).status, 404, `GET ${id}`);
  }
  assert.equal((await allPosts('copy-neighbour')).length, 1, 'nothing made for anyone else');
});

// --- bring back ----------------------------------------------------------------------

/** Adds `count` enquiries naming a post. */
async function customersFor(owner, postId, count) {
  for (let index = 0; index < count; index += 1) await customers.addEnquiryFor(owner, { name: `Customer ${index}`, postId, receivedOn: '2026-01-01' });
}

test('the posts to bring back are older than 60 days with a customer, best first, and not already brought back', async () => {
  const owner = 'back-owner';
  const today = '2036-06-15';
  const day = (back) => addDays(today, -back);
  const a = await posts.createPostFor(owner, { name: 'A', day: day(61) });
  const b = await posts.createPostFor(owner, { name: 'B', day: day(60) });
  const c = await posts.createPostFor(owner, { name: 'C', day: day(200) });
  const d = await posts.createPostFor(owner, { name: 'D', day: day(90) });
  const e = await posts.createPostFor(owner, { name: 'E', day: day(120) });
  const f = await posts.createPostFor(owner, { name: 'F', day: day(100) });
  const g = await posts.createPostFor(owner, { name: 'G idea' });
  const h = await posts.createPostFor(owner, { name: 'H', day: day(150) });
  await customersFor(owner, a.id, 3);
  await customersFor(owner, b.id, 5);
  await customersFor(owner, c.id, 3);
  await customersFor(owner, d.id, 4);
  await customersFor(owner, e.id, 2);
  await customersFor(owner, g.id, 6);
  await customersFor(owner, h.id, 1);
  await customersFor('back-neighbour', (await posts.createPostFor('back-neighbour', { name: 'N', day: day(100) })).id, 9);
  // D was brought back for a day ahead; E's copy is itself older than 60 days; H's copy is an idea with no day.
  await posts.copyPostFor(owner, d.id, { day: addDays(today, 5) });
  await posts.copyPostFor(owner, e.id, { day: day(70) });
  await posts.copyPostFor(owner, h.id);
  void f;

  const run = await measured(() => posts.bringBackFor(owner, { today }));
  bounded(run, 'the posts to bring back', 2);
  assert.deepEqual(run.value, [
    { id: a.id, name: 'A', day: day(61), themeId: null, customers: 3 },
    { id: c.id, name: 'C', day: day(200), themeId: null, customers: 3 },
    { id: e.id, name: 'E', day: day(120), themeId: null, customers: 2 },
  ], 'B is exactly 60 days old, D and H are brought back, F had no customer, G has no day, N is someone else\'s');

  const none = await measured(() => posts.bringBackFor('no-customers', { today }));
  bounded(none, 'no customers', 1);
  assert.deepEqual(none.value, []);
  await assert.rejects(posts.bringBackFor(owner, { today: 'soon' }), refusedWith('refuse.request'));
});

test('bring-back proposals take free days from today on, spread through the month, never a day of remembrance', () => {
  const candidate = (id, customers, themeId = null) => ({ id, name: `Post ${id}`, day: '2030-01-01', themeId, customers });
  const base = {
    month: '2031-05', today: '2031-05-10', taken: [{ day: '2031-05-11' }, { day: '2031-05-12' }, { day: null }], proposed: [{ day: '2031-05-13' }],
    specialDays: [{ day: '2031-05-19', kind: 'remembrance' }, { day: '2031-05-20', kind: 'celebration' }], inUse: new Set([7, 8]), chosen: new Set([7]),
  };
  const found = proposals.bringBackProposals([candidate(1, 5), candidate(2, 3, 7), candidate(3, 2)], base);
  assert.equal(found.length, proposals.BRING_BACK_PROPOSALS);
  assert.equal(proposals.BRING_BACK_PROPOSALS, posts.BRING_BACK_MOST, 'the page proposes what the records keep');
  const free = [];
  for (let date = 10; date <= 31; date += 1) if (![11, 12, 13, 19].includes(date)) free.push(`2031-05-${String(date).padStart(2, '0')}`);
  assert.deepEqual(found, [
    { day: free[Math.floor(free.length / 3)], name: 'Post 1', themeId: null, fromPostId: 1, customers: 5 },
    { day: free[Math.floor((2 * free.length) / 3)], name: 'Post 2', themeId: 7, fromPostId: 2, customers: 3 },
  ]);

  // A theme in use that the person did not choose stays home; an archived theme (not in use) comes back with none.
  const themed = proposals.bringBackProposals([candidate(1, 5, 8), candidate(2, 4, 99)], base);
  assert.deepEqual(themed.map((item) => [item.fromPostId, item.themeId]), [[2, null]]);
  assert.equal(proposals.bringBackProposals([candidate(1, 5, 8)], { ...base, chosen: new Set() }).length, 1, 'with no theme chosen, any may come back');

  // One free day: one proposal. A month already past: none. No candidate: none.
  const oneFree = proposals.bringBackProposals([candidate(1, 5), candidate(2, 4)], { ...base, today: '2031-05-31' });
  assert.deepEqual(oneFree.map((item) => item.day), ['2031-05-31']);
  assert.deepEqual(proposals.bringBackProposals([candidate(1, 5)], { ...base, today: '2031-06-01' }), []);
  assert.deepEqual(proposals.bringBackProposals([], base), []);
  const twoFree = proposals.bringBackProposals([candidate(1, 5), candidate(2, 4)], { ...base, today: '2031-05-30' });
  assert.deepEqual(twoFree.map((item) => item.day), ['2031-05-30', '2031-05-31']);
});

test('a bring-back card names the post and its customers, one customer in the singular', () => {
  assert.deepEqual(proposals.bringBackWords({ name: 'Spring menu', customers: 3 }, 'Untitled post'), { key: 'month.bringBack.label', values: { name: 'Spring menu', count: '3' } });
  assert.deepEqual(proposals.bringBackWords({ name: 'Spring menu', customers: 1 }, 'Untitled post'), { key: 'month.bringBack.one', values: { name: 'Spring menu', count: '1' } });
  assert.deepEqual(proposals.bringBackWords({ name: '  ', customers: 2 }, 'Untitled post').values.name, 'Untitled post');
});

test('Keep these reads a bring-back proposal by its day and post only, at most two, each post once', () => {
  const known = new Set([1]);
  const keep = (list) => proposals.readKeepRequest({ month: '2031-05', madeBy: 'ai', proposals: list }, known);
  const back = (fromPostId, extra = {}) => ({ day: '2031-05-04', name: `Brought back: ${'a'.repeat(LIMITS.name)} (3 customers)`, themeId: 55, fromPostId, ...extra });
  const one = keep([{ day: '2031-05-01', name: 'Idea', themeId: 1 }, back(9)]);
  assert.equal(one.ok, true, JSON.stringify(one));
  assert.deepEqual(one.value.proposals[1], { day: '2031-05-04', fromPostId: 9 }, 'its long label and its archived theme are not read');
  assert.equal(keep([back(9), back(10)]).ok, true);
  assert.equal(keep([back(9), back(10), back(11)]).problem, 'refuse.request');
  assert.equal(keep([back(9), back(9, { day: '2031-05-05' })]).problem, 'refuse.request');
  assert.equal(keep([back(0)]).problem, 'refuse.request');
  assert.equal(keep([back('9')]).problem, 'refuse.request');
  assert.equal(keep([back(9, { day: '2031-06-01' })]).problem, 'month.refuse.day');
  assert.equal(keep([back(null, { name: 'Idea', themeId: 1 })]).ok, true, 'fromPostId null is an ordinary proposal');
});

/** A post of OWNER more than 60 days before today, with pictures and customers. */
async function pastPostWithCustomers(name, back, count, extra = {}) {
  const source = await posts.createPostFor(OWNER, { name, day: addDays(todayCivil(), -back), ...extra });
  await posts.updatePostFor(OWNER, source.id, { mainText: `${name} words` });
  await posts.addPictureFor(OWNER, source.id, { source: 'photo', file: digest('7'), width: 800, height: 800 });
  await posts.addPictureFor(OWNER, source.id, { source: 'words', words: `${name} words` });
  await customersFor(OWNER, source.id, count);
  return source;
}

test('Keep these keeps the ideas and the copies together, each copy on its day with its pictures, or keeps nothing', async () => {
  await plan.saveProfileFor(OWNER, { networks: 'instagram,facebook', postsPerWeek: 3 });
  const theme = await plan.addThemeFor(OWNER, { name: 'Bread' });
  const first = await pastPostWithCustomers('Sourdough', 400, 4, { themeId: theme.id });
  const second = await pastPostWithCustomers('Rye', 380, 2);
  const gone = await posts.createPostFor(OWNER, { name: 'Gone', day: '2025-01-01' });
  await posts.deletePostFor(OWNER, gone.id);
  const month = '2038-03';
  const body = {
    month,
    madeBy: 'ai',
    proposals: [
      { day: `${month}-02`, name: 'Idea one', themeId: theme.id },
      { day: `${month}-09`, name: 'Brought back: Sourdough (4 customers)', themeId: theme.id, fromPostId: first.id },
      { day: `${month}-16`, name: 'Brought back: Rye (2 customers)', themeId: null, fromPostId: second.id },
    ],
  };

  // When the copies' pictures cannot be kept, nothing of the press stays: the idea neither.
  const failed = await withFailingCalls(keepsCopyPictures, () => call(keepRoute.POST, { body }));
  assert.equal(failed.status, 400);
  assert.equal(failed.json.problem, 'error.saveFailed');
  assert.equal((await allPosts(OWNER)).filter((row) => row.day?.startsWith(month)).length, 0);

  const run = await measured(() => call(keepRoute.POST, { body }));
  bounded(run, 'Keep these with two copies', 12);
  assert.equal(mostInFlight(run), 1);
  assert.equal(run.value.status, 201, JSON.stringify(run.value.json));
  const kept = run.value.json.posts;
  assert.deepEqual(kept.map((post) => [post.day, post.name]), [[`${month}-02`, 'Idea one'], [`${month}-09`, 'Sourdough'], [`${month}-16`, 'Rye']]);
  assert.equal(kept[0].picture, null);
  assert.equal(kept[1].picture?.source, 'photo', 'a copy\'s tile shows its chosen picture');
  assert.equal(kept[1].themeId, theme.id);
  assert.ok(kept.every((post) => post.state === 'idea' && post.of === 2));
  const rows = (await allPosts(OWNER)).filter((row) => row.day?.startsWith(month));
  assert.deepEqual(rows.map((row) => [row.fromPostId, row.madeBy, row.mainText]), [[null, 'ai', ''], [first.id, 'person', 'Sourdough words'], [second.id, 'person', 'Rye words']]);
  assert.equal((await pictureRows(OWNER, kept[1].id)).length, 2);

  // A bring-back proposal whose post is gone is left out; the rest is kept.
  const left = await call(keepRoute.POST, { body: { month: '2038-04', madeBy: 'person', proposals: [{ day: '2038-04-03', name: 'Idea', themeId: null }, { day: '2038-04-05', name: 'x', fromPostId: gone.id }] } });
  assert.equal(left.status, 201);
  assert.deepEqual(left.json.posts.map((post) => post.name), ['Idea']);
  const onlyGone = await call(keepRoute.POST, { body: { month: '2038-05', madeBy: 'person', proposals: [{ day: '2038-05-05', name: 'x', fromPostId: gone.id }] } });
  assert.equal(onlyGone.status, 201);
  assert.deepEqual(onlyGone.json.posts, []);
});

test('Fill my month, with and without AI, proposes up to two posts to bring back on free days, and saves nothing', async () => {
  const third = await pastPostWithCustomers('Baguette', 300, 9);
  const fourth = await pastPostWithCustomers('Croissant', 200, 5);
  await pastPostWithCustomers('Bagel', 250, 1);
  const month = addMonths(monthOf(todayCivil()), 3);
  const before = (await allPosts(OWNER)).length;

  const run = await measured(() => call(planRoute.POST, { body: { month, perWeek: 3, themeIds: [] } }));
  bounded(run, 'a plan without AI with posts to bring back', 10);
  assert.equal(run.value.status, 200, JSON.stringify(run.value.json));
  const found = run.value.json.proposals;
  const back = found.filter((item) => item.fromPostId !== undefined);
  // Sourdough (4) and Rye (2) were brought back by the keep before: the best two left are Baguette and Croissant.
  assert.deepEqual(back.map((item) => [item.fromPostId, item.name, item.customers]), [[third.id, 'Baguette', 9], [fourth.id, 'Croissant', 5]]);
  assert.equal(new Set(found.map((item) => item.day)).size, found.length, 'every proposal on its own day');
  assert.deepEqual(found.map((item) => item.day), [...found.map((item) => item.day)].sort(), 'in day order');
  assert.equal((await allPosts(OWNER)).length, before, 'nothing was saved');

  // As inside Tellop: its AI route answers (`lib/ai.js` sends there while the records hook is on), here a stand-in.
  const TELLOP_AI = Symbol.for('tellop.ai');
  const guard = globalThis.fetch;
  const asked = [];
  globalThis[TELLOP_AI] = {};
  const contentOf = (body) => {
    const user = body.messages.find((message) => message.role === 'user').content;
    return JSON.parse(user.slice(user.indexOf(CONTENT_START) + CONTENT_START.length, user.lastIndexOf(CONTENT_END)));
  };
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body));
    asked.push(body);
    const content = JSON.stringify({ proposals: contentOf(body).slots.map((slot) => ({ day: slot.day, name: `Idea for ${slot.day}` })) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const ai = await measured(() => call(fillMonthRoute.POST, { body: { month, perWeek: 3, themeIds: [] } }));
    bounded(ai, 'Fill my month with posts to bring back', 10);
    assert.equal(ai.value.status, 200, JSON.stringify(ai.value.json));
    const answer = ai.value.json.proposals;
    const brought = answer.filter((item) => item.fromPostId !== undefined);
    assert.equal(brought.length, 2);
    const sent = contentOf(asked[0]);
    assert.ok(brought.every((item) => !sent.slots.some((slot) => slot.day === item.day)), 'the AI names no idea for a bring-back day');
    assert.ok(brought.every((item) => sent.planned.some((post) => post.name === item.name && post.day === item.day)), 'the AI is told what comes back');
    assert.equal(new Set(answer.map((item) => item.day)).size, answer.length);
  } finally {
    globalThis.fetch = guard;
    delete globalThis[TELLOP_AI];
  }
  assert.equal((await allPosts(OWNER)).length, before, 'nothing was saved');
});

test('Fill my month for a span of at most seven days (the first visit): ideas for those days only, across a month\'s end, no bring-back, with and without AI', async () => {
  const span = { from: '2040-01-29', to: '2040-02-04' };
  const within = (list) => list.every((item) => item.day >= span.from && item.day <= span.to);
  const before = (await allPosts(OWNER)).length;
  const plain = await measured(() => call(planRoute.POST, { body: { ...span, perWeek: 4, themeIds: [] } }));
  bounded(plain, 'a plan without AI for a span', 11);
  assert.equal(mostInFlight(plain), 1);
  assert.equal(plain.value.status, 200, JSON.stringify(plain.value.json));
  const found = plain.value.json.proposals;
  assert.ok(found.length >= 4 && found.length <= 7, String(found.length));
  assert.ok(within(found), 'every idea inside the span');
  assert.ok(found.some((item) => item.day.startsWith('2040-01')) && found.some((item) => item.day.startsWith('2040-02')), 'both months');
  assert.ok(found.every((item) => item.fromPostId === undefined), 'no bring-back for a span');
  assert.deepEqual(found.map((item) => item.day), [...new Set(found.map((item) => item.day))].sort());

  // Its edges: seven days are taken, eight refused; the last before the first, a month as well, a day that is not one: refused.
  assert.equal((await call(planRoute.POST, { body: { from: '2040-03-01', to: '2040-03-07', perWeek: 3, themeIds: [] } })).status, 200);
  for (const body of [
    { from: '2040-03-01', to: '2040-03-08' }, { from: '2040-03-07', to: '2040-03-01' }, { from: '2040-03-01', to: '2040-03-07', month: '2040-03' },
    { from: '2040-02-30', to: '2040-03-02' }, { from: '2040-03-01' },
  ]) {
    const refused = await call(planRoute.POST, { body: { ...body, perWeek: 3, themeIds: [] } });
    assert.deepEqual([refused.status, refused.json.problem], [400, 'refuse.request'], JSON.stringify(body));
    const refusedAi = await call(fillMonthRoute.POST, { body: { ...body, perWeek: 3, themeIds: [] } });
    assert.deepEqual([refusedAi.status, refusedAi.json.problem], [400, 'refuse.request'], `AI ${JSON.stringify(body)}`);
  }

  const TELLOP_AI = Symbol.for('tellop.ai');
  const guard = globalThis.fetch;
  const asked = [];
  globalThis[TELLOP_AI] = {};
  const contentOf = (body) => {
    const user = body.messages.find((message) => message.role === 'user').content;
    return JSON.parse(user.slice(user.indexOf(CONTENT_START) + CONTENT_START.length, user.lastIndexOf(CONTENT_END)));
  };
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body));
    asked.push(body);
    const content = JSON.stringify({ proposals: contentOf(body).slots.map((slot) => ({ day: slot.day, name: `Idea for ${slot.day}` })) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const ai = await measured(() => call(fillMonthRoute.POST, { body: { ...span, perWeek: 4, themeIds: [], networks: ['instagram'] } }));
    bounded(ai, 'Fill my month for a span', 11);
    assert.ok(mostInFlight(ai) <= 2);
    assert.equal(ai.value.status, 200, JSON.stringify(ai.value.json));
    assert.equal(asked.length, 1, 'the AI is asked once');
    const slots = contentOf(asked[0]).slots;
    assert.ok(slots.length >= 4 && slots.length <= 7 && within(slots), 'the AI names only the span\'s days, never a whole month');
    assert.deepEqual(ai.value.json.proposals.map((item) => item.day), slots.map((slot) => slot.day));
    assert.ok(ai.value.json.proposals.every((item) => item.fromPostId === undefined && item.name === `Idea for ${item.day}`));
  } finally {
    globalThis.fetch = guard;
    delete globalThis[TELLOP_AI];
  }
  assert.equal((await allPosts(OWNER)).length, before, 'nothing was saved');
});

// --- the mix check -----------------------------------------------------------------

test('bring-back copies count toward the month\'s 256 posts: 255 posts, an idea and a copy are refused and nothing is kept; a copy alone fits', async () => {
  const at = new Date().toISOString();
  const month = '2039-02';
  await modelAction('Post', 'createMany', { data: Array.from({ length: posts.MOST_A_MONTH - 1 }, (_, index) => ({
    ownerId: OWNER, name: 'Full', day: `${month}-${String((index % 20) + 1).padStart(2, '0')}`, createdAt: at, updatedAt: at,
  })) });
  const source = await posts.createPostFor(OWNER, { name: 'Bring me back', day: '2025-02-01' });
  const inMonth = async () => Number(await modelAction('Post', 'count', { where: { ownerId: OWNER, day: { gte: `${month}-01`, lte: `${month}-31` } } }));
  assert.equal(await inMonth(), 255);

  const both = await call(keepRoute.POST, { body: { month, madeBy: 'person', proposals: [
    { day: `${month}-27`, name: 'Idea', themeId: null },
    { day: `${month}-28`, name: 'Brought back', fromPostId: source.id },
  ] } });
  assert.deepEqual([both.status, both.json.problem], [400, 'refuse.post.monthFull']);
  assert.equal(await inMonth(), 255, 'nothing kept: neither the idea nor the copy');
  await assert.rejects(posts.keepProposalsFor(OWNER, month, 'person', [{ day: `${month}-28`, name: 'x', fromPostId: source.id }, { day: `${month}-27`, name: 'Idea' }]), refusedWith('refuse.post.monthFull'));

  const copy = await call(keepRoute.POST, { body: { month, madeBy: 'person', proposals: [{ day: `${month}-28`, name: 'Brought back', fromPostId: source.id }] } });
  assert.equal(copy.status, 201, 'exactly the most fits');
  assert.deepEqual(copy.json.posts.map((post) => [post.day, post.name]), [[`${month}-28`, 'Bring me back']]);
  assert.equal(await inMonth(), 256);
});

test('the month says so when more than one in four of its posts sell, counted from its tiles', () => {
  const view = { kind: 'month', month: '2031-05' };
  const themes = [{ id: 1, sells: true }, { id: 2, sells: false }, { id: 3 }, { id: 4, sells: true }];
  const tiles = (selling, other, extra = []) => [
    ...Array.from({ length: selling }, (_, index) => ({ day: `2031-05-${String(index + 1).padStart(2, '0')}`, themeId: index % 2 ? 4 : 1 })),
    ...Array.from({ length: other }, (_, index) => ({ day: `2031-05-${String(index + 15).padStart(2, '0')}`, themeId: index % 3 === 0 ? null : index % 3 === 1 ? 2 : 3 })),
    ...extra,
  ];
  assert.equal(rules.mixOf(view, tiles(1, 3), themes), null, 'one in four: no line');
  assert.equal(rules.MIX_LEAST, 4);
  assert.equal(rules.mixOf(view, tiles(1, 2), themes), null, 'three posts: too few to call a mix, whatever sells');
  assert.equal(rules.mixOf(view, tiles(3, 0), themes), null, 'three posts that all sell: no line');
  assert.deepEqual(rules.mixOf(view, tiles(2, 2), themes), { sells: 2, of: 4 }, 'four posts, two sell: the line');
  assert.deepEqual(rules.mixOf(view, tiles(2, 3), themes), { sells: 2, of: 5 });
  assert.equal(rules.mixOf(view, tiles(2, 6), themes), null, 'two in eight: no line');
  assert.deepEqual(rules.mixOf(view, tiles(2, 5), themes), { sells: 2, of: 7 });
  assert.deepEqual(rules.mixOf(view, tiles(4, 6), themes), { sells: 4, of: 10 });
  assert.equal(rules.mixOf(view, [], themes), null);
  assert.equal(rules.mixOf(view, tiles(0, 5), themes), null);
  // The muted days of the weeks around the month do not count; a week view has no line.
  const around = [{ day: '2031-04-30', themeId: 1 }, { day: '2031-06-01', themeId: 1 }, { day: null, themeId: 1 }];
  assert.equal(rules.mixOf(view, tiles(1, 3, around), themes), null);
  assert.equal(rules.mixOf({ kind: 'week', month: '2031-05' }, tiles(4, 0), themes), null);
  assert.equal(rules.mixWordsKey({ sells: 1, of: 3 }), 'month.mix.one');
  assert.equal(rules.mixOf(view, tiles(1, 2, [{ day: '2031-05-30', themeId: 2 }]), themes), null, 'one in four exactly at four posts: no line');
  assert.equal(rules.mixWordsKey({ sells: 4, of: 10 }), 'month.mix.line');
  void daysInMonth;
});
