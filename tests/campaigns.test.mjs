/**
 * Campaigns and their steps, against a throwaway store (`APP_DATA_FILE` in a
 * temporary folder, removed afterwards): the owner condition on every read,
 * change and removal, a month's campaigns at the month's edges, the status
 * worked out from the days, the 50-step limit at its edge and one each side,
 * moving steps, and a campaign's removal leaving its posts with no campaign.
 * Nothing reaches the network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'campaign-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction, DataError } = await import('../lib/data/index.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { OWNER } = await import('../lib/plan/owner.js');
const campaigns = await import('../lib/data/campaigns.js');
const campaignsRoute = await import('../app/api/campaigns/route.js');
const campaignRoute = await import('../app/api/campaigns/[id]/route.js');
const stepsRoute = await import('../app/api/campaigns/[id]/steps/route.js');
const stepRoute = await import('../app/api/campaign-steps/[id]/route.js');

const OTHER = 'someone-else';

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

async function refusedWith(promise, key) {
  await assert.rejects(promise, (error) => error instanceof DataError && error.messageKey === key);
}

const jsonRequest = (method, body) =>
  new Request('http://app.test/api', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id: String(id) }) });

async function addPost(owner, campaignId, day = '2026-11-03') {
  const at = new Date().toISOString();
  const row = await modelAction('Post', 'create', { data: { ownerId: owner, name: 'A post', day, campaignId, createdAt: at, updatedAt: at } });
  return Number(row.id);
}

const autumn = { name: 'Autumn series', goal: 'Fill the Saturday classes', offer: 'Bring a friend, 10% off', startsOn: '2026-11-01', endsOn: '2026-11-15' };

test('a campaign is saved, read and changed only by its owner', async () => {
  const added = await campaigns.addCampaignFor(OWNER, { ...autumn, notes: 'one\ntwo' }, { today: '2026-10-21' });
  assert.equal(added.name, 'Autumn series');
  assert.equal(added.doneEarly, false);
  assert.equal(added.notes, 'one\ntwo');
  assert.equal(added.status, 'planned');

  assert.equal(await campaigns.getCampaignFor(OTHER, added.id), null);
  assert.equal(await campaigns.updateCampaignFor(OTHER, added.id, { name: 'Mine now' }), null);
  assert.equal(await campaigns.removeCampaignFor(OTHER, added.id), false);
  assert.equal((await campaigns.listCampaignsFor(OTHER)).length, 0);

  const changed = await campaigns.updateCampaignFor(OWNER, added.id, { offer: 'Two for one' });
  assert.equal(changed?.offer, 'Two for one');
  assert.equal(changed?.goal, autumn.goal, 'a change keeps the fields it was not sent');
  const found = await campaigns.getCampaignFor(OWNER, added.id);
  assert.equal(found?.campaign.name, 'Autumn series');
  assert.deepEqual(found?.steps, []);
});

test('a campaign needs a name and its days, the last on or after the first', async () => {
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, name: ' ' }), 'refuse.campaign.name');
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, name: 'x'.repeat(LIMITS.name + 1) }), 'refuse.campaign.name');
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, startsOn: undefined }), 'refuse.campaign.days');
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, endsOn: '2026-10-31' }), 'refuse.campaign.days');
  assert.equal((await campaigns.addCampaignFor(OWNER, { ...autumn, endsOn: '2026-11-01' })).endsOn, '2026-11-01', 'one day long');
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, endsOn: '2026-11-31' }), 'refuse.campaign.days');
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, doneEarly: 'yes' }), 'refuse.campaign.doneEarly');
  await refusedWith(campaigns.addCampaignFor(OWNER, { ...autumn, notes: 'n'.repeat(LIMITS.notes + 1) }), 'refuse.campaign.notes');

  const stored = await campaigns.addCampaignFor(OWNER, autumn);
  await refusedWith(campaigns.updateCampaignFor(OWNER, stored.id, { endsOn: '2026-10-31' }), 'refuse.campaign.days');
  await refusedWith(campaigns.updateCampaignFor(OWNER, stored.id, { startsOn: '2026-11-16' }), 'refuse.campaign.days');
  assert.equal((await campaigns.updateCampaignFor(OWNER, stored.id, { startsOn: '2026-11-15' }))?.startsOn, '2026-11-15');
});

test('the status comes from the days and the done-early mark', () => {
  const days = { startsOn: '2026-11-01', endsOn: '2026-11-15', doneEarly: false };
  assert.equal(campaigns.campaignStatus(days, '2026-10-31'), 'planned');
  assert.equal(campaigns.campaignStatus(days, '2026-11-01'), 'running');
  assert.equal(campaigns.campaignStatus(days, '2026-11-15'), 'running');
  assert.equal(campaigns.campaignStatus(days, '2026-11-16'), 'done');
  assert.equal(campaigns.campaignStatus({ ...days, doneEarly: true }, '2026-11-02'), 'done');
  assert.equal(campaigns.campaignStatus({ ...days, doneEarly: true }, '2026-10-30'), 'done');
});

test('a month lists the campaigns that run on at least one of its days', async () => {
  const owner = 'month-owner';
  const add = (name, startsOn, endsOn) => campaigns.addCampaignFor(owner, { name, startsOn, endsOn });
  await add('Ends the day before', '2030-04-20', '2030-04-30');
  await add('Ends on the first', '2030-04-25', '2030-05-01');
  await add('Inside', '2030-05-10', '2030-05-12');
  await add('Starts on the last', '2030-05-31', '2030-06-05');
  await add('Starts the day after', '2030-06-01', '2030-06-03');
  await add('Spans the month', '2030-04-01', '2030-06-30');
  const may = await campaigns.listCampaignsFor(owner, { month: '2030-05', today: '2030-05-11' });
  assert.deepEqual(may.map((item) => item.name), ['Spans the month', 'Ends on the first', 'Inside', 'Starts on the last']);
  assert.deepEqual(may.map((item) => item.status), ['running', 'done', 'running', 'planned']);
  assert.equal((await campaigns.listCampaignsFor(owner)).length, 6);
  assert.equal((await campaigns.listCampaignsFor(owner))[0].name, 'Starts the day after', 'all campaigns, the latest first');
  await refusedWith(campaigns.listCampaignsFor(owner, { month: '2030-5' }), 'refuse.campaign.month');
});

test('a campaign holds 50 steps: the 49th and 50th are added, the 51st refused', async () => {
  const held = await campaigns.addCampaignFor(OWNER, { ...autumn, name: 'Many steps' });
  for (let index = 1; index <= LIMITS.campaignSteps - 2; index += 1) {
    await campaigns.addCampaignStepFor(OWNER, held.id, { text: `Step ${index}` });
  }
  assert.equal((await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Step 49' }))?.position, 48);
  assert.equal((await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Step 50' }))?.position, 49);
  await refusedWith(campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Step 51' }), 'refuse.campaign.steps');
  const steps = (await campaigns.getCampaignFor(OWNER, held.id))?.steps ?? [];
  assert.equal(steps.length, LIMITS.campaignSteps);
  assert.equal(steps[49].text, 'Step 50');

  const response = await stepsRoute.POST(jsonRequest('POST', { text: 'Step 51' }), context(held.id));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { problem: 'refuse.campaign.steps' });

  await campaigns.removeCampaignStepFor(OWNER, steps[0].id);
  assert.equal((await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Room again' }))?.position, 50);
});

test('a step is changed, moved and removed only by its owner', async () => {
  const held = await campaigns.addCampaignFor(OWNER, { ...autumn, name: 'Steps' });
  const first = await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Write the offer', dueOn: '2026-11-01' });
  const second = await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Ask three customers' });
  const third = await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Post the reminder' });
  assert.equal(first?.dueOn, '2026-11-01');
  assert.equal(second?.dueOn, '');
  assert.equal(second?.done, false);
  assert.equal(await campaigns.addCampaignStepFor(OTHER, held.id, { text: 'Not yours' }), null);
  await refusedWith(campaigns.addCampaignStepFor(OWNER, held.id, { text: '' }), 'refuse.campaign.step');
  await refusedWith(campaigns.addCampaignStepFor(OWNER, held.id, { text: 's'.repeat(LIMITS.campaignStep + 1) }), 'refuse.campaign.step');
  await refusedWith(campaigns.addCampaignStepFor(OWNER, held.id, { text: 'x', dueOn: '2026-13-01' }), 'refuse.campaign.due');

  assert.equal((await campaigns.updateCampaignStepFor(OWNER, second.id, { done: true }))?.done, true);
  assert.equal((await campaigns.updateCampaignStepFor(OWNER, first.id, { dueOn: '' }))?.dueOn, '');
  await refusedWith(campaigns.updateCampaignStepFor(OWNER, first.id, { done: 'yes' }), 'refuse.campaign.done');
  assert.equal(await campaigns.updateCampaignStepFor(OTHER, first.id, { text: 'Mine now' }), null);

  const order = (steps) => steps.map((step) => step.id);
  assert.deepEqual(order(await campaigns.moveCampaignStepFor(OWNER, third.id, 'up')), [first.id, third.id, second.id]);
  assert.deepEqual(order(await campaigns.moveCampaignStepFor(OWNER, third.id, 'up')), [third.id, first.id, second.id]);
  assert.deepEqual(order(await campaigns.moveCampaignStepFor(OWNER, third.id, 'up')), [third.id, first.id, second.id], 'the first stays first');
  assert.deepEqual(order(await campaigns.moveCampaignStepFor(OWNER, second.id, 'down')), [third.id, first.id, second.id], 'the last stays last');
  assert.deepEqual(order(await campaigns.moveCampaignStepFor(OWNER, third.id, 'down')), [first.id, third.id, second.id]);
  assert.equal(await campaigns.moveCampaignStepFor(OTHER, third.id, 'down'), null);
  await refusedWith(campaigns.moveCampaignStepFor(OWNER, third.id, 'sideways'), 'refuse.campaign.direction');

  assert.equal(await campaigns.removeCampaignStepFor(OTHER, first.id), false);
  assert.equal(await campaigns.removeCampaignStepFor(OWNER, first.id), true);
  assert.deepEqual(order((await campaigns.getCampaignFor(OWNER, held.id))?.steps ?? []), [third.id, second.id]);
});

test('removing a campaign removes its steps and leaves its posts with no campaign', async () => {
  const held = await campaigns.addCampaignFor(OWNER, { ...autumn, name: 'To remove' });
  const kept = await campaigns.addCampaignFor(OWNER, { ...autumn, name: 'To keep' });
  await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'One' });
  await campaigns.addCampaignStepFor(OWNER, held.id, { text: 'Two' });
  await campaigns.addCampaignStepFor(OWNER, kept.id, { text: 'Stays' });
  const post = await addPost(OWNER, held.id, '2026-11-03');
  const other = await addPost(OWNER, kept.id, '2026-11-04');
  const theirs = await addPost(OTHER, held.id, '2026-11-05');

  assert.equal(await campaigns.removeCampaignFor(OTHER, held.id), false);
  assert.equal((await modelAction('Post', 'findFirst', { where: { id: post } })).campaignId, held.id, 'another owner removes nothing');

  assert.equal(await campaigns.removeCampaignFor(OWNER, held.id), true);
  assert.equal(await campaigns.getCampaignFor(OWNER, held.id), null);
  const moved = await modelAction('Post', 'findFirst', { where: { id: post } });
  assert.equal(moved.campaignId, null);
  assert.equal(moved.day, '2026-11-03', 'the post keeps its day');
  assert.equal((await modelAction('Post', 'findFirst', { where: { id: other } })).campaignId, kept.id);
  assert.equal((await modelAction('Post', 'findFirst', { where: { id: theirs } })).campaignId, held.id, 'another owner’s post is not touched');
  assert.equal(await modelAction('CampaignStep', 'count', { where: { campaignId: held.id } }), 0);
  assert.equal((await campaigns.getCampaignFor(OWNER, kept.id))?.steps.length, 1);
  assert.equal(await campaigns.removeCampaignFor(OWNER, held.id), false);
});

test('the campaign addresses refuse with keys and answer only the owner’s records', async () => {
  const wrongType = await campaignsRoute.POST(new Request('http://app.test/api/campaigns', { method: 'POST', body: '{}' }));
  assert.deepEqual(await wrongType.json(), { problem: 'refuse.request' });
  const backwards = await campaignsRoute.POST(jsonRequest('POST', { ...autumn, endsOn: '2026-10-01' }));
  assert.equal(backwards.status, 400);
  assert.deepEqual(await backwards.json(), { problem: 'refuse.campaign.days' });

  const created = await campaignsRoute.POST(jsonRequest('POST', { name: 'Route campaign', startsOn: '2031-02-10', endsOn: '2031-03-02' }));
  const { campaign } = await created.json();
  const february = await (await campaignsRoute.GET(new Request('http://app.test/api/campaigns?month=2031-02'))).json();
  assert.deepEqual(february.campaigns.map((item) => item.id), [campaign.id]);
  const badMonth = await campaignsRoute.GET(new Request('http://app.test/api/campaigns?month=31-02'));
  assert.deepEqual(await badMonth.json(), { problem: 'refuse.campaign.month' });

  const step = (await (await stepsRoute.POST(jsonRequest('POST', { text: 'Tell the regulars' }), context(campaign.id))).json()).step;
  assert.equal(step.text, 'Tell the regulars');
  const read = await (await campaignRoute.GET(new Request('http://app.test/x'), context(campaign.id))).json();
  assert.deepEqual(read.steps.map((item) => item.id), [step.id]);
  assert.equal((await (await stepRoute.PATCH(jsonRequest('PATCH', { done: true }), context(step.id))).json()).step.done, true);
  const badMove = await stepRoute.POST(jsonRequest('POST', { action: 'move', direction: 'left' }), context(step.id));
  assert.deepEqual(await badMove.json(), { problem: 'refuse.request' });
  assert.equal((await (await stepRoute.POST(jsonRequest('POST', { action: 'move', direction: 'up' }), context(step.id))).json()).steps.length, 1);

  const theirs = await campaigns.addCampaignFor(OTHER, { name: 'Not yours', startsOn: '2031-02-01', endsOn: '2031-02-02' });
  const theirStep = await campaigns.addCampaignStepFor(OTHER, theirs.id, { text: 'Not yours' });
  const del = () => new Request('http://app.test/x', { method: 'DELETE' });
  assert.equal((await campaignRoute.GET(new Request('http://app.test/x'), context(theirs.id))).status, 404);
  assert.equal((await campaignRoute.PATCH(jsonRequest('PATCH', { name: 'Mine now' }), context(theirs.id))).status, 404);
  assert.equal((await campaignRoute.DELETE(del(), context(theirs.id))).status, 404);
  assert.equal((await stepsRoute.GET(new Request('http://app.test/x'), context(theirs.id))).status, 404);
  assert.equal((await stepsRoute.POST(jsonRequest('POST', { text: 'Sneaked in' }), context(theirs.id))).status, 404);
  assert.equal((await stepRoute.PATCH(jsonRequest('PATCH', { done: true }), context(theirStep.id))).status, 404);
  assert.equal((await stepRoute.POST(jsonRequest('POST', { action: 'move', direction: 'up' }), context(theirStep.id))).status, 404);
  assert.equal((await stepRoute.DELETE(del(), context(theirStep.id))).status, 404);
  assert.equal((await campaigns.getCampaignFor(OTHER, theirs.id))?.steps[0].done, false);

  assert.deepEqual(await (await campaignRoute.DELETE(del(), context(campaign.id))).json(), { ok: true });
  assert.equal((await campaignRoute.GET(new Request('http://app.test/x'), context(campaign.id))).status, 404);
  assert.equal((await campaignRoute.GET(new Request('http://app.test/x'), context('0'))).status, 404);
});

/* ---------------------------------------------------------- Tellop's bounds */

