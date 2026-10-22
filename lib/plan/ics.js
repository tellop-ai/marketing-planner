/**
 * The calendar file: a month's posts as events the person adds to their own
 * calendar (Apple Calendar, Google Calendar, Outlook), each with a reminder
 * when it starts. Pure: works in the page and on the server, nothing runs
 * when this file loads.
 *
 * One event a post that has a day. A post with a time starts then, in the
 * person's own time wherever their calendar is (a "floating" time: no time
 * zone), and lasts 15 minutes; a post with no time is a whole-day event. The
 * event's title is the post's name, its notes the post's main words (the
 * first `ICS_DESCRIPTION_MOST` characters), and its name in the calendar
 * `post-<id>@marketing-planner.invalid`, so adding the file again changes the
 * same events instead of adding copies.
 *
 * The text follows RFC 5545: lines end CRLF and are folded at 75 bytes
 * (never inside a character), and `\`, `;`, `,` and new lines are escaped.
 */

import { t } from '../i18n/index.js';

import { addDays, daysInMonth, isCivilDay, isCivilMonth, isClockTime } from './days.js';
import { crc32 } from './zip.js';

/** The most days a `{ from, to }` span takes: one week (the week page's); the read stops at a month's most posts. */
export const CALENDAR_SPAN_MOST = 7;
/** The most characters of a post's main words an event's notes carry. */
export const ICS_DESCRIPTION_MOST = 500;
/** How long an event with a time lasts, in minutes. */
export const ICS_EVENT_MINUTES = 15;
/** The longest line, in bytes, before it is folded. */
const LINE_MOST = 75;
/** When a whole-day event reminds: 9:00 on its day (its start is midnight, when nobody reads a reminder). */
const WHOLE_DAY_REMINDER = 'PT9H';

/** Control characters a calendar's text cannot hold (tab and new lines are kept: new lines become `\n`). */
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f]/gu;

/**
 * `text` as a calendar's TEXT value: new lines as `\n`, and `\`, `;`, `,`
 * escaped.
 *
 * @param {unknown} text
 */
export function icsText(text) {
  return String(text ?? '')
    .replace(/\r\n|\r|\n/gu, '\n')
    .replace(CONTROLS, '')
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\n/gu, '\\n');
}

/**
 * `line` folded as RFC 5545 asks: at most 75 bytes a line (the space that
 * starts a following line counted), cut only between characters.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = '';
  let size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > LINE_MOST) {
      lines.push(current);
      current = ' ';
      size = 1;
    }
    current += character;
    size += bytes;
  }
  lines.push(current);
  return lines;
}

/** `2026-10-22` as `20261022`. @param {string} day */
const dateOf = (day) => day.replaceAll('-', '');

/** An instant in UTC as `20261022T090000Z`. @param {Date} now */
function stampOf(now) {
  return now.toISOString().replace(/\.\d{3}Z$/u, 'Z').replaceAll('-', '').replaceAll(':', '');
}

/** A day and a time `HH:MM` with `minutes` added, as a floating `YYYYMMDDTHHMMSS`. @param {string} day @param {string} time @param {number} minutes */
function floatingAt(day, time, minutes) {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  const moved = addDays(day, Math.floor(total / 1440));
  const within = ((total % 1440) + 1440) % 1440;
  const clock = `${String(Math.floor(within / 60)).padStart(2, '0')}${String(within % 60).padStart(2, '0')}00`;
  return `${dateOf(moved)}T${clock}`;
}

/**
 * A short, stable mark of this copy of the app (eight hex digits): from the
 * moment its profile was first saved, or from the business's name when there
 * is no profile yet. Each event's identity carries it, so the calendar files
 * of two copies of the app (each with its own post numbers) never replace
 * each other's events, while a file made again by the same copy updates its
 * own.
 *
 * @param {{ createdAt?: string | null, businessName?: string | null } | null | undefined} profile
 */
export function copyTag(profile) {
  const created = typeof profile?.createdAt === 'string' ? profile.createdAt.trim() : '';
  const seed = created !== '' ? `created:${created}` : `business:${String(profile?.businessName ?? '').trim()}`;
  return crc32(new TextEncoder().encode(seed)).toString(16).padStart(8, '0');
}

/**
 * The calendar file's text for `posts` (each `{ id, name, mainText, day,
 * time }`; a post with no day is left out), in the order given.
 *
 * `business` names the calendar (the app's name when it is empty), `locale`
 * chooses the word for a post with no name, `now` is the moment the file
 * is made (each event's `DTSTAMP`), and `tag` (`copyTag`) marks each
 * event's identity as this copy of the app's (`post-<id>-<tag>`).
 *
 * @param {Array<{ id: number, name?: string | null, mainText?: string | null, day?: string | null, time?: string | null }>} posts
 * @param {{ business?: string, locale?: 'en' | 'tr', now?: Date, tag?: string }} [options]
 * @returns {string}
 */
export function calendarFile(posts, { business = '', locale = 'en', now = new Date(), tag = '' } = {}) {
  const mark = /^[0-9a-f]{1,16}$/u.test(String(tag)) ? `-${tag}` : '';
  const stamp = stampOf(now);
  const calendarName = String(business ?? '').trim() || t('app.title', locale);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Marketing planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(calendarName)}`,
  ];
  for (const post of posts) {
    if (!isCivilDay(post?.day) || !Number.isSafeInteger(post.id)) continue;
    const day = /** @type {string} */ (post.day);
    const title = String(post.name ?? '').trim() || t('post.untitled', locale);
    const words = Array.from(String(post.mainText ?? '').replace(/\r\n|\r/gu, '\n').trim()).slice(0, ICS_DESCRIPTION_MOST).join('');
    const timed = isClockTime(post.time);
    lines.push('BEGIN:VEVENT', `UID:post-${post.id}${mark}@marketing-planner.invalid`, `DTSTAMP:${stamp}`);
    if (timed) {
      const time = /** @type {string} */ (post.time);
      lines.push(`DTSTART:${floatingAt(day, time, 0)}`, `DTEND:${floatingAt(day, time, ICS_EVENT_MINUTES)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateOf(day)}`, `DTEND;VALUE=DATE:${dateOf(addDays(day, 1))}`);
    }
    lines.push(`SUMMARY:${icsText(title)}`);
    if (words !== '') lines.push(`DESCRIPTION:${icsText(words)}`);
    lines.push(
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${timed ? 'PT0S' : WHOLE_DAY_REMINDER}`,
      `DESCRIPTION:${icsText(title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.flatMap(foldLine).join('\r\n')}\r\n`;
}

/**
 * The days a request asks for: a whole month, or `from` to `to` (both civil
 * days, in order, at most `CALENDAR_SPAN_MOST` days); null for anything else.
 *
 * @param {Record<string, unknown>} body
 * @returns {{ from: string, to: string, label: string } | null}
 */
export function calendarSpan(body) {
  const { month, from, to } = body ?? {};
  if (month !== undefined) {
    if (from !== undefined || to !== undefined || !isCivilMonth(month)) return null;
    const chosen = /** @type {string} */ (month);
    const [year, number] = chosen.split('-').map(Number);
    return { from: `${chosen}-01`, to: `${chosen}-${String(daysInMonth(year, number)).padStart(2, '0')}`, label: chosen };
  }
  if (!isCivilDay(from) || !isCivilDay(to)) return null;
  const first = /** @type {string} */ (from);
  const last = /** @type {string} */ (to);
  if (first > last || addDays(first, CALENDAR_SPAN_MOST - 1) < last) return null;
  return { from: first, to: last, label: first };
}
