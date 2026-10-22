/**
 * What this app asks of AI for a post's sets of pictures and its video plan,
 * and how it reads the answers back: Make slides
 * (a swipe set of words pictures), Make a story set (tall frames) and Make a
 * video plan. Pure functions only: the addresses (`app/api/posts/[id]/slides`,
 * `.../stories`, `.../video-plan`) read the records, call `lib/ai.js` and
 * save.
 *
 * The person's content (the post's words and name, the business, the theme,
 * the special day) travels only inside Make my post's content block
 * (`contentBlock`, `CONTENT_RULE` in `ai-words.js`); the app's own rules and
 * the post's ask (one of the app's choices, never typed) go in the
 * instructions. Every answer is read strictly: only the shape asked for,
 * every line cut to its most, and an answer that does not read is `null`
 * (the address then makes the same thing without AI and says
 * `aiplan.unreadable`).
 *
 * Without AI the app makes them itself: a set from the post's own sentences,
 * the first one first, ending with the ask's fixed sentence; a video plan
 * from a fixed template in the app's words (`aiplan.video.*`).
 */

import { askOf } from './asks.js';
import { ASK_RULES, CONTENT_RULE, clipText, contentBlock, languageName, oneLine, parseAnswer } from './ai-words.js';
import { removeAddresses, splitHashtags } from './fit.js';
import { readVideoPlan, videoPlanSeconds, VIDEO_PLAN } from './video-plan.js';

/**
 * The two sets AI makes: how many items it is asked for (`least` to `most`,
 * `count` when the page names none) and the layouts it may give them. A story
 * frame is never a numbered tip.
 */
export const SETS = Object.freeze({
  slide: Object.freeze({ least: 5, most: 8, count: 6, layouts: Object.freeze(['words', 'tip', 'quote', 'offer']), answer: 'slides', noun: 'slide' }),
  story: Object.freeze({ least: 3, most: 5, count: 4, layouts: Object.freeze(['words', 'quote', 'offer']), answer: 'frames', noun: 'frame' }),
});

/** The most letters of a set item's words, and of the line under them. */
export const SET_WORDS_MOST = 110;
export const SET_SUBLINE_MOST = 60;

/** The fewest items an AI answer holds to be a set at all. */
const SET_FEWEST = 2;

/** A video plan's length in all, in seconds, from AI. */
export const VIDEO_SECONDS = Object.freeze([15, 30]);

/** The seconds of the template's four shots (25 in all). */
export const TEMPLATE_SECONDS = Object.freeze([3, 8, 8, 6]);

/** How long the lines AI writes for a video plan are kept, in letters (a little over what it is asked for). */
const VIDEO_LINES = Object.freeze({ hook: 120, what: 200, onScreen: 80, cover: 200 });

/** @param {unknown} value */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} text */
const hasWords = (text) => /[\p{L}\p{N}]/u.test(text);

/**
 * How many items the page asked for: none is the set's `count`; a whole
 * number from `least` to `most`, else `refuse.number`.
 *
 * @param {unknown} value
 * @param {'slide' | 'story'} kind
 * @returns {{ ok: true, value: number } | { ok: false, problem: string }}
 */
export function readSetCount(value, kind) {
  const set = SETS[kind];
  if (value === undefined || value === null) return { ok: true, value: set.count };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < set.least || value > set.most) return { ok: false, problem: 'refuse.number' };
  return { ok: true, value };
}

/**
 * How many new pictures a remade set may hold (Make slides and Make a story
 * set replace the set made before, `saveWordsSetFor` with `replace`): the
 * words pictures now in that set and in no other, never the chosen one, go;
 * a swipe set keeps the chosen picture as its cover; the post keeps at most
 * `LIMITS.picturesPerPost` pictures and the set at most `SET_LIMITS[kind]`.
 * The address refuses before any AI call when fewer than two fit
 * (`refuse.picture.tooMany`).
 *
 * @param {{ pictures?: Array<{ source?: string, chosen?: boolean, slide?: number | null, story?: number | null }> } | null} full
 * @param {'slide' | 'story'} kind
 * @param {{ picturesPerPost: number, setMost: number }} limits
 */
