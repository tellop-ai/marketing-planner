import { ArrowLeft } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';

import { getLocale, t } from '../../../lib/i18n/index.js';
import { Shell } from '../../shell.jsx';

/** A post that is not here (removed, or never made): says so, with the way back to the calendar. */
export default function PostNotFound() {
  const locale = getLocale();
  return (
    <Shell locale={locale} path="/posts">
      <h1 className="text-xl font-semibold">{t('maker.notFound', locale)}</h1>
      <a href="/" className={buttonVariants({ variant: 'outline', className: 'w-fit' })}>
        <ArrowLeft aria-hidden="true" />
        {t('maker.back', locale)}
      </a>
    </Shell>
  );
}
