/**
 * What the preview of one network's words says about them, one short line each,
 * only when it is so. The person's words are never changed here.
 *
 * - `must` (the post stays unfinished while one stays): over the network's limit
 *   (`check.overLimit`), more hashtags than the network takes
 *   (`check.tooManyHashtags`), no words (`check.noWords`), a network that needs a
 *   picture with no chosen picture (`check.needsPicture`), a chosen comment
 *   card whose customer has not said yes to sharing (`check.cardRefused`), a
 *   link that is not a safe web address (`check.badLink`: not `https:`, not
 *   readable, or over `LIMITS.link`).
 * - `mark` (a small mark, never blocking): a web address in the words of a
 *   network where links cannot be pressed (`check.linkNotPressable`, fix
 *   `linkSentence`: put the "link in profile" sentence in its place); a chosen
 *   picture with no description (`check.noDescription`, fix `description`); a
 *   network that needs a video (`check.needsVideo`); a planned day that has
 *   passed while not shared (`check.dayPassed`); a day of remembrance
 *   (`check.remembrance`).
 *
 * The count is the network's own (`count.js`), of the words as the network
 * carries them (`sharedWords` in `share.js`: the words, the link where links
 * can be pressed, X counting it 23, and the hashtags, each after a blank
 * line); Telegram takes a caption's limit when the post has a chosen picture. Hashtags are counted in the hashtags and in the words, each
 * once, as the networks count them.
 *
 * Three of the musts come from a version's own words alone (`wordsChecks`:
 * over the limit, too many hashtags, a bad link). The posts records keep
 * whether a version has one (`mustFixOf`), so a calendar tile, which never
 * reads words, shows the same state as the post maker, which works it out
 * from the words it holds: both go through `wordsChecks`.
 */

import { countFor, findAddresses, hashtagText } from './count.js';
import { normaliseHashtags } from './fit.js';
import { readLink } from './limits.js';
import { TELEGRAM_CAPTION_LIMIT, networkByKey } from './networks.js';
import { sharedWords } from './share.js';

/** Every check's words key and level, in the order they show. */
export const CHECKS = Object.freeze({
  overLimit: Object.freeze({ key: 'check.overLimit', level: 'must' }),
  tooManyHashtags: Object.freeze({ key: 'check.tooManyHashtags', level: 'must' }),
  noWords: Object.freeze({ key: 'check.noWords', level: 'must' }),
  needsPicture: Object.freeze({ key: 'check.needsPicture', level: 'must' }),
  cardRefused: Object.freeze({ key: 'check.cardRefused', level: 'must' }),
  badLink: Object.freeze({ key: 'check.badLink', level: 'must' }),
  linkNotPressable: Object.freeze({ key: 'check.linkNotPressable', level: 'mark', fix: 'linkSentence' }),
  noDescription: Object.freeze({ key: 'check.noDescription', level: 'mark', fix: 'description' }),
  needsVideo: Object.freeze({ key: 'check.needsVideo', level: 'mark' }),
  dayPassed: Object.freeze({ key: 'check.dayPassed', level: 'mark' }),
  remembrance: Object.freeze({ key: 'check.remembrance', level: 'mark' }),
});

