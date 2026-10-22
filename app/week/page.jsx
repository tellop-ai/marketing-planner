import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../lib/data/index.js';
import { getLocale, t } from '../../lib/i18n/index.js';
import { todayCivil } from '../../lib/plan/days.js';
import { OWNER } from '../../lib/plan/owner.js';
import { PictureBrand } from '../pictures/brand.jsx';
import { Shell } from '../shell.jsx';

import { readWeekPage } from './read.js';
import { WeekPlanner } from './week-planner.jsx';

/**
 * This week: the week's posts by day and time, and for each platform what
 * scheduling it takes (Copy words, Save picture, the day and time, Mark
 * scheduled); Save all pictures and Add to my calendar for the whole week.
 * `?week=YYYY-MM-DD` names the week's first day (Monday in Turkish, Sunday in
 * English); this week when missing or wrong. Opening it only reads
 * (AGENTS.md rule 4a), in at most 11 records calls, one at a time (`readWeekPage`).
 */
export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function WeekPage({ searchParams }) {
  const locale = getLocale();
  const query = (await searchParams) ?? {};
  let read;
  try {
    read = await readWeekPage({ owner: OWNER, query, today: todayCivil(), locale });
  } catch (error) {
    return (
      <Shell locale={locale} path="/week">
        <h1 className="text-xl font-semibold">{t('menu.week', locale)}</h1>
        <Alert variant="destructive">
          <AlertDescription>{t(error instanceof DataError ? error.messageKey : 'error.storageUnreadable', locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  return (
    <Shell locale={locale} path="/week" business={read.business}>
      <PictureBrand brand={read.brand} />
      <WeekPlanner key={read.week.from} locale={locale} {...read} />
    </Shell>
  );
}