/**
 * Inside Tellop every records call goes through its records route: at most
 * 256 rows a statement, 256 KiB a call (a `modelBatch` counted whole), 2,048
 * values in a statement's answer (a list counts one, a row its fields and two
 * more), 256 values in a list it is sent, 32 steps a batch and 16 calls a
 * request. The local store has none of these, so here the route's hook runs
 * each call on the local store and measures it.
 */
const { bounded, measured } = await import('./records-bounds.mjs');

/** The longest words a field takes, in two-byte letters. */
const longest = (count) => 'ş'.repeat(count);

test('the largest lists with the longest words stay within Tellop\'s bounds: each read and the addresses', async () => {
  const at = new Date().toISOString();
  const campaign = (index, startsOn) => ({
    ownerId: OWNER, name: longest(LIMITS.name), goal: longest(LIMITS.profileField), offer: longest(LIMITS.profileField),
    notes: longest(LIMITS.notes), startsOn, endsOn: '2033-12-31', doneEarly: index % 2 === 0, createdAt: at, updatedAt: at,
  });
  // More campaigns than one list answers, all running in June 2033, on few first days (pages end inside a day).
  const firsts = ['2033-01-01', '2033-03-01', '2033-06-01', '2033-06-30'];
  await modelAction('Campaign', 'createMany', {
    data: Array.from({ length: campaigns.MOST_CAMPAIGNS + 10 }, (_, index) => campaign(index, firsts[index % firsts.length])),
  });
  await modelAction('Campaign', 'createMany', { data: [{ ...campaign(0, '2033-06-01'), ownerId: OTHER }, campaign(1, '2033-07-01')] });

  /** The ids a list should answer, in its order. */
  const expected = async (where, direction, count) => (await modelAction('Campaign', 'findMany', {
    where, orderBy: [{ startsOn: direction }, { id: direction }], select: { id: true }, take: count,
  })).map((row) => row.id);

  const every = await measured(() => campaigns.listCampaignsFor(OWNER));
  bounded(every, 'every campaign', 4);
  assert.deepEqual(every.value.map((item) => item.id), await expected({ ownerId: OWNER }, 'desc', campaigns.MOST_CAMPAIGNS));
  assert.equal(every.value[0].notes, longest(LIMITS.notes));

  const june = { ownerId: OWNER, startsOn: { lt: '2033-07-01' }, endsOn: { gte: '2033-06-01' } };
  const month = await measured(() => campaigns.listCampaignsFor(OWNER, { month: '2033-06' }));
  bounded(month, 'a month\'s campaigns', 1);
  assert.deepEqual(month.value.map((item) => item.id), await expected(june, 'asc', campaigns.MONTH_CAMPAIGNS));

  // A campaign with the most steps, each with the longest words.
  const full = month.value[0];
  await modelAction('CampaignStep', 'createMany', {
    data: Array.from({ length: LIMITS.campaignSteps }, (_, index) => ({ ownerId: OWNER, campaignId: full.id, text: longest(LIMITS.campaignStep), dueOn: '2033-06-15', position: index })),
  });
  const one = await measured(() => campaigns.getCampaignFor(OWNER, full.id));
  bounded(one, 'one campaign with its steps', 2);
  assert.equal(one.value.steps.length, LIMITS.campaignSteps);
  const moved = await measured(() => campaigns.moveCampaignStepFor(OWNER, one.value.steps[1].id, 'up'));
  bounded(moved, 'a step moved', 4);
  assert.equal(moved.value[0].id, one.value.steps[1].id);
  const refused = await measured(() => assert.rejects(campaigns.addCampaignStepFor(OWNER, full.id, { text: 'One more' }), (error) => error instanceof DataError));
  bounded(refused, 'a step past the most', 2);

  // The addresses.
  const everyAddress = await measured(async () => (await campaignsRoute.GET(new Request('http://app.test/api/campaigns'))).json());
  bounded(everyAddress, 'GET /api/campaigns', 4);
  assert.equal(everyAddress.value.campaigns.length, campaigns.MOST_CAMPAIGNS);
  const monthAddress = await measured(async () => (await campaignsRoute.GET(new Request('http://app.test/api/campaigns?month=2033-06'))).json());
  bounded(monthAddress, 'GET /api/campaigns?month', 1);
  assert.equal(monthAddress.value.campaigns.length, campaigns.MONTH_CAMPAIGNS);
  const oneAddress = await measured(async () => (await campaignRoute.GET(new Request('http://app.test/x'), context(full.id))).json());
  // The campaign with its steps (2), the plan (2) and its posts (none here: 1).
  bounded(oneAddress, 'GET /api/campaigns/[id]', 5);
  assert.equal(oneAddress.value.steps.length, LIMITS.campaignSteps);
  assert.deepEqual(oneAddress.value.posts, []);
  const stepsAddress = await measured(async () => (await stepsRoute.GET(new Request('http://app.test/x'), context(full.id))).json());
  bounded(stepsAddress, 'GET /api/campaigns/[id]/steps', 2);
  assert.equal(stepsAddress.value.steps.length, LIMITS.campaignSteps);
  const changed = await measured(async () => (await campaignRoute.PATCH(jsonRequest('PATCH', { notes: longest(LIMITS.notes) }), context(full.id))).json());
  bounded(changed, 'PATCH /api/campaigns/[id]', 3);
  assert.equal(changed.value.campaign.notes, longest(LIMITS.notes));
});

