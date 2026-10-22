import { DataError, keepFile } from '../../../lib/data/files.js';

/**
 * A person's own file, kept: the request's whole body is the file, exactly as
 * `sendFile` in `lib/send-file.js` sends it, and the answer names
 * it by its digest, which the record that owns it keeps (`AGENTS.md` rule 6c).
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
    return json(await keepFile(request), 201);
  } catch (error) {
    if (error instanceof DataError) return json({ problem: error.messageKey }, error.messageKey === 'error.fileRoom' ? 507 : 400);
    return json({ problem: 'error.fileNotKept' }, 500);
  }
}

/** No cross-origin preflight is answered, exactly as `app/api/notes/route.js`. */
export function OPTIONS() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
