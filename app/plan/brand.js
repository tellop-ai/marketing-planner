/**
 * The Brand card's colour rules, pure (the browser loads it; the checks call
 * it directly). Nothing runs when this file loads.
 */

/** Six hex digits, with or without the `#` in front, in either case. */
const TYPED_COLOUR = /^#?([0-9a-f]{6})$/iu;

/**
 * What a typed colour saves as: '' for an empty field, `#rrggbb` in lowercase
 * for a whole colour (the `#` may be left out), and null while it is not one
 * yet (it then waits for the field to be left, and the address says why).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function colourToSave(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const match = TYPED_COLOUR.exec(trimmed);
  return match ? `#${match[1].toLowerCase()}` : null;
}

/**
 * The colour a field's sample shows: the typed colour when it is a whole one,
 * else null (the sample then shows the muted token).
 *
 * @param {unknown} value
 */
export function swatchColour(value) {
  const colour = colourToSave(value);
  return colour === '' ? null : colour;
}

/**
 * The ready colours the Brand card offers under each colour field: four warm
 * and four calm ones, each dark enough for white words or light enough for
 * black words with room to spare (WCAG's 4.5:1 and more, `inkFor` in
 * `lib/plan/card-layout.js`). They are the person's data once picked, like a
 * typed colour: each is kept as its six hex digits (`presetColour` adds the
 * `#`), and its name is a words key (`plan.brand.preset.<key>`).
 */
export const BRAND_PRESETS = Object.freeze([
  Object.freeze({ key: 'terracotta', digits: 'a3472f' }),
  Object.freeze({ key: 'ochre', digits: 'e0a526' }),
  Object.freeze({ key: 'coral', digits: 'f08a6c' }),
  Object.freeze({ key: 'wine', digits: '7a2e3b' }),
  Object.freeze({ key: 'sage', digits: '9caf88' }),
  Object.freeze({ key: 'pine', digits: '3f6b5b' }),
  Object.freeze({ key: 'navy', digits: '2c4a6b' }),
  Object.freeze({ key: 'sand', digits: 'e8d5b7' }),
]);

/** A ready colour as a colour field saves it (`#rrggbb`). @param {{ digits: string }} preset */
export function presetColour(preset) {
  return `#${preset.digits}`;
}

/** Whether a field's value is that ready colour (a typed colour in capitals, or without its `#`, is too). @param {unknown} value @param {{ digits: string }} preset */
export function isPreset(value, preset) {
  return colourToSave(value) === presetColour(preset);
}
