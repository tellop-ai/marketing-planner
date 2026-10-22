/**
 * Posts, their versions and their pictures, checked against a throwaway store
 * (`APP_DATA_FILE` points at a temporary folder that is removed afterwards).
 *
 * Every function is called the way the addresses and the other parts of the
 * app call it, and each limit is tested at its edge and one past it. Rows of
 * another owner are written straight into the store (`modelAction`) and must
 * never be read, changed or removed through these functions.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'posts-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const posts = await import('../lib/data/posts.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
const { SHAPE_KEYS } = await import('../lib/plan/shapes.js');
const { addDays, todayCivil } = await import('../lib/plan/days.js');
const { postState } = await import('../lib/plan/state.js');
const { bounded, largestCall, measured, mostInFlight } = await import('./records-bounds.mjs');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const MAX_SIDE = 10000;
const stamp = () => new Date().toISOString();
/** A moment after every share these checks date in later years: a share before it is shared, not scheduled. */
const LATER = '2040-01-01T00:00:00.000Z';
/** A digest-shaped text; the records functions check the shape only. */
const digest = (n) => n.toString(16).padStart(64, '0');
const refusedWith = (key) => (error) => {
  assert.ok(error instanceof DataError, `expected a refusal, got ${String(error)}`);
  assert.equal(error.messageKey, key);
  return true;
};
const words = (count, character = 'a') => character.repeat(count);

async function otherPost(fields = {}) {
  return modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', createdAt: stamp(), updatedAt: stamp(), ...fields } });
}
async function theme(owner) {
  return modelAction('Theme', 'create', { data: { ownerId: owner, name: 'Season', colour: 0, position: 1, createdAt: stamp(), updatedAt: stamp() } });
}
async function campaign(owner) {
  return modelAction('Campaign', 'create', { data: { ownerId: owner, name: 'Autumn', startsOn: '2026-11-01', endsOn: '2026-11-30', createdAt: stamp(), updatedAt: stamp() } });
}
async function comment(owner, permission) {
  return modelAction('CustomerComment', 'create', {
    data: { ownerId: owner, name: 'Ayşe', text: 'The best cake in town.', bestLine: 'Best cake', stars: 5, receivedOn: '2026-10-01', permission, createdAt: stamp(), updatedAt: stamp() },
  });
}
async function picturesOf(postId) {
  return (await posts.getPostFor(OWNER, postId)).pictures;
}

test('a new post starts empty and keeps what it was given', async () => {
  const plain = await posts.createPostFor(OWNER, {});
  assert.deepEqual(
    { name: plain.name, mainText: plain.mainText, day: plain.day, time: plain.time, themeId: plain.themeId, campaignId: plain.campaignId, specialDay: plain.specialDay, madeBy: plain.madeBy },
    { name: '', mainText: '', day: null, time: null, themeId: null, campaignId: null, specialDay: null, madeBy: 'person' },
  );
  assert.ok(Number.isInteger(plain.id));
  const mine = await theme(OWNER);
  const run = await campaign(OWNER);
  const full = await posts.createPostFor(OWNER, { name: '  Autumn sale  ', day: '2026-11-03', time: '09:30', themeId: mine.id, campaignId: run.id, specialDay: 'blackFriday', madeBy: 'ai' });
  assert.equal(full.name, 'Autumn sale');
  assert.equal(full.day, '2026-11-03');
  assert.equal(full.time, '09:30');
  assert.equal(full.themeId, mine.id);
  assert.equal(full.campaignId, run.id);
  assert.equal(full.specialDay, 'blackFriday');
  assert.equal(full.madeBy, 'ai');
});

test('a post refuses a day, time, name, theme, campaign or special day it cannot keep', async () => {
  await assert.rejects(posts.createPostFor(OWNER, { day: '2027-02-29' }), refusedWith('refuse.post.day'));
  assert.equal((await posts.createPostFor(OWNER, { day: '2028-02-29' })).day, '2028-02-29');
  await assert.rejects(posts.createPostFor(OWNER, { day: '29-02-2028' }), refusedWith('refuse.post.day'));
  await assert.rejects(posts.createPostFor(OWNER, { time: '24:00' }), refusedWith('refuse.post.time'));
  assert.equal((await posts.createPostFor(OWNER, { time: '23:59' })).time, '23:59');
  assert.equal((await posts.createPostFor(OWNER, { time: '00:00' })).time, '00:00');
  assert.equal((await posts.createPostFor(OWNER, { name: words(LIMITS.name) })).name.length, LIMITS.name);
  await assert.rejects(posts.createPostFor(OWNER, { name: words(LIMITS.name + 1) }), refusedWith('refuse.text.long'));
  const theirs = await theme(OTHER);
  await assert.rejects(posts.createPostFor(OWNER, { themeId: theirs.id }), refusedWith('refuse.post.theme'));
  await assert.rejects(posts.createPostFor(OWNER, { themeId: 0 }), refusedWith('refuse.post.theme'));
  await assert.rejects(posts.createPostFor(OWNER, { themeId: String(theirs.id) }), refusedWith('refuse.post.theme'));
  const theirRun = await campaign(OTHER);
  await assert.rejects(posts.createPostFor(OWNER, { campaignId: theirRun.id }), refusedWith('refuse.post.campaign'));
  await assert.rejects(posts.createPostFor(OWNER, { specialDay: 'not a key!' }), refusedWith('refuse.post.specialDay'));
  await assert.rejects(posts.createPostFor(OWNER, { madeBy: 'robot' }), refusedWith('refuse.request'));
  assert.equal(await modelAction('Post', 'count', { where: { ownerId: OWNER, themeId: theirs.id } }), 0);
});

test('another owner\'s post is never read, changed or deleted', async () => {
  const theirs = await otherPost({ day: '2026-12-10', mainText: 'their words' });
  assert.equal(await posts.getPostFor(OWNER, theirs.id), null);
  assert.equal(await posts.updatePostFor(OWNER, theirs.id, { name: 'Mine now' }), null);
  assert.equal(await posts.deletePostFor(OWNER, theirs.id), false);
  await assert.rejects(posts.saveVersionsFor(OWNER, theirs.id, [{ network: 'x', text: 'Hi' }]), refusedWith('error.notFound'));
  assert.equal(await posts.saveVersionFor(OWNER, theirs.id, 'x', { text: 'Hi' }), null);
  assert.equal(await posts.markSharedFor(OWNER, theirs.id, 'x'), null);
  assert.equal(await posts.addPictureFor(OWNER, theirs.id, { source: 'words', words: 'Hello' }), null);
  assert.equal((await posts.listMonthFor(OWNER, '2026-12', ['x'])).some((tile) => tile.id === theirs.id), false);
  const still = await modelAction('Post', 'findFirst', { where: { id: theirs.id } });
  assert.equal(still.name, 'Theirs');
  assert.equal(still.ownerId, OTHER);
  assert.equal(await modelAction('PostVersion', 'count', { where: { postId: theirs.id } }), 0);
  assert.equal(await modelAction('PostPicture', 'count', { where: { postId: theirs.id } }), 0);
});

test('another owner\'s version and picture are never read, changed or deleted', async () => {
  const theirs = await otherPost();
  await modelAction('PostVersion', 'create', { data: { ownerId: OTHER, postId: theirs.id, network: 'x', text: 'theirs', sharedAt: stamp(), updatedAt: stamp() } });
  const picture = await modelAction('PostPicture', 'create', { data: { ownerId: OTHER, postId: theirs.id, source: 'photo', file: digest(9), chosen: true, position: 1, createdAt: stamp() } });
  assert.equal(await posts.unmarkSharedFor(OWNER, theirs.id, 'x'), null);
  assert.equal(await posts.saveResultsFor(OWNER, theirs.id, 'x', { views: 5 }), null);
  assert.equal(await posts.updatePictureFor(OWNER, picture.id, { description: 'mine' }), null);
  assert.equal(await posts.choosePictureFor(OWNER, picture.id), null);
  assert.equal(await posts.deletePictureFor(OWNER, picture.id), false);
  assert.equal(await posts.pictureFileFor(OWNER, picture.id, 'original'), null);
  const version = await modelAction('PostVersion', 'findFirst', { where: { postId: theirs.id } });
  assert.notEqual(version.sharedAt, null);
  assert.equal(version.views, null);
  const kept = await modelAction('PostPicture', 'findFirst', { where: { id: picture.id } });
  assert.equal(kept.description, '');
  // Rows of another owner that name one of this owner's posts stay out of it, and stay when it goes.
  const mine = await posts.createPostFor(OWNER, { name: 'Mine' });
  await modelAction('PostVersion', 'create', { data: { ownerId: OTHER, postId: mine.id, network: 'x', text: 'planted', updatedAt: stamp() } });
  await modelAction('PostPicture', 'create', { data: { ownerId: OTHER, postId: mine.id, source: 'photo', file: digest(10), chosen: true, position: 1, createdAt: stamp() } });
  const full = await posts.getPostFor(OWNER, mine.id);
  assert.deepEqual(full.versions, []);
  assert.deepEqual(full.pictures, []);
  assert.equal(await posts.deletePostFor(OWNER, mine.id), true);
  assert.equal(await modelAction('PostVersion', 'count', { where: { ownerId: OTHER, postId: mine.id } }), 1);
  assert.equal(await modelAction('PostPicture', 'count', { where: { ownerId: OTHER, postId: mine.id } }), 1);
});

