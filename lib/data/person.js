/**
 * Who is using this app right now (`AGENTS.md` rule 1).
 *
 * `await currentPerson()` answers `{ id, name, role, preview }`:
 *
 *  - `role` is `'owner'`, `'member'`, `'viewer'` or `'helper'`. Draw only the
 *    buttons that role may use: the host refuses the rest anyway, and a
 *    refused change shows `error.cannotChange` ("You cannot change this.").
 *  - `name` is text to draw, or `null` when the host knows no name: then draw
 *    a word of the app's own for "you".
 *  - `preview` is `true` only while the app's owner looks at the app as a
 *    Member or a Viewer. Draw a way back then: a link to `/.tellop/door/as`.
 *  - `id` names one person in this app, the same on every visit: `'owner'`
 *    for the app's owner, on the computer and online alike (also while they
 *    look as a Member or a Viewer), and the door's `p_` id for anyone else.
 *
 * The host answers, never the app or the browser. Inside Tellop on the
 * computer, Tellop answers the app's owner (the account's name, role
 * `owner`). Online, Tellop's wrapper reads
 * `GET http://records.tellop.invalid/person`, the person the door let in.
 * Nothing a request carries (a header, a cookie, a field, an address) can
 * name the person, so this takes no argument. An app outside Tellop has one
 * person, the one who runs it: its owner.
 *
 * A host answer of any other shape, or no answer inside Tellop, is refused
 * with `error.storageUnreadable` rather than guessed: never the owner by
 * default where a host is present.
 *
 * A page that asks is drawn for each visit, never ahead of time: this first
 * awaits Next's `connection()`, so `next build`, where nobody visits and no
 * host answers, cannot draw it once as the owner and serve that to everyone.
 */

import process from 'node:process';

import { DataError } from './refusal.js';

/** The roles a person may hold, as the host names them. */
export const ROLES = Object.freeze(['owner', 'member', 'viewer', 'helper']);

/** Where the owner goes back to their own view after looking as a Member or a Viewer. */
export const BACK_TO_OWNER = '/.tellop/door/as';

const PERSON_DOOR = Symbol.for('tellop.person');
const TELLOP_DOORS = ['tellop.internalRecordsAction', 'tellop.internalRecordsRead', 'tellop.internalFiles'].map((name) => Symbol.for(name));
/** Only an owner looking at the app in a lower role is in a preview. */
const PREVIEW_ROLES = Object.freeze(['member', 'viewer']);
/** The longest name the host hands on, in characters. */
const MAX_NAME = 64;
/** The owner's id, on the computer and online; anyone else's is the door's: `p_` and 22 letters, digits, `-` or `_`. */
const OWNER_ID = 'owner';
const DOOR_ID = /^p_[A-Za-z0-9_-]{22}$/u;
const OUTSIDE_TELLOP = Object.freeze({ id: OWNER_ID, name: null, role: 'owner', preview: false });

function insideTellop() {
  return process.env.TELLOP_INTERNAL_RECORDS === '1' || TELLOP_DOORS.some((door) => globalThis[door] !== undefined);
}

/**
 * Waits for the visit this call belongs to, so Next draws the page for each
 * visit and never in `next build`, where there is none (`connection()`). Next
 * names itself in `NEXT_RUNTIME`; a check under `node --test` has no Next and
 * no visit to wait for.
 */
async function forThisVisit() {
  if (!process.env.NEXT_RUNTIME) return;
  // `.js`: Node's own loader (a check that sets NEXT_RUNTIME) finds no file without it; Next's finds either.
  const { connection } = await import('next/server.js');
  await connection();
}

/** The host's answer as this helper hands it on, or `null` when it is any other shape. */
function shaped(answer) {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const keys = Object.keys(answer);
  const previewed = keys.includes('preview');
  if (keys.length !== (previewed ? 4 : 3) || !['id', 'name', 'role'].every((key) => keys.includes(key))) return null;
  const { id, name, role, preview } = answer;
  if (typeof id !== 'string' || !(id === OWNER_ID || DOOR_ID.test(id)) || !ROLES.includes(role)) return null;
  if (name !== null && (typeof name !== 'string' || name.trim() === '' || [...name].length > MAX_NAME)) return null;
  if (previewed && (preview !== true || !PREVIEW_ROLES.includes(role))) return null;
  // Only the owner is `'owner'`, in their own role or looking in a lower one.
  if ((id === OWNER_ID) !== (role === 'owner' || previewed)) return null;
  return Object.freeze({ id, name, role, preview: previewed });
}

/**
 * The person using the app in this request.
 *
 * @returns {Promise<{ id: string, name: string | null, role: 'owner' | 'member' | 'viewer' | 'helper', preview: boolean }>}
 */
export async function currentPerson() {
  await forThisVisit();
  const door = globalThis[PERSON_DOOR];
  if (door === undefined && !insideTellop()) return OUTSIDE_TELLOP;
  if (typeof door !== 'function') throw new DataError('error.storageUnreadable');
  let answer;
  try {
    answer = await door();
  } catch {
    throw new DataError('error.storageUnreadable');
  }
  const person = shaped(answer);
  if (person === null) throw new DataError('error.storageUnreadable');
  return person;
}
