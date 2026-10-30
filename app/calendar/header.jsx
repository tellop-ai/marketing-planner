'use client';

import { CalendarPlus, ChevronLeft, ChevronRight, Ellipsis, Flag, Printer, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { formatMonth } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { addDays, addMonths, monthOf } from '../../lib/plan/days.js';
import { printPage, usePrintLight } from '../posts/print-light.js';

import { weekTitle } from './format.js';
import { mixWordsKey, monthAddress, weekAddress } from './rules.js';

/**
 * The calendar's top line, as drawn: the month's name, previous and next,
 * Today, Month and Week (links), **Fill my month**, and a small menu with
 * Print this month, Add to my calendar and New campaign. Only the name
 * prints, in the look's light colours (`usePrintLight`, which also serves
 * Print this campaign). Add to my calendar rests, saying why, while the view
 * holds no post (`fileRest`, a words key) and while its file is being made.
 * `mix` (`mixOf` in `rules.js`): when more than one in four of the month's
 * posts sell, one quiet line under the top line says so; none otherwise.
 * `canAdd`: Fill my month, Add to my calendar (it keeps the file it hands
 * over) and New campaign are drawn only for a person who may add; a Viewer
 * keeps the month, the week and Print.
 *
 * @param {{ locale: string, today: string, view: { kind: 'month' | 'week', month: string, day?: string, from: string, to: string },
 *   onFill: () => void, onNewCampaign: () => void, onAddToCalendar: () => void, fileRest: string | null, fileMaking?: boolean,
 *   mix?: { sells: number, of: number } | null, canAdd?: boolean }} props
 */
export function CalendarHeader({ locale, today, view, onFill, onNewCampaign, onAddToCalendar, fileRest, fileMaking = false, mix = null, canAdd = false }) {
  usePrintLight();
  const week = view.kind === 'week';
  const title = week ? weekTitle(view.from, view.to, locale) : formatMonth(view.month, locale);
  const previous = week ? weekAddress(addDays(view.from, -7)) : monthAddress(addMonths(view.month, -1));
  const next = week ? weekAddress(addDays(view.from, 7)) : monthAddress(addMonths(view.month, 1));
  const todayAddress = week ? weekAddress(today) : '/';
  const showsToday = view.from <= today && today <= view.to;
  const monthLink = monthAddress(week ? monthOf(view.day ?? view.from) : view.month);
  const weekLink = weekAddress(week ? view.from : view.month === monthOf(today) ? today : `${view.month}-01`);
  const outline = cn(buttonVariants({ variant: 'outline' }), 'bg-card');
  const outlineIcon = cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'bg-card');

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div data-print-hidden className="flex items-center gap-1">
        <Link href={previous} aria-label={t(week ? 'calendar.previousWeek' : 'calendar.previousMonth', locale)} className={outlineIcon}>
          <ChevronLeft aria-hidden="true" />
        </Link>
        <Link href={next} aria-label={t(week ? 'calendar.nextWeek' : 'calendar.nextMonth', locale)} className={outlineIcon}>
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      <Link data-print-hidden href={todayAddress} aria-current={showsToday ? 'date' : undefined} className={outline}>
        {t('calendar.today', locale)}
      </Link>
      <div data-print-hidden className="ml-auto flex flex-wrap items-center gap-2">
        <Tabs value={view.kind}>
          <TabsList aria-label={t('calendar.view.label', locale)}>
            <TabsTrigger value="month" nativeButton={false} className="px-2.5" render={<Link href={monthLink} />}>
              {t('calendar.view.month', locale)}
            </TabsTrigger>
            <TabsTrigger value="week" nativeButton={false} className="px-2.5" render={<Link href={weekLink} />}>
              {t('calendar.view.week', locale)}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {canAdd && (
          <Button type="button" variant="secondary" onClick={onFill}>
            <Sparkles aria-hidden="true" />
            {t('calendar.fill', locale)}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t('calendar.menu', locale)} />}>
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onClick={printPage}>
              <Printer aria-hidden="true" />
              {t(week ? 'calendar.printWeek' : 'calendar.printMonth', locale)}
            </DropdownMenuItem>
            {canAdd && (
              <DropdownMenuItem disabled={fileRest !== null || fileMaking} onClick={onAddToCalendar}>
                <CalendarPlus aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>{t('calendar.export.add', locale)}</span>
                  {fileRest !== null && <span className="max-w-56 text-xs text-muted-foreground">{t(fileRest, locale)}</span>}
                </span>
              </DropdownMenuItem>
            )}
            {canAdd && (
              <DropdownMenuItem onClick={onNewCampaign}>
                <Flag aria-hidden="true" />
                {t('campaign.new', locale)}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mix && (
        <p data-print-hidden className="basis-full text-sm text-muted-foreground">
          {t(mixWordsKey(mix), locale, { sells: String(mix.sells), count: String(mix.of) })}
        </p>
      )}
    </header>
  );
}
