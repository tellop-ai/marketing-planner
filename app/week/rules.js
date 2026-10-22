/**
 * The "This week" page's own rules, pure (no records, no page, nothing runs
 * when this file loads): which week an address asks for, how the week's posts
 * line up by day and time, what each platform's line offers (the words to
 * copy, the picture or the swipe set to save, Mark scheduled or I shared it),
 * and which pictures one press of Save all pictures puts in its zip, under
 * which names. A story set is not part of the week: stories go up on the day.
 *
 * Weeks start on Monday in Turkish and on Sunday in English, as the calendar's
 * do (`app/calendar/rules.js` `mondayFirstFor`).
 */

import { addDays, isCivilDay, isClockTime, partsOf, weekDays, weekStart } from '../../lib/plan/days.js';
import { networkByKey } from '../../lib/plan/networks.js';
import { canDraw, fileAddress } from '../../lib/plan/picture-rules.js';
import { sharedWords } from '../../lib/plan/share.js';
import { isAhead, momentOf, postState } from '../../lib/plan/state.js';
import { ZIP_LIMITS } from '../../lib/plan/zip.js';
import { setOf, tipPlace } from '../pictures/rules.js';
import { slidesFor } from '../posts/[id]/rules.js';

/** The most reads the page sends at once (each post's words, each picture of Save all pictures). */
export const AT_ONCE = 3;

/**
 * The time a post with no time is scheduled at: the same as Mark scheduled's
 * on the server (`lib/data/posts.js` `SCHEDULE_TIME`; a check holds them equal).
 */
export const SCHEDULE_TIME = '12:00';

/** The most letters of a post's name in a picture's file name. */
export const NAME_MOST = 40;

/** @param {unknown} value */
const one = (value) => (typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined);

/**
 * The week the address asks for: `?week=YYYY-MM-DD` names the week's first
 * day; any day of the week reads as that week, and a missing or wrong day (or
 * one whose week runs past the app's days) as this week. `previous` and
 * `next` are null where no whole week of the app's days lies.
 *
 * @param {Record<string, string | string[] | undefined> | null | undefined} query
 * @param {string} today
 * @param {boolean} mondayFirst
 * @returns {{ from: string, to: string, days: string[], thisWeek: boolean, previous: string | null, next: string | null }}
 */
export function weekOf(query, today, mondayFirst) {
  const asked = one(query?.week);
  const chosen = isCivilDay(asked) ? weekDays(/** @type {string} */ (asked), mondayFirst) : null;
  const days = chosen !== null && isCivilDay(chosen[0]) && isCivilDay(chosen[6]) ? chosen : weekDays(today, mondayFirst);
  const before = addDays(days[0], -7);
  const after = addDays(days[0], 7);
  return {
    from: days[0],
    to: days[6],
    days,
    thisWeek: days[0] === weekStart(today, mondayFirst),
    previous: isCivilDay(before) && isCivilDay(addDays(before, 6)) ? before : null,
    next: isCivilDay(after) && isCivilDay(addDays(after, 6)) ? after : null,
  };
}

/** The address of the week page for the week starting `day`. @param {string} day */
export function weekAddress(day) {
  return `/week?week=${encodeURIComponent(day)}`;
}

/** The calendar's week view of the week holding `day`. @param {string} day */
export function calendarWeekAddress(day) {
  return `/?view=week&day=${encodeURIComponent(day)}`;
}

/** A post's address on its share part. @param {number} id */
export function shareAddress(id) {
  return `/posts/${encodeURIComponent(String(id))}#share`;
}

/** A post's version address for one network. @param {number} id @param {string} network */
export function versionAddress(id, network) {
  return `/api/posts/${encodeURIComponent(String(id))}/versions/${encodeURIComponent(network)}`;
}

/**
 * Posts in the order a day's list shows them: a post with no time first,
 * then by time, then by number.
 *
 * @template {{ id: number, time: string | null }} T
 * @param {T} a
 * @param {T} b
 */
function byTime(a, b) {
  if (a.time !== b.time) {
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return a.time < b.time ? -1 : 1;
  }
  return a.id - b.id;
}

