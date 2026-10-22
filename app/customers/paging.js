/**
 * Lists on the Customers page that come in pages (pure: no records, no
 * page). The page reads the first page; **Show more** asks the list's address
 * for the page after the last one shown (`?after=`, the cursor the page
 * before answered as `next`, null when nothing comes after it).
 */

/**
 * A page as a read or an address answers it: `{ items, next }`. An answer
 * without a readable list is not a page (null); a cursor that is not a
 * non-empty string means nothing comes after.
 *
 * @param {unknown} value
 * @returns {{ items: any[], next: string | null } | null}
 */
export function pageOf(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(/** @type {any} */ (value).items)) return null;
  const { items, next } = /** @type {{ items: any[], next?: unknown }} */ (value);
  return { items, next: typeof next === 'string' && next !== '' ? next : null };
}

/**
 * The address of the page after `next`: `path` with its own query (for
 * example the month) and `after`.
 *
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {string} next
 */
export function moreAddress(path, query, next) {
  const search = new URLSearchParams({ ...query, after: next });
  return `${path}?${search.toString()}`;
}

/**
 * The rows shown after one more page: the ones shown, then the new page's
 * rows that are not shown yet (a row changed meanwhile can come back in a
 * later page; it shows once, where it first showed).
 *
 * @template {{ id: number }} T
 * @param {T[]} shown
 * @param {T[]} more
 * @returns {T[]}
 */
export function joinPages(shown, more) {
  const seen = new Set(shown.map((row) => row.id));
  return [...shown, ...more.filter((row) => !seen.has(row.id))];
}
