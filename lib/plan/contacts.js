/**
 * The consent rules of the Contacts page, pure: the browser loads them, the
 * addresses use them too, and nothing here reaches the records or the network.
 *
 * In Türkiye a marketing message by WhatsApp or email may go only to a person
 * whose yes is on İYS (the national register of those yeses); a yes not taken
 * through İYS is recorded there within three business days, or it does not
 * count. So a contact can get a message on a channel only when:
 *
 * - that channel's yes day is filled (and is not after today), and the
 *   contact has the channel's address (a phone number, an email address);
 * - and the İYS day (the day every yes on the contact was recorded there) is
 *   filled, on or after that channel's yes day.
 *
 * A yes not on İYS yet rests for that channel: within three business days of
 * the yes (weekends skipped: public holidays are not known here, which makes
 * the window shorter, never longer) a reminder says to record it; after them
 * the line says the yes does not count and a new one is needed.
 *
 * A yes belongs to the number or address it was given for: when a kept
 * number or address changes, that channel's yes goes (`afterAddressChange`).
 *
 * The app never sends: WhatsApp opens for one person with the words ready,
 * and the email addresses are copied for the person's own email. Every
 * message the app copies ends with the business's name and a line saying how
 * to stop them (`withEnding`).
 */

import { addDays, isCivilDay, weekdayOf } from './days.js';
import { readWords } from './limits.js';
import { whatsAppAddress, whatsAppDigits } from './whatsapp.js';

/** The channels a contact can say yes to, in the order the page shows them. */
export const CHANNELS = Object.freeze(['whatsapp', 'email']);

/** Each channel's yes day on a contact. */
export const CONSENT_FIELD = Object.freeze({ whatsapp: 'whatsappConsentOn', email: 'emailConsentOn' });

/** Each channel's address on a contact. */
export const ADDRESS_FIELD = Object.freeze({ whatsapp: 'phone', email: 'email' });

/** Business days a yes taken outside İYS has to be recorded there. */
export const IYS_BUSINESS_DAYS = 3;

/** Whether a channel is one of `CHANNELS`. @param {unknown} channel */
export function isChannel(channel) {
  return typeof channel === 'string' && CHANNELS.includes(channel);
}

/** Whether `day` is Monday to Friday. @param {string} day */
export function isBusinessDay(day) {
  const weekday = weekdayOf(day);
  return weekday !== 0 && weekday !== 6;
}

/**
 * The day `count` business days after `day`: Saturdays and Sundays are
 * skipped; `day` itself does not count, whatever day it is.
 *
 * @param {string} day
 * @param {number} count
 */
export function businessDaysAfter(day, count) {
  let at = day;
  for (let counted = 0; counted < count;) {
    at = addDays(at, 1);
    if (isBusinessDay(at)) counted += 1;
  }
  return at;
}

/** The last day a yes given on `consentOn` may still wait for its İYS day. @param {string} consentOn */
export function iysDeadline(consentOn) {
  return businessDaysAfter(consentOn, IYS_BUSINESS_DAYS);
}

/** A civil day, or null for anything else. @param {unknown} value */
function dayOrNull(value) {
  return isCivilDay(value) ? /** @type {string} */ (value) : null;
}

/**
 * Whether `contact` can get a message on `channel` on `today`, and why not:
 *
 * - `noConsent`: no yes day for the channel (or one after today);
 * - `noAddress`: a yes, but no phone number or email address;
 * - `ok`: a yes recorded in İYS (the İYS day on or after the yes day): the
 *   only state a message may go in;
 * - `remind`: a yes not in İYS yet, still within three business days
 *   (`deadline` is the last day): it rests, with a reminder to record it;
 * - `late`: a yes not in İYS after three business days (`deadline` passed):
 *   it rests, and the line says to ask for a new yes.
 *
 * @param {{ phone?: string, email?: string, whatsappConsentOn?: string | null, emailConsentOn?: string | null, iysOn?: string | null }} contact
 * @param {'whatsapp' | 'email'} channel
 * @param {string} today
 * @returns {{ state: 'ok' | 'remind' | 'late' | 'noConsent' | 'noAddress', consentOn: string | null, deadline: string | null }}
 */
