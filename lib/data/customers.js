/**
 * Customers: the people who came (`Enquiry`) and what customers said
 * (`CustomerComment`). Every read, save and delete names its owner inside the
 * statement's `where` (AGENTS.md rule 1a); nothing here saves while reading
 * (rule 4a). What leaves this file is a plain object.
 *
 * The person's words are checked here, before anything is saved, and a
 * refusal is a `DataError` whose `messageKey` the page shows
 * (`refuse.customers.*`). `contact` and the notes are free text: no check of a
 * phone number's or a mail address's shape.
 *
 * A comment's screenshot is the person's own picture (rule 6c): the page keeps
 * it with `appendPicture` and sends only its digest; `readPicture` checks that
 * digest names a kept picture, and the record keeps it in `screenshotFile`. A
 * summary carries only a short tag of it (a cache key for its address), never
 * the digest itself.
 *
 * ## How much one read takes
 *
 * Inside Tellop a records call answers at most 256 rows a statement and
 * 256 KiB (a `modelBatch` counted whole), a statement's answer holds at most
 * 2,048 values (a row counts its fields and two more), an `in` list names at
 * most 256 values, and a request makes at most 16 calls. So a list read takes
 * `PAGE` rows a call, sized so a full call of the longest words (two bytes a
 * letter, as Turkish letters take) stays near 90% of 256 KiB, and reads on,
 * after the last row read, only when a call came back full. Reads that depend
 * only on known ids go together in one `modelBatch`. A month's enquiries and
 * the comments are lists that page: each read answers `{ items, next }`, at
 * most `LIST_PAGE` items, and `next` (an opaque text, or null when nothing
 * is left) starts the next page ("Show more"). The most calls: a page of
 * enquiries 3, a page of comments 3, `MOST_ROWS` enquiries 14, the post
 * choices 1, the post names 1 for every 1,280 posts, the posts that brought
 * customers 1, the month's totals 1. The spreadsheet file makes at most 15.
 */

import { readPicture } from './files.js';
import { DataError, modelAction, modelBatch } from './index.js';
import { readInPages } from './read-in-pages.js';
import { SHAPE_KEYS, SHAPES } from '../plan/shapes.js';
import { LIMITS, readCount, readWords } from '../plan/limits.js';
import { addMonths, isCivilDay, isCivilMonth, todayCivil } from '../plan/days.js';
import { isChannel, isEnquiryStatus, isPermission, isSource } from '../plan/customer-choices.js';

/**
 * Rows one records call takes: a full call of enquiries or comments with the
 * longest words is about 220 KiB; `ids` is the most values one `in` list names.
 */
const PAGE = Object.freeze({ enquiries: 50, comments: 36, ids: 256 });
/** Reads of post names (`PAGE.ids` posts each) that go together in one call: about 240 KiB with the longest names. */
const NAME_READS_A_CALL = 5;

/** Most enquiries one list read answers (the spreadsheet file's); 14 calls. */
export const MOST_ROWS = 700;
/** Enquiries a span read answers when the caller names no number; 4 calls. */
export const LIST_ROWS = 200;
/** Items one page of a month's enquiries or of the comments holds ("Show more" reads the next); 3 calls with the one read past it. */
export const LIST_PAGE = 100;
/** Most posts one "which posts brought customers" read asks about; 1 call. */
export const MOST_POST_IDS = 2000;
/** Most posts the "post that brought them" choice lists; 1 call. */
export const MOST_CHOICES = PAGE.ids;

export const CUSTOMER_REFUSALS = Object.freeze({
  name: 'refuse.customers.name',
  contact: 'refuse.customers.contact',
  askedAbout: 'refuse.customers.askedAbout',
  notes: 'refuse.customers.notes',
  channel: 'refuse.customers.channel',
  status: 'refuse.customers.status',
  amount: 'refuse.customers.amount',
  day: 'refuse.customers.day',
  post: 'refuse.customers.post',
  month: 'refuse.customers.month',
  span: 'refuse.customers.span',
  commentName: 'refuse.customers.commentName',
  comment: 'refuse.customers.comment',
  bestLine: 'refuse.customers.bestLine',
  stars: 'refuse.customers.stars',
  source: 'refuse.customers.source',
  permission: 'refuse.customers.permission',
  permissionNote: 'refuse.customers.permissionNote',
  screenshot: 'refuse.customers.screenshot',
  followUpOn: 'refuse.customers.followUpOn',
  code: 'refuse.customers.code',
});

