/**
 * Wave 1 of the growth review on the calendar, Results and Customers pages
 *: a scheduled post's mark, words and place on the
 * Share today card and the week's goal; Add to my calendar's span and when it
 * rests; the follow-ups on the Today card (WhatsApp's address, the line, Done
 * and Tomorrow); Results' changes, columns, followers; and the customers'
 * spreadsheet's follow-up and code columns. Pure rules are called directly;
 * the records run against a throwaway store (`APP_DATA_FILE` in a temporary
 * folder, removed afterwards). Nothing reaches the network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'wave1-pages-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { getLocale, t } = await import('../lib/i18n/index.js');
const { addDays } = await import('../lib/plan/days.js');
const { postState } = await import('../lib/plan/state.js');
const customers = await import('../lib/data/customers.js');
const rules = await import('../app/calendar/rules.js');
const followUps = await import('../app/calendar/follow-ups.js');
const rows = await import('../app/results/rows.js');
const { readCalendar } = await import('../app/calendar/read.js');
const enquiryRoute = await import('../app/api/enquiries/[id]/route.js');
const enquiriesExport = await import('../app/api/export/enquiries/route.js');
const calendarExport = await import('../app/api/export/calendar/route.js');
const downloadsRoute = await import('../app/api/downloads/route.js');
const { unzipStored } = await import('../lib/plan/zip.js');
const { measured, bounded } = await import('./records-bounds.mjs');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'someone-else';
const STAMP = '2026-10-21T09:00:00.000Z';
const jsonRequest = (method, body, address = 'http://app.test/api') =>
  new Request(address, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id: String(id) }) });
/** The app's words, by language (the locale files). */
const fragment = Object.fromEntries(['en', 'tr'].map((language) => [language, JSON.parse(readFileSync(path.join(projectRoot, 'lib/i18n/locales', `${language}.json`), 'utf8'))]));

/** @param {number} id @param {string | null} day @param {string} state @param {Record<string, unknown>} [more] */
const tile = (id, day, state, more = {}) => ({ id, day, time: null, state, ...more });

/* ------------------------------------------------------------ scheduled on the calendar */

test('a post scheduled on every network is not due on the Share today card; one partly scheduled still is', () => {
  const today = '2026-10-21';
  assert.equal(rules.dueOf([tile(1, today, 'scheduled')], today), null);
  assert.equal(rules.dueOf([tile(1, addDays(today, -13), 'scheduled')], today), null, 'an earlier scheduled day is not due either');
  assert.equal(rules.dueOf([tile(1, today, 'partly', { shared: 0, scheduled: 1, of: 2 })], today)?.id, 1, 'one network still to share');
  // The scheduled post gives the card to the next one due, never to itself.
  assert.equal(rules.dueOf([tile(1, today, 'scheduled'), tile(2, addDays(today, -1), 'ready')], today)?.id, 2);
});

test('the week\'s goal counts a scheduled post as shared, on the week\'s first and last day, and not one day outside', () => {
  const today = '2026-10-21';
  // Monday-first: 19 to 25 October.
  const list = [tile(1, '2026-10-19', 'scheduled'), tile(2, '2026-10-25', 'scheduled'), tile(3, '2026-10-18', 'scheduled'), tile(4, '2026-10-26', 'scheduled'),
    tile(5, '2026-10-21', 'ready'), tile(6, null, 'scheduled')];
  assert.deepEqual(rules.weekGoal(list, today, true, 3), { goal: 3, shared: 2, filled: 2 });
  assert.deepEqual(rules.weekGoal([...list, tile(7, '2026-10-22', 'shared'), tile(8, '2026-10-23', 'partly')], today, true, 3), { goal: 3, shared: 4, filled: 3 });
  assert.deepEqual([...rules.GOAL_STATES].sort(), ['partly', 'scheduled', 'shared']);
});

