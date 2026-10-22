/**
 * Numbers files: the posts' numbers a person downloads from Meta Business
 * Suite (Facebook and Instagram posts) or LinkedIn (a page's posts), read
 * into the results the app keeps for each shared post. Pure: no records, no
 * files, no network. The kit's reader (`lib/import/`) turns the file into a
 * heading row and rows of words; this file finds the headings it knows in a
 * closed list of names (English and Turkish), and reads each row's link, day
 * and numbers. Matching rows to shared posts is `lib/data/result-import.js`.
 *
 * What a row fills is only the six counts the result line edits (views,
 * likes, comments, shares, saves, clicks); each takes the first of its
 * headings the row has a number under (views: Views, then Impressions, then
 * Reach; likes: Likes, then Reactions; shares: Shares, then Reposts; clicks:
 * Link clicks, then Clicks, then Total clicks).
 *
 * A spreadsheet (LinkedIn's posts file) may hold its posts on any sheet:
 * `readResultBytes` tries each sheet in turn, every one through the kit's
 * own reader, and takes the first whose headings match. Server only (the
 * kit's reader opens spreadsheets with Node's zip tools).
 */

import { ImportError, matchHeadings, plain, readRows } from '../import/index.js';
import { decode } from '../import/limits.js';
import { children, local, one, xml } from '../import/xml.js';
import { unzip } from '../import/zip.js';
import { civilDay, daysInMonth } from './days.js';
import { LIMITS } from './limits.js';
import { zipFiles } from './zip.js';

/**
 * The closed list of headings, by what they hold. Each name is matched the
 * kit's way (`plain`: case, Turkish dotted and dotless i, accents, words in
 * brackets and punctuation do not count), so "Views (excluding off-site video
 * views)" is Views and "YAYINLANMA ZAMANI" is Yayınlanma zamanı.
 */
export const RESULT_HEADINGS = Object.freeze({
  link: Object.freeze({ en: ['Permalink', 'Post link', 'Link', 'Post URL'], tr: ['Kalıcı bağlantı', 'Gönderi bağlantısı', 'Paylaşım bağlantısı', 'Bağlantı'] }),
  published: Object.freeze({
    en: ['Publish time', 'Published', 'Publish date', 'Created date', 'Date posted', 'Post date'],
    tr: ['Yayınlanma zamanı', 'Yayınlanma tarihi', 'Yayın zamanı', 'Yayın tarihi', 'Oluşturulma tarihi', 'Paylaşım tarihi', 'Gönderi tarihi'],
  }),
  views: Object.freeze({ en: ['Views'], tr: ['Görüntülemeler', 'Görüntüleme', 'Görüntülenme'] }),
  impressions: Object.freeze({ en: ['Impressions'], tr: ['Gösterimler', 'Gösterim'] }),
  reach: Object.freeze({ en: ['Reach', 'Accounts reached'], tr: ['Erişim', 'Erişilen hesaplar'] }),
  likes: Object.freeze({ en: ['Likes'], tr: ['Beğeniler', 'Beğeni', 'Beğenme'] }),
  reactions: Object.freeze({ en: ['Reactions'], tr: ['Tepkiler', 'Tepki'] }),
  comments: Object.freeze({ en: ['Comments'], tr: ['Yorumlar', 'Yorum'] }),
  shares: Object.freeze({ en: ['Shares'], tr: ['Paylaşımlar', 'Paylaşma', 'Paylaşılma'] }),
  reposts: Object.freeze({ en: ['Reposts'], tr: ['Yeniden paylaşımlar', 'Yeniden yayınlamalar'] }),
  saves: Object.freeze({ en: ['Saves'], tr: ['Kaydetmeler', 'Kaydetme', 'Kaydedilenler'] }),
  linkClicks: Object.freeze({ en: ['Link clicks'], tr: ['Bağlantı tıklamaları', 'Bağlantı tıklaması'] }),
  clicks: Object.freeze({ en: ['Clicks'], tr: ['Tıklamalar', 'Tıklama'] }),
  totalClicks: Object.freeze({ en: ['Total clicks'], tr: ['Toplam tıklamalar', 'Toplam tıklama'] }),
});

