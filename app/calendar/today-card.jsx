'use client';

import { Send } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { PictureThumb } from '../pictures/thumb.jsx';
import { useRights } from '../rights.jsx';

import { FollowUpsList } from './follow-ups-list.jsx';
import { shortDay, timeText } from './format.js';
import { goalWordsKey } from './rules.js';

/**
 * The week's goal: one dot per post My plan wants a week, filled for each
 * post of this week shared on any of its networks, and "1 of 3 shared".
 *
 * @param {{ locale: string, goal: { goal: number, shared: number, filled: number }, className?: string }} props
 */
function WeekGoal({ locale, goal, className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
      <span className="text-muted-foreground">{t('calendar.week.label', locale)}</span>
      <span aria-hidden="true" className="flex flex-wrap gap-1">
        {Array.from({ length: goal.goal }, (_, index) => (
          <span key={index} className={cn('size-3 rounded-full', index < goal.filled ? 'bg-primary' : 'bg-muted ring-1 ring-primary/40')} />
        ))}
      </span>
      <span className="font-medium">{t(goalWordsKey(goal.goal), locale, { shared: String(goal.shared), goal: String(goal.goal) })}</span>
    </div>
  );
}

/**
 * The Share today card, as drawn: the post due today (or the latest one due
 * before today and not shared yet) with its picture, "Share today · 18:30",
 * its name and **Share**, which opens the post on its share part; the week's
 * goal on its right. With no post due, only the goal, smaller. Under them,
 * the people to follow up with today (`FollowUpsList`), when there are any.
 * A person who may not change the post (marking it shared changes it) gets
 * **Open the post** in place of Share.
 *
 * @param {{ locale: string, today: string, due: { id: number, name: string, day: string, time: string | null, picture: object | null } | null,
 *   colour: number | null, goal: { goal: number, shared: number, filled: number }, business: string,
 *   followUps?: Array<{ id: number, name: string, contact: string, askedAbout: string, followUpOn: string }> | null }} props
 */
export function TodayCard({ locale, today, due, colour, goal, business, followUps }) {
  const { change } = useRights();
  const people = Array.isArray(followUps) && followUps.length > 0
    ? <FollowUpsList locale={locale} today={today} business={business} followUps={followUps} className="border-t border-border px-3 pt-2.5" />
    : null;
  if (!due) {
    return (
      <Card data-print-hidden className="gap-2.5 py-2.5">
        <div className="flex px-3">
          <WeekGoal locale={locale} goal={goal} />
        </div>
        {people}
      </Card>
    );
  }
  const when = due.day === today ? t('calendar.shareToday', locale) : t('calendar.dueOn', locale, { day: shortDay(due.day, locale) });
  const name = due.name || t('post.untitled', locale);
  return (
    <Card data-print-hidden className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3">
        <div className="flex min-w-0 items-center gap-4">
          <span className="size-14 shrink-0 overflow-hidden rounded-lg">
            <PictureThumb picture={due.picture} themeColour={colour} business={business} locale={locale} alt="" />
          </span>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{due.time ? `${when} · ${timeText(due.time, locale)}` : when}</div>
            <div className="line-clamp-2 text-base font-semibold break-words">{name}</div>
          </div>
          {change ? (
            <Link href={`/posts/${due.id}#share`} className={cn(buttonVariants(), 'ml-2')}>
              <Send aria-hidden="true" />
              {t('calendar.share', locale)}
            </Link>
          ) : (
            <Link href={`/posts/${due.id}`} className={cn(buttonVariants({ variant: 'outline' }), 'ml-2')}>
              {t('week.openPost', locale)}
            </Link>
          )}
        </div>
        <WeekGoal locale={locale} goal={goal} className="sm:ml-auto" />
      </div>
      {people}
    </Card>
  );
}
