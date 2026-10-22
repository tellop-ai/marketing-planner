/**
 * The calendar: its rules (which days a view shows, the Share today post, the
 * week's goal, campaign bars), the two month addresses (a plan without AI and
 * Keep these), and the page's read, run against a throwaway store
 * (`APP_DATA_FILE` in a temporary folder, removed afterwards). The page's read
 * and the addresses also run through Tellop's records hook, which measures
 * the calls a request makes and the rows and bytes each call answers.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'calendar-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
const { SHAPE_KEYS } = await import('../lib/plan/shapes.js');
const plan = await import('../lib/data/plan.js');
const posts = await import('../lib/data/posts.js');
const campaigns = await import('../lib/data/campaigns.js');
const rules = await import('../app/calendar/rules.js');
const proposals = await import('../app/calendar/proposals.js');
const { readCalendar } = await import('../app/calendar/read.js');
const planRoute = await import('../app/api/month/plan/route.js');
const keepRoute = await import('../app/api/month/keep/route.js');
const fillMonthRoute = await import('../app/api/ai/fill-month/route.js');
const { emptySlots } = await import('../lib/plan/slots.js');
const { specialDaysIn } = await import('../lib/plan/special-days.js');
const { CONTENT_END, CONTENT_START } = await import('../lib/plan/ai-words.js');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';

/** Calls a handler with a real JSON request. */
async function call(handler, body, { raw, type = 'application/json' } = {}) {
  const sent = raw ?? JSON.stringify(body);
  const request = new Request('http://localhost/api/month', { method: 'POST', headers: { 'content-type': type }, body: sent });
  const response = await handler(request, { params: Promise.resolve({}) });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

/** Every post of an owner (to see that reading saved nothing, and what a keep made). */
async function allPosts(owner = OWNER) {
  return modelAction('Post', 'findMany', { where: { ownerId: owner }, orderBy: { id: 'asc' }, take: 256 });
}

/**
 * Inside Tellop every records call goes through its records route, which
 * answers at most 256 rows, 256 KB and 2,048 values a step (a value: 1 for a
 * list, 2 for a row, 1 for each field), takes lists of at most 256 items and
 * batches of at most 32 steps, and allows 16 calls a request. The local store
 * has none of these, so the route's hook runs each call on the local store's
 * own client (calls made at the same moment, `Promise.all`, included) and
 * measures it.
 */
const recordsBounds = await import('./records-bounds.mjs');
const { measured } = recordsBounds;
/** Every call within Tellop's bounds (`tests/records-bounds.mjs`), and at most `most` of them. */
const bounded = (calls, what, most) => recordsBounds.bounded({ calls }, what, most);

const tile = (id, day, state, time = null) => ({ id, day, time, state });

// --- rules -------------------------------------------------------------------------

test('a view is this month unless the address names a real month or asks for a week', () => {
  const today = '2026-10-21';
  const month = rules.viewOf({}, today, false);
  assert.equal(month.kind, 'month');
  assert.equal(month.month, '2026-10');
  // October 2026 starts on a Thursday: Sunday-first weeks start on 27 September, Monday-first on 28 September.
  assert.equal(month.from, '2026-09-27');
  assert.equal(month.to, '2026-10-31');
  assert.equal(rules.viewOf({}, today, true).from, '2026-09-28');
  assert.equal(rules.viewOf({}, today, true).to, '2026-11-01');
  assert.equal(rules.viewOf({ month: '2027-02' }, today, false).month, '2027-02');
  for (const wrong of ['2026-13', '1999-12', '2200-01', '2026-1', 'x']) assert.equal(rules.viewOf({ month: wrong }, today, false).month, '2026-10', wrong);
  const week = rules.viewOf({ view: 'week', day: '2026-11-01' }, today, true);
  assert.equal(week.kind, 'week');
  assert.deepEqual([week.from, week.to], ['2026-10-26', '2026-11-01']);
  assert.deepEqual(rules.monthsOf(week), ['2026-10', '2026-11']);
  const sundayWeek = rules.viewOf({ view: 'week', day: '2026-11-01' }, today, false);
  assert.deepEqual([sundayWeek.from, sundayWeek.to], ['2026-11-01', '2026-11-07']);
  assert.equal(rules.viewOf({ view: 'week', day: '2026-02-30' }, today, false).day, today);
});

test('the read reaches back to the oldest due day only when the view shows today', () => {
  const view = { from: '2026-09-27', to: '2026-10-31' };
  assert.deepEqual(rules.readRange(view, '2026-10-21'), { from: '2026-09-27', to: '2026-10-31', showsToday: true });
  // Today on the view's first day: the read starts 13 days earlier.
  assert.deepEqual(rules.readRange(view, '2026-09-27'), { from: '2026-09-14', to: '2026-10-31', showsToday: true });
  assert.deepEqual(rules.readRange(view, '2026-10-31'), { from: '2026-09-27', to: '2026-10-31', showsToday: true });
  assert.equal(rules.readRange(view, '2026-11-01').showsToday, false);
  assert.equal(rules.readRange(view, '2026-09-26').showsToday, false);
  assert.equal(rules.readRange(view, '2026-11-01').from, '2026-09-27');
});

test('the Share today post is due from 13 days back to today, never an idea, a shared or a scheduled post', () => {
  const today = '2026-10-21';
  assert.equal(rules.dueOf([tile(1, '2026-10-08', 'ready')], today)?.id, 1, 'thirteen days back still shows');
  assert.equal(rules.dueOf([tile(1, '2026-10-07', 'ready')], today), null, 'fourteen days back no longer shows');
  assert.equal(rules.dueOf([tile(1, '2026-10-22', 'ready')], today), null, 'tomorrow is not due');
  assert.equal(rules.dueOf([tile(1, today, 'idea'), tile(2, today, 'shared'), tile(3, today, 'scheduled')], today), null);
  assert.equal(rules.dueOf([tile(1, today, 'partly')], today)?.id, 1);
  assert.equal(rules.dueOf([tile(1, today, 'draft')], today)?.id, 1);
  assert.equal(rules.dueOf([tile(1, null, 'ready')], today), null);
  // Today first, by time (no time first); then the latest earlier day.
  const list = [tile(1, '2026-10-19', 'ready'), tile(2, '2026-10-20', 'ready'), tile(3, today, 'ready', '18:30'), tile(4, today, 'ready', '09:00')];
  assert.equal(rules.dueOf(list, today)?.id, 4);
  assert.equal(rules.dueOf([...list, tile(5, today, 'ready')], today)?.id, 5);
  assert.equal(rules.dueOf(list.slice(0, 2), today)?.id, 2);
});

test('the week\'s goal counts posts of this week shared on any network, or scheduled', () => {
  const today = '2026-10-21';
  // Sunday-first: 18 to 24 October. Monday-first: 19 to 25 October.
  const list = [tile(1, '2026-10-18', 'shared'), tile(2, '2026-10-19', 'shared'), tile(3, '2026-10-24', 'shared'), tile(4, '2026-10-25', 'shared'),
    tile(5, '2026-10-21', 'partly'), tile(6, '2026-10-17', 'shared'), tile(7, null, 'shared')];
  // A post shared on one network of several (`partly`) counts too.
  assert.deepEqual(rules.weekGoal(list, today, false, 3), { goal: 3, shared: 4, filled: 3 });
  assert.deepEqual(rules.weekGoal(list, today, true, 2), { goal: 2, shared: 4, filled: 2 });
  assert.deepEqual(rules.weekGoal([], today, true, 14), { goal: 14, shared: 0, filled: 0 });
  assert.deepEqual(rules.weekGoal([tile(1, today, 'scheduled'), tile(2, today, 'ready')], today, true, 3), { goal: 3, shared: 1, filled: 1 });
});

test('the goal line follows how Turkish says each number from 1 to 14', () => {
  const said = Array.from({ length: 14 }, (_, index) => rules.goalWordsKey(index + 1).split('.').pop());
  assert.deepEqual(said, ['de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da', 'da', 'de', 'de', 'te', 'te']);
});

test('campaign bars keep one lane each, are named at their start and at each week row\'s start', () => {
  const days = Array.from({ length: 14 }, (_, index) => `2026-10-${String(index + 4).padStart(2, '0')}`); // Sun 4 to Sat 17
  const list = [
    { id: 1, name: 'Autumn sale', startsOn: '2026-10-06', endsOn: '2026-10-12' },
    { id: 2, name: 'Classes', startsOn: '2026-10-08', endsOn: '2026-10-09' },
    { id: 3, name: 'After', startsOn: '2026-10-13', endsOn: '2026-10-20' },
  ];
  const { lanes, byDay } = rules.campaignBars(list, days);
  assert.equal(lanes, 2);
  assert.equal(byDay.has('2026-10-05'), false);
  assert.deepEqual(byDay.get('2026-10-06'), [{ id: 1, name: 'Autumn sale', lane: 0, named: true, first: true, last: false }]);
  assert.equal(byDay.get('2026-10-07')[0].named, false);
  assert.deepEqual(byDay.get('2026-10-08').map((bar) => [bar.id, bar.lane]), [[1, 0], [2, 1]]);
  // A new week row (Sunday 11) names the bar again; the day after a campaign ends its lane is free.
  assert.equal(byDay.get('2026-10-11')[0].named, true);
  assert.equal(byDay.get('2026-10-12')[0].last, true);
  assert.deepEqual(byDay.get('2026-10-13').map((bar) => [bar.id, bar.lane, bar.named]), [[3, 0, true]]);
  assert.equal(byDay.get('2026-10-17')[0].last, false, 'a bar that runs past the days drawn has no end here');
  // A campaign that began before the month is named on the month's first drawn day; muted days get no bar.
  const grid = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
  const early = rules.campaignBars([{ id: 4, name: 'Early', startsOn: '2026-09-20', endsOn: '2026-10-02' }], grid, (day) => day.startsWith('2026-10'));
  assert.equal(early.byDay.has('2026-09-30'), false);
  assert.equal(early.byDay.get('2026-10-01')[0].named, true);
  assert.equal(early.byDay.get('2026-10-02')[0].named, false);
});

test('a theme colour is 0 to 4, and none for no theme or an unknown one', () => {
  const colours = rules.coloursOf([{ id: 7, colour: 4 }, { id: 8, colour: 0 }, { id: 9, colour: 5 }]);
  assert.equal(rules.colourOf(7, colours), 4);
  assert.equal(rules.colourOf(8, colours), 0);
  assert.equal(rules.colourOf(9, colours), null);
  assert.equal(rules.colourOf(null, colours), null);
  assert.equal(rules.colourOf(10, colours), null);
});

// --- reading the requests -------------------------------------------------------

test('a plan without AI takes a month from 2000 to 2199, 1 to 14 posts a week and themes in use', () => {
  const known = new Set([1, 2]);
  const ok = (body) => proposals.readPlanRequest(body, known);
  assert.equal(ok({ month: '2000-01', perWeek: 3, themeIds: [1] }).ok, true);
  assert.equal(ok({ month: '2199-12', perWeek: 3, themeIds: [] }).ok, true);
  assert.equal(ok({ month: '1999-12', perWeek: 3, themeIds: [] }).problem, 'month.refuse.month');
  assert.equal(ok({ month: '2200-01', perWeek: 3, themeIds: [] }).problem, 'month.refuse.month');
  assert.equal(ok({ month: '2031-05', perWeek: 0, themeIds: [] }).problem, 'month.refuse.perWeek');
  assert.equal(ok({ month: '2031-05', perWeek: 1, themeIds: [] }).ok, true);
  assert.equal(ok({ month: '2031-05', perWeek: 14, themeIds: [] }).ok, true);
  assert.equal(ok({ month: '2031-05', perWeek: 15, themeIds: [] }).problem, 'month.refuse.perWeek');
  assert.equal(ok({ month: '2031-05', perWeek: 2.5, themeIds: [] }).problem, 'month.refuse.perWeek');
  assert.equal(ok({ month: '2031-05', perWeek: '3', themeIds: [] }).problem, 'month.refuse.perWeek');
  assert.equal(ok({ month: '2031-05', perWeek: 3, themeIds: [3] }).problem, 'month.refuse.theme');
  assert.equal(ok({ month: '2031-05', perWeek: 3, themeIds: ['1'] }).problem, 'refuse.request');
  assert.deepEqual(ok({ month: '2031-05', perWeek: 3, themeIds: [2, 1, 2] }).value.themeIds, [2, 1]);
  assert.equal(ok([]).problem, 'refuse.request');
});

test('a plan may name a span of at most seven days instead of a month: its slots only, from today, themes in turn across it', () => {
  const known = new Set([1, 2]);
  const ok = (body) => proposals.readPlanRequest(body, known);
  assert.deepEqual(ok({ from: '2031-05-29', to: '2031-06-04', perWeek: 4, themeIds: [1] }).value, { month: null, span: { from: '2031-05-29', to: '2031-06-04', months: ['2031-05', '2031-06'] }, perWeek: 4, themeIds: [1] });
  assert.equal(ok({ month: '2031-05', perWeek: 4, themeIds: [] }).value.span, null);
  assert.deepEqual(proposals.readSpan('2031-05-01', '2031-05-01'), { from: '2031-05-01', to: '2031-05-01', months: ['2031-05'] }, 'one day');
  assert.equal(proposals.readSpan('2031-05-01', '2031-05-07')?.to, '2031-05-07', 'seven days: the most');
  assert.equal(proposals.readSpan('2031-05-01', '2031-05-08'), null, 'eight days');
  assert.equal(proposals.readSpan('2031-05-02', '2031-05-01'), null);
  assert.equal(ok({ from: '2031-05-01', perWeek: 4, themeIds: [] }).problem, 'refuse.request');
  assert.equal(ok({ from: '2031-05-01', to: '2031-05-02', month: '2031-05', perWeek: 4, themeIds: [] }).problem, 'refuse.request');

  const span = proposals.readSpan('2031-05-29', '2031-06-04');
  const slots = proposals.spanSlots({ span, perWeek: 4, themeIds: [1, 2], mondayFirst: true, today: '2031-05-30', takenOf: () => [], specialDaysOf: () => [] });
  assert.ok(slots.length > 0 && slots.every((slot) => slot.day >= '2031-05-30' && slot.day <= '2031-06-04'), 'from today to the span\'s last day');
  assert.deepEqual(slots.map((slot) => slot.day), [...slots.map((slot) => slot.day)].sort());
  assert.deepEqual(slots.map((slot) => slot.themeId), slots.map((_, index) => [1, 2][index % 2]), 'themes in turn across both months');
  const busy = proposals.spanSlots({ span, perWeek: 4, themeIds: [], mondayFirst: true, today: '2031-05-01', takenOf: (month) => (month === '2031-06' ? [{ day: '2031-06-02' }] : []), specialDaysOf: () => [] });
  assert.ok(!busy.some((slot) => slot.day === '2031-06-02'), 'never a day that holds a post');
  assert.ok(busy.every((slot) => slot.themeId === null));
});

test('keeping takes 1 to 62 proposals on days of the month, with names up to the limit', () => {
  const known = new Set([1]);
  const one = (day, extra = {}) => ({ day, name: 'Idea', themeId: 1, ...extra });
  const many = (count) => Array.from({ length: count }, (_, index) => one(`2031-05-${String((index % 31) + 1).padStart(2, '0')}`));
  const keep = (list, extra = {}) => proposals.readKeepRequest({ month: '2031-05', madeBy: 'ai', proposals: list, ...extra }, known);
  assert.equal(keep([]).problem, 'refuse.request');
  assert.equal(keep(many(1)).ok, true);
  assert.equal(keep(many(62)).ok, true);
  assert.equal(keep(many(63)).problem, 'month.refuse.count');
  assert.equal(keep([one('2031-05-31')]).ok, true);
  assert.equal(keep([one('2031-06-01')]).problem, 'month.refuse.day');
  assert.equal(keep([one('2031-04-30')]).problem, 'month.refuse.day');
  assert.equal(keep([one('2031-05-32')]).problem, 'refuse.request');
  assert.equal(keep([one('2031-05-01', { name: 'a'.repeat(LIMITS.name) })]).ok, true);
  assert.equal(keep([one('2031-05-01', { name: 'a'.repeat(LIMITS.name + 1) })]).problem, 'refuse.text.long');
  assert.equal(keep([one('2031-05-01', { name: '  ' })]).problem, 'refuse.text.missing');
  assert.equal(keep([one('2031-05-01', { themeId: 2 })]).problem, 'month.refuse.theme');
  assert.equal(keep([one('2031-05-01', { themeId: null })]).value.proposals[0].themeId, null);
  assert.equal(keep([one('2031-05-01', { specialDay: 'republicDay' })]).value.proposals[0].specialDay, 'republicDay');
  assert.equal(keep([one('2031-05-01', { specialDay: 'own-12' })]).value.proposals[0].specialDay, 'own-12');
  assert.equal(keep([one('2031-05-01', { specialDay: 'made-up' })]).problem, 'refuse.request');
  assert.equal(keep(many(1), { madeBy: 'robot' }).problem, 'refuse.request');
  assert.equal(keep(many(1), { month: '2031-13' }).problem, 'month.refuse.month');
});

test('a plan without AI names a slot after its special day, else its theme, else the fallback', () => {
  const named = proposals.planProposals(
    [{ day: '2031-10-27', themeId: 1 }, { day: '2031-10-29', themeId: 2, specialDayKey: 'republicDay' }, { day: '2031-10-30', themeId: null },
      { day: '2031-10-31', themeId: 1, specialDayKey: 'own-4' }],
    {
      themes: [{ id: 1, name: 'Behind the scenes' }, { id: 2, name: 'a'.repeat(100) }],
      specialDays: [{ key: 'republicDay', nameKey: 'special.republicDay.name' }, { key: 'own-4', name: 'Studio birthday' }],
      words: (key) => (key === 'special.republicDay.name' ? 'Republic Day' : key),
      fallback: 'Post idea',
    },
  );
  assert.deepEqual(named, [
    { day: '2031-10-27', name: 'Behind the scenes', themeId: 1 },
    { day: '2031-10-29', name: 'Republic Day', themeId: 2, specialDay: 'republicDay' },
    { day: '2031-10-30', name: 'Post idea', themeId: null },
    { day: '2031-10-31', name: 'Studio birthday', themeId: 1, specialDay: 'own-4' },
  ]);
  const long = proposals.planProposals([{ day: '2031-10-27', themeId: 2 }], { themes: [{ id: 2, name: 'ş'.repeat(100) }], specialDays: [], words: String, fallback: 'x' });
  assert.equal(Array.from(long[0].name).length, LIMITS.name);
  // The name follows the slot's own mark only: a slot with none keeps its theme's name on any day.
  const unmarked = proposals.planProposals([{ day: '2031-10-29', themeId: 1 }], {
    themes: [{ id: 1, name: 'Behind the scenes' }],
    specialDays: [{ key: 'republicDay', day: '2031-10-29', kind: 'celebration', nameKey: 'r' }],
    words: () => 'Republic Day',
    fallback: 'x',
  });
  assert.deepEqual(unmarked, [{ day: '2031-10-29', name: 'Behind the scenes', themeId: 1 }]);
});

test('a slot that already falls on a celebration is named after it; an awareness day is not, and a day of remembrance holds no slot', () => {
  // October 2031: Republic Day (29) is a Wednesday and World Food Day (16, awareness) a Thursday; three a week
  // take Monday, Wednesday and Friday. 18 March 2031 (Çanakkale, remembrance) is a Tuesday.
  const words = (key) => ({ 'special.republicDay.name': 'Republic Day', 'special.halloween.name': 'Halloween' })[key] ?? key;
  const name = (month, today, perWeek = 3, hidden = []) => {
    const specialDays = specialDaysIn(month, { showDays: 'both', hidden, own: [] });
    const slots = emptySlots({ month, perWeek, taken: [], themeIds: [1], specialDays, mondayFirst: true, today });
    return proposals.planProposals(slots, { themes: [{ id: 1, name: 'Behind the scenes' }], specialDays, words, fallback: 'x' });
  };
  // The last week has five days in October: round(3 x 5 / 7) = 2 slots, Monday and Wednesday; Halloween (Friday)
  // pulls the unmarked Monday slot onto it.
  const october = name('2031-10', '2031-10-27');
  assert.deepEqual(october, [
    { day: '2031-10-29', name: 'Republic Day', themeId: 1, specialDay: 'republicDay' },
    { day: '2031-10-31', name: 'Halloween', themeId: 1, specialDay: 'halloween' },
  ]);
  assert.ok(name('2031-10', '2031-10-13', 7).filter((item) => item.day === '2031-10-16').every((item) => item.specialDay === undefined));
  const march = name('2031-03', '2031-03-17', 7);
  assert.ok(!march.some((item) => item.day === '2031-03-18'), 'a day of remembrance holds no ordinary slot');
  assert.ok(march.some((item) => item.day === '2031-03-17') && march.some((item) => item.day === '2031-03-19'), 'the days either side still do');
  assert.ok(name('2031-03', '2031-03-17', 7, ['canakkale']).some((item) => item.day === '2031-03-18'), 'a hidden day is an ordinary day');
});

test('Fill my month hands the AI the special day of a slot already on it, and gives it back', async () => {
  await themesReady;
  /** The slots the AI was asked about: the content block of its request. */
  const slotsOf = (body) => {
    const user = body.messages.find((message) => message.role === 'user').content;
    return JSON.parse(user.slice(user.indexOf(CONTENT_START) + CONTENT_START.length, user.lastIndexOf(CONTENT_END))).slots;
  };
  const guard = globalThis.fetch;
  const asked = [];
  process.env.AI_BASE_URL = 'http://ai.stand-in.invalid/v1';
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body));
    asked.push(body);
    const content = JSON.stringify({ proposals: slotsOf(body).map((slot) => ({ day: slot.day, name: `Idea for ${slot.day}` })) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    // 2035-10-29, Republic Day, is a Monday: a slot falls on it without moving.
    const { status, json } = await call(fillMonthRoute.POST, { month: '2035-10', perWeek: 3, themeIds: [] });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(asked.length, 1);
    const sent = slotsOf(asked[0]);
    const republic = sent.find((slot) => slot.day === '2035-10-29');
    assert.equal(republic?.specialDay?.kind, 'celebration');
    assert.ok(republic.specialDay.name.length > 0);
    // English weeks start on Sunday: the last week has four days in October (28 to 31), so round(3 x 4 / 7) = 2
    // slots, Monday 29 (already on Republic Day) and Wednesday 31; nothing moved onto the 29th.
    assert.deepEqual(sent.filter((slot) => slot.day >= '2035-10-28').map((slot) => slot.day), ['2035-10-29', '2035-10-31'], 'no other slot moved onto it');
    assert.deepEqual(json.proposals.find((item) => item.day === '2035-10-29'), { day: '2035-10-29', name: 'Idea for 2035-10-29', themeId: null, specialDay: 'republicDay' });
  } finally {
    globalThis.fetch = guard;
    delete process.env.AI_BASE_URL;
  }
});

