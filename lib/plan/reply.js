/**
 * How this app's addresses answer.
 *
 * **Sharing with other websites is off, and it is off by omission.** No answer
 * carries `Access-Control-Allow-Origin`, so a browser refuses to hand this
 * app's answers to a page on another site. Refusals travel as message keys,
 * never as sentences: the words are chosen in the reader's language where they
 * are shown.
 */

import { DataError } from '../data/index.js';

/** The refusal keys every address shares. Each area adds its own under `refuse.<area>.*`. */
export const REFUSED = Object.freeze({
  request: 'refuse.request',
  long: 'refuse.long',
  notFound: 'error.notFound',
});

/**
 * @param {unknown} body
 * @param {number} [status]
 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** @param {string} problem */
export function refused(problem) {
  if (problem === REFUSED.notFound) return json({ problem }, 404);
  return json({ problem }, problem === REFUSED.long ? 413 : 400);
}

/** The status of a refusal a person can be shown, by its words key; any other is 400. */
const STATUS = Object.freeze({ 'error.saveUnconfirmed': 503, 'error.cannotChange': 403 });

/**
 * A refusal as the page shows it: a `DataError`'s own words (the host's
 * refusal of a change this person may not make is `error.cannotChange`, "You
 * cannot change this.", answered 403), anything else `error.saveFailed`.
 *
 * @param {unknown} error
 */
export function failed(error) {
  if (error instanceof DataError) return json({ problem: error.messageKey }, STATUS[error.messageKey] ?? 400);
  return json({ problem: 'error.saveFailed' }, 500);
}
