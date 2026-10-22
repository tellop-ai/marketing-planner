import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../lib/data/index.js';
import { getProfileFor } from '../../lib/data/plan.js';
import { listReadyWordsFor, READY_WORD_KINDS } from '../../lib/data/words.js';
import { getLocale, t } from '../../lib/i18n/index.js';
import { OWNER } from '../../lib/plan/owner.js';
import { Shell } from '../shell.jsx';

import { ReadyWordsBoard } from './ready-words-board.jsx';

/**
 * Ready words: the bios, hashtag sets, link sentences, answers, offers and
 * signatures the person copies again and again, grouped by kind. Opening it
 * only reads (rule 4a), one read after another (Tellop answers at most four
 * records calls of one request at once).
 */
export const dynamic = 'force-dynamic';

export default async function ReadyWordsPage() {
  const locale = getLocale();
  let read;
  try {
    const profile = await getProfileFor(OWNER);
    const readyWords = await listReadyWordsFor(OWNER);
    read = { profile, readyWords };
  } catch (error) {
    read = { problem: error instanceof DataError ? error.messageKey : 'error.storageUnreadable' };
  }
  if (!read.readyWords) {
    return (
      <Shell locale={locale} path="/ready-words">
        <h1 className="text-xl font-semibold">{t('menu.readyWords', locale)}</h1>
        <Alert variant="destructive">
          <AlertDescription>{t(read.problem, locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  return (
    <Shell locale={locale} path="/ready-words" business={read.profile.businessName}>
      <ReadyWordsBoard locale={locale} kinds={[...READY_WORD_KINDS]} readyWords={read.readyWords} />
    </Shell>
  );
}