// --- the two month addresses --------------------------------------------------------

async function setUpPlan() {
  await plan.saveProfileFor(OWNER, { networks: 'instagram,facebook', postsPerWeek: 3, showDays: 'both' });
  const first = await plan.addThemeFor(OWNER, { name: 'Behind the scenes' });
  const second = await plan.addThemeFor(OWNER, { name: 'New pieces' });
  return [first, second];
}

const themesReady = setUpPlan();

test('a plan without AI proposes the empty days and saves nothing', async () => {
  const [first, second] = await themesReady;
  await posts.createPostFor(OWNER, { day: '2031-10-06', name: 'Already there' });
  const before = (await allPosts()).length;
  const { status, json } = await call(planRoute.POST, { month: '2031-10', perWeek: 3, themeIds: [first.id, second.id] });
  assert.equal(status, 200, JSON.stringify(json));
  assert.ok(json.proposals.length >= 12, `${json.proposals.length} proposals`);
  assert.ok(json.proposals.every((item) => item.day.startsWith('2031-10-') && item.day !== '2031-10-06'));
  assert.ok(json.proposals.every((item) => item.themeId === first.id || item.themeId === second.id || item.specialDay));
  const republic = json.proposals.find((item) => item.specialDay === 'republicDay');
  assert.equal(republic?.day, '2031-10-29');
  assert.equal((await allPosts()).length, before, 'nothing was saved');

  assert.equal((await call(planRoute.POST, { month: '2031-10', perWeek: 15, themeIds: [] })).json.problem, 'month.refuse.perWeek');
  assert.equal((await call(planRoute.POST, { month: '2200-01', perWeek: 3, themeIds: [] })).json.problem, 'month.refuse.month');
  const unknown = await call(planRoute.POST, { month: '2031-10', perWeek: 3, themeIds: [first.id + 1000] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.problem, 'month.refuse.theme');
  assert.equal((await call(planRoute.POST, null, { raw: 'month=2031-10', type: 'text/plain' })).json.problem, 'refuse.request');

  const runs = await measured(() => call(planRoute.POST, { month: '2031-10', perWeek: 14, themeIds: [first.id] }));
  bounded(runs.calls, 'a plan without AI', 8);
});

test('Keep these keeps every proposal as an idea in one call, or none', async () => {
  const [first] = await themesReady;
  const list = Array.from({ length: 62 }, (_, index) => ({ day: `2032-01-${String((index % 31) + 1).padStart(2, '0')}`, name: `Idea ${index}`, themeId: first.id }));
  list[3] = { ...list[3], specialDay: 'newYear', themeId: null };
  const before = (await allPosts()).length;

  const bad = await call(keepRoute.POST, { month: '2032-01', madeBy: 'ai', proposals: [...list.slice(0, 5), { day: '2032-02-01', name: 'Outside', themeId: null }] });
  assert.equal(bad.json.problem, 'month.refuse.day');
  assert.equal((await call(keepRoute.POST, { month: '2032-01', madeBy: 'ai', proposals: [...list, list[0]] })).json.problem, 'month.refuse.count');
  assert.equal((await allPosts()).length, before, 'a refused keep keeps nothing');

  assert.equal(proposals.MOST_PROPOSALS, posts.MOST_KEPT, 'the page sends at most what the records keep');
  const runs = await measured(() => call(keepRoute.POST, { month: '2032-01', madeBy: 'ai', proposals: list }));
  bounded(runs.calls, 'Keep these', 4);
  const { status, json } = runs.value;
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.posts.length, 62);
  assert.ok(json.posts.every((post) => post.state === 'idea' && post.picture === null && post.of === 2));
  const kept = (await allPosts()).filter((row) => row.day?.startsWith('2032-01'));
  assert.equal(kept.length, 62);
  assert.ok(kept.every((row) => row.ownerId === OWNER && row.madeBy === 'ai' && row.mainText === ''));
  assert.equal(kept.find((row) => row.specialDay === 'newYear')?.themeId, null);

  const person = await call(keepRoute.POST, { month: '2032-02', madeBy: 'person', proposals: [{ day: '2032-02-29', name: 'Leap day', themeId: null }] });
  assert.equal(person.status, 201);
  assert.equal((await allPosts()).find((row) => row.id === person.json.posts[0].id)?.madeBy, 'person');
  assert.equal((await allPosts(OTHER)).length, 0, 'nothing was kept for anyone else');
});

