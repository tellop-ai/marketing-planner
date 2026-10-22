import { getContactFor, removeContactFor, stopConsentFor, updateContactFor } from '../../../../lib/data/contacts.js';
import { recordId } from '../../../../lib/data/customers.js';
import { getLocale } from '../../../../lib/i18n/index.js';
import { todayCivil } from '../../../../lib/plan/days.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';

import { businessDaysAfter, IYS_BUSINESS_DAYS, isChannel } from '../../../contacts/rules.js';

/**
 * One contact.
 *
 * - `GET` answers `{ contact }` with every field (the edit window reads the
 *   notes and "how" here; the list does not carry them). Reading saves
 *   nothing.
 * - `PATCH` with any of its fields changes it (a day `null` or `''` clears
 *   it) and answers `{ contact }`.
 * - `POST { action: 'stop', channel: 'whatsapp' | 'email' }` is "They said
 *   stop": that channel's yes day goes, and the İYS day unless it still
 *   covers the other channel's yes. Answers `{ contact, reportBy }`:
 *   `reportBy` is the last day to report the stop to İYS (three business days
 *   from today).
 * - `DELETE` removes it: `{ ok: true }`.
 *
 * Another owner's contact is not found. At most three records calls, one
 * after another.
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
    const contact = await getContactFor(OWNER, id);
    return contact === null ? refused(REFUSED.notFound) : json({ contact });
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
    const contact = await updateContactFor(OWNER, id, body.value, { locale: getLocale() });
    return contact === null ? refused(REFUSED.notFound) : json({ contact });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request @param {{ params: Promise<{ id: string }> }} context */
export async function POST(request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const { action, channel } = body.value;
  if (action !== 'stop' || !isChannel(channel)) return refused(REFUSED.request);
  try {
    const contact = await stopConsentFor(OWNER, id, channel);
    if (contact === null) return refused(REFUSED.notFound);
    return json({ contact, reportBy: businessDaysAfter(todayCivil(), IYS_BUSINESS_DAYS) });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} _request @param {{ params: Promise<{ id: string }> }} context */
export async function DELETE(_request, context) {
  const id = await idOf(context);
  if (id === null) return refused(REFUSED.notFound);
  try {
    return (await removeContactFor(OWNER, id)) ? json({ ok: true }) : refused(REFUSED.notFound);
  } catch (error) {
    return failed(error);
  }
}