export function channelGate(contact, channel, today) {
  const consentOn = dayOrNull(contact?.[CONSENT_FIELD[channel]]);
  if (consentOn === null || consentOn > today) return { state: 'noConsent', consentOn: null, deadline: null };
  const address = contact?.[ADDRESS_FIELD[channel]];
  if (typeof address !== 'string' || address === '') return { state: 'noAddress', consentOn, deadline: null };
  const iysOn = dayOrNull(contact?.iysOn);
  if (iysOn !== null && iysOn >= consentOn) return { state: 'ok', consentOn, deadline: null };
  const deadline = iysDeadline(consentOn);
  return { state: today <= deadline ? 'remind' : 'late', consentOn, deadline };
}

/** Whether a gate lets a message go: only a yes already on İYS. @param {{ state: string }} gate */
export function canMessage(gate) {
  return gate.state === 'ok';
}

/**
 * The contacts WhatsApp can open for, one at a time, in the order given:
 * each with its gate; one number once (two contacts with the same number
 * would get the message twice).
 *
 * @template {{ id: number, phone: string }} T
 * @param {T[]} contacts
 * @param {string} today
 * @returns {Array<{ contact: T, gate: ReturnType<typeof channelGate> }>}
 */
export function whatsAppQueue(contacts, today) {
  const seen = new Set();
  const queue = [];
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const gate = channelGate(contact, 'whatsapp', today);
    if (!canMessage(gate) || seen.has(contact.phone)) continue;
    seen.add(contact.phone);
    queue.push({ contact, gate });
  }
  return queue;
}

/**
 * The email addresses of the contacts that can get email, in the order
 * given, each once.
 *
 * @param {Array<{ email: string }>} contacts
 * @param {string} today
 * @returns {string[]}
 */
export function emailList(contacts, today) {
  const seen = new Set();
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    if (canMessage(channelGate(contact, 'email', today))) seen.add(contact.email);
  }
  return [...seen];
}

/** The addresses as the copy puts them: separated by commas, as an email's address line takes them. @param {string[]} addresses */
export function emailText(addresses) {
  return addresses.join(', ');
}

/**
 * The people with a yes on `channel` who rest in one gate state: `late` (not
 * recorded in İYS in time) or `remind` (not recorded yet, still in time).
 *
 * @param {object[]} contacts
 * @param {'whatsapp' | 'email'} channel
 * @param {string} today
 * @param {'late' | 'remind'} [state]
 */
export function lateCount(contacts, channel, today, state = 'late') {
  return (Array.isArray(contacts) ? contacts : []).filter((contact) => channelGate(contact, channel, today).state === state).length;
}

/**
 * WhatsApp's own address for a contact's number (kept as `+` and its digits)
 * with the words ready; the person presses send in WhatsApp.
 *
 * @param {{ phone: string }} contact
 * @param {string} words
 */
export function contactWhatsAppAddress(contact, words) {
  return whatsAppAddress(String(contact.phone).replace(/^\+/u, ''), words);
}

/**
 * The person after `currentId` in the queue: the first when none is current
 * or the current one left the queue, null after the last.
 *
 * @param {Array<{ contact: { id: number } }>} queue
 * @param {number | null} currentId
 * @returns {number | null}
 */
export function nextInQueue(queue, currentId) {
  if (queue.length === 0) return null;
  const at = queue.findIndex((item) => item.contact.id === currentId);
  if (at === -1) return queue[0].contact.id;
  return at + 1 < queue.length ? queue[at + 1].contact.id : null;
}

/**
 * The İYS day a contact keeps after "They said stop" on `channel`: it stays
 * only while it still covers the other channel's yes (on or after it);
 * otherwise it belonged to the channel that stopped and goes with it.
 *
 * @param {{ whatsappConsentOn?: string | null, emailConsentOn?: string | null, iysOn?: string | null }} contact
 * @param {'whatsapp' | 'email'} channel
 * @returns {string | null}
 */
export function iysAfterStop(contact, channel) {
  const other = CHANNELS.find((name) => name !== channel);
  const otherOn = dayOrNull(contact?.[CONSENT_FIELD[other]]);
  const iysOn = dayOrNull(contact?.iysOn);
  return otherOn !== null && iysOn !== null && iysOn >= otherOn ? iysOn : null;
}


/** The most letters an email address holds. */
export const EMAIL_MOST = 254;

