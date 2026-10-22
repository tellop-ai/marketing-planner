/**
 * An amount as the person typed it, as whole money units: digits, or digits
 * grouped by thousands with a dot, a comma or a space (`1.500`, `1,500`,
 * `1 500`). Empty is none (null); anything else is not a whole amount
 * (undefined), and the page refuses it with the address's words.
 *
 * @param {string} text
 * @returns {number | null | undefined}
 */
export function amountOf(text) {
  const value = String(text ?? '').trim();
  if (value === '') return null;
  const grouped = /^\d{1,3}(?:[.,\s ]\d{3})+$/u.test(value) ? value.replace(/[.,\s ]/gu, '') : value;
  if (!/^\d{1,13}$/u.test(grouped)) return undefined;
  return Number(grouped);
}