/**
 * The week's days that hold a post, in the week's order, each with its posts
 * by time. A post on a day outside `days` is left out.
 *
 * @template {{ id: number, day: string | null, time: string | null }} T
 * @param {string[]} days
 * @param {T[]} posts
 * @returns {Array<{ day: string, posts: T[] }>}
 */
export function daysWithPosts(days, posts) {
  return days
    .map((day) => ({ day, posts: posts.filter((post) => post.day === day).sort(byTime) }))
    .filter((group) => group.posts.length > 0);
}

/**
 * Where a network's version stands for the week's list: `scheduled` (marked
 * for a moment still ahead of `now`), `shared` (marked, the moment passed) or
 * `none`.
 *
 * @param {{ sharedAt?: string | null } | null | undefined} version
 * @param {unknown} now
 * @returns {'none' | 'scheduled' | 'shared'}
 */
export function versionMark(version, now) {
  const at = version?.sharedAt;
  if (typeof at !== 'string' || at === '') return 'none';
  return isAhead(at, now) ? 'scheduled' : 'shared';
}

/**
 * The moment a post is planned for, on this computer's clock, as Mark
 * scheduled keeps it: its day at its time, or at `SCHEDULE_TIME` when it has
 * none. Null for a post with no day.
 *
 * @param {unknown} day
 * @param {unknown} time
 */
export function plannedMoment(day, time) {
  if (!isCivilDay(day)) return null;
  const [hours, minutes] = (isClockTime(time) ? /** @type {string} */ (time) : SCHEDULE_TIME).split(':').map(Number);
  const { year, month, day: date } = partsOf(/** @type {string} */ (day));
  return new Date(year, month - 1, date, hours, minutes).getTime();
}

/**
 * What a platform's line offers for a version not marked yet: Mark scheduled
 * while the post's planned moment is ahead of `now` (the person schedules it
 * in the platform's own scheduler), I shared it once it has passed (a moment
 * passed cannot be scheduled: marked scheduled, it would read as shared at
 * once). Null for a post with no day.
 *
 * @param {unknown} day
 * @param {unknown} time
 * @param {unknown} now
 * @returns {'scheduled' | 'shared' | null}
 */
export function markAction(day, time, now) {
  const at = plannedMoment(day, time);
  if (at === null) return null;
  return at > momentOf(now) ? 'scheduled' : 'shared';
}

/** A version that holds nothing yet, switched on. @param {string} network */
function emptyVersion(network) {
  return { network, on: true, text: '', hashtags: '', link: '', sharedAt: null };
}

/**
 * The post's chosen picture as the post holds it (the first chosen one by
 * position), or null.
 *
 * @param {{ pictures?: any[] } | null | undefined} full
 */
export function chosenPictureOf(full) {
  const chosen = (Array.isArray(full?.pictures) ? full.pictures : []).filter((picture) => picture?.chosen === true);
  chosen.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return chosen[0] ?? null;
}

/**
 * What the Save picture step of a platform's line shows for the chosen
 * picture in the network's shape: the kept copy to save (`file`), a link to
 * the post's share part where the copy is made (`open`: a copy not kept yet,
 * or a customer's card that cannot be shared yet, which the post says why),
 * or nothing (no picture).
 *
 * @param {any} picture
 * @param {string} shape
 * @returns {'file' | 'open' | 'none'}
 */
export function pictureStep(picture, shape) {
  if (picture === null || picture === undefined || typeof picture !== 'object') return 'none';
  if (picture.cardRefused === true) return 'open';
  const tag = picture.shapes?.[shape];
  if (typeof tag === 'string' && tag !== '') return 'file';
  return canDraw(picture) ? 'open' : 'none';
}

/** A kept copy's address as a download (the window's pressed download). @param {{ id: number, shapes?: Record<string, string | null> }} picture @param {string} shape */
export function pictureDownloadAddress(picture, shape) {
  return `${fileAddress(picture.id, shape, picture.shapes?.[shape])}&download=1`;
}

