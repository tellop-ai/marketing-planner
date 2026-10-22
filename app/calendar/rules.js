/**
 * The calendar's own rules, pure (no records, no page): which days a view
 * shows, which post the Share today card names, the week's goal, how the
 * campaigns lie over the days, and the colour of a theme.
 *
 * Days are civil days (`YYYY-MM-DD`, `lib/plan/days.js`); weeks start on
 * Monday in Turkish and on Sunday in English, as the kit's month planner does.
 */

import { planSlots } from '../../lib/plan/campaign-plans.js';
import { addDays, isCivilDay, isCivilMonth, monthGrid, monthOf, weekDays } from '../../lib/plan/days.js';
import { LIMITS } from '../../lib/plan/limits.js';

/** How many days back (today included) a post that was not shared still shows on the Share today card. */
export const DUE_DAYS = 14;

/** How many ideas the row under the month shows, newest first. */
export const IDEAS_SHOWN = 6;

/**
 * Theme colours as a tile's left edge: `chart-1`..`chart-5` (theme.colour 0..4). Classes written out for the
 * stylesheet; the backgrounds are `app/theme-colours.js`.
 */
export const THEME_EDGE = Object.freeze(['border-l-chart-1', 'border-l-chart-2', 'border-l-chart-3', 'border-l-chart-4', 'border-l-chart-5']);

/**
 * A name in the month that only a wide window has room for (a post tile's
 * name, a special day's, a campaign bar's): hidden on a phone's narrow
 * columns, shown on a wide window and always on paper. It hides under its
 * own breakpoint (`max-lg`), so a display class beside it (`line-clamp-2`)
 * never drops it when the classes are joined: `cn` keeps only the last
 * display class of one breakpoint, and `hidden lg:block` lost its `hidden`.
 */
export const WIDE_NAME = 'max-lg:not-print:hidden';

/** A post's state in words on a tile: the one rule all pages share. */
export { stateWordsOf } from '../../lib/plan/state.js';

/** @param {string} locale */
export function mondayFirstFor(locale) {
  return locale === 'tr';
}

/**
 * What the address asks the calendar to show. `?month=YYYY-MM` (this month
 * when missing or wrong); `?view=week&day=YYYY-MM-DD` shows the week holding
 * that day (today's week when the day is missing or wrong).
 *
 * @param {Record<string, string | string[] | undefined>} query
 * @param {string} today
 * @param {boolean} mondayFirst
 * @returns {{ kind: 'month', month: string, from: string, to: string, cells: Array<{ day: string, inMonth: boolean }> }
 *   | { kind: 'week', day: string, month: string, from: string, to: string, days: string[] }}
 */
export function viewOf(query, today, mondayFirst) {
  const one = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined);
  if (one(query?.view) === 'week') {
    const asked = one(query?.day);
    const day = isCivilDay(asked) ? /** @type {string} */ (asked) : today;
    const days = weekDays(day, mondayFirst);
    return { kind: 'week', day, month: monthOf(day), from: days[0], to: days[6], days };
  }
  const asked = one(query?.month);
  const month = isCivilMonth(asked) ? /** @type {string} */ (asked) : monthOf(today);
  const cells = monthGrid(month, mondayFirst);
  return { kind: 'month', month, from: cells[0].day, to: cells[cells.length - 1].day, cells };
}

/**
 * The days one read takes: the view's days, and, when the view shows today,
 * back to the oldest day a post can still be due on (`DUE_DAYS`), so the
 * Share today card and the week's goal need no read of their own.
 *
 * @param {{ from: string, to: string }} view
 * @param {string} today
 * @returns {{ from: string, to: string, showsToday: boolean }}
 */
export function readRange(view, today) {
  const showsToday = view.from <= today && today <= view.to;
  if (!showsToday) return { from: view.from, to: view.to, showsToday };
  const oldest = addDays(today, -(DUE_DAYS - 1));
  return { from: oldest < view.from ? oldest : view.from, to: view.to, showsToday };
}

/**
 * The post the Share today card names: one that is more than an idea, not
 * shared or scheduled on every network (`scheduled`: the platform will post
 * it, so nothing is left to do), on a day from `DUE_DAYS` ago up to today.
 * A post shared or scheduled on some of its networks only (`partly`) is
 * still due. Today's come first (a post with no time first, then by time),
 * then the latest earlier day's.
 *
 * @template {{ id: number, day: string | null, time: string | null, state: string }} T
 * @param {T[]} tiles
 * @param {string} today
 * @returns {T | null}
 */
