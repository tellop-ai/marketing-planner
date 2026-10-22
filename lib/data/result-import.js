/**
 * The records side of numbers files and best times: filling the counts of
 * the person's shared posts from a numbers file's rows, and reading the
 * shares with reactions that best times are worked out from.
 *
 * Every read and change names its owner inside the statement's `where`
 * (AGENTS.md rule 1a), through `modelAction`/`modelBatch` from `./index.js`;
 * nothing else changes. Calls run one after another (at most one in flight).
 *
 * ## How much one request takes
 *
 * `fillResultsFor`: the shared versions near the file's days, newest first,
 * `VERSION_PAGE` a call (`readInPages`; a row is at most about 1,130 bytes
 * with the longest kept link, so a call answers under 220 KB and 1,165
 * values), at most `MOST_VERSIONS` (2 calls); their posts' days (1 call,
 * `readPacked`); then the matched versions' counts, 32 changes a batch, one
 * batch after another: at most `MOST_VERSIONS / 32` = 12 calls. At most 15 in
 * all, so every row a file matches is filled in the same request.
 *
 * `bestTimesFor`: the newest `MOST_RESULT_SHARES` shares with reactions,
 * `RESULT_PAGE` a call (2 calls), then their posts' days and times (1 call,
 * `readPacked`): at most 3 calls.
 */

import { BEST_TIMES, bestTimes, localMoment } from '../plan/best-times.js';
import { addDays, isCivilDay, partsOf } from '../plan/days.js';
import { IMPORT_LIMITS } from '../import/limits.js';
import { LIMITS, readCount, RESULT_COUNTS } from '../plan/limits.js';
import { isNetworkKey } from '../plan/networks.js';
import { momentOf } from '../plan/state.js';
import { linkForm, normalLink } from '../plan/result-files.js';

import { DataError, modelBatch } from './index.js';
import { REACTION_COUNTS } from './results.js';
import { inGroups, readInPages, readPacked, RECORDS } from './read-in-pages.js';

/** Shared versions one file is matched against, and how many a call reads. */
export const MOST_VERSIONS = 384;
export const VERSION_PAGE = 192;
/** Days before the file's first day and after its last that a version's shared day may fall. */
export const MATCH_MARGIN = 14;
/** Changes in one batch. */
const WRITE_BATCH = RECORDS.steps;
/** The days of rows not matched that the answer names. */
export const NOT_MATCHED_DAYS = 5;
/** Shares with reactions best times are worked out from (the newest), and how many a call reads. */
export const MOST_RESULT_SHARES = 400;
export const RESULT_PAGE = 200;
/** A post's day as a records answer writes it: `{"id":12345678901,"day":"2026-10-22"},`. */
const POST_DAY_ROW = 48;
/** A post's day and time as a records answer writes them: `{"id":12345678901,"day":"2026-10-22","time":"18:30"},`. */
const POST_WHEN_ROW = 64;

