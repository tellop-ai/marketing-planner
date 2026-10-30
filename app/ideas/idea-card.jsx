'use client';

import { CalendarPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { civilDay, partsOf } from '../../lib/plan/days.js';
import { send } from '../send.js';

import { dotClass } from './groups.js';

/** A civil day as the calendar's date (noon, so no clock change moves it). @param {string} day */
function dateOf(day) {
  const { year, month, day: date } = partsOf(day);
  return new Date(year, month - 1, date, 12);
}

/**
 * One idea: its theme's dot, its name, Pick a day (a calendar in a small
 * window; the chosen day is saved at once and the idea moves to the
 * calendar), Open (the post maker) and Delete (the page asks first). Pick a
 * day and Delete change the idea: drawn only while `canChange`.
 *
 * @param {{ idea: { id: number, name: string, themeId: number | null }, colour: number | null, locale: string,
 *   today: string, calendarLocale: object, canChange?: boolean, onMoved: (idea: object, day: string) => void,
 *   onDelete: (idea: object) => void }} props
 */
export function IdeaCard({ idea, colour, locale, today, calendarLocale, canChange = false, onMoved, onDelete }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const name = idea.name || t('post.untitled', locale);

  /** @param {Date | undefined} date */
  async function pick(date) {
    if (!date || pending) return;
    const day = civilDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
    setPending(true);
    setProblem(null);
    const sent = await send(`/api/posts/${idea.id}`, 'PATCH', { day });
    setPending(false);
    if (!sent.ok || sent.value?.post?.day !== day) {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    setOpen(false);
    onMoved(idea, day);
  }

  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-dashed border-input bg-card p-3">
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden="true" className={cn('mt-1.5 inline-block size-2 shrink-0 rounded-full', dotClass(colour))} />
        <p className="line-clamp-3 min-w-0 flex-1 font-medium break-words">{name}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {canChange && (
          <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setProblem(null); }}>
            <PopoverTrigger render={<Button type="button" variant="outline" size="sm" disabled={pending} />}>
              <CalendarPlus aria-hidden="true" />
              {t('ideas.pickDay', locale)}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                locale={calendarLocale}
                defaultMonth={dateOf(today)}
                disabled={pending}
                onSelect={pick}
              />
              {problem && <p role="alert" className="max-w-64 px-3 pb-3 text-sm text-destructive">{t(problem, locale)}</p>}
            </PopoverContent>
          </Popover>
        )}
        <a href={`/posts/${idea.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          {t('ideas.open', locale)}
        </a>
        {canChange && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground"
            aria-label={t('ideas.remove', locale)}
            onClick={() => onDelete(idea)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>
    </li>
  );
}
