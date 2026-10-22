/**
 * The calendar file (`lib/plan/ics.js`) with a fixed moment: one event a post
 * that has a day, timed (floating, 15 minutes) or whole-day, the reminder,
 * the name and words, the escaping, the 500-character cut and the folding at
 * 75 bytes, read back by unfolding and parsing the text as a calendar does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { t } from '../lib/i18n/index.js';
import { calendarFile, copyTag, foldLine, ICS_DESCRIPTION_MOST, icsText } from '../lib/plan/ics.js';

const NOW = new Date('2026-10-22T09:00:00.000Z');
const post = (fields) => ({ id: 1, name: 'Autumn offer', mainText: '', day: '2026-10-22', time: null, ...fields });

/** The file's lines with every fold undone (a line break followed by one space joins the lines). */
const unfolded = (file) => file.replace(/\r\n /gu, '').split('\r\n').filter((line) => line !== '');
/** Each event's properties, by name (parameters kept in the name: `DTSTART;VALUE=DATE`); an alarm's under `alarm`. */
function events(file) {
  const found = [];
  let current = null;
  let inAlarm = false;
  for (const line of unfolded(file)) {
    if (line === 'BEGIN:VEVENT') current = { alarm: {} };
    else if (line === 'END:VEVENT') found.push(current);
    else if (line === 'BEGIN:VALARM') inAlarm = true;
    else if (line === 'END:VALARM') inAlarm = false;
    else if (current !== null) {
      const colon = line.indexOf(':');
      (inAlarm ? current.alarm : current)[line.slice(0, colon)] = line.slice(colon + 1);
    }
  }
  return found;
}

