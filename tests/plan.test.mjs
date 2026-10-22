/**
 * My plan's records and addresses, checked against a throwaway store
 * (`APP_DATA_FILE` points at a temporary folder that is removed afterwards).
 *
 * The checks run in order and share one store: the first ones look at an
 * owner who has saved nothing yet.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'plan-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction, modelBatch } = await import('../lib/data/index.js');
const { keepFile } = await import('../lib/data/files.js');
const plan = await import('../lib/data/plan.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { BUILT_IN_DAYS } = await import('../lib/plan/special-days.js');
const planRoute = await import('../app/api/plan/route.js');
const logoRoute = await import('../app/api/plan/logo/route.js');
const themesRoute = await import('../app/api/themes/route.js');
const themeRoute = await import('../app/api/themes/[id]/route.js');
const daysRoute = await import('../app/api/special-days/route.js');
const dayRoute = await import('../app/api/special-days/[id]/route.js');

const OTHER = 'someone-else';
const NOW = '2026-10-21T09:00:00.000Z';

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/** @param {string} address @param {string} method @param {unknown} [body] @param {Record<string, string>} [headers] */
function sending(address, method, body, headers = {}) {
  return new Request(`http://localhost${address}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** @param {string} id */
const at = (id) => ({ params: Promise.resolve({ id: String(id) }) });

/** @param {Response} response */
async function answer(response) {
  return { status: response.status, body: await response.json() };
}

const profileRows = () => modelAction('Profile', 'count', { where: { ownerId: OWNER } });

/** @param {() => Promise<unknown>} work @param {string} key */
async function refusedWith(work, key) {
  await assert.rejects(work, (error) => error instanceof DataError && error.messageKey === key);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('with nothing saved, the profile reads as the defaults and reading saves nothing', async () => {
  const profile = await plan.getProfileFor(OWNER);
  assert.equal(profile.saved, false);
  assert.equal(profile.postsPerWeek, 3);
  assert.equal(profile.showDays, 'both');
  assert.equal(profile.networks, '');
  assert.equal(profile.logo, null);
  const read = await answer(await planRoute.GET());
  assert.equal(read.status, 200);
  assert.equal(read.body.profile.postsPerWeek, 3);
  assert.deepEqual(read.body.themes, []);
  assert.deepEqual(read.body.ownDays, []);
  const whole = await plan.planFor(OWNER);
  assert.deepEqual(whole.networks, []);
  assert.deepEqual(whole.hiddenDays, []);
  assert.equal((await logoRoute.GET(new Request('http://localhost/api/plan/logo'))).status, 404);
  // A logo form that keeps what is there writes nothing either.
  const kept = await answer(await logoRoute.POST(new Request('http://localhost/api/plan/logo', { method: 'POST', body: new FormData() })));
  assert.equal(kept.status, 200);
  assert.equal(kept.body.profile.saved, false);
  assert.equal(await profileRows(), 0);
});

test('saving the profile creates it once, keeps its first moment and leaves unsent fields alone', async () => {
  const first = await plan.saveProfileFor(OWNER, { businessName: 'Clay & Co' }, { now: () => new Date(NOW) });
  assert.equal(first.saved, true);
  assert.equal(first.createdAt, NOW);
  assert.equal(first.postsPerWeek, 3);
  const second = await plan.saveProfileFor(OWNER, { offer: 'Pottery classes' }, { now: () => new Date('2026-10-22T09:00:00.000Z') });
  assert.equal(second.createdAt, NOW);
  assert.equal(second.updatedAt, '2026-10-22T09:00:00.000Z');
  assert.equal(second.businessName, 'Clay & Co');
  assert.equal(second.offer, 'Pottery classes');
  assert.equal(await profileRows(), 1);
  // Another owner's profile is theirs alone.
  assert.equal((await plan.getProfileFor(OTHER)).saved, false);
  await refusedWith(() => plan.saveProfileFor(OTHER, { postsPerWeek: '4' }), 'refuse.request');
});

test('PUT /api/plan reads every field at its edges and names the field it refuses', async () => {
  const put = async (body, headers) => answer(await planRoute.PUT(sending('/api/plan', 'PUT', body, headers)));

  assert.deepEqual((await put({ businessName: 'x' }, { 'content-type': 'text/plain' })).body, { problem: 'refuse.request' });
  assert.deepEqual((await put({})).body, { problem: 'refuse.request' });
  assert.deepEqual((await put({ ownerId: 'someone-else' })).body, { problem: 'refuse.request' });
  assert.deepEqual((await put('[1]')).body, { problem: 'refuse.request' });

  const limit = LIMITS.profileField;
  assert.equal((await put({ businessName: 'b'.repeat(limit - 1) })).status, 200);
  assert.equal((await put({ businessName: 'b'.repeat(limit) })).body.profile.businessName.length, limit);
  assert.deepEqual((await put({ businessName: 'b'.repeat(limit + 1) })).body, { problem: 'refuse.text.long', field: 'businessName' });
  assert.equal((await put({ pictureStyle: 's'.repeat(LIMITS.pictureStyle) })).status, 200);
  assert.deepEqual((await put({ pictureStyle: 's'.repeat(LIMITS.pictureStyle + 1) })).body, { problem: 'refuse.text.long', field: 'pictureStyle' });
  assert.equal((await put({ offer: 'Line one\nLine two' })).body.profile.offer, 'Line one\nLine two');
  assert.equal((await put({ businessName: 'Clay\nand Co' })).body.profile.businessName, 'Clay and Co');

  for (const count of [0, 15, 2.5, '3', null]) {
    assert.deepEqual((await put({ postsPerWeek: count })).body, { problem: 'refuse.number', field: 'postsPerWeek' }, String(count));
  }
  for (const count of [1, 2, 13, 14]) assert.equal((await put({ postsPerWeek: count })).body.profile.postsPerWeek, count);

  assert.equal((await put({ networks: ['threads', 'instagram'] })).body.profile.networks, 'threads,instagram');
  assert.deepEqual((await plan.planFor(OWNER)).networks, ['threads', 'instagram']);
  assert.equal((await put({ networks: [] })).body.profile.networks, '');
  for (const networks of [['instagram', 'instagram'], ['myspace'], 'instagram', [1]]) {
    assert.deepEqual((await put({ networks })).body, { problem: 'refuse.request', field: 'networks' });
  }

  assert.equal((await put({ profileLink: 'https://example.com/clay' })).body.profile.profileLink, 'https://example.com/clay');
  assert.equal((await put({ reviewLink: '' })).body.profile.reviewLink, '');
  for (const link of ['http://example.com/', 'javascript:alert(1)', ['https://name', 'pw@example.com/'].join(':'), 'not a link']) {
    assert.deepEqual((await put({ reviewLink: link })).body, { problem: 'refuse.link', field: 'reviewLink' }, link);
  }
  assert.deepEqual((await put({ profileLink: `https://example.com/${'a'.repeat(LIMITS.link)}` })).body, { problem: 'refuse.text.long', field: 'profileLink' });

  for (const place of ['tr', 'world', 'both']) assert.equal((await put({ showDays: place })).body.profile.showDays, place);
  assert.deepEqual((await put({ showDays: 'mars' })).body, { problem: 'refuse.request', field: 'showDays' });

  const [first, second] = BUILT_IN_DAYS;
  assert.equal((await put({ hiddenDays: [first.key, second.key] })).body.profile.hiddenDays, `${first.key},${second.key}`);
  assert.deepEqual((await plan.planFor(OWNER)).hiddenDays, [first.key, second.key]);
  for (const hiddenDays of [['no-such-day'], [first.key, first.key], first.key, [3]]) {
    assert.deepEqual((await put({ hiddenDays })).body, { problem: 'refuse.request', field: 'hiddenDays' });
  }
  assert.equal((await put({ hiddenDays: [] })).body.profile.hiddenDays, '');
  // A refused field saves nothing of the request, not even the fields beside it.
  await put({ voice: 'warm', postsPerWeek: 99 });
  assert.notEqual((await plan.getProfileFor(OWNER)).voice, 'warm');
});

