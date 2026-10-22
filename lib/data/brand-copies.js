/**
 * The kept shape copies a change of the business's brand makes stale
 * (My plan's brand colour, second colour, "Logo on pictures" and the logo),
 * as records steps for one `modelBatch` beside the profile's own save. Each
 * step is one `updateMany` over the owner's pictures (it answers a count,
 * never rows, so no read bound is reached however many pictures there are);
 * the page draws the missing copies again on its next press, in the new
 * brand (`lib/plan/draw.js`).
 *
 * - The brand colour is a words picture's background and the colour a whole
 *   picture is fitted on: every copy of a words picture, and each copy a
 *   photo or AI picture fits whole (`fitFor(fit, shape)` is `fit`), goes.
 * - The second colour is a words picture's badges and quote mark: every copy
 *   of a words picture goes.
 * - The logo is on every copy while "Logo on pictures" is on and a logo is
 *   kept: when that changes, or the logo itself does, every copy of every
 *   picture goes.
 */

import { FITS, SHAPES, SHAPE_KEYS, fitFor } from '../plan/shapes.js';

const SHAPE_FIELDS = Object.freeze(SHAPE_KEYS.map((key) => SHAPES[key].field));
const BRAND_COLOUR = /^#[0-9a-f]{6}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

/** The profile fields a picture's brand is read from (a save of any of them may make copies stale). */
export const BRAND_FIELDS = Object.freeze(['brandColour', 'brandColour2', 'logoOnPictures', 'logoFile']);

/** The select that reads them. */
export const BRAND_SELECT = Object.freeze(Object.fromEntries(BRAND_FIELDS.map((name) => [name, true])));

/**
 * What a stored profile (a row, or null for none saved) puts on pictures:
 * its two colours ('' for none, also for a row saved before brands) and the
 * logo's digest while the pictures carry it, else null.
 *
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {{ colour: string, colour2: string, logo: string | null }}
 */
export function brandOnPictures(row) {
  const colour = (value) => (typeof value === 'string' && BRAND_COLOUR.test(value) ? value : '');
  const logo = row?.logoOnPictures === true && typeof row?.logoFile === 'string' && DIGEST.test(row.logoFile) ? row.logoFile : null;
  return { colour: colour(row?.brandColour), colour2: colour(row?.brandColour2), logo };
}

/** Every named shape field cleared. @param {readonly string[]} fields */
function cleared(fields) {
  return Object.fromEntries(fields.map((field) => [field, null]));
}

/**
 * The steps that clear the copies `before` -> `after` (each from
 * `brandOnPictures`) makes stale, for every picture of `owner`; none when the
 * pictures look the same.
 *
 * @param {string} owner
 * @param {{ colour: string, colour2: string, logo: string | null }} before
 * @param {{ colour: string, colour2: string, logo: string | null }} after
 * @returns {Array<{ model: string, action: string, args: object }>}
 */
export function brandCopySteps(owner, before, after) {
  if (before.logo !== after.logo) {
    return [{ model: 'PostPicture', action: 'updateMany', args: { where: { ownerId: owner }, data: cleared(SHAPE_FIELDS) } }];
  }
  const colour = before.colour !== after.colour;
  if (!colour && before.colour2 === after.colour2) return [];
  const steps = [{ model: 'PostPicture', action: 'updateMany', args: { where: { ownerId: owner, source: 'words' }, data: cleared(SHAPE_FIELDS) } }];
  if (!colour) return steps;
  for (const fit of FITS) {
    const fields = SHAPE_KEYS.filter((key) => fitFor(fit, key) === 'fit').map((key) => SHAPES[key].field);
    if (fields.length === 0) continue;
    // A stored fit the app does not know reads as `auto`.
    const fitWhere = fit === 'auto' ? { notIn: FITS.filter((other) => other !== 'auto') } : fit;
    steps.push({
      model: 'PostPicture',
      action: 'updateMany',
      args: { where: { ownerId: owner, source: { notIn: ['words', 'card'] }, fit: fitWhere }, data: cleared(fields) },
    });
  }
  return steps;
}