/** An offer code (an enquiry's, a campaign's): 2 to 24 letters or digits, any alphabet, nothing else. */
export const OFFER_CODE = /^[\p{L}\p{N}]{2,24}$/u;

/**
 * An offer code as the person typed it, trimmed: `''` (or null) for none,
 * else 2 to 24 letters or digits (`OFFER_CODE`). One reader for every code.
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false }}
 */
export function readOfferCode(value) {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false };
  const code = value.trim();
  if (code === '') return { ok: true, value: '' };
  return OFFER_CODE.test(code) ? { ok: true, value: code } : { ok: false };
}

/** Most enquiries the Today card lists as due for a follow-up. */
export const FOLLOW_UPS_MOST = 20;
/** The statuses a follow-up is still due for: a person who has not bought or said not now. */
export const FOLLOW_UP_STATUSES = Object.freeze(['new', 'talking']);

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** A record id from a route or a caller: a whole number above 0, else null. @param {unknown} value */
export function recordId(value) {
  const number = typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** The rows a caller asked for: a whole number from 1 to `most`, else `fallback`. @param {unknown} take */
function rowsOf(take, most = MOST_ROWS, fallback = LIST_ROWS) {
  return typeof take === 'number' && Number.isSafeInteger(take) && take > 0 ? Math.min(take, most) : fallback;
}

/** @template T @param {T[]} items @param {number} size @returns {T[][]} */
function groupsOf(items, size) {
  const groups = [];
  for (let start = 0; start < items.length; start += size) groups.push(items.slice(start, start + size));
  return groups;
}

/** Reads that depend only on known ids, in one call. @param {{ model: string, action: string, args: object }[]} steps */
async function readTogether(steps) {
  return steps.length === 1 ? [await modelAction(steps[0].model, steps[0].action, steps[0].args)] : modelBatch(steps);
}

/** The first day of `month` and the first day of the month after: `from <= day < until`. @param {string} month */
export function monthSpan(month) {
  if (!isCivilMonth(month)) throw new DataError(CUSTOMER_REFUSALS.month);
  return { from: `${month}-01`, until: `${addMonths(month, 1)}-01` };
}

/**
 * Words through `readWords`, with this area's refusal key in place of the
 * generic one, so the page can say which field to fix.
 */
function words(value, max, key, options) {
  const read = readWords(value, max, options);
  if (!read.ok) throw new DataError(key);
  return read.value;
}

/** A civil day, or today when none was sent and `fallback` is set. */
function dayOf(value, today) {
  if ((value === undefined || value === null || value === '') && today !== undefined) return today;
  if (!isCivilDay(value)) throw new DataError(CUSTOMER_REFUSALS.day);
  return value;
}

/** @param {Record<string, unknown>} input @param {string} name */
const sent = (input, name) => Object.hasOwn(input, name) && input[name] !== undefined;

/** Where a page starts: the last item's day and id, as `next` writes them. */
const CURSOR = /^([0-9]{4}-[0-9]{2}-[0-9]{2})\.([1-9][0-9]{0,14})$/u;

/**
 * The row a page starts after, from the `next` a page answered, or null for
 * the first page. Anything else is refused (`refuse.request`).
 *
 * @param {unknown} after
 * @returns {{ receivedOn: string, id: number } | null}
 */
function cursorOf(after) {
  if (after === undefined || after === null || after === '') return null;
  const match = typeof after === 'string' ? CURSOR.exec(after) : null;
  if (match === null || !isCivilDay(match[1])) throw new DataError('refuse.request');
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id)) throw new DataError('refuse.request');
  return { receivedOn: match[1], id };
}

/**
 * One page of rows matching `where`, newest day first and, on one day, the
 * newest first: at most `size` items, read with one row more so `next` is
 * null exactly when nothing is left.
 *
 * @param {string} model
 * @param {Record<string, unknown>} where
 * @param {Record<string, boolean>} select
 * @param {{ after?: unknown, size: number, page: number }} options
 */
