/**
 * The Results page's parts: its figures (reactions, averages, the best
 * posts), the spreadsheet file (its guarded cells, its address and what it
 * hands over), the reads it adds (chosen pictures, shared addresses) and the
 * page's reads staying inside Tellop's records bounds. A throwaway store
 * (`APP_DATA_FILE` in a temporary folder, removed afterwards); rows of another
 * owner are written straight into the store and must never be read.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'results-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction, modelBatch } = await import('../lib/data/index.js');
const { keepFile } = await import('../lib/data/files.js');
const ideas = await import('../lib/data/ideas.js');
const posts = await import('../lib/data/posts.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
const { getLocale, t } = await import('../lib/i18n/index.js');
const figures = await import('../app/results/figures.js');
const { readResults, postsExportText } = await import('../app/results/read.js');
const exportRoute = await import('../app/api/export/posts/route.js');
const downloadsRoute = await import('../app/api/downloads/route.js');
const { unzipStored } = await import('../lib/plan/zip.js');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const stamp = () => new Date().toISOString();
/** An instant on a civil day at an hour of this computer's clock (as the shares are read). */
const at = (day, hour = 12, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
};
/** A share as `listSharedFor` answers it. */
const share = (fields) => ({
  postId: 1, name: 'Post', day: '2030-05-01', themeId: null, network: 'instagram', sharedAt: at('2030-05-01'),
  views: null, likes: null, comments: null, shares: null, saves: null, clicks: null, resultNote: '', ...fields,
});

async function post(owner, fields = {}) {
  return modelAction('Post', 'create', { data: { ownerId: owner, name: 'A post', createdAt: stamp(), updatedAt: stamp(), ...fields } });
}
async function shared(owner, postId, network, sharedAt, fields = {}) {
  return modelAction('PostVersion', 'create', { data: { ownerId: owner, postId, network, text: 'Words', sharedAt, updatedAt: stamp(), ...fields } });
}

// --- figures -------------------------------------------------------------------

test('reactions are the typed likes, comments, shares and saves; none typed is no reactions, not zero', () => {
  assert.equal(figures.reactionsOf(share({})), null);
  assert.equal(figures.reactionsOf(share({ views: 900, clicks: 12 })), null, 'views and clicks are not reactions');
  assert.equal(figures.reactionsOf(share({ likes: 0 })), 0);
  assert.equal(figures.reactionsOf(share({ likes: 10, comments: 2, shares: 1, saves: 3 })), 16);
  assert.equal(figures.reactionsOf(share({ likes: 10, saves: 3 })), 13, 'an empty count adds nothing');
  assert.equal(figures.hasResults(share({})), false);
  assert.equal(figures.hasResults(share({ views: 0 })), true);
  assert.equal(figures.hasResults(share({ clicks: 4 })), true);
});

test('an average counts only shares with typed reactions, and there is none without them', () => {
  assert.equal(figures.averageOf([]), null);
  assert.equal(figures.averageOf([null, null]), null);
  assert.equal(figures.averageOf([0]), 0);
  assert.equal(figures.averageOf([null, 4, 6]), 5);
  assert.equal(figures.averageOf([1, 2]), 1.5);
});

/** A month's counts as `monthFiguresFor` answers them. */
const month = (fields = {}) => ({ shares: 0, typed: 0, customers: 0, bought: 0, sales: 0, byNetwork: {}, byPost: {}, byChannel: {}, followers: {}, ...fields });
const counts = (fields = {}) => ({ shares: 0, reacted: 0, reactions: 0, customers: 0, bought: 0, sales: 0, ...fields });

