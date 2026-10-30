/**
 * A person's own files: a photo on a memory, a voice note, a document. Every
 * file a person adds while using this app is kept here, whole, exactly as it
 * arrived, and a record names it by its digest. `AGENTS.md` rule 6c says how a
 * screen uses this; this file is the server's half, and it trusts nothing the
 * browser says.
 *
 * ## Where a file is kept
 *
 *  - **Inside Tellop**, Tellop keeps it in this app's own folder of files on
 *    the person's computer, outside the project, and this process only ever
 *    learns its digest, its size and its kind. There is no size limit here;
 *    the only bound is free room on the computer.
 *  - **Outside Tellop** (an exported copy run on its own), the same functions
 *    keep it in `.data/files/` beside the app's records, one file named by its
 *    digest, so the same code works with no setup.
 *
 * ## A record names a file by its digest, and only by its digest
 *
 * `keepFile(request)` answers `{ file, size, kind, shows }`, where `file` is the
 * digest: 64 lowercase hexadecimal characters, the SHA-256 of the bytes. A
 * record keeps exactly that text in a field of its own whose name ends in
 * `File` (or is `file`), such as `photoFile String?` or `voiceNoteFile String?`:
 * no address, no prefix, no name. Tellop finds a record's files through that
 * convention (to carry them, to export them), so a file named any other way is
 * a file Tellop cannot find. Never keep a file's bytes in a record: the records
 * route refuses one value over 48 KB, and a photo is far larger.
 *
 * ## Never held whole
 *
 * The browser sends a file on requests of its own (`sendFile` in
 * `lib/send-file.js`), and `keepFile` passes each request's body on a piece at
 * a time. Never `request.formData()` or `request.arrayBuffer()` for a file:
 * either one holds the whole file in this app's memory, and a video or a long
 * recording is bigger than that memory. A body that ends shorter than its
 * request said was cut on the way (a proxy in front of the route passes on only
 * its first part), and it is refused rather than kept as the file.
 *
 * A large file comes in pieces, one request each (online a request carries at
 * most 100 MB): `?size=` (the whole file's length), `&from=` and `&to=` (the
 * bytes this piece carries) and, after the first, `&upload=` (the id the first
 * piece's answer named). Each piece but the last answers `{ upload, size }`,
 * the bytes kept so far, and the first also `pieceBytes`, the size of every
 * later piece; the last answers the file. A first piece may name `&previous=`,
 * an upload its send gave up (a piece lost on the way), which ends first. On
 * the Mac the id is this app's own, never Tellop's: inside Tellop the pieces
 * go to Tellop's upload in pieces, and outside it they grow
 * `.data/files/arrivals/upload-<id>`. An upload with no new piece for
 * `UPLOAD_IDLE_MS` ends and its arrival goes: its next piece is refused
 * `error.fileExpired`, and `sendFile` sends the file again from its first
 * piece. Online (Tellop's host says it keeps each upload, `resumable`) the
 * id is the host's, and this app holds nothing between pieces: any copy of
 * the app takes the next piece, and the host judges whose upload it is, its
 * place and its size; pieces there are the host's `pieceBytes`. A refused
 * request's body is read to its end and dropped, so the request ends at once
 * (Tellop holds an unread body's request open).
 *
 * ## Showing a file
 *
 * `fileResponse(digest, request)` is what the address that shows a file
 * answers, after it has read the owner's record (rule 1a). Inside Tellop it
 * names the file and Tellop answers with the bytes; outside, it sends them from
 * `.data/files/`. Either way the type comes from the file's own first bytes,
 * never from its name or the type the browser claimed: pictures, sound and video
 * show in place, and everything else (a page, a drawing written as text, a
 * document) is a download, so nothing a person added ever runs as a page.
 * Outside Tellop the answer is Tellop's own, header for header: the same kinds,
 * byte ranges, revalidation and guard headers.
 *
 * The app asks only to show a file or to download it (`{ use: 'download' }`:
 * the original, byte for byte, as a file to save), and never names a format:
 * each browser is given what it can show. Inside Tellop, a phone's photo that a
 * browser cannot draw is shown as a copy it can (the original stays the
 * person's file). Outside Tellop there is no such copy, so a photo is shown
 * only to a browser that says it draws that kind (Safari draws an iPhone's
 * HEIC; Chrome does not), and is a download for every other; a video whose
 * picture no browser here plays (ProRes) is a download too.
 *
 * ## A file kept for one use
 *
 * Some files are kept only so one thing can be done with them: a recording
 * that AI writes down, and nothing else. `discardFile(digest)` throws such a
 * file away right after that use, and answers `true` once it is gone. It
 * removes only a file this app's server kept in the last 30 minutes that
 * nothing has looked up or shown since (no other `fileFacts`, `readFile` or
 * `fileResponse` for it, no second keep of the same bytes), and never a photo
 * from a phone (HEIC). Any other file stays and the answer is `false`: one a
 * record names, one kept before Tellop or this app started again, and every
 * file on a Tellop that cannot discard yet. So a person's file is never lost
 * to a discard, and the app must not promise a recording is gone unless the
 * answer was `true`. Never call it for a file a record names.
 *
 * Online, the host answers each keep with a keeper, the one value that may
 * discard that file later. This file holds it in the server's own memory only
 * (30 minutes, used once), hands it only to that keep's own look-up and to
 * `discardFile`, and never puts it in an answer: so it never reaches a record
 * or a page. It is held for the person who kept the file and the file, where
 * the host names the person (`currentPerson()`), so one person's keep or
 * discard never takes another's; else for the file alone. A keep tells the
 * host the file's size, as online needs.
 */

import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { Readable } from 'node:stream';

import { DataError } from './refusal.js';

export { DataError };

/** What a form sends in place of a file when the person pressed Remove, and only then (the picture field's `PICTURE_REMOVED`). */
export const FILE_REMOVED = 'remove';