async function readPage(model, where, select, { after, size, page }) {
  const rows = await readInPages(model, { where, order: [['receivedOn', 'desc'], ['id', 'desc']], select, most: size + 1, page, after: cursorOf(after) });
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, next: rows.length > size && last !== undefined ? `${last.receivedOn}.${last.id}` : null };
}

/** How many items a page holds: `take` from 1 to `LIST_PAGE`, else `LIST_PAGE`. @param {unknown} take */
function pageSize(take) {
  return rowsOf(take, LIST_PAGE, LIST_PAGE);
}

/* ----------------------------------------------------------------------------
 * Enquiries: the people who came
 * ------------------------------------------------------------------------- */

/**
 * @typedef {{ id: number, name: string, contact: string, channel: string, postId: number | null,
 *   askedAbout: string, status: string, amount: number | null, receivedOn: string, notes: string,
 *   createdAt: string, updatedAt: string, followUpOn: string | null, code: string }} Enquiry
 */

/** Every field an enquiry's summary reads (not the owner, which every read names). */
const ENQUIRY_SELECT = Object.freeze(Object.fromEntries(['id', 'name', 'contact', 'channel', 'postId', 'askedAbout', 'status',
  'amount', 'receivedOn', 'notes', 'createdAt', 'updatedAt', 'followUpOn', 'code'].map((field) => [field, true])));

/** @returns {Enquiry} */
function enquiryOf(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    contact: String(row.contact ?? ''),
    channel: String(row.channel ?? 'other'),
    postId: row.postId === null || row.postId === undefined ? null : Number(row.postId),
    askedAbout: String(row.askedAbout ?? ''),
    status: String(row.status ?? 'new'),
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    receivedOn: String(row.receivedOn),
    notes: String(row.notes ?? ''),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    // Fields added later are null on enquiries kept before them: null reads as none.
    followUpOn: typeof row.followUpOn === 'string' && isCivilDay(row.followUpOn) ? row.followUpOn : null,
    code: typeof row.code === 'string' ? row.code : '',
  };
}

/**
 * The fields an enquiry form sent, checked. A new enquiry needs a name; the
 * day is today, the channel `other` and the status `new` when not sent. A
 * change reads only the fields it was sent. `followUpOn` is a civil day or
 * none (`null` or `''`; `refuse.customers.followUpOn`); `code` is an offer
 * code (`readOfferCode`; `refuse.customers.code`).
 *
 * @param {Record<string, unknown>} input
 * @param {{ partial: boolean, today?: string }} options
 */
export function readEnquiryFields(input, { partial, today }) {
  const source = input !== null && typeof input === 'object' ? input : {};
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (!partial || sent(source, 'name')) fields.name = words(source.name, LIMITS.name, CUSTOMER_REFUSALS.name, { required: true });
  if (!partial || sent(source, 'contact')) fields.contact = words(source.contact, LIMITS.profileField, CUSTOMER_REFUSALS.contact);
  if (!partial || sent(source, 'askedAbout')) fields.askedAbout = words(source.askedAbout, LIMITS.profileField, CUSTOMER_REFUSALS.askedAbout);
  if (!partial || sent(source, 'notes')) fields.notes = words(source.notes, LIMITS.notes, CUSTOMER_REFUSALS.notes, { multiline: true });
  if (!partial || sent(source, 'channel')) {
    const channel = source.channel === undefined || source.channel === null || source.channel === '' ? (partial ? undefined : 'other') : source.channel;
    if (!isChannel(channel)) throw new DataError(CUSTOMER_REFUSALS.channel);
    fields.channel = channel;
  }
  if (!partial || sent(source, 'status')) {
    const status = source.status === undefined || source.status === null || source.status === '' ? (partial ? undefined : 'new') : source.status;
    if (!isEnquiryStatus(status)) throw new DataError(CUSTOMER_REFUSALS.status);
    fields.status = status;
  }
  if (!partial || sent(source, 'amount')) {
    const amount = readCount(source.amount, LIMITS.amount);
    if (!amount.ok) throw new DataError(CUSTOMER_REFUSALS.amount);
    fields.amount = amount.value;
  }
  if (!partial || sent(source, 'receivedOn')) fields.receivedOn = dayOf(source.receivedOn, partial ? undefined : (today ?? todayCivil()));
  if (!partial || sent(source, 'postId')) {
    if (source.postId === undefined || source.postId === null || source.postId === '') fields.postId = null;
    else {
      const postId = recordId(source.postId);
      if (postId === null) throw new DataError(CUSTOMER_REFUSALS.post);
      fields.postId = postId;
    }
  }
  if (!partial || sent(source, 'followUpOn')) {
    const day = source.followUpOn;
    if (day === undefined || day === null || day === '') fields.followUpOn = null;
    else if (isCivilDay(day)) fields.followUpOn = day;
    else throw new DataError(CUSTOMER_REFUSALS.followUpOn);
  }
  if (!partial || sent(source, 'code')) {
    const code = readOfferCode(source.code);
    if (!code.ok) throw new DataError(CUSTOMER_REFUSALS.code);
    fields.code = code.value;
  }
  return fields;
}

