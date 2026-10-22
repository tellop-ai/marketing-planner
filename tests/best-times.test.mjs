/**
 * Best times: per platform, by weekday and three time bands, the middle
 * reactions of the person's own shares with results; shown only after 12
 * such shares over 6 different weeks. The bands' edges, the thresholds at
 * the edge and one each side, the middle value, which day and band is named,
 * and the records read (only this owner's shares with reactions typed, never
 * one scheduled for later, inside Tellop's records bounds).
 *
 * A throwaway store (`APP_DATA_FILE` in a temporary folder, removed
 * afterwards). No check uses the network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'best-times-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');
delete process.env.TELLOP_INTERNAL_RECORDS;

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const times = await import('../lib/plan/best-times.js');
const { addDays, partsOf } = await import('../lib/plan/days.js');
const resultImport = await import('../lib/data/result-import.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
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
/** A Monday. */
const MONDAY = '2026-03-02';

/** Shares on one platform: `count` of them, one a week from `MONDAY` for `weeks` weeks then more in the last week. */
function spread({ network = 'instagram', count, weeks, weekday = 4, time = '18:30', reactions = 10 }) {
  return Array.from({ length: count }, (_, index) => {
    const week = Math.min(index, weeks - 1);
    return { network, at: `${addDays(MONDAY, week * 7 + weekday - 1)}T${time}`, reactions: typeof reactions === 'function' ? reactions(index) : reactions };
  });
}

// --- bands -------------------------------------------------------------------------------

test('the bands’ edges: 04:59 evening of the day before, 05:00 morning, 12:00 afternoon, 17:00 evening', () => {
  // 2026-03-05 is a Thursday (weekday 4).
  const cases = [
    ['2026-03-05T04:59', 3, 'evening'], ['2026-03-05T00:00', 3, 'evening'],
    ['2026-03-05T05:00', 4, 'morning'], ['2026-03-05T11:59', 4, 'morning'],
    ['2026-03-05T12:00', 4, 'afternoon'], ['2026-03-05T16:59', 4, 'afternoon'],
    ['2026-03-05T17:00', 4, 'evening'], ['2026-03-05T23:59', 4, 'evening'],
    ['2026-03-02T03:00', 7, 'evening'], ['2026-03-08T12:00', 7, 'afternoon'],
  ];
  for (const [at, weekday, band] of cases) assert.deepEqual(times.slotOf(at), { weekday, band, day: at.slice(0, 10) }, at);
  for (const time of ['04:59', '00:00']) assert.equal(times.bandOf(time), 'evening');
  assert.equal(times.bandOf('05:00'), 'morning');
  assert.equal(times.bandOf('12:00'), 'afternoon');
  assert.equal(times.bandOf('17:00'), 'evening');
  for (const bad of [null, '', '2026-03-05', '2026-03-05T24:00', '2026-02-30T10:00', '2026-03-05 10:00']) assert.equal(times.slotOf(bad), null, String(bad));
});

test('the middle value', () => {
  assert.equal(times.median([]), null);
  assert.equal(times.median([7]), 7);
  assert.equal(times.median([9, 1, 5]), 5);
  assert.equal(times.median([1, 2, 10, 4]), 3);
});

// --- thresholds ------------------------------------------------------------------------------

test('12 shares with results over 6 weeks, at the edge and one each side', () => {
  const at = (count, weeks) => times.bestTimes(spread({ count, weeks })).instagram;
  const ready = at(12, 6);
  assert.equal(ready.ready, true);
  assert.deepEqual([ready.shares, ready.weeks, ready.morePosts, ready.moreWeeks], [12, 6, 0, 0]);
  assert.deepEqual(ready.best, { weekday: 4, band: 'evening', shares: 12, median: 10 });
  const fewer = at(11, 6);
  assert.equal(fewer.ready, false);
  assert.deepEqual([fewer.morePosts, fewer.moreWeeks, fewer.slots, fewer.best], [1, 0, [], null]);
  const shorter = at(12, 5);
  assert.equal(shorter.ready, false);
  assert.deepEqual([shorter.morePosts, shorter.moreWeeks, shorter.best], [0, 1, null]);
  assert.equal(at(13, 7).ready, true);
  assert.deepEqual(times.needOf({ instagram: at(3, 2) }, 'instagram'), { morePosts: 9, moreWeeks: 4 });
  assert.deepEqual(times.needOf(null, 'facebook'), { morePosts: 12, moreWeeks: 6 }, 'a platform with none needs them all');
  // Weeks start on Monday: a Sunday and the Monday after are two weeks, a Monday and the Sunday after one.
  const sundayMonday = times.bestTimes([{ network: 'x', at: '2026-03-08T12:00', reactions: 1 }, { network: 'x', at: '2026-03-09T12:00', reactions: 1 }]);
  assert.equal(sundayMonday.x.weeks, 2);
  const mondaySunday = times.bestTimes([{ network: 'x', at: '2026-03-02T12:00', reactions: 1 }, { network: 'x', at: '2026-03-08T12:00', reactions: 1 }]);
  assert.equal(mondaySunday.x.weeks, 1);
});

