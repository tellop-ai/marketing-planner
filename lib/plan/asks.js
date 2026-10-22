/**
 * What a post asks the reader to do: one of these keys, or
 * `''` for no ask. The AI ends every version with it; without AI the app
 * appends the ask's fixed sentence (`ask.sentence.<key>`). Results count the
 * customers and sales each ask brought. Pure: the browser loads it too.
 */

/** The asks, in the order the post maker offers them. */
export const ASKS = Object.freeze(['message', 'book', 'buy', 'visit', 'call', 'comment']);

/** @param {unknown} value */
export function isAsk(value) {
  return typeof value === 'string' && ASKS.includes(value);
}

/**
 * A stored ask as the app reads it: one of `ASKS`, else `''` (a post with no
 * ask, or one kept before asks existed).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function askOf(value) {
  return isAsk(value) ? /** @type {string} */ (value) : '';
}
