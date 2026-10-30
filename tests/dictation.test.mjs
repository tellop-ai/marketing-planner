import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { availability, status, show, hide, openAccessibilitySettings } from '../lib/dictation.js';
const original = globalThis.window;
after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });

test('a server or ordinary browser has no invented dictation support', async () => {
  delete globalThis.window;
  for (const call of [availability, status, show, hide, openAccessibilitySettings]) assert.deepEqual(await call(), { ok: false, reason: 'unavailable' });
  globalThis.window = {};
  assert.deepEqual(await availability(), { ok: false, reason: 'unavailable' });
});

test('each call uses the current trusted bridge and show sends only the two choices', async () => {
  const seen = [];
  globalThis.window = { tellopDictation: {
    availability: async () => ({ ok: true, available: true }),
    status: async () => ({ ok: true, visible: true, state: 'ready', readiness: 'ready' }),
    show: async options => { seen.push(options); return { ok: true }; },
    hide: async () => ({ ok: true, visible: false, state: 'hidden' }),
  } };
  assert.deepEqual(await availability(), { ok: true, available: true });
  assert.deepEqual(await status(), { ok: true, visible: true, state: 'ready', readiness: 'ready' });
  for (const language of ['auto', 'en', 'tr']) for (const mode of ['local', 'online'])
    assert.deepEqual(await show({ language, mode }), { ok: true });
  await show();
  assert.equal(seen.length, 7);
  assert.deepEqual(seen.at(-1), { language: 'auto', mode: 'local' });
  assert.deepEqual(await hide(), { ok: true, visible: false, state: 'hidden' });
  globalThis.window = {};
  assert.deepEqual(await show(), { ok: false, reason: 'unavailable' });
});

test('invalid choices and extra authority never reach the bridge', async () => {
  let calls = 0;
  globalThis.window = { tellopDictation: { show: async () => { calls++; return { ok: true }; } } };
  for (const value of [null, [], 'local', {}, { language: 'en' }, { language: 'de', mode: 'local' },
    { language: 'en', mode: 'automatic' }, { language: 'en', mode: 'local', text: 'untrusted' },
    { language: 'en', mode: 'local', target: 'untrusted' }])
    assert.deepEqual(await show(value), { ok: false, reason: 'failed' });
  assert.equal(calls, 0);
});

test('only public structured state leaves the helper', async () => {
  globalThis.window = { tellopDictation: { status: async () => ({ ok: true, visible: true,
    state: 'recording', transcript: 'private', target: 'private', readiness: 'downloading', progress: 0.5 }) } };
  assert.deepEqual(await status(), { ok: true, visible: true, state: 'recording', readiness: 'downloading', progress: 0.5 });
  for (const progress of [-Number.EPSILON, 0, Number.EPSILON, 1 - Number.EPSILON, 1, 1 + Number.EPSILON, NaN, Infinity]) {
    globalThis.window.tellopDictation.status = async () => ({ ok: true, progress });
    const result = await status();
    assert.equal(Object.hasOwn(result, 'progress'), Number.isFinite(progress) && progress >= 0 && progress <= 1);
  }
  globalThis.window.tellopDictation.status = async () => ({ ok: true, reason: 'arbitrary words', state: 'unexpected', readiness: 'unexpected' });
  assert.deepEqual(await status(), { ok: true });
});

test('missing, malformed and rejected replies do not claim success or retry', async () => {
  let calls = 0;
  for (const answer of [undefined, null, 'ok', {}, { ok: 'true' }]) {
    globalThis.window = { tellopDictation: { show: async () => { calls++; return answer; } } };
    assert.deepEqual(await show(), { ok: false, reason: 'failed' });
  }
  assert.equal(calls, 5);
  globalThis.window.tellopDictation.show = async () => { throw new Error('private detail'); };
  assert.deepEqual(await show(), { ok: false, reason: 'failed' });
  for (const reason of ['unavailable', 'unsupported', 'permission', 'not-ready', 'busy', 'failed']) {
    globalThis.window.tellopDictation.show = async () => ({ ok: false, reason });
    assert.deepEqual(await show(), { ok: false, reason });
  }
});


test('Accessibility status is coarse and the settings action forwards no arbitrary arguments', async () => {
  const seen = [];
  globalThis.window = { tellopDictation: {
    status: async () => ({ ok: true, accessibility: 'denied', target: 'private' }),
    openAccessibilitySettings: async (...args) => { seen.push(args); return { ok: true }; },
  } };
  assert.deepEqual(await status(), { ok: true, accessibility: 'denied' });
  await openAccessibilitySettings('https://example.com');assert.deepEqual(seen, [[]]);
  for (const value of ['unknown', true, null, 'ready']) {
    globalThis.window.tellopDictation.status = async () => ({ ok: true, accessibility: value });
    assert.deepEqual(await status(), { ok: true });
  }
});
