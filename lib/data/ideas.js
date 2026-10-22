/**
 * The records reads and saves the Ideas and Results pages need that the posts
 * file (`./posts.js`) does not have:
 *
 * - `keepIdeasFor`: the ideas a person picked from "Give me ideas", kept as
 *   idea posts (posts with no day) in one `modelBatch`;
 * - `chosenPicturesFor`: the chosen picture of a few posts (the five best
 *   posts on Results), in one call (two when one is a comment card).
 *
 * Every read, save and delete names its owner inside the statement's `where`
 * (AGENTS.md rule 1); nothing here saves while reading (rule 4a). What leaves
 * this file is a plain object. Every call stays inside Tellop's records
 * bounds: at most 256 rows and 256 KB a call.
 */

import { LIMITS, readWords } from '../plan/limits.js';

import { DataError, modelAction, modelBatch } from './index.js';
import { PICTURE_SELECT, pictureView, POST_REFUSALS } from './posts.js';

/** The most ideas one press keeps. */
export const IDEAS_MOST = 20;

/** The refusals this file adds (the limit readers add `refuse.text.*`; a theme not the owner's is `refuse.post.theme`). */
export const IDEA_REFUSALS = Object.freeze({
  none: 'ideas.refuse.none',
  tooMany: 'ideas.refuse.tooMany',
});

/** The most posts one chosen-pictures read asks about. */
export const PICTURE_POSTS_MOST = 20;

const REQUEST = 'refuse.request';
/** A card picture's comment holds up to `LIMITS.comment` characters: 24 a call stay under 256 KB. */
const CARD_PAGE = 24;

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** @param {unknown} value */
function isWholeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

const text = (value) => (typeof value === 'string' ? value : '');
const wholeOrNull = (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);

// --- ideas ---------------------------------------------------------------------

/**
 * The names a person picked, read: 1 to `IDEAS_MOST` names, each one line of
 * 1 to `LIMITS.name` characters.
 *
 * @param {unknown} names
 * @returns {string[]}
 */
export function readIdeaNames(names) {
  if (!Array.isArray(names)) throw new DataError(REQUEST);
  if (names.length === 0) throw new DataError(IDEA_REFUSALS.none);
  if (names.length > IDEAS_MOST) throw new DataError(IDEA_REFUSALS.tooMany);
  return names.map((name) => {
    const read = readWords(name, LIMITS.name, { required: true });
    if (!read.ok) throw new DataError(read.problem);
    return read.value;
  });
}

/**
 * Keeps the picked ideas as posts with no day, in the theme named (one of
 * this owner's themes) or in none. They were written by the AI, so they are
 * kept as made by it. One read checks the theme, then one `modelBatch`
 * creates them all or none. They are created last name first, so the newest-
 * first Ideas list shows them in the order they were picked.
 *
 * @param {unknown} ownerId
 * @param {unknown} names
 * @param {unknown} themeId a theme's id, or null for none
 * @returns {Promise<{ id: number, name: string, day: null, themeId: number | null, madeBy: string }[]>} in the order given
 */
export async function keepIdeasFor(ownerId, names, themeId) {
  const owner = ownerOf(ownerId);
  const picked = readIdeaNames(names);
  let theme = null;
  if (themeId !== null && themeId !== undefined) {
    if (!isWholeId(themeId)) throw new DataError(POST_REFUSALS.theme);
    // A theme in use only: an archived theme stays on its old posts, never on new ones.
    const found = await modelAction('Theme', 'findFirst', { where: { id: themeId, ownerId: owner, archived: false }, select: { id: true } });
    if (found === null || found === undefined) throw new DataError(POST_REFUSALS.theme);
    theme = /** @type {number} */ (themeId);
  }
  const at = new Date().toISOString();
  const select = { id: true, name: true, day: true, themeId: true, madeBy: true };
  const created = await modelBatch([...picked].reverse().map((name) => ({
    model: 'Post',
    action: 'create',
    args: { data: { ownerId: owner, name, themeId: theme, madeBy: 'ai', createdAt: at, updatedAt: at }, select },
  })));
  if (!Array.isArray(created) || created.length !== picked.length) throw new DataError('error.saveUnconfirmed');
  return created.map((row) => {
    if (row === null || typeof row !== 'object' || !isWholeId(row.id)) throw new DataError('error.saveUnconfirmed');
    return { id: row.id, name: text(row.name), day: null, themeId: wholeOrNull(row.themeId), madeBy: row.madeBy === 'ai' ? 'ai' : 'person' };
  }).reverse();
}

// --- chosen pictures ------------------------------------------------------------

/**
 * A picture row as the posts file's `PictureSummary` (`pictureView`, the one
 * reader): tags (a cache key for the picture's address), never digests. A
 * card shows its comment's words only while the comment's permission is yes
 * (`cards`); `cardRefused` when its comment is there with another permission
 * (`refused`).
 *
 * @param {any} row
 * @param {Map<number, { bestLine: string, text: string, name: string, stars: number | null }>} cards
 * @param {Set<number>} refused
 */
function pictureSummary(row, cards, refused) {
  return pictureView(row, { cards, refused });
}

/**
 * The chosen picture of each of these posts (this owner's only), by post id:
 * `{ [postId]: PictureSummary }`; a post with no chosen picture is left out.
 * At most `PICTURE_POSTS_MOST` posts; one call, and one more when a chosen
 * picture is a comment card (its comment is read for the card's words).
 *
 * @param {unknown} ownerId
 * @param {unknown[]} postIds
 * @returns {Promise<Record<number, object>>}
 */
export async function chosenPicturesFor(ownerId, postIds) {
  const owner = ownerOf(ownerId);
  const ids = [...new Set((Array.isArray(postIds) ? postIds : []).filter(isWholeId))];
  if (ids.length === 0) return {};
  if (ids.length > PICTURE_POSTS_MOST) throw new DataError(REQUEST);
  // A post has one chosen picture; the take leaves room for a stray second one.
  const rows = await modelAction('PostPicture', 'findMany', {
    where: { ownerId: owner, postId: { in: ids }, chosen: true },
    select: PICTURE_SELECT,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: ids.length * 2,
  });
  if (!Array.isArray(rows)) throw new DataError('error.storageUnreadable');
  const commentIds = [...new Set(rows.filter((row) => row?.source === 'card' && isWholeId(row.commentId)).map((row) => row.commentId))];
  const cards = new Map();
  const refused = new Set();
  if (commentIds.length > 0) {
    const ids = commentIds.slice(0, CARD_PAGE);
    // Only a comment whose permission is yes gives its words; the others answer their ids.
    const [shown, others] = await modelBatch([
      { model: 'CustomerComment', action: 'findMany', args: { where: { ownerId: owner, id: { in: ids }, permission: 'yes' }, select: { id: true, name: true, text: true, bestLine: true, stars: true }, take: CARD_PAGE } },
      { model: 'CustomerComment', action: 'findMany', args: { where: { ownerId: owner, id: { in: ids }, permission: { not: 'yes' } }, select: { id: true }, take: CARD_PAGE } },
    ]);
    for (const row of Array.isArray(shown) ? shown : []) {
      cards.set(row.id, { bestLine: text(row.bestLine), text: text(row.text), name: text(row.name), stars: wholeOrNull(row.stars) });
    }
    for (const row of Array.isArray(others) ? others : []) refused.add(row.id);
  }
  /** @type {Record<number, object>} */
  const chosen = {};
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || !isWholeId(row.id) || !isWholeId(row.postId)) continue;
    if (chosen[row.postId] === undefined) chosen[row.postId] = pictureSummary(row, cards, refused);
  }
  return chosen;
}
