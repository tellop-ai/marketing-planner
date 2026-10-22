'use client';

import { Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { networkByKey } from '../../lib/plan/networks.js';
import { PictureThumb } from '../pictures/thumb.jsx';

import { dayNumber, dayTitle, timeText, weekdayNames } from './format.js';
import { colourOf, THEME_EDGE } from './rules.js';
import { sendUnconfirmed } from '../send.js';
import { ProposalTile, specialIcon, specialName, StateMark, stateWords } from './tiles.jsx';

/** The most posts whose first line the week reads, one post at a time. */
const MOST_LINES = 40;
/** Reads in flight at once. */
const AT_ONCE = 3;

/** The first line of a post's words: its own words, else the first network's. @param {any} full */
function firstLineOf(full) {
  const words = typeof full?.post?.mainText === 'string' && full.post.mainText.trim() !== ''
    ? full.post.mainText
    : (Array.isArray(full?.versions) ? full.versions.find((version) => version.on && version.text.trim() !== '')?.text : '') ?? '';
  return words.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

/**
 * The first line of each post's words. A list read never carries a post's
 * words (they can be long), so the week asks for each post on its own after it
 * opens, a few at a time; a GET only reads.
 *
 * @param {number[]} ids
 */
function useFirstLines(ids) {
  const [lines, setLines] = useState(() => new Map());
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    const queue = key === '' ? [] : key.split(',').map(Number).slice(0, MOST_LINES);
    async function next() {
      while (live && queue.length > 0) {
        const id = queue.shift();
        const answer = await sendUnconfirmed(`/api/posts/${id}`, 'GET');
        if (!live) return;
        if (answer.ok) setLines((before) => new Map(before).set(id, firstLineOf(answer.value)));
      }
    }
    for (let index = 0; index < AT_ONCE; index += 1) next();
    return () => {
      live = false;
    };
  }, [key]);
  return lines;
}

/**
 * The week as a list, for a narrow window and for printing: the seven days as
 * rows, each post with its picture, time, network marks, name and the first
 * line of its words. Pressing a day opens its sheet.
 *
 * @param {{ locale: string, today: string, days: string[], tiles: object[], proposals: Array<{ day: string, name: string }>,
 *   specialDays: object[], colours: Map<number, number>, business: string, onOpenDay: (day: string) => void }} props
 */
export function WeekView({ locale, today, days, tiles, proposals, specialDays, colours, business, onOpenDay }) {
  const names = weekdayNames(days, locale);
  const ids = useMemo(() => tiles.filter((tile) => tile.state !== 'idea').map((tile) => tile.id), [tiles]);
  const lines = useFirstLines(ids);
  return (
    <section aria-label={t('calendar.view.week', locale)} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card/60">
      {days.map((day, index) => {
        const isToday = day === today;
        const dayTiles = tiles.filter((tile) => tile.day === day);
        const dayProposals = proposals.filter((item) => item.day === day);
        const special = specialDays.filter((item) => item.day === day);
        return (
          <div key={day} className={cn('flex min-w-0 flex-col gap-2 border-t border-border p-3 first:border-t-0 sm:flex-row sm:gap-4', isToday && 'bg-accent/50')}>
            <div className="flex shrink-0 flex-col gap-1 sm:w-36">
              <Button
                type="button"
                variant="ghost"
                aria-label={t('calendar.day.open', locale, { day: dayTitle(day, locale) })}
                onClick={() => onOpenDay(day)}
                className="h-auto w-fit justify-start gap-2 px-1.5 py-1"
              >
                <time
                  dateTime={day}
                  className={cn('inline-flex size-7 items-center justify-center rounded-lg text-sm', isToday ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground')}
                >
                  {dayNumber(day)}
                </time>
                <span className="text-sm text-muted-foreground">{names[index]}</span>
              </Button>
              {special.map((item) => {
                const Icon = specialIcon(item);
                return (
                  <span key={item.key} className="flex min-w-0 items-center gap-1 px-1.5 text-xs text-muted-foreground">
                    <Icon aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{specialName(item, locale)}</span>
                  </span>
                );
              })}
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-2">
              {dayTiles.map((tile) => (
                <li key={tile.id} className="min-w-0">
                  <WeekTile tile={tile} colour={colourOf(tile.themeId, colours)} line={lines.get(tile.id) ?? ''} business={business} locale={locale} />
                </li>
              ))}
              {dayProposals.map((proposal, at) => (
                <li key={`proposal-${at}`} className="min-w-0">
                  <ProposalTile proposal={proposal} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** A larger tile: picture, time and network marks, name, first line of the words. */
function WeekTile({ tile, colour, line, business, locale }) {
  const name = tile.name || t('post.untitled', locale);
  const idea = tile.state === 'idea';
  const marks = tile.networks.map((key) => networkByKey(key)).filter(Boolean);
  return (
    <Link
      href={`/posts/${tile.id}`}
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-lg p-2 text-sm outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
        idea ? 'border border-dashed border-input text-muted-foreground' : cn('border-l-[3px] bg-card ring-1 ring-foreground/10', colour === null ? 'border-l-input' : THEME_EDGE[colour]),
      )}
    >
      <span className={cn('relative size-14 shrink-0 overflow-hidden rounded-md', idea && 'inline-flex items-center justify-center bg-muted')}>
        {idea ? (
          <Lightbulb aria-hidden="true" className="size-5" />
        ) : (
          <PictureThumb picture={tile.picture} themeColour={colour} business={business} locale={locale} alt="" />
        )}
        <StateMark state={tile.state} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {tile.time && <span className="tabular-nums">{timeText(tile.time, locale)}</span>}
          <span className="sr-only">{stateWords(tile, locale)}</span>
          {marks.map((network) => (
            <abbr key={network.key} title={network.name} className="rounded-sm bg-muted px-1 py-px text-[10px] font-medium no-underline">
              {network.mark}
            </abbr>
          ))}
        </span>
        <span className={cn('truncate', !idea && 'font-medium', tile.state === 'shared' && 'font-normal text-muted-foreground')}>{name}</span>
        {line && <span className="truncate text-xs text-muted-foreground">{line}</span>}
      </span>
    </Link>
  );
}
