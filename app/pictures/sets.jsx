'use client';

import { ArrowLeft, ArrowRight, Ellipsis, Plus, Sparkles, X } from 'lucide-react';
import { useId, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { networkByKey } from '../../lib/plan/networks.js';

import { addToSet, canMakeSet, moveInSet, pictureWords, replacesSet, setChoices, setCutLines, setFull, setOf, takeOutOfSet, tipPlace } from './rules.js';
import { PictureThumb } from './thumb.jsx';

/** Each set's words and look: its title, its Make press, the shape of its tiles. */
const SET_LOOK = Object.freeze({
  slide: { title: 'pictures.setSlide', make: 'pictures.makeSlides', making: 'pictures.makingSlides', full: 'refuse.picture.slidesFull', ask: 'pictures.replaceSlidesAsk', tile: 'aspect-square', grid: 'grid-cols-5' },
  story: { title: 'pictures.setStory', make: 'pictures.makeStory', making: 'pictures.makingStory', full: 'refuse.picture.storyFull', ask: 'pictures.replaceStoryAsk', tile: 'aspect-[9/16]', grid: 'grid-cols-6' },
});

/** Names joined as a sentence lists them ("X and Bluesky", "X ve Bluesky"). */
function namesOf(keys, locale) {
  const names = keys.map((key) => networkByKey(key)?.name ?? key);
  return new Intl.ListFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { style: 'long', type: 'conjunction' }).format(names);
}

/**
 * One of a post's sets of pictures, under the picture strip: the **Swipe post** (`slide`: the pictures that go together in one post,
 * the first is the cover, the post's chosen picture) or the **Story**
 * (`story`: tall frames). Its pictures as small tiles in order, each with its
 * number under it (outside the picture, so its words show whole) and a menu
 * (one place earlier, one place later, take out); **Add** (one of the post's
 * other pictures, while the set has room); and **Make slides** / **Make a
 * story** (the AI writes the set's words pictures; without AI the post's own
 * sentences, only while there is no set yet), with a busy tile while it
 * works. Make asks first ("Replace these slides?") when it would replace
 * pictures the set holds (`replacesSet`).
 *
 * Every press goes up to the strip (`onOrder` with the set's new order,
 * `onMake`), which runs one press at a time and hands back the post as
 * saved. While the strip works, everything here rests. Make rests with its
 * reason when the post has no words or no room for the pictures it makes; a
 * full set rests Add with its reason. Under the swipe set: a line for each
 * network that takes fewer pictures than the set holds. `quiet`: Make's
 * reason is not said again here (the swipe set above says the same).
 *
 * @param {{ kind: 'slide' | 'story', post: any, networks: string[], hasWords: boolean, themeColour?: number | null,
 *   business?: string, locale: string, resting: boolean, work: string | null, note?: string | null, quiet?: boolean,
 *   onOrder: (kind: 'slide' | 'story', ids: number[]) => void, onMake: (kind: 'slide' | 'story') => void }} props
 */