test('GET /api/campaigns/[id] answers the campaign\'s posts as tiles, the owner\'s only, and stays within Tellop\'s bounds at its largest', async () => {
  const at = new Date().toISOString();
  const run = await campaigns.addCampaignFor(OWNER, { name: 'Spring', startsOn: '2034-03-01', endsOn: '2034-03-31' });
  await modelAction('Profile', 'upsert', { where: { ownerId: OWNER }, create: { ownerId: OWNER, networks: 'instagram,x', createdAt: at, updatedAt: at }, update: { networks: 'instagram,x' } });
  const idea = await modelAction('Post', 'create', { data: { ownerId: OWNER, name: 'Idea', campaignId: run.id, createdAt: at, updatedAt: at } });
  const dated = await modelAction('Post', 'create', { data: { ownerId: OWNER, name: 'Dated', day: '2034-03-02', campaignId: run.id, mainText: 'Words', createdAt: at, updatedAt: at } });
  await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', campaignId: run.id, createdAt: at, updatedAt: at } });
  const small = await (await campaignRoute.GET(new Request('http://app.test/x'), context(run.id))).json();
  assert.deepEqual(small.posts.map((tile) => tile.id), [dated.id, idea.id], 'by day, ideas last');
  assert.equal(small.campaign.id, run.id);
  assert.deepEqual(small.steps, []);
  assert.deepEqual(small.posts[0].networks, ['instagram', 'x'], 'state follows the plan\'s networks');
  assert.equal(typeof small.posts[0].state, 'string');

  // The most posts a campaign shows, with the longest names, each with versions on both networks.
  await modelAction('Post', 'createMany', {
    data: Array.from({ length: 300 }, (_, index) => ({ ownerId: OWNER, name: longest(LIMITS.name), day: `2034-04-${String((index % 30) + 1).padStart(2, '0')}`, campaignId: run.id, createdAt: at, updatedAt: at })),
  });
  const largest = await measured(async () => (await campaignRoute.GET(new Request('http://app.test/x'), context(run.id))).json());
  bounded(largest, 'GET /api/campaigns/[id] with its posts', 12);
  assert.equal(largest.value.posts.length, 256);
  assert.equal(largest.value.posts[0].id, dated.id);
});

