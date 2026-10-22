/**
 * Contacts: the people the person may send a marketing message to, each with
 * a yes day for each channel (WhatsApp, email), how the yes was given, and the
 * day it went into İYS. Every read, save and delete names its owner inside the
 * statement's `where` (AGENTS.md rule 1a); nothing here saves while reading
 * (rule 4a). What leaves this file is a plain object.
 *
 * The person's words are checked here, before anything is saved, and a
 * refusal is a `DataError` whose `messageKey` the page shows
 * (`refuse.contacts.*`):
 *
 * - a phone number is kept as `+` and its digits: written with its country
 *   code (`+90 532 …`, `0090 532 …`) or, in Turkish, a Turkish mobile number
 *   written the national way (`0532 …`), the one rule WhatsApp's follow-ups
 *   use (`phoneOf` in `lib/plan/contacts.js`); anything else is refused, so
 *   WhatsApp never opens a chat with the wrong person;
 * - an email address is kept lower-cased, one address, no comma (the copy
 *   joins them with commas);
 * - a yes day and the İYS day are civil days, never after today; the İYS day
 *   needs a yes day on or before it;
 * - how the yes was given: one line of at most 200 letters.
 *
 * A yes belongs to the number or address it was given for: a change of a
 * kept number or address drops that channel's yes (and the İYS day when no
 * yes left is on or before it), whatever yes day came with the change
 * (`afterAddressChange`).
 *
 * ## How much one read takes
 *
 * A list read selects seven short fields (no notes, no "how"): `rowsFor(7)`
 * rows a call, at most about 180 KiB with the longest names and addresses,
 * read on only when a call came back full: `CONTACTS_MOST` contacts in at
 * most 9 calls. Calls one after another: list 1-9, get 1, add 2, add from an
 * enquiry 4, change 3, stop 3, remove 1.
 */

import { afterAddressChange, emailOf, iysAfterStop, phoneOf } from '../plan/contacts.js';
import { getLocale } from '../i18n/index.js';
import { isCivilDay, todayCivil } from '../plan/days.js';
import { LIMITS, readWords } from '../plan/limits.js';

import { getEnquiryFor, recordId } from './customers.js';
import { DataError, modelAction } from './index.js';
import { readInPages, rowsFor } from './read-in-pages.js';

export { EMAIL_MOST, emailOf, phoneOf } from '../plan/contacts.js';

/** The most contacts one person keeps (the page lists them all). */
export const CONTACTS_MOST = 2000;
/** The most letters "how they said yes" holds. */
export const CONSENT_HOW_MOST = 200;

export const CONTACT_REFUSALS = Object.freeze({
  name: 'refuse.contacts.name',
  phone: 'refuse.contacts.phone',
  email: 'refuse.contacts.email',
  day: 'refuse.contacts.day',
  iys: 'refuse.contacts.iys',
  how: 'refuse.contacts.how',
  notes: 'refuse.contacts.notes',
  full: 'refuse.contacts.full',
});

/** The channels a contact says yes to, and each one's yes day. */
const CONSENT_FIELDS = Object.freeze({ whatsapp: 'whatsappConsentOn', email: 'emailConsentOn' });
const DAY_FIELDS = Object.freeze(['whatsappConsentOn', 'emailConsentOn', 'iysOn']);

/** The fields a list shows (`rowsFor(7)` rows a call). */
const SUMMARY_SELECT = Object.freeze(Object.fromEntries(['id', 'name', 'phone', 'email', 'whatsappConsentOn', 'emailConsentOn', 'iysOn']
  .map((field) => [field, true])));
/** Every field of one contact. */
const FULL_SELECT = Object.freeze({ ...SUMMARY_SELECT, consentHow: true, notes: true, createdAt: true, updatedAt: true });

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** Words through `readWords`, with this area's refusal key. */
function words(value, max, key, options) {
  const read = readWords(value, max, options);
  if (!read.ok) throw new DataError(key);
  return read.value;
}

/** @param {Record<string, unknown>} input @param {string} name */
const sent = (input, name) => Object.hasOwn(input, name) && input[name] !== undefined;

/** A day field: null for none, else a civil day not after `today`. */
function dayOf(value, today) {
  if (value === undefined || value === null || value === '') return null;
  if (!isCivilDay(value) || /** @type {string} */ (value) > today) throw new DataError(CONTACT_REFUSALS.day);
  return /** @type {string} */ (value);
}

/**
 * The fields a contact form sent, checked. A new contact needs a name; a
 * change reads only the fields it was sent.
 *
 * @param {Record<string, unknown>} input
 * @param {{ partial: boolean, today: string, locale: string }} options
 */
