/**
 * The records reads of the Results page: what a month and
 * the month before brought, counted by the records themselves (`groupBy`,
 * `count`) so the cost does not grow with the number of shares or customers.
 * Every read names its owner inside the statement's `where` (AGENTS.md rule
 * 1a); nothing here saves (rule 4a). What leaves this file is a plain object;
 * the page's figures are worked out from it in `app/results/figures.js`.
 *
 * A "share" is one post marked shared on one network, with its moment in the
 * month and not after `now` (a version scheduled for later is not shared
 * yet). A share's reactions are its typed likes, comments, shares and saves;
 * "typed" is a share with any of its six numbers typed. A "customer" is an
 * enquiry received in the month; a "sale" is the amount of one that bought.
 *
 * ## How much one read takes
 *
 * `monthFiguresFor` reads both months in one batch (17 steps, all small); a
 * count by post comes back at most `POST_PAGE` (or `NAMED_PAGE`) posts a step
 * and reads on, all such steps together, while one came back full: at most
 * `FIGURE_CALLS` calls, after which the answer says `partial`.
 * `postFactsFor` reads every post the figures name (256 a step) and the few
 * best posts' names and networks in one call (`readPacked`). Each step's
 * answer stays inside 2,048 values: a row by post with its four sums is 12.
 *
 * By code: the first batch also reads the campaigns that have an offer code
 * (`campaignCodesStep`, at most 100) and each month's customers by the code
 * they gave and their status (`CODE_ROWS` rows a month, 10 values a row), so
 * the code counts take no call of their own. A read that comes back full (as
 * many campaigns with a code as `CODES_MOST`, or a month's `CODE_ROWS` rows)
 * may have left codes out: the answer then says `codesPartial`.
 */

import { askOf } from '../plan/asks.js';
import { addDays, addMonths, isCivilDay, isCivilMonth, partsOf } from '../plan/days.js';
import { isNetworkKey, NETWORK_KEYS } from '../plan/networks.js';
import { momentOf } from '../plan/state.js';

import { codeKey } from '../plan/campaign-plans.js';

import { CODES_MOST, campaignCodesOf, campaignCodesStep } from './campaigns.js';
import { followersOf, followersStep } from './followers.js';
import { DataError, modelBatch } from './index.js';
import { inGroups, readPacked } from './read-in-pages.js';

/** The typed counts that make a share's reactions, and the six that make it "typed". */
export const REACTION_COUNTS = Object.freeze(['likes', 'comments', 'shares', 'saves']);
const TYPED_COUNTS = Object.freeze(['views', 'likes', 'comments', 'shares', 'saves', 'clicks']);
/** Posts one count by post answers: a row with its four sums is 12 values (1 + 170 x 12 <= 2,048). */
const POST_PAGE = 170;
/** Posts one count of the customers by post answers (a row is at most 9 values). */
const NAMED_PAGE = 200;
/** The most calls `monthFiguresFor` makes: the first, then the counts by post that came back full. */
export const FIGURE_CALLS = 3;
/** The most posts `postFactsFor` names as best (their names and networks are read). */
export const DETAIL_MOST = 20;
/** Rows of customers by code and status one month reads (a row is 10 values: 1 + 100 x 10 <= 2,048). */
export const CODE_ROWS = 100;

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

const count = (value) => (Number.isSafeInteger(value) ? value : 0);
const sum = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * A month's first and last moment on this computer's clock, and its first
 * day and the day after its last: the whole month, or with `through` (a day
 * of that month) the month's first days up to that day's end.
 *
 * @param {string} month
 * @param {string | null} [through]
 */
function spanOf(month, through = null) {
  const { year, month: number } = partsOf(`${month}-01`);
  if (isCivilDay(through) && /** @type {string} */ (through).startsWith(`${month}-`)) {
    const { day } = partsOf(/** @type {string} */ (through));
    return {
      from: `${month}-01`,
      until: addDays(/** @type {string} */ (through), 1),
      start: new Date(year, number - 1, 1).toISOString(),
      end: new Date(year, number - 1, day + 1).toISOString(),
    };
  }
  return {
    from: `${month}-01`,
    until: `${addMonths(month, 1)}-01`,
    start: new Date(year, number - 1, 1).toISOString(),
    end: new Date(year, number, 1).toISOString(),
  };
}

