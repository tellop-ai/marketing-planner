import { getLocale } from '../lib/i18n/index.js';
import { todayCivil } from '../lib/plan/days.js';
import { OWNER } from '../lib/plan/owner.js';

import { CalendarView } from './calendar/calendar-view.jsx';
import { readCalendar } from './calendar/read.js';
import { FirstVisit } from './first-visit/first-visit.jsx';
import { PictureBrand } from './pictures/brand.jsx';
import { Shell } from './shell.jsx';

// The calendar, the app's first page: `?month=YYYY-MM` (this month when
// missing), `?view=week&day=YYYY-MM-DD` for a week. Opening it only reads
// (AGENTS.md rule 4a); `app/calendar/read.js` says what it reads and how many
// records calls that takes.
export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function CalendarPage({ searchParams }) {
  const locale = getLocale();
  const query = (await searchParams) ?? {};
  const data = await readCalendar({ owner: OWNER, query, today: todayCivil(), locale });
  return (
    <Shell locale={locale} path="/" business={data.business}>
      <PictureBrand brand={data.brand} />
      <CalendarView locale={locale} {...data} />
      <FirstVisit owner={OWNER} locale={locale} calendar={data} />
    </Shell>
  );
}
