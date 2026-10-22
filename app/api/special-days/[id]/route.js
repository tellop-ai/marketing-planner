import { getOwnDayFor, readOwnDayFields, removeOwnDayFor, updateOwnDayFor } from '../../../../lib/data/plan.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One own special day: `PATCH { name?, date?, yearly?, note? }` changes it,
 * `DELETE` removes it. Another owner's day is not found.
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
  try {
    const current = await getOwnDayFor(OWNER, id);
    if (current === null) return refused(REFUSED.notFound);
    const read = readOwnDayFields(body.value, { current });
    if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
    const day = await updateOwnDayFor(OWNER, id, read.fields);
    return day === null ? refused(REFUSED.notFound) : json({ day });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeOwnDayFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
