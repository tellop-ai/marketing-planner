/**
 * How words sit on a card the app draws itself: a words picture (the person's
 * words, large, on the theme's colour) and a comment card (a customer's best
 * line). Pure, so the page's canvas (`lib/plan/draw.js`), the page's HTML
 * cards (`app/pictures/words-picture.jsx`) and the checks all use the same
 * rules.
 *
 * Sizes are in the units of the box they are given. The card shapes below are
 * written for a 400 x 400 box (the approved drawing's `textCard` and
 * `commentCard`); a drawing of another size scales them by
 * `Math.min(width, height) / 400`.
 */

/** The mark that ends words cut short. */
export const ELLIPSIS = '…';

/** A words picture, in units of a 400 x 400 card. */
export const WORDS_CARD = Object.freeze({
  pad: 36,
  /** The top of the first line of words. */
  top: 92,
  maxSize: 56,
  minSize: 20,
  lineHeight: 1.1,
  /** The business's name, small, at the bottom. */
  nameSize: 17,
  /** Room kept between the words and the business's name. */
  nameGap: 24,
  /** The light circle in the top right corner. */
  circle: Object.freeze({ right: 40, top: 40, radius: 90 }),
});

/**
 * The layouts a words picture is drawn in: plain `words`;
 * a `tip` with its number in a round badge; a `quote` under a large quote
 * mark; an `offer` with its subline as a price badge; an `event` with its
 * subline as a date line. Any other value draws as `words`.
 */
export const CARD_LAYOUTS = Object.freeze(['words', 'tip', 'quote', 'offer', 'event']);

/** A words picture's layout parts, in units of a 400 x 400 card. */
export const LAYOUT_PARTS = Object.freeze({
  /** `tip`: the tip's number in a round badge in the top left corner. */
  badge: Object.freeze({ top: 36, size: 52, numberSize: 26 }),
  /** `quote`: a large quote mark in the top left corner. */
  quote: Object.freeze({ top: 36, size: 56 }),
  /** The top of the words under a badge or a quote mark. */
  markedTop: 108,
  /** `offer`: the subline in a round-ended badge above the business's name. */
  price: Object.freeze({ height: 52, size: 26, padX: 20 }),
  /** `event`: a calendar mark and the subline on one line above the business's name. */
  date: Object.freeze({ height: 30, size: 24, icon: 26, gap: 10 }),
  /** `quote`: who said it (the subline after a dash), on one line above the business's name. */
  by: Object.freeze({ height: 30, size: 24 }),
  /** Room between the words and a price or date, and between that and the name. */
  gap: 20,
});

/** The most a words picture's line under its words holds (price, date or name), as the app keeps it. */
export const CARD_SUBLINE_MOST = 80;

/** The layouts whose line under the words is drawn, each with what the line is. */
export const SUBLINE_KINDS = Object.freeze({ offer: 'price', event: 'date', quote: 'name' });

/** A stored layout as the card draws it: one of `CARD_LAYOUTS`, else `words`. @param {unknown} value */
export function layoutOf(value) {
  return typeof value === 'string' && CARD_LAYOUTS.includes(value) ? value : 'words';
}

/**
 * What a words picture shows besides its words: a tip's number badge (only
 * with a `place`, the tip's number, a whole number from 1), a quote's mark,
 * an offer's price badge, an event's date line or a quote's "who said it"
 * line (`by`; each only with a subline, on one line). Everything else is
 * drawn as plain words.
 *
 * @param {{ layout?: unknown, subline?: unknown, place?: unknown }} [options]
 * @returns {{ layout: string, badge: string | null, quote: boolean, price: string | null, date: string | null, by: string | null }}
 */
export function cardParts({ layout, subline, place } = {}) {
  const kind = layoutOf(layout);
  const line = typeof subline === 'string' ? subline.replace(/\s+/gu, ' ').trim() : '';
  return {
    layout: kind,
    badge: kind === 'tip' && Number.isInteger(place) && /** @type {number} */ (place) > 0 ? String(place) : null,
    quote: kind === 'quote',
    price: kind === 'offer' && line !== '' ? line : null,
    date: kind === 'event' && line !== '' ? line : null,
    by: kind === 'quote' && line !== '' ? `— ${line}` : null,
  };
}

