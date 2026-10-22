import { addReadyWordFor, listReadyWordsFor, readReadyWordFields } from '../../../lib/data/words.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * Ready words: `GET` lists them, `POST { kind, title, text, network? }` adds
 * one (refused past `LIMITS.readyWords`).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return json({ readyWords: await listReadyWordsFor(OWNER) });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const read = readReadyWordFields(body.value, { creating: true });
  if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
  try {
    return json({ readyWord: await addReadyWordFor(OWNER, read.fields) }, 201);
  } catch (error) {
    return failed(error);
  }
}
