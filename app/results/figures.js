/**
 * What the Results page and its spreadsheet file work out from the records'
 * counts (`lib/data/results.js`) and the shares of a month (`listSharedFor`),
 * pure, so the checks call it directly.
 *
 * A "shared post" is one share: a post marked shared on one network. Its
 * reactions are its likes, comments, shares and saves together, and only the
 * numbers the person typed count: a share with none of the four typed has no
 * reactions (null), never zero, so it is left out of every average. A group
 * with no typed reactions has no average.
 *
 * No import here reaches the records: the page and the address read them and
 * hand the rows in.
 */

import { t } from '../../lib/i18n/index.js';
import { ASKS } from '../../lib/plan/asks.js';
import { joinWords } from '../../lib/plan/count.js';
import { csvText } from '../../lib/plan/csv.js';
import { OWN_CHANNELS } from '../../lib/plan/customer-choices.js';
import { todayCivil } from '../../lib/plan/days.js';
import { RESULT_COUNTS } from '../../lib/plan/limits.js';
import { isNetworkKey, NETWORK_KEYS, networkByKey } from '../../lib/plan/networks.js';

/** The typed counts that make a share's reactions. */
export const REACTION_COUNTS = Object.freeze(['likes', 'comments', 'shares', 'saves']);
/** How many best posts the page shows. */
export const BEST_MOST = 5;

/**
 * @typedef {{ postId: number, name: string, day: string | null, themeId: number | null, network: string,
 *   sharedAt: string, sharedLink?: string | null, views: number | null, likes: number | null, comments: number | null,
 *   shares: number | null, saves: number | null, clicks: number | null, resultNote: string,
 *   text?: string | null, hashtags?: string | null }} Share
 */

/** @param {unknown} value */
const typed = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * A share's reactions: the typed ones of likes, comments, shares and saves
 * added up, or null when none of the four was typed.
 *
 * @param {Share} share
 * @returns {number | null}
 */
export function reactionsOf(share) {
  const counts = REACTION_COUNTS.map((name) => share?.[name]).filter(typed);
  return counts.length === 0 ? null : counts.reduce((sum, value) => sum + value, 0);
}

/** Whether the person typed any number for this share. @param {Share} share */
export function hasResults(share) {
  return RESULT_COUNTS.some((name) => typed(share?.[name]));
}

/**
 * The average of the values that are numbers, or null when there are none.
 *
 * @param {(number | null)[]} values
 * @returns {number | null}
 */
export function averageOf(values) {
  const counted = values.filter(typed);
  return counted.length === 0 ? null : counted.reduce((sum, value) => sum + value, 0) / counted.length;
}

/** @param {string} network */
const networkPlace = (network) => {
  const place = NETWORK_KEYS.indexOf(network);
  return place === -1 ? NETWORK_KEYS.length : place;
};

/**
 * A number this month and the month before (`last`), as every figure on the
 * Results page shows it.
 *
 * @typedef {{ value: number, last: number }} Pair
 * @typedef {{ value: number | null, last: number | null }} AveragePair
 */

/** @typedef {import('../../lib/data/results.js').MonthCounts} MonthCounts */
/** @typedef {import('../../lib/data/results.js').PostCounts} PostCounts */

/** @param {number} value @param {number} last @returns {Pair} */
const pair = (value, last) => ({ value, last });
/** @param {number} total @param {number} counted */
const average = (total, counted) => (counted > 0 ? total / counted : null);
/** Whether a group brought anything in either month. @param {Record<string, Pair | AveragePair>} row @param {string[]} names */
const anyOf = (row, names) => names.some((name) => (row[name].value ?? 0) !== 0 || (row[name].last ?? 0) !== 0);

/**
 * A post's reactions in a month: its shares' typed reactions added up, or
 * null when none of its shares has reactions typed.
 *
 * @param {PostCounts | undefined} post
 */
export function postReactions(post) {
  return post !== undefined && post.reacted > 0 ? post.reactions : null;
}

/**
 * The best posts of a month, at most `most`: the most customers first, then
 * the most sales, then the most reactions (none typed counts as below 0),
 * then the newer post. A post that brought no customer, no sale and no
 * reaction is not among them. Pure: works on `monthFiguresFor`'s counts.
 *
 * @param {MonthCounts} month
 * @param {number} [most]
 * @returns {number[]} the posts' ids, best first
 */
export function bestPostIds(month, most = BEST_MOST) {
  return Object.entries(month?.byPost ?? {})
    .map(([id, post]) => ({ id: Number(id), customers: post.customers, sales: post.sales, reactions: postReactions(post) }))
    .filter((post) => post.customers > 0 || post.sales > 0 || (post.reactions ?? 0) > 0)
    .sort((a, b) => b.customers - a.customers || b.sales - a.sales || (b.reactions ?? -1) - (a.reactions ?? -1) || b.id - a.id)
    .slice(0, most)
    .map((post) => post.id);
}

