/**
 * Campaign plans and offer codes: the pure rules (no records, no AI call).
 *
 * **Plan the posts** adds dated idea posts across a campaign's days from a
 * fixed pattern for its kind:
 *
 * - launch: teaser, behind the scenes, launch day, how it works, first
 *   customer, last call (each asks the reader to visit);
 * - event: save the date, what to expect, countdown, on the day, thank you
 *   (each asks the reader to book);
 * - sale: announce, best pick, halfway, last day (each asks the reader to buy).
 *
 * The posts go on the days still ahead (today included) from the campaign's
 * first day to its last, one a day, spread evenly in the pattern's order (the
 * first on the first day left, the last on the last day); an event's "on the
 * day" takes its last day and its "thank you" the day after it (the event is
 * over then). With fewer days left than the pattern holds, the posts that
 * matter most for the kind stay (`PRIORITY`): a launch keeps its launch day
 * first, an event its day, a sale its announcement. Which planned days
 * already hold a post, and which are days of remembrance, the records decide
 * (`lib/data/campaigns.js`).
 *
 * Offer codes: a campaign's code is kept in capitals (`lib/data/campaigns.js`);
 * a customer's code matches a campaign's whatever its capitals and dotted or
 * dotless i (`codeKey`).
 */

import { cleanName, CONTENT_RULE, contentBlock, languageName, parseAnswer } from './ai-words.js';
import { addDays, isCivilDay, partsOf } from './days.js';
import { BYTES_A_LETTER, LIMITS, wireBytes } from './limits.js';

/** The kinds of campaign plan. */
export const PLAN_KINDS = Object.freeze(['launch', 'event', 'sale']);

/** The posts of each kind, in their order. */
export const PATTERNS = Object.freeze({
  launch: Object.freeze(['teaser', 'behindTheScenes', 'launchDay', 'howItWorks', 'firstCustomer', 'lastCall']),
  event: Object.freeze(['saveTheDate', 'whatToExpect', 'countdown', 'onTheDay', 'thankYou']),
  sale: Object.freeze(['announce', 'bestPick', 'halfway', 'lastDay']),
});

/** Which posts stay first when the campaign has fewer days left than the pattern holds. */
export const PRIORITY = Object.freeze({
  launch: Object.freeze(['launchDay', 'teaser', 'lastCall', 'howItWorks', 'behindTheScenes', 'firstCustomer']),
  event: Object.freeze(['onTheDay', 'saveTheDate', 'thankYou', 'countdown', 'whatToExpect']),
  sale: Object.freeze(['announce', 'lastDay', 'bestPick', 'halfway']),
});

/** The post that takes a campaign's last day (an event: the day itself). */
const ON_LAST_DAY = Object.freeze({ launch: null, event: 'onTheDay', sale: null });
/** The post that takes the day after a campaign's last day (an event: the thanks). */
const DAY_AFTER = Object.freeze({ launch: null, event: 'thankYou', sale: null });

/** The ask each kind's posts carry (`lib/plan/asks.js`). */
export const PLAN_ASKS = Object.freeze({ launch: 'visit', event: 'book', sale: 'buy' });

/** The most posts one plan adds. */
export const PLAN_MOST = 12;

/** @param {unknown} kind @returns {kind is 'launch' | 'event' | 'sale'} */
export function isPlanKind(kind) {
  return typeof kind === 'string' && PLAN_KINDS.includes(kind);
}

/** Days from `from` to `to` (both civil days), `to` not counted: 0 for the same day. */
function daysFrom(from, to) {
  const a = partsOf(from);
  const b = partsOf(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** `count` places spread evenly over `0..last` in order (the first at 0, the last at `last`); `last >= count - 1`. */
function spread(count, last) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => Math.round((index * last) / (count - 1)));
}

/**
 * The posts a plan of `kind` puts on a campaign, `[{ key, day }]` in the
 * pattern's order, one a day, on the days from the later of its first day
 * and `today` to its last; an event's thanks goes on the day after its last
 * day. None when no day is left (or the days do not read).
 *
 * @param {{ kind: string, startsOn: string, endsOn: string, today: string }} input
 * @returns {Array<{ key: string, day: string }>}
 */
export function planSlots({ kind, startsOn, endsOn, today }) {
  if (!isPlanKind(kind) || !isCivilDay(startsOn) || !isCivilDay(endsOn) || !isCivilDay(today)) return [];
  const from = startsOn > today ? startsOn : today;
  if (from > endsOn) return [];
  const days = daysFrom(from, endsOn) + 1;
  const last = ON_LAST_DAY[kind];
  const after = DAY_AFTER[kind];
  // The days the spread posts share: every day left, but the last when a post of its own takes it.
  const room = days - (last === null ? 0 : 1);
  /** @type {Set<string>} */
  const kept = new Set();
  let spreadKept = 0;
  for (const key of PRIORITY[kind]) {
    if (kept.size >= PLAN_MOST) break;
    if (key === last || key === after) kept.add(key);
    else if (spreadKept < room) {
      kept.add(key);
      spreadKept += 1;
    }
  }
  const chosen = PATTERNS[kind].filter((key) => kept.has(key));
  const head = chosen.filter((key) => key !== last && key !== after);
  const places = spread(head.length, room - 1);
  /** @type {Map<string, number>} */
  const at = new Map(head.map((key, index) => [key, places[index]]));
  if (last !== null && kept.has(last)) at.set(last, days - 1);
  if (after !== null && kept.has(after)) at.set(after, days);
  return chosen.map((key) => ({ key, day: addDays(from, /** @type {number} */ (at.get(key))) }));
}

