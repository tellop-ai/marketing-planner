import { getEnquiryFor, recordId, removeEnquiryFor, updateEnquiryFor } from '../../../../lib/data/customers.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

/**
 * One enquiry: `GET` answers `{ enquiry }`, `PATCH` with any of its fields
 * changes it (`postId: null`, `amount: null`, `followUpOn: null` and
 * `code: ''` clear them) and answers
 * `{ enquiry }`, `DELETE` removes it, `{ ok: true }`. Another owner's enquiry
 * is not found.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> }} context */
async function idOf(context) {
  const { id } = await context.params;
  return recordId(id);
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function GET(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    const enquiry = await getEnquiryFor(OWNER, id);
    return enquiry === null ? refused(REFUSED.notFound) : json({ enquiry });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function PATCH(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    const enquiry = await updateEnquiryFor(OWNER, id, body.value);
    return enquiry === null ? refused(REFUSED.notFound) : json({ enquiry });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeEnquiryFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
