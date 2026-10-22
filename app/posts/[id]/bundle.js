/**
 * A set of pictures saved as one zip: the browser gathers
 * each picture in the network's shape, builds the zip (`lib/plan/zip.js`,
 * files stored as they are), keeps it through `POST /api/downloads` and
 * answers the address that hands it over. Inside Tellop the app's server
 * cannot read kept bytes (Tellop serves them), so the page does the work.
 *
 * - A words picture is drawn now (`drawShape`, nothing kept): its tip number
 *   follows the set's order as it is now, which a kept copy may not.
 * - Any other picture keeps its missing copy in the shape first
 *   (`keepShapes`, handed back through `onKept`), then its kept copy is
 *   read from the picture's address.
 *
 * Browser only: nothing runs when this file loads. A failure throws a
 * `BundleProblem` (or the drawing's own problem), each with the `messageKey`
 * the page shows.
 */

import { drawShape, keepShapes } from '../../../lib/plan/draw.js';
import { fileAddress, problemOf } from '../../../lib/plan/picture-rules.js';
import { zipFiles } from '../../../lib/plan/zip.js';

import { setFileName } from './rules.js';

/** A set that could not be saved; `messageKey` says why. */
export class BundleProblem extends Error {
  constructor(messageKey) {
    super(messageKey);
    this.name = 'BundleProblem';
    this.messageKey = messageKey;
  }
}

/** One picture's bytes in `shape`, with its type. */
async function pictureBytes(picture, shape, { themeColour, business, place, onKept }) {
  if (picture?.source === 'words') {
    const blob = await drawShape(picture, shape, { themeColour, business, place });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  }
  let kept = picture;
  if (!(typeof picture?.shapes?.[shape] === 'string' && picture.shapes[shape] !== '')) {
    kept = await keepShapes(picture, [shape], { themeColour, business, place });
    onKept?.(kept);
  }
  let response;
  try {
    response = await fetch(fileAddress(kept.id, shape, kept.shapes?.[shape]), { cache: 'no-store' });
  } catch {
    throw new BundleProblem('pictures.notReady');
  }
  if (!response.ok) throw new BundleProblem('pictures.notReady');
  return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('content-type') ?? '' };
}

/**
 * Saves `pictures` (in this order) in `shape` as one zip and answers the
 * address that downloads it (`{ address }` from `POST /api/downloads`).
 * Pictures are gathered one after another. `placeOf(picture)` is a tip's
 * number; `onKept(picture)` hands back each picture whose copy was kept on
 * the way.
 *
 * @param {any[]} pictures
 * @param {string} shape
 * @param {{ themeColour?: number | null, business?: string, placeOf?: (picture: any) => number | null,
 *   onKept?: (picture: any) => void }} [options]
 * @returns {Promise<string>}
 */
export async function bundleSet(pictures, shape, { themeColour, business, placeOf, onKept } = {}) {
  if (typeof document === 'undefined') throw new BundleProblem('pictures.notReady');
  const files = [];
  for (const [index, picture] of pictures.entries()) {
    const read = await pictureBytes(picture, shape, { themeColour, business, place: placeOf?.(picture) ?? null, onKept });
    files.push({ name: setFileName(index, read.type), bytes: read.bytes });
  }
  let zip;
  try {
    zip = zipFiles(files);
  } catch {
    throw new BundleProblem('share.zipTooBig');
  }
  let response;
  try {
    response = await fetch('/api/downloads', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip });
  } catch {
    throw new BundleProblem('error.saveFailed');
  }
  const answer = await response.json().catch(() => null);
  if (!response.ok || typeof answer?.address !== 'string') throw new BundleProblem(problemOf(answer, 'error.saveUnconfirmed'));
  return answer.address;
}
