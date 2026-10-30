/**
 * What the host says, in this app's own words (Tellop's kit release K2).
 *
 * - AI: the app's limit for the day (`dailyLimit`, with when it renews in
 *   seconds) and a paused app (`appPaused`) each have their own words, never
 *   "AI is not available right now".
 * - The language: online (workerd) nothing reads `language.json` while the app
 *   runs, so a build that never compiled the choice in throws, never English.
 * - Files: online, a keep answers a keeper. It stays in the server's memory:
 *   only the keep's own look-up and `discardFile` get it, never an answer. It
 *   is held for the person who kept the file, so another person's keep or
 *   discard never takes it. A keep tells the host the file's size.
 * - A change the host refuses with a named reason (`records-refused:<reason>`)
 *   says it cannot be saved this way, not "could not save", and keeps the reason.
 *
 * Nothing here reaches the network or opens a store: every call goes to a
 * stand-in door.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { afterEach, test } from 'node:test';

process.chdir(path.join(import.meta.dirname, '..'));

const { AiProblem, askAI, streamAI } = await import('../lib/ai.js');
const { DataError, modelAction, modelBatch } = await import('../lib/data/index.js');
const { discardFile, keepFile } = await import('../lib/data/files.js');
const { getLocale, MESSAGES } = await import('../lib/i18n/index.js');
const browserReader = await import('../lib/i18n/language.browser.js');

const AI = Symbol.for('tellop.ai');
const ACTION = Symbol.for('tellop.internalRecordsAction');
const FILES = Symbol.for('tellop.internalFiles');
const PERSON = Symbol.for('tellop.person');
const priorFlag = process.env.TELLOP_INTERNAL_RECORDS;
const priorFetch = globalThis.fetch;
const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  for (const door of [AI, ACTION, FILES, PERSON]) delete globalThis[door];
  if (priorFlag === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
  else process.env.TELLOP_INTERNAL_RECORDS = priorFlag;
  globalThis.fetch = priorFetch;
  if (priorNavigator === undefined) delete globalThis.navigator;
  else Object.defineProperty(globalThis, 'navigator', priorNavigator);
});

const ASKED = { level: 'quick', messages: [{ role: 'user', content: 'Hello' }] };
const DAY_END = 1_793_232_000;

function insideTellopAi(answer) {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  globalThis[AI] = Object.freeze({ host: 'ai.tellop.invalid' });
  globalThis.fetch = async () => answer();
}

test('AI: the day limit and a paused app answer with their own words, in both languages', async () => {
  for (const [code, key, status] of [['dailyLimit', 'ai.dailyLimit', 429], ['appPaused', 'ai.appPaused', 403]]) {
    insideTellopAi(() => new Response(JSON.stringify({ error: { type: 'tellop', code, period_end: DAY_END } }), { status }));
    const refused = await askAI(ASKED).then(() => assert.fail('answered'), (error) => error);
    assert.ok(refused instanceof AiProblem, code);
    assert.equal(refused.code, code);
    assert.equal(refused.wordsKey, key, `${code} fell back to other words`);
    assert.notEqual(refused.state, 'unavailable');
    assert.equal(refused.periodEnd, DAY_END, 'the renewal moment comes through as the host sent it, in seconds');
    for (const locale of ['en', 'tr']) {
      const words = MESSAGES[locale][key];
      assert.equal(typeof words, 'string', `${locale} ${key} is missing`);
      assert.notEqual(words, MESSAGES[locale]['ai.unavailable'], `${locale} ${key} says the same as unavailable`);
    }
  }
  assert.notEqual(MESSAGES.en['ai.dailyLimit'], MESSAGES.en['ai.appPaused']);
});

test('AI: an app past its calls a minute online (the outbound answers app-busy, 429) says busy, never unavailable', async () => {
  // Tellop's host answers every call past the app's call ceiling with this exact body.
  insideTellopAi(() => new Response(JSON.stringify({ error: { type: 'tellop', code: 'app-busy' } }), { status: 429 }));
  const refused = await askAI(ASKED).then(() => assert.fail('answered'), (error) => error);
  assert.ok(refused instanceof AiProblem);
  assert.equal(refused.code, 'app-busy');
  assert.equal(refused.state, 'busy');
  assert.equal(refused.wordsKey, 'ai.busy');
  for (const locale of ['en', 'tr']) assert.notEqual(MESSAGES[locale]['ai.busy'], MESSAGES[locale]['ai.unavailable'], locale);
});

test('AI: a day limit met after the first words ends the stream with its own words', async () => {
  insideTellopAi(() => new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\n` +
    `data: ${JSON.stringify({ error: { type: 'tellop', code: 'dailyLimit', message: 'dailyLimit', period_end: DAY_END } })}\n\n`,
    { status: 200 }));
  const words = [];
  const refused = await (async () => { for await (const part of streamAI(ASKED)) words.push(part); })()
    .then(() => assert.fail('ended without the refusal'), (error) => error);
  assert.deepEqual(words, ['Hi']);
  assert.equal(refused.wordsKey, 'ai.dailyLimit');
  assert.equal(refused.periodEnd, DAY_END);
});

test('language: online a reader that was not compiled in throws, never English; on a computer it reads', () => {
  assert.equal(typeof getLocale(), 'string');
  assert.equal(browserReader.readLanguage(), '');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true, writable: true });
  // The package's own import map gives Node `language.node.js`, the reader a bundle without the kit loader gets too.
  assert.throws(() => getLocale(), /read at build time online/u);
  assert.throws(() => browserReader.readLanguage(), /read at build time online/u);
});

/** A stand-in for the online host's files door: every call it gets, and a keeper for each keep. */
function onlineFiles({ keeper } = {}) {
  const calls = [];
  globalThis[FILES] = Object.freeze({
    put: async (source, options) => {
      let size = 0;
      for await (const piece of source) size += piece.byteLength;
      calls.push(['put', options]);
      const given = typeof keeper === 'function' ? keeper() : keeper;
      return { digest: 'a'.repeat(64), size, ...(given === undefined ? {} : { keeper: given }) };
    },
    ref: async (...args) => { calls.push(['ref', ...args]); return { size: 5, kind: 'm4a' }; },
    discard: async (...args) => { calls.push(['discard', ...args]); return true; },
  });
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  return calls;
}
const upload = () => new Request('http://localhost/api/files', { method: 'POST', body: 'hello', headers: { 'content-length': '5' } });