/**
 * Each switched-on platform's line for one post, in the person's order of
 * networks: the words to copy (`sharedWords`: what the platform carries,
 * the same words the post maker copies), whether there are words at all, the
 * picture step, and where the version stands. A platform that takes a set
 * (`setMostOf` above 1) on a post whose swipe set holds two or more
 * pictures saves the set instead (`picture` is `set`; `set` holds the
 * first pictures, as many as the platform takes), as the post maker does.
 *
 * @param {{ post: { id: number, day: string | null, time: string | null, tracking?: import('../../lib/plan/share.js').Tracking }, versions: any[],
 *   picture: any, networks: string[], now: unknown, slides?: any[] }} input `post.tracking`: its link tracking, carried by the copied words
 * @returns {Array<{ network: string, name: string, mark: string, shape: string, words: string, hasWords: boolean,
 *   picture: 'file' | 'open' | 'none' | 'set', pictureAddress: string | null, set: any[] | null, status: 'none' | 'scheduled' | 'shared',
 *   action: 'scheduled' | 'shared' | null }>}
 */
export function platformLines({ post, versions, picture, networks, now, slides = [] }) {
  const byNetwork = new Map((Array.isArray(versions) ? versions : []).map((version) => [version?.network, version]));
  return (Array.isArray(networks) ? networks : [])
    .map((key) => networkByKey(key))
    .filter((item) => item !== null && byNetwork.get(item.key)?.on !== false)
    .map((item) => {
      const version = byNetwork.get(item.key) ?? emptyVersion(item.key);
      const set = slidesFor(item.key, slides);
      const step = set !== null ? 'set' : pictureStep(picture, item.shape);
      return {
        network: item.key,
        name: item.name,
        mark: item.mark,
        shape: item.shape,
        words: sharedWords(item.key, version, post.tracking),
        hasWords: typeof version.text === 'string' && version.text.trim() !== '',
        picture: step,
        pictureAddress: step === 'file' ? pictureDownloadAddress(picture, item.shape) : null,
        set,
        status: versionMark(version, now),
        action: markAction(post.day, post.time, now),
      };
    });
}

/**
 * One post of the week as the page shows it: from its whole record once the
 * page has read it (`full`, `GET /api/posts/{id}`), else from its tile. The
 * state is worked out again from the record for `now`, so a press that marks
 * a platform shows at once. `slides` is the post's swipe set in order (none
 * until the record is read).
 *
 * @param {{ id: number, name: string, day: string | null, time: string | null, themeId: number | null, state: string, shared?: number,
 *   scheduled?: number, of?: number, networks: string[], picture: any }} tile
 * @param {any} full the post's record, or null while it is read (or when it could not be)
 * @param {string[]} networks the person's networks (My plan), in order
 * @param {unknown} now
 */
export function weekPost(tile, full, networks, now) {
  if (!full || typeof full !== 'object' || !full.post) {
    return {
      id: tile.id, name: tile.name, day: tile.day, time: tile.time, themeId: tile.themeId,
      state: { state: tile.state, shared: tile.shared ?? 0, scheduled: tile.scheduled ?? 0, of: tile.of ?? 0 },
      networks: tile.networks, picture: tile.picture, slides: [], read: false,
    };
  }
  const picture = chosenPictureOf(full);
  const state = postState({
    networks,
    versions: full.versions ?? [],
    hasChosenPicture: picture !== null,
    pictureRefused: picture?.cardRefused === true,
    mainText: typeof full.post.mainText === 'string' ? full.post.mainText : '',
    now,
  });
  return {
    id: tile.id, name: full.post.name ?? tile.name, day: full.post.day ?? tile.day, time: full.post.time ?? null,
    themeId: full.post.themeId ?? null,
    state: { state: state.state, shared: state.shared, scheduled: state.scheduled, of: state.of },
    networks: state.networks, picture, slides: setOf(full, 'slide'), read: true,
  };
}

/**
 * The post's record with one version as the app answered it.
 *
 * @param {{ versions?: any[] }} full
 * @param {{ network: string }} version
 */
export function withVersion(full, version) {
  const versions = Array.isArray(full?.versions) ? full.versions : [];
  const held = versions.some((item) => item?.network === version.network);
  return { ...full, versions: held ? versions.map((item) => (item?.network === version.network ? version : item)) : [...versions, version] };
}

