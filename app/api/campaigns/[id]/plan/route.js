import { askAI } from '../../../../../lib/ai.js';
import { campaignPlanFor, keepCampaignPlanFor, recordId } from '../../../../../lib/data/campaigns.js';
import { getLocale, t } from '../../../../../lib/i18n/index.js';
import { aiFailure, businessContent } from '../../../../../lib/plan/ai-words.js';
import { planNamesMessages, planPostName, readPlanNames } from '../../../../../lib/plan/campaign-plans.js';
import { todayCivil } from '../../../../../lib/plan/days.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * Plan the posts: `POST { kind: 'launch' | 'event' | 'sale' }` adds the
 * kind's dated idea posts across the campaign's days still ahead
 * (`campaignPlanFor`: one a day, never on a day that already holds a post,
 * never on a day of remembrance, at most 12; an event's "on the day" post on
 * its last day and its thanks the day after), in the campaign, with the theme
 * its posts use most (when they give none: for a sale the first theme in use
 * that sells, else the first theme in use) and the ask that fits the kind
 * (launch: visit, event: book, sale: buy).
 *
 * Names: the fixed names from the words (`campaign.plan.post.<kind>.<key>`,
 * with the campaign's name); when AI answers, one `quick` request rewrites
 * only the names in the business's voice (the business, the campaign and the
 * fixed names travel as content); an answer that does not read, or a name
 * that does not, keeps the fixed ones. AI is asked only when there is a post
 * to name.
 *
 * Answers 201 `{ posts, skipped, ai, aiProblem? }`: the posts kept (`{ id,
 * name, day, themeId, campaignId, ask }`, by day) and the planned days left
 * out (`{ key, day, reason: 'taken' | 'remembrance' }`). Refused: a kind that
 * is not one (400 `refuse.campaign.planKind`), a campaign that is done (400
 * `refuse.campaign.over`), a month that would pass its posts
 * (`refuse.post.monthFull`); another owner's campaign is not found. Records
 * calls: three, one after another (the campaign, what its days hold, the
 * posts kept in one call).
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const id = recordId((await context?.params)?.id);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  const locale = getLocale();
  try {
    const plan = await campaignPlanFor(OWNER, id, asked.kind, { today: todayCivil() });
    if (plan === null) return refused(REFUSED.notFound);
    const fixed = plan.slots.map((slot) => planPostName(plan.kind, slot.key, plan.campaign.name, (key, values) => t(key, locale, values)));

    let names = null;
    let aiProblem = null;
    if (fixed.length > 0) {
      try {
        const answer = await askAI({
          level: 'quick',
          messages: planNamesMessages({ kind: plan.kind, campaign: plan.campaign, names: fixed, business: businessContent(plan.business), locale }),
          max_tokens: 600,
          response_format: { type: 'json_object' },
        });
        names = readPlanNames(answer.text, fixed);
        if (names === null) aiProblem = 'aiplan.unreadable';
      } catch (error) {
        aiProblem = aiFailure(error).problem;
      }
    }
    const ai = names !== null;
    const posts = await keepCampaignPlanFor(OWNER, plan, names ?? fixed, { madeBy: ai ? 'ai' : 'person' });
    return json({ posts, skipped: plan.skipped, ai, ...(aiProblem === null ? {} : { aiProblem }) }, 201);
  } catch (error) {
    return failed(error);
  }
}
