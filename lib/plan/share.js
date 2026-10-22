/**
 * How the person shares one network's words: the words to copy, and the
 * address their browser opens on a press (through Tellop's trusted-sites door).
 *
 * - `kind: 'address'`: an official share address that carries the words (X,
 *   Threads, Bluesky, WhatsApp; Telegram when there is a link) or the link
 *   (Facebook and LinkedIn when there is a link);
 * - `kind: 'site'`: the network's own site; the person pastes the copied words.
 *
 * The words a network carries (`sharedWords`) are the same everywhere the app
 * shows, counts or checks them: the copied words, the words a share address
 * carries, the preview's count and the checks (`checks.js`). On a network
 * where links can be pressed they hold the version's own link.
 *
 * Share addresses as read on 2026-10-21 (spec `marketing-planner.md`, "Share
 * addresses"). Every address is `https:` on the default port. An address over
 * `SHARE_ADDRESS_MOST` characters falls back to the site.
 *
 * Tracking (`tracking`, the third argument; `trackingFor` makes it from the
 * plan): while it is on, the version's own `https:` link, wherever the app
 * hands it over (after the words, in a share address), and every `https:`
 * address inside the words on a network where links can be pressed
 * (`trackedWords`, in place), carry `utm_source=<network key>`,
 * `utm_medium=social` and `utm_campaign=<the campaign's name, else the
 * theme's, else "post", as a slug>` (`trackedLink`), so the person's site
 * statistics can tell which platform and campaign each visit came from. Never
 * on the person's profile link (My plan's, wherever it appears), never on a
 * link that already carries a `utm_` field, never on a link that is not a
 * safe `https:` one. The copied words, the share addresses, the count, the
 * checks, the preview and the week page all go through `sharedWords` /
 * `trackedWords` with the same tracking, so they agree.
 */

import { findAddresses, hashtagText, joinWords } from './count.js';
import { readLink } from './limits.js';
import { networkByKey } from './networks.js';

/** The longest share address the app opens; a longer one opens the network's site instead. */
export const SHARE_ADDRESS_MOST = 8000;

/** Share addresses that carry the words, before the encoded words. */
const TEXT_ADDRESSES = Object.freeze({
  x: 'https://x.com/intent/post?text=',
  threads: 'https://www.threads.com/intent/post?text=',
  bluesky: 'https://bsky.app/intent/compose?text=',
  whatsapp: 'https://wa.me/?text=',
});

/** Share addresses that carry only a link, before the encoded link. */
const LINK_ADDRESSES = Object.freeze({
  facebook: 'https://www.facebook.com/sharer/sharer.php?u=',
  linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=',
});

/** Telegram's share address carries a link and the words. */
const TELEGRAM_ADDRESS = 'https://t.me/share/url';

