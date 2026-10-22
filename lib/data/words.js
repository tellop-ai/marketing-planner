/**
 * Ready words: bios, hashtag sets, links, answers to common messages, offers
 * and signatures the person copies again and again. At most
 * `LIMITS.readyWords` per owner. Every read, save and delete names its owner
 * inside the statement's `where` (`AGENTS.md` rules 1 and 1a); values leave
 * this file as plain objects. A route checks the person's words
 * (`lib/plan/limits.js`) before it calls a save here.
 *
 * ## How much one read takes
 *
 * Inside Tellop a records call answers at most 256 rows a statement and
 * 256 KiB, a statement's answer holds at most 2,048 values (a row counts its
 * fields and two more), and a request makes at most 16 calls. A ready word
 * can hold about 4.7 KB (two bytes a letter), so the list reads `PAGE` a call
 * (about 235 KiB) and reads on, after the last one read, only when a call came
 * back full: at most `LIMITS.readyWords / PAGE` (4) calls. Every other read
 * here is one row.
 */

import { DataError, modelAction } from './index.js';
import { readInPages } from './read-in-pages.js';
import { LIMITS, readWords } from '../plan/limits.js';
import { isNetworkKey } from '../plan/networks.js';

/** The kinds, in the order the Ready words page shows them. */
export const READY_WORD_KINDS = Object.freeze(['bio', 'hashtags', 'link', 'answer', 'offer', 'signature']);

/** Refusal keys this file answers through `DataError`. */
export const WORDS_REFUSALS = Object.freeze({
  limit: 'refuse.words.limit',
});

/** Ready words one records call takes. */
const PAGE = 50;
const FIELDS = Object.freeze(['kind', 'title', 'text', 'network']);
/** Every field a ready word's summary reads (not the owner, which every read names). */
const READY_WORD_SELECT = Object.freeze(Object.fromEntries(['id', 'kind', 'title', 'text', 'network', 'copied', 'position', 'createdAt',
  'updatedAt'].map((field) => [field, true])));

/** @param {unknown} owner */
function ownerOf(owner) {
  if (typeof owner !== 'string' || owner.trim().length === 0) throw new DataError('error.ownerMissing');
  return owner;
}