test('the month’s figures lead with customers and sales, each beside the month before', () => {
  const now = month({
    shares: 6, typed: 5, customers: 9, bought: 4, sales: 1200,
    byNetwork: { instagram: { shares: 3, reacted: 2, reactions: 18 }, facebook: { shares: 2, reacted: 1, reactions: 4 }, x: { shares: 1, reacted: 1, reactions: 0 } },
    byPost: {
      1: counts({ shares: 2, reacted: 2, reactions: 16, customers: 2, bought: 1, sales: 500 }),
      2: counts({ shares: 1 }),
      3: counts({ shares: 1, customers: 1 }),
      4: counts({ shares: 1, reacted: 1, reactions: 0, customers: 3, bought: 2, sales: 300 }),
      5: counts({ shares: 1, reacted: 1, reactions: 6 }),
      8: counts({ customers: 1, bought: 1, sales: 100 }),
    },
    byChannel: { instagram: { customers: 4, bought: 2, sales: 700 }, word: { customers: 2, bought: 1, sales: 400 }, website: { customers: 3, bought: 1, sales: 100 } },
    followers: { instagram: 1500, tiktok: 40 },
  });
  const before = month({
    shares: 2, customers: 3, bought: 1, sales: 200,
    byNetwork: { instagram: { shares: 2, reacted: 0, reactions: 0 } },
    byPost: { 1: counts({ shares: 2, customers: 1, bought: 1, sales: 200 }) },
    byChannel: { instagram: { customers: 3, bought: 1, sales: 200 } },
    followers: { instagram: 1400 },
  });
  const facts = { 1: { themeId: 7, ask: 'book' }, 2: { themeId: 7, ask: '' }, 3: { themeId: 3, ask: 'buy' }, 4: { themeId: null, ask: 'book' }, 5: { themeId: 99, ask: '' }, 8: { themeId: 3, ask: 'message' } };
  const best = figures.bestPostIds(now);
  assert.deepEqual(best, [4, 1, 8, 3, 5], 'customers first, then sales, then reactions; no customer, sale or reaction: not among them');
  const result = figures.resultsFigures({
    month: '2030-05', last: '2030-04', counts: { '2030-05': now, '2030-04': before }, facts, best,
    detail: { 4: { name: 'Four', day: '2030-05-04', networks: ['instagram', 'x'] } }, themeOrder: [3, 7], networks: ['tiktok', 'instagram'],
  });
  assert.deepEqual(result.totals, {
    shares: { value: 6, last: 2 }, typed: { value: 5, last: 0 }, customers: { value: 9, last: 3 }, bought: { value: 4, last: 1 }, sales: { value: 1200, last: 200 },
    noPost: { customers: { value: 2, last: 2 }, sales: { value: 300, last: 0 } },
  });
  assert.deepEqual(result.byTheme, [
    { themeId: 3, shares: { value: 1, last: 0 }, customers: { value: 2, last: 0 }, sales: { value: 100, last: 0 }, reactions: { value: null, last: null } },
    { themeId: 7, shares: { value: 3, last: 2 }, customers: { value: 2, last: 1 }, sales: { value: 500, last: 200 }, reactions: { value: 8, last: null } },
    { themeId: 99, shares: { value: 1, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 }, reactions: { value: 6, last: null } },
    { themeId: null, shares: { value: 1, last: 0 }, customers: { value: 3, last: 0 }, sales: { value: 300, last: 0 }, reactions: { value: 0, last: null } },
  ], 'the plan’s order, an unknown theme after it, no theme last; no reactions typed is no average, not zero');
  assert.deepEqual(result.byNetwork, [
    { network: 'instagram', shares: { value: 3, last: 2 }, customers: { value: 4, last: 3 }, sales: { value: 700, last: 200 }, reactions: { value: 9, last: null } },
    { network: 'facebook', shares: { value: 2, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 }, reactions: { value: 4, last: null } },
    { network: 'x', shares: { value: 1, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 }, reactions: { value: 0, last: null } },
  ]);
  assert.deepEqual(result.byChannel, [
    { channel: 'word', customers: { value: 2, last: 0 }, sales: { value: 400, last: 0 } },
    { channel: 'website', customers: { value: 3, last: 0 }, sales: { value: 100, last: 0 } },
  ], 'the places that are not networks, in their order; one with nothing in either month left out');
  assert.deepEqual(result.byAsk, [
    { ask: 'message', shares: { value: 0, last: 0 }, customers: { value: 1, last: 0 }, sales: { value: 100, last: 0 } },
    { ask: 'book', shares: { value: 3, last: 2 }, customers: { value: 5, last: 1 }, sales: { value: 800, last: 200 } },
    { ask: 'buy', shares: { value: 1, last: 0 }, customers: { value: 1, last: 0 }, sales: { value: 0, last: 0 } },
    { ask: '', shares: { value: 2, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 } },
  ], 'the asks’ order, no ask last');
  assert.deepEqual(result.best[0], { postId: 4, name: 'Four', day: '2030-05-04', themeId: null, ask: 'book', networks: ['instagram', 'x'], customers: 3, sales: 300, reactions: 0 });
  assert.deepEqual(result.best.map((item) => [item.postId, item.reactions]), [[4, 0], [1, 16], [8, null], [3, null], [5, 6]]);
  assert.deepEqual(result.followers, [
    { network: 'tiktok', count: 40, last: null },
    { network: 'instagram', count: 1500, last: 1400 },
  ], 'the plan’s networks in its order; none typed is null, never zero');

  const empty = figures.resultsFigures({ month: '2030-05', last: '2030-04', counts: {}, facts: {} });
  assert.deepEqual([empty.byTheme, empty.byNetwork, empty.byChannel, empty.byAsk, empty.best, empty.followers], [[], [], [], [], [], []]);
  assert.deepEqual(empty.totals.customers, { value: 0, last: 0 });
});

