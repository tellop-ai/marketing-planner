'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '../lib/i18n/index.js';

/** Print the actual page, including its local fonts. No separate PDF layout. */
export function PrintButton({ locale }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let restoreDark = false;
    const before = () => {
      restoreDark ||= document.documentElement.classList.contains('dark');
      document.documentElement.classList.remove('dark');
    };
    const after = () => {
      if (restoreDark) document.documentElement.classList.add('dark');
      restoreDark = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      after();
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  async function printPage() {
    setBusy(true);
    try {
      await document.fonts.ready;
      window.print();
    } finally {
      setBusy(false);
    }
  }

  return <Button type="button" data-print-hidden disabled={busy} onClick={printPage}>{t('print.savePdf', locale)}</Button>;
}
