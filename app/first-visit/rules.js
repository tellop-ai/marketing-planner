/**
 * The first-visit start, pure: the browser loads it, the start address reads
 * its request with it, and the checks call it directly. Nothing runs when
 * this file loads.
 *
 * The start shows on the calendar when the profile has no business name and
 * no post exists (`mayBeFirstVisit`, then one records call, `./read.js`). It
 * asks three short things: the business's name, two platforms and three
 * themes from the built-in theme ideas, then makes the first four posts of
 * the next seven days through Fill my month (or without AI). Skip keeps it
 * closed on this computer through the browser's storage, never a record;
 * Escape or the window's close leave it for this visit only (`closeStart`).
 */

import { addDays, isCivilDay, monthOf } from '../../lib/plan/days.js';
import { LIMITS, readWords } from '../../lib/plan/limits.js';
import { isNetworkKey } from '../../lib/plan/networks.js';

import { STARTERS_EACH } from '../ideas/groups.js';

/**
 * The built-in theme ideas, in the order the start shows them: the same kinds
 * as Ideas' idea starters (`ideas.starter.<key>.<n>`), so a post made without
 * AI is named from its theme's starters. Only offers sell (posts that ask
 * people to buy), so a first plan does not lean on selling.
 */
export const THEME_IDEAS = Object.freeze([
  Object.freeze({ key: 'behind', sells: false }),
  Object.freeze({ key: 'made', sells: false }),
  Object.freeze({ key: 'product', sells: false }),
  Object.freeze({ key: 'customer', sells: false }),
  Object.freeze({ key: 'offer', sells: true }),
  Object.freeze({ key: 'question', sells: false }),
]);

/** The keys of the theme ideas. */
export const IDEA_KEYS = Object.freeze(THEME_IDEAS.map((idea) => idea.key));

/** The theme ideas already picked when the start opens (none of them sells). */
export const FIRST_IDEAS = Object.freeze(['behind', 'product', 'customer']);

/** The most platforms and themes the start takes. */
export const START_MOST = Object.freeze({ networks: 2, themes: 3 });

/** How many posts the start makes, and over how many days from today. */
export const FIRST_POSTS = 4;
export const WINDOW_DAYS = 7;

/**
 * Posts a week asked of Fill my month: every week the seven days touch then
 * offers at least `FIRST_POSTS` free days, so the days to choose from are many.
 */
export const POSTS_A_WEEK = 4;

/** The browser storage key that keeps the start closed after Skip. */
export const SKIP_STORE_NAME = 'marketing-planner.first-visit.skipped';

/**
 * Whether the calendar's own read leaves room for a first visit: no business
 * name and no post among what it read (the shown days, the ideas, the post
 * due). Only then does the page ask the records whether any post exists.
 *
 * @param {{ business?: string, tiles?: unknown[], ideas?: unknown[], due?: unknown }} calendar
 */
