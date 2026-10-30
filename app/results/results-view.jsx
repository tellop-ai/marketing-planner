import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CountsLine } from '@/components/ui/counts-line';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { formatDate, formatDecimal, formatMonth } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { addMonths } from '../../lib/plan/days.js';
import { networkByKey } from '../../lib/plan/networks.js';
import { channelLabel } from '../customers/choices.js';
import { dotClass } from '../ideas/groups.js';
import { PictureThumb } from '../pictures/thumb.jsx';

import { BestTimesCard } from './best-times-card.jsx';
import { ExportButton } from './export-button.jsx';
import { FollowersRow } from './followers-row.jsx';
import { ImportDialog } from './import-dialog.jsx';
import { changeOf, changeText, followerFields, followersTotal, hasFigures, rowsThisMonth, showsByAsk, showsReactions, wholeMoney } from './rows.js';

/** A whole count in the reader's language. @param {number} value @param {string} locale */
function count(value, locale) {
  return formatDecimal(String(Math.max(0, Math.trunc(value))), locale);
}

/** An average to one decimal place in the reader's language. @param {number} value @param {string} locale */
function average(value, locale) {
  return formatDecimal(String(Math.round(Math.max(0, value) * 10) / 10), locale);
}


/**
 * A count on the counts line with its change from last month beside it
 * ("+3", "−1"); no change, or none to compare, shows only the count.
 * `fromKey` says what it is compared with (the whole month before, or its
 * same days while this month runs).
 *
 * @param {{ value: string, change: number | null, format: (value: number) => string, locale: string, fromKey?: string }} props
 */
function WithChange({ value, change, format, locale, fromKey = 'results.change.fromLast' }) {
  return (
    <>
      {value}
      {change !== null && (
        <span className={cn('ml-1.5 text-xs font-medium', change > 0 ? 'text-primary' : 'text-muted-foreground')}>
          {changeText(change, format)}
          <span className="sr-only"> {t(fromKey, locale)}</span>
        </span>
      )}
    </>
  );
}

/** A number cell. @param {{ children: React.ReactNode }} props */
function NumberCell({ children }) {
  return <TableCell className="text-right tabular-nums">{children}</TableCell>;
}

/** A dash read out as "none". @param {{ label: string }} props */
function Dash({ label }) {
  return <><span aria-hidden="true" className="text-muted-foreground">–</span><span className="sr-only">{label}</span></>;
}

/**
 * One group's figures for the month as a compact list: a row each, with the
 * posts shared, the customers and the sales they brought and, only when
 * results were typed this month, the average reactions a post (a dash when
 * that row has none typed). It fits by the card's own width (a phone, or half
 * of a window): where the card is narrow, each name takes a line of its own
 * above its numbers (so a name never breaks inside a word) and the reactions
 * column says only "Average". `note`: one quiet line under the list (By
 * code: some codes were left out).
 *
 * @param {{ locale: string, title: string, reactions: boolean, rows: Array<{ key: string, label: string, colour?: number | null,
 *   shares: number | null, customers: number, sales: number, average: number | null }>, note?: string | null }} props
 */