/* ---------------------------------------------------------- Offer codes */

const planRoute = await import('../app/api/campaigns/[id]/plan/route.js');
const { readResults } = await import('../app/results/read.js');
const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
const { MOST_A_MONTH } = await import('../lib/data/posts.js');
const { mostInFlight } = await import('./records-bounds.mjs');
const { getLocale, t } = await import('../lib/i18n/index.js');
const { planPostName } = await import('../lib/plan/campaign-plans.js');
/** A plan post's fixed name in the words the addresses use. */
const fixedName = (kind, key, name) => planPostName(kind, key, name, (words, values) => t(words, getLocale(), values));

test('an offer code is 2 to 24 letters or digits, kept in capitals; empty clears it; an older campaign reads none', async () => {
  const owner = 'code-owner';
  const base = { name: 'Winter sale', startsOn: '2031-01-01', endsOn: '2031-01-31' };
  assert.equal((await campaigns.addCampaignFor(owner, base)).code, '', 'none when not sent');
  assert.equal((await campaigns.addCampaignFor(owner, { ...base, code: ' kış20 ' })).code, 'KIŞ20');
  assert.equal((await campaigns.addCampaignFor(owner, { ...base, code: 'ab' })).code, 'AB', 'two: the least');
  assert.equal((await campaigns.addCampaignFor(owner, { ...base, code: 'a'.repeat(24) })).code, 'A'.repeat(24), 'twenty-four: the most');
  for (const code of ['a', 'a'.repeat(25), 'KIŞ 20', 'KIS-20', 'ß'.repeat(13), 7]) {
    await refusedWith(campaigns.addCampaignFor(owner, { ...base, code }), 'refuse.campaign.code');
  }
  assert.equal((await campaigns.addCampaignFor(owner, { ...base, code: 'ß'.repeat(12) })).code, 'SS'.repeat(12), 'capitals that grow to the most still fit');

  const kept = await campaigns.addCampaignFor(OWNER, { ...base, code: 'yaz' });
  const patched = await (await campaignRoute.PATCH(jsonRequest('PATCH', { code: 'güz25' }), context(kept.id))).json();
  assert.equal(patched.campaign.code, 'GÜZ25');
  assert.equal(patched.campaign.name, 'Winter sale', 'a change keeps the fields it was not sent');
  const refused = await campaignRoute.PATCH(jsonRequest('PATCH', { code: 'x' }), context(kept.id));
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { problem: 'refuse.campaign.code' });
  assert.equal((await campaigns.updateCampaignFor(OWNER, kept.id, { code: '' }))?.code, '');
  assert.equal((await campaigns.updateCampaignFor(OWNER, kept.id, { code: null }))?.code, '');

  const at = new Date().toISOString();
  const older = await modelAction('Campaign', 'create', { data: { ownerId: owner, name: 'Before codes', startsOn: '2031-02-01', endsOn: '2031-02-02', createdAt: at, updatedAt: at } });
  assert.equal(older.code ?? null, null, 'stored with no code at all');
  assert.equal((await campaigns.getCampaignFor(owner, older.id))?.campaign.code, '');
  assert.equal((await campaigns.listCampaignsFor(owner, { month: '2031-02' }))[0].code, '');
});

