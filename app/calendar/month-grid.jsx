'use client';

import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';

import { dayNumber, dayTitle, weekdayNames } from './format.js';
import { barReach, campaignBars, colourOf, REACH_WIDTH, WIDE_NAME } from './rules.js';
import { PostTile, ProposalTile, specialHint, specialIcon, specialName } from './tiles.jsx';

/** @template T @param {T[]} list @param {(item: T) => string | null} keyOf */
function byDay(list, keyOf) {
  const map = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (key === null) continue;
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

/**
 * The month as drawn: whole weeks, each day with its number (today filled),
 * its special day, the campaigns that run on it as thin bars across its top
 * (a bar's name, at the start of each week row it runs in, reads across the
 * days it runs on there), then its posts as tiles. Pressing a day opens its sheet; a tile opens its
 * post; a bar opens its campaign. Days of the weeks around the month are
 * muted and empty. On a phone a tile shows only its picture; on paper every
 * name prints (a special day's on its own line under the day's number, a
 * campaign bar as high as its name needs).
 *
 * @param {{ locale: string, today: string, cells: Array<{ day: string, inMonth: boolean }>, tiles: object[],
 *   proposals: Array<{ day: string, name: string }>, specialDays: Array<{ key: string, day: string, kind: string, name?: string, nameKey?: string, hintKey?: string | null }>,
 *   campaigns: Array<{ id: number, name: string, startsOn: string, endsOn: string }>, colours: Map<number, number>, business: string,
 *   onOpenDay: (day: string) => void, onOpenCampaign: (id: number) => void }} props
 */
export function MonthGrid({ locale, today, cells, tiles, proposals, specialDays, campaigns, colours, business, onOpenDay, onOpenCampaign }) {
  const names = weekdayNames(cells.slice(0, 7).map((cell) => cell.day), locale);
  const tilesByDay = useMemo(() => byDay(tiles, (tile) => tile.day), [tiles]);
  const proposalsByDay = useMemo(() => byDay(proposals, (item) => item.day), [proposals]);
  const specialByDay = useMemo(() => byDay(specialDays, (item) => item.day), [specialDays]);
  const inMonth = useMemo(() => new Set(cells.filter((cell) => cell.inMonth).map((cell) => cell.day)), [cells]);
  const days = useMemo(() => cells.map((cell) => cell.day), [cells]);
  const bars = useMemo(() => campaignBars(campaigns, days, (day) => inMonth.has(day)), [campaigns, days, inMonth]);

  /** The lanes a week row keeps for bars, so its days' numbers line up. @param {number} row */
  const rowLanes = (row) => {
    let most = 0;
    for (const cell of cells.slice(row * 7, row * 7 + 7)) {
      for (const bar of bars.byDay.get(cell.day) ?? []) most = Math.max(most, bar.lane + 1);
    }
    return most;
  };

  return (
    <section data-slot="month-planner" aria-label={t('calendar.view.month', locale)} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card/60 text-foreground">
      <div className="grid grid-cols-7 [&>div:nth-child(7n+1)]:border-l-0">
        {names.map((name, index) => (
          <div key={`head-${index}`} className="truncate p-2 text-center text-xs text-muted-foreground">{name}</div>
        ))}
        {cells.map((cell, index) => {
          if (!cell.inMonth) {
            return <div key={cell.day} aria-hidden="true" className="min-h-16 border-t border-l border-border bg-muted/30 lg:min-h-28" />;
          }
          const day = cell.day;
          const isToday = day === today;
          const dayTiles = tilesByDay.get(day) ?? [];
          const dayProposals = proposalsByDay.get(day) ?? [];
          const special = specialByDay.get(day) ?? [];
          const first = special[0];
          const Icon = first ? specialIcon(first) : null;
          const remembrance = special.find((item) => item.kind === 'remembrance');
          const lanes = rowLanes(Math.floor(index / 7));
          const dayBars = bars.byDay.get(day) ?? [];
          return (
            <div key={day} className={cn('relative min-h-16 min-w-0 border-t border-l border-border p-1 sm:p-1.5 lg:min-h-28', isToday && 'bg-accent/50')}>
              <Button
                type="button"
                variant="ghost"
                data-print-hidden
                aria-label={t('calendar.day.open', locale, { day: dayTitle(day, locale) })}
                title={remembrance ? specialHint(remembrance, locale) : undefined}
                onClick={() => onOpenDay(day)}
                className="absolute inset-0 size-auto rounded-none hover:bg-muted/40"
              />
              {lanes > 0 && (
                <div className="pointer-events-none relative -mx-1 -mt-1 mb-1 flex flex-col gap-px sm:-mx-1.5 sm:-mt-1.5">
                  {Array.from({ length: lanes }, (_, lane) => {
                    const bar = dayBars.find((item) => item.lane === lane);
                    if (!bar) return <span key={lane} aria-hidden="true" className="h-4" />;
                    return (
                      <Button
                        key={lane}
                        type="button"
                        variant="secondary"
                        size="xs"
                        tabIndex={bar.named ? 0 : -1}
                        aria-label={t('calendar.campaign.open', locale, { name: bar.name })}
                        onClick={() => onOpenCampaign(bar.id)}
                        className={cn(
                          'pointer-events-auto relative h-4 justify-start rounded-none bg-primary/15 px-1 text-[10px] font-medium text-primary hover:bg-primary/25 print:h-auto print:min-h-4',
                          bar.first && 'ml-1 rounded-l-md',
                          bar.last && 'mr-1 rounded-r-md',
                        )}
                      >
                        {bar.named && (
                          <span
                            className={cn(
                              'pointer-events-none absolute top-0 left-1 z-10 h-4 truncate text-left leading-4 print:static print:h-auto print:w-auto',
                              REACH_WIDTH[barReach(bars.byDay, days, index, bar.id) - 1] ?? REACH_WIDTH[0],
                            )}
                          >
                            {bar.name}
                          </span>
                        )}
                      </Button>
                    );
                  })}
                </div>
              )}
              <div className="pointer-events-none relative flex min-w-0 items-center gap-1 print:flex-wrap">
                <time
                  dateTime={day}
                  className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-xs', isToday ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground')}
                >
                  {dayNumber(day)}
                </time>
                {first && (
                  <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground print:basis-full">
                    <Icon aria-hidden="true" className="size-3 shrink-0" />
                    <span className={cn('truncate', WIDE_NAME)}>{specialName(first, locale)}</span>
                  </span>
                )}
              </div>
              {(dayTiles.length > 0 || dayProposals.length > 0) && (
                <ul className="pointer-events-none relative mt-1 flex flex-col gap-1">
                  {dayTiles.map((tile) => (
                    <li key={tile.id} className="pointer-events-auto min-w-0 @container">
                      <PostTile tile={tile} colour={colourOf(tile.themeId, colours)} business={business} locale={locale} names="wide" />
                    </li>
                  ))}
                  {dayProposals.map((proposal, at) => (
                    <li key={`proposal-${at}`} className="min-w-0 @container">
                      <ProposalTile proposal={proposal} names="wide" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
