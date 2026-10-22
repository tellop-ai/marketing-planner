/**
 * The picture rules that need no page and no records, shared by the picture
 * strip (`app/pictures/rules.js` hands them on) and the canvas drawing
 * (`./draw.js`): which shapes a picture still misses, whether the page can
 * draw them, a kept file's address, and how an address's refusal is read.
 * Pure: the browser loads it too.
 */

import { isShapeKey } from './shapes.js';

/** Where a picture's sources may come from that has a kept original file. */
const WITH_ORIGINAL = Object.freeze(['photo', 'drawn', 'changed']);

/**
 * The shapes in `keys` that `picture` has no kept copy of yet, each once.
 *
 * @param {{ shapes?: Record<string, string | null> } | null | undefined} picture
 * @param {unknown} keys
 * @returns {string[]}
 */
export function missingShapes(picture, keys) {
  if (!Array.isArray(keys)) return [];
  const missing = [];
  for (const key of keys) {
    if (isShapeKey(key) && !picture?.shapes?.[key] && !missing.includes(key)) missing.push(key);
  }
  return missing;
}

/** Whether the picture has a kept original that a canvas can cut its shapes from. */
export function hasOriginal(picture) {
  return WITH_ORIGINAL.includes(picture?.source) && typeof picture?.original === 'string' && picture.original !== '';
}

/**
 * Whether the page can draw the picture's shapes now (a words or card
 * picture, or one with its original). Never a comment card whose customer has
 * not said yes to sharing (`cardRefused`: the app no longer reads its words).
 */
export function canDraw(picture) {
  if (picture?.source === 'words') return typeof picture.words === 'string' && picture.words.trim() !== '';
  if (picture?.source === 'card') return picture.cardRefused !== true && picture.card !== null && typeof picture.card === 'object';
  return hasOriginal(picture);
}

/**
 * The app's address for one of a picture's kept files: a shape's copy or
 * `original`, with `tag` (the first characters of the file's digest) so a
 * changed file has a new address.
 *
 * @param {number | string} id
 * @param {string} shape
 * @param {string | null | undefined} tag
 */
export function fileAddress(id, shape, tag) {
  const address = `/api/pictures/${encodeURIComponent(String(id))}/file?shape=${encodeURIComponent(shape)}`;
  return typeof tag === 'string' && tag !== '' ? `${address}&v=${encodeURIComponent(tag)}` : address;
}

const WORDS_PATTERN = /^[A-Za-z][\w-]*(?:\.[\w-]+)+$/u;

/**
 * The words key an address answered with its refusal (`problem`, or an AI
 * problem's `aiProblem`), or `fallback` when the answer holds none that looks
 * like a key.
 *
 * @param {unknown} answer
 * @param {string} [fallback]
 */
export function problemOf(answer, fallback = 'error.saveFailed') {
  for (const name of ['problem', 'aiProblem']) {
    const value = answer && typeof answer === 'object' ? answer[name] : undefined;
    if (typeof value === 'string' && WORDS_PATTERN.test(value)) return value;
  }
  return fallback;
}
