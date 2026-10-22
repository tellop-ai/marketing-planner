import { keepIdeasFor } from '../../../../lib/data/ideas.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * Keeps the ideas a person picked from "Give me ideas": `{ names, themeId }`,
 * 1 to 20 names of at most `LIMITS.name` characters each, and a theme of this
 * owner or null. They become ideas (posts with no day), all or none, in one
 * save. Answers `{ posts }` (201), in the order the names came.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const { names, themeId = null } = /** @type {Record<string, unknown>} */ (body.value);
  try {
    const posts = await keepIdeasFor(OWNER, names, themeId);
    return json({ posts }, 201);
  } catch (error) {
    return failed(error);
  }
}
