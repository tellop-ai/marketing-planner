/**
 * Which presses each role gets (`AGENTS.md` rule 1), in one place.
 *
 * Online, the people the owner lets in each have a role, and the host refuses
 * what that role may not do: every write by a Viewer, and a Member's change or
 * removal of a record the Member did not add (the host keeps who added each
 * record; this app does not know). So the app draws:
 *
 * - **Owner and Helper:** every press.
 * - **Member:** the presses that add something new (a post, an idea, a
 *   customer, a comment, a contact, a note, a campaign and its steps, a
 *   download kept as a file), never one that changes or removes something
 *   already kept, nor My plan (the business's shared settings).
 * - **Viewer:** none of those. Reading, moving between pages, copying words,
 *   printing and opening a kept picture stay.
 *
 * On the Mac and outside Tellop the person is always the owner, so nothing
 * changes there. Pure: the server page asks `currentPerson()` and hands the
 * page `rightsOf(person)`, never the other way round.
 */

/** The roles the host names, as `lib/data/person.js` lists them. */
export const ROLE_NAMES = Object.freeze(['owner', 'helper', 'member', 'viewer']);

/** Whether `role` may add a new record. Any role the app does not know may not. @param {unknown} role */
export function canAdd(role) {
  return role === 'owner' || role === 'helper' || role === 'member';
}

/** Whether `role` may change or remove a record already kept, or a shared setting. @param {unknown} role */
export function canChange(role) {
  return role === 'owner' || role === 'helper';
}

/** Nothing that saves: a part drawn with no rights handed to it. */
export const NO_RIGHTS = Object.freeze({ add: false, change: false, preview: false, unknown: false });

/**
 * What a page may draw when the host's answer about the person could not be
 * read: still nothing that saves (never the owner's presses by default), and
 * `unknown`, so the page says that something is wrong instead of looking
 * like a Viewer's page (`app/shell.jsx`).
 */
export const UNKNOWN_RIGHTS = Object.freeze({ add: false, change: false, preview: false, unknown: true });

/**
 * What the person may press: `add`, `change`, and `preview` (the owner looks
 * at the app as a Member or a Viewer, so the page draws the way back);
 * `unknown` is false (the person was read).
 *
 * @param {{ role?: unknown, preview?: unknown } | null | undefined} person what `currentPerson()` answered
 * @returns {{ add: boolean, change: boolean, preview: boolean, unknown: boolean }}
 */
export function rightsOf(person) {
  const role = person?.role;
  return Object.freeze({ add: canAdd(role), change: canChange(role), preview: person?.preview === true, unknown: false });
}