/** Which headings fill each count the app keeps, in the order they are tried. */
export const COUNT_SOURCES = Object.freeze({
  views: Object.freeze(['views', 'impressions', 'reach']),
  likes: Object.freeze(['likes', 'reactions']),
  comments: Object.freeze(['comments']),
  shares: Object.freeze(['shares', 'reposts']),
  saves: Object.freeze(['saves']),
  clicks: Object.freeze(['linkClicks', 'clicks', 'totalClicks']),
});

/**
 * Headings that tell which platform a whole file is about, for a row whose
 * link does not say (any one of them is enough; a file with two platforms'
 * headings tells nothing).
 */
export const PLATFORM_HEADINGS = Object.freeze({
  instagram: Object.freeze(['Account username', 'Account name', 'Account ID', 'Hesap kullanıcı adı', 'Hesap adı', 'Hesap kimliği']),
  facebook: Object.freeze(['Page name', 'Page ID', 'Sayfa adı', 'Sayfa kimliği']),
  linkedin: Object.freeze(['Post title', 'Posted by', 'Gönderi başlığı', 'Gönderen', 'Paylaşan']),
});

/** The fields as the kit's `matchHeadings` takes them. */
export const RESULT_FILE_FIELDS = Object.freeze(Object.entries(RESULT_HEADINGS)
  .map(([name, { en, tr }]) => Object.freeze({ name, headings: Object.freeze([...en, ...tr]) })));

/** Rows the heading row may sit below (a title line or two above it). */
export const HEADING_ROWS = 5;

/** A link longer than this is not read. */
const LINK_MOST = 2048;

/** The query words kept in a link, where they name the post itself (`permalink.php?story_fbid=…&id=…`, `watch?v=…`). */
const KEEP_QUERY = Object.freeze({ 'facebook.com': Object.freeze(['story_fbid', 'fbid', 'id', 'v']), 'youtube.com': Object.freeze(['v']) });

/** Hosts by the platform they belong to. */
const HOSTS = Object.freeze({
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'fb.watch': 'facebook',
  'linkedin.com': 'linkedin',
  'lnkd.in': 'linkedin',
});

/**
 * A post's link as one key that two ways of writing the same link share, or
 * null when the words are not a web link: the host in small letters without
 * `www.` (or `m.`, `mobile.`, `web.`), then the path with no slash at its end,
 * no query and no `#` part (http and https count alike). Kept from the query:
 * only the words that name the post on Facebook and YouTube. An Instagram
 * post's address (`/p/`, `/reel/`, `/tv/`, with or without the account name
 * before it) becomes `instagram.com/p/<code>`; a LinkedIn post named by its
 * activity number becomes `linkedin.com/activity/<number>`.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalLink(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > LINK_MOST || /\s/u.test(text)) return null;
  const written = /^[a-z][a-z0-9+.-]*:/iu.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(written);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return null;
  // Every leading `www.`, `m.`… goes (`www.m.facebook.com` too), so a key reads the same again.
  const host = url.hostname.toLowerCase().replace(/\.$/u, '').replace(/^(?:(?:www|m|mobile|web)\.)+/u, '');
  if (!host.includes('.') || host.startsWith('[')) return null;
  let path = url.pathname.replace(/\/+$/u, '');
  if (host === 'instagram.com') {
    // `/p/`, `/reel/`, `/tv/` in any letters' size (`/P/` is `/p/`); the post's code keeps its own.
    const post = /^(?:\/[^/]+)?\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/iu.exec(path);
    if (post) path = `/p/${post[1]}`;
  }
  if (host === 'linkedin.com') {
    const activity = /(?:urn(?::|%3A)li(?::|%3A)activity(?::|%3A)|activity-)(\d{6,})/iu.exec(path);
    if (activity) path = `/activity/${activity[1]}`;
  }
  const kept = (KEEP_QUERY[host] ?? [])
    .filter((name) => url.searchParams.has(name))
    .map((name) => `${name}=${encodeURIComponent(url.searchParams.get(name) ?? '')}`)
    .join('&');
  return `${host}${path}${kept === '' ? '' : `?${kept}`}`;
}

/**
 * The platform a link key (`normalLink`) belongs to, or null when its host is
 * not one the numbers files come from.
 *
 * @param {string | null} key
 * @returns {string | null}
 */