export function setRoom(full, kind, { picturesPerPost, setMost }) {
  const other = kind === 'slide' ? 'story' : 'slide';
  const pictures = Array.isArray(full?.pictures) ? full.pictures : [];
  const inSet = (picture, set) => Number.isInteger(picture?.[set]);
  const going = pictures.filter((picture) => picture?.source === 'words' && inSet(picture, kind) && !inSet(picture, other) && picture?.chosen !== true).length;
  const cover = kind === 'slide' && pictures.some((picture) => picture?.chosen === true) ? 1 : 0;
  return Math.max(0, Math.min(setMost - cover, picturesPerPost - (pictures.length - going)));
}

/**
 * Whether a post already has a set of this kind (a picture with a place in
 * it). Making a set again keeps that set when the AI cannot make a new one:
 * the post's own sentences make a set only when there is none yet.
 *
 * @param {{ pictures?: Array<{ slide?: number | null, story?: number | null }> } | null} full
 * @param {'slide' | 'story'} kind
 */
export function hasSet(full, kind) {
  const pictures = Array.isArray(full?.pictures) ? full.pictures : [];
  return pictures.some((picture) => Number.isInteger(picture?.[kind]) && /** @type {number} */ (picture[kind]) > 0);
}

/** The fewest new pictures a set is made of. */
export const SET_LEAST_ROOM = SET_FEWEST;

/**
 * The words a post's sets and video plan are made from: its main words, else
 * the words of its first version that has some, else ''.
 *
 * @param {{ post?: { mainText?: string }, versions?: Array<{ text?: string }> } | null} full
 */
export function postWords(full) {
  const main = typeof full?.post?.mainText === 'string' ? full.post.mainText.trim() : '';
  if (main !== '') return main;
  for (const version of full?.versions ?? []) {
    const text = typeof version?.text === 'string' ? version.text.trim() : '';
    if (text !== '') return text;
  }
  return '';
}

/**
 * The person's content for a set or a video plan, with only the fields that
 * hold something.
 *
 * @param {{ words?: string, name?: string, business?: Record<string, string>, theme?: Record<string, unknown> | null, specialDay?: Record<string, string> | null }} input
 */
function contentOf({ words = '', name = '', business = {}, theme = null, specialDay = null }) {
  const content = { words: typeof words === 'string' ? words.replace(/\r\n?/gu, '\n').trim() : '', business };
  const title = oneLine(name);
  if (title !== '') content.name = title;
  if (theme) content.theme = theme;
  if (specialDay) content.specialDay = specialDay;
  return content;
}

/** The writing rules every request here shares. */
const WRITING = 'Write from the person\'s words ("words") and the post\'s name ("name"): in the business\'s voice ("business.voice") when it is given, for the theme ("theme") and the special day ("specialDay") when they are given. When "specialDay.kind" is "remembrance", write calmly and respectfully, with no offer or sale. Keep the person\'s facts (prices, days, names, addresses) as they wrote them; never invent a price, a date, a discount or a claim.';

/**
 * What the last item of a set (or a video's last line) asks, as the
 * instructions say it. On a picture nothing can be pressed, so Visit says
 * that the link is in the profile.
 *
 * @param {unknown} ask
 */
function pictureAskRule(ask) {
  const key = askOf(ask);
  if (key === 'visit') return 'visit the link, and says that the link is in the profile ("Link in our profile", in the language of the words)';
  return ASK_RULES[key];
}

/**
 * The request for Make slides (`kind` `slide`) or Make a story set (`story`):
 * exactly `count` items. Slides: the first stops the scroll (a promise or a
 * question), each one between makes one point, the last carries the ask.
 * Frames: a question, then a second point, the offer or the point, and the
 * ask last. No poll: a picture cannot take a viewer's answer, so a story
 * frame never asks for one.
 * `subline`), the offer or the point, and the ask last.
 *
 * @param {{
 *   kind: 'slide' | 'story',
 *   count: number,
 *   words?: string,
 *   name?: string,
 *   business?: Record<string, string>,
 *   theme?: Record<string, unknown> | null,
 *   specialDay?: Record<string, string> | null,
 *   ask?: string,
 *   locale?: string,
 * }} input `ask`: the post's ask (`askOn`), '' for none
 * @returns {Array<{ role: 'system' | 'user', content: string }>}
 */