export function dueOf(tiles, today) {
  const oldest = addDays(today, -(DUE_DAYS - 1));
  const due = tiles.filter((tile) => typeof tile.day === 'string' && tile.day >= oldest && tile.day <= today
    && tile.state !== 'idea' && tile.state !== 'shared' && tile.state !== 'scheduled');
  due.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    if (a.time !== b.time) {
      if (a.time === null) return -1;
      if (b.time === null) return 1;
      return a.time < b.time ? -1 : 1;
    }
    return a.id - b.id;
  });
  return due[0] ?? null;
}

/** The states that count for the week's goal: shared on any network, or scheduled on every one. */
export const GOAL_STATES = Object.freeze(['shared', 'partly', 'scheduled']);

/**
 * This week's goal: My plan's posts a week, and how many posts planned for a
 * day of this week are shared, on any of their networks (`partly` counts),
 * or scheduled (the person did the work; the platform posts it).
 *
 * @param {Array<{ day: string | null, state: string }>} tiles
 * @param {string} today
 * @param {boolean} mondayFirst
 * @param {number} perWeek
 * @returns {{ goal: number, shared: number, filled: number }}
 */
export function weekGoal(tiles, today, mondayFirst, perWeek) {
  const days = new Set(weekDays(today, mondayFirst));
  const shared = tiles.filter((tile) => tile.day !== null && days.has(tile.day) && GOAL_STATES.includes(tile.state)).length;
  const goal = Number.isInteger(perWeek) && perWeek > 0 ? perWeek : 3;
  return { goal, shared, filled: Math.min(shared, goal) };
}

/**
 * The words key of the goal line. Turkish puts a suffix on the goal number
 * ("3’te 1 paylaşıldı"), and the suffix follows how the number is said:
 * 1, 2, 7, 8 take "de"; 6, 9, 10 take "da"; 3, 4, 5 take "te" (and so 11 to
 * 14 by their last word). Goals run from 1 to 14. English has one line for
 * all three keys.
 *
 * @param {number} goal
 */
export function goalWordsKey(goal) {
  if (goal === 10) return 'calendar.week.goal.da';
  const last = goal % 10;
  if (last === 3 || last === 4 || last === 5) return 'calendar.week.goal.te';
  if (last === 6 || last === 9) return 'calendar.week.goal.da';
  return 'calendar.week.goal.de';
}

/**
 * Where each campaign's bar lies on the days drawn: per day, the campaigns
 * that run on it, each in a lane (the same lane on every day of a campaign,
 * so a bar runs straight across a week), `named` on the first day it shows
 * in each week row.
 *
 * @param {Array<{ id: number, name: string, startsOn: string, endsOn: string }>} campaigns
 * @param {string[]} days the days of the grid, whole weeks in order
 * @param {(day: string) => boolean} [drawn] whether a day of the grid shows bars (the month's own days do; the
 *   muted days of the weeks around it do not)
 * @returns {{ lanes: number, byDay: Map<string, Array<{ id: number, name: string, lane: number, named: boolean, first: boolean, last: boolean }>> }}
 */
export function campaignBars(campaigns, days, drawn = () => true) {
  const sorted = [...campaigns].sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : a.id - b.id));
  /** @type {string[]} the last day of the campaign now in each lane */
  const laneEnds = [];
  const laneOf = new Map();
  for (const campaign of sorted) {
    let lane = laneEnds.findIndex((end) => end < campaign.startsOn);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = campaign.endsOn;
    laneOf.set(campaign.id, lane);
  }
  const byDay = new Map();
  days.forEach((day, index) => {
    if (!drawn(day)) return;
    const here = [];
    for (const campaign of sorted) {
      if (day < campaign.startsOn || day > campaign.endsOn) continue;
      const rowStart = index % 7 === 0 || !drawn(days[index - 1]);
      here.push({
        id: campaign.id,
        name: campaign.name,
        lane: laneOf.get(campaign.id),
        named: day === campaign.startsOn || rowStart,
        first: day === campaign.startsOn,
        last: day === campaign.endsOn,
      });
    }
    if (here.length > 0) byDay.set(day, here.sort((a, b) => a.lane - b.lane));
  });
  return { lanes: laneEnds.length, byDay };
}

