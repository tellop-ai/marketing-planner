/**
 * AI for this app's server code (AGENTS.md rule 3a). Call it only from a route
 * handler or a server action, never from the page: it reads the server's
 * settings, and inside Tellop it works only while a request is being answered.
 *
 * - `askAI({ level, messages, ...options })` answers `{ text, message, finishReason }`.
 * - `streamAI({ level, messages, ...options })` yields the answer's words as they come.
 * - `picturePart(bytes, type)` puts a PNG or WebP picture in a message, for AI to read.
 * - `picture({ prompt })` draws a picture; `editPicture({ file, mask, prompt })` changes one this app drew
 *   (`mask`: PNG bytes the picture's size, 1536 by 1024, at most 48 KB, clear where it should change: draw it with
 *   hard edges, which keeps it small). Both answer a kept file, `{ file, size, kind, shows }`, as `keepFile` does
 *   (rule 6c): keep `file` in a field ending `File`.
 * - `transcribe({ file, language })` writes down a kept recording and answers `{ text }`. Record it in the page
 *   with `lib/recording.js`, whose note says how: AAC in MP4 only, at most 1.5 MiB (about four minutes).
 *   `language` is optional, the language spoken in it: `en`, `tr`, `es`, `de`, `fr`, `it`, `pt`, `ja`, `ko` or
 *   `zh`. Name it when the app knows it (a language lesson does); any other value is refused before anything is sent.
 * - `speak({ text, voice })` reads `text` aloud in one of six voices (`alloy`, `echo`, `fable`, `nova`, `onyx`,
 *   `shimmer`) and answers a kept MP3 like a picture, with `aiVoice` true. `text` is at most 4,096 characters: cut
 *   a longer text into paragraphs, one call each. A page that plays it says on the page, beside the player, that
 *   the voice is an AI voice.
 * - Voice only on a press. Record only between the person's own start and stop presses, and read aloud only what
 *   a press asked for, never on its own. A page that records needs Tellop's "Use camera and devices" switch on for
 *   this app, and a store app names the `devices` need, with its reason, in its listing.
 *
 * Search by meaning comes in a later version: do not build it, and draw no button, field or page for it. Call
 * only the seven functions above; the one at the end of this file waits for that version.
 *
 * `level` is `quick`, `standard` or `best`: how much thought the action needs.
 * Never a model name: inside Tellop no request names a model, and the person may
 * move the whole app up or down a level. `messages` and the options are the
 * common chat request format (`max_tokens`, `temperature`, `top_p`, `stop`,
 * `seed`, `response_format`, `tools`, `tool_choice`, `parallel_tool_calls`).
 *
 * Inside Tellop the request goes to Tellop, with no key, on the person's
 * allowance. Outside Tellop it goes to `AI_BASE_URL` (for example
 * `https://api.openai.com/v1`) with `AI_API_KEY`, and names the model that
 * `AI_MODEL_QUICK`, `AI_MODEL_STANDARD` or `AI_MODEL_BEST` (else `AI_MODEL`)
 * gives for the level, or none (`AI_MODEL_PICTURE`, `AI_MODEL_TRANSCRIBE` and
 * `AI_MODEL_SPEECH` for the others, and a picture or a sound is kept in
 * `.data/files/`). No model name is ever written in this app's code.
 *
 * A failure throws `AiProblem`: `state` says which words to show (the locale key
 * is `wordsKey`, `ai.paused` and the rest, already in `lib/i18n/locales/`; show
 * them in the page near the button that asked, and never retry a paused or
 * refused call by yourself), `code` is the exact reason, and `periodEnd`
 * (milliseconds) says when an allowance that is used up renews.
 *
 * An answer is a proposal, never an instruction: show it, and save or act on it
 * only when the person accepts it. Send the person's information only for a
 * reason the screen gives (a press on "Write today's summary"), never in the
 * background or at page load, and only what the action needs. Inside Tellop the
 * AI needs no key, so an AI key is never one of the keys this app asks for.
 * Pictures: PNG or WebP, at most 2048 pixels a side and 512 KB each, two in one
 * request, and 700 KB for all the pictures in one request together (a request
 * carries a picture as text, a third larger); make a larger photo smaller
 * first. A request over these throws `request-over-bound` before it is sent.
 * One request may begin at most four AI calls, and four at once hold all four
 * of its open calls to Tellop, so its reads and saves fail until one answers:
 * ask one after another. Checks never call AI.
 */