test('a post with a time is a 15-minute event at that time on its day, in the person’s own time, reminding when it starts', () => {
  const file = calendarFile([post({ id: 7, time: '09:30' })], { business: 'Lale Ceramics', locale: 'en', now: NOW });
  const [event] = events(file);
  assert.equal(event.UID, 'post-7@marketing-planner.invalid');
  assert.equal(event.DTSTAMP, '20261022T090000Z');
  assert.equal(event.DTSTART, '20261022T093000', 'floating: no Z, no time zone');
  assert.equal(event.DTEND, '20261022T094500');
  assert.equal(event.SUMMARY, 'Autumn offer');
  assert.equal(event.TRANSP, 'TRANSPARENT', 'a reminder never shows the person as busy');
  assert.deepEqual(event.alarm, { ACTION: 'DISPLAY', TRIGGER: 'PT0S', DESCRIPTION: 'Autumn offer' });
  assert.equal('DESCRIPTION' in event, false, 'no words, no notes');
  const lines = unfolded(file);
  assert.deepEqual(lines.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marketing planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Lale Ceramics']);
  assert.equal(lines.at(-1), 'END:VCALENDAR');
});

test('a post with no time is a whole-day event, reminding at 9:00 on its day', () => {
  for (const time of [null, undefined, '', '9:30', '24:00', '12:60']) {
    const [event] = events(calendarFile([post({ time })], { locale: 'en', now: NOW }));
    assert.equal(event['DTSTART;VALUE=DATE'], '20261022', String(time));
    assert.equal(event['DTEND;VALUE=DATE'], '20261023');
    assert.equal(event.DTSTART, undefined);
    assert.equal(event.alarm.TRIGGER, 'PT9H');
  }
  const [last] = events(calendarFile([post({ day: '2026-12-31' })], { now: NOW }));
  assert.equal(last['DTEND;VALUE=DATE'], '20270101', 'the year turns');
});

test('a 15-minute event past midnight ends the next day; at 23:44 it ends the same day', () => {
  const [late, edge, lastMinute] = events(calendarFile([
    post({ id: 1, day: '2026-12-31', time: '23:50' }),
    post({ id: 2, day: '2026-10-22', time: '23:44' }),
    post({ id: 3, day: '2026-10-22', time: '23:45' }),
  ], { now: NOW }));
  assert.deepEqual([late.DTSTART, late.DTEND], ['20261231T235000', '20270101T000500']);
  assert.deepEqual([edge.DTSTART, edge.DTEND], ['20261022T234400', '20261022T235900']);
  assert.deepEqual([lastMinute.DTSTART, lastMinute.DTEND], ['20261022T234500', '20261023T000000']);
});

test('a post with no day, or a day that is not one, or no whole-number id, is left out; the rest keep their order', () => {
  const file = calendarFile([
    post({ id: 3, day: '2026-10-25' }),
    post({ id: 4, day: null }),
    post({ id: 5, day: '2026-02-30' }),
    post({ id: 6, day: '2026-10' }),
    post({ id: /** @type {any} */ ('7'), day: '2026-10-26' }),
    post({ id: 2, day: '2026-10-01' }),
  ], { now: NOW });
  assert.deepEqual(events(file).map((event) => event.UID), ['post-3@marketing-planner.invalid', 'post-2@marketing-planner.invalid']);
  assert.equal(events(calendarFile([], { now: NOW })).length, 0);
});

test('a post with no name is called by the untitled word, in the app’s language; an empty business name is the app’s name', () => {
  for (const locale of /** @type {const} */ (['en', 'tr'])) {
    const file = calendarFile([post({ name: '   ' }), post({ id: 2, name: null })], { business: ' ', locale, now: NOW });
    assert.deepEqual(events(file).map((event) => event.SUMMARY), [t('post.untitled', locale), t('post.untitled', locale)]);
    assert.ok(unfolded(file).includes(`X-WR-CALNAME:${icsText(t('app.title', locale))}`));
  }
});

test('text is escaped: backslash, semicolon, comma and new lines; control characters are dropped', () => {
  assert.equal(icsText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
  assert.equal(icsText('one\r\ntwo\rthree\nfour'), 'one\\ntwo\\nthree\\nfour');
  assert.equal(icsText('tab\tbell\u0007null\u0000del\u007f'), 'tab\tbellnulldel');
  assert.equal(icsText(null), '');
  const [event] = events(calendarFile([post({ name: 'Sale; 2 for 1, today', mainText: 'Line one\nLine two, with \\ a mark' })], { now: NOW }));
  assert.equal(event.SUMMARY, 'Sale\\; 2 for 1\\, today');
  assert.equal(event.DESCRIPTION, 'Line one\\nLine two\\, with \\\\ a mark');
});

test('the notes carry the first 500 characters of the main words: 500 stay whole, 501 are cut, an emoji is one character', () => {
  assert.equal(ICS_DESCRIPTION_MOST, 500);
  const exact = 'ğ'.repeat(500);
  const [whole] = events(calendarFile([post({ mainText: exact })], { now: NOW }));
  assert.equal(whole.DESCRIPTION, exact);
  const [cut] = events(calendarFile([post({ mainText: `${exact}x` })], { now: NOW }));
  assert.equal(cut.DESCRIPTION, exact);
  const [emoji] = events(calendarFile([post({ mainText: '😀'.repeat(501) })], { now: NOW }));
  assert.equal(Array.from(emoji.DESCRIPTION).length, 500);
  const [trimmed] = events(calendarFile([post({ mainText: '  \n words \n ' })], { now: NOW }));
  assert.equal(trimmed.DESCRIPTION, 'words');
});

test('lines end CRLF and are folded at 75 bytes, never inside a character; unfolding gives the line back', () => {
  const name = `Ürün ${'ğüşiöç'.repeat(40)} 😀😀😀`;
  const file = calendarFile([post({ name, mainText: 'ş'.repeat(500) })], { now: NOW });
  assert.ok(file.endsWith('\r\n'));
  assert.equal(/[^\r]\n/u.test(file) || /\r[^\n]/u.test(file), false, 'no bare line end');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  for (const line of file.split('\r\n')) {
    assert.ok(encoder.encode(line).length <= 75, `${encoder.encode(line).length} bytes: ${line}`);
    assert.doesNotThrow(() => decoder.decode(encoder.encode(line)));
  }
  assert.equal(events(file)[0].SUMMARY, name);
  assert.equal(events(file)[0].DESCRIPTION, 'ş'.repeat(500));
});

test('a line of exactly 75 bytes stays one line; 76 bytes fold into 75 and a space with the last byte', () => {
  assert.deepEqual(foldLine('a'.repeat(75)), ['a'.repeat(75)]);
  assert.deepEqual(foldLine('a'.repeat(76)), ['a'.repeat(75), ' a']);
  assert.deepEqual(foldLine('a'.repeat(74) + 'ş'), ['a'.repeat(74), ' ş'], 'a two-byte letter that would end at byte 76 moves whole');
  const long = foldLine('b'.repeat(75 + 74 + 1));
  assert.deepEqual(long.map((line) => line.length), [75, 75, 2], 'a following line holds its space and 74 bytes');
});

test('the file names each post’s event the same way every time, so adding it again changes the same events', () => {
  const posts = [post({ id: 11, time: '10:00' }), post({ id: 12, day: '2026-10-30' })];
  const first = calendarFile(posts, { now: NOW });
  assert.equal(calendarFile(posts, { now: NOW }), first);
  const later = calendarFile(posts, { now: new Date('2026-10-23T10:15:30.000Z') });
  assert.deepEqual(events(later).map((event) => event.UID), events(first).map((event) => event.UID));
  assert.equal(events(later)[0].DTSTAMP, '20261023T101530Z');
});

test('calendarSpan: a month, or a week of at most seven days in order', async () => {
  const { calendarSpan, CALENDAR_SPAN_MOST } = await import('../lib/plan/ics.js');
  assert.equal(CALENDAR_SPAN_MOST, 7);
  assert.deepEqual(calendarSpan({ month: '2026-02' }), { from: '2026-02-01', to: '2026-02-28', label: '2026-02' });
  assert.deepEqual(calendarSpan({ from: '2026-10-26', to: '2026-11-01' }), { from: '2026-10-26', to: '2026-11-01', label: '2026-10-26' });
  assert.deepEqual(calendarSpan({ from: '2026-10-26', to: '2026-10-26' }), { from: '2026-10-26', to: '2026-10-26', label: '2026-10-26' });
  assert.equal(calendarSpan({ from: '2026-10-26', to: '2026-11-02' }), null, 'eight days');
  assert.equal(calendarSpan({ from: '2026-10-27', to: '2026-10-26' }), null, 'out of order');
  assert.equal(calendarSpan({ month: '2026-10', from: '2026-10-01', to: '2026-10-02' }), null, 'both kinds');
  assert.equal(calendarSpan({ month: '2026-13' }), null);
  assert.equal(calendarSpan({ from: '2026-10-26' }), null);
  assert.equal(calendarSpan({}), null);
});

test('each event’s identity carries this copy’s mark, so two copies’ files never replace each other’s events', () => {
  const mine = copyTag({ createdAt: '2026-09-01T10:00:00.000Z', businessName: 'Lale Ceramics' });
  assert.match(mine, /^[0-9a-f]{8}$/u);
  assert.equal(copyTag({ createdAt: '2026-09-01T10:00:00.000Z', businessName: 'Another name' }), mine, 'stable: the moment the profile was first saved, not its name');
  const other = copyTag({ createdAt: '2026-09-01T10:00:00.001Z', businessName: 'Lale Ceramics' });
  assert.notEqual(other, mine, 'another copy of the app, saved a moment later');
  // No profile yet: the business's name (none: the same empty mark every time).
  assert.equal(copyTag({ createdAt: null, businessName: ' Lale Ceramics ' }), copyTag({ createdAt: '', businessName: 'Lale Ceramics' }));
  assert.notEqual(copyTag({ createdAt: null, businessName: 'Lale Ceramics' }), copyTag({ createdAt: null, businessName: 'Tea House' }));
  assert.match(copyTag(null), /^[0-9a-f]{8}$/u);
  const uids = (tag) => events(calendarFile([post({ id: 7 }), post({ id: 8, time: '09:30' })], { now: NOW, tag })).map((event) => event.UID);
  assert.deepEqual(uids(mine), [`post-7-${mine}@marketing-planner.invalid`, `post-8-${mine}@marketing-planner.invalid`]);
  assert.notDeepEqual(uids(other), uids(mine));
  assert.deepEqual(uids(mine), uids(mine), 'the same copy’s file again updates its own events');
  assert.deepEqual(uids('not a tag'), ['post-7@marketing-planner.invalid', 'post-8@marketing-planner.invalid'], 'a mark that is not hex digits is left out');
});
