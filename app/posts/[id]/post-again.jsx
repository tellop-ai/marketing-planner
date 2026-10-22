'use client';

import { enUS, tr } from 'date-fns/locale';
import { LoaderCircle, Repeat2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { t } from '../../../lib/i18n/index.js';
import { isCivilDay } from '../../../lib/plan/days.js';

import { send } from '../../send.js';
import { postAddress } from './addresses.js';
import { dateOfDay, dayOfDate } from './rules.js';

/**
 * Post again: the kit's calendar on the first day from today that holds no
 * post (the app answers it when the window opens; today until then), and
 * **Make the copy**, which asks the app for a copy of this post on the day
 * picked (its name, main words, theme, campaign, ask, video plan, hashtags,
 * links and pictures; never its words for each network, its shares or its
 * results) and opens the copy. The press rests while the first free day is
 * being read and while the copy is being made; a refusal shows as a line and
 * the window stays open.
 *
 * @param {{ locale: string, postId: number, today: string, open: boolean, onClose: () => void }} props
 */
export function PostAgainDialog({ locale, postId, today, open, onClose }) {
  const router = useRouter();
  const [day, setDay] = useState(/** @type {string | null} */ (null));
  const [shown, setShown] = useState(() => dateOfDay(today) ?? new Date());
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  // Each time the window opens: the first free day, read afresh (the calendar may have changed since).
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setDay(null);
    setProblem(null);
    setShown(dateOfDay(today) ?? new Date());
    send(postAddress(postId, '/copy'), 'GET').then((answer) => {
      if (!live) return;
      const found = answer.ok && isCivilDay(answer.value?.day) ? answer.value.day : today;
      setDay(found);
      setShown(dateOfDay(found) ?? new Date());
    });
    return () => {
      live = false;
    };
  }, [open, postId, today]);

  async function make() {
    if (working || day === null) return;
    setWorking(true);
    setProblem(null);
    const answer = await send(postAddress(postId, '/copy'), 'POST', { day });
    if (!answer.ok || !Number.isSafeInteger(answer.value?.id)) {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      setWorking(false);
      return;
    }
    router.push(`/posts/${answer.value.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat2 aria-hidden="true" className="size-4 text-muted-foreground" />
            {t('maker.again', locale)}
          </DialogTitle>
        </DialogHeader>
        <div className="-mx-4 flex min-h-0 flex-1 justify-center overflow-y-auto px-4">
          <Calendar
            mode="single"
            required
            className="bg-transparent"
            selected={dateOfDay(day)}
            month={shown}
            onMonthChange={setShown}
            locale={locale === 'tr' ? tr : enUS}
            disabled={working}
            onSelect={(date) => {
              const picked = dayOfDate(date);
              if (picked !== null) setDay(picked);
            }}
          />
        </div>
        {problem !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t(problem, locale)}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={working} onClick={onClose}>
            {t('maker.cancel', locale)}
          </Button>
          <Button type="button" disabled={working || day === null} onClick={make}>
            {(working || day === null) && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {t('maker.again.make', locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
