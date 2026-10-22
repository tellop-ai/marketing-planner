/**
 * The special days the calendar shows: the built-in days on their dates, the
 * places the person chose, the days they hid, and their own days.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUILT_IN_DAYS,
  BUILT_IN_DAY_KEYS,
  LAST_MOVING_YEAR,
  NO_OFFERS_WORDS,
  SHOW_DAYS,
  builtInDayByKey,
  datesOf,
  isBuiltInDayKey,
  isSpecialDayKey,
  specialDaysIn,
  specialDaysOn,
} from '../lib/plan/special-days.js';
import { addMonths } from '../lib/plan/days.js';

const MOVING = ['ramadanBegins', 'ramadanFeast', 'sacrificeFeast'];

/** Every day of a key in a year, read through the months as the calendar reads them. */
function daysOfKeyInYear(key, year, options) {
  const found = [];
  for (let month = `${year}-01`; month <= `${year}-12`; month = addMonths(month, 1)) {
    for (const item of specialDaysIn(month, options)) if (item.key === key) found.push(item.day);
  }
  return found;
}

const dayOf = (month, key, options) => specialDaysIn(month, options).filter((item) => item.key === key).map((item) => item.day);

test('the built-in days are a frozen list of unique keys, each with its words keys', () => {
  assert.ok(Object.isFrozen(BUILT_IN_DAYS));
  assert.equal(new Set(BUILT_IN_DAY_KEYS).size, BUILT_IN_DAYS.length);
  assert.deepEqual([...SHOW_DAYS], ['tr', 'world', 'both']);
  for (const item of BUILT_IN_DAYS) {
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.rule), item.key);
    assert.match(item.key, /^[a-zA-Z]+$/u, 'a key fits a stored comma list');
    assert.ok(['tr', 'world', 'all'].includes(item.where), item.key);
    assert.ok(['celebration', 'shopping', 'awareness', 'remembrance'].includes(item.kind), item.key);
    assert.equal(item.nameKey, `special.${item.key}.name`);
    assert.equal(item.hintKey, item.kind === 'remembrance' ? NO_OFFERS_WORDS : `special.${item.key}.hint`);
    assert.equal(isBuiltInDayKey(item.key), true);
    assert.equal(builtInDayByKey(item.key), item);
  }
  assert.equal(isBuiltInDayKey('own-1'), false);
  assert.equal(isBuiltInDayKey(undefined), false);
  assert.equal(builtInDayByKey('nothing'), null);
  assert.deepEqual(
    BUILT_IN_DAYS.filter((item) => item.kind === 'remembrance').map((item) => item.key).sort(),
    ['ataturkDay', 'canakkale', 'democracyDay'],
  );
});

test('every built-in day shows in 2026 and 2027, once a year unless it lasts several days', () => {
  for (const year of [2026, 2027]) {
    for (const item of BUILT_IN_DAYS) {
      const days = daysOfKeyInYear(item.key, year);
      if (item.key === 'ramadanFeast') assert.equal(days.length, 3, `${item.key} ${year}`);
      else if (item.key === 'sacrificeFeast') assert.equal(days.length, 4, `${item.key} ${year}`);
      else assert.equal(days.length, 1, `${item.key} ${year}`);
    }
  }
});

test('days set by a weekday fall on their 2026 and 2027 dates', () => {
  assert.deepEqual(dayOf('2026-05', 'mothersDay'), ['2026-05-10']);
  assert.deepEqual(dayOf('2026-06', 'fathersDay'), ['2026-06-21']);
  assert.deepEqual(dayOf('2026-11', 'blackFriday'), ['2026-11-27']);
  assert.deepEqual(dayOf('2026-11', 'smallBusinessSaturday'), ['2026-11-28']);
  assert.deepEqual(dayOf('2026-11', 'cyberMonday'), ['2026-11-30']);
  assert.deepEqual(dayOf('2027-11', 'blackFriday'), ['2027-11-26']);
  assert.deepEqual(dayOf('2027-11', 'cyberMonday'), ['2027-11-29']);
  assert.deepEqual(dayOf('2027-05', 'mothersDay'), ['2027-05-09']);
  assert.deepEqual(dayOf('2027-06', 'fathersDay'), ['2027-06-20']);
});

