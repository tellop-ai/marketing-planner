/**
 * Posts: a post, its words for each network (its versions) and its pictures.
 *
 * Every read, save and delete names its owner inside the statement's `where`;
 * updates and deletes carry the owner in their condition (`updateMany`,
 * `deleteMany`) and read back what they changed. All of it goes through
 * `modelAction` and `modelBatch` from `./index.js`, never the generated client.
 * A read never creates a row. Values are copied into plain objects before they
 * leave this file, because the records route used inside Tellop answers
 * objects with no prototype.
 *
 * Every value a caller hands in is read here, through `lib/plan/limits.js` and
 * the day, network and shape checks, so an address, the month planner and the
 * AI steps all keep the same limits. A refusal is a `DataError` whose
 * `messageKey` the page shows in the person's language.
 *
 * ## How much one read takes
 *
 * Inside Tellop a records call keeps the bounds `./read-in-pages.js` names
 * (256 rows a statement, 2,048 values a step's answer, 256 items a list sent,
 * 32 steps, 256 KiB of answers a call, 16 calls a request). So a list of
 * posts is read on a cursor (`readInPages`), ids go into `in` lists of at
 * most 256, and the reads that depend only on what is already known go
 * through `readPacked`, which plans each call by the largest answer its
 * steps can give: `WORST` below, from the letter limits at two bytes a
 * letter (`lib/plan/limits.js` refuses or cuts anything larger). No read
 * here selects a post's main words or a version's words for a list: a tile
 * needs only whether there are words.
 */

import { askOf, isAsk } from '../plan/asks.js';
import { mustFixOf } from '../plan/checks.js';
import { addDays, daysInMonth, isCivilDay, isCivilMonth, isClockTime, partsOf } from '../plan/days.js';
import { BYTES_A_LETTER, cutText, LIMITS, readCount, readLink, readWords, RESULT_COUNTS, wireBytes } from '../plan/limits.js';
import { isNetworkKey, NETWORK_KEYS, SET_LIMITS } from '../plan/networks.js';
import { FITS, fitFor, isShapeKey, SHAPE_KEYS, SHAPES } from '../plan/shapes.js';
import { isSpecialDayKey, ownDayId } from '../plan/special-days.js';
import { isAhead, momentOf, postState } from '../plan/state.js';
import { readVideoPlan, VIDEO_PLAN } from '../plan/video-plan.js';

import { DataError, modelAction, modelBatch } from './index.js';
import { MOST_THEMES } from './plan.js';
import { CALL_BUDGET, inGroups, readInPages, readPacked, RECORDS } from './read-in-pages.js';

/** The refusal keys this file adds (the limit readers add `refuse.text.*`, `refuse.link`, `refuse.number`). */
export const POST_REFUSALS = Object.freeze({
  day: 'refuse.post.day',
  time: 'refuse.post.time',
  theme: 'refuse.post.theme',
  campaign: 'refuse.post.campaign',
  specialDay: 'refuse.post.specialDay',
  hashtags: 'refuse.post.hashtags',
  pictureSource: 'refuse.picture.source',
  pictureFile: 'refuse.picture.file',
  pictureSize: 'refuse.picture.size',
  pictureFocus: 'refuse.picture.focus',
  pictureFit: 'refuse.picture.fit',
  pictureShape: 'refuse.picture.shape',
  tooManyPictures: 'refuse.picture.tooMany',
  noPermission: 'refuse.picture.noPermission',
  monthFull: 'refuse.post.monthFull',
  noDay: 'refuse.post.noDay',
  slidesFull: 'refuse.picture.slidesFull',
  storyFull: 'refuse.picture.storyFull',
});

/** A words picture's layouts; a stored layout the app does not know reads as `words`. */
export const LAYOUTS = Object.freeze(['words', 'tip', 'offer', 'quote', 'event']);
/** The line under a words picture's words (a price, a date or a name), at most this many letters. */
export const SUBLINE_MOST = 80;
/** The two sets of a post's pictures: its swipe set (`slide`) and its story set (`story`); the most each holds is `SET_LIMITS`. */
export const SET_KINDS = Object.freeze(['slide', 'story']);
/** When "Mark scheduled" finds a post with no time, it schedules the post at this time (and says so). */
export const SCHEDULE_TIME = '12:00';

/** A request whose shape no page sends (a wrong type, an unknown choice). */
const REQUEST = 'refuse.request';
const NOT_FOUND = 'error.notFound';
/** A kept file's digest: the only text a record keeps for a file (`lib/data/files.js`). */
const DIGEST = /^[0-9a-f]{64}$/u;
/** Where a picture comes from: the person's photo, drawn by the AI, changed by the AI, the person's words, a customer's comment. */
export const PICTURE_SOURCES = Object.freeze(['photo', 'drawn', 'changed', 'words', 'card']);
const FILE_SOURCES = new Set(['photo', 'drawn', 'changed']);
/** The largest side, in pixels, a picture's stored size may name. */
const MAX_SIDE = 10000;
/** One line of words with a network's results (`LIMITS.resultNote`, the one source). */
export const RESULT_NOTE_MOST = LIMITS.resultNote;
/** What an AI picture was asked with is the app's own text; a longer one (in letters or bytes) is cut, never refused (the picture is already made). */
const PROMPT_MOST = LIMITS.mainText;
/** The counts a version's results hold (`lib/plan/limits.js`, the one source). */
export { RESULT_COUNTS };

/** The most posts one list of tiles holds. */
const MOST_TILES = 256;
/**
 * The most posts one month holds: a month's tiles are read whole (`MOST_TILES`),
 * so a new post, a day change or Keep these that would put more in one month
 * is refused (`refuse.post.monthFull`).
 */
export const MOST_A_MONTH = MOST_TILES;
/** Shared versions `listSharedFor` reads, `SHARED_PAGE` a call. */
const MOST_SHARED = 400;
const SHARED_PAGE = 100;
/** Posts whose chosen pictures one step reads, and comments one step reads for card pictures. */
const PICTURE_GROUP = 32;
const CARD_GROUP = 16;
/** Pictures `getPostFor` reads (twice the limit, so a post that went past it still shows them). */
const POST_PICTURES = LIMITS.picturesPerPost * 2;

/**
 * The largest answer each field can give, in bytes as a records answer writes
 * it (quotes included): words at `BYTES_A_LETTER` a letter of their limit
 * (`lib/plan/limits.js` refuses or cuts anything larger), whole numbers at
 * eleven characters, floats at 24, instants at 32, digests at 66.
 */
const textBytes = (letters) => BYTES_A_LETTER * letters + 2;
const INT = 11;
const FLOAT = 24;
const INSTANT = 32;
const DIGEST_TEXT = 66;
const SHAPE_WORST = Object.fromEntries(SHAPE_KEYS.map((key) => [SHAPES[key].field, DIGEST_TEXT]));
const WORST = Object.freeze({
  Post: { id: INT, name: textBytes(LIMITS.name), mainText: textBytes(LIMITS.mainText), day: 12, time: 7, themeId: INT, campaignId: INT,
    specialDay: 82, madeBy: 8, createdAt: INSTANT, updatedAt: INSTANT, ask: 9, videoPlan: BYTES_A_LETTER * VIDEO_PLAN.bytes + 2, fromPostId: INT },
  PostVersion: { id: INT, postId: INT, network: 11, on: 5, text: textBytes(LIMITS.versionText),
    hashtags: LIMITS.hashtags * BYTES_A_LETTER * LIMITS.hashtagLength + LIMITS.hashtags + 1, link: textBytes(LIMITS.link),
    firstComment: textBytes(LIMITS.firstComment), changedByPerson: 5, mustFix: 5, mustFixWithPicture: 5, sharedAt: INSTANT, sharedLink: textBytes(LIMITS.link),
    ...Object.fromEntries(RESULT_COUNTS.map((name) => [name, INT])),
    resultNote: textBytes(RESULT_NOTE_MOST), resultAt: INSTANT },
  PostPicture: { id: INT, postId: INT, source: 9, file: DIGEST_TEXT, chosen: 5, description: textBytes(LIMITS.description),
    words: textBytes(LIMITS.pictureWords), commentId: INT, position: INT, width: INT, height: INT, focusX: FLOAT, focusY: FLOAT,
    fit: 6, createdAt: INSTANT, prompt: textBytes(LIMITS.mainText), slide: INT, story: INT, layout: 7, subline: textBytes(SUBLINE_MOST), ...SHAPE_WORST,
    change: textBytes(LIMITS.change) },
  CustomerComment: { id: INT, name: textBytes(LIMITS.name), text: textBytes(LIMITS.comment), bestLine: textBytes(LIMITS.bestLine), stars: INT },
});

/** The largest row of `model` with `select`, in bytes, with the comma after it. @param {string} model @param {Record<string, boolean>} select */
function rowBytes(model, select) {
  const worst = WORST[model];
  let size = 3;
  for (const [name, picked] of Object.entries(select)) {
    if (picked !== true) continue;
    if (worst[name] === undefined) throw new Error(`posts: no largest size for ${model}.${name}`);
    size += name.length + 4 + worst[name];
  }
  return size;
}

/** A read step with its largest answer: `take` rows for a list, one row (or null) otherwise. */
function readStep(model, action, args) {
  const row = rowBytes(model, args.select);
  return { model, action, args, bytes: action === 'findMany' ? 2 + args.take * row : row };
}

// --- small readers -----------------------------------------------------------

/** @param {unknown} value */
function requireOwner(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** @param {unknown} value */
function isWholeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** A record's id named by a caller; anything else names no record. @param {unknown} value */
function requireId(value) {
  if (!isWholeId(value)) throw new DataError(NOT_FOUND);
  return /** @type {number} */ (value);
}

/**
 * A record id from an address's path (`/api/posts/12`), or null when the
 * text is not a whole number from 1 up.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function idFromPath(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,14}$/u.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** @param {{ ok: boolean, value?: any, problem?: string }} read */
function take(read) {
  if (!read.ok) throw new DataError(/** @type {string} */ (read.problem));
  return read.value;
}

/** @param {unknown} value */
function isDigest(value) {
  return typeof value === 'string' && DIGEST.test(value);
}

/** The first 12 characters of a kept file's digest: a cache key for its address, never the digest. @param {unknown} digest */
function tagOf(digest) {
  return isDigest(digest) ? /** @type {string} */ (digest).slice(0, 12) : null;
}

const text = (value) => (typeof value === 'string' ? value : '');
const textOrNull = (value) => (typeof value === 'string' ? value : null);
const wholeOrNull = (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);
const whole = (value) => wholeOrNull(value) ?? 0;
const unit = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0.5);

/** The ISO instant of the start of a civil day on this computer's clock. @param {string} day */
function startOfDay(day) {
  const { year, month, day: date } = partsOf(day);
  return new Date(year, month - 1, date).toISOString();
}

/** @param {unknown} networks */
function cleanNetworks(networks) {
  if (!Array.isArray(networks)) return [];
  return [...new Set(networks.filter((key) => isNetworkKey(key)))];
}

/** @param {unknown} value */
function readDay(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  return isCivilDay(value) ? { ok: true, value } : { ok: false, problem: POST_REFUSALS.day };
}

/** @param {unknown} value */
function readTime(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  return isClockTime(value) ? { ok: true, value } : { ok: false, problem: POST_REFUSALS.time };
}

/** @param {unknown} value @param {string} problem */
function readLinkedId(value, problem) {
  if (value === null) return { ok: true, value: null };
  return isWholeId(value) ? { ok: true, value } : { ok: false, problem };
}

/**
 * A special day's key: a built-in day's or a person's own day's (`own-<id>`,
 * which the caller checks is this owner's: `checkLinks`).
 *
 * @param {unknown} value
 */
function readSpecialDay(value) {
  if (value === null || value === '') return { ok: true, value: null };
  return isSpecialDayKey(value) ? { ok: true, value } : { ok: false, problem: POST_REFUSALS.specialDay };
}

/** The first and the last day of the month `day` falls in. @param {string} day */
function monthOfDay(day) {
  const { year, month } = partsOf(day);
  const prefix = day.slice(0, 7);
  return { first: `${prefix}-01`, last: `${prefix}-${String(daysInMonth(year, month)).padStart(2, '0')}` };
}

/**
 * Hashtags as one line of `#tag` words: a string or a list of strings, at most
 * `LIMITS.hashtags` tags of at most `LIMITS.hashtagLength` characters (and
 * `BYTES_A_LETTER` bytes a character) each.
 * Kept as given (the fitting rules shape them); only the bounds are checked.
 *
 * @param {unknown} value
 */
function readHashtags(value) {
  if (value === undefined || value === null) return { ok: true, value: '' };
  let line;
  if (Array.isArray(value)) {
    if (value.length > LIMITS.hashtags || value.some((item) => typeof item !== 'string')) {
      return { ok: false, problem: value.length > LIMITS.hashtags ? POST_REFUSALS.hashtags : REQUEST };
    }
    line = value.join(' ');
  } else if (typeof value === 'string') {
    line = value;
  } else {
    return { ok: false, problem: REQUEST };
  }
  const tags = line.replace(/[\u0000-\u001F\u007F]/gu, ' ').split(/\s+/u).filter((tag) => tag.length > 0);
  const tooLong = (tag) => Array.from(tag).length > LIMITS.hashtagLength || wireBytes(tag) > BYTES_A_LETTER * LIMITS.hashtagLength;
  if (tags.length > LIMITS.hashtags || tags.some(tooLong)) {
    return { ok: false, problem: POST_REFUSALS.hashtags };
  }
  return { ok: true, value: tags.join(' ') };
}

/** @param {unknown} value */
function readSide(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE
    ? { ok: true, value }
    : { ok: false, problem: POST_REFUSALS.pictureSize };
}

/** A words picture's layout: one of `LAYOUTS`. @param {unknown} value */
function readLayout(value) {
  return typeof value === 'string' && LAYOUTS.includes(value) ? { ok: true, value } : { ok: false, problem: REQUEST };
}

/** The line under a words picture's words: one line of at most `SUBLINE_MOST` letters, or empty. @param {unknown} value */
function readSubline(value) {
  return readWords(value, SUBLINE_MOST);
}