test('the best posts: at most five, ties by the newer post', () => {
  const many = (count, fields) => month({ byPost: Object.fromEntries(Array.from({ length: count }, (_, index) => [index + 1, counts(fields(index))])) });
  assert.equal(figures.bestPostIds(many(4, (index) => ({ customers: index + 1 }))).length, 4);
  assert.deepEqual(figures.bestPostIds(many(6, (index) => ({ customers: index + 1 }))), [6, 5, 4, 3, 2]);
  assert.deepEqual(figures.bestPostIds(many(3, () => ({ customers: 1 }))), [3, 2, 1]);
  assert.deepEqual(figures.bestPostIds(many(3, (index) => ({ reacted: 1, reactions: index === 1 ? 0 : 2 }))), [3, 1], 'zero reactions is not a best post');
  assert.deepEqual(figures.bestPostIds(month()), []);
});

// --- the spreadsheet file --------------------------------------------------------

test('every cell that could run as a formula is guarded, and the rows run oldest first', () => {
  const locale = getLocale();
  const text = figures.postsCsv([
    share({ postId: 3, name: '', network: 'facebook', day: null, sharedAt: at('2030-05-10'), resultNote: '\tTabbed', text: '', hashtags: '' }),
    share({ postId: 2, name: '-5% today', network: 'x', sharedAt: at('2030-05-09'), likes: 3, resultNote: '@everyone came', text: '=1+1 deal', hashtags: '#mugs' }),
    share({ postId: 1, name: '=HYPERLINK("https://x.invalid","press")', themeId: 4, network: 'instagram', sharedAt: at('2030-05-02', 23, 59), views: 120, resultNote: '+90 532',
      sharedLink: 'https://instagram.com/p/1', text: 'Kiln day', hashtags: '' }),
  ], { themeNames: new Map([[4, 'Offers']]), locale });
  assert.ok(text.startsWith('﻿'), 'a byte order mark, so a spreadsheet reads Turkish letters');
  const lines = text.replace(/^﻿/u, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 4, 'every share\'s words were read: no line says some were left out');
  assert.equal(lines[0], ['day', 'post', 'theme', 'network', 'sharedDay', 'address', 'words', 'views', 'likes', 'comments', 'shares', 'saves', 'clicks', 'note']
    .map((key) => t(`results.export.${key}`, locale)).join(','));
  assert.equal(lines[1], `2030-05-01,"'=HYPERLINK(""https://x.invalid"",""press"")",Offers,Instagram,2030-05-02,https://instagram.com/p/1,Kiln day,120,,,,,,'+90 532`);
  assert.equal(lines[2], `2030-05-01,'-5% today,,X,2030-05-09,,"'=1+1 deal\n\n#mugs",,3,,,,,'@everyone came`, 'the words as shared, guarded too');
  assert.ok(lines[3].startsWith(`,${t('post.untitled', locale)},,Facebook,2030-05-10,`), lines[3]);
  assert.ok(lines[3].endsWith(`"'\tTabbed"`), lines[3]);
});

