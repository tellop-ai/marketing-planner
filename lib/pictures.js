/**
 * A person's own pictures: the few facts the browser half and the server half
 * share. The picture itself is a kept file like any other (`lib/data/files.js`),
 * named in its record by its digest (`AGENTS.md` rule 6c).
 *
 * The browser half is `components/ui/picture-field.jsx`: it shows the picture,
 * lets the person choose another, change it and remove it, and its
 * `appendPicture()` sends the picture the person picked, as it is, before the
 * form is sent. The server half is `readPicture()` and `fileResponse()` in
 * `lib/data/files.js`. The address that shows a picture looks like this:
 *
 *     // app/api/memories/[id]/photo/route.js
 *     import { findMemoryFor } from '../../../../../lib/data/index.js';
 *     import { fileResponse } from '../../../../../lib/data/files.js';
 *
 *     export const dynamic = 'force-dynamic';
 *
 *     export async function GET(request, { params }) {
 *       const { id } = await params;
 *       const owner = new URL(request.url).searchParams.get('owner');
 *       const memory = await findMemoryFor(owner, id);
 *       return fileResponse(memory?.photoFile ?? null, request);
 *     }
 *
 * and the address that saves the memory reads its picture from the same form
 * (a small form: the picture went ahead on its own, so only its digest is here):
 *
 *     const form = await request.formData();
 *     const picture = await readPicture(form, 'photo');
 *     if (picture.problem) return json({ problem: picture.problem }, 400);
 *     // picture.change is 'keep', 'remove' or 'replace' (with picture.file,
 *     // the digest): hand it to the lib/data/ function that saves the memory,
 *     // which keeps, clears or sets `photoFile` for that owner.
 *
 * Nothing here imports anything, so the browser and a check can both load it.
 */

/**
 * The longest side, in pixels, of a smaller copy: what `appendPicture` makes
 * only when the app's person asked for smaller pictures (`{ smaller: true }`)
 * or for a display copy beside the original (`{ displayCopy }`).
 */
export const PICTURE_LONGEST_SIDE = 1280;

/**
 * What a form sends in place of a picture when the person pressed Remove, and
 * only then: an empty field, or one the form never filled, sends nothing. The
 * same word as `FILE_REMOVED` in `lib/data/files.js`.
 */
export const PICTURE_REMOVED = 'remove';

/**
 * `?v=` values that name no version: what a missing or broken stamp turns into
 * when it is written into an address by hand.
 */
const NO_VERSION = new Set(['', 'undefined', 'null', 'NaN', 'Invalid Date']);

/**
 * The address a page gives `<img>` for a saved picture: `address` with a `?v=`
 * value that changes whenever the picture does.
 *
 * Pass the record's file field (its digest, which changes exactly when the
 * picture does) or its `updatedAt`. A changed picture then has a new address
 * and shows at once. Without a real stamp (nothing, an invalid date, empty
 * text) the address comes back as it was, and the browser asks again each
 * time, which is slower but never shows an old picture after a change.
 *
 * @param {string} address
 * @param {Date | string | number | null | undefined} changedAt
 * @returns {string}
 */
export function pictureAddress(address, changedAt) {
  const stamp = changedAt instanceof Date ? changedAt.getTime() : changedAt;
  const known =
    (typeof stamp === 'number' && Number.isFinite(stamp)) ||
    (typeof stamp === 'string' && !NO_VERSION.has(stamp.trim()));
  if (!known) return address;
  return `${address}${address.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(stamp))}`;
}