/** Refuses a post that is not this owner's. */
async function requireOwnPost(owner, postId) {
  if (postId === null || postId === undefined) return;
  const count = await modelAction('Post', 'count', { where: { id: postId, ownerId: owner } });
  if (Number(count) < 1) throw new DataError(CUSTOMER_REFUSALS.post);
}

/**
 * @param {string} ownerId
 * @param {Record<string, unknown>} input
 * @param {{ now?: () => Date, today?: string }} [options]
 * @returns {Promise<Enquiry>}
 */
export async function addEnquiryFor(ownerId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const at = (options.now?.() ?? new Date()).toISOString();
  const fields = readEnquiryFields(input, { partial: false, today: options.today });
  await requireOwnPost(owner, fields.postId);
  const created = await modelAction('Enquiry', 'create', { data: { ...fields, ownerId: owner, createdAt: at, updatedAt: at } });
  return enquiryOf(created);
}

/** @returns {Promise<Enquiry | null>} */
export async function getEnquiryFor(ownerId, enquiryId) {
  const owner = ownerOf(ownerId);
  const id = recordId(enquiryId);
  if (id === null) return null;
  const found = await modelAction('Enquiry', 'findFirst', { where: { id, ownerId: owner } });
  return found ? enquiryOf(found) : null;
}

/**
 * The enquiries due for a follow-up on `today` (the calendar's Today card):
 * still new or talking, with a follow-up day on or before `today`, the oldest
 * follow-up first (then the oldest enquiry), at most `FOLLOW_UPS_MOST`, with
 * the fields the card shows (no notes), and one more when more are due: the
 * card shows `FOLLOW_UPS_MOST` and says the rest are in Customers. One call.
 *
 * @param {string} ownerId
 * @param {unknown} today a civil day
 * @returns {Promise<Array<{ id: number, name: string, contact: string, channel: string, postId: number | null, askedAbout: string,
 *   status: string, receivedOn: string, followUpOn: string, code: string }>>}
 */
export async function listFollowUpsDueFor(ownerId, today) {
  const owner = ownerOf(ownerId);
  if (!isCivilDay(today)) throw new DataError('refuse.request');
  const rows = await modelAction('Enquiry', 'findMany', {
    where: { ownerId: owner, status: { in: [...FOLLOW_UP_STATUSES] }, followUpOn: { not: null, lte: today } },
    orderBy: [{ followUpOn: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, contact: true, channel: true, postId: true, askedAbout: true, status: true, receivedOn: true, followUpOn: true, code: true },
    take: FOLLOW_UPS_MOST + 1,
  });
  if (!Array.isArray(rows)) throw new DataError('error.storageUnreadable');
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    contact: String(row.contact ?? ''),
    channel: String(row.channel ?? 'other'),
    postId: row.postId === null || row.postId === undefined ? null : Number(row.postId),
    askedAbout: String(row.askedAbout ?? ''),
    status: String(row.status ?? 'new'),
    receivedOn: String(row.receivedOn),
    followUpOn: String(row.followUpOn),
    code: typeof row.code === 'string' ? row.code : '',
  }));
}

/**
 * Changes the fields sent; null when this owner has no such enquiry.
 *
 * @returns {Promise<Enquiry | null>}
 */
