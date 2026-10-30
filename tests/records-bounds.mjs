/**
 * Tellop's records bounds, measured in a test (shared by the tests that check
 * them; not a test file itself, so `node --test` does not run it alone).
 *
 * Inside Tellop every records call (one `modelAction`, or one `modelBatch`)
 * goes through its records route, which keeps these bounds: at most 32 steps
 * a batch; 256 rows a statement; 2,048 values in a step's answer (a list
 * counts one, a row its fields and two more); 256 items in any list a call
 * sends; 256 KiB of answers a call (a batch counted whole); 1 MiB of
 * arguments a call; 16 calls a request; and at most 4 calls unanswered at
 * once in one request (`recordsCalls` in Tellop's records channel: a fifth
 * started while four wait is refused, and the page shows the records as
 * unreadable). The local store has none of these, so
 * `measured` runs `work` as inside Tellop: the route's hook runs each call's
 * steps on the local store's own client (a batch of several through
 * `localBatch`, all kept or none), and notes each call's size and how many
 * calls were unanswered when it started (itself included). `bounded` then
 * asserts every bound.
 *
 * When `MP_RECORDS_DUMP` names a file, each step of each measured call is
 * appended to it as one JSON line `{ call, model, action, args, value }`
 * (`call` names the call it was part of), so a separate check can run each
 * step through Tellop's own records reader.
 */

import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import process from 'node:process';

import { modelBatch } from '../lib/data/index.js';

export const BOUNDS = Object.freeze({ steps: 32, rows: 256, list: 256, values: 2048, bytes: 256 * 1024, args: 1024 * 1024, calls: 16, inFlight: 4 });

const ACTION = Symbol.for('tellop.internalRecordsAction');
const STORE = Symbol.for('tellop.template.storage');

let callNumber = 0;

/** Values in one answer, counted as the records route counts them. @param {unknown} value @returns {number} */
export function valuesIn(value) {
  if (Array.isArray(value)) return value.reduce((total, item) => total + valuesIn(item), 1);
  if (value !== null && typeof value === 'object') return Object.values(value).reduce((total, item) => total + valuesIn(item), 2);
  return 1;
}

/** The longest list anywhere in what a call sends. @param {unknown} value @returns {number} */
export function longestList(value) {
  if (Array.isArray(value)) return Math.max(value.length, ...value.map(longestList));
  if (value !== null && typeof value === 'object') return Math.max(0, ...Object.values(value).map(longestList));
  return 0;
}

/**
 * A batch of several steps on the local store, all kept or none, as Tellop's
 * records route keeps a batch: through the kit's own `modelBatch` as it runs
 * outside Tellop (`lib/data/index.js`, the one place that opens the local
 * store's batch), so no check names the records client's batch call itself
 * (Tellop's online check stops an app whose code names it, its tests
 * included). A hook runs while `TELLOP_INTERNAL_RECORDS` is on, which would
 * send `modelBatch` back to the hook, so it is off only while the call
 * starts: `modelBatch` picks the local store before its first wait, and no
 * other code runs in between, so no call started by `Promise.all` can reach
 * the store uncounted.
 *
 * @param {Array<{ model: string, action: string, args?: unknown }>} steps
 */
export function localBatch(steps) {
  const prior = process.env.TELLOP_INTERNAL_RECORDS;
  delete process.env.TELLOP_INTERNAL_RECORDS;
  try {
    return modelBatch(steps);
  } finally {
    if (prior !== undefined) process.env.TELLOP_INTERNAL_RECORDS = prior;
  }
}

/** One step on a records client, as the route runs it. */
function run(records, step) {
  return records[step.model[0].toLowerCase() + step.model.slice(1)][step.action](step.args ?? {});
}

/**
 * Runs `work` as inside Tellop and answers what it answered with the calls it
 * made: `{ value, calls }`, each call `{ steps, list, rows, values, bytes,
 * args, inFlight, what }` (`inFlight`: the calls unanswered when it started,
 * itself included).
 *
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<{ value: T, calls: Array<{ steps: number, list: number, rows: number, values: number, bytes: number, args: number, inFlight: number, what: string }> }>}
 */