export function readContactFields(input, { partial, today, locale }) {
  const source = input !== null && typeof input === 'object' ? input : {};
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (!partial || sent(source, 'name')) fields.name = words(source.name, LIMITS.name, CONTACT_REFUSALS.name, { required: true });
  if (!partial || sent(source, 'phone')) {
    const phone = phoneOf(source.phone, locale);
    if (phone === null) throw new DataError(CONTACT_REFUSALS.phone);
    fields.phone = phone;
  }
  if (!partial || sent(source, 'email')) {
    const email = emailOf(source.email);
    if (email === null) throw new DataError(CONTACT_REFUSALS.email);
    fields.email = email;
  }
  for (const name of DAY_FIELDS) {
    if (!partial || sent(source, name)) fields[name] = dayOf(source[name], today);
  }
  if (!partial || sent(source, 'consentHow')) fields.consentHow = words(source.consentHow, CONSENT_HOW_MOST, CONTACT_REFUSALS.how);
  if (!partial || sent(source, 'notes')) fields.notes = words(source.notes, LIMITS.notes, CONTACT_REFUSALS.notes, { multiline: true });
  return fields;
}

/**
 * Refuses an İYS day with no yes day on or before it: a contact's İYS day
 * records when a yes went into İYS, so it never comes before every yes.
 *
 * @param {{ whatsappConsentOn: string | null, emailConsentOn: string | null, iysOn: string | null }} contact
 */
function checkIys(contact) {
  if (contact.iysOn === null) return;
  const yeses = [contact.whatsappConsentOn, contact.emailConsentOn].filter((day) => day !== null);
  if (!yeses.some((day) => day <= /** @type {string} */ (contact.iysOn))) throw new DataError(CONTACT_REFUSALS.iys);
}

/** A stored day, or null (also for a field kept before it existed). @param {unknown} value */
function storedDay(value) {
  return typeof value === 'string' && isCivilDay(value) ? value : null;
}

/**
 * @typedef {{ id: number, name: string, phone: string, email: string, whatsappConsentOn: string | null,
 *   emailConsentOn: string | null, iysOn: string | null }} ContactSummary
 * @typedef {ContactSummary & { consentHow: string, notes: string, createdAt: string, updatedAt: string }} Contact
 */

/** @returns {ContactSummary} */
function summaryOf(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    phone: typeof row.phone === 'string' ? row.phone : '',
    email: typeof row.email === 'string' ? row.email : '',
    whatsappConsentOn: storedDay(row.whatsappConsentOn),
    emailConsentOn: storedDay(row.emailConsentOn),
    iysOn: storedDay(row.iysOn),
  };
}

