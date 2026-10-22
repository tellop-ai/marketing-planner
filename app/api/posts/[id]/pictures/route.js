import { readPicture } from '../../../../../lib/data/files.js';
import { DataError } from '../../../../../lib/data/index.js';
import { addPictureFor, idFromPath, POST_REFUSALS } from '../../../../../lib/data/posts.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * One more picture for a post, made without AI:
 *
 * - `{ source: 'photo', file, width, height, description? }`: the person's
 *   own photo, kept first with `sendFile` (`file` is its digest). It is their
 *   file and is kept whole, never changed.
 * - `{ source: 'words', words, layout?, subline?, description? }`: the page
 *   draws the words in their layout (`LAYOUTS`; `words` when not sent), with
 *   the subline under them (at most 80 letters).
 * - `{ source: 'card', commentId, description? }`: a customer's comment the
 *   customer said yes to sharing; the page draws the card from the comment.
 *
 * Answers `{ picture }`. Pictures the AI makes come through the AI addresses.
 */
export const dynamic = 'force-dynamic';

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const params = await context?.params;
  const postId = idFromPath(params?.id);
  if (postId === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  const described = asked.description === undefined ? {} : { description: asked.description };
  /** @type {Parameters<typeof addPictureFor>[2]} */
  let input;
  try {
    if (asked.source === 'photo') {
      // The digest must name a file that is really kept, and a picture (read from its own bytes).
      const form = new FormData();
      if (typeof asked.file === 'string') form.set('file', asked.file);
      const picked = await readPicture(form, 'file');
      if ('problem' in picked) return refused(/** @type {string} */ (picked.problem));
      if (picked.change !== 'replace') return refused(POST_REFUSALS.pictureFile);
      if (asked.width === undefined || asked.height === undefined) return refused(POST_REFUSALS.pictureSize);
      input = { source: 'photo', file: picked.file, width: /** @type {number} */ (asked.width), height: /** @type {number} */ (asked.height), ...described };
    } else if (asked.source === 'words') {
      const look = Object.fromEntries(['layout', 'subline'].filter((name) => asked[name] !== undefined).map((name) => [name, asked[name]]));
      input = { source: 'words', words: /** @type {string} */ (asked.words), ...look, ...described };
    } else if (asked.source === 'card') {
      input = { source: 'card', commentId: /** @type {number} */ (asked.commentId), ...described };
    } else {
      return refused(POST_REFUSALS.pictureSource);
    }
    const picture = await addPictureFor(OWNER, postId, input);
    return picture === null ? refused(REFUSED.notFound) : json({ picture }, 201);
  } catch (error) {
    return problemOf(error);
  }
}
