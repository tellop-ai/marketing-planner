/**
 * The picture shapes the app makes for the networks, kept in code. A picture is
 * kept once as the person or the AI gave it; each shape is a copy cut from it
 * in the page (on a canvas) and kept as a file of its own, named in the
 * picture's record by the shape's `field`.
 *
 * Two ways to make a shape from a picture of another shape:
 * - `fill`: cut the largest part of the shape's proportions around the focus
 *   point (the picture fills the whole shape; the edges are lost);
 * - `fit`: draw the whole picture as large as fits, on the theme's colour.
 * `auto` is `fit` for the tall shapes (story and tall), which would lose most
 * of a wide picture, and `fill` for the rest.
 */

const shape = (key, width, height, field) => Object.freeze({ key, width, height, field, ratio: `${width}:${height}` });

export const SHAPES = Object.freeze({
  square: shape('square', 1080, 1080, 'squareFile'),
  portrait: shape('portrait', 1080, 1350, 'portraitFile'),
  story: shape('story', 1080, 1920, 'storyFile'),
  wide: shape('wide', 1200, 628, 'wideFile'),
  landscape: shape('landscape', 1600, 900, 'landscapeFile'),
  tall: shape('tall', 1000, 1500, 'tallFile'),
  gbp: shape('gbp', 1200, 900, 'gbpFile'),
});

export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

export const FITS = Object.freeze(['auto', 'fill', 'fit']);

/** @param {unknown} key */
export function isShapeKey(key) {
  return typeof key === 'string' && Object.hasOwn(SHAPES, key);
}

/** `fill` or `fit` for one shape, from the picture's stored choice. */
export function fitFor(fit, key) {
  if (fit === 'fill' || fit === 'fit') return fit;
  return key === 'story' || key === 'tall' ? 'fit' : 'fill';
}

/** @param {number} value */
function clampUnit(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/**
 * The part of a `width` x `height` picture that `fill` keeps for a shape: the
 * largest rectangle of the shape's proportions, centred on the focus point as
 * far as the picture's edges allow. Whole pixels.
 *
 * @param {{ width: number, height: number, focusX?: number, focusY?: number }} picture
 * @param {string} key
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function fillCut(picture, key) {
  if (!isShapeKey(key)) return null;
  const { width, height } = picture;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  const target = SHAPES[key].width / SHAPES[key].height;
  let cutWidth = width;
  let cutHeight = Math.round(width / target);
  if (cutHeight > height) {
    cutHeight = height;
    cutWidth = Math.min(width, Math.round(height * target));
  }
  const centreX = clampUnit(picture.focusX ?? 0.5) * width;
  const centreY = clampUnit(picture.focusY ?? 0.5) * height;
  const x = Math.round(Math.min(width - cutWidth, Math.max(0, centreX - cutWidth / 2)));
  const y = Math.round(Math.min(height - cutHeight, Math.max(0, centreY - cutHeight / 2)));
  return { x, y, width: cutWidth, height: cutHeight };
}

/**
 * Where `fit` draws a `width` x `height` picture inside a shape: as large as
 * fits, in the middle. Whole pixels of the shape.
 *
 * @param {{ width: number, height: number }} picture
 * @param {string} key
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function fitPlace(picture, key) {
  if (!isShapeKey(key)) return null;
  const { width, height } = picture;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  const { width: shapeWidth, height: shapeHeight } = SHAPES[key];
  const scale = Math.min(shapeWidth / width, shapeHeight / height);
  const drawnWidth = Math.round(width * scale);
  const drawnHeight = Math.round(height * scale);
  return { x: Math.round((shapeWidth - drawnWidth) / 2), y: Math.round((shapeHeight - drawnHeight) / 2), width: drawnWidth, height: drawnHeight };
}
