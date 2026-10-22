/**
 * The empty days "Fill my month" and "Plan my month" offer ideas for.
 *
 * For each week of the month (whole weeks, as the month view draws them), from
 * today on, the plan wants `perWeek` posts. The posts already planned that week
 * count towards it; the rest become slots on days of the month that hold no
 * post yet, weekdays first (Monday, Wednesday, Friday, then Tuesday, Thursday,
 * Saturday, Sunday). A week only partly in the month wants its share of
 * `perWeek` (its days in the month / 7, rounded), so the month's first and
 * last weeks never crowd their few days. Only past seven a week does a free
 * day take a second slot. Themes take the slots in turn, in day order.
 *
 * A celebration or shopping special day with no post on it gets one slot,
 * marked with its key (`specialDayKey`): a slot that already falls on the day
 * is marked where it is; else the nearest unmarked slot of the day's week
 * moves to it. One slot carries at most one special day, and one special day
 * marks at most one slot. Other kinds (awareness, remembrance, a person's own
 * day) never move a slot and never mark one.
 *
 * A day of remembrance among `specialDays` (those the person shows) never
 * takes a slot: no ordinary themed post is proposed on it, and no special day
 * pulls a slot onto it. It does not count as a planned post either.
 */

import { monthGrid, weekdayOf } from './days.js';

/** Weekdays in the order slots fill them (0 is Sunday). */
const PREFERENCE = Object.freeze([1, 3, 5, 2, 4, 6, 0]);
const PULLING_KINDS = new Set(['celebration', 'shopping']);
/** The kind of special day that never takes a slot. */
const QUIET_KIND = 'remembrance';

/**
 * @param {{
 *   month: string,
 *   perWeek: number,
 *   taken: Array<{ day: string | null }>,
 *   themeIds: number[],
 *   specialDays?: Array<{ key: string, day: string, kind: string }>,
 *   mondayFirst: boolean,
 *   today: string,
 * }} input
 * @returns {Array<{ day: string, themeId: number | null, specialDayKey?: string }>}
 */
export function emptySlots({ month, perWeek, taken, themeIds, specialDays = [], mondayFirst, today }) {
  const busy = new Set(taken.map((post) => post.day).filter((day) => typeof day === 'string'));
  const quiet = new Set(specialDays.filter((special) => special?.kind === QUIET_KIND && typeof special.day === 'string').map((special) => special.day));
  const cells = monthGrid(month, mondayFirst);
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7).map((cell) => cell.day));

  /** @type {Array<{ day: string, themeId: number | null, specialDayKey?: string, week: number }>} */
  const slots = [];
  weeks.forEach((days, week) => {
    const open = days.filter((day) => day.startsWith(month) && day >= today);
    if (open.length === 0) return;
    const inMonth = days.filter((day) => day.startsWith(month));
    const planned = inMonth.filter((day) => busy.has(day)).length;
    let need = Math.max(0, Math.round((perWeek * inMonth.length) / 7) - planned);
    const free = open.filter((day) => !busy.has(day) && !quiet.has(day))
      .sort((a, b) => PREFERENCE.indexOf(weekdayOf(a)) - PREFERENCE.indexOf(weekdayOf(b)));
    for (let pass = 0; pass < (perWeek > 7 ? 2 : 1) && need > 0; pass += 1) {
      for (const day of free) {
        if (need === 0) break;
        slots.push({ day, themeId: null, week });
        need -= 1;
      }
    }
  });

  const pulling = specialDays.filter((special) => PULLING_KINDS.has(special.kind) && typeof special.day === 'string'
    && special.day.startsWith(month) && special.day >= today && !busy.has(special.day) && !quiet.has(special.day));
  // First the slots that already fall on such a day, so a later day never pulls one of them away.
  const marked = new Set();
  for (const special of pulling) {
    const slot = slots.find((item) => item.day === special.day && !item.specialDayKey);
    if (!slot) continue;
    slot.specialDayKey = special.key;
    marked.add(special);
  }
  for (const special of pulling) {
    if (marked.has(special) || slots.some((slot) => slot.day === special.day)) continue;
    const week = weeks.findIndex((days) => days.includes(special.day));
    let nearest = null;
    for (const slot of slots) {
      if (slot.week !== week || slot.specialDayKey) continue;
      const distance = Math.abs(Date.parse(slot.day) - Date.parse(special.day));
      if (nearest === null || distance < nearest.distance) nearest = { slot, distance };
    }
    if (nearest) {
      nearest.slot.day = special.day;
      nearest.slot.specialDayKey = special.key;
    }
  }

  slots.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return slots.map((slot, index) => {
    const themeId = themeIds.length > 0 ? themeIds[index % themeIds.length] : null;
    return slot.specialDayKey ? { day: slot.day, themeId, specialDayKey: slot.specialDayKey } : { day: slot.day, themeId };
  });
}
