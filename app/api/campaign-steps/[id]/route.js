import { moveCampaignStepFor, recordId, removeCampaignStepFor, updateCampaignStepFor } from '../../../../lib/data/campaigns.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One campaign step: `PATCH { text?, dueOn? ('' clears), done? }` changes it,
 * `{ step }`; `POST { action: 'move', direction: 'up' | 'down' }` moves it one
 * place and answers the campaign's steps in their new order, `{ steps }`;
 * `DELETE` removes it, `{ ok: true }`. Another owner's step is not found.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> }} context */
async function idOf(context) {
  const { id } = await context.params;
  return recordId(id);
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const step = await updateCampaignStepFor(OWNER, id, body.value);
    return step === null ? refused(REFUSED.notFound) : json({ step });
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
  const { action, direction, ...rest } = body.value;
  if (action !== 'move' || (direction !== 'up' && direction !== 'down') || Object.keys(rest).length > 0) return refused(REFUSED.request);
  try {
    const steps = await moveCampaignStepFor(OWNER, id, direction);
    return steps === null ? refused(REFUSED.notFound) : json({ steps });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeCampaignStepFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