/** @param {unknown} id */
function idOf(id) {
  const value = Number(id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** @param {{ now?: () => Date }} [options] */
function instantOf(options = {}) {
  return (options.now?.() ?? new Date()).toISOString();
}

/** @param {unknown} kind */
export function isReadyWordKind(kind) {
  return typeof kind === 'string' && READY_WORD_KINDS.includes(kind);
}

/** @param {Record<string, unknown>} row */
function readyWordOf(row) {
  return {
    id: Number(row.id),
    kind: String(row.kind),
    title: String(row.title),
    text: String(row.text),
    network: typeof row.network === 'string' && row.network !== '' ? row.network : null,
    copied: Number(row.copied ?? 0),
    position: Number(row.position),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/**
 * Only the named fields, each of the shape its record takes.
 *
 * @param {Record<string, unknown>} fields
 */
function pick(fields) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const name of FIELDS) {
    if (!Object.hasOwn(fields ?? {}, name) || fields[name] === undefined) continue;
    const value = fields[name];
    if (name === 'network') {
      if (value !== null && !isNetworkKey(value)) throw new DataError('refuse.request');
    } else if (typeof value !== 'string') {
      throw new DataError('refuse.request');
    }
    if (name === 'kind' && !isReadyWordKind(value)) throw new DataError('refuse.request');
    if ((name === 'title' || name === 'text') && value === '') throw new DataError('refuse.text.missing');
    picked[name] = value;
  }
  return picked;
}

/**
 * A ready word's fields as sent to an address, read through
 * `lib/plan/limits.js`: `kind`, `title` (one line, `LIMITS.readyTitle`) and
 * `text` (`LIMITS.readyWord`, line breaks kept), all three required when
 * `creating`, and an optional `network` (a network key, or null). A refusal
 * names its field.
 *
 * @param {Record<string, unknown>} body
 * @param {{ creating?: boolean }} [options]
 * @returns {{ ok: true, fields: Record<string, unknown> } | { ok: false, problem: string, field?: string }}
 */
export function readReadyWordFields(body, { creating = false } = {}) {
  const names = Object.keys(body);
  if (names.some((name) => !FIELDS.includes(name))) return { ok: false, problem: 'refuse.request' };
  if (!creating && names.length === 0) return { ok: false, problem: 'refuse.request' };
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (creating || Object.hasOwn(body, 'kind')) {
    if (!isReadyWordKind(body.kind)) return { ok: false, problem: 'refuse.request', field: 'kind' };
    fields.kind = body.kind;
  }
  if (creating || Object.hasOwn(body, 'title')) {
    const title = readWords(body.title, LIMITS.readyTitle, { required: true });
    if (!title.ok) return { ok: false, problem: title.problem, field: 'title' };
    fields.title = title.value;
  }
  if (creating || Object.hasOwn(body, 'text')) {
    const text = readWords(body.text, LIMITS.readyWord, { required: true, multiline: true });
    if (!text.ok) return { ok: false, problem: text.problem, field: 'text' };
    fields.text = text.value;
  }
  if (Object.hasOwn(body, 'network')) {
    const network = body.network === '' ? null : body.network;
    if (network !== null && !isNetworkKey(network)) return { ok: false, problem: 'refuse.request', field: 'network' };
    fields.network = network;
  }
  return { ok: true, fields };
}

/**
 * The owner's ready words, by position: at most `LIMITS.readyWords`, `PAGE` a
 * call, each call after the last one read and only when the one before came
 * back full. A ready word read twice (moved between two calls) is kept once.
 *
 * @param {unknown} owner
 */
export async function listReadyWordsFor(owner) {
  const ownerId = ownerOf(owner);
  const rows = await readInPages('ReadyWord', {
    where: { ownerId },
    order: [['position', 'asc'], ['id', 'asc']],
    select: READY_WORD_SELECT,
    most: LIMITS.readyWords,
    page: PAGE,
  });
  return rows.map(readyWordOf);
}

/**
 * Adds a ready word last. Refused (`refuse.words.limit`) when the owner
 * already keeps `LIMITS.readyWords`.
 *
 * @param {unknown} owner
 * @param {{ kind: string, title: string, text: string, network?: string | null }} fields
 * @param {{ now?: () => Date }} [options]
 */
export async function addReadyWordFor(owner, fields, options = {}) {
  const ownerId = ownerOf(owner);
  const picked = pick(fields);
  if (picked.kind === undefined || picked.title === undefined || picked.text === undefined) throw new DataError('refuse.request');
  const count = Number(await modelAction('ReadyWord', 'count', { where: { ownerId } }));
  if (count >= LIMITS.readyWords) throw new DataError(WORDS_REFUSALS.limit);
  const last = await modelAction('ReadyWord', 'findFirst', {
    where: { ownerId },
    orderBy: [{ position: 'desc' }, { id: 'desc' }],
    select: { position: true },
  });
  const at = instantOf(options);
  const row = await modelAction('ReadyWord', 'create', {
    data: {
      ownerId,
      kind: picked.kind,
      title: picked.title,
      text: picked.text,
      network: picked.network ?? null,
      copied: 0,
      position: last === null ? 0 : Number(last.position) + 1,
      createdAt: at,
      updatedAt: at,
    },
  });
  return readyWordOf(row);
}

/**
 * One ready word, or null.
 *
 * @param {unknown} owner
 * @param {unknown} id
 */
export async function getReadyWordFor(owner, id) {
  const ownerId = ownerOf(owner);
  const wordId = idOf(id);
  if (wordId === null) return null;
  const row = await modelAction('ReadyWord', 'findFirst', { where: { id: wordId, ownerId } });
  return row === null ? null : readyWordOf(row);
}

/**
 * Changes a ready word's kind, title, words or network; null when the owner has none.
 *
 * @param {unknown} owner
 * @param {unknown} id
 * @param {{ kind?: string, title?: string, text?: string, network?: string | null }} fields
 * @param {{ now?: () => Date }} [options]
 */
export async function updateReadyWordFor(owner, id, fields, options = {}) {
  const ownerId = ownerOf(owner);
  const wordId = idOf(id);
  if (wordId === null) return null;
  const picked = pick(fields);
  if (Object.keys(picked).length > 0) {
    const changed = await modelAction('ReadyWord', 'updateMany', {
      where: { id: wordId, ownerId },
      data: { ...picked, updatedAt: instantOf(options) },
    });
    if (Number(changed.count) === 0) return null;
  }
  return getReadyWordFor(ownerId, wordId);
}

/**
 * @param {unknown} owner
 * @param {unknown} id
 * @returns {Promise<boolean>} whether anything was removed
 */
export async function removeReadyWordFor(owner, id) {
  const ownerId = ownerOf(owner);
  const wordId = idOf(id);
  if (wordId === null) return false;
  const gone = await modelAction('ReadyWord', 'deleteMany', { where: { id: wordId, ownerId } });
  return Number(gone.count) > 0;
}

/**
 * Counts one more copy of a ready word. Answers the new count, or null when
 * the owner has no such ready word.
 *
 * @param {unknown} owner
 * @param {unknown} id
 * @returns {Promise<number | null>}
 */
export async function countCopyFor(owner, id) {
  const ownerId = ownerOf(owner);
  const wordId = idOf(id);
  if (wordId === null) return null;
  const changed = await modelAction('ReadyWord', 'updateMany', {
    where: { id: wordId, ownerId },
    data: { copied: { increment: 1 } },
  });
  if (Number(changed.count) === 0) return null;
  const row = await modelAction('ReadyWord', 'findFirst', { where: { id: wordId, ownerId }, select: { copied: true } });
  return row === null ? null : Number(row.copied);
}

/**
 * The "link in profile" sentence: the words of the owner's first `link` ready
 * word (by position), or `''` when there is none.
 *
 * @param {unknown} owner
 * @returns {Promise<string>}
 */
export async function linkSentenceFor(owner) {
  const ownerId = ownerOf(owner);
  const row = await modelAction('ReadyWord', 'findFirst', {
    where: { ownerId, kind: 'link' },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { text: true },
  });
  return row === null ? '' : String(row.text);
}