export function setMessages({ kind, count, words = '', name = '', business = {}, theme = null, specialDay = null, ask = '', locale = 'en' }) {
  const set = SETS[kind];
  const key = askOf(ask);
  const language = languageName(locale);
  let opening;
  let order;
  if (kind === 'slide') {
    opening = `You write the words for a swipe post: ${count} picture slides that people swipe through, for a small business's social media. Write every slide in ${language}.`;
    order = `Make exactly ${count} slides. Slide 1 stops the scroll: a promise or a question. Each slide in between makes one point. ${key === '' ? 'The last slide sums up the point in a few words.' : `The last slide carries the ask: it asks the reader to ${pictureAskRule(key)}.`}`;
  } else {
    opening = `You write the words for a story: ${count} tall pictures shown one after another for a few seconds each, for a small business's social media. Write every frame in ${language}.`;
    order = `Make exactly ${count} frames, in this order: frame 1 asks the viewer a question; frame 2 makes a second point; the frames after that give the offer or the point, one each; ${key === '' ? 'the last frame sums up the point.' : `the last frame carries the ask: it asks the viewer to ${pictureAskRule(key)}.`}`;
  }
  const layouts = [
    '"words" (plain words)',
    ...(set.layouts.includes('tip') ? ['"tip" (one tip of a list: the picture draws its number, so never write the number)'] : []),
    '"quote" (words someone said, without quote marks; their name in "subline")',
    '"offer" (an offer, with its price or its date in "subline")',
  ];
  const system = [
    opening,
    CONTENT_RULE,
    WRITING,
    order,
    `Each ${set.noun}'s "words" are at most ${SET_WORDS_MOST} characters, plain and short, with no hashtags and no web address (nothing on a picture can be pressed). "layout" is one of: ${layouts.join(', ')}. "subline" is "" or one short line under the words, at most ${SET_SUBLINE_MOST} characters.`,
    `Answer only with a JSON object and nothing else: {"${set.answer}": [{"words": "the words", "layout": "words", "subline": ""}]}.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Write the ${set.answer} for this content.\n${contentBlock(contentOf({ words, name, business, theme, specialDay }))}` },
  ];
}

/**
 * One item's words as a picture keeps them: one line, with no hashtags at
 * the end and no web address; a tip without the number AI wrote before it
 * (the picture draws it), a quote without the marks around it; at most
 * `SET_WORDS_MOST` letters. '' when nothing with letters or digits is left.
 *
 * @param {unknown} value
 * @param {string} layout
 */
function itemWords(value, layout) {
  let words = splitHashtags(removeAddresses(oneLine(value)).text).text;
  if (layout === 'tip') words = words.replace(/^(?:#\s?)?\d{1,2}\s*[.):\-–—]\s*/u, '');
  if (layout === 'quote') words = words.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/gu, '');
  words = oneLine(words);
  return hasWords(words) ? clipText(words, SET_WORDS_MOST) : '';
}

/**
 * The items of a set in an answer (`slides` for a swipe set, `frames` for a
 * story set): each `{ words, layout, subline }`, its words read by
 * `itemWords` (an item with none is left out), a layout the set does not
 * take read as `words`, the subline one line of at most `SET_SUBLINE_MOST`.
 * More than `count` items keep the first ones and the last (the ask). Null
 * when the answer does not read, or holds fewer than two items.
 *
 * @param {unknown} text
 * @param {{ kind: 'slide' | 'story', count: number }} options
 * @returns {Array<{ words: string, layout: string, subline: string }> | null}
 */
export function readSetAnswer(text, { kind, count }) {
  const set = SETS[kind];
  const value = parseAnswer(text);
  const list = value === null ? null : value[set.answer];
  if (!Array.isArray(list)) return null;
  const items = [];
  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const layout = typeof item.layout === 'string' && set.layouts.includes(item.layout) ? item.layout : 'words';
    const words = itemWords(item.words, layout);
    if (words === '') continue;
    items.push({ words, layout, subline: clipText(oneLine(item.subline), SET_SUBLINE_MOST) });
  }
  if (items.length < SET_FEWEST) return null;
  return items.length > count ? [...items.slice(0, count - 1), items[items.length - 1]] : items;
}