export function networkOfLink(key) {
  if (typeof key !== 'string') return null;
  return HOSTS[key.split(/[/?]/u)[0]] ?? null;
}

/**
 * The form a link key (`normalLink`) is written in: its platform, then the
 * kind of address. Facebook names one post in several forms (a share link
 * `facebook.com/share/…`, a `pfbid` address, a permalink or story address,
 * a page's numbered post, a photo, a video), and a numbers file may use one
 * while the person kept another: two keys in different forms may name the
 * same post, two different keys in the same form never do. Null for no key.
 *
 * @param {string | null} key
 * @returns {string | null}
 */
export function linkForm(key) {
  if (typeof key !== 'string' || key === '') return null;
  const host = key.split(/[/?]/u)[0];
  const path = key.slice(host.length);
  const network = HOSTS[host] ?? null;
  if (network === 'facebook') {
    if (host === 'fb.watch') return 'facebook:video';
    if (/^\/share\//u.test(path)) return 'facebook:share';
    if (/pfbid/iu.test(path)) return 'facebook:pfbid';
    if (/^\/(?:permalink|story)\.php(?:\?|$)/u.test(path)) return 'facebook:permalink';
    if (/\/posts\/\d+(?:\?|$)/u.test(path)) return 'facebook:posts';
    if (/^\/photo(?:\.php)?(?:\?|$)/u.test(path) || /\/photos\//u.test(path)) return 'facebook:photo';
    if (/^\/watch(?:\?|$)/u.test(path) || /\/videos\//u.test(path) || /^\/reel\//u.test(path)) return 'facebook:video';
    return 'facebook:other';
  }
  if (network === 'instagram') return /^\/p\/[^/?]+$/u.test(path) ? 'instagram:post' : 'instagram:other';
  if (network === 'linkedin') return /^\/activity\/\d+$/u.test(path) ? 'linkedin:activity' : 'linkedin:other';
  return 'web';
}

/**
 * A count in a file as a whole number from 0 to `LIMITS.result`: digits,
 * with or without thousands marks (`1,234`, `1.234`, `1 234`), or a whole
 * number a spreadsheet wrote with a point (`12.0`, `1.2E3`). An empty cell or
 * a dash is no count (`value: null`); anything else cannot be read.
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: number | null } | { ok: false }}
 */
export function readFileCount(value) {
  const text = String(value ?? '').replace(/[\s  '’]/gu, '');
  if (text === '' || /^[-–—]+$/u.test(text)) return { ok: true, value: null };
  let number = null;
  if (/^\d+$/u.test(text)) number = Number(text);
  else if (/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/u.test(text)) number = Number(text.replace(/[.,]/gu, ''));
  else if (/^\d+[.,]0+$/u.test(text)) number = Number(text.split(/[.,]/u)[0]);
  else if (/^\d+(?:\.\d+)?[eE]\+?\d+$/u.test(text)) number = Number(text);
  if (number === null || !Number.isSafeInteger(number) || number < 0 || number > LIMITS.result) return { ok: false };
  return { ok: true, value: number };
}

/** A civil day from its parts, or null when there is no such day (years 2000 to 2100). */
function dayFrom(year, month, day) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return civilDay(year, month, day);
}

/** A two-digit year is this century's. @param {string} text */
const yearOf = (text) => (text.length === 2 ? 2000 + Number(text) : Number(text));

const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/u;
const PARTS_DAY = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?:[,\s].*)?$/u;
const SERIAL = /^\d{5}(?:\.\d+)?$/u;
/** Spreadsheet day numbers that fall from 1954 to 2119 (day 0 is 30 December 1899). */
const SERIAL_FROM = 20000;
const SERIAL_TO = 80000;

/**
 * The day a cell names, in the file's own clock (the time after it is not
 * needed), or null when it names none: `2026-10-15` (a time and a zone may
 * follow), `15.10.2026` and `15-10-2026` (day first), `10/15/2026` (month
 * first when `order` is `md`, day first when `dm`; two-digit years are this
 * century's), or a spreadsheet's day number.
 *
 * @param {unknown} value
 * @param {'md' | 'dm'} [order] how a day written with slashes is ordered
 * @returns {string | null}
 */
export function readFileDay(value, order = 'md') {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const iso = ISO_DAY.exec(text);
  if (iso) return dayFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const parts = PARTS_DAY.exec(text);
  if (parts) {
    const [first, mark, second, year] = [Number(parts[1]), parts[2], Number(parts[3]), yearOf(parts[4])];
    return mark === '/' && order === 'md' ? dayFrom(year, first, second) : dayFrom(year, second, first);
  }
  if (SERIAL.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial < SERIAL_FROM || serial > SERIAL_TO) return null;
    const moment = new Date(Date.UTC(1899, 11, 30 + serial));
    return civilDay(moment.getUTCFullYear(), moment.getUTCMonth() + 1, moment.getUTCDate());
  }
  return null;
}

/**
 * How the days written with slashes in a file are ordered: day first when one
 * of them can only be read day first (its first number past 12), month first
 * when one can only be read month first, else day first under a Turkish date
 * heading and month first under an English one. Null when the file holds
 * both kinds (then a day that could be read either way is not read).
 *
 * @param {string[]} cells the date column's cells
 * @param {boolean} turkish whether the date heading is a Turkish one
 * @returns {'md' | 'dm' | null}
 */
export function slashOrder(cells, turkish) {
  let dayFirst = false;
  let monthFirst = false;
  for (const cell of cells) {
    const parts = PARTS_DAY.exec(String(cell ?? '').trim());
    if (!parts || parts[2] !== '/') continue;
    const first = Number(parts[1]);
    const second = Number(parts[3]);
    if (first > 12 && second <= 12) dayFirst = true;
    if (second > 12 && first <= 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return null;
  if (dayFirst) return 'dm';
  if (monthFirst) return 'md';
  return turkish ? 'dm' : 'md';
}

/** Whether a cell names a day only one way when slashes are read both ways (`slashOrder` null). */
function readDayStrict(text) {
  const parts = PARTS_DAY.exec(String(text ?? '').trim());
  if (!parts || parts[2] !== '/') return readFileDay(text, 'md');
  const md = readFileDay(text, 'md');
  const dm = readFileDay(text, 'dm');
  return md !== null && dm !== null && md !== dm ? null : md ?? dm;
}

/**
 * A heading row with a later copy of the same heading (the same once read the
 * kit's way) renamed so that it matches nothing: the first column under a
 * heading is the one read.
 *
 * @param {string[]} headings
 */
function firstOfEach(headings) {
  const seen = new Set();
  return headings.map((heading, index) => {
    const key = plain(heading);
    if (key !== '' && seen.has(key)) return `${heading} ${index + 1}`;
    seen.add(key);
    return heading;
  });
}

/** The platform a heading row names, or null when it names none or more than one. @param {string[]} headings */
export function platformOf(headings) {
  const keys = new Set(headings.map((heading) => plain(heading)));
  const found = Object.entries(PLATFORM_HEADINGS)
    .filter(([, names]) => names.some((name) => keys.has(plain(name))))
    .map(([network]) => network);
  return found.length === 1 ? found[0] : null;
}

const TURKISH_DATE_HEADINGS = new Set(RESULT_HEADINGS.published.tr.map((name) => plain(name)));
const COUNT_FIELDS = new Set(Object.values(COUNT_SOURCES).flat());

/** Whether every cell of a row is empty. @param {string[]} row */
const isEmptyRow = (row) => row.every((cell) => String(cell ?? '').trim() === '');

/**
 * @typedef {{ link: string | null, network: string | null, day: string | null,
 *   counts: Partial<Record<'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks', number>> }} ResultRow
 */

/**
 * A numbers file's rows, read: `{ ok: true, platform, rows, skipped }` with
 * each row's link key (`normalLink`), platform (the link's, else the file's),
 * day and the counts it has numbers for, and how many rows could not be read
 * (`skipped`: neither a link nor a day, or no count with a number). Empty
 * rows are left out, as is a first row under the headings that holds no
 * link, day or number (Meta writes a line that says what each column means).
 * The heading row is the first of the file's first `HEADING_ROWS` rows that
 * has a link or a date heading.
 *
 * Refusals (`{ ok: false, problem }`): `results.import.noPosts` (no link and
 * no date heading), `results.import.noNumbers` (no count heading),
 * `results.import.noRows` (nothing under the headings).
 *
 * @param {{ headings: string[], rows: string[][] }} table what the kit's `readRows` answered
 * @returns {{ ok: true, platform: string | null, rows: ResultRow[], skipped: number } | { ok: false, problem: string }}
 */
export function readResultFile(table) {
  const lines = [table.headings, ...table.rows.slice(0, HEADING_ROWS - 1)];
  let at = -1;
  let headings = [];
  let matched = {};
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = firstOfEach(lines[index]);
    const found = matchHeadings(candidate, RESULT_FILE_FIELDS).matched;
    if (Object.hasOwn(found, 'link') || Object.hasOwn(found, 'published')) {
      at = index;
      headings = candidate;
      matched = found;
      break;
    }
  }
  if (at === -1) return { ok: false, problem: 'results.import.noPosts' };
  if (!Object.keys(matched).some((name) => COUNT_FIELDS.has(name))) return { ok: false, problem: 'results.import.noNumbers' };

  const body = table.rows.slice(at).filter((row) => !isEmptyRow(row));
  const platform = platformOf(headings);
  const dateColumn = matched.published;
  const order = dateColumn === undefined
    ? 'md'
    : slashOrder(body.map((row) => row[dateColumn]), TURKISH_DATE_HEADINGS.has(plain(headings[dateColumn])));
  const cell = (row, name) => (Object.hasOwn(matched, name) ? row[matched[name]] : undefined);

  const rows = [];
  let skipped = 0;
  body.forEach((row, index) => {
    // A key that would not read the same again is no link (the records side reads each key again).
    const key = normalLink(cell(row, 'link'));
    const link = key !== null && normalLink(key) === key ? key : null;
    const dateText = cell(row, 'published');
    const day = dateText === undefined ? null : order === null ? readDayStrict(dateText) : readFileDay(dateText, order);
    /** @type {ResultRow['counts']} */
    const counts = {};
    for (const [count, sources] of Object.entries(COUNT_SOURCES)) {
      for (const source of sources) {
        const read = readFileCount(cell(row, source));
        if (read.ok && read.value !== null) {
          counts[count] = read.value;
          break;
        }
      }
    }
    const hasCounts = Object.keys(counts).length > 0;
    if (index === 0 && link === null && day === null && !hasCounts) return;
    if ((link === null && day === null) || !hasCounts) {
      skipped += 1;
      return;
    }
    rows.push({ link, network: networkOfLink(link) ?? platform, day, counts });
  });
  if (rows.length === 0 && skipped === 0) return { ok: false, problem: 'results.import.noRows' };
  return { ok: true, platform, rows, skipped };
}

/** The most sheets of one spreadsheet that are tried. */
export const SHEETS_MOST = 16;

const SHEET_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const SHEET_RELATIONS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Text for an XML attribute's value. @param {string} value */
function attributeText(value) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

/** The part a workbook relationship points at, named as the kit's reader names it, or null for an odd one. @param {unknown} target */
function partOf(target) {
  if (typeof target !== 'string' || /[\\:%?#\0]/u.test(target)) return null;
  const name = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  return name.split('/').some((part) => part === '' || part === '.' || part === '..') ? null : name;
}

/**
 * Each sheet of a spreadsheet (`.xlsx` bytes) as a spreadsheet of its own,
 * in the workbook's order, at most `SHEETS_MOST`: the same parts, with a
 * workbook that names only that sheet, so the kit's reader (which reads a
 * workbook's first sheet) reads each one with every one of its own checks.
 * Each holds only the parts that sheet needs (the workbook's relationships,
 * its shared words and the sheet), so it stays inside the kit's size limit.
 * A file the kit cannot open is refused as the kit refuses it
 * (`ImportError`); a workbook whose parts cannot be listed answers the file
 * as it is, for the kit's reader to say what is wrong.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array[]}
 */
export function sheetFiles(bytes) {
  const parts = unzip(bytes);
  const book = parts.get('xl/workbook.xml');
  const links = parts.get('xl/_rels/workbook.xml.rels');
  if (book === undefined || links === undefined) return [bytes];
  let sheets;
  let relations;
  try {
    sheets = children(one(xml(decode(book)), 'sheets'), 'sheet');
    relations = xml(decode(links)).children.filter((node) => local(node) === 'Relationship');
  } catch (error) {
    if (error instanceof ImportError && error.reason !== 'import.tooLarge') return [bytes];
    throw error;
  }
  const shared = relations.filter((node) => node.attrs.Type === `${SHEET_RELATIONS}/sharedStrings`).map((node) => partOf(node.attrs.Target));
  const files = [];
  for (const sheet of sheets.slice(0, SHEETS_MOST)) {
    const id = typeof sheet.attrs['r:id'] === 'string' ? sheet.attrs['r:id'] : '';
    const target = partOf(relations.find((node) => node.attrs.Id === id)?.attrs.Target);
    const workbook = `<workbook xmlns="${SHEET_MAIN}" xmlns:r="${SHEET_RELATIONS}"><sheets><sheet name="Sheet" sheetId="1" r:id="${attributeText(id)}"/></sheets></workbook>`;
    const names = [...new Set(['xl/_rels/workbook.xml.rels', ...shared, target])].filter((name) => typeof name === 'string' && parts.has(name));
    try {
      files.push(zipFiles([{ name: 'xl/workbook.xml', bytes: new TextEncoder().encode(workbook) }, ...names.map((name) => ({ name, bytes: parts.get(name) }))]));
    } catch {
      // A part the zip writer refuses (a name too long): that sheet cannot be read alone.
    }
  }
  return files.length > 0 ? files : [bytes];
}

/**
 * A numbers file's rows from its bytes (`kind` `csv` or `xlsx`, as the
 * kit's reader takes them): `readResultFile` of the file, and for a
 * spreadsheet of its first sheet whose headings match (posts and numbers
 * found, rows or none). A sheet the kit cannot read is passed over; when
 * none matches, the answer is the nearest miss (`noNumbers` before
 * `noPosts`), or the first sheet's refusal when none could be read at all.
 * A file too large is refused at once.
 *
 * @param {Uint8Array} bytes
 * @param {'csv' | 'xlsx'} kind
 * @returns {Promise<ReturnType<typeof readResultFile>>}
 */
export async function readResultBytes(bytes, kind) {
  if (kind !== 'xlsx') return readResultFile(await readRows(bytes, { kind }));
  let refusal = null;
  let miss = null;
  for (const sheet of sheetFiles(bytes)) {
    let read;
    try {
      read = readResultFile(await readRows(sheet, { kind: 'xlsx' }));
    } catch (error) {
      if (!(error instanceof ImportError) || error.reason === 'import.tooLarge') throw error;
      refusal ??= error;
      continue;
    }
    if (read.ok || read.problem === 'results.import.noRows') return read;
    if (miss === null || read.problem === 'results.import.noNumbers') miss = read;
  }
  if (miss !== null) return miss;
  throw refusal ?? new ImportError('import.xlsx');
}
