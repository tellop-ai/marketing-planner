/**
 * A picture's shapes, drawn in the page on a canvas and kept as files (the
 * spec's "Shapes": crops are drawn in the page, as `lib/send-file.js` draws
 * its copies, and written as WebP, or JPEG where the browser cannot write
 * WebP).
 *
 * - A photo, or a picture the AI drew or changed, is cut from its kept
 *   original: `fill` cuts the shape around the focus point (`fillCut`), `fit`
 *   draws the whole picture on the theme's colour (`fitPlace`); `auto` is
 *   `fit` for the tall shapes (`fitFor`).
 * - A words picture and a comment card are drawn here at the shape's size, as
 *   `app/pictures/words-picture.jsx` draws them in HTML, with the words laid
 *   out by `lib/plan/card-layout.js`. A words picture is drawn in its
 *   layout (`picture.layout`, `picture.subline`: a tip's number badge, a
 *   quote mark, an offer's price badge, an event's date line); a tip's number
 *   is its place among the tips of its set, which the page passes as `place`.
 *
 * Every colour is the look's own, read from `app/tokens.css` at the moment of
 * drawing (`getComputedStyle(document.documentElement)`), or the business's
 * brand from My plan (`cardPaint`: a words picture on the brand colour, its
 * badges on the second colour, the words black or white for contrast; a whole
 * picture fitted on the brand colour); no colour is written here. With "Logo
 * on pictures" on, every shape carries the logo small in its bottom right
 * corner (`logoBox`). The brand is the one given in the options, else the
 * page's (`setPageBrand`, which `app/pictures/brand.jsx` sets from My plan),
 * so every press on a page draws in the same brand. The words use the look's
 * display face.
 *
 * Browser only: every function needs `document`, and nothing runs when this
 * file loads. A failure throws a `DrawProblem` (or the `FileProblem` that
 * `sendFile` throws), each with the `messageKey` the page shows.
 */

import { __iconNode as CALENDAR_ICON } from 'lucide-react/dist/esm/icons/calendar-days.mjs';
import { __iconNode as QUOTE_ICON } from 'lucide-react/dist/esm/icons/quote.mjs';
import { __iconNode as STAR_ICON } from 'lucide-react/dist/esm/icons/star.mjs';

import { canDraw, fileAddress, hasOriginal, missingShapes, problemOf } from './picture-rules.js';
import { sendFile } from '../send-file.js';
import { NO_BRAND, cardPaint, clipLine, commentCardBox, isLookName, layoutWords, logoAddress, logoBox, readBrand, wordsCardBox } from './card-layout.js';
import { SHAPES, fillCut, fitFor, fitPlace, isShapeKey } from './shapes.js';

/** The words a failed drawing shows. */
export const NOT_READY = 'pictures.notReady';

/** A shape that could not be drawn or kept; `messageKey` says why, in `lib/i18n/locales`. */
export class DrawProblem extends Error {
  constructor(messageKey) {
    super(messageKey);
    this.name = 'DrawProblem';
    this.messageKey = messageKey;
  }
}

/** The look's name for a card's background: the theme's colour (`--chart-1` to `--chart-5`), else `--primary`. */
export function themeToken(themeColour) {
  return cardPaint(themeColour, NO_BRAND).bg;
}

// The page's brand: what My plan gives this page's pictures (`readBrand`), for every drawing on it.
let pageBrand = NO_BRAND;
const brandWatchers = new Set();

/**
 * Sets the brand every drawing on this page takes when its options name none
 * (`app/pictures/brand.jsx` sets it from My plan as the page opens, and back
 * to none as it closes), and tells the page's pictures.
 *
 * @param {unknown} brand
 */
export function setPageBrand(brand) {
  const next = readBrand(brand);
  if (next.colour === pageBrand.colour && next.colour2 === pageBrand.colour2 && next.logo === pageBrand.logo) return;
  pageBrand = next;
  for (const watcher of [...brandWatchers]) watcher();
}

/** The page's brand now (the same object until it changes). */
export function currentPageBrand() {
  return pageBrand;
}

/** Calls `watcher` after each change of the page's brand; answers the function that stops it. @param {() => void} watcher */
export function watchPageBrand(watcher) {
  brandWatchers.add(watcher);
  return () => {
    brandWatchers.delete(watcher);
  };
}

