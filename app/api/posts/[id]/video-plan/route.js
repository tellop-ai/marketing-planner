import { askAI } from '../../../../../lib/ai.js';
import { DataError } from '../../../../../lib/data/index.js';
import { getOwnDayFor, planFor } from '../../../../../lib/data/plan.js';
import { getPostFor, idFromPath, updatePostFor } from '../../../../../lib/data/posts.js';
import { getLocale, t } from '../../../../../lib/i18n/index.js';
import { postWords, readVideoPlanAnswer, videoPlanMessages, videoTemplate } from '../../../../../lib/plan/ai-sets.js';
import {
  AI_WORDS, aiFailure, askOn, askSentenceFor, businessContent, ownDayId, specialDayForPost, themeContent,
} from '../../../../../lib/plan/ai-words.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * Make a video plan: `{}`, sent by a press. Words only: the app edits no
 * video.
 *
 * AI (`quick`) plans a 15 to 30 second video from the post's words (its main
 * words, else its first version's), its name, the business, the theme and
 * the special day: a hook, at most six shots with their seconds, lines on
 * screen (the last carries the post's ask; none on a day of remembrance) and
 * the cover. The answer is read strictly (`readVideoPlanAnswer`, then
 * `readVideoPlan`). Any AI problem, or an answer that does not read, and the
 * fixed template in the app's language is the plan instead (its hook, four
 * shots, the post's name and the ask's sentence on screen, its cover), but
 * only on a post with no plan yet: a plan made before (or edited by the
 * person) is never replaced by the template. Then nothing changes and the
 * address answers the AI's problem with its status (`{ problem }`; 502
 * `aiplan.unreadable` for an answer that does not read).
 *
 * The plan is kept on the post (`Post.videoPlan`), replacing the one before.
 * Answers `{ post: PostFull, ai, aiProblem? }`. Refused: a body that is not
 * JSON; another owner's post is not found. The post's words are never
 * logged.
 *
 * Records calls, one after another: the post (2-3), the plan (at most 4), an
 * own day (0-1), the save (1) and the post again (2-3): at most 12.
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
  const locale = getLocale();
  const translate = (key) => t(key, locale);
  try {
    const full = await getPostFor(OWNER, postId);
    if (full === null) return refused(REFUSED.notFound);
    const plan = await planFor(OWNER);
    const themeRow = [...plan.themes, ...plan.archivedThemes].find((theme) => theme.id === full.post.themeId) ?? null;
    const ownId = ownDayId(full.post.specialDay);
    const ownDay = ownId === null ? null : await getOwnDayFor(OWNER, ownId);
    const specialDay = specialDayForPost(full.post, { ownDay, translate, showDays: plan.profile.showDays, hidden: plan.hiddenDays });
    const ask = askOn(full.post.ask, specialDay);

    /** @type {ReturnType<typeof readVideoPlanAnswer>} */
    let made = null;
    let aiProblem = null;
    let aiStatus = 502;
    try {
      const answer = await askAI({
        level: 'quick',
        messages: videoPlanMessages({
          words: postWords(full), name: full.post.name, business: businessContent(plan.profile), theme: themeContent(themeRow), specialDay, ask, locale,
        }),
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });
      made = readVideoPlanAnswer(answer.text);
      if (made === null) aiProblem = AI_WORDS.unreadable;
    } catch (error) {
      ({ problem: aiProblem, status: aiStatus } = aiFailure(error));
    }

    const ai = made !== null;
    // A plan made before stays as it is when the AI could not make a new one.
    if (!ai && typeof full.post.videoPlan === 'string' && full.post.videoPlan !== '') return json({ problem: aiProblem ?? AI_WORDS.unreadable }, aiStatus);
    const videoPlan = ai ? made : videoTemplate({ translate, name: full.post.name, askSentence: askSentenceFor(ask, { translate }) });
    const saved = await updatePostFor(OWNER, postId, { videoPlan });
    if (saved === null) return refused(REFUSED.notFound);
    const post = await getPostFor(OWNER, postId);
    if (post === null) return refused(REFUSED.notFound);
    return json({ post, ai, ...(aiProblem === null ? {} : { aiProblem }) });
  } catch (error) {
    return problemOf(error);
  }
}