/** The longest campaign part (`utm_campaign`) of a tracked link. */
export const TRACK_SLUG_MOST = 40;
/** The campaign part of a tracked link with neither a campaign nor a theme to name it. */
export const TRACK_SLUG_NONE = 'post';
/** Turkish letters that a plain ASCII slug writes without their marks. */
const TURKISH_FOLD = Object.freeze({ ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' });

/**
 * A name as the campaign part of a tracked link: ASCII lowercase letters and
 * digits joined by single hyphens, Turkish letters folded (ç c, ğ g, ı i, İ i,
 * ö o, ş s, ü u) and other marks taken off (é e), at most `TRACK_SLUG_MOST`
 * characters with no hyphen at either end; '' when nothing is left (a name in
 * another script).
 *
 * @param {unknown} name
 * @returns {string}
 */
export function trackSlug(name) {
  if (typeof name !== 'string') return '';
  const plain = name
    .replace(/[çÇğĞıİöÖşŞüÜ]/gu, (letter) => TURKISH_FOLD[letter])
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  return plain.replace(/[^a-z0-9]+/gu, '-').replace(/^-+/u, '').slice(0, TRACK_SLUG_MOST).replace(/-+$/u, '');
}

/**
 * How the app tracks one post's link: off (`track` not true) or on, with the
 * names that make the campaign part and the person's profile link (`profile`,
 * never tracked). Every caller of `sharedWords` and `shareFor` passes it;
 * left out, the link is not tracked.
 *
 * @typedef {{ track?: boolean, campaign?: unknown, theme?: unknown, profile?: unknown }} Tracking
 */

/**
 * The tracking of a post from the plan: on unless the plan switched it off
 * (`trackLinks` false; null, as an older plan reads, is on), with the names
 * of the post's campaign and theme (an archived theme too) found by id, and
 * the plan's profile link (kept form; '' for none), which is never tracked.
 *
 * @param {{ campaignId?: unknown, themeId?: unknown } | null | undefined} post
 * @param {{ trackLinks?: boolean | null, themes?: Array<{ id: number, name: string }>, campaigns?: Array<{ id: number, name: string }>,
 *   profileLink?: unknown }} [plan]
 * @returns {{ track: boolean, campaign: string, theme: string, profile: string }}
 */
export function trackingFor(post, { trackLinks = true, themes = [], campaigns = [], profileLink = '' } = {}) {
  const nameOf = (list, id) => {
    if (!Number.isSafeInteger(id) || !Array.isArray(list)) return '';
    const name = list.find((item) => item?.id === id)?.name;
    return typeof name === 'string' ? name : '';
  };
  return { track: trackLinks !== false, campaign: nameOf(campaigns, post?.campaignId), theme: nameOf(themes, post?.themeId), profile: safeLinkOf(profileLink) };
}

/** The campaign part of a tracked link: the campaign's slug, else the theme's, else `TRACK_SLUG_NONE`. @param {Tracking} [tracking] */
export function trackCampaign({ campaign = '', theme = '' } = {}) {
  return trackSlug(campaign) || trackSlug(theme) || TRACK_SLUG_NONE;
}

/**
 * A safe link (`safeLinkOf`) with the three tracking fields after its own
 * query (before any `#` part) while `tracking.track` is on; the safe link as
 * it is when tracking is off, when it already carries a `utm_` field (in any
 * case), when it is the person's profile link (`tracking.profile`), or for an
 * unknown network; '' when it is not a safe `https:` link.
 *
 * @param {string} networkKey
 * @param {unknown} link
 * @param {Tracking} [tracking]
 * @returns {string}
 */
export function trackedLink(networkKey, link, tracking = {}) {
  const safe = safeLinkOf(link);
  if (safe === '' || tracking?.track !== true) return safe;
  const item = networkByKey(networkKey);
  if (!item) return safe;
  if ([...new URL(safe).searchParams.keys()].some((key) => key.toLowerCase().startsWith('utm_'))) return safe;
  const profile = safeLinkOf(tracking?.profile);
  if (profile !== '' && profile === safe) return safe;
  const hashAt = safe.indexOf('#');
  const head = hashAt === -1 ? safe : safe.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : safe.slice(hashAt);
  const joiner = !head.includes('?') ? '?' : /[?&]$/u.test(head) ? '' : '&';
  return `${head}${joiner}utm_source=${item.key}&utm_medium=social&utm_campaign=${trackCampaign(tracking)}${hash}`;
}

/** A version's link as the app uses it: a safe `https:` address in its kept form, else none (''). @param {unknown} link */
export function safeLinkOf(link) {
  const read = readLink(link);
  return read.ok ? read.value : '';
}

/** A web address found in words, in the kept form a link takes; '' when it does not read as one. @param {string} address */
function keptAddress(address) {
  const read = readLink(/^www\./iu.test(address) ? `https://${address}` : address);
  return read.ok ? read.value : '';
}

/**
 * The words with every `https:` address in them tracked in place
 * (`trackedLink`), on a network where links can be pressed while
 * `tracking.track` is on: the person's profile link, an address that already
 * carries a `utm_` field and one that is not a safe `https:` link (a `www.`
 * or `http:` one too) stay as written. Elsewhere, and with tracking off, the
 * words as they are.
 *
 * @param {string} networkKey
 * @param {unknown} text
 * @param {Tracking} [tracking]
 * @returns {string}
 */
export function trackedWords(networkKey, text, tracking = {}) {
  const words = typeof text === 'string' ? text : '';
  if (tracking?.track !== true || networkByKey(networkKey)?.links !== 'pressable') return words;
  let out = '';
  let from = 0;
  for (const { start, end, address } of findAddresses(words)) {
    if (!/^https:\/\//iu.test(address)) continue;
    const safe = safeLinkOf(address);
    const tracked = safe === '' ? '' : trackedLink(networkKey, safe, tracking);
    if (tracked === '' || tracked === safe) continue;
    out += words.slice(from, start) + tracked;
    from = end;
  }
  return from === 0 ? words : out + words.slice(from);
}

/**
 * The link that goes after the words on `networkKey`: the version's safe
 * `https:` link on a network where links can be pressed, unless the words
 * already hold that same address; else ''.
 *
 * @param {string} networkKey
 * @param {string} text
 * @param {unknown} link
 */
export function linkAfterWords(networkKey, text, link) {
  if (networkByKey(networkKey)?.links !== 'pressable') return '';
  const safe = safeLinkOf(link);
  if (safe === '') return '';
  const words = typeof text === 'string' ? text : '';
  return findAddresses(words).some(({ address }) => keptAddress(address) === safe) ? '' : safe;
}

/**
 * The words as `networkKey` carries them when shared: the words (their own
 * `https:` addresses tracked, `trackedWords`); then, on a network where
 * links can be pressed, a blank line and the version's link
 * (`linkAfterWords`, tracked by `trackedLink` while `tracking` is on); then a
 * blank line and the hashtags. Each part is left out when empty. A link on a
 * network where links cannot be pressed, or one with a field of its own
 * (Pinterest, Google), is never in the words.
 *
 * @param {string} networkKey
 * @param {{ text?: unknown, hashtags?: unknown, link?: unknown }} [version]
 * @param {Tracking} [tracking]
 */
export function sharedWords(networkKey, { text = '', hashtags = '', link = '' } = {}, tracking = {}) {
  const words = typeof text === 'string' ? text.replace(/\r\n?/gu, '\n') : '';
  const after = linkAfterWords(networkKey, words, link);
  return joinWords(joinWords(trackedWords(networkKey, words, tracking), after === '' ? '' : trackedLink(networkKey, after, tracking)), hashtagText(hashtags));
}

/**
 * How to share one network's words.
 *
 * `copyText` is `sharedWords`: the words, the link where links can be pressed,
 * and the hashtags, each after a blank line. A share address that carries the
 * words carries the same words; Telegram's carries the link in its own place
 * and the words and hashtags beside it. `link` is used only when it is a safe
 * `https:` address (`readLink`); else the post is shared as if it had none.
 * While `tracking` is on, the link carries the tracking fields everywhere it
 * goes (`trackedLink`). An unknown network answers null.
 *
 * @param {string} networkKey
 * @param {{ text?: string, hashtags?: string | string[], link?: string }} [version]
 * @param {Tracking} [tracking]
 * @returns {{ kind: 'address' | 'site', address: string, copyText: string } | null}
 */
export function shareFor(networkKey, { text = '', hashtags = '', link = '' } = {}, tracking = {}) {
  const item = networkByKey(networkKey);
  if (!item) return null;
  const copyText = sharedWords(item.key, { text, hashtags, link }, tracking);
  const safeLink = trackedLink(item.key, link, tracking);
  const site = { kind: 'site', address: item.site, copyText };

  let address = null;
  if (Object.hasOwn(TEXT_ADDRESSES, item.key)) address = `${TEXT_ADDRESSES[item.key]}${encodeURIComponent(copyText)}`;
  else if (item.key === 'telegram' && safeLink !== '') {
    const beside = joinWords(trackedWords(item.key, typeof text === 'string' ? text.replace(/\r\n?/gu, '\n') : '', tracking), hashtagText(hashtags));
    address = `${TELEGRAM_ADDRESS}?url=${encodeURIComponent(safeLink)}&text=${encodeURIComponent(beside)}`;
  } else if (Object.hasOwn(LINK_ADDRESSES, item.key) && safeLink !== '') address = `${LINK_ADDRESSES[item.key]}${encodeURIComponent(safeLink)}`;

  if (address === null || address.length > SHARE_ADDRESS_MOST) return site;
  return { kind: 'address', address, copyText };
}