test('a post changes only the fields sent, and null clears a day', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Draft', day: '2026-11-05', time: '10:00' });
  const renamed = await posts.updatePostFor(OWNER, post.id, { name: 'Final', mainText: 'Line one\nLine two' });
  assert.equal(renamed.name, 'Final');
  assert.equal(renamed.mainText, 'Line one\nLine two');
  assert.equal(renamed.day, '2026-11-05');
  const cleared = await posts.updatePostFor(OWNER, post.id, { day: null });
  assert.equal(cleared.day, null);
  assert.equal(cleared.time, '10:00');
  assert.equal((await posts.updatePostFor(OWNER, post.id, {})).name, 'Final');
  await assert.rejects(posts.updatePostFor(OWNER, post.id, { mainText: words(LIMITS.mainText + 1) }), refusedWith('refuse.text.long'));
  assert.equal((await posts.updatePostFor(OWNER, post.id, { mainText: words(LIMITS.mainText) })).mainText.length, LIMITS.mainText);
  assert.equal(await posts.updatePostFor(OWNER, 999999, { name: 'Nobody' }), null);
});

test('deleting a post removes its versions and pictures and unlinks its enquiries', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Gone soon' });
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: 'Hi' }, { network: 'instagram', text: 'Hello' }], { replace: true });
  await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Sale' });
  const enquiry = await modelAction('Enquiry', 'create', { data: { ownerId: OWNER, name: 'Ali', postId: post.id, receivedOn: '2026-10-20', createdAt: stamp(), updatedAt: stamp() } });
  assert.equal(await posts.deletePostFor(OWNER, post.id), true);
  assert.equal(await posts.getPostFor(OWNER, post.id), null);
  assert.equal(await modelAction('PostVersion', 'count', { where: { postId: post.id } }), 0);
  assert.equal(await modelAction('PostPicture', 'count', { where: { postId: post.id } }), 0);
  assert.equal((await modelAction('Enquiry', 'findFirst', { where: { id: enquiry.id } })).postId, null);
  assert.equal(await posts.deletePostFor(OWNER, post.id), false);
});

test('a month holds the posts from its first to its last day, by day, time and id', async () => {
  const make = (day, time) => posts.createPostFor(OWNER, { name: `${day} ${time ?? ''}`, day, time });
  await make('2027-01-31');
  const firstTimed = await make('2027-02-01', '10:00');
  const firstUntimed = await make('2027-02-01');
  const firstEarly = await make('2027-02-01', '08:15');
  const last = await make('2027-02-28', '23:59');
  await make('2027-03-01', '00:00');
  const february = await posts.listMonthFor(OWNER, '2027-02', ['x']);
  assert.deepEqual(february.map((tile) => tile.id), [firstUntimed.id, firstEarly.id, firstTimed.id, last.id]);
  const leap = await make('2028-02-29');
  await make('2028-03-01');
  assert.deepEqual((await posts.listMonthFor(OWNER, '2028-02', [])).map((tile) => tile.id).filter((id) => id === leap.id), [leap.id]);
  assert.equal((await posts.listMonthFor(OWNER, '2028-02', [])).some((tile) => tile.day === '2028-03-01'), false);
  await assert.rejects(posts.listMonthFor(OWNER, '2027-13', []), refusedWith('refuse.request'));
  const days = await posts.listDaysFor(OWNER, '2027-02-01', '2027-02-01', []);
  assert.deepEqual(days.map((tile) => tile.id), [firstUntimed.id, firstEarly.id, firstTimed.id]);
  await assert.rejects(posts.listDaysFor(OWNER, '2027-02-02', '2027-02-01', []), refusedWith('refuse.request'));
});

test('a tile\'s state is worked out from its versions and its chosen picture', async () => {
  const networks = ['instagram', 'x'];
  const day = '2029-04-10';
  const tileOf = async (id, list = networks) => (await posts.listDaysFor(OWNER, day, day, list)).find((tile) => tile.id === id);
  const post = await posts.createPostFor(OWNER, { day });
  let tile = await tileOf(post.id);
  assert.deepEqual([tile.state, tile.shared, tile.of, tile.networks, tile.picture], ['idea', 0, 2, networks, null]);
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: 'Hi' }], { replace: true });
  assert.equal((await tileOf(post.id)).state, 'draft');
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'instagram', text: 'Hello' }], { replace: true });
  assert.equal((await tileOf(post.id)).state, 'draft', 'Instagram needs a picture');
  const picture = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Open today' });
  tile = await tileOf(post.id);
  assert.equal(tile.state, 'ready');
  assert.equal(tile.picture.id, picture.id);
  assert.equal(tile.picture.chosen, true);
  await posts.markSharedFor(OWNER, post.id, 'x');
  tile = await tileOf(post.id);
  assert.deepEqual([tile.state, tile.shared, tile.of], ['partly', 1, 2]);
  await posts.markSharedFor(OWNER, post.id, 'instagram');
  assert.equal((await tileOf(post.id)).state, 'shared');

  // A network switched off for this post, with no words, still counts.
  const quiet = await posts.createPostFor(OWNER, { day });
  await posts.saveVersionFor(OWNER, quiet.id, 'instagram', { on: false });
  await posts.saveVersionsFor(OWNER, quiet.id, [{ network: 'x', text: 'Only here' }], { replace: true });
  tile = await tileOf(quiet.id);
  assert.deepEqual([tile.state, tile.of, tile.networks], ['ready', 1, ['x']]);

  // With no networks chosen, the main words decide between an idea and a draft.
  const bare = await posts.createPostFor(OWNER, { day });
  assert.equal((await tileOf(bare.id, [])).state, 'idea');
  await posts.updatePostFor(OWNER, bare.id, { mainText: 'Something to say' });
  assert.equal((await tileOf(bare.id, [])).state, 'draft');
  assert.equal((await tileOf(bare.id, ['not-a-network'])).state, 'draft');
});

test('a must-fix check in a version\'s words keeps the post from Ready, in its tile and when it is read', async () => {
  const networks = ['x', 'telegram'];
  const day = '2029-05-10';
  const tileOf = async (id) => (await posts.listDaysFor(OWNER, day, day, networks)).find((tile) => tile.id === id);
  const flagsOf = async (id, network) => {
    const version = (await posts.getPostFor(OWNER, id)).versions.find((item) => item.network === network);
    return [version.mustFix, version.mustFixWithPicture];
  };
  const post = await posts.createPostFor(OWNER, { day });

  // Make my post's words: X at its limit (280) is ready, one past it holds the post back.
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: words(280) }, { network: 'telegram', text: 'Hi' }], { replace: true });
  assert.equal((await tileOf(post.id)).state, 'ready');
  assert.deepEqual(await flagsOf(post.id, 'x'), [false, false]);
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: words(281) }], { replace: true });
  assert.equal((await tileOf(post.id)).state, 'draft', 'Make my post\'s words over the limit');
  assert.deepEqual(await flagsOf(post.id, 'x'), [true, true]);

  // The person's own edit, at the edge and one past it; hashtags sent alone count with the words already kept.
  await posts.saveVersionFor(OWNER, post.id, 'x', { text: words(275) });
  assert.equal((await tileOf(post.id)).state, 'ready');
  await posts.saveVersionFor(OWNER, post.id, 'x', { hashtags: '#ab' });
  assert.equal((await tileOf(post.id)).state, 'ready', '275 letters, a blank line and 3 for the hashtag: 280');
  await posts.saveVersionFor(OWNER, post.id, 'x', { hashtags: '#abc' });
  assert.equal((await tileOf(post.id)).state, 'draft', '281 with the hashtag');
  assert.deepEqual(await flagsOf(post.id, 'x'), [true, true]);

  // Switching the version off and on again leaves its check where it was.
  await posts.saveVersionFor(OWNER, post.id, 'x', { on: false });
  assert.equal((await tileOf(post.id)).state, 'ready', 'a switched-off network does not count');
  await posts.saveVersionFor(OWNER, post.id, 'x', { on: true });
  assert.equal((await tileOf(post.id)).state, 'draft');
  await posts.saveVersionFor(OWNER, post.id, 'x', { hashtags: '' });
  assert.equal((await tileOf(post.id)).state, 'ready');

  // Telegram takes 4,096 letters alone and 1,024 under a picture: the tile reads the check that fits the post.
  await posts.saveVersionFor(OWNER, post.id, 'telegram', { text: words(1025) });
  assert.equal((await tileOf(post.id)).state, 'ready', 'no picture: 1,025 fits');
  assert.deepEqual(await flagsOf(post.id, 'telegram'), [false, true]);
  const picture = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Open today' });
  assert.equal((await tileOf(post.id)).state, 'draft', 'under a picture: 1,025 is over the caption limit');
  await posts.saveVersionFor(OWNER, post.id, 'telegram', { text: words(1024) });
  assert.equal((await tileOf(post.id)).state, 'ready', 'under a picture: 1,024 fits');
  await posts.saveVersionFor(OWNER, post.id, 'telegram', { text: words(4097) });
  assert.deepEqual(await flagsOf(post.id, 'telegram'), [true, true]);
  await posts.deletePictureFor(OWNER, picture.id);
  assert.equal((await tileOf(post.id)).state, 'draft', 'no picture: 4,097 is over 4,096');
});

