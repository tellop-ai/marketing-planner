import { askAI } from '../../../../../lib/ai.js';
import { DataError } from '../../../../../lib/data/index.js';
import { getOwnDayFor, planFor } from '../../../../../lib/data/plan.js';
import { getPostFor, idFromPath, POST_REFUSALS, saveWordsSetFor } from '../../../../../lib/data/posts.js';
import { getLocale, t } from '../../../../../lib/i18n/index.js';
import {
  fallbackSet, hasSet, postWords, readSetAnswer, readSetCount, SET_LEAST_ROOM, setMessages, setRoom,
} from '../../../../../lib/plan/ai-sets.js';
import {
  AI_WORDS, aiFailure, askOn, askSentenceFor, businessContent, ownDayId, specialDayForPost, themeContent,
} from '../../../../../lib/plan/ai-words.js';
import { LIMITS } from '../../../../../lib/plan/limits.js';
import { SET_LIMITS } from '../../../../../lib/plan/networks.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * Make slides: `{ count? }` (5 to 8, 6 when none), sent by a press.
 *
 * AI (`quick`) writes `count` slides from the post's words (its main words,
 * else its first version's), its name, the business, the theme and the
 * special day: the first stops the scroll, each one between makes one point,
 * the last carries the post's ask (none on a day of remembrance). The answer
 * is read strictly (`readSetAnswer`). Any AI problem, or an answer that does
 * not read, and the post's own sentences make the slides instead (at most
 * `count`, the first first, the ask's fixed sentence last), but only on a
 * post with no swipe set yet: a set made before is never replaced by them.
 * Then nothing changes and the address answers the AI's problem with its
 * status (`{ problem }`; 502 `aiplan.unreadable` for an answer that does
 * not read).
 *
 * The slides become words pictures and the post's swipe set, in order, after
 * the chosen picture (the cover); the words pictures of the set made before
 * (in no other set, never the chosen one) go (`saveWordsSetFor` with
 * `replace`). Answers 201 `{ post: PostFull, ai, aiProblem? }`.
 *
 * Refused before any AI call: a post with no words a picture can hold (in
 * its main words or its versions: `refuse.text.missing`), a post with no
 * room for two more pictures (`refuse.picture.tooMany`; less room than
 * `count` asks for fewer), a count outside 5 to 8 (`refuse.number`), a body
 * that is not JSON. Another owner's post is not found. The post's words are
 * never logged.
 *
 * Records calls, one after another: the post (2-3), the plan (at most 4), an
 * own day (0-1), the set with the post read back (4-5): at most 13.
 */
export const dynamic = 'force-dynamic';

const KIND = 'slide';

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
  const count = readSetCount(body.value.count, KIND);
  if (!count.ok) return refused(count.problem);
  const locale = getLocale();
  const translate = (key) => t(key, locale);
  try {
    const full = await getPostFor(OWNER, postId);
    if (full === null) return refused(REFUSED.notFound);
    const room = setRoom(full, KIND, { picturesPerPost: LIMITS.picturesPerPost, setMost: SET_LIMITS[KIND] });
    if (room < SET_LEAST_ROOM) return refused(POST_REFUSALS.tooManyPictures);
    const size = Math.min(count.value, room);
    const words = postWords(full);
    const name = full.post.name;

    const plan = await planFor(OWNER);
    const themeRow = [...plan.themes, ...plan.archivedThemes].find((theme) => theme.id === full.post.themeId) ?? null;
    const ownId = ownDayId(full.post.specialDay);
    const ownDay = ownId === null ? null : await getOwnDayFor(OWNER, ownId);
    const specialDay = specialDayForPost(full.post, { ownDay, translate, showDays: plan.profile.showDays, hidden: plan.hiddenDays });
    const ask = askOn(full.post.ask, specialDay);
    const fallback = fallbackSet({ count: size, words, askSentence: askSentenceFor(ask, { translate }) });
    if (fallback.length === 0) return refused('refuse.text.missing');

    /** @type {ReturnType<typeof readSetAnswer>} */
    let items = null;
    let aiProblem = null;
    let aiStatus = 502;
    try {
      const answer = await askAI({
        level: 'quick',
        messages: setMessages({
          kind: KIND, count: size, words, name, business: businessContent(plan.profile), theme: themeContent(themeRow), specialDay, ask, locale,
        }),
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      });
      items = readSetAnswer(answer.text, { kind: KIND, count: size });
      if (items === null) aiProblem = AI_WORDS.unreadable;
    } catch (error) {
      ({ problem: aiProblem, status: aiStatus } = aiFailure(error));
    }

    const ai = items !== null;
    // A set made before stays as it is when the AI could not make a new one.
    if (!ai && hasSet(full, KIND)) return json({ problem: aiProblem ?? AI_WORDS.unreadable }, aiStatus);
    const post = await saveWordsSetFor(OWNER, postId, KIND, ai ? items : fallback, { replace: true });
    if (post === null) return refused(REFUSED.notFound);
    return json({ post, ai, ...(aiProblem === null ? {} : { aiProblem }) }, 201);
  } catch (error) {
    return problemOf(error);
  }
}