test('each platform counts on its own', () => {
  const answer = times.bestTimes([...spread({ count: 12, weeks: 6 }), ...spread({ network: 'facebook', count: 11, weeks: 6 })]);
  assert.equal(answer.instagram.ready, true);
  assert.equal(answer.facebook.ready, false);
  assert.equal(answer.linkedin, undefined);
});

test('a day and band is named only with two shares and a middle value at least the platform’s; the highest first, at most three', () => {
  const items = [
    ...spread({ count: 6, weeks: 6, weekday: 2, time: '09:00', reactions: (index) => [5, 7, 9, 11, 13, 15][index] }), // Tuesday mornings: middle 10
    ...spread({ count: 3, weeks: 3, weekday: 4, time: '19:00', reactions: (index) => [30, 40, 50][index] }), // Thursday evenings: 40
    { network: 'instagram', at: '2026-03-07T13:00', reactions: 500 }, // one lucky Saturday afternoon
    ...spread({ count: 2, weeks: 2, weekday: 5, time: '12:30', reactions: 40 }), // Friday afternoons: 40, fewer shares
    ...spread({ count: 2, weeks: 1, weekday: 1, time: '07:00', reactions: 1 }), // Monday mornings: 1
  ];
  const answer = times.bestTimes(items).instagram;
  assert.equal(answer.ready, true);
  assert.equal(answer.shares, 14);
  // The middle of all fourteen is 14: Tuesday mornings (10) and Monday mornings (1) do worse than usual.
  assert.equal(answer.usual, 14);
  assert.equal(answer.steady, 4);
  assert.deepEqual(answer.slots, [
    { weekday: 4, band: 'evening', shares: 3, median: 40 },
    { weekday: 5, band: 'afternoon', shares: 2, median: 40 },
  ]);
  assert.deepEqual(answer.best, answer.slots[0]);
  // Enough shares, but no day and band holds two: nothing named.
  const scattered = times.bestTimes(Array.from({ length: 12 }, (_, index) => ({ network: 'x', at: `${addDays(MONDAY, index * 8)}T${index % 2 === 0 ? '09' : '20'}:00`, reactions: index })));
  assert.equal(scattered.x.ready, true);
  assert.deepEqual([scattered.x.slots, scattered.x.best], [[], null]);
  // Items that cannot be read are left out.
  const odd = times.bestTimes([{ network: 'x', at: 'later', reactions: 1 }, { network: '', at: '2026-03-02T10:00', reactions: 1 }, { network: 'x', at: '2026-03-02T10:00', reactions: -1 }, null]);
  assert.deepEqual(odd, {});
  assert.deepEqual(times.slotKeys({ weekday: 4, band: 'evening' }), { day: 'results.bestTimes.day.4', band: 'results.bestTimes.band.evening' });
});