test('files: the keeper stays in the server, goes to the keep\'s own look-up and to one discard, with the size sent', async () => {
  const keeper = 'b'.repeat(32);
  const calls = onlineFiles({ keeper });
  const kept = await keepFile(upload());
  // The answer is what a record or a page may hold: never the keeper.
  assert.deepEqual(Object.keys(kept).sort(), ['file', 'kind', 'shows', 'size']);
  assert.equal(JSON.stringify(kept).includes(keeper), false);
  assert.deepEqual(calls, [['put', { size: 5 }], ['ref', kept.file, { keeper }]]);
  assert.equal(await discardFile(kept.file), true);
  assert.deepEqual(calls.at(-1), ['discard', kept.file, { keeper }]);
  // Used once: a second discard sends the digest alone, which online keeps the file.
  await discardFile(kept.file);
  assert.deepEqual(calls.at(-1), ['discard', kept.file]);
});

test('files: a keeper is held for the person who kept the file: another person\'s keep or discard never takes it', async () => {
  const forAyse = 'c'.repeat(32);
  const forMert = 'd'.repeat(32);
  const given = [forAyse, forMert];
  const calls = onlineFiles({ keeper: () => given.shift() });
  const ayse = { id: `p_${'a'.repeat(22)}`, name: 'Ayşe', role: 'member' };
  const mert = { id: `p_${'m'.repeat(22)}`, name: 'Mert', role: 'member' };
  let person = ayse;
  globalThis[PERSON] = async () => person;
  const kept = await keepFile(upload());
  // Mert keeps the same bytes: his keep is answered with his own keeper, and Ayşe's stays held for her.
  person = mert;
  assert.equal((await keepFile(upload())).file, kept.file);
  assert.deepEqual(calls.at(-1), ['ref', kept.file, { keeper: forMert }]);
  // The owner kept nothing: the digest alone, and both keepers stay held.
  person = { id: 'owner', name: null, role: 'owner' };
  await discardFile(kept.file);
  assert.deepEqual(calls.at(-1), ['discard', kept.file]);
  person = ayse;
  await discardFile(kept.file);
  assert.deepEqual(calls.at(-1), ['discard', kept.file, { keeper: forAyse }], 'a discard took another person\'s keeper');
  person = mert;
  await discardFile(kept.file);
  assert.deepEqual(calls.at(-1), ['discard', kept.file, { keeper: forMert }]);
});

test('files: a host that answers no keeper (Tellop on the Mac) gets the digest alone, as before', async () => {
  const calls = onlineFiles();
  const kept = await keepFile(upload());
  assert.deepEqual(calls, [['put', { size: 5 }], ['ref', kept.file]]);
  await discardFile(kept.file);
  assert.deepEqual(calls.at(-1), ['discard', kept.file]);
});

test('records: a refusal with a named reason says it cannot be saved this way and keeps the reason', async () => {
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  globalThis[ACTION] = async () => { throw new Error('records-refused:nested-write'); };
  const write = await modelBatch([{ model: 'Note', action: 'create', args: { data: {} } }]).then(() => assert.fail('saved'), (error) => error);
  assert.ok(write instanceof DataError);
  assert.equal(write.messageKey, 'error.saveRefused');
  assert.equal(write.reason, 'nested-write');
  assert.equal(typeof MESSAGES.tr['error.saveRefused'], 'string');
  const read = await modelAction('Note', 'findMany', {}).then(() => assert.fail('read'), (error) => error);
  assert.equal(read.messageKey, 'error.storageUnreadable');
  assert.equal(read.reason, 'nested-write');
  // No reason named: as before.
  globalThis[ACTION] = async () => { throw new Error('records-refused'); };
  const plain = await modelBatch([{ model: 'Note', action: 'create', args: { data: {} } }]).then(() => assert.fail('saved'), (error) => error);
  assert.equal(plain.messageKey, 'error.saveFailed');
  assert.equal(plain.reason, undefined);
});
