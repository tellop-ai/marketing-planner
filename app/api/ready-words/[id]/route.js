import { countCopyFor, readReadyWordFields, removeReadyWordFor, updateReadyWordFor } from '../../../../lib/data/words.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One ready word: `PATCH { kind?, title?, text?, network? }` changes it,
 * `POST { action: 'copied' }` counts a copy the person made, `DELETE` removes
 * it. Another owner's ready word is not found.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> }} context */
async function idOf(context) {
  const { id } = await context.params;
  return typeof id === 'string' && /^[1-9][0-9]{0,15}$/u.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : null;
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const read = readReadyWordFields(body.value);
  if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
  try {
    const readyWord = await updateReadyWordFor(OWNER, id, read.fields);
    return readyWord === null ? refused(REFUSED.notFound) : json({ readyWord });
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
  const { action, ...rest } = body.value;
  if (action !== 'copied' || Object.keys(rest).length > 0) return refused(REFUSED.request);
  try {
    const copied = await countCopyFor(OWNER, id);
    return copied === null ? refused(REFUSED.notFound) : json({ copied });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeReadyWordFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
