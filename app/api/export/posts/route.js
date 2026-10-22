import { keepFile } from '../../../../lib/data/files.js';
import { getLocale, t } from '../../../../lib/i18n/index.js';
import { isCivilMonth } from '../../../../lib/plan/days.js';
import { failed, json, refused } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';
import { downloadAddress, zipFiles } from '../../../../lib/plan/zip.js';
import { postsExportText } from '../../../results/read.js';

/**
 * A month's shared posts with the results the person typed, as a spreadsheet
 * file (CSV) inside a zip, in two steps because opening an address never
 * saves (AGENTS.md rule 4a), as the customers' file does:
 *
 * - `POST { month }` (`YYYY-MM`) writes the text, puts it in a zip as
 *   `posts-<YYYY-MM>.csv` (`paylasimlar-` in Turkish) and keeps the zip
 *   (`keepFile`), answering `{ address }`;
 * - that address is `GET /api/downloads?file=<digest>`
 *   (`app/api/downloads/route.js`), which hands it over as a download.
 *
 * One row a share: the post's day, its name, its theme, the network, the day
 * it was shared, the address the person gave, the six numbers and the note.
 * The headings are in the app's language; every cell that could run as a
 * formula is guarded by `csvText`.
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const { month } = /** @type {Record<string, unknown>} */ (body.value);
  if (!isCivilMonth(month)) return refused('refuse.request');
  try {
    const locale = getLocale();
    const text = await postsExportText(/** @type {string} */ (month), locale);
    const zip = zipFiles([{ name: t('results.export.fileName', locale, { month: /** @type {string} */ (month) }), bytes: new TextEncoder().encode(text) }]);
    const kept = await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body: zip }));
    return json({ address: downloadAddress(kept.file) });
  } catch (error) {
    return failed(error);
  }
}