/** The brand a drawing takes: the one its options give (`brand`, even none), else the page's. @param {unknown} brand */
export function drawingBrand(brand) {
  return brand === undefined ? pageBrand : readBrand(brand);
}

function inPage() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') throw new DrawProblem(NOT_READY);
}

/** The look as it is right now: colours and faces by name, from the page's own stylesheet. */
function readLook() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  const body = read('--font-body') || 'sans-serif';
  const colour = (name) => {
    const value = read(name);
    if (value === '') throw new DrawProblem(NOT_READY);
    return value;
  };
  return {
    colour,
    /** A part of `cardPaint`: a look's name read from the page, or the brand's own colour as it is. */
    paint: (value) => (isLookName(value) ? colour(value) : value),
    display: read('--font-display') || body,
    body,
    weight: read('--display-weight') || '700',
  };
}

/** Waits for the look's faces at the sizes used, so the canvas draws in them and not in a stand-in. */
async function loadFaces(fonts) {
  if (typeof document.fonts?.load !== 'function') return;
  await Promise.all(fonts.map((font) => document.fonts.load(font).catch(() => [])));
}

/** A `measure(text, size)` for `layoutWords` that measures on this canvas in `fontFor(size)`. */
function measurer(context, fontFor) {
  return (text, size) => {
    context.font = fontFor(size);
    return context.measureText(text).width;
  };
}