export async function updateEnquiryFor(ownerId, enquiryId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const id = recordId(enquiryId);
  if (id === null) return null;
  const fields = readEnquiryFields(input, { partial: true });
  if (fields.postId !== undefined) await requireOwnPost(owner, fields.postId);
  const at = (options.now?.() ?? new Date()).toISOString();
  const changed = await modelAction('Enquiry', 'updateMany', { where: { id, ownerId: owner }, data: { ...fields, updatedAt: at } });
  if (Number(changed?.count ?? 0) < 1) return null;
  return getEnquiryFor(owner, id);
}

/** @returns {Promise<boolean>} whether anything was removed */
export async function removeEnquiryFor(ownerId, enquiryId) {
  const owner = ownerOf(ownerId);
  const id = recordId(enquiryId);
  if (id === null) return false;
  const removed = await modelAction('Enquiry', 'deleteMany', { where: { id, ownerId: owner } });
  return Number(removed?.count ?? 0) > 0;
}

/** Enquiries matching `where`, newest day first and, on one day, the newest first. */
async function readEnquiries(where, take) {
  const rows = await readInPages('Enquiry', { where, order: [['receivedOn', 'desc'], ['id', 'desc']], select: ENQUIRY_SELECT,
    most: rowsOf(take), page: PAGE.enquiries });
  return rows.map(enquiryOf);
}

/**
 * Enquiries from `from` to `to`, both days included, newest first: at most
 * `take` (up to `MOST_ROWS`, `LIST_ROWS` when not named).
 *
 * @param {string} ownerId @param {string} from @param {string} to
 * @param {{ take?: number }} [options]
 * @returns {Promise<Enquiry[]>}
 */
export async function listEnquiriesBetweenFor(ownerId, from, to, { take } = {}) {
  const owner = ownerOf(ownerId);
  if (!isCivilDay(from) || !isCivilDay(to) || from > to) throw new DataError(CUSTOMER_REFUSALS.span);
  return readEnquiries({ ownerId: owner, receivedOn: { gte: from, lte: to } }, take);
}

/**
 * One page of a month's (`YYYY-MM`) enquiries, newest first: `{ items, next }`,
 * at most `take` items (up to `LIST_PAGE`, which is also the number when none
 * is named); `next` starts the page after (`after`), null when none is left.
 * A cursor that is not one is refused (`refuse.request`).
 *
 * @param {string} ownerId
 * @param {string} month
 * @param {{ after?: unknown, take?: number }} [options]
 * @returns {Promise<{ items: Enquiry[], next: string | null }>}
 */
export async function listEnquiriesFor(ownerId, month, { after, take } = {}) {
  const owner = ownerOf(ownerId);
  const { from, until } = monthSpan(month);
  const page = await readPage('Enquiry', { ownerId: owner, receivedOn: { gte: from, lt: until } }, ENQUIRY_SELECT, { after, size: pageSize(take), page: PAGE.enquiries });
  return { items: page.items.map(enquiryOf), next: page.next };
}

/**
 * The month's totals in one read: how many came, how many bought, what those
 * who bought paid (whole money units; an empty amount counts as 0), and how
 * many came from each place.
 *
 * @returns {Promise<{ count: number, bought: number, amount: number, byChannel: Record<string, number> }>}
 */