test('the export keeps a file of the month’s shares, the owner’s only, and hands over only itself', async () => {
  const locale = getLocale();
  const offers = await modelAction('Theme', 'create', { data: { ownerId: OWNER, name: 'Offers', colour: 1, position: 1, createdAt: stamp(), updatedAt: stamp() } });
  const first = await post(OWNER, { name: '=1+1', day: '2025-03-01', themeId: offers.id });
  const second = await post(OWNER, { name: 'Late spring', day: '2025-03-30' });
  await shared(OWNER, first.id, 'instagram', at('2025-03-01', 0, 0), { likes: 7, sharedLink: 'https://instagram.com/p/abc', resultNote: '-nice' });
  await shared(OWNER, second.id, 'facebook', at('2025-03-31', 23, 59));
  await shared(OWNER, second.id, 'x', at('2025-04-01', 0, 0), { likes: 1 });
  await shared(OWNER, second.id, 'threads', at('2025-02-28', 23, 59));
  const theirs = await post(OTHER, { name: 'Not yours', day: '2025-03-05' });
  await shared(OTHER, theirs.id, 'instagram', at('2025-03-05'), { likes: 99, sharedLink: 'https://instagram.com/p/theirs' });

  const made = await exportRoute.POST(new Request('http://app.test/api/export/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: '2025-03' }) }));
  assert.equal(made.status, 200);
  const { address } = await made.json();
  assert.match(address, /^\/api\/downloads\?file=[0-9a-f]{64}$/u);
  const handed = await downloadsRoute.GET(new Request(`http://app.test${address}`));
  assert.equal(handed.status, 200);
  assert.match(handed.headers.get('content-disposition') ?? '', /attachment/u);
  const [csv, ...more] = unzipStored(new Uint8Array(await handed.arrayBuffer()));
  assert.deepEqual([csv.name, more.length], [t('results.export.fileName', locale, { month: '2025-03' }), 0], 'a zip holding the one file');
  const text = new TextDecoder().decode(csv.bytes);
  const lines = text.replace(/^﻿/u, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3, 'headings and the two shares of the month, from its first moment to its last');
  assert.equal(lines[0].split(',')[0], t('results.export.day', locale));
  assert.equal(lines[1], `2025-03-01,'=1+1,Offers,Instagram,2025-03-01,https://instagram.com/p/abc,Words,,7,,,,,'-nice`);
  assert.equal(lines[2], '2025-03-30,Late spring,,Facebook,2025-03-31,,Words,,,,,,,');
  assert.equal(text.includes('Not yours') || text.includes('theirs'), false);

  const picture = await keepFile(new Request('http://app.test/api/files', { method: 'POST', body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) }));
  assert.equal((await downloadsRoute.GET(new Request(`http://app.test/api/downloads?file=${picture.file}`))).status, 404, 'a kept picture is not handed over here');
  assert.equal((await downloadsRoute.GET(new Request('http://app.test/api/downloads?file=../app.db'))).status, 404);
  assert.equal((await downloadsRoute.GET(new Request(`http://app.test/api/downloads?file=${'0'.repeat(64)}`))).status, 404);
  assert.equal((await downloadsRoute.GET(new Request('http://app.test/api/downloads'))).status, 404);

  for (const month of ['2025-3', '2025-13', '2025-03-01', 202503, null]) {
    const refused = await exportRoute.POST(new Request('http://app.test/api/export/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month }) }));
    assert.equal(refused.status, 400, String(month));
    assert.deepEqual(await refused.json(), { problem: 'refuse.request' });
  }
  const empty = await postsExportText('2025-07', locale, OWNER);
  assert.equal(empty.replace(/^﻿/u, '').split('\r\n').filter(Boolean).length, 1, 'a month with no shares is the headings alone');
});

// --- reads ---------------------------------------------------------------------------

test('shared addresses cover the span’s days on this computer’s clock, the owner’s only', async () => {
  const mine = await post(OWNER, { day: '2028-06-01' });
  await shared(OWNER, mine.id, 'instagram', at('2028-06-01', 0, 0), { sharedLink: 'https://instagram.com/p/start' });
  await shared(OWNER, mine.id, 'facebook', at('2028-06-30', 23, 59), { sharedLink: 'https://facebook.com/p/end' });
  await shared(OWNER, mine.id, 'x', at('2028-07-01', 0, 0), { sharedLink: 'https://x.com/p/after' });
  await shared(OWNER, mine.id, 'threads', at('2028-06-10'));
  const theirs = await post(OTHER, { day: '2028-06-02' });
  await shared(OTHER, theirs.id, 'instagram', at('2028-06-02'), { sharedLink: 'https://instagram.com/p/theirs' });
  // `now` is the month's last minute (a share at that very moment is shared); one half a minute later is still scheduled.
  const now = at('2028-06-30', 23, 59);
  await shared(OWNER, mine.id, 'bluesky', new Date(2028, 5, 30, 23, 59, 30).toISOString());
  const rows = await posts.listSharedFor(OWNER, '2028-06-01', '2028-06-30', { now });
  assert.deepEqual(Object.fromEntries(rows.map((row) => [`${row.postId} ${row.network}`, row.sharedLink])), {
    [`${mine.id} instagram`]: 'https://instagram.com/p/start',
    [`${mine.id} facebook`]: 'https://facebook.com/p/end',
    [`${mine.id} threads`]: null,
  }, 'the one scheduled after now is not shared yet');
  assert.ok((await posts.listSharedFor(OWNER, '2028-06-01', '2028-06-30', { now: at('2028-07-01', 0, 0) })).some((row) => row.network === 'bluesky'), 'once its moment passes, it is');
  await assert.rejects(posts.listSharedFor(OWNER, '2028-06-30', '2028-06-01'), (error) => error instanceof DataError && error.messageKey === 'refuse.request');
  await assert.rejects(posts.listSharedFor(OWNER, '2028-06', '2028-06-30'), (error) => error instanceof DataError);
});

test('chosen pictures: the owner’s only, a card with its comment’s words, at most twenty posts', async () => {
  const comment = await modelAction('CustomerComment', 'create', {
    data: { ownerId: OWNER, name: 'Ayşe', text: 'The best mug.', bestLine: 'Best mug', stars: 5, receivedOn: '2028-01-01', permission: 'yes', createdAt: stamp(), updatedAt: stamp() },
  });
  const words = await posts.createPostFor(OWNER, { name: 'Words' });
  await posts.addPictureFor(OWNER, words.id, { source: 'words', words: 'Autumn is here' });
  const card = await posts.createPostFor(OWNER, { name: 'Card' });
  await posts.addPictureFor(OWNER, card.id, { source: 'card', commentId: comment.id });
  const bare = await posts.createPostFor(OWNER, { name: 'No picture' });
  const theirs = await post(OTHER);
  await modelAction('PostPicture', 'create', { data: { ownerId: OTHER, postId: theirs.id, source: 'words', words: 'Theirs', chosen: true, position: 1, createdAt: stamp() } });

  const chosen = await ideas.chosenPicturesFor(OWNER, [words.id, card.id, bare.id, theirs.id]);
  assert.deepEqual(Object.keys(chosen).map(Number).sort((a, b) => a - b), [words.id, card.id].sort((a, b) => a - b));
  assert.equal(chosen[words.id].source, 'words');
  assert.equal(chosen[words.id].words, 'Autumn is here');
  assert.equal(chosen[words.id].chosen, true);
  assert.deepEqual(chosen[card.id].card, { bestLine: 'Best mug', text: 'The best mug.', name: 'Ayşe', stars: 5 });
  assert.deepEqual(Object.keys(chosen[words.id].shapes), ['square', 'portrait', 'story', 'wide', 'landscape', 'tall', 'gbp']);
  const full = await posts.getPostFor(OWNER, card.id);
  assert.deepEqual(chosen[card.id], full.pictures[0], 'the same summary the posts file gives');
  // Once the customer's permission is not yes, the card gives no words here either.
  await modelAction('CustomerComment', 'updateMany', { where: { id: comment.id, ownerId: OWNER }, data: { permission: 'no' } });
  const refusedCard = (await ideas.chosenPicturesFor(OWNER, [card.id]))[card.id];
  assert.deepEqual([refusedCard.card, refusedCard.cardRefused], [null, true]);
  assert.deepEqual(refusedCard, (await posts.getPostFor(OWNER, card.id)).pictures[0], 'the same summary the posts file gives');
  await modelAction('CustomerComment', 'updateMany', { where: { id: comment.id, ownerId: OWNER }, data: { permission: 'yes' } });

  assert.deepEqual(await ideas.chosenPicturesFor(OWNER, []), {});
  const twenty = Array.from({ length: 20 }, (_, index) => 900000 + index);
  assert.deepEqual(await ideas.chosenPicturesFor(OWNER, twenty), {});
  await assert.rejects(ideas.chosenPicturesFor(OWNER, [...twenty, 900020]), (error) => error instanceof DataError && error.messageKey === 'refuse.request');
});

/** The length of every `in` list in a call's arguments. */
function inLists(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) inLists(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'in' && Array.isArray(item)) found.push(item.length);
      inLists(item, found);
    }
  }
  return found;
}