/** An SVG `rect` (with its round corners, `rx`) as path words, for `Path2D`. */
export function rectPath({ x = 0, y = 0, width = 0, height = 0, rx = 0 } = {}) {
  const [left, top, wide, high] = [x, y, width, height].map(Number);
  const r = Math.max(0, Math.min(Number(rx) || 0, wide / 2, high / 2));
  if (r === 0) return `M${left} ${top}h${wide}v${high}h${-wide}Z`;
  return `M${left + r} ${top}h${wide - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${high - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}`
    + `h${-(wide - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(high - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

/** One of lucide's own icons (`[tag, attributes][]`, drawn on a 24 x 24 box) at `size`. */
function drawIcon(context, icon, x, y, size, { fill = null, stroke = null, alpha = 1 } = {}) {
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.globalAlpha = alpha;
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const [tag, attributes] of icon) {
    const d = tag === 'path' ? attributes?.d : tag === 'rect' ? rectPath(attributes) : null;
    if (typeof d !== 'string') continue;
    const path = new Path2D(d);
    if (fill !== null) {
      context.fillStyle = fill;
      context.fill(path);
    }
    if (stroke !== null) {
      context.strokeStyle = stroke;
      context.stroke(path);
    }
  }
  context.restore();
}

/** The kept original, opened as the page shows it (upright), or null for a picture drawn from words. */
async function openSource(picture) {
  if (!canDraw(picture)) throw new DrawProblem(NOT_READY);
  if (!hasOriginal(picture)) return null;
  const image = new Image();
  image.decoding = 'async';
  image.src = fileAddress(picture.id, 'original', picture.original);
  try {
    await image.decode();
  } catch {
    throw new DrawProblem('error.pictureUnreadable');
  }
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new DrawProblem('error.pictureUnreadable');
  return image;
}

function drawCut(context, picture, key, image, look, paint) {
  const { width, height } = SHAPES[key];
  const natural = { width: image.naturalWidth, height: image.naturalHeight, focusX: picture.focusX, focusY: picture.focusY };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (fitFor(picture.fit, key) === 'fill') {
    const cut = fillCut(natural, key);
    if (cut === null) throw new DrawProblem('error.pictureUnreadable');
    // Under a picture with see-through parts, the card's colour rather than black.
    context.fillStyle = look.colour('--card');
    context.fillRect(0, 0, width, height);
    context.drawImage(image, cut.x, cut.y, cut.width, cut.height, 0, 0, width, height);
    return;
  }
  const place = fitPlace(natural, key);
  if (place === null) throw new DrawProblem('error.pictureUnreadable');
  context.fillStyle = look.paint(paint.bg);
  context.fillRect(0, 0, width, height);
  context.drawImage(image, place.x, place.y, place.width, place.height);
}

/** The business's name on one line at the foot of a card (ending before the logo: `nameWidth`). */
function drawName(context, name, box, look, colour, alpha) {
  const value = String(name ?? '').trim();
  if (value === '') return;
  const font = (size) => `400 ${size}px ${look.body}`;
  const line = clipLine(value, box.nameWidth ?? box.width, { size: box.nameSize, measure: measurer(context, font) });
  context.save();
  context.globalAlpha = alpha;
  context.font = font(box.nameSize);
  context.textBaseline = 'alphabetic';
  context.fillStyle = colour;
  context.fillText(line, box.x, box.nameY);
  context.restore();
}

/** Lines of words from `top`, each `size * lineHeight` apart, the words in the middle of their line. */
function drawLines(context, layout, x, top, lineHeight, font, colour) {
  const step = layout.size * lineHeight;
  context.font = font(layout.size);
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillStyle = colour;
  layout.lines.forEach((line, index) => context.fillText(line, x, top + index * step + (step - layout.size) / 2));
}

/** A round-ended badge's outline (a pill), from `x`, `y`, as wide and high as given. */
function pillPath(width, height, x, y) {
  return new Path2D(rectPath({ x, y, width, height, rx: height / 2 }));
}

/** A tip's number in its round badge: the accent and its ink (`cardPaint`; without a brand the card's own pair). */
function drawBadge(context, badge, number, font, look, paint) {
  context.save();
  context.fillStyle = look.paint(paint.accent);
  context.beginPath();
  context.arc(badge.x + badge.size / 2, badge.y + badge.size / 2, badge.size / 2, 0, Math.PI * 2);
  context.fill();
  context.font = font(badge.numberSize);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = look.paint(paint.accentInk);
  context.fillText(number, badge.x + badge.size / 2, badge.y + badge.size / 2);
  context.restore();
}

/** An offer's price in a round-ended badge above the name: the accent and its ink, cut to the card's width. */
function drawPrice(context, price, text, look, paint) {
  const font = (size) => `600 ${size}px ${look.body}`;
  const line = clipLine(text, price.maxWidth - 2 * price.padX, { size: price.size, measure: measurer(context, font) });
  context.font = font(price.size);
  const width = Math.min(price.maxWidth, context.measureText(line).width + 2 * price.padX);
  context.save();
  context.fillStyle = look.paint(paint.accent);
  context.fill(pillPath(width, price.height, price.x, price.y));
  context.font = font(price.size);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = look.paint(paint.accentInk);
  context.fillText(line, price.x + price.padX, price.y + price.height / 2);
  context.restore();
}

/** An event's date line above the name: a calendar mark and the subline, in the words' colour. */
function drawDate(context, date, text, look, ink) {
  const font = (size) => `500 ${size}px ${look.body}`;
  const room = date.maxWidth - date.icon - date.gap;
  const line = clipLine(text, room, { size: date.size, measure: measurer(context, font) });
  drawIcon(context, CALENDAR_ICON, date.x, date.y + (date.height - date.icon) / 2, date.icon, { stroke: ink });
  context.save();
  context.font = font(date.size);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = ink;
  context.fillText(line, date.x + date.icon + date.gap, date.y + date.height / 2);
  context.restore();
}

/** Who said a quote, on one line above the name, in the words' colour. */
function drawBy(context, by, text, look, ink) {
  const font = (size) => `500 ${size}px ${look.body}`;
  const line = clipLine(text, by.maxWidth, { size: by.size, measure: measurer(context, font) });
  context.save();
  context.font = font(by.size);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = ink;
  context.fillText(line, by.x, by.y + by.height / 2);
  context.restore();
}

async function drawWordsCard(context, key, picture, business, look, paint, place, logo) {
  const { width, height } = SHAPES[key];
  const box = wordsCardBox(width, height, { layout: picture.layout, subline: picture.subline, place, logo });
  const font = (size) => `${look.weight} ${size}px ${look.display}`;
  const faces = [font(box.maxSize), `400 ${box.nameSize}px ${look.body}`];
  if (box.price !== null) faces.push(`600 ${box.price.size}px ${look.body}`);
  if (box.date !== null || box.by !== null) faces.push(`500 ${(box.date ?? box.by).size}px ${look.body}`);
  await loadFaces(faces);

  context.fillStyle = look.paint(paint.bg);
  context.fillRect(0, 0, width, height);
  context.save();
  context.globalAlpha = 0.1;
  context.fillStyle = look.colour('--card');
  context.beginPath();
  context.arc(box.circle.x, box.circle.y, box.circle.radius, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const ink = look.paint(paint.ink);
  if (box.badge !== null) drawBadge(context, box.badge, box.parts.badge, font, look, paint);
  if (box.quote !== null) {
    const mark = look.paint(paint.accent);
    drawIcon(context, QUOTE_ICON, box.quote.x, box.quote.y, box.quote.size, { fill: mark, stroke: mark });
  }
  const layout = layoutWords(picture.words, { ...box, measure: measurer(context, font) });
  const block = layout.lines.length * layout.size * box.lineHeight;
  const top = box.top + (box.middle ? Math.max(0, (box.height - block) / 2) : 0);
  drawLines(context, layout, box.x, top, box.lineHeight, font, ink);
  if (box.price !== null) drawPrice(context, box.price, box.parts.price, look, paint);
  if (box.date !== null) drawDate(context, box.date, box.parts.date, look, ink);
  if (box.by !== null) drawBy(context, box.by, box.parts.by, look, ink);
  drawName(context, business, box, look, ink, 0.8);
}

/** How many of the five stars are filled: a whole 1 to 5, else none shown. */
function starsOf(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 0;
}

async function drawCommentCard(context, key, card, look) {
  const { width, height } = SHAPES[key];
  const box = commentCardBox(width, height);
  const font = (size) => `600 ${size}px ${look.display}`;
  await loadFaces([font(box.maxSize), `400 ${box.nameSize}px ${look.body}`]);

  const mark = look.colour('--chart-4');
  context.fillStyle = look.colour('--card');
  context.fillRect(0, 0, width, height);
  context.save();
  context.globalAlpha = 0.12;
  context.fillStyle = mark;
  context.fillRect(0, 0, width, height);
  context.restore();

  drawIcon(context, QUOTE_ICON, box.x, box.quote.y, box.quote.size, { fill: mark, stroke: mark });
  const line = String(card?.bestLine || card?.text || '').trim();
  const layout = layoutWords(line, { ...box, measure: measurer(context, font) });
  drawLines(context, layout, box.x, box.top, box.lineHeight, font, look.colour('--foreground'));

  const stars = starsOf(card?.stars);
  if (stars > 0) {
    const starColour = look.colour('--chart-1');
    for (let index = 0; index < 5; index += 1) {
      const x = box.x + index * (box.stars.size + box.stars.gap);
      const filled = index < stars;
      drawIcon(context, STAR_ICON, x, box.stars.y, box.stars.size, filled ? { fill: starColour, stroke: starColour } : { stroke: starColour, alpha: 0.4 });
    }
  }
  drawName(context, card?.name, box, look, look.colour('--muted-foreground'), 1);
}

function written(canvas, type) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

/**
 * The kept logo, opened, when the brand's pictures carry it (`brand.logo`),
 * else null. A logo that does not open stops the drawing (`NOT_READY`): no
 * copy is kept without the logo it should carry.
 */
async function openLogo(brand) {
  if (brand.logo === null) return null;
  const image = new Image();
  image.decoding = 'async';
  image.src = logoAddress(brand.logo);
  try {
    await image.decode();
  } catch {
    throw new DrawProblem(NOT_READY);
  }
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new DrawProblem(NOT_READY);
  return image;
}

/** The logo in the shape's bottom right corner, in its own proportions (`logoBox`). */
function drawLogo(context, key, logo) {
  const { width, height } = SHAPES[key];
  const box = logoBox(width, height, logo.naturalWidth, logo.naturalHeight);
  context.save();
  context.globalAlpha = 1;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(logo, box.x, box.y, box.width, box.height);
  context.restore();
}

/** One shape drawn from an opened source (or from the picture's words), with the opened logo when there is one. */
async function drawWith(picture, key, image, { themeColour, business, place = null } = {}, brand = NO_BRAND, logo = null) {
  if (!isShapeKey(key)) throw new DrawProblem(NOT_READY);
  const { width, height } = SHAPES[key];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new DrawProblem(NOT_READY);
  const look = readLook();
  const paint = cardPaint(themeColour, brand);
  if (image !== null) drawCut(context, picture, key, image, look, paint);
  else if (picture.source === 'words') await drawWordsCard(context, key, picture, business, look, paint, place, logo !== null);
  else await drawCommentCard(context, key, picture.card, look);
  if (logo !== null) drawLogo(context, key, logo);

  let blob = await written(canvas, 'image/webp');
  if (blob === null || blob.type !== 'image/webp') blob = await written(canvas, 'image/jpeg');
  if (blob === null || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) throw new DrawProblem(NOT_READY);
  return blob;
}

/**
 * The width and height of a picture the person picked, upright as the page
 * shows it, read in the page from the file itself (nothing is sent). Throws a
 * `DrawProblem` (`error.pictureUnreadable`) for a file this browser cannot open.
 *
 * @param {Blob} file
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function readPictureSize(file) {
  inPage();
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      // Tried again below as a plain picture.
    }
  }
  const address = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = address;
    await image.decode();
    if (image.naturalWidth > 0 && image.naturalHeight > 0) return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    // Said below.
  } finally {
    URL.revokeObjectURL(address);
  }
  throw new DrawProblem('error.pictureUnreadable');
}

/**
 * `picture` (a `PictureSummary`) drawn in one shape (`SHAPES` key), as a WebP
 * `Blob` (JPEG where the browser writes no WebP). `themeColour` is the post's
 * theme colour (0 to 4, else the look's main colour); `business` the name a
 * words picture carries at its foot; `place` a tip's number (its badge is
 * drawn only with one); `brand` the business's brand (`readBrand`; when
 * not given, the page's: `setPageBrand`).
 *
 * @param {object} picture
 * @param {string} shapeKey
 * @param {{ themeColour?: number | null, business?: string, place?: number | null, brand?: object | null }} [options]
 * @returns {Promise<Blob>}
 */
export async function drawShape(picture, shapeKey, options = {}) {
  inPage();
  if (!isShapeKey(shapeKey)) throw new DrawProblem(NOT_READY);
  const brand = drawingBrand(options.brand);
  const image = await openSource(picture);
  const logo = await openLogo(brand);
  return drawWith(picture, shapeKey, image, options, brand, logo);
}

/**
 * Keeps `picture`'s copies in `shapeKeys`: draws each shape it has no copy of
 * yet (a theme change clears the copies drawn on the old colour, so they are
 * drawn again), keeps each as a file
 * with `sendFile`, then names them all in the picture's record with one
 * `PATCH /api/pictures/[id]` `{ shapes }`, and answers the picture as the
 * app saved it. With nothing to draw it answers `picture` as it was.
 *
 * All or nothing: the record is changed only after every file is kept, and
 * names only files that `sendFile` confirmed. A failure on the way throws
 * (`DrawProblem` or `FileProblem`, each with a `messageKey`) before anything
 * is named, and the files already kept stay unnamed (the kit's clean-up
 * removes those). A refused `PATCH` changes nothing.
 *
 * `place`: a tip's number, and `brand` the business's brand, as `drawShape`
 * takes them.
 *
 * @param {object} picture
 * @param {string[]} shapeKeys
 * @param {{ themeColour?: number | null, business?: string, place?: number | null, brand?: object | null, signal?: AbortSignal }} [options]
 * @returns {Promise<object>}
 */
export async function keepShapes(picture, shapeKeys, { themeColour, business, place = null, brand: given, signal } = {}) {
  inPage();
  if (picture === null || typeof picture !== 'object' || picture.id === undefined || picture.id === null) throw new DrawProblem(NOT_READY);
  const wanted = missingShapes(picture, shapeKeys);
  if (wanted.length === 0) return picture;

  const brand = drawingBrand(given);
  const image = await openSource(picture);
  const logo = await openLogo(brand);
  const shapes = {};
  for (const key of wanted) {
    const blob = await drawWith(picture, key, image, { themeColour, business, place }, brand, logo);
    const kept = await sendFile(blob, { signal });
    shapes[key] = kept.file;
  }

  let response;
  try {
    response = await fetch(`/api/pictures/${encodeURIComponent(String(picture.id))}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shapes }),
      signal,
    });
  } catch {
    throw new DrawProblem('error.saveFailed');
  }
  const answer = await response.json().catch(() => null);
  if (!response.ok || answer?.picture === null || typeof answer?.picture !== 'object') {
    throw new DrawProblem(problemOf(answer, 'error.saveFailed'));
  }
  return answer.picture;
}
