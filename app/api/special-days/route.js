import { addOwnDayFor, listOwnDaysFor, readOwnDayFields } from '../../../lib/data/plan.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * The person's own special days: `GET` lists them, `POST { name, date,
 * yearly?, note? }` adds one (`date` `YYYY-MM-DD`; a yearly day keeps only its
 * month and day).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return json({ ownDays: await listOwnDaysFor(OWNER) });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const read = readOwnDayFields(body.value);
  if (!read.ok) return read.field === undefined ? refused(read.problem) : json({ problem: read.problem, field: read.field }, 400);
  try {
    return json({ day: await addOwnDayFor(OWNER, read.fields) }, 201);
  } catch (error) {
    return failed(error);
  }
}
