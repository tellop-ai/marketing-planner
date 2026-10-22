/**
 * The pages' own pure rules (calendar, customers, My plan), and what My
 * plan's page reads, checked against a throwaway store (`APP_DATA_FILE`
 * points at a temporary folder that is removed afterwards).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'pages-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { cn } = await import('../lib/utils.js');
const { addDays } = await import('../lib/plan/days.js');
const rules = await import('../app/calendar/rules.js');
const paging = await import('../app/customers/paging.js');
const { hashtagSetsOf } = await import('../app/plan/hashtag-sets.js');

const NOW = '2026-10-21T09:00:00.000Z';

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------------ the calendar */

test('a month tile\'s name stays hidden on a phone\'s columns, whatever display class joins it, and shows on paper', () => {
  const classes = rules.WIDE_NAME.split(' ');
  // Every class that hides the name survives the join, in either order (`hidden lg:block` lost its `hidden` here).
  for (const joined of [cn('line-clamp-2 min-w-0', rules.WIDE_NAME), cn(rules.WIDE_NAME, 'line-clamp-2'), cn('truncate', rules.WIDE_NAME)]) {
    const kept = joined.split(' ');
    for (const name of classes) assert.ok(kept.includes(name), `"${name}" is kept in "${joined}"`);
  }
  // It hides only below the wide breakpoint and never on paper.
  assert.ok(classes.every((name) => name.startsWith('max-lg:not-print:')), rules.WIDE_NAME);
  assert.ok(classes.some((name) => name.endsWith(':hidden')), rules.WIDE_NAME);
});

test('a campaign bar\'s name reads across the days its bar runs on in that week row, and no further', () => {
  // Sunday-first October 2026: 27 Sep .. 31 Oct; the month's own days draw bars.
  const days = Array.from({ length: 35 }, (_, index) => addDays('2026-09-27', index));
  const campaigns = [{ id: 1, name: 'Autumn sale', startsOn: '2026-10-06', endsOn: '2026-10-12' }, { id: 2, name: 'Late', startsOn: '2026-10-29', endsOn: '2026-11-03' }];
  const { byDay } = rules.campaignBars(campaigns, days, (day) => day.startsWith('2026-10'));
  const at = (day) => days.indexOf(day);
  // Tuesday 6 to Saturday 10: five days of its first row; Sunday 11 starts a row with two days left.
  assert.equal(rules.barReach(byDay, days, at('2026-10-06'), 1), 5);
  assert.equal(rules.barReach(byDay, days, at('2026-10-10'), 1), 1);
  assert.equal(rules.barReach(byDay, days, at('2026-10-11'), 1), 2);
  // A day the campaign does not run on has no room; another campaign's bar is not its room.
  assert.equal(rules.barReach(byDay, days, at('2026-10-05'), 1), 0);
  assert.equal(rules.barReach(byDay, days, at('2026-10-06'), 2), 0);
  // The muted days after the month draw no bar: the room ends with the month.
  assert.equal(rules.barReach(byDay, days, at('2026-10-29'), 2), 3);
  // A width for each reach of one to seven days.
  assert.equal(rules.REACH_WIDTH.length, 7);
});

/** @param {number} id @param {string | null} day @param {string} state */
const tile = (id, day, state) => ({ id, day, time: null, state });

test('the week\'s goal counts a post shared on any of its networks', () => {
  const today = '2026-10-21';
  // Sunday-first: 18 to 24 October. Monday-first: 19 to 25 October.
  const list = [tile(1, '2026-10-18', 'shared'), tile(2, '2026-10-19', 'partly'), tile(3, '2026-10-24', 'shared'), tile(4, '2026-10-25', 'partly'),
    tile(5, '2026-10-21', 'ready'), tile(6, '2026-10-17', 'shared'), tile(7, null, 'partly'), tile(8, '2026-10-22', 'draft'), tile(9, '2026-10-20', 'idea')];
  assert.deepEqual(rules.weekGoal(list, today, false, 3), { goal: 3, shared: 3, filled: 3 });
  assert.deepEqual(rules.weekGoal(list, today, true, 2), { goal: 2, shared: 3, filled: 2 });
  // One post shared on one network of two: one of the goal.
  assert.deepEqual(rules.weekGoal([tile(1, today, 'partly')], today, true, 3), { goal: 3, shared: 1, filled: 1 });
  assert.deepEqual(rules.weekGoal([tile(1, today, 'ready')], today, true, 3), { goal: 3, shared: 0, filled: 0 });
});

test('Fill my month\'s proposals show only in the month they were made for', () => {
  const proposed = { month: '2026-11', madeBy: 'ai', proposals: [{ day: '2026-11-03', name: 'Mugs' }] };
  assert.deepEqual(rules.proposalsFor(proposed, '2026-11'), proposed.proposals);
  assert.deepEqual(rules.proposalsFor(proposed, '2026-12'), []);
  assert.deepEqual(rules.proposalsFor(proposed, '2026-10'), []);
  assert.deepEqual(rules.proposalsFor(null, '2026-11'), []);
});

