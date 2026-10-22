import { addInspirationFor } from '../../../lib/data/inspiration.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

import { noteRefusal } from './refusal.js';

/**
 * Saves an inspiration note: `POST { link?, note?, themeId? }` (a link, a
 * note or both; a theme in use, or none) → 201 `{ note }`. A refusal names
 * the field it is about: `{ problem, field }`. The link is kept as text; the
 * app never opens it. Past 500 notes kept a new one is refused
 * `refuse.inspiration.full`. At most 3 records calls, one after the other.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const note = await addInspirationFor(OWNER, body.value);
    return json({ note }, 201);
  } catch (error) {
    return noteRefusal(error);
  }
}
