import { getLocale } from '../lib/i18n/index.js';
import { todayCivil } from '../lib/plan/days.js';
import { OWNER } from '../lib/plan/owner.js';
import { rightsForThisVisit } from '../lib/plan/visitor.js';

import { CalendarView } from './calendar/calendar-view.jsx';
import { readCalendar } from './calendar/read.js';
import { FirstVisit } from './first-visit/first-visit.jsx';
import { PictureBrand } from './pictures/brand.jsx';
import { Shell } from './shell.jsx';

// The calendar, the app's first page: `?month=YYYY-MM` (this month when
// missing), `?view=week&day=YYYY-MM-DD` for a week. Opening it only reads
// (AGENTS.md rule 4a); `app/calendar/read.js` says what it reads and how many
// records calls that takes. What it draws follows who is here
// (`lib/plan/roles.js`): a Viewer reads it, a Member adds to it.
export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function CalendarPage({ searchParams }) {
  const locale = getLocale();
  // Who is here decides what the page draws (lib/plan/roles.js); asked before any read, on its own.
  const rights = await rightsForThisVisit();
  const query = (await searchParams) ?? {};
  const data = await readCalendar({ owner: OWNER, query, today: todayCivil(), locale });
  return (
    <Shell locale={locale} path="/" rights={rights} business={data.business}>
      <PictureBrand brand={data.brand} />
      <CalendarView locale={locale} {...data} />
      {/* The first visit saves the business's start (My plan): only for a person who may change it. */}
      {rights.change && <FirstVisit owner={OWNER} locale={locale} calendar={data} />}
    </Shell>
  );
}
