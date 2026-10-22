import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptySlots } from '../lib/plan/slots.js';

const base = { month: '2026-10', taken: [], themeIds: [1, 2, 3], specialDays: [], mondayFirst: true, today: '2026-10-01' };

test('three a week fill Monday, Wednesday and Friday of each week from today', () => {
  const slots = emptySlots({ ...base, perWeek: 3 });
  const days = slots.map((slot) => slot.day);
  // October 2026 starts on a Thursday: its first week has four days in the month (Thu 1 to Sun 4), so it wants
  // round(3 x 4 / 7) = 2 posts, Friday first, then Thursday.
  assert.deepEqual(days.slice(0, 3), ['2026-10-01', '2026-10-02', '2026-10-05']);
  assert.ok(days.includes('2026-10-05') && days.includes('2026-10-07') && days.includes('2026-10-09'));
  assert.equal(new Set(days).size, days.length);
  assert.ok(days.every((day) => day.startsWith('2026-10')));
});

test('themes take the slots in turn, in day order', () => {
  const slots = emptySlots({ ...base, perWeek: 3 });
  assert.deepEqual(slots.slice(0, 4).map((slot) => slot.themeId), [1, 2, 3, 1]);
  assert.equal(emptySlots({ ...base, perWeek: 1, themeIds: [] })[0].themeId, null);
});

test('posts already planned count, and their days stay free of slots', () => {
  const taken = [{ day: '2026-10-05' }, { day: '2026-10-07' }, { day: null }];
  const slots = emptySlots({ ...base, perWeek: 3, taken });
  const week = slots.filter((slot) => slot.day >= '2026-10-05' && slot.day <= '2026-10-11');
  assert.deepEqual(week.map((slot) => slot.day), ['2026-10-09']);
});

test('a full month has no slots', () => {
  const taken = Array.from({ length: 31 }, (_, index) => ({ day: `2026-10-${String(index + 1).padStart(2, '0')}` }));
  assert.deepEqual(emptySlots({ ...base, perWeek: 3, taken }), []);
});

test('days before today get no slot; today does', () => {
  const slots = emptySlots({ ...base, perWeek: 7, today: '2026-10-21' });
  assert.equal(slots[0].day, '2026-10-21');
  assert.ok(slots.every((slot) => slot.day >= '2026-10-21'));
  assert.deepEqual(emptySlots({ ...base, perWeek: 3, today: '2026-11-01' }), []);
});

test('one a week takes Monday where it can; fourteen a week fill each free day twice', () => {
  const one = emptySlots({ ...base, perWeek: 1, today: '2026-10-05' });
  assert.equal(one[0].day, '2026-10-05');
  const many = emptySlots({ ...base, perWeek: 14, today: '2026-10-05', month: '2026-10' });
  const monday = many.filter((slot) => slot.day === '2026-10-05');
  assert.equal(monday.length, 2);
  assert.equal(many.filter((slot) => slot.day >= '2026-10-05' && slot.day <= '2026-10-11').length, 14);
});

test('a celebration day pulls the nearest slot of its week; an awareness day does not', () => {
  const specialDays = [{ key: 'republic-day', day: '2026-10-29', kind: 'celebration' }, { key: 'food-day', day: '2026-10-16', kind: 'awareness' }];
  const slots = emptySlots({ ...base, perWeek: 3, specialDays });
  const republic = slots.find((slot) => slot.day === '2026-10-29');
  assert.equal(republic?.specialDayKey, 'republic-day');
  assert.equal(slots.filter((slot) => slot.day >= '2026-10-26' && slot.day <= '2026-11-01').length, 3);
  assert.equal(slots.some((slot) => slot.specialDayKey === 'food-day'), false);
});

test('a special day that already holds a post pulls nothing', () => {
  const specialDays = [{ key: 'republic-day', day: '2026-10-29', kind: 'celebration' }];
  const slots = emptySlots({ ...base, perWeek: 3, specialDays, taken: [{ day: '2026-10-29' }] });
  assert.equal(slots.some((slot) => slot.specialDayKey), false);
});

test('Sunday-first weeks group the same days by the English week', () => {
  const slots = emptySlots({ ...base, perWeek: 3, mondayFirst: false });
  assert.ok(slots.every((slot) => slot.day.startsWith('2026-10')));
  assert.equal(new Set(slots.map((slot) => slot.day)).size, slots.length);
});

