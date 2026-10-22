import { fileResponse, readPicture } from '../../../../lib/data/files.js';
import { getProfileFor, logoFileFor, saveLogoFor } from '../../../../lib/data/plan.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';

/**
 * The business's logo (`AGENTS.md` rule 6c). The picture itself is kept first
 * through `/api/files` (`appendPicture` in `lib/send-file.js`); `POST` takes a
 * form whose `logo` holds only its digest, `remove`, or nothing (keep).
 * `GET` shows the kept logo, read from the owner's own profile.
 */
export const dynamic = 'force-dynamic';

/** A form here holds a digest at most, never a file: anything larger is refused unread. */
const MAX_FORM_BYTES = 16384;
const FORM_TYPES = Object.freeze(['multipart/form-data', 'application/x-www-form-urlencoded']);

/**
 * The sent form, read with a size bound, or the refusal key.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: true, form: FormData } | { ok: false, problem: string }>}
 */
async function readSmallForm(request) {
  // Only the app's own page sends this form: a page on another site can send a
  // form without asking first, and the browser says so in this header.
  const site = (request.headers.get('sec-fetch-site') ?? '').toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return { ok: false, problem: REFUSED.request };
  const type = request.headers.get('content-type') ?? '';
  if (!FORM_TYPES.includes(type.split(';')[0].trim().toLowerCase())) return { ok: false, problem: REFUSED.request };
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^[0-9]{1,12}$/u.test(declared.trim()) || Number(declared.trim()) > MAX_FORM_BYTES)) {
    return { ok: false, problem: REFUSED.long };
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
      if (size > MAX_FORM_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, problem: REFUSED.long };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { ok: true, form: await new Response(bytes, { headers: { 'content-type': type } }).formData() };
  } catch {
    return { ok: false, problem: REFUSED.request };
  }
}

/** @param {Request} request */
export async function GET(request) {
  try {
    return await fileResponse(await logoFileFor(OWNER), request);
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const sent = await readSmallForm(request);
  if (!sent.ok) return refused(sent.problem);
  try {
    const logo = await readPicture(sent.form, 'logo');
    if (logo.problem) return json({ problem: logo.problem, field: 'logo' }, 400);
    if (logo.change === 'keep') return json({ profile: await getProfileFor(OWNER) });
    return json({ profile: await saveLogoFor(OWNER, logo.change === 'replace' ? logo.file : null) });
  } catch (error) {
    return failed(error);
  }
}