/**
 * The Results page's figures for `month`, each paired with `last` (the month
 * before), from `monthFiguresFor`'s counts and `postFactsFor`'s facts (customers and sales first, reactions optional). Pure.
 *
 * - `totals`: `shares`, `typed`, `customers`, `bought`, `sales`, and
 *   `noPost` (`customers`, `sales` of the enquiries naming no post);
 * - `byTheme`: per theme of the posts shared or named in either month (the
 *   plan's order, `themeId` null last: a post with no theme, or one gone):
 *   `shares`, `customers` and `sales` (the enquiries naming its posts) and
 *   `reactions` (the average a share with reactions typed, null with none);
 * - `byNetwork`: per network with shares, customers or sales in either month
 *   (the networks' order): `shares`, `customers` and `sales` (the enquiries
 *   that came from that network), `reactions` (as above);
 * - `byChannel`: per other place customers came from (`OWN_CHANNELS` that
 *   are not networks), `customers` and `sales`;
 * - `byAsk`: per post's ask (`ASKS`, then `''`, no ask): `shares`, `customers`,
 *   `sales`;
 * - `best`: `bestPostIds` with each post's `name`, `day`, `themeId`, `ask`,
 *   the `networks` it was shared on this month, `customers`, `sales` and
 *   `reactions` (this month only);
 * - `followers`: per network of the plan (its order), then any other with a
 *   number in either month: `count` and `last` (null when none was typed).
 *
 * Each list leaves out a row whose numbers are all 0 in both months.
 *
 * @param {{ month: string, last: string, counts: Record<string, MonthCounts>,
 *   facts: Record<number, { themeId: number | null, ask: string }>,
 *   detail?: Record<number, { name: string, day: string | null, networks: string[] }>,
 *   best?: number[], themeOrder?: number[], networks?: string[] }} input
 */
export function resultsFigures({ month, last, counts, facts, detail = {}, best = [], themeOrder = [], networks = [] }) {
  const now = counts[month] ?? emptyCounts();
  const before = counts[last] ?? emptyCounts();
  const both = (pick) => pair(pick(now), pick(before));
  const named = (counted) => Object.values(counted.byPost).reduce((total, post) => ({ customers: total.customers + post.customers, sales: total.sales + post.sales }), { customers: 0, sales: 0 });
  const [namedNow, namedBefore] = [named(now), named(before)];
  const totals = {
    shares: both((item) => item.shares),
    typed: both((item) => item.typed),
    customers: both((item) => item.customers),
    bought: both((item) => item.bought),
    sales: both((item) => item.sales),
    noPost: {
      customers: pair(Math.max(0, now.customers - namedNow.customers), Math.max(0, before.customers - namedBefore.customers)),
      sales: pair(Math.max(0, now.sales - namedNow.sales), Math.max(0, before.sales - namedBefore.sales)),
    },
  };

  /** Each post's counts added up into groups by `keyOf(post id)`. */
  const grouped = (keyOf) => {
    const groups = new Map();
    for (const [index, counted] of [now, before].entries()) {
      for (const [id, post] of Object.entries(counted.byPost)) {
        const key = keyOf(Number(id));
        const group = groups.get(key) ?? [emptyGroup(), emptyGroup()];
        const into = group[index];
        into.shares += post.shares;
        into.reacted += post.reacted;
        into.reactions += post.reactions;
        into.customers += post.customers;
        into.sales += post.sales;
        groups.set(key, group);
      }
    }
    return groups;
  };
  const themePlace = (id) => {
    if (id === null) return Number.MAX_SAFE_INTEGER;
    const place = themeOrder.indexOf(id);
    return place === -1 ? themeOrder.length : place;
  };
  const byTheme = [...grouped((id) => facts[id]?.themeId ?? null).entries()]
    .sort(([a], [b]) => themePlace(a) - themePlace(b) || (a ?? 0) - (b ?? 0))
    .map(([themeId, [value, prior]]) => ({
      themeId,
      shares: pair(value.shares, prior.shares),
      customers: pair(value.customers, prior.customers),
      sales: pair(value.sales, prior.sales),
      reactions: { value: average(value.reactions, value.reacted), last: average(prior.reactions, prior.reacted) },
    }))
    .filter((row) => anyOf(row, ['shares', 'customers', 'sales']));
  const askPlace = (ask) => (ask === '' ? ASKS.length : ASKS.indexOf(ask));
  const byAsk = [...grouped((id) => facts[id]?.ask ?? '').entries()]
    .sort(([a], [b]) => askPlace(a) - askPlace(b))
    .map(([ask, [value, prior]]) => ({ ask, shares: pair(value.shares, prior.shares), customers: pair(value.customers, prior.customers), sales: pair(value.sales, prior.sales) }))
    .filter((row) => anyOf(row, ['shares', 'customers', 'sales']));

  const shareOf = (counted, network) => counted.byNetwork[network] ?? { shares: 0, reacted: 0, reactions: 0 };
  const cameOf = (counted, channel) => counted.byChannel[channel] ?? { customers: 0, bought: 0, sales: 0 };
  const byNetwork = NETWORK_KEYS
    .map((network) => {
      const [value, prior] = [shareOf(now, network), shareOf(before, network)];
      const [came, cameBefore] = [cameOf(now, network), cameOf(before, network)];
      return {
        network,
        shares: pair(value.shares, prior.shares),
        customers: pair(came.customers, cameBefore.customers),
        sales: pair(came.sales, cameBefore.sales),
        reactions: { value: average(value.reactions, value.reacted), last: average(prior.reactions, prior.reacted) },
      };
    })
    .filter((row) => anyOf(row, ['shares', 'customers', 'sales']));
  const byChannel = OWN_CHANNELS.filter((channel) => !isNetworkKey(channel))
    .map((channel) => ({ channel, customers: pair(cameOf(now, channel).customers, cameOf(before, channel).customers), sales: pair(cameOf(now, channel).sales, cameOf(before, channel).sales) }))
    .filter((row) => anyOf(row, ['customers', 'sales']));

  const bestPosts = best.filter((id) => now.byPost[id] !== undefined).map((id) => {
    const post = now.byPost[id];
    return {
      postId: id,
      name: detail[id]?.name ?? '',
      day: detail[id]?.day ?? null,
      themeId: facts[id]?.themeId ?? null,
      ask: facts[id]?.ask ?? '',
      networks: detail[id]?.networks ?? [],
      customers: post.customers,
      sales: post.sales,
      reactions: postReactions(post),
    };
  });

  const typedNetworks = new Set([...Object.keys(now.followers), ...Object.keys(before.followers)]);
  const followerNetworks = [...networks.filter((network) => isNetworkKey(network)), ...NETWORK_KEYS.filter((network) => !networks.includes(network) && typedNetworks.has(network))];
  const followers = [...new Set(followerNetworks)].map((network) => ({ network, count: now.followers[network] ?? null, last: before.followers[network] ?? null }));

  return { totals, byTheme, byNetwork, byChannel, byAsk, best: bestPosts, followers };
}