/** @param {unknown} value */
function readFocus(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? { ok: true, value }
    : { ok: false, problem: POST_REFUSALS.pictureFocus };
}

/**
 * A post's ask: one of `ASKS` (`lib/plan/asks.js`), or `''` (or null) for none.
 *
 * @param {unknown} value
 */
function readAsk(value) {
  if (value === null || value === '') return { ok: true, value: '' };
  return isAsk(value) ? { ok: true, value } : { ok: false, problem: REQUEST };
}

/**
 * The post fields a caller sent, read and cleaned: only the fields present
 * (`undefined` means "not sent"). `null` (or empty text) clears `day`, `time`,
 * `themeId`, `campaignId` and `specialDay`; `''` (or null) clears `ask` and
 * `videoPlan` (an object read by `readVideoPlan`, kept as its JSON text).
 *
 * @param {Record<string, unknown>} input
 * @param {{ create?: boolean }} [options]
 */
function readPostFields(input, { create = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DataError(REQUEST);
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (input.name !== undefined || create) fields.name = take(readWords(input.name, LIMITS.name));
  if (input.mainText !== undefined) fields.mainText = take(readWords(input.mainText, LIMITS.mainText, { multiline: true }));
  if (input.day !== undefined) fields.day = take(readDay(input.day));
  if (input.time !== undefined) fields.time = take(readTime(input.time));
  if (input.themeId !== undefined) fields.themeId = take(readLinkedId(input.themeId, POST_REFUSALS.theme));
  if (input.campaignId !== undefined) fields.campaignId = take(readLinkedId(input.campaignId, POST_REFUSALS.campaign));
  if (input.specialDay !== undefined) fields.specialDay = take(readSpecialDay(input.specialDay));
  if (input.ask !== undefined) fields.ask = take(readAsk(input.ask));
  if (input.videoPlan !== undefined) fields.videoPlan = take(readVideoPlan(input.videoPlan));
  if (create) {
    const madeBy = input.madeBy ?? 'person';
    if (madeBy !== 'person' && madeBy !== 'ai') throw new DataError(REQUEST);
    fields.madeBy = madeBy;
  }
  return fields;
}

/**
 * A version's words fields a caller sent: `text`, `hashtags`, `link`,
 * `firstComment` and `on`, only those present.
 *
 * @param {Record<string, unknown>} input
 */
function readVersionFields(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DataError(REQUEST);
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (input.text !== undefined) fields.text = take(readWords(input.text, LIMITS.versionText, { multiline: true }));
  if (input.hashtags !== undefined) fields.hashtags = take(readHashtags(input.hashtags));
  if (input.link !== undefined) fields.link = take(readLink(input.link));
  if (input.firstComment !== undefined) fields.firstComment = take(readWords(input.firstComment, LIMITS.firstComment, { multiline: true }));
  if (input.on !== undefined) {
    if (typeof input.on !== 'boolean') throw new DataError(REQUEST);
    fields.on = input.on;
  }
  return fields;
}

const WORDS_FIELDS = Object.freeze(['text', 'hashtags', 'link', 'firstComment']);
/** The words a version's must-fix checks read (`mustFixOf`). */
const CHECKED_FIELDS = Object.freeze(['text', 'hashtags', 'link']);

/** Whether a save changes words a must-fix check reads but leaves one of them as held. @param {Record<string, unknown>} fields */
function needsHeldWords(fields) {
  return CHECKED_FIELDS.some((name) => fields[name] !== undefined) && CHECKED_FIELDS.some((name) => fields[name] === undefined);
}

/** A read of the words a version holds now, for its must-fix checks. @param {string} owner @param {number} postId @param {string} network */
function heldWordsStep(owner, postId, network) {
  return readStep('PostVersion', 'findFirst', { where: { ownerId: owner, postId, network }, select: { text: true, hashtags: true, link: true } });
}

/**
 * The must-fix flags a version keeps after a save of `fields`, worked out from
 * its words as they will be (those sent, else those `held`, else none); no
 * flags when the save sends no words a check reads.
 *
 * @param {string} network
 * @param {Record<string, unknown>} fields
 * @param {Record<string, unknown> | null | undefined} held
 * @returns {{ mustFix?: boolean, mustFixWithPicture?: boolean }}
 */
function flagsFor(network, fields, held) {
  if (!CHECKED_FIELDS.some((name) => fields[name] !== undefined)) return {};
  const words = Object.fromEntries(CHECKED_FIELDS.map((name) => [name, fields[name] !== undefined ? fields[name] : text(held?.[name])]));
  return mustFixOf({ network, ...words });
}

// --- plain views ---------------------------------------------------------------

const POST_FIELDS = Object.freeze(['id', 'name', 'mainText', 'day', 'time', 'themeId', 'campaignId', 'specialDay', 'madeBy', 'createdAt', 'updatedAt',
  'ask', 'videoPlan', 'fromPostId']);
const POST_SELECT = Object.freeze(Object.fromEntries(POST_FIELDS.map((name) => [name, true])));
/** What a tile shows of a post: no words, no instants, none of the fields the post maker alone shows. */
const TILE_POST_SELECT = Object.freeze(Object.fromEntries(POST_FIELDS
  .filter((name) => !['mainText', 'createdAt', 'updatedAt', 'ask', 'videoPlan', 'fromPostId'].includes(name)).map((name) => [name, true])));

/** @param {any} row */
function postView(row) {
  if (row === null || typeof row !== 'object' || !isWholeId(row.id)) throw new DataError('error.storageUnreadable');
  return {
    id: row.id,
    name: text(row.name),
    mainText: text(row.mainText),
    day: textOrNull(row.day),
    time: textOrNull(row.time),
    themeId: wholeOrNull(row.themeId),
    campaignId: wholeOrNull(row.campaignId),
    specialDay: textOrNull(row.specialDay),
    madeBy: row.madeBy === 'ai' ? 'ai' : 'person',
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    // Fields added later are null on posts kept before them: null reads as the default.
    ask: askOf(row.ask),
    videoPlan: text(row.videoPlan),
    fromPostId: isWholeId(row.fromPostId) ? row.fromPostId : null,
  };
}

const VERSION_FIELDS = Object.freeze(['network', 'on', 'text', 'hashtags', 'link', 'firstComment', 'changedByPerson', 'mustFix', 'mustFixWithPicture',
  'sharedAt', 'sharedLink', ...RESULT_COUNTS, 'resultNote', 'resultAt']);
const VERSION_SELECT = Object.freeze(Object.fromEntries(VERSION_FIELDS.map((name) => [name, true])));

/** @param {any} row */
function versionView(row) {
  if (row === null || typeof row !== 'object' || !isNetworkKey(row.network)) throw new DataError('error.storageUnreadable');
  return {
    network: row.network,
    on: row.on !== false,
    text: text(row.text),
    hashtags: text(row.hashtags),
    link: text(row.link),
    firstComment: text(row.firstComment),
    changedByPerson: row.changedByPerson === true,
    mustFix: row.mustFix === true,
    mustFixWithPicture: row.mustFixWithPicture === true,
    sharedAt: textOrNull(row.sharedAt),
    sharedLink: textOrNull(row.sharedLink),
    ...Object.fromEntries(RESULT_COUNTS.map((name) => [name, wholeOrNull(row[name])])),
    resultNote: text(row.resultNote),
    resultAt: textOrNull(row.resultAt),
  };
}

/** Versions in the networks' own order. @param {any[]} rows */
function versionsInOrder(rows) {
  return rows
    .filter((row) => isNetworkKey(row?.network))
    .map(versionView)
    .sort((a, b) => NETWORK_KEYS.indexOf(a.network) - NETWORK_KEYS.indexOf(b.network));
}

const SHAPE_FIELDS = Object.freeze(SHAPE_KEYS.map((key) => SHAPES[key].field));
/** What a picture summary reads (`pictureView`); `./ideas.js` reads its chosen pictures with it too. */
export const PICTURE_SELECT = Object.freeze(Object.fromEntries(['id', 'postId', 'source', 'file', 'chosen', 'description', 'words', 'commentId',
  'position', 'width', 'height', 'focusX', 'focusY', 'fit', 'createdAt', 'slide', 'story', 'layout', 'subline', ...SHAPE_FIELDS].map((name) => [name, true])));
const CARD_SELECT = Object.freeze({ id: true, name: true, text: true, bestLine: true, stars: true });
/** A card's comment is shown only while its permission is yes. */
const SHOWN = 'yes';

/**
 * The comments card pictures are drawn from: `cards`, the words of those whose
 * permission is yes, by id; `refused`, the ids of those whose permission is
 * not yes (a card drawn from them must not be shared).
 *
 * @typedef {{ cards: Map<number, ReturnType<typeof cardView>>, refused: Set<number> }} CardComments
 */
/** @type {CardComments} */
const NO_CARDS = Object.freeze({ cards: new Map(), refused: new Set() });

/** @param {any} row */
function cardView(row) {
  return { bestLine: text(row.bestLine), text: text(row.text), name: text(row.name), stars: wholeOrNull(row.stars) };
}

/**
 * A picture summary. A card picture carries its comment's words (`card`) only
 * while the comment's permission is yes; `cardRefused` is true when its
 * comment is there and its permission is not yes (`card` is then null).
 * `slide` and `story` are its place in the post's swipe set and story set
 * (null: not in it; a set is ordered by these numbers, gaps allowed);
 * `layout` and `subline` shape a words picture (`words` and `''` on a picture
 * kept before they existed).
 *
 * @param {any} row
 * @param {CardComments} [comments]
 */
export function pictureView(row, comments = NO_CARDS) {
  if (row === null || typeof row !== 'object' || !isWholeId(row.id)) throw new DataError('error.storageUnreadable');
  const source = PICTURE_SOURCES.includes(row.source) ? row.source : 'photo';
  const commentId = wholeOrNull(row.commentId);
  return {
    id: row.id,
    postId: whole(row.postId),
    source,
    chosen: row.chosen === true,
    description: text(row.description),
    words: text(row.words),
    commentId,
    position: whole(row.position),
    width: whole(row.width),
    height: whole(row.height),
    focusX: unit(row.focusX),
    focusY: unit(row.focusY),
    fit: FITS.includes(row.fit) ? row.fit : 'auto',
    original: tagOf(row.file),
    shapes: Object.fromEntries(SHAPE_KEYS.map((key) => [key, tagOf(row[SHAPES[key].field])])),
    canChange: source === 'drawn' || source === 'changed',
    card: source === 'card' && commentId !== null ? comments.cards.get(commentId) ?? null : null,
    cardRefused: source === 'card' && commentId !== null && comments.refused.has(commentId),
    createdAt: text(row.createdAt),
    slide: isWholeId(row.slide) ? row.slide : null,
    story: isWholeId(row.story) ? row.story : null,
    layout: LAYOUTS.includes(row.layout) ? row.layout : 'words',
    subline: text(row.subline),
  };
}

// --- reads ---------------------------------------------------------------------------

/** A list answer, or a refusal when the store answered something else. @param {unknown} value */
function listOf(value) {
  if (!Array.isArray(value)) throw new DataError('error.storageUnreadable');
  return value;
}

/**
 * The steps that read the comments the card pictures among `rows` are drawn
 * from, `CARD_GROUP` a step, in pairs: the words of those whose permission is
 * yes (no other card read reads words), then the ids of the others.
 *
 * @param {string} owner
 * @param {any[]} rows
 */
function cardSteps(owner, rows) {
  const ids = [...new Set(rows.filter((row) => row?.source === 'card' && isWholeId(row.commentId)).map((row) => row.commentId))];
  return inGroups(ids, CARD_GROUP).flatMap((group) => [
    readStep('CustomerComment', 'findMany', {
      where: { ownerId: owner, id: { in: group }, permission: SHOWN },
      select: CARD_SELECT,
      orderBy: { id: 'asc' },
      take: group.length,
    }),
    readStep('CustomerComment', 'findMany', {
      where: { ownerId: owner, id: { in: group }, permission: { not: SHOWN } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: group.length,
    }),
  ]);
}

/** The comments read by `cardSteps` (their answers, in pairs). @param {any[][]} answers @returns {CardComments} */
function cardsOf(answers) {
  const comments = { cards: new Map(), refused: new Set() };
  answers.forEach((answer, index) => {
    for (const row of listOf(answer)) {
      if (index % 2 === 0) comments.cards.set(row.id, cardView(row));
      else comments.refused.add(row.id);
    }
  });
  return comments;
}

/** The comments the card pictures among `rows` are drawn from: one call for up to about 50. @param {string} owner @param {any[]} rows */
async function readCards(owner, rows) {
  const steps = cardSteps(owner, rows);
  return steps.length === 0 ? NO_CARDS : cardsOf(await readPacked(steps));
}

/** @param {string} owner @param {number} postId */
async function postExists(owner, postId) {
  const found = await modelAction('Post', 'findFirst', { where: { id: postId, ownerId: owner }, select: { id: true } });
  return found !== null && found !== undefined;
}

/** @param {string} owner @param {number} id */
async function readPost(owner, id) {
  const found = await modelAction('Post', 'findFirst', { where: { id, ownerId: owner }, select: POST_SELECT });
  return found === null || found === undefined ? null : postView(found);
}

/**
 * Refuses, in one call (none when nothing below is named):
 *
 * - a theme that is not one of this owner's, or one that is archived, unless
 *   the post already names it (`heldOf`: an existing link stays);
 * - a campaign that is not one of this owner's;
 * - a person's own day (`own-<id>`) that is not one of this owner's;
 * - a day in a month that already holds `MOST_A_MONTH` posts (`postId`, the
 *   post being moved, not counted; `adding` more posts going in at once).
 *
 * With `heldOf` (a post's id), also reads that post's theme, day and time as
 * they are now and answers them: `{ themeId, day, time }`, or null when the
 * post is not this owner's.
 *
 * @param {string} owner
 * @param {Record<string, unknown>} fields
 * @param {{ heldOf?: number | null, postId?: number | null, adding?: number }} [options]
 * @returns {Promise<{ themeId: unknown, day: unknown, time: unknown } | null | undefined>}
 */
async function checkLinks(owner, fields, { heldOf = null, postId = null, adding = 1 } = {}) {
  const steps = [];
  const theme = isWholeId(fields.themeId) ? steps.push({ model: 'Theme', action: 'findFirst', args: { where: { id: fields.themeId, ownerId: owner }, select: { id: true, archived: true } }, problem: POST_REFUSALS.theme }) - 1 : -1;
  if (isWholeId(fields.campaignId)) steps.push({ model: 'Campaign', action: 'findFirst', args: { where: { id: fields.campaignId, ownerId: owner }, select: { id: true } }, problem: POST_REFUSALS.campaign });
  const ownDay = ownDayId(fields.specialDay);
  if (ownDay !== null) steps.push({ model: 'SpecialDay', action: 'findFirst', args: { where: { id: ownDay, ownerId: owner }, select: { id: true } }, problem: POST_REFUSALS.specialDay });
  let month = -1;
  if (typeof fields.day === 'string' && isCivilDay(fields.day)) {
    const { first, last } = monthOfDay(fields.day);
    month = steps.push({ model: 'Post', action: 'count', args: { where: { ownerId: owner, day: { gte: first, lte: last }, ...(postId === null ? {} : { id: { not: postId } }) } }, problem: null }) - 1;
  }
  if (heldOf !== null) steps.push({ model: 'Post', action: 'findFirst', args: { where: { id: heldOf, ownerId: owner }, select: { themeId: true, day: true, time: true } }, problem: null });
  if (steps.length === 0) return undefined;
  const found = await modelBatch(steps.map(({ model, action, args }) => ({ model, action, args })));
  steps.forEach((step, index) => {
    if (step.problem !== null && (found[index] === null || found[index] === undefined)) throw new DataError(step.problem);
  });
  const held = heldOf === null ? undefined : found.at(-1) ?? null;
  if (theme !== -1 && found[theme].archived === true && (held === undefined || held === null || wholeOrNull(held.themeId) !== fields.themeId)) {
    throw new DataError(POST_REFUSALS.theme);
  }
  if (month !== -1 && Number(found[month] ?? 0) + adding > MOST_A_MONTH) throw new DataError(POST_REFUSALS.monthFull);
  return held;
}

/**
 * The moment a version scheduled for a post is shared: the post's day at its
 * time on this computer's clock, at `SCHEDULE_TIME` when it has no time. Null
 * when the post has no day.
 *
 * @param {unknown} day
 * @param {unknown} time
 */
function scheduledMoment(day, time) {
  if (typeof day !== 'string' || !isCivilDay(day)) return null;
  const [hours, minutes] = (isClockTime(time) ? /** @type {string} */ (time) : SCHEDULE_TIME).split(':').map(Number);
  const { year, month, day: date } = partsOf(day);
  return new Date(year, month - 1, date, hours, minutes).toISOString();
}

/**
 * The step that makes a post's scheduled versions follow its new day and
 * time: every version of the post whose moment is still ahead of `now` moves
 * to `moment`, or is no longer scheduled (its moment cleared) when the post
 * has no day or the new moment is not ahead of `now`. A version already
 * shared (its moment not ahead) never changes.
 *
 * @param {string} owner
 * @param {number} postId
 * @param {string | null} moment
 * @param {string} now an ISO instant
 */
function followStep(owner, postId, moment, now) {
  const sharedAt = moment !== null && isAhead(moment, now) ? moment : null;
  return { model: 'PostVersion', action: 'updateMany', args: { where: { ownerId: owner, postId, sharedAt: { gt: now } }, data: { sharedAt, updatedAt: now } } };
}

/**
 * The steps that clear the kept shape copies a theme change makes stale, for
 * every picture of one post: every copy of a words picture (drawn on the
 * theme's colour), and each copy a photo or AI picture fits whole on the
 * theme's colour (`fitFor(fit, shape)` is `fit`). A comment card's copies and
 * a `fill` cut's carry no theme colour and stay. The page then draws the
 * missing copies again.
 *
 * @param {string} owner
 * @param {number} postId
 */
function themeCopySteps(owner, postId) {
  const cleared = (fields) => Object.fromEntries(fields.map((field) => [field, null]));
  const steps = [{ model: 'PostPicture', action: 'updateMany', args: { where: { ownerId: owner, postId, source: 'words' }, data: cleared(SHAPE_FIELDS) } }];
  for (const fit of FITS) {
    const fields = SHAPE_KEYS.filter((key) => fitFor(fit, key) === 'fit').map((key) => SHAPES[key].field);
    if (fields.length === 0) continue;
    // A stored fit the app does not know reads as `auto` (`pictureView`).
    const fitWhere = fit === 'auto' ? { notIn: FITS.filter((other) => other !== 'auto') } : fit;
    steps.push({
      model: 'PostPicture',
      action: 'updateMany',
      args: { where: { ownerId: owner, postId, source: { notIn: ['words', 'card'] }, fit: fitWhere }, data: cleared(fields) },
    });
  }
  return steps;
}

// --- tiles ---------------------------------------------------------------------------

/** By day (posts with no day last), then time (no time first), then id. */
function byDayThenTime(a, b) {
  if (a.day !== b.day) {
    if (a.day === null) return 1;
    if (b.day === null) return -1;
    return a.day < b.day ? -1 : 1;
  }
  if (a.time !== b.time) {
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return a.time < b.time ? -1 : 1;
  }
  return a.id - b.id;
}

const PICTURE_ORDER = /** @type {Array<[string, 'asc' | 'desc']>} */ ([['postId', 'asc'], ['position', 'asc'], ['id', 'asc']]);

/**
 * Tiles for posts already read (`rows`, selected with `TILE_POST_SELECT`).
 * The steps depend only on the posts' ids, so they go through `readPacked`:
 * the chosen pictures, `PICTURE_GROUP` posts a step (one row to spare: a full
 * step reads on once), first, as the largest steps; which posts have main
 * words; for each post, how many of its switched-on versions on the person's
 * networks are marked shared and how many of those are still scheduled (a
 * moment after `now`): two counts by post; for each network, the posts whose
 * version there is switched off or has words and is not shared (never the
 * words: whether they hold a must-fix check is kept beside them). A card
 * picture comes without its comment (`card: null`): a tile draws a plain card
 * mark. A version with no words that is on and not shared counts as no
 * version at all.
 *
 * A tile needs only how many versions are shared and scheduled, not which:
 * once one is marked, `postState` no longer reads the words. So the marked
 * versions are handed to `postState` on the switched-on networks the other
 * reads did not name, in the networks' order.
 *
 * @param {string} owner
 * @param {any[]} rows
 * @param {unknown} networks
 * @param {number} now the moment the states are worked out for, in milliseconds
 */
async function tilesFor(owner, rows, networks, now) {
  const posts = rows.map(postView);
  if (posts.length === 0) return [];
  const keys = cleanNetworks(networks);
  const groups = inGroups(posts.map((post) => post.id));
  const steps = [];
  const main = [];
  const shared = [];
  const ahead = [];
  const offOrWorded = [];
  const nowIso = new Date(now).toISOString();
  const pictures = [];
  // The chosen pictures first: their steps are the largest (three a call), and the small version steps then fill the room they leave.
  for (const ids of inGroups(posts.map((post) => post.id), PICTURE_GROUP)) {
    pictures.push([ids, steps.length]);
    steps.push(readStep('PostPicture', 'findMany', {
      where: { ownerId: owner, postId: { in: ids }, chosen: true },
      select: PICTURE_SELECT,
      orderBy: PICTURE_ORDER.map(([key, direction]) => ({ [key]: direction })),
      take: ids.length + 1,
    }));
  }
  for (const ids of groups) {
    main.push(steps.length);
    steps.push(readStep('Post', 'findMany', { where: { ownerId: owner, id: { in: ids }, mainText: { not: '' } }, select: { id: true }, orderBy: { id: 'asc' }, take: ids.length }));
    // How many of each post's switched-on versions are marked shared, and how many of those are still ahead of `now`.
    if (keys.length > 0) {
      const countBy = (sharedAt) => ({
        model: 'PostVersion',
        action: 'groupBy',
        args: { by: ['postId'], where: { ownerId: owner, postId: { in: ids }, network: { in: keys }, on: true, sharedAt }, _count: { _all: true }, orderBy: { postId: 'asc' }, take: ids.length },
        bytes: 2 + ids.length * COUNT_ROW,
      });
      shared.push(steps.length);
      steps.push(countBy({ not: null }));
      ahead.push(steps.length);
      steps.push(countBy({ gt: nowIso }));
    }
    for (const network of keys) {
      const where = { ownerId: owner, postId: { in: ids }, network };
      offOrWorded.push([network, steps.length]);
      steps.push(readStep('PostVersion', 'findMany', {
        where: { ...where, OR: [{ on: false }, { sharedAt: null, text: { not: '' } }] },
        select: { postId: true, on: true, mustFix: true, mustFixWithPicture: true },
        orderBy: { postId: 'asc' },
        take: ids.length,
      }));
    }
  }
  const answers = await readPacked(steps);

  const withMain = new Set(main.flatMap((index) => listOf(answers[index]).map((row) => row.id)));
  const counted = (indexes) => new Map(indexes.flatMap((index) => listOf(answers[index]).map((row) => [row.postId, whole(row?._count?._all)])));
  const marked = counted(shared);
  const scheduled = counted(ahead);
  const versions = new Map();
  const note = (postId, entry) => versions.set(postId, [...(versions.get(postId) ?? []), entry]);
  for (const [network, index] of offOrWorded) {
    for (const row of listOf(answers[index])) {
      note(row.postId, {
        network, on: row.on !== false, text: row.on === false ? '' : 'words', sharedAt: null,
        mustFix: row.mustFix === true, mustFixWithPicture: row.mustFixWithPicture === true,
      });
    }
  }
  const pictureRows = [];
  for (const [ids, index] of pictures) {
    const found = listOf(answers[index]);
    pictureRows.push(...found);
    // More chosen pictures than posts (two pictures added at once to one post): read on once, after the last row read.
    if (found.length > ids.length) {
      pictureRows.push(...(await readInPages('PostPicture', {
        where: { ownerId: owner, postId: { in: ids }, chosen: true }, order: PICTURE_ORDER, select: PICTURE_SELECT,
        most: ids.length, page: ids.length, after: found.at(-1),
      })));
    }
  }
  // A tile never reads a card picture's comment (its words cannot be read at a tile's size): `card` stays null.
  const chosen = new Map();
  for (const row of pictureRows) {
    const view = pictureView(row, NO_CARDS);
    const held = chosen.get(view.postId);
    if (held === undefined || view.position < held.position) chosen.set(view.postId, view);
  }
  // The marked versions, on the switched-on networks no other read named (a marked version is on and is neither of those).
  for (const post of posts) {
    let left = marked.get(post.id) ?? 0;
    let ahead = scheduled.get(post.id) ?? 0;
    const named = new Set((versions.get(post.id) ?? []).map((entry) => entry.network));
    for (const network of keys) {
      if (left === 0) break;
      if (named.has(network)) continue;
      note(post.id, { network, on: true, text: '', sharedAt: ahead > 0 ? AHEAD : nowIso });
      left -= 1;
      ahead -= 1;
    }
  }
  return posts.map((post) => {
    const picture = chosen.get(post.id) ?? null;
    const state = postState({ networks: keys, versions: versions.get(post.id) ?? [], hasChosenPicture: picture !== null, mainText: withMain.has(post.id) ? 'words' : '', now });
    return {
      id: post.id,
      name: post.name,
      day: post.day,
      time: post.time,
      themeId: post.themeId,
      campaignId: post.campaignId,
      specialDay: post.specialDay,
      madeBy: post.madeBy,
      state: state.state,
      shared: state.shared,
      scheduled: state.scheduled,
      of: state.of,
      networks: state.networks,
      picture,
    };
  });
}

/** A moment no clock reaches: what a tile hands `postState` for a version still scheduled. */
const AHEAD = '9999-12-31T23:59:59.999Z';
/** The largest row of a count by post (`{ postId, _count: { _all } }`) as a records answer writes it, with room to spare. */
const COUNT_ROW = 64;

const BY_DAY = /** @type {Array<[string, 'asc' | 'desc', boolean?]>} */ ([['day', 'asc', true], ['time', 'asc', true], ['id', 'asc']]);

/**
 * Tiles of up to `most` posts matching `where`, in `order`: the posts on a
 * cursor (as many a call as `TILE_POST_SELECT` allows), then `tilesFor`.
 *
 * @param {string} owner
 * @param {Record<string, unknown>} where
 * @param {unknown} networks
 * @param {{ order?: Array<[string, 'asc' | 'desc']>, most?: number, now?: unknown }} [options]
 */
async function tilesWhere(owner, where, networks, { order = BY_DAY, most = MOST_TILES, now } = {}) {
  const rows = await readInPages('Post', { where: { ...where, ownerId: owner }, order, select: TILE_POST_SELECT, most, page: RECORDS.rows });
  return tilesFor(owner, rows, networks, momentOf(now));
}

// --- posts ---------------------------------------------------------------------------

/**
 * A new post. `name` may be empty (the page shows "Untitled post"); `madeBy`
 * is `person` unless the month planner keeps an AI proposal. Refused: an
 * archived theme, another owner's theme, campaign or own day, and a day in a
 * month that already holds `MOST_A_MONTH` posts (`checkLinks`).
 *
 * @param {unknown} ownerId
 * @param {{ name?: string, day?: string | null, time?: string | null, themeId?: number | null, campaignId?: number | null, specialDay?: string | null, madeBy?: 'person' | 'ai', mainText?: string }} input
 */
export async function createPostFor(ownerId, input = {}) {
  const owner = requireOwner(ownerId);
  const fields = readPostFields(input, { create: true });
  await checkLinks(owner, fields);
  const at = new Date().toISOString();
  const created = await modelAction('Post', 'create', {
    data: { ownerId: owner, ...fields, createdAt: at, updatedAt: at },
    select: POST_SELECT,
  });
  return postView(created);
}

/** The most proposals one Keep these keeps: two a day in the longest month. */
export const MOST_KEPT = 62;
/** Keep these refuses in the calendar's own words. */
const KEEP_REFUSALS = Object.freeze({ month: 'month.refuse.month', count: 'month.refuse.count', day: 'month.refuse.day' });

/**
 * Keep these (Fill my month): keeps each proposal `{ day, name, themeId?,
 * specialDay? }` as an idea post on its day of `month`, made by `madeBy`
 * (`ai` or `person`), and each bring-back proposal `{ day, fromPostId }` as a
 * copy of that post on its day (what `copyPostFor` copies; made by whoever
 * made the post it copies). Every post goes in one records call
 * (`createManyAndReturn`), and the copies' pictures, hashtags and links in one
 * batch after it; when that batch fails, every post this keep made is
 * removed again: every proposal is kept, or none. A bring-back proposal whose
 * post is gone (or is not this owner's) is left out. Answers the kept posts
 * (as `createPostFor` does), by day, then id, each with the `versions` and
 * `pictures` it was kept with (none for an idea; a copy's hashtags and links,
 * and its pictures, cards without their comment's words).
 *
 * Refuses, keeping nothing: a month that is not one (`month.refuse.month`),
 * no proposals or more than `MOST_KEPT` (`refuse.request`,
 * `month.refuse.count`), a day outside the month (`month.refuse.day`), a
 * missing or too long name (`refuse.text.*`), a theme or special day that is
 * not one (`refuse.post.theme`, `refuse.post.specialDay`, also an own day that
 * is not this owner's), more than `BRING_BACK_MOST` bring-back proposals or one
 * post brought back twice (`refuse.request`), a month that would then hold
 * more than `MOST_A_MONTH` posts (`refuse.post.monthFull`), any other shape
 * (`refuse.request`); a store that does not confirm every row,
 * `error.saveUnconfirmed`. Whether each theme is one of this owner's themes in
 * use is the caller's check (the calendar reads them with the plan). A
 * bring-back proposal's name and theme are not read: its copy takes the post's.
 * Calls: one counts the month's posts (and reads the own days named), one
 * keeps; with bring-back proposals, two or three more read the posts they
 * copy and one writes the copies' pictures, hashtags and links.
 *
 * @param {unknown} ownerId
 * @param {unknown} month `YYYY-MM`
 * @param {unknown} madeBy
 * @param {unknown} proposals
 */
export async function keepProposalsFor(ownerId, month, madeBy, proposals) {
  const owner = requireOwner(ownerId);
  if (!isCivilMonth(month)) throw new DataError(KEEP_REFUSALS.month);
  if (madeBy !== 'ai' && madeBy !== 'person') throw new DataError(REQUEST);
  if (!Array.isArray(proposals) || proposals.length === 0) throw new DataError(REQUEST);
  if (proposals.length > MOST_KEPT) throw new DataError(KEEP_REFUSALS.count);
  const at = new Date().toISOString();
  /** @type {Array<{ day: string, fromPostId: number }>} */
  const copies = [];
  const data = [];
  for (const proposal of proposals) {
    if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) throw new DataError(REQUEST);
    const day = take(readDay(proposal.day));
    if (day === null) throw new DataError(REQUEST);
    if (!day.startsWith(`${month}-`)) throw new DataError(KEEP_REFUSALS.day);
    if (proposal.fromPostId !== undefined && proposal.fromPostId !== null) {
      const fromPostId = proposal.fromPostId;
      if (!isWholeId(fromPostId) || copies.some((copy) => copy.fromPostId === fromPostId)) throw new DataError(REQUEST);
      copies.push({ day, fromPostId: /** @type {number} */ (fromPostId) });
      continue;
    }
    // Every row names the same fields (a copy's among them), so the store keeps them in one statement.
    data.push({
      ownerId: owner,
      name: take(readWords(proposal.name, LIMITS.name, { required: true })),
      mainText: '',
      day,
      themeId: take(readLinkedId(proposal.themeId ?? null, POST_REFUSALS.theme)),
      campaignId: null,
      specialDay: take(readSpecialDay(proposal.specialDay ?? null)),
      madeBy,
      ask: null,
      videoPlan: null,
      fromPostId: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  if (copies.length > BRING_BACK_MOST) throw new DataError(REQUEST);
  const ownDays = [...new Set(data.map((row) => ownDayId(row.specialDay)).filter((ownId) => ownId !== null))];
  const { first, last } = monthOfDay(`${month}-01`);
  const [count, owned] = await modelBatch([
    { model: 'Post', action: 'count', args: { where: { ownerId: owner, day: { gte: first, lte: last } } } },
    { model: 'SpecialDay', action: 'findMany', args: { where: { ownerId: owner, id: { in: ownDays } }, select: { id: true }, take: Math.max(1, ownDays.length) } },
  ]);
  if (listOf(owned).length !== ownDays.length) throw new DataError(POST_REFUSALS.specialDay);
  if (Number(count ?? 0) + data.length + copies.length > MOST_A_MONTH) throw new DataError(POST_REFUSALS.monthFull);
  const sources = copies.length === 0 ? null : await readCopySources(owner, copies.map((copy) => copy.fromPostId));
  const made = copies
    .filter((copy) => sources?.posts.has(copy.fromPostId))
    .map((copy) => ({ fromPostId: copy.fromPostId, parts: copyParts(sources.posts.get(copy.fromPostId), { owner, day: copy.day, at, archived: sources.archived }) }));
  const rows = [...data, ...made.map((copy) => copy.parts.post)];
  if (rows.length === 0) return [];
  const created = await modelAction('Post', 'createManyAndReturn', { data: rows, select: POST_SELECT });
  if (!Array.isArray(created) || created.length !== rows.length) throw new DataError('error.saveUnconfirmed');
  const posts = created.map(postView);
  const copyOf = new Map(posts.filter((post) => post.fromPostId !== null).map((post) => [post.fromPostId, post]));
  if (made.some((copy) => !copyOf.has(copy.fromPostId))) throw new DataError('error.saveUnconfirmed');
  const written = await writeCopyParts(owner, made.map((copy) => ({ post: copyOf.get(copy.fromPostId), parts: copy.parts })), posts.map((post) => post.id));
  const parts = new Map(written.map((copy) => [copy.post.id, copy]));
  return posts
    .map((post) => ({ ...post, versions: parts.get(post.id)?.versions ?? [], pictures: parts.get(post.id)?.pictures ?? [] }))
    .sort((a, b) => (a.day === b.day ? a.id - b.id : a.day < b.day ? -1 : 1));
}

/**
 * A post with its versions (in the networks' order) and its pictures (by
 * position). Every network's version can be long, so the reads go through
 * `readPacked`: the post, its pictures and the versions that fit in the first
 * call, the other versions and the comments of card pictures after it. Two
 * calls, three when the card pictures' comments do not fit beside the other
 * versions; one when the post is not this owner's. A card picture shows its
 * comment's words only while the comment's permission is yes; else `card` is
 * null and `cardRefused` true.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 */
export async function getPostFor(ownerId, postId) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(postId)) return null;
  const id = /** @type {number} */ (postId);
  const steps = [
    readStep('Post', 'findFirst', { where: { id, ownerId: owner }, select: POST_SELECT }),
    readStep('PostPicture', 'findMany', { where: { ownerId: owner, postId: id }, select: PICTURE_SELECT, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: POST_PICTURES }),
    ...NETWORK_KEYS.map((network) => readStep('PostVersion', 'findFirst', { where: { ownerId: owner, postId: id, network }, select: VERSION_SELECT })),
  ];
  // The first call alone, so the post's absence ends the read and the card comments can join the call after it.
  let first = 0;
  for (let bytes = 0; first < steps.length && bytes + steps[first].bytes <= CALL_BUDGET; first += 1) bytes += steps[first].bytes;
  first = Math.max(first, 2);
  const opening = await modelBatch(steps.slice(0, first).map(({ model, action, args }) => ({ model, action, args })));
  const [post, pictureRows] = opening;
  if (post === null || post === undefined) return null;
  const comments = cardSteps(owner, listOf(pictureRows));
  const later = await readPacked([...steps.slice(first), ...comments]);
  const versionRows = [...opening.slice(2), ...later.slice(0, steps.length - first)].filter((row) => row !== null && row !== undefined);
  const cards = cardsOf(later.slice(steps.length - first));
  return {
    post: postView(post),
    versions: versionsInOrder(versionRows),
    pictures: listOf(pictureRows).map((row) => pictureView(row, cards)),
  };
}

/**
 * Changes the fields sent (`name`, `mainText`, `day`, `time`, `themeId`,
 * `campaignId`, `specialDay`); `null` clears a day, time, theme, campaign or
 * special day. Null when the post is not this owner's.
 *
 * A change of theme (to another theme or to none) also clears, in the same
 * batch, the kept shape copies drawn on the old theme's colour
 * (`themeCopySteps`); the page then keeps the missing copies again. A change
 * of day or time (either sent) moves, in the same batch, the versions
 * scheduled for a moment still ahead to the new moment, or makes them no
 * longer scheduled when the post has no day or the new moment has passed
 * (`followStep`); a version already shared stays as it is.
 *
 * Refused: a theme that is archived (unless the post already names it), a
 * day in a month that already holds `MOST_A_MONTH` other posts, and what
 * `checkLinks` refuses besides.
 *
 * Calls: one checks the theme, campaign, own day and day sent and reads the
 * post's theme, day and time (none when none of them nor a time is sent); one
 * batch changes the post, moves its scheduled versions, clears the stale
 * copies and reads the post back.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {Record<string, unknown>} input
 */
export async function updatePostFor(ownerId, postId, input = {}) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(postId)) return null;
  const id = /** @type {number} */ (postId);
  const fields = readPostFields(input);
  delete fields.madeBy;
  if (Object.keys(fields).length === 0) return readPost(owner, id);
  const sendsTheme = fields.themeId !== undefined;
  const sendsMoment = fields.day !== undefined || fields.time !== undefined;
  const before = await checkLinks(owner, fields, { heldOf: sendsTheme || sendsMoment ? id : null, postId: id });
  if ((sendsTheme || sendsMoment) && (before === null || before === undefined)) return null;
  const themeChanged = sendsTheme && wholeOrNull(before?.themeId) !== fields.themeId;
  const now = new Date().toISOString();
  const moment = sendsMoment ? scheduledMoment(fields.day !== undefined ? fields.day : before?.day, fields.time !== undefined ? fields.time : before?.time) : null;
  const done = await modelBatch([
    { model: 'Post', action: 'updateMany', args: { where: { id, ownerId: owner }, data: { ...fields, updatedAt: now } } },
    ...(sendsMoment ? [followStep(owner, id, moment, now)] : []),
    ...(themeChanged ? themeCopySteps(owner, id) : []),
    { model: 'Post', action: 'findFirst', args: { where: { id, ownerId: owner }, select: POST_SELECT } },
  ]);
  const read = done.at(-1);
  if (Number(done[0]?.count ?? 0) === 0 || read === null || read === undefined) return null;
  return postView(read);
}

