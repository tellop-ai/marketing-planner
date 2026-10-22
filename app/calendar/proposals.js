/**
 * Fill my month without AI, and keeping proposals: the requests the two month
 * addresses read, and the names a plan without AI gives its proposals. Pure:
 * no records, no page.
 *
 * A proposal is `{ day, name, themeId, specialDay? }`: an idea for a day of the
 * month, in a theme, maybe for a special day. Nothing is kept until the person
 * presses Keep these.
 */

import { addDays, civilDay, daysInMonth, isCivilDay, isCivilMonth, monthOf, partsOf } from '../../lib/plan/days.js';
import { LIMITS, readWords } from '../../lib/plan/limits.js';
import { emptySlots } from '../../lib/plan/slots.js';
import { isBuiltInDayKey } from '../../lib/plan/special-days.js';

/** The most proposals one keep takes: two a day in the longest month. */
export const MOST_PROPOSALS = 62;
/** The most "bring back" proposals one Fill my month makes (and one keep takes): posts that brought customers, kept again as copies. */
export const BRING_BACK_PROPOSALS = 2;

/** Refusal keys of the two month addresses (`refuse.request` for a shape no page sends). */
export const MONTH_REFUSALS = Object.freeze({
  month: 'month.refuse.month',
  perWeek: 'month.refuse.perWeek',
  theme: 'month.refuse.theme',
  count: 'month.refuse.count',
  day: 'month.refuse.day',
});

const REQUEST = 'refuse.request';
const [LEAST_A_WEEK, MOST_A_WEEK] = LIMITS.postsPerWeek;
/** A person's own special day's key, as the special-days rules give it. */
const OWN_DAY_KEY = /^own-[1-9][0-9]{0,14}$/u;

/** @param {unknown} value */
function isWholeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
export function isSpecialDayKey(value) {
  return typeof value === 'string' && (isBuiltInDayKey(value) || OWN_DAY_KEY.test(value));
}

/**
 * The themes a request names: a list of whole ids, each once, each one of
 * `known` (the themes in use). Null when the list is not a list of ids.
 *
 * @param {unknown} value
 * @param {Set<number>} known
 * @returns {{ ok: true, value: number[] } | { ok: false, problem: string }}
 */
export function readThemeIds(value, known) {
  if (!Array.isArray(value) || value.length > LIMITS.themes * 4 || !value.every(isWholeId)) return { ok: false, problem: REQUEST };
  const ids = [...new Set(/** @type {number[]} */ (value))];
  if (ids.some((id) => !known.has(id))) return { ok: false, problem: MONTH_REFUSALS.theme };
  return { ok: true, value: ids };
}

/** The most days a span of proposals holds (the first visit's seven days). */
export const SPAN_MOST = 7;

/**
 * A span of days a Fill my month request may name instead of a month,
 * `{ from, to }`: two days, the first not after the last, at most
 * `SPAN_MOST` days in all, with the one or two months they touch, in order.
 * Null when it does not read as one.
 *
 * @param {unknown} from
 * @param {unknown} to
 * @returns {{ from: string, to: string, months: string[] } | null}
 */
export function readSpan(from, to) {
  if (!isCivilDay(from) || !isCivilDay(to) || from > to || to > addDays(/** @type {string} */ (from), SPAN_MOST - 1)) return null;
  const first = monthOf(/** @type {string} */ (from));
  const last = monthOf(/** @type {string} */ (to));
  return { from: /** @type {string} */ (from), to: /** @type {string} */ (to), months: first === last ? [first] : [first, last] };
}

/** Whether a request names a span (`from` or `to`) rather than a month. @param {Record<string, unknown>} body */
export function asksSpan(body) {
  return body.from !== undefined || body.to !== undefined;
}

/**
 * `POST /api/month/plan` `{ month, perWeek, themeIds }` or `{ from, to,
 * perWeek, themeIds }`: a month from 2000 to 2199, or a span of at most
 * `SPAN_MOST` days (`readSpan`; one that does not read is `refuse.request`),
 * 1 to 14 posts a week, themes that are in use (none is allowed: the
 * proposals then have no theme). `month` is null for a span, `span` null for
 * a month.
 *
 * @param {unknown} body
 * @param {Set<number>} known the ids of the themes in use
 * @returns {{ ok: true, value: { month: string | null, span: { from: string, to: string, months: string[] } | null, perWeek: number, themeIds: number[] } }
 *   | { ok: false, problem: string }}
 */
export function readPlanRequest(body, known) {
  if (!isPlainObject(body)) return { ok: false, problem: REQUEST };
  const asked = /** @type {Record<string, unknown>} */ (body);
  const { month, perWeek, themeIds } = asked;
  const span = asksSpan(asked) ? readSpan(asked.from, asked.to) : null;
  if (asksSpan(asked) && (span === null || month !== undefined)) return { ok: false, problem: REQUEST };
  if (span === null && !isCivilMonth(month)) return { ok: false, problem: MONTH_REFUSALS.month };
  if (typeof perWeek !== 'number' || !Number.isInteger(perWeek) || perWeek < LEAST_A_WEEK || perWeek > MOST_A_WEEK) {
    return { ok: false, problem: MONTH_REFUSALS.perWeek };
  }
  const themes = readThemeIds(themeIds ?? [], known);
  if (!themes.ok) return themes;
  return { ok: true, value: { month: span === null ? /** @type {string} */ (month) : null, span, perWeek, themeIds: themes.value } };
}