test('campaign names for tracking: the owner\'s only, in one call, none without an id', async () => {
  const mine = await campaigns.addCampaignFor('names-owner', { name: 'Spring', startsOn: '2031-03-01', endsOn: '2031-03-02' });
  const theirs = await campaigns.addCampaignFor(OTHER, { name: 'Theirs', startsOn: '2031-03-01', endsOn: '2031-03-02' });
  const read = await measured(() => campaigns.campaignNamesFor('names-owner', [mine.id, theirs.id, mine.id, null, 'x', 0]));
  bounded(read, 'campaign names', 1);
  assert.deepEqual(read.value, [{ id: mine.id, name: 'Spring' }]);
  const none = await measured(() => campaigns.campaignNamesFor('names-owner', [null, undefined]));
  assert.deepEqual([none.value, none.calls.length], [[], 0], 'no call');
});

/* ---------------------------------------------------------- Plan the posts */

/** Runs `work` with AI set up as a stand-in (`answer` answers each request); a guard `fetch` refuses anything else. */
async function withAI(answer, work) {
  const guard = globalThis.fetch;
  const asked = [];
  process.env.AI_BASE_URL = 'http://ai.stand-in.invalid/v1';
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    return answer(asked.length);
  };
  try {
    return await work(asked);
  } finally {
    globalThis.fetch = guard;
    delete process.env.AI_BASE_URL;
  }
}
const chat = (content) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const planned = async (id, kind) => {
  const response = await planRoute.POST(jsonRequest('POST', { kind }), context(id));
  return { status: response.status, body: await response.json() };
};
const postsOf = (owner, campaignId) => modelAction('Post', 'findMany', {
  where: { ownerId: owner, campaignId }, orderBy: [{ day: 'asc' }, { id: 'asc' }], select: { id: true, name: true, day: true, ask: true, themeId: true, madeBy: true },
});

