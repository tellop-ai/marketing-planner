/**
 * The post maker's rules that need no page: which shape and which words a
 * network shows, when a count shows, what the share button says, how a day
 * and a time read, and how the results form reads. Pure, so the checks call them (`tests/maker.test.mjs`).
 */

import { formatDecimal } from '../../../lib/format.js';
import { countFor } from '../../../lib/plan/count.js';
import { civilDay, isCivilDay, isClockTime, partsOf } from '../../../lib/plan/days.js';
import { normaliseHashtags, removeAddresses } from '../../../lib/plan/fit.js';
import { LIMITS, RESULT_COUNTS, readLink } from '../../../lib/plan/limits.js';
import { TELEGRAM_CAPTION_LIMIT, isNetworkKey, networkByKey, setMostOf } from '../../../lib/plan/networks.js';
import { canDraw } from '../../../lib/plan/picture-rules.js';
import { isAhead } from '../../../lib/plan/state.js';
import { linkAfterWords, safeLinkOf, sharedWords, trackedLink, trackedWords } from '../../../lib/plan/share.js';
import { isShapeKey } from '../../../lib/plan/shapes.js';
import { specialDaysOn } from '../../../lib/plan/special-days.js';

/** A count shows from this share of a network's limit up. */
export const NEAR_LIMIT = 0.9;

/**
 * Each shape's proportions as a box class (written out whole, so the
 * stylesheet knows each one): the preview shows the picture in the network's shape.
 */
export const SHAPE_ASPECT = Object.freeze({
  square: 'aspect-square',
  portrait: 'aspect-[4/5]',
  story: 'aspect-[9/16]',
  wide: 'aspect-[300/157]',
  landscape: 'aspect-video',
  tall: 'aspect-[2/3]',
  gbp: 'aspect-[4/3]',
});

/** The shape a network's picture takes; square for a network the app does not know. @param {unknown} network */
export function shapeOf(network) {
  return networkByKey(network)?.shape ?? 'square';
}

/** The box class of a shape (square for one the app does not know). @param {unknown} shape */
export function aspectOf(shape) {
  return isShapeKey(shape) ? SHAPE_ASPECT[/** @type {keyof typeof SHAPE_ASPECT} */ (shape)] : SHAPE_ASPECT.square;
}

/** A network's words before anything is saved for it. @param {string} network */
export function emptyVersion(network) {
  return {
    network,
    on: true,
    text: '',
    hashtags: '',
    link: '',
    firstComment: '',
    changedByPerson: false,
    sharedAt: null,
    sharedLink: null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    resultNote: '',
    resultAt: null,
  };
}

/**
 * A post's saved version for one network, or an empty one.
 *
 * @param {{ versions?: any[] } | null | undefined} full
 * @param {string} network
 */
export function versionOf(full, network) {
  return (full?.versions ?? []).find((version) => version?.network === network) ?? emptyVersion(network);
}

/**
 * The network the preview opens on: the first of the post's networks not
 * shared yet, else the first; null with none.
 *
 * @param {string[]} networks the post's networks, in order
 * @param {any[]} versions
 */
export function firstNetwork(networks, versions) {
  if (!Array.isArray(networks) || networks.length === 0) return null;
  const shared = new Set((versions ?? []).filter((version) => Boolean(version?.sharedAt)).map((version) => version.network));
  return networks.find((key) => !shared.has(key)) ?? networks[0];
}

/**
 * The network to keep showing after the post's networks change: the one shown
 * when it is still one of them, else the first one not shared.
 *
 * @param {string | null} current
 * @param {string[]} networks
 * @param {any[]} versions
 */
export function keepNetwork(current, networks, versions) {
  return current !== null && networks.includes(current) ? current : firstNetwork(networks, versions);
}

/**
 * The count a network's words show, as the network counts them, only within
 * `NEAR_LIMIT` of its limit or over it; else null. It counts the words as
 * they are shared (`sharedWords`: the words, the link where links can be
 * pressed, X counting it 23, and the hashtags), as the checks do. Telegram
 * counts against a caption's limit when the post has a picture. With the
 * post's `tracking` on, the link is counted with its tracking fields.
 *
 * @param {string} network
 * @param {{ text?: string, hashtags?: string, link?: string }} words
 * @param {boolean} [withPicture]
 * @param {import('../../../lib/plan/share.js').Tracking} [tracking]
 * @returns {{ count: number, limit: number, over: boolean } | null}
 */