/**
 * The empty slots of a span (pure): `emptySlots` for each month the span
 * touches (that month's posts, `takenOf`, and special days, `specialDaysOf`),
 * from the later of `today` and the span's first day, kept up to its last
 * day, the themes then taking the slots in turn across the span (the first
 * slot the first theme).
 *
 * @param {{ span: { from: string, to: string, months: string[] }, perWeek: number, themeIds: number[], mondayFirst: boolean, today: string,
 *   takenOf: (month: string) => Array<{ day: string | null }>, specialDaysOf: (month: string) => Array<{ key: string, day: string, kind: string }> }} input
 * @returns {Array<{ day: string, themeId: number | null, specialDayKey?: string }>}
 */
export function spanSlots({ span, perWeek, themeIds, mondayFirst, today, takenOf, specialDaysOf }) {
  const from = span.from > today ? span.from : today;
  const slots = span.months.flatMap((month) => emptySlots({
    month, perWeek, taken: takenOf(month), themeIds, specialDays: specialDaysOf(month), mondayFirst, today: from,
  })).filter((slot) => slot.day >= from && slot.day <= span.to);
  return byDay(slots).map((slot, index) => ({ ...slot, themeId: themeIds.length > 0 ? themeIds[index % themeIds.length] : null }));
}

/**
 * `POST /api/month/keep` `{ month, madeBy, proposals }`: `madeBy` is `ai` or
 * `person`; 1 to `MOST_PROPOSALS` proposals, each on a day of `month`, with a
 * name of 1 to `LIMITS.name` characters, a theme in use or none, and a special
 * day's key or none. A bring-back proposal names the post it copies
 * (`fromPostId`, a whole id): only its day and that id are read (the copy takes
 * the post's own name and theme, so the label the calendar shows in its name is
 * never kept); at most `BRING_BACK_PROPOSALS` of them, each post once.
 *
 * @param {unknown} body
 * @param {Set<number>} known the ids of the themes in use
 * @returns {{ ok: true, value: { month: string, madeBy: 'ai' | 'person', proposals: Array<{ day: string, name: string, themeId: number | null, specialDay: string | null }
 *   | { day: string, fromPostId: number }> } }
 *   | { ok: false, problem: string }}
 */
export function readKeepRequest(body, known) {
  if (!isPlainObject(body)) return { ok: false, problem: REQUEST };
  const { month, madeBy, proposals } = /** @type {Record<string, unknown>} */ (body);
  if (!isCivilMonth(month)) return { ok: false, problem: MONTH_REFUSALS.month };
  if (madeBy !== 'ai' && madeBy !== 'person') return { ok: false, problem: REQUEST };
  if (!Array.isArray(proposals) || proposals.length === 0) return { ok: false, problem: REQUEST };
  if (proposals.length > MOST_PROPOSALS) return { ok: false, problem: MONTH_REFUSALS.count };
  const kept = [];
  const copied = new Set();
  for (const item of proposals) {
    if (!isPlainObject(item)) return { ok: false, problem: REQUEST };
    const { day, name, themeId, specialDay, fromPostId } = item;
    if (!isCivilDay(day)) return { ok: false, problem: REQUEST };
    if (!/** @type {string} */ (day).startsWith(`${month}-`)) return { ok: false, problem: MONTH_REFUSALS.day };
    if (fromPostId !== undefined && fromPostId !== null) {
      if (!isWholeId(fromPostId) || copied.has(fromPostId) || copied.size >= BRING_BACK_PROPOSALS) return { ok: false, problem: REQUEST };
      copied.add(fromPostId);
      kept.push({ day: /** @type {string} */ (day), fromPostId: /** @type {number} */ (fromPostId) });
      continue;
    }
    const words = readWords(name, LIMITS.name, { required: true });
    if (!words.ok) return words;
    if (themeId !== undefined && themeId !== null && !isWholeId(themeId)) return { ok: false, problem: REQUEST };
    if (isWholeId(themeId) && !known.has(/** @type {number} */ (themeId))) return { ok: false, problem: MONTH_REFUSALS.theme };
    if (specialDay !== undefined && specialDay !== null && !isSpecialDayKey(specialDay)) return { ok: false, problem: REQUEST };
    kept.push({
      day: /** @type {string} */ (day),
      name: words.value,
      themeId: isWholeId(themeId) ? /** @type {number} */ (themeId) : null,
      specialDay: isSpecialDayKey(specialDay) ? /** @type {string} */ (specialDay) : null,
    });
  }
  return { ok: true, value: { month: /** @type {string} */ (month), madeBy, proposals: kept } };
}

