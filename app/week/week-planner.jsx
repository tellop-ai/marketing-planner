'use client';

import { CalendarPlus, ChevronLeft, ChevronRight, Download, Images, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { dayTitle, weekTitle } from '../calendar/format.js';
import { trackingFor } from '../../lib/plan/share.js';
import { colourOf, coloursOf } from '../calendar/rules.js';
import { useRights } from '../rights.jsx';
import { sendUnconfirmed } from '../send.js';

import { useAddToCalendar, useSaveAllPictures } from './downloads.js';
import { PostRow } from './post-row.jsx';
import { AT_ONCE, calendarWeekAddress, daysWithPosts, missingCount, notReadyKey, shareAddress, weekAddress, weekPost, withPicture, withVersion } from './rules.js';

/**
 * Each post's whole record, read after the page opens (a tile carries no
 * words), at most `AT_ONCE` at a time; a GET only reads. A post whose record
 * could not be read holds `false`.
 *
 * @param {number[]} ids
 */
function useRecords(ids) {
  const [records, setRecords] = useState(() => new Map());
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    const queue = key === '' ? [] : key.split(',').map(Number);
    async function next() {
      while (live && queue.length > 0) {
        const id = queue.shift();
        const answer = await sendUnconfirmed(`/api/posts/${id}`, 'GET');
        if (!live) return;
        const full = answer.ok && answer.value?.post ? answer.value : false;
        setRecords((before) => new Map(before).set(id, full));
      }
    }
    for (let index = 0; index < AT_ONCE; index += 1) next();
    return () => {
      live = false;
    };
  }, [key]);
  return [records, setRecords];
}

/** The posts to open after a whole-week download: "2 pictures were not ready: Autumn mugs, Tea set". */
function NotReadyLine({ locale, notReady }) {
  const count = missingCount(notReady);
  if (count === 0) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {t(notReadyKey(count), locale, { count: String(count) })}{' '}
      {notReady.map((post, index) => (
        <span key={post.id}>
          {index > 0 && ', '}
          <Link href={shareAddress(post.id)} className="font-medium text-foreground underline underline-offset-4">
            {post.name || t('post.untitled', locale)}
          </Link>
        </span>
      ))}
    </p>
  );
}

/** A kept file whose press no longer counted: "Your pictures are ready." (`wordsKey`) and Download. */
function ReadyLine({ locale, wordsKey, address, name }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t(wordsKey, locale)}</span>
      <a href={address} download={name} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'bg-card')}>
        <Download aria-hidden="true" />
        {t('week.download', locale)}
      </a>
    </div>
  );
}

/**
 * The week's top line, as the calendar's: the week's days, previous and next
 * week, This week, then Save all pictures (not drawn when the week holds no
 * picture) and Add to my calendar; under it, what their last press answered,
 * and why Save all pictures rests. Both downloads keep the file they hand
 * over, so they are drawn only for a person who may add (`useRights`).
 *
 * @param {{ locale: string, week: ReturnType<typeof import('./rules.js').weekOf>, empty: boolean,
 *   pictures: ReturnType<typeof useSaveAllPictures>, calendar: ReturnType<typeof useAddToCalendar> }} props
 */
