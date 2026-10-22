import { IMPORT_LIMITS as L, bounded, refuse, finish } from './limits.js';
/** Both separators are counted only outside quoted cells in the heading row. */
function separator(text) {
  let quoted = false, comma = 0, semi = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted) { if (c === '\n' || c === '\r') break; if (c === ',') comma++; if (c === ';') semi++; }
  }
  if (comma && semi && comma === semi) refuse('import.ambiguous');
  return semi > comma ? ';' : ',';
}
export function readCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const sep = separator(text), matrix = [];
  let row = [], cell = '', state = 'start', count = 0, ended = false;
  const pushCell = () => { bounded(++count, L.cells); bounded(row.length + 1, L.columns); row.push(cell); cell = ''; state = 'start'; };
  const pushRow = () => { pushCell(); bounded(matrix.length + 1, L.rows + 1); matrix.push(row); row = []; ended = true; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; ended = false;
    if (state === 'quoted') {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else state = 'closed'; }
      else cell += c;
    } else if (c === sep) pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && state === 'start') state = 'quoted';
    else { if (state === 'closed' || c === '"') refuse(); cell += c; state = 'plain'; }
    bounded(cell.length, L.stringLength);
  }
  if (state === 'quoted') refuse();
  if (!ended && (text.length || row.length || cell.length)) pushRow();
  if (matrix.some((r) => r.length !== matrix[0].length)) refuse('import.rowWidth');
  return finish(matrix);
}