import { fileResponse, keepFile } from './data/files.js';

export const AI_LEVELS = Object.freeze(['quick', 'standard', 'best']);

/** Tellop's address for this app's AI: a name no network serves, answered inside the app's own process. */
const TELLOP_AI_BASE = 'http://ai.tellop.invalid/v1';
/** Set by the Tellop that answers that address; an older Tellop has none, and then nothing is sent. */
const TELLOP_AI = Symbol.for('tellop.ai');

/** One picture, all the pictures in one request, how many, and one whole request, in bytes. */
const PICTURE_BYTES = 512 * 1024;
const PICTURES_BYTES = 700 * 1024;
const PICTURES = 2;
const REQUEST_BYTES = 1_000_000;

const OPTIONS = Object.freeze(['max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'stop', 'seed',
  'response_format', 'tools', 'tool_choice', 'parallel_tool_calls']);

/** Each reason Tellop can give, by the words a person sees for it. Any other reason is `unavailable`. */
const STATES = Object.freeze({
  'paused-by-person': 'paused',
  'paused-by-guard': 'paused',
  'open-tellop': 'openTellop',
  'notice-shown': 'needsPermission',
  'notice-open': 'needsPermission',
  'notice-later': 'needsPermission',
  'notice-not-now': 'needsPermission',
  'not-signed-in': 'signedOut',
  'no-sign-in-context': 'signedOut',
  'stale-sign-in': 'accountChanged',
  'meter-exhausted': 'allowance',
  'app-busy': 'busy',
  'account-busy': 'busy',
  busy: 'busy',
  offline: 'offline',
  'level-unknown': 'refused',
  'request-invalid': 'refused',
  'body-refused': 'refused',
  'request-over-bound': 'refused',
  'outside-request': 'refused',
  'model-named': 'refused',
  'not-found': 'refused',
  'method-refused': 'refused',
  'provider-declined': 'refused',
  'picture-not-drawn': 'notDrawnHere',
  'clip-unmeasured': 'clipUnreadable',
  'voice-paused': 'voicePaused',
  room: 'room',
  practice: 'practice',
  'app-ai-off': 'appAiOff',
});

/** The words for each state, in `lib/i18n/locales/`. */
const WORDS = Object.freeze({
  paused: 'ai.paused',
  openTellop: 'ai.openTellop',
  needsPermission: 'ai.needsPermission',
  signedOut: 'ai.signedOut',
  accountChanged: 'ai.accountChanged',
  allowance: 'ai.allowance',
  busy: 'ai.busy',
  offline: 'ai.offline',
  refused: 'ai.refused',
  unavailable: 'ai.unavailable',
  notDrawnHere: 'ai.notDrawnHere',
  clipUnreadable: 'ai.clipUnreadable',
  voicePaused: 'ai.voicePaused',
  room: 'error.fileRoom',
  practice: 'ai.practice',
  appAiOff: 'ai.appAiOff',
});

export class AiProblem extends Error {
  constructor(code, periodEnd) {
    const state = Object.hasOwn(STATES, code) ? STATES[code] : 'unavailable';
    super(`ai-${code}`);
    this.name = 'AiProblem';
    this.code = code;
    this.state = state;
    this.wordsKey = WORDS[state];
    this.periodEnd = Number.isSafeInteger(periodEnd) ? periodEnd : undefined;
  }
}

/** A picture for AI to read, as one part of a user message. PNG or WebP only; the limits are in the note above. */
export function picturePart(bytes, type) {
  if (type !== 'image/png' && type !== 'image/webp') throw new AiProblem('request-invalid');
  const picture = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  if (picture.byteLength > PICTURE_BYTES) throw new AiProblem('request-over-bound');
  return { type: 'image_url', image_url: { url: `data:${type};base64,${picture.toString('base64')}` } };
}