export function PictureSet({ kind, post, networks, hasWords, themeColour, business, locale, resting, work, note = null, quiet = false, onOrder, onMake }) {
  const look = SET_LOOK[kind];
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const pictures = setOf(post, kind);
  const choices = setChoices(post, kind);
  const full = setFull(post, kind);
  const make = canMakeSet(post, kind, hasWords);
  const makingHere = work === `make:${kind}`;
  const ordering = work === `set:${kind}`;
  const cuts = kind === 'slide' ? setCutLines(post, networks) : [];

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
      <h3 id={titleId} className="font-sans text-sm font-medium">
        {t(look.title, locale)}
      </h3>
      {(pictures.length > 0 || makingHere) && (
      <div className={cn('grid gap-2', look.grid)}>
        {pictures.map((picture, index) => {
          const words = pictureWords(picture);
          const label = words === ''
            ? t('pictures.setNumber', locale, { n: String(index + 1) })
            : t('pictures.setNumberWith', locale, { n: String(index + 1), description: words });
          return (
            <div key={picture.id} className="flex min-w-0 flex-col items-center gap-1">
            <div className={cn('group/set relative w-full min-w-0 overflow-hidden rounded-lg ring-1 ring-foreground/10', look.tile)}>
              <span className="sr-only">{label}</span>
              <PictureThumb picture={picture} shape={kind === 'story' ? 'story' : 'square'} themeColour={themeColour} business={business} locale={locale} alt="" wordsFirst place={tipPlace(post, picture)} />
              {ordering && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
                  <Spinner role="presentation" aria-label={undefined} className="size-4 text-primary" />
                </span>
              )}
              {!resting && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-xs"
                        aria-label={t('pictures.setMenu', locale, { n: String(index + 1) })}
                        className="absolute right-1 bottom-1 rounded-full shadow-sm opacity-0 group-hover/set:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                      />
                    }
                  >
                    <Ellipsis aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto">
                    {index > 0 && (
                      <DropdownMenuItem onClick={() => onOrder(kind, moveInSet(post, kind, picture.id, -1))}>
                        <ArrowLeft aria-hidden="true" />
                        {t('pictures.setEarlier', locale)}
                      </DropdownMenuItem>
                    )}
                    {index < pictures.length - 1 && (
                      <DropdownMenuItem onClick={() => onOrder(kind, moveInSet(post, kind, picture.id, 1))}>
                        <ArrowRight aria-hidden="true" />
                        {t('pictures.setLater', locale)}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onOrder(kind, takeOutOfSet(post, kind, picture.id))}>
                      <X aria-hidden="true" />
                      {t('pictures.setTakeOut', locale)}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <span aria-hidden="true" className="text-xs font-medium text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            </div>
          );
        })}

        {makingHere && (
          <div aria-hidden="true" className={cn('flex min-w-0 flex-col items-center justify-center gap-1 self-start rounded-lg bg-muted px-1 text-center text-xs font-medium text-muted-foreground ring-1 ring-foreground/10', look.tile)}>
            <Spinner role="presentation" aria-label={undefined} className="size-4 text-primary" />
            <span className="max-w-full truncate">{t('pictures.making', locale)}</span>
          </div>
        )}
      </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={resting || !make.ok} onClick={() => {
            if (!make.ok) return;
            if (replacesSet(post, kind)) setAsking(true);
            else onMake(kind);
          }} className="bg-card text-primary hover:text-primary">
          {makingHere ? <Spinner role="presentation" aria-label={undefined} /> : <Sparkles aria-hidden="true" />}
          {t(look.make, locale)}
        </Button>
        {choices.length > 0 && (
          <Button type="button" variant="outline" size="sm" disabled={resting || full} onClick={() => setAdding(true)} className="bg-card">
            <Plus aria-hidden="true" />
            {t('pictures.setAdd', locale)}
          </Button>
        )}
      </div>

      <p role="status" className="sr-only">{makingHere ? t(look.making, locale) : ''}</p>
      {!make.ok && !quiet && <p className="text-sm text-muted-foreground">{t(make.reason, locale, { n: String(LIMITS.picturesPerPost) })}</p>}
      {full && choices.length > 0 && <p className="text-sm text-muted-foreground">{t(look.full, locale)}</p>}
      {cuts.map((cut) => (
        <p key={cut.most} className="text-sm text-muted-foreground">
          {cut.most === 1
            ? t('pictures.setCutOne', locale, { networks: namesOf(cut.networks, locale) })
            : t('pictures.setCut', locale, { networks: namesOf(cut.networks, locale), n: String(cut.most) })}
        </p>
      ))}
      {note !== null && <p role="status" className="text-sm text-muted-foreground">{note}</p>}

      <AlertDialog
        open={asking}
        onOpenChange={(next) => {
          if (!next) setAsking(false);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t(look.ask, locale)}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('pictures.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAsking(false);
                onMake(kind);
              }}
            >
              {t('maker.replace', locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {adding && (
        <AddToSet
          kind={kind}
          post={post}
          choices={choices}
          themeColour={themeColour}
          business={business}
          locale={locale}
          onPick={(pictureId) => {
            const ids = addToSet(post, kind, pictureId);
            setAdding(false);
            if (ids !== null) onOrder(kind, ids);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

/** The post's pictures that are not in the set: a press on one adds it at the end. */
function AddToSet({ kind, post, choices, themeColour, business, locale, onPick, onClose }) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t(kind === 'story' ? 'pictures.setAddStory' : 'pictures.setAddSlide', locale)}</DialogTitle>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
          <div className="grid grid-cols-3 gap-3 p-1">
            {choices.map((picture) => {
              const words = pictureWords(picture);
              const n = String((post?.pictures ?? []).indexOf(picture) + 1);
              return (
                <Button
                  key={picture.id}
                  type="button"
                  variant="ghost"
                  aria-label={words === '' ? t('pictures.number', locale, { n }) : t('pictures.numberWith', locale, { n, description: words })}
                  onClick={() => onPick(picture.id)}
                  className="aspect-square size-full overflow-hidden rounded-xl p-0 ring-1 ring-foreground/10 hover:bg-transparent hover:ring-primary"
                >
                  <PictureThumb picture={picture} themeColour={themeColour} business={business} locale={locale} alt="" wordsFirst place={tipPlace(post, picture)} />
                </Button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