/** The values one step's answer holds, as Tellop counts them: 1 + rows x (2 + fields). */
function valuesOf(answer) {
  const fields = (row) => (row !== null && typeof row === 'object' ? Object.keys(row).length : 1);
  if (Array.isArray(answer)) return 1 + answer.length * (2 + Math.max(0, ...answer.map(fields)));
  return answer !== null && typeof answer === 'object' ? 1 + 2 + fields(answer) : 1;
}

/**
 * Inside Tellop every records call goes through its records route, which
 * answers at most 256 rows, 2,048 values a step and 256 KB a call, takes at
 * most 32 steps a call and `in` lists of at most 256 items, and allows 16
 * calls a request. Here the route's hook runs each call on the local store
 * and measures it. The store is switched to local only while a call starts
 * (its records client is chosen as it starts), so calls started together
 * (`Promise.all`) still each come through the hook.
 */
const recordsBounds = await import('./records-bounds.mjs');
const { measured } = recordsBounds;
/** Every call within Tellop's bounds (`tests/records-bounds.mjs`), and at most `most` of them. */
const bounded = (calls, what, most) => recordsBounds.bounded({ calls }, what, most);

/** A moment after every share these checks date in later years: a share before it is shared, not scheduled. */
const LATER = '2040-01-01T00:00:00.000Z';

