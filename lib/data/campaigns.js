/**
 * Campaigns (`Campaign`) and their steps (`CampaignStep`). Every read, save
 * and delete names its owner inside the statement's `where` (AGENTS.md rule
 * 1a); nothing here saves while reading (rule 4a). What leaves this file is a
 * plain object.
 *
 * A campaign runs from `startsOn` to `endsOn`, both days included. Its status
 * is worked out, never stored: Planned before its first day, Running from its
 * first day to its last, Done after its last day or once the person marked it
 * done early (`doneEarly`). Deleting a campaign removes its steps and leaves
 * its posts where they are, with no campaign, in one group of changes.
 *
 * ## How much one read takes
 *
 * Inside Tellop a records call answers at most 256 rows a statement and
 * 256 KiB, a statement's answer holds at most 2,048 values (a row counts its
 * fields and two more), and a request makes at most 16 calls. So a list of
 * campaigns takes `PAGE_ROWS` a call (about 215 KiB with the longest words,
 * two bytes a letter) and reads on, after the last campaign read, only when a
 * call came back full: a month's campaigns 1 call, every campaign at most
 * `MOST_CAMPAIGNS / PAGE_ROWS` (4) calls. A campaign's steps (at most
 * `LIMITS.campaignSteps`) are one call.
 *
 * ## Offer codes and plans
 *
 * A campaign's offer code (`code`, '' for none; an older campaign's null reads
 * as '') is kept in capitals, 2 to 24 letters or digits as a customer's code
 * is (`readCampaignCode`). Results count the customers whose code matches a
 * campaign's (`campaignCodesStep`, read inside Results' own batch).
 *
 * Plan the posts (`campaignPlanFor`, then `keepCampaignPlanFor`): the dated
 * idea posts of a launch, an event or a sale (`lib/plan/campaign-plans.js`),
 * never on a day that already holds a post, never on a day of remembrance,
 * never past a month's `MOST_A_MONTH` posts, with the theme the campaign's
 * posts use most (one in use, never an archived one), else a theme in use
 * (a sale's the first that sells). Three calls in all: the campaign, what its
 * days hold, the posts kept in one call.
 */

import { DataError, modelAction, modelBatch } from './index.js';
import { OFFER_CODE, readOfferCode } from './customers.js';
import { parseDayList } from './plan.js';
import { MOST_A_MONTH, POST_REFUSALS } from './posts.js';
import { readInPages } from './read-in-pages.js';
import { codeKey, isPlanKind, PLAN_ASKS, PLAN_MOST, planSlots } from '../plan/campaign-plans.js';
import { LIMITS, readWords } from '../plan/limits.js';
import { addMonths, isCivilDay, isCivilMonth, todayCivil } from '../plan/days.js';
import { specialDaysOn } from '../plan/special-days.js';

export const CAMPAIGN_STATUSES = Object.freeze(['planned', 'running', 'done']);

/** Campaigns one records call takes. */
const PAGE_ROWS = 50;
/** Most campaigns one list read of every campaign answers; 4 calls. */
export const MOST_CAMPAIGNS = 200;
/** Most campaigns a month's list answers; 1 call. */
export const MONTH_CAMPAIGNS = PAGE_ROWS;
/** Every field a campaign's summary reads (not the owner, which every read names). */
const CAMPAIGN_SELECT = Object.freeze(Object.fromEntries(['id', 'name', 'goal', 'offer', 'startsOn', 'endsOn', 'doneEarly', 'notes',
  'createdAt', 'updatedAt', 'code'].map((field) => [field, true])));

export const CAMPAIGN_REFUSALS = Object.freeze({
  name: 'refuse.campaign.name',
  goal: 'refuse.campaign.goal',
  offer: 'refuse.campaign.offer',
  notes: 'refuse.campaign.notes',
  days: 'refuse.campaign.days',
  doneEarly: 'refuse.campaign.doneEarly',
  month: 'refuse.campaign.month',
  step: 'refuse.campaign.step',
  due: 'refuse.campaign.due',
  done: 'refuse.campaign.done',
  steps: 'refuse.campaign.steps',
  direction: 'refuse.campaign.direction',
  code: 'refuse.campaign.code',
  planKind: 'refuse.campaign.planKind',
  over: 'refuse.campaign.over',
});

