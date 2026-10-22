/**
 * Inspiration notes: links and notes a person saves on the Ideas page because
 * something caught their eye (a link, a note, a theme). Give me ideas sends the
 * newest ones to AI as content (`latestInspirationFor`), and a note can become
 * an idea post (`postFromInspirationFor`).
 *
 * Every read, save and delete names its owner inside the statement's `where`
 * (AGENTS.md rule 1); nothing here saves while reading (rule 4a). What leaves
 * this file is a plain object. The app never opens a note's link: it keeps it
 * as text, and the page shows only its host.
 *
 * Records calls, one after another (never two at once):
 * - `listInspirationFor`: at most 2 (`readInPages`, 50 notes a call: a note
 *   and its link take at most about 2 KB each inside an answer);
 * - `latestInspirationFor`: 1; `addInspirationFor`: at most 3 (the count of
 *   notes kept, the theme, the note);
 * - `updateInspirationFor`: at most 3; `removeInspirationFor`: 1;
 * - `postFromInspirationFor`: at most 4 (the note, its theme, then
 *   `createPostFor`'s 2).
 */

import { clipText, INSPIRATION_NOTE_MOST, INSPIRATION_SENT, oneLine } from '../plan/ai-words.js';
import { LIMITS, readLink, readWords } from '../plan/limits.js';

import { DataError, modelAction } from './index.js';
import { createPostFor, POST_REFUSALS } from './posts.js';
import { readInPages } from './read-in-pages.js';

/** How much a note holds, how many the Ideas page shows, how many Give me ideas sends, and the most one person keeps. */
export const INSPIRATION = Object.freeze({ note: INSPIRATION_NOTE_MOST, shown: 100, sent: INSPIRATION_SENT, most: 500 });

/** The refusals this file adds (the limit readers add `refuse.text.*`, `refuse.link`, `refuse.linkPublic`). */
export const INSPIRATION_REFUSALS = Object.freeze({
  empty: 'refuse.inspiration.empty',
  full: 'refuse.inspiration.full',
  theme: POST_REFUSALS.theme,
  notFound: 'error.notFound',
});

/** Notes one list call reads: 50 of the largest (about 2 KB each) stay far under a call's 256 KB. */
const LIST_PAGE = 50;

const SELECT = Object.freeze({ id: true, link: true, note: true, themeId: true, createdAt: true });

/**
 * A note as it leaves this file: `host` is the link's host as the page shows
 * it (`hostOf`), worked out from the address as text, never by opening it.
 *
 * @typedef {{ id: number, link: string, host: string, note: string, themeId: number | null, createdAt: string }} InspirationNote
 */

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** @param {unknown} value */
function isWholeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * A stored row as a plain note. @param {any} row
 * @returns {InspirationNote}
 */
function noteView(row) {
  const link = typeof row.link === 'string' ? row.link : '';
  return {
    id: Number(row.id),
    link,
    host: hostOf(link),
    note: typeof row.note === 'string' ? row.note : '',
    themeId: typeof row.themeId === 'number' && Number.isSafeInteger(row.themeId) ? row.themeId : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
  };
}

/**
 * What a person sent for a note, read (pure, so a route can answer which
 * field is refused): `link` (empty, or a safe `https:` web address on the
 * internet, `readLink`), `note` (at most `INSPIRATION.note` characters, lines
 * kept) and `themeId` (a theme's id, or null for none; whose theme it is, is
 * checked when saving). With `partial`, a field left out stays as it is.
 * Anything else that is not an object is refused `refuse.request`.
 *
 * @param {unknown} input
 * @param {{ partial?: boolean }} [options]
 * @returns {{ ok: true, fields: { link?: string, note?: string, themeId?: number | null } } | { ok: false, problem: string, field?: string }}
 */
export function readInspirationFields(input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, problem: 'refuse.request' };
  const asked = /** @type {Record<string, unknown>} */ (input);
  /** @type {{ link?: string, note?: string, themeId?: number | null }} */
  const fields = {};
  if (!partial || asked.link !== undefined) {
    const link = readLink(asked.link);
    if (!link.ok) return { ok: false, problem: link.problem, field: 'link' };
    fields.link = link.value;
  }
  if (!partial || asked.note !== undefined) {
    const note = readWords(asked.note, INSPIRATION.note, { multiline: true });
    if (!note.ok) return { ok: false, problem: note.problem, field: 'note' };
    fields.note = note.value;
  }
  if (!partial || asked.themeId !== undefined) {
    const themeId = asked.themeId ?? null;
    if (themeId !== null && !isWholeId(themeId)) return { ok: false, problem: INSPIRATION_REFUSALS.theme, field: 'themeId' };
    fields.themeId = /** @type {number | null} */ (themeId);
  }
  return { ok: true, fields };
}

