/**
 * WhatsApp addresses for one person: the number the app can be sure of, and
 * WhatsApp's own address with a message ready. Pure; used by the calendar's
 * follow-ups and the Contacts page (the app never sends: the person presses
 * send in WhatsApp).
 */

/** The fewest and the most digits of a whole phone number with its country code (E.164 allows 15). */
const DIGITS_FEWEST = 8;
const DIGITS_MOST = 15;

/** What a person types between a phone number's digits: spaces, dashes, dots, brackets, slashes. */
const SPACING = /[\s\-.()/ ]/gu;

/**
 * The digits WhatsApp's address takes for a contact (country code first, no
 * plus, no leading zero), or null when the contact is not a phone number the
 * app can be sure of:
 *
 * - `+<digits>` or `00<digits>`: the whole number with its country code;
 * - in Turkish only, a Turkish mobile number written the national way
 *   (`0532 123 45 67` or `532 123 45 67`) gets Turkey's code (90);
 * - anything else (an email address, a name on a platform, a number written
 *   without its country code in English) is not a phone contact: the press
 *   then copies the line only, so WhatsApp never opens a chat with the wrong
 *   person.
 *
 * @param {unknown} contact
 * @param {string} locale
 * @returns {string | null}
 */
export function whatsAppDigits(contact, locale) {
  if (typeof contact !== 'string') return null;
  const written = contact.trim().replace(SPACING, '');
  let digits = null;
  if (/^\+\d+$/u.test(written)) digits = written.slice(1);
  else if (/^00\d+$/u.test(written)) digits = written.slice(2);
  else if (locale === 'tr' && /^0?5\d{9}$/u.test(written)) digits = `90${written.slice(-10)}`;
  if (digits === null || digits.startsWith('0')) return null;
  return digits.length >= DIGITS_FEWEST && digits.length <= DIGITS_MOST ? digits : null;
}

/**
 * WhatsApp's own address for one number with the line ready to send; the
 * person presses send in WhatsApp (the app sends nothing).
 *
 * @param {string} digits from `whatsAppDigits`
 * @param {string} message
 */
export function whatsAppAddress(digits, message) {
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
