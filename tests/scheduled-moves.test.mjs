/**
 * A scheduled version follows its post: when the post's day or time changes,
 * every version scheduled for a moment still ahead moves to the new moment, or
 * is no longer scheduled when the post loses its day or the new moment has
 * passed. A version already shared never changes. A throwaway store
 * (`APP_DATA_FILE` in a temporary folder, removed afterwards).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'scheduled-moves-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const posts = await import('../lib/data/posts.js');
const { OWNER } = await import('../lib/plan/owner.js');
const postRoute = await import('../app/api/posts/[id]/route.js');
const { bounded, measured } = await import('./records-bounds.mjs');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/** An instant on a civil day at a time of this computer's clock. */
const at = (day, hour = 12, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
};

async function patch(id, body) {
  const request = new Request('http://localhost/api/posts/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await postRoute.PATCH(request, { params: Promise.resolve({ id: String(id) }) });
  return { status: response.status, json: await response.json() };
}

const momentsOf = async (postId) => Object.fromEntries((await posts.getPostFor(OWNER, postId)).versions.map((version) => [version.network, version.sharedAt]));

// 2031-03-12 is a Wednesday, 2031-03-14 a Friday.
const WED = '2031-03-12';
const FRI = '2031-03-14';

test('a version scheduled for Wednesday 18:30 moves with its post to Friday 10:00; a shared one stays', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Moving', day: WED, time: '18:30' });
  const scheduled = await posts.markScheduledFor(OWNER, post.id, 'instagram');
  assert.equal(scheduled.version.sharedAt, at(WED, 18, 30));
  const shared = await posts.markSharedFor(OWNER, post.id, 'facebook');
  assert.ok(Date.parse(shared.sharedAt) <= Date.now());

  assert.equal((await patch(post.id, { day: FRI, time: '10:00' })).status, 200);
  assert.deepEqual(await momentsOf(post.id), { instagram: at(FRI, 10, 0), facebook: shared.sharedAt });

  // A time sent alone moves it within the day; a day sent alone keeps the time.
  await patch(post.id, { time: '09:15' });
  assert.equal((await momentsOf(post.id)).instagram, at(FRI, 9, 15));
  await patch(post.id, { day: WED });
  assert.equal((await momentsOf(post.id)).instagram, at(WED, 9, 15));
  // No time: the moment is 12:00, as Mark scheduled keeps it.
  await patch(post.id, { time: null });
  assert.equal((await momentsOf(post.id)).instagram, at(WED, 12, 0));
  // Words alone never move it.
  await patch(post.id, { name: 'Renamed' });
  assert.deepEqual(await momentsOf(post.id), { instagram: at(WED, 12, 0), facebook: shared.sharedAt });
});

test('a post moved to no day or to a moment that has passed is no longer scheduled; a shared version is untouched', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Unscheduled', day: WED, time: '18:30' });
  await posts.markScheduledFor(OWNER, post.id, 'instagram');
  const shared = await posts.markSharedFor(OWNER, post.id, 'x');

  await patch(post.id, { day: null });
  assert.deepEqual(await momentsOf(post.id), { instagram: null, x: shared.sharedAt });

  await patch(post.id, { day: FRI });
  await posts.markScheduledFor(OWNER, post.id, 'instagram');
  assert.equal((await momentsOf(post.id)).instagram, at(FRI, 18, 30));
  await patch(post.id, { day: '2020-01-06', time: '10:00' });
  assert.deepEqual(await momentsOf(post.id), { instagram: null, x: shared.sharedAt });
  // Back to a day ahead: a version that is no longer scheduled stays unscheduled.
  await patch(post.id, { day: FRI });
  assert.deepEqual(await momentsOf(post.id), { instagram: null, x: shared.sharedAt });

  // The edge: a moment one minute ahead still moves; the moment that is now does not.
  await posts.markScheduledFor(OWNER, post.id, 'instagram');
  const soon = new Date(Date.now() + 2 * 60 * 1000);
  const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  const time = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  await patch(post.id, { day, time });
  assert.equal((await momentsOf(post.id)).instagram, at(day, soon.getHours(), soon.getMinutes()));
});

test('another owner’s scheduled version on a post of the same number never moves', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Mine', day: WED, time: '18:30' });
  await posts.markScheduledFor(OWNER, post.id, 'instagram');
  const stamp = new Date().toISOString();
  await modelAction('PostVersion', 'create', { data: { ownerId: 'another-owner', postId: post.id, network: 'instagram', sharedAt: at(WED, 18, 30), updatedAt: stamp } });
  await patch(post.id, { day: FRI });
  const theirs = await modelAction('PostVersion', 'findFirst', { where: { ownerId: 'another-owner', postId: post.id, network: 'instagram' }, select: { sharedAt: true } });
  assert.equal(theirs.sharedAt, at(WED, 18, 30));
  assert.equal((await momentsOf(post.id)).instagram, at(FRI, 18, 30));
});

test('moving a post’s day or time stays at two records calls, one at a time', async () => {
  const post = await posts.createPostFor(OWNER, { name: 'Counted', day: WED, time: '18:30' });
  await posts.markScheduledFor(OWNER, post.id, 'instagram');
  bounded(await measured(() => posts.updatePostFor(OWNER, post.id, { time: '08:00' })), 'a time change', 2);
  bounded(await measured(() => posts.updatePostFor(OWNER, post.id, { day: FRI, time: '10:00', themeId: null })), 'a day, time and theme change', 2);
  assert.equal((await momentsOf(post.id)).instagram, at(FRI, 10, 0));
});