export async function measured(work) {
  const store = globalThis[STORE];
  assert.ok(store?.client, 'the local store is open (make one records call before measuring)');
  const dump = process.env.MP_RECORDS_DUMP;
  const calls = [];
  let waiting = 0;
  globalThis[ACTION] = async (steps) => {
    waiting += 1;
    const inFlight = waiting;
    let values;
    try {
      // One turn of the event loop first, as a call to Tellop's records channel takes, so calls started together overlap.
      await new Promise((resolve) => setImmediate(resolve));
      values = steps.length === 1 ? [await run(store.client, steps[0])] : await localBatch(steps);
    } finally {
      waiting -= 1;
    }
    calls.push({
      inFlight,
      steps: steps.length,
      list: Math.max(...steps.map((step) => longestList(step.args))),
      rows: Math.max(...values.map((value) => (Array.isArray(value) ? value.length : 1))),
      values: Math.max(...values.map(valuesIn)),
      bytes: Buffer.byteLength(JSON.stringify(values)),
      args: Buffer.byteLength(JSON.stringify(steps.map((step) => step.args ?? {}))),
      what: steps.map((step) => `${step.model}.${step.action}`).join(' '),
    });
    if (typeof dump === 'string' && dump !== '') {
      callNumber += 1;
      const call = `${process.pid}:${callNumber}`;
      appendFileSync(dump, steps.map((step, index) => `${JSON.stringify({ call, model: step.model, action: step.action, args: step.args ?? {}, value: values[index] ?? null })}\n`).join(''));
    }
    return values;
  };
  const prior = process.env.TELLOP_INTERNAL_RECORDS;
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  try {
    return { value: await work(), calls };
  } finally {
    if (prior === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
    else process.env.TELLOP_INTERNAL_RECORDS = prior;
    delete globalThis[ACTION];
  }
}

/**
 * Asserts that every call of a measured run kept every bound, and that it made
 * at least one call and at most `most` (never more than `BOUNDS.calls`).
 *
 * @param {{ calls: Array<Record<string, any>> }} result
 * @param {string} what
 * @param {number} [most]
 */
export function bounded({ calls }, what, most = BOUNDS.calls) {
  assert.ok(calls.length >= 1, `${what}: no call went through the records route`);
  assert.ok(calls.length <= Math.min(most, BOUNDS.calls), `${what}: ${calls.length} calls, at most ${Math.min(most, BOUNDS.calls)}`);
  calls.forEach((call, index) => {
    const which = `${what}, call ${index + 1} (${call.what})`;
    assert.ok(call.steps <= BOUNDS.steps, `${which}: ${call.steps} steps`);
    assert.ok(call.list <= BOUNDS.list, `${which}: a list of ${call.list}`);
    assert.ok(call.rows <= BOUNDS.rows, `${which}: ${call.rows} rows`);
    assert.ok(call.values <= BOUNDS.values, `${which}: ${call.values} values`);
    assert.ok(call.bytes <= BOUNDS.bytes, `${which}: ${call.bytes} bytes`);
    assert.ok(call.args <= BOUNDS.args, `${which}: ${call.args} bytes of arguments`);
    assert.ok(call.inFlight <= BOUNDS.inFlight, `${which}: ${call.inFlight} calls unanswered at once, at most ${BOUNDS.inFlight}`);
  });
}

/**
 * The most calls a measured run had unanswered at once. A data function keeps
 * it at 2 or less, so a page or an address can run two of them together.
 *
 * @param {{ calls: Array<{ inFlight: number }> }} result
 */
export function mostInFlight({ calls }) {
  return Math.max(0, ...calls.map((call) => call.inFlight));
}

/** The largest call of a measured run, in bytes of answers. @param {{ calls: Array<{ bytes: number }> }} result */
export function largestCall({ calls }) {
  return Math.max(0, ...calls.map((call) => call.bytes));
}
