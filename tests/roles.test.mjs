/**
 * Who may press what (`lib/plan/roles.js`, kit rule 1), what a page learns
 * from the host about the person (`lib/plan/visitor.js`), and how the app's
 * own addresses answer a change the host refuses this person: in the
 * person's words, "You cannot change this." (`error.cannotChange`, 403),
 * never "could not save".
 *
 * Nothing here reaches the network or opens a store: the host's doors are
 * stand-ins, as the kit's `tests/person.test.mjs` sets them.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, test } from 'node:test';

process.chdir(path.join(import.meta.dirname, '..'));

const { NO_RIGHTS, ROLE_NAMES, UNKNOWN_RIGHTS, canAdd, canChange, rightsOf } = await import('../lib/plan/roles.js');
const { rightsForThisVisit } = await import('../lib/plan/visitor.js');
const { t } = await import('../lib/i18n/index.js');
const { failed } = await import('../lib/plan/reply.js');
const { DataError } = await import('../lib/data/index.js');
const { ZIP_START } = await import('../lib/plan/zip.js');

const PERSON = Symbol.for('tellop.person');
const ACTION = Symbol.for('tellop.internalRecordsAction');
const WRITE = Symbol.for('tellop.internalRecordsWrite');
const READ = Symbol.for('tellop.internalRecordsRead');
const FILES = Symbol.for('tellop.internalFiles');
const priorFlag = process.env.TELLOP_INTERNAL_RECORDS;

afterEach(() => {
  for (const door of [PERSON, ACTION, WRITE, READ, FILES]) delete globalThis[door];
  if (priorFlag === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
  else process.env.TELLOP_INTERNAL_RECORDS = priorFlag;
});

/** A person the door let in online (not the owner): `p_` and 22 letters. */
const SOMEONE = `p_${'a'.repeat(22)}`;

describe('the rule, one row for each role', () => {
  test('owner: adds, changes and removes', () => {
    assert.equal(canAdd('owner'), true);
    assert.equal(canChange('owner'), true);
    assert.deepEqual(rightsOf({ role: 'owner', preview: false }), { add: true, change: true, preview: false, unknown: false });
  });

  test('helper: adds, changes and removes, as the owner does', () => {
    assert.equal(canAdd('helper'), true);
    assert.equal(canChange('helper'), true);
    assert.deepEqual(rightsOf({ role: 'helper', preview: false }), { add: true, change: true, preview: false, unknown: false });
  });

  test('member: adds, never changes or removes what is kept', () => {
    assert.equal(canAdd('member'), true);
    assert.equal(canChange('member'), false);
    assert.deepEqual(rightsOf({ role: 'member', preview: false }), { add: true, change: false, preview: false, unknown: false });
  });

  test('viewer: neither adds nor changes', () => {
    assert.equal(canAdd('viewer'), false);
    assert.equal(canChange('viewer'), false);
    assert.deepEqual(rightsOf({ role: 'viewer', preview: false }), { add: false, change: false, preview: false, unknown: false });
  });

  test('a role the app does not know, or none, gets nothing that saves', () => {
    for (const role of ['', 'admin', 'Owner', undefined, null, 1]) {
      assert.equal(canAdd(role), false, String(role));
      assert.equal(canChange(role), false, String(role));
    }
    assert.deepEqual(rightsOf(null), NO_RIGHTS);
    assert.deepEqual(rightsOf(undefined), NO_RIGHTS);
    assert.deepEqual(ROLE_NAMES, ['owner', 'helper', 'member', 'viewer']);
  });

  test('preview shows the way back only when the host says so', () => {
    assert.equal(rightsOf({ role: 'viewer', preview: true }).preview, true);
    assert.equal(rightsOf({ role: 'member', preview: true }).preview, true);
    assert.equal(rightsOf({ role: 'viewer', preview: 'yes' }).preview, false);
    assert.equal(rightsOf({ role: 'owner' }).preview, false);
  });
});

describe('what a page learns about the person', () => {
  test('outside Tellop the one person is the owner: every press', async () => {
    assert.deepEqual(await rightsForThisVisit(), { add: true, change: true, preview: false, unknown: false });
  });

  test('on the computer Tellop names the owner: every press', async () => {
    process.env.TELLOP_INTERNAL_RECORDS = '1';
    globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe', role: 'owner' });
    assert.deepEqual(await rightsForThisVisit(), { add: true, change: true, preview: false, unknown: false });
  });

  test('online, each role the door names gets its own presses', async () => {
    process.env.TELLOP_INTERNAL_RECORDS = '1';
    const rows = [
      [{ id: SOMEONE, name: null, role: 'helper' }, { add: true, change: true, preview: false, unknown: false }],
      [{ id: SOMEONE, name: 'Can', role: 'member' }, { add: true, change: false, preview: false, unknown: false }],
      [{ id: SOMEONE, name: null, role: 'viewer' }, { add: false, change: false, preview: false, unknown: false }],
    ];
    for (const [answer, rights] of rows) {
      globalThis[PERSON] = async () => answer;
      assert.deepEqual(await rightsForThisVisit(), rights, answer.role);
    }
  });

  test('the owner looking as a Member or a Viewer gets that role\'s presses and the way back', async () => {
    process.env.TELLOP_INTERNAL_RECORDS = '1';
    globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe', role: 'viewer', preview: true });
    assert.deepEqual(await rightsForThisVisit(), { add: false, change: false, preview: true, unknown: false });
    globalThis[PERSON] = async () => ({ id: 'owner', name: 'Ayşe', role: 'member', preview: true });
    assert.deepEqual(await rightsForThisVisit(), { add: true, change: false, preview: true, unknown: false });
  });

  test('a host answer that cannot be read draws nothing that saves, never the owner\'s presses, and is told apart', async () => {
    process.env.TELLOP_INTERNAL_RECORDS = '1';
    const unknown = { add: false, change: false, preview: false, unknown: true };
    assert.deepEqual(UNKNOWN_RIGHTS, unknown);
    // No door at all inside Tellop.
    assert.deepEqual(await rightsForThisVisit(), unknown);
    // A door that fails, and one of another shape.
    globalThis[PERSON] = async () => { throw new Error('records-delivery-uncertain'); };
    assert.deepEqual(await rightsForThisVisit(), unknown);
    globalThis[PERSON] = async () => ({ id: 'owner', role: 'admin' });
    assert.deepEqual(await rightsForThisVisit(), unknown);
    // A person read, even a Viewer, is never unknown: only a failed read makes the page say something is wrong.
    globalThis[PERSON] = async () => ({ id: SOMEONE, name: null, role: 'viewer' });
    assert.equal((await rightsForThisVisit()).unknown, false);
    assert.equal(NO_RIGHTS.unknown, false);
  });
});

