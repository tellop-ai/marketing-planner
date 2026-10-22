/**
 * My plan's records: the business profile (one per owner), the themes (at most
 * `LIMITS.themes` in use) and the person's own special days.
 *
 * Every read, save and delete names its owner inside the statement's `where`
 * (`AGENTS.md` rules 1 and 1a). A read never creates a row (rule 4a): with no
 * profile saved, `getProfileFor` answers the defaults and writes nothing.
 * Values leave this file as plain objects. A route checks what the person sent
 * (`lib/plan/limits.js`) before it calls a save here; a refusal that only the
 * records can decide (the theme limit) is a `DataError` whose `messageKey` the
 * page shows.
 *
 * ## How much one read takes
 *
 * Inside Tellop a records call answers at most 256 rows a statement and
 * 256 KiB, a statement's answer holds at most 2,048 values (a row counts its
 * fields and two more), and a request makes at most 16 calls. A theme can
 * hold about 7 KB of words (two bytes a letter), so the themes are read
 * `THEME_PAGE` a call (about 220 KiB), on after the last theme read only when
 * a call came back full: at most `MOST_THEMES / THEME_PAGE` (3) calls, and one
 * while the person has fewer than `THEME_PAGE` themes. The own days (at most
 * `MAX_OWN_DAYS`, about 225 KiB) are one call, the profile one. So `planFor`
 * makes at most 4 calls, My plan's page 5 and `GET /api/plan` 3. The
 * first-visit start (`startPlanFor`) makes 3 and `hasPostsFor` 1.
 */

import { BRAND_SELECT, brandCopySteps, brandOnPictures } from './brand-copies.js';
import { DataError, modelAction, modelBatch } from './index.js';
import { readInPages } from './read-in-pages.js';
import { LIMITS, readWords } from '../plan/limits.js';
import { parseNetworkList } from '../plan/networks.js';

/** Theme colours are `chart-1`..`chart-5`, stored as 0..4. */
export const THEME_COLOURS = 5;

/** Which built-in special days a person sees: Turkey's, the worldwide ones, or both. */
export const SHOW_DAYS = Object.freeze(['tr', 'world', 'both']);

/** The most own special days one person keeps. */
export const MAX_OWN_DAYS = 100;

/** Refusal keys this file answers through `DataError`. */
export const PLAN_REFUSALS = Object.freeze({
  themeLimit: 'refuse.plan.themeLimit',
  daysLimit: 'refuse.plan.daysLimit',
  oldThemesFull: 'refuse.plan.oldThemesFull',
  colour: 'refuse.plan.colour',
  started: 'refuse.plan.started',
});

/** A brand colour as stored: `#` and six lowercase hex digits (none is ''). */
export const BRAND_COLOUR = /^#[0-9a-f]{6}$/u;

/**
 * What a person who saved nothing yet has (the stored defaults of `Profile`).
 * The brand and link fields came later and are optional in the records: a
 * row saved before them holds null, which reads as these defaults (no brand
 * colours, no logo on pictures, tracking on).
 */
export const PROFILE_DEFAULTS = Object.freeze({
  businessName: '',
  offer: '',
  audience: '',
  goal: '',
  voice: '',
  pictureStyle: '',
  postsPerWeek: 3,
  networks: '',
  profileLink: '',
  reviewLink: '',
  showDays: 'both',
  hiddenDays: '',
  brandColour: '',
  brandColour2: '',
  logoOnPictures: false,
  trackLinks: true,
});

const PROFILE_FIELDS = Object.freeze(Object.keys(PROFILE_DEFAULTS));
const THEME_FIELDS = Object.freeze(['name', 'about', 'hashtags', 'colour', 'sells']);
const OWN_DAY_FIELDS = Object.freeze(['name', 'date', 'yearly', 'note']);
/** Themes one records call takes. */
const THEME_PAGE = 32;
/** Most themes one read answers, those in use and the archived ones together; 3 calls. */
export const MOST_THEMES = 3 * THEME_PAGE;
/**
 * Most archived themes an owner keeps: with `LIMITS.themes` in use, the
 * themes in all never pass `MOST_THEMES`, so every old post keeps its colour.
 */
export const MOST_ARCHIVED_THEMES = MOST_THEMES - LIMITS.themes;
/** Every field a theme's summary reads (not the owner, which every read names). */
const THEME_SELECT = Object.freeze(Object.fromEntries(['id', 'name', 'about', 'colour', 'position', 'hashtags', 'archived', 'sells',
  'createdAt', 'updatedAt'].map((field) => [field, true])));