/**
 * Deletes a post with its versions and pictures in one batch, and unlinks
 * the enquiries that named it. Its pictures' kept files are not removed here:
 * the app keeps every file it was given (a file kept once can be named again
 * by another record), and nothing in the app removes kept files later.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @returns {Promise<boolean>} whether the post was this owner's and is gone
 */
export async function deletePostFor(ownerId, postId) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(postId)) return false;
  const id = /** @type {number} */ (postId);
  const at = new Date().toISOString();
  const done = await modelBatch([
    { model: 'PostVersion', action: 'deleteMany', args: { where: { ownerId: owner, postId: id } } },
    { model: 'PostPicture', action: 'deleteMany', args: { where: { ownerId: owner, postId: id } } },
    { model: 'Enquiry', action: 'updateMany', args: { where: { ownerId: owner, postId: id }, data: { postId: null, updatedAt: at } } },
    { model: 'Post', action: 'deleteMany', args: { where: { id, ownerId: owner } } },
  ]);
  return Number(done[3]?.count ?? 0) > 0;
}

/**
 * The posts on the days of a month (`YYYY-MM`), by day, then time (a post
 * with no time first), then id. At most 256 posts (`MOST_TILES`): two calls
 * for the posts past 204, then `tilesFor`.
 *
 * A tile's `state` is worked out for `now` (an ISO instant or milliseconds;
 * the computer's clock when left out): a version shared after it is still
 * scheduled (`postState`). Every list of tiles below takes the same option.
 *
 * @param {unknown} ownerId
 * @param {unknown} month
 * @param {unknown} networks the person's networks (My plan), in their order
 * @param {{ now?: string | number }} [options]
 */