/** The pictures in a request's messages: how many, and their own bytes together. */
function picturesOf(messages) {
  let count = 0;
  let bytes = 0;
  for (const message of messages) {
    for (const part of Array.isArray(message?.content) ? message.content : []) {
      const url = part?.type === 'image_url' ? part.image_url?.url : undefined;
      if (typeof url !== 'string') continue;
      count += 1;
      const data = url.slice(url.indexOf(',') + 1);
      bytes += Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    }
  }
  return { count, bytes };
}

function insideTellop() {
  return process.env.TELLOP_INTERNAL_RECORDS === '1';
}

function request({ level, messages, signal, ...options }, stream) {
  if (!AI_LEVELS.includes(level)) throw new AiProblem('level-unknown');
  if (!Array.isArray(messages) || messages.length === 0) throw new AiProblem('request-invalid');
  if (Object.hasOwn(options, 'model')) throw new AiProblem('model-named');
  const body = { messages, stream };
  for (const name of OPTIONS) if (options[name] !== undefined) body[name] = options[name];
  const pictures = picturesOf(messages);
  if (pictures.count > PICTURES || pictures.bytes > PICTURES_BYTES) throw new AiProblem('request-over-bound');
  const headers = { 'content-type': 'application/json' };
  let base = TELLOP_AI_BASE;
  if (insideTellop()) {
    if (globalThis[TELLOP_AI] === undefined) throw new AiProblem('unavailable');
    headers['x-tellop-level'] = level;
  } else {
    base = process.env.AI_BASE_URL;
    if (typeof base !== 'string' || base.length === 0) throw new AiProblem('unavailable');
    if (process.env.AI_API_KEY) headers.authorization = `Bearer ${process.env.AI_API_KEY}`;
    const model = process.env[`AI_MODEL_${level.toUpperCase()}`] || process.env.AI_MODEL;
    if (model) body.model = model;
  }
  const sent = JSON.stringify(body);
  if (Buffer.byteLength(sent) > REQUEST_BYTES) throw new AiProblem('request-over-bound');
  return fetch(`${base.replace(/\/+$/u, '')}/chat/completions`, {
    method: 'POST', headers, body: sent, cache: 'no-store', ...(signal ? { signal } : {}),
  }).catch((error) => {
    if (error?.name === 'AbortError') throw error;
    throw new AiProblem('unavailable');
  });
}

async function problemOf(response) {
  let body = null;
  try { body = await response.json(); } catch { /* not a typed answer */ }
  const error = body?.error;
  if (error?.type === 'tellop' && typeof error.code === 'string') return new AiProblem(error.code, error.period_end);
  if (response.status === 429) return new AiProblem('busy');
  if (response.status === 402) return new AiProblem('meter-exhausted');
  if (response.status === 400) return new AiProblem('request-invalid');
  return new AiProblem('unavailable');
}

export async function askAI(asked) {
  const response = await request(asked, false);
  if (!response.ok) throw await problemOf(response);
  let answer;
  try { answer = await response.json(); } catch { throw new AiProblem('unavailable'); }
  const choice = answer?.choices?.[0];
  if (!choice?.message) throw new AiProblem('unavailable');
  return { text: typeof choice.message.content === 'string' ? choice.message.content : '', message: choice.message,
    finishReason: choice.finish_reason ?? null };
}

