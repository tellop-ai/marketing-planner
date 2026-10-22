'use client';

import { CircleCheck } from 'lucide-react';

import { t } from '../../lib/i18n/index.js';

/**
 * A card's one quiet line: "Saved" only after the app confirmed the card's
 * last save, or the refusal's words. Nothing while there is nothing to say
 * (and while a save is on its way).
 *
 * @param {{ locale: string, result: { saved?: boolean, done?: string, problem?: string } | null }} props
 */
export function ResultLine({ locale, result }) {
  if (result?.problem) {
    return <p role="alert" className="text-sm text-destructive">{t(result.problem, locale)}</p>;
  }
  if (result?.saved || result?.done) {
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-4" />
        {t(result.done ?? 'plan.saved', locale)}
      </p>
    );
  }
  return <p role="status" className="sr-only" />;
}
