/**
 * The rules the app keeps in code: networks, shapes, civil days, limits, a
 * post's state, how a network counts, fitting words, the preview's checks,
 * share addresses, comma-separated text and the clear mask. Each boundary is
 * tested on it and one each side.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateSync } from 'node:zlib';

import { CHECKS, checksFor, mustFixOf, wordsChecks } from '../lib/plan/checks.js';
import { MASK_HEIGHT, MASK_WIDTH, clearMask } from '../lib/plan/clear-mask.js';
import { X_LINK_WEIGHT, countFor, countForX, countGraphemes, findAddresses, graphemesOf, joinWords } from '../lib/plan/count.js';
import { CSV_BOM, csvCell, csvText } from '../lib/plan/csv.js';
import {
  FIRST_YEAR,
  LAST_YEAR,
  addDays,
  addMonths,
  civilDay,
  daysInMonth,
  isCivilDay,
  isCivilMonth,
  isClockTime,
  monthGrid,
  monthOf,
  partsOf,
  todayCivil,
  weekDays,
  weekStart,
  weekdayOf,
} from '../lib/plan/days.js';
import { fitWords, normaliseHashtags, removeAddresses, splitHashtags } from '../lib/plan/fit.js';
import { BYTES_A_LETTER, cutText, LIMITS, LIMIT_REFUSALS, readCount, readLink, readWords, wireBytes } from '../lib/plan/limits.js';
import { clipText } from '../lib/plan/ai-words.js';
import { changedScene, SCENE_MOST } from '../lib/plan/ai-picture.js';
import {
  NETWORKS,
  NETWORK_KEYS,
  TELEGRAM_CAPTION_LIMIT,
  YOUTUBE_TITLE_LIMIT,
  formatNetworkList,
  isNetworkKey,
  networkByKey,
  parseNetworkList,
} from '../lib/plan/networks.js';
import { SHARE_ADDRESS_MOST, shareFor, sharedWords } from '../lib/plan/share.js';
import { FITS, SHAPES, SHAPE_KEYS, fillCut, fitFor, fitPlace, isShapeKey } from '../lib/plan/shapes.js';
import { postState } from '../lib/plan/state.js';

const PICTURE = { width: 1536, height: 1024 };
const tags = (count, prefix = 'tag') => Array.from({ length: count }, (_, index) => `#${prefix}${String.fromCharCode(97 + (index % 26))}${'x'.repeat(Math.floor(index / 26))}`);
/** An `https:` link of exactly `length` characters. */
const linkOf = (length) => `https://a.com/${'a'.repeat(length - 'https://a.com/'.length)}`;
const keysOf = (checks) => checks.map((check) => check.key);

// ---- networks ----

test('networks: twelve known networks, each with a whole set of rules', () => {
  assert.equal(NETWORKS.length, 12);
  assert.deepEqual([...NETWORK_KEYS], ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'bluesky', 'tiktok', 'youtube', 'pinterest', 'whatsapp', 'telegram', 'google']);
  for (const item of NETWORKS) {
    assert.ok(Object.isFrozen(item), item.key);
    assert.ok(Number.isInteger(item.limit) && item.limit > 0, item.key);
    assert.ok(['graphemes', 'x'].includes(item.counting), item.key);
    assert.ok(['pressable', 'not-pressable', 'one'].includes(item.links), item.key);
    assert.ok([null, 'picture', 'video'].includes(item.needs), item.key);
    assert.ok(['text', 'link', 'site'].includes(item.share), item.key);
    assert.ok(isShapeKey(item.shape) && item.shapes.includes(item.shape), item.key);
    assert.ok(item.shapes.every(isShapeKey), item.key);
    assert.ok(item.hashtagAdvice[0] <= item.hashtagAdvice[1], item.key);
    assert.ok(item.hashtagMost === null || item.hashtagAdvice[1] <= item.hashtagMost, item.key);
    const site = new URL(item.site);
    assert.equal(site.protocol, 'https:', item.key);
    assert.equal(site.port, '', item.key);
  }
  assert.equal(TELEGRAM_CAPTION_LIMIT, 1024);
  assert.equal(YOUTUBE_TITLE_LIMIT, 100);
});

test('networks: keys are read and listed as known keys only', () => {
  assert.equal(networkByKey('x')?.limit, 280);
  assert.equal(networkByKey('myspace'), null);
  assert.equal(networkByKey(7), null);
  assert.equal(isNetworkKey('instagram'), true);
  assert.equal(isNetworkKey('Instagram'), false);
  assert.equal(isNetworkKey(null), false);
  assert.deepEqual(parseNetworkList('instagram, x,myspace,x,,whatsapp'), ['instagram', 'x', 'whatsapp']);
  assert.deepEqual(parseNetworkList(''), []);
  assert.deepEqual(parseNetworkList(null), []);
  assert.equal(formatNetworkList(['x', 'instagram']), 'x,instagram');
  assert.equal(formatNetworkList([]), '');
  assert.equal(formatNetworkList(['x', 'x']), null);
  assert.equal(formatNetworkList(['x', 'myspace']), null);
  assert.equal(formatNetworkList('x'), null);
  assert.equal(formatNetworkList([...NETWORK_KEYS]), NETWORK_KEYS.join(','), 'every network at once is allowed');
  assert.equal(formatNetworkList([...NETWORK_KEYS, 'x']), null, 'one more than every network is refused');
});

// ---- shapes ----

test('shapes: seven shapes with their sizes and fields', () => {
  assert.deepEqual([...SHAPE_KEYS], ['square', 'portrait', 'story', 'wide', 'landscape', 'tall', 'gbp']);
  assert.deepEqual([SHAPES.square.width, SHAPES.square.height], [1080, 1080]);
  assert.deepEqual([SHAPES.portrait.width, SHAPES.portrait.height], [1080, 1350]);
  assert.deepEqual([SHAPES.story.width, SHAPES.story.height], [1080, 1920]);
  assert.deepEqual([SHAPES.wide.width, SHAPES.wide.height], [1200, 628]);
  assert.deepEqual([SHAPES.landscape.width, SHAPES.landscape.height], [1600, 900]);
  assert.deepEqual([SHAPES.tall.width, SHAPES.tall.height], [1000, 1500]);
  assert.deepEqual([SHAPES.gbp.width, SHAPES.gbp.height], [1200, 900]);
  for (const key of SHAPE_KEYS) assert.equal(SHAPES[key].field, `${key}File`);
  assert.equal(isShapeKey('toString'), false);
  assert.deepEqual([...FITS], ['auto', 'fill', 'fit']);
});

test('shapes: auto fits the tall shapes and fills the rest; a stored choice wins', () => {
  for (const key of SHAPE_KEYS) {
    assert.equal(fitFor('auto', key), key === 'story' || key === 'tall' ? 'fit' : 'fill', key);
    assert.equal(fitFor('fill', key), 'fill');
    assert.equal(fitFor('fit', key), 'fit');
  }
  assert.equal(fitFor(undefined, 'square'), 'fill');
});