// --- a special day and the slots around it (week Mon 13 to Sun 19 October 2031, all in the month) ---------------

const october = { month: '2031-10', taken: [], themeIds: [1], mondayFirst: true, today: '2031-10-01' };
const weekOf13 = (slots) => slots.filter((slot) => slot.day >= '2031-10-13' && slot.day <= '2031-10-19');
const celebration = (day, key = 'party') => ({ key, day, kind: 'celebration' });

test('a slot that already falls on a celebration or shopping day is marked with it, where it is', () => {
  // Three a week: Mon 13, Wed 15, Fri 17.
  for (const kind of ['celebration', 'shopping']) {
    const week = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [{ key: 'party', day: '2031-10-15', kind }] }));
    assert.deepEqual(week, [
      { day: '2031-10-13', themeId: 1 },
      { day: '2031-10-15', themeId: 1, specialDayKey: 'party' },
      { day: '2031-10-17', themeId: 1 },
    ], kind);
  }
  // Republic Day 2031 is a Wednesday: its slot is marked, and no other slot of the week moves. The week has five
  // days in October, so it wants round(3 x 5 / 7) = 2 posts.
  const republic = emptySlots({ ...october, perWeek: 3, specialDays: [celebration('2031-10-29', 'republicDay')] });
  assert.deepEqual(republic.filter((slot) => slot.day >= '2031-10-27').map((slot) => [slot.day, slot.specialDayKey]), [
    ['2031-10-27', undefined], ['2031-10-29', 'republicDay'],
  ]);
});

test('a slot on the day before or the day after a celebration moves onto it', () => {
  // Sat 18: Fri 17 is the day before, Sun 19 holds no slot.
  assert.deepEqual(weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [celebration('2031-10-18')] })).map((slot) => slot.day),
    ['2031-10-13', '2031-10-15', '2031-10-18']);
  // Tue 14 with Mon 13 already planned: the slots are Wed 15 and Fri 17, so the day after moves.
  const after = weekOf13(emptySlots({ ...october, perWeek: 3, taken: [{ day: '2031-10-13' }], specialDays: [celebration('2031-10-14')] }));
  assert.deepEqual(after, [{ day: '2031-10-14', themeId: 1, specialDayKey: 'party' }, { day: '2031-10-17', themeId: 1 }]);
});

test('a day of remembrance never takes a slot: the slot goes to the next free day, and nothing pulls one onto it', () => {
  // Wed 15 is a day of remembrance: three a week take Monday, Friday and then Tuesday.
  const on = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [{ key: 'calm', day: '2031-10-15', kind: 'remembrance' }] }));
  assert.deepEqual(on.map((slot) => [slot.day, slot.specialDayKey]), [['2031-10-13', undefined], ['2031-10-14', undefined], ['2031-10-17', undefined]]);
  // Beside the slots it changes nothing; it is not a planned post either.
  const beside = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [{ key: 'calm', day: '2031-10-14', kind: 'remembrance' }] }));
  assert.deepEqual(beside.map((slot) => slot.day), ['2031-10-13', '2031-10-15', '2031-10-17']);
  // Fourteen a week: two slots on every other free day, none on it.
  const full = weekOf13(emptySlots({ ...october, perWeek: 14, specialDays: [{ key: 'calm', day: '2031-10-15', kind: 'remembrance' }] }));
  assert.equal(full.filter((slot) => slot.day === '2031-10-15').length, 0);
  assert.equal(full.length, 12, 'six free days of the week, two slots each');
  // A celebration on the same day never pulls a slot onto it.
  const both = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [{ key: 'calm', day: '2031-10-16', kind: 'remembrance' }, celebration('2031-10-16')] }));
  assert.ok(both.every((slot) => slot.day !== '2031-10-16' && slot.specialDayKey === undefined));
});

test('an awareness or own day never takes a slot of its own and never marks one', () => {
  for (const kind of ['awareness', 'own']) {
    const on = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [{ key: 'calm', day: '2031-10-15', kind }] }));
    assert.deepEqual(on.map((slot) => [slot.day, slot.specialDayKey]), [['2031-10-13', undefined], ['2031-10-15', undefined], ['2031-10-17', undefined]], `${kind} on a slot`);
    const beside = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [{ key: 'calm', day: '2031-10-14', kind }] }));
    assert.deepEqual(beside.map((slot) => slot.day), ['2031-10-13', '2031-10-15', '2031-10-17'], `${kind} beside a slot`);
  }
});

