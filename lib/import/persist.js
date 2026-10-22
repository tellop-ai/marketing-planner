/** Whole-file writes use the shipped records transaction, after shaping and bounds checks. */
import { refuse } from './limits.js';
const bad = new Set(['__proto__', 'prototype', 'constructor', '$tellop']);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
// Match the selected records codec and fd3 frame limits. This importer admits
// String, Boolean, Int, Float and Json fields only. Dates, Decimal, BigInt, Bytes,
// enums, relations and operation/tag objects are unsupported; refuse them.
function preflight(args) {
  let nodes = 0;
  function visit(value, depth) {
    // Snapshot work is bounded by the actual one-MiB envelope. Schema
    // qualification below owns the stricter codec visit budget.
    nodes += 1;
    if (nodes > 1048576 || depth > 24) refuse('import.tooLarge');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) refuse(); return value; }
    if (typeof value === 'string') { if (value.length > 65536) refuse('import.tooLarge'); return value; }
    if (!value || typeof value !== 'object') refuse();
    if (Array.isArray(value)) {
      if (value.length > 256) refuse('import.tooLarge');
      if (Reflect.ownKeys(value).length !== value.length + 1) refuse();
      return Object.freeze(Array.from({length:value.length}, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) refuse();
        return visit(descriptor.value, depth + 1);
      }));
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 256) refuse('import.tooLarge');
    const copy = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 128 || bad.has(key)) refuse();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) refuse();
      copy[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(copy);
  }
  return visit(args, 0);
}
function stepsFor(model, action, args) {
  if (typeof model !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(model) || bad.has(model)) refuse();
  const snapshot = preflight(args);
  const steps = [{ model, action, args: snapshot }];
  // Largest safe-integer stream/call counters give the complete actual envelope.
  if (bytes({kind:'records', id:Number.MAX_SAFE_INTEGER, body:{kind:'model-batch',call:Number.MAX_SAFE_INTEGER,steps}}) > 1048576 ||
      bytes({kind:'transaction',token:'0'.repeat(36),id:Number.MAX_SAFE_INTEGER,steps}) > 1048576) refuse('import.tooLarge');
  return steps;
}
function unconfirmed() { refuse('import.saveUnconfirmed'); }
function id(value) { return (typeof value === 'string' && value.length > 0 && value.length <= 65536) || (Number.isSafeInteger(value)); }
// This importer admits only scalar createMany data and a scalar-ID in filter.
// No relation writes, scalar operation objects, tags, or caller-provided schema.
function qualify(steps, fields) {
  let nodes = 0;
  const tick = depth => { if (++nodes > 2048 || depth > 24) refuse('import.tooLarge'); };
  function json(value, depth) {
    tick(depth);
    if (Array.isArray(value)) { for (const item of value) json(item,depth+1); }
    else if (value && typeof value === 'object') {
      tick(depth); // boundedJson visits the object, then keys visits it again.
      for (const item of Object.values(value)) json(item,depth+1);
    }
  }
  function scalar(value, field, depth) {
    if (!field || field.kind !== 'scalar') refuse();
    if (value === null) return; // decodeFields' nullable branch has no scalar tick.
    tick(depth);
    if (field.type === 'Json') {
      tick(depth); // JsonNullValueInput enum attempt, then Json scalar.
      json(value,depth+1); return;
    }
    if (field.type === 'String' && typeof value === 'string' ||
        field.type === 'Boolean' && typeof value === 'boolean' ||
        field.type === 'Int' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ||
        field.type === 'Float' && typeof value === 'number' && Number.isFinite(value)) return;
    refuse();
  }
  const step = steps[0];
  tick(0); // operation args, after selection has been removed.
  if (step.action === 'createManyAndReturn') {
    tick(1); // unsuccessful non-list CreateManyInput alternative shares budget.
    tick(1); // successful CreateManyInput list.
    for (const row of step.args.data) {
      tick(2);
      for (const [name,value] of Object.entries(row)) scalar(value,fields[name],3);
    }
    tick(1); // select: {id:true}; booleans do not consume an additional tick.
    if (!['String','Int'].includes(fields.id?.type)) refuse();
  } else {
    tick(1); tick(2); tick(3); // where, id filter, in list.
    for (const value of step.args.where.id.in) scalar(value,fields.id,4);
  }
}
export async function saveRows(checked, { model, prepare = row => row } = {}) {
  const descriptor = checked && Object.getOwnPropertyDescriptor(checked, 'rows');
  if (!descriptor || !Object.hasOwn(descriptor,'value') || !Array.isArray(descriptor.value) || descriptor.value.length > 1000 || typeof prepare !== 'function') refuse();
  const entries = descriptor.value;
  if (Reflect.ownKeys(entries).length !== entries.length + 1) refuse();
  const seen = new Set(), data = [];
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) refuse();
    const entry = preflight(descriptor.value);
    if (!entry || !['new', 'already-there'].includes(entry.status) || typeof entry.key !== 'string' || !entry.key.trim() || entry.key.length > 65536 || seen.has(entry.key)) refuse('import.problemRows');
    seen.add(entry.key);
    if (entry.status === 'new') {
      const row = preflight(prepare(preflight(entry.row)));
      if (!row || typeof row !== 'object' || Array.isArray(row) || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) refuse();
      data.push(row);
    }
  }
  const steps = stepsFor(model, 'createManyAndReturn', { data, select: { id: true } });
  if (!data.length) return { savedIds: [], savedCount: 0 };
  const snapshotData = steps[0].args.data;
  // Known IDs alone are a lower bound on the complete selected result.
  // Omitted generated IDs can only add bytes; never guess their value or size.
  const knownResult = [snapshotData.filter(row => Object.hasOwn(row, 'id')).map(row => ({id:row.id}))];
  if (bytes(knownResult) > 262144) refuse('import.tooLarge');
  const { importModelFields } = await import('../data/import-schema.js');
  qualify(steps, await importModelFields(model));
  const { modelBatch } = await import('../data/index.js');
  const values = await modelBatch(steps);
  if (!Array.isArray(values) || values.length !== 1 || !Array.isArray(values[0]) || values[0].length !== snapshotData.length) unconfirmed();
  const savedIds = values[0].map(row => {
    if (!row || Object.keys(row).length !== 1 || !id(row.id)) unconfirmed();
    return row.id;
  });
  if (new Set(savedIds).size !== savedIds.length || bytes(values) > 262144) unconfirmed();
  return { savedIds, savedCount: savedIds.length };
}
export async function undoRows(savedIds, { model } = {}) {
  savedIds = preflight(savedIds);
  if (!Array.isArray(savedIds) || savedIds.some(value => !id(value)) || new Set(savedIds).size !== savedIds.length) refuse();
  const steps = stepsFor(model, 'deleteMany', { where: { id: { in: savedIds } } });
  if (!savedIds.length) return { removedCount: 0 };
  const { importModelFields } = await import('../data/import-schema.js');
  qualify(steps, await importModelFields(model));
  const { modelBatch } = await import('../data/index.js');
  const values = await modelBatch(steps);
  if (!Array.isArray(values) || values.length !== 1 || !values[0] || Object.keys(values[0]).length !== 1 || !Number.isSafeInteger(values[0].count) || values[0].count < 0 || values[0].count > savedIds.length) unconfirmed();
  return { removedCount: values[0].count };
}
