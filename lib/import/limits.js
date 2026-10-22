/** Read-only import limits. Save-time record shaping has its own, tighter limits. */
export const IMPORT_LIMITS = Object.freeze({ fileBytes: 4 * 1024 * 1024, inflatedBytes: 8 * 1024 * 1024,
  entryBytes: 1024 * 1024, entries: 128, rows: 1000, columns: 128, cells: 32000,
  stringLength: 65536, strings: 4096, xmlNodes: 40000, xmlDepth: 32 });
export class ImportError extends Error {
  constructor(reason) { super(reason); this.name = 'ImportError'; this.reason = reason; this.messageKey = reason; }
}
export function refuse(reason = 'import.malformed') { throw new ImportError(reason); }
export function bounded(value, limit) { if (value > limit) refuse('import.tooLarge'); }
export function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { refuse(); }
}
export function finish(matrix) {
  if (!matrix.length) refuse('import.empty');
  const headings = matrix[0];
  if (!headings.length || headings.every((s) => !s.trim())) refuse('import.empty');
  return { headings, rows: matrix.slice(1) };
}