test('Plan the posts: a sale skips a day that holds a post and a day of remembrance, takes the theme in use, asks to buy', async () => {
  for (const name of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_MODEL_QUICK', 'TELLOP_INTERNAL_RECORDS']) delete process.env[name];
  const at = new Date().toISOString();
  // A sale from 1 to 10 November 2031: 10 November is a day of remembrance in Türkiye (shown for every choice of days but "world").
  const sale = await campaigns.addCampaignFor(OWNER, { name: 'Kış İndirimi', startsOn: '2031-11-01', endsOn: '2031-11-10' });
  const inUse = await modelAction('Theme', 'create', { data: { ownerId: OWNER, name: 'Offers', colour: 1, position: 1, createdAt: at, updatedAt: at } });
  const archived = await modelAction('Theme', 'create', { data: { ownerId: OWNER, name: 'Old', colour: 2, position: 2, archived: true, createdAt: at, updatedAt: at } });
  // The campaign's posts: two on the archived theme (more, but not in use) and one on the theme in use, on 4 November.
  await modelAction('Post', 'createMany', { data: [
    { ownerId: OWNER, name: 'Old one', campaignId: sale.id, themeId: archived.id, createdAt: at, updatedAt: at },
    { ownerId: OWNER, name: 'Old two', campaignId: sale.id, themeId: archived.id, createdAt: at, updatedAt: at },
    { ownerId: OWNER, name: 'Held', day: '2031-11-04', campaignId: sale.id, themeId: inUse.id, createdAt: at, updatedAt: at },
  ] });
  // Another owner's post on 7 November takes nothing from this owner.
  await modelAction('Post', 'create', { data: { ownerId: OTHER, name: 'Theirs', day: '2031-11-07', createdAt: at, updatedAt: at } });

  const run = await measured(() => planned(sale.id, 'sale'));
  bounded(run, 'Plan the posts', 3);
  assert.ok(mostInFlight(run) <= 1, 'one call at a time');
  const { status, body } = run.value;
  assert.equal(status, 201);
  assert.equal(body.ai, false);
  assert.equal(typeof body.aiProblem, 'string', 'without AI: its problem, and the fixed names');
  assert.deepEqual(body.posts.map((item) => [item.day, item.ask, item.themeId, item.campaignId]), [
    ['2031-11-01', 'buy', inUse.id, sale.id],
    ['2031-11-07', 'buy', inUse.id, sale.id],
  ]);
  assert.deepEqual(body.posts.map((item) => item.name), [fixedName('sale', 'announce', 'Kış İndirimi'), fixedName('sale', 'halfway', 'Kış İndirimi')]);
  assert.deepEqual(body.skipped, [{ key: 'bestPick', day: '2031-11-04', reason: 'taken' }, { key: 'lastDay', day: '2031-11-10', reason: 'remembrance' }]);
  assert.deepEqual((await postsOf(OWNER, sale.id)).filter((item) => item.day !== null).map((item) => [item.day, item.madeBy]), [
    ['2031-11-01', 'person'], ['2031-11-04', 'person'], ['2031-11-07', 'person'],
  ]);

  // Pressed again: every planned day holds a post now; nothing is added and AI is not asked.
  await withAI(() => chat('{"names": []}'), async (asked) => {
    const again = await planned(sale.id, 'sale');
    assert.equal(again.status, 201);
    assert.deepEqual(again.body.posts, []);
    assert.deepEqual(again.body.skipped.map((item) => item.reason), ['taken', 'taken', 'taken', 'remembrance']);
    assert.equal(asked.length, 0, 'no post to name: no AI request');
  });
});

test('Plan the posts: AI only rewrites the names; an answer that does not read keeps the fixed ones', async () => {
  for (const name of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_MODEL_QUICK', 'TELLOP_INTERNAL_RECORDS']) delete process.env[name];
  const owner = OWNER;
  // A launch from 3 to 8 November 2032 (six days, one post each); 10 November is outside it.
  const launch = await campaigns.addCampaignFor(owner, { name: 'Glaze kit', startsOn: '2032-11-03', endsOn: '2032-11-08', offer: 'Free brush' });
  await withAI(() => chat(JSON.stringify({ names: ['Peek', 'Studio', 'It is out', 'How to', 'First buyer', '#'] })), async (asked) => {
    const { status, body } = await planned(launch.id, 'launch');
    assert.equal(status, 201);
    assert.equal(body.ai, true);
    assert.equal(asked.length, 1, 'one request');
    assert.ok(asked[0].body.messages[1].content.includes('Free brush'), 'the campaign goes as content');
    assert.deepEqual(body.posts.map((item) => item.name), ['Peek', 'Studio', 'It is out', 'How to', 'First buyer', fixedName('launch', 'lastCall', 'Glaze kit')], 'a name that does not read keeps its fixed one');
    assert.deepEqual(body.posts.map((item) => item.ask), Array(6).fill('visit'));
    assert.deepEqual(body.posts.map((item) => item.day), ['2032-11-03', '2032-11-04', '2032-11-05', '2032-11-06', '2032-11-07', '2032-11-08']);
    assert.deepEqual((await postsOf(owner, launch.id)).map((item) => item.madeBy), Array(6).fill('ai'));
  });

  const event = await campaigns.addCampaignFor(owner, { name: 'Open studio', startsOn: '2032-12-01', endsOn: '2032-12-09' });
  await withAI(() => chat('{"names": ["only one"]}'), async () => {
    const { body } = await planned(event.id, 'event');
    assert.equal(body.ai, false);
    assert.equal(body.aiProblem, 'aiplan.unreadable');
    assert.deepEqual(body.posts.map((item) => item.name), ['saveTheDate', 'whatToExpect', 'countdown', 'onTheDay', 'thankYou'].map((key) => fixedName('event', key, 'Open studio')));
    assert.deepEqual(body.posts.map((item) => item.day).slice(-2), ['2032-12-09', '2032-12-10'], 'the day on its last day, the thanks the day after');
    assert.deepEqual(body.posts.map((item) => item.ask), Array(5).fill('book'));
  });
});

test('Plan the posts refuses a kind that is not one, a campaign that is over, another owner\'s, and a month past its posts', async () => {
  const at = new Date().toISOString();
  const open = await campaigns.addCampaignFor(OWNER, { name: 'Open', startsOn: '2033-02-01', endsOn: '2033-02-03' });
  for (const kind of ['promo', '', null, undefined]) {
    const { status, body } = await planned(open.id, kind);
    assert.deepEqual([status, body.problem], [400, 'refuse.campaign.planKind'], String(kind));
  }
  const early = await campaigns.addCampaignFor(OWNER, { name: 'Stopped', startsOn: '2033-02-01', endsOn: '2033-02-03', doneEarly: true });
  assert.deepEqual(await planned(early.id, 'sale'), { status: 400, body: { problem: 'refuse.campaign.over' } });
  const past = await campaigns.addCampaignFor(OWNER, { name: 'Past', startsOn: '2020-02-01', endsOn: '2020-02-03' });
  assert.deepEqual(await planned(past.id, 'sale'), { status: 400, body: { problem: 'refuse.campaign.over' } });
  const theirs = await campaigns.addCampaignFor(OTHER, { name: 'Theirs', startsOn: '2033-02-01', endsOn: '2033-02-03' });
  assert.equal((await planned(theirs.id, 'sale')).status, 404);
  assert.equal((await planned('x', 'sale')).status, 404);

  // March 2033 holds one post fewer than the most: a sale over its first two days would add two, so it adds none.
  await modelAction('Post', 'createMany', { data: Array.from({ length: MOST_A_MONTH - 1 }, (_, index) => ({
    ownerId: OWNER, name: 'Full', day: `2033-03-${String((index % 20) + 10).padStart(2, '0')}`, createdAt: at, updatedAt: at,
  })) });
  const full = await campaigns.addCampaignFor(OWNER, { name: 'Too many', startsOn: '2033-03-01', endsOn: '2033-03-02' });
  assert.deepEqual(await planned(full.id, 'sale'), { status: 400, body: { problem: 'refuse.post.monthFull' } });
  assert.equal((await postsOf(OWNER, full.id)).length, 0, 'nothing kept');
  const one = await campaigns.addCampaignFor(OWNER, { name: 'Just one', startsOn: '2033-03-01', endsOn: '2033-03-01' });
  const fits = await planned(one.id, 'sale');
  assert.deepEqual([fits.status, fits.body.posts.length], [201, 1], 'exactly the most fits');
});

test('Plan the posts: no post on a day of remembrance whatever the kind (a launch from 8 to 12 November, an event from 5 to 11)', async () => {
  for (const name of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_MODEL_QUICK', 'TELLOP_INTERNAL_RECORDS']) delete process.env[name];
  // 10 November is a day of remembrance in Türkiye (2035 for the launch, 2037 for the event: the launch's posts would take its days).
  const launch = await campaigns.addCampaignFor(OWNER, { name: 'Glaze', startsOn: '2035-11-08', endsOn: '2035-11-12' });
  const launched = await planned(launch.id, 'launch');
  assert.equal(launched.status, 201);
  assert.deepEqual(launched.body.posts.map((item) => [item.day, item.ask]), [['2035-11-08', 'visit'], ['2035-11-09', 'visit'], ['2035-11-11', 'visit'], ['2035-11-12', 'visit']]);
  assert.deepEqual(launched.body.skipped, [{ key: 'launchDay', day: '2035-11-10', reason: 'remembrance' }]);

  const event = await campaigns.addCampaignFor(OWNER, { name: 'Open day', startsOn: '2037-11-05', endsOn: '2037-11-11' });
  const evented = await planned(event.id, 'event');
  assert.equal(evented.status, 201);
  assert.deepEqual(evented.body.skipped, [{ key: 'countdown', day: '2037-11-10', reason: 'remembrance' }]);
  assert.deepEqual(evented.body.posts.map((item) => item.day), ['2037-11-05', '2037-11-08', '2037-11-11', '2037-11-12'], 'the day on its last day, the thanks after');
  assert.ok((await postsOf(OWNER, event.id)).every((item) => item.day !== '2037-11-10'), 'nothing kept on the day');

  // A person who shows only the world's days has no day of remembrance on 10 November: the launch day stays.
  const world = 'world-days-owner';
  await modelAction('Profile', 'create', { data: { ownerId: world, showDays: 'world', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  const theirs = await campaigns.addCampaignFor(world, { name: 'Glaze', startsOn: '2035-11-08', endsOn: '2035-11-12' });
  const plan = await campaigns.campaignPlanFor(world, theirs.id, 'launch', { today: '2035-10-01' });
  assert.deepEqual(plan?.skipped, []);
  assert.ok(plan?.slots.some((slot) => slot.day === '2035-11-10' && slot.key === 'launchDay'));
});

test('Plan the posts: when the campaign\'s posts give no theme, a sale takes the first theme in use that sells, else the first in use; a launch or an event the first in use', async () => {
  const owner = 'plan-theme-owner';
  const at = new Date().toISOString();
  const theme = async (name, position, fields = {}) => Number((await modelAction('Theme', 'create', { data: { ownerId: owner, name, colour: 0, position, createdAt: at, updatedAt: at, ...fields } })).id);
  const options = { today: '2036-01-01' };
  const sale = await campaigns.addCampaignFor(owner, { name: 'Spring sale', startsOn: '2036-03-01', endsOn: '2036-03-10' });
  assert.equal((await campaigns.campaignPlanFor(owner, sale.id, 'sale', options))?.themeId, null, 'no theme at all: none');

  const tips = await theme('Tips', 2);
  assert.equal((await campaigns.campaignPlanFor(owner, sale.id, 'sale', options))?.themeId, tips, 'none sells: the first in use');
  await theme('Old offers', 0, { archived: true, sells: true });
  await theme('Older', 1, { sells: null });
  const offers = await theme('Offers', 3, { sells: true });
  await theme('More offers', 4, { sells: true });
  const older = (await modelAction('Theme', 'findFirst', { where: { ownerId: owner, name: 'Older' }, select: { id: true } })).id;

  const plan = await campaigns.campaignPlanFor(owner, sale.id, 'sale', options);
  assert.equal(plan?.themeId, offers, 'a sale: the first in use that sells (never an archived one)');
  for (const kind of ['launch', 'event']) {
    assert.equal((await campaigns.campaignPlanFor(owner, sale.id, kind, options))?.themeId, Number(older), `${kind}: the first in use by its place`);
  }
  // Kept, the posts carry it.
  const kept = await campaigns.keepCampaignPlanFor(owner, plan, plan.slots.map((slot) => slot.key));
  assert.ok(kept.length > 0 && kept.every((item) => item.themeId === offers));
  // The campaign's own posts decide once they hold a theme in use.
  const again = await campaigns.campaignPlanFor(owner, sale.id, 'launch', options);
  assert.equal(again?.themeId, offers, 'the theme its posts use most');
});

test('Plan the posts: a campaign named with emoji is planned, never refused after AI was asked', async () => {
  const name = `Kış${'🎉'.repeat(37)}`;
  const emoji = await campaigns.addCampaignFor(OWNER, { name, startsOn: '2036-05-04', endsOn: '2036-05-09' });
  await withAI(() => chat('{"names": ["only one"]}'), async (asked) => {
    const { status, body } = await planned(emoji.id, 'launch');
    assert.equal(status, 201);
    assert.equal(asked.length, 1, 'AI was asked');
    assert.equal(body.posts.length, 6);
    for (const item of body.posts) {
      assert.ok(item.name.includes('Kış🎉'), item.name);
      assert.ok(new TextEncoder().encode(JSON.stringify(item.name)).length - 2 <= 2 * LIMITS.name);
    }
  });
});

/* ---------------------------------------------------------- Results by code */

test('Results by code says it is partial when a read of codes comes back full, and only then', async () => {
  const at = new Date().toISOString();
  const { CODE_ROWS } = await import('../lib/data/results.js');
  const owner = 'code-partial';
  const enquiries = (count, month, prefix) => Array.from({ length: count }, (_, index) => ({
    ownerId: owner, name: 'Customer', channel: 'instagram', status: 'new', code: `${prefix}${String(index).padStart(3, '0')}`,
    receivedOn: `${month}-05`, createdAt: at, updatedAt: at,
  }));
  await campaigns.addCampaignFor(owner, { name: 'One', startsOn: '2036-01-01', endsOn: '2036-12-31', code: 'AA000' });
  // One row fewer than a month's read of codes takes: whole.
  await modelAction('Enquiry', 'createMany', { data: enquiries(CODE_ROWS - 1, '2036-06', 'AA') });
  const whole = await readResults('2036-06', owner, { now: '2040-01-01T00:00:00.000Z' });
  assert.equal(whole.byCode.partial, false);
  assert.deepEqual(whole.byCode.rows.map((row) => row.code), ['AA000']);
  // Exactly as many: the read came back full and may have left a code out.
  await modelAction('Enquiry', 'createMany', { data: enquiries(CODE_ROWS, '2036-08', 'BB') });
  assert.equal((await readResults('2036-08', owner, { now: '2040-01-01T00:00:00.000Z' })).byCode.partial, true);
  // The month before counts too (its own read).
  assert.equal((await readResults('2036-09', owner, { now: '2040-01-01T00:00:00.000Z' })).byCode.partial, true);
  assert.equal((await readResults('2036-11', owner, { now: '2040-01-01T00:00:00.000Z' })).byCode.partial, false);
});

test('Results by code: the month\'s customers whose code a campaign has, whatever its capitals, with the month before', async () => {
  const owner = 'code-results';
  const at = new Date().toISOString();
  const winter = await campaigns.addCampaignFor(owner, { name: 'Winter sale', startsOn: '2034-01-01', endsOn: '2034-02-28', code: 'kış20' });
  await campaigns.addCampaignFor(owner, { name: 'Unused', startsOn: '2034-01-01', endsOn: '2034-01-02', code: 'NONE1' });
  await campaigns.addCampaignFor(OTHER, { name: 'Theirs', startsOn: '2034-01-01', endsOn: '2034-01-02', code: 'THEIRS' });
  const enquiry = (fields) => ({ ownerId: owner, name: 'Customer', channel: 'instagram', status: 'new', createdAt: at, updatedAt: at, ...fields });
  await modelAction('Enquiry', 'createMany', { data: [
    enquiry({ code: 'KIŞ20', status: 'bought', amount: 300, receivedOn: '2034-02-03' }),
    enquiry({ code: 'kiş20', receivedOn: '2034-02-04' }),
    enquiry({ code: 'KİŞ20', status: 'bought', amount: 100, receivedOn: '2034-02-05' }),
    enquiry({ code: 'kış20', receivedOn: '2034-01-20' }),
    enquiry({ code: 'OTHER', receivedOn: '2034-02-06' }),
    enquiry({ code: '', receivedOn: '2034-02-07' }),
    enquiry({ receivedOn: '2034-02-08' }),
    { ...enquiry({ code: 'THEIRS', receivedOn: '2034-02-03' }), ownerId: OTHER },
  ] });
  const read = await measured(() => readResults('2034-02', owner, { now: '2040-01-01T00:00:00.000Z' }));
  bounded(read, 'Results', 10);
  assert.deepEqual(read.value.byCode, { rows: [{ code: 'KIŞ20', name: 'Winter sale', customers: { value: 3, last: 1 }, sales: { value: 400, last: 0 } }], partial: false });
  assert.equal(read.value.totals.customers.value, 6, 'the totals still count every customer');
  assert.equal(winter.code, 'KIŞ20');
});

test('Results by code at its largest stays inside every records bound and within ten calls', async (t) => {
  const owner = 'code-largest';
  const stamp = new Date().toISOString();
  const longest = (count) => 'Ş'.repeat(count);
  const [month, last] = ['2035-03', '2035-02'];
  const day = (which, index) => `${which}-${String((index % 28) + 1).padStart(2, '0')}`;
  const instant = (text, hour) => {
    const [year, number, date] = text.split('-').map(Number);
    return new Date(year, number - 1, date, hour, 0).toISOString();
  };
  // The largest Results month (as its own check builds it) and, beside it, the most campaigns with a code and the most code rows a month.
  const make = async (count, which) => {
    const tag = `${stamp}#${which ?? 'idea'}`;
    await modelAction('Post', 'createMany', { data: Array.from({ length: count }, (_, index) => ({
      ownerId: owner, name: longest(LIMITS.name), day: which === null ? null : day(which, index), ask: 'message', createdAt: stamp, updatedAt: tag,
    })) });
    return modelAction('Post', 'findMany', { where: { ownerId: owner, updatedAt: tag }, select: { id: true, day: true }, orderBy: { id: 'asc' } });
  };
  const thisMonth = await make(256, month);
  const lastMonth = await make(256, last);
  const named = await make(700, null);
  for (const [rows, which] of [[thisMonth, month], [lastMonth, last]]) {
    await modelAction('PostVersion', 'createMany', { data: rows.flatMap((row, index) => NETWORK_KEYS.map((network, place) => ({
      ownerId: owner, postId: row.id, network, text: 'Words', sharedAt: instant(row.day, place), likes: index, comments: 1, shares: 2, saves: 3, views: 1000, clicks: 9, updatedAt: stamp,
    }))) });
    await modelAction('Enquiry', 'createMany', { data: named.map((row, index) => ({
      ownerId: owner, name: longest(LIMITS.name), channel: NETWORK_KEYS[index % NETWORK_KEYS.length], postId: row.id, status: ['bought', 'new', 'talking', 'not-now'][index % 4], amount: 1000,
      code: `${longest(20)}${String(index % 60).padStart(4, '0')}`, receivedOn: day(which, index), createdAt: stamp, updatedAt: stamp,
    })) });
  }
  await modelAction('Campaign', 'createMany', { data: Array.from({ length: campaigns.CODES_MOST + 20 }, (_, index) => ({
    ownerId: owner, name: longest(LIMITS.name), startsOn: '2035-01-01', endsOn: '2035-12-31', code: `${longest(20)}${String(index).padStart(4, '0')}`, createdAt: stamp, updatedAt: stamp,
  })) });
  const read = await measured(() => readResults(month, owner, { now: '2040-01-01T00:00:00.000Z' }));
  bounded(read, 'Results at its largest, with codes', 10);
  assert.ok(mostInFlight(read) <= 1);
  assert.ok(read.value.byCode.rows.length > 0 && read.value.byCode.rows.length <= campaigns.CODES_MOST);
  assert.ok(read.value.byCode.rows.every((row) => row.customers.value > 0 || row.customers.last > 0));
  assert.equal(read.value.byCode.partial, true, 'more campaigns with a code than one read takes: By code says it is partial');
  t.diagnostic(`Results with codes at the largest: ${read.calls.length} calls, largest ${Math.max(...read.calls.map((call) => call.bytes))} bytes`);
});
