'use client';

import { ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';

import { usePictureBrand } from './brand.jsx';
import { fileAddress, pictureWords, thumbSources } from './rules.js';
import { CardMark, CommentCard, LogoMark, WordsPicture } from './words-picture.jsx';

/**
 * One of a post's pictures, filling its box: the kept copy in `shape` when
 * there is one, else the kept original, else (a words or card picture whose
 * copies are not kept yet) the page's own drawing of it (a card read without
 * its comment, as a tile reads it: the theme's colour and a quote mark), else
 * a muted box with a picture icon. A file that does not load moves the thumb on to the
 * next of these. Corners and the box's size come from the parent's classes.
 *
 * `alt` is the picture's description (else the words drawn on it, else the
 * word "Picture"); pass `alt=""` where the words beside it already name it,
 * and the thumb is hidden from screen readers.
 *
 * `tile`: a tile of the picture strip, whose chosen mark sits in the top
 * corner: a words picture is drawn by the page (never a kept copy) with room
 * above its words for the mark.
 *
 * `wordsFirst`: a words picture is drawn by the page before any kept copy (a
 * set's slides, whose tip numbers follow the set's order as it is now: a kept
 * copy may carry an older number). `place` is a tip's number (its badge
 * shows only with one).
 *
 * `brand`: the business's brand (`readBrand`; when not given, the page's,
 * from `PictureBrand`). A picture the page draws takes its colours, and with
 * "Logo on pictures" every picture shows the logo in its corner: the page
 * draws it over the original and over its own drawings, as the kept copies
 * carry it drawn in.
 *
 * @param {{ picture: object | null, shape?: string, themeColour?: number | null, business?: string,
 *   locale?: string, className?: string, alt?: string, tile?: boolean, wordsFirst?: boolean, place?: number | null,
 *   brand?: object | null }} props
 */
export function PictureThumb({ picture, shape = 'square', themeColour, business, locale, className, alt, tile = false, wordsFirst = tile, place = null, brand: given }) {
  const brand = usePictureBrand(given);
  const [failed, setFailed] = useState(() => new Set());
  const source = thumbSources(picture, shape, { wordsFirst }).find((item) => item.kind !== 'file' || !failed.has(item.address));
  const decorative = alt === '';
  const label = decorative ? '' : (alt ?? (pictureWords(picture) || t('pictures.alt', locale)));

  if (source.kind === 'file') {
    const { address } = source;
    // A kept copy carries the logo drawn in; the original shows it on top, where its copies will carry it.
    const logoOver = brand.logo !== null && address === fileAddress(picture.id, 'original', picture.original);
    const image = (
      <img
        src={address}
        alt={label}
        draggable={false}
        onError={() => setFailed((before) => new Set(before).add(address))}
        className={cn('block size-full object-cover', !logoOver && className)}
      />
    );
    if (!logoOver) return image;
    return (
      <div className={cn('[container-type:size] relative block size-full overflow-hidden', className)}>
        {image}
        <LogoMark logo={brand.logo} />
      </div>
    );
  }
  if (source.kind === 'words') {
    return (
      <WordsPicture
        words={picture.words}
        layout={picture.layout}
        subline={picture.subline}
        place={place}
        themeColour={themeColour}
        business={business}
        topRoom={tile}
        brand={brand}
        aria-hidden={decorative || undefined}
        className={className}
      />
    );
  }
  if (source.kind === 'card') {
    return <CommentCard comment={picture.card} business={business} locale={locale} brand={brand} aria-hidden={decorative || undefined} className={className} />;
  }
  if (source.kind === 'cardMark') {
    return (
      <CardMark
        themeColour={themeColour}
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
        className={className}
      />
    );
  }
  return (
    <div
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      className={cn('flex size-full items-center justify-center bg-muted text-muted-foreground', className)}
    >
      <ImageIcon aria-hidden="true" className="size-1/4 max-h-10 max-w-10" />
    </div>
  );
}