test('Results read two months from the records’ own counts: customers, sales, shares, followers, the owner’s only, up to now', async () => {
  const [month, last] = ['2026-05', '2026-04'];
  const now = at('2026-05-20', 12, 0);
  await modelAction('Profile', 'create', { data: { ownerId: OWNER, networks: 'instagram,facebook', createdAt: stamp(), updatedAt: stamp() } });
  const first = await modelAction('Theme', 'create', { data: { ownerId: OWNER, name: 'Classes', colour: 0, position: 1, createdAt: stamp(), updatedAt: stamp() } });
  const second = await modelAction('Theme', 'create', { data: { ownerId: OWNER, name: 'Tips', colour: 1, position: 2, createdAt: stamp(), updatedAt: stamp() } });
  const p1 = await post(OWNER, { name: 'Pottery class', day: '2026-05-03', themeId: first.id, ask: 'book' });
  const p2 = await post(OWNER, { name: 'Glaze tips', day: '2026-04-10', themeId: second.id });
  const p3 = await post(OWNER, { name: 'Studio day', day: '2026-05-10', ask: 'buy' });
  await posts.addPictureFor(OWNER, p1.id, { source: 'words', words: 'Book a class' });
  await shared(OWNER, p1.id, 'instagram', at('2026-05-03'), { likes: 10, comments: 2 });
  await shared(OWNER, p1.id, 'facebook', at('2026-05-04'));
  await shared(OWNER, p1.id, 'x', at('2026-05-25'), { likes: 50 });
  await shared(OWNER, p2.id, 'instagram', at('2026-04-10'), { likes: 4 });
  await shared(OWNER, p3.id, 'facebook', at('2026-05-10'), { views: 100 });
  const enquiry = (fields) => modelAction('Enquiry', 'create', { data: { ownerId: OWNER, name: 'Customer', createdAt: stamp(), updatedAt: stamp(), ...fields } });
  await enquiry({ channel: 'instagram', postId: p1.id, status: 'bought', amount: 300, receivedOn: '2026-05-05' });
  await enquiry({ channel: 'word', postId: p1.id, status: 'talking', receivedOn: '2026-05-06' });
  await enquiry({ channel: 'website', status: 'bought', amount: 50, receivedOn: '2026-05-07' });
  await enquiry({ channel: 'instagram', postId: p2.id, status: 'bought', amount: 200, receivedOn: '2026-04-12' });
  await enquiry({ channel: 'instagram', postId: p2.id, status: 'new', receivedOn: '2026-05-08' });
  await enquiry({ channel: 'instagram', postId: p1.id, status: 'bought', amount: 999, receivedOn: '2026-06-01' });
  await modelAction('Followers', 'createMany', { data: [
    { ownerId: OWNER, month, network: 'instagram', count: 1500, createdAt: stamp(), updatedAt: stamp() },
    { ownerId: OWNER, month: last, network: 'instagram', count: 1400, createdAt: stamp(), updatedAt: stamp() },
    { ownerId: OTHER, month, network: 'instagram', count: 5, createdAt: stamp(), updatedAt: stamp() },
  ] });
  const theirs = await post(OTHER, { name: 'Not yours', day: '2026-05-05', ask: 'book' });
  await shared(OTHER, theirs.id, 'instagram', at('2026-05-05'), { likes: 99 });
  await modelAction('Enquiry', 'create', { data: { ownerId: OTHER, name: 'Theirs', channel: 'instagram', postId: theirs.id, status: 'bought', amount: 5000, receivedOn: '2026-05-05', createdAt: stamp(), updatedAt: stamp() } });

  const before = await modelAction('Post', 'count', {});
  const read = await measured(() => readResults(month, OWNER, { now }));
  bounded(read.calls, 'the page', 10);
  assert.ok(recordsBounds.mostInFlight({ calls: read.calls }) <= 1, 'one call at a time');
  assert.equal(await modelAction('Post', 'count', {}), before, 'reading saved nothing');
  const page = read.value;
  assert.deepEqual([page.month, page.last, page.partial], [month, last, false]);
  assert.deepEqual(page.totals, {
    shares: { value: 3, last: 1 }, typed: { value: 2, last: 1 }, customers: { value: 4, last: 1 }, bought: { value: 2, last: 1 }, sales: { value: 350, last: 200 },
    noPost: { customers: { value: 1, last: 0 }, sales: { value: 50, last: 0 } },
  }, 'the share scheduled after now and the enquiry of the month after are not counted');
  assert.deepEqual(page.byTheme, [
    { themeId: first.id, shares: { value: 2, last: 0 }, customers: { value: 2, last: 0 }, sales: { value: 300, last: 0 }, reactions: { value: 12, last: null } },
    { themeId: second.id, shares: { value: 0, last: 1 }, customers: { value: 1, last: 1 }, sales: { value: 0, last: 200 }, reactions: { value: null, last: 4 } },
    { themeId: null, shares: { value: 1, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 }, reactions: { value: null, last: null } },
  ], 'an old post named by this month’s customer counts this month');
  assert.deepEqual(page.byNetwork, [
    { network: 'instagram', shares: { value: 1, last: 1 }, customers: { value: 2, last: 1 }, sales: { value: 300, last: 200 }, reactions: { value: 12, last: 4 } },
    { network: 'facebook', shares: { value: 2, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 }, reactions: { value: null, last: null } },
  ]);
  assert.deepEqual(page.byChannel, [
    { channel: 'word', customers: { value: 1, last: 0 }, sales: { value: 0, last: 0 } },
    { channel: 'website', customers: { value: 1, last: 0 }, sales: { value: 50, last: 0 } },
  ]);
  assert.deepEqual(page.byAsk, [
    { ask: 'book', shares: { value: 2, last: 0 }, customers: { value: 2, last: 0 }, sales: { value: 300, last: 0 } },
    { ask: 'buy', shares: { value: 1, last: 0 }, customers: { value: 0, last: 0 }, sales: { value: 0, last: 0 } },
    { ask: '', shares: { value: 0, last: 1 }, customers: { value: 1, last: 1 }, sales: { value: 0, last: 200 } },
  ]);
  assert.deepEqual(page.best, [
    { postId: p1.id, name: 'Pottery class', day: '2026-05-03', themeId: first.id, ask: 'book', networks: ['instagram', 'facebook'], customers: 2, sales: 300, reactions: 12 },
    { postId: p2.id, name: 'Glaze tips', day: '2026-04-10', themeId: second.id, ask: '', networks: [], customers: 1, sales: 0, reactions: null },
  ], 'a post shared but bringing nothing is not among the best; the scheduled network is not among its networks');
  assert.deepEqual(page.followers, [{ network: 'instagram', count: 1500, last: 1400 }, { network: 'facebook', count: null, last: null }]);
  assert.equal(page.pictures[p1.id]?.source, 'words');
  assert.deepEqual(page.themes.map((theme) => theme.id).filter((id) => id === first.id || id === second.id), [first.id, second.id], 'the plan’s themes, in its order');

  // After the scheduled moment, the share counts with no further press.
  const later = await readResults(month, OWNER, { now: at('2026-05-31', 23, 0) });
  assert.deepEqual([later.totals.shares.value, later.byNetwork.find((row) => row.network === 'x')?.shares.value], [4, 1]);
});