test('a theme change clears the copies drawn on the old theme\'s colour, and keeps the rest', async () => {
  const old = await theme(OWNER);
  const next = await theme(OWNER);
  const post = await posts.createPostFor(OWNER, { day: '2029-05-11', themeId: old.id });
  const every = (seed) => Object.fromEntries(SHAPE_KEYS.map((key, index) => [key, digest(seed * 100 + index + 1)]));
  const kept = (picture) => SHAPE_KEYS.filter((key) => picture.shapes[key] !== null);
  async function picture(input, look) {
    const added = await posts.addPictureFor(OWNER, post.id, input);
    return posts.updatePictureFor(OWNER, added.id, { ...look, shapes: every(added.id) });
  }
  const fitted = await picture({ source: 'photo', file: digest(901), width: 1200, height: 800 }, { fit: 'fit' });
  const wordsCard = await picture({ source: 'words', words: 'Open today' }, {});
  const card = await picture({ source: 'card', commentId: (await comment(OWNER, 'yes')).id }, {});
  const filled = await picture({ source: 'photo', file: digest(902), width: 1200, height: 800 }, { fit: 'fill' });
  const auto = await picture({ source: 'photo', file: digest(903), width: 1200, height: 800 }, { fit: 'auto' });
  assert.equal(fitted.chosen, true, 'the photo fitted whole is the chosen one');
  assert.equal(wordsCard.chosen, false);
  // Another owner's picture under the same post id is never touched.
  const theirs = await modelAction('PostPicture', 'create', {
    data: { ownerId: OTHER, postId: post.id, source: 'words', words: 'Theirs', position: 9, createdAt: stamp(), ...shapeFiles(7) },
  });
  const byId = async () => new Map((await picturesOf(post.id)).map((item) => [item.id, item]));

  // Another change, or the same theme named again, clears nothing.
  await posts.updatePostFor(OWNER, post.id, { name: 'Renamed', themeId: old.id });
  for (const item of (await byId()).values()) assert.deepEqual(kept(item), [...SHAPE_KEYS], `picture ${item.id} keeps every copy`);

  const run = await measured(() => posts.updatePostFor(OWNER, post.id, { themeId: next.id }));
  bounded(run, 'a theme change', 2);
  assert.equal(run.value.themeId, next.id);
  const now = await byId();
  assert.deepEqual(kept(now.get(fitted.id)), [], 'a picture fitted whole on the colour: every copy');
  assert.equal(now.get(fitted.id).original, fitted.original, 'the photo itself stays');
  assert.deepEqual(kept(now.get(wordsCard.id)), [], 'a words picture: every copy');
  assert.deepEqual(kept(now.get(card.id)), [...SHAPE_KEYS], 'a comment card carries no theme colour');
  assert.deepEqual(kept(now.get(filled.id)), [...SHAPE_KEYS], 'a cut that fills its shape carries no theme colour');
  assert.deepEqual(kept(now.get(auto.id)), SHAPE_KEYS.filter((key) => key !== 'story' && key !== 'tall'), '`auto` fits whole only the tall shapes');
  const theirsNow = await modelAction('PostPicture', 'findFirst', { where: { id: theirs.id } });
  assert.deepEqual(SHAPE_KEYS.map((key) => theirsNow[`${key}File`]), SHAPE_KEYS.map((key) => theirs[`${key}File`]));

  // Taking the theme away is a change of colour too.
  await posts.updatePictureFor(OWNER, wordsCard.id, { shapes: every(wordsCard.id + 50) });
  await posts.updatePostFor(OWNER, post.id, { themeId: null });
  assert.deepEqual(kept((await byId()).get(wordsCard.id)), []);
  assert.equal(await posts.updatePostFor(OWNER, (await otherPost()).id, { themeId: next.id }), null, 'another owner\'s post');
});

test('Keep these keeps every proposal as an idea in one call, or refuses and keeps none', async () => {
  const month = '2029-07';
  const pad = (n) => String(n).padStart(2, '0');
  const list = Array.from({ length: posts.MOST_KEPT }, (_, index) => ({ day: `${month}-${pad((index % 31) + 1)}`, name: `Idea ${index}` }));
  const inMonth = async () => (await modelAction('Post', 'findMany', { where: { ownerId: OWNER, day: { startsWith: month } } })).length;
  const refusals = [
    [['2029-13', 'ai', list], 'month.refuse.month'],
    [[month, 'robot', list], 'refuse.request'],
    [[month, 'ai', []], 'refuse.request'],
    [[month, 'ai', [...list, list[0]]], 'month.refuse.count'],
    [[month, 'ai', [...list.slice(1), { day: '2029-08-01', name: 'Outside' }]], 'month.refuse.day'],
    [[month, 'ai', [...list.slice(1), { day: `${month}-02`, name: '' }]], 'refuse.text.missing'],
    [[month, 'ai', [...list.slice(1), { day: `${month}-02`, name: words(LIMITS.name + 1) }]], 'refuse.text.long'],
    [[month, 'ai', [...list.slice(1), { day: `${month}-02`, name: 'X', themeId: 0 }]], 'refuse.post.theme'],
    [[month, 'ai', [...list.slice(1), { day: `${month}-02`, name: 'X', specialDay: '!' }]], 'refuse.post.specialDay'],
  ];
  for (const [args, key] of refusals) await assert.rejects(posts.keepProposalsFor(OWNER, ...args), refusedWith(key));
  assert.equal(await inMonth(), 0, 'a refused keep keeps nothing');

  const longest = [...list.slice(1), { day: `${month}-31`, name: words(LIMITS.name), specialDay: 'newYear' }];
  const run = await measured(() => posts.keepProposalsFor(OWNER, month, 'person', longest));
  bounded(run, 'Keep these', 2);
  assert.equal(run.value.length, posts.MOST_KEPT);
  assert.ok(run.value.every((post, index) => post.madeBy === 'person' && post.mainText === '' && (index === 0 || run.value[index - 1].day <= post.day)));
  assert.equal(run.value.at(-1).specialDay, 'newYear');
  assert.equal(await inMonth(), posts.MOST_KEPT);
});

test('ideas are the posts with no day, newest first', async () => {
  const older = await posts.createPostFor(OWNER, { name: 'Older idea' });
  const newer = await posts.createPostFor(OWNER, { name: 'Newer idea' });
  await posts.createPostFor(OWNER, { name: 'Has a day', day: '2026-11-11' });
  const ideas = await posts.listIdeasFor(OWNER, ['x']);
  assert.equal(ideas.every((tile) => tile.day === null), true);
  assert.ok(ideas.findIndex((tile) => tile.id === newer.id) < ideas.findIndex((tile) => tile.id === older.id));
  assert.deepEqual((await posts.listIdeasFor(OWNER, ['x'], 1)).map((tile) => tile.id), [newer.id]);
});

test('Make my post writes every version, and keeps the person\'s own words unless told to replace them', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Words' });
  const first = await posts.saveVersionsFor(OWNER, post.id, [
    { network: 'x', text: 'Short', hashtags: ['#a', '#b'] },
    { network: 'instagram', text: 'Long words', hashtags: '#cake #town', link: 'https://example.com/shop', firstComment: 'More below' },
  ]);
  assert.equal(first.ok, true);
  assert.deepEqual(first.versions.map((version) => version.network), ['instagram', 'x']);
  assert.equal(first.versions.every((version) => version.changedByPerson === false && version.on === true), true);
  assert.equal(first.versions[1].hashtags, '#a #b');
  assert.equal(first.versions[0].link, 'https://example.com/shop');

  const edited = await posts.saveVersionFor(OWNER, post.id, 'instagram', { text: 'My own words' });
  assert.equal(edited.changedByPerson, true);
  assert.equal(edited.hashtags, '#cake #town', 'fields not sent stay');

  const stopped = await posts.saveVersionsFor(OWNER, post.id, [{ network: 'instagram', text: 'AI words' }, { network: 'x', text: 'New short' }], { replace: false });
  assert.deepEqual(stopped, { ok: false, changed: ['instagram'] });
  const after = await posts.getPostFor(OWNER, post.id);
  assert.equal(after.versions.find((version) => version.network === 'instagram').text, 'My own words');
  assert.equal(after.versions.find((version) => version.network === 'x').text, 'Short', 'nothing is written when the call stops');

  const same = await posts.saveVersionsFor(OWNER, post.id, [{ network: 'instagram', text: 'My own words' }, { network: 'x', text: 'New short' }]);
  assert.equal(same.ok, true, 'the same words replace nothing');

  await posts.saveVersionFor(OWNER, post.id, 'instagram', { text: 'Mine again' });
  const replaced = await posts.saveVersionsFor(OWNER, post.id, [{ network: 'instagram', text: 'AI words' }], { replace: true });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.versions[0].text, 'AI words');
  assert.equal(replaced.versions[0].changedByPerson, false);

  const switched = await posts.saveVersionFor(OWNER, post.id, 'x', { on: false });
  assert.equal(switched.on, false);
  assert.equal(switched.changedByPerson, false, 'switching a network off is not an edit of the words');
});

