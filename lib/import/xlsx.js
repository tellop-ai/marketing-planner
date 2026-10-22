import { IMPORT_LIMITS as L, bounded, decode, refuse, finish } from './limits.js';
import { unzip } from './zip.js';
import { xml, children, local, one, stringText } from './xml.js';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
function target(value) {
  if (typeof value !== 'string' || /[\\:%?#]/.test(value) || value.includes('\0')) refuse('import.xlsx');
  const name = value.startsWith('/') ? value.slice(1) : `xl/${value}`;
  if (name.split('/').some((p) => !p || p === '.' || p === '..')) refuse('import.xlsx');
  return name;
}
export function readXlsx(bytes) {
  const files = unzip(bytes);
  const part = (name, root) => { if (!files.has(name)) refuse('import.xlsx'); const tree = xml(decode(files.get(name))); if (local(tree) !== root) refuse('import.xlsx'); return tree; };
  const workbook = part('xl/workbook.xml', 'workbook'), rels = part('xl/_rels/workbook.xml.rels', 'Relationships');
  const relations = new Map(); let sharedName;
  for (const r of rels.children) {
    if (local(r) !== 'Relationship' || r.children.length || !r.attrs.Id || relations.has(r.attrs.Id) || (r.attrs.TargetMode !== undefined && r.attrs.TargetMode !== 'Internal')) refuse('import.xlsx');
    const name = target(r.attrs.Target); relations.set(r.attrs.Id, { name, type: r.attrs.Type });
    if (r.attrs.Type === `${OFFICE}sharedStrings`) { if (sharedName) refuse('import.ambiguous'); sharedName = name; }
  }
  const sheetsPart = one(workbook, 'sheets');
  if (sheetsPart.children.some((s) => local(s) !== 'sheet') || sheetsPart.text.trim()) refuse('import.xlsx');
  const sheets = children(sheetsPart, 'sheet'); if (!sheets.length) refuse('import.xlsx');
  const ids = new Set();
  for (const s of sheets) { if (!s.attrs['r:id'] || ids.has(s.attrs['r:id'])) refuse('import.xlsx'); ids.add(s.attrs['r:id']); }
  const relation = relations.get(sheets[0].attrs['r:id']);
  if (!relation || relation.type !== `${OFFICE}worksheet`) refuse('import.xlsx');
  const strings = [];
  if (sharedName) {
    for (const si of part(sharedName, 'sst').children) { if (local(si) !== 'si') refuse('import.xlsx'); bounded(strings.length + 1, L.strings); strings.push(stringText(si)); }
  }
  const sheet = part(relation.name, 'worksheet'), matrix = []; let count = 0, lastRow = 0, width = 0;
  for (const row of one(sheet, 'sheetData').children) {
    if (local(row) !== 'row' || !/^[1-9]\d*$/.test(row.attrs.r ?? '')) refuse('import.xlsx');
    const number = Number(row.attrs.r); bounded(number, L.rows + 1); if (number <= lastRow) refuse('import.xlsx');
    while (matrix.length < number - 1) matrix.push([]);
    const values = []; let lastColumn = -1;
    for (const cell of row.children) {
      if (local(cell) !== 'c') refuse('import.unsupported');
      const formulas = children(cell, 'f');
      if (formulas.length > 1 || formulas.some((f) => f.children.length)) refuse('import.xlsx');
      const ref = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell.attrs.r ?? ''); if (!ref || Number(ref[2]) !== number) refuse('import.xlsx');
      let column = 0; for (const c of ref[1]) column = column * 26 + c.charCodeAt(0) - 64;
      bounded(column, L.columns); bounded(++count, L.cells); if (column <= lastColumn) refuse('import.xlsx'); lastColumn = column;
      const type = cell.attrs.t ?? 'n'; let value;
      if (cell.text.trim() || cell.children.some((c) => ![type === 'inlineStr' ? 'is' : 'v', 'f'].includes(local(c)))) refuse('import.unsupported');
      if (formulas.length && (type === 'inlineStr' || children(cell, 'v').length !== 1 || (type !== 'str' && !children(cell, 'v')[0].text))) refuse('import.xlsx');
      if (type === 'inlineStr') value = stringText(one(cell, 'is'));
      else {
        const vs = children(cell, 'v'); if (vs.length > 1 || vs.some((v) => v.children.length)) refuse('import.xlsx'); const raw = vs[0]?.text ?? '';
        if (type === 's') { if (!/^(0|[1-9]\d*)$/.test(raw) || Number(raw) >= strings.length) refuse('import.xlsx'); value = strings[Number(raw)]; }
        else if (['n', 'str', 'b'].includes(type)) { if (type === 'n' && raw && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw)) refuse('import.xlsx'); if (type === 'b' && !['0', '1'].includes(raw)) refuse('import.xlsx'); value = raw; }
        else refuse('import.unsupported');
      }
      bounded(value.length, L.stringLength); while (values.length < column - 1) values.push(''); values.push(value);
    }
    width = Math.max(width, values.length); matrix.push(values); lastRow = number;
  }
  bounded(matrix.length * width, L.cells);
  for (const row of matrix) while (row.length < width) row.push('');
  return finish(matrix);
}
