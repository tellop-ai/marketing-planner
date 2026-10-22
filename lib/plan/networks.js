/**
 * The networks this app writes for, kept in code (not rows): what each one
 * allows and how the person shares to it. The app never reaches a network
 * itself; it opens the network's own site or share address in the person's
 * browser on a press (through Tellop's trusted-sites door).
 *
 * The limits follow each network's help pages as read on 2026-10-21 (spec
 * `marketing-planner.md`, "Networks"); a network changes them from time to
 * time, so they are re-read before each release of this app.
 *
 * - `limit`: the most characters a post's words may have, as the network counts
 *   them (`counting`: `graphemes` counts what a person sees as one character;
 *   `x` counts a web address as 23 and a wide character as 2).
 * - `foldAt`: about where the feed cuts the words to "more" (null: no cut).
 * - `hashtagMost`: the most hashtags the network takes (null: no stated most);
 *   `hashtagAdvice`: the number that works best, `[least, most]`.
 * - `links`: `pressable`, `not-pressable` (a link in the words cannot be
 *   pressed; the "link in profile" sentence goes in its place) or `one` (one
 *   link field of its own).
 * - `needs`: `picture` or `video` when a post there needs one, else null.
 * - `shape`: the picture shape used for this network; `shapes`: the shapes it takes.
 * - `share`: `text` (an official share address carries the words), `link` (the
 *   address carries only a web address) or `site` (copy, then open `site`).
 * - `mark`: the two-letter mark drawn in small places (never a logo).
 * - `setMost`: the most pictures one post there carries as a set (swipe
 *   pictures; 1 where a post takes one picture). A post keeps at most
 *   `SET_LIMITS.slide` in its set: `setMostOf` reads both.
 * - `storyOk`: whether the network has stories (a set of tall frames, at most
 *   `SET_LIMITS.story` a post).
 */

const network = (value) => Object.freeze({ ...value, hashtagAdvice: Object.freeze(value.hashtagAdvice), shapes: Object.freeze(value.shapes) });

export const NETWORKS = Object.freeze([
  network({ key: 'instagram', name: 'Instagram', mark: 'IG', limit: 2200, counting: 'graphemes', foldAt: 125, hashtagMost: 5, hashtagAdvice: [3, 5], links: 'not-pressable', needs: 'picture', shape: 'portrait', shapes: ['portrait', 'square', 'story'], share: 'site', site: 'https://www.instagram.com/', setMost: 20, storyOk: true }),
  network({ key: 'facebook', name: 'Facebook', mark: 'FB', limit: 63206, counting: 'graphemes', foldAt: 480, hashtagMost: null, hashtagAdvice: [1, 3], links: 'pressable', needs: null, shape: 'portrait', shapes: ['portrait', 'square', 'wide'], share: 'link', site: 'https://www.facebook.com/', setMost: 10, storyOk: true }),
  network({ key: 'linkedin', name: 'LinkedIn', mark: 'LI', limit: 3000, counting: 'graphemes', foldAt: 210, hashtagMost: null, hashtagAdvice: [3, 5], links: 'pressable', needs: null, shape: 'square', shapes: ['square', 'wide', 'portrait'], share: 'link', site: 'https://www.linkedin.com/feed/', setMost: 20, storyOk: false }),
  network({ key: 'x', name: 'X', mark: 'X', limit: 280, counting: 'x', foldAt: null, hashtagMost: null, hashtagAdvice: [1, 2], links: 'pressable', needs: null, shape: 'landscape', shapes: ['landscape', 'square'], share: 'text', site: 'https://x.com/', setMost: 4, storyOk: false }),
  network({ key: 'threads', name: 'Threads', mark: 'TH', limit: 500, counting: 'graphemes', foldAt: null, hashtagMost: 1, hashtagAdvice: [0, 1], links: 'pressable', needs: null, shape: 'portrait', shapes: ['portrait', 'square'], share: 'text', site: 'https://www.threads.com/', setMost: 10, storyOk: false }),
  network({ key: 'bluesky', name: 'Bluesky', mark: 'BS', limit: 300, counting: 'graphemes', foldAt: null, hashtagMost: null, hashtagAdvice: [1, 2], links: 'pressable', needs: null, shape: 'landscape', shapes: ['landscape', 'square'], share: 'text', site: 'https://bsky.app/', setMost: 4, storyOk: false }),
  network({ key: 'tiktok', name: 'TikTok', mark: 'TT', limit: 4000, counting: 'graphemes', foldAt: 100, hashtagMost: null, hashtagAdvice: [3, 5], links: 'not-pressable', needs: 'video', shape: 'story', shapes: ['story'], share: 'site', site: 'https://www.tiktok.com/upload', setMost: 35, storyOk: true }),
  network({ key: 'youtube', name: 'YouTube', mark: 'YT', limit: 5000, counting: 'graphemes', foldAt: 150, hashtagMost: 60, hashtagAdvice: [1, 3], links: 'pressable', needs: 'video', shape: 'landscape', shapes: ['landscape'], share: 'site', site: 'https://studio.youtube.com/', setMost: 1, storyOk: true }),
  network({ key: 'pinterest', name: 'Pinterest', mark: 'PI', limit: 500, counting: 'graphemes', foldAt: null, hashtagMost: null, hashtagAdvice: [2, 5], links: 'one', needs: 'picture', shape: 'tall', shapes: ['tall', 'square'], share: 'site', site: 'https://www.pinterest.com/pin-creation-tool/', setMost: 5, storyOk: false }),
  network({ key: 'whatsapp', name: 'WhatsApp', mark: 'WA', limit: 65536, counting: 'graphemes', foldAt: null, hashtagMost: null, hashtagAdvice: [0, 0], links: 'pressable', needs: null, shape: 'square', shapes: ['square', 'story'], share: 'text', site: 'https://web.whatsapp.com/', setMost: 1, storyOk: true }),
  network({ key: 'telegram', name: 'Telegram', mark: 'TG', limit: 4096, counting: 'graphemes', foldAt: null, hashtagMost: null, hashtagAdvice: [0, 3], links: 'pressable', needs: null, shape: 'square', shapes: ['square', 'landscape'], share: 'text', site: 'https://web.telegram.org/', setMost: 10, storyOk: false }),
  network({ key: 'google', name: 'Google', mark: 'GB', limit: 1500, counting: 'graphemes', foldAt: null, hashtagMost: null, hashtagAdvice: [0, 0], links: 'one', needs: null, shape: 'gbp', shapes: ['gbp', 'square'], share: 'site', site: 'https://business.google.com/', setMost: 1, storyOk: false }),
]);

