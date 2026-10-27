/**
 * The "This week" page: its pure rules (which week an address asks for, the
 * days and their posts, each platform's line, Mark scheduled or I shared it,
 * the files one press of Save all pictures fetches and names), and the page's
 * read at its largest through Tellop's records hook, against a throwaway
 * store (`APP_DATA_FILE` in a temporary folder, removed afterwards).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'week-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage, modelAction } = await import('../lib/data/index.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { NETWORK_KEYS } = await import('../lib/plan/networks.js');
const { SHAPE_KEYS } = await import('../lib/plan/shapes.js');
const { sharedWords, trackingFor } = await import('../lib/plan/share.js');
const { ZIP_LIMITS, unzipStored, zipFiles } = await import('../lib/plan/zip.js');
const plan = await import('../lib/data/plan.js');
const posts = await import('../lib/data/posts.js');
const rules = await import('../app/week/rules.js');
const { readWeekPage } = await import('../app/week/read.js');
const { PAGES } = await import('../lib/pages.js');
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');
const { weekTitle } = await import('../app/calendar/format.js');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const TAG = 'abcdef012345';
/** A chosen photo with kept copies in `shapes` (each a 12-hex tag). */
const photo = (id, shapes = {}) => ({ id, postId: 1, source: 'photo', chosen: true, position: 1, original: TAG, shapes: { ...Object.fromEntries(SHAPE_KEYS.map((key) => [key, null])), ...shapes } });

/* ------------------------------------------------------------ the week */