/** The shares of a month (up to `through`'s end when given) up to `now`. @param {string} owner @param {string} month @param {string} nowIso @param {string | null} [through] */
function sharesWhere(owner, month, nowIso, through = null) {
  const { start, end } = spanOf(month, through);
  return { ownerId: owner, sharedAt: { gte: start, lt: end, lte: nowIso } };
}

const anyOf = (names) => ({ OR: names.map((name) => ({ [name]: { not: null } })) });
const REACTION_SUMS = Object.freeze(Object.fromEntries(REACTION_COUNTS.map((name) => [name, true])));

/**
 * The pageable counts of one month, each `{ key, step(after) }`: by post, its
 * shares with their reaction sums, its shares with reactions typed, its
 * customers and its sales. `after` is the last post id a page before read.
 *
 * @param {string} owner @param {string} month @param {string} nowIso @param {string | null} [through]
 */
function pagedCounts(owner, month, nowIso, through = null) {
  const shares = sharesWhere(owner, month, nowIso, through);
  const { from, until } = spanOf(month, through);
  const enquiries = { ownerId: owner, receivedOn: { gte: from, lt: until } };
  // A version always names its post; an enquiry may name none (`not: null` is refused on a field that cannot be empty).
  const afterPost = (after) => (after === null ? {} : { postId: { gt: after } });
  const namedAfter = (after) => (after === null ? { not: null } : { not: null, gt: after });
  return [
    {
      key: 'byPost', take: POST_PAGE,
      step: (after) => ({ model: 'PostVersion', action: 'groupBy', args: { by: ['postId'], where: { AND: [shares, afterPost(after)] }, _count: { _all: true }, _sum: REACTION_SUMS, orderBy: { postId: 'asc' }, take: POST_PAGE } }),
    },
    {
      key: 'reactedByPost', take: POST_PAGE,
      step: (after) => ({ model: 'PostVersion', action: 'groupBy', args: { by: ['postId'], where: { AND: [shares, anyOf(REACTION_COUNTS), afterPost(after)] }, _count: { _all: true }, orderBy: { postId: 'asc' }, take: POST_PAGE } }),
    },
    {
      key: 'named', take: NAMED_PAGE,
      step: (after) => ({ model: 'Enquiry', action: 'groupBy', args: { by: ['postId'], where: { ...enquiries, postId: namedAfter(after) }, _count: { _all: true }, orderBy: { postId: 'asc' }, take: NAMED_PAGE } }),
    },
    {
      key: 'namedBought', take: NAMED_PAGE,
      step: (after) => ({ model: 'Enquiry', action: 'groupBy', args: { by: ['postId'], where: { ...enquiries, status: 'bought', postId: namedAfter(after) }, _count: { _all: true }, _sum: { amount: true }, orderBy: { postId: 'asc' }, take: NAMED_PAGE } }),
    },
  ];
}

/**
 * The counts of one month read whole in one step each: by network, its shares
 * with their reaction sums and its shares with reactions typed; the shares
 * with any number typed; the customers by channel and status with their
 * amounts.
 *
 * @param {string} owner @param {string} month @param {string} nowIso @param {string | null} [through]
 */
function wholeCounts(owner, month, nowIso, through = null) {
  const shares = sharesWhere(owner, month, nowIso, through);
  const { from, until } = spanOf(month, through);
  return [
    { key: 'byNetwork', step: { model: 'PostVersion', action: 'groupBy', args: { by: ['network'], where: shares, _count: { _all: true }, _sum: REACTION_SUMS } } },
    { key: 'reactedByNetwork', step: { model: 'PostVersion', action: 'groupBy', args: { by: ['network'], where: { AND: [shares, anyOf(REACTION_COUNTS)] }, _count: { _all: true } } } },
    { key: 'typed', step: { model: 'PostVersion', action: 'count', args: { where: { AND: [shares, anyOf(TYPED_COUNTS)] } } } },
    { key: 'byChannel', step: { model: 'Enquiry', action: 'groupBy', args: { by: ['channel', 'status'], where: { ownerId: owner, receivedOn: { gte: from, lt: until } }, _count: { _all: true }, _sum: { amount: true } } } },
  ];
}

/**
 * The step that counts one month's customers by the offer code they gave
 * (none left out) and their status, with the amounts of those that bought.
 *
 * @param {string} owner @param {string} month @param {string | null} [through]
 */
