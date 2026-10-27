/**
 * Day names for the calendar in the person's language, from civil days
 * (`YYYY-MM-DD`). A civil day is formatted at noon in UTC, so it stays the
 * same day in every time zone, on the server and in the browser alike.
 */

import { isClockTime, partsOf } from '../../lib/plan/days.js';

/** @param {string} locale */
const language = (locale) => (locale === 'tr' ? 'tr-TR' : 'en-US');

/** @param {string} day */
function utcNoon(day) {
  const { year, month, day: date } = partsOf(day);
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, date);
  at.setUTCHours(12, 0, 0, 0);
  return at;
}

/** @param {string} day @param {string} locale @param {Intl.DateTimeFormatOptions} options */
function format(day, locale, options) {
  return new Intl.DateTimeFormat(language(locale), { ...options, timeZone: 'UTC' }).format(utcNoon(day));
}

/**
 * A clock time as it is written, the one form every screen shows: "18:30",
 * in Turkish "18.30". Empty for anything else.
 *
 * @param {unknown} time
 * @param {string} locale
 */
export function timeText(time, locale) {
  if (!isClockTime(time)) return '';
  return locale === 'tr' ? /** @type {string} */ (time).replace(':', '.') : /** @type {string} */ (time);
}

/** "Mon", "Pzt": the short weekday names of the seven days given. @param {string[]} days @param {string} locale */
export function weekdayNames(days, locale) {
  return days.map((day) => format(day, locale, { weekday: 'short' }));
}

/** "Wednesday, 21 October" / "21 Ekim Çarşamba". @param {string} day @param {string} locale */
export function dayTitle(day, locale) {
  return format(day, locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "Mon, Oct 19" / "19 Eki Pzt". @param {string} day @param {string} locale */
export function shortDay(day, locale) {
  return format(day, locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Oct 19 – 25, 2026" / "19–25 Eki 2026". @param {string} from @param {string} to @param {string} locale */
export function weekTitle(from, to, locale) {
  const formatter = new Intl.DateTimeFormat(language(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // Node writes thin spaces around the dash, a browser plain ones: plain on both, so the page the server
  // drew is the page the browser draws.
  return formatter.formatRange(utcNoon(from), utcNoon(to)).replace(/[\u2009\u202f]/gu, ' ');
}

/** The day of the month, as a number. @param {string} day */
export function dayNumber(day) {
  return partsOf(day).day;
}

/** A civil day as a local `Date` at noon, for the kit's calendar. @param {string} day */
export function dateOf(day) {
  const { year, month, day: date } = partsOf(day);
  const at = new Date(2000, 0, 1, 12);
  at.setFullYear(year, month - 1, date);
  return at;
}

/** The civil day of a local `Date` the kit's calendar picked. @param {Date} date */
export function dayOf(date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
