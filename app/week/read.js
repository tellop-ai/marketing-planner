/**
 * What the "This week" page reads, once for one request. Opening it only
 * reads (AGENTS.md rule 4a): no read here creates or changes a row.
 *
 * Records calls, one after another (never two at once): the plan (2, 4 with
 * the most themes), then the week's posts as tiles (`listDaysFor`: 2 calls
 * for the posts past 204, then their chosen pictures and versions packed in
 * as few calls as the bounds allow): 10 measured at the largest (256 posts
 * with the longest words on every network and the most themes), 5 for an
 * empty week (`tests/week.test.mjs`); then, when a post of the week is in a
 * campaign, those campaigns' names (1 more: a shared link's tracking names
 * its campaign). A tile carries no words; the page reads
 * each post's words after it opens (`GET /api/posts/{id}`, one request each,
 * at most `AT_ONCE` at a time).
 *
 * A week holds at most `MOST_A_MONTH` posts read here; a week across two full
 * months could hold more, and then `full` says the list stops there.
 */

import { campaignNamesFor } from '../../lib/data/campaigns.js';
import { planFor } from '../../lib/data/plan.js';
import { listDaysFor, MOST_A_MONTH } from '../../lib/data/posts.js';
import { pictureBrandOf } from '../../lib/plan/card-layout.js';
import { momentOf } from '../../lib/plan/state.js';
import { mondayFirstFor } from '../calendar/rules.js';

import { weekOf } from './rules.js';

/**
 * @param {{ owner: string, query: Record<string, string | string[] | undefined>, today: string, locale: string, now?: string | number }} input
 */
export async function readWeekPage({ owner, query, today, locale, now = Date.now() }) {
  const mondayFirst = mondayFirstFor(locale);
  const week = weekOf(query, today, mondayFirst);
  const moment = new Date(momentOf(now)).toISOString();
  const plan = await planFor(owner);
  const tiles = await listDaysFor(owner, week.from, week.to, plan.networks, { now: moment });
  const theme = ({ id, name, colour }) => ({ id, name, colour });
  const campaigns = await campaignNamesFor(owner, tiles.map((tile) => tile.campaignId));
  return {
    week,
    today,
    now: moment,
    business: plan.profile.businessName,
    brand: pictureBrandOf(plan.profile),
    networks: plan.networks,
    themes: plan.themes.map(theme),
    archivedThemes: plan.archivedThemes.map(theme),
    tiles,
    campaigns,
    trackLinks: plan.profile.trackLinks,
    profileLink: plan.profile.profileLink,
    full: tiles.length >= MOST_A_MONTH,
  };
}