/**
 * Names the empty slots without AI: a slot for a special day (its
 * `specialDayKey` from `emptySlots`, which marks a slot on a celebration or
 * shopping day) takes the day's name, any other slot its theme's name, and a
 * slot with neither the words `fallback`. Names are cut to `LIMITS.name`.
 *
 * @param {Array<{ day: string, themeId: number | null, specialDayKey?: string }>} slots from `emptySlots`
 * @param {{ themes: Array<{ id: number, name: string }>, specialDays: Array<{ key: string, name?: string, nameKey?: string }>,
 *   words: (key: string) => string, fallback: string }} options
 * @returns {Array<{ day: string, name: string, themeId: number | null, specialDay?: string }>}
 */
export function planProposals(slots, { themes, specialDays, words, fallback }) {
  const themeName = new Map(themes.map((theme) => [theme.id, theme.name]));
  const special = new Map(specialDays.map((item) => [item.key, item]));
  const cut = (text) => Array.from(text.trim()).slice(0, LIMITS.name).join('');
  return slots.map((slot) => {
    const key = slot.specialDayKey;
    const day = key ? special.get(key) : undefined;
    const dayName = day ? (day.name ?? (day.nameKey ? words(day.nameKey) : '')) : '';
    const name = cut(dayName || (slot.themeId !== null ? themeName.get(slot.themeId) ?? '' : '') || fallback) || cut(fallback);
    const proposal = { day: slot.day, name, themeId: slot.themeId };
    return key ? { ...proposal, specialDay: key } : proposal;
  });
}

/**
 * The "bring back" proposals of a Fill my month (pure): up to
 * `BRING_BACK_PROPOSALS` of `candidates` (as `bringBackFor` answers them, best
 * first), each on a free day of `month`: from `today` on, holding no post
 * (`taken`), no other proposal (`proposed`) and no day of remembrance, spread
 * through the free days (the best first). A post whose theme is in use but not
 * among the themes the person chose is left out (with none chosen, every one
 * may come back). Each is `{ day, name, themeId, fromPostId, customers }`:
 * the post's name, its theme while in use (else none), the post it copies and
 * how many customers named it. Fewer free days than candidates: as many as
 * there are days.
 *
 * @param {Array<{ id: number, name: string, themeId: number | null, customers: number }>} candidates
 * @param {{ month: string, today: string, taken: Array<{ day: string | null }>, proposed: Array<{ day: string }>,
 *   specialDays: Array<{ day: string, kind: string }>, inUse: Set<number>, chosen: Set<number> }} options
 * @returns {Array<{ day: string, name: string, themeId: number | null, fromPostId: number, customers: number }>}
 */
export function bringBackProposals(candidates, { month, today, taken, proposed, specialDays, inUse, chosen }) {
  if (!isCivilMonth(month) || !Array.isArray(candidates)) return [];
  const allowed = candidates.filter((item) => item.themeId === null || !inUse.has(item.themeId) || chosen.size === 0 || chosen.has(item.themeId));
  const picks = allowed.slice(0, BRING_BACK_PROPOSALS);
  if (picks.length === 0) return [];
  const held = new Set([...taken.map((item) => item.day), ...proposed.map((item) => item.day)]);
  const quiet = new Set(specialDays.filter((item) => item.kind === 'remembrance').map((item) => item.day));
  const { year, month: number } = partsOf(`${month}-01`);
  const free = [];
  for (let date = 1; date <= daysInMonth(year, number); date += 1) {
    const day = civilDay(year, number, date);
    if (day >= today && !held.has(day) && !quiet.has(day)) free.push(day);
  }
  const count = Math.min(picks.length, free.length);
  const proposals = [];
  let previous = -1;
  for (let index = 0; index < count; index += 1) {
    const at = Math.max(previous + 1, Math.floor(((index + 1) * free.length) / (count + 1)));
    previous = at;
    const item = picks[index];
    proposals.push({
      day: free[at],
      name: item.name,
      themeId: item.themeId !== null && inUse.has(item.themeId) ? item.themeId : null,
      fromPostId: item.id,
      customers: item.customers,
    });
  }
  return proposals;
}

/**
 * The words of a "bring back" proposal's card ("Brought back: Summer menu (3
 * customers)"): its key and values. The name of a post with none is
 * `untitled` (the words for "Untitled post").
 *
 * @param {{ name: string, customers: number }} proposal
 * @param {string} untitled
 * @returns {{ key: string, values: { name: string, count: string } }}
 */
export function bringBackWords(proposal, untitled) {
  const count = Number.isInteger(proposal.customers) && proposal.customers > 0 ? proposal.customers : 1;
  const name = typeof proposal.name === 'string' && proposal.name.trim() !== '' ? proposal.name : untitled;
  return { key: count === 1 ? 'month.bringBack.one' : 'month.bringBack.label', values: { name, count: String(count) } };
}

/**
 * Proposals in day order (a sort that keeps the order of those on one day).
 *
 * @template {{ day: string }} P
 * @param {P[]} list
 * @returns {P[]}
 */
export function byDay(list) {
  return [...list].sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? -1 : 1));
}