/**
 * The post's record with one picture as the app answered it (a copy kept on
 * the way); a picture the record does not hold leaves it as it is.
 *
 * @param {{ pictures?: any[] }} full
 * @param {{ id: number }} picture
 */
export function withPicture(full, picture) {
  const pictures = Array.isArray(full?.pictures) ? full.pictures : [];
  if (!picture || !pictures.some((item) => item?.id === picture.id)) return full;
  return { ...full, pictures: pictures.map((item) => (item?.id === picture.id ? picture : item)) };
}

const TURKISH_LETTERS = Object.freeze({ ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' });

/**
 * A name as a file name's part: ASCII letters and digits in lower case, words
 * joined by `-`, Turkish letters as their plain twins, at most `most`
 * characters. Empty when nothing of it is left.
 *
 * @param {unknown} name
 * @param {number} [most]
 */
export function asciiName(name, most = NAME_MOST) {
  const text = typeof name === 'string' ? name : '';
  const plain = text
    .replace(/[çÇğĞıİöÖşŞüÜ]/gu, (letter) => TURKISH_LETTERS[/** @type {keyof typeof TURKISH_LETTERS} */ (letter)])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return plain.slice(0, Math.max(0, most)).replace(/-+$/u, '');
}

/** The file name ending of a picture's content type, or null for a kind the zip does not take. @param {unknown} contentType */
export function extensionOf(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  const endings = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/avif': 'avif' };
  return Object.hasOwn(endings, type) ? endings[/** @type {keyof typeof endings} */ (type)] : null;
}

/**
 * What one press of Save all pictures gathers, for each post (in the week's
 * order):
 *
 * - for each shape its switched-on platforms use with one picture, the
 *   chosen picture's kept copy in that shape, once, named
 *   `<day>-<post>-<platforms>` (platforms sharing a shape share it);
 * - for each platform that takes a set, on a post whose swipe set holds two
 *   or more pictures, the set's first pictures (as many as the platform
 *   takes), named `<day>-<post>-<platform>-<n>` from 1: a words picture is
 *   drawn in the page (`draw`: the picture, the shape, its tip's place and
 *   the post's theme), as the post maker draws it; any other its kept copy.
 *
 * The ending comes from the answer's content type. The posts with a copy not
 * kept yet, or a picture that cannot be shared yet (a customer's card), are
 * listed once each, to open, with how many of their copies are missing
 * (`count`). A story set is not part of the week.
 *
 * @param {Array<{ id: number, name: string, day: string | null, themeId?: number | null, networks: string[], picture: any, slides?: any[] }>} posts
 * @returns {{ files: Array<{ postId: number, shape: string, address?: string, draw?: { picture: any, shape: string, place: number | null,
 *   themeId: number | null }, stem: string }>, notReady: Array<{ id: number, name: string, count: number }> }}
 */
export function picturePlan(posts) {
  const files = [];
  const notReady = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    if (!post || typeof post.day !== 'string') continue;
    const picture = post.picture && typeof post.picture === 'object' ? post.picture : null;
    const slides = Array.isArray(post.slides) ? post.slides : [];
    const name = asciiName(post.name) || `post-${post.id}`;
    /** @type {Map<string, string[]>} */
    const shapes = new Map();
    let missing = 0;
    for (const key of Array.isArray(post.networks) ? post.networks : []) {
      const item = networkByKey(key);
      if (item === null) continue;
      const set = slidesFor(item.key, slides);
      if (set === null) {
        if (picture !== null) shapes.set(item.shape, [...(shapes.get(item.shape) ?? []), item.key]);
        continue;
      }
      set.forEach((slide, index) => {
        const stem = `${post.day}-${name}-${item.key}-${index + 1}`;
        if (slide?.source === 'words') {
          files.push({ postId: post.id, shape: item.shape, draw: { picture: slide, shape: item.shape, place: tipPlace({ pictures: slides }, slide), themeId: post.themeId ?? null }, stem });
        } else if (pictureStep(slide, item.shape) === 'file') {
          files.push({ postId: post.id, shape: item.shape, address: fileAddress(slide.id, item.shape, slide.shapes[item.shape]), stem });
        } else {
          missing += 1;
        }
      });
    }
    for (const [shape, keys] of shapes) {
      if (pictureStep(picture, shape) !== 'file') {
        missing += 1;
        continue;
      }
      files.push({ postId: post.id, shape, address: fileAddress(picture.id, shape, picture.shapes[shape]), stem: `${post.day}-${name}-${keys.join('-')}` });
    }
    if (missing > 0) notReady.push({ id: post.id, name: post.name, count: missing });
  }
  return { files, notReady };
}

/**
 * Gathers each planned picture, at most `atOnce` at a time, in the plan's
 * order: `ready` holds `{ name, bytes }` for the zip, `failed` the posts whose
 * picture could not be read or drawn (gone, or a kind the zip does not
 * take), each once with how many of its files failed (`count`).
 * `fetchFile(address)` reads a kept copy and `drawFile(draw)` draws a words
 * picture (a file planned with `draw`; none drawn when it is missing); each
 * answers `{ ok, type, bytes }` or throws.
 *
 * @param {Array<{ postId: number, address?: string, draw?: any, stem: string }>} files
 * @param {(address: string) => Promise<{ ok: boolean, type: string | null, bytes: Uint8Array | null }>} fetchFile
 * @param {number} [atOnce]
 * @param {((draw: any) => Promise<{ ok: boolean, type: string | null, bytes: Uint8Array | null }>) | null} [drawFile]
 * @returns {Promise<{ ready: Array<{ name: string, bytes: Uint8Array }>, failed: Array<{ postId: number, count: number }> }>}
 */
export async function collectPictures(files, fetchFile, atOnce = AT_ONCE, drawFile = null) {
  const list = Array.isArray(files) ? files : [];
  /** @type {Array<{ name: string, bytes: Uint8Array } | null>} */
  const got = list.map(() => null);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      const file = list[index];
      try {
        const answer = file.draw ? (drawFile === null ? null : await drawFile(file.draw)) : await fetchFile(/** @type {string} */ (file.address));
        const ending = extensionOf(answer?.type);
        if (answer?.ok && ending !== null && answer.bytes instanceof Uint8Array && answer.bytes.length > 0) {
          got[index] = { name: `${file.stem}.${ending}`, bytes: answer.bytes };
        }
      } catch {
        // Counted below as not ready.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, list.length)) }, worker));
  /** @type {Map<number, number>} */
  const failed = new Map();
  list.forEach((file, index) => {
    if (got[index] === null) failed.set(file.postId, (failed.get(file.postId) ?? 0) + 1);
  });
  return { ready: got.filter((item) => item !== null), failed: [...failed].map(([postId, count]) => ({ postId, count })) };
}

/**
 * Why Save all pictures rests, or null when it can be pressed: no kept copy
 * to save yet, or more files than one zip holds (`ZIP_LIMITS.files`).
 *
 * @param {{ files: unknown[] }} plan
 */
export function saveAllRest(plan) {
  if (plan.files.length === 0) return 'week.saveAllNone';
  return plan.files.length > ZIP_LIMITS.files ? 'week.tooMany' : null;
}

/** The words key of the "not ready" line: one picture, or more. @param {number} count */
export function notReadyKey(count) {
  return count === 1 ? 'week.notReady.one' : 'week.notReady.many';
}

/**
 * The posts whose pictures were not ready after a press: the plan's, then
 * those whose files could not be read, each post once with all its missing
 * copies counted.
 *
 * @param {Array<{ id: number, name: string, count: number }>} planned
 * @param {Array<{ postId: number, count: number }>} failed
 * @param {Array<{ id: number, name: string }>} posts
 */
export function joinNotReady(planned, failed, posts) {
  const joined = planned.map((item) => ({ ...item }));
  for (const { postId, count } of failed) {
    const held = joined.find((item) => item.id === postId);
    if (held) held.count += count;
    else joined.push({ id: postId, name: posts.find((post) => post.id === postId)?.name ?? '', count });
  }
  return joined;
}

/** How many pictures a not-ready list holds. @param {Array<{ count: number }>} list */
export function missingCount(list) {
  return list.reduce((total, item) => total + item.count, 0);
}