test('a tile\'s state reads "1 of 3 shared, 1 scheduled" while one network is still ahead, and as before otherwise', () => {
  const now = '2026-10-21T09:00:00.000Z';
  const networks = ['instagram', 'facebook', 'linkedin'];
  const version = (network, sharedAt) => ({ network, on: true, text: 'Words', sharedAt });
  // One shared, one scheduled for later, one not yet: partly, with one scheduled.
  const partly = postState({ networks, versions: [version('instagram', '2026-10-20T10:00:00.000Z'), version('facebook', '2026-10-22T10:00:00.000Z'), version('linkedin', null)], hasChosenPicture: true, now });
  assert.equal(partly.state, 'partly');
  assert.deepEqual(rules.stateWordsOf(partly), { key: 'state.partlyScheduled', values: { shared: '1', scheduled: '1', of: '3' }, mark: 'partly' });
  // None shared yet, one scheduled.
  const ahead = postState({ networks, versions: [version('facebook', '2026-10-22T10:00:00.000Z'), version('instagram', null), version('linkedin', null)], hasChosenPicture: true, now });
  assert.deepEqual(rules.stateWordsOf(ahead), { key: 'state.someScheduled', values: { shared: '0', scheduled: '1', of: '3' }, mark: 'scheduled' });
  // Shared on some, none scheduled: the words as before.
  const some = postState({ networks, versions: [version('instagram', '2026-10-20T10:00:00.000Z'), version('facebook', null), version('linkedin', null)], hasChosenPicture: true, now });
  assert.equal(rules.stateWordsOf(some).key, 'state.partly');
  // Every network shared or scheduled: Scheduled; the moment it passes: Shared.
  const all = postState({ networks, versions: networks.map((network) => version(network, '2026-10-21T09:00:01.000Z')), hasChosenPicture: true, now });
  assert.equal(rules.stateWordsOf(all).key, 'state.scheduled');
  const passed = postState({ networks, versions: networks.map((network) => version(network, '2026-10-21T09:00:00.000Z')), hasChosenPicture: true, now });
  assert.equal(rules.stateWordsOf(passed).key, 'state.shared');
  // A tile with no counts reads zeros, never "undefined".
  assert.deepEqual(rules.stateWordsOf({ state: 'ready' }), { key: 'state.ready', values: { shared: '0', scheduled: '0', of: '0' }, mark: 'ready' });
  // Both new lines carry every value they name, in both languages.
  for (const language of ['en', 'tr']) {
    for (const key of ['state.partlyScheduled', 'state.someScheduled']) {
      const names = [...fragment[language][key].matchAll(/\{(\w+)\}/gu)].map((match) => match[1]);
      assert.ok(names.length >= 2 && names.every((name) => name in rules.stateWordsOf(partly).values), `${language} ${key}`);
    }
  }
});

/* ------------------------------------------------------------ Add to my calendar */

test('Add to my calendar asks for the month shown, or the week shown across two months', () => {
  const month = rules.viewOf({ month: '2026-10' }, '2026-10-21', false);
  assert.deepEqual(rules.calendarFileSpan(month), { body: { month: '2026-10' }, label: '2026-10' });
  const week = rules.viewOf({ view: 'week', day: '2026-11-01' }, '2026-10-21', true);
  assert.deepEqual(rules.calendarFileSpan(week), { body: { from: '2026-10-26', to: '2026-11-01' }, label: '2026-10-26' });
});

test('Add to my calendar rests exactly when the app would refuse the file: no post on the month\'s own days', async () => {
  const today = '2026-10-21';
  const view = rules.viewOf({ month: '2027-03' }, today, false);
  // March 2027 starts on a Monday: the Sunday-first grid starts on 28 February, a muted day.
  assert.equal(view.from, '2027-02-28');
  const ask = async () => {
    const answer = await calendarExport.POST(jsonRequest('POST', rules.calendarFileSpan(view).body));
    return { status: answer.status, body: await answer.json() };
  };
  // Nothing: rests, and the app refuses.
  assert.equal(rules.calendarFileRest(view, []), 'calendar.export.noneMonth');
  assert.deepEqual((await ask()).body, { problem: 'calendar.export.empty' });
  // A post on the muted day before the month: still rests, still refused.
  const post = async (day) => modelAction('Post', 'create', { data: { ownerId: OWNER, name: `Post on ${day}`, day, createdAt: STAMP, updatedAt: STAMP } });
  await post('2027-02-28');
  await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Not yours', day: '2027-03-10', createdAt: STAMP, updatedAt: STAMP } });
  assert.equal(rules.calendarFileRest(view, [tile(1, '2027-02-28', 'idea')]), 'calendar.export.noneMonth');
  assert.deepEqual((await ask()).body, { problem: 'calendar.export.empty' }, 'another owner\'s post does not count');
  // A post on the month's last day: it acts, and the app answers a download.
  await post('2027-03-31');
  assert.equal(rules.calendarFileRest(view, [tile(1, '2027-02-28', 'idea'), tile(2, '2027-03-31', 'idea')]), null);
  const made = await ask();
  assert.equal(made.status, 200);
  assert.match(made.body.address, /^\/api\/downloads\?file=[0-9a-f]{64}$/u);
  // A week rests on its own words while it holds no post.
  const week = rules.viewOf({ view: 'week', day: '2027-03-31' }, today, true);
  assert.equal(rules.calendarFileRest(week, []), 'calendar.export.noneWeek');
  assert.equal(rules.calendarFileRest(week, [tile(2, '2027-03-31', 'ready')]), null);
});

