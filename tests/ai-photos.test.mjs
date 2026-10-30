import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pictureFromPhotos } from '../lib/ai.js';
import { keepFile, keptBytesForAi } from '../lib/data/files.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const photo = (side = 16, size = 64) => {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0); b.writeUInt32LE(size - 8, 4); b.write('WEBPVP8 ', 8);
  b.writeUInt32LE(size - 20, 16); b.set([0x9d, 1, 0x2a], 23);
  b.writeUInt16LE(side, 26); b.writeUInt16LE(side, 28);
  return b;
};

test('photo refs: exact private operation, validation, abort and failure words', async () => {
  const oldFetch = globalThis.fetch;
  const oldFlag = process.env.TELLOP_INTERNAL_RECORDS;
  const mark = Symbol.for('tellop.ai'); const oldMark = globalThis[mark];
  process.env.TELLOP_INTERNAL_RECORDS = '1'; globalThis[mark] = true;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ file: 'c'.repeat(64), size: 100, kind: 'webp' });
    };
    const controller = new AbortController();
    const files = ['a'.repeat(64), 'b'.repeat(64)];
    assert.deepEqual(await pictureFromPhotos({ files, prompt: 'At sea', signal: controller.signal }),
      { file: 'c'.repeat(64), size: 100, kind: 'webp', shows: 'picture' });
    assert.equal(calls[0].url, 'http://ai.tellop.invalid/v1/tellop/picture-from-photos');
    assert.deepEqual(JSON.parse(calls[0].init.body), { files, prompt: 'At sea' });
    assert.equal(calls[0].init.signal, controller.signal);
    for (const invalid of [undefined, [], ['../secret'], ['a'.repeat(64), 'a'.repeat(64)], [null], 'x']) {
      await assert.rejects(pictureFromPhotos({ files: invalid, prompt: 'At sea' }), { code: 'request-invalid' });
    }
    await assert.rejects(pictureFromPhotos({ files: [...files, 'c'.repeat(64)], prompt: 'At sea' }), { code: 'request-over-bound' });
    await assert.rejects(pictureFromPhotos({ files, prompt: '' }), { code: 'request-invalid' });
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => Response.json({ error: { type: 'tellop', code: 'paused-by-person' } }, { status: 403 });
    await assert.rejects(pictureFromPhotos({ files, prompt: 'At sea' }), { wordsKey: 'ai.paused' });
    const abort = new DOMException('Stopped', 'AbortError');
    globalThis.fetch = async () => { throw abort; };
    await assert.rejects(pictureFromPhotos({ files, prompt: 'At sea' }), error => error === abort);
    delete globalThis[mark];
    await assert.rejects(pictureFromPhotos({ files, prompt: 'At sea' }), { code: 'unavailable' });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldFlag === undefined) delete process.env.TELLOP_INTERNAL_RECORDS; else process.env.TELLOP_INTERNAL_RECORDS = oldFlag;
    if (oldMark === undefined) delete globalThis[mark]; else globalThis[mark] = oldMark;
  }
});

test('outside Tellop: owned bounded measured copies, multipart input, kept output; bad references never send', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tellop-kit-photo-'));
  const oldFetch = globalThis.fetch;
  const names = ['TELLOP_INTERNAL_RECORDS', 'APP_DATA_FILE', 'AI_BASE_URL'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  delete process.env.TELLOP_INTERNAL_RECORDS;
  process.env.APP_DATA_FILE = path.join(root, 'app.db'); process.env.AI_BASE_URL = 'https://test.invalid/v1';
  const calls = [];
  const output = photo(20);
  const keep = async bytes => (await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body: bytes }))).file;
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ b64_json: output.toString('base64') }] }); };
    const first = await keep(photo(1024, 512 * 1024));
    const second = await keep(photo(1023, 512 * 1024));
    assert.equal((await pictureFromPhotos({ files: [first, second], prompt: 'At sea' })).file, sha(output));
    assert.equal(calls[0].url, 'https://test.invalid/v1/images/edits');
    const form = calls[0].init.body;
    assert.equal(form.getAll('image[]').length, 2);
    assert.equal(form.getAll('image[]')[0].type, 'image/webp');
    assert.equal(form.get('prompt'), 'At sea'); assert.equal(form.has('mask'), false);
    const malformed = photo(); malformed.writeUInt32LE(999, 16);
    for (const bytes of [photo(1025), photo(16, 512 * 1024 + 2), malformed, Buffer.from('not WebP')]) {
      const file = await keep(bytes);
      await assert.rejects(pictureFromPhotos({ files: [file], prompt: 'At sea' }), { code: 'request-invalid' });
    }
    await assert.rejects(pictureFromPhotos({ files: ['d'.repeat(64)], prompt: 'At sea' }), { code: 'request-invalid' });
    await writeFile(path.join(root, 'files', first), photo(16));
    await assert.rejects(pictureFromPhotos({ files: [first], prompt: 'At sea' }), { code: 'request-invalid' });
    assert.equal(await keptBytesForAi(second, 512 * 1024 - 1), null);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    await rm(root, { recursive: true, force: true });
  }
});