/** @param {unknown} value */
function requireOwner(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** The ISO instant of the start of a civil day on this computer's clock. @param {string} day */
function startOfDay(day) {
  const { year, month, day: date } = partsOf(day);
  return new Date(year, month - 1, date).toISOString();
}

/** @param {unknown} value */
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A numbers file's rows as `lib/plan/result-files.js` reads them, checked
 * again here (a caller's values are never trusted): at most
 * `IMPORT_LIMITS.rows` rows, each a link key or null, a platform or null, a
 * day or null and at least one count from 0 to `LIMITS.result`.
 *
 * @param {unknown} rows
 */
function readRows(rows) {
  if (!Array.isArray(rows) || rows.length > IMPORT_LIMITS.rows) throw new DataError('refuse.request');
  return rows.map((row) => {
    if (!isPlainObject(row) || !isPlainObject(row.counts)) throw new DataError('refuse.request');
    const link = row.link === null || row.link === undefined ? null : row.link;
    if (link !== null && (typeof link !== 'string' || link.length > 2048 || normalLink(link) !== link)) throw new DataError('refuse.request');
    const network = row.network === null || row.network === undefined ? null : row.network;
    if (network !== null && !isNetworkKey(network)) throw new DataError('refuse.request');
    const day = row.day === null || row.day === undefined ? null : row.day;
    if (day !== null && !isCivilDay(day)) throw new DataError('refuse.request');
    /** @type {Record<string, number>} */
    const counts = {};
    for (const [name, value] of Object.entries(row.counts)) {
      if (!RESULT_COUNTS.includes(name)) throw new DataError('refuse.request');
      const read = readCount(value, LIMITS.result);
      if (!read.ok || read.value === null) throw new DataError('refuse.request');
      counts[name] = read.value;
    }
    if (Object.keys(counts).length === 0) throw new DataError('refuse.request');
    return { link, network, day, counts };
  });
}

/**
 * Fills the counts of the owner's shared posts from a numbers file's rows
 * (`readResultFile`'s `rows`). A row fills the one shared version whose kept
 * link is the row's link (both read by `normalLink`); else, when the row
 * names a day and a platform, the one shared version on that platform whose
 * post's day or shared day is the row's day and whose kept link, when it
 * has one, is not another post's. A kept link in another form than the
 * row's (`linkForm`: a Facebook share link, a `pfbid` address, a permalink
 * or story address...) cannot say which post it is, so it counts as no link
 * there. Two or more that fit, or two rows that fit the same version: not
 * matched. Only the counts the row has numbers
 * for change (and the moment results were last typed); nothing else.
 *
 * Shares scheduled for after `now` are not shared yet and never match. The
 * versions read are the newest `MOST_VERSIONS` shared from `MATCH_MARGIN`
 * days before the file's first day to as many after its last (when every
 * row names a platform, only those platforms'). When that many came back,
 * older ones were not read: a row on or before the oldest one's day that
 * matched nothing is counted in `left` (with that day as `leftBefore`), not
 * in `notMatched`.
 *
 * A failed batch stops the filling: the rows of the batches before it stay
 * filled, and the refusal carries how many (`DataError` with `filled`).
 *
 * @param {unknown} ownerId
 * @param {unknown} rows
 * @param {{ now?: string | number }} [options]
 * @returns {Promise<{ filled: number, notMatched: number, notMatchedDays: string[], left: number, leftBefore: string | null }>}
 */
export async function fillResultsFor(ownerId, rows, { now } = {}) {
  const owner = requireOwner(ownerId);
  const wanted = readRows(rows);
  const nowIso = new Date(momentOf(now)).toISOString();
  if (wanted.length === 0) return { filled: 0, notMatched: 0, notMatchedDays: [], left: 0, leftBefore: null };

  const days = wanted.map((row) => row.day).filter((day) => day !== null).sort();
  /** @type {Record<string, unknown>} */
  const sharedAt = { lte: nowIso };
  if (days.length > 0) {
    sharedAt.gte = startOfDay(addDays(days[0], -MATCH_MARGIN));
    sharedAt.lt = startOfDay(addDays(days.at(-1), MATCH_MARGIN + 1));
  }
  const networks = [...new Set(wanted.map((row) => row.network))];
  const where = { ownerId: owner, sharedAt, ...(networks.includes(null) ? {} : { network: { in: networks } }) };
  const versions = await readInPages('PostVersion', {
    where,
    order: [['sharedAt', 'desc'], ['id', 'desc']],
    select: { id: true, postId: true, network: true, sharedAt: true, sharedLink: true },
    most: MOST_VERSIONS,
    page: VERSION_PAGE,
  });
  const full = versions.length >= MOST_VERSIONS;
  const oldestDay = full ? localMoment(versions.at(-1).sharedAt)?.slice(0, 10) ?? null : null;

  const postIds = [...new Set(versions.map((version) => version.postId))];
  const postDays = new Map();
  if (postIds.length > 0) {
    const answers = await readPacked(inGroups(postIds).map((ids) => ({
      model: 'Post',
      action: 'findMany',
      args: { where: { ownerId: owner, id: { in: ids } }, select: { id: true, day: true }, orderBy: { id: 'asc' }, take: ids.length },
      bytes: 2 + ids.length * POST_DAY_ROW,
    })));
    for (const answer of answers) for (const post of Array.isArray(answer) ? answer : []) postDays.set(post.id, typeof post.day === 'string' ? post.day : null);
  }
  const known = versions
    .filter((version) => isNetworkKey(version.network) && typeof version.sharedAt === 'string')
    .map((version) => ({
      id: version.id,
      network: version.network,
      link: normalLink(version.sharedLink),
      days: new Set([postDays.get(version.postId), localMoment(version.sharedAt)?.slice(0, 10)].filter((day) => typeof day === 'string')),
    }));

  // By link first: a row whose link is one version's link.
  /** @type {Array<number | null>} */
  const claims = wanted.map((row) => {
    if (row.link === null) return null;
    const found = known.filter((version) => version.link === row.link);
    return found.length === 1 ? found[0].id : null;
  });
  const byLink = new Set(claims.filter((id) => id !== null));
  // Then by platform and day, among the versions no link took.
  wanted.forEach((row, index) => {
    if (claims[index] !== null || row.day === null || row.network === null) return;
    const found = known.filter((version) => !byLink.has(version.id)
      && version.network === row.network
      && version.days.has(/** @type {string} */ (row.day))
      && (version.link === null || row.link === null || version.link === row.link || linkForm(version.link) !== linkForm(row.link)));
    if (found.length === 1) claims[index] = found[0].id;
  });
  const takers = new Map();
  for (const id of claims) if (id !== null) takers.set(id, (takers.get(id) ?? 0) + 1);

  const writes = [];
  let notMatched = 0;
  let left = 0;
  const notMatchedDays = [];
  wanted.forEach((row, index) => {
    const id = claims[index];
    if (id !== null && takers.get(id) === 1) {
      writes.push({ id, counts: row.counts });
      return;
    }
    if (full && id === null && row.day !== null && oldestDay !== null && row.day <= oldestDay) {
      left += 1;
      return;
    }
    notMatched += 1;
    if (row.day !== null && notMatchedDays.length < NOT_MATCHED_DAYS && !notMatchedDays.includes(row.day)) notMatchedDays.push(row.day);
  });

  let filled = 0;
  const at = new Date().toISOString();
  for (let start = 0; start < writes.length; start += WRITE_BATCH) {
    const steps = writes.slice(start, start + WRITE_BATCH).map(({ id, counts }) => ({
      model: 'PostVersion',
      action: 'updateMany',
      args: { where: { ownerId: owner, id, sharedAt: { lte: nowIso } }, data: { ...counts, resultAt: at, updatedAt: at } },
    }));
    let answers;
    try {
      answers = await modelBatch(steps);
    } catch (error) {
      const problem = new DataError(error instanceof DataError ? error.messageKey : 'error.saveFailed');
      /** @type {any} */ (problem).filled = filled;
      throw problem;
    }
    for (const answer of answers) filled += Number(answer?.count ?? 0);
  }
  return { filled, notMatched, notMatchedDays, left, leftBefore: left > 0 ? oldestDay : null };
}

/**
 * When a share went out, as a local moment: the post's planned day and time
 * when it has a time and "I shared it" was pressed on that day or later (the
 * person shared it as planned, or marked it scheduled), else the moment of
 * the press. Null when neither reads.
 *
 * @param {unknown} sharedAt the version's shared moment (an ISO instant)
 * @param {{ day?: unknown, time?: unknown } | undefined} post
 * @returns {string | null}
 */
export function wentOutAt(sharedAt, post) {
  const pressed = localMoment(sharedAt);
  const day = post?.day;
  const time = post?.time;
  if (pressed !== null && isCivilDay(day) && typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(time) && pressed.slice(0, 10) >= /** @type {string} */ (day)) {
    return `${day}T${time}`;
  }
  return pressed;
}

/**
 * The owner's best times (`bestTimes` in `lib/plan/best-times.js`) from the
 * newest `MOST_RESULT_SHARES` shares with reactions typed (likes, comments,
 * shares or saves) up to `now`, each at the moment it went out on this
 * computer's clock (`wentOutAt`). Only reads (AGENTS.md rule 4a); at most 3
 * calls, one at a time.
 *
 * @param {unknown} ownerId
 * @param {{ now?: string | number }} [options]
 * @returns {Promise<Record<string, import('../plan/best-times.js').PlatformTimes>>}
 */
export async function bestTimesFor(ownerId, { now } = {}) {
  const owner = requireOwner(ownerId);
  const nowIso = new Date(momentOf(now)).toISOString();
  const rows = await readInPages('PostVersion', {
    where: { AND: [{ ownerId: owner, sharedAt: { lte: nowIso } }, { OR: REACTION_COUNTS.map((name) => ({ [name]: { not: null } })) }] },
    order: [['sharedAt', 'desc'], ['id', 'desc']],
    select: { id: true, postId: true, network: true, sharedAt: true, ...Object.fromEntries(REACTION_COUNTS.map((name) => [name, true])) },
    most: MOST_RESULT_SHARES,
    page: RESULT_PAGE,
  });
  const postIds = [...new Set(rows.map((row) => row.postId).filter((id) => Number.isSafeInteger(id)))];
  const posts = new Map();
  if (postIds.length > 0) {
    const answers = await readPacked(inGroups(postIds).map((ids) => ({
      model: 'Post',
      action: 'findMany',
      args: { where: { ownerId: owner, id: { in: ids } }, select: { id: true, day: true, time: true }, orderBy: { id: 'asc' }, take: ids.length },
      bytes: 2 + ids.length * POST_WHEN_ROW,
    })));
    for (const answer of answers) for (const post of Array.isArray(answer) ? answer : []) posts.set(post.id, post);
  }
  return bestTimes(rows
    .filter((row) => isNetworkKey(row.network))
    .map((row) => ({
      network: row.network,
      at: wentOutAt(row.sharedAt, posts.get(row.postId)),
      reactions: REACTION_COUNTS.reduce((total, name) => total + (Number.isSafeInteger(row[name]) ? row[name] : 0), 0),
    })));
}

export { BEST_TIMES };
