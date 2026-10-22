import { moveThemeFor, readThemeFields, removeThemeFor, updateThemeFor } from '../../../../lib/data/plan.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One theme in use: `PATCH { name?, about?, hashtags?, colour? }` changes it,
 * `POST { action: 'move', direction: 'up' | 'down' }` moves it one place and
 * answers the themes in their new order, `DELETE` deletes it when no post uses
 * it and archives it otherwise. Another owner's theme is not found.
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
  const read = readThemeFields(body.value);
  if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
  try {
    const theme = await updateThemeFor(OWNER, id, read.fields);
    return theme === null ? refused(REFUSED.notFound) : json({ theme });
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
    const themes = await moveThemeFor(OWNER, id, direction);
    return themes === null ? refused(REFUSED.notFound) : json({ themes });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    const removed = await removeThemeFor(OWNER, id);
    return removed === null ? refused(REFUSED.notFound) : json({ removed });
  } catch (error) {
    return failed(error);
  }
}
