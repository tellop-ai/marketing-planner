/**
 * What My plan's page reads, one read after another: Tellop answers at most
 * four records calls of one request at once, and a read here can be two
 * calls wide (the plan), so they never run side by side. Opening the page
 * only reads (rule 4a).
 *
 * Records calls: the plan (2, 4 with the most themes), the own days (1) and
 * the ready words (at most 4, one after another): at most 9
 * (`tests/pages.test.mjs`).
 */

import { listOwnDaysFor, planFor } from '../../lib/data/plan.js';
import { listReadyWordsFor } from '../../lib/data/words.js';

import { hashtagSetsOf } from './hashtag-sets.js';

/** @param {string} owner */
export async function readPlanPage(owner) {
  const plan = await planFor(owner);
  const ownDays = await listOwnDaysFor(owner);
  const hashtagSets = hashtagSetsOf(await listReadyWordsFor(owner));
  return { plan, ownDays, hashtagSets };
}