/* ------------------------------------------------------------ follow-ups */

test('WhatsApp opens only for a phone number the app can be sure of', () => {
  const digits = followUps.whatsAppDigits;
  assert.equal(digits('+90 532 123 45 67', 'en'), '905321234567');
  assert.equal(digits('0090 (532) 123-45-67', 'en'), '905321234567');
  assert.equal(digits('+44 7700 900123', 'tr'), '447700900123');
  // A Turkish mobile written the national way: Turkey's code in Turkish only.
  assert.equal(digits('0532 123 45 67', 'tr'), '905321234567');
  assert.equal(digits('532 123 45 67', 'tr'), '905321234567');
  assert.equal(digits('0532 123 45 67', 'en'), null);
  assert.equal(digits('0212 123 45 67', 'tr'), null, 'a landline written the national way is not sure');
  assert.equal(digits('0532 123 45 6', 'tr'), null, 'one digit short');
  // Eight digits at the fewest and fifteen at the most, with one each side.
  assert.equal(digits('+1234567', 'en'), null);
  assert.equal(digits('+12345678', 'en'), '12345678');
  assert.equal(digits('+123456789012345', 'en'), '123456789012345');
  assert.equal(digits('+1234567890123456', 'en'), null);
  // A country code never starts with 0; other contacts are not numbers.
  for (const contact of ['+0532 123 45 67', '000532123456', 'ayse@example.com', '@ayse.k', '+90 532 abc', '', '   ', '+', null, 5321234567]) {
    assert.equal(digits(contact, 'tr'), null, String(contact));
  }
  assert.equal(followUps.whatsAppAddress('905321234567', 'Hi & bye?\nAyşe'), 'https://wa.me/905321234567?text=Hi%20%26%20bye%3F%0AAy%C5%9Fe');
});

test('the follow-up line greets by name, names what they asked when noted, and ends with the business name when there is one', () => {
  const locale = 'en';
  const asked = followUps.followUpMessage({ name: ' Ayşe ', askedAbout: ' the Saturday class ' }, ' Blue Clay ', locale);
  assert.equal(asked, t('calendar.followUp.message', locale, { name: 'Ayşe', asked: 'the Saturday class', business: 'Blue Clay' }).trim());
  const plain = followUps.followUpMessage({ name: 'Ayşe', askedAbout: '   ' }, '', locale);
  assert.equal(plain, t('calendar.followUp.messagePlain', locale, { name: 'Ayşe', asked: '', business: '' }).trim());
  assert.notEqual(asked, plain);
  // The lines name the person and, when noted, what they asked; the business goes on its own last line.
  for (const language of ['en', 'tr']) {
    const fill = (key, values) => fragment[language][key].replace(/\{(\w+)\}/gu, (_, name) => values[name] ?? `{${name}}`).trim();
    const full = fill('calendar.followUp.message', { name: 'Ayşe', asked: 'kupalar', business: 'Mavi Kil' });
    assert.ok(full.includes('Ayşe') && full.includes('kupalar') && full.endsWith('\nMavi Kil'), `${language}: ${full}`);
    const none = fill('calendar.followUp.messagePlain', { name: 'Ayşe', business: '' });
    assert.ok(none.includes('Ayşe') && !none.includes('{') && !none.endsWith('\n'), `${language}: ${none}`);
  }
});

test('Done clears the follow-up day and Tomorrow moves it to the day after today, across a month and a year', () => {
  assert.deepEqual(followUps.followUpChange('done', '2026-10-21'), { followUpOn: null });
  assert.deepEqual(followUps.followUpChange('tomorrow', '2026-10-21'), { followUpOn: '2026-10-22' });
  assert.deepEqual(followUps.followUpChange('tomorrow', '2026-10-31'), { followUpOn: '2026-11-01' });
  assert.deepEqual(followUps.followUpChange('tomorrow', '2026-12-31'), { followUpOn: '2027-01-01' });
});

test('a follow-up is due today or earlier, for a person still new or talking', () => {
  const today = '2026-10-21';
  const due = (followUpOn, status = 'talking') => followUps.isFollowUpDue({ followUpOn, status }, today);
  assert.equal(due('2026-10-20'), true);
  assert.equal(due('2026-10-21'), true);
  assert.equal(due('2026-10-22'), false);
  assert.equal(due('2026-10-21', 'new'), true);
  assert.equal(due('2026-10-21', 'bought'), false);
  assert.equal(due('2026-10-21', 'not-now'), false);
  assert.equal(due(null), false);
  assert.equal(due(''), false);
});

