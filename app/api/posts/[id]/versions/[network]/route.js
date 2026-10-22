import { DataError } from '../../../../../../lib/data/index.js';
import { idFromPath, markScheduledFor, markSharedFor, RESULT_COUNTS, saveResultsFor, saveVersionFor, unmarkSharedFor } from '../../../../../../lib/data/posts.js';
import { isNetworkKey } from '../../../../../../lib/plan/networks.js';
import { OWNER } from '../../../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../../../lib/plan/request.js';

/**
 * One network's version of a post.
 *
 * - `PUT` `{ text?, hashtags?, link?, firstComment?, on? }`: the person's own
 *   edit (their words are then kept when Make my post runs again, unless they
 *   say to replace them). Answers `{ version }`.
 * - `POST` `{ action: 'shared', sharedLink? }` marks it shared now (a later
 *   press only changes the address; a version scheduled for later is shared
 *   now), `{ action: 'scheduled' }` marks it scheduled for the post's day and
 *   time (answers `{ version, timeAssumed }`: `timeAssumed` is true when the
 *   post has no time and 12:00 was used; a post with no day is refused,
 *   `refuse.post.noDay`), `{ action: 'unshared' }` takes either back,
 *   `{ action: 'results', views?, likes?, comments?, shares?, saves?, clicks?,
 *   resultNote? }` keeps its results. Answers `{ version }`.
 *
 * A network that is not one of the app's, or another owner's post, is not found.
 */
export const dynamic = 'force-dynamic';

const WORDS = Object.freeze(['text', 'hashtags', 'link', 'firstComment', 'on']);
const RESULTS = Object.freeze([...RESULT_COUNTS, 'resultNote']);

/** @param {{ params: Promise<{ id: string, network: string }> | { id: string, network: string } }} context */
async function targetOf(context) {
  const params = await context?.params;
  const postId = idFromPath(params?.id);
  const network = params?.network;
  if (postId === null || !isNetworkKey(network)) return null;
  return { postId, network: /** @type {string} */ (network) };
}

/** @param {Record<string, unknown>} asked @param {readonly string[]} names */
function pick(asked, names) {
  return Object.fromEntries(names.filter((name) => asked[name] !== undefined).map((name) => [name, asked[name]]));
}

/** @param {unknown} error */
function problemOf(error) {
  if (error instanceof DataError && error.messageKey === REFUSED.notFound) return refused(REFUSED.notFound);
  return failed(error);
}

/** @param {Request} request @param {{ params: Promise<{ id: string, network: string }> }} context */
export async function PUT(request, context) {
  const target = await targetOf(context);
  if (target === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const version = await saveVersionFor(OWNER, target.postId, target.network, pick(body.value, WORDS));
    return version === null ? refused(REFUSED.notFound) : json({ version });
  } catch (error) {
    return problemOf(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string, network: string }> }} context */
export async function POST(request, context) {
  const target = await targetOf(context);
  if (target === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  try {
    let version;
    if (asked.action === 'shared') {
      version = await markSharedFor(OWNER, target.postId, target.network, pick(asked, ['sharedLink']));
    } else if (asked.action === 'scheduled') {
      const scheduled = await markScheduledFor(OWNER, target.postId, target.network);
      return scheduled === null ? refused(REFUSED.notFound) : json(scheduled);
    } else if (asked.action === 'unshared') {
      version = await unmarkSharedFor(OWNER, target.postId, target.network);
    } else if (asked.action === 'results') {
      version = await saveResultsFor(OWNER, target.postId, target.network, pick(asked, RESULTS));
    } else {
      return refused(REFUSED.request);
    }
    return version === null ? refused(REFUSED.notFound) : json({ version });
  } catch (error) {
    return problemOf(error);
  }
}