test('shapes: a 1536x1024 picture cut into each shape, focus at 0, the middle and 1', () => {
  for (const key of SHAPE_KEYS) {
    const target = SHAPES[key].width / SHAPES[key].height;
    const start = fillCut({ ...PICTURE, focusX: 0, focusY: 0 }, key);
    const middle = fillCut({ ...PICTURE, focusX: 0.5, focusY: 0.5 }, key);
    const end = fillCut({ ...PICTURE, focusX: 1, focusY: 1 }, key);
    for (const cut of [start, middle, end]) {
      assert.ok(cut.x >= 0 && cut.y >= 0 && cut.x + cut.width <= PICTURE.width && cut.y + cut.height <= PICTURE.height, key);
      assert.ok(cut.width === PICTURE.width || cut.height === PICTURE.height, `${key}: the largest cut touches two edges`);
      assert.ok(Math.abs(cut.width / cut.height - target) < 0.002, `${key}: the shape's proportions`);
    }
    assert.deepEqual([start.x, start.y], [0, 0], `${key}: focus 0 keeps the first edge`);
    assert.equal(end.x + end.width, PICTURE.width, `${key}: focus 1 keeps the last edge`);
    assert.equal(end.y + end.height, PICTURE.height, `${key}: focus 1 keeps the last edge`);
  }
  assert.deepEqual(fillCut({ ...PICTURE, focusX: 0.5, focusY: 0.5 }, 'square'), { x: 256, y: 0, width: 1024, height: 1024 });
  assert.deepEqual(fillCut({ ...PICTURE, focusX: 1, focusY: 0.5 }, 'story'), { x: 960, y: 0, width: 576, height: 1024 });
  assert.deepEqual(fillCut({ ...PICTURE, focusX: 0.5, focusY: 0.5 }, 'wide'), { x: 0, y: 110, width: 1536, height: 804 });
  assert.deepEqual(fillCut({ ...PICTURE, focusX: 0.5, focusY: 1 }, 'landscape'), { x: 0, y: 160, width: 1536, height: 864 });
  assert.deepEqual(fillCut(PICTURE, 'square'), { x: 256, y: 0, width: 1024, height: 1024 }, 'no focus is the middle');
  assert.deepEqual(fillCut({ ...PICTURE, focusX: Number.NaN, focusY: 5 }, 'square'), { x: 256, y: 0, width: 1024, height: 1024 }, 'a broken focus reads as the middle or the edge');
  assert.equal(fillCut(PICTURE, 'circle'), null);
  assert.equal(fillCut({ width: 0, height: 10 }, 'square'), null);
  assert.equal(fillCut({ width: 10.5, height: 10 }, 'square'), null);
});

test('shapes: a 1536x1024 picture fitted into each shape, whole and in the middle', () => {
  for (const key of SHAPE_KEYS) {
    const place = fitPlace(PICTURE, key);
    const { width, height } = SHAPES[key];
    assert.ok(place.width <= width && place.height <= height, key);
    assert.ok(place.width === width || place.height === height, `${key}: as large as fits`);
    assert.ok(Math.abs(place.width / place.height - 1.5) < 0.01, `${key}: the picture's own proportions`);
    assert.ok(Math.abs(place.x * 2 + place.width - width) <= 1 && Math.abs(place.y * 2 + place.height - height) <= 1, `${key}: in the middle`);
  }
  assert.deepEqual(fitPlace(PICTURE, 'square'), { x: 0, y: 180, width: 1080, height: 720 });
  assert.deepEqual(fitPlace(PICTURE, 'story'), { x: 0, y: 600, width: 1080, height: 720 });
  assert.deepEqual(fitPlace(PICTURE, 'landscape'), { x: 125, y: 0, width: 1350, height: 900 });
  assert.equal(fitPlace(PICTURE, 'circle'), null);
  assert.equal(fitPlace({ width: 1, height: 0 }, 'square'), null);
});

// ---- civil days ----

test('days: the month grid of October 2026 for both week starts', () => {
  const sundayFirst = monthGrid('2026-10', false);
  assert.equal(sundayFirst.length, 35);
  assert.equal(sundayFirst[0].day, '2026-09-27');
  assert.equal(sundayFirst.at(-1).day, '2026-10-31');
  assert.equal(weekdayOf(sundayFirst[0].day), 0);
  assert.equal(sundayFirst.filter((cell) => cell.inMonth).length, 31);
  assert.deepEqual(sundayFirst.slice(0, 5).map((cell) => cell.inMonth), [false, false, false, false, true]);

  const mondayFirst = monthGrid('2026-10', true);
  assert.equal(mondayFirst.length, 35);
  assert.equal(mondayFirst[0].day, '2026-09-28');
  assert.equal(mondayFirst.at(-1).day, '2026-11-01');
  assert.equal(weekdayOf(mondayFirst[0].day), 1);
  assert.equal(mondayFirst.filter((cell) => cell.inMonth).length, 31);
  assert.equal(mondayFirst.at(-1).inMonth, false);

  for (const grid of [sundayFirst, mondayFirst]) {
    for (let index = 1; index < grid.length; index += 1) assert.equal(grid[index].day, addDays(grid[index - 1].day, 1));
  }
});

test('days: a month that fills whole weeks exactly, and a six-week month', () => {
  // February 2027 starts on a Monday and ends on a Sunday.
  const february = monthGrid('2027-02', true);
  assert.equal(february.length, 28);
  assert.ok(february.every((cell) => cell.inMonth));
  assert.equal(monthGrid('2027-02', false).length, 35);
  // August 2026 starts on a Saturday: six weeks with Sunday first.
  assert.equal(monthGrid('2026-08', false).length, 42);
  assert.equal(monthGrid('2026-08', true).length, 42);
});

test('days: leap days and the years the app knows', () => {
  assert.equal(FIRST_YEAR, 2000);
  assert.equal(LAST_YEAR, 2199);
  assert.equal(isCivilDay('2028-02-29'), true);
  assert.equal(isCivilDay('2026-02-29'), false);
  assert.equal(isCivilDay('2026-02-28'), true);
  assert.equal(isCivilDay('2000-02-29'), true, '2000 is a leap year');
  assert.equal(isCivilDay('2100-02-29'), false, '2100 is not');
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(isCivilDay('2000-01-01'), true);
  assert.equal(isCivilDay('1999-12-31'), false);
  assert.equal(isCivilDay('2199-12-31'), true);
  assert.equal(isCivilDay('2200-01-01'), false);
  assert.equal(isCivilMonth('2000-01'), true);
  assert.equal(isCivilMonth('1999-12'), false);
  assert.equal(isCivilMonth('2199-12'), true);
  assert.equal(isCivilMonth('2200-01'), false);
  assert.equal(isCivilMonth('2026-00'), false);
  assert.equal(isCivilMonth('2026-13'), false);
  assert.equal(isCivilDay('2026-10-32'), false);
  assert.equal(isCivilDay('2026-10-00'), false);
  assert.equal(isCivilDay('2026-1-01'), false);
  assert.equal(isCivilDay(20261021), false);
  assert.equal(monthGrid('2000-01', true)[0].day, '1999-12-27', 'a grid may draw a day before the first year');
  assert.equal(monthGrid('2199-12', false).at(-1).day, '2200-01-04', 'and after the last');
});

