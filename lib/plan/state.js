/**
 * Where a post stands, worked out from what it holds; the person never picks a
 * stage.
 *
 * - `idea`: no switched-on network has words yet;
 * - `draft`: some words, but a switched-on network still has none, or its
 *   words hold a must-fix check (over the network's limit, too many hashtags,
 *   a link that is not safe: `mustFixOf` in `checks.js`), or a network that
 *   needs a picture has no chosen picture, or the chosen picture cannot be
 *   shared (`pictureRefused`: a comment card whose customer has not said yes);
 * - `ready`: every switched-on network has words with no must-fix check, and a
 *   picture where needed;
 * - `partly`: shared or scheduled on some of its networks (`shared` and
 *   `scheduled` of `of`);
 * - `scheduled`: every switched-on network is shared or scheduled, and at
 *   least one is still scheduled;
 * - `shared`: shared on every switched-on network.
 *
 * A version is shared when its `sharedAt` is at or before `now`, and scheduled
 * when it is after `now` ("Mark scheduled" keeps the post's
 * planned moment as `sharedAt`; once that moment passes, the platform has
 * posted it and the version reads as shared with no further press). A
 * `sharedAt` that is not a moment reads as shared. Every caller passes `now`
 * (an ISO instant or milliseconds; the computer's clock when left out), so a
 * page works one moment out for all its posts.
 *
 * A network the post goes to is one of the person's networks (My plan) whose
 * version is not switched off for this post. With no networks chosen yet, the
 * post is an idea until it has main words, then a draft.
 *
 * A version says whether its words hold a must-fix check: `mustFix` for a
 * post with no chosen picture, `mustFixWithPicture` for one with (they differ
 * only on Telegram, whose caption limit is shorter). A tile reads both from
 * the records; the post maker works them out from the words it holds.
 *
 * `pictureRefused` comes only from the post maker, which reads the chosen
 * card's comment; a tile never reads comments, so it does not pass it.
 */

import { networkByKey } from './networks.js';

/**
 * Whether a version's words hold a must-fix check for a post with or without a
 * chosen picture.
 *
 * @param {{ mustFix?: boolean, mustFixWithPicture?: boolean } | undefined} version
 * @param {boolean} hasChosenPicture
 */
function mustFixIn(version, hasChosenPicture) {
  if (hasChosenPicture) return (version?.mustFixWithPicture ?? version?.mustFix) === true;
  return version?.mustFix === true;
}

/**
 * A moment as milliseconds: an ISO instant or a number; anything else is this
 * computer's clock now.
 *
 * @param {unknown} now
 */
export function momentOf(now) {
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (typeof now === 'string') {
    const parsed = Date.parse(now);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Whether a version's `sharedAt` is still ahead of `now` (scheduled, not yet
 * shared). Empty or not a moment: not ahead.
 *
 * @param {unknown} sharedAt
 * @param {unknown} [now]
 */
export function isAhead(sharedAt, now) {
  if (typeof sharedAt !== 'string' || sharedAt === '') return false;
  const at = Date.parse(sharedAt);
  return Number.isFinite(at) && at > momentOf(now);
}

/**
 * @param {{
 *   networks: string[],
 *   versions: Array<{ network: string, on?: boolean, text?: string, sharedAt?: string | null, mustFix?: boolean, mustFixWithPicture?: boolean }>,
 *   hasChosenPicture: boolean,
 *   pictureRefused?: boolean,
 *   mainText?: string,
 *   now?: string | number,
 * }} post
 * @returns {{ state: 'idea' | 'draft' | 'ready' | 'partly' | 'scheduled' | 'shared', shared: number, scheduled: number, of: number, networks: string[] }}
 */
export function postState({ networks, versions, hasChosenPicture, pictureRefused = false, mainText = '', now }) {
  const moment = momentOf(now);
  const byNetwork = new Map(versions.map((version) => [version.network, version]));
  const on = networks.filter((key) => networkByKey(key) !== null && byNetwork.get(key)?.on !== false);
  if (on.length === 0) {
    return { state: mainText.trim() === '' ? 'idea' : 'draft', shared: 0, scheduled: 0, of: 0, networks: on };
  }
  const marked = on.filter((key) => Boolean(byNetwork.get(key)?.sharedAt));
  const scheduled = marked.filter((key) => isAhead(byNetwork.get(key)?.sharedAt, moment)).length;
  const shared = marked.length - scheduled;
  const counts = { shared, scheduled, of: on.length, networks: on };
  if (marked.length === on.length) return { state: scheduled > 0 ? 'scheduled' : 'shared', ...counts };
  if (marked.length > 0) return { state: 'partly', ...counts };
  const written = on.filter((key) => (byNetwork.get(key)?.text ?? '').trim() !== '');
  if (written.length === 0) return { state: 'idea', ...counts };
  const finished = written.filter((key) => !mustFixIn(byNetwork.get(key), hasChosenPicture)).length;
  const pictureMissing = !hasChosenPicture && on.some((key) => networkByKey(key)?.needs === 'picture');
  const pictureHeld = hasChosenPicture && pictureRefused === true;
  if (finished === on.length && !pictureMissing && !pictureHeld) return { state: 'ready', ...counts };
  return { state: 'draft', ...counts };
}

/**
 * The words a post's state reads as (the post maker's state pill, the
 * calendar's tiles, the week page), as a words key, its values and the mark
 * drawn beside it: `state.<state>` ("Ready", "2 of 3 shared"), except a post
 * partly shared with one still scheduled: "1 of 3 shared, 1 scheduled"
 * (`state.partlyScheduled`), or "1 of 3 scheduled" when none is shared yet
 * (`state.someScheduled`, drawn with the scheduled mark). Every key gets all
 * three values; a state with no counts reads zeros, never "undefined".
 *
 * @param {{ state?: string, shared?: number, scheduled?: number, of?: number } | null | undefined} state what `postState` answered, or a tile
 * @returns {{ key: string, values: { shared: string, scheduled: string, of: string }, mark: string }}
 */
export function stateWordsOf(state) {
  const count = (value) => (Number.isInteger(value) ? value : 0);
  const shared = count(state?.shared);
  const scheduled = count(state?.scheduled);
  const values = { shared: String(shared), scheduled: String(scheduled), of: String(count(state?.of)) };
  if (state?.state !== 'partly' || scheduled === 0) return { key: `state.${state?.state}`, values, mark: String(state?.state) };
  if (shared === 0) return { key: 'state.someScheduled', values, mark: 'scheduled' };
  return { key: 'state.partlyScheduled', values, mark: 'partly' };
}
