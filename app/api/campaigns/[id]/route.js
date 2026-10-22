import { getCampaignFor, recordId, removeCampaignFor, updateCampaignFor } from '../../../../lib/data/campaigns.js';
import { planFor } from '../../../../lib/data/plan.js';
import { listPostsForCampaignFor } from '../../../../lib/data/posts.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One campaign: `GET` answers `{ campaign, steps, posts }`, `posts` the
 * campaign's posts as tiles (by day, ideas last; at most 256), whose state
 * follows the plan's networks; `PATCH` with any of
 * `name`, `goal`, `offer`, `startsOn`, `endsOn`, `doneEarly`, `notes` changes
 * it, `{ campaign }`; `DELETE` removes it and its steps and leaves its posts
 * with no campaign, `{ ok: true }`. Another owner's campaign is not found.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> }} context */
async function idOf(context) {
  const { id } = await context.params;
  return recordId(id);
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function GET(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    const found = await getCampaignFor(OWNER, id);
    if (found === null) return refused(REFUSED.notFound);
    const plan = await planFor(OWNER);
    const posts = await listPostsForCampaignFor(OWNER, id, plan.networks, { now: Date.now() });
    return json({ ...found, posts });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const campaign = await updateCampaignFor(OWNER, id, body.value);
    return campaign === null ? refused(REFUSED.notFound) : json({ campaign });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeCampaignFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