function FiguresCard({ locale, title, reactions, rows, note = null }) {
  if (rows.length === 0) return null;
  const head = 'text-right text-xs font-normal whitespace-normal text-muted-foreground';
  const across = reactions ? 4 : 3;
  const label = (row) => (
    <span className="flex min-w-0 items-start gap-2">
      {row.colour !== undefined && <span aria-hidden="true" className={cn('mt-1.5 inline-block size-2 shrink-0 rounded-full', dotClass(row.colour))} />}
      <span className="min-w-0 break-words">{row.label}</span>
    </span>
  );
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="@container">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden @md:table-cell"><span className="sr-only">{title}</span></TableHead>
              <TableHead className={head}>{t('results.col.posts', locale)}</TableHead>
              <TableHead className={head}>{t('results.col.customers', locale)}</TableHead>
              <TableHead className={head}>{t('results.col.sales', locale)}</TableHead>
              {reactions && (
                <TableHead className={head}>
                  <span aria-hidden="true" className="@md:hidden">{t('results.col.average', locale)}</span>
                  <span className="@max-md:sr-only">{t('results.col.reactions', locale)}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <Fragment key={row.key}>
                <TableRow className="border-b-0 hover:bg-transparent @md:hidden">
                  <TableCell colSpan={across} className="pt-2 pb-0 font-medium whitespace-normal">{label(row)}</TableCell>
                </TableRow>
                <TableRow>
                <TableCell className="hidden min-w-24 whitespace-normal @md:table-cell">{label(row)}</TableCell>
                <NumberCell>{row.shares === null ? <Dash label={t('results.none', locale)} /> : count(row.shares, locale)}</NumberCell>
                <NumberCell>{count(row.customers, locale)}</NumberCell>
                <NumberCell>{row.sales > 0 ? wholeMoney(row.sales, locale) : <Dash label={t('results.none', locale)} />}</NumberCell>
                {reactions && (
                  <NumberCell>{row.average === null ? <Dash label={t('results.noAverage', locale)} /> : average(row.average, locale)}</NumberCell>
                )}
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** This month's numbers of a group's row. */
const thisMonth = (row) => ({
  shares: row.shares?.value ?? null,
  customers: row.customers.value,
  sales: row.sales.value,
  average: row.reactions?.value ?? null,
});

/**
 * The Results page's body (customers and sales first): the
 * month (previous, next), the download of the shared posts (resting while
 * the month has none, so the file is never empty), the counts line with each
 * count's change from last month, the month by theme, by platform (and the
 * other places customers came from) and by ask, the best posts by customers,
 * and the followers typed for the month. It only shows what the page read;
 * only the followers fields save, each by itself. Who is here (the page's
 * `lib/plan/roles.js` answer): Read a numbers file fills results into kept
 * posts and the followers fields change the month's numbers, so both need
 * `canChange` (else the numbers only show); the download keeps the file it
 * hands over, so it needs `canAdd`.
 *
 * @param {{ locale: string, month: string, today: string, business?: string,
 *   figures: Pick<Awaited<ReturnType<typeof import('./read.js').readResults>>, 'totals' | 'byTheme' | 'byNetwork' | 'byChannel' | 'byAsk' | 'byCode' | 'best' | 'followers'>,
 *   partial: boolean, sameDays?: boolean, networks: string[], themes: { id: number, name: string, colour: number }[],
 *   pictures: Record<number, object>, canAdd?: boolean, canChange?: boolean }} props
 */
export function ResultsView({ locale, month, today, business, figures, partial, sameDays = false, networks, themes, pictures, bestTimes = null, canAdd = false, canChange = false }) {
  const { totals } = figures;
  // While the month runs, its counts are compared with the same days of the month before; followers are a month's number.
  const fromKey = sameDays ? 'results.change.fromSameDays' : 'results.change.fromLast';
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const reactions = showsReactions(totals);
  const whole = (value) => count(value, locale);
  const cash = (value) => wholeMoney(value, locale);

  const themeRows = rowsThisMonth(figures.byTheme).map((row) => {
    const theme = row.themeId === null ? null : themeById.get(row.themeId) ?? null;
    return { ...thisMonth(row), key: row.themeId === null ? 'none' : String(row.themeId), label: theme?.name ?? t('results.noTheme', locale), colour: theme?.colour ?? null };
  });
  const platformRows = [
    ...rowsThisMonth(figures.byNetwork).map((row) => ({ ...thisMonth(row), key: row.network, label: networkByKey(row.network)?.name ?? row.network })),
    ...rowsThisMonth(figures.byChannel).map((row) => ({ ...thisMonth(row), shares: null, average: null, key: `channel-${row.channel}`, label: channelLabel(row.channel, locale) })),
  ];
  const askShown = rowsThisMonth(figures.byAsk);
  const askRows = showsByAsk(askShown)
    ? askShown.map((row) => ({ ...thisMonth(row), average: null, key: row.ask || 'none', label: t(row.ask ? `maker.ask.${row.ask}` : 'maker.ask.none', locale) }))
    : [];
  // By code: the customers who gave a campaign's offer code ("KIS20 · Winter sale").
  const codeRows = rowsThisMonth(figures.byCode?.rows ?? []).map((row) => ({ ...thisMonth(row), shares: null, average: null, key: `code-${row.code}`, label: `${row.code} · ${row.name}` }));
  const followers = followersTotal(figures.followers);
  const best = figures.best.filter((post) => post.customers > 0 || post.sales > 0 || (post.reactions ?? 0) > 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('menu.results', locale)}</h1>
        <div className="flex items-center gap-1">
          <Link href={`/results?month=${addMonths(month, -1)}`} aria-label={t('results.month.previous', locale)} className={buttonVariants({ variant: 'outline', size: 'icon' })}>
            <ChevronLeft aria-hidden="true" />
          </Link>
          <Link href={`/results?month=${addMonths(month, 1)}`} aria-label={t('results.month.next', locale)} className={buttonVariants({ variant: 'outline', size: 'icon' })}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
        <h2 className="text-base font-semibold">{formatMonth(month, locale)}</h2>
        {!today.startsWith(month) && (
          <Link href="/results" className={buttonVariants({ variant: 'outline' })}>{t('results.month.this', locale)}</Link>
        )}
        {(canAdd || canChange) && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {canChange && <ImportDialog locale={locale} />}
            {canAdd && <ExportButton locale={locale} month={month} disabled={totals.shares.value === 0} />}
          </div>
        )}
      </header>

      <CountsLine
        items={[
          { key: 'shared', label: t('results.count.shared', locale), value: <WithChange locale={locale} value={whole(totals.shares.value)} change={changeOf(totals.shares.value, totals.shares.last)} format={whole} fromKey={fromKey} /> },
          { key: 'customers', label: t('results.count.customers', locale), value: <WithChange locale={locale} value={whole(totals.customers.value)} change={changeOf(totals.customers.value, totals.customers.last)} format={whole} fromKey={fromKey} /> },
          { key: 'sales', label: t('results.count.sales', locale), value: <WithChange locale={locale} value={cash(totals.sales.value)} change={changeOf(totals.sales.value, totals.sales.last)} format={cash} fromKey={fromKey} /> },
          ...(followers.value === null ? [] : [{ key: 'followers', label: t('results.count.followers', locale), value: <WithChange locale={locale} value={whole(followers.value)} change={followers.change} format={whole} /> }]),
        ]}
      />
      {partial && <p className="text-xs text-muted-foreground">{t('results.partial', locale)}</p>}

      {!hasFigures(totals) ? (
        <p className="rounded-xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
          {t('results.empty', locale, { month: formatMonth(month, locale) })}
        </p>
      ) : (
        <>
          {best.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t('results.best', locale)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col divide-y divide-border">
                  {best.map((post) => {
                    const theme = post.themeId === null ? null : themeById.get(post.themeId) ?? null;
                    const where = post.networks.map((key) => networkByKey(key)?.name ?? key).join(', ');
                    const about = [where, post.day ? formatDate(post.day, locale) : ''].filter((part) => part !== '').join(' · ');
                    return (
                      <li key={post.postId} className="flex min-w-0 items-center gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="size-12 shrink-0 overflow-hidden rounded-md">
                          <PictureThumb picture={pictures[post.postId] ?? null} themeColour={theme?.colour ?? null} business={business} locale={locale} alt="" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link href={`/posts/${post.postId}`} className="line-clamp-2 font-medium break-words hover:underline">
                            {post.name || t('post.untitled', locale)}
                          </Link>
                          {about && <div className="text-xs break-words text-muted-foreground">{about}</div>}
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                          <div className="text-sm">
                            <span className="font-semibold text-foreground">{whole(post.customers)}</span>{' '}
                            {t(post.customers === 1 ? 'results.customer.one' : 'results.customer.other', locale)}
                          </div>
                          {post.sales > 0 && <div>{cash(post.sales)}</div>}
                          {post.reactions !== null && (
                            <div>{whole(post.reactions)} {t(post.reactions === 1 ? 'results.reaction.one' : 'results.reaction.other', locale)}</div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <FiguresCard locale={locale} title={t('results.byTheme', locale)} reactions={reactions} rows={themeRows} />
            <FiguresCard locale={locale} title={t('results.byPlatform', locale)} reactions={reactions} rows={platformRows} />
            <FiguresCard locale={locale} title={t('results.byAsk', locale)} reactions={false} rows={askRows} />
            <FiguresCard locale={locale} title={t('results.byCode', locale)} reactions={false} rows={codeRows} note={figures.byCode?.partial ? t('results.byCodePartial', locale) : null} />
          </div>
        </>
      )}

      <BestTimesCard locale={locale} networks={networks} bestTimes={bestTimes} />

      <FollowersRow locale={locale} month={month} fields={followerFields(figures.followers, networks)} canChange={canChange} />
    </div>
  );
}