/** @returns {Contact} */
function contactOf(row) {
  return {
    ...summaryOf(row),
    consentHow: typeof row.consentHow === 'string' ? row.consentHow : '',
    notes: typeof row.notes === 'string' ? row.notes : '',
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/** The options every save takes: the day a yes may be at most, the language a phone number is read in, the clock. */
function optionsOf(options) {
  return {
    today: typeof options?.today === 'string' && isCivilDay(options.today) ? options.today : todayCivil(),
    locale: options?.locale === 'tr' || options?.locale === 'en' ? options.locale : getLocale(),
    at: (options?.now?.() ?? new Date()).toISOString(),
  };
}

/**
 * The owner's contacts by name (then by when they were added): at most
 * `CONTACTS_MOST`, the fields a list shows. At most 9 calls, one after
 * another.
 *
 * @param {unknown} ownerId
 * @returns {Promise<ContactSummary[]>}
 */
export async function listContactsFor(ownerId) {
  const owner = ownerOf(ownerId);
  const rows = await readInPages('Contact', {
    where: { ownerId: owner },
    order: [['name', 'asc'], ['id', 'asc']],
    select: { ...SUMMARY_SELECT },
    most: CONTACTS_MOST,
    page: rowsFor(Object.keys(SUMMARY_SELECT).length),
  });
  return rows.map(summaryOf);
}

/**
 * One contact with every field; null when this owner has none with that id.
 * One call.
 *
 * @returns {Promise<Contact | null>}
 */
export async function getContactFor(ownerId, contactId) {
  const owner = ownerOf(ownerId);
  const id = recordId(contactId);
  if (id === null) return null;
  const found = await modelAction('Contact', 'findFirst', { where: { id, ownerId: owner }, select: { ...FULL_SELECT } });
  return found ? contactOf(found) : null;
}

/** Refuses a new contact past `CONTACTS_MOST`. One call. */
async function requireRoom(owner) {
  const count = await modelAction('Contact', 'count', { where: { ownerId: owner } });
  if (Number(count) >= CONTACTS_MOST) throw new DataError(CONTACT_REFUSALS.full);
}

/**
 * Adds a contact. Two calls.
 *
 * @param {unknown} ownerId
 * @param {Record<string, unknown>} input
 * @param {{ today?: string, locale?: string, now?: () => Date }} [options]
 * @returns {Promise<Contact>}
 */
export async function addContactFor(ownerId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const { today, locale, at } = optionsOf(options);
  const fields = readContactFields(input, { partial: false, today, locale });
  checkIys(/** @type {any} */ (fields));
  await requireRoom(owner);
  const created = await modelAction('Contact', 'create', { data: { ...fields, ownerId: owner, createdAt: at, updatedAt: at }, select: { ...FULL_SELECT } });
  return contactOf(created);
}

/**
 * Changes the fields sent; null when this owner has no such contact. A
 * changed number or address drops that channel's kept yes
 * (`afterAddressChange`). When a day was sent or a yes dropped, the İYS day
 * is checked against the yes days as they will be. Three calls.
 *
 * @param {unknown} ownerId
 * @param {unknown} contactId
 * @param {Record<string, unknown>} input
 * @param {{ today?: string, locale?: string, now?: () => Date }} [options]
 * @returns {Promise<Contact | null>}
 */
export async function updateContactFor(ownerId, contactId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const id = recordId(contactId);
  if (id === null) return null;
  const { today, locale, at } = optionsOf(options);
  const fields = readContactFields(input, { partial: true, today, locale });
  const before = await getContactFor(owner, id);
  if (before === null) return null;
  const after = afterAddressChange(before, { ...before, ...fields });
  if (after.dropped.length > 0) {
    fields.whatsappConsentOn = after.whatsappConsentOn;
    fields.emailConsentOn = after.emailConsentOn;
    fields.iysOn = after.iysOn;
  }
  if (DAY_FIELDS.some((name) => Object.hasOwn(fields, name))) checkIys({ ...before, ...fields });
  const changed = await modelAction('Contact', 'updateMany', { where: { id, ownerId: owner }, data: { ...fields, updatedAt: at } });
  if (Number(changed?.count ?? 0) < 1) return null;
  return getContactFor(owner, id);
}

/**
 * "They said stop" on one channel: clears that channel's yes day, and the
 * İYS day unless it still covers the other channel's yes (on or after it).
 * Answers the contact as it is now, or null when this owner has no such
 * contact. Refused (`refuse.request`) for a channel that is not one. Three
 * calls.
 *
 * @param {unknown} ownerId
 * @param {unknown} contactId
 * @param {unknown} channel `whatsapp` or `email`
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<Contact | null>}
 */
export async function stopConsentFor(ownerId, contactId, channel, options = {}) {
  const owner = ownerOf(ownerId);
  if (typeof channel !== 'string' || !Object.hasOwn(CONSENT_FIELDS, channel)) throw new DataError('refuse.request');
  const id = recordId(contactId);
  if (id === null) return null;
  const before = await getContactFor(owner, id);
  if (before === null) return null;
  const iysOn = iysAfterStop(before, /** @type {'whatsapp' | 'email'} */ (channel));
  const at = (options.now?.() ?? new Date()).toISOString();
  const changed = await modelAction('Contact', 'updateMany', {
    where: { id, ownerId: owner },
    data: { [CONSENT_FIELDS[channel]]: null, iysOn, updatedAt: at },
  });
  if (Number(changed?.count ?? 0) < 1) return null;
  return getContactFor(owner, id);
}

/** @returns {Promise<boolean>} whether anything was removed. One call. */
export async function removeContactFor(ownerId, contactId) {
  const owner = ownerOf(ownerId);
  const id = recordId(contactId);
  if (id === null) return false;
  const removed = await modelAction('Contact', 'deleteMany', { where: { id, ownerId: owner } });
  return Number(removed?.count ?? 0) > 0;
}

/**
 * A new contact from a person who came (an enquiry): their name, and their
 * contact as a phone number or an email address when it reads as one (else
 * it goes into the notes, as written). No yes is copied: a person who asked
 * a question has not said yes to marketing messages. When the owner already
 * keeps a contact with that number or address, that one is answered
 * (`existed: true`) and nothing is added. Null when this owner has no such
 * enquiry. At most four calls.
 *
 * @param {unknown} ownerId
 * @param {unknown} enquiryId
 * @param {{ locale?: string, now?: () => Date }} [options]
 * @returns {Promise<{ contact: Contact, existed: boolean } | null>}
 */
export async function addFromEnquiryFor(ownerId, enquiryId, options = {}) {
  const owner = ownerOf(ownerId);
  const { locale, at } = optionsOf(options);
  const enquiry = await getEnquiryFor(owner, enquiryId);
  if (enquiry === null) return null;
  const written = enquiry.contact.trim();
  const email = written.includes('@') ? emailOf(written) : null;
  const phone = email === null ? phoneOf(written, locale) : null;
  const fields = {
    name: words(enquiry.name, LIMITS.name, CONTACT_REFUSALS.name, { required: true }),
    phone: phone ?? '',
    email: email ?? '',
    notes: email === null && phone === null ? words(written, LIMITS.notes, CONTACT_REFUSALS.notes, { multiline: true }) : '',
  };
  const same = [fields.phone !== '' ? { phone: fields.phone } : null, fields.email !== '' ? { email: fields.email } : null].filter(Boolean);
  if (same.length > 0) {
    const found = await modelAction('Contact', 'findFirst', { where: { ownerId: owner, OR: same }, orderBy: [{ id: 'asc' }], select: { ...FULL_SELECT } });
    if (found) return { contact: contactOf(found), existed: true };
  }
  await requireRoom(owner);
  const created = await modelAction('Contact', 'create', { data: { ...fields, ownerId: owner, createdAt: at, updatedAt: at }, select: { ...FULL_SELECT } });
  return { contact: contactOf(created), existed: false };
}