test('New post for a special day starts the words box with its suggestion, except on a day of remembrance', () => {
  const day = '2026-10-29';
  const republic = { key: 'republicDay', kind: 'celebration' };
  assert.deepEqual(rules.specialPostBody({ day, special: republic, name: 'Republic Day', hint: 'Thank your customers.' }),
    { day, specialDay: 'republicDay', name: 'Republic Day', mainText: 'Thank your customers.' });
  // A day of remembrance: its line is not words to post.
  assert.deepEqual(rules.specialPostBody({ day: '2026-11-10', special: { key: 'ataturkDay', kind: 'remembrance' }, name: 'Remembrance', hint: 'Not a day for offers' }),
    { day: '2026-11-10', specialDay: 'ataturkDay', name: 'Remembrance' });
  // An own day without a note sends no words.
  assert.equal('mainText' in rules.specialPostBody({ day, special: { key: 'own-4', kind: 'own' }, name: 'Shop birthday', hint: '  ' }), false);
  // The longest name and words a post takes, and one letter more (two-byte letters count as one).
  const name = (count) => 'ş'.repeat(count);
  assert.equal(rules.specialPostBody({ day, special: republic, name: name(LIMITS.name), hint: 'x' }).name, name(LIMITS.name));
  assert.equal(rules.specialPostBody({ day, special: republic, name: name(LIMITS.name + 1), hint: 'x' }).name, name(LIMITS.name));
  assert.equal(rules.specialPostBody({ day, special: republic, name: 'x', hint: name(LIMITS.mainText) }).mainText, name(LIMITS.mainText));
  assert.equal(rules.specialPostBody({ day, special: republic, name: 'x', hint: name(LIMITS.mainText + 1) }).mainText, name(LIMITS.mainText));
});

/* ------------------------------------------------------------ the customers */

test('a page of a list reads as { items, next }; anything else is not a page', () => {
  assert.deepEqual(paging.pageOf({ items: [{ id: 1 }], next: 'c1' }), { items: [{ id: 1 }], next: 'c1' });
  assert.deepEqual(paging.pageOf({ items: [], next: null }), { items: [], next: null });
  // No cursor, or one that is not a word, means nothing comes after.
  assert.deepEqual(paging.pageOf({ items: [{ id: 1 }] }), { items: [{ id: 1 }], next: null });
  assert.deepEqual(paging.pageOf({ items: [{ id: 1 }], next: '' }), { items: [{ id: 1 }], next: null });
  assert.deepEqual(paging.pageOf({ items: [{ id: 1 }], next: 7 }), { items: [{ id: 1 }], next: null });
  for (const value of [null, undefined, [], 'x', { comments: [] }, { items: 'x' }]) assert.equal(paging.pageOf(value), null, JSON.stringify(value));
});

test('Show more asks for the page after the cursor, and shows each row once', () => {
  assert.equal(paging.moreAddress('/api/comments', {}, 'c&1'), '/api/comments?after=c%261');
  assert.equal(paging.moreAddress('/api/enquiries', { month: '2026-10' }, 'x'), '/api/enquiries?month=2026-10&after=x');
  const shown = [{ id: 3, v: 'a' }, { id: 2, v: 'b' }];
  assert.deepEqual(paging.joinPages(shown, [{ id: 2, v: 'moved' }, { id: 1, v: 'c' }]), [{ id: 3, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }]);
  assert.deepEqual(paging.joinPages(shown, []), shown);
  assert.deepEqual(paging.joinPages([], [{ id: 5 }]), [{ id: 5 }]);
});

/* ------------------------------------------------------------ My plan, Ready words */

test('a theme\'s hashtags offer the hashtag sets kept in Ready words, cleaned as a theme keeps them', () => {
  const sets = hashtagSetsOf([
    { id: 1, kind: 'bio', title: 'Bio', text: '#notaset' },
    { id: 2, kind: 'hashtags', title: 'Clay', text: '#clay  #handmade\n#clay #çömlek' },
    { id: 3, kind: 'hashtags', title: 'Empty', text: '123 456 !!! #' },
    { id: 4, kind: 'hashtags', title: 'Words', text: 'pottery class' },
  ]);
  assert.deepEqual(sets, [{ id: 2, title: 'Clay', hashtags: '#clay #handmade #çömlek' }, { id: 4, title: 'Words', hashtags: '#pottery #class' }]);
  // The most hashtags a post takes, and one more: the set fills the field with the most.
  const many = (count) => Array.from({ length: count }, (_, index) => `#tag${index}a`).join(' ');
  assert.equal(hashtagSetsOf([{ id: 1, kind: 'hashtags', title: 't', text: many(LIMITS.hashtags) }])[0].hashtags.split(' ').length, LIMITS.hashtags);
  assert.equal(hashtagSetsOf([{ id: 1, kind: 'hashtags', title: 't', text: many(LIMITS.hashtags + 1) }])[0].hashtags.split(' ').length, LIMITS.hashtags);
  assert.deepEqual(hashtagSetsOf([]), []);
});

