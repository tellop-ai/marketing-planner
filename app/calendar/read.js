/**
 * Everything the calendar page shows, read once for one request. Opening the
 * calendar only reads (AGENTS.md rule 4a): no read here creates or changes a
 * row.
 *
 * Records calls, worst case for a month that shows today: the plan (2, 4
 * with the most themes), the posts of the days drawn and of the days a post
 * can still be due on (at most 256: 2 calls for the posts, 4 for their
 * versions and chosen pictures with every network chosen, one more for each
 * 32 posts among which one has two chosen pictures), the newest ideas (2),
 * the month's campaigns (1), the person's own days (1): 12 measured with 256
 * tiles (`tests/calendar.test.mjs`, "at its largest"), 14 with the largest
 * plan. A tile never reads a card picture's comment (its words cannot be
 * read at a tile's size), so card pictures add no call. The Share today card
 * and the week's goal come from the same read of the days, so their cost does
 * not grow with the person's history of posts. A view that shows today also
 * reads the enquiries due for a follow-up (1 more call, at most
 * `FOLLOW_UPS_MOST`).
 *
 * Every tile's state is worked out for one moment, `now` (a version
 * scheduled after it reads as scheduled, `postState`).
 */

import { listCampaignsFor } from '../../lib/data/campaigns.js';
import { listFollowUpsDueFor } from '../../lib/data/customers.js';
import { listOwnDaysFor, planFor } from '../../lib/data/plan.js';
import { listDaysFor, listIdeasFor } from '../../lib/data/posts.js';
import { pictureBrandOf } from '../../lib/plan/card-layout.js';
import { specialDaysIn } from '../../lib/plan/special-days.js';

import { dueOf, IDEAS_SHOWN, mondayFirstFor, monthsOf, readRange, viewOf, weekGoal } from './rules.js';

/**
 * `followUps` (only when the view shows today, else null): the enquiries due
 * for a follow-up today or earlier, as `listFollowUpsDueFor` answers them.
 *
 * @param {{ owner: string, query: Record<string, string | string[] | undefined>, today: string, locale: string, now?: string | number }} input
 */
export async function readCalendar({ owner, query, today, locale, now = Date.now() }) {
  const mondayFirst = mondayFirstFor(locale);
  const view = viewOf(query, today, mondayFirst);
  const plan = await planFor(owner);
  const range = readRange(view, today);
  const read = await listDaysFor(owner, range.from, range.to, plan.networks, { now });
  const ideas = await listIdeasFor(owner, plan.networks, IDEAS_SHOWN + 1, { now });
  const campaigns = view.kind === 'month' ? await listCampaignsFor(owner, { month: view.month, today }) : [];
  const own = await listOwnDaysFor(owner);
  const followUps = range.showsToday ? await listFollowUpsDueFor(owner, today) : null;

  const tiles = read.filter((tile) => tile.day !== null && tile.day >= view.from && tile.day <= view.to);
  const specialDays = monthsOf(view).flatMap((month) => specialDaysIn(month, { showDays: plan.profile.showDays, hidden: plan.hiddenDays, own }));
  const due = range.showsToday ? dueOf(read, today) : null;
  const goal = range.showsToday ? weekGoal(read, today, mondayFirst, plan.profile.postsPerWeek) : null;
  const firstVisit = plan.networks.length === 0 && read.length === 0 && ideas.length === 0;

  return {
    view,
    today,
    mondayFirst,
    business: plan.profile.businessName,
    brand: pictureBrandOf(plan.profile),
    networks: plan.networks,
    perWeek: plan.profile.postsPerWeek,
    themes: plan.themes.map((theme) => ({ id: theme.id, name: theme.name, colour: theme.colour, sells: theme.sells === true })),
    archivedThemes: plan.archivedThemes.map((theme) => ({ id: theme.id, name: theme.name, colour: theme.colour, sells: theme.sells === true })),
    tiles,
    ideas: ideas.slice(0, IDEAS_SHOWN),
    moreIdeas: ideas.length > IDEAS_SHOWN,
    campaigns: campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, startsOn: campaign.startsOn, endsOn: campaign.endsOn })),
    specialDays,
    due,
    goal,
    followUps,
    firstVisit,
  };
}
