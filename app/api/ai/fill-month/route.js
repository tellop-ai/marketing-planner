import { askAI } from '../../../../lib/ai.js';
import { listOwnDaysFor, planFor } from '../../../../lib/data/plan.js';
import { bringBackFor, listMonthFor, POST_REFUSALS } from '../../../../lib/data/posts.js';
import { getLocale, t } from '../../../../lib/i18n/index.js';
import {
  AI_WORDS, aiFailure, businessContent, monthMessages, readProposals, specialDayContent, themeContent,
} from '../../../../lib/plan/ai-words.js';
import { isCivilMonth, todayCivil } from '../../../../lib/plan/days.js';
import { LIMITS } from '../../../../lib/plan/limits.js';
import { isNetworkKey } from '../../../../lib/plan/networks.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';
import { emptySlots } from '../../../../lib/plan/slots.js';
import { specialDaysIn } from '../../../../lib/plan/special-days.js';

import { asksSpan, bringBackProposals, byDay, readSpan, spanSlots } from '../../../calendar/proposals.js';

/**
 * Fill my month: `{ month, perWeek, themeIds, networks? }`, on a press.
 *
 * The empty days come from `emptySlots` (the month's posts, `perWeek`, the
 * themes in turn, a celebration or shopping day marking the slot on it or
 * taking the nearest slot of its week, from today on; never a day of
 * remembrance). One `standard` request names a post idea for each slot (a
 * special day's slot is about that day), told the names of the month's posts
 * already planned so the new ones differ. Answers `{ proposals: [{ day,
 * name, themeId, specialDay? }] }`, only for those slots, and up to two "bring
 * back" proposals `{ day, name, themeId, fromPostId, customers }` (posts more
 * than 60 days old that customers named, on free days: `bringBackProposals`,
 * no AI; the AI is told their names with the month's posts), in day order;
 * with no empty day, only those and nothing goes to AI. Nothing is saved: the
 * calendar keeps them on Keep (`POST /api/month/keep`). An AI problem answers
 * `{ problem }` with `lib/ai.js`'s words key and its status (the calendar then
 * offers its plan without AI); an answer with no usable proposal,
 * `aiplan.unreadable`.
 *
 * `{ from, to, perWeek, themeIds, networks? }` instead of `month` names a span
 * of at most seven days (the first visit's days: `readSpan`, `spanSlots`)
 * across one or two months: the AI names only that span's empty slots, told
 * the posts planned in the months it touches; no bring-back. A span that does
 * not read is `refuse.request`. Records calls: the plan and the person's own
 * days (two at once: 3-5), the month's posts (2-3; a span, each month's:
 * 4-6), the posts to bring back (1-2; a span none): at most 11.
 */
export const dynamic = 'force-dynamic';

/** @param {unknown} value */
function isWholeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * The request's fields, read, or the refusal key.
 *
 * @param {Record<string, unknown>} asked
 * @returns {{ ok: true, month: string | null, span: { from: string, to: string, months: string[] } | null, perWeek: number, themeIds: number[],
 *   networks: string[] | null } | { ok: false, problem: string }}
 */
function readAsked(asked) {
  const span = asksSpan(asked) ? readSpan(asked.from, asked.to) : null;
  if (asksSpan(asked) && (span === null || asked.month !== undefined)) return { ok: false, problem: REFUSED.request };
  if (span === null && !isCivilMonth(asked.month)) return { ok: false, problem: REFUSED.request };
  const [least, most] = LIMITS.postsPerWeek;
  const perWeek = asked.perWeek;
  if (typeof perWeek !== 'number' || !Number.isInteger(perWeek) || perWeek < least || perWeek > most) return { ok: false, problem: AI_WORDS.perWeek };
  const themeIds = asked.themeIds ?? [];
  if (!Array.isArray(themeIds) || themeIds.length > LIMITS.themes * 2 || !themeIds.every(isWholeId)) return { ok: false, problem: POST_REFUSALS.theme };
  let networks = null;
  if (asked.networks !== undefined && asked.networks !== null) {
    if (!Array.isArray(asked.networks) || !asked.networks.every(isNetworkKey)) return { ok: false, problem: REFUSED.request };
    networks = [...new Set(/** @type {string[]} */ (asked.networks))];
  }
  return { ok: true, month: span === null ? /** @type {string} */ (asked.month) : null, span, perWeek, themeIds: [...new Set(/** @type {number[]} */ (themeIds))], networks };
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = readAsked(/** @type {Record<string, unknown>} */ (body.value));
  if (!asked.ok) return refused(asked.problem);
  const locale = getLocale();
  try {
    // Two reads at once at most (Tellop answers 4 records calls at once in one request).
    const [plan, ownDays] = await Promise.all([planFor(OWNER), listOwnDaysFor(OWNER)]);
    const themes = new Map(plan.themes.map((theme) => [theme.id, theme]));
    if (!asked.themeIds.every((id) => themes.has(id))) return refused(POST_REFUSALS.theme);
    const months = asked.span === null ? [/** @type {string} */ (asked.month)] : asked.span.months;
    /** @type {Map<string, any[]>} */
    const tilesOf = new Map();
    for (const month of months) tilesOf.set(month, await listMonthFor(OWNER, month, []));
    const tiles = [...tilesOf.values()].flat();
    const daysOf = new Map(months.map((month) => [month, specialDaysIn(month, { showDays: plan.profile.showDays, hidden: plan.hiddenDays, own: ownDays })]));
    const specialDays = [...daysOf.values()].flat();
    const today = todayCivil();
    const slots = asked.span === null
      ? emptySlots({
        month: /** @type {string} */ (asked.month),
        perWeek: asked.perWeek,
        taken: tiles,
        themeIds: asked.themeIds,
        specialDays,
        mondayFirst: locale === 'tr',
        today,
      })
      : spanSlots({
        span: asked.span, perWeek: asked.perWeek, themeIds: asked.themeIds, mondayFirst: locale === 'tr', today,
        takenOf: (month) => tilesOf.get(month) ?? [], specialDaysOf: (month) => daysOf.get(month) ?? [],
      });
    const back = asked.span !== null ? [] : bringBackProposals(await bringBackFor(OWNER, { today }), {
      month: /** @type {string} */ (asked.month), today, taken: tiles, proposed: slots, specialDays, inUse: new Set(themes.keys()), chosen: new Set(asked.themeIds),
    });
    if (slots.length === 0) return json({ proposals: back });

    const described = slots.map((slot) => {
      const special = slot.specialDayKey ? specialDays.find((day) => day.key === slot.specialDayKey && day.day === slot.day) : undefined;
      return {
        day: slot.day,
        theme: themeContent(slot.themeId === null ? null : themes.get(slot.themeId)),
        specialDay: special ? specialDayContent({ name: special.own ? special.name : t(special.nameKey, locale), kind: special.kind, note: special.note }) : null,
      };
    });
    let answer;
    try {
      answer = await askAI({
        level: 'standard',
        messages: monthMessages({
          business: businessContent(plan.profile, { goal: true }),
          networks: asked.networks ?? plan.networks,
          slots: described,
          planned: [...tiles, ...back].map((tile) => ({ day: tile.day, name: tile.name })),
          locale,
        }),
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      });
    } catch (error) {
      const failure = aiFailure(error);
      return json({ problem: failure.problem }, failure.status);
    }
    const proposals = readProposals(answer.text, slots);
    if (proposals === null || proposals.length === 0) return json({ problem: AI_WORDS.unreadable }, 502);
    return json({ proposals: byDay([...proposals, ...back]) });
  } catch (error) {
    return failed(error);
  }
}