test('a slot shows at the platform’s middle value and above, never one below it', () => {
  // Twelve shares over six weeks: the platform's middle is 10.
  const items = [
    ...spread({ count: 2, weeks: 2, weekday: 1, time: '09:00', reactions: 10 }), // Monday mornings: 10, the platform's middle
    ...spread({ count: 2, weeks: 2, weekday: 3, time: '19:00', reactions: 9 }), // Wednesday evenings: 9, one below
    // One share in each of eight other days and bands, over six weeks.
    ...[[2, '09:00'], [2, '13:00'], [4, '09:00'], [4, '13:00'], [5, '09:00'], [5, '13:00'], [6, '09:00'], [7, '13:00']].map(([weekday, time], index) => ({
      network: 'instagram', at: `${addDays(MONDAY, (index % 6) * 7 + weekday - 1)}T${time}`, reactions: [10, 10, 10, 10, 11, 11, 11, 11][index],
    })),
  ];
  const answer = times.bestTimes(items).instagram;
  assert.deepEqual([answer.ready, answer.shares, answer.usual], [true, 12, 10]);
  assert.deepEqual(answer.slots, [{ weekday: 1, band: 'morning', shares: 2, median: 10 }]);
  // Raised by one, Wednesday evenings reach the middle and show too.
  const raised = times.bestTimes(items.map((item) => (item.reactions === 9 ? { ...item, reactions: 10 } : item))).instagram;
  assert.deepEqual(raised.slots.map((slot) => `${slot.weekday}-${slot.band}`), ['1-morning', '3-evening']);
  // Every day and band with two shares below the middle: none shows, and the platform says so (steady > 0).
  const below = times.bestTimes(items.map((item, index) => (index < 4 ? { ...item, reactions: 1 } : item))).instagram;
  assert.deepEqual([below.ready, below.usual, below.slots, below.steady], [true, 10, [], 2]);
});

test('a share counts when it went out: the planned day and time once pressed that day or later, else the press', () => {
  const at = (day, hour, minute = 0) => {
    const { year, month, day: date } = partsOf(day);
    return new Date(year, month - 1, date, hour, minute).toISOString();
  };
  const post = { day: '2026-03-05', time: '19:30' };
  // Pressed later that day, or the next morning: the planned moment.
  assert.equal(resultImport.wentOutAt(at('2026-03-05', 22), post), '2026-03-05T19:30');
  assert.equal(resultImport.wentOutAt(at('2026-03-06', 8), post), '2026-03-05T19:30');
  // Pressed on the day before (it went out early): the press.
  assert.equal(resultImport.wentOutAt(at('2026-03-04', 23, 59), post), '2026-03-04T23:59');
  // On the day itself, before the planned time: the day is the same, so the planned time.
  assert.equal(resultImport.wentOutAt(at('2026-03-05', 0, 0), post), '2026-03-05T19:30');
  // No time, no day, or a time that is not one: the press.
  for (const other of [{ day: '2026-03-05', time: '' }, { day: '2026-03-05', time: null }, { day: null, time: '19:30' }, { day: '2026-03-05', time: '24:00' }, undefined]) {
    assert.equal(resultImport.wentOutAt(at('2026-03-06', 8), other), '2026-03-06T08:00', JSON.stringify(other));
  }
  assert.equal(resultImport.wentOutAt('', post), null);
});

test('a local moment of a shared time', () => {
  assert.equal(times.localMoment(new Date(2026, 2, 5, 4, 59).toISOString()), '2026-03-05T04:59');
  assert.equal(times.localMoment(''), null);
  assert.equal(times.localMoment('soon'), null);
});

// --- the records read -----------------------------------------------------------------------