function codeStep(owner, month, through = null) {
  const { from, until } = spanOf(month, through);
  return {
    model: 'Enquiry', action: 'groupBy',
    args: { by: ['code', 'status'], where: { ownerId: owner, receivedOn: { gte: from, lt: until }, code: { not: '' } }, _count: { _all: true }, _sum: { amount: true }, orderBy: [{ code: 'asc' }, { status: 'asc' }], take: CODE_ROWS },
  };
}

/** Adds a month's customers by code (`codeStep`'s answer) to its counts, by `codeKey`. @param {MonthCounts} counts @param {unknown} answer */
function takeCodes(counts, answer) {
  for (const row of Array.isArray(answer) ? answer : []) {
    const key = codeKey(row?.code);
    if (key === '') continue;
    counts.byCode[key] ??= { customers: 0, bought: 0, sales: 0 };
    const code = counts.byCode[key];
    code.customers += count(row?._count?._all);
    if (row.status === 'bought') {
      code.bought += count(row?._count?._all);
      code.sales += sum(row?._sum?.amount);
    }
  }
}

/** A reaction sum of a row's `_sum`, or null when none of the four was typed in the group. @param {any} row */
function reactionSum(row) {
  return REACTION_COUNTS.reduce((total, name) => total + sum(row?._sum?.[name]), 0);
}

/**
 * @typedef {{ shares: number, reacted: number, reactions: number }} ShareCounts
 * @typedef {{ shares: number, reacted: number, reactions: number, customers: number, bought: number, sales: number }} PostCounts
 * @typedef {{
 *   shares: number, typed: number, customers: number, bought: number, sales: number,
 *   byNetwork: Record<string, ShareCounts>,
 *   byPost: Record<number, PostCounts>,
 *   byChannel: Record<string, { customers: number, bought: number, sales: number }>,
 *   byCode: Record<string, { customers: number, bought: number, sales: number }>,
 *   followers: Record<string, number>,
 * }} MonthCounts
 */

/** @returns {MonthCounts} */
function emptyMonth() {
  return { shares: 0, typed: 0, customers: 0, bought: 0, sales: 0, byNetwork: {}, byPost: {}, byChannel: {}, byCode: {}, followers: {} };
}

/** @param {MonthCounts} counts @param {number} postId */
function postOf(counts, postId) {
  counts.byPost[postId] ??= { shares: 0, reacted: 0, reactions: 0, customers: 0, bought: 0, sales: 0 };
  return counts.byPost[postId];
}

/**
 * What `months` (each a `YYYY-MM`, at most two: the month and the month
 * before) brought, up to `now` (an ISO instant or milliseconds; the computer's
 * clock when left out): `{ months: { [month]: MonthCounts }, partial }`.
 *
 * - `shares`, `typed`: the shares, and those with any number typed;
 * - `byNetwork[network]`: its `shares`, `reacted` (those with reactions
 *   typed) and `reactions` (their typed reactions added up);
 * - `byPost[postId]`: the same for each post shared in the month, with the
 *   month's `customers` whose enquiry names it, how many of them `bought`
 *   and their `sales`; a post named by an enquiry and not shared in the
 *   month is there with no shares;
 * - `customers`, `bought`, `sales`: the month's enquiries, those that
 *   bought, and what those paid (an empty amount counts as 0);
 * - `byChannel[channel]`: the same for each place they came from;
 * - `byCode[key]`: the same for each offer code they gave (by `codeKey`, so
 *   `kış20` and `KIŞ20` count together);
 * - `followers[network]`: the number the person typed for the month.
 *
 * `codes` lists the campaigns that have an offer code (`campaignCodesOf`);
 * `codesPartial` is true when the campaigns with a code, or a month's
 * customers by code, filled their read (`CODES_MOST`, `CODE_ROWS`): By code
 * may then leave some codes out, and Results says so.
 *
 * `through` (`{ [month]: day }`) counts a month only up to the end of that
 * day of it: the month before, compared with a month still running, over the
 * same days. Followers stay the month's number.
 *
 * `partial` is true when a month held more posts than `FIGURE_CALLS` calls
 * read by post (more than 510 shared, or 600 named by its enquiries): the
 * totals stay whole, the counts by post leave the rest out.
 *
 * Calls: one, and one more for each page by post a full month needs, at most
 * `FIGURE_CALLS`.
 *
 * @param {unknown} ownerId
 * @param {string[]} months
 * @param {{ now?: string | number, through?: Record<string, string> }} [options]
 * @returns {Promise<{ months: Record<string, MonthCounts>, partial: boolean, codes: ReturnType<typeof campaignCodesOf>, codesPartial: boolean }>}
 */