/** Every field an own day's summary reads. */
const OWN_DAY_SELECT = Object.freeze({ id: true, name: true, date: true, yearly: true, note: true, createdAt: true });
const DIGEST = /^[0-9a-f]{64}$/u;
const YEARLY_DATE = /^(\d{2})-(\d{2})$/u;
const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** @param {unknown} owner */
function ownerOf(owner) {
  if (typeof owner !== 'string' || owner.trim().length === 0) throw new DataError('error.ownerMissing');
  return owner;
}

/** @param {unknown} id */
function idOf(id) {
  const value = Number(id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** @param {{ now?: () => Date }} [options] */
function instantOf(options = {}) {
  return (options.now?.() ?? new Date()).toISOString();
}

/**
 * The first 12 characters of a kept file's digest: enough to change a
 * picture's address when the picture changes, never the digest itself.
 *
 * @param {unknown} digest
 */
export function fileTag(digest) {
  return typeof digest === 'string' && DIGEST.test(digest) ? digest.slice(0, 12) : null;
}

/**
 * A stored comma list of special-day keys as a list, in order, with no repeats.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseDayList(value) {
  if (typeof value !== 'string') return [];
  const keys = [];
  for (const part of value.split(',')) {
    const key = part.trim();
    if (key !== '' && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** @param {Record<string, unknown> | null | undefined} row */
function profileOf(row) {
  if (row === null || row === undefined) {
    return { ...PROFILE_DEFAULTS, logo: null, saved: false, createdAt: null, updatedAt: null };
  }
  return {
    businessName: String(row.businessName ?? ''),
    offer: String(row.offer ?? ''),
    audience: String(row.audience ?? ''),
    goal: String(row.goal ?? ''),
    voice: String(row.voice ?? ''),
    pictureStyle: String(row.pictureStyle ?? ''),
    postsPerWeek: Number(row.postsPerWeek ?? PROFILE_DEFAULTS.postsPerWeek),
    networks: String(row.networks ?? ''),
    profileLink: String(row.profileLink ?? ''),
    reviewLink: String(row.reviewLink ?? ''),
    showDays: SHOW_DAYS.includes(String(row.showDays)) ? String(row.showDays) : PROFILE_DEFAULTS.showDays,
    hiddenDays: String(row.hiddenDays ?? ''),
    brandColour: brandColourOf(row.brandColour),
    brandColour2: brandColourOf(row.brandColour2),
    logoOnPictures: row.logoOnPictures === true,
    trackLinks: row.trackLinks !== false,
    logo: fileTag(row.logoFile),
    saved: true,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/** @param {Record<string, unknown>} row */
function themeOf(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    about: String(row.about ?? ''),
    colour: Number(row.colour),
    position: Number(row.position),
    hashtags: String(row.hashtags ?? ''),
    archived: row.archived === true,
    sells: row.sells === true,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

/**
 * A stored brand colour as the pages and the drawing take it: `#rrggbb`, or ''
 * for none (null, from a row saved before brand colours, and anything else).
 *
 * @param {unknown} value
 */
export function brandColourOf(value) {
  return typeof value === 'string' && BRAND_COLOUR.test(value) ? value : '';
}

/** @param {Record<string, unknown>} row */
function ownDayOf(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    date: String(row.date),
    yearly: row.yearly === true,
    note: String(row.note ?? ''),
    createdAt: String(row.createdAt),
  };
}

/**
 * Only the named fields, each of the type its record takes.
 *
 * @param {Record<string, unknown>} fields
 * @param {readonly string[]} names
 * @param {Record<string, 'string' | 'number' | 'boolean'>} types
 */
function pick(fields, names, types) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const name of names) {
    if (!Object.hasOwn(fields ?? {}, name) || fields[name] === undefined) continue;
    const value = fields[name];
    const type = types[name] ?? 'string';
    if (type === 'number' ? !Number.isInteger(value) : typeof value !== type) throw new DataError('refuse.request');
    picked[name] = value;
  }
  return picked;
}

const PROFILE_TYPES = Object.freeze({ postsPerWeek: 'number', logoOnPictures: 'boolean', trackLinks: 'boolean' });
const THEME_TYPES = Object.freeze({ colour: 'number', sells: 'boolean' });
const OWN_DAY_TYPES = Object.freeze({ yearly: 'boolean' });

/**
 * The profile, or the defaults when none is saved. Never creates a row.
 *
 * @param {unknown} owner
 */
export async function getProfileFor(owner) {
  const ownerId = ownerOf(owner);
  return profileOf(await modelAction('Profile', 'findUnique', { where: { ownerId } }));
}

/**
 * Saves the named profile fields (stored forms: `networks` and `hiddenDays`
 * as comma lists; a brand colour '' or `#rrggbb`, anything else refused with
 * `refuse.plan.colour`); the first save creates the row with the defaults
 * beside them. A save that changes how the pictures look (a brand colour, or
 * whether they carry the logo) also clears, in the same batch, the kept
 * copies drawn in the old look (`brandCopySteps`): one more call first, to
 * read the brand as it was.
 *
 * @param {unknown} owner
 * @param {Partial<typeof PROFILE_DEFAULTS>} fields
 * @param {{ now?: () => Date }} [options]
 */
export async function saveProfileFor(owner, fields, options = {}) {
  const ownerId = ownerOf(owner);
  const picked = pick(fields, PROFILE_FIELDS, PROFILE_TYPES);
  for (const name of ['brandColour', 'brandColour2']) {
    if (picked[name] !== undefined && picked[name] !== '' && !BRAND_COLOUR.test(String(picked[name]))) throw new DataError(PLAN_REFUSALS.colour);
  }
  const at = instantOf(options);
  const upsert = {
    where: { ownerId },
    create: { ...PROFILE_DEFAULTS, ...picked, ownerId, createdAt: at, updatedAt: at },
    update: { ...picked, updatedAt: at },
  };
  if (!['brandColour', 'brandColour2', 'logoOnPictures'].some((name) => picked[name] !== undefined)) {
    return profileOf(await modelAction('Profile', 'upsert', upsert));
  }
  return profileOf(await saveWithBrandCopies(ownerId, upsert, picked));
}

/**
 * Saves the profile (`upsert`, changing `fields`) and clears the copies the
 * change makes stale, in one batch, after reading the brand as it was.
 *
 * @param {string} ownerId
 * @param {object} upsert
 * @param {Record<string, unknown>} fields
 */
async function saveWithBrandCopies(ownerId, upsert, fields) {
  const stored = await modelAction('Profile', 'findUnique', { where: { ownerId }, select: BRAND_SELECT });
  const before = brandOnPictures(stored ?? PROFILE_DEFAULTS);
  const after = brandOnPictures({ ...PROFILE_DEFAULTS, ...(stored ?? {}), ...fields });
  const steps = brandCopySteps(ownerId, before, after);
  if (steps.length === 0) return modelAction('Profile', 'upsert', upsert);
  const [row] = await modelBatch([{ model: 'Profile', action: 'upsert', args: upsert }, ...steps]);
  return row;
}

/**
 * The kept logo's digest, or null.
 *
 * @param {unknown} owner
 * @returns {Promise<string | null>}
 */
export async function logoFileFor(owner) {
  const ownerId = ownerOf(owner);
  const row = await modelAction('Profile', 'findUnique', { where: { ownerId }, select: { logoFile: true } });
  return typeof row?.logoFile === 'string' && DIGEST.test(row.logoFile) ? row.logoFile : null;
}

/**
 * Keeps `file` (a digest from `readPicture`) as the logo, or removes it with null.
 *
 * @param {unknown} owner
 * @param {string | null} file
 * @param {{ now?: () => Date }} [options]
 */
export async function saveLogoFor(owner, file, options = {}) {
  const ownerId = ownerOf(owner);
  if (file !== null && (typeof file !== 'string' || !DIGEST.test(file))) throw new DataError('error.fileNotKept');
  const at = instantOf(options);
  const upsert = {
    where: { ownerId },
    create: { ...PROFILE_DEFAULTS, ownerId, logoFile: file, createdAt: at, updatedAt: at },
    update: { logoFile: file, updatedAt: at },
  };
  // The pictures carry the logo while "Logo on pictures" is on: a new logo, or none, clears their copies.
  return profileOf(await saveWithBrandCopies(ownerId, upsert, { logoFile: file }));
}

/**
 * Up to `MOST_THEMES` themes that match `where`, by position then id (with
 * `inUseFirst`, the themes in use first, so the most cuts only archived ones),
 * `THEME_PAGE` a call: each call starts after the last theme the one before
 * read, and is made only when that one came back full. A theme read twice
 * (moved between two calls) is kept once.
 *
 * @param {Record<string, unknown>} where
 * @param {boolean} [inUseFirst]
 */
async function readThemes(where, inUseFirst = false) {
  const rows = await readInPages('Theme', {
    where,
    order: [...(inUseFirst ? [['archived', 'asc']] : []), ['position', 'asc'], ['id', 'asc']],
    select: THEME_SELECT,
    most: MOST_THEMES,
    page: THEME_PAGE,
  });
  return rows.map(themeOf);
}

/** The themes in use, then the archived ones, each by position. @param {string} ownerId */
async function allThemesOf(ownerId) {
  return readThemes({ ownerId }, true);
}

/**
 * The themes in use (or, with `archived: true`, the archived ones), by position.
 *
 * @param {unknown} owner
 * @param {{ archived?: boolean }} [options]
 */
export async function listThemesFor(owner, { archived = false } = {}) {
  const ownerId = ownerOf(owner);
  return readThemes({ ownerId, archived: archived === true });
}

/**
 * Adds a theme last, with the first colour no other theme in use has. Refused
 * (`refuse.plan.themeLimit`) when `LIMITS.themes` are already in use.
 *
 * @param {unknown} owner
 * @param {{ name: string, about?: string, hashtags?: string }} fields
 * @param {{ now?: () => Date }} [options]
 */
export async function addThemeFor(owner, fields, options = {}) {
  const ownerId = ownerOf(owner);
  const picked = pick(fields, ['name', 'about', 'hashtags'], {});
  if (typeof picked.name !== 'string' || picked.name === '') throw new DataError('refuse.text.missing');
  const live = await modelAction('Theme', 'findMany', {
    where: { ownerId, archived: false },
    select: { colour: true, position: true },
    take: MOST_THEMES,
  });
  if (live.length >= LIMITS.themes) throw new DataError(PLAN_REFUSALS.themeLimit);
  const used = new Set(live.map((row) => Number(row.colour)));
  const colour = Array.from({ length: THEME_COLOURS }, (_, index) => index).find((index) => !used.has(index)) ?? 0;
  const position = live.reduce((most, row) => Math.max(most, Number(row.position)), -1) + 1;
  const at = instantOf(options);
  const row = await modelAction('Theme', 'create', {
    data: {
      ownerId,
      name: picked.name,
      about: picked.about ?? '',
      hashtags: picked.hashtags ?? '',
      colour,
      position,
      archived: false,
      createdAt: at,
      updatedAt: at,
    },
  });
  return themeOf(row);
}

/**
 * Changes a theme in use (`name`, `about`, `hashtags`, `colour` 0..4, `sells`:
 * whether its posts ask people to buy); null when the owner has no such theme
 * in use.
 *
 * @param {unknown} owner
 * @param {unknown} id
 * @param {{ name?: string, about?: string, hashtags?: string, colour?: number, sells?: boolean }} fields
 * @param {{ now?: () => Date }} [options]
 */
export async function updateThemeFor(owner, id, fields, options = {}) {
  const ownerId = ownerOf(owner);
  const themeId = idOf(id);
  if (themeId === null) return null;
  const picked = pick(fields, THEME_FIELDS, THEME_TYPES);
  if (picked.colour !== undefined && (picked.colour < 0 || picked.colour >= THEME_COLOURS)) throw new DataError('refuse.request');
  if (picked.name !== undefined && picked.name === '') throw new DataError('refuse.text.missing');
  if (Object.keys(picked).length > 0) {
    const changed = await modelAction('Theme', 'updateMany', {
      where: { id: themeId, ownerId, archived: false },
      data: { ...picked, updatedAt: instantOf(options) },
    });
    if (Number(changed.count) === 0) return null;
  }
  const row = await modelAction('Theme', 'findFirst', { where: { id: themeId, ownerId, archived: false } });
  return row === null ? null : themeOf(row);
}

/**
 * Moves a theme in use one place up or down and numbers every theme in use
 * again from 0, in one group of saves. Answers the themes in their new order,
 * or null when the owner has no such theme in use. A move past either end
 * changes nothing.
 *
 * @param {unknown} owner
 * @param {unknown} id
 * @param {'up' | 'down'} direction
 */
export async function moveThemeFor(owner, id, direction) {
  const ownerId = ownerOf(owner);
  const themeId = idOf(id);
  if (themeId === null) return null;
  if (direction !== 'up' && direction !== 'down') throw new DataError('refuse.request');
  const themes = await listThemesFor(ownerId);
  const at = themes.findIndex((theme) => theme.id === themeId);
  if (at === -1) return null;
  const to = direction === 'up' ? at - 1 : at + 1;
  if (to < 0 || to >= themes.length) return themes;
  const order = [...themes];
  [order[at], order[to]] = [order[to], order[at]];
  const steps = order
    .map((theme, position) => ({ theme, position }))
    .filter(({ theme, position }) => theme.position !== position)
    .map(({ theme, position }) => ({
      model: 'Theme',
      action: 'updateMany',
      args: { where: { id: theme.id, ownerId, archived: false }, data: { position } },
    }));
  if (steps.length > 0) await modelBatch(steps);
  return order.map((theme, position) => ({ ...theme, position }));
}

/**
 * Removes a theme: deleted when no post uses it, else archived (its posts keep
 * it). Archiving is refused (`refuse.plan.oldThemesFull`) when the owner
 * already keeps `MOST_ARCHIVED_THEMES` archived themes. Answers `'deleted'`,
 * `'archived'`, or null when the owner has no such theme. One call reads the
 * theme and both counts; one more archives or deletes it.
 *
 * @param {unknown} owner
 * @param {unknown} id
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<'deleted' | 'archived' | null>}
 */
export async function removeThemeFor(owner, id, options = {}) {
  const ownerId = ownerOf(owner);
  const themeId = idOf(id);
  if (themeId === null) return null;
  const [found, usedCount, archivedCount] = await modelBatch([
    { model: 'Theme', action: 'findFirst', args: { where: { id: themeId, ownerId }, select: { id: true, archived: true } } },
    { model: 'Post', action: 'count', args: { where: { ownerId, themeId } } },
    { model: 'Theme', action: 'count', args: { where: { ownerId, archived: true } } },
  ]);
  if (found === null || found === undefined) return null;
  const used = Number(usedCount);
  if (used > 0) {
    if (found.archived !== true) {
      if (Number(archivedCount) >= MOST_ARCHIVED_THEMES) throw new DataError(PLAN_REFUSALS.oldThemesFull);
      const changed = await modelAction('Theme', 'updateMany', {
        where: { id: themeId, ownerId },
        data: { archived: true, updatedAt: instantOf(options) },
      });
      if (Number(changed.count) === 0) return null;
    }
    return 'archived';
  }
  const gone = await modelAction('Theme', 'deleteMany', { where: { id: themeId, ownerId } });
  return Number(gone.count) > 0 ? 'deleted' : null;
}

/**
 * The stored form of an own day's date: `MM-DD` for a yearly day (02-29 is
 * kept; it shows on 28 February in a common year), `YYYY-MM-DD` (years 2000 to
 * 2199) for one day. A yearly day also takes a whole date and keeps its month
 * and day. Null when the date is not a real one.
 *
 * @param {unknown} value
 * @param {boolean} yearly
 * @returns {string | null}
 */
export function ownDayDate(value, yearly) {
  if (typeof value !== 'string') return null;
  const full = FULL_DATE.exec(value);
  if (full) {
    const [year, month, day] = full.slice(1).map(Number);
    if (year < 2000 || year > 2199 || month < 1 || month > 12) return null;
    if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
    return yearly ? value.slice(5) : value;
  }
  const short = YEARLY_DATE.exec(value);
  if (!short || !yearly) return null;
  const [month, day] = short.slice(1).map(Number);
  if (month < 1 || month > 12) return null;
  // A leap year, so 29 February is a day a yearly day can be.
  if (day < 1 || day > new Date(Date.UTC(2000, month, 0)).getUTCDate()) return null;
  return value;
}

/** Month and day, the order own days are shown in. @param {{ date: string, yearly: boolean }} day */
function monthDayOf(day) {
  return day.yearly ? day.date : day.date.slice(5);
}

/**
 * The person's own special days, by month and day (`[{ id, name, date, yearly, note }]`).
 *
 * @param {unknown} owner
 */
export async function listOwnDaysFor(owner) {
  const ownerId = ownerOf(owner);
  const rows = await modelAction('SpecialDay', 'findMany', {
    where: { ownerId },
    orderBy: { id: 'asc' },
    select: OWN_DAY_SELECT,
    take: MAX_OWN_DAYS,
  });
  return rows
    .map(ownDayOf)
    .sort((a, b) => monthDayOf(a).localeCompare(monthDayOf(b)) || a.id - b.id);
}

/**
 * One own day, or null.
 *
 * @param {unknown} owner
 * @param {unknown} id
 */
export async function getOwnDayFor(owner, id) {
  const ownerId = ownerOf(owner);
  const dayId = idOf(id);
  if (dayId === null) return null;
  const row = await modelAction('SpecialDay', 'findFirst', { where: { id: dayId, ownerId } });
  return row === null ? null : ownDayOf(row);
}

/**
 * Adds an own day (`date` in its stored form, `ownDayDate`). Refused
 * (`refuse.plan.daysLimit`) past `MAX_OWN_DAYS`.
 *
 * @param {unknown} owner
 * @param {{ name: string, date: string, yearly: boolean, note?: string }} fields
 * @param {{ now?: () => Date }} [options]
 */
export async function addOwnDayFor(owner, fields, options = {}) {
  const ownerId = ownerOf(owner);
  const picked = pick(fields, OWN_DAY_FIELDS, OWN_DAY_TYPES);
  if (typeof picked.name !== 'string' || picked.name === '') throw new DataError('refuse.text.missing');
  const yearly = picked.yearly === true;
  if (ownDayDate(picked.date, yearly) !== picked.date) throw new DataError('refuse.plan.date');
  const count = Number(await modelAction('SpecialDay', 'count', { where: { ownerId } }));
  if (count >= MAX_OWN_DAYS) throw new DataError(PLAN_REFUSALS.daysLimit);
  const row = await modelAction('SpecialDay', 'create', {
    data: { ownerId, name: picked.name, date: picked.date, yearly, note: picked.note ?? '', createdAt: instantOf(options) },
  });
  return ownDayOf(row);
}

/**
 * Changes an own day (each field in its stored form); null when the owner has none.
 *
 * @param {unknown} owner
 * @param {unknown} id
 * @param {{ name?: string, date?: string, yearly?: boolean, note?: string }} fields
 */
export async function updateOwnDayFor(owner, id, fields) {
  const ownerId = ownerOf(owner);
  const dayId = idOf(id);
  if (dayId === null) return null;
  const picked = pick(fields, OWN_DAY_FIELDS, OWN_DAY_TYPES);
  if (picked.name !== undefined && picked.name === '') throw new DataError('refuse.text.missing');
  if (picked.date !== undefined && picked.yearly !== undefined && ownDayDate(picked.date, picked.yearly) !== picked.date) {
    throw new DataError('refuse.plan.date');
  }
  if (Object.keys(picked).length > 0) {
    const changed = await modelAction('SpecialDay', 'updateMany', { where: { id: dayId, ownerId }, data: picked });
    if (Number(changed.count) === 0) return null;
  }
  return getOwnDayFor(ownerId, dayId);
}

/**
 * @param {unknown} owner
 * @param {unknown} id
 * @returns {Promise<boolean>} whether anything was removed
 */
export async function removeOwnDayFor(owner, id) {
  const ownerId = ownerOf(owner);
  const dayId = idOf(id);
  if (dayId === null) return false;
  const gone = await modelAction('SpecialDay', 'deleteMany', { where: { id: dayId, ownerId } });
  return Number(gone.count) > 0;
}

/** The most characters a theme's default hashtags take, as typed (a person's set of up to `LIMITS.hashtags`). */
export const THEME_HASHTAGS_MAX = LIMITS.hashtags * (LIMITS.hashtagLength + 1);

/**
 * @typedef {{ ok: true, fields: Record<string, unknown> } | { ok: false, problem: string, field?: string }} FieldsRead
 */

/**
 * A theme's fields as sent to an address, read through `lib/plan/limits.js`:
 * `name` (required when `creating`), `about`, `hashtags` (kept as typed) and,
 * when changing, `colour` 0..4 and `sells` (true or false). A refusal names
 * its field.
 *
 * @param {Record<string, unknown>} body
 * @param {{ creating?: boolean }} [options]
 * @returns {FieldsRead}
 */
export function readThemeFields(body, { creating = false } = {}) {
  const allowed = creating ? ['name', 'about', 'hashtags'] : THEME_FIELDS;
  const names = Object.keys(body);
  if (names.some((name) => !allowed.includes(name))) return { ok: false, problem: 'refuse.request' };
  if (!creating && names.length === 0) return { ok: false, problem: 'refuse.request' };
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (creating || Object.hasOwn(body, 'name')) {
    const name = readWords(body.name, LIMITS.name, { required: true });
    if (!name.ok) return { ok: false, problem: name.problem, field: 'name' };
    fields.name = name.value;
  }
  for (const [field, max] of /** @type {const} */ ([['about', LIMITS.themeAbout], ['hashtags', THEME_HASHTAGS_MAX]])) {
    if (!Object.hasOwn(body, field)) continue;
    const words = readWords(body[field], max);
    if (!words.ok) return { ok: false, problem: words.problem, field };
    fields[field] = words.value;
  }
  if (Object.hasOwn(body, 'colour')) {
    const colour = body.colour;
    if (typeof colour !== 'number' || !Number.isInteger(colour) || colour < 0 || colour >= THEME_COLOURS) {
      return { ok: false, problem: 'refuse.request', field: 'colour' };
    }
    fields.colour = colour;
  }
  if (Object.hasOwn(body, 'sells')) {
    if (typeof body.sells !== 'boolean') return { ok: false, problem: 'refuse.request', field: 'sells' };
    fields.sells = body.sells;
  }
  return { ok: true, fields };
}

/**
 * An own day's fields as sent to an address: `name` (required when creating),
 * `date` (`YYYY-MM-DD`, or `MM-DD` for a yearly day), `yearly` (true when not
 * sent on a new day) and `note`. Changing one of `date` and `yearly` checks
 * the pair against `current`; the answer always carries both then, the date in
 * its stored form. A refusal names its field.
 *
 * @param {Record<string, unknown>} body
 * @param {{ current?: { date: string, yearly: boolean } | null }} [options]
 * @returns {FieldsRead}
 */
export function readOwnDayFields(body, { current = null } = {}) {
  const creating = current === null;
  const names = Object.keys(body);
  if (names.some((name) => !OWN_DAY_FIELDS.includes(name))) return { ok: false, problem: 'refuse.request' };
  if (!creating && names.length === 0) return { ok: false, problem: 'refuse.request' };
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (creating || Object.hasOwn(body, 'name')) {
    const name = readWords(body.name, LIMITS.name, { required: true });
    if (!name.ok) return { ok: false, problem: name.problem, field: 'name' };
    fields.name = name.value;
  }
  if (Object.hasOwn(body, 'note')) {
    const note = readWords(body.note, LIMITS.notes, { multiline: true });
    if (!note.ok) return { ok: false, problem: note.problem, field: 'note' };
    fields.note = note.value;
  }
  if (Object.hasOwn(body, 'yearly') && typeof body.yearly !== 'boolean') return { ok: false, problem: 'refuse.request', field: 'yearly' };
  if (creating || Object.hasOwn(body, 'date') || Object.hasOwn(body, 'yearly')) {
    const yearly = typeof body.yearly === 'boolean' ? body.yearly : current?.yearly ?? true;
    const date = ownDayDate(Object.hasOwn(body, 'date') ? body.date : current?.date, yearly);
    if (date === null) return { ok: false, problem: 'refuse.plan.date', field: 'date' };
    fields.date = date;
    fields.yearly = yearly;
  }
  return { ok: true, fields };
}

/**
 * What other pages need of the plan: the profile (or its defaults), the
 * themes in use by position, the archived ones (old posts keep their colour),
 * the networks in the person's order and the hidden special days. One call
 * after the other (the profile, then the themes: at most 4), never two at
 * once, so a page or an address can run it beside another read and stay
 * within Tellop's 4 calls unanswered at once.
 *
 * @param {unknown} owner
 */
export async function planFor(owner) {
  const ownerId = ownerOf(owner);
  const profile = await getProfileFor(ownerId);
  const all = await allThemesOf(ownerId);
  return {
    profile,
    themes: all.filter((theme) => !theme.archived),
    archivedThemes: all.filter((theme) => theme.archived),
    networks: parseNetworkList(profile.networks),
    hiddenDays: parseDayList(profile.hiddenDays),
  };
}

/**
 * Whether the owner has any post at all (an idea or a dated one): one call
 * that reads at most one post's id. The calendar asks it only when nothing it
 * already read shows a post, to decide whether to offer the first-visit start.
 *
 * @param {unknown} owner
 */
export async function hasPostsFor(owner) {
  const ownerId = ownerOf(owner);
  const row = await modelAction('Post', 'findFirst', { where: { ownerId }, select: { id: true } });
  return row !== null && row !== undefined;
}

/** A theme's name as two themes are compared: case and the spaces around it do not count. @param {unknown} name */
function sameName(name) {
  return String(name ?? '').normalize('NFC').trim().toLowerCase();
}

/**
 * The first-visit start: saves the business name and the networks (a stored
 * comma list) and adds the themes asked for, in one group of saves after two
 * reads (3 calls, one after the other). Refused (`refuse.plan.started`) once
 * the profile has a business name, so a start left open in a second window
 * never replaces what the person saved since. A theme whose name a theme in
 * use already has is that theme (nothing is added); the others are added
 * last, each with the first colour no theme in use has, while there is room
 * under `LIMITS.themes`.
 *
 * Answers `{ profile, themes, inUse }`: `themes` lines up with the themes
 * asked for (`{ id, name, colour, sells }`, or null when there was no room),
 * `inUse` every theme in use afterwards, by position.
 *
 * @param {unknown} owner
 * @param {{ businessName: string, networks: string, themes: Array<{ name: string, about?: string, sells?: boolean }> }} start
 * @param {{ now?: () => Date }} [options]
 */
export async function startPlanFor(owner, { businessName, networks, themes }, options = {}) {
  const ownerId = ownerOf(owner);
  if (typeof businessName !== 'string' || businessName.trim() === '') throw new DataError('refuse.text.missing');
  if (typeof networks !== 'string' || !Array.isArray(themes) || themes.length > LIMITS.themes) throw new DataError('refuse.request');
  const asked = themes.map((theme) => {
    const picked = pick(theme, ['name', 'about', 'sells'], { sells: 'boolean' });
    if (typeof picked.name !== 'string' || picked.name.trim() === '') throw new DataError('refuse.text.missing');
    return { name: picked.name, about: picked.about ?? '', sells: picked.sells === true };
  });
  const profile = await getProfileFor(ownerId);
  if (profile.businessName !== '') throw new DataError(PLAN_REFUSALS.started);
  const live = (await modelAction('Theme', 'findMany', {
    where: { ownerId, archived: false },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, colour: true, position: true, sells: true },
    take: MOST_THEMES,
  })).map((row) => ({ id: Number(row.id), name: String(row.name), colour: Number(row.colour), position: Number(row.position), sells: row.sells === true }));

  const at = instantOf(options);
  const used = new Set(live.map((theme) => theme.colour));
  let room = LIMITS.themes - live.length;
  let position = live.reduce((most, theme) => Math.max(most, theme.position), -1) + 1;
  /** @type {Array<Record<string, unknown>>} */
  const adding = [];
  /** @type {Array<{ found: { id: number, name: string, colour: number, sells: boolean } } | { adds: string } | null>} */
  const plan = asked.map((theme) => {
    const found = live.find((item) => sameName(item.name) === sameName(theme.name));
    if (found) return { found };
    if (room <= 0 || adding.some((item) => sameName(item.name) === sameName(theme.name))) return null;
    room -= 1;
    const colour = Array.from({ length: THEME_COLOURS }, (_, index) => index).find((index) => !used.has(index)) ?? 0;
    used.add(colour);
    adding.push({ ownerId, name: theme.name, about: theme.about, hashtags: '', colour, position, archived: false, sells: theme.sells, createdAt: at, updatedAt: at });
    position += 1;
    return { adds: sameName(theme.name) };
  });

  /** @type {Array<{ model: string, action: string, args: Record<string, unknown> }>} */
  const steps = [{
    model: 'Profile',
    action: 'upsert',
    args: {
      where: { ownerId },
      create: { ...PROFILE_DEFAULTS, businessName, networks, ownerId, createdAt: at, updatedAt: at },
      update: { businessName, networks, updatedAt: at },
    },
  }];
  if (adding.length > 0) {
    steps.push({ model: 'Theme', action: 'createManyAndReturn', args: { data: adding, select: { id: true, name: true, colour: true, position: true, sells: true } } });
  }
  const [row, added = []] = await modelBatch(steps);
  const made = added.map((item) => ({ id: Number(item.id), name: String(item.name), colour: Number(item.colour), position: Number(item.position), sells: item.sells === true }));
  const plain = ({ id, name, colour, sells }) => ({ id, name, colour, sells });
  return {
    profile: profileOf(row),
    themes: plan.map((step) => {
      if (step === null) return null;
      if ('found' in step) return plain(step.found);
      const theme = made.find((item) => sameName(item.name) === step.adds);
      return theme ? plain(theme) : null;
    }),
    inUse: [...live, ...made].sort((a, b) => a.position - b.position || a.id - b.id).map(plain),
  };
}