test('versions refuse what they cannot keep, at each limit', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Limits' });
  const save = (version) => posts.saveVersionsFor(OWNER, post.id, [{ network: 'facebook', ...version }], { replace: true });
  await assert.rejects(posts.saveVersionsFor(OWNER, post.id, [{ network: 'x' }, { network: 'x' }]), refusedWith('refuse.request'));
  await assert.rejects(posts.saveVersionsFor(OWNER, post.id, [{ network: 'myspace' }]), refusedWith('refuse.request'));
  await assert.rejects(posts.saveVersionsFor(OWNER, post.id, []), refusedWith('refuse.request'));
  await assert.rejects(posts.saveVersionsFor(OWNER, post.id, [...NETWORK_KEYS, 'x'].map((network) => ({ network }))), refusedWith('refuse.request'));
  assert.equal((await posts.saveVersionsFor(OWNER, post.id, NETWORK_KEYS.map((network) => ({ network, text: network })), { replace: true })).versions.length, 12);
  assert.equal((await save({ text: words(LIMITS.versionText) })).versions[0].text.length, LIMITS.versionText);
  await assert.rejects(save({ text: words(LIMITS.versionText + 1) }), refusedWith('refuse.text.long'));
  const tags = (count) => Array.from({ length: count }, (_, index) => `#tag${index}`);
  assert.equal((await save({ hashtags: tags(LIMITS.hashtags) })).versions[0].hashtags.split(' ').length, LIMITS.hashtags);
  await assert.rejects(save({ hashtags: tags(LIMITS.hashtags + 1) }), refusedWith('refuse.post.hashtags'));
  await assert.rejects(save({ hashtags: tags(LIMITS.hashtags + 1).join(' ') }), refusedWith('refuse.post.hashtags'));
  await assert.rejects(save({ hashtags: [`#${words(LIMITS.hashtagLength)}`] }), refusedWith('refuse.post.hashtags'));
  assert.equal((await save({ hashtags: [`#${words(LIMITS.hashtagLength - 1)}`] })).ok, true);
  await assert.rejects(save({ hashtags: 5 }), refusedWith('refuse.request'));
  await assert.rejects(save({ link: 'http://example.com' }), refusedWith('refuse.link'));
  assert.equal((await save({ link: '' })).versions[0].link, '');
  assert.equal((await save({ firstComment: words(LIMITS.firstComment) })).ok, true);
  await assert.rejects(save({ firstComment: words(LIMITS.firstComment + 1) }), refusedWith('refuse.text.long'));
  await assert.rejects(save({ on: 'yes' }), refusedWith('refuse.request'));
  await assert.rejects(posts.saveVersionFor(OWNER, post.id, 'myspace', { text: 'x' }), refusedWith('refuse.request'));
});

test('I shared it keeps its first time, takes an address, and can be taken back', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Shared' });
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: 'Hi' }]);
  const shared = await posts.markSharedFor(OWNER, post.id, 'x');
  assert.match(shared.sharedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(shared.sharedLink, null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const linked = await posts.markSharedFor(OWNER, post.id, 'x', { sharedLink: 'https://x.com/me/status/1' });
  assert.equal(linked.sharedAt, shared.sharedAt);
  assert.equal(linked.sharedLink, 'https://x.com/me/status/1');
  assert.equal((await posts.markSharedFor(OWNER, post.id, 'x')).sharedLink, 'https://x.com/me/status/1', 'no address sent keeps the address');
  await assert.rejects(posts.markSharedFor(OWNER, post.id, 'x', { sharedLink: 'http://x.com/me' }), refusedWith('refuse.link'));
  const back = await posts.unmarkSharedFor(OWNER, post.id, 'x');
  assert.equal(back.sharedAt, null);
  assert.equal(back.sharedLink, null);
  assert.equal(await posts.unmarkSharedFor(OWNER, post.id, 'instagram'), null);
});

test('results keep whole counts up to the limit and one line of words', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Results' });
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: 'Hi' }]);
  const saved = await posts.saveResultsFor(OWNER, post.id, 'x', { views: 0, likes: LIMITS.result, comments: null, resultNote: words(300) });
  assert.deepEqual([saved.views, saved.likes, saved.comments, saved.shares], [0, LIMITS.result, null, null]);
  assert.equal(saved.resultNote.length, 300);
  assert.match(saved.resultAt, /^\d{4}-/u);
  await assert.rejects(posts.saveResultsFor(OWNER, post.id, 'x', { views: -1 }), refusedWith('refuse.number'));
  await assert.rejects(posts.saveResultsFor(OWNER, post.id, 'x', { views: 1.5 }), refusedWith('refuse.number'));
  await assert.rejects(posts.saveResultsFor(OWNER, post.id, 'x', { likes: LIMITS.result + 1 }), refusedWith('refuse.number'));
  await assert.rejects(posts.saveResultsFor(OWNER, post.id, 'x', { resultNote: words(301) }), refusedWith('refuse.text.long'));
  assert.equal((await posts.saveResultsFor(OWNER, post.id, 'x', { shares: 3 })).likes, LIMITS.result, 'counts not sent stay');
  assert.equal(await posts.saveResultsFor(OWNER, post.id, 'instagram', { views: 1 }), null);
});

test('the shared list holds what was marked shared within the days asked', async () => {
  const today = todayCivil();
  const post = await posts.createPostFor(OWNER, { name: 'In results', day: '2026-01-05' });
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: 'Hi' }, { network: 'instagram', text: 'Hello' }]);
  await posts.markSharedFor(OWNER, post.id, 'x');
  await posts.saveResultsFor(OWNER, post.id, 'x', { views: 12, resultNote: 'Two people asked' });
  const rows = (await posts.listSharedFor(OWNER, today, today)).filter((row) => row.postId === post.id);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], sharedAt: typeof rows[0].sharedAt }, {
    postId: post.id, name: 'In results', day: '2026-01-05', themeId: null, network: 'x', sharedAt: 'string', sharedLink: null,
    views: 12, likes: null, comments: null, shares: null, saves: null, clicks: null, resultNote: 'Two people asked',
  });
  assert.equal((await posts.listSharedFor(OWNER, addDays(today, -1), addDays(today, -1))).some((row) => row.postId === post.id), false);
  assert.equal((await posts.listSharedFor(OWNER, addDays(today, 1), addDays(today, 1))).some((row) => row.postId === post.id), false);
  await assert.rejects(posts.listSharedFor(OWNER, today, addDays(today, -1)), refusedWith('refuse.request'));
});

test('a post\'s first picture is chosen and each one goes last; 20 is the most', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Pictures' });
  const photo = await posts.addPictureFor(OWNER, post.id, { source: 'photo', file: digest(1), width: 1536, height: 1024, description: 'A cake' });
  assert.deepEqual([photo.chosen, photo.position, photo.original, photo.canChange, photo.card], [true, 1, digest(1).slice(0, 12), false, null]);
  assert.deepEqual(photo.shapes, Object.fromEntries(SHAPE_KEYS.map((key) => [key, null])));
  const second = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Open\nevery day' });
  assert.deepEqual([second.chosen, second.position, second.words, second.original], [false, 2, 'Open\nevery day', null]);
  for (let count = 3; count <= 19; count += 1) await posts.addPictureFor(OWNER, post.id, { source: 'words', words: `Picture ${count}` });
  const nineteenth = (await picturesOf(post.id)).at(-1);
  assert.equal(nineteenth.position, 19);
  const twentieth = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Twenty' });
  assert.equal(twentieth.position, LIMITS.picturesPerPost);
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'One too many' }), refusedWith('refuse.picture.tooMany'));
  assert.equal((await picturesOf(post.id)).length, LIMITS.picturesPerPost);
  assert.equal((await picturesOf(post.id)).filter((picture) => picture.chosen).length, 1);
});

