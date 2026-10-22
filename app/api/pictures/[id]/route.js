import { readPicture } from '../../../../lib/data/files.js';
import { DataError } from '../../../../lib/data/index.js';
import { choosePictureFor, deletePictureFor, idFromPath, POST_REFUSALS, updatePictureFor } from '../../../../lib/data/posts.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One picture of a post. `PATCH` `{ chosen?: true, description?, focusX?,
 * focusY?, fit?, words?, layout?, subline?, width?, height?, shapes? }`
 * changes it (a new focus, fit, words, layout, subline or size drops the kept
 * shapes, which the page makes again; `words`, `layout` and `subline` only on
 * a words picture) and answers `{ picture }`; `chosen: true` makes it the
 * post's chosen picture (and the first of its swipe set when it has one).
 * `shapes` is `{ <shape key>: digest }`, each a picture kept first with
 * `sendFile`. `DELETE` removes it (the next picture becomes chosen when it
 * was), `{ ok: true }`. Another owner's picture is not found.
 */
export const dynamic = 'force-dynamic';

const FIELDS = Object.freeze(['description', 'focusX', 'focusY', 'fit', 'words', 'layout', 'subline', 'width', 'height', 'shapes']);

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

/**
 * The refusal key when a shape names a digest that is not a kept picture, else null.
 *
 * @param {unknown} shapes
 */
async function shapesProblem(shapes) {
  if (shapes === null || typeof shapes !== 'object' || Array.isArray(shapes)) return POST_REFUSALS.pictureShape;
  for (const digest of Object.values(shapes)) {
    if (digest === null) continue;
    if (typeof digest !== 'string') return POST_REFUSALS.pictureShape;
    const form = new FormData();
    form.set('shape', digest);
    const kept = await readPicture(form, 'shape');
    if ('problem' in kept) return /** @type {string} */ (kept.problem);
    if (kept.change !== 'replace') return POST_REFUSALS.pictureShape;
  }
  return null;
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  if (asked.chosen !== undefined && asked.chosen !== true) return refused(REFUSED.request);
  const fields = Object.fromEntries(FIELDS.filter((name) => asked[name] !== undefined).map((name) => [name, asked[name]]));
  try {
    if (fields.shapes !== undefined) {
      const problem = await shapesProblem(fields.shapes);
      if (problem !== null) return refused(problem);
    }
    let picture = await updatePictureFor(OWNER, id, fields);
    if (picture !== null && asked.chosen === true) picture = await choosePictureFor(OWNER, id);
    return picture === null ? refused(REFUSED.notFound) : json({ picture });
  } catch (error) {
    return problemOf(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await deletePictureFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return problemOf(error);
  }
}