test('Results at the largest month stay inside every records bound, and say when a count by post was left partial', async (t) => {
  const [month, last] = ['2031-02', '2031-01'];
  const longest = 'ş'.repeat(LIMITS.name);
  const created = stamp();
  const make = async (count, day) => {
    const tag = `${created}#${day ?? 'idea'}`;
    await modelAction('Post', 'createMany', { data: Array.from({ length: count }, (_, index) => ({
      ownerId: OWNER, name: longest, day: day === null ? null : `${day}-${String((index % 28) + 1).padStart(2, '0')}`, ask: 'message', createdAt: created, updatedAt: tag,
    })) });
    return (await modelAction('Post', 'findMany', { where: { ownerId: OWNER, updatedAt: tag }, select: { id: true, day: true }, orderBy: { id: 'asc' } }));
  };
  // A full month of posts (256) shared on every network in each of the two months, and 700 more posts that
  // this month's 700 customers and last month's 700 each name once: more than the counts by post read.
  const thisMonth = await make(256, month);
  const lastMonth = await make(256, last);
  const named = await make(700, null);
  for (const [rows, which] of [[thisMonth, month], [lastMonth, last]]) {
    await modelAction('PostVersion', 'createMany', { data: rows.flatMap((row, index) => NETWORK_KEYS.map((network, place) => ({
      ownerId: OWNER, postId: row.id, network, text: 'Words', sharedAt: at(row.day, 9, place), likes: index + place, comments: 1, shares: 2, saves: 3, views: 1000, clicks: 9, updatedAt: stamp(),
    }))) });
    await modelAction('Enquiry', 'createMany', { data: named.map((row, index) => ({
      ownerId: OWNER, name: longest, channel: NETWORK_KEYS[index % NETWORK_KEYS.length], postId: row.id, status: index % 2 === 0 ? 'bought' : 'new', amount: 1000,
      receivedOn: `${which}-${String((index % 28) + 1).padStart(2, '0')}`, createdAt: stamp(), updatedAt: stamp(),
    })) });
    await modelAction('Followers', 'createMany', { data: NETWORK_KEYS.map((network) => ({ ownerId: OWNER, month: which, network, count: 1_000_000_000, createdAt: stamp(), updatedAt: stamp() })) });
  }
  const read = await measured(() => readResults(month, OWNER, { now: LATER }));
  bounded(read.calls, 'the page at its largest', 12);
  assert.ok(recordsBounds.mostInFlight({ calls: read.calls }) <= 1);
  const page = read.value;
  assert.equal(page.partial, true, '700 posts named by the month’s customers: more than the counts by post read');
  assert.deepEqual([page.totals.shares.value, page.totals.shares.last], [256 * NETWORK_KEYS.length, 256 * NETWORK_KEYS.length], 'the totals stay whole');
  assert.deepEqual([page.totals.customers.value, page.totals.sales.value], [700, 350 * 1000]);
  assert.equal(page.byNetwork.length, NETWORK_KEYS.length);
  assert.equal(page.best.length, 5);
  assert.ok(page.best.every((item) => item.name === longest));
  assert.equal(page.followers.length, NETWORK_KEYS.length);
  t.diagnostic(`Results at the largest month: ${read.calls.length} calls, largest ${recordsBounds.largestCall({ calls: read.calls })} bytes`);
});