export async function* streamAI(asked) {
  const response = await request(asked, true);
  if (!response.ok) throw await problemOf(response);
  if (!response.body) throw new AiProblem('unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let held = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new AiProblem('unavailable');
      // Events end with a blank line, which a provider may write as CR LF twice.
      held = (held + decoder.decode(value, { stream: true })).replace(/\r\n/gu, '\n');
      let end;
      while ((end = held.indexOf('\n\n')) >= 0) {
        const event = held.slice(0, end);
        held = held.slice(end + 2);
        const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (data === '') continue;
        if (data === '[DONE]') return;
        let chunk;
        try { chunk = JSON.parse(data); } catch { throw new AiProblem('unavailable'); }
        if (chunk?.error) throw chunk.error.type === 'tellop' ? new AiProblem(chunk.error.code, chunk.error.period_end) : new AiProblem('unavailable');
        const words = chunk?.choices?.[0]?.delta?.content;
        if (typeof words === 'string' && words.length > 0) yield words;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** Tellop's address for pictures, voice and search: one path for each, answered like the chat address. */
const TELLOP_MEDIA_BASE = 'http://ai.tellop.invalid/v1/tellop';
const VOICES = Object.freeze(['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']);
/** The languages a recording may be named in, Tellop's own list: any other value is refused before it is sent. */
const LANGUAGES = Object.freeze(['en', 'tr', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'zh']);
const MASK_BYTES = 48 * 1024;
/** Outside Tellop: the most a made picture's bytes may weigh before they are kept. */
const MADE_PICTURE_BYTES = 8 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/u;

/** Inside Tellop: one call to Tellop's address, its answer read whole. */
async function askTellop(op, input, signal) {
  if (globalThis[TELLOP_AI] === undefined) throw new AiProblem('unavailable');
  const response = await fetch(`${TELLOP_MEDIA_BASE}/${op}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store',
    ...(signal ? { signal } : {}),
  }).catch((error) => {
    if (error?.name === 'AbortError') throw error;
    throw new AiProblem('unavailable');
  });
  if (!response.ok) throw await problemOf(response);
  try { return await response.json(); } catch { throw new AiProblem('unavailable'); }
}

/** Outside Tellop: the developer's address and key, and the model the environment names for this kind of call. */
async function askOutside(path, body, kind, signal) {
  const base = process.env.AI_BASE_URL;
  if (typeof base !== 'string' || base.length === 0) throw new AiProblem('unavailable');
  const headers = {};
  if (process.env.AI_API_KEY) headers.authorization = `Bearer ${process.env.AI_API_KEY}`;
  const model = process.env[`AI_MODEL_${kind}`];
  let sent = body;
  if (body instanceof FormData) { if (model) body.set('model', model); }
  else { headers['content-type'] = 'application/json'; sent = JSON.stringify(model ? { ...body, model } : body); }
  const response = await fetch(`${base.replace(/\/+$/u, '')}${path}`, {
    method: 'POST', headers, body: sent, cache: 'no-store', ...(signal ? { signal } : {}),
  }).catch((error) => {
    if (error?.name === 'AbortError') throw error;
    throw new AiProblem('unavailable');
  });
  if (!response.ok) throw await problemOf(response);
  return response;
}

/** Outside Tellop: bytes kept in `.data/files/`, answered as `keepFile` answers. */
async function keepOutside(bytes) {
  return await keepFile(new Request('http://app.invalid/keep', { method: 'POST', body: bytes }));
}

/** Outside Tellop: a kept file's bytes. */
async function keptBytes(file) {
  const response = await fileResponse(file, new Request('http://app.invalid/file'));
  if (!response.ok) throw new AiProblem('request-invalid');
  return new Uint8Array(await response.arrayBuffer());
}

function promptOf(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new AiProblem('request-invalid');
  if (prompt.length > 8192) throw new AiProblem('request-over-bound');
  return prompt;
}

/** A picture's type by its own first bytes: PNG, WebP or JPEG, else none. */
function pictureType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', name: 'picture.png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', name: 'picture.jpg' };
  if (Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP') return { type: 'image/webp', name: 'picture.webp' };
  return undefined;
}

/** Outside Tellop: the made picture's bytes from the answer, kept. An answer that is only an address is refused. */
async function pictureOutside(response) {
  let answer;
  try { answer = await response.json(); } catch { throw new AiProblem('unavailable'); }
  const data = answer?.data?.[0]?.b64_json;
  if (typeof data !== 'string') throw new AiProblem('unavailable');
  if (data.length > Math.ceil(MADE_PICTURE_BYTES / 3) * 4) throw new AiProblem('response-too-large');
  const bytes = Buffer.from(data, 'base64');
  if (pictureType(bytes) === undefined) throw new AiProblem('unavailable');
  return await keepOutside(bytes);
}

/** Draws a picture. Answers a kept file, `{ file, size, kind, shows }`. */
export async function picture({ prompt, signal } = {}) {
  const words = promptOf(prompt);
  if (insideTellop()) return { ...(await askTellop('picture', { prompt: words }, signal)), shows: 'picture' };
  return await pictureOutside(await askOutside('/images/generations', { prompt: words, size: '1536x1024', n: 1 }, 'PICTURE', signal));
}

/** Changes a picture this app drew (`file`), where the PNG `mask` is clear. Answers a kept file, like `picture`. */
export async function editPicture({ file, mask, prompt, signal } = {}) {
  const words = promptOf(prompt);
  if (typeof file !== 'string' || !DIGEST.test(file)) throw new AiProblem('request-invalid');
  const masked = Buffer.from(mask instanceof ArrayBuffer ? new Uint8Array(mask) : mask ?? []);
  if (masked.byteLength === 0) throw new AiProblem('request-invalid');
  if (masked.byteLength > MASK_BYTES) throw new AiProblem('request-over-bound');
  if (insideTellop()) {
    return { ...(await askTellop('edit-picture', { prompt: words, file, mask: masked.toString('base64') }, signal)), shows: 'picture' };
  }
  const form = new FormData();
  const picture = await keptBytes(file);
  const label = pictureType(picture);
  if (label === undefined) throw new AiProblem('request-invalid');
  form.set('image', new Blob([picture], { type: label.type }), label.name);
  form.set('mask', new Blob([masked], { type: 'image/png' }), 'mask.png');
  form.set('prompt', words);
  return await pictureOutside(await askOutside('/images/edits', form, 'PICTURE', signal));
}

/** Writes down a kept recording (`file`), in `language` when the app names one. Answers `{ text }`. */
export async function transcribe({ file, language, signal } = {}) {
  if (typeof file !== 'string' || !DIGEST.test(file)) throw new AiProblem('request-invalid');
  if (language !== undefined && !LANGUAGES.includes(language)) throw new AiProblem('request-invalid');
  if (insideTellop()) return await askTellop('transcribe', language === undefined ? { file } : { file, language }, signal);
  const form = new FormData();
  form.set('file', new Blob([await keptBytes(file)], { type: 'audio/mp4' }), 'recording.m4a');
  if (language !== undefined) form.set('language', language);
  const response = await askOutside('/audio/transcriptions', form, 'TRANSCRIBE', signal);
  let answer;
  try { answer = await response.json(); } catch { throw new AiProblem('unavailable'); }
  if (typeof answer?.text !== 'string') throw new AiProblem('unavailable');
  return { text: answer.text };
}

/** Speaks `text` in one of the six voices. Answers a kept MP3, like `picture`, with `aiVoice`. */
export async function speak({ text, voice = 'nova', signal } = {}) {
  if (typeof text !== 'string' || text.trim().length === 0 || !VOICES.includes(voice)) throw new AiProblem('request-invalid');
  if (text.length > 4096) throw new AiProblem('request-over-bound');
  if (insideTellop()) return { ...(await askTellop('speak', { text, voice }, signal)), shows: 'sound' };
  const response = await askOutside('/audio/speech', { input: text, voice, response_format: 'mp3' }, 'SPEECH', signal);
  return { ...(await keepOutside(new Uint8Array(await response.arrayBuffer()))), aiVoice: true };
}

/*
 * Search by meaning comes in a later version (the opening note): no app calls the one below yet, and no page
 * offers it. Outside Tellop it names `AI_MODEL_EMBED`.
 */

/** A later version's: one vector for each of up to eight texts, for search by meaning. Answers `{ vectors }`. */
export async function embed({ inputs, signal } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.some((text) => typeof text !== 'string' || text.length === 0)) {
    throw new AiProblem('request-invalid');
  }
  if (inputs.length > 8 || inputs.some((text) => Buffer.byteLength(text) > 8192)) throw new AiProblem('request-over-bound');
  if (insideTellop()) return await askTellop('embed', { inputs }, signal);
  const response = await askOutside('/embeddings', { input: inputs }, 'EMBED', signal);
  let answer;
  try { answer = await response.json(); } catch { throw new AiProblem('unavailable'); }
  const vectors = Array.isArray(answer?.data) ? answer.data.map((row) => row?.embedding) : [];
  if (vectors.length !== inputs.length || !vectors.every(Array.isArray)) throw new AiProblem('unavailable');
  return { vectors };
}