export function WeekHeader({ locale, week, empty, pictures, calendar }) {
  const { add } = useRights();
  const outlineIcon = cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'bg-card');
  const resting = pictures.rest !== null && !pictures.none && !pictures.result;
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">{weekTitle(week.from, week.to, locale)}</h1>
        <div className="flex items-center gap-1">
          {week.previous && (
            <Link href={weekAddress(week.previous)} aria-label={t('calendar.previousWeek', locale)} className={outlineIcon}>
              <ChevronLeft aria-hidden="true" />
            </Link>
          )}
          {week.next && (
            <Link href={weekAddress(week.next)} aria-label={t('calendar.nextWeek', locale)} className={outlineIcon}>
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
        </div>
        <Link href="/week" aria-current={week.thisWeek ? 'date' : undefined} className={cn(buttonVariants({ variant: 'outline' }), 'bg-card')}>
          {t('week.thisWeek', locale)}
        </Link>
        {!empty && add && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {!pictures.none && (
              <Button type="button" variant="outline" disabled={pictures.pending || pictures.rest !== null} onClick={pictures.run} className="bg-card">
                {pictures.pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Images aria-hidden="true" />}
                {t('week.saveAll', locale)}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={calendar.pending} onClick={calendar.run} className="bg-card">
              {calendar.pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <CalendarPlus aria-hidden="true" />}
              {t('week.addCalendar', locale)}
            </Button>
          </div>
        )}
      </header>

      {!empty && add && (resting || pictures.result || calendar.result) && (
        <div className="flex flex-col gap-1.5">
          {resting && (
            <>
              <p className="text-sm text-muted-foreground">{t(pictures.rest, locale)}</p>
              <NotReadyLine locale={locale} notReady={pictures.plan.notReady} />
            </>
          )}
          {pictures.result?.problem && (
            <p role="alert" className="text-sm text-destructive">{t(pictures.result.problem, locale)}</p>
          )}
          {pictures.result?.address && <ReadyLine locale={locale} wordsKey="week.picturesReady" address={pictures.result.address} name={pictures.result.name} />}
          {pictures.result && <NotReadyLine locale={locale} notReady={pictures.result.notReady} />}
          {calendar.result?.problem && (
            <p role="alert" className="text-sm text-destructive">{t(calendar.result.problem, locale)}</p>
          )}
          {calendar.result?.address && <ReadyLine locale={locale} wordsKey="week.calendarReady" address={calendar.result.address} name={calendar.result.name} />}
        </div>
      )}
    </>
  );
}

/**
 * The week's days that hold a post, each post with its platforms' lines
 * (`PostRow`); a week with no post says so and links to the calendar's week.
 *
 * @param {{ locale: string, week: { from: string, days: string[] }, today: string, posts: Array<ReturnType<typeof weekPost>>,
 *   records: Map<number, any>, networks: string[], now: string, colours: Map<number, number>, business: string,
 *   full: boolean, onVersion: (postId: number, version: any) => void, onPicture: (postId: number, picture: any) => void }} props
 */
export function WeekDays({ locale, week, today, posts, records, networks, now, colours, business, full, onVersion, onPicture }) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card/60 p-4">
        <p className="text-sm text-muted-foreground">{t('week.empty', locale)}</p>
        <Link href={calendarWeekAddress(week.from)} className={cn(buttonVariants({ variant: 'outline' }), 'bg-card')}>
          {t('week.openCalendar', locale)}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {daysWithPosts(week.days, posts).map((group) => (
        <section key={group.day} aria-labelledby={`week-day-${group.day}`} className="flex min-w-0 flex-col gap-2.5">
          <h2 id={`week-day-${group.day}`} className="flex items-center gap-2 text-sm font-semibold">
            <time dateTime={group.day}>{dayTitle(group.day, locale)}</time>
            {group.day === today && <Badge>{t('calendar.today', locale)}</Badge>}
          </h2>
          <ul className="flex min-w-0 flex-col gap-3">
            {group.posts.map((post) => (
              <li key={post.id} className="min-w-0">
                <PostRow
                  locale={locale}
                  post={post}
                  record={records.get(post.id)}
                  networks={networks}
                  now={now}
                  colour={colourOf(post.themeId, colours)}
                  business={business}
                  onVersion={onVersion}
                  onPicture={onPicture}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {full && <p className="text-sm text-muted-foreground">{t('week.more', locale, { count: String(posts.length) })}</p>}
    </div>
  );
}

/**
 * This week, as a list to schedule from (`WeekHeader`, `WeekDays`). Each
 * post's record is read after the page opens; a press that marks a platform
 * keeps the version the app answered and works the states out again.
 *
 * @param {{ locale: string, week: ReturnType<typeof import('./rules.js').weekOf>, today: string, now: string, business: string,
 *   networks: string[], themes: Array<{ id: number, colour: number }>, archivedThemes: Array<{ id: number, colour: number }>,
 *   tiles: any[], full: boolean, campaigns?: Array<{ id: number, name: string }>, trackLinks?: boolean | null, profileLink?: string }} props
 */
export function WeekPlanner({ locale, week, today, now, business, networks, themes, archivedThemes, tiles, full, campaigns = [], trackLinks = true, profileLink = '' }) {
  const colours = useMemo(() => coloursOf([...archivedThemes, ...themes]), [themes, archivedThemes]);
  const ids = useMemo(() => tiles.map((tile) => tile.id), [tiles]);
  const [records, setRecords] = useRecords(ids);
  const [moment, setMoment] = useState(now);
  const posts = useMemo(
    // Each post's link tracking (its campaign's or theme's name) goes with it to the words its lines copy.
    () => tiles.map((tile) => ({
      ...weekPost(tile, records.get(tile.id) || null, networks, moment),
      tracking: trackingFor(records.get(tile.id)?.post ?? tile, { trackLinks, themes: [...themes, ...archivedThemes], campaigns, profileLink }),
    })),
    [tiles, records, networks, moment, trackLinks, themes, archivedThemes, campaigns, profileLink],
  );
  const colourFor = useCallback((themeId) => colourOf(themeId, colours), [colours]);
  const pictures = useSaveAllPictures({ locale, from: week.from, posts, colourOf: colourFor, business });
  const calendar = useAddToCalendar({ locale, from: week.from, to: week.to });

  const onVersion = useCallback((postId, version) => {
    setRecords((before) => {
      const held = before.get(postId);
      return held ? new Map(before).set(postId, withVersion(held, version)) : before;
    });
    setMoment(new Date().toISOString());
  }, [setRecords]);

  // A copy kept while a swipe set was saved: the record holds the picture as the app answered it.
  const onPicture = useCallback((postId, picture) => {
    setRecords((before) => {
      const held = before.get(postId);
      return held ? new Map(before).set(postId, withPicture(held, picture)) : before;
    });
  }, [setRecords]);

  return (
    <>
      <WeekHeader locale={locale} week={week} empty={tiles.length === 0} pictures={pictures} calendar={calendar} />
      <WeekDays
        locale={locale}
        week={week}
        today={today}
        posts={posts}
        records={records}
        networks={networks}
        now={moment}
        colours={colours}
        business={business}
        full={full}
        onVersion={onVersion}
        onPicture={onPicture}
      />
    </>
  );
}
