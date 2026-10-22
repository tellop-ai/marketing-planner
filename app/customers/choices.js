/**
 * The stored choice values for customers and their comments (from
 * `lib/plan/customer-choices.js`, which the records code reads too), and the
 * words each one shows, so a value the page offers is always one the records
 * accept. Pure: the browser loads it too.
 *
 * A network key is always a choice as well (`lib/plan/networks.js`); a network
 * shows its own name, never translated.
 */

import { OWN_CHANNELS, OWN_SOURCES } from '../../lib/plan/customer-choices.js';
import { isNetworkKey, networkByKey } from '../../lib/plan/networks.js';
import { t } from '../../lib/i18n/index.js';

export { ENQUIRY_STATUSES, isChannel, isEnquiryStatus, isPermission, isSource, OWN_CHANNELS, OWN_SOURCES, PERMISSIONS } from '../../lib/plan/customer-choices.js';

/** The words for a channel (or a comment's source): a network's own name, else the locale's. */
export function channelLabel(value, locale) {
  const network = networkByKey(value);
  if (network) return network.name;
  if (value === 'email' || value === 'in-person') return t(`comments.source.${value}`, locale);
  return t(`customers.channel.${String(value)}`, locale);
}

export function statusLabel(value, locale) {
  return t(`customers.status.${String(value)}`, locale);
}

export function permissionLabel(value, locale) {
  return t(`comments.permission.${String(value)}`, locale);
}

/**
 * The choices a "where from" field offers: the networks the person uses (in
 * their order), then the other places, then `current` when it is something
 * else that is stored (so editing never loses a value).
 *
 * @param {string[]} networks
 * @param {readonly string[]} own
 * @param {string | undefined} current
 */
function choicesOf(networks, own, current) {
  const keys = [];
  for (const key of [...networks, ...own]) if (!keys.includes(key)) keys.push(key);
  if (typeof current === 'string' && current !== '' && !keys.includes(current)) keys.push(current);
  return keys;
}

/** @param {string[]} networks @param {string} [current] */
export function channelChoices(networks, current) {
  return choicesOf(networks.filter(isNetworkKey), OWN_CHANNELS, current);
}

/** @param {string[]} networks @param {string} [current] */
export function sourceChoices(networks, current) {
  return choicesOf(networks.filter(isNetworkKey), OWN_SOURCES, current);
}