export function countLine(network, { text = '', hashtags = '', link = '' } = {}, withPicture = false, tracking = {}) {
  const item = networkByKey(network);
  if (!item) return null;
  const limit = item.key === 'telegram' && withPicture ? TELEGRAM_CAPTION_LIMIT : item.limit;
  const count = countFor(item.key, sharedWords(item.key, { text, hashtags, link }, tracking));
  if (count < limit * NEAR_LIMIT) return null;
  return { count, limit, over: count > limit };
}

/**
 * What the second share button says: "Open X with your words" when the
 * network's share address carries the words, else "Copy and open X" (a
 * network whose address carries only a link still opens with the words copied).
 *
 * @param {string} network
 * @param {{ kind: string } | null} share what `shareFor` answered
 */
export function shareLabelKey(network, share) {
  const item = networkByKey(network);
  if (!item) return null;
  return share?.kind === 'address' && item.share === 'text' ? `share.openWith.${item.key}` : `share.copyOpen.${item.key}`;
}

/** @param {string} locale */
function language(locale) {
  return locale === 'tr' ? 'tr-TR' : 'en-GB';
}

/** A civil day as a date at noon UTC, for formatting only. @param {string} day */
function noonOf(day) {
  const { year, month, day: date } = partsOf(day);
  return new Date(Date.UTC(year, month - 1, date, 12));
}

/**
 * A planned day as the header chip reads it: "Wed 21 Oct" / "21 Ekim Çar",
 * with the year when it is not `today`'s year. Empty for a value that is not a day.
 *
 * @param {unknown} day
 * @param {string} locale
 * @param {string} [today]
 */
export function dayText(day, locale, today = '') {
  if (!isCivilDay(day)) return '';
  const value = /** @type {string} */ (day);
  const sameYear = typeof today === 'string' && today.slice(0, 4) === value.slice(0, 4);
  const options = { weekday: 'short', day: 'numeric', month: locale === 'tr' ? 'long' : 'short', timeZone: 'UTC' };
  if (!sameYear) options.year = 'numeric';
  return new Intl.DateTimeFormat(language(locale), /** @type {Intl.DateTimeFormatOptions} */ (options)).format(noonOf(value));
}

/**
 * A day with no weekday: "21 Oct" / "21 Ekim", with the year when it is not
 * `today`'s year. Empty for a value that is not a day.
 *
 * @param {unknown} day
 * @param {string} locale
 * @param {string} [today]
 */
export function shortDayText(day, locale, today = '') {
  if (!isCivilDay(day)) return '';
  const value = /** @type {string} */ (day);
  const sameYear = typeof today === 'string' && today.slice(0, 4) === value.slice(0, 4);
  const options = { day: 'numeric', month: locale === 'tr' ? 'long' : 'short', timeZone: 'UTC' };
  if (!sameYear) options.year = 'numeric';
  return new Intl.DateTimeFormat(language(locale), /** @type {Intl.DateTimeFormatOptions} */ (options)).format(noonOf(value));
}

/** A clock time as it is written ("18:30", in Turkish "18.30"): the one helper every screen uses. */
export { timeText } from '../../calendar/format.js';

/**
 * The time a person typed, as the app keeps it (`HH:MM`): "18:30", "18.30",
 * "9:05" and "1830" all read; empty text clears it (null).
 *
 * @param {unknown} text
 * @returns {{ ok: true, value: string | null } | { ok: false }}
 */
export function readTimeText(text) {
  if (typeof text !== 'string') return { ok: false };
  const value = text.trim();
  if (value === '') return { ok: true, value: null };
  const match = /^(\d{1,2})[:.](\d{2})$/u.exec(value) ?? /^(\d{2})(\d{2})$/u.exec(value);
  if (!match) return { ok: false };
  const time = `${match[1].padStart(2, '0')}:${match[2]}`;
  return isClockTime(time) ? { ok: true, value: time } : { ok: false };
}

