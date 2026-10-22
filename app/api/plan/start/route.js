import { startPlanFor } from '../../../../lib/data/plan.js';
import { getLocale, t } from '../../../../lib/i18n/index.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

import { readStart, THEME_IDEAS } from '../../../first-visit/rules.js';

/**
 * The first-visit start, on the press that makes the first posts:
 * `POST { businessName, networks: [1-2 platforms], themes: [1-3 theme ideas] }`
 * saves the business name and the platforms and adds a theme for each idea
 * (named in the person's language; an idea whose name a theme in use already
 * has is that theme), then answers `{ profile, themes: [{ id, name, colour,
 * sells, idea }] }`: the themes the first posts take, in the order asked
 * (with no room for a new theme, the first three themes in use, `idea` null).
 * The posts themselves are made by Fill my month and Keep these, as on the
 * calendar.
 *
 * Refusals: a field's words (`refuse.text.*`, field `businessName`), any other
 * shape (`refuse.request`, with `networks` or `themes` when about them), and a
 * plan that already has a business name (`refuse.plan.started`, 409). Records
 * calls: 3, one after the other (`startPlanFor`).
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const read = readStart(body.value);
  if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
  const { businessName, networks, themes } = read.value;
  const locale = getLocale();
  const ideas = themes.map((key) => THEME_IDEAS.find((idea) => idea.key === key));
  try {
    const started = await startPlanFor(OWNER, {
      businessName,
      networks: networks.join(','),
      themes: ideas.map((idea) => ({
        name: t(`start.theme.${idea.key}`, locale),
        about: t(`start.theme.${idea.key}.about`, locale),
        sells: idea.sells,
      })),
    });
    const made = started.themes
      .map((theme, index) => (theme === null ? null : { ...theme, idea: ideas[index].key }))
      .filter((theme) => theme !== null);
    const chosen = made.length > 0 ? made : started.inUse.slice(0, 3).map((theme) => ({ ...theme, idea: null }));
    return json({ profile: started.profile, themes: chosen });
  } catch (error) {
    if (error?.messageKey === 'refuse.plan.started') return json({ problem: error.messageKey }, 409);
    return failed(error);
  }
}
