import { fileFacts, fileResponse, keepFile } from '../../../lib/data/files.js';
import { failed, json, refused, REFUSED } from '../../../lib/plan/reply.js';
import { downloadAddress, ZIP_LIMITS, ZIP_START } from '../../../lib/plan/zip.js';

/**
 * Zips the person downloads, in two steps because opening an address never
 * saves (AGENTS.md rule 4a):
 *
 * - `POST` with a zip the page built (`lib/plan/zip.js`) as its whole body
 *   keeps it (`keepFile`) and answers `{ address }`, this address with the
 *   kept file's digest. Only a request from this app's own pages
 *   (`sec-fetch-site` absent or `same-origin`, else 403), sent as
 *   `application/zip` (a page on another site cannot send that without
 *   asking first, and this app never says yes), whose body starts as a zip
 *   does and holds at most `ZIP_LIMITS.bytes` (else 413). The first bytes
 *   are read before anything is kept, and the rest is counted as it arrives
 *   and never held whole.
 * - `GET ?file=<digest>` hands that file over as a download. It answers only
 *   a kept file that is a download (never a picture, a sound or a video the
 *   person kept), so it is not a way to read their photos.
 *
 * The spreadsheet and calendar downloads keep their zips on the server and
 * answer this same address.
 */
export const dynamic = 'force-dynamic';

const DIGEST = /^[0-9a-f]{64}$/u;
const nothing = (status) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** @param {Request} request */
export async function POST(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return json({ problem: REFUSED.request }, 403);
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/zip') return refused(REFUSED.request);
  const declaredText = request.headers.get('content-length');
  let declared = null;
  if (declaredText !== null) {
    if (!/^\d{1,15}$/u.test(declaredText.trim())) return refused(REFUSED.request);
    declared = Number(declaredText.trim());
    if (declared > ZIP_LIMITS.bytes) return refused(REFUSED.long);
  }
  if (request.body === null) return refused(REFUSED.request);

  const reader = request.body.getReader();
  const held = [];
  let size = 0;
  try {
    while (size < ZIP_START.length) {
      const { done, value } = await reader.read();
      if (done) break;
      held.push(value);
      size += value.byteLength;
    }
  } catch {
    return refused(REFUSED.request);
  }
  const head = [];
  for (const piece of held) {
    for (let at = 0; at < piece.length && head.length < ZIP_START.length; at += 1) head.push(piece[at]);
  }
  if (head.length < ZIP_START.length || head.some((byte, at) => byte !== ZIP_START[at])) {
    await reader.cancel().catch(() => undefined);
    return refused(REFUSED.request);
  }
  if (size > ZIP_LIMITS.bytes) {
    await reader.cancel().catch(() => undefined);
    return refused(REFUSED.long);
  }

  // The rest, counted as it arrives: past the limit the body stops, and nothing is kept.
  let over = false;
  const body = new ReadableStream({
    start(controller) {
      for (const piece of held) controller.enqueue(piece);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > ZIP_LIMITS.bytes) {
          over = true;
          await reader.cancel().catch(() => undefined);
          controller.error(new Error('over the limit'));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  try {
    const headers = declared === null ? {} : { 'content-length': String(declared) };
    const kept = await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body, duplex: 'half', headers }));
    if (kept.shows !== 'download') return refused(REFUSED.request);
    return json({ address: downloadAddress(kept.file) });
  } catch (error) {
    return over ? refused(REFUSED.long) : failed(error);
  }
}

/** @param {Request} request */
export async function GET(request) {
  const file = new URL(request.url).searchParams.get('file');
  if (file === null || !DIGEST.test(file)) return nothing(404);
  let facts = null;
  try {
    facts = await fileFacts(file);
  } catch {
    return nothing(503);
  }
  if (facts === null || facts.shows !== 'download') return nothing(404);
  return fileResponse(file, request, { use: 'download' });
}