/**
 * Runs `work` as inside Tellop (`measured`) and also counts the records calls
 * that wait for their answer at the same moment: Tellop answers at most four
 * of one request at once and fails the fifth.
 */
async function measuredAtOnce(work) {
  const { measured } = await import('./records-bounds.mjs');
  const ACTION = Symbol.for('tellop.internalRecordsAction');
  let waiting = 0;
  let most = 0;
  const result = await measured(async () => {
    const inner = globalThis[ACTION];
    globalThis[ACTION] = async (steps) => {
      waiting += 1;
      most = Math.max(most, waiting);
      try {
        return await inner(steps);
      } finally {
        waiting -= 1;
      }
    };
    try {
      return await work();
    } finally {
      globalThis[ACTION] = inner;
    }
  });
  return { ...result, atOnce: most };
}

test('My plan\'s page reads, at their largest with the longest words, stay within Tellop\'s bounds, at most three calls at once', async () => {
  const plan = await import('../lib/data/plan.js');
  const { bounded } = await import('./records-bounds.mjs');
  const { readPlanPage } = await import('../app/plan/read.js');
  const longest = (count) => 'ş'.repeat(count);
  const field = longest(LIMITS.profileField);
  await plan.saveProfileFor(OWNER, { businessName: field, offer: field, audience: field, goal: field, voice: field, pictureStyle: longest(LIMITS.pictureStyle), profileLink: field, reviewLink: field });
  // The themes in use and archived ones past what one read answers, each with the longest words.
  await modelAction('Theme', 'createMany', {
    data: Array.from({ length: plan.MOST_THEMES + 4 }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), about: longest(LIMITS.themeAbout), hashtags: longest(plan.THEME_HASHTAGS_MAX),
      colour: index % 5, position: index, archived: index >= LIMITS.themes, createdAt: NOW, updatedAt: NOW,
    })),
  });
  await modelAction('SpecialDay', 'createMany', {
    data: Array.from({ length: plan.MAX_OWN_DAYS }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), date: `${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      yearly: true, note: longest(LIMITS.notes), createdAt: NOW,
    })),
  });
  // The most ready words, every one with the longest words; half of them hashtag sets.
  const tags = Array.from({ length: LIMITS.readyWord }, () => '#ş').join(' ').slice(0, LIMITS.readyWord);
  await modelAction('ReadyWord', 'createMany', {
    data: Array.from({ length: LIMITS.readyWords }, (_, index) => ({
      ownerId: OWNER, kind: index % 2 === 0 ? 'hashtags' : 'answer', title: longest(LIMITS.readyTitle),
      text: index % 2 === 0 ? tags : longest(LIMITS.readyWord), network: 'instagram', copied: 1000000, position: index, createdAt: NOW, updatedAt: NOW,
    })),
  });

  // What `app/plan/page.jsx` reads.
  const page = await measuredAtOnce(() => readPlanPage(OWNER));
  bounded(page, 'My plan\'s page', 9);
  assert.ok(page.atOnce <= 3, `My plan's page: ${page.atOnce} calls at once`);
  const { plan: whole, ownDays, hashtagSets } = page.value;
  assert.equal(whole.themes.length, LIMITS.themes);
  assert.equal(ownDays.length, plan.MAX_OWN_DAYS);
  assert.equal(hashtagSets.length, LIMITS.readyWords / 2);
  assert.equal(hashtagSets[0].hashtags, '#ş');
  // The count sees calls side by side: four one-call reads at once are four at once.
  const together = await measuredAtOnce(() => Promise.all([plan.getProfileFor(OWNER), plan.listOwnDaysFor(OWNER), plan.getProfileFor(OWNER), plan.listOwnDaysFor(OWNER)]));
  assert.equal(together.atOnce, 4, 'four reads side by side');
});

test('the Ready words page reads at most three calls at once', async () => {
  const { getProfileFor } = await import('../lib/data/plan.js');
  const words = await import('../lib/data/words.js');
  // What `app/ready-words/page.jsx` reads, in its order (the check before left the most ready words).
  const page = await measuredAtOnce(async () => {
    const profile = await getProfileFor(OWNER);
    return { profile, readyWords: await words.listReadyWordsFor(OWNER) };
  });
  assert.equal(page.value.readyWords.length, LIMITS.readyWords);
  assert.ok(page.atOnce <= 3, `the Ready words page: ${page.atOnce} calls at once`);
});