/** The `#word` hashtags written inside the words. @param {string} text */
function hashtagsInWords(text) {
  return Array.from(text.matchAll(/(?:^|[^\p{L}\p{M}\p{N}_&#])(#[\p{L}\p{M}\p{N}_]+)/gu), (match) => match[1]);
}

const found = (check) => ({ ...check });

/** Every check's key in the order they show. */
const ORDER = Object.values(CHECKS).map((check) => check.key);

/**
 * The must-fix checks that come from one network's words alone, in the order
 * they show: over the network's limit (the words as the network carries them,
 * `sharedWords`: with the link where links can be pressed), more hashtags than
 * it takes, a link that is not a safe web address. `withPicture`: the post has a chosen
 * picture (Telegram then takes a caption's limit). None for a network the app
 * does not know.
 *
 * `tracking`: the post's link tracking (`share.js`), so the count holds the
 * tracked link as it is shared.
 *
 * @param {{ network: string, text?: string, hashtags?: string | string[], link?: unknown, withPicture?: boolean, tracking?: import('./share.js').Tracking }} version
 * @returns {Array<{ key: string, level: 'must' }>}
 */
export function wordsChecks({ network, text = '', hashtags = '', link = '', withPicture = false, tracking = {} } = {}) {
  const item = networkByKey(network);
  if (!item) return [];
  const words = typeof text === 'string' ? text.trim() : '';
  const tags = hashtagText(hashtags);
  const checks = [];
  const limit = item.key === 'telegram' && withPicture ? TELEGRAM_CAPTION_LIMIT : item.limit;
  if (countFor(item.key, sharedWords(item.key, { text: words, hashtags: tags, link }, tracking)) > limit) checks.push(found(CHECKS.overLimit));
  if (item.hashtagMost !== null && normaliseHashtags([tags, ...hashtagsInWords(words)]).length > item.hashtagMost) checks.push(found(CHECKS.tooManyHashtags));
  if (typeof link === 'string' && link.trim() !== '' && !readLink(link).ok) checks.push(found(CHECKS.badLink));
  else if (link !== undefined && link !== null && typeof link !== 'string') checks.push(found(CHECKS.badLink));
  return checks;
}

/**
 * Whether a version's own words hold a must-fix check (`wordsChecks`), for a
 * post with no chosen picture (`mustFix`) and with one
 * (`mustFixWithPicture`): the two differ only on Telegram, whose caption
 * limit is shorter. The posts records keep both at every save of a version's
 * words; `postState` reads the one that fits the post.
 *
 * @param {{ network: string, text?: string, hashtags?: string | string[], link?: unknown }} version
 * @param {import('./share.js').Tracking} [tracking] the post's link tracking (`share.js`)
 * @returns {{ mustFix: boolean, mustFixWithPicture: boolean }}
 */
export function mustFixOf({ network, text = '', hashtags = '', link = '' } = {}, tracking = {}) {
  return {
    mustFix: wordsChecks({ network, text, hashtags, link, withPicture: false, tracking }).length > 0,
    mustFixWithPicture: wordsChecks({ network, text, hashtags, link, withPicture: true, tracking }).length > 0,
  };
}

/**
 * The checks of one network's words, `[{ key, level, fix? }]`, musts first.
 *
 * @param {{
 *   network: string,
 *   text?: string,
 *   hashtags?: string | string[],
 *   link?: string,
 *   chosenPicture?: { description?: string, cardRefused?: boolean } | null,
 *   day?: string | null,
 *   today?: string,
 *   remembrance?: boolean,
 *   shared?: boolean,
 *   tracking?: import('./share.js').Tracking,
 * }} version
 * @returns {Array<{ key: string, level: 'must' | 'mark', fix?: 'linkSentence' | 'description' }>}
 */
export function checksFor({ network, text = '', hashtags = '', link = '', chosenPicture = null, day = null, today = '', remembrance = false, shared = false, tracking = {} } = {}) {
  const item = networkByKey(network);
  if (!item) return [];
  const words = typeof text === 'string' ? text.trim() : '';
  const checks = wordsChecks({ network, text, hashtags, link, withPicture: Boolean(chosenPicture), tracking });
  if (words === '') checks.push(found(CHECKS.noWords));
  if (item.needs === 'picture' && !chosenPicture) checks.push(found(CHECKS.needsPicture));
  // A comment card whose customer has not said yes cannot be shared (its words are not read, its copies are gone).
  const refused = chosenPicture?.cardRefused === true;
  if (refused) checks.push(found(CHECKS.cardRefused));
  checks.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  if (item.links === 'not-pressable' && findAddresses(words).length > 0) checks.push(found(CHECKS.linkNotPressable));
  if (chosenPicture && !refused && (typeof chosenPicture.description !== 'string' || chosenPicture.description.trim() === '')) checks.push(found(CHECKS.noDescription));
  if (item.needs === 'video') checks.push(found(CHECKS.needsVideo));
  if (!shared && typeof day === 'string' && typeof today === 'string' && day !== '' && today !== '' && day < today) checks.push(found(CHECKS.dayPassed));
  if (remembrance) checks.push(found(CHECKS.remembrance));
  return checks;
}

/** True when any check would keep the post unfinished. @param {Array<{ level: string }>} checks */
export function hasMust(checks) {
  return Array.isArray(checks) && checks.some((check) => check.level === 'must');
}
