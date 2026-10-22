/**
 * The Ideas page's parts: keeping the ideas a person picked (the address and
 * its records function), grouping ideas by theme, the idea starters, and the
 * page's reads staying inside Tellop's records bounds. A throwaway store
 * (`APP_DATA_FILE` in a temporary folder, removed afterwards); rows of another
 * owner are written straight into the store and must never be read or used.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'ideas-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction, modelBatch } = await import('../lib/data/index.js');
const ideas = await import('../lib/data/ideas.js');
const posts = await import('../lib/data/posts.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const keepRoute = await import('../app/api/ideas/keep/route.js');
const groups = await import('../app/ideas/groups.js');
const { readIdeas, IDEAS_SHOWN } = await import('../app/ideas/read.js');
const inspiration = await import('../lib/data/inspiration.js');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const stamp = () => new Date().toISOString();
const names = (count, prefix = 'Idea') => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

async function theme(owner, name = 'Season', colour = 0, position = 1) {
  return modelAction('Theme', 'create', { data: { ownerId: owner, name, colour, position, createdAt: stamp(), updatedAt: stamp() } });
}
async function postCount(owner) {
  return Number(await modelAction('Post', 'count', { where: { ownerId: owner } }));
}

/** @param {unknown} body */
async function keep(body) {
  const request = new Request('http://app.test/api/ideas/keep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await keepRoute.POST(request);
  return { status: response.status, json: await response.json() };
}

test('keeping picked ideas makes ideas with no day, in the theme, in the order picked', async () => {
  const mine = await theme(OWNER, 'Behind the scenes');
  const answer = await keep({ names: ['First', '  Second  ', 'Third'], themeId: mine.id });
  assert.equal(answer.status, 201);
  assert.deepEqual(answer.json.posts.map((post) => post.name), ['First', 'Second', 'Third']);
  for (const post of answer.json.posts) {
    assert.equal(post.day, null);
    assert.equal(post.themeId, mine.id);
    assert.equal(post.madeBy, 'ai');
  }
  const listed = await posts.listIdeasFor(OWNER, [], 3);
  assert.deepEqual(listed.map((tile) => tile.name), ['First', 'Second', 'Third'], 'the newest-first list shows them as picked');

  const plain = await keep({ names: ['No theme here'] });
  assert.equal(plain.status, 201);
  assert.equal(plain.json.posts[0].themeId, null);
  const explicit = await keep({ names: ['Also none'], themeId: null });
  assert.equal(explicit.json.posts[0].themeId, null);
});

test('one to twenty names are kept; none or twenty-one are refused and nothing is saved', async () => {
  const before = await postCount(OWNER);
  const twenty = await keep({ names: names(20), themeId: null });
  assert.equal(twenty.status, 201);
  assert.equal(twenty.json.posts.length, 20);
  assert.equal(await postCount(OWNER), before + 20);

  const one = await keep({ names: ['Only one'], themeId: null });
  assert.equal(one.status, 201);
  assert.equal(one.json.posts.length, 1);

  const counted = await postCount(OWNER);
  const twentyOne = await keep({ names: names(21), themeId: null });
  assert.equal(twentyOne.status, 400);
  assert.deepEqual(twentyOne.json, { problem: 'ideas.refuse.tooMany' });
  const empty = await keep({ names: [], themeId: null });
  assert.equal(empty.status, 400);
  assert.deepEqual(empty.json, { problem: 'ideas.refuse.none' });
  assert.equal(await postCount(OWNER), counted, 'a refused press keeps nothing');
});

test('each name is one line of 1 to the name limit; one bad name refuses the whole press', async () => {
  const counted = await postCount(OWNER);
  const longest = 'ş'.repeat(LIMITS.name);
  const atLimit = await keep({ names: [longest] });
  assert.equal(atLimit.status, 201);
  assert.equal(atLimit.json.posts[0].name, longest);
  const lineBreaks = await keep({ names: ['Two\nlines'] });
  assert.equal(lineBreaks.json.posts[0].name, 'Two lines');

  const overLimit = await keep({ names: ['Fine', 'ş'.repeat(LIMITS.name + 1)] });
  assert.deepEqual(overLimit.json, { problem: 'refuse.text.long' });
  const blank = await keep({ names: ['Fine', '   '] });
  assert.deepEqual(blank.json, { problem: 'refuse.text.missing' });
  const notWords = await keep({ names: ['Fine', 42] });
  assert.deepEqual(notWords.json, { problem: 'refuse.text.missing' });
  assert.equal(await postCount(OWNER), counted + 2, 'only the two good presses saved');
});

test('the request must be the page’s shape, and the theme the owner’s own', async () => {
  const counted = await postCount(OWNER);
  assert.deepEqual((await keep({ names: 'One idea' })).json, { problem: 'refuse.request' });
  assert.deepEqual((await keep({})).json, { problem: 'refuse.request' });
  const theirs = await theme(OTHER, 'Not yours');
  const refusedTheme = await keep({ names: ['Mine'], themeId: theirs.id });
  assert.equal(refusedTheme.status, 400);
  assert.deepEqual(refusedTheme.json, { problem: 'refuse.post.theme' });
  assert.deepEqual((await keep({ names: ['Mine'], themeId: '3' })).json, { problem: 'refuse.post.theme' });
  assert.deepEqual((await keep({ names: ['Mine'], themeId: 0 })).json, { problem: 'refuse.post.theme' });
  const plainText = await keepRoute.POST(new Request('http://app.test/api/ideas/keep', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"names":["x"]}' }));
  assert.equal(plainText.status, 400);
  assert.equal(await postCount(OWNER), counted);
  assert.equal(await postCount(OTHER), 0, 'nothing was kept for the other owner');
});

test('keepIdeasFor names its owner and makes at most two records calls', async () => {
  await assert.rejects(ideas.keepIdeasFor('', ['x'], null), (error) => error instanceof DataError && error.messageKey === 'error.ownerMissing');
  const mine = await theme(OWNER, 'Counted');
  const run = await measured(() => ideas.keepIdeasFor(OWNER, names(20), mine.id));
  assert.equal(run.value.length, 20);
  assert.ok(run.calls.length <= 2, `${run.calls.length} calls`);
  bounded(run.calls, 'keeping twenty ideas');
});

test('ideas group by the plan’s themes in order, then gone themes and no theme last', () => {
  const themes = [{ id: 7, name: 'Product', colour: 2 }, { id: 3, name: 'Customer', colour: 0 }, { id: 9, name: 'Old', colour: 4 }];
  const list = [
    { id: 50, name: 'a', themeId: 3 },
    { id: 49, name: 'b', themeId: null },
    { id: 48, name: 'c', themeId: 7 },
    { id: 47, name: 'd', themeId: 3 },
    { id: 46, name: 'e', themeId: 99 },
  ];
  const grouped = groups.groupIdeas(list, themes);
  assert.deepEqual(grouped.map((group) => group.key), ['7', '3', 'none']);
  assert.deepEqual(grouped[1].ideas.map((idea) => idea.id), [50, 47], 'a group keeps the newest-first order');
  assert.deepEqual(grouped[2].ideas.map((idea) => idea.id), [49, 46], 'a theme that is gone joins no theme');
  assert.equal(grouped[2].themeId, null);
  assert.deepEqual(groups.groupIdeas([], themes), []);
  assert.equal(groups.themeKey(null), 'none');
  assert.equal(groups.themeKey(4), '4');
});

test('a theme’s dot takes one of the five chart colours, and anything else a plain one', () => {
  assert.equal(groups.dotClass(0), 'bg-chart-1');
  assert.equal(groups.dotClass(4), 'bg-chart-5');
  assert.equal(groups.dotClass(5), 'bg-muted-foreground');
  assert.equal(groups.dotClass(-1), 'bg-muted-foreground');
  assert.equal(groups.dotClass(null), 'bg-muted-foreground');
});

test('the idea starters are six kinds of five, each with its own words key', () => {
  assert.deepEqual([...groups.STARTER_KINDS], ['behind', 'made', 'product', 'customer', 'offer', 'question']);
  const keys = groups.STARTER_KINDS.flatMap((kind) => groups.starterKeys(kind));
  assert.equal(keys.length, 30);
  assert.equal(new Set(keys).size, 30);
  assert.ok(keys.every((key) => /^ideas\.starter\.[a-z]+\.[1-5]$/u.test(key)));
});

/** The length of every `in` list in a call's arguments. */
function inLists(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) inLists(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'in' && Array.isArray(item)) found.push(item.length);
      inLists(item, found);
    }
  }
  return found;
}

