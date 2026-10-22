/**
 * How long a network finds a text, counted the way the network counts.
 *
 * - `graphemes`: what a person sees as one character counts one (an emoji
 *   made of several code points, a flag or a letter with a mark is one).
 * - `x`: X's weighted count, approximated from its published weighting
 *   (twitter-text, configuration v3): every web address counts 23 whatever
 *   its length; a character in the narrow ranges (U+0000 to U+10FF, which hold
 *   Latin, Latin-1, Latin Extended, Greek, Cyrillic, Hebrew, Arabic and more,
 *   and the general punctuation U+2000-U+200D, U+2010-U+201F, U+2032-U+2037)
 *   counts 1; every other character (Chinese, Japanese, Korean, most symbols)
 *   counts 2, and an emoji, however many code points it is made of, counts 2.
 *   X also counts a bare domain without `www.` as an address; this count does
 *   not (it finds `http://`, `https://` and `www.` addresses only), so such a
 *   text may count a little differently on X.
 *
 * The count of a text with its hashtags is the count of the words, a blank
 * line and the hashtags (see `joinWords`).
 */

import { networkByKey } from './networks.js';

/** The count X gives every web address, whatever its length. */
export const X_LINK_WEIGHT = 23;

/** A web address in a person's words: `http://`, `https://` or `www.` up to the next space. */
const ADDRESS = /(?:https?:\/\/|www\.)[^\s<>"]+/giu;
/** Marks that end a sentence or close a bracket, left out of an address that ends with them. */
const TRAILING = /[.,!?;:'")\]}…»”’]+$/u;

let graphemeSegmenter = null;

function segmenter() {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return graphemeSegmenter;
}

/**
 * The web addresses in a text, each `{ start, end, address }` (end not kept),
 * with closing punctuation after an address left out of it.
 *
 * @param {string} text
 * @returns {Array<{ start: number, end: number, address: string }>}
 */
export function findAddresses(text) {
  if (typeof text !== 'string' || text === '') return [];
  const found = [];
  for (const match of text.matchAll(ADDRESS)) {
    const address = match[0].replace(TRAILING, '');
    if (/^(?:https?:\/\/|www\.)$/iu.test(address)) continue;
    found.push({ start: match.index, end: match.index + address.length, address });
  }
  return found;
}

/** The graphemes of a text. @param {string} text */
export function graphemesOf(text) {
  return Array.from(segmenter().segment(text), (part) => part.segment);
}

/** How many graphemes a text holds. @param {string} text */
export function countGraphemes(text) {
  if (typeof text !== 'string' || text === '') return 0;
  let count = 0;
  for (const _ of segmenter().segment(text)) count += 1;
  return count;
}

/** @param {number} codePoint */
function narrow(codePoint) {
  return codePoint <= 0x10ff
    || (codePoint >= 0x2000 && codePoint <= 0x200d)
    || (codePoint >= 0x2010 && codePoint <= 0x201f)
    || (codePoint >= 0x2032 && codePoint <= 0x2037);
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/**
 * X's weighted count of words that hold no web address: one code point by its
 * range; an emoji of several code points (a skin tone, a family, a flag, a
 * keycap) as one wide character.
 */
function weighWords(text) {
  let count = 0;
  for (const { segment } of segmenter().segment(text)) {
    const characters = Array.from(segment);
    if (characters.length > 1 && EMOJI.test(segment)) {
      count += 2;
      continue;
    }
    for (const character of characters) count += narrow(character.codePointAt(0)) ? 1 : 2;
  }
  return count;
}

/** X's weighted count of a text (approximated as this file's note says). @param {string} text */
export function countForX(text) {
  if (typeof text !== 'string' || text === '') return 0;
  const normal = text.normalize('NFC');
  let count = 0;
  let from = 0;
  for (const { start, end } of findAddresses(normal)) {
    count += weighWords(normal.slice(from, start)) + X_LINK_WEIGHT;
    from = end;
  }
  return count + weighWords(normal.slice(from));
}

/**
 * How long `text` is as the network counts it. An unknown network counts
 * graphemes. A value that is not text counts 0.
 *
 * @param {string} networkKey
 * @param {unknown} text
 * @returns {number}
 */
export function countFor(networkKey, text) {
  if (typeof text !== 'string' || text === '') return 0;
  return networkByKey(networkKey)?.counting === 'x' ? countForX(text) : countGraphemes(text);
}

/** Hashtags as one line of words, from a line or a list (anything else is none). @param {unknown} hashtags */
export function hashtagText(hashtags) {
  if (Array.isArray(hashtags)) return hashtags.filter((item) => typeof item === 'string').join(' ').trim();
  return typeof hashtags === 'string' ? hashtags.trim() : '';
}

/**
 * The words with their hashtags as a post carries them: the words, a blank
 * line, the hashtags (either alone when the other is empty).
 *
 * @param {string} text
 * @param {string} hashtags
 */
export function joinWords(text, hashtags) {
  const words = typeof text === 'string' ? text.trim() : '';
  const tags = typeof hashtags === 'string' ? hashtags.trim() : '';
  if (words === '') return tags;
  if (tags === '') return words;
  return `${words}\n\n${tags}`;
}
