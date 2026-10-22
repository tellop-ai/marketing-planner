import { getCommentFor, recordId, removeCommentFor, updateCommentFor } from '../../../../lib/data/customers.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One comment: `GET` answers `{ comment }`, `PATCH` with any of its fields
 * changes it and answers `{ comment }` (`screenshot`: a new digest replaces
 * the picture, `'remove'` removes it, nothing keeps it), `DELETE` removes it,
 * `{ ok: true }`. Another owner's comment is not found.
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
    const comment = await getCommentFor(OWNER, id);
    return comment === null ? refused(REFUSED.notFound) : json({ comment });
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
    const comment = await updateCommentFor(OWNER, id, body.value);
    return comment === null ? refused(REFUSED.notFound) : json({ comment });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeCommentFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
