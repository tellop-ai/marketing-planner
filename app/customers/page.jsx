import { getProfileFor } from '../../lib/data/plan.js';
import {
  enquiryTotalsFor,
  listCommentsFor,
  listEnquiriesFor,
  postChoicesFor,
  postNamesFor,
} from '../../lib/data/customers.js';
import { getLocale } from '../../lib/i18n/index.js';
import { addDays, isCivilMonth, monthOf, todayCivil } from '../../lib/plan/days.js';
import { parseNetworkList } from '../../lib/plan/networks.js';
import { OWNER } from '../../lib/plan/owner.js';

import { Shell } from '../shell.jsx';

import { CustomersView } from './customers-view.jsx';

// Customers: who came (this month's people, their totals and where they came
// from) and what they said. Opening it only reads (AGENTS.md rule 4a). Both
// lists come in pages: the page reads the first of each, and Show more asks
// `/api/enquiries?month=&after=` or `/api/comments?after=` for the next.
export const dynamic = 'force-dynamic';

/** How far back and ahead the "post that brought them" choice reaches, in days. */
const POSTS_BACK = 120;
const POSTS_AHEAD = 31;

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function CustomersPage({ searchParams }) {
  const locale = getLocale();
  const query = (await searchParams) ?? {};
  const today = todayCivil();
  const month = typeof query.month === 'string' && isCivilMonth(query.month) ? query.month : monthOf(today);
  const tab = query.tab === 'said' ? 'said' : 'came';

  const profile = await getProfileFor(OWNER);
  const { items: enquiries, next: enquiriesNext } = await listEnquiriesFor(OWNER, month);
  const totals = await enquiryTotalsFor(OWNER, month);
  const { items: comments, next: commentsNext } = await listCommentsFor(OWNER);
  const choices = await postChoicesFor(OWNER, addDays(today, -POSTS_BACK), addDays(today, POSTS_AHEAD));
  const named = new Map(choices.map((post) => [post.id, post.name]));
  const missing = enquiries.map((enquiry) => enquiry.postId).filter((id) => id !== null && !named.has(id));
  const names = { ...Object.fromEntries(named), ...(await postNamesFor(OWNER, missing)) };

  return (
    <Shell locale={locale} path="/customers" business={profile.businessName}>
      <CustomersView
        locale={locale}
        tab={tab}
        month={month}
        today={today}
        enquiries={enquiries.map((enquiry) => ({ ...enquiry, postName: enquiry.postId === null ? null : (names[enquiry.postId] ?? null) }))}
        enquiriesNext={enquiriesNext}
        totals={totals}
        comments={comments}
        commentsNext={commentsNext}
        posts={choices}
        networks={parseNetworkList(profile.networks)}
        business={profile.businessName}
        reviewLink={profile.reviewLink}
      />
    </Shell>
  );
}
