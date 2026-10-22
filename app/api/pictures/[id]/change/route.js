import { editPicture } from '../../../../../lib/ai.js';
import { DataError } from '../../../../../lib/data/index.js';
import { addPictureFor, choosePictureFor, idFromPath, pictureForChangeFor, POST_REFUSALS } from '../../../../../lib/data/posts.js';
import { getLocale, t } from '../../../../../lib/i18n/index.js';
import { changedDescription, changedScene, changePrompt, PICTURE_SIZE } from '../../../../../lib/plan/ai-picture.js';
import { aiFailure } from '../../../../../lib/plan/ai-words.js';
import { clearMask } from '../../../../../lib/plan/clear-mask.js';
import { LIMITS, readWords } from '../../../../../lib/plan/limits.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * Change this picture: `{ change }` (one sentence, at most `LIMITS.change`
 * characters), on a press.
 *
 * Only a picture the AI made here (`drawn` or `changed`) is changed, never the
 * person's own photo (`ai.notDrawnHere`). Refused past `LIMITS.picturesPerPost`
 * before anything goes to AI. The whole picture may change (a clear mask); it
 * is changed with the sentence, the picture's own prompt and the fixed rules,
 * and the new picture is kept beside the old one and chosen. Its description is
 * the old one with the change, in the app's language (no AI request).
 * Answers `{ picture }` (201). An AI problem answers `{ problem }` with
 * `lib/ai.js`'s words key, and nothing is added.
 */
export const dynamic = 'force-dynamic';

const NOT_DRAWN_HERE = 'ai.notDrawnHere';
const DIGEST = /^[0-9a-f]{64}$/u;

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const params = await context?.params;
  const pictureId = idFromPath(params?.id);
  if (pictureId === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const change = readWords(/** @type {Record<string, unknown>} */ (body.value).change, LIMITS.change, { required: true });
  if (!change.ok) return refused(change.problem);
  const locale = getLocale();
  try {
    const held = await pictureForChangeFor(OWNER, pictureId);
    if (held === null) return refused(REFUSED.notFound);
    if ((held.source !== 'drawn' && held.source !== 'changed') || !DIGEST.test(held.file)) return refused(NOT_DRAWN_HERE);
    if (!(held.pictures < LIMITS.picturesPerPost)) return refused(POST_REFUSALS.tooManyPictures);

    let made;
    try {
      made = await editPicture({ file: held.file, mask: clearMask(), prompt: changePrompt(held.prompt, change.value) });
    } catch (error) {
      const failure = aiFailure(error);
      return json({ problem: failure.problem }, failure.status);
    }

    const added = await addPictureFor(OWNER, held.postId, {
      source: 'changed',
      file: made?.file,
      prompt: changedScene(held.prompt, change.value),
      change: change.value,
      fromPictureId: held.id,
      description: changedDescription(held.description, change.value, (key, values) => t(key, locale, values)),
      width: PICTURE_SIZE.width,
      height: PICTURE_SIZE.height,
    });
    if (added === null) return refused(REFUSED.notFound);
    const chosen = added.chosen ? added : await choosePictureFor(OWNER, added.id);
    return json({ picture: chosen ?? added }, 201);
  } catch (error) {
    return problemOf(error);
  }
}