test('a slot on a celebration is never pulled away by another celebration of its week', () => {
  // Thu 16 is nearer to Wed 15 than to Fri 17 or Mon 13, but Wed 15 is a celebration's own slot.
  const week = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [celebration('2031-10-16', 'second'), celebration('2031-10-15', 'first')] }));
  assert.deepEqual(week.map((slot) => [slot.day, slot.specialDayKey]), [
    ['2031-10-13', undefined], ['2031-10-15', 'first'], ['2031-10-16', 'second'],
  ]);
});

test('one celebration marks one slot; two on one day share it', () => {
  // Fourteen a week: two slots on each free day, one of them marked.
  const twice = emptySlots({ ...october, perWeek: 14, specialDays: [celebration('2031-10-15')] }).filter((slot) => slot.day === '2031-10-15');
  assert.equal(twice.length, 2);
  assert.equal(twice.filter((slot) => slot.specialDayKey === 'party').length, 1);
  // Two days on Wed 15: the first takes the slot, the second pulls none.
  const both = weekOf13(emptySlots({ ...october, perWeek: 3, specialDays: [celebration('2031-10-15', 'one'), celebration('2031-10-15', 'two')] }));
  assert.deepEqual(both.map((slot) => [slot.day, slot.specialDayKey]), [['2031-10-13', undefined], ['2031-10-15', 'one'], ['2031-10-17', undefined]]);
});

test('a celebration pulls only from its own week, and not before today', () => {
  // Sun 19 with every slot of its week planned: Mon 20, one day away in the next week, stays.
  const taken = [{ day: '2031-10-13' }, { day: '2031-10-15' }, { day: '2031-10-17' }];
  const slots = emptySlots({ ...october, perWeek: 3, taken, specialDays: [celebration('2031-10-19')] });
  assert.equal(slots.some((slot) => slot.day === '2031-10-19' || slot.specialDayKey), false);
  assert.ok(slots.some((slot) => slot.day === '2031-10-20'));
  // Today is Thu 16: Wed 15 has gone by, so it marks nothing; today itself does.
  const late = emptySlots({ ...october, perWeek: 3, today: '2031-10-16', specialDays: [celebration('2031-10-15', 'gone'), celebration('2031-10-16', 'today')] });
  assert.equal(late.some((slot) => slot.specialDayKey === 'gone' || slot.day < '2031-10-16'), false);
  assert.deepEqual(late.find((slot) => slot.day === '2031-10-16'), { day: '2031-10-16', themeId: 1, specialDayKey: 'today' });
});

test('a week only partly in the month wants its share, and no day takes two posts at seven a week or fewer', () => {
  // November 2026, Sundays first: Sun 29 and Mon 30 are the last week's days in the month: round(3 x 2 / 7) = 1.
  const sunday = emptySlots({ ...base, month: '2026-11', today: '2026-11-01', mondayFirst: false, perWeek: 3 });
  assert.deepEqual(sunday.filter((slot) => slot.day >= '2026-11-29').map((slot) => slot.day), ['2026-11-30']);
  // Mondays first: Sun 1 is the first week's only day in the month: round(3 / 7) = 0; Mon 30 likewise.
  const monday = emptySlots({ ...base, month: '2026-11', today: '2026-11-01', perWeek: 3 });
  assert.equal(monday.some((slot) => slot.day === '2026-11-01' || slot.day === '2026-11-30'), false);
  // At seven a week a day of remembrance (Tue 10) leaves its week one short; no other day takes it twice.
  const seven = emptySlots({ ...base, month: '2026-11', today: '2026-11-01', perWeek: 7, specialDays: [{ key: 'calm', day: '2026-11-10', kind: 'remembrance' }] });
  const days = seven.map((slot) => slot.day);
  assert.equal(new Set(days).size, days.length);
  assert.equal(days.filter((day) => day >= '2026-11-09' && day <= '2026-11-15').length, 6);
  // Past seven a week a day may take two.
  const eight = emptySlots({ ...base, month: '2026-11', today: '2026-11-01', perWeek: 8 });
  assert.ok(eight.length > new Set(eight.map((slot) => slot.day)).size);
});
