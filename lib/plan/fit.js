/**
 * Fitting a post's words to a network, the silent fixes the app makes when it
 * writes words (Make my post, with or without AI): a web address on a network
 * where links cannot be pressed goes, and the "link in profile" sentence takes
 * its place; hashtags go down to the network's advice; words over the
 * network's limit are cut at the last sentence end that fits, else the last
 * word that fits, never with an ellipsis. A person's own edit is never fitted
 * here: the checks (`checks.js`) say what is over instead.
 */

import { countFor, findAddresses, graphemesOf } from './count.js';
import { BYTES_A_LETTER, LIMITS, wireBytes } from './limits.js';
import { TELEGRAM_CAPTION_LIMIT, networkByKey } from './networks.js';
import { sharedWords } from './share.js';

/** A hashtag as written at the end of a text: `#`, then letters, digits or `_` with one letter at least. */
const HASHTAG_WORD = /^#[\p{L}\p{M}\p{N}_]*\p{L}[\p{L}\p{M}\p{N}_]*$/u;
/** Between the hashtags of a list: spaces, commas, semicolons or the next `#`. */
const BETWEEN_TAGS = /[\s,;，、#]+/u;
/** What a hashtag keeps of a word: letters (with their marks), digits and `_`, in any script. */
const NOT_TAG = /[^\p{L}\p{M}\p{N}_]/gu;
/** The end of a sentence: its marks and any closing quote or bracket, before a space or the end; or a line's end. */
const SENTENCE_END = /[.!?…。！？]+[)"'’”»\]]*(?=\s|$)|(?=\n)/gu;
/** Marks a cut at a word should not leave hanging at the end. */
const HANGING = /[\s,;:\-–—]+$/u;

/** A text as the app keeps it: line ends as `\n`, trimmed. @param {unknown} value */
function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/gu, '\n').trim() : '';
}

/**
 * The hashtags written at the very end of a text, split from its words. Only
 * whole words that start with `#` (and hold a letter) count, so "We are #1" keeps
 * its words. The hashtags come back as written; `normaliseHashtags` tidies them.
 *
 * @param {unknown} text
 * @returns {{ text: string, hashtags: string[] }}
 */
export function splitHashtags(text) {
  const value = cleanText(text);
  const parts = value.split(/(\s+)/u);
  const hashtags = [];
  let index = parts.length - 1;
  while (index >= 0) {
    const part = parts[index];
    if (part === '' || /^\s+$/u.test(part)) {
      index -= 1;
      continue;
    }
    if (!HASHTAG_WORD.test(part)) break;
    hashtags.unshift(part);
    index -= 1;
  }
  return { text: parts.slice(0, index + 1).join('').trim(), hashtags };
}

/** The same hashtag in any capitals (a dotted capital I folds to a plain i). @param {string} tag */
function tagFold(tag) {
  return tag.toLowerCase().replace(/i\u0307/gu, 'i');
}

/**
 * Hashtags from a string or a list: each `#word` with letters, digits and `_`
 * in any script (other marks inside a word are dropped, so "mug-painting"
 * becomes `#mugpainting`), with one letter at least, at most
 * `LIMITS.hashtagLength` characters and `BYTES_A_LETTER` x that many bytes
 * (as a version keeps them: a longer one is left out, never cut), each once
 * whatever its capitals (the first spelling is kept), in their order, at most
 * `LIMITS.hashtags`.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normaliseHashtags(value) {
  let items = [];
  if (typeof value === 'string') items = value.split(BETWEEN_TAGS);
  else if (Array.isArray(value)) items = value.flatMap((item) => (typeof item === 'string' ? item.split(BETWEEN_TAGS) : []));
  const seen = new Set();
  const tags = [];
  for (const item of items) {
    const word = item.normalize('NFC').replace(NOT_TAG, '');
    if (!/\p{L}/u.test(word)) continue;
    const tag = `#${word}`;
    if (Array.from(tag).length > LIMITS.hashtagLength || wireBytes(tag) > BYTES_A_LETTER * LIMITS.hashtagLength) continue;
    const fold = tagFold(tag);
    if (seen.has(fold)) continue;
    seen.add(fold);
    tags.push(tag);
    if (tags.length === LIMITS.hashtags) break;
  }
  return tags;
}

/**
 * The words with every web address taken out and the spaces it leaves tidied.
 *
 * @param {string} text
 * @returns {{ text: string, removed: number }}
 */
