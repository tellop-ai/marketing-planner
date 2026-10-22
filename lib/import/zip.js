import { inflateRawSync } from 'node:zlib';
import { IMPORT_LIMITS as L, bounded, decode, refuse } from './limits.js';
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function filename(name) {
  if (!name || name.length > 256 || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /[:%]/.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..')) refuse('import.zip');
  return name;
}
// Extra fields are bounded TLVs. Conflicting names, ZIP64 and encryption metadata
// would change the interpretation of the central record and are unsupported.
function extras(bytes, originalName, originalComment = Buffer.alloc(0)) {
  const ids = new Set(); let pos = 0;
  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) refuse('import.zip');
    const id = bytes.readUInt16LE(pos), size = bytes.readUInt16LE(pos + 2); pos += 4;
    if (pos + size > bytes.length || ([0x7075, 0x6375].includes(id) && ids.has(id)) || [1, 0x0017, 0x0018, 0x0019, 0x9901].includes(id)) refuse('import.zip');
    if ([0x7075, 0x6375].includes(id)) {
      const original = id === 0x7075 ? originalName : originalComment;
      if (size < 5 || bytes[pos] !== 1 || bytes.readUInt32LE(pos + 1) !== crc32(original) || decode(bytes.subarray(pos + 5, pos + size)) !== decode(original)) refuse('import.zip');
    }
    ids.add(id); pos += size;
  }
}
/** Central/local metadata, descriptors and occupied ranges must agree. */
export function unzip(bytes) {
  bounded(bytes.length, L.fileBytes);
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 22) refuse('import.zip');
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { if (end !== -1) refuse('import.zip'); end = i; }
  }
  if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) refuse('import.zip');
  const count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16);
  if (!count || count !== b.readUInt16LE(end + 8) || start + size !== end) refuse('import.zip');
  bounded(count, L.entries);
  const records = [], names = new Set(); let pos = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || b.readUInt32LE(pos) !== 0x02014b50) refuse('import.zip');
    const flags = b.readUInt16LE(pos + 8), method = b.readUInt16LE(pos + 10), crc = b.readUInt32LE(pos + 16), compressed = b.readUInt32LE(pos + 20), inflated = b.readUInt32LE(pos + 24);
    const n = b.readUInt16LE(pos + 28), extra = b.readUInt16LE(pos + 30), comment = b.readUInt16LE(pos + 32), offset = b.readUInt32LE(pos + 42);
    if ((flags & ~(0x808 | (method === 8 ? 6 : 0))) || ![0, 8].includes(method) || b.readUInt16LE(pos + 34) || compressed === 0xffffffff || inflated === 0xffffffff || offset === 0xffffffff || pos + 46 + n + extra + comment > end) refuse('import.zip');
    extras(b.subarray(pos + 46 + n, pos + 46 + n + extra), b.subarray(pos + 46, pos + 46 + n), b.subarray(pos + 46 + n + extra, pos + 46 + n + extra + comment));
    bounded(compressed, L.fileBytes); bounded(inflated, L.entryBytes); bounded(total += inflated, L.inflatedBytes);
    const name = filename(decode(b.subarray(pos + 46, pos + 46 + n)));
    if (names.has(name)) refuse('import.zip'); names.add(name);
    if (offset + 30 > start || b.readUInt32LE(offset) !== 0x04034b50) refuse('import.zip');
    const ln = b.readUInt16LE(offset + 26), le = b.readUInt16LE(offset + 28), data = offset + 30 + ln + le;
    if (ln !== n || data + compressed > start || b.readUInt16LE(offset + 6) !== flags || b.readUInt16LE(offset + 8) !== method || b.readUInt32LE(offset + 10) !== b.readUInt32LE(pos + 12) || decode(b.subarray(offset + 30, offset + 30 + ln)) !== name) refuse('import.zip');
    extras(b.subarray(offset + 30 + ln, data), b.subarray(offset + 30, offset + 30 + ln));
    const metadata = [crc, compressed, inflated], localMetadata = [14, 18, 22].map((at) => b.readUInt32LE(offset + at));
    let occupiedEnd = data + compressed;
    if (flags & 8) {
      if (localMetadata.some((value, i) => value !== 0 && value !== metadata[i])) refuse('import.zip');
      const candidates = [];
      for (const signed of [false, true]) {
        const at = occupiedEnd + (signed ? 4 : 0), length = signed ? 16 : 12;
        if (occupiedEnd + length <= start && (!signed || b.readUInt32LE(occupiedEnd) === 0x08074b50) && metadata.every((value, i) => b.readUInt32LE(at + i * 4) === value)) candidates.push(occupiedEnd + length);
      }
      if (candidates.length !== 1) refuse('import.zip');
      occupiedEnd = candidates[0];
    } else if (localMetadata.some((value, i) => value !== metadata[i])) refuse('import.zip');
    records.push({ name, offset, data, compressed, inflated, method, crc, occupiedEnd }); pos += 46 + n + extra + comment;
  }
  if (pos !== end) refuse('import.zip');
  const ordered = [...records].sort((a, c) => a.offset - c.offset); let next = 0;
  for (const r of ordered) { if (r.offset !== next) refuse('import.zip'); next = r.occupiedEnd; }
  if (next !== start) refuse('import.zip');
  const result = new Map();
  for (const r of records) {
    const raw = b.subarray(r.data, r.data + r.compressed); let value;
    try {
      if (r.method === 8) {
        const expanded = inflateRawSync(raw, { maxOutputLength: L.entryBytes, info: true });
        if (expanded.engine.bytesWritten !== raw.length) refuse('import.zip');
        value = expanded.buffer;
      } else value = raw;
    }
    catch (error) { if (error?.reason) throw error; refuse('import.tooLarge'); }
    bounded(value.length, L.entryBytes);
    if (value.length !== r.inflated || crc32(value) !== r.crc) refuse('import.zip');
    result.set(r.name, value);
  }
  return result;
}
