/**
 * The kinds of numbers file Results reads, by a file's name and its first
 * bytes. Pure and safe in the browser: the page picks the body type it sends
 * with, and the address checks the bytes again.
 *
 * - `.csv`: words separated by commas or semicolons;
 * - `.xlsx`: a spreadsheet, a zip inside (its bytes start with `PK`);
 * - `.xls`: read as a spreadsheet when its bytes start with `PK` (a new
 *   spreadsheet saved under the old name); a real old spreadsheet (its bytes
 *   start with the old format's mark) is refused with words that say to save
 *   it as `.xlsx` or `.csv` first.
 */

/** The body type the address takes for each kind of file it reads. */
export const FILE_TYPES = Object.freeze({
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

/** What the file chooser offers. */
export const FILE_ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

/** The refusal for an old spreadsheet. */
export const OLD_SPREADSHEET = 'results.import.oldXls';

/** The bytes a file must start with to be looked at: enough for both marks. */
export const START_BYTES = 8;

/** A zip's first bytes (`PK`, 3, 4) and the old spreadsheet format's mark. */
const ZIP_MARK = Object.freeze([0x50, 0x4b, 0x03, 0x04]);
const OLD_MARK = Object.freeze([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * The kind of a picked file by its name: `csv`, `xlsx`, `xls`, or null.
 *
 * @param {unknown} name
 * @returns {'csv' | 'xlsx' | 'xls' | null}
 */
export function kindOfFile(name) {
  const lower = String(name ?? '').trim().toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  return null;
}

/**
 * What a file's first bytes say it is: `zip` (a spreadsheet's zip), `old`
 * (the old spreadsheet format) or `other`.
 *
 * @param {Uint8Array | null | undefined} bytes
 * @returns {'zip' | 'old' | 'other'}
 */
export function startOf(bytes) {
  const starts = (mark) => bytes instanceof Uint8Array && bytes.length >= mark.length && mark.every((byte, index) => bytes[index] === byte);
  if (starts(ZIP_MARK)) return 'zip';
  if (starts(OLD_MARK)) return 'old';
  return 'other';
}

/**
 * How a picked file is sent: `{ kind }` (the kind the address reads it as)
 * or `{ problem }` (a words key): a `.csv` as words; an `.xlsx` or `.xls`
 * whose bytes are a zip as a spreadsheet; one in the old spreadsheet format
 * refused; an `.xls` that is neither refused the same way (it is not a
 * spreadsheet this reads); an `.xlsx` that is neither sent, for the address
 * to say what is wrong. Any other name is refused `results.import.wrongKind`.
 *
 * @param {string | null} kind from `kindOfFile`
 * @param {'zip' | 'old' | 'other'} start from `startOf`
 * @returns {{ kind: 'csv' | 'xlsx' } | { problem: string }}
 */
export function sendKind(kind, start) {
  if (kind === 'csv') return { kind: 'csv' };
  if (kind !== 'xlsx' && kind !== 'xls') return { problem: 'results.import.wrongKind' };
  if (start === 'zip') return { kind: 'xlsx' };
  if (start === 'old' || kind === 'xls') return { problem: OLD_SPREADSHEET };
  return { kind: 'xlsx' };
}
