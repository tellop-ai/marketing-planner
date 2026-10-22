/**
 * Reading a JSON request without reading a very large one.
 *
 * A larger request is refused before it is parsed: first by the size it
 * declares, then by counting what actually arrives, which stops reading as soon
 * as the count passes the limit. Files never come this way: a picture or a
 * screenshot goes as its own request to `/api/files` (`lib/send-file.js`), and
 * a form carries only its digest.
 */

import { REFUSED } from './reply.js';

/** The largest request body this app's addresses read, in bytes. */
export const MAX_BODY_BYTES = 131072;

/**
 * The parsed body, or the refusal key that says why there is none.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: true, value: Record<string, unknown> } | { ok: false, problem: string }>}
 */
export async function readJsonBody(request) {
  // Only a JSON request. A page on another site can send a plain-text request
  // without asking first; a JSON one makes the browser ask, and this app never
  // says yes (no sharing header), so such a request never arrives.
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { ok: false, problem: REFUSED.request };
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^[0-9]{1,12}$/u.test(declared.trim())) return { ok: false, problem: REFUSED.request };
    if (Number(declared.trim()) > MAX_BODY_BYTES) return { ok: false, problem: REFUSED.long };
  }
  if (request.body === null) return { ok: false, problem: REFUSED.request };
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, problem: REFUSED.long };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, problem: REFUSED.request };
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, problem: REFUSED.request };
    return { ok: true, value };
  } catch {
    return { ok: false, problem: REFUSED.request };
  }
}
