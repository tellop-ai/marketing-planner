/**
 * What the Results page and its spreadsheet file read, server only. Kept
 * apart from the page so the checks can count the records calls one request
 * makes (Tellop allows 16, at most 4 at once: these run one after another).
 */

import { chosenPicturesFor } from '../../lib/data/ideas.js';
import { planFor } from '../../lib/data/plan.js';
import { bestTimesFor } from '../../lib/data/result-import.js';
import { listSharedFor } from '../../lib/data/posts.js';
import { monthFiguresFor, postFactsFor } from '../../lib/data/results.js';
import { addMonths, civilDay, daysInMonth, partsOf, todayCivil } from '../../lib/plan/days.js';
import { momentOf } from '../../lib/plan/state.js';
import { OWNER } from '../../lib/plan/owner.js';

import { bestPostIds, postsCsv, resultsFigures } from './figures.js';

/** The first and the last day of a month (`YYYY-MM`). @param {string} month */
function monthDays(month) {
  const [year, number] = month.split('-').map(Number);
  return { from: `${month}-01`, to: civilDay(year, number, daysInMonth(year, number)) };
}

/**
 * The day of the month before that a month still running is compared up to:
 * the same day of the month as today, or the month before's last day when it
 * is shorter (the 31st against a 30-day month is the 30th). Null for a month
 * that is not today's: a whole month is compared with the whole month before.
 *
 * @param {string} month the month shown
 * @param {string} today a civil day on this computer's clock
 * @returns {string | null}
 */
export function sameDaysThrough(month, today) {
  if (typeof today !== 'string' || !today.startsWith(`${month}-`)) return null;
  const last = addMonths(month, -1);
  const [year, number] = last.split('-').map(Number);
  return civilDay(year, number, Math.min(partsOf(today).day, daysInMonth(year, number)));
}

/**
 * The month's customers by the offer code of a campaign (By code), each with
 * the month before: `[{ code, name, customers: Pair, sales: Pair }]`, in the
 * campaigns' order (the latest first), one row a code (campaigns that share
 * a code count once, under the latest one's name). A code that brought no
 * customer in either month is left out, as is a customer's code that no
 * campaign has.
 *
 * @param {Array<{ name: string, code: string, key: string }>} codes the campaigns with a code
 * @param {{ byCode?: Record<string, { customers: number, sales: number }> }} now this month's counts
 * @param {{ byCode?: Record<string, { customers: number, sales: number }> }} before the month before's counts
 */
export function codeRows(codes, now, before) {
  const rows = [];
  const seen = new Set();
  for (const campaign of Array.isArray(codes) ? codes : []) {
    if (seen.has(campaign.key)) continue;
    seen.add(campaign.key);
    const value = now?.byCode?.[campaign.key] ?? { customers: 0, sales: 0 };
    const last = before?.byCode?.[campaign.key] ?? { customers: 0, sales: 0 };
    if (value.customers + value.sales + last.customers + last.sales === 0) continue;
    rows.push({
      code: campaign.code,
      name: campaign.name,
      customers: { value: value.customers, last: last.customers },
      sales: { value: value.sales, last: last.sales },
    });
  }
  return rows;
}

/** The records calls the plan and the shares take at most (the plan 4, the shares 5): the posts download's words take the rest. */
const PLAN_CALLS = 4;
const SHARES_CALLS = 5;
/** The most records calls one request makes inside Tellop. */
const REQUEST_CALLS = 16;

/**
 * The Results page's reads for one month and the month before it, up to
 * `now` (the computer's clock when left out; a version scheduled for later is
 * not shared yet), one call at a time: the plan (at most 4), the counts of
 * both months (`monthFiguresFor`, 1 to 3), the posts they name and the best
 * ones' names and networks (`postFactsFor`, 1) and the best posts' chosen
 * pictures (at most 2), then the best times (at most 3): at most 13 records
 * calls, whatever the month holds.
 *
 * For the month that holds today, the month before is counted only up to the
 * same day of the month (`sameDaysThrough`), so a part month is never
 * compared with a whole one; `sameDays` says so (the page's change label
 * then reads "from the same days last month"). Followers are a month's
 * number: always the whole month before.
 *
 * The counts of both months' customers by campaign offer code come in the
 * same first call: `byCode` is `{ rows, partial }` (`codeRows`; `partial`
 * when the read of codes came back full and may have left some out).
 *
 * Answers `{ month, last, sameDays, plan, themes, partial, totals, byTheme, byNetwork,
 * byChannel, byAsk, byCode, best, followers, pictures }`: the figures as
 * `resultsFigures` (`./figures.js`) describes them, `themes` the plan's themes
 * then its archived ones (so an old post keeps its colour), `pictures` the
 * best posts' chosen pictures by post id, and `partial` true when the month
 * held more posts than the counts by post read (its totals stay whole).
 *
 * @param {string} month a civil month, already checked
 * @param {string} [owner]
 * @param {{ now?: string | number }} [options]
 */
export async function readResults(month, owner = OWNER, { now = Date.now() } = {}) {
  const last = addMonths(month, -1);
  const plan = await planFor(owner);
  const through = sameDaysThrough(month, todayCivil(new Date(momentOf(now))));
  const counts = await monthFiguresFor(owner, [month, last], { now, through: through === null ? {} : { [last]: through } });
  const best = bestPostIds(counts.months[month]);
  const postIds = [...new Set([month, last].flatMap((which) => Object.keys(counts.months[which].byPost).map(Number)))];
  const { facts, detail } = await postFactsFor(owner, postIds, { detail: best, month, now });
  const themes = [...plan.themes, ...plan.archivedThemes];
  const figures = resultsFigures({
    month, last, counts: counts.months, facts, detail, best,
    themeOrder: themes.map((theme) => theme.id), networks: plan.networks,
  });
  const pictures = best.length === 0 ? {} : await chosenPicturesFor(owner, best);
  const byCode = { rows: codeRows(counts.codes, counts.months[month], counts.months[last]), partial: counts.codesPartial === true };
  const bestTimes = await bestTimesFor(owner, { now });
  return { month, last, sameDays: through !== null, plan, themes, partial: counts.partial, ...figures, byCode, pictures, bestTimes };
}

/**
 * The spreadsheet file's text for one month, at most 16 records calls: the
 * plan (at most 4, for the themes' names), the shares with their addresses
 * (at most 5) and their words with the calls left (7: about 105 shares at the
 * longest words a version holds; the words of later shares are left out and
 * the file says so).
 *
 * A version scheduled for a moment after `now` is not shared yet and is left
 * out.
 *
 * @param {string} month a civil month, already checked
 * @param {string} locale
 * @param {string} [owner]
 * @param {{ now?: string | number }} [options]
 */
export async function postsExportText(month, locale, owner = OWNER, { now } = {}) {
  const { from, to } = monthDays(month);
  const plan = await planFor(owner);
  const shares = await listSharedFor(owner, from, to, { wordCalls: REQUEST_CALLS - PLAN_CALLS - SHARES_CALLS, now });
  const themeNames = new Map([...plan.themes, ...plan.archivedThemes].map((theme) => [theme.id, theme.name]));
  return postsCsv(shares, { themeNames, locale });
}