/**
 * How many days of its week row a campaign's bar runs on from the day at
 * `index` of the grid, that day included: the room the bar's name has, so a
 * name written at the start of a row reads across the days after it (on a
 * phone one day is too narrow for a word).
 *
 * @param {Map<string, Array<{ id: number }>>} byDay the bars of each day (`campaignBars`)
 * @param {string[]} days the days of the grid, whole weeks in order
 * @param {number} index
 * @param {number} id the campaign
 */
export function barReach(byDay, days, index, id) {
  const rowEnd = Math.min((Math.floor(index / 7) + 1) * 7, days.length);
  let reach = 0;
  for (let at = index; at < rowEnd; at += 1) {
    if (!(byDay.get(days[at]) ?? []).some((bar) => bar.id === id)) break;
    reach += 1;
  }
  return reach;
}

/** A bar name's width for its reach (1 to 7 days), as written-out classes; a little short of the last day's end. */
export const REACH_WIDTH = Object.freeze(['w-[calc(100%-0.5rem)]', 'w-[calc(200%-0.5rem)]', 'w-[calc(300%-0.5rem)]', 'w-[calc(400%-0.5rem)]',
  'w-[calc(500%-0.5rem)]', 'w-[calc(600%-0.5rem)]', 'w-[calc(700%-0.5rem)]']);

/**
 * A theme's colour index (0..4), from the themes in use and the archived ones
 * (an old post keeps its colour); null for no theme.
 *
 * @param {number | null | undefined} themeId
 * @param {Map<number, number>} colours
 */
export function colourOf(themeId, colours) {
  if (typeof themeId !== 'number') return null;
  const colour = colours.get(themeId);
  return Number.isInteger(colour) && colour >= 0 && colour < THEME_EDGE.length ? colour : null;
}

/** @param {Array<{ id: number, colour: number }>} themes */
export function coloursOf(themes) {
  return new Map(themes.map((theme) => [theme.id, theme.colour]));
}

/**
 * The months a view's days touch (one for a month, one or two for a week),
 * for the special days.
 *
 * @param {{ kind: string, month: string, from: string, to: string }} view
 */
export function monthsOf(view) {
  if (view.kind === 'month') return [view.month];
  const first = monthOf(view.from);
  const last = monthOf(view.to);
  return first === last ? [first] : [first, last];
}

/** The address of the month view of `month`. @param {string} month */
export function monthAddress(month) {
  return `/?month=${month}`;
}

/** The address of the week view of the week holding `day`. @param {string} day */
export function weekAddress(day) {
  return `/?view=week&day=${day}`;
}

/**
 * The month's mix check: how many of the posts on the month's own days are
 * on a selling theme (`sells`, My plan's Sells switch), counted from the
 * tiles and the themes the calendar already read (in use or archived: an old
 * post keeps its theme). `{ sells, of }` when the month holds at least
 * `MIX_LEAST` posts and more than one in four of them sell (the calendar then
 * says so in one quiet line), else null (too few posts to call a mix, or few
 * enough that sell). A week view has none.
 *
 * @param {{ kind: string, month: string }} view
 * @param {Array<{ day: string | null, themeId: number | null }>} tiles
 * @param {Array<{ id: number, sells?: boolean }>} themes
 * @returns {{ sells: number, of: number } | null}
 */
export function mixOf(view, tiles, themes) {
  if (view.kind !== 'month') return null;
  const selling = new Set(themes.filter((theme) => theme.sells === true).map((theme) => theme.id));
  const month = tiles.filter((tile) => typeof tile.day === 'string' && tile.day.startsWith(`${view.month}-`));
  const sells = month.filter((tile) => typeof tile.themeId === 'number' && selling.has(tile.themeId)).length;
  return month.length >= MIX_LEAST && sells * 4 > month.length ? { sells, of: month.length } : null;
}

/** The fewest posts a month holds before the mix check speaks (fewer is too few to call a mix). */
export const MIX_LEAST = 4;

/** The mix line's words key: one selling post reads in the singular. @param {{ sells: number }} mix */
export function mixWordsKey(mix) {
  return mix.sells === 1 ? 'month.mix.one' : 'month.mix.line';
}

