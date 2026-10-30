import { ArrowLeft } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';

import { getLocale, t } from '../lib/i18n/index.js';
import { rightsForThisVisit } from '../lib/plan/visitor.js';
import { Shell } from './shell.jsx';

/** Any address the app does not have (or a post that is gone): says so, with the way back to the calendar. */
export default async function NotFound() {
  const locale = getLocale();
  // As every page: New post for a person who may add, the way back while the owner looks as someone else.
  const rights = await rightsForThisVisit();
  return (
    <Shell locale={locale} path="" rights={rights}>
      <h1 className="text-xl font-semibold">{t('page.notFound', locale)}</h1>
      <a href="/" className={buttonVariants({ variant: 'outline', className: 'w-fit' })}>
        <ArrowLeft aria-hidden="true" />
        {t('maker.back', locale)}
      </a>
    </Shell>
  );
}