test('the Today card lists the owner\'s follow-ups due; Done and Tomorrow take one off, each in two records calls', async () => {
  const today = '2026-10-21';
  const add = (owner, fields) => customers.addEnquiryFor(owner, { receivedOn: '2026-10-01', ...fields }, { today });
  const late = await add(OWNER, { name: 'Late', status: 'talking', followUpOn: '2026-10-20', contact: '+90 532 000 00 00' });
  const due = await add(OWNER, { name: 'Due', status: 'new', followUpOn: today, askedAbout: 'mugs' });
  await add(OWNER, { name: 'Tomorrow already', status: 'new', followUpOn: '2026-10-22' });
  await add(OWNER, { name: 'Bought', status: 'bought', followUpOn: '2026-10-20' });
  await add(OWNER, { name: 'No day', status: 'new' });
  await add(OTHER, { name: 'Not yours', status: 'new', followUpOn: '2026-10-20' });

  const read = async (day = today, query = {}) => (await readCalendar({ owner: OWNER, query, today: day, locale: 'en' })).followUps;
  assert.deepEqual((await read()).map((row) => row.name), ['Late', 'Due'], 'the oldest day first, the owner\'s only');
  // A view that does not show today reads none.
  assert.equal(await read(today, { month: '2026-12' }), null);

  const press = async (id, which) => {
    const run = await measured(() => enquiryRoute.PATCH(jsonRequest('PATCH', followUps.followUpChange(which, today)), context(id)));
    bounded(run, `the follow-up's ${which}`, 2);
    assert.equal(run.value.status, 200);
    return (await run.value.json()).enquiry;
  };
  assert.equal((await press(late.id, 'tomorrow')).followUpOn, '2026-10-22');
  assert.equal((await press(due.id, 'done')).followUpOn, null);
  assert.deepEqual(await read(), []);
  // Tomorrow, the moved one is due again, beside the one already set for that day.
  assert.deepEqual((await read('2026-10-22')).map((row) => row.name), ['Late', 'Tomorrow already']);
  // Another owner's enquiry is not found, and its day stays.
  const theirs = (await customers.listFollowUpsDueFor(OTHER, today))[0];
  const refused = await enquiryRoute.PATCH(jsonRequest('PATCH', followUps.followUpChange('done', today)), context(theirs.id));
  assert.equal(refused.status, 404);
  assert.equal((await customers.listFollowUpsDueFor(OTHER, today)).length, 1);
});

test('the customers\' spreadsheet ends each row with the follow-up day and the code', async () => {
  const locale = getLocale();
  await customers.addEnquiryFor(OWNER, { name: 'With both', receivedOn: '2031-05-02', followUpOn: '2031-05-09', code: 'BAHAR10' });
  await customers.addEnquiryFor(OWNER, { name: 'With neither', receivedOn: '2031-05-03' });
  const made = await enquiriesExport.POST(jsonRequest('POST', { from: '2031-05-01', to: '2031-05-31' }));
  assert.equal(made.status, 200);
  const { address } = await made.json();
  const handed = await downloadsRoute.GET(new Request(`http://app.test${address}`));
  const [file] = unzipStored(new Uint8Array(await handed.arrayBuffer()));
  const lines = new TextDecoder().decode(file.bytes).replace(/^﻿/u, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 3);
  const headings = lines[0].split(',');
  assert.deepEqual(headings.slice(-2), [t('export.enquiries.followUpOn', locale), t('export.enquiries.code', locale)]);
  assert.equal(headings[0], t('export.enquiries.day', locale), 'the first columns stay where they were');
  assert.ok(lines[1].startsWith('2031-05-02,With both,') && lines[1].endsWith(',2031-05-09,BAHAR10'), lines[1]);
  assert.ok(lines[2].startsWith('2031-05-03,With neither,') && lines[2].endsWith(',,'), lines[2]);
  assert.equal(lines[1].split(',').length, headings.length);
});

/* ------------------------------------------------------------ Results */

