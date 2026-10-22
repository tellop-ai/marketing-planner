import { addEnquiryFor, enquiryTotalsFor, listEnquiriesBetweenFor, listEnquiriesFor } from '../../../lib/data/customers.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';

/**
 * The people who came. `GET ?month=YYYY-MM&after=` answers one page of that
 * month's enquiries, newest first, `{ items, next }` (`next` is the `after` of
 * the page after it, null when none is left; a page holds at most
 * `LIST_PAGE`), with the month's `totals` on the first page (no `after`);
 * `GET ?from=&to=` answers the enquiries of those days, both included,
 * `{ enquiries }`.
 * `POST { name, contact?, channel?, postId?, askedAbout?, status?, amount?,
 * receivedOn?, notes?, followUpOn?, code? }` adds one, `{ enquiry }`
 * (`followUpOn` a day to follow up on, or null; `code` an offer code of 2 to
 * 24 letters or digits, or `''`). A refusal is `{ problem }`.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function GET(request) {
  const query = new URL(request.url).searchParams;
  const month = query.get('month');
  const from = query.get('from');
  const to = query.get('to');
  try {
    if (month !== null) {
      const after = query.get('after');
      const page = await listEnquiriesFor(OWNER, month, { after });
      if (after !== null && after !== '') return json(page);
      return json({ ...page, totals: await enquiryTotalsFor(OWNER, month) });
    }
    if (from !== null && to !== null) return json({ enquiries: await listEnquiriesBetweenFor(OWNER, from, to) });
    return refused('refuse.customers.month');
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  try {
    return json({ enquiry: await addEnquiryFor(OWNER, body.value) });
  } catch (error) {
    return failed(error);
  }
}
