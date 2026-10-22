'use client';

import { Check, Clock, Coffee, Contrast, Globe, Lightbulb, PartyPopper, Ribbon, ShoppingBag, Sparkles, Star } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { PictureThumb } from '../pictures/thumb.jsx';
import { THEME_BACKGROUNDS } from '../theme-colours.js';

import { stateWordsOf, THEME_EDGE, WIDE_NAME } from './rules.js';

/** A post's state in words ("Scheduled", "1 of 3 shared, 1 scheduled"): `stateWordsOf`. @param {object} tile @param {string} locale */
export function stateWords(tile, locale) {
  const { key, values } = stateWordsOf(tile);
  return t(key, locale, values);
}

/** The mark on a post's picture for its state: a check when shared, a clock when scheduled, a half mark when partly. */
const STATE_MARKS = Object.freeze({ shared: Check, scheduled: Clock, partly: Contrast });

/** @param {{ state: string, className?: string }} props */
export function StateMark({ state, className }) {
  const Mark = STATE_MARKS[state];
  if (!Mark) return null;
  return (
    <span className={cn('absolute right-0 bottom-0 inline-flex items-center justify-center rounded-tl-md bg-primary text-primary-foreground', className)}>
      <Mark aria-hidden="true" className="size-2.5" />
    </span>
  );
}

/** A grid tile: picture and name side by side when the day holds both (7.5rem), else the name under the picture. */
const WIDE_LAYOUT = 'flex-col items-start gap-1 @[7.5rem]:flex-row @[7.5rem]:items-center @[7.5rem]:gap-2';

/**
 * A post on the calendar: its chosen picture as a small square, its name in
 * two lines at most and its theme's colour on the left edge. A shared post
 * has a check on its picture, a scheduled one (every network shared or
 * scheduled, one still ahead) a clock, a post shared on some of its networks
 * a half mark; an idea is a dashed tile with a light bulb. It opens the post.
 *
 * `names`: `wide` is the month grid's tile. Its name shows only on a wide
 * window and on paper (a phone's columns hold just the picture), and it sits under the
 * picture when the day is too narrow to hold both side by side (the tile's
 * parent is a `@container`). `always` shows the name beside the picture.
 *
 * @param {{ tile: { id: number, name: string, state: string, shared?: number, of?: number, picture: object | null }, colour: number | null,
 *   business?: string, locale: string, names?: 'wide' | 'always' }} props
 */
export function PostTile({ tile, colour, business, locale, names = 'always' }) {
  const name = tile.name || t('post.untitled', locale);
  const label = `${name} · ${stateWords(tile, locale)}`;
  const nameClass = cn('line-clamp-2 min-w-0 leading-tight', names === 'wide' && WIDE_NAME);
  const layout = names === 'wide' ? WIDE_LAYOUT : 'items-center gap-2';
  const box = 'size-6 sm:size-7 lg:size-9';
  if (tile.state === 'idea') {
    return (
      <Link
        href={`/posts/${tile.id}`}
        aria-label={label}
        className={cn('flex min-w-0 rounded-lg border border-dashed border-input p-0.5 text-xs text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 lg:p-1', layout)}
      >
        <span className={cn('inline-flex shrink-0 items-center justify-center rounded-md bg-muted', box)}>
          <Lightbulb aria-hidden="true" className="size-3.5 lg:size-4" />
        </span>
        <span className={nameClass}>{name}</span>
      </Link>
    );
  }
  const shared = tile.state === 'shared';
  return (
    <Link
      href={`/posts/${tile.id}`}
      aria-label={label}
      className={cn(
        'flex min-w-0 rounded-lg border-l-[3px] bg-card p-0.5 text-xs ring-1 ring-foreground/10 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 lg:p-1',
        layout,
        colour === null ? 'border-l-input' : THEME_EDGE[colour],
      )}
    >
      <span className={cn('relative shrink-0 overflow-hidden rounded-md', box)}>
        <PictureThumb picture={tile.picture} themeColour={colour} business={business} locale={locale} alt="" />
        <StateMark state={tile.state} className="size-3.5 lg:size-4" />
      </span>
      <span className={cn(nameClass, shared ? 'text-muted-foreground' : 'font-medium')}>{name}</span>
    </Link>
  );
}

/**
 * An idea Fill my month proposed: a dashed tile with a sparkles mark. Nothing
 * is kept until Keep these, so it opens nothing.
 *
 * @param {{ proposal: { name: string }, names?: 'wide' | 'always' }} props
 */
export function ProposalTile({ proposal, names = 'always' }) {
  return (
    <div className={cn('flex min-w-0 rounded-lg border border-dashed border-primary/40 bg-secondary/60 p-0.5 text-xs lg:p-1', names === 'wide' ? WIDE_LAYOUT : 'items-center gap-2')}>
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-card text-primary sm:size-7 lg:size-9">
        <Sparkles aria-hidden="true" className="size-3.5 lg:size-4" />
      </span>
      <span className={cn('line-clamp-2 min-w-0 leading-tight', names === 'wide' && WIDE_NAME)}>{proposal.name}</span>
    </div>
  );
}

/** A theme's dot. @param {{ colour: number | null, className?: string }} props */
export function ThemeDot({ colour, className }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', colour === null ? 'bg-input' : THEME_BACKGROUNDS[colour], className)} />;
}

const KIND_ICONS = Object.freeze({ celebration: PartyPopper, shopping: ShoppingBag, awareness: Globe, remembrance: Ribbon, own: Star });
const DAY_ICONS = Object.freeze({ coffeeDay: Coffee });

/** The icon of a special day: its own for a few, else its kind's. @param {{ key: string, kind: string }} day */
export function specialIcon(day) {
  return DAY_ICONS[day.key] ?? KIND_ICONS[day.kind] ?? Star;
}

/** A special day's name in the reader's language. @param {{ name?: string, nameKey?: string }} day @param {string} locale */
export function specialName(day, locale) {
  return day.name ?? (day.nameKey ? t(day.nameKey, locale) : '');
}

/** A special day's line: its suggestion, "Not a day for offers", or a person's own note. @param {{ hintKey?: string | null, note?: string }} day @param {string} locale */
export function specialHint(day, locale) {
  if (day.hintKey) return t(day.hintKey, locale);
  return day.note ?? '';
}
