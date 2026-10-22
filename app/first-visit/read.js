/**
 * Whether the calendar shows the first-visit start: the profile has no
 * business name and no post exists. The calendar's own read answers most of
 * it (`mayBeFirstVisit`); only when it shows no business name and no post
 * does this ask the records whether any post exists elsewhere: one call, made
 * after the calendar's reads ended, so the page never has two at once more
 * than before and its most calls never grow (the extra call comes only when
 * the calendar read found no post, which is its cheapest read). Opening the
 * calendar only reads (rule 4a).
 */

import { hasPostsFor } from '../../lib/data/plan.js';

import { mayBeFirstVisit } from './rules.js';

/**
 * @param {string} owner
 * @param {{ business?: string, tiles?: unknown[], ideas?: unknown[], due?: unknown }} calendar what `readCalendar` answered
 */
export async function readFirstVisit(owner, calendar) {
  if (!mayBeFirstVisit(calendar)) return false;
  return !(await hasPostsFor(owner));
}
