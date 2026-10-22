/**
 * The special days the calendar shows, kept in code (not rows), and the
 * person's own days beside them.
 *
 * Each built-in day has a `key` (the name a profile's `hiddenDays` list uses),
 * `where` it is marked (`tr`: Turkey, `world`: worldwide), its `kind`
 * (`celebration`, `shopping`, `awareness`, `remembrance`) and a `rule` for its
 * date:
 * - `{ type: 'fixed', month, day }`: the same date every year;
 * - `{ type: 'nth', month, weekday, nth, plus }`: the `nth` `weekday` (0 Sunday
 *   to 6 Saturday) of `month`, moved `plus` days on ("second Sunday of May";
 *   Black Friday is the fourth Thursday of November plus one day, Small
 *   Business Saturday plus two, Cyber Monday, the Monday after Black Friday,
 *   plus four, which can fall on 1 or 2 December);
 * - `{ type: 'dates', years: { [year]: { from, to } } }`: days that move each
 *   year, as published for each year; a day of several days shows on each of
 *   its days.
 *
 * The moving religious days of Turkey follow the official religious calendar
 * as reported on 2026-10-21 (eve days are not shown): Ramadan begins
 * 2026-02-19 and 2027-02-08; Ramadan Feast 2026-03-20 to 22 and 2027-03-09 to
 * 11; Sacrifice Feast 2026-05-27 to 30 and 2027-05-16 to 19. After
 * `LAST_MOVING_YEAR` those days are not shown until a store update adds the
 * next year (My plan says so).
 *
 * Every built-in day's words are locale keys: `special.<key>.name` and one
 * suggestion line, `special.<key>.hint` (a day of remembrance uses
 * `special.noOffers`).
 */

import { civilDay, daysInMonth, isCivilDay, isCivilMonth, weekdayOf } from './days.js';

/** The last year whose moving days (Ramadan and the two feasts) this version knows. */
export const LAST_MOVING_YEAR = 2027;

/** The words line a day of remembrance shows in place of a suggestion. */
export const NO_OFFERS_WORDS = 'special.noOffers';

const fixed = (month, day) => ({ type: 'fixed', month, day });
const nth = (month, weekday, count, plus = 0) => ({ type: 'nth', month, weekday, nth: count, plus });
const dates = (years) => ({ type: 'dates', years });

const SUNDAY = 0;
const THURSDAY = 4;

const builtIn = (key, where, kind, rule) => {
  const frozenRule = rule.type === 'dates'
    ? Object.freeze({ type: 'dates', years: Object.freeze(Object.fromEntries(Object.entries(rule.years).map(([year, span]) => [year, Object.freeze({ ...span })]))) })
    : Object.freeze(rule);
  return Object.freeze({
    key,
    where,
    kind,
    rule: frozenRule,
    nameKey: `special.${key}.name`,
    hintKey: kind === 'remembrance' ? NO_OFFERS_WORDS : `special.${key}.hint`,
  });
};

