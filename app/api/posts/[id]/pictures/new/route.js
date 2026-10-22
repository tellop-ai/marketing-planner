import { askAI, picture } from '../../../../../../lib/ai.js';
import { DataError } from '../../../../../../lib/data/index.js';
import { getOwnDayFor, planFor } from '../../../../../../lib/data/plan.js';
import { addPictureFor, choosePictureFor, getPostFor, idFromPath, picturePromptsFor, POST_REFUSALS } from '../../../../../../lib/data/posts.js';
import { getLocale, t } from '../../../../../../lib/i18n/index.js';
import { EARLIER_MOST, PICTURE_SIZE, pictureMessages, picturePrompt, readPictureAnswer } from '../../../../../../lib/plan/ai-picture.js';
import { AI_WORDS, aiFailure, businessContent, ownDayId, specialDayForPost, themeContent } from '../../../../../../lib/plan/ai-words.js';
import { LIMITS, readWords } from '../../../../../../lib/plan/limits.js';
import { OWNER } from '../../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../../lib/plan/request.js';

/**
 * New picture: one more AI picture for a post, on a press. The body is `{}`
 * or `{ idea }` (the `pictureIdea` Make my post answered, at most
 * `LIMITS.description` characters, a suggestion only).
 *
 * Refused past `LIMITS.picturesPerPost` before anything goes to AI. Then one
 * `quick` request writes the picture's prompt and description from the post's
 * words, its theme and special day and My plan's picture style, different
 * from the post's last five AI pictures; the picture is made at 1536 by 1024
 * with the fixed rules (`PICTURE_RULES`), kept beside the others and chosen.
 * Answers `{ picture }` (201). An AI problem answers `{ problem }` with
 * `lib/ai.js`'s words key, and nothing is added.
 */
export const dynamic = 'force-dynamic';

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** The words a post's picture is made for: its main words, else its first version's, else its name. @param {any} full */
function wordsOf(full) {
  if (full.post.mainText.trim() !== '') return full.post.mainText;
  const version = full.versions.find((item) => item.on && item.text.trim() !== '');
  return version ? version.text : full.post.name;
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const params = await context?.params;
  const postId = idFromPath(params?.id);
  if (postId === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const idea = readWords(/** @type {Record<string, unknown>} */ (body.value).idea, LIMITS.description);
  if (!idea.ok) return refused(idea.problem);
  const locale = getLocale();
  try {
    const [full, plan] = await Promise.all([getPostFor(OWNER, postId), planFor(OWNER)]);
    if (full === null) return refused(REFUSED.notFound);
    if (full.pictures.length >= LIMITS.picturesPerPost) return refused(POST_REFUSALS.tooManyPictures);
    const earlierPrompts = await picturePromptsFor(OWNER, postId, EARLIER_MOST);
    const themeRow = [...plan.themes, ...plan.archivedThemes].find((theme) => theme.id === full.post.themeId) ?? null;
    const ownId = ownDayId(full.post.specialDay);
    const ownDay = ownId === null ? null : await getOwnDayFor(OWNER, ownId);

    let scene;
    let made;
    try {
      const answer = await askAI({
        level: 'quick',
        messages: pictureMessages({
          words: wordsOf(full),
          business: businessContent(plan.profile),
          theme: themeContent(themeRow),
          // The post's own special day, else a day of remembrance its day falls on (a calm picture).
          specialDay: specialDayForPost(full.post, { ownDay, translate: (key) => t(key, locale), showDays: plan.profile.showDays, hidden: plan.hiddenDays }),
          pictureStyle: plan.profile.pictureStyle,
          earlierPrompts,
          idea: idea.value,
          locale,
        }),
        max_tokens: 600,
        response_format: { type: 'json_object' },
      });
      scene = readPictureAnswer(answer.text);
      if (scene === null) return json({ problem: AI_WORDS.unreadable }, 502);
      made = await picture({ prompt: picturePrompt(scene.prompt) });
    } catch (error) {
      const failure = aiFailure(error);
      return json({ problem: failure.problem }, failure.status);
    }

    const added = await addPictureFor(OWNER, postId, {
      source: 'drawn',
      file: made?.file,
      prompt: scene.prompt,
      description: scene.description,
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