test('the address names a week by its first day: Sunday in English, Monday in Turkish; any day reads as its week', () => {
  // Wednesday 21 October 2026.
  const today = '2026-10-21';
  assert.deepEqual(rules.weekOf({}, today, false).days, ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(rules.weekOf({}, today, true).from, '2026-10-19');
  assert.equal(rules.weekOf({}, today, true).to, '2026-10-25');
  // Every day of a week, and the day before and after it.
  for (const day of ['2026-10-26', '2026-10-28', '2026-11-01']) assert.equal(rules.weekOf({ week: day }, today, true).from, '2026-10-26', day);
  assert.equal(rules.weekOf({ week: '2026-10-25' }, today, true).from, '2026-10-19');
  assert.equal(rules.weekOf({ week: '2026-11-02' }, today, true).from, '2026-11-02');
  assert.equal(rules.weekOf({ week: ['2026-11-04', 'x'] }, today, false).from, '2026-11-01');
  // A missing or wrong day is this week.
  for (const week of [undefined, '', '2026-13-01', '2026-02-30', '21.10.2026', 7]) {
    assert.equal(rules.weekOf({ week }, today, true).from, '2026-10-19', String(week));
  }
  assert.equal(rules.weekOf(null, today, true).from, '2026-10-19');
  // This week, and the week next to it.
  assert.equal(rules.weekOf({}, today, true).thisWeek, true);
  assert.equal(rules.weekOf({ week: '2026-10-25' }, today, true).thisWeek, true);
  assert.equal(rules.weekOf({ week: '2026-10-26' }, today, true).thisWeek, false);
  assert.equal(rules.weekOf({ week: '2026-10-18' }, today, true).thisWeek, false);
  // Previous and next across a month and a year.
  const turn = rules.weekOf({ week: '2026-12-31' }, today, true);
  assert.deepEqual([turn.from, turn.to, turn.previous, turn.next], ['2026-12-28', '2027-01-03', '2026-12-21', '2027-01-04']);
});

test('a week at the edge of the app\'s days has no week past it, and a week that runs past them reads as this week', () => {
  const today = '2026-10-21';
  // Monday 3 January 2000 starts the first whole Monday-first week; the week before runs into 1999.
  const first = rules.weekOf({ week: '2000-01-03' }, today, true);
  assert.equal(first.from, '2000-01-03');
  assert.equal(first.previous, null);
  assert.equal(first.next, '2000-01-10');
  assert.equal(rules.weekOf({ week: '2000-01-10' }, today, true).previous, '2000-01-03');
  // Saturday 1 January 2000's week starts in 1999: this week instead.
  assert.equal(rules.weekOf({ week: '2000-01-01' }, today, true).from, '2026-10-19');
  // The last whole week: Monday 23 December 2199 to Sunday the 29th; the next one runs into 2200.
  const last = rules.weekOf({ week: '2199-12-23' }, today, true);
  assert.equal(last.next, null);
  assert.equal(rules.weekOf({ week: '2199-12-16' }, today, true).next, '2199-12-23');
  assert.equal(rules.weekOf({ week: '2199-12-31' }, today, true).from, '2026-10-19');
});

test('the week\'s title is written with plain spaces, as a browser writes it, so the page the server drew matches the one the browser draws', () => {
  // Node writes thin spaces around a range's dash, a browser plain ones: the title differed and the page was drawn twice.
  assert.equal(weekTitle('2026-10-25', '2026-10-31', 'en'), 'Oct 25 – 31, 2026');
  assert.equal(weekTitle('2026-10-31', '2026-11-06', 'en'), 'Oct 31 – Nov 6, 2026');
  assert.equal(weekTitle('2026-12-28', '2027-01-03', 'tr'), '28 Ara 2026 – 3 Oca 2027');
  assert.equal(weekTitle('2026-10-26', '2026-11-01', 'tr'), '26 Eki – 1 Kas 2026');
  assert.equal(weekTitle('2026-10-19', '2026-10-25', 'tr'), '19–25 Eki 2026');
});

test('the week page sits in the menu after the calendar', () => {
  const at = PAGES.findIndex((page) => page.href === '/week');
  assert.equal(PAGES[at - 1].href, '/');
  assert.equal(PAGES[at].wordsKey, 'menu.week');
  assert.equal(rules.weekAddress('2026-10-19'), '/week?week=2026-10-19');
  assert.equal(rules.calendarWeekAddress('2026-10-19'), '/?view=week&day=2026-10-19');
  assert.equal(rules.shareAddress(7), '/posts/7#share');
  assert.equal(rules.versionAddress(7, 'x'), '/api/posts/7/versions/x');
});

test('the days that hold a post, in the week\'s order, each post by time with no time first', () => {
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  const list = [
    { id: 5, day: '2026-10-21', time: '18:30' }, { id: 4, day: '2026-10-21', time: null }, { id: 3, day: '2026-10-21', time: '09:00' },
    { id: 2, day: '2026-10-19', time: '09:00' }, { id: 1, day: '2026-10-19', time: '09:00' }, { id: 6, day: '2026-10-18', time: null },
    { id: 7, day: '2026-10-26', time: null }, { id: 8, day: null, time: null },
  ];
  const groups = rules.daysWithPosts(days, list);
  assert.deepEqual(groups.map((group) => [group.day, group.posts.map((post) => post.id)]), [['2026-10-19', [1, 2]], ['2026-10-21', [4, 3, 5]]]);
  assert.deepEqual(rules.daysWithPosts(days, []), []);
});

/* ------------------------------------------------------------ scheduled or shared */

test('a version is scheduled while its moment is ahead, shared from that moment on', () => {
  const now = Date.parse('2026-10-21T09:00:00.000Z');
  assert.equal(rules.versionMark({ sharedAt: null }, now), 'none');
  assert.equal(rules.versionMark({ sharedAt: '' }, now), 'none');
  assert.equal(rules.versionMark(undefined, now), 'none');
  assert.equal(rules.versionMark({ sharedAt: '2026-10-21T09:00:00.001Z' }, now), 'scheduled');
  assert.equal(rules.versionMark({ sharedAt: '2026-10-21T09:00:00.000Z' }, now), 'shared');
  assert.equal(rules.versionMark({ sharedAt: '2026-10-21T08:59:59.999Z' }, now), 'shared');
});

test('Mark scheduled shows while the post\'s moment is ahead; once it has passed, I shared it', () => {
  const moment = new Date(2026, 9, 21, 18, 30).getTime();
  assert.equal(rules.plannedMoment('2026-10-21', '18:30'), moment);
  assert.equal(rules.markAction('2026-10-21', '18:30', moment - 1), 'scheduled');
  assert.equal(rules.markAction('2026-10-21', '18:30', moment), 'shared');
  assert.equal(rules.markAction('2026-10-21', '18:30', moment + 1), 'shared');
  // No time: 12:00, as Mark scheduled keeps it.
  const noon = new Date(2026, 9, 21, 12, 0).getTime();
  assert.equal(rules.plannedMoment('2026-10-21', null), noon);
  assert.equal(rules.plannedMoment('2026-10-21', '25:00'), noon);
  assert.equal(rules.markAction('2026-10-21', null, noon - 1), 'scheduled');
  assert.equal(rules.markAction('2026-10-21', null, noon), 'shared');
  // No day: nothing to mark.
  assert.equal(rules.plannedMoment(null, '18:30'), null);
  assert.equal(rules.markAction(null, '18:30', 0), null);
  assert.equal(rules.SCHEDULE_TIME, posts.SCHEDULE_TIME);
});

test('the page\'s moment for a post is the one Mark scheduled keeps, with and without a time', async () => {
  const timed = await posts.createPostFor(OWNER, { name: 'Timed', day: '2034-05-10', time: '18:30' });
  const untimed = await posts.createPostFor(OWNER, { name: 'Untimed', day: '2034-05-10' });
  const kept = await posts.markScheduledFor(OWNER, timed.id, 'instagram');
  assert.equal(kept.timeAssumed, false);
  assert.equal(Date.parse(kept.version.sharedAt), rules.plannedMoment('2034-05-10', '18:30'));
  const noon = await posts.markScheduledFor(OWNER, untimed.id, 'instagram');
  assert.equal(noon.timeAssumed, true);
  assert.equal(Date.parse(noon.version.sharedAt), rules.plannedMoment('2034-05-10', null));
});

/* ------------------------------------------------------------ a platform's line */

test('the Save picture step: the kept copy, the post to open where it is not kept or cannot be shared, else nothing', () => {
  assert.equal(rules.pictureStep(null, 'portrait'), 'none');
  assert.equal(rules.pictureStep(photo(1, { portrait: TAG }), 'portrait'), 'file');
  assert.equal(rules.pictureStep(photo(1, { square: TAG }), 'portrait'), 'open');
  assert.equal(rules.pictureStep({ ...photo(1, { portrait: TAG }), source: 'card', cardRefused: true }, 'portrait'), 'open');
  assert.equal(rules.pictureStep({ id: 1, source: 'words', words: 'Sale', shapes: {} }, 'square'), 'open');
  // A words picture with no words, and a photo with no original: the page cannot make the copy.
  assert.equal(rules.pictureStep({ id: 1, source: 'words', words: ' ', shapes: {} }, 'square'), 'none');
  assert.equal(rules.pictureStep({ id: 1, source: 'photo', original: null, shapes: {} }, 'square'), 'none');
  assert.equal(rules.pictureDownloadAddress(photo(9, { portrait: TAG }), 'portrait'), `/api/pictures/9/file?shape=portrait&v=${TAG}&download=1`);
});

test('a line for each platform the post goes to, in My plan\'s order, with the words the platform carries', () => {
  const now = new Date(2026, 9, 21, 9, 0).getTime();
  const versions = [
    { network: 'x', on: true, text: 'New mugs', hashtags: '#clay', link: 'https://shop.example/mugs', sharedAt: null },
    { network: 'instagram', on: true, text: 'New mugs', hashtags: '#clay #mugs', link: 'https://shop.example/mugs', sharedAt: new Date(2026, 9, 21, 18, 30).toISOString() },
    { network: 'facebook', on: false, text: 'Off', hashtags: '', link: '', sharedAt: null },
    { network: 'threads', on: true, text: '   ', hashtags: '', link: '', sharedAt: null },
    { network: 'bluesky', on: true, text: 'Shared already', hashtags: '', link: '', sharedAt: '2026-10-20T10:00:00.000Z' },
  ];
  const lines = rules.platformLines({
    post: { id: 3, day: '2026-10-21', time: '18:30' }, versions, picture: photo(4, { portrait: TAG }),
    networks: ['instagram', 'facebook', 'x', 'threads', 'bluesky', 'linkedin', 'nowhere'], now,
  });
  assert.deepEqual(lines.map((line) => line.network), ['instagram', 'x', 'threads', 'bluesky', 'linkedin']);
  const [instagram, x, threads, bluesky, linkedin] = lines;
  // Instagram: no pressable link in the words; scheduled; its shape kept.
  assert.equal(instagram.words, sharedWords('instagram', versions[1]));
  assert.ok(!instagram.words.includes('https://'));
  assert.equal(instagram.status, 'scheduled');
  assert.equal(instagram.picture, 'file');
  assert.equal(instagram.pictureAddress, `/api/pictures/4/file?shape=portrait&v=${TAG}&download=1`);
  // X: the link goes in the words; its shape (landscape) is not kept: open the post.
  assert.equal(x.words, 'New mugs\n\nhttps://shop.example/mugs\n\n#clay');
  assert.equal(x.picture, 'open');
  assert.equal(x.pictureAddress, null);
  assert.equal(x.status, 'none');
  assert.equal(x.action, 'scheduled');
  assert.equal(threads.hasWords, false);
  assert.equal(bluesky.status, 'shared');
  // A platform with no version yet is on, with no words.
  assert.equal(linkedin.hasWords, false);
  assert.equal(linkedin.words, '');
  // Once the moment has passed, the line offers I shared it.
  assert.equal(rules.platformLines({ post: { id: 3, day: '2026-10-21', time: '08:00' }, versions, picture: null, networks: ['x'], now })[0].action, 'shared');
});

test('the words a line copies carry the post\'s link tracking: the link after the words and the addresses in them; never the profile link', () => {
  const now = new Date(2026, 9, 21, 9, 0).getTime();
  const tracking = trackingFor({ campaignId: 7 }, { campaigns: [{ id: 7, name: 'Kış İndirimi' }], profileLink: 'https://linktr.ee/blueclay' });
  const versions = [
    { network: 'facebook', on: true, text: 'New mugs!', hashtags: '', link: 'https://shop.example/mugs', sharedAt: null },
    { network: 'x', on: true, text: 'New mugs! https://shop.example and https://linktr.ee/blueclay', hashtags: '', link: '', sharedAt: null },
    { network: 'instagram', on: true, text: 'New mugs!', hashtags: '', link: 'https://shop.example/mugs', sharedAt: null },
  ];
  const lines = rules.platformLines({ post: { id: 3, day: '2026-10-21', time: '18:30', tracking }, versions, picture: null, networks: ['facebook', 'x', 'instagram'], now });
  const [facebook, x, instagram] = lines;
  assert.ok(facebook.words.endsWith('https://shop.example/mugs?utm_source=facebook&utm_medium=social&utm_campaign=kis-indirimi'), facebook.words);
  assert.equal(x.words, 'New mugs! https://shop.example/?utm_source=x&utm_medium=social&utm_campaign=kis-indirimi and https://linktr.ee/blueclay');
  assert.equal(instagram.words, 'New mugs!', 'no link where links cannot be pressed');
  // The same words the post maker copies.
  for (const line of lines) assert.equal(line.words, sharedWords(line.network, versions.find((item) => item.network === line.network), tracking));
  // Tracking off in My plan: as written.
  const off = rules.platformLines({ post: { id: 3, day: '2026-10-21', time: '18:30', tracking: { ...tracking, track: false } }, versions, picture: null, networks: ['facebook'], now });
  assert.equal(off[0].words, 'New mugs!\n\nhttps://shop.example/mugs');
});

test('a post reads from its tile until its record comes, then its state is worked out again for the moment', async () => {
  const networks = ['instagram', 'x'];
  await plan.saveProfileFor(OWNER, { networks: networks.join(',') });
  const made = await posts.createPostFor(OWNER, { name: 'Sale', day: '2034-06-14', time: '10:00' });
  await posts.saveVersionsFor(OWNER, made.id, [{ network: 'instagram', text: 'Sale on' }, { network: 'x', text: 'Sale on' }], { replace: true });
  const [tile] = await posts.listDaysFor(OWNER, '2034-06-14', '2034-06-14', networks);
  const before = rules.weekPost(tile, null, networks, Date.now());
  assert.equal(before.read, false);
  assert.equal(before.state.state, tile.state);
  const moment = rules.plannedMoment('2034-06-14', '10:00');
  await posts.markScheduledFor(OWNER, made.id, 'instagram');
  let full = await posts.getPostFor(OWNER, made.id);
  assert.deepEqual(rules.weekPost(tile, full, networks, moment - 1).state, { state: 'partly', shared: 0, scheduled: 1, of: 2 });
  const marked = await posts.markScheduledFor(OWNER, made.id, 'x');
  full = rules.withVersion(full, marked.version);
  const after = rules.weekPost(tile, full, networks, moment - 1);
  assert.equal(after.read, true);
  assert.deepEqual(after.state, { state: 'scheduled', shared: 0, scheduled: 2, of: 2 });
  assert.equal(rules.weekPost(tile, full, networks, moment).state.state, 'shared');
  // Undo through unshare: back to ready.
  const undone = await posts.unmarkSharedFor(OWNER, made.id, 'x');
  assert.equal(rules.weekPost(tile, rules.withVersion(full, undone), networks, moment - 1).state.state, 'partly');
  assert.equal(rules.chosenPictureOf({ pictures: [{ id: 2, chosen: true, position: 2 }, { id: 1, chosen: true, position: 1 }, { id: 3, chosen: false }] }).id, 1);
  assert.equal(rules.chosenPictureOf({ pictures: [] }), null);
});

/* ------------------------------------------------------------ Save all pictures */

test('a file name part is plain ASCII, Turkish letters as their plain twins, at most 40 characters', () => {
  assert.equal(rules.asciiName('Şubat İndirimi: çok güzel ÖĞÜ!'), 'subat-indirimi-cok-guzel-ogu');
  assert.equal(rules.asciiName('Café crème 🎉 #1'), 'cafe-creme-1');
  assert.equal(rules.asciiName('  ---  '), '');
  assert.equal(rules.asciiName('🎉'), '');
  assert.equal(rules.asciiName(null), '');
  assert.equal(rules.asciiName('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(rules.asciiName('a'.repeat(41)), 'a'.repeat(40));
  // A cut never ends on a dash.
  assert.equal(rules.asciiName(`${'a'.repeat(39)} b`), 'a'.repeat(39));
  assert.ok(/^[a-z0-9-]*$/u.test(rules.asciiName('ıİşŞğĞüÜöÖçÇ ẞ Å Ø ½')));
});

test('a picture\'s ending comes from its kind; a kind the zip does not take has none', () => {
  assert.equal(rules.extensionOf('image/webp'), 'webp');
  assert.equal(rules.extensionOf('image/jpeg; charset=binary'), 'jpg');
  assert.equal(rules.extensionOf('IMAGE/PNG'), 'png');
  for (const type of [null, '', 'text/html', 'image/svg+xml', 'application/zip']) assert.equal(rules.extensionOf(type), null, String(type));
});

test('Save all pictures takes each post\'s copy in each shape its platforms use, once, and names the posts not ready', () => {
  const plan = rules.picturePlan([
    // Instagram and Facebook both use portrait: one file named for both; X uses landscape, kept too.
    { id: 1, name: 'Yeni kupalar', day: '2026-10-21', networks: ['instagram', 'facebook', 'x'], picture: photo(11, { portrait: TAG, landscape: TAG }) },
    // Pinterest's tall copy is not kept: not ready, counted once for its one shape.
    { id: 2, name: 'Tea set', day: '2026-10-22', networks: ['instagram', 'pinterest'], picture: photo(12, { portrait: TAG }) },
    // A customer's card that cannot be shared yet: not ready for each shape.
    { id: 3, name: 'Card', day: '2026-10-22', networks: ['instagram', 'x'], picture: { ...photo(13, { portrait: TAG, landscape: TAG }), source: 'card', cardRefused: true } },
    // No picture, no day, no platform: nothing.
    { id: 4, name: 'Words only', day: '2026-10-23', networks: ['x'], picture: null },
    { id: 5, name: 'Idea', day: null, networks: ['x'], picture: photo(15, { landscape: TAG }) },
    { id: 6, name: '', day: '2026-10-24', networks: [], picture: photo(16, { landscape: TAG }) },
    { id: 7, name: '🎉', day: '2026-10-24', networks: ['x', 'nowhere'], picture: photo(17, { landscape: TAG }) },
  ]);
  assert.deepEqual(plan.files.map((file) => [file.postId, file.shape, file.stem]), [
    [1, 'portrait', '2026-10-21-yeni-kupalar-instagram-facebook'],
    [1, 'landscape', '2026-10-21-yeni-kupalar-x'],
    [2, 'portrait', '2026-10-22-tea-set-instagram'],
    [7, 'landscape', '2026-10-24-post-7-x'],
  ]);
  assert.equal(plan.files[0].address, `/api/pictures/11/file?shape=portrait&v=${TAG}`);
  assert.deepEqual(plan.notReady, [{ id: 2, name: 'Tea set', count: 1 }, { id: 3, name: 'Card', count: 2 }]);
  assert.equal(rules.missingCount(plan.notReady), 3);
  assert.deepEqual(rules.picturePlan([]), { files: [], notReady: [] });
});

test('Save all pictures rests with no kept copy and past the files one zip holds', () => {
  const files = (count) => ({ files: Array.from({ length: count }, (_, index) => ({ postId: index })) });
  assert.equal(rules.saveAllRest(files(0)), 'week.saveAllNone');
  assert.equal(rules.saveAllRest(files(1)), null);
  assert.equal(rules.saveAllRest(files(ZIP_LIMITS.files)), null);
  assert.equal(rules.saveAllRest(files(ZIP_LIMITS.files + 1)), 'week.tooMany');
  assert.equal(rules.notReadyKey(1), 'week.notReady.one');
  assert.equal(rules.notReadyKey(2), 'week.notReady.many');
  assert.equal(rules.notReadyKey(0), 'week.notReady.many');
});

test('the pictures are fetched at most three at a time, in order, and each one that fails names its post', async () => {
  const files = Array.from({ length: 8 }, (_, index) => ({ postId: index < 6 ? index + 1 : 6, address: `/p/${index}`, stem: `day-post-${index}` }));
  let waiting = 0;
  let most = 0;
  const answers = {
    '/p/1': () => ({ ok: false, type: null, bytes: null }),
    '/p/2': () => { throw new Error('gone'); },
    '/p/3': () => ({ ok: true, type: 'text/html', bytes: new Uint8Array([1]) }),
    '/p/4': () => ({ ok: true, type: 'image/webp', bytes: new Uint8Array(0) }),
    '/p/7': () => ({ ok: false, type: null, bytes: null }),
  };
  const fetchFile = async (address) => {
    waiting += 1;
    most = Math.max(most, waiting);
    try {
      await new Promise((resolve) => setTimeout(resolve, address === '/p/0' ? 20 : 2));
      return (answers[address] ?? (() => ({ ok: true, type: address === '/p/5' ? 'image/jpeg' : 'image/webp', bytes: new Uint8Array([7]) })))();
    } finally {
      waiting -= 1;
    }
  };
  const got = await rules.collectPictures(files, fetchFile);
  assert.equal(most, rules.AT_ONCE);
  assert.deepEqual(got.ready.map((item) => item.name), ['day-post-0.webp', 'day-post-5.jpg', 'day-post-6.webp']);
  assert.deepEqual(got.failed, [{ postId: 2, count: 1 }, { postId: 3, count: 1 }, { postId: 4, count: 1 }, { postId: 5, count: 1 }, { postId: 6, count: 1 }]);
  assert.deepEqual(rules.joinNotReady([{ id: 6, name: 'Six', count: 1 }], got.failed, [{ id: 2, name: 'Two' }]).map((item) => [item.id, item.name, item.count]),
    [[6, 'Six', 2], [2, 'Two', 1], [3, '', 1], [4, '', 1], [5, '', 1]]);
  assert.deepEqual(await rules.collectPictures([], fetchFile), { ready: [], failed: [] });
});

test('one press\'s zip holds each picture once under its plain name, and unpacks to the same bytes', async () => {
  const plan = rules.picturePlan([
    { id: 1, name: 'Çay seti', day: '2026-10-21', networks: ['instagram', 'threads', 'x'], picture: photo(11, { portrait: TAG, landscape: TAG }) },
    { id: 2, name: 'Çay seti', day: '2026-10-21', networks: ['instagram', 'threads'], picture: photo(12, { portrait: TAG }) },
  ]);
  const bytes = new Map(plan.files.map((file, index) => [file.address, new Uint8Array([index, 1, 2, 3])]));
  const got = await rules.collectPictures(plan.files, async (address) => ({ ok: true, type: 'image/webp', bytes: bytes.get(address) }));
  const files = unzipStored(zipFiles(got.ready));
  // Two posts of the same name on the same day stay two files.
  assert.deepEqual(files.map((file) => file.name), ['2026-10-21-cay-seti-instagram-threads.webp', '2026-10-21-cay-seti-x.webp', '2026-10-21-cay-seti-instagram-threads (2).webp']);
  assert.ok(files.every((file) => /^[\x20-\x7e]+$/u.test(file.name)));
  assert.deepEqual(files.map((file) => [...file.bytes]), plan.files.map((file) => [...bytes.get(file.address)]));
});

/* ------------------------------------------------------------ the page's read */

test('the week page at its largest stays within Tellop\'s bounds, one call at a time, and saves nothing', async (t) => {
  await plan.saveProfileFor(OWNER, { networks: NETWORK_KEYS.join(','), businessName: 'ş'.repeat(LIMITS.profileField) });
  const at = new Date().toISOString();
  const longest = (count) => 'ş'.repeat(count);
  await modelAction('Theme', 'createMany', {
    data: Array.from({ length: plan.MOST_THEMES }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), about: longest(LIMITS.themeAbout), hashtags: longest(plan.THEME_HASHTAGS_MAX),
      colour: index % 5, position: index, archived: index >= LIMITS.themes, createdAt: at, updatedAt: at,
    })),
  });
  // A Monday-first week across two months (Monday 27 November 2034 to Sunday 3 December): one post more than a list holds.
  const week = ['2034-11-27', '2034-11-28', '2034-11-29', '2034-11-30', '2034-12-01', '2034-12-02', '2034-12-03'];
  await modelAction('Post', 'createMany', {
    data: Array.from({ length: posts.MOST_A_MONTH + 1 }, (_, index) => ({
      ownerId: OWNER, name: longest(LIMITS.name), mainText: longest(LIMITS.mainText), day: week[index % 7], time: index % 3 ? `${String(index % 24).padStart(2, '0')}:30` : null,
      createdAt: at, updatedAt: `${at}#week`,
    })),
  });
  const made = await modelAction('Post', 'findMany', { where: { ownerId: OWNER, updatedAt: `${at}#week` }, select: { id: true }, orderBy: { id: 'asc' }, take: 300 });
  assert.equal(made.length, posts.MOST_A_MONTH + 1);
  await modelAction('PostVersion', 'createMany', {
    data: made.flatMap((post) => NETWORK_KEYS.map((network) => ({ ownerId: OWNER, postId: post.id, network, text: longest(LIMITS.mainText), updatedAt: at }))),
  });
  const copies = Object.fromEntries(SHAPE_KEYS.map((key, index) => [`${key}File`, String(index + 1).padStart(64, 'f')]));
  await modelAction('PostPicture', 'createMany', {
    data: made.map((post) => ({ ownerId: OWNER, postId: post.id, source: 'photo', file: 'e'.repeat(64), chosen: true, position: 1, description: longest(LIMITS.description), createdAt: at, ...copies })),
  });
  const before = await modelAction('Post', 'count', { where: { ownerId: OWNER } });

  const run = await measured(() => readWeekPage({ owner: OWNER, query: { week: '2034-11-29' }, today: '2034-11-29', locale: 'tr' }));
  bounded(run, 'the week page at its largest', 10);
  assert.equal(mostInFlight(run), 1, 'one records call at a time');
  const page = run.value;
  assert.equal(page.week.from, '2034-11-27');
  assert.equal(page.tiles.length, posts.MOST_A_MONTH);
  assert.equal(page.full, true);
  assert.equal(typeof page.profileLink, 'string', 'the profile link goes to the page, so its tracking leaves it as written');
  assert.ok(page.tiles.every((tile) => week.includes(tile.day) && tile.networks.length === NETWORK_KEYS.length && tile.picture?.shapes?.portrait));
  assert.equal(await modelAction('Post', 'count', { where: { ownerId: OWNER } }), before, 'reading saved nothing');
  // The plan of Save all pictures for that week: every post's every shape, past one zip's files, so it rests.
  const pictures = rules.picturePlan(page.tiles.map((tile) => rules.weekPost(tile, null, page.networks, page.now)));
  assert.equal(pictures.notReady.length, 0);
  assert.equal(rules.saveAllRest(pictures), 'week.tooMany');
  const planCalls = run.calls.filter((call) => /Profile|Theme/u.test(call.what)).length;
  t.diagnostic(`the week page at its largest: ${run.calls.length} calls (the plan ${planCalls}), largest ${Math.max(...run.calls.map((call) => call.bytes))} bytes`);

  // An empty week reads the plan and one list call.
  const empty = await measured(() => readWeekPage({ owner: OWNER, query: { week: '2034-01-02' }, today: '2034-11-29', locale: 'tr' }));
  bounded(empty, 'an empty week', 11);
  t.diagnostic(`an empty week: ${empty.calls.length} calls`);
  assert.equal(empty.value.tiles.length, 0);
  assert.equal(empty.value.full, false);
});

