/**
 * Civil days (`YYYY-MM-DD`) and months (`YYYY-MM`) on this Mac's own calendar.
 * A day is a name for a date, never an instant: nothing here moves a day by a
 * time zone. Years 2000 to 2199 only, which every check of a day also refuses
 * outside.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MONTH = /^(\d{4})-(\d{2})$/u;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;

export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2199;

/** Days in a month (1 to 12) of a year. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** @param {unknown} value */
export function isCivilDay(value) {
  if (typeof value !== 'string') return false;
  const match = DAY.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** @param {unknown} value */
export function isCivilMonth(value) {
  if (typeof value !== 'string') return false;
  const match = MONTH.exec(value);
  if (!match) return false;
  const [year, month] = match.slice(1).map(Number);
  return year >= FIRST_YEAR && year <= LAST_YEAR && month >= 1 && month <= 12;
}

/** `HH:MM` on a 24-hour clock. @param {unknown} value */
export function isClockTime(value) {
  return typeof value === 'string' && TIME.test(value);
}

/** @param {number} year @param {number} month @param {number} day */
export function civilDay(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** @param {string} day */
export function partsOf(day) {
  const [year, month, date] = day.split('-').map(Number);
  return { year, month, day: date };
}

/** Today on this Mac's clock, as a civil day. @param {Date} [now] */
export function todayCivil(now = new Date()) {
  return civilDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** The day `count` days after `day` (before it when negative). */
export function addDays(day, count) {
  const { year, month, day: date } = partsOf(day);
  const moved = new Date(Date.UTC(year, month - 1, date + count));
  return civilDay(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** 0 for Sunday to 6 for Saturday. @param {string} day */
export function weekdayOf(day) {
  const { year, month, day: date } = partsOf(day);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/** The first day of the week holding `day`: Monday in Turkish, Sunday in English. */
export function weekStart(day, mondayFirst) {
  const weekday = weekdayOf(day);
  const back = mondayFirst ? (weekday + 6) % 7 : weekday;
  return addDays(day, -back);
}

/** The seven days of the week holding `day`. */
export function weekDays(day, mondayFirst) {
  const start = weekStart(day, mondayFirst);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** `YYYY-MM` of a civil day. */
export function monthOf(day) {
  return day.slice(0, 7);
}

/** The month `count` months after `month` (`YYYY-MM`). */
export function addMonths(month, count) {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + count;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The days a month view draws: whole weeks from the week holding the 1st to the
 * week holding the last day, each `{ day, inMonth }`.
 *
 * @param {string} month `YYYY-MM`
 * @param {boolean} mondayFirst
 */
export function monthGrid(month, mondayFirst) {
  const [year, number] = month.split('-').map(Number);
  const first = civilDay(year, number, 1);
  const last = civilDay(year, number, daysInMonth(year, number));
  const cells = [];
  for (let day = weekStart(first, mondayFirst); day <= last || cells.length % 7 !== 0; day = addDays(day, 1)) {
    cells.push({ day, inMonth: day.startsWith(month) });
  }
  return cells;
}