export function removeAddresses(text) {
  const addresses = findAddresses(text);
  if (addresses.length === 0) return { text, removed: 0 };
  let kept = '';
  let from = 0;
  for (const { start, end } of addresses) {
    kept += text.slice(from, start);
    from = end;
  }
  kept += text.slice(from);
  const tidied = kept
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/gu, ' ').replace(/[ \t]+([.,!?;:])/gu, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return { text: tidied, removed: addresses.length };
}

/** The words with a sentence added at their end: in the same paragraph after a sentence end, else on its own. */
function addSentence(words, sentence) {
  if (words === '') return sentence;
  return /[.!?…。！？][)"'’”»\]]*$/u.test(words) ? `${words} ${sentence}` : `${words}\n\n${sentence}`;
}

/** The largest place in `places` (ascending) whose cut `fits`, or null. */
function longestFit(places, cutAt, fits) {
  let low = 0;
  let high = places.length - 1;
  let best = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = cutAt(places[middle]);
    if (candidate !== '' && fits(candidate)) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

/** The words cut so that `fits` holds: at a sentence end, else a word end, else a character. */
function cutWords(words, fits) {
  const sentenceEnds = [];
  for (const match of words.matchAll(SENTENCE_END)) sentenceEnds.push(match.index + match[0].length);
  const atSentence = longestFit(sentenceEnds, (place) => words.slice(0, place).trim(), fits);
  if (atSentence !== null) return atSentence;
  const wordEnds = [];
  for (const match of words.matchAll(/\S(?=\s)/gu)) wordEnds.push(match.index + match[0].length);
  const atWord = longestFit(wordEnds, (place) => words.slice(0, place).replace(HANGING, ''), fits);
  if (atWord !== null) return atWord;
  const characterEnds = [];
  let length = 0;
  for (const grapheme of graphemesOf(words)) {
    length += grapheme.length;
    characterEnds.push(length);
  }
  return longestFit(characterEnds, (place) => words.slice(0, place).trim(), fits) ?? '';
}

/**
 * One network's words, fitted as this file's note says.
 *
 * - `text`: the post's words; `hashtags`: a string or list (tidied by
 *   `normaliseHashtags`); `linkSentence`: the "link in profile" sentence from
 *   Ready words ('' for none); `link`: the version's own link; `withPicture`:
 *   the post goes with a picture (Telegram then takes a caption's limit).
 * - On a network where links cannot be pressed, each web address in the words
 *   goes; the link sentence is added once at the end when an address went and
 *   the sentence is not empty (and not already there).
 * - At most the network's advised most of hashtags is kept (none for WhatsApp
 *   and Google).
 * - The words as they are shared (`sharedWords` in `share.js`: the words, the
 *   version's link on a network where links can be pressed, the hashtags,
 *   joined by blank lines) are cut to the network's limit as it counts them
 *   (X counts the link as 23); the link and the hashtags are kept whole and
 *   the words are cut, so the shared words never go over once the link is
 *   added.
 *
 * Answers `{ text, hashtags (space joined), cut }`; `cut` is true when words
 * were cut to fit the limit. An unknown network answers the words as they are.
 *
 * `tracking`: the post's link tracking (`share.js`), so the words leave room
 * for the tracked link.
 *
 * @param {{ network: string, text?: unknown, hashtags?: unknown, linkSentence?: unknown, link?: unknown, withPicture?: boolean, tracking?: import('./share.js').Tracking }} options
 * @returns {{ text: string, hashtags: string, cut: boolean }}
 */
export function fitWords({ network, text, hashtags, linkSentence = '', link = '', withPicture = false, tracking = {} } = {}) {
  const item = networkByKey(network);
  let words = cleanText(text);
  let tags = normaliseHashtags(hashtags ?? []);
  if (!item) return { text: words, hashtags: tags.join(' '), cut: false };

  if (item.links === 'not-pressable') {
    const { text: kept, removed } = removeAddresses(words);
    words = kept;
    const sentence = cleanText(linkSentence);
    if (removed > 0 && sentence !== '' && !words.includes(sentence)) words = addSentence(words, sentence);
  }

  tags = tags.slice(0, item.hashtagAdvice[1]);
  const limit = item.key === 'telegram' && withPicture ? TELEGRAM_CAPTION_LIMIT : item.limit;
  const counted = (candidate, tagText) => countFor(item.key, sharedWords(item.key, { text: candidate, link, hashtags: tagText }, tracking));
  if (counted(words, tags.join(' ')) <= limit) return { text: words, hashtags: tags.join(' '), cut: false };

  while (tags.length > 0 && counted('', tags.join(' ')) > limit) tags.pop();
  const tagText = tags.join(' ');
  const fits = (candidate) => counted(candidate, tagText) <= limit;
  return { text: cutWords(words, fits), hashtags: tagText, cut: true };
}
