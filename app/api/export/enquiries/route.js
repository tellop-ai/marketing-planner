import { keepFile } from '../../../../lib/data/files.js';
import { listEnquiriesBetweenFor, MOST_ROWS, postNamesFor } from '../../../../lib/data/customers.js';
import { getLocale, t } from '../../../../lib/i18n/index.js';
import { csvText } from '../../../../lib/plan/csv.js';
import { OWNER } from '../../../../lib/plan/owner.js';
import { failed, json, refused } from '../../../../lib/plan/reply.js';
import { readJsonBody } from '../../../../lib/plan/request.js';
import { downloadAddress, zipFiles } from '../../../../lib/plan/zip.js';
import { channelLabel, statusLabel } from '../../../customers/choices.js';

/**
 * The people who came, as a spreadsheet file (CSV) inside a zip, in two steps
 * because opening an address never saves (AGENTS.md rule 4a):
 *
 * - `POST { from, to }` (both days included) writes the text, puts it in a zip
 *   as `customers-<YYYY-MM>.csv` (`musteriler-` in Turkish; the month of
 *   `from`) and keeps the zip (`keepFile`), answering `{ address }`;
 * - that address is `GET /api/downloads?file=<digest>`
 *   (`app/api/downloads/route.js`), which hands it over as a download.
 *
 * In a zip, because Tellop names a downloaded text file ".txt" and the name
 * inside a zip stays as written here.
 *
 * The headings and the words in the cells are in the app's language; every
 * cell that could run as a formula is guarded by `csvText`. The last two
 * columns are the follow-up day and the offer code (empty when none).
 */
export const dynamic = 'force-dynamic';

/** @param {Request} request */
export async function POST(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const { from, to } = body.value;
  try {
    const enquiries = await listEnquiriesBetweenFor(OWNER, from, to, { take: MOST_ROWS });
    const names = await postNamesFor(OWNER, enquiries.map((enquiry) => enquiry.postId).filter((id) => id !== null));
    const locale = getLocale();
    const text = enquiriesCsv(enquiries, names, locale);
    const name = t('export.fileName', locale, { month: String(from).slice(0, 7) });
    const zip = zipFiles([{ name, bytes: new TextEncoder().encode(text) }]);
    const kept = await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body: zip }));
    return json({ address: downloadAddress(kept.file) });
  } catch (error) {
    return failed(error);
  }
}

/**
 * The file's text: a row of headings, then one row a person, oldest first.
 *
 * @param {import('../../../../lib/data/customers.js').Enquiry[]} enquiries newest first
 * @param {Record<number, string>} names post names by id
 * @param {string} locale
 */
function enquiriesCsv(enquiries, names, locale) {
  const headings = ['day', 'name', 'contact', 'channel', 'post', 'askedAbout', 'status', 'amount', 'notes', 'followUpOn', 'code']
    .map((key) => t(`export.enquiries.${key}`, locale));
  const rows = [...enquiries].reverse().map((enquiry) => [
    enquiry.receivedOn,
    enquiry.name,
    enquiry.contact,
    channelLabel(enquiry.channel, locale),
    enquiry.postId === null ? '' : (names[enquiry.postId] || t('post.untitled', locale)),
    enquiry.askedAbout,
    statusLabel(enquiry.status, locale),
    enquiry.amount,
    enquiry.notes,
    enquiry.followUpOn ?? '',
    enquiry.code ?? '',
  ]);
  return csvText([headings, ...rows]);
}