/** Takes a read's value or throws its refusal (with the field it is about). @param {ReturnType<typeof readInspirationFields>} read */
function fieldsOf(read) {
  if (read.ok) return read.fields;
  const error = new DataError(read.problem);
  if (read.field !== undefined) error.field = read.field;
  throw error;
}

/** A refusal about one field. @param {string} key @param {string} field */
function refusal(key, field) {
  const error = new DataError(key);
  error.field = field;
  return error;
}

/** Refuses a theme that is not one of this owner's themes in use (one call). @param {string} owner @param {number} themeId */
async function requireThemeInUse(owner, themeId) {
  const found = await modelAction('Theme', 'findFirst', { where: { id: themeId, ownerId: owner, archived: false }, select: { id: true } });
  if (found === null || found === undefined) throw refusal(INSPIRATION_REFUSALS.theme, 'themeId');
}

/** One of this owner's notes, or null (one call). @param {string} owner @param {number} id */
async function findNote(owner, id) {
  const row = await modelAction('Inspiration', 'findFirst', { where: { id, ownerId: owner }, select: SELECT });
  return row === null || row === undefined ? null : noteView(row);
}

/**
 * This owner's notes, newest first, at most `INSPIRATION.shown`.
 *
 * @param {unknown} ownerId
 * @returns {Promise<InspirationNote[]>}
 */
export async function listInspirationFor(ownerId) {
  const owner = ownerOf(ownerId);
  const rows = await readInPages('Inspiration', {
    where: { ownerId: owner },
    order: [['createdAt', 'desc'], ['id', 'desc']],
    select: { ...SELECT },
    most: INSPIRATION.shown,
    page: LIST_PAGE,
  });
  return rows.map(noteView);
}

/**
 * The newest notes Give me ideas sends, at most `most` (`INSPIRATION.sent`):
 * for a theme (`themeId`), the notes of that theme and the notes with none;
 * for the business as a whole (null), any note. One call.
 *
 * @param {unknown} ownerId
 * @param {{ themeId?: number | null, most?: number }} [options]
 * @returns {Promise<InspirationNote[]>}
 */
export async function latestInspirationFor(ownerId, { themeId = null, most = INSPIRATION.sent } = {}) {
  const owner = ownerOf(ownerId);
  const take = Math.max(1, Math.min(INSPIRATION.sent, Number.isSafeInteger(most) ? most : INSPIRATION.sent));
  const where = isWholeId(themeId) ? { ownerId: owner, OR: [{ themeId }, { themeId: null }] } : { ownerId: owner };
  const rows = await modelAction('Inspiration', 'findMany', {
    where,
    select: { ...SELECT },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });
  if (!Array.isArray(rows)) throw new DataError('error.storageUnreadable');
  return rows.map(noteView);
}

/**
 * Saves a new note: a link, a note or both (neither is refused
 * `refuse.inspiration.empty`), and a theme of this owner's in use, or none.
 * Refusals carry the field they are about (`field`); past `INSPIRATION.most`
 * notes kept, a new one is refused `refuse.inspiration.full` (no field).
 * At most 3 calls, one after another.
 *
 * @param {unknown} ownerId
 * @param {unknown} input `{ link?, note?, themeId? }`
 * @returns {Promise<InspirationNote>}
 */
export async function addInspirationFor(ownerId, input) {
  const owner = ownerOf(ownerId);
  const fields = fieldsOf(readInspirationFields(input));
  if (fields.link === '' && fields.note === '') throw refusal(INSPIRATION_REFUSALS.empty, 'note');
  const kept = await modelAction('Inspiration', 'count', { where: { ownerId: owner } });
  if (!Number.isSafeInteger(Number(kept))) throw new DataError('error.storageUnreadable');
  if (Number(kept) >= INSPIRATION.most) throw new DataError(INSPIRATION_REFUSALS.full);
  if (fields.themeId !== null) await requireThemeInUse(owner, /** @type {number} */ (fields.themeId));
  const at = new Date().toISOString();
  const created = await modelAction('Inspiration', 'create', {
    data: { ownerId: owner, link: fields.link, note: fields.note, themeId: fields.themeId, createdAt: at, updatedAt: at },
    select: { ...SELECT },
  });
  if (created === null || created === undefined || !isWholeId(created.id)) throw new DataError('error.saveUnconfirmed');
  return noteView(created);
}