test('the weekday rules hold at their edges: the first day a weekday, and a move into the next month', () => {
  // 1 May 2022 was a Sunday: the second Sunday is the 8th, not the 15th.
  assert.deepEqual(datesOf('mothersDay', 2022), ['2022-05-08']);
  // 1 May 2021 was a Saturday: the second Sunday is the 9th.
  assert.deepEqual(datesOf('mothersDay', 2021), ['2021-05-09']);
  // Thanksgiving 2025 was 27 November: Cyber Monday is 1 December and shows in December, not November.
  assert.deepEqual(datesOf('blackFriday', 2025), ['2025-11-28']);
  assert.deepEqual(datesOf('cyberMonday', 2025), ['2025-12-01']);
  assert.deepEqual(dayOf('2025-12', 'cyberMonday'), ['2025-12-01']);
  assert.deepEqual(dayOf('2025-11', 'cyberMonday'), []);
  // The earliest fourth Thursday (22 November 2029): Black Friday the 23rd.
  assert.deepEqual(datesOf('blackFriday', 2029), ['2029-11-23']);
  assert.deepEqual(datesOf('cyberMonday', 2029), ['2029-11-26']);
});

test('the moving religious days follow the published dates, a feast on each of its days', () => {
  assert.deepEqual(dayOf('2026-02', 'ramadanBegins'), ['2026-02-19']);
  assert.deepEqual(dayOf('2027-02', 'ramadanBegins'), ['2027-02-08']);
  assert.deepEqual(dayOf('2026-03', 'ramadanFeast'), ['2026-03-20', '2026-03-21', '2026-03-22']);
  assert.deepEqual(dayOf('2027-03', 'ramadanFeast'), ['2027-03-09', '2027-03-10', '2027-03-11']);
  assert.deepEqual(dayOf('2026-05', 'sacrificeFeast'), ['2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30']);
  assert.deepEqual(dayOf('2027-05', 'sacrificeFeast'), ['2027-05-16', '2027-05-17', '2027-05-18', '2027-05-19']);
  // The eve (arife) is not shown.
  assert.deepEqual(specialDaysOn('2026-03-19').map((item) => item.key), []);
  assert.deepEqual(specialDaysOn('2026-05-26').map((item) => item.key), []);
});

test('the moving days stop after the last year this version knows', () => {
  assert.equal(LAST_MOVING_YEAR, 2027);
  for (const key of MOVING) {
    assert.ok(daysOfKeyInYear(key, LAST_MOVING_YEAR).length > 0, `${key} in the last year`);
    assert.deepEqual(daysOfKeyInYear(key, LAST_MOVING_YEAR + 1), [], `${key} the year after`);
    assert.deepEqual(daysOfKeyInYear(key, 2025), [], `${key} before the first year`);
  }
  // The fixed and weekday days still show after it.
  assert.deepEqual(dayOf(`${LAST_MOVING_YEAR + 1}-10`, 'republicDay'), [`${LAST_MOVING_YEAR + 1}-10-29`]);
});

test('a hidden key disappears, from a list, a set or a stored comma list', () => {
  assert.deepEqual(dayOf('2026-10', 'republicDay'), ['2026-10-29']);
  assert.deepEqual(dayOf('2026-10', 'republicDay', { hidden: ['republicDay'] }), []);
  assert.deepEqual(dayOf('2026-10', 'republicDay', { hidden: new Set(['republicDay']) }), []);
  assert.deepEqual(dayOf('2026-10', 'republicDay', { hidden: 'halloween, republicDay' }), []);
  const hiding = specialDaysIn('2026-10', { hidden: ['republicDay'] }).map((item) => item.key);
  assert.deepEqual(hiding, ['coffeeDay', 'foodDay', 'halloween'], 'the other days stay');
  // A hidden feast goes from each of its days.
  assert.deepEqual(dayOf('2026-03', 'ramadanFeast', { hidden: ['ramadanFeast'] }), []);
});

test('the places chosen decide which days show', () => {
  const both = specialDaysIn('2026-04');
  assert.deepEqual(both.map((item) => item.key), ['earthDay', 'childrensDay', 'bookDay']);
  const world = specialDaysIn('2026-04', { showDays: 'world' });
  assert.deepEqual(world.map((item) => item.key), ['earthDay', 'bookDay']);
  const turkey = specialDaysIn('2026-04', { showDays: 'tr' });
  assert.deepEqual(turkey.map((item) => item.key), ['childrensDay']);
  for (let month = '2026-01'; month <= '2026-12'; month = addMonths(month, 1)) {
    assert.ok(specialDaysIn(month, { showDays: 'world' }).every((item) => item.where === 'world' || item.where === 'all'), month);
    assert.ok(specialDaysIn(month, { showDays: 'tr' }).every((item) => item.where === 'tr' || item.where === 'all'), month);
  }
  assert.deepEqual(specialDaysIn('2026-04', { showDays: 'somewhere' }), both, 'an unknown choice shows both');
});