/** One address: letters, digits and marks, an `@`, a name with a dot; no space, comma, semicolon, bracket or quote. */
const EMAIL = /^[^\s@,;<>()[\]\\"']+@[^\s@,;<>()[\]\\"']+\.[^\s@,;<>()[\]\\"'.][^\s@,;<>()[\]\\"']*$/u;

/**
 * A phone number as kept: `''` for none, else `+` and its digits: written
 * with its country code (`+90 532 …`, `0090 532 …`) or, in Turkish, a
 * Turkish mobile number written the national way (`0532 …`), the one rule
 * WhatsApp's follow-ups use (`whatsAppDigits`). Null when it is not a number
 * the app can be sure of, so WhatsApp never opens a chat with the wrong
 * person.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string | null}
 */
export function phoneOf(value, locale) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return '';
  const digits = whatsAppDigits(value, locale);
  return digits === null ? null : `+${digits}`;
}

/**
 * An email address as kept: `''` for none, else trimmed and lower-cased, or
 * null when it is not one address (the copy joins them with commas).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function emailOf(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const read = readWords(value, EMAIL_MOST);
  if (!read.ok) return null;
  const email = read.value.toLowerCase();
  if (email === '') return '';
  return EMAIL.test(email) ? email : null;
}

/**
 * A kept number as a person reads it: a Turkish number as `+90 532 123 45
 * 67`, a North American one as `+1 415 555 0100`; any other as kept (its
 * country code's length is not known here).
 *
 * @param {unknown} phone
 */
export function phoneText(phone) {
  const text = typeof phone === 'string' ? phone : '';
  const turkish = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/u.exec(text);
  if (turkish) return `+90 ${turkish.slice(1).join(' ')}`;
  const northAmerican = /^\+1(\d{3})(\d{3})(\d{4})$/u.exec(text);
  if (northAmerican) return `+1 ${northAmerican.slice(1).join(' ')}`;
  return text;
}

/**
 * The yes days and İYS day a contact keeps once a change is saved. A yes
 * belongs to the number or address it was given for: when a kept one changes
 * (another number, or none), that channel's kept yes goes, whatever yes day
 * came with the change (a new number needs a new yes, given after it is
 * saved). A first number or address on a contact that had none keeps the
 * yes: the person adds what was missing. When a yes goes, the İYS day stays
 * only while a yes left is on or before it.
 *
 * @param {{ phone?: string, email?: string, whatsappConsentOn?: string | null, emailConsentOn?: string | null }} before as kept
 * @param {{ phone?: string, email?: string, whatsappConsentOn?: string | null, emailConsentOn?: string | null, iysOn?: string | null }} next as it would be saved (the number and address as kept)
 * @returns {{ dropped: Array<'whatsapp' | 'email'>, whatsappConsentOn: string | null, emailConsentOn: string | null, iysOn: string | null }}
 */
export function afterAddressChange(before, next) {
  const dropped = CHANNELS.filter((channel) => {
    const was = before?.[ADDRESS_FIELD[channel]];
    return typeof was === 'string' && was !== '' && next?.[ADDRESS_FIELD[channel]] !== was
      && dayOrNull(before?.[CONSENT_FIELD[channel]]) !== null;
  });
  const days = {
    whatsappConsentOn: dropped.includes('whatsapp') ? null : dayOrNull(next?.whatsappConsentOn),
    emailConsentOn: dropped.includes('email') ? null : dayOrNull(next?.emailConsentOn),
  };
  let iysOn = dayOrNull(next?.iysOn);
  if (dropped.length > 0 && iysOn !== null && !Object.values(days).some((day) => day !== null && day <= /** @type {string} */ (iysOn))) iysOn = null;
  return { dropped, ...days, iysOn };
}

/**
 * The words a copied message carries: the person's words, a blank line, the
 * business's name, and the line that says how to stop these messages (a
 * message names its sender and says how to refuse, through the same
 * channel).
 *
 * @param {unknown} words
 * @param {{ business: string, stop: string }} ending
 */
export function withEnding(words, { business, stop }) {
  return `${String(words ?? '').trim()}\n\n${endingText({ business, stop })}`;
}

/** The ending alone, as the message box shows it. @param {{ business: string, stop: string }} ending */
export function endingText({ business, stop }) {
  return `${String(business ?? '').trim()}\n${String(stop ?? '').trim()}`;
}
