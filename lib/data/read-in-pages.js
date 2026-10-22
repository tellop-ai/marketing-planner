/**
 * Reads that stay inside the bounds of one records call, shared by every data
 * file here.
 *
 * Inside Tellop each records call (one `modelAction`, or one `modelBatch`)
 * keeps these bounds; the local store has none of them, so a breach passes
 * an ordinary test and fails only inside Tellop (`tests/records-bounds.mjs`
 * measures them):
 *
 * - at most 32 steps in a batch, 256 rows a statement, and 256 items in any
 *   list a call sends (an `in` of 257 is refused);
 * - at most 2,048 values in a step's answer, counted as 1 for the list and
 *   `rows x (2 + fields)` for its rows (`rowsFor`);
 * - at most 256 KiB of answers a call, a whole batch counted together, and at
 *   most 16 calls a request.
 *
 * `readInPages` reads a long list on a cursor; `readPacked` puts reads that
 * depend only on what is already known into as few calls as their largest
 * possible answers allow; `inGroups` cuts a list of ids for `in`.
 */

import { modelAction, modelBatch } from './index.js';

/** The bounds of one records call inside Tellop. */
export const RECORDS = Object.freeze({ steps: 32, rows: 256, list: 256, values: 2048, bytes: 256 * 1024, calls: 16 });

/** The largest answer, in bytes, `readPacked` plans into one call: under `RECORDS.bytes`, with room for the batch's own brackets. */
export const CALL_BUDGET = 250_000;

/**
 * The most rows one step can answer when it selects `fields` fields: at most
 * `RECORDS.rows`, and `1 + rows x (2 + fields)` values at most
 * `RECORDS.values`.
 *
 * @param {number} fields
 */
export function rowsFor(fields) {
  return Math.max(1, Math.min(RECORDS.rows, Math.floor((RECORDS.values - 1) / (2 + fields))));
}

/** The fields a `select` picks. @param {Record<string, unknown>} select */
function fieldCount(select) {
  return Object.values(select).filter((picked) => picked === true).length;
}

/**
 * `items` cut into lists of at most `size` (at most `RECORDS.list`) each.
 *
 * @template T
 * @param {T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function inGroups(items, size = RECORDS.list) {
  const step = Math.max(1, Math.min(size, RECORDS.list));
  const groups = [];
  for (let start = 0; start < items.length; start += step) groups.push(items.slice(start, start + step));
  return groups;
}

/**
 * A condition that `key` comes after `value` in `direction`, or null when
 * nothing does. Nulls come first going up and last going down, so going down a
 * field that can be empty (`nullable`) also takes the empty ones.
 */
function pastValue(key, direction, value, nullable) {
  if (typeof value === 'boolean') {
    if (direction === 'asc') return value ? null : { [key]: true };
    return value ? { [key]: false } : null;
  }
  if (value === null || value === undefined) return direction === 'asc' ? { [key]: { not: null } } : null;
  if (direction === 'asc') return { [key]: { gt: value } };
  return nullable ? { OR: [{ [key]: { lt: value } }, { [key]: null }] } : { [key]: { lt: value } };
}

/**
 * The rows after `last` in `order` (field, direction and, for a field that
 * can be empty, `true`; the last one `id`, so no two rows tie).
 *
 * @param {Array<[string, 'asc' | 'desc', boolean?]>} order
 * @param {Record<string, unknown>} last
 */
export function afterRow(order, last) {
  const branches = [];
  for (let index = 0; index < order.length; index += 1) {
    const [key, direction, nullable = false] = order[index];
    const past = pastValue(key, direction, last[key], nullable);
    if (past === null) continue;
    const same = order.slice(0, index).map(([name]) => ({ [name]: last[name] ?? null }));
    branches.push(same.length === 0 ? past : { AND: [...same, past] });
  }
  return branches.length === 1 ? branches[0] : { OR: branches };
}

/**
 * Up to `most` rows of `model` that match `where`, in `order` (as `afterRow`
 * takes it; the last one must be `id`), `page` rows a call (at most what
 * `rowsFor` allows for the fields selected). Each call starts after the last
 * row the one before read, and is made only when that one came back full: at
 * most `most / page` calls, rounded up. A row read twice (its order changed
 * between two calls) is kept once. `after`, when given, is a row to start
 * after.
 *
 * @param {string} model
 * @param {{ where: Record<string, unknown>, order: Array<[string, 'asc' | 'desc', boolean?]>, select: Record<string, boolean>,
 *   most: number, page: number, after?: Record<string, unknown> | null }} read
 * @returns {Promise<any[]>}
 */
export async function readInPages(model, { where, order, select, most, page, after = null }) {
  if (order.length === 0 || order.at(-1)[0] !== 'id') throw new Error('readInPages: the order must end with id');
  const picked = { ...select };
  for (const [key] of order) picked[key] = true;
  const size = Math.min(page, rowsFor(fieldCount(picked)));
  const rows = [];
  const seen = new Set();
  let last = after;
  for (let calls = Math.ceil(most / size); calls > 0 && rows.length < most; calls -= 1) {
    const take = Math.min(size, most - rows.length);
    const found = await modelAction(model, 'findMany', {
      where: last === null ? where : { AND: [where, afterRow(order, last)] },
      orderBy: order.map(([key, direction]) => ({ [key]: direction })),
      select: picked,
      take,
    });
    if (!Array.isArray(found)) throw new Error('readInPages: not a list');
    for (const row of found) {
      if (seen.has(row.id) || rows.length >= most) continue;
      seen.add(row.id);
      rows.push(row);
    }
    if (found.length < take) break;
    last = found.at(-1);
  }
  return rows;
}

/**
 * Runs reads that depend only on what is already known in as few calls as
 * their largest possible answers allow: in order, as many steps a call as fit
 * `CALL_BUDGET` bytes and `RECORDS.steps` steps. A step names `bytes`, the
 * largest answer it can give. Reads only: writes that must happen together
 * belong in one `modelBatch`.
 *
 * @param {Array<{ model: string, action: string, args: Record<string, unknown>, bytes: number }>} steps
 * @returns {Promise<any[]>} each step's answer, in the steps' order
 */
export async function readPacked(steps) {
  const calls = [];
  let current = [];
  let size = 0;
  for (const step of steps) {
    if (current.length > 0 && (size + step.bytes > CALL_BUDGET || current.length >= RECORDS.steps)) {
      calls.push(current);
      current = [];
      size = 0;
    }
    current.push(step);
    size += step.bytes;
  }
  if (current.length > 0) calls.push(current);
  const answers = [];
  for (const call of calls) {
    const parts = call.map(({ model, action, args }) => ({ model, action, args }));
    if (parts.length === 1) answers.push(await modelAction(parts[0].model, parts[0].action, parts[0].args));
    else answers.push(...(await modelBatch(parts)));
  }
  return answers;
}
