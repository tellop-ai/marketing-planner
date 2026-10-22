import { addCampaignStepFor, listCampaignStepsFor, recordId } from '../../../../../lib/data/campaigns.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * A campaign's steps: `GET` answers `{ steps }` in their order; `POST { text,
 * dueOn?, done? }` adds one at the end, `{ step }` (refused past 50 steps a
 * campaign). Another owner's campaign is not found.
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
    const steps = await listCampaignStepsFor(OWNER, id);
    return steps === null ? refused(REFUSED.notFound) : json({ steps });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const step = await addCampaignStepFor(OWNER, id, body.value);
    return step === null ? refused(REFUSED.notFound) : json({ step });
  } catch (error) {
    return failed(error);
  }
}
