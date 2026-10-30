import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../lib/data/index.js';
import { getLocale, t } from '../../lib/i18n/index.js';
import { pictureBrandOf } from '../../lib/plan/card-layout.js';
import { isCivilMonth, monthOf, todayCivil } from '../../lib/plan/days.js';
import { rightsForThisVisit } from '../../lib/plan/visitor.js';
import { PictureBrand } from '../pictures/brand.jsx';
import { Shell } from '../shell.jsx';

import { readResults } from './read.js';
import { ResultsView } from './results-view.jsx';

/**
 * Results: a month (`?month=YYYY-MM`, this month when none) of what the
 * posts brought (customers and sales first, each count
 * beside last month's), the posts shared and the reactions typed, and the
 * followers typed for the month. Opening it only reads (AGENTS.md rule 4a),
 * in at most 13 records calls one after another (`readResults`).
 */
export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function ResultsPage({ searchParams }) {
  const locale = getLocale();
  // Who is here decides what the page draws (lib/plan/roles.js); asked before any read, on its own.
  const rights = await rightsForThisVisit();
  const query = (await searchParams) ?? {};
  const today = todayCivil();
  const month = typeof query.month === 'string' && isCivilMonth(query.month) ? query.month : monthOf(today);
  let read;
  try {
    read = await readResults(month);
  } catch (error) {
    read = { problem: error instanceof DataError ? error.messageKey : 'error.storageUnreadable' };
  }
  if (!read.totals) {
    return (
      <Shell locale={locale} path="/results" rights={rights}>
        <h1 className="text-xl font-semibold">{t('menu.results', locale)}</h1>
        <Alert variant="destructive">
          <AlertDescription>{t(read.problem, locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  const business = read.plan.profile.businessName;
  const { totals, byTheme, byNetwork, byChannel, byAsk, byCode, best, followers } = read;
  return (
    <Shell locale={locale} path="/results" rights={rights} business={business}>
      <PictureBrand brand={pictureBrandOf(read.plan.profile)} />
      <ResultsView
        locale={locale}
        month={month}
        today={today}
        business={business}
        figures={{ totals, byTheme, byNetwork, byChannel, byAsk, byCode, best, followers }}
        partial={read.partial === true}
        sameDays={read.sameDays === true}
        networks={read.plan.networks}
        themes={read.themes.map(({ id, name, colour }) => ({ id, name, colour }))}
        pictures={read.pictures}
        bestTimes={read.bestTimes}
        canAdd={rights.add}
        canChange={rights.change}
      />
    </Shell>
  );
}