/** A civil day as the kit's calendar takes it: local noon of that day. @param {unknown} day */
export function dateOfDay(day) {
  if (!isCivilDay(day)) return undefined;
  const { year, month, day: date } = partsOf(/** @type {string} */ (day));
  return new Date(year, month - 1, date, 12);
}

/** The civil day the kit's calendar picked (a local date). @param {unknown} date */
export function dayOfDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const day = civilDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return isCivilDay(day) ? day : null;
}

/**
 * Whether a post's day is a day of remembrance among the special days the
 * person shows (My plan's choice and hidden days).
 *
 * @param {unknown} day
 * @param {{ showDays?: string, hidden?: string[] }} [options]
 */
export function isRemembrance(day, { showDays = 'both', hidden = [] } = {}) {
  if (!isCivilDay(day)) return false;
  return specialDaysOn(/** @type {string} */ (day), { showDays, hidden }).some((item) => item.kind === 'remembrance');
}

/**
 * The words with their web addresses taken out and the "link in profile"
 * sentence put at the end (on a network where a link cannot be pressed).
 * With no sentence saved, the words stay as they are.
 *
 * @param {string} text
 * @param {string} sentence
 */
export function withLinkSentence(text, sentence) {
  const words = typeof text === 'string' ? text : '';
  const line = typeof sentence === 'string' ? sentence.trim() : '';
  if (line === '') return words;
  const kept = removeAddresses(words).text;
  if (kept.includes(line)) return kept;
  if (kept === '') return line;
  return /[.!?…][)"'’”»\]]*$/u.test(kept) ? `${kept} ${line}` : `${kept}\n\n${line}`;
}

/** Names joined as a sentence lists them: "Instagram and X", "Instagram ve X". @param {string[]} names @param {string} locale */
export function listNames(names, locale) {
  const list = (names ?? []).filter((name) => typeof name === 'string' && name !== '');
  return new Intl.ListFormat(language(locale), { style: 'long', type: 'conjunction' }).format(list);
}

/** A whole number from 0 up as the person's language writes it (through `lib/format.js`). @param {number} value @param {string} locale */
export function numberText(value, locale) {
  return Number.isSafeInteger(value) && value >= 0 ? formatDecimal(String(value), locale) : String(value);
}

/**
 * One count as typed: empty is no count (null); digits, also with a space,
 * full stop or comma between groups of three ("1.200", "1,200", "1 200"); at
 * most `LIMITS.result`.
 *
 * @param {unknown} text
 * @returns {{ ok: true, value: number | null } | { ok: false }}
 */
export function readCountText(text) {
  if (typeof text !== 'string') return { ok: false };
  const value = text.trim();
  if (value === '') return { ok: true, value: null };
  if (!/^\d+$/u.test(value) && !/^\d{1,3}(?:[ .,  ]\d{3})+$/u.test(value)) return { ok: false };
  const number = Number(value.replace(/[ .,  ]/gu, ''));
  return Number.isSafeInteger(number) && number <= LIMITS.result ? { ok: true, value: number } : { ok: false };
}

/**
 * The results form as the app takes it (`{ action: 'results', ... }`), or the
 * field that cannot be read.
 *
 * @param {Record<string, string>} form
 * @returns {{ ok: true, value: Record<string, number | null | string> } | { ok: false, field: string, problem: string }}
 */
export function readResultsForm(form) {
  /** @type {Record<string, number | null | string>} */
  const value = {};
  for (const name of RESULT_COUNTS) {
    const read = readCountText(form?.[name] ?? '');
    if (!read.ok) return { ok: false, field: name, problem: 'refuse.number' };
    value[name] = read.value;
  }
  value.resultNote = typeof form?.resultNote === 'string' ? form.resultNote.trim() : '';
  return { ok: true, value };
}

/** A saved count as the form shows it: empty for none. @param {unknown} value */
export function countFieldText(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
}

/**
 * The campaigns the post can join: the ones not done yet, and the post's own
 * one whatever its state.
 *
 * @param {{ id: number, status?: string }[]} campaigns
 * @param {number | null} current
 */
export function campaignChoices(campaigns, current) {
  return (campaigns ?? []).filter((campaign) => campaign?.status !== 'done' || campaign?.id === current);
}