/**
 * A campaign's offer code as it is kept: '' (or null, or left out) for none;
 * else read as a customer's code is (`readOfferCode`: 2 to 24 letters or
 * digits) and kept in capitals (`kış20` is `KIŞ20`). Refused (`ok: false`)
 * when it does not read as one, or no longer does in capitals.
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false }}
 */
export function readCampaignCode(value) {
  const code = readOfferCode(value);
  if (!code.ok) return { ok: false };
  if (code.value === '') return { ok: true, value: '' };
  const capitals = code.value.toUpperCase().normalize('NFC');
  return OFFER_CODE.test(capitals) ? { ok: true, value: capitals } : { ok: false };
}

/** @param {unknown} value */
function ownerOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DataError('error.ownerMissing');
  return value.trim();
}

/** A record id: a whole number above 0 (or its digits), else null. @param {unknown} value */
export function recordId(value) {
  const number = typeof value === 'string' && /^[1-9][0-9]{0,9}$/u.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function words(value, max, key, options) {
  const read = readWords(value, max, options);
  if (!read.ok) throw new DataError(key);
  return read.value;
}

/** @param {Record<string, unknown>} input @param {string} name */
const sent = (input, name) => Object.hasOwn(input, name) && input[name] !== undefined;

/**
 * Planned, running or done on `today`.
 *
 * @param {{ startsOn: string, endsOn: string, doneEarly: boolean }} campaign
 * @param {string} [today]
 * @returns {'planned' | 'running' | 'done'}
 */
export function campaignStatus(campaign, today = todayCivil()) {
  if (campaign.doneEarly === true || today > campaign.endsOn) return 'done';
  if (today < campaign.startsOn) return 'planned';
  return 'running';
}

/**
 * @typedef {{ id: number, name: string, goal: string, offer: string, startsOn: string, endsOn: string,
 *   doneEarly: boolean, notes: string, code: string, status: 'planned' | 'running' | 'done', createdAt: string, updatedAt: string }} Campaign
 * @typedef {{ id: number, campaignId: number, text: string, dueOn: string, done: boolean, position: number }} CampaignStep
 */

/** @returns {Campaign} */
function campaignOf(row, today) {
  const campaign = {
    id: Number(row.id),
    name: String(row.name),
    goal: String(row.goal ?? ''),
    offer: String(row.offer ?? ''),
    startsOn: String(row.startsOn),
    endsOn: String(row.endsOn),
    doneEarly: row.doneEarly === true,
    notes: String(row.notes ?? ''),
    code: typeof row.code === 'string' ? row.code : '',
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
  return { ...campaign, status: campaignStatus(campaign, today) };
}

/** @returns {CampaignStep} */
function stepOf(row) {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaignId),
    text: String(row.text),
    dueOn: String(row.dueOn ?? ''),
    done: row.done === true,
    position: Number(row.position),
  };
}

/**
 * The fields a campaign form sent, checked. A new campaign needs a name and
 * both days, the last on or after the first. A change reads only the fields
 * it was sent, and checks its days against the stored ones (`stored`).
 *
 * @param {Record<string, unknown>} input
 * @param {{ partial: boolean, stored?: { startsOn: string, endsOn: string } }} options
 */
export function readCampaignFields(input, { partial, stored }) {
  const source = input !== null && typeof input === 'object' ? input : {};
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (!partial || sent(source, 'name')) fields.name = words(source.name, LIMITS.name, CAMPAIGN_REFUSALS.name, { required: true });
  if (!partial || sent(source, 'goal')) fields.goal = words(source.goal, LIMITS.profileField, CAMPAIGN_REFUSALS.goal);
  if (!partial || sent(source, 'offer')) fields.offer = words(source.offer, LIMITS.profileField, CAMPAIGN_REFUSALS.offer);
  if (!partial || sent(source, 'notes')) fields.notes = words(source.notes, LIMITS.notes, CAMPAIGN_REFUSALS.notes, { multiline: true });
  if (!partial || sent(source, 'code')) {
    const code = readCampaignCode(source.code);
    if (!code.ok) throw new DataError(CAMPAIGN_REFUSALS.code);
    fields.code = code.value;
  }
  if (!partial || sent(source, 'doneEarly')) {
    const doneEarly = source.doneEarly === undefined ? false : source.doneEarly;
    if (typeof doneEarly !== 'boolean') throw new DataError(CAMPAIGN_REFUSALS.doneEarly);
    fields.doneEarly = doneEarly;
  }
  if (!partial || sent(source, 'startsOn') || sent(source, 'endsOn')) {
    const startsOn = sent(source, 'startsOn') ? source.startsOn : stored?.startsOn;
    const endsOn = sent(source, 'endsOn') ? source.endsOn : stored?.endsOn;
    if (!isCivilDay(startsOn) || !isCivilDay(endsOn) || endsOn < startsOn) throw new DataError(CAMPAIGN_REFUSALS.days);
    if (sent(source, 'startsOn') || !partial) fields.startsOn = startsOn;
    if (sent(source, 'endsOn') || !partial) fields.endsOn = endsOn;
  }
  return fields;
}

