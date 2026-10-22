/**
 * Numbers files: the posts files Meta Business Suite and LinkedIn give a
 * person, read into the results of their shared posts. The headings in the
 * closed list (English and Turkish), counts and days as files write them,
 * links that two ways of writing share, the one-fit rule, what changes (only
 * the counts), the address's refusals and Tellop's records bounds.
 *
 * A throwaway store (`APP_DATA_FILE` in a temporary folder, removed
 * afterwards); another owner's shared posts are written straight into the
 * store and must never change. The fixture files are made here from plain
 * text (the same bytes every run) and kept in memory. No check uses the
 * network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'result-files-checks-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');
delete process.env.TELLOP_INTERNAL_RECORDS;

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const files = await import('../lib/plan/result-files.js');
const { IMPORT_LIMITS, readRows } = await import('../lib/import/index.js');
const { zipFiles } = await import('../lib/plan/zip.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { addDays, partsOf } = await import('../lib/plan/days.js');
const resultImport = await import('../lib/data/result-import.js');
const route = await import('../app/api/results/import/route.js');
const kinds = await import('../lib/plan/result-kinds.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('a check reached for the network');
};

after(async () => {
  globalThis.fetch = realFetch;
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const stamp = () => new Date().toISOString();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const enc = (text) => new TextEncoder().encode(text);

// --- fixtures ---------------------------------------------------------------------------

/** A fixture file's bytes, made here and kept in memory (the app's tree holds no binary file). @param {string} _name @param {Uint8Array} bytes */
function fixture(_name, bytes) {
  return new Uint8Array(bytes);
}

const INSTAGRAM_EN = [
  'Post ID,Account ID,Account username,Account name,Description,Duration (sec),Publish time,Permalink,Post type,Data comment,Date,Views,Reach,Likes,Shares,Follows,Comments,Saves',
  '1,2,bakery,Bakery,"Cookies, warm from the oven",0,03/05/2026 18:30,https://www.instagram.com/p/CookieA1/,IG image,,Lifetime,"1,500",900,120,4,1,9,15',
  '3,2,bakery,Bakery,Bread,0,03/09/2026 08:10,https://www.instagram.com/reel/BreadB2/,IG reel,,Lifetime,800,700,60,2,0,5,6',
  '4,2,bakery,Bakery,Old post,0,01/02/2026 12:00,https://www.instagram.com/p/NotHere9/,IG image,,Lifetime,10,9,1,0,0,0,0',
  '',
].join('\r\n');

const FACEBOOK_TR = [
  'Gönderi kimliği;Sayfa kimliği;Sayfa adı;Başlık;Yayınlanma zamanı;Kalıcı bağlantı;Erişim;Tepkiler;Yorumlar;Paylaşımlar;Bağlantı tıklamaları',
  '101;9;Fırın;Kurabiye;05.03.2026 18:30;https://www.facebook.com/firin/posts/pfbid0AAA;1.234;56;7;3;12',
  '102;9;Fırın;Ekmek;06.03.2026 09:15;;2.500;80;10;4;',
  '103;9;Fırın;Bozuk;;;yok;;;;',
  '',
].join('\n');