// --- the page's read ---------------------------------------------------------------------

test('the calendar reads a busy month within Tellop\'s bounds and saves nothing', async () => {
  const [first, second] = await themesReady;
  await plan.saveProfileFor(OWNER, { networks: NETWORK_KEYS.join(','), postsPerWeek: 14 });
  const month = '2033-03';
  const today = '2033-03-16';
  // Fourteen posts a week through the whole drawn month and the due days before it, each with words on
  // every network and a chosen picture: more than one call's worth of pictures and of versions.
  const long = 'ş'.repeat(LIMITS.name);
  for (let index = 0; index < 84; index += 1) {
    const day = `2033-03-${String((index % 31) + 1).padStart(2, '0')}`;
    const post = await posts.createPostFor(OWNER, { day, name: long, themeId: index % 2 ? first.id : second.id, time: index % 3 ? '18:30' : null });
    await posts.saveVersionsFor(OWNER, post.id, NETWORK_KEYS.map((network) => ({ network, text: `${index} words` })), { replace: true });
    await posts.addPictureFor(OWNER, post.id, { source: 'words', words: 'ş'.repeat(LIMITS.pictureWords), description: 'ş'.repeat(LIMITS.description) });
  }
  for (let index = 0; index < 12; index += 1) await posts.createPostFor(OWNER, { name: `Idea ${index}`, themeId: first.id });
  await campaigns.addCampaignFor(OWNER, { name: 'Spring sale', startsOn: '2033-03-10', endsOn: '2033-03-20' });
  const before = (await allPosts()).length;

  const run = await measured(() => readCalendar({ owner: OWNER, query: { month }, today, locale: 'tr' }));
  bounded(run.calls, 'the calendar', 15);
  const page = run.value;
  assert.equal(page.view.kind, 'month');
  assert.equal(page.tiles.length, 84);
  assert.ok(page.tiles.every((item) => item.state === 'ready' && item.picture !== null), 'every version and picture was read');
  assert.equal(page.ideas.length, rules.IDEAS_SHOWN);
  assert.equal(page.moreIdeas, true);
  assert.equal(page.campaigns.length, 1);
  assert.equal(page.due?.day, today);
  assert.equal(page.due?.time, null, 'a post with no time comes first');
  assert.deepEqual(page.goal, { goal: 14, shared: 0, filled: 0 });
  assert.equal(page.firstVisit, false);
  assert.ok(page.specialDays.some((day) => day.day === '2033-03-18' && day.kind === 'remembrance'));
  assert.equal((await allPosts()).length, before, 'reading saved nothing');

  const away = await measured(() => readCalendar({ owner: OWNER, query: { month: '2033-05' }, today, locale: 'en' }));
  bounded(away.calls, 'another month', 15);
  assert.equal(away.value.due, null, 'a month that does not show today has no Share today card');
  assert.equal(away.value.goal, null);

  const week = await measured(() => readCalendar({ owner: OWNER, query: { view: 'week', day: today }, today, locale: 'en' }));
  bounded(week.calls, 'a week', 15);
  assert.equal(week.value.view.kind, 'week');
  assert.ok(week.value.tiles.every((item) => item.day >= week.value.view.from && item.day <= week.value.view.to));
  assert.equal(week.value.campaigns.length, 0);
});