test('a picture refuses what it cannot keep', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Picture limits' });
  const add = (input) => posts.addPictureFor(OWNER, post.id, input);
  await assert.rejects(add({ source: 'video', file: digest(2) }), refusedWith('refuse.picture.source'));
  await assert.rejects(add({ source: 'photo' }), refusedWith('refuse.picture.file'));
  await assert.rejects(add({ source: 'photo', file: 'not-a-digest' }), refusedWith('error.fileNotKept'));
  await assert.rejects(add({ source: 'photo', file: digest(2), width: 0, height: 10 }), refusedWith('refuse.picture.size'));
  await assert.rejects(add({ source: 'photo', file: digest(2), width: 10, height: MAX_SIDE + 1 }), refusedWith('refuse.picture.size'));
  await assert.rejects(add({ source: 'photo', file: digest(2), width: 10 }), refusedWith('refuse.picture.size'));
  await assert.rejects(add({ source: 'photo', file: digest(2), width: 10.5, height: 10 }), refusedWith('refuse.picture.size'));
  const edges = await add({ source: 'photo', file: digest(2), width: 1, height: MAX_SIDE });
  assert.deepEqual([edges.width, edges.height], [1, MAX_SIDE]);
  await assert.rejects(add({ source: 'words', words: '   ' }), refusedWith('refuse.text.missing'));
  assert.equal((await add({ source: 'words', words: words(LIMITS.pictureWords) })).words.length, LIMITS.pictureWords);
  await assert.rejects(add({ source: 'words', words: words(LIMITS.pictureWords + 1) }), refusedWith('refuse.text.long'));
  await assert.rejects(add({ source: 'words', words: 'Hi', description: words(LIMITS.description + 1) }), refusedWith('refuse.text.long'));
  await assert.rejects(add({ source: 'card' }), refusedWith('refuse.request'));
  await assert.rejects(add({ source: 'changed', file: digest(3), change: 'Warmer' }), refusedWith('refuse.request'));
});


test('a card needs a comment of this owner that the customer said yes to', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Cards' });
  const yes = await comment(OWNER, 'yes');
  const asked = await comment(OWNER, 'asked');
  const theirs = await comment(OTHER, 'yes');
  const card = await posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: yes.id, words: 'ignored', file: digest(4) });
  assert.deepEqual(card.card, { bestLine: 'Best cake', text: 'The best cake in town.', name: 'Ayşe', stars: 5 });
  assert.deepEqual([card.words, card.original, card.commentId], ['', null, yes.id]);
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: asked.id }), refusedWith('refuse.picture.noPermission'));
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: theirs.id }), refusedWith('refuse.picture.noPermission'));
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: 999999 }), refusedWith('refuse.picture.noPermission'));
  const full = await posts.getPostFor(OWNER, post.id);
  assert.deepEqual(full.pictures[0].card, card.card);
});

test('an AI picture and a changed one can be changed again; a changed one names a picture of the same post', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'AI pictures' });
  const other = await posts.createPostFor(OWNER, { name: 'Elsewhere' });
  const elsewhere = await posts.addPictureFor(OWNER, other.id, { source: 'drawn', file: digest(5), width: 1536, height: 1024 });
  const drawn = await posts.addPictureFor(OWNER, post.id, { source: 'drawn', file: digest(6), prompt: words(LIMITS.mainText + 10), width: 1536, height: 1024 });
  assert.equal(drawn.canChange, true);
  const stored = await modelAction('PostPicture', 'findFirst', { where: { id: drawn.id } });
  assert.equal(stored.prompt.length, LIMITS.mainText, 'a long prompt is cut, not refused');
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'changed', file: digest(7), fromPictureId: elsewhere.id, change: 'Warmer' }), refusedWith('refuse.request'));
  await assert.rejects(posts.addPictureFor(OWNER, post.id, { source: 'changed', file: digest(7), fromPictureId: drawn.id, change: words(LIMITS.change + 1) }), refusedWith('refuse.text.long'));
  const changed = await posts.addPictureFor(OWNER, post.id, { source: 'changed', file: digest(7), fromPictureId: drawn.id, change: 'Warmer light' });
  assert.deepEqual([changed.source, changed.canChange, changed.chosen, changed.position], ['changed', true, false, 2]);
});

test('choosing a picture leaves exactly one chosen; deleting the chosen one chooses the next', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Choosing' });
  const [one, two, three] = [
    await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'One' }),
    await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Two' }),
    await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Three' }),
  ];
  const chosenIds = async () => (await picturesOf(post.id)).filter((picture) => picture.chosen).map((picture) => picture.id);
  assert.equal((await posts.choosePictureFor(OWNER, two.id)).chosen, true);
  assert.deepEqual(await chosenIds(), [two.id]);
  assert.equal(await posts.deletePictureFor(OWNER, two.id), true);
  assert.deepEqual(await chosenIds(), [three.id], 'the next one');
  assert.equal(await posts.deletePictureFor(OWNER, three.id), true);
  assert.deepEqual(await chosenIds(), [one.id], 'the one before, when the last goes');
  const four = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Four' });
  assert.equal(await posts.deletePictureFor(OWNER, four.id), true);
  assert.deepEqual(await chosenIds(), [one.id], 'deleting another picture leaves the choice');
  assert.equal(await posts.deletePictureFor(OWNER, one.id), true);
  assert.deepEqual(await picturesOf(post.id), []);
  assert.equal(await posts.deletePictureFor(OWNER, one.id), false);
  const fresh = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Again' });
  assert.equal(fresh.chosen, true, 'a picture added while none is chosen is chosen');
});

test('a new focus, fit, words or size clears the kept shapes, except those sent with it', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Shapes' });
  const picture = await posts.addPictureFor(OWNER, post.id, { source: 'photo', file: digest(20), width: 1536, height: 1024 });
  const shaped = await posts.updatePictureFor(OWNER, picture.id, { shapes: { square: digest(21), story: digest(22) } });
  assert.equal(shaped.shapes.square, digest(21).slice(0, 12));
  assert.equal(shaped.shapes.story, digest(22).slice(0, 12));
  assert.equal(await posts.pictureFileFor(OWNER, picture.id, 'square'), digest(21));
  const same = await posts.updatePictureFor(OWNER, picture.id, { focusX: 0.5, fit: 'auto', description: 'A cake on a plate' });
  assert.equal(same.shapes.square, digest(21).slice(0, 12), 'the same focus and fit keep the shapes');
  assert.equal(same.description, 'A cake on a plate');
  const moved = await posts.updatePictureFor(OWNER, picture.id, { focusX: 0 });
  assert.deepEqual(moved.shapes, Object.fromEntries(SHAPE_KEYS.map((key) => [key, null])));
  assert.equal(moved.focusX, 0);
  await posts.updatePictureFor(OWNER, picture.id, { shapes: { square: digest(23), wide: digest(24) } });
  const together = await posts.updatePictureFor(OWNER, picture.id, { focusY: 1, shapes: { square: digest(25) } });
  assert.deepEqual([together.focusY, together.shapes.square, together.shapes.wide], [1, digest(25).slice(0, 12), null]);
  await posts.updatePictureFor(OWNER, picture.id, { shapes: { portrait: digest(26) } });
  assert.equal((await posts.updatePictureFor(OWNER, picture.id, { fit: 'fit' })).shapes.portrait, null);
  await posts.updatePictureFor(OWNER, picture.id, { shapes: { portrait: digest(26) } });
  assert.equal((await posts.updatePictureFor(OWNER, picture.id, { width: 1024 })).shapes.portrait, null);
  assert.equal((await posts.updatePictureFor(OWNER, picture.id, { shapes: { portrait: null } })).shapes.portrait, null);
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { focusX: -0.01 }), refusedWith('refuse.picture.focus'));
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { focusY: 1.01 }), refusedWith('refuse.picture.focus'));
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { fit: 'stretch' }), refusedWith('refuse.picture.fit'));
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { shapes: { round: digest(27) } }), refusedWith('refuse.picture.shape'));
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { shapes: { square: 'abc' } }), refusedWith('refuse.picture.shape'));
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { height: 0 }), refusedWith('refuse.picture.size'));
  assert.equal((await posts.updatePictureFor(OWNER, picture.id, { description: words(LIMITS.description) })).description.length, LIMITS.description);
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { description: words(LIMITS.description + 1) }), refusedWith('refuse.text.long'));
  await assert.rejects(posts.updatePictureFor(OWNER, picture.id, { words: 'Not a words picture' }), refusedWith('refuse.request'));
  const wordsPicture = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Old' });
  await posts.updatePictureFor(OWNER, wordsPicture.id, { shapes: { square: digest(28) } });
  const rewritten = await posts.updatePictureFor(OWNER, wordsPicture.id, { words: 'New' });
  assert.deepEqual([rewritten.words, rewritten.shapes.square], ['New', null]);
});

test('a picture\'s file is its original or a kept shape, or nothing', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Files' });
  const photo = await posts.addPictureFor(OWNER, post.id, { source: 'photo', file: digest(30), width: 10, height: 10 });
  const drawnWords = await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'Hi' });
  assert.equal(await posts.pictureFileFor(OWNER, photo.id, 'original'), digest(30));
  assert.equal(await posts.pictureFileFor(OWNER, photo.id, 'square'), null);
  assert.equal(await posts.pictureFileFor(OWNER, photo.id, 'round'), null);
  assert.equal(await posts.pictureFileFor(OWNER, drawnWords.id, 'original'), null);
  assert.equal(await posts.pictureFileFor(OWNER, 999999, 'original'), null);
});

