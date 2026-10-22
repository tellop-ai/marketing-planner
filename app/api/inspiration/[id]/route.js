import { postFromInspirationFor, removeInspirationFor, updateInspirationFor } from '../../../../lib/data/inspiration.js';
import { idFromPath } from '../../../../lib/data/posts.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

import { noteRefusal } from '../refusal.js';

/**
 * One inspiration note. Another owner's note is not found (404).
 *
 * - `PATCH { link?, note?, themeId? }` changes it → `{ note }` (at most 3
 *   records calls); a refusal names its field (`{ problem, field }`).
 * - `DELETE` removes it → `{ ok: true }` (1 call).
 * - `POST { action: 'post' }` (Make it a post idea) makes an idea post from
 *   it: the note as the main words, the link after them, the theme kept when
 *   still in use → 201 `{ post }` (at most 4 calls). The note stays.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> }} context */
async function idOf(context) {
  const { id } = await context.params;
  return idFromPath(id);
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const note = await updateInspirationFor(OWNER, id, body.value);
    return note === null ? refused(REFUSED.notFound) : json({ note });
  } catch (error) {
    return noteRefusal(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeInspirationFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
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
  if (action !== 'post' || Object.keys(rest).length > 0) return refused(REFUSED.request);
  try {
    const post = await postFromInspirationFor(OWNER, id);
    return post === null ? refused(REFUSED.notFound) : json({ post }, 201);
  } catch (error) {
    return failed(error);
  }
}
