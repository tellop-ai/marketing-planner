import { addThemeFor, listThemesFor, readThemeFields } from '../../../lib/data/plan.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * The themes in use (`GET`; `?archived=1` for the archived ones) and a new
 * theme (`POST { name, about?, hashtags? }`, refused past `LIMITS.themes`).
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function GET(request) {
  try {
    const archived = new URL(request.url).searchParams.get('archived') === '1';
    return json({ themes: await listThemesFor(OWNER, { archived }) });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const read = readThemeFields(body.value, { creating: true });
  if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
  try {
    return json({ theme: await addThemeFor(OWNER, read.fields) }, 201);
  } catch (error) {
    return failed(error);
  }
}
