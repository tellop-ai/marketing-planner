/**
 * What the Results page shows from `readResults`'s figures,
 * pure, so the checks call it directly: the change from last month beside
 * each count, which groups and columns show, the followers' total, and how a
 * typed followers number is read. No import here reaches the records.
 */

import { formatMoney } from '../../lib/format.js';
import { isNetworkKey } from '../../lib/plan/networks.js';

/** The minus sign a change takes (a real minus, not a hyphen). */
export const MINUS = '−';

/** The most followers one number holds (the records refuse more). */
export const FOLLOWERS_MOST = 1_000_000_000;

/**
 * An amount of money as the Results page writes it: the app's currency, whole
 * (sales are kept as whole amounts, so the ",00" or ".00" says nothing and
 * takes a phone's room).
 *
 * @param {number} value
 * @param {string} locale
 */
export function wholeMoney(value, locale) {
  return formatMoney(Math.round(value), locale).replace(/[.,]00(?=\D*$)/u, '');
}

/** @param {unknown} value */
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The change from last month, or null when there is none to show (no change,
 * or either month has no number).
 *
 * @param {number | null | undefined} value
 * @param {number | null | undefined} last
 * @returns {number | null}
 */
export function changeOf(value, last) {
  if (!isNumber(value) || !isNumber(last)) return null;
  const change = value - last;
  return change === 0 ? null : change;
}

/**
 * A change as the page writes it: "+3", "−1" (a real minus), the number
 * itself written by `format` (a count, or an amount of money).
 *
 * @param {number} change not 0
 * @param {(value: number) => string} format
 */
export function changeText(change, format) {
  return change > 0 ? `+${format(change)}` : `${MINUS}${format(-change)}`;
}

/**
 * The followers on the counts line: this month's numbers added up (null when
 * none was typed), and the change from last month over the platforms typed in
 * both months (null when none was).
 *
 * @param {Array<{ count: number | null, last: number | null }>} followers
 * @returns {{ value: number | null, change: number | null }}
 */
export function followersTotal(followers) {
  const rows = Array.isArray(followers) ? followers : [];
  const typed = rows.filter((row) => isNumber(row.count));
  const value = typed.length === 0 ? null : typed.reduce((sum, row) => sum + row.count, 0);
  const both = typed.filter((row) => isNumber(row.last));
  const change = both.length === 0 ? null : both.reduce((sum, row) => sum + row.count - row.last, 0);
  return { value, change: change === 0 ? null : change };
}

/**
 * The rows of a group that brought something this month (posts shared,
 * customers or sales): a row that holds only last month's numbers is left
 * out, since the lists show this month.
 *
 * @template {{ shares?: { value: number }, customers: { value: number }, sales: { value: number } }} R
 * @param {R[]} rows
 * @returns {R[]}
 */
export function rowsThisMonth(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (row.shares?.value ?? 0) > 0 || row.customers.value > 0 || row.sales.value > 0);
}

/**
 * Whether the lists show a Reactions column: only when results were typed for
 * a share this month.
 *
 * @param {{ typed: { value: number } }} totals
 */
export function showsReactions(totals) {
  return (totals?.typed?.value ?? 0) > 0;
}

/**
 * Whether By ask shows: only when a post of this month has an ask (a list
 * with only "No ask" says nothing).
 *
 * @param {Array<{ ask: string }>} rows this month's rows
 */
export function showsByAsk(rows) {
  return rows.some((row) => row.ask !== '');
}

/**
 * Whether the month has anything to list: a post shared, a customer or a
 * sale.
 *
 * @param {{ shares: { value: number }, customers: { value: number }, sales: { value: number } }} totals
 */
export function hasFigures(totals) {
  return totals.shares.value > 0 || totals.customers.value > 0 || totals.sales.value > 0;
}

/**
 * The followers fields: one for each switched-on platform (My plan's order),
 * with the number typed this month and last month's (null when none).
 *
 * @param {Array<{ network: string, count: number | null, last: number | null }>} followers
 * @param {string[]} networks the switched-on platforms
 */
export function followerFields(followers, networks) {
  const typed = new Map((Array.isArray(followers) ? followers : []).map((row) => [row.network, row]));
  return [...new Set(networks.filter((network) => isNetworkKey(network)))].map((network) => ({
    network,
    count: typed.get(network)?.count ?? null,
    last: typed.get(network)?.last ?? null,
  }));
}

/**
 * A followers number as the person typed it: empty is none (null, which
 * removes the number); spaces, dots, commas and apostrophes between the
 * digits are how people group thousands and are dropped ("12.400", "12,400",
 * "12 400"); anything else, or more than `FOLLOWERS_MOST`, is not a number.
 *
 * @param {string} text
 * @returns {{ ok: true, value: number | null } | { ok: false }}
 */
export function readFollowers(text) {
  const written = String(text ?? '').trim();
  if (written === '') return { ok: true, value: null };
  const digits = written.replace(/[\s.,'’ ]/gu, '');
  if (!/^\d{1,10}$/u.test(digits)) return { ok: false };
  const value = Number(digits);
  return value <= FOLLOWERS_MOST ? { ok: true, value } : { ok: false };
}
