/**
 * A theme's colour (`theme.colour`, 0 to 4) is one of the look's five chart
 * colours, `chart-1`..`chart-5` (rule 6: a mark, never words). The one list of
 * their background classes, written out whole so the stylesheet keeps each
 * one: every page that marks or fills with a theme's colour reads it here.
 */
export const THEME_BACKGROUNDS = Object.freeze(['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']);

/** The background class of a theme colour, or null when it is not one of the five. @param {unknown} colour */
export function themeBackground(colour) {
  return typeof colour === 'number' && Number.isInteger(colour) && colour >= 0 && colour < THEME_BACKGROUNDS.length ? THEME_BACKGROUNDS[colour] : null;
}
