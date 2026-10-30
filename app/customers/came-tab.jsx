'use client';

import { BellRing, ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { CountsLine } from '@/components/ui/counts-line';
import { DataTable } from '@/components/ui/data-table';

import { formatDate, formatMoney, formatMonth } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { addMonths, civilDay, daysInMonth } from '../../lib/plan/days.js';
import { isFollowUpDue } from '../calendar/follow-ups.js';

import { ENQUIRY_STATUSES, channelLabel, statusLabel } from './choices.js';
import { EnquiryDialog } from './enquiry-dialog.jsx';
import { useRights } from '../rights.jsx';
import { sendUnconfirmed } from '../send.js';
import { ShowMore, usePages } from './show-more.jsx';

/** How a status looks as a chip. */
const STATUS_LOOK = Object.freeze({ new: 'secondary', talking: 'outline', bought: 'default', 'not-now': 'ghost' });

/** The figure's height by how many places it lists: fixed classes, never a size worked out while drawing. */
function chartHeight(count) {
  if (count <= 3) return 'h-32';
  if (count <= 6) return 'h-48';
  return 'h-72';
}

/** A wide window (the `lg` breakpoint, 64rem), where the list has room for the Code column. */
const WIDE = '(min-width: 64rem)';

/** Whether the window is wide; false while the page is drawn on the server and before it opens. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const changed = () => setWide(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return wide;
}

/**
 * Who came: the month's people with its counts, where they came from as a
 * figure, the list (search, a status filter; its first page, then Show more),
 * Add, a row's edit window, and the month as a spreadsheet file (resting while
 * the month has nobody). The list's Follow up column marks the people due for
 * a follow-up today or earlier (as the calendar's Today card lists them); its
 * Code column shows on a wide window only. Who is here (`useRights`): Add and
 * the spreadsheet (kept as a file to hand over) for a person who may add; a
 * row's window opens for everyone, to read only for a person who may not
 * change it (`EnquiryDialog`).
 *
 * @param {{ locale: string, month: string, today: string,
 *   enquiries: (import('../../lib/data/customers.js').Enquiry & { postName: string | null })[], next: string | null,
 *   totals: { count: number, bought: number, amount: number, byChannel: Record<string, number> },
 *   posts: { id: number, name: string, day: string }[], networks: string[] }} props
 */
export function CameTab({ locale, month, today, enquiries, next, totals, posts, networks }) {
  const router = useRouter();
  const { add: canAdd } = useRights();
  const pages = usePages({ first: enquiries, next, path: '/api/enquiries', query: { month } });
  // A row from Show more names its post from the choices (the page named the first page's).
  const rows = useMemo(() => {
    const named = new Map(posts.map((post) => [post.id, post.name]));
    return pages.items.map((row) => ('postName' in row ? row : { ...row, postName: row.postId === null ? null : (named.get(row.postId) ?? null) }));
  }, [pages.items, posts]);
  const [editing, setEditing] = useState(/** @type {object | null} */ (null));
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [exporting, setExporting] = useState(false);
  const wide = useWide();

  function startAdd() {
    setNotice(null);
    setProblem(null);
    setEditing(null);
    setOpen(true);
  }

  function startEdit(enquiry) {
    setNotice(null);
    setProblem(null);
    setEditing(enquiry);
    setOpen(true);
  }

  /** @param {string} key what the dialog confirmed */
  function done(key) {
    setOpen(false);
    setEditing(null);
    setNotice(key);
    router.refresh();
  }

  async function exportMonth() {
    setExporting(true);
    setNotice(null);
    setProblem(null);
    const [year, number] = month.split('-').map(Number);
    const made = await sendUnconfirmed('/api/export/enquiries', 'POST', { from: `${month}-01`, to: civilDay(year, number, daysInMonth(year, number)) });
    setExporting(false);
    if (!made.ok || typeof made.value?.address !== 'string') {
      setProblem(made.ok ? 'error.saveUnconfirmed' : made.problem);
      return;
    }
    const link = document.createElement('a');
    link.href = made.value.address;
    link.download = t('export.zipName', locale, { month });
    document.body.append(link);
    link.click();
    link.remove();
  }

  const columns = useMemo(() => [
    {
      accessorKey: 'receivedOn',
      header: t('customers.field.day', locale),
      cell: ({ row }) => formatDate(row.original.receivedOn, locale),
    },
    {
      accessorKey: 'name',
      header: t('customers.field.name', locale),
      cell: ({ row }) => (
        <Button type="button" variant="link" size="sm" className="max-w-48 justify-start px-0" onClick={() => startEdit(row.original)}>
          <span className="truncate">{row.original.name}</span>
        </Button>
      ),
    },
    {
      accessorKey: 'contact',
      header: t('customers.field.contact', locale),
      cell: ({ row }) => <span className="block max-w-44 truncate text-muted-foreground">{row.original.contact}</span>,
    },
    {
      id: 'channel',
      accessorFn: (row) => channelLabel(row.channel, locale),
      header: t('customers.field.channel', locale),
    },
    {
      accessorKey: 'status',
      header: t('customers.field.status', locale),
      cell: ({ row }) => <Badge variant={STATUS_LOOK[row.original.status] ?? 'outline'}>{statusLabel(row.original.status, locale)}</Badge>,
    },
    {
      accessorKey: 'amount',
      header: t('customers.field.amount', locale),
      cell: ({ row }) => (row.original.amount === null ? '' : formatMoney(row.original.amount, locale)),
    },
    {
      id: 'followUpOn',
      accessorFn: (row) => row.followUpOn ?? '',
      header: t('customers.col.followUp', locale),
      cell: ({ row }) => {
        const day = row.original.followUpOn;
        if (!day) return '';
        if (!isFollowUpDue(row.original, today)) return <span className="text-muted-foreground">{formatDate(day, locale)}</span>;
        return (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <BellRing aria-hidden="true" className="size-3.5" />
            {formatDate(day, locale)}
            <span className="sr-only">{t('customers.followUp.due', locale)}</span>
          </span>
        );
      },
    },
    ...(wide ? [{
      accessorKey: 'code',
      header: t('customers.field.code', locale),
      cell: ({ row }) => row.original.code ?? '',
    }] : []),
  // startEdit only sets state, so the list's shape changes with the language, the day and the window's width alone.
  ], [locale, today, wide]);

  const filters = useMemo(() => [{
    columnId: 'status',
    label: t('customers.field.status', locale),
    options: ENQUIRY_STATUSES.map((value) => ({ value, label: statusLabel(value, locale) })),
  }], [locale]);

  const places = useMemo(() => Object.entries(totals.byChannel)
    .map(([channel, count]) => ({ place: channelLabel(channel, locale), count }))
    .sort((a, b) => b.count - a.count || a.place.localeCompare(b.place, locale)), [totals, locale]);

  const chartConfig = useMemo(() => ({ count: { label: t('customers.chart.people', locale), color: 'var(--chart-1)' } }), [locale]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={`/customers?month=${addMonths(month, -1)}`} aria-label={t('customers.month.previous', locale)} className={buttonVariants({ variant: 'outline', size: 'icon' })}>
            <ChevronLeft aria-hidden="true" />
          </Link>
          <Link href={`/customers?month=${addMonths(month, 1)}`} aria-label={t('customers.month.next', locale)} className={buttonVariants({ variant: 'outline', size: 'icon' })}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
        <h2 className="text-base font-semibold">{formatMonth(month, locale)}</h2>
        {!today.startsWith(month) && (
          <Link href="/customers" className={buttonVariants({ variant: 'outline' })}>{t('customers.month.this', locale)}</Link>
        )}
        {canAdd && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={exporting || totals.count === 0} onClick={exportMonth}>
              <Download aria-hidden="true" />
              {t('customers.export', locale)}
            </Button>
            <Button type="button" onClick={startAdd}>
              <Plus aria-hidden="true" />
              {t('customers.add', locale)}
            </Button>
          </div>
        )}
      </div>

      {notice && <p role="status" className="text-sm text-muted-foreground">{t(notice, locale)}</p>}
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}

      <CountsLine
        items={[
          { key: 'count', label: t('customers.count.people', locale), value: totals.count },
          { key: 'bought', label: t('customers.count.bought', locale), value: totals.bought },
          { key: 'amount', label: t('customers.count.amount', locale), value: formatMoney(totals.amount, locale) },
        ]}
      />

      {places.length > 0 && (
        <Card className="py-3">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{t('customers.chart.title', locale)}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <ChartContainer config={chartConfig} className={`aspect-auto w-full ${chartHeight(places.length)}`}>
              <BarChart accessibilityLayer data={places} layout="vertical" margin={{ left: 4, right: 12, bottom: 16 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" dataKey="count" allowDecimals={false} tickLine={false} axisLine={false}
                  label={{ value: t('customers.chart.people', locale), position: 'insideBottomRight', offset: -12 }} />
                <YAxis type="category" dataKey="place" width={112} tickLine={false} axisLine={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={rows}
        resetKey={month}
        locale={locale}
        filters={filters}
        searchPlaceholder={t('customers.search', locale)}
        emptyTitle={t('customers.empty', locale)}
        emptyDescription={null}
      />
      <ShowMore locale={locale} pages={pages} />

      <EnquiryDialog
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setEditing(null); }}
        enquiry={editing}
        locale={locale}
        today={today}
        posts={posts}
        networks={networks}
        onDone={done}
      />
    </div>
  );
}