/**
 * The post with one version saved (in the networks' order when added).
 *
 * @param {{ versions: any[] }} full
 * @param {{ network: string }} version
 */
export function withVersion(full, version) {
  const versions = full.versions.some((item) => item.network === version.network)
    ? full.versions.map((item) => (item.network === version.network ? version : item))
    : [...full.versions, version];
  return { ...full, versions };
}

/**
 * The post with one picture as the app answered it: in its place when the
 * post holds it, else added at the end. A chosen one leaves the others unchosen.
 *
 * @param {{ pictures: any[] }} full
 * @param {{ id: number, chosen?: boolean } | null | undefined} picture
 */
export function withPicture(full, picture) {
  if (!picture || typeof picture !== 'object' || picture.id === undefined || picture.id === null) return full;
  const held = full.pictures.some((item) => item.id === picture.id);
  const pictures = held ? full.pictures.map((item) => (item.id === picture.id ? picture : item)) : [...full.pictures, picture];
  return {
    ...full,
    pictures: picture.chosen === true ? pictures.map((item) => (item.id === picture.id || item.chosen !== true ? item : { ...item, chosen: false })) : pictures,
  };
}

/**
 * Why Make my post rests, or null when it can be pressed: My plan has no
 * networks (a link to My plan), or every network is switched off for this
 * post (switched on again in the post's "⋯" menu).
 *
 * @param {{ networks: unknown, goesTo: string[] }} post My plan's networks and the ones this post goes to
 * @returns {{ key: string, href?: string } | null}
 */
export function makeRest({ networks, goesTo }) {
  if (Array.isArray(goesTo) && goesTo.length > 0) return null;
  const chosen = Array.isArray(networks) && networks.some((key) => isNetworkKey(key));
  return chosen ? { key: 'maker.allOff' } : { key: 'maker.noNetworks', href: '/plan' };
}

/** Whether the post has words yet: its own words, or any network's. @param {{ post?: { mainText?: string }, versions?: any[] } | null | undefined} full */
export function hasWords(full) {
  if (typeof full?.post?.mainText === 'string' && full.post.mainText.trim() !== '') return true;
  return (full?.versions ?? []).some((version) => typeof version?.text === 'string' && version.text.trim() !== '');
}

/** The checks that wait for the post to start: no words, no picture yet. */
const WAITING_CHECKS = Object.freeze(['check.noWords', 'check.needsPicture']);

/**
 * The checks the preview shows: before the post has words (`hasWords`) and
 * before Make my post answered (`started`), "No words yet" and "Choose a
 * picture" wait, as a new post has neither by nature.
 *
 * @param {Array<{ key: string }>} checks
 * @param {boolean} started
 */
export function shownChecks(checks, started) {
  const list = Array.isArray(checks) ? checks : [];
  return started ? list : list.filter((check) => !WAITING_CHECKS.includes(check?.key));
}

/**
 * What Make my post sends: the words, and after the "replace your changes?"
 * question the answer: `all` (Replace) or `untouched` (Keep my changes:
 * only the networks the person did not change get new words).
 *
 * @param {string} text
 * @param {'all' | 'untouched' | null | undefined} [replace]
 */
export function makeBody(text, replace = null) {
  return replace === 'all' || replace === 'untouched' ? { text, replace } : { text };
}

/** Words as the app keeps them, for "is this already saved?". @param {unknown} value */
export function keptText(value) {
  return String(value ?? '').replace(/\r\n?/gu, '\n').trim();
}

/**
 * A version's own fields as the words editor compares them (the kept forms).
 *
 * @param {{ text?: unknown, hashtags?: unknown, link?: unknown, firstComment?: unknown } | null | undefined} version
 */
export function editorFields(version) {
  return {
    text: keptText(version?.text),
    hashtags: normaliseHashtags(version?.hashtags ?? '').join(' '),
    link: keptText(version?.link),
    firstComment: keptText(version?.firstComment),
  };
}