test('a campaign lists its posts, the owner\'s only', async () => {
  const mine = await theme(OWNER);
  const run = await campaign(OWNER);
  const dated = await posts.createPostFor(OWNER, { themeId: mine.id, campaignId: run.id, day: '2026-11-20' });
  const idea = await posts.createPostFor(OWNER, { themeId: mine.id, campaignId: run.id });
  const earlier = await posts.createPostFor(OWNER, { campaignId: run.id, day: '2026-11-02' });
  await otherPost({ themeId: mine.id, campaignId: run.id });
  assert.deepEqual((await posts.listPostsForCampaignFor(OWNER, run.id, ['x'])).map((tile) => tile.id), [earlier.id, dated.id, idea.id]);
  await posts.updatePostFor(OWNER, dated.id, { themeId: null, campaignId: null });
  assert.equal((await posts.listPostsForCampaignFor(OWNER, run.id, ['x'])).length, 2);
});

test('a month with more versions and pictures than one read takes still reads them all', async () => {
  const month = '2031-01';
  const count = 70;
  for (let index = 0; index < count; index += 1) {
    const post = await posts.createPostFor(OWNER, { day: `${month}-${String((index % 31) + 1).padStart(2, '0')}` });
    await posts.saveVersionsFor(OWNER, post.id, NETWORK_KEYS.map((network) => ({ network, text: `Words for ${network}` })), { replace: true });
    await posts.addPictureFor(OWNER, post.id, { source: 'words', words: `Picture ${index}` });
  }
  const tiles = await posts.listMonthFor(OWNER, month, [...NETWORK_KEYS]);
  assert.equal(tiles.length, count);
  assert.equal(tiles.filter((tile) => tile.state === 'ready').length, count, 'every version of every post was read');
  assert.equal(tiles.filter((tile) => tile.picture !== null).length, count, 'every chosen picture was read');
});

// --- Tellop's records bounds (`tests/records-bounds.mjs`) ----------------------------------

const two = (n) => String(n).padStart(2, '0');
const longest = (count) => 'ş'.repeat(count);
/** Thirty hashtags of the longest kind, two bytes a letter. */
const longestHashtags = () => Array.from({ length: LIMITS.hashtags }, (_, index) => `#${two(index)}${longest(LIMITS.hashtagLength - 3)}`);
/** The longest address `readLink` keeps: 500 letters, all of them plain. */
const longestLink = () => `https://example.com/${'a'.repeat(LIMITS.link - 20)}`;
const shapeFiles = (seed) => Object.fromEntries(SHAPE_KEYS.map((key, index) => [`${key}File`, digest(seed * 10 + index + 1)]));

/** Comments with the longest words a card shows, each its own. */
async function longComments(count, permission = 'yes') {
  const at = stamp();
  await modelAction('CustomerComment', 'createMany', {
    data: Array.from({ length: count }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), text: longest(LIMITS.comment), bestLine: longest(LIMITS.bestLine), stars: 5,
      permission, receivedOn: '2033-01-01', createdAt: at, updatedAt: `${at}#${index}`,
    })),
  });
  const rows = await modelAction('CustomerComment', 'findMany', { where: { ownerId: OWNER, updatedAt: { startsWith: at } }, select: { id: true }, orderBy: { id: 'asc' } });
  return rows.map((row) => row.id);
}

/** What `postState` says of a post, worked out from every field of its versions (the oracle the tiles must match). */
function expectedState(networks, versionRows, hasChosenPicture, mainText) {
  return postState({
    networks,
    versions: versionRows.map((row) => ({ network: row.network, on: row.on, text: row.text, sharedAt: row.sharedAt, mustFix: row.mustFix, mustFixWithPicture: row.mustFixWithPicture })),
    hasChosenPicture,
    mainText,
  });
}

test('a month, its days, a campaign\'s posts and the ideas at their largest stay within every records bound', async (t) => {
  const month = '2033-05';
  const at = stamp();
  const camp = await campaign(OWNER);
  // 257 posts on the month's days (one past the most a list holds), the longest names, every other one with main words.
  await modelAction('Post', 'createMany', {
    data: Array.from({ length: 257 }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), day: `${month}-${two((index % 31) + 1)}`, time: index % 3 === 0 ? null : `${two(index % 24)}:00`,
      campaignId: camp.id, specialDay: 'k'.repeat(80), madeBy: 'ai', mainText: index % 2 === 0 ? '' : longest(LIMITS.mainText), createdAt: at, updatedAt: at,
    })),
  });
  const inOrder = (await modelAction('Post', 'findMany', {
    where: { ownerId: OWNER, day: { gte: `${month}-01`, lte: `${month}-31` } }, orderBy: [{ day: 'asc' }, { time: 'asc' }, { id: 'asc' }], select: { id: true, mainText: true },
  }));
  assert.equal(inOrder.length, 257);
  const first = inOrder.slice(0, 256);
  // Every network: a version with words, shared, switched off, or none, in turn; every fourth post has only versions
  // with words or switched off (so it is ready unless a must-fix check holds it back), and some versions with words
  // hold a must-fix check.
  const versionRows = [];
  first.forEach((post, index) => NETWORK_KEYS.forEach((network, place) => {
    let kind = (index + place) % 4;
    if (index % 4 === 0) kind = kind === 1 ? 0 : kind === 3 ? 2 : kind;
    if (kind === 3) return;
    versionRows.push({
      ownerId: OWNER, postId: post.id, network, on: kind !== 2, text: kind === 1 ? '' : 'words', sharedAt: kind === 1 ? at : null, updatedAt: at,
      mustFix: kind === 0 && (index + place) % 7 === 0, mustFixWithPicture: kind === 0 && (index + place) % 5 === 0,
    });
  }));
  await modelAction('PostVersion', 'createMany', { data: versionRows });
  // A chosen picture for each: a words picture or a card from its own comment, the longest words and description,
  // every shape kept; the first post has a second chosen one (two added at once).
  const commentIds = await longComments(128);
  const pictureRows = first.map((post, index) => ({
    ownerId: OWNER, postId: post.id, source: index % 2 === 0 ? 'words' : 'card', words: index % 2 === 0 ? longest(LIMITS.pictureWords) : '',
    commentId: index % 2 === 0 ? null : commentIds[(index - 1) / 2], chosen: true, description: longest(LIMITS.description), position: 1,
    width: MAX_SIDE, height: MAX_SIDE, focusX: 0.30000000000000004, focusY: 0.30000000000000004, file: digest(index + 1), ...shapeFiles(index), createdAt: at,
  }));
  pictureRows.push({ ...pictureRows[0], position: 2, words: 'second' });
  await modelAction('PostPicture', 'createMany', { data: pictureRows });

  const networks = [...NETWORK_KEYS];
  const byPost = new Map(first.map((post) => [post.id, versionRows.filter((row) => row.postId === post.id)]));
  const check = (tiles, what) => {
    assert.deepEqual(tiles.map((tile) => tile.id), first.map((post) => post.id), `${what}: the first 256 posts in order`);
    tiles.forEach((tile, index) => {
      const want = expectedState(networks, byPost.get(tile.id), true, first[index].mainText);
      assert.deepEqual([tile.state, tile.shared, tile.of, tile.networks], [want.state, want.shared, want.of, want.networks], `${what}: post ${index}`);
      assert.equal(tile.picture?.position, 1, `${what}: post ${index} shows its first chosen picture`);
      if (index % 2 === 1) {
        // A tile never reads a card's comment: the card comes as a plain mark.
        assert.deepEqual([tile.picture.source, tile.picture.commentId, tile.picture.card], ['card', commentIds[(index - 1) / 2], null], `${what}: post ${index}`);
      } else {
        assert.equal(tile.picture.words, longest(LIMITS.pictureWords));
      }
    });
  };

  const monthRead = await measured(() => posts.listMonthFor(OWNER, month, networks));
  check(monthRead.value, 'the month');
  // Two calls for the posts, four for their versions and chosen pictures, one more for the post with two chosen
  // pictures; none for the 128 comments of the card pictures (a tile never reads them).
  bounded(monthRead, 'the month', 7);
  assert.ok(monthRead.calls.every((call) => !call.what.includes('CustomerComment')), 'no comment is read for a tile');
  const states = new Set(monthRead.value.map((tile) => tile.state));
  assert.ok(['ready', 'draft', 'partly'].every((state) => states.has(state)), `the tiles hold every state: ${[...states]}`);
  const daysRead = await measured(() => posts.listDaysFor(OWNER, `${month}-01`, `${month}-31`, networks));
  check(daysRead.value, 'the days');
  bounded(daysRead, 'the days', 7);
  const campaignRead = await measured(() => posts.listPostsForCampaignFor(OWNER, camp.id, networks));
  assert.equal(campaignRead.value.length, 256);
  bounded(campaignRead, 'a campaign\'s posts', 7);
  const noNetworks = await measured(() => posts.listMonthFor(OWNER, month, []));
  assert.equal(noNetworks.value.length, 256);
  assert.deepEqual(noNetworks.value.map((tile) => tile.state), first.map((post) => (post.mainText === '' ? 'idea' : 'draft')));
  bounded(noNetworks, 'the month with no networks', 6);

  // The ideas: 256 more with the longest names, newest first.
  await modelAction('Post', 'createMany', { data: Array.from({ length: 256 }, () => ({ ownerId: OWNER, name: longest(LIMITS.name), createdAt: at, updatedAt: at })) });
  const newest = (await modelAction('Post', 'findMany', { where: { ownerId: OWNER, day: null }, orderBy: { id: 'desc' }, take: 256, select: { id: true } })).map((row) => row.id);
  const ideas = await measured(() => posts.listIdeasFor(OWNER, networks, 256));
  assert.deepEqual(ideas.value.map((tile) => tile.id), newest);
  bounded(ideas, 'the most ideas', 6);
  const tooMany = await measured(() => posts.listIdeasFor(OWNER, networks, 10_000));
  assert.equal(tooMany.value.length, 256, 'a larger limit reads the most a list holds');

  for (const [what, read] of [['month', monthRead], ['days', daysRead], ['campaign', campaignRead], ['no networks', noNetworks], ['ideas', ideas], ['ideas past the most', tooMany]]) {
    t.diagnostic(`${what}: ${read.calls.length} calls, largest ${largestCall(read)} bytes`);
  }
});