/** The values one step's answer holds, as Tellop counts them: 1 + rows x (2 + fields). */
function valuesOf(answer) {
  const fields = (row) => (row !== null && typeof row === 'object' ? Object.keys(row).length : 1);
  if (Array.isArray(answer)) return 1 + answer.length * (2 + Math.max(0, ...answer.map(fields)));
  return answer !== null && typeof answer === 'object' ? 1 + 2 + fields(answer) : 1;
}

/**
 * Inside Tellop every records call goes through its records route, which
 * answers at most 256 rows, 2,048 values a step and 256 KB a call, takes at
 * most 32 steps a call and `in` lists of at most 256 items, and allows 16
 * calls a request. Here the route's hook runs each call on the local store
 * and measures it. The store is switched to local only while a call starts
 * (its records client is chosen as it starts), so calls started together
 * (`Promise.all`) still each come through the hook.
 */
const recordsBounds = await import('./records-bounds.mjs');
const { measured } = recordsBounds;
/** Every call within Tellop's bounds (`tests/records-bounds.mjs`), and at most `most` of them. */
const bounded = (calls, what, most) => recordsBounds.bounded({ calls }, what, most);

test('the page’s reads stay inside one call’s rows and size, and a request’s calls, with a full page of ideas and of notes', async () => {
  const mine = await theme(OWNER, 'Busy', 1, 2);
  // Ideas with the longest names and a comment-card picture each: the heaviest page there is.
  const comment = await modelAction('CustomerComment', 'create', {
    data: { ownerId: OWNER, name: 'Ayşe', text: 'ş'.repeat(LIMITS.comment), bestLine: 'ş'.repeat(LIMITS.bestLine), stars: 5, receivedOn: '2026-10-01', permission: 'yes', createdAt: stamp(), updatedAt: stamp() },
  });
  for (let index = 0; index < IDEAS_SHOWN + 5; index += 1) {
    const post = await posts.createPostFor(OWNER, { name: 'ş'.repeat(LIMITS.name), themeId: mine.id });
    if (index % 2 === 0) await posts.addPictureFor(OWNER, post.id, { source: 'card', commentId: comment.id });
  }
  // The heaviest notes: every letter of the note and of the link counts twice inside an answer.
  for (let index = 0; index < inspiration.INSPIRATION.shown + 1; index += 1) {
    await inspiration.addInspirationFor(OWNER, { note: '"'.repeat(inspiration.INSPIRATION.note), link: `https://a.example/${'ş'.repeat(160)}`, themeId: mine.id });
  }
  const run = await measured(() => readIdeas(OWNER));
  assert.equal(run.value.ideas.length, IDEAS_SHOWN);
  assert.equal(run.value.full, true);
  assert.equal(run.value.notes.length, inspiration.INSPIRATION.shown);
  assert.equal(run.value.notesFull, true);
  bounded(run.calls, 'the Ideas page', 13);
  assert.equal(recordsBounds.mostInFlight(run), 1, 'one call at a time');
  assert.ok(run.value.ideas.every((idea) => Object.keys(idea).join() === 'id,name,themeId'), 'the page gets only what a card shows');
});