/** A local moment of a civil day as an ISO instant. */
function momentOn(day, hour, minute = 0) {
  const { year, month, day: date } = partsOf(day);
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

let made = 0;
async function shared({ owner = OWNER, network = 'instagram', sharedAt, counts = {}, day = null, time = null }) {
  made += 1;
  const post = await modelAction('Post', 'create', { data: { ownerId: owner, name: `Post ${made}`, day, time, createdAt: stamp(), updatedAt: stamp() } });
  return modelAction('PostVersion', 'create', { data: { ownerId: owner, postId: post.id, network, sharedAt, updatedAt: stamp(), ...counts } });
}

async function clear() {
  await modelAction('PostVersion', 'deleteMany', { where: { ownerId: { in: [OWNER, OTHER] } } });
  await modelAction('Post', 'deleteMany', { where: { ownerId: { in: [OWNER, OTHER] } } });
}

test('best times read only this owner’s shares with reactions typed, up to now, at their shared time on this clock', async () => {
  await clear();
  for (let week = 0; week < 6; week += 1) {
    for (const hour of [18, 19]) {
      await shared({ sharedAt: momentOn(addDays(MONDAY, week * 7 + 3), hour), counts: { likes: 10 + week, comments: 2 } });
    }
  }
  // Not counted: views only, no results, another owner's, scheduled for later, not shared.
  await shared({ sharedAt: momentOn(MONDAY, 9), counts: { views: 900 } });
  await shared({ sharedAt: momentOn(MONDAY, 9) });
  for (let index = 0; index < 4; index += 1) await shared({ owner: OTHER, sharedAt: momentOn(MONDAY, 9), counts: { likes: 999 } });
  await shared({ sharedAt: new Date(Date.now() + 86_400_000).toISOString(), counts: { likes: 999 } });
  await shared({ sharedAt: null, counts: { likes: 999 } });
  const answer = await resultImport.bestTimesFor(OWNER);
  assert.deepEqual(Object.keys(answer), ['instagram']);
  assert.equal(answer.instagram.shares, 12);
  assert.equal(answer.instagram.weeks, 6);
  assert.deepEqual(answer.instagram.best, { weekday: 4, band: 'evening', shares: 12, median: 14.5 }, 'likes and comments added up, the middle of 12 to 17');
  // Two posts planned for Thursday 08:30 and marked shared that evening count in the morning, at their planned time.
  const planned = [];
  for (const week of [0, 1]) {
    const thursday = addDays(MONDAY, week * 7 + 3);
    planned.push(await shared({ sharedAt: momentOn(thursday, 21), counts: { likes: 1000 }, day: thursday, time: '08:30' }));
  }
  assert.deepEqual((await resultImport.bestTimesFor(OWNER)).instagram.best, { weekday: 4, band: 'morning', shares: 2, median: 1000 });
  // Planned for a later day but marked shared on those Thursday evenings: they count at the press.
  await modelAction('Post', 'updateMany', { where: { id: { in: planned.map((version) => version.postId) } }, data: { day: addDays(MONDAY, 11) } });
  const pressed = (await resultImport.bestTimesFor(OWNER)).instagram;
  assert.deepEqual(pressed.best, { weekday: 4, band: 'evening', shares: 14, median: 15 });
  assert.equal(pressed.slots.some((slot) => slot.band === 'morning'), false);
  await modelAction('PostVersion', 'deleteMany', { where: { id: { in: planned.map((version) => version.id) } } });
  // One fewer week: not ready.
  await modelAction('PostVersion', 'updateMany', { where: { ownerId: OWNER, sharedAt: { lt: momentOn(addDays(MONDAY, 7), 0) } }, data: { likes: null, comments: null } });
  const fewer = await resultImport.bestTimesFor(OWNER);
  assert.deepEqual([fewer.instagram.ready, fewer.instagram.shares, fewer.instagram.weeks, fewer.instagram.morePosts, fewer.instagram.moreWeeks], [false, 10, 5, 2, 1]);
});

test('best times keep every records bound: the newest 400 shares, their posts’ days and times, in at most 3 calls, one at a time', async () => {
  await clear();
  const at = stamp();
  const count = resultImport.MOST_RESULT_SHARES + 50;
  await modelAction('Post', 'createMany', { data: Array.from({ length: count }, (_, index) => ({ ownerId: OWNER, name: `Many ${index}`, day: addDays('2024-01-01', index), time: '18:30', createdAt: at, updatedAt: at })) });
  const postRows = await modelAction('Post', 'findMany', { where: { ownerId: OWNER }, orderBy: { id: 'asc' }, select: { id: true } });
  await modelAction('PostVersion', 'createMany', {
    data: postRows.map((post, index) => ({
      ownerId: OWNER, postId: post.id, network: index % 2 === 0 ? 'instagram' : 'facebook',
      sharedAt: momentOn(addDays('2024-01-01', index), 18), likes: 1_000_000_000, comments: 1_000_000_000, shares: 1_000_000_000, saves: 1_000_000_000, updatedAt: at,
    })),
  });
  const run = await measured(() => resultImport.bestTimesFor(OWNER));
  bounded(run, 'best times', 3);
  assert.equal(mostInFlight(run), 1);
  assert.equal(run.value.instagram.shares + run.value.facebook.shares, resultImport.MOST_RESULT_SHARES, 'the newest 400');
  assert.equal(run.value.instagram.best.median, 4_000_000_000);
});