test('one post at its largest, and writing all its versions, stay within every records bound', async (t) => {
  const post = await posts.createPostFor(OWNER, { name: longest(LIMITS.name), day: '2033-06-01' });
  await posts.updatePostFor(OWNER, post.id, { mainText: longest(LIMITS.mainText) });
  const full = (network) => ({ network, text: longest(LIMITS.versionText), hashtags: longestHashtags(), link: longestLink(), firstComment: longest(LIMITS.firstComment) });
  const write = await measured(() => posts.saveVersionsFor(OWNER, post.id, NETWORK_KEYS.map(full), { replace: true }));
  assert.equal(write.value.ok, true);
  assert.deepEqual(write.value.versions.map((version) => version.network), [...NETWORK_KEYS]);
  assert.ok(write.value.versions.every((version) => version.text === longest(LIMITS.versionText) && version.firstComment === longest(LIMITS.firstComment)));
  bounded(write, 'Make my post\'s words for every network', 3);
  for (const network of NETWORK_KEYS) {
    await posts.saveVersionFor(OWNER, post.id, network, { text: `${longest(LIMITS.versionText - 1)}!` });
    await posts.markSharedFor(OWNER, post.id, network, { sharedLink: longestLink() });
    await posts.saveResultsFor(OWNER, post.id, network, { views: LIMITS.result, likes: LIMITS.result, comments: LIMITS.result, shares: LIMITS.result, saves: LIMITS.result, clicks: LIMITS.result, resultNote: longest(posts.RESULT_NOTE_MOST) });
  }
  // The person changed every version: writing again without replace names them all and writes nothing.
  const refusedWrite = await measured(() => posts.saveVersionsFor(OWNER, post.id, NETWORK_KEYS.map(full)));
  assert.deepEqual(refusedWrite.value, { ok: false, changed: [...NETWORK_KEYS] });
  bounded(refusedWrite, 'Make my post kept from replacing', 1);
  const same = await measured(() => posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: `${longest(LIMITS.versionText - 1)}!` }]));
  assert.equal(same.value.ok, true, 'the same words are not a change');

  // Forty pictures (twice the limit), half of them cards from their own comments.
  const commentIds = await longComments(20);
  const at = stamp();
  await modelAction('PostPicture', 'createMany', {
    data: Array.from({ length: 40 }, (_, index) => ({
      ownerId: OWNER, postId: post.id, source: index % 2 === 0 ? 'words' : 'drawn', words: index % 2 === 0 ? longest(LIMITS.pictureWords) : '',
      chosen: index === 0, description: longest(LIMITS.description), position: index + 1, width: MAX_SIDE, height: MAX_SIDE,
      prompt: longest(LIMITS.mainText), file: digest(index + 1), ...shapeFiles(index), createdAt: at,
    })).map((row, index) => (index % 2 === 1 ? { ...row, source: 'card', commentId: commentIds[(index - 1) / 2] } : row)),
  });
  const read = await measured(() => posts.getPostFor(OWNER, post.id));
  assert.equal(read.value.post.mainText, longest(LIMITS.mainText));
  assert.deepEqual(read.value.versions.map((version) => version.network), [...NETWORK_KEYS]);
  assert.ok(read.value.versions.every((version) => version.sharedLink === longestLink() && version.resultNote === longest(posts.RESULT_NOTE_MOST)));
  assert.equal(read.value.pictures.length, 40);
  assert.ok(read.value.pictures.filter((picture) => picture.source === 'card').every((picture) => picture.card.text === longest(LIMITS.comment)));
  bounded(read, 'one post', 3);
  const missing = await measured(() => posts.getPostFor(OWNER, 999_999));
  assert.equal(missing.value, null);
  bounded(missing, 'a post that is not there', 1);

  const prompts = await measured(() => posts.picturePromptsFor(OWNER, post.id, 5));
  assert.equal(prompts.value.length, 0, 'words and card pictures keep no scene');
  bounded(prompts, 'the earlier scenes', 1);
  const changing = await measured(() => posts.pictureForChangeFor(OWNER, read.value.pictures[0].id));
  assert.equal(changing.value.pictures, 40);
  bounded(changing, 'the picture to change', 2);

  for (const [what, run] of [['save versions', write], ['get post', read]]) t.diagnostic(`${what}: ${run.calls.length} calls, largest ${largestCall(run)} bytes`);
});

test('the shared list reads 400 versions on more posts than one list of ids holds', async (t) => {
  const at = '2033-08-10T12:00:00.000Z';
  const created = stamp();
  await modelAction('Post', 'createMany', { data: Array.from({ length: 410 }, (_, index) => ({ ownerId: OWNER, name: `${index} ${longest(LIMITS.name - 4)}`, day: '2033-08-10', createdAt: created, updatedAt: `${created}#shared` })) });
  const made = await modelAction('Post', 'findMany', { where: { ownerId: OWNER, updatedAt: `${created}#shared` }, orderBy: { id: 'asc' }, select: { id: true, name: true } });
  await modelAction('PostVersion', 'createMany', {
    data: made.map((post) => ({ ownerId: OWNER, postId: post.id, network: 'x', sharedAt: at, views: LIMITS.result, resultNote: longest(posts.RESULT_NOTE_MOST), updatedAt: at })),
  });
  const read = await measured(() => posts.listSharedFor(OWNER, '2033-08-10', '2033-08-10', { now: LATER }));
  assert.equal(read.value.length, 400, 'the first 400 are kept');
  const names = new Map(made.map((post) => [post.id, post.name]));
  assert.ok(read.value.every((item) => item.name === names.get(item.postId)), 'each share carries its post\'s name');
  assert.equal(new Set(read.value.map((item) => item.postId)).size, 400);
  bounded(read, 'the shared list', 6);
  t.diagnostic(`shared list: ${read.calls.length} calls, largest ${largestCall(read)} bytes`);
});

test('reads made at the same moment are each counted', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Counted' });
  const ideas = await measured(() => posts.listIdeasFor(OWNER, [...NETWORK_KEYS], 256));
  const one = await measured(() => posts.getPostFor(OWNER, post.id));
  const both = await measured(() => Promise.all([posts.listIdeasFor(OWNER, [...NETWORK_KEYS], 256), posts.getPostFor(OWNER, post.id)]));
  assert.ok(ideas.calls.length >= 2, 'the ideas read on a cursor');
  assert.equal(both.calls.length, ideas.calls.length + one.calls.length, 'every call made together went through the records route');
});

// ---- fix round H1 ----

test('a card shows its comment\'s words only while the permission is yes; the copies of its shapes are kept only then', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Card' });
  const said = await comment(OWNER, 'yes');
  const card = await posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: said.id });
  assert.equal(card.card.text, 'The best cake in town.');
  assert.equal(card.cardRefused, false);
  const kept = await posts.updatePictureFor(OWNER, card.id, { shapes: { square: digest(901) } });
  assert.ok(kept.shapes.square !== null);

  for (const permission of ['no', 'asked', 'not-asked']) {
    await modelAction('CustomerComment', 'updateMany', { where: { id: said.id, ownerId: OWNER }, data: { permission } });
    const [read] = await picturesOf(post.id);
    assert.equal(read.card, null, `${permission}: the customer's words are not read`);
    assert.equal(read.cardRefused, true, permission);
    const chosen = await posts.choosePictureFor(OWNER, card.id);
    assert.deepEqual([chosen.card, chosen.cardRefused], [null, true], permission);
    const described = await posts.updatePictureFor(OWNER, card.id, { description: `A card (${permission})` });
    assert.deepEqual([described.card, described.cardRefused], [null, true], permission);
    await assert.rejects(posts.updatePictureFor(OWNER, card.id, { shapes: { portrait: digest(902) } }), refusedWith('refuse.picture.noPermission'));
    // Clearing a copy stays possible.
    assert.equal((await posts.updatePictureFor(OWNER, card.id, { shapes: { portrait: null } })).shapes.portrait, null);
  }

  await modelAction('CustomerComment', 'updateMany', { where: { id: said.id, ownerId: OWNER }, data: { permission: 'yes' } });
  const [back] = await picturesOf(post.id);
  assert.deepEqual([back.card?.bestLine, back.cardRefused], ['Best cake', false], 'yes again: the words come back');
  assert.ok((await posts.updatePictureFor(OWNER, card.id, { shapes: { portrait: digest(903) } })).shapes.portrait !== null);

  await modelAction('CustomerComment', 'deleteMany', { where: { id: said.id, ownerId: OWNER } });
  const [gone] = await picturesOf(post.id);
  assert.deepEqual([gone.card, gone.cardRefused], [null, false], 'a removed comment names nothing');
  await assert.rejects(posts.updatePictureFor(OWNER, card.id, { shapes: { square: digest(904) } }), refusedWith('refuse.picture.noPermission'));
});