test('days: moving by days, weeks and months, across a year', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-10-21', 0), '2026-10-21');
  assert.equal(weekdayOf('2026-10-21'), 3);
  assert.equal(weekStart('2026-10-25', true), '2026-10-19', 'a Sunday ends a Monday-first week');
  assert.equal(weekStart('2026-10-25', false), '2026-10-25', 'and starts a Sunday-first one');
  assert.equal(weekStart('2026-10-26', true), '2026-10-26');
  assert.deepEqual(weekDays('2026-12-31', true), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-10', 0), '2026-10');
  assert.equal(addMonths('2026-10', 15), '2028-01');
  assert.equal(monthOf('2026-10-21'), '2026-10');
  assert.equal(civilDay(2026, 1, 2), '2026-01-02');
  assert.deepEqual(partsOf('2026-10-21'), { year: 2026, month: 10, day: 21 });
  assert.equal(todayCivil(new Date(2026, 9, 21, 23, 59)), '2026-10-21');
  assert.equal(todayCivil(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  assert.equal(isClockTime('00:00'), true);
  assert.equal(isClockTime('23:59'), true);
  assert.equal(isClockTime('24:00'), false);
  assert.equal(isClockTime('12:60'), false);
  assert.equal(isClockTime('9:00'), false);
});

// ---- limits ----

test('limits: words at the most, one under and one over', () => {
  const max = LIMITS.name;
  assert.deepEqual(readWords('a'.repeat(max), max), { ok: true, value: 'a'.repeat(max) });
  assert.deepEqual(readWords('a'.repeat(max - 1), max), { ok: true, value: 'a'.repeat(max - 1) });
  assert.deepEqual(readWords('a'.repeat(max + 1), max), { ok: false, problem: LIMIT_REFUSALS.long });
  assert.deepEqual(readWords('ğ'.repeat(max), max).ok, true, 'Turkish letters count one each');
  assert.deepEqual(readWords(`  ${'a'.repeat(max)}  `, max).ok, true, 'spaces at the ends do not count');
  assert.deepEqual(readWords(undefined, max), { ok: true, value: '' });
  assert.deepEqual(readWords(undefined, max, { required: true }), { ok: false, problem: LIMIT_REFUSALS.missing });
  assert.deepEqual(readWords('   ', max, { required: true }), { ok: false, problem: LIMIT_REFUSALS.missing });
  assert.deepEqual(readWords(5, max), { ok: false, problem: LIMIT_REFUSALS.missing });
  assert.deepEqual(readWords('one\r\ntwo', max), { ok: true, value: 'one two' });
  assert.deepEqual(readWords('one\r\ntwo\rthree', max, { multiline: true }), { ok: true, value: 'one\ntwo\nthree' });
  assert.deepEqual(readWords('a\u0000b\u0007c', max), { ok: true, value: 'abc' });
});

test('limits: a link at the most, one under and one over; https only', () => {
  assert.equal(LIMITS.link, 500);
  assert.deepEqual(readLink(linkOf(500)), { ok: true, value: linkOf(500) });
  assert.deepEqual(readLink(linkOf(499)), { ok: true, value: linkOf(499) });
  assert.deepEqual(readLink(linkOf(501)), { ok: false, problem: LIMIT_REFUSALS.long });
  assert.deepEqual(readLink(''), { ok: true, value: '' });
  assert.deepEqual(readLink(undefined), { ok: true, value: '' });
  assert.deepEqual(readLink('https://Example.com'), { ok: true, value: 'https://example.com/' });
  assert.deepEqual(readLink('http://example.com'), { ok: false, problem: LIMIT_REFUSALS.link });
  assert.deepEqual(readLink('javascript:alert(1)'), { ok: false, problem: LIMIT_REFUSALS.link });
  assert.deepEqual(readLink(['https://name', 'pw@example.com'].join(':')), { ok: false, problem: LIMIT_REFUSALS.link });
  assert.deepEqual(readLink('example.com'), { ok: false, problem: LIMIT_REFUSALS.link });
});

test('limits: a count at 0 and the most, and one past each', () => {
  assert.deepEqual(readCount(0, 10), { ok: true, value: 0 });
  assert.deepEqual(readCount(10, 10), { ok: true, value: 10 });
  assert.deepEqual(readCount(9, 10), { ok: true, value: 9 });
  assert.deepEqual(readCount(11, 10), { ok: false, problem: LIMIT_REFUSALS.number });
  assert.deepEqual(readCount(-1, 10), { ok: false, problem: LIMIT_REFUSALS.number });
  assert.deepEqual(readCount(1.5, 10), { ok: false, problem: LIMIT_REFUSALS.number });
  assert.deepEqual(readCount('5', 10), { ok: false, problem: LIMIT_REFUSALS.number });
  assert.deepEqual(readCount('', 10), { ok: true, value: null });
  assert.deepEqual(readCount(null, 10), { ok: true, value: null });
  assert.deepEqual(readCount(LIMITS.result, LIMITS.result), { ok: true, value: LIMITS.result });
  assert.deepEqual(readCount(LIMITS.result + 1, LIMITS.result), { ok: false, problem: LIMIT_REFUSALS.number });
});

// ---- a post's state ----

test('state: each state a post can be in', () => {
  const networks = ['instagram', 'x'];
  const words = (network, extra = {}) => ({ network, text: 'Words', ...extra });
  assert.deepEqual(postState({ networks, versions: [], hasChosenPicture: false }), { state: 'idea', shared: 0, scheduled: 0, of: 2, networks });
  assert.equal(postState({ networks, versions: [words('x')], hasChosenPicture: true }).state, 'draft', 'one network still has no words');
  assert.equal(postState({ networks, versions: [words('x'), words('instagram')], hasChosenPicture: false }).state, 'draft', 'Instagram needs a picture');
  assert.equal(postState({ networks, versions: [words('x'), words('instagram')], hasChosenPicture: true }).state, 'ready');
  assert.equal(postState({ networks: ['x'], versions: [words('x')], hasChosenPicture: false }).state, 'ready', 'X needs no picture');
  assert.deepEqual(
    postState({ networks, versions: [words('x', { sharedAt: '2026-10-21T10:00:00.000Z' }), words('instagram')], hasChosenPicture: true }),
    { state: 'partly', shared: 1, scheduled: 0, of: 2, networks },
  );
  assert.deepEqual(
    postState({ networks, versions: [words('x', { sharedAt: '2026-10-21T10:00:00.000Z' }), words('instagram', { sharedAt: '2026-10-21T11:00:00.000Z' })], hasChosenPicture: true }),
    { state: 'shared', shared: 2, scheduled: 0, of: 2, networks },
  );
  assert.deepEqual(
    postState({ networks, versions: [words('x'), { network: 'instagram', on: false }], hasChosenPicture: false }),
    { state: 'ready', shared: 0, scheduled: 0, of: 1, networks: ['x'] },
    'a switched-off network is not counted',
  );
  assert.equal(postState({ networks: [], versions: [], hasChosenPicture: false }).state, 'idea');
  assert.equal(postState({ networks: [], versions: [], hasChosenPicture: false, mainText: 'Something' }).state, 'draft');
  assert.equal(postState({ networks: ['myspace'], versions: [], hasChosenPicture: false }).of, 0, 'an unknown network is not counted');
  assert.equal(postState({ networks, versions: [words('x', { text: '   ' })], hasChosenPicture: false }).state, 'idea', 'spaces are not words');
});

test('state: words with a must-fix check keep the post a draft, by the check that fits its picture', () => {
  const networks = ['x', 'telegram'];
  const words = (network, extra = {}) => ({ network, text: 'Words', ...extra });
  const state = (versions, hasChosenPicture = false) => postState({ networks, versions, hasChosenPicture }).state;
  assert.equal(state([words('x'), words('telegram')]), 'ready');
  assert.equal(state([words('x', { mustFix: true, mustFixWithPicture: true }), words('telegram')]), 'draft');
  assert.equal(state([words('x', { mustFix: true, mustFixWithPicture: true }), words('telegram', { mustFix: true, mustFixWithPicture: true })]), 'draft', 'words everywhere, each held back: still a draft, never an idea');
  assert.equal(state([words('x'), words('telegram', { mustFix: false, mustFixWithPicture: true })]), 'ready', 'no picture: the check without one');
  assert.equal(state([words('x'), words('telegram', { mustFix: false, mustFixWithPicture: true })], true), 'draft', 'a chosen picture: the check with one');
  assert.equal(state([words('x'), words('telegram', { mustFix: true })], true), 'draft', 'a version that names only the one check');
  assert.equal(state([words('x', { on: false, mustFix: true }), words('telegram')]), 'ready', 'a switched-off network is not counted');
  assert.equal(state([words('x', { sharedAt: '2026-10-21T10:00:00.000Z', mustFix: true }), words('telegram')]), 'partly', 'sharing comes first');
  // The post maker works the checks out from the words it holds: the same states.
  const live = (versions, hasChosenPicture = false) => state(versions.map((item) => ({ ...item, ...mustFixOf(item) })), hasChosenPicture);
  assert.equal(live([words('x', { text: 'a'.repeat(280) }), words('telegram')]), 'ready');
  assert.equal(live([words('x', { text: 'a'.repeat(281) }), words('telegram')]), 'draft');
  assert.equal(live([words('x'), words('telegram', { text: 'a'.repeat(1025) })]), 'ready');
  assert.equal(live([words('x'), words('telegram', { text: 'a'.repeat(1025) })], true), 'draft');
});

// ---- count ----

test('count: graphemes count what a person sees as one character', () => {
  assert.equal(countGraphemes('abc'), 3);
  assert.equal(countGraphemes('İğışçö'), 6);
  assert.equal(countGraphemes('👨‍👩‍👧'), 1);
  assert.equal(countGraphemes('🇹🇷'), 1);
  assert.equal(countGraphemes('👍🏽'), 1);
  assert.equal(countGraphemes('e\u0301'), 1);
  assert.equal(countGraphemes(''), 0);
  assert.equal(countGraphemes(null), 0);
  assert.deepEqual(graphemesOf('a👍🏽b'), ['a', '👍🏽', 'b']);
  for (const item of NETWORKS.filter((network) => network.counting === 'graphemes')) {
    assert.equal(countFor(item.key, '👨‍👩‍👧 https://example.com/a/long/path'), 1 + 1 + 'https://example.com/a/long/path'.length, item.key);
  }
  assert.equal(countFor('myspace', 'abc'), 3, 'an unknown network counts graphemes');
  assert.equal(countFor('x', 42), 0);
});

test('count: X weighs addresses as 23 and wide characters as 2', () => {
  assert.equal(X_LINK_WEIGHT, 23);
  assert.equal(countFor('x', 'a'.repeat(280)), 280);
  assert.equal(countFor('x', 'İğış “quote” — dash'), 19, 'Latin Extended and general punctuation count 1');
  assert.equal(countFor('x', '日本語'), 6);
  assert.equal(countFor('x', '😀'), 2);
  assert.equal(countFor('x', '👍🏽'), 2, 'an emoji with a skin tone counts once');
  assert.equal(countFor('x', '👨‍👩‍👧'), 2, 'a family emoji counts once');
  assert.equal(countFor('x', '🇹🇷'), 2);
  assert.equal(countFor('x', '©'), 1);
  assert.equal(countFor('x', 'https://a.co'), 23, 'a short address counts 23');
  assert.equal(countFor('x', `https://example.com/${'p'.repeat(100)}`), 23, 'a long address counts 23');
  assert.equal(countFor('x', 'http://a.co'), 23);
  assert.equal(countFor('x', 'www.example.com'), 23);
  assert.equal(countFor('x', 'Go https://a.co.'), 3 + 23 + 1, 'the full stop after an address is not part of it');
  assert.equal(countFor('x', 'https://'), 8, 'a scheme alone is not an address');
  assert.equal(countForX(''), 0);
});

test('count: addresses are found with closing marks left out', () => {
  assert.deepEqual(findAddresses('See (https://a.com/x), or www.b.org!'), [
    { start: 5, end: 20, address: 'https://a.com/x' },
    { start: 26, end: 35, address: 'www.b.org' },
  ]);
  assert.deepEqual(findAddresses('no address here'), []);
  assert.deepEqual(findAddresses(undefined), []);
});

test('count: words and hashtags join with a blank line, either alone when the other is empty', () => {
  assert.equal(joinWords('Words', '#a #b'), 'Words\n\n#a #b');
  assert.equal(joinWords(' Words ', ''), 'Words');
  assert.equal(joinWords('', '#a'), '#a');
  assert.equal(joinWords(undefined, undefined), '');
});

// ---- fit ----

test('fit: hashtags at the end of a text split from the words', () => {
  assert.deepEqual(splitHashtags('Hello world.\n\n#mug #İstanbul'), { text: 'Hello world.', hashtags: ['#mug', '#İstanbul'] });
  assert.deepEqual(splitHashtags('Hello #mug world'), { text: 'Hello #mug world', hashtags: [] });
  assert.deepEqual(splitHashtags('We are #1'), { text: 'We are #1', hashtags: [] }, 'a number is not a hashtag');
  assert.deepEqual(splitHashtags('#only #tags'), { text: '', hashtags: ['#only', '#tags'] });
  assert.deepEqual(splitHashtags('Words #mug, #tea'), { text: 'Words #mug,', hashtags: ['#tea'] });
  assert.deepEqual(splitHashtags(''), { text: '', hashtags: [] });
  assert.deepEqual(splitHashtags(null), { text: '', hashtags: [] });
});

test('fit: hashtags are tidied, each once whatever its capitals, in their order', () => {
  assert.deepEqual(normaliseHashtags('#İstanbul #istanbul, ISTANBUL mug-painting #1 ##tea'), ['#İstanbul', '#mugpainting', '#tea']);
  assert.deepEqual(normaliseHashtags(['#Kahve', 'kahve', '#çay#ÇAY', 5]), ['#Kahve', '#çay']);
  assert.deepEqual(normaliseHashtags('#日本 #مرحبا #snake_case'), ['#日本', '#مرحبا', '#snake_case']);
  assert.deepEqual(normaliseHashtags(null), []);
  assert.deepEqual(normaliseHashtags(''), []);
});

test('fit: at most LIMITS.hashtags hashtags, each at most LIMITS.hashtagLength characters', () => {
  assert.equal(normaliseHashtags(tags(LIMITS.hashtags - 1)).length, LIMITS.hashtags - 1);
  assert.equal(normaliseHashtags(tags(LIMITS.hashtags)).length, LIMITS.hashtags);
  assert.deepEqual(normaliseHashtags(tags(LIMITS.hashtags + 1)), tags(LIMITS.hashtags), 'the first ones are kept');
  const atMost = `#${'a'.repeat(LIMITS.hashtagLength - 1)}`;
  assert.deepEqual(normaliseHashtags([atMost]), [atMost]);
  assert.deepEqual(normaliseHashtags([`#${'a'.repeat(LIMITS.hashtagLength - 2)}`]).length, 1);
  assert.deepEqual(normaliseHashtags([`#${'a'.repeat(LIMITS.hashtagLength)}`]), [], 'one over is left out');
});

test('fit: web addresses come out of the words, the spaces tidied', () => {
  assert.deepEqual(removeAddresses('Book at https://a.com/x today.'), { text: 'Book at today.', removed: 1 });
  assert.deepEqual(removeAddresses('Link: https://a.com.\n\n\n\nBye www.b.org'), { text: 'Link:.\n\nBye', removed: 2 });
  assert.deepEqual(removeAddresses('Nothing here'), { text: 'Nothing here', removed: 0 });
});

test('fit: words that fit are kept as they are', () => {
  const fitted = fitWords({ network: 'facebook', text: '  Come at https://a.com today.  ', hashtags: '#a #b #c #d' });
  assert.deepEqual(fitted, { text: 'Come at https://a.com today.', hashtags: '#a #b #c', cut: false }, 'Facebook keeps links; hashtags down to its advice of 3');
  assert.deepEqual(fitWords({ network: 'myspace', text: 'Hi', hashtags: '#a' }), { text: 'Hi', hashtags: '#a', cut: false });
});

test('fit: where links cannot be pressed, the link sentence takes the address’s place once', () => {
  const sentence = 'Link in profile.';
  assert.deepEqual(
    fitWords({ network: 'instagram', text: 'Come at https://a.com/x today. Bring a friend.', linkSentence: sentence }),
    { text: 'Come at today. Bring a friend. Link in profile.', hashtags: '', cut: false },
  );
  assert.equal(fitWords({ network: 'instagram', text: 'Bring a friend https://a.com', linkSentence: sentence }).text, 'Bring a friend\n\nLink in profile.', 'on its own after words with no sentence end');
  assert.equal(fitWords({ network: 'instagram', text: 'Come today. https://a.com https://b.com', linkSentence: sentence }).text, 'Come today. Link in profile.', 'once for two addresses');
  assert.equal(fitWords({ network: 'instagram', text: 'Come today. Link in profile. https://a.com', linkSentence: sentence }).text, 'Come today. Link in profile.', 'not twice');
  assert.equal(fitWords({ network: 'tiktok', text: 'Come today https://a.com', linkSentence: '' }).text, 'Come today', 'no sentence: the address just goes');
  assert.equal(fitWords({ network: 'instagram', text: 'Come today.', linkSentence: sentence }).text, 'Come today.', 'no address: no sentence');
  assert.equal(fitWords({ network: 'x', text: 'Come https://a.com', linkSentence: sentence }).text, 'Come https://a.com', 'X keeps links');
});

test('fit: hashtags go down to each network’s advice', () => {
  const six = tags(6).join(' ');
  for (const item of NETWORKS) {
    const fitted = fitWords({ network: item.key, text: 'Words.', hashtags: six });
    const kept = fitted.hashtags === '' ? [] : fitted.hashtags.split(' ');
    assert.deepEqual(kept, tags(6).slice(0, item.hashtagAdvice[1]), item.key);
  }
  assert.equal(fitWords({ network: 'whatsapp', text: 'Words.', hashtags: six }).hashtags, '');
  assert.equal(fitWords({ network: 'google', text: 'Words.', hashtags: six }).hashtags, '');
  assert.equal(fitWords({ network: 'instagram', text: 'Words.', hashtags: six }).hashtags.split(' ').length, 5);
});

test('fit: X words at its limit, one under and one over', () => {
  for (const [length, cut] of [[279, false], [280, false], [281, true]]) {
    const text = `${'a'.repeat(length - 7)} bbbbbb`;
    const fitted = fitWords({ network: 'x', text });
    assert.equal(fitted.cut, cut, `${length}`);
    assert.ok(countFor('x', fitted.text) <= 280, `${length}`);
    if (!cut) assert.equal(fitted.text, text);
    else assert.equal(fitted.text, 'a'.repeat(length - 7), 'cut at the last word that fits');
  }
  // Hashtags count with the words, joined by a blank line.
  const words = 'a'.repeat(270);
  assert.equal(fitWords({ network: 'x', text: words, hashtags: '#abcdefg' }).cut, false, '270 + 2 + 8 = 280');
  assert.equal(fitWords({ network: 'x', text: words, hashtags: '#abcdefgh' }).cut, true, '270 + 2 + 9 = 281');
});

test('fit: a cut ends at the last sentence end that fits, never with an ellipsis', () => {
  const text = `${'First sentence is here. '.repeat(8)}A last sentence that goes on and on ${'and on '.repeat(20)}until the end.`;
  const fitted = fitWords({ network: 'x', text, hashtags: '#mugs' });
  assert.equal(fitted.cut, true);
  assert.equal(fitted.hashtags, '#mugs', 'hashtags are kept whole');
  assert.ok(fitted.text.endsWith('here.'));
  assert.ok(!fitted.text.includes('…') && !fitted.text.endsWith('...'));
  assert.ok(text.startsWith(fitted.text));
  assert.ok(countFor('x', joinWords(fitted.text, fitted.hashtags)) <= 280);
  assert.equal(fitted.text, 'First sentence is here. '.repeat(8).trim(), 'every whole sentence that fits is kept');
  // A line's end is a sentence end too.
  const lines = `${'Line without a full stop\n'.repeat(15)}`;
  assert.equal(fitWords({ network: 'bluesky', text: lines }).text, 'Line without a full stop\n'.repeat(12).trim());
});

test('fit: a word cut leaves no comma hanging, and one long word is cut by characters', () => {
  const text = `${'word, '.repeat(60)}end`;
  const fitted = fitWords({ network: 'x', text });
  assert.ok(fitted.text.endsWith('word'));
  assert.ok(countFor('x', fitted.text) <= 280);
  const long = 'a'.repeat(300);
  assert.deepEqual(fitWords({ network: 'x', text: long }), { text: 'a'.repeat(280), hashtags: '', cut: true });
  const emoji = '😀'.repeat(141);
  assert.equal(fitWords({ network: 'x', text: emoji }).text, '😀'.repeat(140), 'an emoji is never split');
});

test('fit: Telegram takes a caption’s limit with a picture', () => {
  for (const [length, cut] of [[1023, false], [1024, false], [1025, true]]) {
    const text = 'a'.repeat(length);
    assert.equal(fitWords({ network: 'telegram', text, withPicture: true }).cut, cut, `${length} with a picture`);
    assert.equal(fitWords({ network: 'telegram', text, withPicture: false }).cut, false, `${length} without`);
  }
  assert.equal(fitWords({ network: 'telegram', text: 'a'.repeat(1025), withPicture: true }).text.length, 1024);
});

test('fit: every network’s fitted words are within its limit', () => {
  const text = `${'A sentence about mugs and clay at the studio. '.repeat(100)}https://example.com/book`.slice(0, LIMITS.versionText);
  for (const item of NETWORKS) {
    const fitted = fitWords({ network: item.key, text, hashtags: tags(6), linkSentence: 'Link in profile.' });
    assert.ok(countFor(item.key, joinWords(fitted.text, fitted.hashtags)) <= item.limit, item.key);
    assert.equal(fitted.cut, countFor(item.key, text) > item.limit, item.key);
    if (item.links === 'not-pressable') assert.ok(!fitted.text.includes('https://'), item.key);
  }
  assert.deepEqual(fitWords({ network: 'myspace', text: 'Hi' }), { text: 'Hi', hashtags: '', cut: false });
  assert.equal(fitWords({ network: 'telegram', text: 'a'.repeat(1100), withPicture: true }).cut, true);
});

// ---- checks ----

test('checks: X words at its limit, one under and one over', () => {
  for (const [length, over] of [[279, false], [280, false], [281, true]]) {
    const checks = checksFor({ network: 'x', text: 'a'.repeat(length) });
    assert.equal(keysOf(checks).includes('check.overLimit'), over, `${length}`);
  }
  assert.ok(keysOf(checksFor({ network: 'x', text: 'a'.repeat(270), hashtags: '#abcdefgh' })).includes('check.overLimit'), 'hashtags count with the words');
  assert.ok(!keysOf(checksFor({ network: 'x', text: 'a'.repeat(270), hashtags: '#abcdefg' })).includes('check.overLimit'));
  assert.ok(!keysOf(checksFor({ network: 'x', text: `${'a'.repeat(256)} https://example.com/${'p'.repeat(200)}` })).includes('check.overLimit'), 'an address counts 23');
});

test('checks: hashtags at the network’s most, one under and one over, counted in the words too', () => {
  for (const [count, over] of [[4, false], [5, false], [6, true]]) {
    const checks = checksFor({ network: 'instagram', text: 'Words', hashtags: tags(count).join(' '), chosenPicture: { description: 'A mug' } });
    assert.equal(keysOf(checks).includes('check.tooManyHashtags'), over, `${count}`);
  }
  assert.ok(keysOf(checksFor({ network: 'instagram', text: 'Words #one #two', hashtags: tags(4) })).includes('check.tooManyHashtags'), 'hashtags in the words count');
  assert.ok(!keysOf(checksFor({ network: 'instagram', text: 'Words #taga', hashtags: tags(5) })).includes('check.tooManyHashtags'), 'the same hashtag counts once');
  assert.ok(!keysOf(checksFor({ network: 'instagram', text: 'We are #1', hashtags: tags(5) })).includes('check.tooManyHashtags'), 'a number is not a hashtag');
  assert.ok(keysOf(checksFor({ network: 'threads', text: 'Words', hashtags: '#a #b' })).includes('check.tooManyHashtags'));
  assert.ok(!keysOf(checksFor({ network: 'threads', text: 'Words', hashtags: '#a' })).includes('check.tooManyHashtags'));
  assert.ok(!keysOf(checksFor({ network: 'facebook', text: 'Words', hashtags: tags(30) })).includes('check.tooManyHashtags'), 'no stated most');
});

test('checks: the words-only musts are the ones the records keep, with and without a picture', () => {
  assert.deepEqual(mustFixOf({ network: 'x', text: 'a'.repeat(280) }), { mustFix: false, mustFixWithPicture: false });
  assert.deepEqual(mustFixOf({ network: 'x', text: 'a'.repeat(281) }), { mustFix: true, mustFixWithPicture: true });
  assert.deepEqual(mustFixOf({ network: 'x', text: 'a'.repeat(275), hashtags: '#abc' }), { mustFix: true, mustFixWithPicture: true }, 'hashtags count with the words');
  for (const [length, without, under] of [[1023, false, false], [1024, false, false], [1025, false, true], [4096, false, true], [4097, true, true]]) {
    assert.deepEqual(mustFixOf({ network: 'telegram', text: 'a'.repeat(length) }), { mustFix: without, mustFixWithPicture: under }, `Telegram ${length}`);
  }
  assert.deepEqual(mustFixOf({ network: 'threads', text: 'Words', hashtags: '#a #b' }), { mustFix: true, mustFixWithPicture: true });
  assert.deepEqual(mustFixOf({ network: 'facebook', text: 'Words', link: 'http://a.com' }), { mustFix: true, mustFixWithPicture: true });
  assert.deepEqual(mustFixOf({ network: 'facebook', text: '', link: '' }), { mustFix: false, mustFixWithPicture: false }, 'no words is not a check the records keep');
  assert.deepEqual(mustFixOf({ network: 'instagram', text: 'Words' }), { mustFix: false, mustFixWithPicture: false }, 'a missing picture is not one either');
  assert.deepEqual(mustFixOf({ network: 'myspace', text: 'a'.repeat(9000) }), { mustFix: false, mustFixWithPicture: false });
  // The preview's lines hold the same three, in their order.
  const version = { network: 'x', text: `${'a'.repeat(281)} #a`, hashtags: '#b', link: 'http://a.com' };
  assert.deepEqual(keysOf(wordsChecks(version)), keysOf(checksFor(version)).filter((key) => ['check.overLimit', 'check.tooManyHashtags', 'check.badLink'].includes(key)));
  assert.deepEqual(keysOf(checksFor({ network: 'instagram', text: 'a'.repeat(2201), link: 'http://a.com' })), ['check.overLimit', 'check.needsPicture', 'check.badLink']);
});

test('checks: no words, a picture missing, and a link that is not safe', () => {
  assert.deepEqual(checksFor({ network: 'x', text: '' }), [{ key: 'check.noWords', level: 'must' }]);
  assert.deepEqual(checksFor({ network: 'x', text: '   ', hashtags: '#a' }), [{ key: 'check.noWords', level: 'must' }]);
  assert.deepEqual(checksFor({ network: 'x', text: 'Words' }), []);
  for (const network of ['instagram', 'pinterest']) {
    assert.ok(keysOf(checksFor({ network, text: 'Words' })).includes('check.needsPicture'), network);
    assert.ok(!keysOf(checksFor({ network, text: 'Words', chosenPicture: { description: 'A mug' } })).includes('check.needsPicture'), network);
  }
  assert.ok(!keysOf(checksFor({ network: 'facebook', text: 'Words' })).includes('check.needsPicture'));
  for (const [link, bad] of [['', false], ['https://a.com', false], ['http://a.com', true], ['a.com', true], ['javascript:alert(1)', true], [linkOf(499), false], [linkOf(500), false], [linkOf(501), true], [7, true]]) {
    assert.equal(keysOf(checksFor({ network: 'facebook', text: 'Words', link })).includes('check.badLink'), bad, String(link).slice(0, 40));
  }
});

test('checks: the marks never block, and say what to fix', () => {
  assert.deepEqual(checksFor({ network: 'instagram', text: 'Book at https://a.com', chosenPicture: { description: 'A mug' } }), [{ key: 'check.linkNotPressable', level: 'mark', fix: 'linkSentence' }]);
  assert.deepEqual(checksFor({ network: 'facebook', text: 'Book at https://a.com' }), []);
  assert.deepEqual(checksFor({ network: 'facebook', text: 'Words', chosenPicture: { description: ' ' } }), [{ key: 'check.noDescription', level: 'mark', fix: 'description' }]);
  assert.deepEqual(checksFor({ network: 'facebook', text: 'Words', chosenPicture: {} }), [{ key: 'check.noDescription', level: 'mark', fix: 'description' }]);
  assert.deepEqual(checksFor({ network: 'facebook', text: 'Words', chosenPicture: { description: 'A mug' } }), []);
  for (const network of ['tiktok', 'youtube']) assert.deepEqual(checksFor({ network, text: 'Words' }), [{ key: 'check.needsVideo', level: 'mark' }], network);
  assert.deepEqual(checksFor({ network: 'x', text: 'Words', remembrance: true }), [{ key: 'check.remembrance', level: 'mark' }]);
  const must = (checks) => checks.some((check) => check.level === 'must');
  assert.equal(must(checksFor({ network: 'tiktok', text: 'Words', remembrance: true, day: '2026-01-01', today: '2026-10-21' })), false);
  assert.equal(must(checksFor({ network: 'x', text: '' })), true);
});

test('checks: a planned day that passed, at today, one before and one after', () => {
  const today = '2026-10-21';
  for (const [day, passed] of [['2026-10-20', true], ['2026-10-21', false], ['2026-10-22', false], ['2025-12-31', true], [null, false]]) {
    assert.equal(keysOf(checksFor({ network: 'x', text: 'Words', day, today })).includes('check.dayPassed'), passed, String(day));
  }
  assert.ok(!keysOf(checksFor({ network: 'x', text: 'Words', day: '2026-10-20', today, shared: true })).includes('check.dayPassed'), 'not once shared');
});

test('checks: Telegram counts a caption’s limit only with a chosen picture', () => {
  for (const [length, over] of [[1023, false], [1024, false], [1025, true]]) {
    assert.equal(keysOf(checksFor({ network: 'telegram', text: 'a'.repeat(length), chosenPicture: { description: 'A mug' } })).includes('check.overLimit'), over, `${length}`);
  }
  assert.ok(!keysOf(checksFor({ network: 'telegram', text: 'a'.repeat(1025) })).includes('check.overLimit'));
  assert.ok(keysOf(checksFor({ network: 'telegram', text: 'a'.repeat(4097) })).includes('check.overLimit'));
});

test('checks: musts come first, the person’s words are never changed, and every key is listed', () => {
  const version = Object.freeze({ network: 'instagram', text: `${'a'.repeat(2200)} https://a.com`, hashtags: tags(6).join(' '), link: 'http://a.com', chosenPicture: null, day: '2026-10-01', today: '2026-10-21', remembrance: true });
  const checks = checksFor(version);
  assert.deepEqual(keysOf(checks), ['check.overLimit', 'check.tooManyHashtags', 'check.needsPicture', 'check.badLink', 'check.linkNotPressable', 'check.dayPassed', 'check.remembrance']);
  const firstMark = checks.findIndex((check) => check.level === 'mark');
  assert.ok(checks.slice(firstMark).every((check) => check.level === 'mark'));
  assert.equal(version.text.length, 2200 + 1 + 'https://a.com'.length);
  for (const check of Object.values(CHECKS)) assert.match(check.key, /^check\.[a-zA-Z]+$/u);
  assert.deepEqual(checksFor({ network: 'myspace', text: '' }), []);
  // A returned check is a copy: changing it changes no later answer.
  checks[0].level = 'mark';
  assert.equal(checksFor(version)[0].level, 'must');
});

// ---- share ----

test('share: networks whose address carries the words', () => {
  const version = { text: 'Paint your own mug & tea? 50% off', hashtags: '#mug #çay', link: 'https://blueclay.example/book' };
  // Where links can be pressed, the version's link goes between the words and the hashtags.
  const copyText = 'Paint your own mug & tea? 50% off\n\nhttps://blueclay.example/book\n\n#mug #çay';
  const starts = { x: 'https://x.com/intent/post?text=', threads: 'https://www.threads.com/intent/post?text=', bluesky: 'https://bsky.app/intent/compose?text=', whatsapp: 'https://wa.me/?text=' };
  for (const [network, start] of Object.entries(starts)) {
    const share = shareFor(network, version);
    assert.equal(share.kind, 'address', network);
    assert.equal(share.copyText, copyText, network);
    assert.equal(share.address, `${start}${encodeURIComponent(copyText)}`, network);
    assert.equal(new URL(share.address).searchParams.get('text'), copyText, network);
  }
  const telegram = shareFor('telegram', version);
  assert.equal(telegram.kind, 'address');
  assert.equal(new URL(telegram.address).origin + new URL(telegram.address).pathname, 'https://t.me/share/url');
  assert.equal(new URL(telegram.address).searchParams.get('url'), 'https://blueclay.example/book');
  assert.equal(telegram.copyText, copyText);
  assert.deepEqual(shareFor('telegram', { ...version, link: '' }), { kind: 'site', address: 'https://web.telegram.org/', copyText: 'Paint your own mug & tea? 50% off\n\n#mug #çay' });
});

test('share: Facebook and LinkedIn carry a link, else open their site', () => {
  const link = 'https://blueclay.example/book?day=sat&time=14';
  const facebook = shareFor('facebook', { text: 'Words', link });
  assert.equal(facebook.kind, 'address');
  assert.equal(facebook.address, `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`);
  assert.equal(new URL(facebook.address).searchParams.get('u'), link);
  const linkedin = shareFor('linkedin', { text: 'Words', link });
  assert.equal(new URL(linkedin.address).searchParams.get('url'), link);
  assert.equal(linkedin.address.startsWith('https://www.linkedin.com/sharing/share-offsite/?url='), true);
  assert.deepEqual(shareFor('facebook', { text: 'Words' }), { kind: 'site', address: 'https://www.facebook.com/', copyText: 'Words' });
  assert.deepEqual(shareFor('linkedin', { text: 'Words', link: 'http://blueclay.example' }), { kind: 'site', address: 'https://www.linkedin.com/feed/', copyText: 'Words' }, 'a link that is not https is not used');
});

test('share: the other networks copy and open their site', () => {
  for (const network of ['instagram', 'tiktok', 'pinterest', 'google']) {
    assert.deepEqual(shareFor(network, { text: 'Words', hashtags: ['#a', '#b'], link: 'https://a.com' }), { kind: 'site', address: networkByKey(network).site, copyText: 'Words\n\n#a #b' }, network);
  }
  // YouTube's description can hold a link that can be pressed: the link goes in the words.
  assert.deepEqual(shareFor('youtube', { text: 'Words', hashtags: ['#a', '#b'], link: 'https://a.com' }), { kind: 'site', address: networkByKey('youtube').site, copyText: 'Words\n\nhttps://a.com/\n\n#a #b' });
  assert.equal(shareFor('instagram', { text: 'Words' }).copyText, 'Words', 'no hashtags: the words alone');
  assert.equal(shareFor('myspace', { text: 'Words' }), null);
});

test('share: an address at the most opens, one over opens the site instead', () => {
  const start = 'https://x.com/intent/post?text=';
  for (const [length, kind] of [[SHARE_ADDRESS_MOST - 1, 'address'], [SHARE_ADDRESS_MOST, 'address'], [SHARE_ADDRESS_MOST + 1, 'site']]) {
    const share = shareFor('x', { text: 'a'.repeat(length - start.length) });
    assert.equal(share.kind, kind, `${length}`);
    if (kind === 'address') assert.equal(share.address.length, length);
    else assert.equal(share.address, 'https://x.com/');
  }
  // Encoded words grow: 2,000 Turkish letters become 12,000 characters.
  assert.equal(shareFor('whatsapp', { text: 'ğ'.repeat(2000) }).kind, 'site');
});

test('share: every address is https on the default port', () => {
  const versions = [{ text: 'Words', hashtags: '#a', link: 'https://a.com:8443/x' }, { text: 'Words' }, { text: '', link: 'https://a.com' }];
  for (const network of NETWORK_KEYS) {
    for (const version of versions) {
      const share = shareFor(network, version);
      const address = new URL(share.address);
      assert.equal(address.protocol, 'https:', `${network} ${share.address}`);
      assert.equal(address.port, '', `${network} ${share.address}`);
      assert.equal(address.username + address.password, '', network);
    }
  }
});

// ---- csv ----

test('csv: a cell that could run as a formula is guarded', () => {
  for (const start of ['=', '+', '-', '@']) assert.equal(csvCell(`${start}SUM(A1:A9)`), `'${start}SUM(A1:A9)`, start);
  assert.equal(csvCell('\tcmd'), `"'\tcmd"`);
  assert.equal(csvCell('\rcmd'), `"'\rcmd"`);
  assert.equal(csvCell(' =1+1'), "' =1+1", 'after spaces too');
  assert.equal(csvCell('Ayşe'), 'Ayşe');
  assert.equal(csvCell('a=b'), 'a=b', 'only at the start');
  assert.equal(csvCell(-5), '-5', 'a number is not a formula');
  assert.equal(csvCell(0), '0');
});

test('csv: cells are quoted when they need it, and empty values are empty', () => {
  assert.equal(csvCell('Ayşe, "Kil"'), '"Ayşe, ""Kil"""');
  assert.equal(csvCell('one\ntwo'), '"one\ntwo"');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell(' padded'), '" padded"');
  assert.equal(csvCell('Ayşe’s mug'), 'Ayşe’s mug');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(Number.NaN), '');
  assert.equal(csvCell(true), 'true');
  assert.equal(csvCell(new Date('2026-10-21T10:00:00.000Z')), '2026-10-21T10:00:00.000Z');
});

