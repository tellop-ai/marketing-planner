/** Read-only, in-memory import. Pass a picked File or bytes with { kind: 'csv' | 'xlsx' }.
 * No pathname is accepted; no records, filesystem, network or credentials are accessed.
 * readRows answers {headings, rows}; matchHeadings keeps every unread/ambiguous heading.
 * checkRows takes an explicitly supplied key function, optional validator and known keys.
 * ImportError.reason/messageKey are stable refusal keys for the caller's words.
 */
import { IMPORT_LIMITS as L, bounded, decode, refuse } from './limits.js';
import { readCsv } from './csv.js';
import { readXlsx } from './xlsx.js';
export { IMPORT_LIMITS, ImportError } from './limits.js';
export async function readRows(input, { kind } = {}) {
  let bytes;
  if (input instanceof Uint8Array) { bounded(input.byteLength, L.fileBytes); bytes = input; }
  else if (input && typeof input.arrayBuffer === 'function' && Number.isSafeInteger(input.size) && input.size >= 0) {
    bounded(input.size, L.fileBytes);
    if (!kind) kind = String(input.name ?? '').toLowerCase().endsWith('.xlsx') ? 'xlsx' : String(input.name ?? '').toLowerCase().endsWith('.csv') ? 'csv' : undefined;
    if (!['csv', 'xlsx'].includes(kind)) refuse('import.unsupported');
    bytes = new Uint8Array(await input.arrayBuffer()); bounded(bytes.byteLength, L.fileBytes);
    if (bytes.byteLength !== input.size) refuse('import.malformed');
  } else refuse('import.unsupported');
  if (kind === 'csv') return readCsv(decode(bytes));
  if (kind === 'xlsx') return readXlsx(bytes);
  refuse('import.unsupported');
}
export function plain(value) {
  return String(value ?? '').replace(/[Iİı]/g, 'i').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function matchHeadings(headings, fields) {
  if (!Array.isArray(headings) || !Array.isArray(fields)) refuse();
  bounded(headings.length, L.columns); bounded(fields.length, L.columns);
  const aliases = new Map(), names = new Set();
  for (const field of fields) {
    if (!field || typeof field.name !== 'string' || names.has(field.name) || !Array.isArray(field.headings)) refuse('import.ambiguous');
    bounded(field.name.length, L.stringLength); names.add(field.name); bounded(field.headings.length, L.columns);
    for (const label of [field.name, ...field.headings]) {
      if (typeof label !== 'string') refuse(); bounded(label.length, L.stringLength); const key = plain(label);
      if (!key) refuse(); if (!aliases.has(key)) aliases.set(key, new Set()); aliases.get(key).add(field.name);
    }
  }
  const candidates = new Map(), unread = [];
  headings.forEach((heading, index) => {
    if (typeof heading !== 'string') refuse(); bounded(heading.length, L.stringLength);
    const found = aliases.get(plain(heading));
    if (!found) { unread.push({ heading, index, reason: 'import.unreadHeading' }); return; }
    for (const name of found) { if (!candidates.has(name)) candidates.set(name, []); candidates.get(name).push({ heading, index, ambiguous: found.size > 1 }); }
  });
  const matched = {}, ambiguous = [];
  for (const [name, cells] of candidates) {
    if (cells.length !== 1 || cells[0].ambiguous) { for (const cell of cells) if (!ambiguous.some((c) => c.index === cell.index)) ambiguous.push({ heading: cell.heading, index: cell.index, reason: 'import.ambiguousHeading' }); }
    else Object.defineProperty(matched, name, { value: cells[0].index, enumerable: true });
  }
  unread.push(...ambiguous); unread.sort((a, b) => a.index - b.index);
  return { matched, unread, missing: fields.filter((f) => !Object.hasOwn(matched, f.name)).map((f) => f.name) };
}
export function checkRows(rows, { key, validate = () => null, existingKeys = [] } = {}) {
  if (!Array.isArray(rows) || typeof key !== 'function' || typeof validate !== 'function' || !Array.isArray(existingKeys)) refuse();
  bounded(rows.length, L.rows); bounded(existingKeys.length, L.rows);
  const known = new Set();
  for (const value of existingKeys) { if (typeof value !== 'string') refuse(); bounded(value.length, L.stringLength); known.add(value); }
  const seen = new Set();
  const checked = rows.map((row, index) => {
    const value = key(row); if (typeof value !== 'string' || !value.trim()) return { index, row, status: 'problem', reason: 'import.missingKey' };
    bounded(value.length, L.stringLength);
    const reason = validate(row);
    if (reason) { if (typeof reason !== 'string') refuse(); return { index, row, key: value, status: 'problem', reason }; }
    if (seen.has(value)) return { index, row, key: value, status: 'problem', reason: 'import.duplicateKey' };
    seen.add(value);
    return { index, row, key: value, status: known.has(value) ? 'already-there' : 'new', reason: known.has(value) ? 'import.alreadyThere' : 'import.new' };
  });
  return { rows: checked, counts: { new: checked.filter((r) => r.status === 'new').length, alreadyThere: checked.filter((r) => r.status === 'already-there').length, problem: checked.filter((r) => r.status === 'problem').length } };
}

export { saveRows, undoRows } from './persist.js';
