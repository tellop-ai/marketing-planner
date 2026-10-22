import { addCampaignFor, listCampaignsFor } from '../../../lib/data/campaigns.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * Campaigns. `GET ?month=YYYY-MM` answers the campaigns that run on a day of
 * that month, by first day; `GET` with no month answers all of them, the
 * latest first: `{ campaigns }`, each with its `status` (`planned`, `running`
 * or `done`). `POST { name, startsOn, endsOn, goal?, offer?, notes?,
 * doneEarly? }` adds one, `{ campaign }`.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function GET(request) {
  const month = new URL(request.url).searchParams.get('month');
  try {
    return json({ campaigns: await listCampaignsFor(OWNER, month === null ? {} : { month }) });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    return json({ campaign: await addCampaignFor(OWNER, body.value) });
  } catch (error) {
    return failed(error);
  }
}