test('the file’s reads stay inside one call’s rows and size, and a request’s calls, in a full month', async () => {
  const month = '2027-02';
  const themeRow = await modelAction('Theme', 'create', { data: { ownerId: OWNER, name: 'Full', colour: 2, position: 3, createdAt: stamp(), updatedAt: stamp() } });
  // 40 posts on 10 networks each: 400 shares (as many as the month's read takes), with the longest names,
  // notes and addresses.
  const link = `https://example.com/${'a'.repeat(LIMITS.link - 'https://example.com/'.length)}`;
  for (let index = 0; index < 40; index += 1) {
    const day = `${month}-${String((index % 28) + 1).padStart(2, '0')}`;
    const row = await post(OWNER, { name: 'ş'.repeat(LIMITS.name), day, themeId: themeRow.id });
    await modelBatch(NETWORK_KEYS.slice(0, 10).map((network, place) => ({
      model: 'PostVersion',
      action: 'create',
      args: { data: { ownerId: OWNER, postId: row.id, network, text: 'ş'.repeat(LIMITS.versionText), sharedAt: at(day, 10, place), sharedLink: link,
        likes: index + place, views: 1000, resultNote: 'ş'.repeat(posts.RESULT_NOTE_MOST), updatedAt: stamp() } },
    })));
  }
  const file = await measured(() => postsExportText(month, getLocale(), OWNER, { now: LATER }));
  const lines = file.value.replace(/^﻿/u, '').split('\r\n').filter(Boolean);
  assert.equal((file.value.match(/https:\/\/example\.com\//gu) ?? []).length, 400, 'every share’s address was read');
  bounded(file.calls, 'the file');
  assert.ok(recordsBounds.mostInFlight({ calls: file.calls }) <= 1);
  // The longest words of 400 shares do not fit in one request: the earliest shares carry theirs, and the last line says how many did not.
  const withWords = posts.SHARED_WORDS_A_CALL * 7;
  assert.equal(lines.length, 1 + 400 + 1);
  assert.equal(lines.slice(1, 401).filter((line) => line.includes('ş'.repeat(LIMITS.versionText))).length, withWords);
  assert.ok(lines.slice(1, 1 + withWords).every((line) => line.includes('ş'.repeat(LIMITS.versionText))), 'the earliest first');
  assert.equal(lines.at(-1), t('results.export.wordsLeftOut', getLocale(), { count: String(400 - withWords) }));
  const before = await measured(() => postsExportText(month, getLocale(), OWNER, { now: at('2027-01-31', 12, 0) }));
  assert.equal(before.value.replace(/^﻿/u, '').split('\r\n').filter(Boolean).length, 1, 'shares scheduled after now are not in the file');
});

test('a month still running is compared with the same days of the month before, a past month with the whole month', async () => {
  const { sameDaysThrough } = await import('../app/results/read.js');
  assert.equal(sameDaysThrough('2027-03', '2027-03-31'), '2027-02-28', 'the 31st against a 28-day month: its last day');
  assert.equal(sameDaysThrough('2028-03', '2028-03-31'), '2028-02-29', 'a leap year');
  assert.equal(sameDaysThrough('2027-05', '2027-05-31'), '2027-04-30', 'the 31st against a 30-day month');
  assert.equal(sameDaysThrough('2027-05', '2027-05-30'), '2027-04-30');
  assert.equal(sameDaysThrough('2027-05', '2027-05-29'), '2027-04-29');
  assert.equal(sameDaysThrough('2027-03', '2027-03-01'), '2027-02-01', 'the 1st: the 1st');
  assert.equal(sameDaysThrough('2027-01', '2027-01-15'), '2026-12-15', 'across a year');
  assert.equal(sameDaysThrough('2027-03', '2027-04-10'), null, 'a past month: the whole month before');
  assert.equal(sameDaysThrough('2027-03', '2027-02-27'), null, 'a month ahead too');

  const owner = 'window-owner';
  const p = await post(owner, { name: 'Window', day: '2027-04-01' });
  // April has 30 days: its first day, its 29th and its last, each with a share and a customer who bought.
  for (const [day, hour, amount] of [['2027-04-01', 0, 100], ['2027-04-29', 23, 20], ['2027-04-30', 23, 3]]) {
    await shared(owner, p.id, ['instagram', 'facebook', 'x'][[100, 20, 3].indexOf(amount)], at(day, hour, hour === 0 ? 0 : 59));
    await modelAction('Enquiry', 'create', { data: { ownerId: owner, name: 'C', channel: 'word', status: 'bought', amount, receivedOn: day, createdAt: stamp(), updatedAt: stamp() } });
  }
  await modelAction('Followers', 'create', { data: { ownerId: owner, month: '2027-04', network: 'instagram', count: 700, createdAt: stamp(), updatedAt: stamp() } });
  const last = async (now) => {
    const read = await readResults('2027-05', owner, { now });
    return [read.sameDays, read.totals.shares.last, read.totals.customers.last, read.totals.sales.last, read.followers.find((row) => row.network === 'instagram')?.last ?? null];
  };
  assert.deepEqual(await last(at('2027-05-31', 12)), [true, 3, 3, 123, 700], 'the 31st: all of April');
  assert.deepEqual(await last(at('2027-05-30', 8)), [true, 3, 3, 123, 700], 'the 30th: all of April, its last day whole');
  assert.deepEqual(await last(at('2027-05-29', 8)), [true, 2, 2, 120, 700], 'the 29th: April up to the 29th’s end');
  assert.deepEqual(await last(at('2027-05-01', 0, 30)), [true, 1, 1, 100, 700], 'the 1st: April’s 1st only; followers stay April’s number');
  assert.deepEqual(await last(at('2027-06-02', 12)), [false, 3, 3, 123, 700], 'a past month: the whole month before');
});
