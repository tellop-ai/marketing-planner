import { createPostFor } from '../../../lib/data/posts.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * A new post: `{ day?, name?, mainText?, themeId?, specialDay?, campaignId?,
 * ask?, videoPlan? }`, any of them or none (`{}`). `ask` is one of `ASKS`
 * (`lib/plan/asks.js`) or `''`; `videoPlan` a plan object
 * (`lib/plan/video-plan.js`) or `''`. The name may stay empty: the page then shows
 * "Untitled post" in the person's language. `mainText` is read as the words
 * box reads it (the day sheet sends a special day's suggestion). A day in a
 * month that already holds the most posts a month keeps is refused
 * (`refuse.post.monthFull`). Answers `{ post }`.
 */
export const dynamic = 'force-dynamic';

const FIELDS = Object.freeze(['day', 'name', 'mainText', 'themeId', 'specialDay', 'campaignId', 'ask', 'videoPlan']);

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const asked = /** @type {Record<string, unknown>} */ (body.value);
  const fields = Object.fromEntries(FIELDS.filter((name) => asked[name] !== undefined).map((name) => [name, asked[name]]));
  try {
    const post = await createPostFor(OWNER, fields);
    return json({ post }, 201);
  } catch (error) {
    return failed(error);
  }
}
