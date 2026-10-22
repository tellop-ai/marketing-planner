import { DataError } from '../../../../lib/data/index.js';
import { deletePostFor, getPostFor, idFromPath, updatePostFor } from '../../../../lib/data/posts.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One post. `GET` answers the post with its versions and pictures; `PATCH`
 * with any of `{ name, mainText, day, time, themeId, campaignId, specialDay,
 * ask, videoPlan }` changes those (`null` clears a day, time, theme, campaign
 * or special day; `''` clears the ask or the video plan, a plan object
 * replaces it) and answers `{ post }`; `DELETE` removes it with its versions and pictures,
 * `{ ok: true }`. Another owner's post is not found.
 */
export const dynamic = 'force-dynamic';

const FIELDS = Object.freeze(['name', 'mainText', 'day', 'time', 'themeId', 'campaignId', 'specialDay', 'ask', 'videoPlan']);

/** @param {{ params: Promise<{ id: string }> | { id: string } }} context */
async function idOf(context) {
  const params = await context?.params;
  return idFromPath(params?.id);
}

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function GET(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    const full = await getPostFor(OWNER, id);
    return full === null ? refused(REFUSED.notFound) : json(full);
  } catch (error) {
    if (!(error instanceof DataError)) return json({ problem: 'error.storageUnreadable' }, 500);
    return problemOf(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  const fields = Object.fromEntries(FIELDS.filter((name) => asked[name] !== undefined).map((name) => [name, asked[name]]));
  try {
    const post = await updatePostFor(OWNER, id, fields);
    return post === null ? refused(REFUSED.notFound) : json({ post });
  } catch (error) {
    return problemOf(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await deletePostFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return problemOf(error);
  }
}