/** A digest, and the only text a record keeps for a file. */
const DIGEST = /^[0-9a-f]{64}$/u;
const TELLOP_FILES = Symbol.for('tellop.internalFiles');
/** How long a kept file may still be discarded, in milliseconds of this process's clock (Tellop's own window). */
const DISCARD_WINDOW_MS = 30 * 60_000;
/** The most kept files remembered for discarding outside Tellop; the oldest is forgotten first. */
const MAX_FRESH = 4096;
const TELLOP_READ = Symbol.for('tellop.internalRecordsRead');
/** The size of every piece after the first, on the Mac and outside Tellop (`lib/send-file.js` `FILE_PIECE_BYTES`). */
const PIECE_BYTES = 50 * 1024 * 1024;
/** How long an upload in pieces waits for its next piece: a minute inside Tellop's own five. */
const UPLOAD_IDLE_MS = 4 * 60_000;
/** The most uploads in pieces held at once; one more is refused until one ends or goes stale. */
const MAX_UPLOADS = 64;
const UPLOAD_ID = /^[0-9a-f]{32}$/u;
const ARRIVAL = /^upload-[0-9a-f]{32}$/u;
const COUNT = /^\d{1,15}$/u;
/** Uploads in pieces, by this app's own id: `{ id, size, kept, at, busy }` and Tellop's `main`, or here `arrival` and `hash`. */
const uploads = new Map();
/** Inside Tellop: the keeper each keep answered (online), by person and digest (or digest alone), with when; never
 * in an answer. */
const keepers = new Map();
const KEEPER = /^[0-9a-f]{32}$/u;

/**
 * Inside Tellop: whom a keeper is held for, as `currentPerson()` names them (`lib/data/person.js`, loaded only when a
 * keeper is in play, so this file still loads on its own), or `''` when the host names nobody.
 */
async function keeperHolder() {
  try {
    const { currentPerson } = await import('./person.js');
    return (await currentPerson()).id;
  } catch {
    return '';
  }
}

/** The key a keeper is held under: the person and the file where the host names the person, else the file alone. */
const keeperKey = (holder, digest) => (holder === '' ? digest : `${holder} ${digest}`);

/** Inside Tellop: hold the keeper a keep answered, if any, for this file's own look-up and its discard. */
async function holdKeeper(digest, answer) {
  const keeper = answer?.keeper;
  if (typeof keeper !== 'string' || !KEEPER.test(keeper)) return undefined;
  const key = keeperKey(await keeperHolder(), digest);
  keepers.delete(key);
  keepers.set(key, { keeper, at: performance.now() });
  for (const oldest of keepers.keys()) { if (keepers.size <= MAX_FRESH) break; keepers.delete(oldest); }
  return keeper;
}

/** Inside Tellop: the keeper this person (or, where the host names nobody, anyone) holds for a file kept in the last
 * 30 minutes, taken once. Nobody is asked who they are while no keeper for the file is held (Tellop on the Mac). */
async function takeKeeper(digest) {
  if (![...keepers.keys()].some((key) => key === digest || key.endsWith(` ${digest}`))) return undefined;
  const key = keeperKey(await keeperHolder(), digest);
  const held = keepers.get(key);
  keepers.delete(key);
  const age = held === undefined ? -1 : performance.now() - held.at;
  return age >= 0 && age <= DISCARD_WINDOW_MS ? held.keeper : undefined;
}

/** Kinds a picture, a sound or a video can be; any other kind is a download. */
const SHOWS = Object.freeze({
  jpeg: 'picture', png: 'picture', gif: 'picture', webp: 'picture', avif: 'picture', heic: 'picture', heif: 'picture',
  mp3: 'sound', wav: 'sound', ogg: 'sound', flac: 'sound', m4a: 'sound',
  mp4: 'video', mov: 'video', webm: 'video', matroska: 'video',
});
const TYPES = Object.freeze({
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic',
  heif: 'image/heif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  mp4: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', matroska: 'video/x-matroska',
});

/** @param {string} kind @returns {'picture' | 'sound' | 'video' | 'download'} */
function showsOf(kind) {
  return Object.hasOwn(SHOWS, kind) ? SHOWS[kind] : 'download';
}

/** Inside Tellop: its records route is this app's (the same test as `index.js`), so its files are too. */
function insideTellop() {
  return process.env.TELLOP_INTERNAL_RECORDS === '1' || globalThis[TELLOP_FILES] !== undefined || globalThis[TELLOP_READ] !== undefined;
}

function tellopFiles() {
  const files = globalThis[TELLOP_FILES];
  if (files === null || typeof files !== 'object' || typeof files.put !== 'function' || typeof files.ref !== 'function') {
    throw new DataError('error.storageUnreadable');
  }
  return files;
}

/**
 * Outside Tellop: files this process kept and nothing has named since, by digest, with when (this process's own
 * clock, which never goes back); the keeps of a digest in flight (two at once share the file, so neither is fresh);
 * and the discard in flight for a digest, which a keep or a look-up of the same bytes waits for.
 */
const freshHere = new Map();
const keepingHere = new Map();
const discardingHere = new Map();

/** Outside Tellop: until a discard of the digest in flight has ended. */
async function discardSettled(digest) {
  for (let discarding = discardingHere.get(digest); discarding !== undefined; discarding = discardingHere.get(digest)) await discarding;
}

/** Outside Tellop: a file looked up or shown is named, and never discarded after. */
function nameHere(digest) {
  const fresh = freshHere.get(digest);
  if (fresh !== undefined) fresh.named = true;
}

/** Outside Tellop: `.data/files/`, beside the records (`APP_DATA_FILE` moves both). */
function filesFolder() {
  const configured = process.env.APP_DATA_FILE;
  const records = typeof configured === 'string' && configured.length > 0 ? configured : path.join(process.cwd(), '.data', 'app.db');
  return path.join(path.dirname(records), 'files');
}

/**
 * Keep the file that is this request's whole body, and answer its digest.
 *
 * The body is read a piece at a time and never held whole, so a file of any
 * size is kept. The answer is `{ file, size, kind, shows }`: `file` is the text
 * the record keeps, and `shows` is `'picture'`, `'sound'`, `'video'` or
 * `'download'`. Sending the same bytes twice keeps one file and answers the
 * same digest. A piece before the last answers `{ upload, size }` instead
 * (this file's opening note). A refusal is a `DataError`: `error.fileRoom` when
 * the computer is out of room, `error.fileRoomOnline` when the app's room
 * online is full (its host refuses `files-room-online`), `error.cannotChange`
 * when this person may not add a file (its host refuses `records-forbidden`),
 * `error.fileExpired` for a piece of an upload no longer held, the online
 * host's own words for a file larger than the app allows, files turned off,
 * too many files on their way at once, and the app's or the person's day
 * (`REFUSALS`), and `error.fileNotKept` otherwise, a body shorter or longer
 * than its request declared included.
 *
 * @param {Request} request
 * @returns {Promise<{ file: string, size: number, kind: string, shows: 'picture' | 'sound' | 'video' | 'download' } | { upload: string, size: number }>}
 */
