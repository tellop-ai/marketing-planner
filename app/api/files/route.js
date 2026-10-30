import { DataError, keepFile } from '../../../lib/data/files.js';

/**
 * A person's own file, kept: each request's body is the file or one piece of
 * it, exactly as `sendFile` in `lib/send-file.js` sends it, and the last answer
 * names it by its digest, which the record that owns it keeps (`AGENTS.md`
 * rule 6c). A piece before the last answers 202 with its upload's id, and the
 * first also with the size of every later piece (`lib/data/files.js`).
 *
 * The body is passed on a piece at a time and never held whole, so a file of
 * any size is kept; there is no limit here. Nothing is shown from this address:
 * a kept file is shown only through the address of the record that names it,
 * after that address has read the owner's record (rule 1a).
 *
 * Refusals travel as message keys, never as sentences, and no answer here
 * carries `Access-Control-Allow-Origin` (rule 3).
 */
export const dynamic = 'force-dynamic';

/** The status of a refusal, by its message key; any other is 400. */
const STATUS = Object.freeze({
  'error.fileRoom': 507, 'error.fileRoomOnline': 507, 'error.fileExpired': 410, 'error.cannotChange': 403,
  'error.fileTooLarge': 413, 'error.filesOff': 403, 'error.filesBusy': 429, 'error.filesDayLimit': 429, 'error.filesPersonDayLimit': 429,
});

/**
 * @param {unknown} body
 * @param {number} status
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** @param {Request} request */
export async function POST(request) {
  try {
    const kept = await keepFile(request);
    return json(kept, typeof kept.file === 'string' ? 201 : 202);
  } catch (error) {
    if (error instanceof DataError) return json({ problem: error.messageKey }, STATUS[error.messageKey] ?? 400);
    return json({ problem: 'error.fileNotKept' }, 500);
  }
}

/** No cross-origin preflight is answered, exactly as `app/api/notes/route.js`. */
export function OPTIONS() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