test('a first visit has no networks and no posts, and opening it creates nothing', async () => {
  const first = await readCalendar({ owner: 'fresh-owner', query: {}, today: '2026-10-21', locale: 'en' });
  assert.equal(first.firstVisit, true);
  assert.equal(first.due, null);
  assert.deepEqual(first.goal, { goal: 3, shared: 0, filled: 0 });
  assert.equal((await allPosts('fresh-owner')).length, 0);
  assert.equal(await modelAction('Profile', 'count', { where: { ownerId: 'fresh-owner' } }), 0);
});

test('the calendar at its largest: 256 tiles with card pictures from long comments stay within 16 calls', async (t) => {
  await plan.saveProfileFor(OWNER, { networks: NETWORK_KEYS.join(','), postsPerWeek: 14 });
  const month = '2034-03';
  const today = '2034-03-16';
  const at = new Date().toISOString();
  const longest = (count) => 'ş'.repeat(count);
  const two = (n) => String(n).padStart(2, '0');
  const ideasCount = rules.IDEAS_SHOWN + 1;
  // A comment of its own, with the longest words, behind every card picture.
  await modelAction('CustomerComment', 'createMany', {
    data: Array.from({ length: 257 + ideasCount }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), text: longest(LIMITS.comment), bestLine: longest(LIMITS.bestLine), stars: 5,
      source: 'other', permission: 'yes', receivedOn: '2034-01-01', createdAt: at, updatedAt: `${at}#${index}`,
    })),
  });
  const commentIds = (await modelAction('CustomerComment', 'findMany', { where: { ownerId: OWNER, createdAt: at }, select: { id: true }, orderBy: { id: 'asc' }, take: 300 })).map((row) => row.id);
  // 257 posts on the month's days (one past the most a list holds) and the newest ideas, the longest names.
  await modelAction('Post', 'createMany', {
    data: [
      ...Array.from({ length: 257 }, (_, index) => ({ ownerId: OWNER, name: longest(LIMITS.name), day: `${month}-${two((index % 31) + 1)}`, time: index % 2 ? '09:00' : null, createdAt: at, updatedAt: at })),
      ...Array.from({ length: ideasCount }, () => ({ ownerId: OWNER, name: longest(LIMITS.name), createdAt: at, updatedAt: at })),
    ],
  });
  const made = await modelAction('Post', 'findMany', { where: { ownerId: OWNER, createdAt: at }, select: { id: true }, orderBy: { id: 'asc' }, take: 300 });
  assert.equal(made.length, 257 + ideasCount);
  // Words on every network, and a chosen card picture with the longest description and every copy kept.
  await modelAction('PostVersion', 'createMany', { data: made.flatMap((post) => NETWORK_KEYS.map((network) => ({ ownerId: OWNER, postId: post.id, network, text: 'words', updatedAt: at }))) });
  const copies = Object.fromEntries(SHAPE_KEYS.map((key, index) => [`${key}File`, String(index + 1).padStart(64, 'f')]));
  await modelAction('PostPicture', 'createMany', {
    data: made.map((post, index) => ({
      ownerId: OWNER, postId: post.id, source: 'card', commentId: commentIds[index], chosen: true, position: 1,
      description: longest(LIMITS.description), createdAt: at, ...copies,
    })),
  });
  await campaigns.addCampaignFor(OWNER, { name: 'March sale', startsOn: '2034-03-01', endsOn: '2034-03-31' });
  const before = await modelAction('Post', 'count', { where: { ownerId: OWNER } });

  const run = await measured(() => readCalendar({ owner: OWNER, query: { month }, today, locale: 'tr' }));
  bounded(run.calls, 'the calendar at its largest', 16);
  assert.ok(run.calls.every((call) => !call.what.includes('CustomerComment')), 'no comment is read for a tile');
  const page = run.value;
  assert.equal(page.tiles.length, 256);
  assert.ok(page.tiles.every((item) => item.picture?.source === 'card' && item.picture.card === null && item.state === 'ready'));
  assert.equal(page.ideas.length, rules.IDEAS_SHOWN);
  assert.ok(page.ideas.every((item) => item.picture?.source === 'card' && item.picture.card === null));
  assert.equal(await modelAction('Post', 'count', { where: { ownerId: OWNER } }), before, 'reading saved nothing');
  const planCalls = run.calls.filter((call) => /Profile|Theme/u.test(call.what)).length;
  t.diagnostic(`the calendar at its largest: ${run.calls.length} calls (the plan ${planCalls}), largest ${Math.max(...run.calls.map((call) => call.bytes))} bytes`);
  t.diagnostic(run.calls.map((call) => [...new Set(call.what.split(' '))].join('+')).join(' | '));
});
