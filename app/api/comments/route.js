import { addCommentFor, listCommentsFor } from '../../../lib/data/customers.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * What customers said. `GET ?after=` answers one page of them, newest first,
 * `{ items, next }` (`next` is the `after` of the page after it, null when
 * none is left; a page holds at most `LIST_PAGE`).
 * `POST { text, name?, bestLine?, stars?, source?, receivedOn?, permission?,
 * permissionNote?, screenshot? }` adds one, `{ comment }`. `screenshot` is the
 * digest `appendPicture` put in the page's form (the picture went ahead on
 * its own, AGENTS.md rule 6c); it must name a kept picture. The form travels
 * as JSON, so another site's page cannot send it without asking first.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function GET(request) {
  const after = new URL(request.url).searchParams.get('after');
  try {
    return json(await listCommentsFor(OWNER, { after }));
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    return json({ comment: await addCommentFor(OWNER, body.value) });
  } catch (error) {
    return failed(error);
  }
}
