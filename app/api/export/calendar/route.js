import { keepFile } from '../../../../lib/data/files.js';
import { getProfileFor } from '../../../../lib/data/plan.js';
import { MOST_A_MONTH } from '../../../../lib/data/posts.js';
import { CALL_BUDGET, readInPages } from '../../../../lib/data/read-in-pages.js';
import { getLocale, t } from '../../../../lib/i18n/index.js';
import { calendarFile, calendarSpan, copyTag } from '../../../../lib/plan/ics.js';
import { BYTES_A_LETTER, LIMITS } from '../../../../lib/plan/limits.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';
import { downloadAddress, zipFiles } from '../../../../lib/plan/zip.js';

/**
 * "Add to my calendar": a month's posts as a calendar file the person opens
 * in their own calendar (`lib/plan/ics.js`), in two steps because opening an
 * address never saves (AGENTS.md rule 4a):
 *
 * - `POST { month }` (`YYYY-MM`), or `POST { from, to }` (two civil days,
 *   `from` not after `to`, at most `CALENDAR_SPAN_MOST` days: the week page's week,
 *   which can span two months), reads the posts on those days, writes the
 *   calendar file, puts it in a zip as `plan-<YYYY-MM>.ics` (or
 *   `plan-<from>.ics`) and keeps the zip (`keepFile`), answering
 *   `{ address }`; no post on those days is refused
 *   (`calendar.export.empty`);
 * - that address is `GET /api/downloads?file=<digest>`
 *   (`app/api/downloads/route.js`), which hands it over as a download.
 *
 * In a zip, because Tellop names a downloaded text file ".txt" and a
 * calendar opens only a file named ".ics".
 *
 * The posts are read with their main words, which no list read in
 * `lib/data/posts.js` carries, so on a cursor of `CALENDAR_PAGE` posts a call
 * (each call's largest answer under `CALL_BUDGET`): at most
 * `MOST_A_MONTH / CALENDAR_PAGE` calls (11), then the business name (1), one
 * call at a time.
 */
export const dynamic = 'force-dynamic';

/** A field's largest size in a records answer: its name, its quotes and colon, its comma, and its value. */
const field = (name, worst) => name.length + 4 + worst;
/** Words at `BYTES_A_LETTER` bytes a letter of their limit, with their quotes. */
const words = (letters) => BYTES_A_LETTER * letters + 2;
/** The largest post this address reads, in bytes, as `lib/data/posts.js` counts one. */
const ROW_MOST = 3 + field('id', 11) + field('name', words(LIMITS.name)) + field('mainText', words(LIMITS.mainText))
  + field('day', 12) + field('time', 7);
/** Posts read in one call. */
const CALENDAR_PAGE = Math.max(1, Math.floor(CALL_BUDGET / ROW_MOST));

const SELECT = Object.freeze({ id: true, name: true, mainText: true, day: true, time: true });
const BY_DAY = /** @type {Array<[string, 'asc' | 'desc', boolean?]>} */ ([['day', 'asc', true], ['time', 'asc', true], ['id', 'asc']]);

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const span = calendarSpan(/** @type {Record<string, unknown>} */ (body.value));
  if (!span) return refused(REFUSED.request);
  try {
    const posts = await readInPages('Post', {
      where: { ownerId: OWNER, day: { gte: span.from, lte: span.to } },
      order: BY_DAY,
      select: { ...SELECT },
      most: MOST_A_MONTH,
      page: CALENDAR_PAGE,
    });
    if (posts.length === 0) return refused('calendar.export.empty');
    const profile = await getProfileFor(OWNER);
    const locale = getLocale();
    const text = calendarFile(posts, { business: profile.businessName, locale, now: new Date(), tag: copyTag(profile) });
    const zip = zipFiles([{ name: t('calendar.export.fileName', locale, { month: span.label }), bytes: new TextEncoder().encode(text) }]);
    const kept = await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body: zip }));
    return json({ address: downloadAddress(kept.file) });
  } catch (error) {
    return failed(error);
  }
}

