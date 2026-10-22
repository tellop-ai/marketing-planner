import { followersFor, saveFollowersFor } from '../../../lib/data/followers.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * Followers, one number a month for each platform.
 *
 * - `GET ?month=YYYY-MM` answers `{ month, followers: { [network]: count } }`
 *   (only the networks with a number). Reading saves nothing.
 * - `PUT { month, network, count }` keeps one: a whole number from 0 to
 *   1,000,000,000, or null (or `''`) to remove it. Answers `{ month, network,
 *   count }`. A count that is not such a number is refused `refuse.number`;
 *   a month or network that is not one, `refuse.request`.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function GET(request) {
  const month = new URL(request.url).searchParams.get('month');
  try {
    return json({ month, followers: await followersFor(OWNER, month) });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function PUT(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const { month, network, count } = body.value;
  if (!Object.hasOwn(body.value, 'count')) return refused(REFUSED.request);
  try {
    return json(await saveFollowersFor(OWNER, month, network, count));
  } catch (error) {
    return failed(error);
  }
}
