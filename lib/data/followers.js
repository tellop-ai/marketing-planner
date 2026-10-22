/**
 * Followers: one number a month for each platform, typed
 * by the person on Results. Every read and save names its owner inside the
 * statement's `where` (AGENTS.md rule 1a); reading never saves (rule 4a).
 * What leaves this file is a plain object.
 *
 * A month holds at most one number for each network (the records keep one
 * row for each owner, month and network), so a month's read is at most
 * `NETWORK_KEYS.length` rows: one call, far inside every records bound.
 */

import { isCivilMonth } from '../plan/days.js';
import { readCount } from '../plan/limits.js';
import { isNetworkKey, NETWORK_KEYS } from '../plan/networks.js';

import { DataError, modelAction } from './index.js';

/** The most followers one number holds. */
export const FOLLOWERS_MOST = 1_000_000_000;
/** The rows one read of a few months takes at most: every network, for each month. */
const ROWS_A_MONTH = NETWORK_KEYS.length;

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** @param {unknown} month */
function requireMonth(month) {
  if (!isCivilMonth(month)) throw new DataError('refuse.request');
  return /** @type {string} */ (month);
}

/**
 * The read step of the followers of up to a few months (each named once):
 * `{ month, network, count }` rows, every network for each month at most.
 * Exported so a page's read can put it in one batch with its other reads.
 *
 * @param {string} owner
 * @param {string[]} months
 */
export function followersStep(owner, months) {
  return {
    model: 'Followers',
    action: 'findMany',
    args: {
      where: { ownerId: owner, month: { in: months } },
      select: { id: true, month: true, network: true, count: true },
      orderBy: [{ month: 'asc' }, { id: 'asc' }],
      take: Math.max(1, months.length) * ROWS_A_MONTH,
    },
  };
}

/**
 * The rows `followersStep` read, as `{ [month]: { [network]: count } }`; a
 * row for a network the app does not know is left out.
 *
 * @param {unknown} rows
 * @param {string[]} months
 * @returns {Record<string, Record<string, number>>}
 */
export function followersOf(rows, months) {
  /** @type {Record<string, Record<string, number>>} */
  const byMonth = Object.fromEntries(months.map((month) => [month, {}]));
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isNetworkKey(row?.network) || byMonth[row.month] === undefined || !Number.isSafeInteger(row.count)) continue;
    byMonth[row.month][row.network] = row.count;
  }
  return byMonth;
}

/**
 * The followers the person typed for a month (`YYYY-MM`): `{ [network]:
 * count }`, only the networks with a number. One call.
 *
 * @param {unknown} ownerId
 * @param {unknown} month
 * @returns {Promise<Record<string, number>>}
 */
export async function followersFor(ownerId, month) {
  const owner = ownerOf(ownerId);
  const which = requireMonth(month);
  const step = followersStep(owner, [which]);
  const rows = await modelAction(step.model, step.action, step.args);
  if (!Array.isArray(rows)) throw new DataError('error.storageUnreadable');
  return followersOf(rows, [which])[which];
}

/**
 * Keeps a platform's followers for a month: a whole number from 0 to
 * `FOLLOWERS_MOST` (kept in place of the one before), or null to remove it.
 * Refused: a month or network that is not one (`refuse.request`), a count
 * that is not such a number (`refuse.number`). One call.
 *
 * @param {unknown} ownerId
 * @param {unknown} month
 * @param {unknown} network
 * @param {unknown} count
 * @returns {Promise<{ month: string, network: string, count: number | null }>}
 */
export async function saveFollowersFor(ownerId, month, network, count) {
  const owner = ownerOf(ownerId);
  const which = requireMonth(month);
  if (!isNetworkKey(network)) throw new DataError('refuse.request');
  if (count === undefined) throw new DataError('refuse.request');
  const read = readCount(count, FOLLOWERS_MOST);
  if (!read.ok) throw new DataError(read.problem);
  const key = { ownerId_month_network: { ownerId: owner, month: which, network: /** @type {string} */ (network) } };
  if (read.value === null) {
    await modelAction('Followers', 'deleteMany', { where: { ownerId: owner, month: which, network } });
    return { month: which, network: /** @type {string} */ (network), count: null };
  }
  const at = new Date().toISOString();
  const saved = await modelAction('Followers', 'upsert', {
    where: key,
    create: { ownerId: owner, month: which, network, count: read.value, createdAt: at, updatedAt: at },
    update: { count: read.value, updatedAt: at },
    select: { month: true, network: true, count: true },
  });
  if (saved === null || saved === undefined || saved.count !== read.value) throw new DataError('error.saveUnconfirmed');
  return { month: which, network: /** @type {string} */ (network), count: saved.count };
}