export async function enquiryTotalsFor(ownerId, month) {
  const owner = ownerOf(ownerId);
  const { from, until } = monthSpan(month);
  const groups = await modelAction('Enquiry', 'groupBy', {
    by: ['channel', 'status'],
    where: { ownerId: owner, receivedOn: { gte: from, lt: until } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const totals = { count: 0, bought: 0, amount: 0, byChannel: /** @type {Record<string, number>} */ ({}) };
  for (const group of groups) {
    const count = Number(group?._count?._all ?? 0);
    const channel = String(group.channel);
    totals.count += count;
    totals.byChannel[channel] = (totals.byChannel[channel] ?? 0) + count;
    if (group.status === 'bought') {
      totals.bought += count;
      totals.amount += Number(group?._sum?.amount ?? 0);
    }
  }
  return totals;
}

/**
 * How many enquiries name each of these posts: `{ [postId]: count }`, only for
 * posts with at least one; with `month` (`YYYY-MM`), only that month's
 * enquiries (as the month's totals count them).
 *
 * @param {string} ownerId @param {unknown[]} postIds @param {{ month?: string }} [options]
 * @returns {Promise<Record<number, number>>}
 */
export async function enquiriesByPostFor(ownerId, postIds, { month } = {}) {
  const owner = ownerOf(ownerId);
  const span = month === undefined ? null : monthSpan(month);
  const ids = [...new Set((Array.isArray(postIds) ? postIds : []).map(recordId).filter((id) => id !== null))];
  if (ids.length === 0) return {};
  if (ids.length > MOST_POST_IDS) throw new DataError('refuse.long');
  /** @type {Record<number, number>} */
  const counts = {};
  // One call: a count for each group of PAGE.ids posts (at most eight groups), read together.
  const answers = await readTogether(groupsOf(ids, PAGE.ids).map((group) => ({
    model: 'Enquiry',
    action: 'groupBy',
    args: { by: ['postId'], where: { ownerId: owner, postId: { in: group }, ...(span === null ? {} : { receivedOn: { gte: span.from, lt: span.until } }) }, _count: { _all: true } },
  })));
  for (const groups of answers) {
    for (const group of groups) {
      if (group.postId === null || group.postId === undefined) continue;
      counts[Number(group.postId)] = Number(group?._count?._all ?? 0);
    }
  }
  return counts;
}

/**
 * The posts an enquiry can name: this owner's posts with a day from `from` to
 * `to`, newest day first, as `{ id, name, day }`; at most `take` (up to
 * `MOST_CHOICES`, one call).
 *
 * @returns {Promise<{ id: number, name: string, day: string }[]>}
 */
export async function postChoicesFor(ownerId, from, to, { take = 100 } = {}) {
  const owner = ownerOf(ownerId);
  if (!isCivilDay(from) || !isCivilDay(to) || from > to) throw new DataError(CUSTOMER_REFUSALS.span);
  const found = await modelAction('Post', 'findMany', {
    where: { ownerId: owner, day: { gte: from, lte: to } },
    orderBy: [{ day: 'desc' }, { id: 'desc' }],
    take: rowsOf(take, MOST_CHOICES, 100),
    select: { id: true, name: true, day: true },
  });
  return found.map((row) => ({ id: Number(row.id), name: String(row.name), day: String(row.day) }));
}

/**
 * The names of these posts (the first `MOST_POST_IDS` named), this owner's
 * only: `{ [postId]: name }`. One call for every 1,280 posts.
 *
 * @returns {Promise<Record<number, string>>}
 */
export async function postNamesFor(ownerId, postIds) {
  const owner = ownerOf(ownerId);
  const ids = [...new Set((Array.isArray(postIds) ? postIds : []).map(recordId).filter((id) => id !== null))];
  if (ids.length === 0) return {};
  const reads = groupsOf(ids.slice(0, MOST_POST_IDS), PAGE.ids).map((group) => ({
    model: 'Post',
    action: 'findMany',
    args: { where: { ownerId: owner, id: { in: group } }, select: { id: true, name: true }, take: group.length },
  }));
  /** @type {Record<number, string>} */
  const names = {};
  for (const together of groupsOf(reads, NAME_READS_A_CALL)) {
    for (const found of await readTogether(together)) {
      for (const row of found) names[Number(row.id)] = String(row.name);
    }
  }
  return names;
}

/* ----------------------------------------------------------------------------
 * Comments: what customers said
 * ------------------------------------------------------------------------- */

/**
 * @typedef {{ id: number, name: string, text: string, bestLine: string, stars: number | null,
 *   source: string, receivedOn: string, permission: string, permissionNote: string,
 *   screenshot: string | null, createdAt: string, updatedAt: string }} Comment
 */

/** @returns {Comment} */
function commentOf(row) {
  const file = typeof row.screenshotFile === 'string' && row.screenshotFile !== '' ? row.screenshotFile : null;
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    text: String(row.text),
    bestLine: String(row.bestLine ?? ''),
    stars: row.stars === null || row.stars === undefined ? null : Number(row.stars),
    source: String(row.source ?? 'other'),
    receivedOn: String(row.receivedOn),
    permission: String(row.permission ?? 'not-asked'),
    permissionNote: String(row.permissionNote ?? ''),
    screenshot: file === null ? null : file.slice(0, 12),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/** Stars: 1 to 5, or none. @param {unknown} value */
function starsOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) throw new DataError(CUSTOMER_REFUSALS.stars);
  return value;
}

/**
 * The fields a comment form sent, checked (the screenshot apart). A new
 * comment needs its words; the day is today, the source `other` and the
 * permission `not-asked` when not sent.
 *
 * @param {Record<string, unknown>} input
 * @param {{ partial: boolean, today?: string }} options
 */
export function readCommentFields(input, { partial, today }) {
  const source = input !== null && typeof input === 'object' ? input : {};
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (!partial || sent(source, 'name')) fields.name = words(source.name, LIMITS.name, CUSTOMER_REFUSALS.commentName);
  if (!partial || sent(source, 'text')) fields.text = words(source.text, LIMITS.comment, CUSTOMER_REFUSALS.comment, { required: true, multiline: true });
  if (!partial || sent(source, 'bestLine')) fields.bestLine = words(source.bestLine, LIMITS.bestLine, CUSTOMER_REFUSALS.bestLine);
  if (!partial || sent(source, 'permissionNote')) fields.permissionNote = words(source.permissionNote, LIMITS.profileField, CUSTOMER_REFUSALS.permissionNote);
  if (!partial || sent(source, 'stars')) fields.stars = starsOf(source.stars);
  if (!partial || sent(source, 'source')) {
    const from = source.source === undefined || source.source === null || source.source === '' ? (partial ? undefined : 'other') : source.source;
    if (!isSource(from)) throw new DataError(CUSTOMER_REFUSALS.source);
    fields.source = from;
  }
  if (!partial || sent(source, 'permission')) {
    const permission = source.permission === undefined || source.permission === null || source.permission === '' ? (partial ? undefined : 'not-asked') : source.permission;
    if (!isPermission(permission)) throw new DataError(CUSTOMER_REFUSALS.permission);
    fields.permission = permission;
  }
  if (!partial || sent(source, 'receivedOn')) fields.receivedOn = dayOf(source.receivedOn, partial ? undefined : (today ?? todayCivil()));
  return fields;
}

/**
 * What the form asked for the screenshot: keep it (nothing sent), remove it
 * (`'remove'`, sent only after a press on Remove) or replace it with the kept
 * picture this digest names. A digest that names no kept picture is refused.
 *
 * @param {unknown} value
 * @returns {Promise<{ change: 'keep' } | { change: 'remove' } | { change: 'replace', file: string }>}
 */
async function screenshotChange(value) {
  if (value === undefined || value === null || value === '') return { change: 'keep' };
  if (typeof value !== 'string') throw new DataError(CUSTOMER_REFUSALS.screenshot);
  const form = new FormData();
  form.set('screenshot', value);
  const read = await readPicture(form, 'screenshot');
  if (read.problem) throw new DataError(read.problem);
  if (read.change === 'replace') return { change: 'replace', file: read.file };
  return { change: read.change };
}

/**
 * @param {string} ownerId
 * @param {Record<string, unknown>} input the fields and `screenshot` (a digest from `appendPicture`)
 * @param {{ now?: () => Date, today?: string }} [options]
 * @returns {Promise<Comment>}
 */
export async function addCommentFor(ownerId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const fields = readCommentFields(input, { partial: false, today: options.today });
  const picture = await screenshotChange(input?.screenshot);
  const at = (options.now?.() ?? new Date()).toISOString();
  const created = await modelAction('CustomerComment', 'create', {
    data: { ...fields, screenshotFile: picture.change === 'replace' ? picture.file : null, ownerId: owner, createdAt: at, updatedAt: at },
  });
  return commentOf(created);
}

/** @returns {Promise<Comment | null>} */
export async function getCommentFor(ownerId, commentId) {
  const owner = ownerOf(ownerId);
  const id = recordId(commentId);
  if (id === null) return null;
  const found = await modelAction('CustomerComment', 'findFirst', { where: { id, ownerId: owner } });
  return found ? commentOf(found) : null;
}

/** The kept screenshot's digest, for the address that shows it; null when there is none. */
export async function screenshotFileFor(ownerId, commentId) {
  const owner = ownerOf(ownerId);
  const id = recordId(commentId);
  if (id === null) return null;
  const found = await modelAction('CustomerComment', 'findFirst', { where: { id, ownerId: owner }, select: { screenshotFile: true } });
  return typeof found?.screenshotFile === 'string' && found.screenshotFile !== '' ? found.screenshotFile : null;
}

/** The fields of a comment a card picture is drawn from. */
const CARD_FIELDS = Object.freeze(['name', 'text', 'bestLine', 'stars']);

/**
 * The step that clears the kept shape copies of every card picture drawn from
 * this comment: the copies carry the customer's words, so they go when the
 * words change, when the permission is no longer yes and when the comment
 * goes. The maker draws them again from the comment while it may be shared.
 *
 * @param {string} owner @param {number} commentId
 */
function clearCardCopiesStep(owner, commentId) {
  return {
    model: 'PostPicture',
    action: 'updateMany',
    args: { where: { ownerId: owner, source: 'card', commentId }, data: Object.fromEntries(SHAPE_KEYS.map((key) => [SHAPES[key].field, null])) },
  };
}

/**
 * Changes the fields sent; the screenshot changes only when the form says so.
 * When the permission sent is not yes, or any of the words a card shows
 * (name, words, best line, stars) is sent, the same call clears the kept
 * copies of the card pictures drawn from this comment (`clearCardCopiesStep`).
 * Null when this owner has no such comment.
 *
 * @returns {Promise<Comment | null>}
 */
export async function updateCommentFor(ownerId, commentId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const id = recordId(commentId);
  if (id === null) return null;
  const fields = readCommentFields(input, { partial: true });
  const picture = await screenshotChange(input?.screenshot);
  if (picture.change === 'replace') fields.screenshotFile = picture.file;
  if (picture.change === 'remove') fields.screenshotFile = null;
  const at = (options.now?.() ?? new Date()).toISOString();
  const clears = (fields.permission !== undefined && fields.permission !== 'yes') || CARD_FIELDS.some((name) => fields[name] !== undefined);
  const [changed] = await modelBatch([
    { model: 'CustomerComment', action: 'updateMany', args: { where: { id, ownerId: owner }, data: { ...fields, updatedAt: at } } },
    ...(clears ? [clearCardCopiesStep(owner, id)] : []),
  ]);
  if (Number(changed?.count ?? 0) < 1) return null;
  return getCommentFor(owner, id);
}

/**
 * Removes a comment and, in the same call, the kept copies of the card
 * pictures drawn from it. A post picture made from it stays a picture (the
 * card keeps its `commentId`, which then names nothing, and shows no words).
 *
 * @returns {Promise<boolean>}
 */
export async function removeCommentFor(ownerId, commentId) {
  const owner = ownerOf(ownerId);
  const id = recordId(commentId);
  if (id === null) return false;
  const [removed] = await modelBatch([
    { model: 'CustomerComment', action: 'deleteMany', args: { where: { id, ownerId: owner } } },
    clearCardCopiesStep(owner, id),
  ]);
  return Number(removed?.count ?? 0) > 0;
}

/** Every field a comment's summary reads (not the owner, which every read names). */
const COMMENT_SELECT = Object.freeze(Object.fromEntries(['id', 'name', 'text', 'bestLine', 'stars', 'source', 'receivedOn',
  'permission', 'permissionNote', 'screenshotFile', 'createdAt', 'updatedAt'].map((field) => [field, true])));

/**
 * One page of comments, newest day first and, on one day, the newest first:
 * `{ items, next }`, at most `take` items (up to `LIST_PAGE`, which is also
 * the number when none is named); `next` starts the page after (`after`),
 * null when none is left. A cursor that is not one is refused
 * (`refuse.request`).
 *
 * @param {string} ownerId
 * @param {{ after?: unknown, take?: number }} [options]
 * @returns {Promise<{ items: Comment[], next: string | null }>}
 */
export async function listCommentsFor(ownerId, { after, take } = {}) {
  const owner = ownerOf(ownerId);
  const page = await readPage('CustomerComment', { ownerId: owner }, COMMENT_SELECT, { after, size: pageSize(take), page: PAGE.comments });
  return { items: page.items.map(commentOf), next: page.next };
}
