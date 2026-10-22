/**
 * What the Contacts page reads, one read after another (Tellop answers at
 * most four records calls of one request at once): the business's name for
 * the menu, the contacts (at most 9 calls) and the ready answers and offers
 * the message box can start from (at most 4 calls). At most 14 calls; opening
 * the page saves nothing (AGENTS.md rule 4a).
 */

import { listContactsFor } from '../../lib/data/contacts.js';
import { getProfileFor } from '../../lib/data/plan.js';
import { listReadyWordsFor } from '../../lib/data/words.js';

/** The ready-word kinds a message can start from. */
export const MESSAGE_KINDS = Object.freeze(['answer', 'offer']);

/**
 * @param {{ owner: string }} options
 * @returns {Promise<{ business: string, contacts: import('../../lib/data/contacts.js').ContactSummary[],
 *   answers: Array<{ id: number, kind: string, title: string, text: string }> }>}
 */
export async function readContactsPage({ owner }) {
  const profile = await getProfileFor(owner);
  const contacts = await listContactsFor(owner);
  const readyWords = await listReadyWordsFor(owner);
  const answers = readyWords
    .filter((word) => MESSAGE_KINDS.includes(word.kind))
    .map(({ id, kind, title, text }) => ({ id, kind, title, text }));
  return { business: String(profile?.businessName ?? ''), contacts, answers };
}
