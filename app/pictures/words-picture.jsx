'use client';

import { CalendarDays, Quote, Star } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { TILE_WORDS_TOP, cardParts, commentCardSize, logoAddress, pictureVariables, themeIndex, wordsCardSize } from '../../lib/plan/card-layout.js';
import { THEME_BACKGROUNDS } from '../theme-colours.js';

import { usePictureBrand } from './brand.jsx';

/*
 * A words picture's colours are four names the card sets on itself
 * (`PICTURE_VARIABLES` in `lib/plan/card-layout.js`): its classes give each
 * the look's colour it had before brands (the theme's colour, 0 to 4, else the
 * look's main colour; the words in `primary-foreground`; badges in the card's
 * own pair), and a brand from My plan replaces them through the CSSOM
 * (`pictureVariables`), as the canvas draws them (`cardPaint`).
 */

/** The background before a brand: each theme's colour, written out whole so the stylesheet keeps each one. */
const PICTURE_BACKGROUNDS = Object.freeze([
  '[--picture-bg:var(--chart-1)]',
  '[--picture-bg:var(--chart-2)]',
  '[--picture-bg:var(--chart-3)]',
  '[--picture-bg:var(--chart-4)]',
  '[--picture-bg:var(--chart-5)]',
]);
const PICTURE_MAIN_BACKGROUND = '[--picture-bg:var(--primary)]';
const PICTURE_PAINT = '[--picture-ink:var(--primary-foreground)] [--picture-accent:var(--card)] [--picture-accent-ink:var(--card-foreground)] bg-[color:var(--picture-bg)] text-[color:var(--picture-ink)]';

/** Sets a words picture's brand colours on its element (`ref`) through the CSSOM, and takes them off again without one. */
function usePictureColours(ref, themeColour, brand) {
  const { colour, colour2 } = brand;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    for (const [name, value] of pictureVariables(themeColour, { colour, colour2 })) {
      if (value === null) element.style.removeProperty(name);
      else element.style.setProperty(name, value);
    }
  }, [ref, themeColour, colour, colour2]);
}

/**
 * The logo in a picture's bottom right corner, as the canvas draws it
 * (`LOGO`: a box 8% of the shorter side, 4% from both edges; the logo in its
 * own proportions, pressed into the box's corner). Inside a box that sizes
 * by its container (`cqmin`).
 *
 * @param {{ logo: string | null }} props
 */