// --- swipe sets on the week ---------------------------------------------------------

/** A words picture in a swipe set at `slide`, a tip or a plain one. */
const slideWords = (id, slide, layout = 'words') => ({ id, postId: 1, source: 'words', chosen: slide === 1, position: slide, slide, story: null, layout, words: `Slide ${slide}`, original: null, shapes: Object.fromEntries(SHAPE_KEYS.map((key) => [key, null])) });

test('a platform that takes a set saves the post’s swipe set, as many as it takes; one picture a post saves the cover', () => {
  const slides = [photo(21, { portrait: TAG, landscape: TAG, square: TAG }), slideWords(22, 2, 'tip'), slideWords(23, 3), slideWords(24, 4, 'tip'), slideWords(25, 5)];
  slides[0] = { ...slides[0], slide: 1 };
  const lines = rules.platformLines({
    post: { id: 1, day: '2031-03-14', time: '10:00' },
    versions: [],
    picture: slides[0],
    networks: ['instagram', 'x', 'whatsapp', 'linkedin'],
    now: Date.parse('2031-03-01T00:00:00Z'),
    slides,
  });
  assert.deepEqual(lines.map((line) => [line.network, line.picture, line.set?.length ?? null]), [['instagram', 'set', 5], ['x', 'set', 4], ['whatsapp', 'file', null], ['linkedin', 'set', 5]]);
  assert.deepEqual(lines[1].set.map((picture) => picture.id), [21, 22, 23, 24], 'X takes the first four, in the set’s order');
  // A set of one is not a set: the cover alone, as before.
  const one = rules.platformLines({ post: { id: 1, day: '2031-03-14', time: null }, versions: [], picture: slides[0], networks: ['instagram'], now: 0, slides: [slides[0]] });
  assert.equal(one[0].picture, 'file');
  // Before the record is read a post has no set.
  assert.deepEqual(rules.weekPost({ id: 1, name: 'A', day: '2031-03-14', time: null, themeId: null, state: 'draft', networks: ['x'], picture: null }, null, ['x'], 0).slides, []);
  const full = { post: { id: 1, name: 'A', day: '2031-03-14', time: null, mainText: '' }, versions: [], pictures: [slides[2], slides[0], slides[1]] };
  assert.deepEqual(rules.weekPost({ id: 1, name: 'A', day: '2031-03-14', time: null, themeId: null, state: 'draft', networks: ['x'], picture: null }, full, ['x'], 0).slides.map((picture) => picture.id), [21, 22, 23]);
});

