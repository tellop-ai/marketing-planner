import { planFor } from '../../../../lib/data/plan.js';
import { keepProposalsFor } from '../../../../lib/data/posts.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';
import { postState } from '../../../../lib/plan/state.js';

import { readKeepRequest } from '../../../calendar/proposals.js';

/**
 * Keep these: `POST { month, madeBy: 'ai' | 'person', proposals: [{ day,
 * name, themeId, specialDay? } | { day, fromPostId }] }` keeps each proposal
 * as an idea post on its day, and each "bring back" proposal as a copy of the
 * post it names on its day (as Post again copies it), and answers `{ posts }`
 * (tiles, 201).
 *
 * All the posts are kept in one records call (`keepProposalsFor`, at most
 * `MOST_PROPOSALS` rows), and the copies' pictures, hashtags and links in one
 * batch after it, which removes every post again when it fails: either every
 * proposal is kept or none is. A bring-back proposal whose post is gone is
 * left out. Every row names the owner, chosen here, never by the request.
 *
 * Refusals: a month outside 2000-2199 (`month.refuse.month`), more than 62
 * proposals (`month.refuse.count`), a day outside the month
 * (`month.refuse.day`), a missing or too long name (`refuse.text.*`), a theme
 * not in use (`month.refuse.theme`), any other shape (`refuse.request`).
 * A month that would then hold more than `MOST_A_MONTH` posts is refused
 * (`refuse.post.monthFull`). Records calls, one at a time: the plan (2, 4
 * with the most themes), the month's count (1) and the keep (1); with
 * bring-back proposals, two or three more read the posts they copy and one
 * keeps the copies' pictures, hashtags and links.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const plan = await planFor(OWNER);
    const read = readKeepRequest(body.value, new Set(plan.themes.map((theme) => theme.id)));
    if (!read.ok) return refused(read.problem);
    const { month, madeBy, proposals } = read.value;
    const kept = await keepProposalsFor(OWNER, month, madeBy, proposals);
    const now = Date.now();
    // A new idea has no words and no picture; a copy has its main words, its pictures and no words for any network yet.
    const posts = kept.map((post) => {
      const picture = post.pictures.find((item) => item.chosen) ?? null;
      const state = postState({ networks: plan.networks, versions: post.versions, hasChosenPicture: picture !== null, mainText: post.mainText, now });
      return {
        id: post.id,
        name: post.name,
        day: post.day,
        time: post.time,
        themeId: post.themeId,
        campaignId: post.campaignId,
        specialDay: post.specialDay,
        madeBy: post.madeBy,
        state: state.state,
        shared: state.shared,
        scheduled: state.scheduled,
        of: state.of,
        networks: [...state.networks],
        picture,
      };
    });
    return json({ posts }, 201);
  } catch (error) {
    return failed(error);
  }
}