/**
 * A post's words as sentences for pictures: no hashtags at the end, split
 * after each sentence end and at each line end, each one line with letters or
 * digits (a line of hashtags alone is left out), at most `SET_WORDS_MOST`
 * letters. A sentence that holds a web address is left out whole (nothing on
 * a picture can be pressed, and taking the address out of it leaves a broken
 * sentence: "Fresh mugs this Saturday at.").
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function sentencesOf(text) {
  const clean = splitHashtags(typeof text === 'string' ? text : '').text;
  const pieces = [];
  let from = 0;
  for (const match of clean.matchAll(/[.!?…。！？]+[)"'’”»\]]*(?=\s|$)|\n/gu)) {
    const end = match.index + match[0].length;
    pieces.push(clean.slice(from, end));
    from = end;
  }
  pieces.push(clean.slice(from));
  return pieces
    .filter((piece) => removeAddresses(piece).removed === 0)
    .map((piece) => oneLine(piece))
    .filter((piece) => hasWords(piece) && !piece.split(' ').every((part) => part.startsWith('#')))
    .map((piece) => clipText(piece, SET_WORDS_MOST));
}

/** A sentence as two that say the same compare: no end marks, one case. @param {string} sentence */
function sameSentenceKey(sentence) {
  return sentence.replace(/[.!?…。！？]+$/u, '').trim().toLocaleLowerCase();
}

/**
 * A set made without AI: the post's own sentences (`sentencesOf`), the
 * first one first (a sentence that repeats an earlier one, as a name line
 * above the same first sentence does, is left out), at most `count` items with the ask's sentence
 * (`askSentence`, '' for none) as the last. Empty when the words hold nothing
 * to put on a picture (the address then refuses `refuse.text.missing`).
 *
 * @param {{ count: number, words?: string, askSentence?: string }} input
 * @returns {Array<{ words: string, layout: 'words', subline: '' }>}
 */