const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const cell = (ref, value) => (typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`);
const sheetRow = (number, values) => `<row r="${number}">${values.map((value, index) => cell(`${String.fromCharCode(65 + index)}${number}`, value)).join('')}</row>`;

/** A spreadsheet file like LinkedIn's posts file: a title line, then the headings, then a post (its day a spreadsheet day number). */
function linkedinXlsx() {
  const sheet = `<worksheet><sheetData>${[
    sheetRow(1, ['All posts']),
    sheetRow(2, ['Post title', 'Post link', 'Post type', 'Posted by', 'Created date', 'Audience', 'Impressions', 'Views (excluding off-site video views)', 'Clicks', 'Click through rate (CTR)', 'Likes', 'Comments', 'Reposts', 'Follows', 'Engagement rate']),
    sheetRow(3, ['Cookies', 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001', 'Organic', 'Bakery', 46088.75, 'All followers', 2400, '', 33, 0.0137, 41, 6, 2, 1, 0.03]),
  ].join('')}</sheetData></worksheet>`;
  const parts = [
    ['xl/workbook.xml', `<workbook xmlns:r="${OFFICE.slice(0, -1)}"><sheets><sheet name="All posts" r:id="rPosts"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rPosts" Type="${OFFICE}worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
  ];
  return zipFiles(parts.map(([name, text]) => ({ name, bytes: enc(text) })), { now: '2026-01-01T00:00:00Z' });
}

// --- records helpers ------------------------------------------------------------------------

let made = 0;
/** A local moment of a civil day as an ISO instant. */
function momentOn(day, hour = 18) {
  const { year, month, day: date } = partsOf(day);
  return new Date(year, month - 1, date, hour, 0).toISOString();
}

/** A post and one shared version of it. */
async function shared({ owner = OWNER, network = 'instagram', day, postDay = day, hour = 18, link = null, sharedAt = undefined, fields = {} }) {
  made += 1;
  const post = await modelAction('Post', 'create', { data: { ownerId: owner, name: `Post ${made}`, day: postDay, createdAt: stamp(), updatedAt: stamp() } });
  const version = await modelAction('PostVersion', 'create', {
    data: { ownerId: owner, postId: post.id, network, sharedAt: sharedAt ?? momentOn(day, hour), sharedLink: link, text: 'Kept words', resultNote: 'Kept note', updatedAt: stamp(), ...fields },
  });
  return version;
}

async function versionOf(id) {
  return modelAction('PostVersion', 'findFirst', { where: { id } });
}

async function clear() {
  await modelAction('PostVersion', 'deleteMany', { where: { ownerId: { in: [OWNER, OTHER] } } });
  await modelAction('Post', 'deleteMany', { where: { ownerId: { in: [OWNER, OTHER] } } });
}

/** Calls the address with a body. */
async function send(body, { type = 'text/csv', site = undefined, length = undefined } = {}) {
  const headers = { 'content-type': type };
  if (site !== undefined) headers['sec-fetch-site'] = site;
  if (length !== undefined) headers['content-length'] = String(length);
  const response = await route.POST(new Request('http://localhost/api/results/import', { method: 'POST', headers, body }));
  return { status: response.status, json: await response.json() };
}

/** A one-sheet table as the kit's reader answers it. */
const table = (headings, ...rows) => ({ headings, rows });

// --- the closed list of headings ------------------------------------------------------------

const countOf = (field) => Object.entries(files.COUNT_SOURCES).find(([, sources]) => sources.includes(field))?.[0] ?? null;
const POST = 'https://www.instagram.com/p/AbC123/';

test('every heading in the closed list is read, in English and Turkish, as written and in capitals', () => {
  let checked = 0;
  for (const [field, names] of Object.entries(files.RESULT_HEADINGS)) {
    for (const language of ['en', 'tr']) {
      for (const name of names[language]) {
        for (const written of [name, name.toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US')]) {
          let read;
          if (field === 'link') {
            read = files.readResultFile(table([written, 'Views'], [POST, '7']));
            assert.equal(read.ok && read.rows[0].link, 'instagram.com/p/AbC123', `${written}: the link`);
          } else if (field === 'published') {
            read = files.readResultFile(table([written, 'Views'], ['2026-03-04 18:00', '7']));
            assert.equal(read.ok && read.rows[0].day, '2026-03-04', `${written}: the day`);
          } else {
            read = files.readResultFile(table(['Permalink', written], [POST, '7']));
            assert.deepEqual(read.ok && read.rows[0].counts, { [countOf(field)]: 7 }, `${written}: fills ${countOf(field)}`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked >= 100, `${checked} headings checked`);
  // Words in brackets do not count: LinkedIn's views heading is Views.
  const linkedin = files.readResultFile(table(['Post link', 'Views (excluding off-site video views)'], [POST, '3']));
  assert.deepEqual(linkedin.ok && linkedin.rows[0].counts, { views: 3 });
  // A heading outside the list is not read.
  assert.deepEqual(files.readResultFile(table(['Permalink', 'Follows'], [POST, '7'])), { ok: false, problem: 'results.import.noNumbers' });
});

test('the headings that name a platform tell a row without a link where it was shared', () => {
  for (const [network, names] of Object.entries(files.PLATFORM_HEADINGS)) {
    for (const name of names) {
      assert.equal(files.platformOf([name, 'Views']), network, name);
      const read = files.readResultFile(table([name, 'Publish time', 'Views'], ['x', '2026-03-04', '5']));
      assert.equal(read.ok && read.rows[0].network, network, `${name}: the row's platform`);
    }
  }
  assert.equal(files.platformOf(['Account username', 'Page name']), null, 'two platforms named: none');
  assert.equal(files.platformOf(['Views']), null);
  // A row's own link wins over the file's platform.
  const read = files.readResultFile(table(['Page name', 'Permalink', 'Views'], ['Bakery', POST, '5']));
  assert.equal(read.ok && read.rows[0].network, 'instagram');
});

test('a count takes the first of its headings the row has a number under', () => {
  const read = files.readResultFile(table(
    ['Permalink', 'Reach', 'Impressions', 'Views', 'Reactions', 'Likes', 'Reposts', 'Shares', 'Total clicks', 'Clicks', 'Link clicks', 'Saves', 'Comments'],
    [POST, '10', '20', '30', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    [POST, '10', '20', '', '1', '', '3', '', '5', '', '', '', ''],
    [POST, '10', '', '--', '1', 'n/a', '', '', '5', '', '', '', '0'],
  ));
  assert.ok(read.ok);
  assert.deepEqual(read.rows[0].counts, { views: 30, likes: 2, comments: 9, shares: 4, saves: 8, clicks: 7 });
  assert.deepEqual(read.rows[1].counts, { views: 20, likes: 1, shares: 3, clicks: 5 });
  assert.deepEqual(read.rows[2].counts, { views: 10, likes: 1, comments: 0, clicks: 5 }, 'a dash or words fall through to the next heading');
});

test('a heading written twice: the first column is read; the heading row may sit under a title line', () => {
  const twice = files.readResultFile(table(['Permalink', 'Reactions', 'Reactions'], [POST, '4', '99']));
  assert.deepEqual(twice.ok && twice.rows[0].counts, { likes: 4 });
  const titled = files.readResultFile(table(['All posts', '', ''], ['', '', ''], ['Post link', 'Created date', 'Likes'], [POST, '2026-03-04', '5']));
  assert.ok(titled.ok);
  assert.deepEqual(titled.rows, [{ link: 'instagram.com/p/AbC123', network: 'instagram', day: '2026-03-04', counts: { likes: 5 } }]);
  // Five rows down at most.
  const deep = files.readResultFile(table(['a'], ['b'], ['c'], ['d'], ['e'], ['Permalink'], [POST]));
  assert.deepEqual(deep, { ok: false, problem: 'results.import.noPosts' });
});

test('counts as files write them', () => {
  const cases = [
    ['7', 7], ['1,234', 1234], ['1.234', 1234], ['1 234', 1234], ['1 234 567', 1234567], ['12.0', 12], ['12,00', 12],
    ['1.2E3', 1200], ['0', 0], [String(LIMITS.result), LIMITS.result],
    ['', null], ['  ', null], ['--', null], ['—', null],
  ];
  for (const [text, value] of cases) assert.deepEqual(files.readFileCount(text), { ok: true, value }, text);
  for (const text of ['1,5', '-3', 'abc', '1.2.3', '12.5', String(LIMITS.result + 1), '1,23', '1e400']) {
    assert.deepEqual(files.readFileCount(text), { ok: false }, text);
  }
});

test('days as files write them', () => {
  const cases = [
    ['2026-03-04', 'md', '2026-03-04'], ['2026-03-04T18:30:00-0700', 'md', '2026-03-04'], ['2026-3-4 18:30', 'md', '2026-03-04'],
    ['04.03.2026 18:30', 'md', '2026-03-04'], ['04-03-2026', 'md', '2026-03-04'],
    ['03/04/2026 6:30 PM', 'md', '2026-03-04'], ['03/04/2026', 'dm', '2026-04-03'], ['3/4/26', 'md', '2026-03-04'],
    ['45658', 'md', '2025-01-01'], ['46088.75', 'md', '2026-03-07'],
  ];
  for (const [text, order, day] of cases) assert.equal(files.readFileDay(text, /** @type {'md' | 'dm'} */ (order)), day, text);
  for (const text of ['', 'Lifetime', '31.02.2026', '2026-13-01', '13/13/2026', '1999-12-31', '19999', '80001', '12:00']) {
    assert.equal(files.readFileDay(text), null, text);
  }
  // Slashes: a day past 12 in the first place says day first; in the second, month first; none: the heading's language.
  assert.equal(files.slashOrder(['03/04/2026', '15/04/2026'], false), 'dm');
  assert.equal(files.slashOrder(['03/04/2026', '04/15/2026'], true), 'md');
  assert.equal(files.slashOrder(['03/04/2026'], false), 'md');
  assert.equal(files.slashOrder(['03/04/2026'], true), 'dm');
  assert.equal(files.slashOrder(['15/04/2026', '04/15/2026'], false), null);
  // A file that writes both ways reads only the days that read one way.
  const mixed = files.readResultFile(table(['Publish time', 'Views'], ['15/04/2026', '1'], ['04/15/2026', '2'], ['03/04/2026', '3']));
  assert.ok(mixed.ok);
  assert.deepEqual(mixed.rows.map((row) => row.day), ['2026-04-15', '2026-04-15']);
  assert.equal(mixed.skipped, 1);
  // A Turkish date heading reads slashes day first.
  const turkish = files.readResultFile(table(['Yayınlanma zamanı', 'Erişim'], ['03/04/2026', '1']));
  assert.equal(turkish.ok && turkish.rows[0].day, '2026-04-03');
});

test('links: two ways of writing the same post share one key', () => {
  const same = [
    ['https://www.Instagram.com/p/AbC123/?igsh=xyz#top', 'http://instagram.com/p/AbC123', 'instagram.com/reel/AbC123/', 'https://www.instagram.com/bakery/p/AbC123/', 'https://m.instagram.com/tv/AbC123'],
    ['https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/', 'https://www.linkedin.com/posts/bakery_cookies-activity-7300000000000000001-AbCd?utm_source=share', 'https://linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7300000000000000001'],
    ['https://www.facebook.com/firin/posts/pfbid0AAA/', 'https://facebook.com/firin/posts/pfbid0AAA?__cft__=x', 'https://m.facebook.com/firin/posts/pfbid0AAA'],
    ['https://www.facebook.com/permalink.php?story_fbid=123&id=456', 'https://facebook.com/permalink.php?id=456&story_fbid=123&ref=share'],
  ];
  for (const group of same) {
    const keys = new Set(group.map((link) => files.normalLink(link)));
    assert.equal(keys.size, 1, `${group[0]}: ${[...keys].join(' | ')}`);
    assert.ok(![...keys][0].includes('?') || [...keys][0].includes('story_fbid'), 'no query left but the post’s own');
  }
  assert.equal(files.normalLink('https://WWW.Instagram.COM/p/AbC123/'), 'instagram.com/p/AbC123', 'the host in small letters, the path as written');
  assert.notEqual(files.normalLink('https://instagram.com/p/abc123'), files.normalLink('https://instagram.com/p/AbC123'), 'a post code keeps its capitals');
  assert.notEqual(files.normalLink('https://www.facebook.com/permalink.php?story_fbid=1&id=456'), files.normalLink('https://www.facebook.com/permalink.php?story_fbid=2&id=456'));
  assert.equal(files.normalLink('https://example.com/a/b///'), 'example.com/a/b');
  // A link that carries a sign-in, built from parts so no such address is written in the app.
  const signedIn = ['https://name', ['pw', 'example.com/p/x'].join('@')].join(':');
  for (const text of ['', 'Lifetime', 'not a link', 'ftp://example.com/p/x', signedIn, 'https://localhost/p/x', null, 7, `https://example.org/${'x'.repeat(2048)}`]) {
    assert.equal(files.normalLink(text), null, String(text).slice(0, 40));
  }
  // A key reads the same again (the data side checks a row's link this way), with two leading parts on the host too.
  const twice = ['https://www.m.facebook.com/story.php?story_fbid=1&id=2', 'https://m.www.facebook.com/firin/posts/pfbid0AAA', 'https://WWW.M.Instagram.com/P/AbC123/'];
  for (const group of [...same, twice]) for (const link of group) assert.equal(files.normalLink(files.normalLink(link)), files.normalLink(link), link);
  assert.equal(files.normalLink('https://www.m.facebook.com/story.php?story_fbid=1&id=2'), 'facebook.com/story.php?story_fbid=1&id=2');
  // Instagram's `/P/`, `/REEL/` read as `/p/`; the post's code keeps its capitals.
  assert.equal(files.normalLink('HTTPS://WWW.INSTAGRAM.COM/P/AbC123/'), 'instagram.com/p/AbC123');
  assert.equal(files.normalLink('https://instagram.com/Bakery/REEL/AbC123'), 'instagram.com/p/AbC123');
  assert.equal(files.networkOfLink('instagram.com/p/AbC123'), 'instagram');
  assert.equal(files.networkOfLink('facebook.com/permalink.php?story_fbid=1&id=2'), 'facebook');
  assert.equal(files.networkOfLink('fb.watch/abc'), 'facebook');
  assert.equal(files.networkOfLink('linkedin.com/activity/7300000000000000001'), 'linkedin');
  assert.equal(files.networkOfLink('example.com/post'), null);
  assert.equal(files.networkOfLink(null), null);
});

test('rows that cannot be read are skipped; empty rows and Meta’s first line about the headings are left out', () => {
  const read = files.readResultFile(table(
    ['Permalink', 'Publish time', 'Views', 'Likes'],
    ['The link of the post', 'When it was shared', 'Lifetime: how many saw it', 'Lifetime: likes'],
    [POST, '2026-03-04', '5', ''],
    ['', '', '', ''],
    ['', 'Lifetime', '5', '1'],
    [POST, '2026-03-05', 'many', ''],
    ['', '2026-03-06', '', '2'],
  ));
  assert.ok(read.ok);
  assert.equal(read.rows.length, 2);
  assert.equal(read.skipped, 2, 'no link and no day; no number');
  assert.deepEqual(files.readResultFile(table(['Permalink', 'Views'])), { ok: false, problem: 'results.import.noRows' });
  assert.deepEqual(files.readResultFile(table(['Name', 'Views'], ['a', '1'])), { ok: false, problem: 'results.import.noPosts' });
  assert.deepEqual(files.readResultFile(table(['Permalink', 'Description'], [POST, 'x'])), { ok: false, problem: 'results.import.noNumbers' });
});

// --- the fixture files through the kit's reader ---------------------------------------------

test('the fixture files read through the kit’s reader: English Instagram, Turkish Facebook, a LinkedIn spreadsheet', async () => {
  const instagram = files.readResultFile(await readRows(fixture('results-instagram-en.csv', enc(INSTAGRAM_EN)), { kind: 'csv' }));
  assert.ok(instagram.ok);
  assert.equal(instagram.platform, 'instagram');
  assert.deepEqual(instagram.rows[0], { link: 'instagram.com/p/CookieA1', network: 'instagram', day: '2026-03-05', counts: { views: 1500, likes: 120, comments: 9, shares: 4, saves: 15 } });
  assert.equal(instagram.rows[1].link, 'instagram.com/p/BreadB2', 'a reel’s link');

  const facebook = files.readResultFile(await readRows(fixture('results-facebook-tr.csv', enc(FACEBOOK_TR)), { kind: 'csv' }));
  assert.ok(facebook.ok);
  assert.equal(facebook.platform, 'facebook');
  assert.deepEqual(facebook.rows, [
    { link: 'facebook.com/firin/posts/pfbid0AAA', network: 'facebook', day: '2026-03-05', counts: { views: 1234, likes: 56, comments: 7, shares: 3, clicks: 12 } },
    { link: null, network: 'facebook', day: '2026-03-06', counts: { views: 2500, likes: 80, comments: 10, shares: 4 } },
  ]);
  assert.equal(facebook.skipped, 1);

  const linkedin = files.readResultFile(await readRows(fixture('results-linkedin-en.xlsx', linkedinXlsx()), { kind: 'xlsx' }));
  assert.ok(linkedin.ok);
  assert.equal(linkedin.platform, 'linkedin');
  assert.deepEqual(linkedin.rows, [{ link: 'linkedin.com/activity/7300000000000000001', network: 'linkedin', day: '2026-03-07', counts: { views: 2400, likes: 41, comments: 6, shares: 2, clicks: 33 } }]);
});

// --- filling the shared posts -----------------------------------------------------------------

const row = (fields) => ({ link: null, network: 'instagram', day: null, counts: { likes: 5 }, ...fields });

test('a row fills the shared post with its link, else the only one on that platform and day; only the counts change', async () => {
  await clear();
  const byLink = await shared({ day: '2026-04-01', link: 'https://www.instagram.com/p/Linked1/?igsh=1', fields: { views: 3, clicks: 2 } });
  const byDay = await shared({ day: '2026-04-02' });
  const byPostDay = await shared({ day: '2026-04-06', postDay: '2026-04-05' });
  const theirs = await shared({ owner: OTHER, day: '2026-04-02' });
  const before = await versionOf(byLink.id);
  const answer = await resultImport.fillResultsFor(OWNER, [
    row({ link: 'instagram.com/p/Linked1', day: '2026-03-31', counts: { likes: 40, comments: 4 } }),
    row({ day: '2026-04-02', counts: { views: 100, likes: 7, saves: 1 } }),
    row({ day: '2026-04-05', counts: { likes: 9 } }),
  ]);
  assert.deepEqual(answer, { filled: 3, notMatched: 0, notMatchedDays: [], left: 0, leftBefore: null });
  const linked = await versionOf(byLink.id);
  assert.equal(linked.likes, 40);
  assert.equal(linked.comments, 4);
  assert.equal(linked.views, 3, 'a count the file has no number for stays');
  assert.equal(linked.clicks, 2);
  for (const name of ['text', 'resultNote', 'sharedAt', 'sharedLink', 'network', 'postId', 'on', 'hashtags', 'link']) assert.deepEqual(linked[name], before[name], `${name} unchanged`);
  assert.ok(linked.resultAt !== null, 'results were typed now');
  assert.deepEqual([(await versionOf(byDay.id)).views, (await versionOf(byDay.id)).likes, (await versionOf(byDay.id)).saves], [100, 7, 1]);
  assert.equal((await versionOf(byPostDay.id)).likes, 9, 'the post’s own day fits too');
  const other = await versionOf(theirs.id);
  assert.equal(other.likes, null, 'another owner’s share never changes');
  assert.equal(other.resultAt, null);
});

test('the one-fit rule: two shared posts that fit a row leave it not matched; so do two rows on one post', async () => {
  await clear();
  const first = await shared({ day: '2026-05-01', hour: 9 });
  const second = await shared({ day: '2026-05-01', hour: 19 });
  const facebook = await shared({ network: 'facebook', day: '2026-05-01' });
  const answer = await resultImport.fillResultsFor(OWNER, [row({ day: '2026-05-01', counts: { likes: 11 } })]);
  assert.equal(answer.filled, 0);
  assert.equal(answer.notMatched, 1);
  assert.deepEqual(answer.notMatchedDays, ['2026-05-01']);
  assert.equal((await versionOf(first.id)).likes, null);
  assert.equal((await versionOf(second.id)).likes, null);
  assert.equal((await versionOf(facebook.id)).likes, null, 'another platform never fits');
  // One fit on Facebook that day: filled.
  const one = await resultImport.fillResultsFor(OWNER, [row({ network: 'facebook', day: '2026-05-01', counts: { likes: 12 } })]);
  assert.equal(one.filled, 1);
  assert.equal((await versionOf(facebook.id)).likes, 12);
  // Two rows that fit the same one post: neither fills it.
  const twice = await resultImport.fillResultsFor(OWNER, [
    row({ network: 'facebook', day: '2026-05-01', counts: { likes: 20 } }),
    row({ network: 'facebook', day: '2026-05-01', counts: { likes: 21 } }),
  ]);
  assert.deepEqual([twice.filled, twice.notMatched], [0, 2]);
  assert.equal((await versionOf(facebook.id)).likes, 12);
});

test('a shared post with another post’s link never fits by its day; a link wins over the day; a scheduled one never fits', async () => {
  await clear();
  const elsewhere = await shared({ day: '2026-06-01', link: 'https://www.instagram.com/p/Other7/' });
  const open = await shared({ day: '2026-06-01' });
  const answer = await resultImport.fillResultsFor(OWNER, [row({ link: 'instagram.com/p/Mine8', day: '2026-06-01', counts: { likes: 3 } })]);
  assert.equal(answer.filled, 1);
  assert.equal((await versionOf(open.id)).likes, 3, 'the one without a link fits');
  assert.equal((await versionOf(elsewhere.id)).likes, null);
  // Two links match nothing, so the day decides only among those that fit.
  const ahead = new Date(Date.now() + 3 * 86_400_000);
  const later = await shared({ day: '2026-06-01', sharedAt: ahead.toISOString() });
  const day = `${ahead.getFullYear()}-${String(ahead.getMonth() + 1).padStart(2, '0')}-${String(ahead.getDate()).padStart(2, '0')}`;
  const scheduled = await resultImport.fillResultsFor(OWNER, [row({ day, counts: { likes: 4 } })]);
  assert.deepEqual([scheduled.filled, scheduled.notMatched], [0, 1]);
  assert.equal((await versionOf(later.id)).likes, null, 'a share scheduled for later is not shared yet');
});

test('rows not matched name their first five days, in the file’s order, once each', async () => {
  await clear();
  const days = ['2026-07-09', '2026-07-03', '2026-07-03', '2026-07-05', '2026-07-01', '2026-07-08', '2026-07-02', null];
  const answer = await resultImport.fillResultsFor(OWNER, days.map((day) => row({ day, link: day === null ? 'instagram.com/p/None0' : null })));
  assert.equal(answer.notMatched, 8);
  assert.deepEqual(answer.notMatchedDays, ['2026-07-09', '2026-07-03', '2026-07-05', '2026-07-01', '2026-07-08']);
});

test('the rows a caller hands in are read again', async () => {
  const bad = [
    'rows', [row({ counts: {} })], [row({ counts: { likes: -1 } })], [row({ counts: { likes: 1.5 } })], [row({ counts: { reach: 1 } })],
    [row({ network: 'myspace' })], [row({ day: '2026-02-30' })], [row({ link: 'https://www.instagram.com/p/X/' })],
    Array.from({ length: IMPORT_LIMITS.rows + 1 }, () => row({ day: '2026-01-01' })),
  ];
  for (const rows of bad) {
    await assert.rejects(resultImport.fillResultsFor(OWNER, rows), (error) => error instanceof DataError && error.messageKey === 'refuse.request');
  }
  await assert.rejects(resultImport.fillResultsFor('', []), (error) => error instanceof DataError && error.messageKey === 'error.ownerMissing');
  assert.deepEqual(await resultImport.fillResultsFor(OWNER, []), { filled: 0, notMatched: 0, notMatchedDays: [], left: 0, leftBefore: null });
});

test('a kept Facebook link in another form than the file’s counts as no link for the day; the same form never fits another post', async () => {
  await clear();
  const key = (link) => files.normalLink(link);
  const shareLink = await shared({ network: 'facebook', day: '2026-08-03', link: 'https://www.facebook.com/share/p/1AbCdEf/' });
  const pfbid = await shared({ network: 'facebook', day: '2026-08-04', link: 'https://www.facebook.com/firin/posts/pfbid0BBB' });
  const permalink = await shared({ network: 'facebook', day: '2026-08-05', link: 'https://www.facebook.com/permalink.php?story_fbid=111&id=9' });
  const answer = await resultImport.fillResultsFor(OWNER, [
    row({ network: 'facebook', day: '2026-08-03', link: key('https://www.facebook.com/permalink.php?story_fbid=222&id=9'), counts: { likes: 3 } }),
    row({ network: 'facebook', day: '2026-08-04', link: key('https://www.facebook.com/9/posts/333'), counts: { likes: 4 } }),
    row({ network: 'facebook', day: '2026-08-05', link: key('https://www.facebook.com/story.php?story_fbid=444&id=9'), counts: { likes: 5 } }),
  ]);
  assert.deepEqual([answer.filled, answer.notMatched], [2, 1]);
  assert.equal((await versionOf(shareLink.id)).likes, 3, 'a share link and a permalink: the day decides');
  assert.equal((await versionOf(pfbid.id)).likes, 4, 'a pfbid address and a numbered post: the day decides');
  assert.equal((await versionOf(permalink.id)).likes, null, 'another permalink is another post');
  // Exactly one still has to fit: a second share that day makes two.
  await shared({ network: 'facebook', day: '2026-08-03' });
  const two = await resultImport.fillResultsFor(OWNER, [row({ network: 'facebook', day: '2026-08-03', link: key('https://www.facebook.com/permalink.php?story_fbid=555&id=9'), counts: { likes: 6 } })]);
  assert.deepEqual([two.filled, two.notMatched], [0, 1]);
  // Two rows that would claim the same share: neither fills it.
  const claims = await resultImport.fillResultsFor(OWNER, [
    row({ network: 'facebook', day: '2026-08-04', link: key('https://www.facebook.com/9/posts/666'), counts: { likes: 7 } }),
    row({ network: 'facebook', day: '2026-08-04', link: key('https://www.facebook.com/9/posts/777'), counts: { likes: 8 } }),
  ]);
  assert.deepEqual([claims.filled, claims.notMatched], [0, 2]);
  assert.equal((await versionOf(pfbid.id)).likes, 4);
  // The forms, one by one.
  const forms = {
    'facebook:share': 'https://www.facebook.com/share/v/1AbC/', 'facebook:pfbid': 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=9',
    'facebook:permalink': 'https://m.facebook.com/story.php?story_fbid=1&id=2', 'facebook:posts': 'https://www.facebook.com/firin/posts/123',
    'facebook:photo': 'https://www.facebook.com/photo/?fbid=12', 'facebook:video': 'https://fb.watch/abc/',
    'instagram:post': 'https://www.instagram.com/reel/AbC/', 'linkedin:activity': 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001',
    'linkedin:other': 'https://lnkd.in/abc', web: 'https://example.com/offer',
  };
  for (const [form, link] of Object.entries(forms)) assert.equal(files.linkForm(key(link)), form, link);
  assert.equal(files.linkForm(null), null);
});

test('the import’s writes name their owner inside each change', async () => {
  await clear();
  const mine = await shared({ day: '2026-08-10' });
  const ACTION = Symbol.for('tellop.internalRecordsAction');
  const store = globalThis[Symbol.for('tellop.template.storage')];
  const steps = [];
  globalThis[ACTION] = async (sent) => {
    steps.push(...sent);
    return store.client.$transaction(async (records) => {
      const answers = [];
      for (const step of sent) answers.push(await records[step.model[0].toLowerCase() + step.model.slice(1)][step.action](step.args ?? {}));
      return answers;
    });
  };
  const prior = process.env.TELLOP_INTERNAL_RECORDS;
  process.env.TELLOP_INTERNAL_RECORDS = '1';
  let answer;
  try {
    answer = await resultImport.fillResultsFor(OWNER, [row({ day: '2026-08-10', counts: { likes: 11 } })]);
  } finally {
    if (prior === undefined) delete process.env.TELLOP_INTERNAL_RECORDS;
    else process.env.TELLOP_INTERNAL_RECORDS = prior;
    delete globalThis[ACTION];
  }
  assert.equal(answer.filled, 1);
  assert.equal((await versionOf(mine.id)).likes, 11);
  const writes = steps.filter((step) => step.model === 'PostVersion' && step.action === 'updateMany');
  assert.equal(writes.length, 1);
  for (const step of steps) assert.equal(step.args?.where?.ownerId, OWNER, `${step.model}.${step.action} names its owner`);
});

test('a file’s kind by its name and first bytes: a .xls that is a zip reads as a spreadsheet, an old one is refused', () => {
  assert.equal(kinds.kindOfFile('Posts.CSV'), 'csv');
  assert.equal(kinds.kindOfFile('posts.xlsx'), 'xlsx');
  assert.equal(kinds.kindOfFile('posts.xls'), 'xls');
  assert.equal(kinds.kindOfFile(' posts.xls '), 'xls');
  for (const name of ['posts.xlsm', 'posts.csv.txt', 'posts', '', null, undefined, 'posts.numbers']) assert.equal(kinds.kindOfFile(name), null, String(name));
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const old = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(kinds.startOf(zip), 'zip');
  assert.equal(kinds.startOf(old), 'old');
  assert.equal(kinds.startOf(old.slice(0, 7)), 'other', 'one byte short of the mark');
  assert.equal(kinds.startOf(zip.slice(0, 3)), 'other');
  assert.equal(kinds.startOf(enc('<table>')), 'other');
  assert.equal(kinds.startOf(null), 'other');
  assert.deepEqual(kinds.sendKind('csv', 'other'), { kind: 'csv' });
  assert.deepEqual(kinds.sendKind('xls', 'zip'), { kind: 'xlsx' });
  assert.deepEqual(kinds.sendKind('xls', 'old'), { problem: 'results.import.oldXls' });
  assert.deepEqual(kinds.sendKind('xls', 'other'), { problem: 'results.import.oldXls' });
  assert.deepEqual(kinds.sendKind('xlsx', 'zip'), { kind: 'xlsx' });
  assert.deepEqual(kinds.sendKind('xlsx', 'old'), { problem: 'results.import.oldXls' });
  assert.deepEqual(kinds.sendKind('xlsx', 'other'), { kind: 'xlsx' });
  assert.deepEqual(kinds.sendKind(null, 'zip'), { problem: 'results.import.wrongKind' });
  assert.ok(kinds.FILE_ACCEPT.split(',').includes('.xls'));
});

/** A LinkedIn-like spreadsheet whose first sheet is the daily totals and whose posts are on the second. */
function twoSheetXlsx() {
  const metrics = `<worksheet><sheetData>${[
    sheetRow(1, ['Date', 'Impressions (organic)', 'Clicks (organic)']),
    sheetRow(2, ['03/08/2026', 900, 12]),
  ].join('')}</sheetData></worksheet>`;
  const posts = `<worksheet><sheetData>${[
    sheetRow(1, ['All posts']),
    `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>Post link</t></is></c><c r="C2" t="inlineStr"><is><t>Created date</t></is></c><c r="D2" t="inlineStr"><is><t>Impressions</t></is></c><c r="E2" t="inlineStr"><is><t>Likes</t></is></c></row>`,
    sheetRow(3, ['Cookies', 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000002', '03/08/2026', 1800, 44]),
  ].join('')}</sheetData></worksheet>`;
  const parts = [
    ['xl/workbook.xml', `<workbook xmlns:r="${OFFICE.slice(0, -1)}"><sheets><sheet name="Metrics" r:id="rMetrics"/><sheet name="All posts" r:id="rPosts"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rMetrics" Type="${OFFICE}worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rPosts" Type="${OFFICE}worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rWords" Type="${OFFICE}sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', '<sst><si><t>Post title</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', metrics],
    ['xl/worksheets/sheet2.xml', posts],
  ];
  return zipFiles(parts.map(([name, text]) => ({ name, bytes: enc(text) })), { now: '2026-01-01T00:00:00Z' });
}

test('a spreadsheet’s posts on its second sheet are read; an old spreadsheet is refused with what to do', async () => {
  const read = await files.readResultBytes(twoSheetXlsx(), 'xlsx');
  assert.equal(read.ok, true);
  assert.deepEqual(read.rows, [{ link: 'linkedin.com/activity/7300000000000000002', network: 'linkedin', day: '2026-03-08', counts: { views: 1800, likes: 44 } }]);
  assert.equal(files.sheetFiles(twoSheetXlsx()).length, 2);
  // Through the address: the share on that post fills.
  await clear();
  const linked = await shared({ network: 'linkedin', day: '2026-03-08', link: 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000002/' });
  const answer = await send(twoSheetXlsx(), { type: XLSX });
  assert.deepEqual([answer.status, answer.json.filled], [200, 1]);
  assert.deepEqual([(await versionOf(linked.id)).views, (await versionOf(linked.id)).likes], [1800, 44]);
  // A spreadsheet with no sheet of posts answers as one sheet would.
  const onlyMetrics = zipFiles([
    { name: 'xl/workbook.xml', bytes: enc(`<workbook xmlns:r="${OFFICE.slice(0, -1)}"><sheets><sheet name="Metrics" r:id="rMetrics"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: enc(`<Relationships><Relationship Id="rMetrics" Type="${OFFICE}worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: 'xl/worksheets/sheet1.xml', bytes: enc(`<worksheet><sheetData>${sheetRow(1, ['Date', 'Impressions'])}${sheetRow(2, ['03/08/2026', 9])}</sheetData></worksheet>`) },
  ]);
  assert.deepEqual(await send(onlyMetrics, { type: XLSX }), { status: 400, json: { problem: 'results.import.noPosts' } });
  // The old spreadsheet format, sent as a spreadsheet: refused with what to do.
  const old = new Uint8Array(512);
  old.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.deepEqual(await send(old, { type: XLSX }), { status: 400, json: { problem: 'results.import.oldXls' } });
});

test('an odd link skips its own row only: the file’s other rows still fill', async () => {
  await clear();
  const cookie = await shared({ day: '2026-03-05', link: 'https://www.instagram.com/p/CookieA1/' });
  const story = await shared({ network: 'facebook', day: '2026-03-06', link: 'https://www.facebook.com/story.php?story_fbid=1&id=2' });
  const csv = [
    'Permalink,Publish time,Likes',
    'https://www.instagram.com/p/CookieA1/,03/05/2026 18:30,12',
    'https://www.m.facebook.com/story.php?story_fbid=1&id=2,03/06/2026 09:00,13',
    'not a link at all,,14',
    '',
  ].join('\n');
  const answer = await send(enc(csv));
  assert.equal(answer.status, 200);
  assert.deepEqual([answer.json.filled, answer.json.skipped], [2, 1]);
  assert.deepEqual([(await versionOf(cookie.id)).likes, (await versionOf(story.id)).likes], [12, 13]);
});

// --- the address ----------------------------------------------------------------------------

test('the address reads the three fixture files and fills the shared posts they name', async () => {
  await clear();
  const cookie = await shared({ day: '2026-03-05', link: 'https://www.instagram.com/p/CookieA1/?igsh=abc' });
  const bread = await shared({ day: '2026-03-09', hour: 8, link: 'https://www.instagram.com/p/BreadB2/' });
  const firin = await shared({ network: 'facebook', day: '2026-03-05', link: 'https://www.facebook.com/firin/posts/pfbid0AAA' });
  const ekmek = await shared({ network: 'facebook', day: '2026-03-06', hour: 10 });
  const linked = await shared({ network: 'linkedin', day: '2026-03-08', postDay: '2026-03-07', link: 'https://www.linkedin.com/posts/bakery_cookies-activity-7300000000000000001-AbCd?utm_source=share' });

  const instagram = await send(fixture('results-instagram-en.csv', enc(INSTAGRAM_EN)));
  assert.equal(instagram.status, 200);
  assert.deepEqual(instagram.json, { filled: 2, notMatched: 1, notMatchedDays: ['2026-01-02'], left: 0, leftBefore: null, skipped: 0 });
  assert.deepEqual([(await versionOf(cookie.id)).views, (await versionOf(cookie.id)).saves, (await versionOf(bread.id)).likes], [1500, 15, 60]);

  const facebook = await send(fixture('results-facebook-tr.csv', enc(FACEBOOK_TR)));
  assert.deepEqual(facebook.json, { filled: 2, notMatched: 0, notMatchedDays: [], left: 0, leftBefore: null, skipped: 1 });
  assert.deepEqual([(await versionOf(firin.id)).views, (await versionOf(firin.id)).clicks, (await versionOf(ekmek.id)).likes], [1234, 12, 80]);

  const linkedin = await send(fixture('results-linkedin-en.xlsx', linkedinXlsx()), { type: XLSX });
  assert.deepEqual(linkedin.json, { filled: 1, notMatched: 0, notMatchedDays: [], left: 0, leftBefore: null, skipped: 0 });
  assert.deepEqual([(await versionOf(linked.id)).views, (await versionOf(linked.id)).shares], [2400, 2]);
});

test('the address refuses another site, another kind of body, a file too large and a file it cannot read', async () => {
  const csv = enc(INSTAGRAM_EN);
  assert.deepEqual(await send(csv, { site: 'cross-site' }), { status: 403, json: { problem: 'refuse.request' } });
  assert.deepEqual(await send(csv, { site: 'same-site' }), { status: 403, json: { problem: 'refuse.request' } });
  assert.equal((await send(csv, { site: 'same-origin' })).status, 200);
  assert.deepEqual(await send(csv, { type: 'text/plain' }), { status: 400, json: { problem: 'refuse.request' } });
  assert.deepEqual(await send(csv, { type: 'multipart/form-data; boundary=x' }), { status: 400, json: { problem: 'refuse.request' } });
  assert.deepEqual(await send(csv, { length: IMPORT_LIMITS.fileBytes + 1 }), { status: 413, json: { problem: 'import.tooLarge' } });
  const big = new Uint8Array(IMPORT_LIMITS.fileBytes + 1).fill(65);
  assert.deepEqual(await send(big), { status: 413, json: { problem: 'import.tooLarge' } });
  assert.deepEqual(await send(enc('Permalink,Views\n"open,1\n')), { status: 400, json: { problem: 'import.malformed' } });
  assert.deepEqual(await send(enc('Permalink,Views\na,1,2\n')), { status: 400, json: { problem: 'import.rowWidth' } });
  assert.deepEqual(await send(enc('PK nonsense'), { type: XLSX }), { status: 400, json: { problem: 'import.zip' } });
  assert.deepEqual(await send(enc('Name,Views\na,1\n')), { status: 400, json: { problem: 'results.import.noPosts' } });
  assert.deepEqual(await send(enc('Permalink,Description\na,b\n')), { status: 400, json: { problem: 'results.import.noNumbers' } });
  assert.deepEqual(await send(enc('Permalink,Views\n')), { status: 400, json: { problem: 'results.import.noRows' } });
  const tooMany = ['Permalink,Views', ...Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, index) => `https://www.instagram.com/p/P${index}/,1`)].join('\n');
  assert.deepEqual(await send(enc(tooMany)), { status: 413, json: { problem: 'import.tooLarge' } });
});

// --- Tellop's records bounds --------------------------------------------------------------------

/** A kept link whose stored form takes nearly the most bytes a link may (each `ş` is kept as `%C5%9F`). */
const heavyLink = (code) => new URL(`https://www.instagram.com/p/${code}/?n=${'ş'.repeat(155)}`).href;

test('a file of more shared posts than one request checks: every bound kept, the rest named', async () => {
  await clear();
  assert.ok(Buffer.byteLength(heavyLink('C0000')) <= 1000, 'a link as long as one can be kept');
  const count = resultImport.MOST_VERSIONS + 16;
  const first = '2025-01-01';
  const at = stamp();
  await modelAction('Post', 'createMany', { data: Array.from({ length: count }, (_, index) => ({ ownerId: OWNER, name: `Heavy ${index}`, day: addDays(first, index), createdAt: at, updatedAt: at })) });
  const postRows = await modelAction('Post', 'findMany', { where: { ownerId: OWNER }, orderBy: { id: 'asc' }, select: { id: true, day: true } });
  await modelAction('PostVersion', 'createMany', {
    data: postRows.map((post, index) => ({ ownerId: OWNER, postId: post.id, network: 'instagram', sharedAt: momentOn(post.day), sharedLink: heavyLink(`C${String(index).padStart(4, '0')}`), updatedAt: at })),
  });
  const lines = ['Permalink,Publish time,Likes', ...postRows.map((post, index) => `https://www.instagram.com/p/C${String(index).padStart(4, '0')}/,${post.day},${index}`)];
  const run = await measured(() => send(enc(lines.join('\n'))));
  bounded(run, 'reading a numbers file', 15);
  assert.equal(mostInFlight(run), 1, 'one call at a time');
  const { value } = run;
  assert.equal(value.status, 200);
  assert.equal(value.json.filled, resultImport.MOST_VERSIONS);
  assert.equal(value.json.left, 16, 'the oldest were not read');
  assert.equal(value.json.leftBefore, postRows[16].day);
  assert.equal(value.json.notMatched, 0);
  const newest = await modelAction('PostVersion', 'findFirst', { where: { ownerId: OWNER, postId: postRows.at(-1).id } });
  assert.equal(newest.likes, count - 1);
  const oldest = await modelAction('PostVersion', 'findFirst', { where: { ownerId: OWNER, postId: postRows[0].id } });
  assert.equal(oldest.likes, null);
});