test('Save all pictures puts each set platform’s slides in the zip, drawing words pictures with their tip’s place', async () => {
  const cover = { ...photo(31, { portrait: TAG, square: TAG }), slide: 1 };
  const kept = { ...photo(34, { portrait: TAG }), chosen: false, slide: 4 };
  const slides = [cover, slideWords(32, 2, 'tip'), slideWords(33, 3, 'tip'), kept];
  const plan = rules.picturePlan([
    { id: 1, name: 'Beş ipucu', day: '2031-03-14', themeId: 7, networks: ['instagram', 'x', 'whatsapp'], picture: cover, slides },
  ]);
  assert.deepEqual(plan.files.map((file) => file.stem), [
    '2031-03-14-bes-ipucu-instagram-1', '2031-03-14-bes-ipucu-instagram-2', '2031-03-14-bes-ipucu-instagram-3', '2031-03-14-bes-ipucu-instagram-4',
    '2031-03-14-bes-ipucu-x-2', '2031-03-14-bes-ipucu-x-3',
    '2031-03-14-bes-ipucu-whatsapp',
  ]);
  // Words pictures are drawn, with their place among the set's tips and the post's theme; others are kept copies.
  assert.deepEqual(plan.files.slice(0, 4).map((file) => (file.draw ? ['draw', file.draw.picture.id, file.draw.place, file.draw.themeId] : ['file', file.address])), [
    ['file', `/api/pictures/31/file?shape=portrait&v=${TAG}`], ['draw', 32, 1, 7], ['draw', 33, 2, 7], ['file', `/api/pictures/34/file?shape=portrait&v=${TAG}`],
  ]);
  // X's landscape copies of the photos are not kept yet: listed as not ready, the drawn ones still go.
  assert.deepEqual(plan.notReady, [{ id: 1, name: 'Beş ipucu', count: 2 }]);
  assert.equal(plan.files.filter((file) => file.stem.includes('-x-')).length, 2);

  const drawn = [];
  const got = await rules.collectPictures(plan.files, async () => ({ ok: true, type: 'image/jpeg', bytes: new Uint8Array([1]) }), rules.AT_ONCE, async (draw) => {
    drawn.push(draw.picture.id);
    return { ok: true, type: 'image/webp', bytes: new Uint8Array([2]) };
  });
  assert.equal(got.ready.length, plan.files.length);
  assert.deepEqual(drawn.sort(), [32, 32, 33, 33]);
  assert.ok(got.ready.some((file) => file.name === '2031-03-14-bes-ipucu-instagram-2.webp'));
  // With no drawing at hand, a words picture counts as not ready for its post.
  const plain = await rules.collectPictures(plan.files, async () => ({ ok: true, type: 'image/jpeg', bytes: new Uint8Array([1]) }));
  assert.deepEqual(plain.failed, [{ postId: 1, count: 4 }]);
  // A story set is never part of the week.
  const story = [{ ...slideWords(41, 1), slide: null, story: 1 }, { ...slideWords(42, 2), slide: null, story: 2 }];
  assert.deepEqual(rules.picturePlan([{ id: 2, name: 'S', day: '2031-03-14', networks: ['instagram'], picture: null, slides: [], stories: story }]), { files: [], notReady: [] });
});

test('a picture kept on the way replaces the one the record held; one it does not hold changes nothing', () => {
  const full = { post: { id: 1 }, versions: [], pictures: [photo(1), photo(2)] };
  const kept = photo(2, { portrait: TAG });
  assert.deepEqual(rules.withPicture(full, kept).pictures.map((picture) => picture.shapes.portrait), [null, TAG]);
  assert.equal(rules.withPicture(full, photo(3)), full);
  assert.equal(rules.withPicture(full, null), full);
});