/**
 * What the words editor sends for its draft (`PUT` a version), and what it
 * cannot send yet: a link that does not read as a safe web address stays in
 * the box and out of the save (`linkProblem`), so the words still save.
 *
 * @param {{ text: string, hashtags: string, link: string, firstComment: string }} draft
 * @returns {{ body: { text: string, hashtags: string[], link?: string, firstComment: string }, linkProblem: string | null }}
 */
export function editorBody(draft) {
  const body = { text: String(draft?.text ?? ''), hashtags: normaliseHashtags(draft?.hashtags ?? ''), firstComment: String(draft?.firstComment ?? '') };
  const link = readLink(String(draft?.link ?? '').trim());
  if (!link.ok) return { body, linkProblem: link.problem };
  return { body: { ...body, link: link.value }, linkProblem: null };
}

/**
 * Whether the editor's body says something the app does not keep yet
 * (`saved`: `editorFields` of the version as last confirmed). A field the body
 * leaves out is not compared.
 *
 * @param {ReturnType<typeof editorBody>['body']} body
 * @param {ReturnType<typeof editorFields>} saved
 */
export function editorChanged(body, saved) {
  if (keptText(body.text) !== saved.text) return true;
  if (body.hashtags.join(' ') !== saved.hashtags) return true;
  if (keptText(body.firstComment) !== saved.firstComment) return true;
  return body.link !== undefined && keptText(body.link) !== saved.link;
}

/**
 * What the first share step shows for the chosen picture in a network's
 * shape: nothing (no picture, or one the page cannot draw), a rested Save
 * picture (`refused`: a comment card whose customer has not said yes), the
 * kept copy to save (`file`), or Save picture that first makes the copy and
 * then saves it, in the same press (`draw`).
 *
 * @param {any} picture
 * @param {string} shape
 * @returns {'none' | 'refused' | 'file' | 'draw'}
 */
export function saveStep(picture, shape) {
  if (picture === null || picture === undefined || typeof picture !== 'object') return 'none';
  if (picture.cardRefused === true) return 'refused';
  const tag = picture.shapes?.[shape];
  if (typeof tag === 'string' && tag !== '') return 'file';
  return canDraw(picture) ? 'draw' : 'none';
}

/**
 * Whether the page may still start the download a press asked for after
 * making the copy: the browser says the press still counts
 * (`navigator.userActivation.isActive`), or, where it cannot say, the copy
 * took less than `PRESS_STILL_COUNTS_MS`. A download started later than
 * that is refused as not pressed; the Save picture link is then ready for one
 * more press.
 *
 * @param {{ isActive?: boolean } | null | undefined} activation
 * @param {number} elapsed milliseconds since the press
 */
export function pressStillCounts(activation, elapsed) {
  if (activation && typeof activation.isActive === 'boolean') return activation.isActive;
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < PRESS_STILL_COUNTS_MS;
}

/** How long after a press the page treats it as still pressed, where the browser cannot say (it keeps one for 5 seconds). */
export const PRESS_STILL_COUNTS_MS = 4000;

/**
 * The link line the preview shows under the words, as the network shows the
 * post: where links can be pressed, the link that goes after the words
 * (`linkAfterWords`: none when the words hold it already), with its tracking
 * fields while `tracking` is on (`trackedLink`, as Copy gives it and the
 * count counts it); where a post has a link field of its own (Pinterest,
 * Google), the link as the person pastes it in that field; where links cannot
 * be pressed, none (the link is never shared there).
 *
 * @param {string} network
 * @param {{ text?: string, link?: string }} version
 * @param {import('../../../lib/plan/share.js').Tracking} [tracking]
 */
export function previewLink(network, { text = '', link = '' } = {}, tracking = {}) {
  const links = networkByKey(network)?.links;
  if (links === 'pressable') {
    const after = linkAfterWords(network, text, link);
    return after === '' ? '' : trackedLink(network, after, tracking);
  }
  if (links === 'one') return safeLinkOf(link);
  return '';
}

/**
 * The words the preview shows, as they are shared: their own `https:`
 * addresses tracked in place while `tracking` is on, where links can be
 * pressed (`trackedWords`, the function Copy and the count use).
 *
 * @param {string} network
 * @param {{ text?: string }} version
 * @param {import('../../../lib/plan/share.js').Tracking} [tracking]
 */
