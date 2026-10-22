/**
 * Best times: when a person's own posts did best, per platform, from the
 * reactions they typed or read from a numbers file. Pure: no records, no
 * network, no outside figures (never general advice). Safe in the browser.
 *
 * A share counts when it has reactions typed (likes, comments, shares or
 * saves). Its moment is when it went out, on this computer's clock (the
 * records side works it out: the post's planned time, else the moment it was
 * marked shared). A platform shows its best times only after
 * `BEST_TIMES.shares` shares with reactions over at least `BEST_TIMES.weeks`
 * different weeks (weeks start on Monday); before that it says how many more
 * are needed. A day and time band is named only when it holds at least
 * `BEST_TIMES.cell` shares, so one lucky post never decides it, and only when
 * its middle value is at least the platform's middle value of all its shares,
 * so a time that does worse than usual is never called best.
 *
 * Bands: morning 05:00 to 11:59, afternoon 12:00 to 16:59, evening 17:00 to
 * 04:59. A share from midnight to 04:59 belongs to the evening of the day
 * before (Thursday night is Thursday evening).
 */

import { addDays, isCivilDay, weekStart, weekdayOf } from './days.js';

export const BEST_TIMES = Object.freeze({ shares: 12, weeks: 6, cell: 2, shown: 3 });

export const BANDS = Object.freeze(['morning', 'afternoon', 'evening']);

const MOMENT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/u;

/**
 * The band of a time of day (`HH:MM`).
 *
 * @param {string} time
 * @returns {'morning' | 'afternoon' | 'evening'}
 */
export function bandOf(time) {
  const hour = Number(String(time).slice(0, 2));
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * The day and band a local moment (`YYYY-MM-DDTHH:MM`) belongs to: `weekday`
 * 1 (Monday) to 7 (Sunday) of the band's day (the day before for 00:00 to
 * 04:59), `band`, and `day`, the moment's own day (for counting weeks). Null
 * for anything else.
 *
 * @param {unknown} at
 * @returns {{ weekday: number, band: 'morning' | 'afternoon' | 'evening', day: string } | null}
 */
export function slotOf(at) {
  const parts = MOMENT.exec(typeof at === 'string' ? at : '');
  if (!parts || !isCivilDay(parts[1])) return null;
  const day = parts[1];
  const time = `${parts[2]}:${parts[3]}`;
  const band = bandOf(time);
  const bandDay = band === 'evening' && Number(parts[2]) < 5 ? addDays(day, -1) : day;
  const weekday = ((weekdayOf(bandDay) + 6) % 7) + 1;
  return { weekday, band, day };
}

/**
 * The middle value of a list (the mean of the two middle ones for an even
 * count), or null for an empty list.
 *
 * @param {number[]} values
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A local moment (`YYYY-MM-DDTHH:MM`) of an ISO instant on this computer's clock, or null. @param {unknown} instant */
export function localMoment(instant) {
  if (typeof instant !== 'string' || instant === '') return null;
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  const two = (value) => String(value).padStart(2, '0');
  return `${String(at.getFullYear()).padStart(4, '0')}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
}

/**
 * @typedef {{ weekday: number, band: 'morning' | 'afternoon' | 'evening', shares: number, median: number }} BestSlot
 * @typedef {{ shares: number, weeks: number, ready: boolean, morePosts: number, moreWeeks: number, usual: number | null, steady: number, slots: BestSlot[], best: BestSlot | null }} PlatformTimes
 */

/**
 * The best times of each platform from the person's shares with reactions:
 * each `{ network, at, reactions }` (`at` a local moment, `reactions` a whole
 * number from 0). Per platform: its `shares` and `weeks`, whether it is
 * `ready`, how many more shares and weeks it needs (`morePosts`,
 * `moreWeeks`, 0 when none), `usual` (the middle reactions of all its
 * shares), `steady` (how many day and band pairs hold at least
 * `BEST_TIMES.cell` shares), and once ready its `slots`: those pairs whose
 * middle reactions are at least `usual`, the highest first (then more
 * shares, then the earlier day and band), at most `BEST_TIMES.shown`; `best`
 * is the first or null. Before ready, `slots` is empty and `best` null.
 *
 * @param {Array<{ network: string, at: string, reactions: number }>} items
 * @returns {Record<string, PlatformTimes>}
 */
export function bestTimes(items) {
  /** @type {Map<string, { weeks: Set<string>, shares: number, values: number[], cells: Map<string, { weekday: number, band: string, values: number[] }> }>} */
  const byNetwork = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.network !== 'string' || item.network === '') continue;
    if (!Number.isSafeInteger(item.reactions) || item.reactions < 0) continue;
    const slot = slotOf(item.at);
    if (slot === null) continue;
    if (!byNetwork.has(item.network)) byNetwork.set(item.network, { weeks: new Set(), shares: 0, values: [], cells: new Map() });
    const network = byNetwork.get(item.network);
    network.shares += 1;
    network.values.push(item.reactions);
    network.weeks.add(weekStart(slot.day, true));
    const key = `${slot.weekday}-${slot.band}`;
    if (!network.cells.has(key)) network.cells.set(key, { weekday: slot.weekday, band: slot.band, values: [] });
    network.cells.get(key).values.push(item.reactions);
  }
  /** @type {Record<string, PlatformTimes>} */
  const answer = {};
  for (const [key, network] of byNetwork) {
    const weeks = network.weeks.size;
    const ready = network.shares >= BEST_TIMES.shares && weeks >= BEST_TIMES.weeks;
    const usual = median(network.values);
    const steadyCells = [...network.cells.values()].filter((cell) => cell.values.length >= BEST_TIMES.cell);
    const slots = ready
      ? steadyCells
        .map((cell) => ({ weekday: cell.weekday, band: cell.band, shares: cell.values.length, median: /** @type {number} */ (median(cell.values)) }))
        .filter((slot) => usual === null || slot.median >= usual)
        .sort((a, b) => b.median - a.median || b.shares - a.shares || a.weekday - b.weekday || BANDS.indexOf(a.band) - BANDS.indexOf(b.band))
        .slice(0, BEST_TIMES.shown)
      : [];
    answer[key] = {
      shares: network.shares,
      weeks,
      ready,
      morePosts: Math.max(0, BEST_TIMES.shares - network.shares),
      moreWeeks: Math.max(0, BEST_TIMES.weeks - weeks),
      usual,
      steady: steadyCells.length,
      slots,
      best: slots[0] ?? null,
    };
  }
  return answer;
}

/**
 * What a platform still needs before its best times show: `{ morePosts,
 * moreWeeks }` (a platform with no shares with reactions needs them all).
 *
 * @param {Record<string, PlatformTimes> | null | undefined} answer
 * @param {string} network
 */
export function needOf(answer, network) {
  const times = answer?.[network];
  if (!times) return { morePosts: BEST_TIMES.shares, moreWeeks: BEST_TIMES.weeks };
  return { morePosts: times.morePosts, moreWeeks: times.moreWeeks };
}

/**
 * The words keys of a slot: its day (`results.bestTimes.day.1` for Monday to
 * `.7` for Sunday) and its band (`results.bestTimes.band.<band>`).
 *
 * @param {{ weekday: number, band: string }} slot
 */
export function slotKeys(slot) {
  return { day: `results.bestTimes.day.${slot.weekday}`, band: `results.bestTimes.band.${slot.band}` };
}