test('a month holds at most 256 posts: a new post, a move or Keep these into a full month is refused', async () => {
  const month = '2033-03';
  const fill = async (count) => modelAction('Post', 'createMany', {
    data: Array.from({ length: count }, (_, index) => ({ ownerId: OWNER, name: `Filler ${index}`, day: `${month}-${two((index % 31) + 1)}`, createdAt: stamp(), updatedAt: stamp() })),
  });
  const inMonth = async () => modelAction('Post', 'count', { where: { ownerId: OWNER, day: { startsWith: month } } });
  await fill(posts.MOST_A_MONTH - 2);
  await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', day: `${month}-01`, createdAt: stamp(), updatedAt: stamp() } });
  // 254 held: Keep these with two more is taken (256), with three is refused.
  await assert.rejects(posts.keepProposalsFor(OWNER, month, 'person', [1, 2, 3].map((n) => ({ day: `${month}-0${n}`, name: `Idea ${n}` }))), refusedWith('refuse.post.monthFull'));
  assert.equal(await inMonth(), posts.MOST_A_MONTH - 2);
  await posts.keepProposalsFor(OWNER, month, 'person', [{ day: `${month}-01`, name: 'Idea 1' }]);
  // 255 held: one more new post is taken (256), the next is refused.
  const last = await posts.createPostFor(OWNER, { name: 'The last', day: `${month}-31` });
  assert.equal(await inMonth(), posts.MOST_A_MONTH);
  await assert.rejects(posts.createPostFor(OWNER, { name: 'One too many', day: `${month}-15` }), refusedWith('refuse.post.monthFull'));
  await assert.rejects(posts.keepProposalsFor(OWNER, month, 'ai', [{ day: `${month}-02`, name: 'Idea' }]), refusedWith('refuse.post.monthFull'));
  // A post already in the month moves within it; one from elsewhere cannot move in.
  assert.equal((await posts.updatePostFor(OWNER, last.id, { day: `${month}-30` })).day, `${month}-30`);
  const outside = await posts.createPostFor(OWNER, { name: 'Next month', day: '2033-04-01' });
  await assert.rejects(posts.updatePostFor(OWNER, outside.id, { day: `${month}-10` }), refusedWith('refuse.post.monthFull'));
  const idea = await posts.createPostFor(OWNER, { name: 'No day yet' });
  await assert.rejects(posts.updatePostFor(OWNER, idea.id, { day: `${month}-10` }), refusedWith('refuse.post.monthFull'));
  // Another owner's month is theirs: this owner's full month never refuses them, and the next month is open.
  assert.ok((await posts.createPostFor(OWNER, { name: 'April', day: '2033-04-02' })).id > 0);
  assert.equal(await inMonth(), posts.MOST_A_MONTH);
});

test('an archived theme stays on its posts but is never set on a post', async () => {
  const old = await theme(OWNER);
  const kept = await posts.createPostFor(OWNER, { name: 'Kept', themeId: old.id });
  await modelAction('Theme', 'updateMany', { where: { id: old.id, ownerId: OWNER }, data: { archived: true } });
  await assert.rejects(posts.createPostFor(OWNER, { name: 'New', themeId: old.id }), refusedWith('refuse.post.theme'));
  const other = await posts.createPostFor(OWNER, { name: 'Other' });
  await assert.rejects(posts.updatePostFor(OWNER, other.id, { themeId: old.id }), refusedWith('refuse.post.theme'));
  // The post that names it keeps it, also when the same theme is sent again with other changes.
  const same = await posts.updatePostFor(OWNER, kept.id, { themeId: old.id, name: 'Kept still' });
  assert.deepEqual([same.themeId, same.name], [old.id, 'Kept still']);
  assert.equal((await posts.updatePostFor(OWNER, kept.id, { day: '2026-12-01' })).themeId, old.id);
  // Once it leaves, it cannot come back.
  await posts.updatePostFor(OWNER, kept.id, { themeId: null });
  await assert.rejects(posts.updatePostFor(OWNER, kept.id, { themeId: old.id }), refusedWith('refuse.post.theme'));
});

test('a special day is a built-in day\'s key or one of this owner\'s own days', async () => {
  const own = await modelAction('SpecialDay', 'create', { data: { ownerId: OWNER, name: 'Shop birthday', date: '05-20', yearly: true, createdAt: stamp() } });
  const theirs = await modelAction('SpecialDay', 'create', { data: { ownerId: OTHER, name: 'Their day', date: '05-21', yearly: true, createdAt: stamp() } });
  assert.equal((await posts.createPostFor(OWNER, { specialDay: 'newYear' })).specialDay, 'newYear');
  assert.equal((await posts.createPostFor(OWNER, { specialDay: `own-${own.id}` })).specialDay, `own-${own.id}`);
  for (const key of [`own-${theirs.id}`, 'own-999999', 'own-0', 'own-', 'notADay', 'newyear', 'a'.repeat(80), 5]) {
    await assert.rejects(posts.createPostFor(OWNER, { specialDay: key }), refusedWith('refuse.post.specialDay'), String(key));
  }
  const post = await posts.createPostFor(OWNER, {});
  await assert.rejects(posts.updatePostFor(OWNER, post.id, { specialDay: `own-${theirs.id}` }), refusedWith('refuse.post.specialDay'));
  await assert.rejects(posts.keepProposalsFor(OWNER, '2034-05', 'ai', [{ day: '2034-05-21', name: 'Theirs', specialDay: `own-${theirs.id}` }]), refusedWith('refuse.post.specialDay'));
  assert.equal((await posts.keepProposalsFor(OWNER, '2034-05', 'ai', [{ day: '2034-05-20', name: 'Ours', specialDay: `own-${own.id}` }]))[0].specialDay, `own-${own.id}`);
});

test('the shared list reads each version\'s words for the download within the calls it is given, the earliest first', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Words read', day: '2026-02-02' });
  await posts.saveVersionsFor(OWNER, post.id, [{ network: 'x', text: 'Kiln day', hashtags: '#kiln' }, { network: 'threads', text: 'Glaze day' }]);
  await posts.markSharedFor(OWNER, post.id, 'x', { sharedLink: 'https://x.com/a/1' });
  await posts.markSharedFor(OWNER, post.id, 'threads');
  // A day no other check shares on, so the 400 a read keeps are these.
  await modelAction('PostVersion', 'updateMany', { where: { ownerId: OWNER, postId: post.id }, data: { sharedAt: '2034-02-02T12:00:00.000Z' } });
  const [from, to] = ['2034-02-01', '2034-02-03'];
  const today = from;
  const mine = (rows) => rows.filter((row) => row.postId === post.id);
  const plain = mine(await posts.listSharedFor(OWNER, from, to, { now: LATER }));
  assert.ok(plain.every((row) => !('text' in row)), 'no words without word calls');
  assert.deepEqual(Object.fromEntries(plain.map((row) => [row.network, row.sharedLink])), { x: 'https://x.com/a/1', threads: null });
  assert.equal(today, from);
  const read = mine(await posts.listSharedFor(OWNER, from, to, { wordCalls: 1, now: LATER }));
  assert.deepEqual(read.map((row) => [row.network, row.text, row.hashtags]).sort(), [['threads', 'Glaze day', ''], ['x', 'Kiln day', '#kiln']]);
});

test('the bounds check sees calls unanswered at once: four together pass, five fail, and every posts read keeps to one', async () => {
  const together = (count) => measured(() => Promise.all(Array.from({ length: count }, () => modelAction('Post', 'count', { where: { ownerId: OWNER } }))));
  const four = await together(4);
  assert.equal(mostInFlight(four), 4);
  bounded(four, 'four at once');
  const five = await together(5);
  assert.equal(mostInFlight(five), 5);
  assert.throws(() => bounded(five, 'five at once'), /5 calls unanswered at once, at most 4/u);
  const one = await measured(async () => {
    const month = await posts.listMonthFor(OWNER, '2033-03', [...NETWORK_KEYS]);
    await posts.getPostFor(OWNER, month[0].id);
    return posts.listSharedFor(OWNER, '2026-01-01', '2026-12-31', { wordCalls: 7 });
  });
  assert.equal(mostInFlight(one), 1, 'a posts function starts one call at a time');
});
