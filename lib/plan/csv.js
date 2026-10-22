/**
 * Comma-separated text for a spreadsheet (RFC 4180), safe to open.
 *
 * A cell that starts with `=`, `+`, `-`, `@` (or their full-width forms `＝`,
 * `＋`, `－`, `＠`, which some spreadsheets read the same way), a tab or a
 * carriage return (also after spaces) could run as a formula when a
 * spreadsheet opens it, so it gets a `'` in front and shows as plain words. A cell holding a quote, a comma, a
 * semicolon, a line end, a tab or a space at either end is quoted, with its
 * quotes doubled. Rows end with `\r\n`. The text starts with a byte order mark,
 * so a spreadsheet reads Turkish letters right.
 */

/** The mark at the start of the text that tells a spreadsheet it is UTF-8. */
export const CSV_BOM = '\uFEFF';

const FORMULA_START = /^[\s]*[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/u;
const NEEDS_QUOTES = /[",;\r\n\t]|^\s|\s$/u;

/**
 * One cell as text: empty for null or undefined, numbers and true/false as
 * written, a date as its ISO instant, anything else as its words.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  let text = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString()) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The whole text: each row (an array of cells) on its own line.
 *
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function csvText(rows) {
  const lines = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row : [row]).map(csvCell).join(','));
  return `${CSV_BOM}${lines.map((line) => `${line}\r\n`).join('')}`;
}
