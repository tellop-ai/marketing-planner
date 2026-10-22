import { getLocale } from './i18n/index.js';

// One app currency. Change this constant deliberately when the app uses another.
export const CURRENCY = 'TRY';
const language = locale => locale === 'tr' ? 'tr-TR' : 'en-US';

/** Major currency units: 123.45 means 123 lira and 45 kuruş.
 * Stores that keep integer minor units call formatMoney(amount / 100, locale).
 * This is display only, never accounting, tax or rounding arithmetic.
 */
export function formatMoney(value, locale = getLocale()) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('Expected a finite amount');
  return new Intl.NumberFormat(language(locale), { style: 'currency', currency: CURRENCY }).format(value);
}

/** Exact decimal display, with no currency identity or rounding. The caller
 * supplies a canonical nonnegative decimal string (for example from a token's
 * integer-unit formatter). BigInt groups the whole; every fraction digit is
 * retained, so even huge balances and seven-place token fractions stay exact.
 */
export function formatDecimal(value, locale = getLocale()) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new RangeError('Expected a canonical decimal');
  const [whole, fraction] = value.split('.');
  const numbers = new Intl.NumberFormat(language(locale));
  const grouped = numbers.format(BigInt(whole));
  if (fraction === undefined) return grouped;
  const decimal = numbers.formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
  return `${grouped}${decimal}${fraction}`;
}

function civil(value, monthOnly = false) {
  const shape = monthOnly ? /^(\d{4})-(\d{2})(?:-(\d{2}))?$/ : /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = typeof value === 'string' && shape.exec(value);
  if (!match) throw new RangeError('Expected a civil date');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3] ?? 1);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  if (year < 1 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RangeError('Invalid civil date');
  return date;
}
function instant(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  // An instant must state its zone. Refuse rollover dates and zone-free strings.
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new RangeError('Expected a Date or zoned timestamp');
  civil(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || (match[5] !== 'Z' && (Number(match[5].slice(1,3)) > 23 || Number(match[5].slice(4)) > 59))) throw new RangeError('Invalid timestamp');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid timestamp');
  return date;
}
/** Civil YYYY-MM-DD stays on that day in every zone. Zoned timestamps and Date
 * instants show their UTC day everywhere. A zone-free timestamp is refused.
 */
export function formatDate(value, locale = getLocale()) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? civil(value) : instant(value);
  return new Intl.DateTimeFormat(language(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
/** Civil YYYY-MM or YYYY-MM-DD uses that month. Date/zoned instants use UTC.
 * A calendar built from local fields passes its civil month string, not a Date.
 */
export function formatMonth(value, locale = getLocale()) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}(?:-\d{2})?$/.test(value) ? civil(value, true) : instant(value);
  return new Intl.DateTimeFormat(language(locale), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(date);
}