export function fallbackSet({ count, words = '', askSentence = '' }) {
  const seen = new Set();
  const sentences = sentencesOf(words).filter((sentence) => {
    const key = sameSentenceKey(sentence);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (sentences.length === 0) return [];
  const ask = clipText(oneLine(askSentence), SET_WORDS_MOST);
  const own = ask === '' ? sentences.slice(0, count) : sentences.filter((sentence) => sentence !== ask).slice(0, Math.max(1, count - 1));
  const items = own.map((sentence) => ({ words: sentence, layout: /** @type {const} */ ('words'), subline: /** @type {const} */ ('') }));
  if (ask !== '') items.push({ words: ask, layout: 'words', subline: '' });
  return items;
}

// --- the video plan ---------------------------------------------------------------------

/**
 * The request for Make a video plan: a hook, three to six shots of 15 to 30
 * seconds in all, two to four lines on screen (the last carries the ask) and
 * the cover.
 *
 * @param {{
 *   words?: string,
 *   name?: string,
 *   business?: Record<string, string>,
 *   theme?: Record<string, unknown> | null,
 *   specialDay?: Record<string, string> | null,
 *   ask?: string,
 *   locale?: string,
 * }} input
 * @returns {Array<{ role: 'system' | 'user', content: string }>}
 */
export function videoPlanMessages({ words = '', name = '', business = {}, theme = null, specialDay = null, ask = '', locale = 'en' }) {
  const key = askOf(ask);
  const [least, most] = VIDEO_SECONDS;
  const system = [
    `You plan a short video for a small business's social media post: ${least} to ${most} seconds, filmed on a phone in the business's own place, with no special gear. Write in ${languageName(locale)}.`,
    CONTENT_RULE,
    WRITING,
    `"hook": the words said or shown in the first second, which make people stop scrolling (at most 80 characters). "shots": 3 to ${VIDEO_PLAN.shots} shots in order, each {"what": what to film, one plain line of at most 120 characters, "seconds": a whole number of seconds}; the shots add up to ${least} to ${most} seconds. "onScreen": 2 to 4 short lines of words shown on the video, at most 40 characters each${key === '' ? '' : `; the last line carries the ask: it asks the viewer to ${pictureAskRule(key)}`}. "cover": what the cover picture shows, one line of at most 120 characters.`,
    'Answer only with a JSON object and nothing else: {"hook": "the hook", "shots": [{"what": "what to film", "seconds": 5}], "onScreen": ["a line"], "cover": "the cover"}.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Plan the video for this content.\n${contentBlock(contentOf({ words, name, business, theme, specialDay }))}` },
  ];
}

/**
 * The video plan in an answer, as a post keeps it (`readVideoPlan`): a hook
 * (required), shots with words and whole seconds from 1 to 60 (others left
 * out; at most six), lines on screen (at most six), the cover; each line one
 * line cut to its most. Null when the answer does not read, has no hook or no
 * shot, or its shots do not add up to 15 to 30 seconds.
 *
 * @param {unknown} text
 * @returns {{ hook: string, shots: Array<{ what: string, seconds: number }>, onScreen: string[], cover: string } | null}
 */
export function readVideoPlanAnswer(text) {
  const value = parseAnswer(text);
  if (value === null || !Array.isArray(value.shots)) return null;
  const hook = clipText(oneLine(value.hook), VIDEO_LINES.hook);
  if (!hasWords(hook)) return null;
  const [shortest, longest] = VIDEO_PLAN.seconds;
  const shots = [];
  for (const shot of value.shots) {
    if (shots.length === VIDEO_PLAN.shots) break;
    if (!isPlainObject(shot)) continue;
    const what = clipText(oneLine(shot.what), VIDEO_LINES.what);
    const seconds = typeof shot.seconds === 'number' && Number.isFinite(shot.seconds) ? Math.round(shot.seconds) : Number.NaN;
    if (!hasWords(what) || !(seconds >= shortest && seconds <= longest)) continue;
    shots.push({ what, seconds });
  }
  const onScreen = (Array.isArray(value.onScreen) ? value.onScreen : [])
    .map((line) => clipText(oneLine(line), VIDEO_LINES.onScreen))
    .filter(hasWords)
    .slice(0, VIDEO_PLAN.onScreen);
  const read = readVideoPlan({ hook, shots, onScreen, cover: clipText(oneLine(value.cover), VIDEO_LINES.cover) });
  if (!read.ok || read.plan === null) return null;
  const total = videoPlanSeconds(read.plan);
  return total >= VIDEO_SECONDS[0] && total <= VIDEO_SECONDS[1] ? read.plan : null;
}

/**
 * The video plan made without AI, in the app's language (`translate` reads
 * the words `aiplan.video.*`): the template's hook, four shots
 * (`TEMPLATE_SECONDS`), two lines on screen (the post's name, else the
 * template's; the ask's sentence, else the template's) and the cover.
 *
 * @param {{ translate: (key: string) => string, name?: string, askSentence?: string }} input
 * @returns {{ hook: string, shots: Array<{ what: string, seconds: number }>, onScreen: string[], cover: string }}
 */
export function videoTemplate({ translate, name = '', askSentence = '' }) {
  const line = (key) => clipText(oneLine(translate(key)), VIDEO_PLAN.letters);
  const title = clipText(oneLine(name), VIDEO_LINES.onScreen);
  const ask = clipText(oneLine(askSentence), VIDEO_LINES.onScreen);
  const plan = {
    hook: line('aiplan.video.hook'),
    shots: TEMPLATE_SECONDS.map((seconds, index) => ({ what: line(`aiplan.video.shot${index + 1}`), seconds })),
    onScreen: [hasWords(title) ? title : line('aiplan.video.onScreen1'), hasWords(ask) ? ask : line('aiplan.video.onScreen2')],
    cover: line('aiplan.video.cover'),
  };
  const read = readVideoPlan(plan);
  // The template's own words always read; a plan is never lost to a word that does not.
  return read.ok && read.plan !== null ? read.plan : plan;
}