describe('a change the host refuses this person', () => {
  /** Every records door refuses, as the host does for a Viewer's write (and a Member's change of another's record). */
  function hostRefuses() {
    process.env.TELLOP_INTERNAL_RECORDS = '1';
    const forbidden = async () => { throw new Error('records-forbidden'); };
    globalThis[ACTION] = forbidden;
    globalThis[WRITE] = forbidden;
    globalThis[READ] = forbidden;
    globalThis[FILES] = Object.freeze({
      put: async (source) => { for await (const _ of source) { /* read to the end */ } throw new Error('records-forbidden'); },
      ref: async () => null,
    });
  }

  const json = (address, method, body) => new Request(`http://localhost${address}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const params = (id) => ({ params: Promise.resolve({ id: String(id) }) });

  /** [what, the route module, its method, the request, its context] */
  const PRESSES = [
    ['New post', '../app/api/posts/route.js', 'POST', () => json('/api/posts', 'POST', { name: 'Saturday class' })],
    ['a post renamed', '../app/api/posts/[id]/route.js', 'PATCH', () => json('/api/posts/1', 'PATCH', { name: 'Sunday class' }), params(1)],
    ['a post removed', '../app/api/posts/[id]/route.js', 'DELETE', () => new Request('http://localhost/api/posts/1', { method: 'DELETE' }), params(1)],
    ['a ready word added', '../app/api/ready-words/route.js', 'POST', () => json('/api/ready-words', 'POST', { kind: 'bio', title: 'Short bio', text: 'Hand-made mugs.' })],
    ['a ready word removed', '../app/api/ready-words/[id]/route.js', 'DELETE', () => new Request('http://localhost/api/ready-words/1', { method: 'DELETE' }), params(1)],
    ['the month\'s followers', '../app/api/followers/route.js', 'PUT', () => json('/api/followers', 'PUT', { month: '2026-10', network: 'instagram', count: 120 })],
    ['My plan', '../app/api/plan/route.js', 'PUT', () => json('/api/plan', 'PUT', { businessName: 'Clay corner' })],
    ['a campaign added', '../app/api/campaigns/route.js', 'POST', () => json('/api/campaigns', 'POST', { name: 'Autumn', startsOn: '2026-10-01', endsOn: '2026-10-10' })],
    ['an enquiry removed', '../app/api/enquiries/[id]/route.js', 'DELETE', () => new Request('http://localhost/api/enquiries/1', { method: 'DELETE' }), params(1)],
    ['a contact removed', '../app/api/contacts/[id]/route.js', 'DELETE', () => new Request('http://localhost/api/contacts/1', { method: 'DELETE' }), params(1)],
    ['a theme removed', '../app/api/themes/[id]/route.js', 'DELETE', () => new Request('http://localhost/api/themes/1', { method: 'DELETE' }), params(1)],
    ['a zip kept to download', '../app/api/downloads/route.js', 'POST', () => new Request('http://localhost/api/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: new Uint8Array([...ZIP_START, 0, 0, 0, 0]),
    })],
  ];

  for (const [what, address, method, request, context] of PRESSES) {
    test(`${what}: "You cannot change this.", 403`, async () => {
      hostRefuses();
      const route = await import(address);
      const answer = await route[method](request(), context);
      assert.equal(answer.status, 403, what);
      assert.deepEqual(await answer.json(), { problem: 'error.cannotChange' }, what);
    });
  }

  test('every address answers a refusal the same way, with words in both languages', async () => {
    const answer = failed(new DataError('error.cannotChange'));
    assert.equal(answer.status, 403);
    assert.deepEqual(await answer.json(), { problem: 'error.cannotChange' });
    assert.equal(t('error.cannotChange', 'en'), 'You cannot change this.');
    assert.equal(t('error.cannotChange', 'tr'), 'Bunu değiştiremezsiniz.');
    // The way back from looking as someone else, in both languages.
    assert.equal(t('shell.backToOwnView', 'en'), 'Back to your own view');
    assert.equal(t('shell.backToOwnView', 'tr'), 'Kendi görünümüne dön');
    // What the page says when the person could not be read, in both languages.
    for (const locale of ['en', 'tr']) assert.notEqual(t('error.storageUnreadable', locale), 'error.storageUnreadable', locale);
  });
});
