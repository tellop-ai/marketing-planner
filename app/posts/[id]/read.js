/**
 * What the post maker page reads as it opens (kit rule 4a: it only reads):
 * the post, the plan (business, networks, themes), the "link in profile"
 * sentence, the campaigns and the best times.
 *
 * One records function at a time. Inside Tellop a request may hold at most 4
 * records calls unanswered at once, and a data function may run up to 2 side
 * by side (`planFor` does), so running these four together (5 calls in
 * flight) made every post read as `error.storageUnreadable` there. In turn,
 * at most 2 are ever in flight; in all at most thirteen calls (post 1 to 3,
 * plan 2, sentence 1, campaigns 1 to 4, best times 1 to 3). A post that is not there is read first
 * and answers null, with nothing else read.
 */

import { listCampaignsFor } from '../../../lib/data/campaigns.js';
import { planFor } from '../../../lib/data/plan.js';
import { getPostFor } from '../../../lib/data/posts.js';
import { bestTimesFor } from '../../../lib/data/result-import.js';
import { linkSentenceFor } from '../../../lib/data/words.js';

/**
 * @param {string} owner
 * @param {number} id
 * @param {string} today
 * @returns {Promise<{ full: any, plan: any, linkSentence: string, campaigns: any[], bestTimes: any } | null>}
 */
export async function readMakerPage(owner, id, today) {
  const full = await getPostFor(owner, id);
  if (full === null) return null;
  const plan = await planFor(owner);
  const linkSentence = await linkSentenceFor(owner);
  const campaigns = await listCampaignsFor(owner, { today });
  const bestTimes = await bestTimesFor(owner);
  return { full, plan, linkSentence, campaigns, bestTimes };
}
