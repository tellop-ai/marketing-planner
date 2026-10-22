import { getProfileFor, listOwnDaysFor, listThemesFor, PLAN_REFUSALS, saveProfileFor, SHOW_DAYS } from '../../../lib/data/plan.js';
import { LIMITS, readLink, readWords } from '../../../lib/plan/limits.js';
import { formatNetworkList } from '../../../lib/plan/networks.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { failed, json, refused, REFUSED } from '../../../lib/plan/reply.js';
import { readJsonBody } from '../../../lib/plan/request.js';
import { BUILT_IN_DAYS } from '../../../lib/plan/special-days.js';

/**
 * My plan: `GET` reads the profile (or its defaults), the themes in use and
 * the person's own special days, and saves nothing (rule 4a). `PUT` saves any
 * of the profile's fields; a refusal names the field it is about. My plan
 * sends one field at a time as the person changes it. A brand colour is ''
 * (none) or `#` and six hex digits in either case, kept in lowercase;
 * `logoOnPictures` and `trackLinks` are true or false. The logo is kept
 * through `./logo/route.js` (rule 6c); the first-visit start is
 * `./start/route.js`.
 */
export const dynamic = 'force-dynamic';

/** Words fields: the most characters each takes, and whether it keeps line breaks. */
const WORD_FIELDS = Object.freeze({
  businessName: { max: LIMITS.profileField, multiline: false },
  offer: { max: LIMITS.profileField, multiline: true },
  audience: { max: LIMITS.profileField, multiline: true },
  goal: { max: LIMITS.profileField, multiline: true },
  voice: { max: LIMITS.profileField, multiline: true },
  pictureStyle: { max: LIMITS.pictureStyle, multiline: false },
});

/** A brand colour as a person may send it: `#` and six hex digits, either case. */
const SENT_COLOUR = /^#[0-9a-f]{6}$/iu;

/** @param {string} problem @param {string} field */
function refusedField(problem, field) {
  return json({ problem, field }, 400);
}

/**
 * The built-in special-day keys a person may hide, as a stored comma list, or null.
 *
 * @param {unknown} value
 */
function readHiddenDays(value) {
  if (!Array.isArray(value)) return null;
  const known = new Set(BUILT_IN_DAYS.map((day) => day.key));
  if (value.length > known.size) return null;
  const seen = new Set();
  for (const key of value) {
    if (typeof key !== 'string' || !known.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  return value.join(',');
}

/**
 * Each sent profile field in its stored form, or the first refusal and its field.
 *
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, fields: Record<string, unknown> } | { ok: false, problem: string, field?: string }}
 */
function readProfile(body) {
  const names = Object.keys(body);
  if (names.length === 0) return { ok: false, problem: REFUSED.request };
  /** @type {Record<string, unknown>} */
  const fields = {};
  for (const name of names) {
    const value = body[name];
    if (Object.hasOwn(WORD_FIELDS, name)) {
      const words = readWords(value, WORD_FIELDS[name].max, { multiline: WORD_FIELDS[name].multiline });
      if (!words.ok) return { ok: false, problem: words.problem, field: name };
      fields[name] = words.value;
    } else if (name === 'postsPerWeek') {
      const [least, most] = LIMITS.postsPerWeek;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < least || value > most) {
        return { ok: false, problem: 'refuse.number', field: name };
      }
      fields[name] = value;
    } else if (name === 'networks') {
      const list = formatNetworkList(value);
      if (list === null) return { ok: false, problem: REFUSED.request, field: name };
      fields[name] = list;
    } else if (name === 'profileLink' || name === 'reviewLink') {
      const link = readLink(value);
      if (!link.ok) return { ok: false, problem: link.problem, field: name };
      fields[name] = link.value;
    } else if (name === 'showDays') {
      if (typeof value !== 'string' || !SHOW_DAYS.includes(value)) return { ok: false, problem: REFUSED.request, field: name };
      fields[name] = value;
    } else if (name === 'hiddenDays') {
      const list = readHiddenDays(value);
      if (list === null) return { ok: false, problem: REFUSED.request, field: name };
      fields[name] = list;
    } else if (name === 'brandColour' || name === 'brandColour2') {
      const colour = typeof value === 'string' ? value.trim() : null;
      if (colour === null || (colour !== '' && !SENT_COLOUR.test(colour))) return { ok: false, problem: PLAN_REFUSALS.colour, field: name };
      fields[name] = colour.toLowerCase();
    } else if (name === 'logoOnPictures' || name === 'trackLinks') {
      if (typeof value !== 'boolean') return { ok: false, problem: REFUSED.request, field: name };
      fields[name] = value;
    } else {
      return { ok: false, problem: REFUSED.request };
    }
  }
  return { ok: true, fields };
}

export async function GET() {
  try {
    // Two reads at once at most (Tellop answers 4 records calls at once in one request).
    const [profile, themes] = await Promise.all([getProfileFor(OWNER), listThemesFor(OWNER)]);
    const ownDays = await listOwnDaysFor(OWNER);
    return json({ profile, themes, ownDays });
  } catch (error) {
    return failed(error);
  }
}

/** @param {Request} request */
export async function PUT(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return refused(body.problem);
  const read = readProfile(body.value);
  if (!read.ok) return read.field === undefined ? refused(read.problem) : refusedField(read.problem, read.field);
  try {
    return json({ profile: await saveProfileFor(OWNER, read.fields) });
  } catch (error) {
    return failed(error);
  }
}
