'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { t } from '../../lib/i18n/index.js';
import { NewPostButton } from '../new-post-button.jsx';

import { dayTitle } from './format.js';
import { colourOf, specialPostBody } from './rules.js';
import { sendUnconfirmed } from '../send.js';
import { PostTile, ProposalTile, specialHint, specialIcon, specialName } from './tiles.jsx';

/**
 * One day, in a sheet: its special days with their suggestion, its posts and
 * any proposed ideas, **New post for <day>** for a special day and **New post
 * on this day**. Opening it reads nothing and saves nothing.
 *
 * @param {{ locale: string, day: string | null, tiles: object[], proposals: Array<{ day: string, name: string }>,
 *   specialDays: object[], colours: Map<number, number>, business: string, onClose: () => void }} props
 */
export function DaySheet({ locale, day, tiles, proposals, specialDays, colours, business, onClose }) {
  return (
    <Sheet open={day !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="max-h-dvh w-full sm:max-w-sm">
        {day !== null && (
          <DayBody
            locale={locale}
            day={day}
            tiles={tiles.filter((tile) => tile.day === day)}
            proposals={proposals.filter((item) => item.day === day)}
            specialDays={specialDays.filter((item) => item.day === day)}
            colours={colours}
            business={business}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function DayBody({ locale, day, tiles, proposals, specialDays, colours, business }) {
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>{dayTitle(day, locale)}</SheetTitle>
      </SheetHeader>
      <div className="-mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        {specialDays.map((special) => (
          <SpecialDay key={special.key} locale={locale} day={day} special={special} />
        ))}
        {(tiles.length > 0 || proposals.length > 0) && (
          <ul className="flex flex-col gap-2">
            {tiles.map((tile) => (
              <li key={tile.id}>
                <PostTile tile={tile} colour={colourOf(tile.themeId, colours)} business={business} locale={locale} />
              </li>
            ))}
            {proposals.map((proposal, at) => (
              <li key={`proposal-${at}`}>
                <ProposalTile proposal={proposal} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <SheetFooter>
        <NewPostButton locale={locale} day={day} label={t('calendar.day.newPost', locale)} className="w-full" />
      </SheetFooter>
    </>
  );
}

/**
 * A special day with its line and New post for it, which starts the post's
 * words box with the day's suggestion (not on a day of remembrance).
 */
function SpecialDay({ locale, day, special }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const Icon = specialIcon(special);
  const name = specialName(special, locale);
  const hint = specialHint(special, locale);

  async function make() {
    setPending(true);
    setProblem(null);
    const sent = await sendUnconfirmed('/api/posts', 'POST', specialPostBody({ day, special, name, hint }));
    if (!sent.ok || typeof sent.value?.post?.id !== 'number') {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      setPending(false);
      return;
    }
    router.push(`/posts/${sent.value.post.id}`);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
      <div className="flex min-w-0 items-center gap-2 font-medium">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words">{name}</span>
      </div>
      {hint && <p className="text-muted-foreground">{hint}</p>}
      <Button type="button" variant="outline" className="w-fit max-w-full bg-card" disabled={pending} onClick={make}>
        <Plus aria-hidden="true" />
        <span className="truncate">{t('calendar.day.newFor', locale, { name })}</span>
      </Button>
      {problem && <p role="alert" className="text-xs text-destructive">{t(problem, locale)}</p>}
    </div>
  );
}