export async function monthFiguresFor(ownerId, months, { now, through = {} } = {}) {
  const owner = ownerOf(ownerId);
  if (!Array.isArray(months) || months.length === 0 || months.length > 2 || months.some((month) => !isCivilMonth(month)) || new Set(months).size !== months.length) {
    throw new DataError('refuse.request');
  }
  const nowIso = new Date(momentOf(now)).toISOString();
  /** @type {Record<string, MonthCounts>} */
  const counts = Object.fromEntries(months.map((month) => [month, emptyMonth()]));

  const cut = (month) => (through !== null && typeof through === 'object' && Object.hasOwn(through, month) ? through[month] : null);
  const whole = months.flatMap((month) => wholeCounts(owner, month, nowIso, cut(month)).map((item) => ({ ...item, month })));
  /** @type {Array<{ month: string, key: string, take: number, step: (after: number | null) => any, after: number | null }>} */
  let paged = months.flatMap((month) => pagedCounts(owner, month, nowIso, cut(month)).map((item) => ({ ...item, month, after: null })));
  const codeSteps = months.map((month) => codeStep(owner, month, cut(month)));
  const first = await modelBatch([
    ...whole.map((item) => item.step), followersStep(owner, months), campaignCodesStep(owner), ...codeSteps, ...paged.map((item) => item.step(null)),
  ]);

  whole.forEach((item, index) => takeWhole(counts[item.month], item.key, first[index]));
  const followers = followersOf(first[whole.length], months);
  for (const month of months) counts[month].followers = followers[month];
  const codes = campaignCodesOf(first[whole.length + 1]);
  months.forEach((month, index) => takeCodes(counts[month], first[whole.length + 2 + index]));
  const full = (answer, most) => Array.isArray(answer) && answer.length >= most;
  const codesPartial = full(first[whole.length + 1], CODES_MOST) || months.some((_, index) => full(first[whole.length + 2 + index], CODE_ROWS));

  let answers = first.slice(whole.length + 2 + codeSteps.length);
  let partial = false;
  for (let calls = 1; ; calls += 1) {
    const more = [];
    paged.forEach((item, index) => {
      const rows = Array.isArray(answers[index]) ? answers[index] : [];
      takePaged(counts[item.month], item.key, rows);
      if (rows.length >= item.take) more.push({ ...item, after: rows.at(-1).postId });
    });
    if (more.length === 0) break;
    if (calls >= FIGURE_CALLS) {
      partial = true;
      break;
    }
    paged = more;
    answers = await modelBatch(paged.map((item) => item.step(item.after)));
  }
  return { months: counts, partial, codes, codesPartial };
}

/** @param {MonthCounts} counts @param {string} key @param {any} answer */
function takeWhole(counts, key, answer) {
  if (key === 'typed') {
    counts.typed = count(answer);
    return;
  }
  for (const row of Array.isArray(answer) ? answer : []) {
    const rows = count(row?._count?._all);
    if (key === 'byNetwork' || key === 'reactedByNetwork') {
      if (!isNetworkKey(row.network)) continue;
      counts.byNetwork[row.network] ??= { shares: 0, reacted: 0, reactions: 0 };
      const network = counts.byNetwork[row.network];
      if (key === 'byNetwork') {
        network.shares += rows;
        network.reactions += reactionSum(row);
        counts.shares += rows;
      } else {
        network.reacted += rows;
      }
    } else if (key === 'byChannel') {
      const channel = String(row.channel);
      counts.byChannel[channel] ??= { customers: 0, bought: 0, sales: 0 };
      counts.byChannel[channel].customers += rows;
      counts.customers += rows;
      if (row.status === 'bought') {
        counts.byChannel[channel].bought += rows;
        counts.byChannel[channel].sales += sum(row?._sum?.amount);
        counts.bought += rows;
        counts.sales += sum(row?._sum?.amount);
      }
    }
  }
}