export async function listMonthFor(ownerId, month, networks, { now } = {}) {
  const owner = requireOwner(ownerId);
  if (!isCivilMonth(month)) throw new DataError(REQUEST);
  const [year, number] = /** @type {string} */ (month).split('-').map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(year, number)).padStart(2, '0')}`;
  return (await tilesWhere(owner, { day: { gte: first, lte: last } }, networks, { now })).sort(byDayThenTime);
}

/**
 * The posts from `fromDay` to `toDay`, both included, in the month's order.
 *
 * @param {unknown} ownerId
 * @param {unknown} fromDay
 * @param {unknown} toDay
 * @param {unknown} networks
 * @param {{ now?: string | number }} [options]
 */
export async function listDaysFor(ownerId, fromDay, toDay, networks, { now } = {}) {
  const owner = requireOwner(ownerId);
  if (!isCivilDay(fromDay) || !isCivilDay(toDay) || /** @type {string} */ (fromDay) > /** @type {string} */ (toDay)) throw new DataError(REQUEST);
  return (await tilesWhere(owner, { day: { gte: fromDay, lte: toDay } }, networks, { now })).sort(byDayThenTime);
}

/**
 * Ideas: posts with no day, newest first.
 *
 * @param {unknown} ownerId
 * @param {unknown} networks
 * @param {number} [limit] 1 to 256 (`MOST_TILES`; a larger one reads 256)
 * @param {{ now?: string | number }} [options]
 */
export async function listIdeasFor(ownerId, networks, limit = 50, { now } = {}) {
  const owner = requireOwner(ownerId);
  const count = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MOST_TILES) : 50;
  return tilesWhere(owner, { day: null }, networks, { order: [['id', 'desc']], most: count, now });
}

/**
 * The posts of one campaign, by day (ideas with no day last).
 *
 * @param {unknown} ownerId
 * @param {unknown} campaignId
 * @param {unknown} networks
 * @param {{ now?: string | number }} [options]
 */
export async function listPostsForCampaignFor(ownerId, campaignId, networks, { now } = {}) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(campaignId)) return [];
  return (await tilesWhere(owner, { campaignId }, networks, { now })).sort(byDayThenTime);
}

// --- versions -------------------------------------------------------------------------

/**
 * Writes the words of several networks for a post (Make my post), each
 * written version with `changedByPerson: false`, in one batch.
 *
 * With `replace: false`, a version the person changed that this call would
 * give different words stops the whole call: nothing is written and the
 * answer names those networks. The answer's `versions` are the versions
 * written, in the networks' order.
 *
 * Calls: one reads whether the post is this owner's and which changed
 * versions differ (compared in the read, so no words come back); one batch
 * writes, answering as many versions whole as fit in one call; one more reads
 * back the rest (only past about ten networks).
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {Array<{ network: string, text?: string, hashtags?: string | string[], link?: string, firstComment?: string, on?: boolean }>} versions
 * @param {{ replace?: boolean }} [options]
 * @returns {Promise<{ ok: true, versions: any[] } | { ok: false, changed: string[] }>}
 */
export async function saveVersionsFor(ownerId, postId, versions, { replace = false } = {}) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (!Array.isArray(versions) || versions.length === 0 || versions.length > NETWORK_KEYS.length) throw new DataError(REQUEST);
  const asked = versions.map((version) => {
    if (version === null || typeof version !== 'object' || !isNetworkKey(version.network)) throw new DataError(REQUEST);
    return { network: version.network, fields: readVersionFields(version) };
  });
  if (new Set(asked.map((item) => item.network)).size !== asked.length) throw new DataError(REQUEST);
  // A changed version differs when one of the words fields sent is not what it holds.
  const differs = replace === true ? [] : asked.filter(({ fields }) => WORDS_FIELDS.some((name) => fields[name] !== undefined));
  // The words a must-fix check reads that a version keeps from before (those not sent this time).
  const keeps = asked.filter(({ fields }) => needsHeldWords(fields));
  const [post, ...found] = await readPacked([
    readStep('Post', 'findFirst', { where: { id, ownerId: owner }, select: { id: true } }),
    ...differs.map(({ network, fields }) => readStep('PostVersion', 'findFirst', {
      where: {
        ownerId: owner, postId: id, network, changedByPerson: true,
        NOT: { AND: WORDS_FIELDS.filter((name) => fields[name] !== undefined).map((name) => ({ [name]: fields[name] })) },
      },
      select: { network: true },
    })),
    ...keeps.map(({ network }) => heldWordsStep(owner, id, network)),
  ]);
  if (post === null || post === undefined) throw new DataError(NOT_FOUND);
  const changed = found.slice(0, differs.length).filter((row) => row !== null && row !== undefined).map((row) => row.network);
  if (changed.length > 0) return { ok: false, changed: NETWORK_KEYS.filter((key) => changed.includes(key)) };
  const held = new Map(keeps.map(({ network }, index) => [network, found[differs.length + index]]));
  for (const item of asked) Object.assign(item.fields, flagsFor(item.network, item.fields, held.get(item.network)));
  const at = new Date().toISOString();
  const inFull = Math.max(1, Math.floor(CALL_BUDGET / rowBytes('PostVersion', VERSION_SELECT)));
  const written = await modelBatch([
    ...asked.map(({ network, fields }, index) => ({
      model: 'PostVersion',
      action: 'upsert',
      args: {
        where: { ownerId_postId_network: { ownerId: owner, postId: id, network } },
        create: { ownerId: owner, postId: id, network, ...fields, changedByPerson: false, updatedAt: at },
        update: { ...fields, changedByPerson: false, updatedAt: at },
        select: index < inFull ? VERSION_SELECT : { network: true },
      },
    })),
    { model: 'Post', action: 'updateMany', args: { where: { id, ownerId: owner }, data: { updatedAt: at } } },
  ]);
  const rest = asked.slice(inFull).map(({ network }) => readStep('PostVersion', 'findFirst', { where: { ownerId: owner, postId: id, network }, select: VERSION_SELECT }));
  const readBack = rest.length === 0 ? [] : await readPacked(rest);
  const kept = [...written.slice(0, Math.min(inFull, asked.length)), ...readBack].filter((row) => row !== null && row !== undefined);
  return { ok: true, versions: versionsInOrder(kept) };
}

/**
 * The person's own edit of one network's version: the words fields sent mark
 * it `changedByPerson`; switching it on or off alone does not. Null when the
 * post is not this owner's.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} network
 * @param {{ text?: string, hashtags?: string | string[], link?: string, firstComment?: string, on?: boolean }} input
 */
export async function saveVersionFor(ownerId, postId, network, input = {}) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (!isNetworkKey(network)) throw new DataError(REQUEST);
  const fields = readVersionFields(input);
  if (WORDS_FIELDS.some((name) => fields[name] !== undefined)) fields.changedByPerson = true;
  // One call: whether the post is this owner's, and the words a must-fix check reads that this edit keeps.
  const [post, held] = await readPacked([
    readStep('Post', 'findFirst', { where: { id, ownerId: owner }, select: { id: true } }),
    ...(needsHeldWords(fields) ? [heldWordsStep(owner, id, /** @type {string} */ (network))] : []),
  ]);
  if (post === null || post === undefined) return null;
  Object.assign(fields, flagsFor(/** @type {string} */ (network), fields, held));
  const at = new Date().toISOString();
  const [saved] = await modelBatch([
    {
      model: 'PostVersion',
      action: 'upsert',
      args: {
        where: { ownerId_postId_network: { ownerId: owner, postId: id, network } },
        create: { ownerId: owner, postId: id, network, ...fields, updatedAt: at },
        update: { ...fields, updatedAt: at },
        select: VERSION_SELECT,
      },
    },
    { model: 'Post', action: 'updateMany', args: { where: { id, ownerId: owner }, data: { updatedAt: at } } },
  ]);
  return versionView(saved);
}

/** @param {string} owner @param {number} postId @param {string} network */
async function readVersion(owner, postId, network) {
  const found = await modelAction('PostVersion', 'findFirst', { where: { ownerId: owner, postId, network }, select: VERSION_SELECT });
  return found === null || found === undefined ? null : versionView(found);
}

/**
 * Marks one network shared. The first press keeps its time; a later one
 * changes only the post's address on that network, when one is sent (empty
 * text clears it). A version that was scheduled for a moment still ahead is
 * shared now (its moment becomes now). Null when the post is not this
 * owner's.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} network
 * @param {{ sharedLink?: string | null }} [input]
 */
export async function markSharedFor(ownerId, postId, network, input = {}) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (!isNetworkKey(network)) throw new DataError(REQUEST);
  const linkSent = input?.sharedLink !== undefined;
  const link = linkSent ? take(readLink(input.sharedLink)) : '';
  const [post, held] = await modelBatch([
    { model: 'Post', action: 'findFirst', args: { where: { id, ownerId: owner }, select: { id: true } } },
    { model: 'PostVersion', action: 'findFirst', args: { where: { ownerId: owner, postId: id, network }, select: { sharedAt: true } } },
  ]);
  if (post === null || post === undefined) return null;
  const at = new Date().toISOString();
  const kept = textOrNull(held?.sharedAt);
  const sharedAt = kept !== null && !isAhead(kept, at) ? kept : at;
  const data = { sharedAt, ...(linkSent ? { sharedLink: link === '' ? null : link } : {}), updatedAt: at };
  const saved = await modelAction('PostVersion', 'upsert', {
    where: { ownerId_postId_network: { ownerId: owner, postId: id, network } },
    create: { ownerId: owner, postId: id, network, ...data },
    update: data,
    select: VERSION_SELECT,
  });
  return versionView(saved);
}

/**
 * "Mark scheduled": the person scheduled this network's
 * version in the platform's own scheduler for the post's day and time, so its
 * `sharedAt` becomes that moment on this computer's clock. Until then the
 * version reads as scheduled (`postState`), after it as shared, with no
 * further press. A post with no time is scheduled at `SCHEDULE_TIME` and the
 * answer says so (`timeAssumed`); a post with no day is refused
 * (`refuse.post.noDay`). The address the person gave stays. "I shared it"
 * before that moment shares it now; Undo clears it (`unmarkSharedFor`). Null
 * when the post is not this owner's. A later change of the post's day or time
 * moves the moment with it while it is still ahead (`updatePostFor`).
 *
 * Calls: one reads the post's day and time, one keeps the moment.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} network
 * @returns {Promise<{ version: ReturnType<typeof versionView>, timeAssumed: boolean } | null>}
 */
export async function markScheduledFor(ownerId, postId, network) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (!isNetworkKey(network)) throw new DataError(REQUEST);
  const post = await modelAction('Post', 'findFirst', { where: { id, ownerId: owner }, select: { day: true, time: true } });
  if (post === null || post === undefined) return null;
  const sharedAt = scheduledMoment(post.day, post.time);
  if (sharedAt === null) throw new DataError(POST_REFUSALS.noDay);
  const timeAssumed = !isClockTime(post.time);
  const at = new Date().toISOString();
  const saved = await modelAction('PostVersion', 'upsert', {
    where: { ownerId_postId_network: { ownerId: owner, postId: id, network } },
    create: { ownerId: owner, postId: id, network, sharedAt, updatedAt: at },
    update: { sharedAt, updatedAt: at },
    select: VERSION_SELECT,
  });
  return { version: versionView(saved), timeAssumed };
}

/**
 * Takes back "I shared it" (or "Mark scheduled"): clears the time and the
 * address. Null when this owner's post has no version for that network.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} network
 */
export async function unmarkSharedFor(ownerId, postId, network) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (!isNetworkKey(network)) throw new DataError(REQUEST);
  const changed = await modelAction('PostVersion', 'updateMany', {
    where: { ownerId: owner, postId: id, network },
    data: { sharedAt: null, sharedLink: null, updatedAt: new Date().toISOString() },
  });
  if (Number(changed?.count ?? 0) === 0) return null;
  return readVersion(owner, id, /** @type {string} */ (network));
}

/**
 * Saves a network's results: the counts sent (a whole number, or null to
 * clear) and one line of words; `resultAt` is now. Null when this owner's
 * post has no version for that network.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} network
 * @param {{ views?: number | null, likes?: number | null, comments?: number | null, shares?: number | null, saves?: number | null, clicks?: number | null, resultNote?: string }} input
 */
export async function saveResultsFor(ownerId, postId, network, input = {}) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (!isNetworkKey(network)) throw new DataError(REQUEST);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DataError(REQUEST);
  /** @type {Record<string, unknown>} */
  const data = {};
  for (const name of RESULT_COUNTS) if (input[name] !== undefined) data[name] = take(readCount(input[name], LIMITS.result));
  if (input.resultNote !== undefined) data.resultNote = take(readWords(input.resultNote, RESULT_NOTE_MOST));
  const at = new Date().toISOString();
  const changed = await modelAction('PostVersion', 'updateMany', {
    where: { ownerId: owner, postId: id, network },
    data: { ...data, resultAt: at, updatedAt: at },
  });
  if (Number(changed?.count ?? 0) === 0) return null;
  return readVersion(owner, id, /** @type {string} */ (network));
}

/** What one words read of a shared version selects. */
const SHARED_WORDS_SELECT = Object.freeze({ id: true, text: true, hashtags: true });
/** Shared versions whose words one call reads, planned by the longest words (about 15). */
export const SHARED_WORDS_A_CALL = Math.max(1, Math.floor(CALL_BUDGET / rowBytes('PostVersion', SHARED_WORDS_SELECT)));

/**
 * Every version marked shared from the start of `fromDay` to the end of
 * `toDay` on this computer's clock, newest first, with its post's name, day
 * and theme, and the address the person gave for it (`sharedLink`). A version
 * scheduled for a moment after `now` (an ISO instant or milliseconds; the
 * computer's clock when left out) is not shared yet and is left out. At most
 * 400 (the first 400 kept): up to four calls for the versions, `SHARED_PAGE`
 * a call, then one for their posts (256 ids a step).
 *
 * With `wordCalls` (the posts download), also each version's words (`text`
 * and `hashtags`) in at most that many more calls, `SHARED_WORDS_A_CALL`
 * versions a call (planned by the longest words a version can hold): the
 * earliest shared first. A version whose words did not fit has `text` and
 * `hashtags` null; without `wordCalls`, no version has them.
 *
 * @param {unknown} ownerId
 * @param {unknown} fromDay
 * @param {unknown} toDay
 * @param {{ wordCalls?: number, now?: string | number }} [options]
 */
export async function listSharedFor(ownerId, fromDay, toDay, { wordCalls = 0, now } = {}) {
  const owner = requireOwner(ownerId);
  if (!isCivilDay(fromDay) || !isCivilDay(toDay) || /** @type {string} */ (fromDay) > /** @type {string} */ (toDay)) throw new DataError(REQUEST);
  const start = startOfDay(/** @type {string} */ (fromDay));
  const end = startOfDay(addDays(/** @type {string} */ (toDay), 1));
  const rows = await readInPages('PostVersion', {
    where: { ownerId: owner, sharedAt: { gte: start, lt: end, lte: new Date(momentOf(now)).toISOString() } },
    order: [['id', 'asc']],
    select: { postId: true, network: true, sharedAt: true, sharedLink: true, ...Object.fromEntries(RESULT_COUNTS.map((name) => [name, true])), resultNote: true },
    most: MOST_SHARED,
    page: SHARED_PAGE,
  });
  if (rows.length === 0) return [];
  const postIds = [...new Set(rows.map((row) => row.postId))];
  const found = await readPacked(inGroups(postIds).map((ids) => readStep('Post', 'findMany', {
    where: { ownerId: owner, id: { in: ids } },
    select: { id: true, name: true, day: true, themeId: true },
    orderBy: { id: 'asc' },
    take: ids.length,
  })));
  const byId = new Map(found.flatMap(listOf).map((post) => [post.id, post]));
  const kept = rows
    .filter((row) => byId.has(row.postId) && isNetworkKey(row.network))
    .sort((a, b) => (a.sharedAt === b.sharedAt ? NETWORK_KEYS.indexOf(a.network) - NETWORK_KEYS.indexOf(b.network) : a.sharedAt < b.sharedAt ? 1 : -1));
  const words = new Map();
  const calls = Number.isInteger(wordCalls) ? Math.max(0, Math.min(wordCalls, RECORDS.calls)) : 0;
  if (calls > 0) {
    // The earliest shared first, as the posts download lists them: by moment, then the networks' order, then the post.
    const earliest = [...kept]
      .sort((a, b) => (a.sharedAt === b.sharedAt ? 0 : a.sharedAt < b.sharedAt ? -1 : 1)
        || NETWORK_KEYS.indexOf(a.network) - NETWORK_KEYS.indexOf(b.network) || a.postId - b.postId)
      .slice(0, calls * SHARED_WORDS_A_CALL)
      .map((row) => row.id);
    const answers = await readPacked(inGroups(earliest, SHARED_WORDS_A_CALL).map((ids) => readStep('PostVersion', 'findMany', {
      where: { ownerId: owner, id: { in: ids } },
      select: SHARED_WORDS_SELECT,
      orderBy: { id: 'asc' },
      take: ids.length,
    })));
    for (const row of answers.flatMap(listOf)) words.set(row.id, { text: text(row.text), hashtags: text(row.hashtags) });
  }
  return kept.map((row) => {
    const post = byId.get(row.postId);
    return {
      postId: row.postId,
      name: text(post.name),
      day: textOrNull(post.day),
      themeId: wholeOrNull(post.themeId),
      network: row.network,
      sharedAt: text(row.sharedAt),
      sharedLink: textOrNull(row.sharedLink),
      ...Object.fromEntries(RESULT_COUNTS.map((name) => [name, wholeOrNull(row[name])])),
      resultNote: text(row.resultNote),
      ...(calls > 0 ? { text: words.get(row.id)?.text ?? null, hashtags: words.get(row.id)?.hashtags ?? null } : {}),
    };
  });
}

// --- pictures --------------------------------------------------------------------------

/**
 * A new picture for a post, after its others (`position` = the current most +
 * 1). The post's first picture is chosen (so is a picture added while none
 * is). Refused past `LIMITS.picturesPerPost`.
 *
 * - `photo`, `drawn`, `changed`: `file` is the kept file's digest; `changed`
 *   also names `fromPictureId` (a picture of the same post) and `change`.
 * - `words`: the person's `words`, drawn by the page, with its `layout`
 *   (`LAYOUTS`; `words` when not sent) and `subline` (a price, a date or a
 *   name under the words, at most `SUBLINE_MOST` letters).
 * - `card`: `commentId`, a comment of this owner with permission `yes`; the
 *   card is drawn from the comment, so nothing of it is copied here.
 *
 * Null when the post is not this owner's.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * A new picture joins neither of the post's sets (`setPictureSetFor`).
 *
 * @param {{ source: string, file?: string, prompt?: string, change?: string, fromPictureId?: number, words?: string, layout?: string, subline?: string,
 *   commentId?: number, width?: number, height?: number, description?: string }} input
 */
export async function addPictureFor(ownerId, postId, input) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DataError(REQUEST);
  const source = input.source;
  if (typeof source !== 'string' || !PICTURE_SOURCES.includes(source)) throw new DataError(POST_REFUSALS.pictureSource);
  /** @type {Record<string, unknown>} */
  const data = { source };
  if (FILE_SOURCES.has(source)) {
    if (input.file === undefined || input.file === null || input.file === '') throw new DataError(POST_REFUSALS.pictureFile);
    if (!isDigest(input.file)) throw new DataError('error.fileNotKept');
    data.file = input.file;
  }
  if (source === 'drawn' || source === 'changed') {
    const prompt = take(readWords(input.prompt, Number.MAX_SAFE_INTEGER, { multiline: true }));
    data.prompt = cutText(prompt, PROMPT_MOST);
  }
  if (source === 'changed') {
    if (!isWholeId(input.fromPictureId)) throw new DataError(REQUEST);
    data.fromPictureId = input.fromPictureId;
    data.change = take(readWords(input.change, LIMITS.change, { required: true }));
  }
  if (source === 'words') data.words = take(readWords(input.words, LIMITS.pictureWords, { required: true, multiline: true }));
  if (input.layout !== undefined || input.subline !== undefined) {
    if (source !== 'words') throw new DataError(REQUEST);
    if (input.layout !== undefined) data.layout = take(readLayout(input.layout));
    if (input.subline !== undefined) data.subline = take(readSubline(input.subline));
  }
  if (source === 'card') {
    if (!isWholeId(input.commentId)) throw new DataError(REQUEST);
    data.commentId = input.commentId;
  }
  if (input.width !== undefined || input.height !== undefined) {
    data.width = take(readSide(input.width));
    data.height = take(readSide(input.height));
  }
  if (input.description !== undefined) data.description = take(readWords(input.description, LIMITS.description));

  const siblings = await modelAction('PostPicture', 'findMany', {
    where: { ownerId: owner, postId: id },
    select: { id: true, position: true, chosen: true },
    orderBy: { position: 'asc' },
    take: LIMITS.picturesPerPost + 1,
  });
  if (siblings.length === 0 && !(await postExists(owner, id))) return null;
  if (siblings.length >= LIMITS.picturesPerPost) throw new DataError(POST_REFUSALS.tooManyPictures);
  if (source === 'changed' && !siblings.some((row) => row.id === data.fromPictureId)) throw new DataError(REQUEST);
  const cards = new Map();
  if (source === 'card') {
    const comment = await modelAction('CustomerComment', 'findFirst', {
      where: { id: data.commentId, ownerId: owner, permission: SHOWN },
      select: CARD_SELECT,
    });
    if (comment === null || comment === undefined) throw new DataError(POST_REFUSALS.noPermission);
    cards.set(comment.id, cardView(comment));
  }
  const position = siblings.reduce((most, row) => Math.max(most, whole(row.position)), 0) + 1;
  const created = await modelAction('PostPicture', 'create', {
    data: { ownerId: owner, postId: id, ...data, position, chosen: !siblings.some((row) => row.chosen === true), createdAt: new Date().toISOString() },
    select: PICTURE_SELECT,
  });
  return pictureView(created, { cards, refused: new Set() });
}

/**
 * The steps that read one picture back with its card's comment: its words
 * while its permission is yes, else whether it is there with another one.
 *
 * @param {string} owner @param {number} id @param {unknown} commentId
 */
function readBackSteps(owner, id, commentId) {
  const steps = [{ model: 'PostPicture', action: 'findFirst', args: { where: { id, ownerId: owner }, select: PICTURE_SELECT } }];
  if (isWholeId(commentId)) {
    steps.push(
      { model: 'CustomerComment', action: 'findFirst', args: { where: { id: commentId, ownerId: owner, permission: SHOWN }, select: CARD_SELECT } },
      { model: 'CustomerComment', action: 'findFirst', args: { where: { id: commentId, ownerId: owner, permission: { not: SHOWN } }, select: { id: true } } },
    );
  }
  return steps;
}

/** @param {any} picture @param {any} [comment] @param {any} [refused] */
function viewWithCard(picture, comment, refused) {
  if (picture === null || picture === undefined) return null;
  const comments = { cards: new Map(), refused: new Set() };
  if (comment !== null && comment !== undefined) comments.cards.set(comment.id, cardView(comment));
  if (refused !== null && refused !== undefined) comments.refused.add(refused.id);
  return pictureView(picture, comments);
}

/** @param {string} owner @param {number} id */
async function readPictureView(owner, id) {
  const picture = await modelAction('PostPicture', 'findFirst', { where: { id, ownerId: owner }, select: PICTURE_SELECT });
  if (picture === null || picture === undefined) return null;
  const cards = await readCards(owner, [picture]);
  return pictureView(picture, cards);
}

const LOOK_FIELDS = Object.freeze(['focusX', 'focusY', 'fit', 'words', 'width', 'height', 'layout', 'subline']);

/**
 * Changes a picture's description, focus point, fill or fit, words, layout
 * and subline (a words picture only), stored size, or kept shapes (`shapes`:
 * `{ <shape key>: digest | null }`). A change of focus, fit, words, layout,
 * subline, width or height clears every kept shape, except the shapes this
 * same call sets. A card picture's
 * shapes are kept only while its comment's permission is yes
 * (`refuse.picture.noPermission`; one more call). Null when the picture is
 * not this owner's.
 *
 * @param {unknown} ownerId
 * @param {unknown} pictureId
 * @param {{ description?: string, focusX?: number, focusY?: number, fit?: string, words?: string, layout?: string, subline?: string, width?: number, height?: number,
 *   shapes?: Record<string, string | null> }} input
 */
export async function updatePictureFor(ownerId, pictureId, input = {}) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(pictureId)) return null;
  const id = /** @type {number} */ (pictureId);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DataError(REQUEST);
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (input.description !== undefined) fields.description = take(readWords(input.description, LIMITS.description));
  if (input.focusX !== undefined) fields.focusX = take(readFocus(input.focusX));
  if (input.focusY !== undefined) fields.focusY = take(readFocus(input.focusY));
  if (input.fit !== undefined) {
    if (typeof input.fit !== 'string' || !FITS.includes(input.fit)) throw new DataError(POST_REFUSALS.pictureFit);
    fields.fit = input.fit;
  }
  if (input.width !== undefined) fields.width = take(readSide(input.width));
  if (input.height !== undefined) fields.height = take(readSide(input.height));
  if (input.words !== undefined) fields.words = take(readWords(input.words, LIMITS.pictureWords, { required: true, multiline: true }));
  if (input.layout !== undefined) fields.layout = take(readLayout(input.layout));
  if (input.subline !== undefined) fields.subline = take(readSubline(input.subline));
  /** @type {Record<string, string | null>} */
  const shapes = {};
  if (input.shapes !== undefined) {
    if (input.shapes === null || typeof input.shapes !== 'object' || Array.isArray(input.shapes)) throw new DataError(POST_REFUSALS.pictureShape);
    for (const [key, digest] of Object.entries(input.shapes)) {
      if (!isShapeKey(key) || (digest !== null && !isDigest(digest))) throw new DataError(POST_REFUSALS.pictureShape);
      shapes[SHAPES[key].field] = digest;
    }
  }
  const current = await modelAction('PostPicture', 'findFirst', {
    where: { id, ownerId: owner },
    select: { id: true, source: true, commentId: true, focusX: true, focusY: true, fit: true, words: true, width: true, height: true, layout: true, subline: true },
  });
  if (current === null || current === undefined) return null;
  if ((fields.words !== undefined || fields.layout !== undefined || fields.subline !== undefined) && current.source !== 'words') throw new DataError(REQUEST);
  // A layout or subline kept before they existed is empty: it reads as the default.
  const look = { ...current, layout: LAYOUTS.includes(current.layout) ? current.layout : 'words', subline: text(current.subline) };
  // A card's copies carry its customer's words: kept only while the comment's permission is yes.
  if (current.source === 'card' && Object.values(shapes).some((digest) => digest !== null)) {
    const shown = isWholeId(current.commentId)
      ? await modelAction('CustomerComment', 'findFirst', { where: { id: current.commentId, ownerId: owner, permission: SHOWN }, select: { id: true } })
      : null;
    if (shown === null || shown === undefined) throw new DataError(POST_REFUSALS.noPermission);
  }
  const data = { ...fields };
  if (LOOK_FIELDS.some((name) => fields[name] !== undefined && fields[name] !== look[name])) {
    for (const field of SHAPE_FIELDS) data[field] = null;
  }
  Object.assign(data, shapes);
  if (Object.keys(data).length === 0) return readPictureView(owner, id);
  const [changed, picture, comment, refused] = await modelBatch([
    { model: 'PostPicture', action: 'updateMany', args: { where: { id, ownerId: owner }, data } },
    ...readBackSteps(owner, id, current.source === 'card' ? current.commentId : null),
  ]);
  if (Number(changed?.count ?? 0) === 0) return null;
  return viewWithCard(picture, comment, refused);
}

/** The steps that make `pictureId` its post's chosen picture, and no other. @param {string} owner @param {number} postId @param {number} pictureId */
function chooseSteps(owner, postId, pictureId) {
  return [
    { model: 'PostPicture', action: 'updateMany', args: { where: { ownerId: owner, postId, chosen: true, id: { not: pictureId } }, data: { chosen: false } } },
    { model: 'PostPicture', action: 'updateMany', args: { where: { id: pictureId, ownerId: owner, postId }, data: { chosen: true } } },
  ];
}

/**
 * The steps that make `ordered` (picture ids of one post) its set `kind`, in
 * that order (numbers 1, 2, ...), and take every other picture of the post
 * out of it: one step clears the others, one more for each picture whose
 * number changes (`rows`: the post's pictures with their numbers now).
 *
 * @param {string} owner @param {number} postId @param {'slide' | 'story'} kind
 * @param {any[]} rows @param {number[]} ordered
 */
function setSteps(owner, postId, kind, rows, ordered) {
  const held = new Map(rows.map((row) => [row.id, wholeOrNull(row[kind])]));
  const steps = [{ model: 'PostPicture', action: 'updateMany', args: { where: { ownerId: owner, postId, id: { notIn: ordered }, [kind]: { not: null } }, data: { [kind]: null } } }];
  ordered.forEach((pictureId, index) => {
    if (held.get(pictureId) !== index + 1) steps.push({ model: 'PostPicture', action: 'updateMany', args: { where: { id: pictureId, ownerId: owner, postId }, data: { [kind]: index + 1 } } });
  });
  return steps;
}

/**
 * Makes this the post's chosen picture, and no other. The chosen picture is
 * the cover and the first of the post's swipe set: when the
 * post has one, this picture becomes its first (it joins the set when it was
 * not in it, and a set that would then pass `SET_LIMITS.slide` leaves out its
 * last). Null when the picture is not this owner's.
 *
 * Calls: one reads the picture, one the post's swipe set, one batch chooses
 * it, orders the set and reads the picture back.
 *
 * @param {unknown} ownerId
 * @param {unknown} pictureId
 */
export async function choosePictureFor(ownerId, pictureId) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(pictureId)) return null;
  const id = /** @type {number} */ (pictureId);
  const held = await modelAction('PostPicture', 'findFirst', { where: { id, ownerId: owner }, select: { postId: true, source: true, commentId: true } });
  if (held === null || held === undefined) return null;
  const postId = whole(held.postId);
  const set = listOf(await modelAction('PostPicture', 'findMany', {
    where: { ownerId: owner, postId, slide: { not: null } },
    select: { id: true, slide: true },
    orderBy: [{ slide: 'asc' }, { id: 'asc' }],
    take: POST_PICTURES,
  }));
  const ordered = set.length === 0 ? [] : [id, ...set.map((row) => row.id).filter((other) => other !== id)].slice(0, SET_LIMITS.slide);
  const steps = [...chooseSteps(owner, postId, id), ...(ordered.length === 0 ? [] : setSteps(owner, postId, 'slide', set, ordered))];
  const done = await modelBatch([...steps, ...readBackSteps(owner, id, held.source === 'card' ? held.commentId : null)]);
  if (Number(done[1]?.count ?? 0) === 0) return null;
  const [picture, comment, refused] = done.slice(steps.length);
  return viewWithCard(picture, comment, refused);
}

/**
 * Deletes a picture. When it was the chosen one, the next picture becomes
 * chosen: the first left in the post's swipe set when it has one (the cover
 * is the set's first), else the next by position (the one before when it was
 * the last). Its kept files are not removed (as `deletePostFor` says, nothing
 * removes kept files).
 *
 * @param {unknown} ownerId
 * @param {unknown} pictureId
 * @returns {Promise<boolean>} whether the picture was this owner's and is gone
 */
export async function deletePictureFor(ownerId, pictureId) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(pictureId)) return false;
  const id = /** @type {number} */ (pictureId);
  const held = await modelAction('PostPicture', 'findFirst', { where: { id, ownerId: owner }, select: { postId: true, chosen: true, position: true } });
  if (held === null || held === undefined) return false;
  const steps = [{ model: 'PostPicture', action: 'deleteMany', args: { where: { id, ownerId: owner } } }];
  if (held.chosen === true) {
    const others = await modelAction('PostPicture', 'findMany', {
      where: { ownerId: owner, postId: held.postId, id: { not: id } },
      select: { id: true, position: true, slide: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: LIMITS.picturesPerPost * 2,
    });
    const inSet = others.filter((row) => isWholeId(row.slide)).sort((a, b) => a.slide - b.slide || a.id - b.id);
    const next = inSet[0] ?? others.find((row) => row.position > held.position) ?? others.at(-1);
    if (next !== undefined) steps.push({ model: 'PostPicture', action: 'updateMany', args: { where: { id: next.id, ownerId: owner }, data: { chosen: true } } });
  }
  const [removed] = await modelBatch(steps);
  return Number(removed?.count ?? 0) > 0;
}

// --- sets of pictures ---------------------------------------------------------------------

/** A set's kind: `slide` (the swipe set) or `story` (the story set). @param {unknown} kind */
function requireKind(kind) {
  if (typeof kind !== 'string' || !SET_KINDS.includes(kind)) throw new DataError(REQUEST);
  return /** @type {'slide' | 'story'} */ (kind);
}

/** The refusal for a set past its most. @param {'slide' | 'story'} kind */
const setFull = (kind) => new DataError(kind === 'slide' ? POST_REFUSALS.slidesFull : POST_REFUSALS.storyFull);

/** What the set functions read of a post's pictures. */
const SET_ROW_SELECT = Object.freeze({ id: true, source: true, chosen: true, position: true, slide: true, story: true });

/**
 * One call: whether the post is this owner's, and its pictures with their
 * places in both sets. Null when the post is not this owner's.
 *
 * @param {string} owner @param {number} postId
 */
async function readSetRows(owner, postId) {
  const [post, rows] = await modelBatch([
    { model: 'Post', action: 'findFirst', args: { where: { id: postId, ownerId: owner }, select: { id: true } } },
    { model: 'PostPicture', action: 'findMany', args: { where: { ownerId: owner, postId }, select: SET_ROW_SELECT, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: POST_PICTURES } },
  ]);
  return post === null || post === undefined ? null : listOf(rows);
}

/**
 * Orders one of a post's sets of pictures: `pictureIds`, in
 * that order, become the post's swipe set (`slide`, at most
 * `SET_LIMITS.slide`) or its story set (`story`, at most `SET_LIMITS.story`);
 * every other picture of the post leaves that set and stays a picture. An
 * empty list empties the set. The first of a swipe set is the cover: it
 * becomes the post's chosen picture. Refused: an id that is not one of this
 * post's pictures, or one named twice (`refuse.request`), a set past its most
 * (`refuse.picture.slidesFull`, `refuse.picture.storyFull`). Answers the post
 * as `getPostFor` reads it; null when the post is not this owner's.
 *
 * Calls: one reads the post's pictures, one batch orders the set (none when
 * nothing changes), then `getPostFor` (two or three).
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} kind `slide` or `story`
 * @param {unknown} pictureIds
 */
export async function setPictureSetFor(ownerId, postId, kind, pictureIds) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  const set = requireKind(kind);
  if (!Array.isArray(pictureIds) || pictureIds.some((item) => !isWholeId(item)) || new Set(pictureIds).size !== pictureIds.length) throw new DataError(REQUEST);
  if (pictureIds.length > SET_LIMITS[set]) throw setFull(set);
  const rows = await readSetRows(owner, id);
  if (rows === null) return null;
  const held = new Map(rows.map((row) => [row.id, row]));
  if (pictureIds.some((pictureId) => !held.has(pictureId))) throw new DataError(REQUEST);
  const ordered = /** @type {number[]} */ (pictureIds);
  const steps = setSteps(owner, id, set, rows, ordered);
  if (set === 'slide' && ordered.length > 0 && held.get(ordered[0]).chosen !== true) steps.push(...chooseSteps(owner, id, ordered[0]));
  await modelBatch(steps);
  return getPostFor(owner, id);
}

/**
 * Makes a set of words pictures in one press (Make slides, Make a story set):
 * each item `{ words, layout?, subline? }` (as a words picture takes them)
 * becomes a new words picture of the post, after its others, and together
 * they become the set `kind`, in order. A swipe set keeps the post's chosen
 * picture as its cover and first, so the new pictures follow
 * it; a post with no picture yet gets the first new one as its chosen picture.
 * The pictures of the set before stay pictures, out of the set; with
 * `replace`, its words pictures that are in no other set and are not the
 * chosen picture are removed in the same batch.
 *
 * All or nothing, in one batch. Refused before anything is written: no items
 * or another shape (`refuse.request`), a words or subline refusal
 * (`refuse.text.*`), a set past its most (`refuse.picture.slidesFull`,
 * `refuse.picture.storyFull`), a post that would then hold more than
 * `LIMITS.picturesPerPost` pictures (`refuse.picture.tooMany`). Answers the
 * post as `getPostFor` reads it; null when the post is not this owner's.
 *
 * Calls: one reads the post's pictures, one batch writes, then `getPostFor`
 * (two or three).
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} kind `slide` or `story`
 * @param {unknown} items
 * @param {{ replace?: boolean }} [options]
 */
export async function saveWordsSetFor(ownerId, postId, kind, items, { replace = false } = {}) {
  const owner = requireOwner(ownerId);
  const id = requireId(postId);
  const set = requireKind(kind);
  if (!Array.isArray(items) || items.length === 0) throw new DataError(REQUEST);
  if (items.length > SET_LIMITS[set]) throw setFull(set);
  const pictures = items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new DataError(REQUEST);
    return {
      words: take(readWords(item.words, LIMITS.pictureWords, { required: true, multiline: true })),
      layout: item.layout === undefined || item.layout === null ? 'words' : take(readLayout(item.layout)),
      subline: take(readSubline(item.subline)),
    };
  });
  const rows = await readSetRows(owner, id);
  if (rows === null) return null;
  const other = set === 'slide' ? 'story' : 'slide';
  const chosen = rows.find((row) => row.chosen === true) ?? null;
  const removed = replace !== true ? [] : rows
    .filter((row) => row.source === 'words' && isWholeId(row[set]) && !isWholeId(row[other]) && row.chosen !== true)
    .map((row) => row.id);
  const cover = set === 'slide' && chosen !== null ? 1 : 0;
  if (cover + pictures.length > SET_LIMITS[set]) throw setFull(set);
  if (rows.length - removed.length + pictures.length > LIMITS.picturesPerPost) throw new DataError(POST_REFUSALS.tooManyPictures);
  const last = rows.filter((row) => !removed.includes(row.id)).reduce((most, row) => Math.max(most, whole(row.position)), 0);
  const at = new Date().toISOString();
  const steps = [];
  if (removed.length > 0) steps.push({ model: 'PostPicture', action: 'deleteMany', args: { where: { ownerId: owner, postId: id, id: { in: removed } } } });
  steps.push({ model: 'PostPicture', action: 'updateMany', args: { where: { ownerId: owner, postId: id, [set]: { not: null } }, data: { [set]: null } } });
  if (cover === 1) steps.push({ model: 'PostPicture', action: 'updateMany', args: { where: { id: chosen.id, ownerId: owner, postId: id }, data: { slide: 1 } } });
  steps.push({
    model: 'PostPicture',
    action: 'createMany',
    args: {
      data: pictures.map((picture, index) => ({
        ownerId: owner, postId: id, source: 'words', ...picture, position: last + 1 + index,
        chosen: chosen === null && index === 0, [set]: cover + index + 1, createdAt: at,
      })),
    },
  });
  const done = await modelBatch(steps);
  if (Number(done.at(-1)?.count ?? 0) !== pictures.length) throw new DataError('error.saveUnconfirmed');
  return getPostFor(owner, id);
}

/**
 * The digest of a picture's kept file: `original` (the file as it was given:
 * a person's photo is their own file, never changed) or a shape's kept copy.
 * Null when the picture is not this owner's or that file is not kept.
 *
 * @param {unknown} ownerId
 * @param {unknown} pictureId
 * @param {unknown} shapeOrOriginal `original` or a shape key
 */
export async function pictureFileFor(ownerId, pictureId, shapeOrOriginal) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(pictureId)) return null;
  const field = shapeOrOriginal === 'original' ? 'file' : isShapeKey(shapeOrOriginal) ? SHAPES[/** @type {string} */ (shapeOrOriginal)].field : null;
  if (field === null) return null;
  const found = await modelAction('PostPicture', 'findFirst', { where: { id: pictureId, ownerId: owner }, select: { [field]: true } });
  const digest = found?.[field];
  return isDigest(digest) ? digest : null;
}

/**
 * The scenes this post's last AI pictures were made from (their kept
 * prompts), newest first, at most `most` (up to `LIMITS.picturesPerPost`).
 * One call.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {number} most
 * @returns {Promise<string[]>}
 */
export async function picturePromptsFor(ownerId, postId, most) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(postId)) return [];
  const take = Number.isInteger(most) ? Math.min(Math.max(most, 0), LIMITS.picturesPerPost) : 0;
  if (take === 0) return [];
  const rows = listOf(await modelAction('PostPicture', 'findMany', {
    where: { ownerId: owner, postId, source: { in: ['drawn', 'changed'] } },
    select: { id: true, prompt: true },
    orderBy: { id: 'desc' },
    take,
  }));
  return rows.map((row) => text(row?.prompt)).filter((prompt) => prompt !== '');
}

/**
 * A picture as Change this picture needs it (a picture summary leaves out its
 * prompt and its file), with how many pictures its post has. Null when it is
 * not this owner's. Two calls.
 *
 * @param {unknown} ownerId
 * @param {unknown} pictureId
 * @returns {Promise<{ id: number, postId: number, source: string, file: string, prompt: string, description: string, pictures: number } | null>}
 */
export async function pictureForChangeFor(ownerId, pictureId) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(pictureId)) return null;
  const row = await modelAction('PostPicture', 'findFirst', {
    where: { id: pictureId, ownerId: owner },
    select: { id: true, postId: true, source: true, file: true, prompt: true, description: true },
  });
  if (row === null || row === undefined) return null;
  const pictures = await modelAction('PostPicture', 'count', { where: { ownerId: owner, postId: whole(row.postId) } });
  return {
    id: whole(row.id),
    postId: whole(row.postId),
    source: text(row.source),
    file: text(row.file),
    prompt: text(row.prompt),
    description: text(row.description),
    pictures: Number(pictures ?? 0),
  };
}

// --- post again ---------------------------------------------------------------------------

/** How many days old a post must be before Fill my month offers to bring it back. */
export const BRING_BACK_AGE = 60;
/** The most posts one Fill my month brings back. */
export const BRING_BACK_MOST = 2;
/** The posts with customers one bring-back read looks at, newest post first. */
const BRING_BACK_LOOK = 256;

/** What a copy takes of a picture: everything but its id, its post, its prompt (read on its own: it is long), the picture it was changed from and when it was made. */
const COPY_PICTURE_FIELDS = Object.freeze(['id', 'source', 'file', 'change', 'words', 'commentId', 'chosen', 'description', 'position', 'width', 'height',
  'focusX', 'focusY', 'fit', 'slide', 'story', 'layout', 'subline', ...SHAPE_FIELDS]);
const COPY_PICTURE_SELECT = Object.freeze(Object.fromEntries(COPY_PICTURE_FIELDS.map((name) => [name, true])));
/** What a copy takes of a version: the network's switch, its hashtags and its link; never its words, its share or its results. */
const COPY_VERSION_SELECT = Object.freeze({ network: true, on: true, hashtags: true, link: true });
const BY_POSITION = Object.freeze([{ position: 'asc' }, { id: 'asc' }]);
/** The largest row of a list of theme ids, with the comma after it. */
const THEME_ID_ROW = 3 + 'id'.length + 4 + INT;

/**
 * Reads the posts `ids` (this owner's only) as a copy needs them: each post,
 * its first `LIMITS.picturesPerPost` pictures by position (with their
 * prompts), its versions' switches, hashtags and links; the ids of this
 * owner's archived themes (a copy never links to one); and, with `day`, how
 * many posts the month of `day` holds. Through `readPacked`: two calls for
 * one post, three for two.
 *
 * @param {string} owner
 * @param {number[]} ids
 * @param {{ day?: string | null }} [options]
 * @returns {Promise<{ posts: Map<number, { post: any, pictures: any[], versions: any[] }>, archived: Set<number>, count: number }>}
 */
async function readCopySources(owner, ids, { day = null } = {}) {
  const steps = [];
  const where = new Map();
  for (const id of ids) {
    // A post beside its prompts: the prompts are the largest step, and the post is what fills the call they leave room in.
    where.set(id, { post: steps.length, prompts: steps.length + 1 });
    steps.push(readStep('Post', 'findFirst', { where: { id, ownerId: owner }, select: POST_SELECT }));
    steps.push(readStep('PostPicture', 'findMany', { where: { ownerId: owner, postId: id }, select: { id: true, prompt: true }, orderBy: BY_POSITION, take: LIMITS.picturesPerPost }));
  }
  for (const id of ids) {
    where.get(id).versions = steps.length;
    steps.push(readStep('PostVersion', 'findMany', {
      where: { ownerId: owner, postId: id, network: { in: [...NETWORK_KEYS] } }, select: COPY_VERSION_SELECT, orderBy: { id: 'asc' }, take: NETWORK_KEYS.length,
    }));
  }
  for (const id of ids) {
    where.get(id).pictures = steps.length;
    steps.push(readStep('PostPicture', 'findMany', { where: { ownerId: owner, postId: id }, select: COPY_PICTURE_SELECT, orderBy: BY_POSITION, take: LIMITS.picturesPerPost }));
  }
  const archivedAt = steps.length;
  steps.push({
    model: 'Theme', action: 'findMany', args: { where: { ownerId: owner, archived: true }, select: { id: true }, orderBy: { id: 'asc' }, take: MOST_THEMES },
    bytes: 2 + MOST_THEMES * THEME_ID_ROW,
  });
  let countAt = -1;
  if (day !== null) {
    const { first, last } = monthOfDay(day);
    countAt = steps.length;
    steps.push({ model: 'Post', action: 'count', args: { where: { ownerId: owner, day: { gte: first, lte: last } } }, bytes: INT });
  }
  const answers = await readPacked(steps);
  const posts = new Map();
  for (const [id, at] of where) {
    const post = answers[at.post];
    if (post === null || post === undefined) continue;
    const prompts = new Map(listOf(answers[at.prompts]).map((row) => [row.id, text(row.prompt)]));
    const pictures = listOf(answers[at.pictures]).map((row) => ({ ...row, prompt: prompts.get(row.id) ?? '' }));
    posts.set(id, { post, pictures, versions: listOf(answers[at.versions]) });
  }
  return {
    posts,
    archived: new Set(listOf(answers[archivedAt]).map((row) => row.id)),
    count: countAt === -1 ? 0 : Number(answers[countAt] ?? 0),
  };
}

/**
 * The rows a copy of a post is kept with (pure): the post (its name, main
 * words, theme unless archived, campaign, ask, video plan and how it was
 * made; on `day`, with no time and no special day; `fromPostId` names the
 * post it copies), a version for each network whose switch is off or that
 * holds hashtags or a link (only those: no words, no share, no results), and
 * its pictures (new rows naming the same kept files and shape copies, in the
 * same order, with their places in the swipe and story sets). Exactly one
 * picture is chosen: the first chosen one, else the first. A card picture
 * names the same comment (the comment itself is not copied). `postId` is
 * filled in once the post is kept.
 *
 * @param {{ post: any, pictures: any[], versions: any[] }} source
 * @param {{ owner: string, day: string | null, at: string, archived: Set<number> }} options
 */
function copyParts(source, { owner, day, at, archived }) {
  const { post } = source;
  const themeId = isWholeId(post.themeId) && !archived.has(post.themeId) ? post.themeId : null;
  const pictures = [...source.pictures].sort((a, b) => whole(a.position) - whole(b.position) || a.id - b.id).slice(0, LIMITS.picturesPerPost);
  const chosen = Math.max(0, pictures.findIndex((row) => row.chosen === true));
  return {
    post: {
      ownerId: owner,
      name: text(post.name),
      mainText: text(post.mainText),
      day,
      themeId,
      campaignId: wholeOrNull(post.campaignId),
      specialDay: null,
      madeBy: post.madeBy === 'ai' ? 'ai' : 'person',
      ask: askOf(post.ask),
      videoPlan: text(post.videoPlan),
      fromPostId: post.id,
      createdAt: at,
      updatedAt: at,
    },
    versions: source.versions
      .filter((row) => isNetworkKey(row?.network) && (row.on === false || text(row.hashtags) !== '' || text(row.link) !== ''))
      .map((row) => ({
        ownerId: owner,
        network: row.network,
        on: row.on !== false,
        hashtags: text(row.hashtags),
        link: text(row.link),
        ...mustFixOf({ network: row.network, text: '', hashtags: text(row.hashtags), link: text(row.link) }),
        updatedAt: at,
      })),
    pictures: pictures.map((row, index) => {
      const { id: _id, chosen: _chosen, ...kept } = row;
      return { ...kept, ownerId: owner, chosen: index === chosen, createdAt: at };
    }),
  };
}

/**
 * Keeps the versions and pictures of copies whose posts were just kept, in
 * one batch, and answers each copy with them: `{ post, versions, pictures }`
 * (versions as written: their hashtags and links come back as sent, not read
 * back, so two copies' longest hashtags never crowd the batch's answer;
 * pictures read back, by position, a card picture without its comment's
 * words). When
 * the batch fails or is not confirmed, the posts `made` (every post the press
 * made, the copies among them) are removed again with anything kept for them,
 * so nothing of the press stays: `error.saveFailed`, or
 * `error.saveUnconfirmed` when the removal is not confirmed either.
 *
 * @param {string} owner
 * @param {Array<{ post: ReturnType<typeof postView>, parts: ReturnType<typeof copyParts> }>} copies
 * @param {number[]} made
 */
async function writeCopyParts(owner, copies, made) {
  const versions = copies.flatMap(({ post, parts }) => parts.versions.map((row) => ({ ...row, postId: post.id })));
  const pictures = copies.flatMap(({ post, parts }) => parts.pictures.map((row) => ({ ...row, postId: post.id })));
  const steps = [];
  if (versions.length > 0) steps.push({ model: 'PostVersion', action: 'createMany', args: { data: versions } });
  if (pictures.length > 0) steps.push({ model: 'PostPicture', action: 'createManyAndReturn', args: { data: pictures, select: PICTURE_SELECT } });
  let pictureRows = [];
  if (steps.length > 0) {
    try {
      const done = await modelBatch(steps);
      if (versions.length > 0 && Number(done[0]?.count ?? -1) !== versions.length) throw new DataError('error.saveUnconfirmed');
      pictureRows = pictures.length > 0 ? listOf(done.at(-1)) : [];
      if (pictureRows.length !== pictures.length) throw new DataError('error.saveUnconfirmed');
    } catch {
      const removed = await modelBatch([
        { model: 'PostVersion', action: 'deleteMany', args: { where: { ownerId: owner, postId: { in: made } } } },
        { model: 'PostPicture', action: 'deleteMany', args: { where: { ownerId: owner, postId: { in: made } } } },
        { model: 'Post', action: 'deleteMany', args: { where: { ownerId: owner, id: { in: made } } } },
      ]).then(() => true, () => false);
      throw new DataError(removed ? 'error.saveFailed' : 'error.saveUnconfirmed');
    }
  }
  return copies.map(({ post }) => ({
    post,
    versions: versionsInOrder(versions.filter((row) => row.postId === post.id)),
    pictures: pictureRows.filter((row) => row.postId === post.id).map((row) => pictureView(row)).sort((a, b) => a.position - b.position || a.id - b.id),
  }));
}

/**
 * Post again: a new post copying this one (what `copyParts` takes: its name,
 * main words, theme, campaign, ask, video plan, each network's switch,
 * hashtags and link, and its pictures as new rows naming the same kept files
 * and shape copies, with their places in the swipe and story sets), on `day`
 * (a civil day; none, or null, keeps it an idea with no day), with
 * `fromPostId` naming this post. Never its words for each network, its
 * shares, its results or its comments. Answers `{ post, versions, pictures }`
 * (as `writeCopyParts` does); null when the post is not this owner's.
 *
 * Refused: a day that is not one (`refuse.post.day`), a month that already
 * holds `MOST_A_MONTH` posts (`refuse.post.monthFull`). The post is kept
 * first, then its versions and pictures in one batch; when that batch fails
 * the new post is removed again (`writeCopyParts`). Calls: two read the post,
 * one keeps the new one, one keeps its versions and pictures (none when it
 * has neither).
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {{ day?: unknown }} [options]
 */
export async function copyPostFor(ownerId, postId, { day } = {}) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(postId)) return null;
  const id = /** @type {number} */ (postId);
  const target = take(readDay(day));
  const read = await readCopySources(owner, [id], { day: target });
  const source = read.posts.get(id);
  if (source === undefined) return null;
  if (target !== null && read.count + 1 > MOST_A_MONTH) throw new DataError(POST_REFUSALS.monthFull);
  const parts = copyParts(source, { owner, day: target, at: new Date().toISOString(), archived: read.archived });
  const created = await modelAction('Post', 'create', { data: parts.post, select: POST_SELECT });
  if (created === null || typeof created !== 'object' || !isWholeId(created.id)) throw new DataError('error.saveUnconfirmed');
  const post = postView(created);
  const [copy] = await writeCopyParts(owner, [{ post, parts }], [post.id]);
  return copy;
}

/**
 * The day Post again offers first: the first day from `today` on (today
 * included) that holds none of this owner's posts. One call, which also
 * checks the post is this owner's (null when it is not). It looks at the
 * first `RECORDS.rows` days from today that hold posts; when every one of
 * them follows the one before without a gap, the day after the last is
 * offered.
 *
 * @param {unknown} ownerId
 * @param {unknown} postId
 * @param {unknown} today
 * @returns {Promise<{ day: string } | null>}
 */
export async function copyDayFor(ownerId, postId, today) {
  const owner = requireOwner(ownerId);
  if (!isWholeId(postId)) return null;
  if (!isCivilDay(today)) throw new DataError(REQUEST);
  const [post, days] = await modelBatch([
    { model: 'Post', action: 'findFirst', args: { where: { id: postId, ownerId: owner }, select: { id: true } } },
    { model: 'Post', action: 'groupBy', args: { by: ['day'], where: { ownerId: owner, day: { gte: today } }, orderBy: { day: 'asc' }, take: RECORDS.rows } },
  ]);
  if (post === null || post === undefined) return null;
  const taken = new Set(listOf(days).map((row) => row?.day).filter((value) => typeof value === 'string'));
  let day = /** @type {string} */ (today);
  while (taken.has(day)) day = addDays(day, 1);
  return { day };
}

/**
 * The posts Fill my month can bring back: this owner's posts on a day more
 * than `BRING_BACK_AGE` days before `today` that at least one customer named
 * (an enquiry's post), best first: the most customers, then the newer day,
 * then the newer post. A post already brought back (a copy of it with no day,
 * or on a day from `BRING_BACK_AGE` days ago on) is left out. It looks at the
 * `BRING_BACK_LOOK` newest posts customers named. Answers `[{ id, name, day,
 * themeId, customers }]`. Calls: one counts the customers by post, one reads
 * those posts and their copies (none when no customer named a post).
 *
 * @param {unknown} ownerId
 * @param {{ today: unknown }} options
 * @returns {Promise<Array<{ id: number, name: string, day: string, themeId: number | null, customers: number }>>}
 */
export async function bringBackFor(ownerId, { today }) {
  const owner = requireOwner(ownerId);
  if (!isCivilDay(today)) throw new DataError(REQUEST);
  const since = addDays(/** @type {string} */ (today), -BRING_BACK_AGE);
  const named = listOf(await modelAction('Enquiry', 'groupBy', {
    by: ['postId'],
    where: { ownerId: owner, postId: { not: null } },
    _count: { _all: true },
    orderBy: { postId: 'desc' },
    take: BRING_BACK_LOOK,
  }));
  const customers = new Map(named.filter((row) => isWholeId(row?.postId)).map((row) => [row.postId, whole(row?._count?._all)]));
  const ids = [...customers.keys()].filter((id) => customers.get(id) > 0);
  if (ids.length === 0) return [];
  const [posts, copies] = await readPacked([
    readStep('Post', 'findMany', { where: { ownerId: owner, id: { in: ids }, day: { lt: since } }, select: { id: true, name: true, day: true, themeId: true }, orderBy: { id: 'asc' }, take: ids.length }),
    {
      model: 'Post',
      action: 'groupBy',
      args: { by: ['fromPostId'], where: { ownerId: owner, fromPostId: { in: ids }, OR: [{ day: null }, { day: { gte: since } }] }, _count: { _all: true }, orderBy: { fromPostId: 'asc' }, take: ids.length },
      bytes: 2 + ids.length * COUNT_ROW,
    },
  ]);
  const broughtBack = new Set(listOf(copies).map((row) => row?.fromPostId));
  return listOf(posts)
    .filter((row) => isWholeId(row?.id) && isCivilDay(row.day) && !broughtBack.has(row.id))
    .map((row) => ({ id: row.id, name: text(row.name), day: row.day, themeId: wholeOrNull(row.themeId), customers: customers.get(row.id) ?? 0 }))
    .sort((a, b) => b.customers - a.customers || (a.day === b.day ? b.id - a.id : a.day < b.day ? 1 : -1));
}
