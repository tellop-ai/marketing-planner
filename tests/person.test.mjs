/**
 * Who is using this app, and the words for a change this person may not make.
 *
 * `currentPerson()` (`lib/data/person.js`) answers what the host says through
 * its person door, and nothing the app or a request supplies. These checks set
 * that door the way Tellop does: on the computer it answers the app's owner;
 * online it answers the person the door let in, and `preview` while the owner
 * looks at the app as a Member or a Viewer. A host that refuses a change with
 * `records-forbidden` must show "You cannot change this.", never "could not
 * save".
 *
 * Nothing here reaches the network or opens a store: every call goes to a
 * stand-in door.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { afterEach, test } from 'node:test';

process.chdir(path.join(import.meta.dirname, '..'));

const { BACK_TO_OWNER, ROLES, currentPerson } = await import('../lib/data/person.js');
const { DataError, addNoteFor, listNotesPageFor, modelAction, modelBatch, removeNoteFor } = await import('../lib/data/index.js');
const { keepFile } = await import('../lib/data/files.js');
const { POST } = await import('../app/api/files/route.js');
const { t } = await import('../lib/i18n/index.js');

const PERSON = Symbol.for('tellop.person');
const ACTION = Symbol.for('tellop.internalRecordsAction');
const WRITE = Symbol.for('tellop.internalRecordsWrite');
const READ = Symbol.for('tellop.internalRecordsRead');
const FILES = Symbol.for('tellop.internalFiles');
const priorFlag = process.env.TELLOP_INTERNAL_RECORDS;
const priorNext = process.env.NEXT_RUNTIME;

afterEach(() => {
  for (const door of [PERSON, ACTION, WRITE, READ, FILES]) delete globalThis[door];
  if (priorFlag === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
  else process.env.TELLOP_INTERNAL_RECORDS = priorFlag;
  if (priorNext === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = priorNext;
});

const refusedWith = (key) => (error) => error instanceof DataError && error.messageKey === key;

test('outside Tellop the one person is the owner', async () => {
  assert.deepEqual(await currentPerson(), { id: 'owner', name: null, role: 'owner', preview: false });
  assert.deepEqual(ROLES, ['owner', 'member', 'viewer', 'helper']);
  assert.equal(BACK_TO_OWNER, '/.tellop/door/as');
});

test('on the computer the page shows the owner Tellop names', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe Yılmaz', role: 'owner' });
  const person = await currentPerson();
  assert.deepEqual(person, { id: 'owner', name: 'Ayşe Yılmaz', role: 'owner', preview: false });
  // The answer is the host's: a value the app passes in changes nothing.
  assert.deepEqual(await currentPerson({ id: 'p_x', name: 'Mallory', role: 'viewer' }), person);
  globalThis[PERSON] = async () => ({ id: 'owner', name: null, role: 'owner' });
  assert.equal((await currentPerson()).name, null);
});

test('online the door names the person, and a preview only for an owner looking as a Member or a Viewer', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  const id = 'p_abcdefghijklmnopqrstuv';
  globalThis[PERSON] = async () => ({ id, name: 'Deniz', role: 'viewer' });
  assert.deepEqual(await currentPerson(), { id, name: 'Deniz', role: 'viewer', preview: false });
  // The owner is 'owner' online too, as on the computer, and still 'owner' while looking in a lower role.
  globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe', role: 'owner' });
  assert.deepEqual(await currentPerson(), { id: 'owner', name: 'Ayşe', role: 'owner', preview: false });
  for (const role of ['member', 'viewer']) {
    globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe', role, preview: true });
    assert.deepEqual(await currentPerson(), { id: 'owner', name: 'Ayşe', role, preview: true });
  }
});

test('an answer of any other shape is refused, never guessed', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  const id = 'p_abcdefghijklmnopqrstuv';
  for (const answer of [
    null, 'owner', [], {},
    { id: 'owner', name: 'Ayşe', role: 'owner', preview: true },
    { id: 'owner', name: 'Ayşe', role: 'member', preview: false },
    { id, name: 'Ayşe', role: 'admin' },
    { id: 'owner', name: 'Ayşe', role: 'owner', email: 'a@example.com' },
    { id: 'owner', name: '   ', role: 'owner' },
    { id: 'owner', name: 'x'.repeat(65), role: 'owner' },
    { id: 'owner', role: 'owner' },
    // An id is 'owner' or the door's shape, and 'owner' is the owner's alone.
    { id: '', name: 'Ayşe', role: 'member' },
    { id: 'p_abcdefghijklmnopqrstu', name: 'Ayşe', role: 'member' },
    { id: 'p_abcdefghijklmnopqrstu!', name: 'Ayşe', role: 'member' },
    { id: 'Owner', name: 'Ayşe', role: 'owner' },
    { id: 7, name: 'Ayşe', role: 'member' },
    { id, name: 'Ayşe', role: 'owner' },
    { id, name: 'Ayşe', role: 'viewer', preview: true },
    { id: 'owner', name: 'Ayşe', role: 'member' },
    { id: 'owner', name: 'Ayşe', role: 'helper' },
  ]) {
    globalThis[PERSON] = async () => answer;
    await assert.rejects(() => currentPerson(), refusedWith('error.storageUnreadable'), JSON.stringify(answer));
  }
  // The longest name the door keeps still passes.
  globalThis[PERSON] = async () => ({ id: 'owner', name: 'ş'.repeat(64), role: 'owner' });
  assert.equal((await currentPerson()).name, 'ş'.repeat(64));
});

test('inside Next the call waits for its visit first, so `next build` never draws a page as the owner', async () => {
  // Next names itself in NEXT_RUNTIME. With no visit, as in `next build`, Next's connection() refuses, and nothing
  // is answered: the page is drawn for each visit instead. (Measured with a real `next build`: such a page is not
  // built ahead of time.)
  process.env.NEXT_RUNTIME = 'nodejs';
  await assert.rejects(() => currentPerson(), /`connection` was called outside a request scope/);
  globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe', role: 'owner' });
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  await assert.rejects(() => currentPerson(), /`connection` was called outside a request scope/);
  // The control: the same calls with no Next answer at once.
  delete process.env.NEXT_RUNTIME;
  assert.equal((await currentPerson()).name, 'Ayşe');
  delete process.env.TELLOP_INTERNAL_RECORDS;
  delete globalThis[PERSON];
  assert.deepEqual(await currentPerson(), { id: 'owner', name: null, role: 'owner', preview: false });
});

test('inside Tellop with no person door, or a door that fails, nobody is the owner by default', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  await assert.rejects(() => currentPerson(), refusedWith('error.storageUnreadable'));
  delete process.env.TELLOP_INTERNAL_RECORDS;
  globalThis[ACTION] = async () => [];
  await assert.rejects(() => currentPerson(), refusedWith('error.storageUnreadable'));
  globalThis[PERSON] = async () => { throw new Error('records-delivery-uncertain'); };
  await assert.rejects(() => currentPerson(), refusedWith('error.storageUnreadable'));
});

test('a change or read the host refuses this person shows "You cannot change this.", not "could not save"', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  const forbidden = async () => { throw new Error('records-forbidden'); };
  globalThis[ACTION] = forbidden;
  globalThis[WRITE] = forbidden;
  globalThis[READ] = forbidden;
  await assert.rejects(() => modelAction('Person', 'create', { data: { id: 'x', name: 'X' } }), refusedWith('error.cannotChange'));
  await assert.rejects(() => modelBatch([{ model: 'Person', action: 'deleteMany', args: {} }]), refusedWith('error.cannotChange'));
  await assert.rejects(() => modelAction('Person', 'findMany', {}), refusedWith('error.cannotChange'));
  await assert.rejects(() => addNoteFor('owner', 'a note'), refusedWith('error.cannotChange'));
  await assert.rejects(() => removeNoteFor('owner', 1), refusedWith('error.cannotChange'));
  await assert.rejects(() => listNotesPageFor('owner'), refusedWith('error.cannotChange'));
  // Any other refusal keeps its words.
  globalThis[ACTION] = async () => { throw new Error('records-refused'); };
  await assert.rejects(() => modelAction('Person', 'create', { data: { id: 'x', name: 'X' } }), refusedWith('error.saveFailed'));
  assert.equal(t('error.cannotChange', 'en'), 'You cannot change this.');
  assert.equal(t('error.cannotChange', 'tr'), 'Bunu değiştiremezsiniz.');
});

test('a file the host refuses this person answers 403 with the same words', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  globalThis[FILES] = Object.freeze({
    put: async (source) => { for await (const _ of source) { /* read */ } throw new Error('records-forbidden'); },
    ref: async () => null,
  });
  const upload = () => new Request('http://localhost/api/files', { method: 'POST', body: 'hello', headers: { 'content-length': '5' } });
  await assert.rejects(() => keepFile(upload()), refusedWith('error.cannotChange'));
  const answer = await POST(upload());
  assert.equal(answer.status, 403);
  assert.deepEqual(await answer.json(), { problem: 'error.cannotChange' });
});
