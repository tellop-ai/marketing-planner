import { DataError } from '../../../../lib/data/index.js';
import { fillResultsFor } from '../../../../lib/data/result-import.js';
import { IMPORT_LIMITS, ImportError } from '../../../../lib/import/index.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, REFUSED } from '../../../../lib/plan/reply.js';
import { readResultBytes } from '../../../../lib/plan/result-files.js';
import { FILE_TYPES, OLD_SPREADSHEET, startOf } from '../../../../lib/plan/result-kinds.js';

/**
 * Read a numbers file: `POST` with the file the person picked as the whole
 * body (`text/csv` for a .csv file, the spreadsheet type for an .xlsx one;
 * the page sets it from the file's name and first bytes). The kit's reader
 * reads it (`readRows`, at most `IMPORT_LIMITS.fileBytes` bytes and
 * `IMPORT_LIMITS.rows` rows; a spreadsheet's sheets one by one, the first
 * whose headings match), `readResultBytes` finds its posts, and
 * `fillResultsFor` fills the counts of the shared posts its rows match;
 * nothing else changes and the file is not kept.
 *
 * Answers `{ filled, notMatched, notMatchedDays, skipped, left, leftBefore }`
 * (`skipped`: rows that could not be read). Refusals: 403 `refuse.request`
 * from another site; 400 `refuse.request` for another kind of body; 413
 * `import.tooLarge` past the size; 400 `results.import.oldXls` for a
 * spreadsheet in the old format; 400 with the kit's `import.*` key for a
 * file it cannot read, or `results.import.noPosts | noNumbers | noRows`; a
 * records problem as `failed` does, with `filled` when some rows were filled
 * before it. At most 15 records calls, one at a time.
 */
export const dynamic = 'force-dynamic';

/** The kind of file the kit reads, by the body type this address takes. */
const KIND_OF_TYPE = Object.freeze(Object.fromEntries(Object.entries(FILE_TYPES).map(([kind, type]) => [type, kind])));

const TOO_LARGE = 'import.tooLarge';

/**
 * The body's bytes, counted as they arrive and never more than the kit reads
 * (null past that).
 *
 * @param {ReadableStream<Uint8Array>} stream
 */
async function readBody(stream) {
  const reader = stream.getReader();
  const pieces = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMPORT_LIMITS.fileBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    pieces.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.byteLength;
  }
  return bytes;
}

/** @param {Request} request */
export async function POST(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return json({ problem: REFUSED.request }, 403);
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const kind = Object.hasOwn(KIND_OF_TYPE, type) ? KIND_OF_TYPE[type] : null;
  if (kind === null || request.body === null) return json({ problem: REFUSED.request }, 400);
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d{1,15}$/u.test(declared.trim()) && Number(declared.trim()) > IMPORT_LIMITS.fileBytes) {
    return json({ problem: TOO_LARGE }, 413);
  }

  let bytes;
  try {
    bytes = await readBody(request.body);
  } catch {
    return json({ problem: REFUSED.request }, 400);
  }
  if (bytes === null) return json({ problem: TOO_LARGE }, 413);
  if (kind === 'xlsx' && startOf(bytes) === 'old') return json({ problem: OLD_SPREADSHEET }, 400);

  let read;
  try {
    read = await readResultBytes(bytes, kind);
  } catch (error) {
    if (error instanceof ImportError) return json({ problem: error.messageKey }, error.messageKey === TOO_LARGE ? 413 : 400);
    return failed(error);
  }
  if (!read.ok) return json({ problem: read.problem }, 400);

  try {
    const filled = await fillResultsFor(OWNER, read.rows);
    return json({ ...filled, skipped: read.skipped });
  } catch (error) {
    const answer = failed(error);
    const done = error instanceof DataError ? Number(/** @type {any} */ (error).filled ?? 0) : 0;
    if (done > 0) return json({ problem: error.messageKey, filled: done }, answer.status);
    return answer;
  }
}