export async function keepFile(request) {
  const body = request?.body;
  if (body === null || body === undefined) throw new DataError('error.fileMissing');
  let reader;
  try {
    reader = body.getReader();
  } catch {
    throw new DataError('error.fileNotKept');
  }
  try {
    const piece = pieceOf(request);
    if (piece !== null && (piece.upload !== null || piece.to < piece.size)) return await keepPiece(reader, piece);
    return await keepWhole(reader, piece === null ? declaredLength(request) : piece.size);
  } catch (error) {
    // Refused: the rest of the body is read and dropped, so the request ends now and never waits on its deadline.
    await endBody(reader);
    throw error instanceof DataError ? error : new DataError('error.fileNotKept');
  } finally {
    reader.releaseLock();
  }
}

/** A whole file on one request, `expected` bytes long (`null`: unknown). */
async function keepWhole(reader, expected) {
  let kept;
  if (insideTellop()) {
    const files = tellopFiles();
    let keeper;
    try {
      const put = await files.put(within(reader, expected), expected === null ? {} : { size: expected });
      kept = { file: put.digest, size: put.size };
      keeper = await holdKeeper(put.digest, put);
    } catch (error) {
      throw new DataError(refusalOf(error));
    }
    if (expected !== null && expected !== kept.size) throw new DataError('error.fileNotKept');
    return await answered(kept, keeper);
  }
  kept = await keepHere(within(reader, expected), expected);
  // Cut on the way: the body ended as if whole, and its digest names only a part.
  if (expected !== null && expected !== kept.size) throw new DataError('error.fileNotKept');
  return await answered(kept);
}

/** The answer for a file just kept; the keep's own look-up names nothing (inside Tellop, it is the same request, and
 * online it carries the keep's keeper). The keeper stays here: the answer never holds it. */
async function answered(kept, keeper) {
  const facts = await factsOf(kept.file, keeper);
  if (facts === null || facts.size !== kept.size) throw new DataError('error.fileNotKept');
  return { file: kept.file, ...facts };
}

/** A file store's refusals, by the reason it gives, as message keys: no room on this computer, no room online, this
 * person may not add or remove a file (`records-forbidden`, such as a Viewer's upload), and the online host's own. */
const REFUSALS = Object.freeze({
  'files-room': 'error.fileRoom',
  'files-room-online': 'error.fileRoomOnline',
  'records-forbidden': 'error.cannotChange',
  'files-too-large': 'error.fileTooLarge',
  'files-off': 'error.filesOff',
  'files-busy': 'error.filesBusy',
  'files-day-limit': 'error.filesDayLimit',
  'files-person-day-limit': 'error.filesPersonDayLimit',
  'files-expired': 'error.fileExpired',
});

/** The message key for a refusal from a file store (`REFUSALS`); any other is not kept. */
function refusalOf(error) {
  const reason = error instanceof Error ? error.message : '';
  const code = /** @type {{ code?: string }} */ (error ?? {}).code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'error.fileRoom';
  return Object.hasOwn(REFUSALS, reason) ? REFUSALS[reason] : 'error.fileNotKept';
}

/** The piece a request carries (this file's opening note), `null` when it names none (a whole file), or a refusal. */
function pieceOf(request) {
  let query;
  try {
    query = new URL(request.url).searchParams;
  } catch {
    return null;
  }
  if (!['size', 'from', 'to', 'upload', 'previous'].some((name) => query.has(name))) return null;
  const [size, from, to] = ['size', 'from', 'to'].map((name) => (COUNT.test(query.get(name) ?? '') ? Number(query.get(name)) : Number.NaN));
  const [upload, previous] = [query.get('upload'), query.get('previous')];
  if (!(from <= to && to <= size) || (upload === null ? from !== 0 : !UPLOAD_ID.test(upload))) throw new DataError('error.fileNotKept');
  // The upload a send gave up is named only on a first piece.
  if (previous !== null && (upload !== null || !UPLOAD_ID.test(previous))) throw new DataError('error.fileNotKept');
  const declared = declaredLength(request);
  if (declared !== null && declared !== to - from) throw new DataError('error.fileNotKept');
  return { size, from, to, upload, previous };
}

/** The body's pieces, refused past `limit` bytes; leaving early never cancels the body, so `endBody` can read the rest. */
async function* within(reader, limit) {
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    if (!(bytes instanceof Uint8Array)) throw new Error('not bytes');
    seen += bytes.length;
    if (limit !== null && seen > limit) throw new Error('too long');
    yield bytes;
  }
}

/** The rest of a refused request's body, read and dropped. */
async function endBody(reader) {
  try {
    while (!(await reader.read()).done);
  } catch {
    // A body that failed has ended.
  }
}

/** Inside Tellop online: the host keeps each upload in pieces itself (its files door says `resumable`). */
function resumableHost() {
  return insideTellop() && globalThis[TELLOP_FILES]?.resumable === true;
}