/**
 * @param {string} ownerId
 * @param {Record<string, unknown>} input
 * @param {{ now?: () => Date, today?: string }} [options]
 * @returns {Promise<Campaign>}
 */
export async function addCampaignFor(ownerId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const fields = readCampaignFields(input, { partial: false });
  const at = (options.now?.() ?? new Date()).toISOString();
  const created = await modelAction('Campaign', 'create', { data: { ...fields, ownerId: owner, createdAt: at, updatedAt: at } });
  return campaignOf(created, options.today);
}

/** The campaign alone; null when this owner has none by that id. @returns {Promise<Campaign | null>} */
async function findCampaign(owner, id, today) {
  const found = await modelAction('Campaign', 'findFirst', { where: { id, ownerId: owner } });
  return found ? campaignOf(found, today) : null;
}

/** The campaign's steps, in their order. @returns {Promise<CampaignStep[]>} */
async function stepsOf(owner, campaignId) {
  const found = await modelAction('CampaignStep', 'findMany', {
    where: { ownerId: owner, campaignId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: LIMITS.campaignSteps,
  });
  return found.map(stepOf);
}

/**
 * A campaign with its steps; null when this owner has none by that id.
 *
 * @returns {Promise<{ campaign: Campaign, steps: CampaignStep[] } | null>}
 */
export async function getCampaignFor(ownerId, campaignId, { today } = {}) {
  const owner = ownerOf(ownerId);
  const id = recordId(campaignId);
  if (id === null) return null;
  const campaign = await findCampaign(owner, id, today);
  if (campaign === null) return null;
  return { campaign, steps: await stepsOf(owner, id) };
}

/**
 * Campaigns that run on at least one day of `month` (`YYYY-MM`), by first day
 * (at most `MONTH_CAMPAIGNS`, one call); with no month, every campaign, the
 * latest first (at most `MOST_CAMPAIGNS`).
 *
 * @param {string} ownerId
 * @param {{ month?: string, today?: string }} [options]
 * @returns {Promise<Campaign[]>}
 */
export async function listCampaignsFor(ownerId, { month, today } = {}) {
  const owner = ownerOf(ownerId);
  if (month !== undefined) {
    if (!isCivilMonth(month)) throw new DataError(CAMPAIGN_REFUSALS.month);
    const found = await modelAction('Campaign', 'findMany', {
      // Runs on a day of the month: starts before the next month begins and ends on or after its first day.
      where: { ownerId: owner, startsOn: { lt: `${addMonths(month, 1)}-01` }, endsOn: { gte: `${month}-01` } },
      orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
      select: CAMPAIGN_SELECT,
      take: MONTH_CAMPAIGNS,
    });
    return found.map((row) => campaignOf(row, today));
  }
  const found = await readInPages('Campaign', { where: { ownerId: owner }, order: [['startsOn', 'desc'], ['id', 'desc']], select: CAMPAIGN_SELECT,
    most: MOST_CAMPAIGNS, page: PAGE_ROWS });
  return found.map((row) => campaignOf(row, today));
}

/**
 * Changes the fields sent; null when this owner has no such campaign.
 *
 * @returns {Promise<Campaign | null>}
 */
export async function updateCampaignFor(ownerId, campaignId, input, options = {}) {
  const owner = ownerOf(ownerId);
  const id = recordId(campaignId);
  if (id === null) return null;
  const stored = await findCampaign(owner, id, options.today);
  if (stored === null) return null;
  const fields = readCampaignFields(input, { partial: true, stored });
  const at = (options.now?.() ?? new Date()).toISOString();
  const changed = await modelAction('Campaign', 'updateMany', { where: { id, ownerId: owner }, data: { ...fields, updatedAt: at } });
  if (Number(changed?.count ?? 0) < 1) return null;
  return findCampaign(owner, id, options.today);
}

/**
 * Removes a campaign and its steps; its posts keep their day and lose the
 * campaign. One group of changes: all of it happens, or none.
 *
 * @returns {Promise<boolean>} whether a campaign was removed
 */
export async function removeCampaignFor(ownerId, campaignId) {
  const owner = ownerOf(ownerId);
  const id = recordId(campaignId);
  if (id === null) return false;
  // Only a campaign this owner has: asking to remove one they do not have changes nothing at all.
  if (Number(await modelAction('Campaign', 'count', { where: { id, ownerId: owner } })) < 1) return false;
  const results = await modelBatch([
    { model: 'Post', action: 'updateMany', args: { where: { ownerId: owner, campaignId: id }, data: { campaignId: null } } },
    { model: 'CampaignStep', action: 'deleteMany', args: { where: { ownerId: owner, campaignId: id } } },
    { model: 'Campaign', action: 'deleteMany', args: { where: { id, ownerId: owner } } },
  ]);
  return Number(results[2]?.count ?? 0) > 0;
}

/* ----------------------------------------------------------------------------
 * Steps
 * ------------------------------------------------------------------------- */

/**
 * @param {Record<string, unknown>} input
 * @param {{ partial: boolean }} options
 */
export function readStepFields(input, { partial }) {
  const source = input !== null && typeof input === 'object' ? input : {};
  /** @type {Record<string, unknown>} */
  const fields = {};
  if (!partial || sent(source, 'text')) fields.text = words(source.text, LIMITS.campaignStep, CAMPAIGN_REFUSALS.step, { required: true });
  if (!partial || sent(source, 'dueOn')) {
    const dueOn = source.dueOn === undefined || source.dueOn === null ? '' : source.dueOn;
    if (dueOn !== '' && !isCivilDay(dueOn)) throw new DataError(CAMPAIGN_REFUSALS.due);
    fields.dueOn = dueOn;
  }
  if (!partial || sent(source, 'done')) {
    const done = source.done === undefined ? false : source.done;
    if (typeof done !== 'boolean') throw new DataError(CAMPAIGN_REFUSALS.done);
    fields.done = done;
  }
  return fields;
}

/**
 * Adds a step at the end of the campaign's list. Refused once the campaign
 * holds `LIMITS.campaignSteps`; null when this owner has no such campaign.
 *
 * @returns {Promise<CampaignStep | null>}
 */
export async function addCampaignStepFor(ownerId, campaignId, input) {
  const owner = ownerOf(ownerId);
  const id = recordId(campaignId);
  if (id === null) return null;
  const fields = readStepFields(input, { partial: false });
  const campaign = await modelAction('Campaign', 'count', { where: { id, ownerId: owner } });
  if (Number(campaign) < 1) return null;
  const held = await modelAction('CampaignStep', 'findMany', {
    where: { ownerId: owner, campaignId: id },
    orderBy: [{ position: 'desc' }],
    take: LIMITS.campaignSteps + 1,
    select: { position: true },
  });
  if (held.length >= LIMITS.campaignSteps) throw new DataError(CAMPAIGN_REFUSALS.steps);
  const position = held.length === 0 ? 0 : Number(held[0].position) + 1;
  const created = await modelAction('CampaignStep', 'create', { data: { ...fields, ownerId: owner, campaignId: id, position } });
  return stepOf(created);
}

/** A campaign's steps; null when this owner has no such campaign. @returns {Promise<CampaignStep[] | null>} */
export async function listCampaignStepsFor(ownerId, campaignId) {
  const owner = ownerOf(ownerId);
  const id = recordId(campaignId);
  if (id === null) return null;
  const campaign = await modelAction('Campaign', 'count', { where: { id, ownerId: owner } });
  if (Number(campaign) < 1) return null;
  return stepsOf(owner, id);
}

/** @returns {Promise<CampaignStep | null>} */
async function findStep(owner, id) {
  const found = await modelAction('CampaignStep', 'findFirst', { where: { id, ownerId: owner } });
  return found ? stepOf(found) : null;
}

/**
 * Changes a step's words, due day or done mark; null when this owner has no
 * such step.
 *
 * @returns {Promise<CampaignStep | null>}
 */
export async function updateCampaignStepFor(ownerId, stepId, input) {
  const owner = ownerOf(ownerId);
  const id = recordId(stepId);
  if (id === null) return null;
  const fields = readStepFields(input, { partial: true });
  if (Object.keys(fields).length === 0) return findStep(owner, id);
  const changed = await modelAction('CampaignStep', 'updateMany', { where: { id, ownerId: owner }, data: fields });
  if (Number(changed?.count ?? 0) < 1) return null;
  return findStep(owner, id);
}

/** @returns {Promise<boolean>} */
export async function removeCampaignStepFor(ownerId, stepId) {
  const owner = ownerOf(ownerId);
  const id = recordId(stepId);
  if (id === null) return false;
  const removed = await modelAction('CampaignStep', 'deleteMany', { where: { id, ownerId: owner } });
  return Number(removed?.count ?? 0) > 0;
}

/**
 * Moves a step one place up or down in its campaign's list (it changes places
 * with its neighbour; at either end nothing moves) and answers the list.
 * Null when this owner has no such step.
 *
 * @param {string} ownerId @param {unknown} stepId @param {unknown} direction `up` or `down`
 * @returns {Promise<CampaignStep[] | null>}
 */
export async function moveCampaignStepFor(ownerId, stepId, direction) {
  const owner = ownerOf(ownerId);
  if (direction !== 'up' && direction !== 'down') throw new DataError(CAMPAIGN_REFUSALS.direction);
  const id = recordId(stepId);
  if (id === null) return null;
  const step = await findStep(owner, id);
  if (step === null) return null;
  const neighbour = await modelAction('CampaignStep', 'findFirst', {
    where: { ownerId: owner, campaignId: step.campaignId, position: direction === 'up' ? { lt: step.position } : { gt: step.position } },
    orderBy: [{ position: direction === 'up' ? 'desc' : 'asc' }],
  });
  if (neighbour) {
    await modelBatch([
      { model: 'CampaignStep', action: 'updateMany', args: { where: { id: step.id, ownerId: owner }, data: { position: Number(neighbour.position) } } },
      { model: 'CampaignStep', action: 'updateMany', args: { where: { id: Number(neighbour.id), ownerId: owner }, data: { position: step.position } } },
    ]);
  }
  return stepsOf(owner, step.campaignId);
}

/* ----------------------------------------------------------------------------
 * Names and codes for other pages
 * ------------------------------------------------------------------------- */

/** Most campaigns `campaignNamesFor` names in one call (a records call sends lists of at most 256). */
export const NAMES_MOST = 256;

/**
 * The names of this owner's campaigns among `ids` (`[{ id, name }]`, by id),
 * for the tracking of shared links: one call, none when no id reads as one.
 * At most `NAMES_MOST` ids are read; another owner's campaign, or one gone, is
 * left out.
 *
 * @param {string} ownerId
 * @param {unknown[]} ids
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
export async function campaignNamesFor(ownerId, ids) {
  const owner = ownerOf(ownerId);
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(recordId).filter((id) => id !== null))].slice(0, NAMES_MOST);
  if (wanted.length === 0) return [];
  const found = await modelAction('Campaign', 'findMany', {
    where: { ownerId: owner, id: { in: wanted } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
    take: wanted.length,
  });
  return (Array.isArray(found) ? found : []).map((row) => ({ id: Number(row.id), name: String(row.name) }));
}

/** Most campaigns with a code that Results reads (the latest first). */
export const CODES_MOST = 100;

/**
 * The step that reads this owner's campaigns that have an offer code, the
 * latest first (at most `CODES_MOST`), for a batch another read makes
 * (Results): `campaignCodesOf` reads its answer.
 *
 * @param {string} ownerId
 */
export function campaignCodesStep(ownerId) {
  return {
    model: 'Campaign',
    action: 'findMany',
    args: { where: { ownerId: ownerOf(ownerId), code: { not: '' } }, select: { id: true, name: true, code: true }, orderBy: [{ startsOn: 'desc' }, { id: 'desc' }], take: CODES_MOST },
  };
}

/**
 * The campaigns with a code in `campaignCodesStep`'s answer, `[{ id, name,
 * code, key }]` (`key`: `codeKey`), the latest first; a campaign with no code
 * is left out.
 *
 * @param {unknown} answer
 */
export function campaignCodesOf(answer) {
  return (Array.isArray(answer) ? answer : [])
    .filter((row) => typeof row?.code === 'string' && codeKey(row.code) !== '')
    .map((row) => ({ id: Number(row.id), name: String(row.name ?? ''), code: row.code, key: codeKey(row.code) }));
}

/* ----------------------------------------------------------------------------
 * Plan the posts
 * ------------------------------------------------------------------------- */

/** The theme rows one plan reads: every theme in use fits (at most 96). */
const THEMES_READ = 256;

/**
 * @typedef {{ key: string, day: string, ask: string }} PlanSlot
 * @typedef {{ key: string, day: string, reason: 'taken' | 'remembrance' }} PlanSkip
 * @typedef {{ campaign: Campaign, kind: string, slots: PlanSlot[], skipped: PlanSkip[], themeId: number | null,
 *   business: { businessName: string, offer: string, audience: string, voice: string } }} CampaignPlan
 */

/**
 * What a plan of `kind` would add to a campaign, read in two calls (the
 * campaign; then, in one batch, the posts on the planned days, the themes its
 * posts use, the themes in use, the person's special-day choices and the
 * posts of each month touched): `{ campaign, kind, slots, skipped, themeId,
 * business }` (`business`: the profile's words AI may read).
 *
 * - `slots`: the posts to add (`planSlots`), each with the kind's ask;
 * - `skipped`: the planned days left out: one already holding a post
 *   (`taken`), or a day of remembrance (`remembrance`), whatever the kind;
 * - `themeId`: the theme the campaign's posts use most (the lower id on a
 *   tie) among the themes in use; when they use none, a sale takes the first
 *   theme in use that sells (by its place in My plan), else the first theme
 *   in use, and a launch or an event the first theme in use; null only when
 *   no theme is in use.
 *
 * Null when this owner has no such campaign. Refused: a kind that is not one
 * (`refuse.campaign.planKind`), a campaign that is done
 * (`refuse.campaign.over`), a month that would then hold more than
 * `MOST_A_MONTH` posts (`refuse.post.monthFull`). Nothing is saved.
 *
 * @param {string} ownerId
 * @param {unknown} campaignId
 * @param {unknown} kind
 * @param {{ today?: string }} [options]
 * @returns {Promise<CampaignPlan | null>}
 */
export async function campaignPlanFor(ownerId, campaignId, kind, { today = todayCivil() } = {}) {
  const owner = ownerOf(ownerId);
  if (!isPlanKind(kind)) throw new DataError(CAMPAIGN_REFUSALS.planKind);
  const id = recordId(campaignId);
  if (id === null) return null;
  const campaign = await findCampaign(owner, id, today);
  if (campaign === null) return null;
  if (campaign.status === 'done') throw new DataError(CAMPAIGN_REFUSALS.over);
  const wanted = planSlots({ kind, startsOn: campaign.startsOn, endsOn: campaign.endsOn, today });
  if (wanted.length === 0) throw new DataError(CAMPAIGN_REFUSALS.over);
  const days = wanted.map((slot) => slot.day);
  const months = [...new Set(days.map((day) => day.slice(0, 7)))];
  const found = await modelBatch([
    { model: 'Post', action: 'groupBy', args: { by: ['day'], where: { ownerId: owner, day: { in: days } }, _count: { _all: true }, orderBy: { day: 'asc' }, take: days.length } },
    { model: 'Post', action: 'groupBy', args: { by: ['themeId'], where: { ownerId: owner, campaignId: id, themeId: { not: null } }, _count: { _all: true }, orderBy: { themeId: 'asc' }, take: THEMES_READ } },
    { model: 'Theme', action: 'findMany', args: { where: { ownerId: owner, archived: false }, select: { id: true, sells: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: THEMES_READ } },
    { model: 'Profile', action: 'findFirst', args: { where: { ownerId: owner }, select: { showDays: true, hiddenDays: true, businessName: true, offer: true, audience: true, voice: true } } },
    ...months.map((month) => ({ model: 'Post', action: 'count', args: { where: { ownerId: owner, day: { gte: `${month}-01`, lte: `${month}-31` } } } })),
  ]);
  const [held, used, inUse, profile] = found;
  const taken = new Set((Array.isArray(held) ? held : []).map((row) => row?.day));
  const options = { showDays: typeof profile?.showDays === 'string' ? profile.showDays : 'both', hidden: parseDayList(profile?.hiddenDays) };
  const quiet = (day) => specialDaysOn(day, options).some((item) => item.kind === 'remembrance' && item.own !== true);

  /** @type {PlanSlot[]} */
  const slots = [];
  /** @type {PlanSkip[]} */
  const skipped = [];
  for (const slot of wanted) {
    if (slots.length >= PLAN_MOST) break;
    if (taken.has(slot.day)) skipped.push({ ...slot, reason: 'taken' });
    else if (quiet(slot.day)) skipped.push({ ...slot, reason: 'remembrance' });
    else slots.push({ ...slot, ask: PLAN_ASKS[kind] });
  }
  months.forEach((month, index) => {
    const adding = slots.filter((slot) => slot.day.startsWith(`${month}-`)).length;
    if (adding > 0 && Number(found[4 + index] ?? 0) + adding > MOST_A_MONTH) throw new DataError(POST_REFUSALS.monthFull);
  });

  const inUseRows = (Array.isArray(inUse) ? inUse : []).map((row) => ({ id: Number(row.id), sells: row.sells === true }));
  const themes = new Set(inUseRows.map((row) => row.id));
  let themeId = null;
  let most = 0;
  for (const row of Array.isArray(used) ? used : []) {
    const count = Number(row?._count?._all ?? 0);
    if (themes.has(Number(row.themeId)) && count > most) {
      themeId = Number(row.themeId);
      most = count;
    }
  }
  // No theme from the campaign's posts: a sale takes the first theme in use that sells, else the first in use;
  // a launch or an event the first in use (by its place in My plan). None only when no theme is in use.
  if (themeId === null && inUseRows.length > 0) {
    themeId = ((kind === 'sale' ? inUseRows.find((row) => row.sells) : undefined) ?? inUseRows[0]).id;
  }
  const business = Object.fromEntries(['businessName', 'offer', 'audience', 'voice'].map((field) => [field, typeof profile?.[field] === 'string' ? profile[field] : '']));
  return { campaign, kind, slots, skipped, themeId, business };
}

/**
 * Keeps a plan's posts (`campaignPlanFor`) as idea posts on their days, in
 * the campaign, with the plan's theme and each slot's ask, named `names` (one
 * a slot, in order; each 1 to `LIMITS.name` characters), made by `madeBy`
 * (`ai` when AI named them, else `person`): one call, every post or none.
 * Answers the posts kept, by day: `[{ id, name, day, themeId, campaignId, ask }]`.
 *
 * @param {string} ownerId
 * @param {CampaignPlan} plan
 * @param {string[]} names
 * @param {{ madeBy?: 'ai' | 'person', now?: () => Date }} [options]
 */
export async function keepCampaignPlanFor(ownerId, plan, names, { madeBy = 'person', now } = {}) {
  const owner = ownerOf(ownerId);
  if (!Array.isArray(plan?.slots) || !Array.isArray(names) || names.length !== plan.slots.length || (madeBy !== 'ai' && madeBy !== 'person')) {
    throw new DataError('refuse.request');
  }
  if (plan.slots.length === 0) return [];
  const at = (now?.() ?? new Date()).toISOString();
  const data = plan.slots.map((slot, index) => ({
    ownerId: owner,
    name: words(names[index], LIMITS.name, 'refuse.request', { required: true }),
    day: slot.day,
    themeId: plan.themeId,
    campaignId: plan.campaign.id,
    ask: slot.ask,
    madeBy,
    createdAt: at,
    updatedAt: at,
  }));
  const rows = await modelAction('Post', 'createManyAndReturn', { data, select: { id: true, name: true, day: true, themeId: true, campaignId: true, ask: true } });
  if (!Array.isArray(rows) || rows.length !== data.length) throw new DataError('error.saveUnconfirmed');
  return rows
    .map((row) => ({ id: Number(row.id), name: String(row.name), day: String(row.day), themeId: row.themeId === null ? null : Number(row.themeId), campaignId: Number(row.campaignId), ask: String(row.ask ?? '') }))
    .sort((a, b) => (a.day === b.day ? a.id - b.id : a.day < b.day ? -1 : 1));
}