test('a change from last month reads "+3" or "−1", and nothing when there is none', () => {
  assert.equal(rows.changeOf(5, 2), 3);
  assert.equal(rows.changeOf(1, 2), -1);
  assert.equal(rows.changeOf(2, 2), null);
  assert.equal(rows.changeOf(2, null), null);
  assert.equal(rows.changeOf(null, 2), null);
  assert.equal(rows.changeText(3, String), '+3');
  assert.equal(rows.changeText(-1, String), '−1');
  assert.equal(rows.changeText(-1200, (value) => rows.wholeMoney(value, 'tr')), '−₺1.200');
});

test('sales show whole, in either language', () => {
  assert.equal(rows.wholeMoney(1200, 'tr'), '₺1.200');
  assert.equal(rows.wholeMoney(1000, 'tr'), '₺1.000');
  assert.equal(rows.wholeMoney(0, 'tr'), '₺0');
  // English writes the currency's code with a space that does not break.
  assert.equal(rows.wholeMoney(1000000, 'en'), 'TRY\u00a01,000,000');
  assert.equal(rows.wholeMoney(1200.4, 'en'), 'TRY\u00a01,200');
});

test('the followers on the counts line add up this month\'s numbers; the change counts only platforms typed in both months', () => {
  assert.deepEqual(rows.followersTotal([]), { value: null, change: null });
  assert.deepEqual(rows.followersTotal([{ count: null, last: 400 }]), { value: null, change: null });
  assert.deepEqual(rows.followersTotal([{ count: 0, last: null }]), { value: 0, change: null }, 'a typed 0 is a number');
  assert.deepEqual(rows.followersTotal([{ count: 520, last: 500 }, { count: 90, last: null }]), { value: 610, change: 20 });
  assert.deepEqual(rows.followersTotal([{ count: 500, last: 520 }, { count: 30, last: 10 }]), { value: 530, change: null }, 'no change overall');
});

test('the lists show this month: a row with only last month\'s numbers is left out; Reactions and By ask show only when they say something', () => {
  const pair = (value, last = 0) => ({ value, last });
  const row = (shares, customers, sales) => ({ shares: pair(shares, 4), customers: pair(customers, 2), sales: pair(sales, 100) });
  const kept = rows.rowsThisMonth([row(1, 0, 0), row(0, 1, 0), row(0, 0, 1), row(0, 0, 0)]);
  assert.equal(kept.length, 3);
  // A channel row has no shares.
  assert.equal(rows.rowsThisMonth([{ customers: pair(1), sales: pair(0) }, { customers: pair(0, 3), sales: pair(0) }]).length, 1);
  assert.equal(rows.showsReactions({ typed: pair(0, 9) }), false);
  assert.equal(rows.showsReactions({ typed: pair(1) }), true);
  assert.equal(rows.showsByAsk([{ ask: '' }]), false);
  assert.equal(rows.showsByAsk([{ ask: '' }, { ask: 'book' }]), true);
  assert.equal(rows.hasFigures({ shares: pair(0), customers: pair(0), sales: pair(0) }), false);
  assert.equal(rows.hasFigures({ shares: pair(0), customers: pair(1), sales: pair(0) }), true, 'a customer with no post shared still has figures');
});

test('a followers field for each switched-on platform, in My plan\'s order, with this month\'s and last month\'s numbers', () => {
  const typed = [{ network: 'facebook', count: 120, last: 100 }, { network: 'tiktok', count: 9, last: null }];
  assert.deepEqual(rows.followerFields(typed, ['instagram', 'facebook', 'nowhere', 'instagram']), [
    { network: 'instagram', count: null, last: null },
    { network: 'facebook', count: 120, last: 100 },
  ]);
  assert.deepEqual(rows.followerFields(typed, []), []);
});

test('a followers number is read as people write it, from empty to the most, and one past it is refused', () => {
  assert.deepEqual(rows.readFollowers(''), { ok: true, value: null });
  assert.deepEqual(rows.readFollowers('   '), { ok: true, value: null });
  assert.deepEqual(rows.readFollowers('0'), { ok: true, value: 0 });
  assert.deepEqual(rows.readFollowers('12.400'), { ok: true, value: 12400 });
  assert.deepEqual(rows.readFollowers('12,400'), { ok: true, value: 12400 });
  assert.deepEqual(rows.readFollowers('12 400'), { ok: true, value: 12400 });
  assert.deepEqual(rows.readFollowers('1.000.000.000'), { ok: true, value: rows.FOLLOWERS_MOST });
  assert.deepEqual(rows.readFollowers('999999999'), { ok: true, value: rows.FOLLOWERS_MOST - 1 });
  for (const wrong of ['1000000001', '10000000000', '-5', '1.5K', 'many', '+3']) assert.deepEqual(rows.readFollowers(wrong), { ok: false }, wrong);
});
