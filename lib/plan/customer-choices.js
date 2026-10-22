/**
 * The stored choice values for customers and their comments: one list each,
 * read by the records code (`lib/data/customers.js`) and, through
 * `app/customers/choices.js` (which adds the words each one shows), by the
 * export and the pages, so a value the page offers is always one the records
 * accept. Pure: the browser loads it too.
 *
 * A network key is always a choice as well (`./networks.js`).
 */

import { isNetworkKey } from './networks.js';

/** Where an enquiry came from, besides the networks. `google` is also a network key. */
export const OWN_CHANNELS = Object.freeze(['word', 'google', 'website', 'walk-in', 'other']);

/** Where a comment was written, besides the networks. */
export const OWN_SOURCES = Object.freeze(['instagram', 'whatsapp', 'google', 'email', 'in-person', 'other']);

export const ENQUIRY_STATUSES = Object.freeze(['new', 'talking', 'bought', 'not-now']);

export const PERMISSIONS = Object.freeze(['not-asked', 'asked', 'yes', 'no']);

/** @param {unknown} value */
export function isChannel(value) {
  return typeof value === 'string' && (OWN_CHANNELS.includes(value) || isNetworkKey(value));
}

/** @param {unknown} value */
export function isSource(value) {
  return typeof value === 'string' && (OWN_SOURCES.includes(value) || isNetworkKey(value));
}

/** @param {unknown} value */
export function isEnquiryStatus(value) {
  return typeof value === 'string' && ENQUIRY_STATUSES.includes(value);
}

/** @param {unknown} value */
export function isPermission(value) {
  return typeof value === 'string' && PERMISSIONS.includes(value);
}