/**
 * Changes one of this owner's notes (the fields sent; the others stay). A
 * note left with neither a link nor words is refused
 * `refuse.inspiration.empty`. A theme it already has stays even when that
 * theme is no longer in use; a new theme must be one in use. Null when the
 * note is not this owner's.
 *
 * @param {unknown} ownerId
 * @param {unknown} noteId
 * @param {unknown} input `{ link?, note?, themeId? }`
 * @returns {Promise<InspirationNote | null>}
 */
export async function updateInspirationFor(ownerId, noteId, input) {
  const owner = ownerOf(ownerId);
  const fields = fieldsOf(readInspirationFields(input, { partial: true }));
  if (!isWholeId(noteId)) return null;
  const id = /** @type {number} */ (noteId);
  const stored = await findNote(owner, id);
  if (stored === null) return null;
  const next = { ...stored, ...fields };
  if (next.link === '' && next.note === '') throw refusal(INSPIRATION_REFUSALS.empty, fields.note !== undefined ? 'note' : 'link');
  if (next.themeId !== null && next.themeId !== stored.themeId) await requireThemeInUse(owner, next.themeId);
  const at = new Date().toISOString();
  const changed = await modelAction('Inspiration', 'updateMany', {
    where: { id, ownerId: owner },
    data: { link: next.link, note: next.note, themeId: next.themeId, updatedAt: at },
  });
  if (Number(changed?.count ?? 0) < 1) return null;
  return { id, link: next.link, host: hostOf(next.link), note: next.note, themeId: next.themeId, createdAt: stored.createdAt };
}

/**
 * Removes one of this owner's notes. One call.
 *
 * @param {unknown} ownerId
 * @param {unknown} noteId
 * @returns {Promise<boolean>} whether a note was removed
 */
export async function removeInspirationFor(ownerId, noteId) {
  const owner = ownerOf(ownerId);
  if (!isWholeId(noteId)) return false;
  const removed = await modelAction('Inspiration', 'deleteMany', { where: { id: noteId, ownerId: owner } });
  return Number(removed?.count ?? 0) > 0;
}

/** A link's host as the page shows it (`www.` left out), or '' (pure; never opens the link). @param {unknown} link */
export function hostOf(link) {
  if (typeof link !== 'string' || link === '') return '';
  try {
    return new URL(link).hostname.replace(/^www\./iu, '');
  } catch {
    return '';
  }
}

/**
 * The idea post a note becomes (pure): its name is the note's first line, cut
 * at a word end to `LIMITS.name` (the link's host for a note with no words);
 * its main words are the note, then the link on a line of its own when the
 * note does not already hold it, so Make my post finds it there.
 *
 * @param {{ link: string, note: string }} note
 * @returns {{ name: string, mainText: string }}
 */
export function ideaFromNote({ link, note }) {
  const firstLine = oneLine(note.split('\n').find((line) => line.trim() !== '') ?? '');
  const name = firstLine === '' ? hostOf(link) : clipText(firstLine, LIMITS.name);
  const words = note.trim();
  const mainText = link === '' || words.includes(link) ? words : [words, link].filter((part) => part !== '').join('\n\n');
  return { name, mainText };
}

/**
 * Make it a post idea: a new post with no day from one of this owner's notes
 * (`ideaFromNote`), made by the person, in the note's theme when that theme is
 * still in use (else in none). The note stays. Answers the post as
 * `createPostFor` does, or null when the note is not this owner's.
 *
 * @param {unknown} ownerId
 * @param {unknown} noteId
 */
export async function postFromInspirationFor(ownerId, noteId) {
  const owner = ownerOf(ownerId);
  if (!isWholeId(noteId)) return null;
  const stored = await findNote(owner, /** @type {number} */ (noteId));
  if (stored === null) return null;
  let themeId = null;
  if (stored.themeId !== null) {
    const found = await modelAction('Theme', 'findFirst', { where: { id: stored.themeId, ownerId: owner, archived: false }, select: { id: true } });
    if (found !== null && found !== undefined) themeId = stored.themeId;
  }
  const { name, mainText } = ideaFromNote(stored);
  return createPostFor(owner, { name, mainText, themeId });
}
