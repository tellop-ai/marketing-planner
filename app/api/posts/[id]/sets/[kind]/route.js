import { DataError } from '../../../../../../lib/data/index.js';
import { idFromPath, saveWordsSetFor, SET_KINDS, setPictureSetFor } from '../../../../../../lib/data/posts.js';
import { OWNER } from '../../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../../lib/plan/request.js';

/**
 * One of a post's sets of pictures: `kind` is `slide` (the
 * swipe set, at most 20; its first is the cover, the post's chosen picture)
 * or `story` (the story set, at most 10).
 *
 * - `PUT` `{ pictureIds }`: these pictures of the post, in this order, become
 *   the set; the others leave it and stay pictures (`[]` empties it).
 * - `POST` `{ items: [{ words, layout?, subline? }], replace? }`: makes each
 *   item a new words picture and makes them the set, all or nothing (a swipe
 *   set keeps the chosen picture first); `replace: true` also removes the
 *   words pictures of the set before that are in no other set and are not
 *   the chosen picture.
 *
 * Both answer `{ post }`, the post as `GET /api/posts/[id]` answers it
 * (201 for `POST`). Refusals: `refuse.picture.slidesFull`,
 * `refuse.picture.storyFull`, `refuse.picture.tooMany`, `refuse.text.*`,
 * `refuse.request`; another owner's post, or another kind, is not found.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string, kind: string }> | { id: string, kind: string } }} context */
async function targetOf(context) {
  const params = await context?.params;
  const postId = idFromPath(params?.id);
  const kind = params?.kind;
  if (postId === null || typeof kind !== 'string' || !SET_KINDS.includes(kind)) return null;
  return { postId, kind };
}

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** @param {Request} request @param {{ params: Promise<{ id: string, kind: string }> }} context */
export async function PUT(request, context) {
  const target = await targetOf(context);
  if (target === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const post = await setPictureSetFor(OWNER, target.postId, target.kind, body.value.pictureIds);
    return post === null ? refused(REFUSED.notFound) : json({ post });
  } catch (error) {
    return problemOf(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string, kind: string }> }} context */
export async function POST(request, context) {
  const target = await targetOf(context);
  if (target === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const { items, replace } = body.value;
  if (replace !== undefined && typeof replace !== 'boolean') return refused(REFUSED.request);
  try {
    const post = await saveWordsSetFor(OWNER, target.postId, target.kind, items, { replace: replace === true });
    return post === null ? refused(REFUSED.notFound) : json({ post }, 201);
  } catch (error) {
    return problemOf(error);
  }
}
