import { PAGES } from '@/lib/pages';
import { getLocale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function AppMenu({ pages = PAGES, locale = getLocale(), currentPath, label = t('menu.label', locale), className }) {
  return <nav data-slot="app-menu" aria-label={label} className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
    {pages.map(page => <a key={page.href} href={page.href} aria-current={currentPath === page.href ? 'page' : undefined} className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground">{t(page.wordsKey, locale)}</a>)}
  </nav>;
}
export { AppMenu };