export function mayBeFirstVisit(calendar) {
  return String(calendar?.business ?? '').trim() === ''
    && (calendar?.tiles?.length ?? 0) === 0
    && (calendar?.ideas?.length ?? 0) === 0
    && !calendar?.due;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * `POST /api/plan/start { businessName, networks, themes }`: a business name
 * (required, `LIMITS.profileField`), 1 to 2 different platforms, and 1 to 3
 * different theme ideas. A refusal names its field.
 *
 * @param {unknown} body
 * @returns {{ ok: true, value: { businessName: string, networks: string[], themes: string[] } } | { ok: false, problem: string, field?: string }}
 */
export function readStart(body) {
  if (!isPlainObject(body)) return { ok: false, problem: 'refuse.request' };
  const { businessName, networks, themes, ...rest } = /** @type {Record<string, unknown>} */ (body);
  if (Object.keys(rest).length > 0) return { ok: false, problem: 'refuse.request' };
  const name = readWords(businessName, LIMITS.profileField, { required: true });
  if (!name.ok) return { ok: false, problem: name.problem, field: 'businessName' };
  if (!Array.isArray(networks) || networks.length < 1 || networks.length > START_MOST.networks
    || !networks.every(isNetworkKey) || new Set(networks).size !== networks.length) {
    return { ok: false, problem: 'refuse.request', field: 'networks' };
  }
  if (!Array.isArray(themes) || themes.length < 1 || themes.length > START_MOST.themes
    || !themes.every((key) => IDEA_KEYS.includes(/** @type {string} */ (key))) || new Set(themes).size !== themes.length) {
    return { ok: false, problem: 'refuse.request', field: 'themes' };
  }
  return { ok: true, value: { businessName: name.value, networks: /** @type {string[]} */ (networks), themes: /** @type {string[]} */ (themes) } };
}

/**
 * The seven days from today: the first and the last, and the one or two
 * months they touch, in order.
 *
 * @param {string} today
 */
export function windowOf(today) {
  const to = addDays(today, WINDOW_DAYS - 1);
  const first = monthOf(today);
  return { from: today, to, months: monthOf(to) === first ? [first] : [first, monthOf(to)] };
}

/**
 * The proposals that fall in the seven days from today, one a day (the first
 * of a day), in day order. Anything that is not a proposal is left out.
 *
 * @template {{ day: string, name: string }} P
 * @param {P[]} proposals
 * @param {string} today
 * @returns {P[]}
 */
export function inWindow(proposals, today) {
  const { from, to } = windowOf(today);
  const seen = new Set();
  return (Array.isArray(proposals) ? proposals : [])
    .filter((item) => isPlainObject(item) && isCivilDay(item.day) && typeof item.name === 'string' && item.day >= from && item.day <= to)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .filter((item) => (seen.has(item.day) ? false : (seen.add(item.day), true)));
}

/**
 * `count` of the proposals, spread over their days: all of them when there
 * are no more, else the first, the last and those evenly between (each
 * index once), in day order.
 *
 * @template {{ day: string }} P
 * @param {P[]} proposals in day order
 * @param {number} [count]
 * @returns {P[]}
 */
export function spreadPick(proposals, count = FIRST_POSTS) {
  if (proposals.length <= count) return [...proposals];
  if (count <= 1) return proposals.slice(0, Math.max(0, count));
  const step = (proposals.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => proposals[Math.round(index * step)]);
}

/**
 * Names proposals made without AI from the idea starters of their theme's
 * idea, in turn (the first post of a theme takes its first starter). A
 * proposal for a special day keeps its day's name, and one whose theme came
 * from no idea keeps the name it has.
 *
 * @template {{ name: string, themeId: number | null, specialDay?: string | null }} P
 * @param {P[]} proposals
 * @param {Map<number, string>} ideaOf the idea key of each theme made from one
 * @param {(key: string) => string} words
 * @returns {P[]}
 */
export function starterNamed(proposals, ideaOf, words) {
  /** @type {Map<string, number>} */
  const used = new Map();
  return proposals.map((proposal) => {
    const idea = proposal.themeId === null ? undefined : ideaOf.get(proposal.themeId);
    if (proposal.specialDay || !idea || !IDEA_KEYS.includes(idea)) return proposal;
    const turn = used.get(idea) ?? 0;
    used.set(idea, turn + 1);
    const name = words(`ideas.starter.${idea}.${(turn % STARTERS_EACH) + 1}`);
    return typeof name === 'string' && name.trim() !== '' ? { ...proposal, name: Array.from(name.trim()).slice(0, LIMITS.name).join('') } : proposal;
  });
}

/**
 * The picked proposals of each month, months in order (each month is kept by
 * its own Keep request).
 *
 * @template {{ day: string }} P
 * @param {P[]} picks
 * @returns {Array<{ month: string, proposals: P[] }>}
 */
export function byMonth(picks) {
  /** @type {Map<string, P[]>} */
  const months = new Map();
  for (const pick of picks) months.set(monthOf(pick.day), [...(months.get(monthOf(pick.day)) ?? []), pick]);
  return [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, proposals]) => ({ month, proposals }));
}

/**
 * Whether Skip was pressed on this computer. A storage that cannot be read
 * (blocked, private) answers false: the start may show again next time.
 *
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 */
export function isSkipped(storage) {
  try {
    return storage?.getItem(SKIP_STORE_NAME) === '1';
  } catch {
    return false;
  }
}

/**
 * Remembers Skip on this computer; false when the storage refused.
 *
 * @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage
 */
export function rememberSkip(storage) {
  try {
    if (!storage) return false;
    storage.setItem(SKIP_STORE_NAME, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * What closing the start keeps: **Skip** (`how` `'skip'`) keeps it closed on
 * this computer (`rememberSkip`); Escape or the window's own close (any other
 * `how`) leave it for this visit only and remember nothing. Answers whether
 * the storage now holds the Skip.
 *
 * @param {'skip' | 'close'} how
 * @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage
 */
export function closeStart(how, storage) {
  return how === 'skip' ? rememberSkip(storage) : false;
}

/**
 * The browser's storage, or null where there is none or reading it throws.
 */
export function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