export const BUILT_IN_DAYS = Object.freeze([
  builtIn('newYear', 'all', 'celebration', fixed(1, 1)),
  builtIn('ramadanBegins', 'tr', 'celebration', dates({ 2026: { from: '2026-02-19', to: '2026-02-19' }, 2027: { from: '2027-02-08', to: '2027-02-08' } })),
  builtIn('valentines', 'all', 'celebration', fixed(2, 14)),
  builtIn('womensDay', 'all', 'awareness', fixed(3, 8)),
  builtIn('medicineDay', 'tr', 'celebration', fixed(3, 14)),
  builtIn('canakkale', 'tr', 'remembrance', fixed(3, 18)),
  builtIn('ramadanFeast', 'tr', 'celebration', dates({ 2026: { from: '2026-03-20', to: '2026-03-22' }, 2027: { from: '2027-03-09', to: '2027-03-11' } })),
  builtIn('nevruz', 'tr', 'celebration', fixed(3, 21)),
  builtIn('childrensDay', 'tr', 'celebration', fixed(4, 23)),
  builtIn('labourDay', 'tr', 'celebration', fixed(5, 1)),
  builtIn('mothersDay', 'tr', 'celebration', nth(5, SUNDAY, 2)),
  builtIn('youthDay', 'tr', 'celebration', fixed(5, 19)),
  builtIn('sacrificeFeast', 'tr', 'celebration', dates({ 2026: { from: '2026-05-27', to: '2026-05-30' }, 2027: { from: '2027-05-16', to: '2027-05-19' } })),
  builtIn('fathersDay', 'tr', 'celebration', nth(6, SUNDAY, 3)),
  builtIn('democracyDay', 'tr', 'remembrance', fixed(7, 15)),
  builtIn('victoryDay', 'tr', 'celebration', fixed(8, 30)),
  builtIn('republicDay', 'tr', 'celebration', fixed(10, 29)),
  builtIn('halloween', 'all', 'celebration', fixed(10, 31)),
  builtIn('ataturkDay', 'tr', 'remembrance', fixed(11, 10)),
  builtIn('singlesDay', 'all', 'shopping', fixed(11, 11)),
  builtIn('teachersDay', 'tr', 'celebration', fixed(11, 24)),
  builtIn('blackFriday', 'all', 'shopping', nth(11, THURSDAY, 4, 1)),
  builtIn('cyberMonday', 'all', 'shopping', nth(11, THURSDAY, 4, 4)),
  builtIn('newYearsEve', 'all', 'celebration', fixed(12, 31)),
  builtIn('wildlifeDay', 'world', 'awareness', fixed(3, 3)),
  builtIn('earthDay', 'world', 'awareness', fixed(4, 22)),
  builtIn('bookDay', 'world', 'awareness', fixed(4, 23)),
  builtIn('environmentDay', 'world', 'awareness', fixed(6, 5)),
  builtIn('coffeeDay', 'world', 'celebration', fixed(10, 1)),
  builtIn('foodDay', 'world', 'awareness', fixed(10, 16)),
  builtIn('womenEntrepreneursDay', 'world', 'awareness', fixed(11, 19)),
  builtIn('smallBusinessSaturday', 'world', 'shopping', nth(11, THURSDAY, 4, 2)),
]);

export const BUILT_IN_DAY_KEYS = Object.freeze(BUILT_IN_DAYS.map((item) => item.key));

/** Where the person chose to see days from: `tr`, `world` or `both` (the default). */
export const SHOW_DAYS = Object.freeze(['tr', 'world', 'both']);

/** @param {unknown} key */
export function isBuiltInDayKey(key) {
  return typeof key === 'string' && BUILT_IN_DAY_KEYS.includes(key);
}

/** A person's own day's key in a post: `own-` and its record id. */
const OWN_DAY_KEY = /^own-([1-9][0-9]{0,14})$/u;

/**
 * The record id of the person's own day a special-day key names (`own-12`),
 * or null (the one reader of that key: the records and the AI requests use it).
 *
 * @param {unknown} key
 * @returns {number | null}
 */
export function ownDayId(key) {
  const match = typeof key === 'string' ? OWN_DAY_KEY.exec(key) : null;
  return match ? Number(match[1]) : null;
}

/**
 * Whether `key` names a special day a post can carry: a built-in day's key or
 * a person's own day's key (`own-<id>`, as `specialDaysIn` gives it; whether
 * that own day is the person's is the records' check).
 *
 * @param {unknown} key
 */
export function isSpecialDayKey(key) {
  return isBuiltInDayKey(key) || ownDayId(key) !== null;
}

/** @param {unknown} key */
export function builtInDayByKey(key) {
  return BUILT_IN_DAYS.find((item) => item.key === key) ?? null;
}

/** The `count`th `weekday` of a month (1 the first), as a day of that month. */
function nthWeekday(year, month, weekday, count) {
  const firstWeekday = weekdayOf(civilDay(year, month, 1));
  return 1 + ((weekday - firstWeekday + 7) % 7) + (count - 1) * 7;
}