/** @returns {MonthCounts} */
function emptyCounts() {
  return { shares: 0, typed: 0, customers: 0, bought: 0, sales: 0, byNetwork: {}, byPost: {}, byChannel: {}, followers: {} };
}

function emptyGroup() {
  return { shares: 0, reacted: 0, reactions: 0, customers: 0, sales: 0 };
}

/**
 * The civil day (this computer's clock, as the shares were read) of a saved
 * instant, or null when it is not one. The one such reader: the post maker's
 * share step uses it too.
 *
 * @param {unknown} instant
 * @returns {string | null}
 */
export function dayOfInstant(instant) {
  if (typeof instant !== 'string' || instant === '') return null;
  const date = new Date(instant);
  return Number.isFinite(date.getTime()) ? todayCivil(date) : null;
}

/**
 * The spreadsheet file's text: a row of headings in the app's language, then
 * one row a share, the earliest shared first (on the same moment, in the
 * networks' order): its day, the post's name, its theme, the network, the
 * day it was shared, the address the person gave, the words as shared there
 * (the words and the hashtags), the six numbers and the note. A share whose
 * words were not read (`text` null: more shares than one download can read
 * words for) has its words cell empty, and a last row says how many
 * (`results.export.wordsLeftOut`). Every cell that could run as a formula is
 * guarded (`csvText`).
 *
 * @param {Share[]} shares
 * @param {{ themeNames: Map<number, string>, locale: string }} options
 */
export function postsCsv(shares, { themeNames, locale }) {
  const headings = ['day', 'post', 'theme', 'network', 'sharedDay', 'address', 'words', ...RESULT_COUNTS, 'note']
    .map((key) => t(`results.export.${key}`, locale));
  const inOrder = [...shares].sort((a, b) => (a.sharedAt === b.sharedAt ? 0 : a.sharedAt < b.sharedAt ? -1 : 1)
    || networkPlace(a.network) - networkPlace(b.network)
    || a.postId - b.postId);
  const rows = inOrder.map((share) => [
    share.day ?? '',
    share.name || t('post.untitled', locale),
    share.themeId === null ? '' : (themeNames.get(share.themeId) ?? ''),
    networkByKey(share.network)?.name ?? share.network,
    dayOfInstant(share.sharedAt),
    share.sharedLink ?? '',
    typeof share.text === 'string' ? joinWords(share.text, share.hashtags ?? '') : '',
    ...RESULT_COUNTS.map((name) => (typed(share[name]) ? share[name] : null)),
    share.resultNote,
  ]);
  const leftOut = inOrder.filter((share) => typeof share.text !== 'string').length;
  const note = leftOut === 0 ? [] : [[t('results.export.wordsLeftOut', locale, { count: String(leftOut) })]];
  return csvText([headings, ...rows, ...note]);
}