test('the logo is kept from a digest, shown from the owner\'s profile and removed only on remove', async () => {
  const post = async (form, headers = {}) => answer(await logoRoute.POST(new Request('http://localhost/api/plan/logo', { method: 'POST', body: form, headers })));
  const kept = await keepFile(new Request('http://localhost/api/files', { method: 'POST', body: PNG }));
  const form = new FormData();
  form.set('logo', kept.file);
  const saved = await post(form);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.logo, kept.file.slice(0, 12));
  assert.equal(JSON.stringify(saved.body).includes(kept.file), false, 'the digest itself never leaves');
  const shown = await logoRoute.GET(new Request('http://localhost/api/plan/logo'));
  assert.equal(shown.status, 200);
  assert.deepEqual(Buffer.from(await shown.arrayBuffer()), PNG);

  // Saving without touching the picture keeps it.
  assert.equal((await post(new FormData())).body.profile.logo, kept.file.slice(0, 12));

  const missing = new FormData();
  missing.set('logo', 'f'.repeat(64));
  assert.deepEqual((await post(missing)).body, { problem: 'error.fileMissing', field: 'logo' });
  const notDigest = new FormData();
  notDigest.set('logo', 'nope');
  assert.deepEqual((await post(notDigest)).body, { problem: 'error.fileNotKept', field: 'logo' });
  assert.deepEqual((await post(form, { 'sec-fetch-site': 'cross-site' })).body, { problem: 'refuse.request' });
  // A form larger than a digest needs is refused unread: by the size it
  // declares, and by counting when it declares none.
  const boundary = 'edge';
  const bigForm = (size) => new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="logo"\r\n\r\n${kept.file}\r\n--${boundary}\r\nContent-Disposition: form-data; name="padding"\r\n\r\n${'x'.repeat(size)}\r\n--${boundary}--\r\n`);
  const multipart = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  const overhead = bigForm(0).byteLength;
  const sendBytes = async (bytes, headers) => answer(await logoRoute.POST(new Request('http://localhost/api/plan/logo', { method: 'POST', body: bytes, headers })));
  assert.equal((await sendBytes(bigForm(16384 - overhead), multipart)).status, 200);
  assert.deepEqual(await sendBytes(bigForm(16384 - overhead + 1), multipart), { status: 413, body: { problem: 'refuse.long' } });
  assert.deepEqual(await sendBytes(bigForm(10), { ...multipart, 'content-length': '16385' }), { status: 413, body: { problem: 'refuse.long' } });
  const asJson = await logoRoute.POST(sending('/api/plan/logo', 'POST', { logo: kept.file }));
  assert.deepEqual(await asJson.json(), { problem: 'refuse.request' });
  assert.equal((await plan.getProfileFor(OWNER)).logo, kept.file.slice(0, 12));

  const remove = new FormData();
  remove.set('logo', 'remove');
  assert.equal((await post(remove)).body.profile.logo, null);
  assert.equal((await logoRoute.GET(new Request('http://localhost/api/plan/logo'))).status, 404);
});

test('themes: four and five are taken, a sixth is refused, each with the first free colour', async () => {
  const added = [];
  for (let count = 1; count <= 4; count += 1) added.push(await plan.addThemeFor(OWNER, { name: `Theme ${count}` }));
  added.push(await plan.addThemeFor(OWNER, { name: 'Theme 5', about: 'Offers', hashtags: '#clay #studio' }));
  assert.deepEqual(added.map((theme) => theme.colour), [0, 1, 2, 3, 4]);
  assert.deepEqual(added.map((theme) => theme.position), [0, 1, 2, 3, 4]);
  assert.equal(added[4].hashtags, '#clay #studio');
  await refusedWith(() => plan.addThemeFor(OWNER, { name: 'Theme 6' }), 'refuse.plan.themeLimit');
  const sixth = await answer(await themesRoute.POST(sending('/api/themes', 'POST', { name: 'Theme 6' })));
  assert.deepEqual(sixth, { status: 400, body: { problem: 'refuse.plan.themeLimit' } });
  assert.equal((await plan.listThemesFor(OWNER)).length, LIMITS.themes);

  // A theme no post uses is deleted, and its colour is the next one given.
  assert.equal(await plan.removeThemeFor(OWNER, added[1].id), 'deleted');
  assert.equal((await modelAction('Theme', 'count', { where: { ownerId: OWNER, id: added[1].id } })), 0);
  const again = await plan.addThemeFor(OWNER, { name: 'Theme 2 again' });
  assert.equal(again.colour, 1);

  // A theme a post uses is archived: kept for the post, out of the limit, its colour free.
  await modelAction('Post', 'create', { data: { ownerId: OWNER, name: 'A class', themeId: added[2].id, createdAt: NOW, updatedAt: NOW } });
  const removed = await answer(await themeRoute.DELETE(new Request('http://localhost/api/themes/x', { method: 'DELETE' }), at(added[2].id)));
  assert.deepEqual(removed, { status: 200, body: { removed: 'archived' } });
  assert.equal((await plan.listThemesFor(OWNER)).some((theme) => theme.id === added[2].id), false);
  assert.deepEqual((await plan.listThemesFor(OWNER, { archived: true })).map((theme) => theme.id), [added[2].id]);
  const whole = await plan.planFor(OWNER);
  assert.equal(whole.themes.length, 4);
  assert.deepEqual(whole.archivedThemes.map((theme) => theme.id), [added[2].id]);
  const fifth = await answer(await themesRoute.POST(sending('/api/themes', 'POST', { name: 'In place of 3' })));
  assert.equal(fifth.status, 201);
  assert.equal(fifth.body.theme.colour, 2);
  assert.equal(await plan.updateThemeFor(OWNER, added[2].id, { name: 'Archived' }), null);
});

test('theme addresses: refusals name the field, and another owner\'s theme is not found', async () => {
  const themes = await plan.listThemesFor(OWNER);
  const mine = themes[0];
  const post = async (body) => answer(await themesRoute.POST(sending('/api/themes', 'POST', body)));
  assert.deepEqual((await post({})).body, { problem: 'refuse.text.missing', field: 'name' });
  assert.deepEqual((await post({ name: '   ' })).body, { problem: 'refuse.text.missing', field: 'name' });
  assert.deepEqual((await post({ name: 'n'.repeat(LIMITS.name + 1) })).body, { problem: 'refuse.text.long', field: 'name' });
  assert.deepEqual((await post({ name: 'x', colour: 1 })).body, { problem: 'refuse.request' });

  const patch = async (id, body) => answer(await themeRoute.PATCH(sending(`/api/themes/${id}`, 'PATCH', body), at(id)));
  assert.equal((await patch(mine.id, { name: 'n'.repeat(LIMITS.name) })).status, 200);
  assert.deepEqual((await patch(mine.id, { about: 'a'.repeat(LIMITS.themeAbout + 1) })).body, { problem: 'refuse.text.long', field: 'about' });
  assert.equal((await patch(mine.id, { about: 'a'.repeat(LIMITS.themeAbout) })).body.theme.about.length, LIMITS.themeAbout);
  assert.deepEqual((await patch(mine.id, { hashtags: '#a '.repeat(2000) })).body, { problem: 'refuse.text.long', field: 'hashtags' });
  for (const colour of [-1, 5, 1.5, '2']) assert.deepEqual((await patch(mine.id, { colour })).body, { problem: 'refuse.request', field: 'colour' });
  assert.equal((await patch(mine.id, { colour: 4 })).body.theme.colour, 4);
  assert.equal((await patch(mine.id, { colour: 0 })).body.theme.colour, 0);
  assert.deepEqual((await patch(mine.id, {})).body, { problem: 'refuse.request' });
  for (const id of ['abc', '0', '-1', '1.5']) assert.equal((await themeRoute.PATCH(sending('/api/themes/x', 'PATCH', { name: 'x' }), at(id))).status, 404);

  const theirs = await plan.addThemeFor(OTHER, { name: 'Their theme' });
  assert.deepEqual(await patch(theirs.id, { name: 'Taken' }), { status: 404, body: { problem: 'error.notFound' } });
  const moveTheirs = await themeRoute.POST(sending(`/api/themes/${theirs.id}`, 'POST', { action: 'move', direction: 'up' }), at(theirs.id));
  assert.equal(moveTheirs.status, 404);
  assert.equal((await themeRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(theirs.id))).status, 404);
  const still = await plan.listThemesFor(OTHER);
  assert.deepEqual(still.map((theme) => [theme.id, theme.name]), [[theirs.id, 'Their theme']]);
});

test('themes move one place, numbered again from 0, and a move past either end changes nothing', async () => {
  const before = await plan.listThemesFor(OWNER);
  const move = async (id, body) => answer(await themeRoute.POST(sending(`/api/themes/${id}`, 'POST', body), at(id)));
  assert.deepEqual((await move(before[0].id, { action: 'move', direction: 'sideways' })).body, { problem: 'refuse.request' });
  assert.deepEqual((await move(before[0].id, { action: 'jump', direction: 'up' })).body, { problem: 'refuse.request' });

  const down = await move(before[0].id, { action: 'move', direction: 'down' });
  assert.deepEqual(down.body.themes.map((theme) => theme.id), [before[1].id, before[0].id, ...before.slice(2).map((theme) => theme.id)]);
  assert.deepEqual(down.body.themes.map((theme) => theme.position), before.map((_, index) => index));
  const stored = await plan.listThemesFor(OWNER);
  assert.deepEqual(stored.map((theme) => theme.id), down.body.themes.map((theme) => theme.id));

  const top = (await move(stored[0].id, { action: 'move', direction: 'up' })).body.themes;
  assert.deepEqual(top.map((theme) => theme.id), stored.map((theme) => theme.id));
  const last = stored.at(-1);
  const bottom = (await move(last.id, { action: 'move', direction: 'down' })).body.themes;
  assert.deepEqual(bottom.map((theme) => theme.id), stored.map((theme) => theme.id));
  const up = (await move(last.id, { action: 'move', direction: 'up' })).body.themes;
  assert.equal(up.at(-2).id, last.id);
});

test('own days keep a real date: a yearly day its month and day, a single day its whole date', () => {
  assert.equal(plan.ownDayDate('2026-02-14', true), '02-14');
  assert.equal(plan.ownDayDate('02-29', true), '02-29');
  assert.equal(plan.ownDayDate('02-30', true), null);
  assert.equal(plan.ownDayDate('02-14', false), null);
  assert.equal(plan.ownDayDate('2027-02-29', false), null);
  assert.equal(plan.ownDayDate('2028-02-29', false), '2028-02-29');
  assert.equal(plan.ownDayDate('13-01', true), null);
  assert.equal(plan.ownDayDate('00-10', true), null);
  assert.equal(plan.ownDayDate('1999-12-31', false), null);
  assert.equal(plan.ownDayDate('2000-01-01', false), '2000-01-01');
  assert.equal(plan.ownDayDate('2199-12-31', false), '2199-12-31');
  assert.equal(plan.ownDayDate('2200-01-01', false), null);
  assert.equal(plan.ownDayDate(20260214, false), null);
});

test('own day addresses: add, list by month and day, change, remove, and another owner\'s day is not found', async () => {
  const post = async (body) => answer(await daysRoute.POST(sending('/api/special-days', 'POST', body)));
  const shopDay = await post({ name: 'Shop birthday', date: '2026-06-01', yearly: true });
  assert.equal(shopDay.status, 201);
  assert.equal(shopDay.body.day.date, '06-01');
  assert.equal(shopDay.body.day.yearly, true);
  const fair = await post({ name: 'Craft fair', date: '2026-03-07', yearly: false, note: 'Stand 12' });
  assert.equal(fair.body.day.date, '2026-03-07');
  const plain = await post({ name: 'Studio day', date: '01-15' });
  assert.equal(plain.body.day.yearly, true, 'a new day is yearly when not said');
  assert.deepEqual((await post({ name: 'x', date: '2026-02-30', yearly: false })).body, { problem: 'refuse.plan.date', field: 'date' });
  assert.deepEqual((await post({ name: 'x', date: '05-01', yearly: false })).body, { problem: 'refuse.plan.date', field: 'date' });
  assert.deepEqual((await post({ name: 'x' })).body, { problem: 'refuse.plan.date', field: 'date' });
  assert.deepEqual((await post({ date: '2026-05-01' })).body, { problem: 'refuse.text.missing', field: 'name' });
  assert.deepEqual((await post({ name: 'x', date: '05-01', yearly: 'yes' })).body, { problem: 'refuse.request', field: 'yearly' });
  assert.deepEqual((await post({ name: 'x', date: '05-01', when: 'now' })).body, { problem: 'refuse.request' });

  const listed = await answer(await daysRoute.GET());
  assert.deepEqual(listed.body.ownDays.map((day) => day.name), ['Studio day', 'Craft fair', 'Shop birthday']);

  const patch = async (id, body) => answer(await dayRoute.PATCH(sending(`/api/special-days/${id}`, 'PATCH', body), at(id)));
  const id = shopDay.body.day.id;
  assert.deepEqual((await patch(id, { yearly: false })).body, { problem: 'refuse.plan.date', field: 'date' });
  const once = await patch(id, { yearly: false, date: '2027-06-01' });
  assert.deepEqual([once.body.day.date, once.body.day.yearly], ['2027-06-01', false]);
  const yearlyAgain = await patch(id, { yearly: true });
  assert.deepEqual([yearlyAgain.body.day.date, yearlyAgain.body.day.yearly], ['06-01', true]);
  assert.equal((await patch(id, { name: 'Our birthday' })).body.day.name, 'Our birthday');

  const theirs = await plan.addOwnDayFor(OTHER, { name: 'Their day', date: '04-04', yearly: true });
  assert.deepEqual(await patch(theirs.id, { name: 'Taken' }), { status: 404, body: { problem: 'error.notFound' } });
  assert.equal((await dayRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(theirs.id))).status, 404);
  assert.deepEqual((await plan.listOwnDaysFor(OTHER)).map((day) => day.name), ['Their day']);

  assert.deepEqual(await answer(await dayRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(fair.body.day.id))), { status: 200, body: { ok: true } });
  assert.equal((await dayRoute.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), at(fair.body.day.id))).status, 404);
});

test('own days stop at the most one person keeps', async () => {
  const have = await modelAction('SpecialDay', 'count', { where: { ownerId: OWNER } });
  const fill = plan.MAX_OWN_DAYS - 1 - have;
  for (let start = 0; start < fill; start += 32) {
    const steps = [];
    for (let index = start; index < Math.min(fill, start + 32); index += 1) {
      steps.push({ model: 'SpecialDay', action: 'create', args: { data: { ownerId: OWNER, name: `Day ${index}`, date: '07-07', yearly: true, note: '', createdAt: NOW } } });
    }
    await modelBatch(steps);
  }
  assert.equal(await modelAction('SpecialDay', 'count', { where: { ownerId: OWNER } }), plan.MAX_OWN_DAYS - 1);
  assert.equal((await plan.addOwnDayFor(OWNER, { name: 'The last one', date: '08-08', yearly: true })).name, 'The last one');
  const over = await answer(await daysRoute.POST(sending('/api/special-days', 'POST', { name: 'One more', date: '09-09' })));
  assert.deepEqual(over, { status: 400, body: { problem: 'refuse.plan.daysLimit' } });
  assert.equal((await plan.listOwnDaysFor(OWNER)).length, plan.MAX_OWN_DAYS);
  // Another owner's days do not count toward this owner's.
  assert.equal((await plan.addOwnDayFor(OTHER, { name: 'Theirs too', date: '09-09', yearly: true })).name, 'Theirs too');
});

/* ---------------------------------------------------------- Tellop's bounds */

/**
 * Inside Tellop every records call goes through its records route: at most
 * 256 rows a statement, 256 KiB a call (a `modelBatch` counted whole), 2,048
 * values in a statement's answer (a list counts one, a row its fields and two
 * more), 256 values in a list it is sent, 32 steps a batch and 16 calls a
 * request. The local store has none of these, so here the route's hook runs
 * each call on the local store and measures it.
 */
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

/** The longest words a field takes, in two-byte letters. */
const longest = (count) => 'ş'.repeat(count);

test('the largest lists with the longest words stay within Tellop\'s bounds: each read, the addresses and the page', async () => {
  // Every field of the profile at its longest.
  const field = longest(LIMITS.profileField);
  await plan.saveProfileFor(OWNER, { businessName: field, offer: field, audience: field, goal: field, voice: field, pictureStyle: longest(LIMITS.pictureStyle), profileLink: field, reviewLink: field });
  // More themes than one read answers, archived ones beside those in use, on few positions (pages end inside one).
  const have = await modelAction('Theme', 'count', { where: { ownerId: OWNER } });
  await modelAction('Theme', 'createMany', {
    data: Array.from({ length: plan.MOST_THEMES + 4 - have }, (_, index) => ({
      ownerId: OWNER, name: 'x', colour: index % 5, position: index % 7, archived: true, createdAt: NOW, updatedAt: NOW,
    })),
  });
  await modelAction('Theme', 'updateMany', {
    where: { ownerId: OWNER }, data: { name: longest(LIMITS.name), about: longest(LIMITS.themeAbout), hashtags: longest(plan.THEME_HASHTAGS_MAX) },
  });
  // A theme in use placed after every archived one: the most themes a read answers still holds every theme in use.
  const lastInUse = (await plan.listThemesFor(OWNER)).at(-1);
  await modelAction('Theme', 'updateMany', { where: { ownerId: OWNER, id: lastInUse.id }, data: { position: 9 } });
  // The most own days (the check before filled them), each with the longest words.
  assert.equal(await modelAction('SpecialDay', 'count', { where: { ownerId: OWNER } }), plan.MAX_OWN_DAYS);
  await modelAction('SpecialDay', 'updateMany', { where: { ownerId: OWNER }, data: { name: longest(LIMITS.name), note: longest(LIMITS.notes) } });

  /** The ids a themes read should answer: by position, then id (with `inUseFirst`, the themes in use first). */
  const expected = async (where, inUseFirst = false) => (await modelAction('Theme', 'findMany', {
    where, orderBy: [...(inUseFirst ? [{ archived: 'asc' }] : []), { position: 'asc' }, { id: 'asc' }], select: { id: true }, take: plan.MOST_THEMES,
  })).map((row) => row.id);

  const whole = await measured(() => plan.planFor(OWNER));
  bounded(whole, 'the plan', 4);
  assert.equal(mostInFlight(whole), 1, 'one call after the other, so a page can run it beside another read');
  const all = await expected({ ownerId: OWNER }, true);
  assert.equal(all.length, plan.MOST_THEMES);
  assert.deepEqual([...whole.value.themes, ...whole.value.archivedThemes].map((theme) => theme.id), all);
  assert.equal(whole.value.themes.length, LIMITS.themes);
  assert.equal(whole.value.themes.at(-1).id, lastInUse.id);
  assert.equal(whole.value.archivedThemes[0].hashtags, longest(plan.THEME_HASHTAGS_MAX));

  const archived = await measured(() => plan.listThemesFor(OWNER, { archived: true }));
  bounded(archived, 'the archived themes', 3);
  assert.deepEqual(archived.value.map((theme) => theme.id), await expected({ ownerId: OWNER, archived: true }));

  const days = await measured(() => plan.listOwnDaysFor(OWNER));
  bounded(days, 'the own days', 1);
  assert.equal(days.value.length, plan.MAX_OWN_DAYS);
  assert.equal(days.value[0].note, longest(LIMITS.notes));

  // Changes that read the themes first.
  const live = whole.value.themes;
  const moved = await measured(() => plan.moveThemeFor(OWNER, live[1].id, 'up'));
  bounded(moved, 'a theme moved', 2);
  assert.equal(moved.value[0].id, live[1].id);
  const refused = await measured(() => assert.rejects(plan.addThemeFor(OWNER, { name: 'One more' }), (error) => error instanceof DataError));
  bounded(refused, 'a theme past the most', 1);

  // The addresses.
  const planAddress = await measured(async () => (await planRoute.GET()).json());
  bounded(planAddress, 'GET /api/plan', 5);
  assert.ok(mostInFlight(planAddress) <= 2);
  assert.equal(planAddress.value.themes.length, LIMITS.themes);
  assert.equal(planAddress.value.ownDays.length, plan.MAX_OWN_DAYS);
  const themesAddress = await measured(async () => (await themesRoute.GET(new Request('http://localhost/api/themes?archived=1'))).json());
  bounded(themesAddress, 'GET /api/themes?archived=1', 3);
  assert.deepEqual(themesAddress.value.themes.map((theme) => theme.id), archived.value.map((theme) => theme.id));
  const daysAddress = await measured(async () => (await daysRoute.GET()).json());
  bounded(daysAddress, 'GET /api/special-days', 1);
  assert.equal(daysAddress.value.ownDays.length, plan.MAX_OWN_DAYS);

  // My plan's page reads what `app/plan/page.jsx` reads, at the same moment.
  const page = await measured(() => Promise.all([plan.planFor(OWNER), plan.listOwnDaysFor(OWNER)]));
  bounded(page, 'My plan\'s page', 5);
  assert.equal(page.value[1].length, plan.MAX_OWN_DAYS);
});

test('a theme with posts is archived only while fewer than 91 archived themes are kept (96 in all with five in use)', async () => {
  const owner = 'archive-owner';
  const at = new Date().toISOString();
  assert.equal(plan.MOST_ARCHIVED_THEMES, plan.MOST_THEMES - LIMITS.themes);
  const archiveOne = async () => {
    const theme = await plan.addThemeFor(owner, { name: 'Used' });
    await modelAction('Post', 'create', { data: { ownerId: owner, name: 'Uses it', themeId: theme.id, createdAt: at, updatedAt: at } });
    return theme;
  };
  await modelAction('Theme', 'createMany', {
    data: Array.from({ length: plan.MOST_ARCHIVED_THEMES - 1 }, (_, index) => ({ ownerId: owner, name: `Old ${index}`, colour: 0, position: index, archived: true, createdAt: at, updatedAt: at })),
  });
  // One under the most: archived.
  const last = await archiveOne();
  const run = await measured(() => plan.removeThemeFor(owner, last.id));
  assert.equal(run.value, 'archived');
  bounded(run, 'a theme archived', 2);
  // At the most: refused, and the theme stays in use.
  const over = await archiveOne();
  await assert.rejects(plan.removeThemeFor(owner, over.id), (error) => error instanceof DataError && error.messageKey === 'refuse.plan.oldThemesFull');
  assert.ok((await plan.listThemesFor(owner)).some((theme) => theme.id === over.id), 'still in use');
  // A theme no post uses is still deleted, and an archived one stays archived.
  const unused = await plan.addThemeFor(owner, { name: 'Unused' });
  assert.equal(await plan.removeThemeFor(owner, unused.id), 'deleted');
  assert.equal(await plan.removeThemeFor(owner, last.id), 'archived');
  // Every theme still reads: the old posts keep their colour.
  const whole = await plan.planFor(owner);
  assert.equal(whole.themes.length + whole.archivedThemes.length, plan.MOST_THEMES - LIMITS.themes + 1);
});
