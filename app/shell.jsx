import { ArrowLeft, CalendarCheck, CalendarDays, ChartColumn, Contact, Lightbulb, MessageSquareText, Target, Users } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';

import { BACK_TO_OWNER } from '../lib/data/person.js';
import { PAGES } from '../lib/pages.js';
import { t } from '../lib/i18n/index.js';
import { NO_RIGHTS } from '../lib/plan/roles.js';

import { NewPostButton } from './new-post-button.jsx';
import { RightsProvider } from './rights.jsx';

const ICONS = Object.freeze({
  calendar: CalendarDays,
  week: CalendarCheck,
  ideas: Lightbulb,
  words: MessageSquareText,
  customers: Users,
  contacts: Contact,
  results: ChartColumn,
  plan: Target,
});

/** The business's initials for the small mark: one or two letters, or the app's own. */
export function initialsOf(name, locale) {
  const words = String(name ?? '').trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return t('shell.initials', locale);
  const letters = words.slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
  return letters.toLocaleUpperCase(locale);
}

/**
 * Every page's outer shape: the business's mark and the app's name (each on
 * two lines at most, never cut short on one), New post, and the menu beside
 * the page on a wide window, above it on a narrow one.
 *
 * `rights` is what the person may press (`rightsForThisVisit()` in
 * `lib/plan/visitor.js`, asked by the server page): every part of the page
 * reads it (`useRights()` in `./rights.jsx`). New post shows only to a
 * person who may add. While the owner looks at the app as a Member or a
 * Viewer (`preview`), "Back to your own view" leads back to their own view
 * on every page. When the host's answer about the person could not be read
 * (`unknown`), nothing that saves is drawn and one line at the top of the
 * page says the app's information is in an unexpected state
 * (`error.storageUnreadable`), so the owner never meets a page that only
 * looks read-only. Every page hands its `rights` (`tests/shell-rights.test.mjs`);
 * a Shell without them draws nothing that saves.
 *
 * `data-tellop-app-marker` is what Tellop's health probe looks for: a page that
 * renders it has really mounted. It stays on the outermost element.
 *
 * @param {{ locale: string, path: string, business?: string, rights?: { add: boolean, change: boolean, preview: boolean, unknown: boolean },
 *   children: React.ReactNode }} props
 */
export function Shell({ locale, path, business, rights = NO_RIGHTS, children }) {
  const name = String(business ?? '').trim();
  return (
    <RightsProvider rights={rights}>
      <div data-tellop-app-marker="ok" className="flex min-h-dvh flex-col bg-background text-foreground md:flex-row">
        <aside data-print-hidden className="flex shrink-0 flex-col gap-4 border-b border-sidebar-border bg-sidebar p-3 text-sidebar-foreground md:w-52 md:border-r md:border-b-0">
          {rights.preview && (
            <a href={BACK_TO_OWNER} className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              <ArrowLeft aria-hidden="true" />
              {t('shell.backToOwnView', locale)}
            </a>
          )}
          <div className="flex items-center gap-2 px-2 pt-1">
            <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
              {initialsOf(name, locale)}
            </span>
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-semibold leading-tight break-words">{name || t('app.title', locale)}</div>
              {name && <div className="line-clamp-2 text-xs leading-tight text-muted-foreground break-words">{t('app.title', locale)}</div>}
            </div>
          </div>
          {rights.add && <NewPostButton locale={locale} className="w-full" />}
          <nav aria-label={t('menu.label', locale)} className="flex flex-row flex-wrap gap-0.5 text-sm md:flex-col md:flex-nowrap">
            {PAGES.map((page) => {
              const Icon = ICONS[page.icon];
              const current = page.href === '/' ? path === '/' : path === page.href || path.startsWith(`${page.href}/`);
              // A post is made from the calendar, so the calendar stays marked while one is open.
              const within = page.href === '/' && (path === '/posts' || path.startsWith('/posts/'));
              return (
                <a
                  key={page.href}
                  href={page.href}
                  aria-current={current ? 'page' : within ? 'true' : undefined}
                  data-current={current || within ? '' : undefined}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground data-current:bg-muted data-current:font-medium data-current:text-foreground"
                >
                  {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
                  {t(page.wordsKey, locale)}
                </a>
              );
            })}
          </nav>
        </aside>
        <main className="print-page flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6">
          {rights.unknown && (
            <Alert data-print-hidden variant="destructive">
              <AlertDescription>{t('error.storageUnreadable', locale)}</AlertDescription>
            </Alert>
          )}
          {children}
        </main>
      </div>
    </RightsProvider>
  );
}
