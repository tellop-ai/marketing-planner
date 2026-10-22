/**
 * How much each thing the person writes may hold, and readers that check a
 * value against it. A route reads every field through these before it saves;
 * a refusal is a message key the page shows in the person's language.
 */

export const LIMITS = Object.freeze({
  name: 80,
  mainText: 5000,
  versionText: 5000,
  hashtags: 30,
  hashtagLength: 100,
  link: 500,
  firstComment: 2200,
  description: 300,
  pictureWords: 300,
  pictureStyle: 300,
  change: 300,
  readyWord: 2200,
  readyTitle: 80,
  comment: 2000,
  bestLine: 300,
  notes: 1000,
  profileField: 500,
  themeAbout: 300,
  campaignStep: 200,
  picturesPerPost: 20,
  themes: 5,
  readyWords: 200,
  campaignSteps: 50,
  postsPerWeek: [1, 14],
  result: 1_000_000_000,
  resultNote: 300,
  amount: 1_000_000_000,
});

/**
 * The counts a shared post's results hold on one network, in the order the
 * results form and the spreadsheet file show them (the one list every file
 * uses; the line of words beside them holds at most `LIMITS.resultNote`).
 */
export const RESULT_COUNTS = Object.freeze(['views', 'likes', 'comments', 'shares', 'saves', 'clicks']);

/** The refusal keys these readers answer. */
export const LIMIT_REFUSALS = Object.freeze({
  missing: 'refuse.text.missing',
  long: 'refuse.text.long',
  link: 'refuse.link',
  linkPublic: 'refuse.linkPublic',
  number: 'refuse.number',
});

/** Bytes a stored word may take on average: a Turkish letter takes two. */
export const BYTES_A_LETTER = 2;

/**
 * The bytes `text` takes inside a records answer: its UTF-8 size as the
 * answer writes it, so a quote, a backslash, a new line or a tab counts two
 * and a broken half of an emoji six. Works in the browser too.
 *
 * @param {string} text
 */
export function wireBytes(text) {
  return new TextEncoder().encode(JSON.stringify(text)).length - 2;
}

/** The bytes one character takes inside a records answer (as `wireBytes`). @param {string} letter */
function letterBytes(letter) {
  const code = letter.codePointAt(0) ?? 0;
  if (letter === '"' || letter === '\\' || letter === '\b' || letter === '\f' || letter === '\n' || letter === '\r' || letter === '\t') return 2;
  if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) return 6;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code < 0x10000 ? 3 : 4;
}

/**
 * The longest start of `text` of at most `letters` characters and `bytes`
 * bytes (as `wireBytes` counts them), cut at a whole character.
 *
 * @param {string} text
 * @param {number} letters
 * @param {number} [bytes] `BYTES_A_LETTER` x `letters` when not given
 */
export function cutText(text, letters, bytes = BYTES_A_LETTER * letters) {
  let count = 0;
  let size = 0;
  let end = 0;
  for (const letter of text) {
    count += 1;
    size += letterBytes(letter);
    if (count > letters || size > bytes) return text.slice(0, end);
    end += letter.length;
  }
  return text;
}

/**
 * One line or several of the person's words: trimmed, at most `max` characters
 * (as a person counts them) and `BYTES_A_LETTER` x `max` bytes (as
 * `wireBytes` counts them: ordinary English and Turkish always fit, a text
 * of emoji or other four-byte letters can be refused before its letter count
 * is reached), and present when `required`. A broken half of an emoji
 * becomes the replacement character.
 *
 * @param {unknown} value
 * @param {number} max
 * @param {{ required?: boolean, multiline?: boolean }} [options]
 * @returns {{ ok: true, value: string } | { ok: false, problem: string }}
 */
export function readWords(value, max, { required = false, multiline = false } = {}) {
  if (value === undefined || value === null) return required ? { ok: false, problem: LIMIT_REFUSALS.missing } : { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, problem: LIMIT_REFUSALS.missing };
  const whole = typeof value.toWellFormed === 'function' ? value.toWellFormed() : value;
  const cleaned = (multiline ? whole.replace(/\r\n?/gu, '\n') : whole.replace(/[\r\n]+/gu, ' ')).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').trim();
  if (required && cleaned.length === 0) return { ok: false, problem: LIMIT_REFUSALS.missing };
  if (Array.from(cleaned).length > max || wireBytes(cleaned) > BYTES_A_LETTER * max) return { ok: false, problem: LIMIT_REFUSALS.long };
  return { ok: true, value: cleaned };
}

/** Host names that name this computer or the local network, never a page on the internet. */
const LOCAL_NAMES = /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/u;

/**
 * Whether an IPv4 address (as `URL` writes it, so `2130706433` and `0x7f.1`
 * are already `127.0.0.1`) is this computer, a private or shared network, a
 * link-local address or no address: `0.0.0.0/8`, `10/8`, `100.64/10`,
 * `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `255.255.255.255`.
 *
 * @param {string} host
 */
function isLocalIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (match === null) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || host === '255.255.255.255';
}

/**
 * An optional web address: empty, or an `https:` address of at most
 * `LIMITS.link` characters that `URL` reads, with no name or password in it,
 * for a page on the internet: no port written out (`https://shop.com:8443`),
 * and not this computer or a local network (`localhost`, a `.local` name, an
 * address written as numbers in a private, loopback or link-local range, or
 * any address written in brackets) (`refuse.linkPublic`). The address is kept
 * as `URL` writes it, which can be longer (a letter outside English becomes
 * several): refused when that is over `BYTES_A_LETTER` x `LIMITS.link` bytes.
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, problem: string }}
 */
export function readLink(value) {
  const words = readWords(value, LIMITS.link);
  if (!words.ok) return words;
  if (words.value === '') return words;
  let parsed;
  try {
    parsed = new URL(words.value);
  } catch {
    return { ok: false, problem: LIMIT_REFUSALS.link };
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') return { ok: false, problem: LIMIT_REFUSALS.link };
  // The host as written (`URL` drops a written default port, `:443`): a colon after it is a port.
  const written = /^\s*https:\/\/([^/?#\\]*)/iu.exec(words.value)?.[1] ?? '';
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (parsed.port !== '' || /:[0-9]*$/u.test(written.replace(/^\[[^\]]*\]/u, '')) || host.startsWith('[') || LOCAL_NAMES.test(host) || isLocalIPv4(host)) {
    return { ok: false, problem: LIMIT_REFUSALS.linkPublic };
  }
  if (wireBytes(parsed.href) > BYTES_A_LETTER * LIMITS.link) return { ok: false, problem: LIMIT_REFUSALS.long };
  return { ok: true, value: parsed.href };
}

/**
 * An optional whole number from 0 to `max` (null when left empty).
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {{ ok: true, value: number | null } | { ok: false, problem: string }}
 */
export function readCount(value, max) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return { ok: false, problem: LIMIT_REFUSALS.number };
  return { ok: true, value };
}