test('the person’s own days: yearly, one day, and a yearly 29 February', () => {
  const own = [
    { id: 7, name: 'Shop birthday', date: '02-29', yearly: true, note: 'Cake' },
    { id: 8, name: 'Market stall', date: '2027-02-14', yearly: false },
    { id: 9, name: 'Summer fair', date: '07-01', yearly: true },
    { id: 10, name: 'Broken', date: '2027-02-30', yearly: false },
    { id: 11, name: 'Broken yearly', date: '02-30', yearly: true },
  ];
  const february2027 = specialDaysIn('2027-02', { own });
  assert.deepEqual(february2027.map((item) => [item.day, item.key]), [
    ['2027-02-08', 'ramadanBegins'],
    ['2027-02-14', 'valentines'],
    ['2027-02-14', 'own-8'],
    ['2027-02-28', 'own-7'],
  ]);
  const birthday = february2027.find((item) => item.key === 'own-7');
  assert.deepEqual(birthday, { key: 'own-7', id: 7, day: '2027-02-28', kind: 'own', name: 'Shop birthday', note: 'Cake', hintKey: null, own: true });
  assert.deepEqual(dayOf('2028-02', 'own-7', { own }), ['2028-02-29'], 'a leap year keeps the 29th');
  assert.deepEqual(dayOf('2028-02', 'own-8', { own }), [], 'a one-day day shows only in its own year');
  assert.deepEqual(dayOf('2026-07', 'own-9', { own }), ['2026-07-01']);
  assert.deepEqual(dayOf('2026-06', 'own-9', { own }), []);
  assert.ok(specialDaysIn('2027-02', { showDays: 'world', hidden: BUILT_IN_DAY_KEYS, own }).every((item) => item.own), 'own days ignore the places and the hidden list');
});

test('the days of a month come by day', () => {
  for (const month of ['2026-03', '2026-05', '2026-11', '2027-03']) {
    const days = specialDaysIn(month, { own: [{ id: 1, name: 'A', date: '03-01', yearly: true }] }).map((item) => item.day);
    assert.deepEqual(days, [...days].sort(), month);
    assert.ok(days.every((day) => day.startsWith(`${month}-`)), month);
  }
  // Nevruz and the Ramadan Feast share 21 March 2026.
  assert.deepEqual(specialDaysOn('2026-03-21').map((item) => item.key), ['ramadanFeast', 'nevruz']);
  assert.deepEqual(specialDaysOn('2026-10-29').map((item) => item.key), ['republicDay']);
  assert.deepEqual(specialDaysOn('2026-10-30'), []);
});

test('a built-in day carries its words keys, never a name', () => {
  const [republic] = specialDaysOn('2026-10-29');
  assert.deepEqual(republic, { key: 'republicDay', day: '2026-10-29', kind: 'celebration', where: 'tr', nameKey: 'special.republicDay.name', hintKey: 'special.republicDay.hint', own: false });
  const [remembrance] = specialDaysOn('2026-11-10');
  assert.equal(remembrance.key, 'ataturkDay');
  assert.equal(remembrance.kind, 'remembrance');
  assert.equal(remembrance.hintKey, NO_OFFERS_WORDS);
});

test('the years the app knows bound the days, and a month that is not one answers none', () => {
  assert.deepEqual(dayOf('2000-01', 'newYear'), ['2000-01-01']);
  assert.deepEqual(dayOf('2199-12', 'newYearsEve'), ['2199-12-31']);
  assert.deepEqual(specialDaysIn('1999-12'), []);
  assert.deepEqual(specialDaysIn('2200-01'), []);
  assert.deepEqual(specialDaysIn('2026-13'), []);
  assert.deepEqual(specialDaysIn('2026-1'), []);
  assert.deepEqual(specialDaysIn(undefined), []);
  assert.deepEqual(specialDaysOn('2026-02-30'), []);
  assert.deepEqual(datesOf('newYear', 2200), []);
  assert.deepEqual(datesOf('nothing', 2026), []);
});

test('days kept everywhere show for every place choice; Turkish-only days only for Turkey', () => {
  for (const showDays of ['tr', 'world', 'both']) {
    assert.ok(specialDaysIn('2026-11', { showDays }).some((item) => item.key === 'blackFriday'), showDays);
  }
  assert.equal(specialDaysIn('2026-10', { showDays: 'world' }).some((item) => item.key === 'republicDay'), false);
  assert.equal(specialDaysIn('2026-10', { showDays: 'tr' }).some((item) => item.key === 'coffeeDay'), false);
});

test('a special day a post may carry: a built-in day\'s key or an own day\'s key', () => {
  for (const key of BUILT_IN_DAY_KEYS) assert.equal(isSpecialDayKey(key), true, key);
  for (const key of ['own-1', 'own-12', `own-${'9'.repeat(15)}`]) assert.equal(isSpecialDayKey(key), true, key);
  for (const key of ['own-0', 'own-', 'own-01', `own-${'9'.repeat(16)}`, 'own-1a', 'newyear', 'NEWYEAR', '', ' newYear', 'x'.repeat(80), null, 5, undefined]) {
    assert.equal(isSpecialDayKey(key), false, String(key));
  }
});