export function LogoMark({ logo }) {
  if (logo === null) return null;
  return (
    <img
      src={logoAddress(logo)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="pointer-events-none absolute right-[4cqmin] bottom-[4cqmin] size-[8cqmin] object-contain object-right-bottom"
    />
  );
}

/**
 * A size on the 400 card (`lib/plan/card-layout.js`, in steps of 4) as a size
 * relative to the card's shorter side: size / 4 = cqmin, so a wide or tall box
 * (the X or story preview) keeps the words inside it. It goes first in `cn()`:
 * a size class after the line height makes `tailwind-merge` drop the line height.
 */
const SIZE_CLASS = Object.freeze({
  56: 'text-[length:14cqmin]',
  52: 'text-[length:13cqmin]',
  48: 'text-[length:12cqmin]',
  44: 'text-[length:11cqmin]',
  40: 'text-[length:10cqmin]',
  36: 'text-[length:9cqmin]',
  32: 'text-[length:8cqmin]',
  28: 'text-[length:7cqmin]',
  24: 'text-[length:6cqmin]',
  20: 'text-[length:5cqmin]',
  16: 'text-[length:4cqmin]',
});

const STARS = Object.freeze([0, 1, 2, 3, 4]);

/**
 * A words picture as the page draws it (the drawing's `textCard`): the
 * person's words, large, in `primary-foreground` on the theme's colour (or
 * on the brand colour, in black or white for contrast), and the business's
 * name small at the foot (ending before the logo when the picture carries it). It fills its box and scales with it
 * (sizes are relative to its shorter side), so the same card shows as a
 * small tile and as a large preview. `lib/plan/draw.js` draws the same card
 * on a canvas when its shapes are kept. `topRoom`: at least 2rem above the
 * words (a strip tile, whose chosen mark sits in the top corner, 30px deep).
 *
 * `layout` and `subline` draw the picture's layout (`cardParts`, the same
 * parts and places as the canvas, in units of the 400 card: 4 units = 1cqmin):
 * a tip's number badge (`place`, the tip's number), a quote mark, an offer's
 * price badge, an event's date line or who said a quote. The badges and the
 * quote mark are the accent (the brand's second colour; without one the
 * card's own pair); the lines are the words' colour.
 *
 * `brand`: the business's brand (`readBrand`); when not given, the page's
 * (`PictureBrand`).
 *
 * @param {{ words: string, layout?: string, subline?: string, place?: number | null, themeColour?: number | null,
 *   business?: string, topRoom?: boolean, brand?: object | null, className?: string }} props
 */
export function WordsPicture({ words, layout, subline, place = null, themeColour, business, topRoom = false, brand: given, className, ...rest }) {
  const brand = usePictureBrand(given);
  const element = useRef(/** @type {HTMLDivElement | null} */ (null));
  usePictureColours(element, themeColour, brand);
  const index = themeIndex(themeColour);
  const name = String(business ?? '').trim();
  const options = { layout, subline, place };
  const parts = cardParts(options);
  const marked = parts.badge !== null || parts.quote;
  const line = parts.price !== null || parts.date !== null || parts.by !== null;
  return (
    <div
      {...rest}
      ref={element}
      className={cn('[container-type:size] relative size-full overflow-hidden text-left', index === null ? PICTURE_MAIN_BACKGROUND : PICTURE_BACKGROUNDS[index], PICTURE_PAINT, className)}
    >
      <span aria-hidden="true" className="absolute top-[-12.5cqmin] right-[-12.5cqmin] size-[45cqmin] rounded-full bg-card/10" />
      {parts.badge !== null && (
        <span
          aria-hidden="true"
          className="absolute top-[9cqmin] left-[9cqmin] inline-flex size-[13cqmin] items-center justify-center rounded-full bg-[color:var(--picture-accent)] font-heading text-[length:6.5cqmin] leading-none text-[color:var(--picture-accent-ink)] [font-weight:var(--display-weight)]"
        >
          {parts.badge}
        </span>
      )}
      {parts.quote && <Quote aria-hidden="true" className="absolute top-[9cqmin] left-[9cqmin] size-[14cqmin] fill-current text-[color:var(--picture-accent)]" />}
      <div
        className={cn(
          'absolute inset-0 flex flex-col px-[9cqmin] pb-[9cqmin]',
          marked ? (topRoom ? 'pt-[max(27cqmin,2rem)]' : 'pt-[27cqmin]') : topRoom ? 'pt-[max(23cqmin,2rem)]' : 'pt-[23cqmin]',
        )}
      >
        <p
          className={cn(
            // A tile's words start lower (2rem for its mark): their size is chosen for that smaller box.
            SIZE_CLASS[wordsCardSize(words, topRoom ? { ...options, minTop: TILE_WORDS_TOP } : options)],
            'min-h-0 flex-1 overflow-hidden font-heading leading-[1.1] whitespace-pre-line [font-weight:var(--display-weight)] [overflow-wrap:anywhere]',
          )}
        >
          {String(words ?? '').trim()}
        </p>
        {parts.price !== null && (
          <p className="mt-[5cqmin] max-w-full shrink-0 self-start truncate rounded-full bg-[color:var(--picture-accent)] px-[5cqmin] py-[3.25cqmin] text-[length:6.5cqmin] leading-none font-semibold text-[color:var(--picture-accent-ink)]">
            {parts.price}
          </p>
        )}
        {parts.date !== null && (
          <p className="mt-[5cqmin] flex h-[7.5cqmin] max-w-full shrink-0 items-center gap-[2.5cqmin] text-[length:6cqmin] leading-none font-medium">
            <CalendarDays aria-hidden="true" className="size-[6.5cqmin] shrink-0" />
            <span className="min-w-0 truncate">{parts.date}</span>
          </p>
        )}
        {parts.by !== null && (
          <p className="mt-[5cqmin] flex h-[7.5cqmin] max-w-full shrink-0 items-center text-[length:6cqmin] leading-none font-medium">
            <span className="min-w-0 truncate">{parts.by}</span>
          </p>
        )}
        {name !== '' && (
          <p className={cn('truncate text-[length:4.25cqmin] leading-none opacity-80', line && 'mt-[5cqmin] shrink-0', brand.logo !== null && 'pr-[5cqmin]')}>{name}</p>
        )}
      </div>
      <LogoMark logo={brand.logo} />
    </div>
  );
}

/**
 * A customer's comment as a card (the drawing's `commentCard`): a light tint
 * of `chart-4`, a large quote mark, the best line (else the comment's words),
 * the stars as icons (filled up to `stars`; none shown without a number) and
 * the customer's name. It fills its box and scales with it. `business` is
 * taken for the same call as `WordsPicture`; the card does not show it. It
 * carries the logo as every picture does (`brand`, else the page's).
 *
 * @param {{ comment: { bestLine?: string, text?: string, name?: string, stars?: number | null } | null,
 *   business?: string, locale?: string, brand?: object | null, className?: string }} props
 */
export function CommentCard({ comment, business: _business, locale, brand: given, className, ...rest }) {
  const brand = usePictureBrand(given);
  const line = String(comment?.bestLine || comment?.text || '').trim();
  const name = String(comment?.name ?? '').trim();
  const stars = Number.isInteger(comment?.stars) && comment.stars >= 1 && comment.stars <= 5 ? comment.stars : 0;
  return (
    <div
      {...rest}
      className={cn('[container-type:size] relative size-full overflow-hidden bg-[color-mix(in_oklch,var(--chart-4),var(--card)_88%)] text-left text-foreground', className)}
    >
      <div className="absolute inset-0 flex flex-col px-[9cqmin] pt-[9cqmin] pb-[14cqmin]">
        <Quote aria-hidden="true" className="size-[18cqmin] shrink-0 fill-chart-4 text-chart-4" />
        <p
          className={cn(
            SIZE_CLASS[commentCardSize(line)],
            'mt-[6cqmin] min-h-0 flex-1 overflow-hidden font-heading leading-[1.3] font-semibold whitespace-pre-line [overflow-wrap:anywhere]',
          )}
        >
          {line}
        </p>
        {stars > 0 && (
          <div role="img" aria-label={t('pictures.stars', locale, { n: String(stars) })} className="mt-[5cqmin] flex shrink-0 gap-[1cqmin]">
            {STARS.map((star) => (
              <Star key={star} aria-hidden="true" className={cn('size-[6.5cqmin]', star < stars ? 'fill-chart-1 text-chart-1' : 'text-chart-1/40')} />
            ))}
          </div>
        )}
        {name !== '' && <p className="mt-[4.5cqmin] shrink-0 truncate text-[length:5cqmin] leading-none text-muted-foreground">{name}</p>}
      </div>
      <LogoMark logo={brand.logo} />
    </div>
  );
}

/**
 * A layout's sample in Change words (56 points): the picture's own colours
 * (its theme's, or the brand's, as `WordsPicture` sets them) and the
 * layout's own mark drawn large enough to tell the five apart at a glance,
 * never words: a tip's number badge, a quote's large quote mark, an offer's
 * price badge, an event's date line; plain words show only their lines.
 *
 * @param {{ layout: string, themeColour?: number | null, brand?: object | null, className?: string }} props
 */
export function LayoutSample({ layout, themeColour, brand: given, className }) {
  const brand = usePictureBrand(given);
  const element = useRef(/** @type {HTMLDivElement | null} */ (null));
  usePictureColours(element, themeColour, brand);
  const index = themeIndex(themeColour);
  const kind = cardParts({ layout, subline: 'x', place: 1 });
  const lines = (
    <span className="flex w-full flex-col gap-1">
      <span className="h-1.5 w-full rounded-full bg-current opacity-90" />
      <span className="h-1.5 w-2/3 rounded-full bg-current opacity-90" />
    </span>
  );
  return (
    <div
      ref={element}
      aria-hidden="true"
      data-layout={layout}
      className={cn('flex size-14 shrink-0 flex-col items-start justify-center gap-1.5 overflow-hidden rounded-md p-2', index === null ? PICTURE_MAIN_BACKGROUND : PICTURE_BACKGROUNDS[index], PICTURE_PAINT, className)}
    >
      {kind.badge !== null && (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--picture-accent)] text-sm leading-none font-semibold text-[color:var(--picture-accent-ink)]">1</span>
      )}
      {kind.quote && <Quote className="-my-0.5 size-7 shrink-0 fill-current text-[color:var(--picture-accent)]" />}
      {lines}
      {kind.price !== null && (
        <span className="rounded-full bg-[color:var(--picture-accent)] px-2 py-0.5 text-xs leading-none font-semibold text-[color:var(--picture-accent-ink)]">%</span>
      )}
      {kind.date !== null && (
        <span className="flex w-full items-center gap-1">
          <CalendarDays className="size-4 shrink-0" />
          <span className="h-1.5 flex-1 rounded-full bg-current opacity-90" />
        </span>
      )}
      {kind.badge === null && !kind.quote && kind.price === null && kind.date === null && (
        <span className="h-1.5 w-1/2 rounded-full bg-current opacity-90" />
      )}
    </div>
  );
}

/**
 * A comment card where its words cannot be read (a calendar tile is read
 * without the comment): the theme's colour and a large quote mark, no words.
 * The post maker reads the comment and shows the whole card.
 *
 * @param {{ themeColour?: number | null, className?: string }} props
 */
export function CardMark({ themeColour, className, ...rest }) {
  const index = themeIndex(themeColour);
  return (
    <div
      {...rest}
      className={cn('@container flex size-full items-center justify-center text-primary-foreground', index === null ? 'bg-primary' : THEME_BACKGROUNDS[index], className)}
    >
      <Quote aria-hidden="true" className="size-[40cqmin] fill-current" />
    </div>
  );
}
