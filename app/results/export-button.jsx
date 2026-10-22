'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { t } from '../../lib/i18n/index.js';
import { send } from '../send.js';

/**
 * Export CSV: the month's shared posts with their typed results as a
 * spreadsheet file. The press asks the app to write the file, then the
 * browser downloads it; a refusal shows its words beside the button. It
 * rests (`disabled`) while the month has no shared post, so a press never
 * makes an empty file.
 *
 * @param {{ locale: string, month: string, disabled?: boolean }} props
 */
export function ExportButton({ locale, month, disabled = false }) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function exportMonth() {
    setPending(true);
    setProblem(null);
    const made = await send('/api/export/posts', 'POST', { month });
    setPending(false);
    if (!made.ok || typeof made.value?.address !== 'string') {
      setProblem(made.ok ? 'error.saveUnconfirmed' : made.problem);
      return;
    }
    const link = document.createElement('a');
    link.href = made.value.address;
    link.download = t('results.export.zipName', locale, { month });
    document.body.append(link);
    link.click();
    link.remove();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      <Button type="button" variant="outline" disabled={pending || disabled} onClick={exportMonth}>
        <Download aria-hidden="true" />
        {t('results.export', locale)}
      </Button>
    </div>
  );
}
