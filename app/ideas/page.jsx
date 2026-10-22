import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../lib/data/index.js';
import { getLocale, t } from '../../lib/i18n/index.js';
import { pictureBrandOf } from '../../lib/plan/card-layout.js';
import { todayCivil } from '../../lib/plan/days.js';
import { PictureBrand } from '../pictures/brand.jsx';
import { Shell } from '../shell.jsx';

import { IdeasBoard } from './ideas-board.jsx';
import { readIdeas } from './read.js';

/**
 * Ideas: posts with no day yet, by theme, newest first; New idea, Give me
 * ideas, and for each one Pick a day, Open and Remove; and the notes and
 * links saved for inspiration. Opening it only reads (AGENTS.md rule 4a), in
 * at most 13 records calls (`readIdeas`).
 */
export const dynamic = 'force-dynamic';

export default async function IdeasPage() {
  const locale = getLocale();
  let read;
  try {
    read = await readIdeas();
  } catch (error) {
    read = { problem: error instanceof DataError ? error.messageKey : 'error.storageUnreadable' };
  }
  if (!read.ideas) {
    return (
      <Shell locale={locale} path="/ideas">
        <h1 className="text-xl font-semibold">{t('menu.ideas', locale)}</h1>
        <Alert variant="destructive">
          <AlertDescription>{t(read.problem, locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  const { plan, ideas, full, notes, notesFull } = read;
  const theme = ({ id, name, colour }) => ({ id, name, colour });
  return (
    <Shell locale={locale} path="/ideas" business={plan.profile.businessName}>
      <PictureBrand brand={pictureBrandOf(plan.profile)} />
      <IdeasBoard
        locale={locale}
        today={todayCivil()}
        ideas={ideas}
        themes={plan.themes.map(theme)}
        archivedThemes={plan.archivedThemes.map(theme)}
        full={full}
        notes={notes}
        notesFull={notesFull}
      />
    </Shell>
  );
}
