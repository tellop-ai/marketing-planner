import { askAI } from '../../../../lib/ai.js';
import { latestInspirationFor } from '../../../../lib/data/inspiration.js';
import { planFor } from '../../../../lib/data/plan.js';
import { listIdeasFor, POST_REFUSALS } from '../../../../lib/data/posts.js';
import { getLocale } from '../../../../lib/i18n/index.js';
import { AI_WORDS, aiFailure, businessContent, ideasMessages, inspirationContent, readIdeas, themeContent } from '../../../../lib/plan/ai-words.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * Give me ideas: `{ themeId, count? }`, on a press. `themeId` is one of the
 * person's themes (or null for the business as a whole); `count` is 1 to 10,
 * 10 when left out.
 *
 * One `quick` request from the business, the theme, the names of the ideas
 * already kept (at most 50) and the person's newest inspiration notes (at
 * most 10: for a theme, its notes and the notes with no theme), sent as
 * content (a note's link is text, never opened). Answers `{ ideas: string[] }`: clean names, each
 * once, none the person already has, at most `LIMITS.name` characters.
 * Nothing is saved: the page keeps the ones the person picks
 * (`POST /api/ideas/keep`). An AI problem answers `{ problem }` with
 * `lib/ai.js`'s words key; an answer with no usable idea, `aiplan.unreadable`.
 */
export const dynamic = 'force-dynamic';

/** The most ideas one press asks for, and the most kept ideas whose names are sent. */
const MOST_IDEAS = 10;
const EXISTING_SENT = 50;

/** @param {unknown} value */
function isWholeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  const themeId = asked.themeId ?? null;
  if (themeId !== null && !isWholeId(themeId)) return refused(POST_REFUSALS.theme);
  const count = asked.count ?? MOST_IDEAS;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MOST_IDEAS) return refused(REFUSED.request);
  const locale = getLocale();
  try {
    const [plan, ideas] = await Promise.all([planFor(OWNER), listIdeasFor(OWNER, [], EXISTING_SENT)]);
    const themeRow = themeId === null ? null : [...plan.themes, ...plan.archivedThemes].find((theme) => theme.id === themeId) ?? null;
    if (themeId !== null && themeRow === null) return refused(POST_REFUSALS.theme);
    const existing = [...new Set(ideas.map((idea) => idea.name).filter((name) => typeof name === 'string' && name.trim() !== ''))];
    const notes = await latestInspirationFor(OWNER, { themeId });
    const inspiration = inspirationContent(notes, [...plan.themes, ...plan.archivedThemes]);

    let answer;
    try {
      answer = await askAI({
        level: 'quick',
        messages: ideasMessages({ business: businessContent(plan.profile, { goal: true }), theme: themeContent(themeRow), existing, count, locale, inspiration }),
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });
    } catch (error) {
      const failure = aiFailure(error);
      return json({ problem: failure.problem }, failure.status);
    }
    const names = readIdeas(answer.text, { count, existing });
    if (names === null || names.length === 0) return json({ problem: AI_WORDS.unreadable }, 502);
    return json({ ideas: names });
  } catch (error) {
    return failed(error);
  }
}
