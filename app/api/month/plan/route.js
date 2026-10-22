import { listOwnDaysFor, planFor } from '../../../../lib/data/plan.js';
import { bringBackFor, listMonthFor } from '../../../../lib/data/posts.js';
import { getLocale, t } from '../../../../lib/i18n/index.js';
import { todayCivil } from '../../../../lib/plan/days.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';
import { emptySlots } from '../../../../lib/plan/slots.js';
import { specialDaysIn } from '../../../../lib/plan/special-days.js';

import { bringBackProposals, byDay, planProposals, readPlanRequest, spanSlots } from '../../../calendar/proposals.js';
import { mondayFirstFor } from '../../../calendar/rules.js';

/**
 * Fill my month without AI: `POST { month, perWeek, themeIds }` answers
 * `{ proposals: [{ day, name, themeId, specialDay? }] }`, an idea for each
 * empty slot of the month from today on (`emptySlots`), named from its theme
 * or its special day, and up to two "bring back" proposals `{ day, name,
 * themeId, fromPostId, customers }` (`bringBackProposals`: posts more than 60
 * days old that customers named, on free days), in day order. Nothing is
 * saved: the calendar shows the proposals and keeps them only when the person
 * presses Keep these (`/api/month/keep`).
 *
 * `POST { from, to, perWeek, themeIds }` instead names a span of at most
 * seven days (the first visit's days: `readSpan`, `spanSlots`) across one
 * or two months: ideas for the span's empty slots only, no bring-back.
 *
 * Refusals: a month outside 2000-2199 (`month.refuse.month`), a span that
 * does not read (`refuse.request`), posts a week outside 1-14
 * (`month.refuse.perWeek`), a theme that is not in use
 * (`month.refuse.theme`). Records calls, one at a time: the plan (2, 4 with
 * the most themes), the month's posts (2-3; a span, each month's: 4-6), the
 * person's own days (1), the posts to bring back (1-2; a span none): at most
 * 11.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const plan = await planFor(OWNER);
    const read = readPlanRequest(body.value, new Set(plan.themes.map((theme) => theme.id)));
    if (!read.ok) return refused(read.problem);
    const { month, span, perWeek, themeIds } = read.value;
    const locale = getLocale();
    const words = { themes: plan.themes, words: (key) => t(key, locale), fallback: t('month.plan.idea', locale) };
    if (span !== null) {
      const takenOf = new Map();
      for (const each of span.months) takenOf.set(each, await listMonthFor(OWNER, each, []));
      const own = await listOwnDaysFor(OWNER);
      const daysOf = new Map(span.months.map((each) => [each, specialDaysIn(each, { showDays: plan.profile.showDays, hidden: plan.hiddenDays, own })]));
      const slots = spanSlots({
        span, perWeek, themeIds, mondayFirst: mondayFirstFor(locale), today: todayCivil(), takenOf: (each) => takenOf.get(each) ?? [], specialDaysOf: (each) => daysOf.get(each) ?? [],
      });
      return json({ proposals: planProposals(slots, { ...words, specialDays: [...daysOf.values()].flat() }) });
    }
    const taken = await listMonthFor(OWNER, month, []);
    const own = await listOwnDaysFor(OWNER);
    const specialDays = specialDaysIn(month, { showDays: plan.profile.showDays, hidden: plan.hiddenDays, own });
    const today = todayCivil();
    const slots = emptySlots({ month, perWeek, taken, themeIds, specialDays, mondayFirst: mondayFirstFor(locale), today });
    const proposals = planProposals(slots, {
      themes: plan.themes,
      specialDays,
      words: (key) => t(key, locale),
      fallback: t('month.plan.idea', locale),
    });
    const back = bringBackProposals(await bringBackFor(OWNER, { today }), {
      month, today, taken, proposed: proposals, specialDays, inUse: new Set(plan.themes.map((theme) => theme.id)), chosen: new Set(themeIds),
    });
    return json({ proposals: byDay([...proposals, ...back]) });
  } catch (error) {
    return failed(error);
  }
}
