import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { readRows, matchHeadings, checkRows, plain, IMPORT_LIMITS as L } from '../lib/import/index.js';
import { crc32 } from '../lib/import/zip.js';
import { xml } from '../lib/import/xml.js';
const enc = (s) => Buffer.from(s);
const reject = async (data, kind, reason) => assert.rejects(readRows(data, { kind }), (e) => e.reason === reason);
// A recorded heading row, with entirely invented contents below.
const headings = ['Firma adı', 'Yetkili kişi', 'Telefon', 'Vergi no', 'Sektör', 'Aylık ücret (TL)', 'Aylık beyannameler'];
const fields = [
  { name: 'name', headings: ['Firma adı'] }, { name: 'contactPerson', headings: ['Yetkili kişi'] },
  { name: 'phone', headings: ['Telefon'] }, { name: 'taxNumber', headings: ['Vergi no'] },
  { name: 'sector', headings: ['Sektör'] }, { name: 'monthlyFee', headings: ['Aylık ücret'] },
  { name: 'filingTypes', headings: ['Aylık beyannameler'] },
];
function zip(parts, options = {}) {
  const locals = [], central = []; let offset = 0;

  for (const [name, content] of parts) {
    const raw = enc(content), body = options.stored ? raw : zlib.deflateRawSync(raw), n = enc(name);
    const extra = typeof options.extra === 'function' ? options.extra(n) : options.extra ?? Buffer.alloc(0);
    const declared = options.declared ?? raw.length, crc = crc32(raw), method = options.stored ? 0 : 8;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(options.flags ?? 0x800, 6); l.writeUInt16LE(method, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(declared, 22); l.writeUInt16LE(n.length, 26); l.writeUInt16LE(extra.length, 28);
    let descriptor = Buffer.alloc(0);
    if (options.descriptor) { l.fill(0, 14, 26); descriptor = Buffer.alloc(options.descriptor === 'signed' ? 16 : 12); const at = descriptor.length === 16 ? 4 : 0; if (at) descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, at); descriptor.writeUInt32LE(body.length, at + 4); descriptor.writeUInt32LE(declared, at + 8); l.writeUInt16LE(0x808, 6); }
    locals.push(l, n, extra, body, descriptor);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(options.flags ?? 0x800, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(declared, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42); c.writeUInt16LE(extra.length, 30); if (options.descriptor) c.writeUInt16LE(0x808, 8); central.push(c, n, extra); offset += l.length + n.length + extra.length + body.length + descriptor.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const BOOK = '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" r:id="rFirst"/><sheet name="Second" r:id="rSecond"/></sheets></workbook>';
const RELS = `<Relationships><Relationship Id="rFirst" Type="${OFFICE}worksheet" Target="worksheets/custom.xml"/><Relationship Id="rSecond" Type="${OFFICE}worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="strings" Type="${OFFICE}sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const SHEET = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Aylık ücret (TL)</t></is></c><c r="C1" t="inlineStr"><is><t>Aylık beyannameler</t></is></c><c r="D1" t="inlineStr"><is><t>Unknown column</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><r><t>Invented &amp; </t></r><r><t>Co</t></r></is></c><c r="B2"><v>25.50</v></c><c r="C2" t="s"><v>1</v></c></row></sheetData></worksheet>';
function parts(sheet = SHEET, rels = RELS) { return [['xl/workbook.xml', BOOK], ['xl/_rels/workbook.xml.rels', rels], ['xl/sharedStrings.xml', '<sst><si><t>Firma adı</t></si><si><t>kdv</t></si></sst>'], ['xl/worksheets/custom.xml', sheet], ['xl/worksheets/sheet1.xml', '<not-a-worksheet/>']]; }

test('recorded headings retain and match fee, filings and every heading', async () => {
  const result = await readRows(enc(`\uFEFF${headings.join(';')}\r\nHayali Firma;Hayali kişi;000;FAKE-25;Örnek;25;kdv\r\n`), { kind: 'csv' });
  assert.deepEqual(result.headings, headings); assert.equal(result.rows.length, 1);
  const match = matchHeadings(result.headings, fields);
  assert.equal(match.matched.monthlyFee, 5); assert.equal(match.matched.filingTypes, 6); assert.deepEqual(match.unread, []); assert.deepEqual(match.missing, []);
});
test('normalizes Turkish capitals, combining marks, bracketed units and punctuation', () => {
  for (const name of ['AYLIK ÜCRET (TL)', 'Aylık ücret [₺]', 'Aylık ücret {TRY}', ' Aylık—ücret. ', 'Aylık u\u0308cret']) assert.equal(plain(name), 'aylik ucret');
  assert.equal(plain('I İ ı i'), 'i i i i');
});
test('unknown and conflicting headings stay visible; field aliases cannot silently overwrite', () => {
  const m = matchHeadings(['Firma adı', 'Unknown', 'Aylık ücret (TL)', 'Aylık ücret [TL]'], fields);
  assert.equal(m.matched.name, 0); assert.equal(m.matched.monthlyFee, undefined);
  assert.deepEqual(m.unread.map((h) => h.index), [1, 2, 3]); assert.ok(m.missing.includes('monthlyFee'));
  assert.deepEqual(matchHeadings(['same'], [{ name: 'a', headings: ['same'] }, { name: 'b', headings: ['same'] }]).matched, {});
});
test('CSV quotes, escaped quotes, embedded newlines, comma and semicolon', async () => {
  assert.deepEqual(await readRows(enc('a,b\n"first,cell","say ""hello""\nnext"\n'), { kind: 'csv' }), { headings: ['a', 'b'], rows: [['first,cell', 'say "hello"\nnext']] });
  assert.deepEqual((await readRows(enc('"a,b";c\n"x;y";z'), { kind: 'csv' })).rows, [['x;y', 'z']]);
  for (const s of ['a,b\n"unfinished,x', 'a,b\n"x"tail,y', 'a,b\nx"y,z']) await reject(enc(s), 'csv', 'import.malformed');
  await reject(enc('a,b\nx'), 'csv', 'import.rowWidth'); await reject(enc('a,b;c\nx,y;z'), 'csv', 'import.ambiguous');
  await reject(Buffer.from([0xff]), 'csv', 'import.malformed'); await reject(enc(''), 'csv', 'import.empty');
});
test('File and bytes only; oversize File refused before arrayBuffer', async () => {
  assert.equal((await readRows(new File(['a\nx'], 'fake.csv'))).rows[0][0], 'x');
  let calls = 0; await assert.rejects(readRows({ size: L.fileBytes + 1, name: 'fake.csv', arrayBuffer() { calls++; } }), (e) => e.reason === 'import.tooLarge'); assert.equal(calls, 0);
  await reject('/outside/path.csv', 'csv', 'import.unsupported'); await reject(enc('abc'), 'xls', 'import.unsupported');
  await reject(Buffer.alloc(L.fileBytes + 1), 'csv', 'import.tooLarge');
  await assert.rejects(readRows({ size: 1, name: 'f.csv', arrayBuffer: async () => enc('too long') }), (e) => e.reason === 'import.malformed');
});
test('CSV row, column, cell and string exact limits and one over', async () => {
  for (const n of [L.rows - 1, L.rows]) assert.equal((await readRows(enc('h\n' + Array(n).fill('x').join('\n')), { kind: 'csv' })).rows.length, n);
  await reject(enc('h\n' + Array(L.rows + 1).fill('x').join('\n')), 'csv', 'import.tooLarge');
  for (const n of [L.columns - 1, L.columns]) assert.equal((await readRows(enc(Array(n).fill('h').join(',')), { kind: 'csv' })).headings.length, n);
  await reject(enc(Array(L.columns + 1).fill('h').join(',')), 'csv', 'import.tooLarge');
  for (const n of [L.stringLength - 1, L.stringLength]) assert.equal((await readRows(enc('x'.repeat(n)), { kind: 'csv' })).headings[0].length, n);
  await reject(enc('x'.repeat(L.stringLength + 1)), 'csv', 'import.tooLarge');
  const line = Array(L.columns).fill('x').join(','); assert.equal((await readRows(enc(Array(250).fill(line).join('\n')), { kind: 'csv' })).rows.length, 249);
  await reject(enc(Array(251).fill(line).join('\n')), 'csv', 'import.tooLarge');
});
test('first workbook relationship wins; shared and inline rich text, sparse cells, all headings', async () => {
  for (const stored of [false, true]) {
    const r = await readRows(zip(parts(), { stored }), { kind: 'xlsx' });
    assert.deepEqual(r.headings, ['Firma adı', 'Aylık ücret (TL)', 'Aylık beyannameler', 'Unknown column']);
    assert.deepEqual(r.rows, [['Invented & Co', '25.50', 'kdv', '']]);
    assert.equal(matchHeadings(r.headings, fields).unread[0].heading, 'Unknown column');
  }
});
test('ZIP malformed, duplicate, encrypted, unsupported and traversal are refused', async () => {
  await reject(enc('PK nonsense'), 'xlsx', 'import.zip');
  for (const name of ['../escape.xml', '/escape.xml', 'xl/../escape.xml', 'C:escape', 'xl\\escape', 'xl/%2e%2e/escape']) await reject(zip([[name, 'x']]), 'xlsx', 'import.zip');
  await reject(zip([['same', 'x'], ['same', 'x']]), 'xlsx', 'import.zip');
  await reject(zip(parts(), { flags: 1 }), 'xlsx', 'import.zip');
  await reject(zip(parts(), { flags: 8 }), 'xlsx', 'import.zip');
  const corrupt = zip(parts()); corrupt[14] ^= 1; await reject(corrupt, 'xlsx', 'import.zip');
  const badcrc = zip(parts(), { stored: true }); badcrc[30 + enc('xl/workbook.xml').length] ^= 1; await reject(badcrc, 'xlsx', 'import.zip');
  await reject(zip(Array.from({ length: L.entries + 1 }, (_, i) => [`p${i}`, ''])), 'xlsx', 'import.tooLarge');
});
test('false ZIP metadata cannot remove actual inflate allocation cap', async () => {
  const original = zlib.inflateRawSync, observed = [];
  zlib.inflateRawSync = (bytes, options) => { observed.push(options?.maxOutputLength); return original(bytes, options); }; syncBuiltinESMExports();
  try {
    await reject(zip([['bomb', 'x'.repeat(L.entryBytes + 1)]], { declared: 1 }), 'xlsx', 'import.tooLarge');
    assert.deepEqual(observed, [L.entryBytes]);
  } finally { zlib.inflateRawSync = original; syncBuiltinESMExports(); }
  for (const n of [L.entryBytes - 1, L.entryBytes]) await reject(zip([['part', 'x'.repeat(n)]]), 'xlsx', 'import.xlsx');
  await reject(zip([['part', 'x'.repeat(L.entryBytes + 1)]]), 'xlsx', 'import.tooLarge');
});
test('XML refuses entities, declarations, malformed trees and duplicate attributes', async () => {
  for (const source of ['<!DOCTYPE worksheet [<!ENTITY a "boom">]><worksheet>&a;</worksheet>', '<worksheet>&unknown;</worksheet>', '<worksheet a="1" a="2"/>', '<worksheet><row></worksheet>', '<worksheet/><worksheet/>', '<?fetch remote?><worksheet/>', '<worksheet>&#0;</worksheet>']) await reject(zip(parts(source)), 'xlsx', 'import.xml');
  assert.equal(xml('<x>&#x130; &amp;</x>').text, 'İ &');
  for (const n of [L.xmlDepth - 1, L.xmlDepth]) assert.ok(xml('<x>'.repeat(n) + '</x>'.repeat(n)));
  assert.throws(() => xml('<x>'.repeat(L.xmlDepth + 1) + '</x>'.repeat(L.xmlDepth + 1)), (e) => e.reason === 'import.tooLarge');
});
test('XLSX refuses ambiguous/external relationships and oversized references', async () => {
  await reject(zip(parts(SHEET, RELS.replace('Target="worksheets/custom.xml"', 'Target="https://example.invalid/remote" TargetMode="External"'))), 'xlsx', 'import.xlsx');
  await reject(zip(parts(SHEET, RELS.replace('worksheets/custom.xml', '../escape.xml'))), 'xlsx', 'import.xlsx');
  await reject(zip(parts(SHEET, RELS.replace('Id="rSecond"', 'Id="rFirst"'))), 'xlsx', 'import.xlsx');

  await reject(zip(parts(SHEET.replace('r="A2"', 'r="XFD2"'))), 'xlsx', 'import.tooLarge');
  await reject(zip(parts(SHEET.replace('<v>0</v>', '<v>99999</v>'))), 'xlsx', 'import.xlsx');
});
test('checkRows classifies new, already-there, duplicate and invalid rows by reason without reads/writes', () => {
  const rows = [{ id: 'fresh' }, { id: 'known' }, { id: 'fresh' }, { id: '' }, { id: 'bad' }];
  const result = checkRows(rows, { key: (r) => r.id, existingKeys: ['known'], validate: (r) => r.id === 'bad' ? 'import.invalidFee' : null });
  assert.deepEqual(result.counts, { new: 1, alreadyThere: 1, problem: 3 });
  assert.deepEqual(result.rows.map((r) => r.reason), ['import.new', 'import.alreadyThere', 'import.duplicateKey', 'import.missingKey', 'import.invalidFee']);
  assert.equal(result.rows[0].row, rows[0]); assert.deepEqual(rows, [{ id: 'fresh' }, { id: 'known' }, { id: 'fresh' }, { id: '' }, { id: 'bad' }]);
});
test('metadata entry, aggregate inflate, XML node and shared string caps at boundaries', async () => {
  for (const n of [L.entries - 1, L.entries]) await reject(zip(Array.from({ length: n }, (_, i) => [`p${i}`, ''])), 'xlsx', 'import.xlsx');
  for (const n of [L.inflatedBytes - 1, L.inflatedBytes]) {
    const chunks = Array.from({ length: Math.ceil(n / L.entryBytes) }, (_, i) => [`p${i}`, 'x'.repeat(Math.min(L.entryBytes, n - i * L.entryBytes))]);
    await reject(zip(chunks), 'xlsx', 'import.xlsx');
  }
  await reject(zip([...Array.from({ length: 8 }, (_, i) => [`p${i}`, 'x'.repeat(L.entryBytes)]), ['over', 'x']]), 'xlsx', 'import.tooLarge');
  for (const n of [L.xmlNodes - 1, L.xmlNodes]) assert.ok(xml('<x>' + '<a/>'.repeat(n - 1) + '</x>'));
  assert.throws(() => xml('<x>' + '<a/>'.repeat(L.xmlNodes) + '</x>'), (e) => e.reason === 'import.tooLarge');
  for (const n of [L.strings - 1, L.strings]) {
    const p = parts(); p[2][1] = '<sst>' + '<si><t>x</t></si>'.repeat(n) + '</sst>';
    assert.equal((await readRows(zip(p), { kind: 'xlsx' })).headings[0], 'x');
  }
  const p = parts(); p[2][1] = '<sst>' + '<si><t>x</t></si>'.repeat(L.strings + 1) + '</sst>'; await reject(zip(p), 'xlsx', 'import.tooLarge');
});
test('File bytes cap accepts exact limit and refuses over without parser allocation', async () => {
  for (const n of [L.fileBytes - 1, L.fileBytes]) {
    // 65 rows, each a legal single cell, totals exactly n UTF-8 bytes.
    const lengths = Array(65).fill(Math.floor((n - 64) / 65)); lengths[0] += n - 64 - lengths.reduce((a, b) => a + b, 0);
    const b = enc(lengths.map((length) => 'x'.repeat(length)).join('\n'));
    assert.equal(b.length, n); assert.equal((await readRows(b, { kind: 'csv' })).rows.length, 64);
  }
  await reject(Buffer.alloc(L.fileBytes + 1), 'csv', 'import.tooLarge');
});

test('own field names, standard CRC vector and unsupported cell XML cannot disappear', async () => {
  const m = matchHeadings(['custom'], [{ name: '__proto__', headings: ['custom'] }]);
  assert.equal(Object.hasOwn(m.matched, '__proto__'), true); assert.equal(m.matched.__proto__, 0); assert.deepEqual(m.missing, []);
  assert.equal(crc32(enc('123456789')), 0xcbf43926);
  await reject(zip(parts(SHEET.replace('<v>25.50</v>', '<mystery/>'))), 'xlsx', 'import.unsupported');
  await reject(zip(parts(SHEET.replace('<v>25.50</v>', '<v><nested/></v>'))), 'xlsx', 'import.xlsx');
  assert.throws(() => xml('<x>&#65535;</x>'), (e) => e.reason === 'import.xml');
});

test('ordinary descriptors and extra metadata retain values; corrupt metadata refuses', async () => {
  const extra = Buffer.from([0x55, 0x54, 5, 0, 1, 0, 0, 0, 0]);
  for (const descriptor of ['signed', 'unsigned']) for (const stored of [false, true]) {
    const data = zip(parts(), { descriptor, extra, stored });
    assert.equal((await readRows(data, { kind: 'xlsx' })).rows[0][1], '25.50');
    const bad = Buffer.from(data), firstEnd = 30 + enc(parts()[0][0]).length + extra.length + (stored ? enc(BOOK).length : zlib.deflateRawSync(enc(BOOK)).length);
    bad[firstEnd + (descriptor === 'signed' ? 4 : 0)] ^= 1; await reject(bad, 'xlsx', 'import.zip');
    for (const delta of [4, 8]) { const inconsistent = Buffer.from(data); inconsistent[firstEnd + (descriptor === 'signed' ? 4 : 0) + delta] ^= 1; await reject(inconsistent, 'xlsx', 'import.zip'); }
    const localMismatch = Buffer.from(data); localMismatch.writeUInt32LE(1, 18); await reject(localMismatch, 'xlsx', 'import.zip');
  }
  assert.equal((await readRows(zip(parts(), { extra }), { kind: 'xlsx' })).rows[0][1], '25.50');
  for (const extra of [Buffer.from([1, 0, 0, 0]), Buffer.from([0x55, 0x54, 8, 0, 1])]) await reject(zip(parts(), { extra }), 'xlsx', 'import.zip');
  const unicodePath = (name) => { const field = Buffer.alloc(9 + name.length); field.writeUInt16LE(0x7075); field.writeUInt16LE(5 + name.length, 2); field[4] = 1; field.writeUInt32LE(crc32(name), 5); name.copy(field, 9); return field; };
  assert.equal((await readRows(zip(parts(), { extra: unicodePath }), { kind: 'xlsx' })).rows[0][1], '25.50');
  await reject(zip(parts(), { extra: (name) => { const field = unicodePath(name); field[9] ^= 1; return field; } }), 'xlsx', 'import.zip');
  const sentinel = zip(parts()); const centralStart = sentinel.readUInt32LE(sentinel.length - 6); sentinel.writeUInt32LE(0xffffffff, centralStart + 24); await reject(sentinel, 'xlsx', 'import.zip');
  const overlap = zip(parts(), { descriptor: 'signed' }); const cd = overlap.readUInt32LE(overlap.length - 6); const second = cd + 46 + enc(parts()[0][0]).length; overlap.writeUInt32LE(1, second + 42); await reject(overlap, 'xlsx', 'import.zip');
});
test('cached formula values are read without evaluating formula text', async () => {
  for (const [type, raw] of [['n', '2'], ['str', 'cached'], ['b', '1']]) {
    const cell = `<c r="B2" t="${type}"><f>globalThis.formulaExecuted=true;process.exit(1)</f><v>${raw}</v></c>`;
    assert.equal((await readRows(zip(parts(SHEET.replace('<c r="B2"><v>25.50</v></c>', cell))), { kind: 'xlsx' })).rows[0][1], raw);
    assert.equal(globalThis.formulaExecuted, undefined);
  }
  for (const content of ['<f>1+1</f>', '<f>1</f><f>2</f><v>2</v>', '<f>1</f><v>2</v><v>3</v>', '<f><v>2</v></f><v>2</v>', '<f>1</f><v/>']) await reject(zip(parts(SHEET.replace('<v>25.50</v>', content))), 'xlsx', 'import.xlsx');
});
test('shared and inline plain/rich strings exclude phonetic annotations', async () => {
  for (const rich of [false, true]) {
    const displayed = rich ? '<r><t>Firma </t></r><r><t>adı</t></r>' : '<t>Firma adı</t>';
    const content = displayed + '<rPh sb="0" eb="1"><t>annotation</t></rPh><phoneticPr fontId="0"/>';
    const p = parts(SHEET.replace('<is><r><t>Invented &amp; </t></r><r><t>Co</t></r></is>', `<is>${content}</is>`)); p[2][1] = `<sst><si>${content}</si><si><t>kdv</t></si></sst>`;
    const result = await readRows(zip(p), { kind: 'xlsx' }); assert.equal(result.headings[0], 'Firma adı'); assert.equal(result.rows[0][0], 'Firma adı');
  }
});
test('explicit Internal relationships accepted; External strings refused', async () => {
  assert.equal((await readRows(zip(parts(SHEET, RELS.replaceAll(' Target=', ' TargetMode="Internal" Target='))), { kind: 'xlsx' })).rows[0][2], 'kdv');
  await reject(zip(parts(SHEET, RELS.replace('Target="sharedStrings.xml"', 'Target="sharedStrings.xml" TargetMode="External"'))), 'xlsx', 'import.xlsx');
});

// Persistence refuses the whole shaped payload before importing/opening records.
test('save preflight rejects problems, unsafe shapes and actual payload bounds', async () => {
  const {saveRows, undoRows, checkRows} = await import('../lib/import/index.js');
  const checked = row => checkRows([row], {key:() => 'key'});
  await assert.rejects(saveRows({rows:[{status:'problem'}]}, {model:'Client'}));
  for (const row of [{n:Infinity},{n:undefined},{n:new Date()},JSON.parse('{"constructor":"bad"}')])
    await assert.rejects(saveRows(checked(row),{model:'Client'}));
  const list = checkRows(Array.from({length:257}, (_,i)=>({tax:String(i)})),{key:row=>row.tax});
  await assert.rejects(saveRows(list,{model:'Client'}), /import.tooLarge/);
  const large = checkRows(Array.from({length:25}, (_,i)=>({tax:String(i),name:'x'.repeat(65536)})),{key:row=>row.tax});
  await assert.rejects(saveRows(large,{model:'Client'}), /import.tooLarge/);
  await assert.rejects(undoRows([1,1],{model:'Client'}));
  await assert.rejects(undoRows([NaN],{model:'Client'}));
});

test('persistence snapshots reject accessors, symbols and extra array keys without reading getters', async () => {
  const {saveRows,undoRows,checkRows} = await import('../lib/import/index.js');
  let getters=0;
  const row={}; Object.defineProperty(row,'tax',{enumerable:true,get(){getters++;return 'bad';}});
  await assert.rejects(saveRows(checkRows([row],{key:()=> 'safe'}),{model:'Client'}));
  const ids=[1]; Object.defineProperty(ids,'0',{enumerable:true,get(){getters++;return 1;}});
  await assert.rejects(undoRows(ids,{model:'Client'}));
  assert.equal(getters,0);
  for(const key of ['extra',Symbol('extra')]) {
    const ids=[1]; ids[key]=2;
    await assert.rejects(undoRows(ids,{model:'Client'}));
    const row={tax:'safe'}; row[key]='bad';
    await assert.rejects(saveRows(checkRows([row],{key:()=> 'safe'}),{model:'Client'}));
  }
  const known=checkRows(Array.from({length:5},(_,i)=>({id:String(i)+'x'.repeat(60000),name:'Known'})),{key:row=>row.id});
  await assert.rejects(saveRows(known,{model:'Person'}), /import.tooLarge/);
  const mixed=checkRows([...known.rows.map(entry=>entry.row),{name:'Generated'}],{key:row=>row.id || 'generated'});
  await assert.rejects(saveRows(mixed,{model:'GeneratedClient'}), /import.tooLarge/);
});
