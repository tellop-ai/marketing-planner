/**
 * My plan in the growth waves: the brand and link fields of the profile, a
 * theme that sells, every field saving by itself (the save queue), and the
 * first-visit start on the calendar (its rules, its address and its read),
 * checked against a throwaway store (`APP_DATA_FILE` points at a temporary
 * folder that is removed afterwards). Never AI, never the network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'plan-wave2-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const plan = await import('../lib/data/plan.js');
const { t } = await import('../lib/i18n/index.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { addDays } = await import('../lib/plan/days.js');
const { OWNER } = await import('../lib/plan/owner.js');
const planRoute = await import('../app/api/plan/route.js');
const startRoute = await import('../app/api/plan/start/route.js');
const themesRoute = await import('../app/api/themes/route.js');
const themeRoute = await import('../app/api/themes/[id]/route.js');
const rules = await import('../app/first-visit/rules.js');
const { readFirstVisit } = await import('../app/first-visit/read.js');
const { readCalendar } = await import('../app/calendar/read.js');
const { STARTER_KINDS } = await import('../app/ideas/groups.js');
const { freshStart, makeFirstPosts } = await import('../app/first-visit/first-posts.js');
const { BRAND_PRESETS, colourToSave, isPreset, presetColour, swatchColour } = await import('../app/plan/brand.js');
const { inkContrastOf, inkFor } = await import('../lib/plan/card-layout.js');
const { SaveQueue, TYPING_WAIT } = await import('../app/plan/save-queue.js');
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

const OTHER = 'someone-else';
const NOW = '2026-10-22T09:00:00.000Z';

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/** @param {string} address @param {string} method @param {unknown} [body] */
function sending(address, method, body) {
  return new Request(`http://localhost${address}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** @param {string} id */
const at = (id) => ({ params: Promise.resolve({ id: String(id) }) });

/** @param {Response} response */
async function answer(response) {
  return { status: response.status, body: await response.json() };
}

/** @param {() => Promise<unknown>} work @param {string} key */
async function refusedWith(work, key) {
  await assert.rejects(work, (error) => error instanceof DataError && error.messageKey === key);
}

/** @param {unknown} body */
const put = async (body) => answer(await planRoute.PUT(sending('/api/plan', 'PUT', body)));
/** @param {unknown} body */
const start = async (body) => answer(await startRoute.POST(sending('/api/plan/start', 'POST', body)));

// ---------------------------------------------------------------------------
// The profile's brand and link fields

test('a profile saved before the brand and link fields reads them as their defaults (null: no colours, no logo, tracking on)', async () => {
  const owner = 'old-row';
  await modelAction('Profile', 'create', { data: { ownerId: owner, businessName: 'Old', createdAt: NOW, updatedAt: NOW } });
  const stored = await modelAction('Profile', 'findUnique', { where: { ownerId: owner } });
  assert.equal(stored.brandColour, null, 'the row really holds null');
  assert.equal(stored.trackLinks, null);
  const profile = await plan.getProfileFor(owner);
  assert.equal(profile.brandColour, '');
  assert.equal(profile.brandColour2, '');
  assert.equal(profile.logoOnPictures, false);
  assert.equal(profile.trackLinks, true);
  assert.deepEqual(
    (({ brandColour, brandColour2, logoOnPictures, trackLinks }) => ({ brandColour, brandColour2, logoOnPictures, trackLinks }))((await plan.planFor(owner)).profile),
    { brandColour: '', brandColour2: '', logoOnPictures: false, trackLinks: true },
  );
  // With nothing saved at all, the same defaults, and nothing is written.
  const none = await plan.getProfileFor('nobody-yet');
  assert.equal(none.trackLinks, true);
  assert.equal(none.brandColour, '');
  assert.equal(await modelAction('Profile', 'count', { where: { ownerId: 'nobody-yet' } }), 0);
  // A stored value that is not a colour never reaches a page or the drawing.
  await modelAction('Profile', 'updateMany', { where: { ownerId: owner }, data: { brandColour: 'url(x)', trackLinks: false } });
  assert.equal((await plan.getProfileFor(owner)).brandColour, '');
  assert.equal((await plan.getProfileFor(owner)).trackLinks, false);
});

test('saveProfileFor keeps a brand colour only as "" or #rrggbb, and the switches only as true or false', async () => {
  const saved = await plan.saveProfileFor(OWNER, { brandColour: '#1a2b3c', brandColour2: '', logoOnPictures: true, trackLinks: false });
  assert.equal(saved.brandColour, '#1a2b3c');
  assert.equal(saved.brandColour2, '');
  assert.equal(saved.logoOnPictures, true);
  assert.equal(saved.trackLinks, false);
  for (const bad of ['#1A2B3C', '#1a2b3', '#1a2b3c4', '1a2b3c', 'red', '#1a2b3g', ' #1a2b3c']) {
    await refusedWith(() => plan.saveProfileFor(OTHER, { brandColour: bad }), 'refuse.plan.colour');
    await refusedWith(() => plan.saveProfileFor(OTHER, { brandColour2: bad }), 'refuse.plan.colour');
  }
  await refusedWith(() => plan.saveProfileFor(OTHER, { logoOnPictures: 'yes' }), 'refuse.request');
  await refusedWith(() => plan.saveProfileFor(OTHER, { trackLinks: 1 }), 'refuse.request');
  assert.equal(await modelAction('Profile', 'count', { where: { ownerId: OTHER } }), 0, 'a refusal writes nothing');
});

test('PUT /api/plan: a colour of exactly six hex digits after # in either case is kept in lowercase; five or seven, or no #, are refused with the field', async () => {
  const kept = await put({ brandColour: '#A1B2C3' });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.profile.brandColour, '#a1b2c3');
  assert.equal((await put({ brandColour2: '  #0f0f0f ' })).body.profile.brandColour2, '#0f0f0f');
  for (const [field, value] of [['brandColour', '#a1b2c'], ['brandColour', '#a1b2c3d'], ['brandColour2', 'a1b2c3'], ['brandColour2', '#ggg000'], ['brandColour', 12], ['brandColour', null]]) {
    const refused = await put({ [field]: value });
    assert.equal(refused.status, 400, `${field} ${value}`);
    assert.deepEqual(refused.body, { problem: 'refuse.plan.colour', field });
  }
  assert.equal((await plan.getProfileFor(OWNER)).brandColour, '#a1b2c3', 'a refusal changed nothing');
  // Clear: an empty colour removes it.
  assert.equal((await put({ brandColour: '' })).body.profile.brandColour, '');
  // The switches, one at a time as the page sends them.
  assert.equal((await put({ logoOnPictures: false })).body.profile.logoOnPictures, false);
  assert.equal((await put({ trackLinks: true })).body.profile.trackLinks, true);
  for (const field of ['logoOnPictures', 'trackLinks']) {
    const refused = await put({ [field]: 'true' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, { problem: 'refuse.request', field });
  }
  // The read answers what was saved.
  const read = await answer(await planRoute.GET());
  assert.equal(read.body.profile.brandColour2, '#0f0f0f');
  assert.equal(read.body.profile.trackLinks, true);
});

// ---------------------------------------------------------------------------
// A theme that sells

test('a theme sells only when turned on: null reads as no, the address takes true or false, and every theme read answers it', async () => {
  const owner = 'sells-owner';
  const old = await modelAction('Theme', 'create', { data: { ownerId: owner, name: 'Old', colour: 0, position: 0, createdAt: NOW, updatedAt: NOW } });
  assert.equal(old.sells, null);
  assert.equal((await plan.listThemesFor(owner))[0].sells, false);
  const added = await plan.addThemeFor(owner, { name: 'Offers' });
  assert.equal(added.sells, false);
  const changed = await plan.updateThemeFor(owner, added.id, { sells: true });
  assert.equal(changed.sells, true);
  const whole = await plan.planFor(owner);
  assert.deepEqual(whole.themes.map((theme) => [theme.name, theme.sells]), [['Old', false], ['Offers', true]]);
  await refusedWith(() => plan.updateThemeFor(owner, added.id, { sells: 'yes' }), 'refuse.request');

  // Through the addresses (the page sends one field at a time).
  const mine = await plan.addThemeFor(OWNER, { name: 'Sale days' });
  const on = await answer(await themeRoute.PATCH(sending(`/api/themes/${mine.id}`, 'PATCH', { sells: true }), at(mine.id)));
  assert.equal(on.status, 200);
  assert.equal(on.body.theme.sells, true);
  const refused = await answer(await themeRoute.PATCH(sending(`/api/themes/${mine.id}`, 'PATCH', { sells: 1 }), at(mine.id)));
  assert.deepEqual([refused.status, refused.body], [400, { problem: 'refuse.request', field: 'sells' }]);
  const listed = await answer(await themesRoute.GET(new Request('http://localhost/api/themes')));
  assert.equal(listed.body.themes.find((theme) => theme.id === mine.id).sells, true);
  // A new theme is never made selling from the address that adds one.
  const made = await answer(await themesRoute.POST(sending('/api/themes', 'POST', { name: 'More', sells: true })));
  assert.equal(made.status, 400);
  // Another owner's theme stays as it is.
  const theirs = await answer(await themeRoute.PATCH(sending(`/api/themes/${old.id}`, 'PATCH', { sells: true }), at(old.id)));
  assert.equal(theirs.status, 404);
  assert.equal((await plan.listThemesFor(owner))[0].sells, false);
});

test('the plan read with the most themes and the longest words, every theme selling, stays inside Tellop\'s bounds', async () => {
  const owner = 'largest-sells';
  const longest = (count) => 'ş'.repeat(count);
  await plan.saveProfileFor(owner, { businessName: longest(LIMITS.profileField), brandColour: '#ffffff', brandColour2: '#000000', logoOnPictures: true, trackLinks: false });
  await modelAction('Theme', 'createMany', {
    data: Array.from({ length: plan.MOST_THEMES + 3 }, (_, index) => ({
      ownerId: owner, name: longest(LIMITS.name), about: longest(LIMITS.themeAbout), hashtags: longest(plan.THEME_HASHTAGS_MAX),
      colour: index % 5, position: index, archived: index >= LIMITS.themes, sells: true, createdAt: NOW, updatedAt: NOW,
    })),
  });
  const run = await measured(() => plan.planFor(owner));
  bounded(run, 'the plan with sells', 4);
  assert.equal(mostInFlight(run), 1);
  assert.equal(run.value.themes.length + run.value.archivedThemes.length, plan.MOST_THEMES);
  assert.ok(run.value.themes.every((theme) => theme.sells === true));
  assert.equal(run.value.profile.brandColour2, '#000000');
  // The calendar reads the same plan first: its whole read stays inside the bounds too.
  const calendar = await measured(() => readCalendar({ owner, query: {}, today: '2026-10-22', locale: 'tr' }));
  bounded(calendar, 'the calendar with the largest plan');
  assert.ok(mostInFlight(calendar) <= 4);
});

// ---------------------------------------------------------------------------
// The first-visit start: its rules

test('the theme ideas are the idea starters\' kinds; only offers sell, and none of the ideas picked at first does', () => {
  assert.deepEqual([...rules.IDEA_KEYS], [...STARTER_KINDS]);
  assert.deepEqual(rules.THEME_IDEAS.filter((idea) => idea.sells).map((idea) => idea.key), ['offer']);
  assert.equal(rules.FIRST_IDEAS.length, rules.START_MOST.themes);
  assert.ok(rules.FIRST_IDEAS.every((key) => rules.THEME_IDEAS.find((idea) => idea.key === key)?.sells === false));
});

test('readStart takes a name, one or two platforms and one to three theme ideas, each once, and names the field it refuses', () => {
  const ok = { businessName: '  Clay & Co ', networks: ['instagram', 'x'], themes: ['behind', 'product', 'offer'] };
  assert.deepEqual(rules.readStart(ok), { ok: true, value: { businessName: 'Clay & Co', networks: ['instagram', 'x'], themes: ['behind', 'product', 'offer'] } });
  assert.equal(rules.readStart({ ...ok, networks: ['instagram'], themes: ['made'] }).ok, true);
  const refused = (change) => {
    const read = rules.readStart({ ...ok, ...change });
    return read.ok ? 'ok' : `${read.problem} ${read.field ?? ''}`.trim();
  };
  assert.equal(refused({ businessName: '   ' }), 'refuse.text.missing businessName');
  assert.equal(refused({ businessName: 'x'.repeat(LIMITS.profileField) }), 'ok');
  assert.equal(refused({ businessName: 'x'.repeat(LIMITS.profileField + 1) }), 'refuse.text.long businessName');
  assert.equal(refused({ networks: [] }), 'refuse.request networks');
  assert.equal(refused({ networks: ['instagram', 'x', 'threads'] }), 'refuse.request networks');
  assert.equal(refused({ networks: ['instagram', 'instagram'] }), 'refuse.request networks');
  assert.equal(refused({ networks: ['myspace'] }), 'refuse.request networks');
  assert.equal(refused({ networks: 'instagram' }), 'refuse.request networks');
  assert.equal(refused({ themes: [] }), 'refuse.request themes');
  assert.equal(refused({ themes: ['behind', 'made', 'product', 'offer'] }), 'refuse.request themes');
  assert.equal(refused({ themes: ['behind', 'behind'] }), 'refuse.request themes');
  assert.equal(refused({ themes: ['sales'] }), 'refuse.request themes');
  assert.equal(refused({ extra: 1 }), 'refuse.request');
  assert.equal(rules.readStart(null).ok, false);
  assert.equal(rules.readStart([ok]).ok, false);
});

test('the seven days from today: one month, or two from the last six days of a month', () => {
  assert.deepEqual(rules.windowOf('2026-10-25'), { from: '2026-10-25', to: '2026-10-31', months: ['2026-10'] });
  assert.deepEqual(rules.windowOf('2026-10-26'), { from: '2026-10-26', to: '2026-11-01', months: ['2026-10', '2026-11'] });
  assert.deepEqual(rules.windowOf('2026-12-31').months, ['2026-12', '2027-01']);
  assert.deepEqual(rules.windowOf('2028-02-23').months, ['2028-02'], 'a leap February: the 23rd reaches the 29th');
});

test('inWindow keeps a proposal from today to six days on, one a day, in day order; spreadPick takes four spread over them', () => {
  const day = (value, name = value) => ({ day: value, name, themeId: 1 });
  const found = rules.inWindow([
    day('2026-10-21'), day('2026-10-29'), day('2026-10-28'), day('2026-10-22', 'today'), day('2026-10-22', 'again'),
    { day: '2026-10-23' }, { name: 'no day' }, null, day('2026-10-24'),
  ], '2026-10-22');
  assert.deepEqual(found.map((item) => item.name), ['today', '2026-10-24', '2026-10-28']);
  const days = (count) => Array.from({ length: count }, (_, index) => day(`2026-11-0${index + 1}`));
  const picked = (count) => rules.spreadPick(days(count)).map((item) => Number(item.day.slice(-1)) - 1);
  assert.deepEqual(picked(0), []);
  assert.deepEqual(picked(3), [0, 1, 2]);
  assert.deepEqual(picked(4), [0, 1, 2, 3]);
  assert.deepEqual(picked(5), [0, 1, 3, 4]);
  assert.deepEqual(picked(6), [0, 2, 3, 5]);
  assert.deepEqual(picked(7), [0, 2, 4, 6]);
  assert.equal(new Set(rules.spreadPick(days(9), 4)).size, 4);
  assert.deepEqual(rules.byMonth([day('2026-11-01'), day('2026-10-30'), day('2026-10-31')]).map(({ month, proposals }) => [month, proposals.length]), [['2026-10', 2], ['2026-11', 1]]);
});

test('a post made without AI is named from its theme idea\'s starters in turn; a special day and a theme from no idea keep their names', () => {
  const words = (key) => `<${key}>`;
  const ideaOf = new Map([[1, 'behind'], [2, 'offer']]);
  const named = rules.starterNamed([
    { day: 'a', name: 'Behind', themeId: 1 },
    { day: 'b', name: 'Offers', themeId: 2 },
    { day: 'c', name: 'Behind', themeId: 1 },
    { day: 'd', name: 'Republic Day', themeId: 1, specialDay: 'republicDay' },
    { day: 'e', name: 'Mine', themeId: 9 },
    { day: 'f', name: 'None', themeId: null },
  ], ideaOf, words);
  assert.deepEqual(named.map((item) => item.name), [
    '<ideas.starter.behind.1>', '<ideas.starter.offer.1>', '<ideas.starter.behind.2>', 'Republic Day', 'Mine', 'None',
  ]);
  const many = rules.starterNamed(Array.from({ length: 6 }, (_, index) => ({ day: String(index), name: 'x', themeId: 1 })), ideaOf, words);
  assert.equal(many[5].name, '<ideas.starter.behind.1>', 'the sixth wraps to the first starter');
  // The real words exist for every starter the start can name.
  for (const key of rules.IDEA_KEYS) for (let number = 1; number <= 5; number += 1) assert.notEqual(t(`ideas.starter.${key}.${number}`, 'tr'), `ideas.starter.${key}.${number}`);
});

test('only Skip keeps the start closed on this computer; Escape or the window\'s close remember nothing', () => {
  const kept = new Map();
  const storage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) };
  assert.equal(rules.closeStart('close', storage), false);
  assert.equal(rules.isSkipped(storage), false, 'closed for this visit only: shown again next time');
  assert.equal(kept.size, 0);
  assert.equal(rules.closeStart('skip', storage), true);
  assert.equal(rules.isSkipped(storage), true);
  assert.equal(rules.closeStart('skip', { setItem: () => { throw new Error('blocked'); } }), false, 'a storage that refuses');
});

test('Skip is kept in the browser\'s storage; a storage that refuses or throws never breaks the start', () => {
  const kept = new Map();
  const storage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) };
  assert.equal(rules.isSkipped(storage), false);
  assert.equal(rules.rememberSkip(storage), true);
  assert.equal(rules.isSkipped(storage), true);
  assert.equal(kept.get(rules.SKIP_STORE_NAME), '1');
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(rules.isSkipped(throwing), false);
  assert.equal(rules.rememberSkip(throwing), false);
  assert.equal(rules.isSkipped(null), false);
  assert.equal(rules.rememberSkip(undefined), false);
  assert.equal(rules.browserStorage(), null, 'no window here');
});

test('the calendar\'s own read rules a first visit out when it shows a business name or any post', () => {
  const empty = { business: '', tiles: [], ideas: [], due: null };
  assert.equal(rules.mayBeFirstVisit(empty), true);
  assert.equal(rules.mayBeFirstVisit({ ...empty, business: 'Clay' }), false);
  assert.equal(rules.mayBeFirstVisit({ ...empty, business: '   ' }), true);
  assert.equal(rules.mayBeFirstVisit({ ...empty, tiles: [{ id: 1 }] }), false);
  assert.equal(rules.mayBeFirstVisit({ ...empty, ideas: [{ id: 1 }] }), false);
  assert.equal(rules.mayBeFirstVisit({ ...empty, due: { id: 1 } }), false);
});

// ---------------------------------------------------------------------------
// The first-visit start: Make my first four posts, against a fake app

/**
 * A fake of the four addresses the press uses: it answers proposals on every
 * free day of a month from `today` (each named by its maker), and fails the
 * addresses named in `failing` (a Set the check changes as it goes).
 */
function fakeApp(today, failing = new Set()) {
  const calls = [];
  const answer = async (address, method, body) => {
    calls.push({ address, body });
    if (failing.has(address)) return { ok: false, problem: address.includes('/ai/') ? 'ai.allowance' : 'error.saveUnconfirmed' };
    if (address === '/api/plan/start') return { ok: true, value: { profile: {}, themes: [{ id: 7, idea: 'behind' }, { id: 8, idea: 'offer' }] } };
    if (address === '/api/month/keep') return { ok: true, value: { posts: body.proposals } };
    const days = [];
    if (body.month === undefined) {
      // A span: every day from its first (not before today) to its last.
      for (let day = body.from; day <= body.to; day = addDays(day, 1)) if (day >= today) days.push(day);
    } else {
      for (let date = 1; date <= 31; date += 1) {
        const day = `${body.month}-${String(date).padStart(2, '0')}`;
        if (day >= today && !Number.isNaN(Date.parse(day)) && new Date(day).getUTCDate() === date) days.push(day);
      }
    }
    const ai = address.includes('/ai/');
    return { ok: true, value: { proposals: days.map((day, index) => ({ day, name: ai ? `AI ${day}` : 'Theme name', themeId: index % 2 ? 8 : 7 })) } };
  };
  return { calls, send: answer, sendUnconfirmed: answer };
}

test('Make my first four posts: the start once, the AI once for the seven days only (across a month\'s end), four days spread, one keep a month', async () => {
  const today = '2026-10-29';
  const app = fakeApp(today);
  const done = freshStart();
  const made = await makeFirstPosts({ ...app, today, businessName: 'Clay', networks: ['instagram'], ideas: ['behind', 'offer'], useAi: true, words: (key) => key, done });
  assert.deepEqual(made, { ok: true, kept: 4 });
  assert.deepEqual(app.calls.map((call) => `${call.address} ${call.body.month ?? ''}`.trim()), [
    '/api/plan/start', '/api/ai/fill-month', '/api/month/keep 2026-10', '/api/month/keep 2026-11',
  ]);
  assert.deepEqual(app.calls[0].body, { businessName: 'Clay', networks: ['instagram'], themes: ['behind', 'offer'] });
  assert.deepEqual(app.calls[1].body, { from: '2026-10-29', to: '2026-11-04', perWeek: rules.POSTS_A_WEEK, themeIds: [7, 8], networks: ['instagram'] }, 'the seven days, never a whole month');
  const kept = app.calls.filter((call) => call.address === '/api/month/keep');
  assert.deepEqual(kept.map((call) => [call.body.madeBy, call.body.proposals.map((item) => item.day)]), [
    ['ai', ['2026-10-29', '2026-10-31']],
    ['ai', ['2026-11-02', '2026-11-04']],
  ], 'seven days, four spread: the first, the last and two between');
  assert.equal(kept[1].body.proposals[0].name, 'AI 2026-11-02');
  assert.ok(kept.every((call) => call.body.proposals.every((item) => !('madeBy' in item))), 'a keep sends only what the address reads');

  // Without AI: one request for the same seven days, named from the ideas' starters.
  const plain = fakeApp(today);
  assert.deepEqual(await makeFirstPosts({ ...plain, today, businessName: 'Clay', networks: ['instagram'], ideas: ['behind', 'offer'], useAi: false, words: (key) => key, done: freshStart() }), { ok: true, kept: 4 });
  assert.deepEqual(plain.calls[1], { address: '/api/month/plan', body: { from: '2026-10-29', to: '2026-11-04', perWeek: rules.POSTS_A_WEEK, themeIds: [7, 8] } });
  const plainKept = plain.calls.filter((call) => call.address === '/api/month/keep');
  assert.equal(plainKept[0].body.madeBy, 'person');
  assert.equal(plainKept[0].body.proposals[0].name, 'ideas.starter.behind.1', 'without AI, named from the idea\'s starters');
  assert.equal(plainKept[0].body.proposals[1].name, 'ideas.starter.behind.2');
});

test('when the AI cannot, the press says so and Make them without AI plans every month without it; a failed keep is tried again alone', async () => {
  const today = '2026-10-10';
  const failing = new Set(['/api/ai/fill-month']);
  const app = fakeApp(today, failing);
  const done = freshStart();
  const input = { ...app, today, businessName: 'Clay', networks: ['x'], ideas: ['behind'], words: (key) => key, done };
  assert.deepEqual(await makeFirstPosts({ ...input, useAi: true }), { ok: false, problem: 'ai.allowance', aiFailed: true });
  assert.equal(done.picks, null);
  // Without AI: no second start, the month planned without AI; then the keep fails once.
  failing.add('/api/month/keep');
  assert.deepEqual(await makeFirstPosts({ ...input, useAi: false }), { ok: false, problem: 'error.saveUnconfirmed' });
  assert.equal(app.calls.filter((call) => call.address === '/api/plan/start').length, 1);
  assert.equal(done.picks.length, 4);
  assert.ok(done.picks.every((pick) => pick.madeBy === 'person'));
  failing.delete('/api/month/keep');
  const before = app.calls.length;
  assert.deepEqual(await makeFirstPosts({ ...input, useAi: true }), { ok: true, kept: 4 });
  assert.deepEqual(app.calls.slice(before).map((call) => call.address), ['/api/month/keep'], 'only the keep goes again');
  // A start refused (its words) stops before anything else.
  const refused = fakeApp(today, new Set(['/api/plan/start']));
  const answer = await makeFirstPosts({ ...refused, today, businessName: '', networks: ['x'], ideas: ['behind'], useAi: true, words: (key) => key, done: freshStart() });
  assert.equal(answer.ok, false);
  assert.equal(refused.calls.length, 1);
});

// ---------------------------------------------------------------------------
// The first-visit start: its read and its address

test('the first visit shows only with no business name and no post at all, and asks the records once, only when the calendar showed neither', async () => {
  const owner = 'first-visit-owner';
  const empty = { business: '', tiles: [], ideas: [], due: null };
  // Nothing anywhere: shown, one call.
  const none = await measured(() => readFirstVisit(owner, empty));
  assert.equal(none.value, true);
  bounded(none, 'the first-visit read', 1);
  assert.equal(await plan.hasPostsFor(owner), false);
  // Another owner's post does not count.
  await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', createdAt: NOW, updatedAt: NOW } });
  assert.equal(await readFirstVisit(owner, empty), true);
  // An idea (no day) of the owner, outside every shown day: not shown.
  await modelAction('Post', 'create', { data: { ownerId: owner, name: 'An idea', createdAt: NOW, updatedAt: NOW } });
  assert.equal(await plan.hasPostsFor(owner), true);
  assert.equal(await readFirstVisit(owner, empty), false);
  // A business name, or a post the calendar shows: not shown, and no call at all.
  for (const calendar of [{ ...empty, business: 'Clay' }, { ...empty, tiles: [{ id: 1 }] }]) {
    let calls = 0;
    const run = await measured(async () => {
      calls += 1;
      return readFirstVisit('never-asked', calendar);
    });
    assert.equal(run.value, false);
    assert.equal(run.calls.length, 0, 'answered from the calendar\'s own read');
    assert.equal(calls, 1);
  }
});

test('the calendar page with the first-visit read stays inside the bounds: the read adds a call only to a calendar that found no post', async () => {
  const owner = 'fresh-calendar';
  const longest = (count) => 'ş'.repeat(count);
  await modelAction('Theme', 'createMany', {
    data: Array.from({ length: plan.MOST_THEMES }, (_, index) => ({
      ownerId: owner, name: longest(LIMITS.name), about: longest(LIMITS.themeAbout), hashtags: longest(plan.THEME_HASHTAGS_MAX),
      colour: index % 5, position: index, archived: index >= LIMITS.themes, createdAt: NOW, updatedAt: NOW,
    })),
  });
  const alone = await measured(() => readCalendar({ owner, query: {}, today: '2026-10-22', locale: 'en' }));
  const page = await measured(async () => {
    const calendar = await readCalendar({ owner, query: {}, today: '2026-10-22', locale: 'en' });
    return readFirstVisit(owner, calendar);
  });
  assert.equal(page.value, true);
  bounded(page, 'the calendar and the first-visit read');
  assert.equal(page.calls.length, alone.calls.length + 1, 'one call more than the calendar alone');
  assert.equal(mostInFlight(page), 1);
});

test('POST /api/plan/start saves the name and the platforms, adds a theme for each idea in the person\'s words, and refuses a second start', async () => {
  const owner = OWNER;
  // The owner already has a theme called like one idea (case differs) and three more: room for one theme.
  await modelAction('Theme', 'deleteMany', { where: { ownerId: owner } });
  await modelAction('Profile', 'updateMany', { where: { ownerId: owner }, data: { businessName: '' } });
  const existing = await plan.addThemeFor(owner, { name: t('start.theme.product', 'en').toUpperCase() });
  for (const name of ['One', 'Two', 'Three']) await plan.addThemeFor(owner, { name });

  const run = await measured(() => start({ businessName: 'Clay & Co', networks: ['instagram', 'whatsapp'], themes: ['offer', 'product', 'behind'] }));
  const made = run.value;
  bounded(run, 'the start', 3);
  assert.equal(mostInFlight(run), 1);
  assert.equal(made.status, 200);
  assert.equal(made.body.profile.businessName, 'Clay & Co');
  assert.equal(made.body.profile.networks, 'instagram,whatsapp');
  // Offers is added (selling, with the first free colour, last); Products is the theme already there; no room is left for Behind the scenes.
  assert.deepEqual(made.body.themes.map((theme) => [theme.idea, theme.sells]), [['offer', true], ['product', false]]);
  assert.equal(made.body.themes[0].name, t('start.theme.offer', 'en'));
  assert.equal(made.body.themes[1].id, existing.id);
  const themes = await plan.listThemesFor(owner);
  assert.equal(themes.length, LIMITS.themes);
  assert.equal(themes.at(-1).name, t('start.theme.offer', 'en'));
  assert.equal(themes.at(-1).about, t('start.theme.offer.about', 'en'));
  assert.equal(new Set(themes.map((theme) => theme.colour)).size, LIMITS.themes, 'every theme in use has its own colour');

  // A second start (a window left open) changes nothing.
  const again = await start({ businessName: 'Another', networks: ['x'], themes: ['question'] });
  assert.deepEqual([again.status, again.body], [409, { problem: 'refuse.plan.started' }]);
  assert.equal((await plan.getProfileFor(owner)).businessName, 'Clay & Co');
  assert.equal((await plan.listThemesFor(owner)).length, LIMITS.themes);

  // Refusals name the field and write nothing.
  const fresh = 'fresh-start';
  const refusal = async (body) => {
    const response = await answer(await startRoute.POST(sending('/api/plan/start', 'POST', body)));
    return [response.status, response.body.problem, response.body.field];
  };
  assert.deepEqual(await refusal({ businessName: '', networks: ['x'], themes: ['made'] }), [400, 'refuse.text.missing', 'businessName']);
  assert.deepEqual(await refusal({ businessName: 'A', networks: ['x', 'threads', 'bluesky'], themes: ['made'] }), [400, 'refuse.request', 'networks']);
  assert.deepEqual(await refusal({ businessName: 'A', networks: ['x'], themes: ['made', 'behind', 'product', 'offer'] }), [400, 'refuse.request', 'themes']);
  assert.deepEqual(await refusal('not json'), [400, 'refuse.request', undefined]);
  assert.equal(await modelAction('Profile', 'count', { where: { ownerId: fresh } }), 0);

  // No room and no theme of the same name: nothing is added, and the first posts take the first three themes in use.
  await modelAction('Profile', 'updateMany', { where: { ownerId: owner }, data: { businessName: '' } });
  const full = await start({ businessName: 'Clay', networks: ['x'], themes: ['question'] });
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.themes.map((theme) => [theme.id, theme.idea]), themes.slice(0, 3).map((theme) => [theme.id, null]));
  assert.equal((await plan.listThemesFor(owner)).length, LIMITS.themes);
});

test('startPlanFor on a fresh owner adds every theme asked, each once; with no room it adds none and answers the themes in use', async () => {
  const fresh = 'start-fresh';
  const started = await plan.startPlanFor(fresh, {
    businessName: 'Fresh',
    networks: 'tiktok',
    themes: [{ name: 'Tips', about: 'How to', sells: false }, { name: 'Deals', about: '', sells: true }, { name: ' tips ' }],
  }, { now: () => new Date(NOW) });
  assert.deepEqual(started.themes.map((theme) => theme?.name ?? null), ['Tips', 'Deals', null], 'the same name twice is added once');
  assert.deepEqual(started.inUse.map((theme) => [theme.name, theme.colour, theme.sells]), [['Tips', 0, false], ['Deals', 1, true]]);
  assert.equal(started.profile.saved, true);
  assert.equal(started.profile.trackLinks, true);
  assert.equal(started.profile.postsPerWeek, 3);

  const full = 'start-full';
  for (const name of ['A', 'B', 'C', 'D', 'E']) await plan.addThemeFor(full, { name });
  const none = await plan.startPlanFor(full, { businessName: 'Full', networks: 'x', themes: [{ name: 'Tips' }] });
  assert.deepEqual(none.themes, [null]);
  assert.deepEqual(none.inUse.map((theme) => theme.name), ['A', 'B', 'C', 'D', 'E']);
  assert.equal((await plan.listThemesFor(full)).length, LIMITS.themes);
  await refusedWith(() => plan.startPlanFor(fresh, { businessName: 'Again', networks: '', themes: [] }), 'refuse.plan.started');
  await refusedWith(() => plan.startPlanFor('start-bad', { businessName: ' ', networks: '', themes: [] }), 'refuse.text.missing');
  await refusedWith(() => plan.startPlanFor('start-bad', { businessName: 'A', networks: '', themes: [{ name: '' }] }), 'refuse.text.missing');
  await refusedWith(() => plan.startPlanFor('start-bad', { businessName: 'A', networks: '', themes: [{ name: 'A', sells: 'yes' }] }), 'refuse.request');
  assert.equal(await modelAction('Profile', 'count', { where: { ownerId: 'start-bad' } }), 0);
});

// ---------------------------------------------------------------------------
// The brand colour rules and the save queue (no records)

test('a typed colour saves as #rrggbb in lowercase (the # may be left out), "" when empty, and waits while it is not whole', () => {
  assert.equal(colourToSave(''), '');
  assert.equal(colourToSave('   '), '');
  assert.equal(colourToSave('#A1B2C3'), '#a1b2c3');
  assert.equal(colourToSave(' a1b2c3 '), '#a1b2c3');
  assert.equal(colourToSave('#a1b2c'), null);
  assert.equal(colourToSave('#a1b2c3d'), null);
  assert.equal(colourToSave('##a1b2c3'), null);
  assert.equal(colourToSave('blue'), null);
  assert.equal(colourToSave(undefined), null);
  assert.equal(swatchColour(''), null);
  assert.equal(swatchColour('#a1b2c'), null);
  assert.equal(swatchColour('A1B2C3'), '#a1b2c3');
});

/** A save queue with a fake `send` and a timer the check runs by hand. */
function queueWith(answers = () => ({ ok: true, value: {} })) {
  const sent = [];
  const results = [];
  let timer = null;
  let open = 0;
  let mostOpen = 0;
  const queue = new SaveQueue({
    send: async (address, method, body, options) => {
      sent.push({ address, method, body, keepalive: options?.keepalive === true });
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      await new Promise((resolve) => setImmediate(resolve));
      open -= 1;
      return answers({ address, method, body });
    },
    onResult: (outcome) => results.push(outcome),
    setTimer: (run, wait) => {
      assert.equal(wait, TYPING_WAIT);
      timer = run;
      return run;
    },
    clearTimer: (which) => {
      if (which === timer) timer = null;
    },
  });
  return {
    queue, sent, results,
    tick: () => { const run = timer; timer = null; run?.(); },
    get timer() { return timer; },
    get mostOpen() { return mostOpen; },
  };
}

test('typing waits for a pause and sends the last words once; a switch goes at once and takes the waiting words along', async () => {
  const run = queueWith();
  run.queue.change('/api/plan', 'PUT', 'offer', 'P');
  run.queue.change('/api/plan', 'PUT', 'offer', 'Pottery');
  assert.equal(run.sent.length, 0, 'nothing before the pause');
  run.tick();
  await run.queue.settled();
  assert.deepEqual(run.sent.map((item) => item.body), [{ offer: 'Pottery' }]);
  assert.deepEqual(run.results, [null, { saved: true }], 'the line clears before the save and says Saved after');

  run.queue.change('/api/plan', 'PUT', 'goal', 'More classes');
  await run.queue.change('/api/plan', 'PUT', 'trackLinks', false, 'now');
  assert.deepEqual(run.sent.slice(1).map((item) => item.body), [{ goal: 'More classes' }, { trackLinks: false }]);
  assert.equal(run.timer, null, 'nothing is left for the timer');
  assert.equal(run.mostOpen, 1, 'one request at a time');
});

test('a value that is not ready waits until the field is left; leaving the page sends what is ready with keepalive and never what is not', async () => {
  const run = queueWith();
  run.queue.change('/api/plan', 'PUT', 'profileLink', 'https://sho', 'held');
  run.tick();
  await run.queue.settled();
  assert.equal(run.sent.length, 0);
  await run.queue.flush();
  assert.deepEqual(run.sent.map((item) => item.body), [{ profileLink: 'https://sho' }]);

  run.queue.change('/api/plan', 'PUT', 'brandColour', '#12', 'held');
  run.queue.change('/api/plan', 'PUT', 'voice', 'Warm');
  run.queue.leave();
  assert.deepEqual(run.sent.slice(1).map((item) => [item.body, item.keepalive]), [[{ voice: 'Warm' }, true]]);
  assert.deepEqual(run.queue.waiting.map((item) => item.field), ['brandColour']);
  // A theme removed: what waited for it is dropped.
  run.queue.change('/api/themes/4', 'PATCH', 'name', 'Gone');
  run.queue.drop('/api/themes/4');
  run.tick();
  await run.queue.settled();
  assert.equal(run.sent.length, 2);
});

test('a failed save keeps the person\'s change and says why; it goes again with the next save, and a newer change wins', async () => {
  let refuse = true;
  const run = queueWith(({ body }) => (refuse && 'reviewLink' in body ? { ok: false, problem: 'refuse.link', field: 'reviewLink' } : { ok: true, value: {} }));
  await run.queue.change('/api/plan', 'PUT', 'reviewLink', 'https://bad', 'now');
  assert.deepEqual(run.results.at(-1), { problem: 'refuse.link', field: 'reviewLink', address: '/api/plan' });
  assert.deepEqual(run.queue.waiting.map((item) => [item.field, item.value, item.held]), [['reviewLink', 'https://bad', false]]);

  // Another field's save sends it again: still refused, still said; the other field is saved on its own.
  await run.queue.change('/api/plan', 'PUT', 'goal', 'Grow', 'now');
  assert.deepEqual(run.sent.map((item) => Object.keys(item.body)[0]), ['reviewLink', 'reviewLink', 'goal']);
  assert.equal(run.results.at(-1).problem, 'refuse.link');

  // The person fixes it: the newer value replaces the kept one and is saved.
  refuse = false;
  run.queue.change('/api/plan', 'PUT', 'reviewLink', 'https://good.example');
  run.tick();
  await run.queue.settled();
  assert.deepEqual(run.sent.at(-1).body, { reviewLink: 'https://good.example' });
  assert.deepEqual(run.results.at(-1), { saved: true });
  assert.deepEqual(run.queue.waiting, []);

  // A request that throws is a failed save with the general words.
  const broken = new SaveQueue({ send: async () => { throw new Error('gone'); }, onResult: (outcome) => run.results.push(outcome), setTimer: () => 0, clearTimer: () => {} });
  await broken.change('/api/plan', 'PUT', 'voice', 'Calm', 'now');
  assert.deepEqual(run.results.at(-1), { problem: 'error.saveFailed', field: 'voice', address: '/api/plan' });
  assert.deepEqual(broken.waiting.map((item) => item.value), ['Calm']);
});

test('a change made while a save is on its way is not lost: it is saved after it, so the last words typed are the last saved', async () => {
  const run = queueWith();
  const first = run.queue.change('/api/plan', 'PUT', 'businessName', 'Clay', 'now');
  run.queue.change('/api/plan', 'PUT', 'businessName', 'Clay & Co', 'now');
  await first;
  await run.queue.settled();
  assert.deepEqual(run.sent.map((item) => item.body.businessName), ['Clay', 'Clay & Co']);
  assert.equal(run.mostOpen, 1);
});

test('the Brand card\'s eight ready colours: whole colours the field saves as they are, each with white or black words at 4.5:1 or more', () => {
  assert.equal(BRAND_PRESETS.length, 8);
  assert.equal(new Set(BRAND_PRESETS.map((preset) => preset.key)).size, 8);
  assert.equal(new Set(BRAND_PRESETS.map((preset) => preset.digits)).size, 8);
  const inks = new Set();
  for (const preset of BRAND_PRESETS) {
    const colour = presetColour(preset);
    assert.match(colour, /^#[0-9a-f]{6}$/u, preset.key);
    assert.equal(colourToSave(colour), colour, `${preset.key}: saved as it is`);
    assert.equal(swatchColour(colour), colour);
    assert.ok(inkContrastOf(colour) >= 4.5, `${preset.key}: ${inkContrastOf(colour)}`);
    inks.add(inkFor(colour));
    assert.equal(isPreset(colour.toUpperCase(), preset), true, 'typed in capitals: still that colour');
    assert.equal(isPreset(colour.slice(1), preset), true, 'typed without its #');
    assert.equal(isPreset('', preset), false);
  }
  assert.deepEqual([...inks].sort(), ['black', 'white'], 'some take white words, some black');
  for (const locale of ['en', 'tr']) {
    for (const preset of BRAND_PRESETS) assert.equal(typeof t(`plan.brand.preset.${preset.key}`, locale), 'string');
  }
});