/**
 * Fill my month's proposals belong to the month they were made for: another
 * month (or a week of another month) shows none.
 *
 * @template P
 * @param {{ month: string, proposals: P[] } | null} proposed
 * @param {string} month the month the view shows
 * @returns {P[]}
 */
export function proposalsFor(proposed, month) {
  return proposed !== null && proposed.month === month ? proposed.proposals : [];
}

/**
 * What **Add to my calendar** asks `POST /api/export/calendar` for: the
 * month shown, or the week shown (its seven days, which may span two months),
 * and what its file names carry ("plan-2026-10", "plan-2026-10-18").
 *
 * @param {{ kind: 'month' | 'week', month: string, from: string, to: string }} view
 * @returns {{ body: { month: string } | { from: string, to: string }, label: string }}
 */
export function calendarFileSpan(view) {
  if (view.kind === 'week') return { body: { from: view.from, to: view.to }, label: view.from };
  return { body: { month: view.month }, label: view.month };
}

/**
 * Why Add to my calendar rests, or null when it can act: the app refuses a
 * calendar file with no post on its days, so the press rests while the view
 * holds none (the month's own days for a month, not the muted days of the
 * weeks around it; the week's days for a week).
 *
 * @param {{ kind: 'month' | 'week', month: string }} view
 * @param {Array<{ day: string | null }>} tiles the posts on the view's days
 * @returns {string | null} a words key
 */
export function calendarFileRest(view, tiles) {
  const any = view.kind === 'week'
    ? tiles.some((tile) => typeof tile.day === 'string')
    : tiles.some((tile) => typeof tile.day === 'string' && tile.day.startsWith(`${view.month}-`));
  if (any) return null;
  return view.kind === 'week' ? 'calendar.export.noneWeek' : 'calendar.export.noneMonth';
}

/** `text` cut to at most `most` letters. @param {string} text @param {number} most */
function cut(text, most) {
  return Array.from(text).slice(0, most).join('');
}

/**
 * What **New post for <day>** sends: the day, the special day's key, its name
 * as the post's name, and its suggestion as the post's first words, so the
 * words box starts with it. A day of remembrance sends no words (its line is
 * "Not a day for offers", not something to post).
 *
 * @param {{ day: string, special: { key: string, kind: string }, name: string, hint: string }} input
 * @returns {{ day: string, specialDay: string, name: string, mainText?: string }}
 */
export function specialPostBody({ day, special, name, hint }) {
  const body = { day, specialDay: special.key, name: cut(name, LIMITS.name) };
  const words = special.kind === 'remembrance' ? '' : String(hint ?? '').trim();
  return words === '' ? body : { ...body, mainText: cut(words, LIMITS.mainText) };
}

/**
 * Why Plan the posts rests, as a words key, or null when its presses work: a
 * campaign that is done (`campaign.plan.over`), or dates in the form that
 * differ from the saved ones (`campaign.plan.saveDates`: the plan reads the
 * saved dates, so the person saves the new ones first).
 *
 * @param {{ status: string, startsOn: string, endsOn: string }} campaign the saved campaign
 * @param {{ startsOn: string, endsOn: string }} fields the dates in the form
 * @returns {string | null}
 */
export function planRest(campaign, fields) {
  if (campaign.status === 'done') return 'campaign.plan.over';
  if (fields.startsOn !== campaign.startsOn || fields.endsOn !== campaign.endsOn) return 'campaign.plan.saveDates';
  return null;
}

/**
 * The question Plan the posts asks before it adds anything: "Add up to 6
 * posts to the calendar?" with as many as the kind puts on the campaign's
 * days left (`planSlots`; a day that already holds a post, or a day of
 * remembrance, can take one away, hence "up to").
 *
 * @param {string} kind
 * @param {{ startsOn: string, endsOn: string }} campaign
 * @param {string} today
 * @returns {{ key: string, values?: Record<string, string> }}
 */
export function planAsk(kind, campaign, today) {
  const count = planSlots({ kind, startsOn: campaign.startsOn, endsOn: campaign.endsOn, today }).length;
  return count === 1 ? { key: 'campaign.plan.ask.one' } : { key: 'campaign.plan.ask', values: { count: String(count) } };
}