export function previewWords(network, { text = '' } = {}, tracking = {}) {
  return trackedWords(network, typeof text === 'string' ? text.replace(/\r\n?/gu, '\n') : '', tracking);
}

/**
 * Where a network's version stands for the share steps: `open` (not marked
 * yet), `scheduled` (marked for a moment still ahead of `now`) or `shared` (marked, and that moment has passed).
 *
 * @param {{ sharedAt?: string | null } | null | undefined} version
 * @param {string | number} [now]
 * @returns {'open' | 'scheduled' | 'shared'}
 */
export function shareMark(version, now) {
  const at = version?.sharedAt;
  if (typeof at !== 'string' || at === '') return 'open';
  return isAhead(at, now) ? 'scheduled' : 'shared';
}

/**
 * An instant as this computer's day and clock time (`YYYY-MM-DD`, `HH:MM`):
 * what "Scheduled for Thu 18:30" reads. Null for anything that is not a moment.
 *
 * @param {unknown} instant
 * @returns {{ day: string, time: string } | null}
 */
export function localWhen(instant) {
  if (typeof instant !== 'string' || instant === '') return null;
  const at = new Date(instant);
  if (!Number.isFinite(at.getTime())) return null;
  const day = civilDay(at.getFullYear(), at.getMonth() + 1, at.getDate());
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return isCivilDay(day) && isClockTime(time) ? { day, time } : null;
}

/** The time Mark scheduled takes for a post with no time of its own (as the app keeps it). */
export const SCHEDULE_TIME = '12:00';

/**
 * Whether a set's pictures can all be saved in a network's shape: none is a
 * comment card whose customer has not said yes (`share.setRefused`), and
 * each has its kept copy in that shape or can be drawn (else
 * `pictures.notReady`).
 *
 * @param {any[]} pictures
 * @param {string} shape
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function setSavable(pictures, shape) {
  const list = Array.isArray(pictures) ? pictures : [];
  if (list.some((picture) => picture?.cardRefused === true)) return { ok: false, reason: 'share.setRefused' };
  const ready = list.every((picture) => {
    const tag = picture?.shapes?.[shape];
    return (typeof tag === 'string' && tag !== '') || canDraw(picture);
  });
  return ready ? { ok: true } : { ok: false, reason: 'pictures.notReady' };
}

/**
 * What Save pictures saves for a network that takes a set: the first
 * pictures of the post's swipe set, as many as the network takes; null when
 * the network takes one picture a post or the set holds fewer than two (the
 * one picture is saved as before).
 *
 * @param {string} network
 * @param {any[]} slides the post's swipe set, in order
 * @returns {any[] | null}
 */
export function slidesFor(network, slides) {
  const most = setMostOf(network);
  if (most < 2 || !Array.isArray(slides) || slides.length < 2) return null;
  return slides.slice(0, most);
}

/** The file endings a picture's type takes in a zip. */
const ENDINGS = Object.freeze({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' });

/**
 * A set's picture's name in its zip: its place, two digits, so the files sort
 * in the set's order ("01.webp", "02.jpg"); the ending from the picture's type
 * (`webp` when the type is not one the app writes).
 *
 * @param {number} index from 0
 * @param {unknown} type
 */
export function setFileName(index, type) {
  const kind = typeof type === 'string' ? type.split(';')[0].trim().toLowerCase() : '';
  return `${String(index + 1).padStart(2, '0')}.${ENDINGS[kind] ?? 'webp'}`;
}

/**
 * Whether a new ask reaches the post's words only by Make my post again: a
 * switched-on version holds words Make would write again (one not marked
 * shared or scheduled; Make never writes those).
 *
 * @param {{ versions?: Array<{ on?: boolean, text?: string, sharedAt?: string | null }> } | null | undefined} full
 */
export function askNeedsMake(full) {
  return (Array.isArray(full?.versions) ? full.versions : []).some((version) => version?.on !== false
    && typeof version?.text === 'string' && version.text.trim() !== ''
    && !(typeof version.sharedAt === 'string' && version.sharedAt !== ''));
}

/** The state pill's words: the one rule all pages share. */
export { stateWordsOf } from '../../../lib/plan/state.js';