/** Each day from `from` to `to` (both kept), civil days. */
function spanDays(from, to) {
  if (!isCivilDay(from) || !isCivilDay(to) || to < from) return [];
  const days = [];
  for (let [year, month, day] = from.split('-').map(Number); ; ) {
    const current = civilDay(year, month, day);
    if (current > to) break;
    days.push(current);
    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  return days;
}

/**
 * The days a built-in day falls on in a year (several for a feast of several
 * days, none for a moving day of a year this version does not know). A day
 * moved past the month's end (Cyber Monday) lands in the next month.
 *
 * @param {string} key
 * @param {number} year
 * @returns {string[]}
 */
export function datesOf(key, year) {
  const item = builtInDayByKey(key);
  if (!item || !Number.isInteger(year)) return [];
  const { rule } = item;
  if (rule.type === 'fixed') {
    const day = civilDay(year, rule.month, rule.day);
    return isCivilDay(day) ? [day] : [];
  }
  if (rule.type === 'nth') {
    const first = nthWeekday(year, rule.month, rule.weekday, rule.nth);
    const moved = new Date(Date.UTC(year, rule.month - 1, first + rule.plus));
    const day = civilDay(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
    return isCivilDay(day) ? [day] : [];
  }
  const span = rule.years[year];
  return span ? spanDays(span.from, span.to) : [];
}

/** The hidden keys as a set, from an array, a set or a stored comma list. */
function hiddenSet(hidden) {
  if (hidden instanceof Set) return hidden;
  if (Array.isArray(hidden)) return new Set(hidden);
  if (typeof hidden === 'string') return new Set(hidden.split(',').map((part) => part.trim()).filter(Boolean));
  return new Set();
}

/** The day a person's own day falls on in `month` (`YYYY-MM`), or null. */
function ownDayIn(month, item) {
  if (!item || typeof item.date !== 'string') return null;
  const [year, number] = month.split('-').map(Number);
  if (item.yearly) {
    const match = /^(\d{2})-(\d{2})$/u.exec(item.date);
    if (!match || Number(match[1]) !== number) return null;
    const date = Number(match[2]);
    if (date < 1 || date > 31) return null;
    // A yearly 29 February shows on 28 February in a common year.
    if (number === 2 && date === 29 && daysInMonth(year, 2) === 28) return civilDay(year, 2, 28);
    const day = civilDay(year, number, date);
    return isCivilDay(day) ? day : null;
  }
  return isCivilDay(item.date) && item.date.startsWith(`${month}-`) ? item.date : null;
}

/**
 * The special days of a month: the built-in days of the places the person
 * chose, minus the ones they hid, and their own days, by day (built-in days in
 * this file's order, then own days by name, on the same day).
 *
 * A built-in day answers `{ key, day, kind, where, nameKey, hintKey, own: false }`.
 * An own day answers `{ key: 'own-<id>', id, day, kind: 'own', name, note,
 * hintKey: null, own: true }`; `own` holds `{ id, name, date, yearly, note }`
 * with `date` as `MM-DD` when yearly, else `YYYY-MM-DD`.
 *
 * @param {string} month `YYYY-MM`
 * @param {{ showDays?: string, hidden?: string[] | Set<string> | string, own?: Array<{ id: number | string, name: string, date: string, yearly: boolean, note?: string }> }} [options]
 */
export function specialDaysIn(month, { showDays = 'both', hidden = [], own = [] } = {}) {
  if (!isCivilMonth(month)) return [];
  const year = Number(month.slice(0, 4));
  const places = SHOW_DAYS.includes(showDays) ? showDays : 'both';
  const hiddenKeys = hiddenSet(hidden);
  const found = [];
  BUILT_IN_DAYS.forEach((item, order) => {
    // `all`: kept by people in Turkey and elsewhere alike, shown for every choice.
    if (places !== 'both' && item.where !== 'all' && item.where !== places) return;
    if (hiddenKeys.has(item.key)) return;
    // No rule moves a day into the next year (Cyber Monday moves at most into December).
    for (const day of datesOf(item.key, year)) {
      if (!day.startsWith(`${month}-`)) continue;
      found.push({ sort: [day, 0, order, ''], value: { key: item.key, day, kind: item.kind, where: item.where, nameKey: item.nameKey, hintKey: item.hintKey, own: false } });
    }
  });
  for (const item of Array.isArray(own) ? own : []) {
    const day = ownDayIn(month, item);
    if (!day) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    found.push({
      sort: [day, 1, 0, name],
      value: { key: `own-${item.id}`, id: item.id, day, kind: 'own', name, note: typeof item.note === 'string' ? item.note : '', hintKey: null, own: true },
    });
  }
  found.sort((a, b) => {
    for (let index = 0; index < a.sort.length; index += 1) {
      if (a.sort[index] < b.sort[index]) return -1;
      if (a.sort[index] > b.sort[index]) return 1;
    }
    return 0;
  });
  return found.map((item) => item.value);
}

/**
 * The special days on one civil day, with the same choices as `specialDaysIn`.
 *
 * @param {string} day `YYYY-MM-DD`
 * @param {Parameters<typeof specialDaysIn>[1]} [options]
 */
export function specialDaysOn(day, options) {
  if (!isCivilDay(day)) return [];
  return specialDaysIn(day.slice(0, 7), options).filter((item) => item.day === day);
}