/** The words key of a plan post's fixed name. @param {string} kind @param {string} key */
export function planNameKey(kind, key) {
  return `campaign.plan.post.${kind}.${key}`;
}

/**
 * Whether a post's name fits what a post's name may hold: at most
 * `LIMITS.name` characters and `BYTES_A_LETTER` x that many bytes (as
 * `readWords` refuses it: a name of emoji can pass its characters but not its
 * bytes).
 *
 * @param {string} name
 */
export function nameFits(name) {
  return Array.from(name).length <= LIMITS.name && wireBytes(name) <= BYTES_A_LETTER * LIMITS.name;
}

/**
 * A plan post's fixed name: its words with the campaign's name. When that
 * would not fit (`nameFits`: too many characters, or too many bytes from
 * emoji), the campaign's name is cut at a whole character (at a word end when
 * one is past its middle) so the post's own words stay whole; when not even
 * one character of the campaign's name fits, the kind's own name
 * (`campaign.plan.kind.<kind>`) without the campaign's. So keeping the plan
 * never refuses a name.
 *
 * @param {string} kind
 * @param {string} key
 * @param {string} campaignName
 * @param {(key: string, values: Record<string, string>) => string} translate
 */
export function planPostName(kind, key, campaignName, translate) {
  const campaign = String(campaignName ?? '').replace(/\s+/gu, ' ').trim();
  const nameWith = (part) => translate(planNameKey(kind, key), { name: part }).replace(/\s+/gu, ' ').trim();
  const whole = nameWith(campaign);
  if (nameFits(whole)) return whole;
  // The most characters of the campaign's name that fit (more characters never fit better).
  const letters = Array.from(campaign);
  let low = 0;
  let high = letters.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (nameFits(nameWith(letters.slice(0, middle).join('')))) low = middle;
    else high = middle - 1;
  }
  const cut = letters.slice(0, low).join('');
  const space = cut.search(/\s\S*$/u);
  const part = (space > cut.length / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:\-–—]+$/u, '');
  if (part !== '' && nameFits(nameWith(part))) return nameWith(part);
  return translate(`campaign.plan.kind.${kind}`, {}).trim();
}

/** What each kind's posts are for, as the AI reads it. */
const KIND_WORDS = Object.freeze({
  launch: 'the launch of something new',
  event: 'an event',
  sale: 'a sale',
});

/**
 * The request that asks AI to name a plan's posts in the business's voice
 * (`quick`): the business, the campaign and the fixed names travel inside the
 * content block (`contentBlock`), so nothing the person wrote reads as an
 * instruction.
 *
 * @param {{ kind: string, campaign: { name: string, goal?: string, offer?: string }, names: string[], business?: Record<string, unknown>,
 *   locale?: string }} input
 */
export function planNamesMessages({ kind, campaign, names, business = {}, locale = 'en' }) {
  const content = {
    business,
    campaign: { name: campaign.name, ...(campaign.goal ? { goal: campaign.goal } : {}), ...(campaign.offer ? { offer: campaign.offer } : {}) },
    names,
  };
  const system = [
    `You name the posts a small business plans for ${KIND_WORDS[kind] ?? 'a campaign'} on social media. Write in ${languageName(locale)}.`,
    CONTENT_RULE,
    `The person's content holds the planned posts' names in order ("names"). Rewrite each name in the business's voice, for this campaign ("campaign"): keep what each post is for and its place in the order, keep the facts as written, invent no price, date or discount. Each name is short: at most ${LIMITS.name} characters, plain words, no hashtags, no emoji, no numbering, no quotes.`,
    `Answer only with a JSON object and nothing else: {"names": ["name"]}, with exactly ${names.length} names in the same order.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Name the posts for this content.\n${contentBlock(content)}` },
  ];
}

/**
 * The names an answer holds, as many as asked, each cleaned (`cleanName`): a
 * name that cleans to '', or that would not fit a post's name (`nameFits`),
 * keeps its fixed name (`fixed[index]`). Null when the answer does not read
 * as `{ names: [...] }` with exactly that many names.
 *
 * @param {unknown} text the answer
 * @param {string[]} fixed
 * @returns {string[] | null}
 */
export function readPlanNames(text, fixed) {
  const value = parseAnswer(text);
  if (value === null || !Array.isArray(value.names) || value.names.length !== fixed.length) return null;
  return value.names.map((name, index) => {
    const clean = cleanName(name);
    return clean !== '' && nameFits(clean) ? clean : fixed[index];
  });
}

/**
 * A code as two codes are matched: trimmed, in capitals, with the dotted and
 * the dotless i alike (`kış20`, `KIŞ20` and `KİŞ20` match); '' for none.
 *
 * @param {unknown} code
 */
export function codeKey(code) {
  if (typeof code !== 'string') return '';
  return code.trim().normalize('NFC').toUpperCase().replace(/İ/gu, 'I').normalize('NFC');
}
