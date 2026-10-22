import { DataError } from '../../../../../lib/data/index.js';
import { copyDayFor, copyPostFor, idFromPath } from '../../../../../lib/data/posts.js';
import { todayCivil } from '../../../../../lib/plan/days.js';
import { OWNER } from '../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../lib/plan/request.js';

/**
 * Post again. `GET` answers `{ day }`, the day the post maker offers first:
 * the first day from today on that holds no post (one records call; it saves
 * nothing). `POST { day? }` makes a new post copying this one
 * (`copyPostFor`: its name, main words, theme, campaign, ask, video plan,
 * hashtags, links and pictures, never its words for each network, its shares
 * or its results) on `day` (none or null: an idea with no day) and answers
 * `{ id, post }` (201); the maker then opens it.
 *
 * Refusals: another owner's post or none (`error.notFound`, 404), a day that
 * is not one (`refuse.post.day`), a month already full
 * (`refuse.post.monthFull`), a body that is not a JSON object or names other
 * fields than `day` (`refuse.request`). Records calls: GET 1; POST 4 (two read
 * the post, one keeps the copy, one its pictures, hashtags and links), 5 when
 * the last fails and the copy is removed again.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> | { id: string } }} context */
async function idOf(context) {
  const params = await context?.params;
  return idFromPath(params?.id);
}

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function GET(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    const found = await copyDayFor(OWNER, id, todayCivil());
    return found === null ? refused(REFUSED.notFound) : json(found);
  } catch (error) {
    if (!(error instanceof DataError)) return json({ problem: 'error.storageUnreadable' }, 500);
    return problemOf(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  if (Object.keys(asked).some((name) => name !== 'day')) return refused(REFUSED.request);
  try {
    const copy = await copyPostFor(OWNER, id, { day: asked.day });
    return copy === null ? refused(REFUSED.notFound) : json({ id: copy.post.id, post: copy.post }, 201);
  } catch (error) {
    return problemOf(error);
  }
}