/** A comment card, in units of a 400 x 400 card. */
export const COMMENT_CARD = Object.freeze({
  pad: 36,
  quoteTop: 36,
  quoteSize: 72,
  /** The top of the best line's first line. */
  top: 132,
  maxSize: 32,
  minSize: 16,
  lineHeight: 1.3,
  starSize: 26,
  starGap: 4,
  nameSize: 20,
  /** From the bottom edge to the name's foot. */
  bottom: 56,
  /** Room kept between the best line and the stars. */
  starsGap: 20,
  /** Room kept between the stars and the name. */
  nameGap: 18,
});

/** The five theme colours are `chart-1` to `chart-5`, stored as 0 to 4. */
export const THEME_COLOURS = 5;

/**
 * The theme colour a card is drawn on: a whole number from 0 to 4, or null
 * (no theme: the card takes the look's main colour).
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function themeIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < THEME_COLOURS ? value : null;
}

let segmenter = null;

/** The characters a person sees, one by one (a letter with its accent, an emoji, a flag). */
export function graphemes(text) {
  const value = String(text ?? '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

const NARROW = /^[il.,:;'’!|ıIjft]$/u;
const BROAD = /^[mwMWĞŞ@]$/u;
const CAPITAL = /^\p{Lu}$/u;
const LETTER = /^[\p{L}\p{N}]\p{M}*$/u;
const MARK = /^\p{P}$/u;

/**
 * About how wide `text` is at `size` in an ordinary sans face, for a place
 * with no canvas to measure on (the HTML cards and the checks). It errs on
 * the wide side, so words it says fit do fit.
 *
 * @param {string} text
 * @param {number} size
 */
export function estimateWidth(text, size) {
  let units = 0;
  for (const piece of graphemes(text)) {
    if (piece === ' ') units += 0.28;
    else if (NARROW.test(piece)) units += 0.3;
    else if (BROAD.test(piece)) units += 0.86;
    else if (CAPITAL.test(piece)) units += 0.68;
    else if (LETTER.test(piece)) units += 0.58;
    else if (MARK.test(piece)) units += 0.4;
    else units += 1;
  }
  return units * size;
}

function positive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a number above 0`);
  return value;
}

/** The person's words as paragraphs of words: a line break they typed starts a new paragraph. */
function paragraphsOf(words) {
  return String(words ?? '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim().split(/\s+/u).filter(Boolean))
    .filter((line) => line.length > 0);
}

/** A word too long for a line, cut into pieces that each fit (a single character always makes a piece). */
function splitWord(word, width, size, measure) {
  const pieces = [];
  let current = '';
  for (const piece of graphemes(word)) {
    const longer = current + piece;
    if (current !== '' && measure(longer, size) > width) {
      pieces.push(current);
      current = piece;
    } else {
      current = longer;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

/** The lines at one size; null when `split` is false and a word is longer than a line. */
function wrap(paragraphs, width, size, measure, split) {
  const lines = [];
  for (const paragraph of paragraphs) {
    let current = '';
    for (const word of paragraph) {
      if (measure(word, size) > width) {
        if (!split) return null;
        if (current !== '') lines.push(current);
        const pieces = splitWord(word, width, size, measure);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1];
        continue;
      }
      const longer = current === '' ? word : `${current} ${word}`;
      if (measure(longer, size) <= width) {
        current = longer;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current !== '') lines.push(current);
  }
  return lines;
}

/**
 * `text` as it fits on one line of `width`: whole when it fits, else cut at
 * the end with `ELLIPSIS`.
 *
 * @param {string} text
 * @param {number} width
 * @param {{ size: number, measure?: (text: string, size: number) => number }} options
 */
export function clipLine(text, width, { size, measure = estimateWidth }) {
  const value = String(text ?? '');
  if (measure(value, size) <= width) return value;
  return endCut(value, width, size, measure);
}

/** `text` with `ELLIPSIS` after it, shortened from the end until both fit in `width`. */
function endCut(text, width, size, measure) {
  const kept = graphemes(text);
  while (kept.length > 0 && measure(`${kept.join('').trimEnd()}${ELLIPSIS}`, size) > width) kept.pop();
  return `${kept.join('').trimEnd()}${ELLIPSIS}`;
}

/**
 * Wraps `words` into lines of at most `width` and finds the largest size,
 * from `maxSize` down to `minSize` by `step`, at which every line fits in
 * `height` (each line takes `size * lineHeight`). A line breaks at spaces,
 * and a line break the person typed starts a new line. Words stay whole
 * whenever some size keeps them whole: a word longer than a line is cut into
 * pieces only when no size from `maxSize` to `minSize` fits it whole, and
 * then the largest size that fits with pieces is taken. When even `minSize`
 * does not fit, the lines that fit are kept at `minSize` and the last one
 * ends with `ELLIPSIS` (`cut: true`).
 * No words at all answer no lines at `maxSize`.
 *
 * `measure(text, size)` says how wide `text` is at `size`: the page passes
 * its canvas's own measure; without one, `estimateWidth`.
 *
 * @param {string} words
 * @param {{ width: number, height: number, maxSize: number, minSize: number, step?: number,
 *   lineHeight?: number, measure?: (text: string, size: number) => number }} box
 * @returns {{ lines: string[], size: number, cut: boolean }}
 */
export function layoutWords(words, { width, height, maxSize, minSize, step = 1, lineHeight = 1.15, measure = estimateWidth }) {
  positive(width, 'width');
  positive(height, 'height');
  positive(minSize, 'minSize');
  positive(maxSize, 'maxSize');
  positive(step, 'step');
  positive(lineHeight, 'lineHeight');
  if (maxSize < minSize) throw new TypeError('maxSize must not be below minSize');

  const paragraphs = paragraphsOf(words);
  if (paragraphs.length === 0) return { lines: [], size: maxSize, cut: false };

  const sizes = [];
  for (let size = maxSize; size > minSize; size -= step) sizes.push(size);
  sizes.push(minSize);
  for (const split of [false, true]) {
    for (const size of sizes) {
      const lines = wrap(paragraphs, width, size, measure, split);
      if (lines !== null && lines.length * size * lineHeight <= height) return { lines, size, cut: false };
    }
  }

  const lines = wrap(paragraphs, width, minSize, measure, true);
  const room = Math.max(1, Math.floor(height / (minSize * lineHeight)));
  const kept = lines.slice(0, room);
  const last = kept.length - 1;
  kept[last] = endCut(kept[last], width, minSize, measure);
  return { lines: kept, size: minSize, cut: true };
}

/**
 * Where a words picture's parts go on a card of `width` x `height`: the
 * words' box (`x`, `top`, `width`, `height`), the business's name (its foot
 * at `nameY`, its size `nameSize`), the circle, and `unit`, the scale from
 * the 400 card. A card taller than it is wide puts the words in the middle of
 * their box (`middle`); others start them at the top, as drawn.
 *
 * `options` is the picture's layout (`cardParts`): a tip's badge or a quote
 * mark (`badge`, `quote`: where they go) moves the words down; a price badge
 * or a date line (`price`, `date`: the top of their line, its height and the
 * widest it may be) takes room above the name, and the words end above it.
 * `parts` says which are drawn. `minTop` (in units of the 400 card): the
 * words start no higher (a strip tile keeps room above them for its mark).
 * `logo`: the picture carries the logo in its bottom right corner, so the
 * business's name ends before it (`nameWidth`; `LOGO_NAME_ROOM`).
 *
 * @param {number} width
 * @param {number} height
 * @param {{ layout?: unknown, subline?: unknown, place?: unknown, minTop?: number, logo?: boolean }} [options]
 */
export function wordsCardBox(width, height, options = {}) {
  const card = WORDS_CARD;
  const parts = cardParts(options);
  const unit = Math.min(positive(width, 'width'), positive(height, 'height')) / 400;
  const x = card.pad * unit;
  const inner = width - 2 * card.pad * unit;
  const marked = parts.badge !== null || parts.quote;
  const least = typeof options.minTop === 'number' && Number.isFinite(options.minTop) ? options.minTop : 0;
  const top = Math.max(marked ? LAYOUT_PARTS.markedTop : card.top, least) * unit;
  const nameY = height - card.pad * unit;
  const nameTop = nameY - card.nameSize * unit;
  const block = parts.price !== null ? LAYOUT_PARTS.price.height
    : parts.date !== null ? LAYOUT_PARTS.date.height
      : parts.by !== null ? LAYOUT_PARTS.by.height : 0;
  const lineTop = block === 0 ? null : nameTop - (LAYOUT_PARTS.gap + block) * unit;
  const bottom = lineTop === null ? nameTop - card.nameGap * unit : lineTop - LAYOUT_PARTS.gap * unit;
  const { badge, quote, price, date, by } = LAYOUT_PARTS;
  return {
    unit,
    x,
    top,
    width: inner,
    height: bottom - top,
    maxSize: card.maxSize * unit,
    minSize: card.minSize * unit,
    lineHeight: card.lineHeight,
    nameSize: card.nameSize * unit,
    nameY,
    nameWidth: inner - (options.logo === true ? LOGO_NAME_ROOM * unit : 0),
    middle: height > width,
    circle: { x: width - card.circle.right * unit, y: card.circle.top * unit, radius: card.circle.radius * unit },
    parts,
    badge: parts.badge === null ? null : { x, y: badge.top * unit, size: badge.size * unit, numberSize: badge.numberSize * unit },
    quote: parts.quote ? { x, y: quote.top * unit, size: quote.size * unit } : null,
    price: parts.price === null ? null : { x, y: lineTop, height: price.height * unit, size: price.size * unit, padX: price.padX * unit, maxWidth: inner },
    date: parts.date === null ? null : { x, y: lineTop, height: date.height * unit, size: date.size * unit, icon: date.icon * unit, gap: date.gap * unit, maxWidth: inner },
    by: parts.by === null ? null : { x, y: lineTop, height: by.height * unit, size: by.size * unit, maxWidth: inner },
  };
}

/**
 * Where a comment card's parts go on a card of `width` x `height`: the quote
 * mark, the best line's box, the row of stars and the name (its foot at
 * `nameY`). The stars and the name keep to the bottom edge.
 *
 * @param {number} width
 * @param {number} height
 */
export function commentCardBox(width, height) {
  const card = COMMENT_CARD;
  const unit = Math.min(positive(width, 'width'), positive(height, 'height')) / 400;
  const nameY = height - card.bottom * unit;
  const starsTop = nameY - (card.nameSize + card.nameGap + card.starSize) * unit;
  const top = card.top * unit;
  return {
    unit,
    x: card.pad * unit,
    quote: { y: card.quoteTop * unit, size: card.quoteSize * unit },
    top,
    width: width - 2 * card.pad * unit,
    height: starsTop - card.starsGap * unit - top,
    maxSize: card.maxSize * unit,
    minSize: card.minSize * unit,
    lineHeight: card.lineHeight,
    stars: { y: starsTop, size: card.starSize * unit, gap: card.starGap * unit },
    nameSize: card.nameSize * unit,
    nameY,
  };
}

/**
 * Where the words of a strip tile's HTML card start, at the least, in units
 * of the 400 card: the tile keeps 2rem above its words for the chosen mark,
 * and a tile is about 106px wide at the narrowest (a phone), where 2rem is
 * about 121 units.
 */
export const TILE_WORDS_TOP = 124;

/** The size steps the page's HTML cards are drawn in (a class for each, in units of the 400 card). */
export const HTML_SIZE_STEP = 4;

/**
 * The page's HTML cards wrap by the face's own widths, which cannot be
 * measured here, so their size is chosen with the estimate a tenth wider:
 * a bold word can be wider than `estimateWidth` says (measured 2026-10-21 in
 * the system face: "mug-painting" wrapped where the plain estimate said it fit).
 */
export const HTML_WIDTH_MARGIN = 1.1;

const htmlMeasure = (text, size) => estimateWidth(text, size) * HTML_WIDTH_MARGIN;

/**
 * The size a words picture's words take on the page's HTML card, in units of
 * the 400 card: a step of `HTML_SIZE_STEP` from 56 down to 20, measured with
 * `estimateWidth` and `HTML_WIDTH_MARGIN`, in the box its layout leaves the
 * words (`wordsCardBox`'s `options`).
 *
 * @param {string} words
 * @param {{ layout?: unknown, subline?: unknown, place?: unknown, minTop?: number }} [options]
 */
export function wordsCardSize(words, options = {}) {
  const box = wordsCardBox(400, 400, options);
  return layoutWords(words, { ...box, step: HTML_SIZE_STEP, measure: htmlMeasure }).size;
}

/**
 * The size a comment card's best line takes on the page's HTML card, in
 * units of the 400 card: a step of `HTML_SIZE_STEP` from 32 down to 16.
 *
 * @param {string} line
 */
export function commentCardSize(line) {
  const box = commentCardBox(400, 400);
  return layoutWords(line, { ...box, step: HTML_SIZE_STEP, measure: htmlMeasure }).size;
}

// --- the business's brand on its pictures ---------------------------------

/** A brand colour as the drawing takes it: `#` and six hex digits. */
const BRAND_HEX = /^#[0-9a-f]{6}$/iu;
/** A kept logo's tag (the first 12 characters of its digest, as `planFor` answers it). */
const LOGO_TAG = /^[0-9a-f]{12}$/u;

/**
 * A brand colour as the drawing takes it: `#rrggbb` in small letters, or ''
 * for none (anything that is not a colour).
 *
 * @param {unknown} value
 */
export function brandHex(value) {
  return typeof value === 'string' && BRAND_HEX.test(value.trim()) ? value.trim().toLowerCase() : '';
}

/** No brand: the pictures take the theme's colours and carry no logo. */
export const NO_BRAND = Object.freeze({ colour: '', colour2: '', logo: null });

/**
 * A brand as the drawing takes it (`{ colour, colour2, logo }`, read safely
 * from anything): the brand colour, the second colour (each `#rrggbb` or
 * ''), and the logo's tag when the pictures carry it, else null.
 *
 * @param {unknown} value
 * @returns {{ colour: string, colour2: string, logo: string | null }}
 */
export function readBrand(value) {
  const brand = value !== null && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
  const colour = brandHex(brand.colour);
  const colour2 = brandHex(brand.colour2);
  const logo = typeof brand.logo === 'string' && LOGO_TAG.test(brand.logo) ? brand.logo : null;
  return colour === '' && colour2 === '' && logo === null ? NO_BRAND : Object.freeze({ colour, colour2, logo });
}

/**
 * What My plan gives the pictures, from a profile as `planFor` and
 * `getProfileFor` answer it: its brand colours, and its logo's tag only
 * while "Logo on pictures" is on and a logo is kept (the switch can stay on
 * after the logo is removed).
 *
 * @param {{ brandColour?: unknown, brandColour2?: unknown, logoOnPictures?: unknown, logo?: unknown } | null | undefined} profile
 */
export function pictureBrandOf(profile) {
  return readBrand({
    colour: profile?.brandColour,
    colour2: profile?.brandColour2,
    logo: profile?.logoOnPictures === true ? profile?.logo : null,
  });
}

/** One sRGB channel (0 to 255) as light, the way WCAG counts it. @param {number} value */
function linear(value) {
  const share = value / 255;
  return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
}

/**
 * How light a colour is, as WCAG counts it (its relative luminance, 0 for
 * black to 1 for white), or null for anything that is not a `#rrggbb` colour.
 *
 * @param {unknown} hex
 */
export function luminanceOf(hex) {
  const colour = brandHex(hex);
  if (colour === '') return null;
  const [red, green, blue] = [1, 3, 5].map((at) => linear(Number.parseInt(colour.slice(at, at + 2), 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast between two luminances, as WCAG counts it (1 to 21). @param {number} a @param {number} b */
export function contrastOf(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The two inks words are drawn in on a brand colour, and their luminances. */
export const INK = Object.freeze({ light: 'white', dark: 'black' });
const INK_LUMINANCE = Object.freeze({ white: 1, black: 0 });

/** The contrast words need against their background (WCAG's 4.5:1 for ordinary text). */
export const INK_CONTRAST = 4.5;

/**
 * The ink words take on a brand colour: white while white keeps WCAG's 4.5:1
 * against it, else black (which then always does: past that edge black
 * reaches more than 4.6:1). Null for anything that is not a colour.
 *
 * @param {unknown} hex
 * @returns {'white' | 'black' | null}
 */
export function inkFor(hex) {
  const luminance = luminanceOf(hex);
  if (luminance === null) return null;
  return contrastOf(INK_LUMINANCE.white, luminance) >= INK_CONTRAST ? INK.light : INK.dark;
}

/** The contrast an ink from `inkFor` has against `hex`. @param {unknown} hex */
export function inkContrastOf(hex) {
  const ink = inkFor(hex);
  return ink === null ? null : contrastOf(INK_LUMINANCE[ink], /** @type {number} */ (luminanceOf(hex)));
}

/**
 * The colours a words picture is drawn in, each a look's name (`--…`, read
 * from `app/tokens.css`) or a colour from the brand:
 *
 * - `bg`: the brand colour, else the theme's colour (`--chart-1` to
 *   `--chart-5`), else the look's main colour (`--primary`);
 * - `ink` (the words, the date line, who said a quote, the business's name):
 *   on a brand colour black or white (`inkFor`), else `--primary-foreground`;
 * - `accent` (a tip's badge, an offer's price badge, a quote's mark): the
 *   second colour, else the ink on a brand colour, else `--card`;
 * - `accentInk` (the tip's number and the price on the accent): the second
 *   colour's own ink, else the brand colour (on its ink), else
 *   `--card-foreground`.
 *
 * Without a brand colour each part is the look's name it was drawn in before
 * brands. The canvas (`lib/plan/draw.js`) and the page's HTML card
 * (`app/pictures/words-picture.jsx`, through `pictureVariables`) both draw
 * from this, so they agree.
 *
 * @param {unknown} themeColour
 * @param {unknown} [brand]
 * @returns {{ bg: string, ink: string, accent: string, accentInk: string }}
 */
export function cardPaint(themeColour, brand) {
  const index = themeIndex(themeColour);
  const { colour, colour2 } = readBrand(brand);
  const ink = colour === '' ? '--primary-foreground' : /** @type {string} */ (inkFor(colour));
  return {
    bg: colour !== '' ? colour : index === null ? '--primary' : `--chart-${index + 1}`,
    ink,
    accent: colour2 !== '' ? colour2 : colour !== '' ? ink : '--card',
    accentInk: colour2 !== '' ? /** @type {string} */ (inkFor(colour2)) : colour !== '' ? colour : '--card-foreground',
  };
}

/** Whether a paint value is a look's name rather than a colour. @param {string} value */
export function isLookName(value) {
  return value.startsWith('--');
}

/** The page's names for a words picture's colours (`cardPaint`'s parts), set on the HTML card. */
export const PICTURE_VARIABLES = Object.freeze({ bg: '--picture-bg', ink: '--picture-ink', accent: '--picture-accent', accentInk: '--picture-accent-ink' });

/**
 * The colours the page's HTML card sets on itself through the CSSOM, one
 * pair `[name, value]` for each of `PICTURE_VARIABLES`: a brand's colour, or
 * null where the part keeps the look's name its classes already give it.
 *
 * @param {unknown} themeColour
 * @param {unknown} [brand]
 * @returns {Array<[string, string | null]>}
 */
export function pictureVariables(themeColour, brand) {
  const paint = cardPaint(themeColour, brand);
  return Object.entries(PICTURE_VARIABLES).map(([part, name]) => {
    const value = paint[/** @type {keyof typeof paint} */ (part)];
    return [name, isLookName(value) ? null : value];
  });
}

/**
 * The logo on a picture: in a square box in the bottom right corner, its
 * side 8% of the picture's shorter side, kept 4% of it from both edges.
 */
export const LOGO = Object.freeze({ size: 0.08, margin: 0.04 });

/** Room kept between the business's name and the logo, in units of the 400 card. */
export const LOGO_GAP = 8;

/**
 * How much shorter the business's name is on a words picture that carries
 * the logo, in units of the 400 card: the logo's box and its margin, less the
 * card's own edge room, and a gap.
 */
export const LOGO_NAME_ROOM = (LOGO.size + LOGO.margin) * 400 - WORDS_CARD.pad + LOGO_GAP;

/**
 * Where the logo is drawn on a picture of `width` x `height`: the logo
 * (`logoWidth` x `logoHeight`, a square when not given) as large as fits in
 * the corner box (`LOGO`), keeping its own proportions, pressed into the
 * box's bottom right corner.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [logoWidth]
 * @param {number} [logoHeight]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function logoBox(width, height, logoWidth = 1, logoHeight = 1) {
  const short = Math.min(positive(width, 'width'), positive(height, 'height'));
  const side = short * LOGO.size;
  const margin = short * LOGO.margin;
  const scale = side / Math.max(positive(logoWidth, 'logoWidth'), positive(logoHeight, 'logoHeight'));
  const drawnWidth = logoWidth * scale;
  const drawnHeight = logoHeight * scale;
  return { x: width - margin - drawnWidth, y: height - margin - drawnHeight, width: drawnWidth, height: drawnHeight };
}

/** The address the kept logo shows at, with its tag so a new logo has a new address. @param {string} tag */
export function logoAddress(tag) {
  return `/api/plan/logo?v=${encodeURIComponent(String(tag))}`;
}
