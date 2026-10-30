/**
 * What this visit's person may press, for a server page (server only: it asks
 * the host through `lib/data/person.js`). Every page asks once, before its
 * reads, and hands the answer to its view (`app/shell.jsx`).
 */

import { currentPerson } from '../data/person.js';
import { DataError } from '../data/refusal.js';

import { UNKNOWN_RIGHTS, rightsOf } from './roles.js';

/**
 * `rightsOf(await currentPerson())`. When the host's answer cannot be read
 * (`currentPerson` refuses rather than guess), the page draws nothing that
 * saves and says so once (`UNKNOWN_RIGHTS`, `unknown`): never the owner's
 * presses by default. Any other failure (Next's own) goes on as it came.
 *
 * @returns {Promise<{ add: boolean, change: boolean, preview: boolean, unknown: boolean }>}
 */
export async function rightsForThisVisit() {
  try {
    return rightsOf(await currentPerson());
  } catch (error) {
    if (error instanceof DataError) return UNKNOWN_RIGHTS;
    throw error;
  }
}
