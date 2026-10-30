/**
 * The picture strip's rules that need no page: which shapes a post's chosen
 * picture keeps, what a thumb shows, where a words picture starts, how the
 * focus grid maps to a focus point, and how an address's answer is read.
 * Pure, so the checks call them (`tests/pictures.test.mjs`).
 */

import { SUBLINE_KINDS, graphemes, layoutOf } from '../../lib/plan/card-layout.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { SET_LIMITS, isNetworkKey, networkByKey, setMostOf } from '../../lib/plan/networks.js';
import { canDraw, fileAddress, hasOriginal, missingShapes, problemOf } from '../../lib/plan/picture-rules.js';
import { isShapeKey } from '../../lib/plan/shapes.js';

// Shared with the canvas drawing (`lib/plan/draw.js`), which never imports from the pages.
export { canDraw, fileAddress, hasOriginal, missingShapes, problemOf };

/**
 * The networks a post goes to: the ones in My plan (`networks`, in that
 * order), less the ones switched off for this post. A network with no saved
 * version yet is on, as a new version starts.
 *
 * @param {{ versions?: { network: string, on: boolean }[] } | null | undefined} post
 * @param {unknown} networks
 * @returns {string[]}
 */
export function postNetworks(post, networks) {
  if (!Array.isArray(networks)) return [];
  const off = new Set((post?.versions ?? []).filter((version) => version?.on === false).map((version) => version.network));
  const keys = [];
  for (const key of networks) {
    if (isNetworkKey(key) && !off.has(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * The shapes a post's chosen picture keeps: each network's own shape for the
 * networks the post goes to, each shape once.
 *
 * @param {Parameters<typeof postNetworks>[0]} post
 * @param {unknown} networks
 * @returns {string[]}
 */
export function shapesFor(post, networks) {
  const shapes = [];
  for (const key of postNetworks(post, networks)) {
    const shape = networkByKey(key)?.shape;
    if (shape && !shapes.includes(shape)) shapes.push(shape);
  }
  return shapes;
}

/**
 * What a thumb can show for `picture` in `shape`, best first: the shape's
 * kept copy, the kept original, the page's own drawing of a words or card
 * picture (a card read without its comment, as every tile reads it, is a
 * plain card mark: `cardMark`), and last an empty box. A thumb whose picture
 * does not load moves on to the next. `wordsFirst`: a words picture shows the
 * page's own drawing before any kept copy (the strip's tiles, whose drawing
 * leaves room for the chosen mark above the words).
 *
 * @param {object | null | undefined} picture
 * @param {string} [shape]
 * @param {{ wordsFirst?: boolean }} [options]
 * @returns {({ kind: 'file', address: string } | { kind: 'words' } | { kind: 'card' } | { kind: 'cardMark' } | { kind: 'empty' })[]}
 */
export function thumbSources(picture, shape = 'square', { wordsFirst = false } = {}) {
  const sources = [];
  const drawsWords = picture?.source === 'words' && typeof picture.words === 'string' && picture.words.trim() !== '';
  if (wordsFirst && drawsWords) sources.push({ kind: 'words' });
  if (picture && typeof picture === 'object') {
    const shapeTag = isShapeKey(shape) ? picture.shapes?.[shape] : null;
    if (typeof shapeTag === 'string' && shapeTag !== '') sources.push({ kind: 'file', address: fileAddress(picture.id, shape, shapeTag) });
    if (typeof picture.original === 'string' && picture.original !== '') {
      sources.push({ kind: 'file', address: fileAddress(picture.id, 'original', picture.original) });
    }
    if (drawsWords && !wordsFirst) sources.push({ kind: 'words' });
    if (picture.source === 'card') sources.push(picture.card && typeof picture.card === 'object' ? { kind: 'card' } : { kind: 'cardMark' });
  }
  sources.push({ kind: 'empty' });
  return sources;
}

/**
 * The words that say what a picture shows, for someone who cannot see it:
 * its description, else the words drawn on it. Empty when there are none.
 *
 * @param {object | null | undefined} picture
 */
export function pictureWords(picture) {
  const description = typeof picture?.description === 'string' ? picture.description.trim() : '';
  if (description !== '') return description;
  if (picture?.source === 'words' && typeof picture.words === 'string') return picture.words.trim();
  if (picture?.source === 'card' && picture.card) return String(picture.card.bestLine || picture.card.text || '').trim();
  return '';
}

const SENTENCE_END = /[.!?…](?=\s|$)|\n/u;

/**
 * Where a new words picture starts: the first sentence of the post's words
 * (up to `.`, `!`, `?` or `…` before a space, or a line break), one line, a
 * single closing full stop dropped, at most `max` characters (cut at a space
 * when there is one).
 *
 * @param {unknown} text
 * @param {number} [max]
 */
export function firstSentence(text, max = LIMITS.pictureWords) {
  const value = String(text ?? '').replace(/\r\n?/gu, '\n').trim();
  const end = SENTENCE_END.exec(value);
  let sentence = (end ? value.slice(0, end.index + (end[0] === '\n' ? 0 : 1)) : value).replace(/\s+/gu, ' ').trim();
  if (sentence.endsWith('.') && !sentence.endsWith('..')) sentence = sentence.slice(0, -1).trimEnd();
  const pieces = graphemes(sentence);
  if (pieces.length <= max) return sentence;
  const cut = pieces.slice(0, max).join('');
  if (pieces[max] === ' ') return cut.trimEnd();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/** The focus grid has this many steps across and down. */
export const FOCUS_STEPS = 5;

/**
 * The grid step (0 to `FOCUS_STEPS - 1`) a stored focus value falls in; the
 * middle one for a value that is not a number.
 *
 * @param {unknown} value
 */
export function focusStep(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.floor(FOCUS_STEPS / 2);
  return Math.min(FOCUS_STEPS - 1, Math.max(0, Math.floor(value * FOCUS_STEPS)));
}

/**
 * The focus value (0 to 1) a press on grid step `step` keeps: the middle of
 * that step.
 *
 * @param {number} step
 */
export function stepFocus(step) {
  const whole = Math.min(FOCUS_STEPS - 1, Math.max(0, Math.trunc(Number(step) || 0)));
  return Math.round(((whole + 0.5) / FOCUS_STEPS) * 1000) / 1000;
}

/**
 * A post as `GET /api/posts/[id]` answers it (`{ post, versions, pictures }`),
 * also when it comes wrapped as `{ post: { post, versions, pictures } }`; null
 * for anything else.
 *
 * @param {unknown} answer
 */
export function postFullOf(answer) {
  const full = (value) => value && typeof value === 'object' && value.post && typeof value.post === 'object' && Array.isArray(value.pictures) && Array.isArray(value.versions);
  if (full(answer)) return answer;
  if (answer && typeof answer === 'object' && full(answer.post)) return answer.post;
  return null;
}

/** The post's chosen picture, or null. */
export function chosenOf(post) {
  return (post?.pictures ?? []).find((picture) => picture?.chosen === true) ?? null;
}

/** Whether a post has room for one more picture. */
export function hasRoom(post) {
  return (post?.pictures ?? []).length < LIMITS.picturesPerPost;
}

/**
 * What the strip's busy tile says while a picture is made, as a words key:
 * the strip's own Change this picture (`work` is `change`), its own New
 * picture (`new`), or the maker's Make my post (`making`); null when no
 * picture is being made (choosing, adding a photo or words, saving a
 * picture's details).
 *
 * @param {string | null} work the strip's press at work, if any
 * @param {boolean} making whether the maker is making a picture
 * @returns {'pictures.changing' | 'pictures.makingLine' | null}
 */
export function makingLine(work, making) {
  if (work === 'change') return 'pictures.changing';
  if (work === 'new' || making === true) return 'pictures.makingLine';
  return null;
}

/**
 * Whether Change this picture can be sent: some words that are not only
 * spaces, at most `LIMITS.change` characters, while the strip is not resting.
 *
 * @param {unknown} words the box's words
 * @param {boolean} resting whether the strip or the maker is at work
 */
export function canSendChange(words, resting) {
  if (resting || typeof words !== 'string') return false;
  const length = words.trim().length;
  return length > 0 && length <= LIMITS.change;
}

/**
 * The AI problems that keep refusing until something outside this page
 * changes (AI paused or not allowed for the app, Tellop signed out or on
 * another account, the allowance or the app's AI for the day used up, AI not
 * on offer): after one of them, New picture and Change this picture rest with
 * the reason. A problem that may pass on the next press (busy, no connection,
 * a refused request, an answer that did not read) does not rest them.
 */
export const LASTING_AI_PROBLEMS = Object.freeze([
  'ai.paused',
  'ai.openTellop',
  'ai.needsPermission',
  'ai.signedOut',
  'ai.accountChanged',
  'ai.allowance',
  'ai.unavailable',
  'ai.practice',
  'ai.appAiOff',
  'ai.dailyLimit',
  'ai.appPaused',
]);

/**
 * The reason AI pictures rest after an answer, as a words key, or null.
 *
 * @param {unknown} problem the words key an AI answer carried
 * @returns {string | null}
 */
export function aiStopOf(problem) {
  return typeof problem === 'string' && LASTING_AI_PROBLEMS.includes(problem) ? problem : null;
}

// --- sets of pictures -----------------------------------------------------

/** The two sets of a post's pictures: the swipe set (`slide`) and the story set (`story`). */
export const SET_KINDS = Object.freeze(['slide', 'story']);

/**
 * Make slides and Make a story set need room for at least `least` new
 * pictures: the app writes as many as it would (6 slides, 4 frames) or, with
 * less room, as many as fit, never fewer than 2 (`SET_LEAST_ROOM` in
 * `lib/plan/ai-sets.js`, which refuses below it).
 */
export const MAKE_SET = Object.freeze({ least: 2 });

/** @param {unknown} kind */
function setField(kind) {
  return kind === 'story' ? 'story' : 'slide';
}

/**
 * A post's set of pictures (`slide` or `story`), in the set's order (by its
 * place, gaps allowed; then by id).
 *
 * @param {{ pictures?: any[] } | null | undefined} post
 * @param {'slide' | 'story'} kind
 * @returns {any[]}
 */
export function setOf(post, kind) {
  const field = setField(kind);
  return (post?.pictures ?? [])
    .filter((picture) => Number.isInteger(picture?.[field]) && picture[field] > 0)
    .sort((a, b) => a[field] - b[field] || a.id - b.id);
}

/**
 * Whether Make slides or Make a story would replace pictures the set holds
 * now, so the page asks first: a swipe set with a picture besides its cover
 * (the chosen picture stays the cover), a story set with any picture.
 *
 * @param {any} post
 * @param {'slide' | 'story'} kind
 */
export function replacesSet(post, kind) {
  const pictures = setOf(post, kind);
  return setField(kind) === 'slide' ? pictures.some((picture) => picture?.chosen !== true) : pictures.length > 0;
}

/** The ids of a set, in order. @param {any} post @param {'slide' | 'story'} kind */
export function setIds(post, kind) {
  return setOf(post, kind).map((picture) => picture.id);
}

/** Whether a set holds the most it may (`SET_LIMITS`). @param {any} post @param {'slide' | 'story'} kind */
export function setFull(post, kind) {
  return setOf(post, kind).length >= SET_LIMITS[setField(kind)];
}

/** The post's pictures that are not in the set yet, in the strip's order. @param {any} post @param {'slide' | 'story'} kind */
export function setChoices(post, kind) {
  const held = new Set(setIds(post, kind));
  return (post?.pictures ?? []).filter((picture) => !held.has(picture?.id));
}

/**
 * The set's ids with one picture added at the end, or null when it cannot
 * be (already in it, not one of the post's pictures, or the set is full). An
 * empty swipe set starts with the chosen picture, so the cover stays the
 * post's chosen picture (the first slide is always the chosen one).
 *
 * @param {any} post
 * @param {'slide' | 'story'} kind
 * @param {number} pictureId
 * @returns {number[] | null}
 */
export function addToSet(post, kind, pictureId) {
  const ids = setIds(post, kind);
  if (ids.includes(pictureId) || !(post?.pictures ?? []).some((picture) => picture?.id === pictureId)) return null;
  const chosen = chosenOf(post);
  const start = setField(kind) === 'slide' && ids.length === 0 && chosen !== null && chosen.id !== pictureId ? [chosen.id] : [];
  const next = [...ids, ...start, pictureId];
  return next.length > SET_LIMITS[setField(kind)] ? null : next;
}

/**
 * The set's ids with one picture moved one place earlier (`step` -1) or
 * later (+1), or null when it cannot move (not in the set, or at that end).
 * Moving a swipe set's first picture makes another the cover.
 *
 * @param {any} post
 * @param {'slide' | 'story'} kind
 * @param {number} pictureId
 * @param {-1 | 1} step
 * @returns {number[] | null}
 */
export function moveInSet(post, kind, pictureId, step) {
  const ids = setIds(post, kind);
  const at = ids.indexOf(pictureId);
  const to = at + (step < 0 ? -1 : 1);
  if (at === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The set's ids without one picture (it stays one of the post's pictures), or null when it is not in the set. */
export function takeOutOfSet(post, kind, pictureId) {
  const ids = setIds(post, kind);
  return ids.includes(pictureId) ? ids.filter((id) => id !== pictureId) : null;
}

/** The networks a post goes to that take a swipe set (more than one picture a post). @param {any} post @param {unknown} networks */
export function slideNetworks(post, networks) {
  return postNetworks(post, networks).filter((key) => setMostOf(key) > 1);
}

/** The networks a post goes to that have stories. @param {any} post @param {unknown} networks */
export function storyNetworks(post, networks) {
  return postNetworks(post, networks).filter((key) => networkByKey(key)?.storyOk === true);
}

/**
 * The networks a post goes to that take fewer pictures than its swipe set
 * holds, grouped by the most they take (fewest first): only the first
 * `most` go there (only the cover where `most` is 1).
 *
 * @param {any} post
 * @param {unknown} networks
 * @returns {{ most: number, networks: string[] }[]}
 */
export function setCutLines(post, networks) {
  const length = setOf(post, 'slide').length;
  if (length < 2) return [];
  /** @type {Map<number, string[]>} */
  const groups = new Map();
  for (const key of postNetworks(post, networks)) {
    const most = setMostOf(key);
    if (most < length) groups.set(most, [...(groups.get(most) ?? []), key]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([most, keys]) => ({ most, networks: keys }));
}

/**
 * A tip's number: its place among the tips of its set (a picture whose
 * layout is `tip`), counted in the set's order; the swipe set first, else
 * the story set. Null for a picture that is not a tip or not in a set.
 *
 * @param {any} post
 * @param {any} picture
 * @returns {number | null}
 */
export function tipPlace(post, picture) {
  if (picture?.source !== 'words' || picture?.layout !== 'tip') return null;
  for (const kind of SET_KINDS) {
    const tips = setOf(post, kind).filter((item) => item.source === 'words' && item.layout === 'tip');
    const at = tips.findIndex((item) => item.id === picture.id);
    if (at !== -1) return at + 1;
  }
  return null;
}

/**
 * How many new pictures Make slides or Make a story set may add, as the app
 * counts it: the post's room for more pictures, with the words pictures a new
 * set of the same kind replaces (in that set only, never the chosen picture),
 * and no more than the set takes (a swipe set keeps its cover first).
 *
 * @param {any} post
 * @param {'slide' | 'story'} kind
 */
export function makeRoom(post, kind) {
  const field = setField(kind);
  const other = field === 'slide' ? 'story' : 'slide';
  const pictures = post?.pictures ?? [];
  const replaced = pictures.filter((picture) => picture?.source === 'words' && Number.isInteger(picture?.[field]) && !Number.isInteger(picture?.[other]) && picture?.chosen !== true);
  const cover = field === 'slide' && pictures.some((picture) => picture?.chosen === true) ? 1 : 0;
  return Math.max(0, Math.min(SET_LIMITS[field] - cover, LIMITS.picturesPerPost - pictures.length + replaced.length));
}

/**
 * Whether Make slides (`slide`) or Make a story set (`story`) can be
 * pressed, and why not: the post has no words yet (`pictures.setNeedsWords`)
 * or no room for two new pictures (`pictures.setNoRoom`).
 *
 * @param {any} post
 * @param {'slide' | 'story'} kind
 * @param {boolean} hasWords whether the post has words yet
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canMakeSet(post, kind, hasWords) {
  if (!hasWords) return { ok: false, reason: 'pictures.setNeedsWords' };
  return makeRoom(post, kind) >= MAKE_SET.least ? { ok: true } : { ok: false, reason: 'pictures.setNoRoom' };
}

// --- changing a words picture ---------------------------------------------

/**
 * What Change words sends for a words picture (`PATCH /api/pictures/[id]`):
 * only the parts that changed (`words`, `layout`, `subline`; an empty object
 * when nothing did), or null when the words are empty (nothing can be
 * saved). The words keep their line breaks; the line under them is one line
 * and is sent only for a layout that draws one (`SUBLINE_KINDS`): hidden, it
 * stays as kept, so switching back shows it again.
 *
 * @param {{ words?: unknown, layout?: unknown, subline?: unknown } | null | undefined} picture
 * @param {{ words: unknown, layout: unknown, subline: unknown }} typed
 * @returns {{ words?: string, layout?: string, subline?: string } | null}
 */
export function wordsChanges(picture, { words, layout, subline }) {
  const text = String(words ?? '').replace(/\r\n?/gu, '\n').trim();
  if (text === '') return null;
  const kind = layoutOf(layout);
  /** @type {{ words?: string, layout?: string, subline?: string }} */
  const changes = {};
  if (text !== String(picture?.words ?? '').replace(/\r\n?/gu, '\n').trim()) changes.words = text;
  if (kind !== layoutOf(picture?.layout)) changes.layout = kind;
  if (Object.hasOwn(SUBLINE_KINDS, kind)) {
    const line = oneLine(subline);
    if (line !== oneLine(picture?.subline)) changes.subline = line;
  }
  return changes;
}

/** @param {unknown} value */
function oneLine(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}
