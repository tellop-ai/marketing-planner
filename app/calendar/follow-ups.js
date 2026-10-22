/**
 * The follow-ups on the calendar's Today card, pure: which
 * contact WhatsApp can open, the short follow-up line the press copies, and
 * the days Done and Tomorrow send. The browser loads it too; nothing here
 * reaches the records or the network.
 */

import { t } from '../../lib/i18n/index.js';
import { addDays } from '../../lib/plan/days.js';
import { whatsAppAddress, whatsAppDigits } from '../../lib/plan/whatsapp.js';

export { whatsAppAddress, whatsAppDigits };

/** How many follow-ups the card shows before "Show all". */
export const FOLLOW_UPS_SHOWN = 3;

/** The most people the card lists (as `lib/data/customers.js` `FOLLOW_UPS_MOST`; a check holds them equal). */
export const FOLLOW_UPS_LISTED = 20;

/**
 * The people the card lists and whether more are due: the read answers one
 * past the most when there are more, and the card then says the rest are in
 * Customers.
 *
 * @template T
 * @param {T[] | null | undefined} followUps
 * @returns {{ people: T[], more: boolean }}
 */
export function listedFollowUps(followUps) {
  const list = Array.isArray(followUps) ? followUps : [];
  return { people: list.slice(0, FOLLOW_UPS_LISTED), more: list.length > FOLLOW_UPS_LISTED };
}

/**
 * The short line a follow-up press copies: hello by name, what they asked
 * about (when the person noted it), an offer to help, and the business's name
 * under it (when My plan has one).
 *
 * @param {{ name: string, askedAbout?: string }} followUp
 * @param {string} business
 * @param {string} locale
 */
export function followUpMessage({ name, askedAbout = '' }, business, locale) {
  const asked = String(askedAbout ?? '').trim();
  const values = { name: String(name ?? '').trim(), asked, business: String(business ?? '').trim() };
  return t(asked === '' ? 'calendar.followUp.messagePlain' : 'calendar.followUp.message', locale, values).trim();
}

/**
 * What a follow-up's presses send to `PATCH /api/enquiries/[id]`: Done clears
 * the day, Tomorrow moves it to the day after today (an overdue one too, so
 * it is never still due tomorrow morning by mistake).
 *
 * @param {'done' | 'tomorrow'} press
 * @param {string} today
 * @returns {{ followUpOn: string | null }}
 */
export function followUpChange(press, today) {
  return { followUpOn: press === 'tomorrow' ? addDays(today, 1) : null };
}

/**
 * Whether an enquiry's follow-up is due on `today`: a day on or before
 * today, and the person is still new or talking (as the Today card lists
 * them).
 *
 * @param {{ followUpOn?: string | null, status?: string }} enquiry
 * @param {string} today
 */
export function isFollowUpDue(enquiry, today) {
  const day = enquiry?.followUpOn;
  return typeof day === 'string' && day !== '' && day <= today && (enquiry.status === 'new' || enquiry.status === 'talking');
}
