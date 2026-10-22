import { askAI } from '../../../../../lib/ai.js';
import { DataError } from '../../../../../lib/data/index.js';
import { campaignNamesFor } from '../../../../../lib/data/campaigns.js';
import { getOwnDayFor, planFor } from '../../../../../lib/data/plan.js';
import { getPostFor, idFromPath, saveVersionsFor, updatePostFor } from '../../../../../lib/data/posts.js';
import { linkSentenceFor } from '../../../../../lib/data/words.js';
import { getLocale, t } from '../../../../../lib/i18n/index.js';
import {
  AI_WORDS, aiFailure, askOn, businessContent, ownDayId, readWordsAnswer, specialDayForPost, themeContent, versionsFor, wordsMessages,
} from '../../../../../lib/plan/ai-words.js';
import { LIMITS, readWords } from '../../../../../lib/plan/limits.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { trackingFor } from '../../../../../lib/plan/share.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * Make my post: `{ text, replace? }`, sent by a press.
 *
 * 1. `text` is saved as the post's main words first.
 * 2. The networks are My plan's networks this post has not switched off; with
 *    none the answer is `{ problem: 'aiplan.noNetworks' }` (400). A network
 *    already marked shared is never written again: its words stay as they
 *    were shared.
 * 3. `replace` says what happens to words the person changed on a network
 *    not yet shared: absent (or false), and any such network makes the
 *    answer name them in `changed` with nothing more written, so the page can
 *    ask; `'all'` (or true) writes every network not yet shared; `'untouched'`
 *    writes only the networks not yet shared whose words the person has not
 *    changed (the person's changes stay). Anything else is refused.
 * 4. AI (`standard`) writes each of those networks' words from the text, the
 *    business, the theme and the special day (the post's own, else a day of
 *    remembrance its day falls on, so the words are calm). Any AI problem, or
 *    an answer that does not read, and the person's own words are fitted to
 *    each network without AI instead (`ai: false` with `aiProblem`). Either
 *    way every network's words go through `fitWords` (with room for the
 *    version's own link where links can be pressed, with its tracking fields
 *    while My plan tracks links: one more call reads the post's campaign's
 *    name) and are kept; each version keeps its link. With no network to
 *    write, nothing goes to AI.
 * 5. The post's ask (none on a day of remembrance): AI is
 *    told to end every version with it; a network written without AI ends
 *    with the ask's fixed sentence (`ask.sentence.<key>`), kept whole.
 *
 * Answers `{ post: PostFull, ai, aiProblem?, needsPicture, pictureIdea?,
 * changed? }`. `needsPicture` is true when AI wrote the words and the post has
 * no picture: the page then asks `POST /api/posts/[id]/pictures/new` (it may
 * send `pictureIdea` as `idea`). The person's words are never logged.
 */
export const dynamic = 'force-dynamic';

/** What `replace` may say, read: `ask`, `all` or `untouched`; null for anything else. @param {unknown} value */
function replaceOf(value) {
  if (value === undefined || value === null || value === false) return 'ask';
  if (value === true || value === 'all') return 'all';
  if (value === 'untouched') return 'untouched';
  return null;
}

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
  const words = readWords(asked.text, LIMITS.mainText, { required: true, multiline: true });
  if (!words.ok) return refused(words.problem);
  const replace = replaceOf(asked.replace);
  if (replace === null) return refused(REFUSED.request);
  const locale = getLocale();
  try {
    const saved = await updatePostFor(OWNER, postId, { mainText: words.value });
    if (saved === null) return refused(REFUSED.notFound);
    // Two reads at once at most (Tellop answers 4 records calls at once in one request).
    const [full, plan] = await Promise.all([getPostFor(OWNER, postId), planFor(OWNER)]);
    const linkSentence = await linkSentenceFor(OWNER);
    if (full === null) return refused(REFUSED.notFound);

    const byNetwork = new Map(full.versions.map((version) => [version.network, version]));
    const switchedOn = plan.networks.filter((key) => byNetwork.get(key)?.on !== false);
    if (switchedOn.length === 0) return json({ problem: AI_WORDS.noNetworks }, 400);
    const open = switchedOn.filter((key) => !byNetwork.get(key)?.sharedAt);
    const changed = open.filter((key) => byNetwork.get(key)?.changedByPerson === true);
    if (changed.length > 0 && replace === 'ask') return json({ post: full, ai: false, changed, needsPicture: false });
    const networks = replace === 'untouched' ? open.filter((key) => !changed.includes(key)) : open;
    if (networks.length === 0) return json({ post: full, ai: false, needsPicture: false });

    const themeRow = [...plan.themes, ...plan.archivedThemes].find((theme) => theme.id === full.post.themeId) ?? null;
    const campaigns = plan.profile.trackLinks === false ? [] : await campaignNamesFor(OWNER, [full.post.campaignId]);
    const tracking = trackingFor(full.post, { trackLinks: plan.profile.trackLinks, profileLink: plan.profile.profileLink, themes: [...plan.themes, ...plan.archivedThemes], campaigns });
    const ownId = ownDayId(full.post.specialDay);
    const ownDay = ownId === null ? null : await getOwnDayFor(OWNER, ownId);
    const specialDay = specialDayForPost(full.post, {
      ownDay, translate: (key) => t(key, locale), showDays: plan.profile.showDays, hidden: plan.hiddenDays,
    });
    const hasPicture = full.pictures.length > 0;
    const ask = askOn(full.post.ask, specialDay);

    /** @type {ReturnType<typeof readWordsAnswer>} */
    let read = null;
    let aiProblem = null;
    try {
      const answer = await askAI({
        level: 'standard',
        messages: wordsMessages({
          words: words.value,
          networks,
          business: businessContent(plan.profile),
          theme: themeContent(themeRow, { hashtags: true }),
          specialDay,
          linkSentence,
          locale,
          withPicture: true,
          ask,
        }),
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });
      read = readWordsAnswer(answer.text, networks);
      if (read === null) aiProblem = AI_WORDS.unreadable;
    } catch (error) {
      aiProblem = aiFailure(error).problem;
    }

    const ai = read !== null;
    const versions = versionsFor({
      networks,
      words: words.value,
      written: read?.networks ?? null,
      hashtags: themeRow?.hashtags ?? '',
      linkSentence,
      links: Object.fromEntries(networks.map((key) => [key, byNetwork.get(key)?.link ?? ''])),
      // AI's words are followed by a picture when the post has none, so they fit a caption at once.
      withPicture: hasPicture || ai,
      ask,
      translate: (key) => t(key, locale),
      tracking,
    });
    await saveVersionsFor(OWNER, postId, versions, { replace: true });
    const post = await getPostFor(OWNER, postId);
    if (post === null) return refused(REFUSED.notFound);
    return json({
      post,
      ai,
      ...(aiProblem === null ? {} : { aiProblem }),
      needsPicture: ai && !hasPicture,
      ...(ai && read.pictureIdea !== '' ? { pictureIdea: read.pictureIdea } : {}),
    });
  } catch (error) {
    return problemOf(error);
  }
}