/** @param {MonthCounts} counts @param {string} key @param {any[]} rows */
function takePaged(counts, key, rows) {
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.postId)) continue;
    const post = postOf(counts, row.postId);
    const rowsCounted = count(row?._count?._all);
    if (key === 'byPost') {
      post.shares += rowsCounted;
      post.reactions += reactionSum(row);
    } else if (key === 'reactedByPost') {
      post.reacted += rowsCounted;
    } else if (key === 'named') {
      post.customers += rowsCounted;
    } else if (key === 'namedBought') {
      post.bought += rowsCounted;
      post.sales += sum(row?._sum?.amount);
    }
  }
}

/** The worst bytes of one row of a post's facts (`{ id, themeId, ask }`) and of a best post's (`{ id, name, day }`), as a records answer writes them. */
const FACT_ROW = 64;
const DETAIL_ROW = 220;
const NETWORK_ROW = 90;

/**
 * What the figures need of the posts they name: each post's theme and ask,
 * and for the best ones (`detail`, at most `DETAIL_MOST`) their name, day and
 * the networks they were shared on in `month` up to `now` (in the networks'
 * order). Another owner's post, or one gone, is left out. One call for up to
 * about 7,000 posts (`readPacked`).
 *
 * @param {unknown} ownerId
 * @param {unknown[]} postIds
 * @param {{ detail?: number[], month?: string, now?: string | number }} [options]
 * @returns {Promise<{ facts: Record<number, { themeId: number | null, ask: string }>,
 *   detail: Record<number, { name: string, day: string | null, networks: string[] }> }>}
 */
export async function postFactsFor(ownerId, postIds, { detail = [], month, now } = {}) {
  const owner = ownerOf(ownerId);
  const ids = [...new Set((Array.isArray(postIds) ? postIds : []).filter((id) => Number.isSafeInteger(id) && id >= 1))];
  const best = [...new Set(detail.filter((id) => Number.isSafeInteger(id) && id >= 1))].slice(0, DETAIL_MOST);
  if (best.length > 0 && !isCivilMonth(month)) throw new DataError('refuse.request');
  const steps = inGroups(ids).map((group) => ({
    model: 'Post', action: 'findMany',
    args: { where: { ownerId: owner, id: { in: group } }, select: { id: true, themeId: true, ask: true }, orderBy: { id: 'asc' }, take: group.length },
    bytes: 2 + FACT_ROW * group.length,
  }));
  const factSteps = steps.length;
  if (best.length > 0) {
    steps.push(
      {
        model: 'Post', action: 'findMany',
        args: { where: { ownerId: owner, id: { in: best } }, select: { id: true, name: true, day: true }, orderBy: { id: 'asc' }, take: best.length },
        bytes: 2 + DETAIL_ROW * best.length,
      },
      {
        model: 'PostVersion', action: 'findMany',
        args: {
          where: { ...sharesWhere(owner, /** @type {string} */ (month), new Date(momentOf(now)).toISOString()), postId: { in: best } },
          select: { id: true, postId: true, network: true },
          orderBy: { id: 'asc' },
          take: best.length * NETWORK_KEYS.length,
        },
        bytes: 2 + NETWORK_ROW * best.length * NETWORK_KEYS.length,
      },
    );
  }
  if (steps.length === 0) return { facts: {}, detail: {} };
  const answers = await readPacked(steps);
  /** @type {Record<number, { themeId: number | null, ask: string }>} */
  const facts = {};
  for (const row of answers.slice(0, factSteps).flatMap((answer) => (Array.isArray(answer) ? answer : []))) {
    facts[row.id] = { themeId: Number.isSafeInteger(row.themeId) ? row.themeId : null, ask: askOf(row.ask) };
  }
  /** @type {Record<number, { name: string, day: string | null, networks: string[] }>} */
  const named = {};
  if (best.length > 0) {
    const [posts, versions] = answers.slice(factSteps);
    for (const row of Array.isArray(posts) ? posts : []) {
      named[row.id] = { name: typeof row.name === 'string' ? row.name : '', day: typeof row.day === 'string' ? row.day : null, networks: [] };
    }
    for (const row of Array.isArray(versions) ? versions : []) {
      if (named[row.postId] !== undefined && isNetworkKey(row.network)) named[row.postId].networks.push(row.network);
    }
    for (const item of Object.values(named)) item.networks.sort((a, b) => NETWORK_KEYS.indexOf(a) - NETWORK_KEYS.indexOf(b));
  }
  return { facts, detail: named };
}
