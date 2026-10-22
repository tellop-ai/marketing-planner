import { addContactFor, addFromEnquiryFor } from '../../../lib/data/contacts.js';
import { recordId } from '../../../lib/data/customers.js';
import { getLocale } from '../../../lib/i18n/index.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * Contacts.
 *
 * - `POST { name, phone?, email?, whatsappConsentOn?, emailConsentOn?,
 *   consentHow?, iysOn?, notes? }` adds one: 201 `{ contact }`. Refusals
 *   travel as `{ problem }` keys (`refuse.contacts.*`).
 * - `POST { enquiryId }` adds a person who came (Customers' "Add to
 *   contacts"): their name and contact, no yes. 201 `{ contact, existed:
 *   false }`, or 200 `{ contact, existed: true }` when a contact with that
 *   number or address is already kept; 404 for an enquiry that is not this
 *   owner's.
 *
 * At most four records calls, one after another. The list is read by the
 * page itself (`app/contacts/read.js`).
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const locale = getLocale();
  try {
    if (Object.hasOwn(body.value, 'enquiryId')) {
      const enquiryId = recordId(body.value.enquiryId);
      if (enquiryId === null) return refused(REFUSED.notFound);
      const added = await addFromEnquiryFor(OWNER, enquiryId, { locale });
      if (added === null) return refused(REFUSED.notFound);
      return json(added, added.existed ? 200 : 201);
    }
    return json({ contact: await addContactFor(OWNER, body.value, { locale }) }, 201);
  } catch (error) {
    return failed(error);
  }
}