test('csv: the whole text starts with the UTF-8 mark and ends each row with CRLF', () => {
  assert.equal(CSV_BOM, '\uFEFF');
  assert.equal(csvText([['Name', 'Amount'], ['=HYPERLINK("x")', 120], ['Ayşe', null]]), '\uFEFFName,Amount\r\n"\'=HYPERLINK(""x"")",120\r\nAyşe,\r\n');
  assert.equal(csvText([]), '\uFEFF');
  assert.equal(csvText(null), '\uFEFF');
  assert.equal(csvText(['one']), '\uFEFFone\r\n');
});

// ---- the clear mask ----

/** The chunks of a PNG: `{ type, data, crcOk }`. */
function chunksOf(bytes) {
  const buffer = Buffer.from(bytes);
  const chunks = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const crc = buffer.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crcOk: crc === crc32(buffer.subarray(offset + 4, offset + 8 + length)) >>> 0 });
    offset += 12 + length;
  }
  return chunks;
}

test('clear mask: a whole PNG 1536x1024, fully clear, under 48 KB', () => {
  const mask = clearMask();
  assert.ok(mask instanceof Uint8Array);
  assert.deepEqual([...mask.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(mask.byteLength < 48 * 1024, `${mask.byteLength} bytes`);
  const chunks = chunksOf(mask);
  assert.deepEqual(chunks.map((chunk) => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  assert.ok(chunks.every((chunk) => chunk.crcOk));
  const header = chunks[0].data;
  assert.equal(header.readUInt32BE(0), 1536);
  assert.equal(header.readUInt32BE(4), 1024);
  assert.equal(MASK_WIDTH, 1536);
  assert.equal(MASK_HEIGHT, 1024);
  assert.deepEqual([...header.subarray(8)], [8, 6, 0, 0, 0], '8 bits, red-green-blue-alpha, no interlace');
  const rows = inflateSync(chunks[1].data);
  assert.equal(rows.length, 1024 * (1 + 1536 * 4));
  assert.ok(rows.every((byte) => byte === 0), 'filter 0 on every row and every pixel clear');
  assert.equal(chunks[2].data.length, 0);
});

test('clear mask: each call answers its own copy', () => {
  const first = clearMask();
  first.fill(7);
  const second = clearMask();
  assert.equal(second[0], 0x89);
  assert.notEqual(first.buffer, second.buffer);
});

// --- stored words: two bytes a letter ---------------------------------------------------------

test('stored words take at most two bytes a letter: English and Turkish at the letter limit fit, emoji past the byte limit do not', () => {
  const max = LIMITS.versionText;
  const english = 'Fresh bread at seven, "warm" and \\ ready.\n\t'.repeat(200).slice(0, max);
  const turkish = 'Taze ekmek yedide çıkıyor, sıcacık ve çıtır; şimdi gel, ğüşiöç!\n'.repeat(100).slice(0, max);
  assert.equal(Array.from(english).length, max);
  assert.equal(Array.from(turkish).length, max);
  assert.equal(readWords(english, max, { multiline: true }).ok, true, 'English at the letter limit');
  assert.equal(readWords(turkish, max, { multiline: true }).ok, true, 'Turkish at the letter limit');
  assert.equal(readWords('ş'.repeat(max), max).ok, true, 'two-byte letters at the letter limit');
  assert.equal(readWords('"'.repeat(max), max).ok, true, 'quotes at the letter limit (two bytes each as stored)');
  // Emoji take four bytes: at half the letter limit they are at the byte limit, one more is refused.
  assert.equal(readWords('😀'.repeat(max / 2), max).ok, true, 'at the byte limit');
  assert.deepEqual(readWords('😀'.repeat(max / 2 + 1), max), { ok: false, problem: LIMIT_REFUSALS.long }, 'one emoji past it');
  assert.deepEqual(readWords('中'.repeat(Math.floor((2 * max) / 3) + 1), max), { ok: false, problem: LIMIT_REFUSALS.long }, 'three-byte letters past it');
  // A broken half of an emoji becomes one replacement character, never six bytes of escape.
  const broken = readWords(`a\ud800b`, 10);
  assert.deepEqual(broken, { ok: true, value: 'a�b' });
  for (const value of [english, turkish, 'ş'.repeat(max), '😀'.repeat(max / 2)]) assert.ok(wireBytes(value) <= BYTES_A_LETTER * max);
  assert.equal(wireBytes('aş"😀\n'), 1 + 2 + 2 + 4 + 2);
});

test('a kept address is refused when the browser\'s spelling of it passes two bytes a letter', () => {
  const plain = `https://example.com/${'a'.repeat(LIMITS.link - 20)}`;
  assert.equal(readLink(plain).ok, true);
  // 480 Turkish letters in the path: within 500 letters, but written as 2,880 characters of %-escapes.
  assert.deepEqual(readLink(`https://example.com/${'ş'.repeat(LIMITS.link - 20)}`), { ok: false, problem: LIMIT_REFUSALS.long });
  assert.equal(readLink(`https://example.com/${'ş'.repeat(80)}`).ok, true, 'a short Turkish path still fits');
});

test('AI words and kept picture scenes are cut at the letter limit and at two bytes a letter, at a whole character', () => {
  assert.equal(clipText('ş'.repeat(300), 300), 'ş'.repeat(300), 'two-byte letters at the limit are kept whole');
  const emoji = clipText('😀'.repeat(300), 300);
  assert.equal(emoji, '😀'.repeat(150), 'four-byte letters stop at the byte limit');
  assert.ok(wireBytes(emoji) <= 600);
  const words = clipText(`${'Fresh bread today. '.repeat(20)}${'😀'.repeat(200)}`, 300);
  assert.ok(wireBytes(words) <= 600 && words.endsWith('.'), 'cut at a sentence end when there is one');
  assert.equal(cutText('a😀b', 2, 10), 'a😀', 'never half an emoji');
  assert.equal(cutText('a😀b', 2), 'a', 'two letters at two bytes a letter leave no room for an emoji');
  assert.equal(cutText('a😀b', 3, 4), 'a', 'the bytes decide when they are fewer');
  const scene = changedScene('😀'.repeat(SCENE_MOST), 'make it green');
  assert.ok(Array.from(scene).length <= SCENE_MOST && wireBytes(scene) <= BYTES_A_LETTER * SCENE_MOST, 'a changed scene stays within its limit');
  assert.ok(scene.endsWith('Changed: make it green'), 'the change always stays');
  const longChange = changedScene('a mug', '😀'.repeat(LIMITS.change));
  assert.ok(wireBytes(longChange) <= BYTES_A_LETTER * SCENE_MOST);
});

// ---- fix round H1: hashtags' bytes, public links, full-width formula marks, a version's link in the words ----

test('hashtags: a tag over the bytes a version keeps is left out, at the edge and one each side', () => {
  // A three-byte letter (as a version's words count it): 66 of them and the # are 199 bytes, 67 are 202 (the most is 200).
  const tag = (letters) => `#${'ㄱ'.repeat(letters)}`;
  assert.deepEqual(normaliseHashtags([tag(66)]), [tag(66)]);
  assert.deepEqual(normaliseHashtags([tag(67)]), []);
  assert.deepEqual(normaliseHashtags([tag(65), tag(67), '#kahve']), [tag(65), '#kahve'], 'only the long one goes');
  // Two-byte letters reach the letter limit first: 99 letters and the # are 100 characters (199 bytes), kept.
  assert.deepEqual(normaliseHashtags([`#${'ş'.repeat(99)}`]), [`#${'ş'.repeat(99)}`]);
  assert.deepEqual(normaliseHashtags([`#${'ş'.repeat(100)}`]), []);
});

test('links: an address with a port, or on this computer or a local network, is refused', () => {
  for (const link of ['https://shop.com:8443/', 'https://shop.com:443/', 'https://shop.com:/', 'https://localhost/', 'https://LOCALHOST./a',
    'https://a.localhost/', 'https://printer.local/', 'https://router.home.arpa/', 'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f.1/',
    'https://0.0.0.0/', 'https://10.0.0.1/', 'https://100.64.0.1/', 'https://169.254.169.254/', 'https://172.16.0.1/', 'https://172.31.255.255/',
    'https://192.168.1.1/', 'https://[::1]/', 'https://[fe80::1]/', 'https://[2001:db8::1]/']) {
    assert.deepEqual(readLink(link), { ok: false, problem: LIMIT_REFUSALS.linkPublic }, link);
  }
  for (const link of ['https://172.15.0.1/', 'https://172.32.0.1/', 'https://100.63.0.1/', 'https://100.128.0.1/', 'https://8.8.8.8/',
    'https://mylocal.com/', 'https://shop.com/a:b', 'https://shop.com/?at=:9']) {
    assert.equal(readLink(link).ok, true, link);
  }
});

test('csv: a cell that starts with a full-width formula mark is guarded too', () => {
  for (const start of ['\uFF1D', '\uFF0B', '\uFF0D', '\uFF20']) assert.equal(csvCell(`${start}SUM(A1)`), `'${start}SUM(A1)`, start);
  assert.equal(csvCell(' \uFF1D1'), "' \uFF1D1", 'after spaces too');
  assert.equal(csvCell('a\uFF1Db'), 'a\uFF1Db', 'only at the start');
});

test('fitWords keeps room for the version\'s link where it is shared with the words: X counts it as 23', () => {
  const link = linkOf(200);
  // X: 280 at most; the link counts 23 and each blank line 2.
  const words = (count) => 'a'.repeat(count);
  const atEdge = 280 - 23 - 2 - 2 - '#tea'.length;
  for (const [count, cut] of [[atEdge - 1, false], [atEdge, false], [atEdge + 1, true]]) {
    const fitted = fitWords({ network: 'x', text: words(count), hashtags: ['#tea'], link });
    assert.equal(fitted.cut, cut, `${count}`);
    assert.ok(countFor('x', sharedWords('x', { text: fitted.text, link, hashtags: fitted.hashtags })) <= 280, `${count}`);
  }
  // Threads counts the link letter by letter: words and link together stay within 500.
  const threads = fitWords({ network: 'threads', text: `${'Mugs and clay. '.repeat(40)}`, link });
  assert.ok(countFor('threads', sharedWords('threads', { text: threads.text, link, hashtags: threads.hashtags })) <= 500);
  assert.equal(threads.cut, true);
  // No room is kept where the link is not in the words, or for a link that is not safe.
  assert.equal(fitWords({ network: 'x', text: words(280), link: 'http://a.com' }).cut, false);
  assert.equal(fitWords({ network: 'instagram', text: words(2200), link }).cut, false);
});