/** One piece of a file sent in pieces: begun by the first, kept on by each, the file answered by the last. */
async function keepPiece(reader, piece) {
  if (resumableHost()) return await keepPieceOnline(reader, piece);
  await sweepUploads();
  // The upload a send before this one gave up ends first.
  const given = piece.previous === null ? undefined : uploads.get(piece.previous);
  if (given !== undefined) await endUpload(given);
  const upload = piece.upload === null ? await beginUpload(piece.size) : uploads.get(piece.upload);
  if (upload === undefined) throw new DataError('error.fileExpired');
  if (upload.busy) throw new DataError('error.fileNotKept');
  if (upload.size !== piece.size || upload.kept !== piece.from) {
    await endUpload(upload);
    throw new DataError('error.fileExpired');
  }
  upload.busy = true;
  try {
    const source = within(reader, piece.to - piece.from);
    upload.kept = upload.main !== undefined ? (await tellopFiles().part(upload.main, source)).size : await partHere(upload, source);
    if (upload.kept !== piece.to) throw new DataError('error.fileNotKept');
    if (piece.to < piece.size) {
      upload.at = performance.now();
      upload.busy = false;
      return piece.upload === null ? { upload: upload.id, size: upload.kept, pieceBytes: PIECE_BYTES } : { upload: upload.id, size: upload.kept };
    }
    let kept;
    if (upload.main !== undefined) {
      const finished = await tellopFiles().finish(upload.main);
      kept = { file: finished.digest, size: finished.size };
      kept.keeper = await holdKeeper(finished.digest, finished);
    } else {
      const file = upload.hash.digest('hex');
      await nameArrival(upload.arrival, file);
      kept = { file, size: upload.kept };
    }
    uploads.delete(upload.id);
    if (kept.size !== piece.size) throw new DataError('error.fileNotKept');
    return await answered({ file: kept.file, size: kept.size }, kept.keeper);
  } catch (error) {
    await endUpload(upload);
    throw error instanceof DataError ? error : new DataError(refusalOf(error));
  }
}

/**
 * One piece online: the host's upload, under the host's own id, so any copy of this app takes the next piece. Nothing
 * is held here between pieces; the host judges whose upload a piece names, its place and its size. A piece that fails
 * ends the upload (the host ends only the asking person's own, so another person's piece naming it ends nothing).
 */
async function keepPieceOnline(reader, piece) {
  const files = tellopFiles();
  if (piece.previous !== null) await files.abort(piece.previous).catch(() => undefined);
  let upload = piece.upload;
  let pieceBytes;
  if (upload === null) {
    try {
      upload = await files.begin();
    } catch (error) {
      throw new DataError(refusalOf(error));
    }
    pieceBytes = files.pieceBytes;
    if (typeof upload !== 'string' || !UPLOAD_ID.test(upload) || !Number.isSafeInteger(pieceBytes) || pieceBytes <= 0) {
      if (typeof upload === 'string' && UPLOAD_ID.test(upload)) await files.abort(upload).catch(() => undefined);
      throw new DataError('error.fileNotKept');
    }
  }
  try {
    const kept = (await files.part(upload, within(reader, piece.to - piece.from)))?.size;
    if (kept !== piece.to) throw new DataError('error.fileNotKept');
    if (piece.to < piece.size) return pieceBytes === undefined ? { upload, size: kept } : { upload, size: kept, pieceBytes };
    const finished = await files.finish(upload);
    const keeper = await holdKeeper(finished.digest, finished);
    if (finished.size !== piece.size) throw new DataError('error.fileNotKept');
    return await answered({ file: finished.digest, size: finished.size }, keeper);
  } catch (error) {
    await files.abort(upload).catch(() => undefined);
    throw error instanceof DataError ? error : new DataError(refusalOf(error));
  }
}

/** A new upload in pieces of a file `size` bytes long, under an id of this app's own. */
async function beginUpload(size) {
  if (uploads.size >= MAX_UPLOADS) throw new DataError('error.fileNotKept');
  const upload = { id: randomBytes(16).toString('hex'), size, kept: 0, at: performance.now(), busy: false };
  try {
    if (insideTellop()) {
      const files = tellopFiles();
      if (typeof files.begin !== 'function' || typeof files.part !== 'function' || typeof files.finish !== 'function') throw new Error('files-refused');
      upload.main = await files.begin();
    } else {
      const arrivals = path.join(filesFolder(), 'arrivals');
      await mkdir(arrivals, { recursive: true });
      upload.arrival = path.join(arrivals, `upload-${upload.id}`);
      await (await open(upload.arrival, 'wx', 0o600)).close();
      upload.hash = createHash('sha256');
    }
  } catch (error) {
    if (upload.arrival !== undefined) await rm(upload.arrival, { force: true }).catch(() => undefined);
    throw new DataError(refusalOf(error));
  }
  uploads.set(upload.id, upload);
  return upload;
}

