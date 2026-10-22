"use client"
import { Button } from '@/components/ui/button';
import { getLocale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** actions and counts are real app controls/content. details is optional:
 * { fields, onSubmit, title?, saveLabel?, pending?, result? }. Its fields must
 * own their draft state and save only through onSubmit. This part claims no save.
 */
function PageFrame({ title, description, actions, counts, details, children, locale = getLocale(), className, ...props }) {
  return <main data-slot="page-frame" className={cn('mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-4 sm:p-6', className)} {...props}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-xl font-semibold">{title}</h1>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
      {actions && <div data-slot="page-actions" className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    {counts && <div data-slot="page-counts">{counts}</div>}
    {details && <details data-slot="page-details" className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">{details.title ?? t('page.editDetails', locale)}</summary>
      <form onSubmit={details.onSubmit} className="mt-3 flex min-w-0 flex-col gap-3">
        <div data-slot="details-fields" className="grid min-w-0 gap-3 sm:grid-cols-2">{details.fields}</div>
        <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={details.pending || !details.onSubmit}>{details.saveLabel ?? t('page.save', locale)}</Button>{details.result}</div>
      </form>
    </details>}
    <div data-slot="page-content" className="min-w-0">{children}</div>
  </main>;
}
export { PageFrame };
