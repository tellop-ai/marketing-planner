/**
 * What the Ideas page reads, server only. Kept apart from the page so the
 * checks can count the records calls one request makes (Tellop allows 16).
 */

import { INSPIRATION, listInspirationFor } from '../../lib/data/inspiration.js';
import { planFor } from '../../lib/data/plan.js';
import { listIdeasFor } from '../../lib/data/posts.js';
import { OWNER } from '../../lib/plan/owner.js';

/** The most ideas the page shows (newest first). */
export const IDEAS_SHOWN = 100;

/**
 * The plan, the newest ideas and the newest inspiration notes, one read after
 * another, at most 13 records calls: the plan (2), the ideas (at most 9) and
 * the notes (at most 2). No networks are passed, so no post's words are read:
 * an idea's card needs only its name and theme.
 *
 * @param {string} [owner]
 * @returns {Promise<{ plan: Awaited<ReturnType<typeof planFor>>, ideas: { id: number, name: string, themeId: number | null }[], full: boolean,
 *   notes: Awaited<ReturnType<typeof listInspirationFor>>, notesFull: boolean }>}
 */
export async function readIdeas(owner = OWNER) {
  const plan = await planFor(owner);
  const tiles = await listIdeasFor(owner, [], IDEAS_SHOWN);
  const notes = await listInspirationFor(owner);
  return {
    plan,
    ideas: tiles.map(({ id, name, themeId }) => ({ id, name, themeId })),
    full: tiles.length >= IDEAS_SHOWN,
    notes,
    notesFull: notes.length >= INSPIRATION.shown,
  };
}