/** The most pictures a post keeps in its swipe set (`slide`) and in its story set (`story`). */
export const SET_LIMITS = Object.freeze({ slide: 20, story: 10 });

/** Telegram takes fewer characters with a picture: the words become the picture's caption. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** A YouTube video's title is at most this long. */
export const YOUTUBE_TITLE_LIMIT = 100;

export const NETWORK_KEYS = Object.freeze(NETWORKS.map((item) => item.key));

const BY_KEY = new Map(NETWORKS.map((item) => [item.key, item]));

/** @param {unknown} key */
export function networkByKey(key) {
  return typeof key === 'string' ? BY_KEY.get(key) ?? null : null;
}

/**
 * The most pictures of a post's swipe set a network takes: its `setMost`, at
 * most `SET_LIMITS.slide`; 1 for a key that is not a network.
 *
 * @param {unknown} key
 */
export function setMostOf(key) {
  const found = networkByKey(key);
  return found === null ? 1 : Math.min(found.setMost, SET_LIMITS.slide);
}

/** @param {unknown} key */
export function isNetworkKey(key) {
  return typeof key === 'string' && BY_KEY.has(key);
}

/**
 * A stored comma list of network keys, as known keys in their order with no
 * repeats. Unknown or repeated names are left out, never refused, so a list
 * written by an older version still reads.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseNetworkList(value) {
  if (typeof value !== 'string') return [];
  const seen = new Set();
  const keys = [];
  for (const part of value.split(',')) {
    const key = part.trim();
    if (BY_KEY.has(key) && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The stored form of a list the person chose, or null when it holds anything
 * that is not a known key, or a key twice.
 *
 * @param {unknown} keys
 * @returns {string | null}
 */
export function formatNetworkList(keys) {
  if (!Array.isArray(keys) || keys.length > NETWORKS.length) return null;
  const seen = new Set();
  for (const key of keys) {
    if (!isNetworkKey(key) || seen.has(key)) return null;
    seen.add(key);
  }
  return keys.join(',');
}