/** Outside Tellop: one piece added to the end of its upload's arrival; answers the bytes kept so far. */
async function partHere(upload, source) {
  const handle = await open(upload.arrival, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  let kept = upload.kept;
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || facts.size !== kept) throw new Error('arrival changed');
    for await (const bytes of source) {
      upload.hash.update(bytes);
      for (let at = 0; at < bytes.length;) {
        const { bytesWritten } = await handle.write(bytes, at, bytes.length - at);
        at += bytesWritten;
      }
      kept += bytes.length;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return kept;
}

/** An upload in pieces ended before its file: forgotten here, Tellop's ended, the arrival removed. */
async function endUpload(upload) {
  if (uploads.get(upload.id) === upload) uploads.delete(upload.id);
  if (upload.main !== undefined) {
    try {
      await globalThis[TELLOP_FILES]?.abort?.(upload.main);
    } catch {
      // Best effort: Tellop ends it at its own idle bound.
    }
  }
  if (upload.arrival !== undefined) await rm(upload.arrival, { force: true }).catch(() => undefined);
}

/** Ends every upload with no piece for `UPLOAD_IDLE_MS`; outside Tellop also the arrivals of uploads no longer held. */
async function sweepUploads() {
  const now = performance.now();
  for (const upload of [...uploads.values()]) if (!upload.busy && now - upload.at > UPLOAD_IDLE_MS) await endUpload(upload);
  if (insideTellop()) return;
  const arrivals = path.join(filesFolder(), 'arrivals');
  const held = new Set([...uploads.values()].filter((upload) => upload.arrival !== undefined).map((upload) => path.basename(upload.arrival)));
  let names = [];
  try {
    names = (await readdir(arrivals)).filter((name) => ARRIVAL.test(name) && !held.has(name));
  } catch {
    return;
  }
  for (const name of names) {
    const facts = await lstat(path.join(arrivals, name)).catch(() => null);
    if (facts !== null && Date.now() - facts.mtimeMs > UPLOAD_IDLE_MS) await rm(path.join(arrivals, name), { force: true }).catch(() => undefined);
  }
}

/** The length a request declared for its body, or `null` when it declared none (a body sent in pieces). */
function declaredLength(request) {
  const header = request?.headers?.get?.('content-length');
  return typeof header === 'string' && /^\d{1,15}$/u.test(header.trim()) ? Number(header.trim()) : null;
}

/** Outside Tellop: written under a private name while it arrives, then named by its digest unless it was cut short. */
async function keepHere(body, declared) {
  const folder = filesFolder();
  const arrivals = path.join(folder, 'arrivals');
  const temporary = path.join(arrivals, randomBytes(16).toString('hex'));
  const hash = createHash('sha256');
  let size = 0;
  try {
    await mkdir(arrivals, { recursive: true });
    const handle = await open(temporary, 'wx', 0o600);
    try {
      for await (const piece of body) {
        const bytes = typeof piece === 'string' ? Buffer.from(piece) : piece;
        if (!(bytes instanceof Uint8Array)) throw new Error('not bytes');
        hash.update(bytes);
        for (let at = 0; at < bytes.length;) {
          const { bytesWritten } = await handle.write(bytes, at, bytes.length - at);
          at += bytesWritten;
        }
        size += bytes.length;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (declared !== null && declared !== size) throw new Error('cut short');
    const file = hash.digest('hex');
    await nameArrival(temporary, file);
    return { file, size };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new DataError(refusalOf(error));
  }
}

/** Outside Tellop: an arrival whose digest is `file` named by it, and remembered as fresh unless it was there or kept twice at once. */
async function nameArrival(temporary, file) {
  const target = path.join(filesFolder(), file);
  await discardSettled(file);
  // With no wait from here to the count: a fresh file of these bytes is held twice now, and a keep in flight beside
  // this one shares the file with it.
  nameHere(file);
  const flight = keepingHere.get(file) ?? { count: 0, shared: false };
  flight.count += 1;
  if (flight.count > 1) flight.shared = true;
  keepingHere.set(file, flight);
  let there;
  try {
    there = await lstat(target).then(() => true, () => false);
    // The same bytes have the same name, so one already there is this file, and replacing it changes nothing.
    await rename(temporary, target);
  } finally {
    flight.count -= 1;
    if (flight.count === 0 && keepingHere.get(file) === flight) keepingHere.delete(file);
  }
  // A file that was there already, or kept twice at once, is held by another keeper too: never discarded.
  if (there || flight.shared) nameHere(file);
  else {
    freshHere.delete(file);
    freshHere.set(file, { at: performance.now(), named: false });
    for (const oldest of freshHere.keys()) {
      if (freshHere.size <= MAX_FRESH) break;
      freshHere.delete(oldest);
    }
  }
}

/**
 * What is kept under this digest: `{ size, kind, shows }`, or `null` when
 * nothing is (or the text is not a digest at all).
 *
 * @param {unknown} digest
 * @returns {Promise<{ size: number, kind: string, shows: 'picture' | 'sound' | 'video' | 'download' } | null>}
 */
export async function fileFacts(digest) {
  // Named before anything is read, so a discard that has not yet decided keeps the file.
  if (typeof digest === 'string' && !insideTellop()) {
    nameHere(digest);
    await discardSettled(digest);
  }
  return await factsOf(digest);
}

/** `fileFacts` without naming the file (Tellop names it itself, for every request but the one that kept it; online,
 * for every look-up without the keep's own `keeper`). */
async function factsOf(digest, keeper) {
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return null;
  if (insideTellop()) {
    let found;
    try {
      found = await (keeper === undefined ? tellopFiles().ref(digest) : tellopFiles().ref(digest, { keeper }));
    } catch {
      throw new DataError('error.storageUnreadable');
    }
    return found === null ? null : { size: found.size, kind: found.kind, shows: showsOf(found.kind) };
  }
  const opened = await openHere(digest);
  if (opened === null) return null;
  await opened.handle.close();
  return { size: opened.size, kind: opened.kind, shows: showsOf(opened.kind) };
}

/**
 * What the form asked for, for the file sent under `name`: `{ change: 'keep' }`,
 * `{ change: 'remove' }`, `{ change: 'replace', file, size, kind, shows }`, or
 * `{ problem }` with a message key.
 *
 * Keeping is the answer unless the form clearly asks for something else:
 * nothing sent, or empty text, keeps what the record has, so saving an edit
 * without touching the file never loses it. Only `FILE_REMOVED`, which the
 * field sends after a press on Remove, removes. A replacement is a digest that
 * `sendFile` answered and that is really kept; `only: 'picture'` (or `'sound'`,
 * `'video'`) also refuses a kept file of another kind, read from its own bytes.
 * A file sent inside the form itself is refused, because reading it would hold
 * it whole: send it with `sendFile` first.
 *
 * @param {FormData} form
 * @param {string} name
 * @param {{ only?: 'picture' | 'sound' | 'video' }} [options]
 */
export async function readFile(form, name, options = {}) {
  const sent = form.get(name);
  if (sent === null || sent === '') return { change: 'keep' };
  if (sent === FILE_REMOVED) return { change: 'remove' };
  if (typeof sent !== 'string' || !DIGEST.test(sent)) return { problem: 'error.fileNotKept' };
  const facts = await fileFacts(sent);
  if (facts === null) return { problem: 'error.fileMissing' };
  if (options.only !== undefined && facts.shows !== options.only) {
    return { problem: options.only === 'picture' ? 'error.pictureType' : 'error.fileKind' };
  }
  return { change: 'replace', file: sent, ...facts };
}

/**
 * `readFile(form, name, { only: 'picture' })`: a person's picture, kept as the
 * original they picked, of any kind a picture can be.
 *
 * @param {FormData} form
 * @param {string} name
 */
export function readPicture(form, name) {
  return readFile(form, name, { only: 'picture' });
}

/**
 * Throw away a file this app kept moments ago for one use, right after that
 * use: a recording that AI wrote down. `true` when it is gone; `false` when it
 * stays, which is the answer for every file but a fresh one (see "A file kept
 * for one use" above). Call it in a `finally`, so a refusal from AI still
 * discards the recording, and from a POST request: inside Tellop a page load
 * or a link never discards (it answers `false`).
 *
 * @param {unknown} digest
 * @returns {Promise<boolean>}
 */
export async function discardFile(digest) {
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return false;
  if (insideTellop()) {
    const files = globalThis[TELLOP_FILES];
    // A Tellop that cannot discard yet keeps the file.
    if (files === null || typeof files !== 'object' || typeof files.discard !== 'function') return false;
    // The digest and, online, the keeper its keep answered (taken once); on the Mac, Tellop knows the keep itself.
    const keeper = await takeKeeper(digest);
    try {
      return (await (keeper === undefined ? files.discard(digest) : files.discard(digest, { keeper }))) === true;
    } catch {
      return false;
    }
  }
  if (discardingHere.has(digest)) return false;
  const work = discardHere(digest);
  discardingHere.set(digest, work.then(() => undefined, () => undefined));
  try {
    return await work;
  } catch {
    return false;
  } finally {
    discardingHere.delete(digest);
  }
}

/** Outside Tellop: the same rule as Tellop's own store. */
async function discardHere(digest) {
  const fresh = freshHere.get(digest);
  if (fresh === undefined || fresh.named) return false;
  const age = performance.now() - fresh.at;
  if (age < 0 || age > DISCARD_WINDOW_MS) {
    freshHere.delete(digest);
    return false;
  }
  const opened = await openHere(digest);
  if (opened === null) {
    freshHere.delete(digest);
    return false;
  }
  await opened.handle.close().catch(() => undefined);
  if (opened.kind === 'heic' || opened.kind === 'heif' || fresh.named || freshHere.get(digest) !== fresh) return false;
  freshHere.delete(digest);
  await unlink(path.join(filesFolder(), digest));
  return true;
}

/**
 * Outside Tellop: a kept file's bytes, whole, for this app's server only:
 * `lib/ai.js` sends a recording or a picture to AI with it. It shows the file
 * to no one, so like Tellop's own reading for AI it names nothing, and a
 * recording read for AI can still be discarded after. Never an answer to a
 * page: a page is shown a file with `fileResponse`. `null` when nothing is kept
 * (and always inside Tellop, which reads the file for AI itself).
 *
 * @param {unknown} digest
 * @param {number} [limit]
 * @returns {Promise<Uint8Array | null>}
 */
export async function keptBytesForAi(digest, limit = Infinity) {
  if (typeof digest !== 'string' || !DIGEST.test(digest) || insideTellop()) return null;
  await discardSettled(digest);
  const opened = await openHere(digest);
  if (opened === null) return null;
  try {
    if (opened.size > limit) return null;
    const bytes = new Uint8Array(opened.size);
    let at = 0;
    while (at < bytes.length) {
      const { bytesRead } = await opened.handle.read(bytes, at, bytes.length - at, at);
      if (bytesRead <= 0) return null;
      at += bytesRead;
    }
    return bytes;
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

const notFound = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/** How an address hands over a file: shown in its place, or the original as a download. */
const USES = Object.freeze(['show', 'download']);

/**
 * The answer of an address that shows or hands over a kept file, once that
 * address has read the owner's record and taken the digest from it. A digest
 * that names nothing answers "not found"; only `GET` and `HEAD` are answered.
 *
 * `use` is `'show'` (the default: a picture, a sound or a video in its place)
 * or `'download'` (the original as a file to save). Never a format: what each
 * browser can show is decided here and by Tellop, never by the app.
 *
 * @param {unknown} digest
 * @param {Request} request
 * @param {{ use?: 'show' | 'download' }} [options]
 * @returns {Promise<Response>}
 */
export async function fileResponse(digest, request, options = {}) {
  // A third argument is { use }, never the word alone: 'download' given as text would
  // otherwise show the file where the person asked to save it.
  if (options === null || typeof options !== 'object') throw new TypeError("fileResponse's third argument is { use: 'show' | 'download' }");
  const use = options.use === undefined ? 'show' : options.use;
  if (!USES.includes(use)) throw new TypeError("fileResponse's use is 'show' or 'download'");
  const method = request?.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  }
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return notFound();
  // Inside Tellop the answer only names the file and its use: Tellop sends the bytes from this app's own folder.
  if (insideTellop()) {
    return new Response(null, { status: 200, headers: { 'x-tellop-file': digest, 'x-tellop-file-use': use, 'cache-control': 'no-store' } });
  }
  return serveHere(digest, request, method, use);
}

/*
 * Outside Tellop the answer is a copy of Tellop's own (its `app-files/serve.ts`,
 * `sniff.ts`, the range decision beside its file viewer, and `display-copy.ts`
 * for a store that makes no display copy), held equal to it by a check that
 * runs both over the same files: the same kinds, the same ranges, the same
 * revalidation and the same guard headers on every status.
 */

/** On every answer for a file, whatever its status: nothing is guessed, nothing is read across sites, and the page policy of its kind. */
function guardOf(shows) {
  return {
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    // A sound or a video is played by its own player, which fetches it again; a sandbox would stop that.
    'content-security-policy': shows === 'sound' || shows === 'video' ? "default-src 'none'; media-src 'self'" : "default-src 'none'; sandbox",
  };
}

/** Outside Tellop: the bytes from `.data/files/`, with one byte range when one is asked for. */
async function serveHere(digest, request, method, use) {
  nameHere(digest);
  await discardSettled(digest);
  const opened = await openHere(digest);
  if (opened === null) return notFound();
  const kind = await servedKind(opened, request, use);
  const shows = showsOf(kind);
  const guard = guardOf(shows);
  // A photo's answer depends on the kinds the browser says it draws.
  if (Object.hasOwn(NAMED_TYPES, opened.kind)) guard.vary = 'Accept';
  const etag = `"${digest}"`;
  const cache = { etag, 'cache-control': 'private, no-cache' };
  const answer = async (status, headers, body = null) => {
    if (body === null) await opened.handle.close().catch(() => undefined);
    return new Response(body, { status, headers: { ...headers, ...guard } });
  };
  if (notModified(request?.headers?.get('if-none-match') ?? null, etag)) return answer(304, cache);
  // An `If-Range` naming another version asks for the whole file, whatever range it came with.
  const ifRange = request?.headers?.get('if-range') ?? null;
  const range = ifRange !== null && ifRange.trim() !== etag ? { kind: 'whole' } : decideRange(request?.headers?.get('range'), opened.size);
  if (range.kind === 'unsatisfiable') {
    return answer(416, { ...cache, 'accept-ranges': 'bytes', 'content-range': `bytes */${String(opened.size)}` });
  }
  const start = range.kind === 'part' ? range.start : 0;
  const end = range.kind === 'part' ? range.end : Math.max(opened.size - 1, 0);
  const headers = {
    ...cache,
    'content-type': shows === 'download' ? 'application/octet-stream' : TYPES[kind],
    'content-disposition': shows === 'download' ? 'attachment' : 'inline',
    'content-length': String(opened.size === 0 ? 0 : end - start + 1),
    'accept-ranges': 'bytes',
  };
  if (range.kind === 'part') headers['content-range'] = `bytes ${String(start)}-${String(end)}/${String(opened.size)}`;
  const status = range.kind === 'part' ? 206 : 200;
  if (method === 'HEAD' || opened.size === 0) return answer(status, headers);
  return answer(status, headers, Readable.toWeb(opened.handle.createReadStream({ start, end, autoClose: true })));
}

/** The type a browser must name in its `Accept` to be given each photo kind as it is (`image/*` never counts). */
const NAMED_TYPES = Object.freeze({ heic: 'image/heic', heif: 'image/heif' });

/**
 * The kind this file is served as, here where no display copy is made: a
 * download for `'download'`, for a photo the browser does not name, and for a
 * video whose picture is a codec no browser here plays; otherwise its own.
 */
async function servedKind(opened, request, use) {
  if (use === 'download') return 'other';
  if (Object.hasOwn(NAMED_TYPES, opened.kind)) {
    return acceptsExactly(request?.headers?.get('accept') ?? null, NAMED_TYPES[opened.kind]) ? opened.kind : 'other';
  }
  if ((opened.kind === 'mov' || opened.kind === 'mp4') && (await videoVerdict(opened.handle, opened.size)) === 'unplayable') return 'other';
  return opened.kind;
}

/** True when `accept` names `type` exactly with a quality above zero. */
function acceptsExactly(accept, type) {
  if (accept === null) return false;
  return accept.split(',').some((range) => {
    const [name, ...parameters] = range.split(';').map((part) => part.trim().toLowerCase());
    if (name !== type) return false;
    const q = parameters.find((parameter) => parameter.startsWith('q='));
    return q === undefined || Number.parseFloat(q.slice(2)) > 0;
  });
}

/** Video codecs a browser plays from an MP4 or QuickTime file: H.264, HEVC, AV1 and VP9. */
const PLAYED_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09']);
/** Boxes read in one list, and header reads in one verdict, before the walk gives up as unknown. */
const MAX_BOXES = 4096;
const MAX_HEADER_READS = 512;

/**
 * `'played'` when every video track is a codec in `PLAYED_CODECS`,
 * `'unplayable'` when one is not, `'unknown'` when none could be read. Reads
 * only box headers, from the `moov` box (an iPhone writes it after the media)
 * to each track's first sample description, at most `MAX_HEADER_READS` reads.
 */
async function videoVerdict(handle, size) {
  const reader = { handle, reads: 0 };
  const readAt = async (position, length) => {
    reader.reads += 1;
    if (reader.reads > MAX_HEADER_READS) throw new Error('over budget');
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  };
  const boxes = async (from, to) => {
    const found = [];
    for (let at = from; at + 8 <= to;) {
      if (found.length >= MAX_BOXES) return undefined;
      const head = await readAt(at, 16);
      if (head.length < 8) return undefined;
      let boxSize = head.readUInt32BE(0), header = 8;
      if (boxSize === 1) {
        if (head.length < 16) return undefined;
        boxSize = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (boxSize === 0) {
        boxSize = to - at;
      }
      if (!Number.isSafeInteger(boxSize) || boxSize < header || at + boxSize > to) return undefined;
      found.push({ type: head.toString('latin1', 4, 8), start: at + header, end: at + boxSize });
      at += boxSize;
    }
    return found;
  };
  const child = async (parent, type) => (await boxes(parent.start, parent.end))?.find((box) => box.type === type);
  try {
    const movie = (await boxes(0, size))?.find((box) => box.type === 'moov');
    if (movie === undefined) return 'unknown';
    const tracks = (await boxes(movie.start, movie.end))?.filter((box) => box.type === 'trak') ?? [];
    const found = [];
    for (const track of tracks) {
      const media = await child(track, 'mdia');
      const listed = media === undefined ? undefined : await boxes(media.start, media.end);
      const handler = listed?.find((box) => box.type === 'hdlr');
      // `hdlr`: version and flags, pre_defined, then the handler type.
      if (handler === undefined || (await readAt(handler.start + 8, 4)).toString('latin1') !== 'vide') continue;
      const information = listed.find((box) => box.type === 'minf');
      const table = information === undefined ? undefined : await child(information, 'stbl');
      const description = table === undefined ? undefined : await child(table, 'stsd');
      if (description === undefined) return 'unplayable';
      // `stsd`: version and flags, the entry count, then the first entry's size and format.
      const entry = await readAt(description.start + 8, 8);
      found.push(entry.length === 8 ? entry.toString('latin1', 4, 8) : '');
    }
    if (found.length === 0) return 'unknown';
    return found.every((codec) => PLAYED_CODECS.has(codec)) ? 'played' : 'unplayable';
  } catch {
    return 'unknown';
  }
}

/** `If-None-Match` names this file's tag, or `*`; a weak tag compares by its value. */
function notModified(header, etag) {
  if (header === null) return false;
  return header.split(',').some((tag) => {
    const value = tag.trim();
    return value === '*' || (value.startsWith('W/') ? value.slice(2) : value) === etag;
  });
}

const BYTE_COUNT = /^\d{1,15}$/u;

/**
 * What a `Range` header asks of a file of `size` bytes: `{ kind: 'whole' }`
 * (none asked, or one not honoured: several ranges, another unit, an end before
 * its start), `{ kind: 'part', start, end }` (inclusive) or
 * `{ kind: 'unsatisfiable' }`. Answering the whole file is always allowed;
 * refusing a range that could be met is not.
 *
 * @param {string | null | undefined} header
 * @param {number} size
 */
function decideRange(header, size) {
  if (header === null || header === undefined) return { kind: 'whole' };
  const spec = header.trim().toLowerCase();
  if (!spec.startsWith('bytes=')) return { kind: 'whole' };
  const body = spec.slice('bytes='.length).trim();
  if (body.includes(',')) return { kind: 'whole' };
  const dash = body.indexOf('-');
  if (dash < 0) return { kind: 'whole' };
  const first = body.slice(0, dash).trim();
  const last = body.slice(dash + 1).trim();
  if (first.length === 0) {
    // The last `n` bytes; more than the file is the whole file, and none at all is unsatisfiable.
    if (!BYTE_COUNT.test(last)) return { kind: 'whole' };
    const wanted = Number.parseInt(last, 10);
    if (wanted === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'part', start: wanted >= size ? 0 : size - wanted, end: size - 1 };
  }
  if (!BYTE_COUNT.test(first)) return { kind: 'whole' };
  const start = Number.parseInt(first, 10);
  if (size === 0 || start >= size) return { kind: 'unsatisfiable' };
  if (last.length === 0) return { kind: 'part', start, end: size - 1 };
  if (!BYTE_COUNT.test(last)) return { kind: 'whole' };
  const asked = Number.parseInt(last, 10);
  if (asked < start) return { kind: 'whole' };
  return { kind: 'part', start, end: Math.min(asked, size - 1) };
}

/** A link is never followed and a pipe never waited on: only a plain file is opened. */
const OPEN_PLAIN = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
/** How many first bytes decide a kind. */
const SNIFF_BYTES = 256;

/** Opens `.data/files/<digest>` when it is a plain file, with its size and its kind read from its first bytes. */
async function openHere(digest) {
  let handle;
  try {
    handle = await open(path.join(filesFolder(), digest), OPEN_PLAIN);
  } catch {
    return null;
  }
  try {
    const held = await handle.stat();
    if (!held.isFile()) throw new Error('not a plain file');
    const head = Buffer.alloc(Math.min(SNIFF_BYTES, held.size));
    const { bytesRead } = head.length === 0 ? { bytesRead: 0 } : await handle.read(head, 0, head.length, 0);
    return { handle, size: held.size, kind: kindOf(head.subarray(0, bytesRead)) };
  } catch {
    await handle.close().catch(() => undefined);
    return null;
  }
}

const codes = (text) => [...text].map((character) => character.charCodeAt(0));
/** Fixed first bytes; `null` is any byte. */
const SIGNATURES = Object.freeze([
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['gif', codes('GIF87a')],
  ['gif', codes('GIF89a')],
  ['webp', [...codes('RIFF'), null, null, null, null, ...codes('WEBP')]],
  ['wav', [...codes('RIFF'), null, null, null, null, ...codes('WAVE')]],
  ['ogg', codes('OggS')],
  ['flac', codes('fLaC')],
  // An ID3 tag leads most MP3 files.
  ['mp3', [...codes('ID3'), null]],
]);
/** `ftyp` brands, major or compatible; a brand not named here (a camera's own, `crx `) is a download. */
const BRANDS = new Map([
  ['avif', 'avif'], ['avis', 'avif'], ['heic', 'heic'], ['heix', 'heic'], ['heim', 'heic'], ['heis', 'heic'], ['hevc', 'heic'],
  ['hevx', 'heic'], ['mif1', 'heif'], ['msf1', 'heif'], ['M4A ', 'm4a'], ['M4B ', 'm4a'], ['M4P ', 'm4a'], ['f4a ', 'm4a'],
  ['qt  ', 'mov'],
  ...['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'dash',
    'M4V ', 'M4VH', 'M4VP', 'f4v ', '3gp4', '3gp5', '3gp6', '3g2a', 'MSNV', 'XAVC', 'mmp4'].map((brand) => [brand, 'mp4']),
]);
/** A general still-picture brand yields to a particular one beside it. */
const GENERIC_BRANDS = new Set(['mif1', 'msf1']);

const startsWith = (bytes, signature) => bytes.length >= signature.length && signature.every((byte, at) => byte === null || bytes[at] === byte);
const textAt = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));

/** `[size][ftyp][major][minor][compatible...]`, read only as far as both the box and the bytes reach. */
function ftypKind(bytes) {
  if (bytes.length < 12 || textAt(bytes, 4, 4) !== 'ftyp') return undefined;
  const boxSize = (bytes[0] * 2 ** 24) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
  if (boxSize < 16) return undefined;
  const brands = [textAt(bytes, 8, 4)];
  for (let at = 16; at + 4 <= Math.min(boxSize, bytes.length); at += 4) brands.push(textAt(bytes, at, 4));
  if (!GENERIC_BRANDS.has(brands[0])) return BRANDS.get(brands[0]);
  for (const brand of brands.slice(1)) {
    const kind = BRANDS.get(brand);
    if (!GENERIC_BRANDS.has(brand) && (kind === 'avif' || kind === 'heic')) return kind;
  }
  return 'heif';
}

/** An MP3 frame with no ID3 tag: the sync bits, layer III, and no reserved version, bitrate or sample rate. */
function mpegAudioFrame(bytes) {
  if (bytes.length < 3 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[1] >> 3) & 0b11;
  const layer = (bytes[1] >> 1) & 0b11;
  return version !== 0b01 && layer === 0b01 && bytes[2] >> 4 !== 0b1111 && ((bytes[2] >> 2) & 0b11) !== 0b11;
}

/** Matroska and WebM: the EBML mark, then the doctype names which; with neither name it is a download. */
function ebmlKind(bytes) {
  if (!startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return undefined;
  const after = Buffer.from(bytes.subarray(4));
  if (after.includes('webm')) return 'webm';
  if (after.includes('matroska')) return 'matroska';
  return undefined;
}

/**
 * The kind of file these first bytes start: a picture, a sound or a video
 * named in `TYPES`, or `'other'`, which is a download. A copy of Tellop's own
 * table, which the check named above holds equal to it.
 *
 * @param {Uint8Array} leading
 * @returns {string}
 */
function kindOf(leading) {
  const bytes = leading.subarray(0, SNIFF_BYTES);
  for (const [kind, signature] of SIGNATURES) if (startsWith(bytes, signature)) return kind;
  return ftypKind(bytes) ?? ebmlKind(bytes) ?? (mpegAudioFrame(bytes) ? 'mp3' : 'other');
}
