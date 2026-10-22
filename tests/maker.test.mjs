import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  aspectOf,
  campaignChoices,
  countFieldText,
  countLine,
  dateOfDay,
  dayOfDate,
  dayText,
  editorBody,
  editorChanged,
  editorFields,
  emptyVersion,
  firstNetwork,
  hasWords,
  isRemembrance,
  keepNetwork,
  listNames,
  makeBody,
  makeRest,
  PRESS_STILL_COUNTS_MS,
  pressStillCounts,
  previewLink,
  previewWords,
  readCountText,
  readResultsForm,
  readTimeText,
  saveStep,
  shapeOf,
  shareLabelKey,
  shownChecks,
  shortDayText,
  timeText,
  versionOf,
  withLinkSentence,
  withPicture,
  withVersion,
  localWhen,
  SCHEDULE_TIME,
  setFileName,
  setSavable,
  shareMark,
  slidesFor,
  stateWordsOf,
} from '../app/posts/[id]/rules.js';
import { VIDEO_NETWORKS, canAdd, draftOf, planText, readDraft, secondsOf, videoPanelOpen } from '../app/posts/[id]/video-rules.js';
import { SCHEDULE_TIME as KEPT_SCHEDULE_TIME } from '../lib/data/posts.js';
import { postState } from '../lib/plan/state.js';
import { t as translate } from '../lib/i18n/index.js';
import { send, sendUnconfirmed } from '../app/send.js';
import { printPage } from '../app/posts/print-light.js';
import { dayOfInstant } from '../app/results/figures.js';
import { themeBackground } from '../app/theme-colours.js';
import { checksFor } from '../lib/plan/checks.js';
import { LIMITS } from '../lib/plan/limits.js';
import { shareFor, sharedWords, trackingFor } from '../lib/plan/share.js';

const words = (length) => 'a'.repeat(length);

describe('countLine: a count shows only within 10% of the limit or over it', () => {
  it('Instagram (2,200): hidden at 1,979, shown from 1,980, over from 2,201', () => {
    assert.equal(countLine('instagram', { text: words(1979) }), null);
    assert.deepEqual(countLine('instagram', { text: words(1980) }), { count: 1980, limit: 2200, over: false });
    assert.deepEqual(countLine('instagram', { text: words(2200) }), { count: 2200, limit: 2200, over: false });
    assert.deepEqual(countLine('instagram', { text: words(2201) }), { count: 2201, limit: 2200, over: true });
  });

  it('counts the hashtags after a blank line, as the post carries them', () => {
    // 1,970 + 2 (blank line) + 8 = 1,980.
    assert.deepEqual(countLine('instagram', { text: words(1970), hashtags: '#ceramic' }), { count: 1980, limit: 2200, over: false });
    assert.equal(countLine('instagram', { text: words(1969), hashtags: '#ceramic' }), null);
  });

  it('X counts a web address as 23: 252 shows, 251 does not', () => {
    const link = 'https://example.com/a-very-long-address-that-is-much-longer-than-23';
    assert.equal(countLine('x', { text: `${words(227)} ${link}` }), null);
    assert.deepEqual(countLine('x', { text: `${words(228)} ${link}` }), { count: 252, limit: 280, over: false });
    assert.deepEqual(countLine('x', { text: words(252) }), { count: 252, limit: 280, over: false });
    assert.equal(countLine('x', { text: words(251) }), null);
    assert.deepEqual(countLine('x', { text: words(281) }), { count: 281, limit: 280, over: true });
  });

  it('Telegram counts against the caption limit (1,024) only with a picture', () => {
    assert.equal(countLine('telegram', { text: words(921) }, true), null);
    assert.deepEqual(countLine('telegram', { text: words(922) }, true), { count: 922, limit: 1024, over: false });
    assert.deepEqual(countLine('telegram', { text: words(1025) }, true), { count: 1025, limit: 1024, over: true });
    assert.equal(countLine('telegram', { text: words(1025) }, false), null);
  });

  it('a network the app does not know shows no count', () => {
    assert.equal(countLine('myspace', { text: words(5000) }), null);
  });
});

describe('shareLabelKey: what the second share button says', () => {
  it('a share address that carries the words opens the network with them', () => {
    for (const network of ['x', 'threads', 'bluesky', 'whatsapp']) {
      assert.equal(shareLabelKey(network, shareFor(network, { text: 'Hello' })), `share.openWith.${network}`);
    }
  });

  it('a site, or an address that carries only a link, copies and opens', () => {
    assert.equal(shareLabelKey('instagram', shareFor('instagram', { text: 'Hello' })), 'share.copyOpen.instagram');
    const facebook = shareFor('facebook', { text: 'Hello', link: 'https://example.com' });
    assert.equal(facebook.kind, 'address');
    assert.equal(shareLabelKey('facebook', facebook), 'share.copyOpen.facebook');
  });

  it('Telegram opens with the words only when it has a link', () => {
    assert.equal(shareLabelKey('telegram', shareFor('telegram', { text: 'Hello', link: 'https://example.com' })), 'share.openWith.telegram');
    assert.equal(shareLabelKey('telegram', shareFor('telegram', { text: 'Hello' })), 'share.copyOpen.telegram');
  });

  it('words too long for an address fall back to copy and open', () => {
    assert.equal(shareLabelKey('x', shareFor('x', { text: words(8000) })), 'share.copyOpen.x');
  });

  it('an unknown network has no button', () => {
    assert.equal(shareLabelKey('myspace', null), null);
  });
});

describe('days and times as the chip reads them', () => {
  it('a day in this year: "Wed 21 Oct" and "21 Ekim Çar"', () => {
    assert.equal(dayText('2026-10-21', 'en', '2026-01-01'), 'Wed 21 Oct');
    assert.equal(dayText('2026-10-21', 'tr', '2026-12-31'), '21 Ekim Çar');
  });

  it('a day in another year says its year', () => {
    assert.match(dayText('2027-01-04', 'en', '2026-10-21'), /2027/u);
    assert.match(shortDayText('2025-12-31', 'tr', '2026-01-01'), /2025/u);
    assert.equal(shortDayText('2026-10-21', 'en', '2026-10-21'), '21 Oct');
    assert.equal(shortDayText('2026-10-21', 'tr', '2026-10-21'), '21 Ekim');
  });

  it('anything that is not a day reads as nothing', () => {
    assert.equal(dayText('2026-02-30', 'en', '2026-01-01'), '');
    assert.equal(dayText(null, 'en'), '');
  });

  it('a time: "18:30", in Turkish "18.30"', () => {
    assert.equal(timeText('18:30', 'en'), '18:30');
    assert.equal(timeText('18:30', 'tr'), '18.30');
    assert.equal(timeText('24:00', 'en'), '');
  });

  it('reads a typed time at each edge of the clock', () => {
    assert.deepEqual(readTimeText('00:00'), { ok: true, value: '00:00' });
    assert.deepEqual(readTimeText('23:59'), { ok: true, value: '23:59' });
    assert.deepEqual(readTimeText('24:00'), { ok: false });
    assert.deepEqual(readTimeText('18:60'), { ok: false });
    assert.deepEqual(readTimeText('18:59'), { ok: true, value: '18:59' });
  });

  it('reads the ways people write a time, and empty clears it', () => {
    assert.deepEqual(readTimeText('18.30'), { ok: true, value: '18:30' });
    assert.deepEqual(readTimeText(' 9:05 '), { ok: true, value: '09:05' });
    assert.deepEqual(readTimeText('1830'), { ok: true, value: '18:30' });
    assert.deepEqual(readTimeText(''), { ok: true, value: null });
    assert.deepEqual(readTimeText('evening'), { ok: false });
    assert.deepEqual(readTimeText('183'), { ok: false });
    assert.deepEqual(readTimeText(1830), { ok: false });
  });

  it("a day goes to the kit's calendar and back unchanged", () => {
    for (const day of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) {
      assert.equal(dayOfDate(dateOfDay(day)), day);
    }
    assert.equal(dateOfDay('2026-13-01'), undefined);
    assert.equal(dayOfDate(new Date(Number.NaN)), null);
  });

  it('a saved instant reads as its day on this computer', () => {
    const at = new Date(2026, 9, 21, 23, 59).toISOString();
    assert.equal(dayOfInstant(at), '2026-10-21');
    assert.equal(dayOfInstant(null), null);
    assert.equal(dayOfInstant('not a time'), null);
  });
});

describe('isRemembrance: a day of remembrance among the days the person shows', () => {
  it('10 November is one; the days on each side are not', () => {
    assert.equal(isRemembrance('2026-11-10', { showDays: 'both', hidden: [] }), true);
    assert.equal(isRemembrance('2026-11-09', { showDays: 'both', hidden: [] }), false);
    assert.equal(isRemembrance('2026-11-11', { showDays: 'both', hidden: [] }), false);
  });

  it('not when the person shows only world days or hid it', () => {
    assert.equal(isRemembrance('2026-11-10', { showDays: 'world', hidden: [] }), false);
    assert.equal(isRemembrance('2026-11-10', { showDays: 'tr', hidden: ['ataturkDay'] }), false);
    assert.equal(isRemembrance(null), false);
  });
});

describe('withLinkSentence: the fix for a link that cannot be pressed', () => {
  it('takes the address out and puts the sentence at the end', () => {
    assert.equal(withLinkSentence('Saturday class.\nhttps://example.com/book', 'Link in profile.'), 'Saturday class. Link in profile.');
    assert.equal(withLinkSentence('See you Saturday. https://example.com', 'Link in profile.'), 'See you Saturday. Link in profile.');
    assert.equal(withLinkSentence('Come by https://example.com', 'Link in profile.'), 'Come by\n\nLink in profile.');
  });

  it('keeps the words as they are with no sentence saved, and never adds it twice', () => {
    assert.equal(withLinkSentence('Go to https://example.com', ''), 'Go to https://example.com');
    assert.equal(withLinkSentence('Link in profile. https://example.com', 'Link in profile.'), 'Link in profile.');
  });
});

describe('the results form', () => {
  it('reads a count at its edges', () => {
    assert.deepEqual(readCountText(''), { ok: true, value: null });
    assert.deepEqual(readCountText('0'), { ok: true, value: 0 });
    assert.deepEqual(readCountText(String(LIMITS.result)), { ok: true, value: LIMITS.result });
    assert.deepEqual(readCountText(String(LIMITS.result + 1)), { ok: false });
    assert.deepEqual(readCountText('-1'), { ok: false });
    assert.deepEqual(readCountText('12.5'), { ok: false });
  });

  it('reads groups of three as people write them', () => {
    assert.deepEqual(readCountText('1.200'), { ok: true, value: 1200 });
    assert.deepEqual(readCountText('1,200'), { ok: true, value: 1200 });
    assert.deepEqual(readCountText('1 200 000'), { ok: true, value: 1200000 });
    assert.deepEqual(readCountText('1,20'), { ok: false });
  });

  it('names the field that cannot be read, else answers what the app takes', () => {
    const form = { views: '1.200', likes: '', comments: '3', shares: '0', saves: '', clicks: '7', resultNote: ' Good week ' };
    assert.deepEqual(readResultsForm(form), {
      ok: true,
      value: { views: 1200, likes: null, comments: 3, shares: 0, saves: null, clicks: 7, resultNote: 'Good week' },
    });
    assert.deepEqual(readResultsForm({ ...form, saves: 'many' }), { ok: false, field: 'saves', problem: 'refuse.number' });
  });

  it('shows a saved count, and nothing for none', () => {
    assert.equal(countFieldText(0), '0');
    assert.equal(countFieldText(1200), '1200');
    assert.equal(countFieldText(null), '');
  });
});

describe('which network the preview shows', () => {
  const versions = [{ network: 'instagram', sharedAt: '2026-10-21T10:00:00.000Z' }, { network: 'x', sharedAt: null }];

  it('opens on the first network not shared yet', () => {
    assert.equal(firstNetwork(['instagram', 'x', 'whatsapp'], versions), 'x');
    assert.equal(firstNetwork(['instagram'], versions), 'instagram');
    assert.equal(firstNetwork([], versions), null);
  });

  it('keeps the one shown while it is still one of the post\'s networks', () => {
    assert.equal(keepNetwork('instagram', ['instagram', 'x'], versions), 'instagram');
    assert.equal(keepNetwork('facebook', ['instagram', 'x'], versions), 'x');
    assert.equal(keepNetwork(null, ['instagram', 'x'], versions), 'x');
  });

  it('a network with nothing saved shows empty words, switched on', () => {
    assert.deepEqual(versionOf({ versions: [] }, 'x'), emptyVersion('x'));
    assert.equal(versionOf({ versions: [{ network: 'x', text: 'Hi' }] }, 'x').text, 'Hi');
  });
});

describe('shapes, colours and lists', () => {
  it('each network shows its own shape', () => {
    assert.equal(shapeOf('instagram'), 'portrait');
    assert.equal(shapeOf('x'), 'landscape');
    assert.equal(shapeOf('tiktok'), 'story');
    assert.equal(shapeOf('myspace'), 'square');
    assert.equal(aspectOf('portrait'), 'aspect-[4/5]');
    assert.equal(aspectOf('round'), 'aspect-square');
  });

  it('a theme colour from 0 to 4 has its colour class; others none', () => {
    assert.equal(themeBackground(0), 'bg-chart-1');
    assert.equal(themeBackground(4), 'bg-chart-5');
    assert.equal(themeBackground(5), null);
    assert.equal(themeBackground(-1), null);
    assert.equal(themeBackground(null), null);
  });

  it('names a list of networks as a sentence', () => {
    assert.equal(listNames(['Instagram', 'X'], 'en'), 'Instagram and X');
    assert.equal(listNames(['Instagram', 'X'], 'tr'), 'Instagram ve X');
    assert.equal(listNames(['Instagram'], 'en'), 'Instagram');
  });

  it("offers the campaigns not done, and the post's own one", () => {
    const campaigns = [{ id: 1, status: 'done' }, { id: 2, status: 'running' }, { id: 3, status: 'planned' }, { id: 4, status: 'done' }];
    assert.deepEqual(campaignChoices(campaigns, 4).map((item) => item.id), [2, 3, 4]);
    assert.deepEqual(campaignChoices(campaigns, null).map((item) => item.id), [2, 3]);
  });
});

describe('keeping the post as the app answered it', () => {
  const full = {
    post: { id: 1 },
    versions: [{ network: 'instagram', text: 'Old' }],
    pictures: [{ id: 1, chosen: true }, { id: 2, chosen: false }],
  };

  it('a saved version takes its place, or joins', () => {
    assert.deepEqual(withVersion(full, { network: 'instagram', text: 'New' }).versions, [{ network: 'instagram', text: 'New' }]);
    assert.equal(withVersion(full, { network: 'x', text: 'Hi' }).versions.length, 2);
  });

  it('a picture takes its place or joins; a chosen one unchooses the rest', () => {
    assert.deepEqual(withPicture(full, { id: 2, chosen: false, description: 'Mugs' }).pictures[1], { id: 2, chosen: false, description: 'Mugs' });
    const added = withPicture(full, { id: 3, chosen: true });
    assert.deepEqual(added.pictures.map((item) => [item.id, item.chosen]), [[1, false], [2, false], [3, true]]);
    assert.equal(withPicture(full, null), full);
  });
});

describe('numberText', () => {
  it('groups a count as each language writes it', async () => {
    const { numberText } = await import('../app/posts/[id]/rules.js');
    assert.equal(numberText(2200, 'en'), '2,200');
    assert.equal(numberText(2200, 'tr'), '2.200');
    assert.equal(numberText(0, 'en'), '0');
  });
});

describe('Make my post rests with the reason when the post goes to no network', () => {
  it('My plan has no networks: a link to My plan', () => {
    assert.deepEqual(makeRest({ networks: [], goesTo: [] }), { key: 'maker.noNetworks', href: '/plan' });
    assert.deepEqual(makeRest({ networks: ['myspace'], goesTo: [] }), { key: 'maker.noNetworks', href: '/plan' });
    assert.deepEqual(makeRest({ networks: undefined, goesTo: [] }), { key: 'maker.noNetworks', href: '/plan' });
  });

  it('every network switched off for this post: the post’s own menu', () => {
    assert.deepEqual(makeRest({ networks: ['instagram'], goesTo: [] }), { key: 'maker.allOff' });
  });

  it('one network is enough to press it', () => {
    assert.equal(makeRest({ networks: ['instagram', 'x'], goesTo: ['x'] }), null);
  });
});

describe('"No words yet" and "Choose a picture" wait for the post to start', () => {
  const checks = checksFor({ network: 'instagram', text: '' });

  it('a new post shows neither', () => {
    assert.deepEqual(checks.map((check) => check.key), ['check.noWords', 'check.needsPicture']);
    assert.deepEqual(shownChecks(checks, false), []);
  });

  it('once started (words, or Make my post answered) both show, and the other checks always show', () => {
    assert.deepEqual(shownChecks(checks, true), checks);
    const marks = checksFor({ network: 'tiktok', text: '', day: '2026-10-01', today: '2026-10-21', remembrance: true });
    assert.deepEqual(shownChecks(marks, false).map((check) => check.key), ['check.needsVideo', 'check.dayPassed', 'check.remembrance']);
    assert.deepEqual(shownChecks(null, true), []);
  });

  it('the post has words when its own words or any network’s words are more than spaces', () => {
    assert.equal(hasWords({ post: { mainText: '' }, versions: [] }), false);
    assert.equal(hasWords({ post: { mainText: '  ' }, versions: [{ text: ' ' }] }), false);
    assert.equal(hasWords({ post: { mainText: 'A mug' }, versions: [] }), true);
    assert.equal(hasWords({ post: { mainText: '' }, versions: [{ network: 'x', text: 'Hi' }] }), true);
    assert.equal(hasWords(null), false);
  });
});

describe('the "replace your changes?" answer', () => {
  it('Replace sends all, Keep my changes sends untouched, a first press asks nothing', () => {
    assert.deepEqual(makeBody('Words', 'all'), { text: 'Words', replace: 'all' });
    assert.deepEqual(makeBody('Words', 'untouched'), { text: 'Words', replace: 'untouched' });
    assert.deepEqual(makeBody('Words'), { text: 'Words' });
    assert.deepEqual(makeBody('Words', null), { text: 'Words' });
    assert.deepEqual(makeBody('Words', true), { text: 'Words' }, 'only the two answers are sent');
  });
});

describe('the preview’s words editor saves only what changed', () => {
  const version = { text: 'Paint a mug.', hashtags: '#mug #çay', link: 'https://blueclay.example/', firstComment: '' };
  const saved = editorFields(version);
  const draft = (fields = {}) => ({ text: version.text, hashtags: version.hashtags, link: version.link, firstComment: '', ...fields });

  it('the words as kept say nothing new: no save', () => {
    assert.equal(editorChanged(editorBody(draft()).body, saved), false);
    assert.equal(editorChanged(editorBody(draft({ text: 'Paint a mug.\r\n', hashtags: 'mug çay' })).body, saved), false, 'line ends, spaces and the # mark are as kept');
    assert.equal(editorChanged(editorBody(draft({ link: 'https://blueclay.example' })).body, saved), false, 'the link in its kept form');
  });

  it('one letter more in any field is a change', () => {
    assert.equal(editorChanged(editorBody(draft({ text: 'Paint a mug!' })).body, saved), true);
    assert.equal(editorChanged(editorBody(draft({ hashtags: '#mug' })).body, saved), true);
    assert.equal(editorChanged(editorBody(draft({ firstComment: 'Book now' })).body, saved), true);
    assert.equal(editorChanged(editorBody(draft({ link: 'https://blueclay.example/book' })).body, saved), true);
    assert.equal(editorChanged(editorBody(draft({ link: '' })).body, saved), true, 'clearing the link is a change');
  });

  it('a link that does not read stays out of the save, with its reason; the words still save', () => {
    const read = editorBody(draft({ text: 'New words', link: 'http://blueclay.example' }));
    assert.equal(read.linkProblem, 'refuse.link');
    assert.equal(Object.hasOwn(read.body, 'link'), false);
    assert.equal(read.body.text, 'New words');
    assert.equal(editorChanged(read.body, saved), true);
    assert.equal(editorChanged(editorBody(draft({ link: 'https://' })).body, saved), false, 'only the link differs, and it cannot be sent yet');
    assert.equal(editorBody(draft({ link: '  ' })).linkProblem, null);
    assert.deepEqual(editorBody(draft()).body.hashtags, ['#mug', '#çay']);
  });
});

describe('Save picture: one press', () => {
  const kept = { id: 3, source: 'photo', original: 'abc', shapes: { portrait: 'aaaaaaaaaaaa' } };

  it('a kept copy downloads; a missing one is made in the same press; a refused card rests; nothing to draw shows nothing', () => {
    assert.equal(saveStep(kept, 'portrait'), 'file');
    assert.equal(saveStep(kept, 'square'), 'draw');
    assert.equal(saveStep({ id: 4, source: 'words', words: 'Hi', shapes: {} }, 'square'), 'draw');
    assert.equal(saveStep({ id: 5, source: 'card', card: null, cardRefused: true, shapes: { square: 'bbbbbbbbbbbb' } }, 'square'), 'refused');
    assert.equal(saveStep({ id: 6, source: 'photo', original: null, shapes: {} }, 'square'), 'none');
    assert.equal(saveStep(null, 'square'), 'none');
  });

  it('the download starts only while the press still counts', () => {
    assert.equal(pressStillCounts({ isActive: true }, 9000), true, 'the browser says so');
    assert.equal(pressStillCounts({ isActive: false }, 10), false, 'the browser says no');
    assert.equal(pressStillCounts(undefined, PRESS_STILL_COUNTS_MS - 1), true);
    assert.equal(pressStillCounts(undefined, PRESS_STILL_COUNTS_MS), false);
    assert.equal(pressStillCounts({}, -1), false);
    assert.equal(pressStillCounts(null, Number.NaN), false);
  });
});

describe('sending: a save as the person leaves goes on after the page', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('keepalive up to the browser’s limit, an ordinary request past it, never on an ordinary save', async () => {
    const seen = [];
    globalThis.fetch = async (address, init) => {
      seen.push(init.keepalive);
      return Response.json({ version: { network: 'x' } });
    };
    assert.equal((await send('/api/posts/1/versions/x', 'PUT', { text: 'Hi' }, { keepalive: true })).ok, true);
    await send('/api/posts/1/versions/x', 'PUT', { text: 'ğ'.repeat(29_990) }, { keepalive: true });
    await send('/api/posts/1/versions/x', 'PUT', { text: 'ğ'.repeat(30_000) }, { keepalive: true });
    await send('/api/posts/1/versions/x', 'PUT', { text: 'Hi' });
    assert.deepEqual(seen, [true, true, false, false]);
  });

  it('one helper for every page: a refusal is its key and field; no readable answer is the caller\'s words', async () => {
    const refusal = { problem: 'refuse.link', field: 'link' };
    globalThis.fetch = async () => Response.json(refusal, { status: 400 });
    assert.deepEqual(await send('/api/plan', 'PUT', {}), { ok: false, ...refusal, value: refusal });
    globalThis.fetch = async () => Response.json({ problem: 'Something broke.' }, { status: 500 });
    assert.equal((await send('/api/plan', 'PUT', {})).problem, 'error.saveFailed');
    globalThis.fetch = async () => new Response('not words', { status: 200 });
    assert.equal((await send('/api/plan', 'PUT', {})).problem, 'error.saveFailed');
    assert.equal((await sendUnconfirmed('/api/posts', 'POST', {})).problem, 'error.saveUnconfirmed');
    assert.equal((await sendUnconfirmed('/api/posts/1', 'GET')).problem, 'error.storageUnreadable');
    globalThis.fetch = async () => {
      throw new TypeError('offline');
    };
    assert.equal((await send('/api/plan', 'PUT', {})).problem, 'error.saveFailed');
    assert.equal((await sendUnconfirmed('/api/campaigns', 'POST', {})).problem, 'error.saveUnconfirmed');
    assert.equal((await sendUnconfirmed('/api/campaigns/1', 'GET')).problem, 'error.storageUnreadable');
  });
});

describe('printing', () => {
  const saved = Object.fromEntries(['document', 'window'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value) Object.defineProperty(globalThis, name, value);
      else delete globalThis[name];
    }
  });

  it('prints once the page’s fonts are ready', async () => {
    const order = [];
    let ready;
    globalThis.document = { fonts: { ready: new Promise((resolve) => { ready = resolve; }) } };
    globalThis.window = { print: () => order.push('print') };
    const printing = printPage();
    await Promise.resolve();
    assert.deepEqual(order, []);
    order.push('fonts');
    ready();
    await printing;
    assert.deepEqual(order, ['fonts', 'print']);
  });
});

describe('the preview shows the link where the network shows it', () => {
  const link = 'https://blueclay.example/book';
  it('after the words where links can be pressed, once', () => {
    assert.equal(previewLink('x', { text: 'Words', link }), link);
    assert.equal(previewLink('x', { text: `Book: ${link}`, link }), '');
  });
  it('as its own field on Pinterest and Google; never where links cannot be pressed; never a link that is not safe', () => {
    assert.equal(previewLink('pinterest', { text: 'Words', link }), link);
    assert.equal(previewLink('google', { text: 'Words', link }), link);
    assert.equal(previewLink('instagram', { text: 'Words', link }), '');
    assert.equal(previewLink('tiktok', { text: 'Words', link }), '');
    assert.equal(previewLink('facebook', { text: 'Words', link: 'http://blueclay.example' }), '');
    assert.equal(previewLink('myspace', { text: 'Words', link }), '');
  });
  it('with the post\'s tracking on: the tracked link and the tracked words, exactly what Copy gives and the count counts', () => {
    const tracking = trackingFor({ campaignId: 2 }, { campaigns: [{ id: 2, name: 'Kış İndirimi' }], profileLink: 'https://linktr.ee/blueclay' });
    const fields = (network) => `utm_source=${network}&utm_medium=social&utm_campaign=kis-indirimi`;
    assert.equal(previewLink('facebook', { text: 'Words', link }, tracking), `${link}?${fields('facebook')}`);
    assert.equal(previewLink('facebook', { text: 'Words', link }, { ...tracking, track: false }), link, 'tracking off');
    assert.equal(previewLink('facebook', { text: 'Words', link: 'https://linktr.ee/blueclay' }, tracking), 'https://linktr.ee/blueclay', 'never the profile link');
    const version = { text: 'New mugs! https://shop.example', link, hashtags: '#clay' };
    assert.equal(previewWords('facebook', version, tracking), `New mugs! https://shop.example/?${fields('facebook')}`);
    assert.equal(previewWords('instagram', version, tracking), version.text, 'where links cannot be pressed: as written');
    // The preview, read top to bottom (words, link line, hashtags), is the copied text.
    const shown = [previewWords('facebook', version, tracking), previewLink('facebook', version, tracking), version.hashtags].join('\n\n');
    assert.equal(shown, sharedWords('facebook', version, tracking));
  });
});

describe('the post maker page reads one records function at a time', () => {
  // Inside Tellop a request may hold at most 4 records calls unanswered at once; the page keeps well under it.
  const ACTION = Symbol.for('tellop.internalRecordsAction');
  const startedIn = process.cwd();
  let scratch;

  before(() => {
    scratch = mkdtempSync(path.join(os.tmpdir(), 'maker-page-checks-'));
    process.chdir(path.join(import.meta.dirname, '..'));
    process.env.APP_DATA_FILE = path.join(scratch, 'app.db');
  });

  after(async () => {
    const { closeStorage } = await import('../lib/data/index.js');
    await closeStorage();
    process.chdir(startedIn);
    delete process.env.APP_DATA_FILE;
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Runs `work` counting the records calls unanswered at the same moment; answers `{ value, most }`. */
  async function inFlight(work) {
    const inner = globalThis[ACTION];
    let now = 0;
    let most = 0;
    globalThis[ACTION] = async (steps) => {
      now += 1;
      most = Math.max(most, now);
      try {
        return await inner(steps);
      } finally {
        now -= 1;
      }
    };
    const value = await work();
    return { value, most };
  }

  it('at most 2 calls in flight and at most 10 calls; a post that is not there reads nothing more', async () => {
    const { OWNER } = await import('../lib/plan/owner.js');
    const { createPostFor } = await import('../lib/data/posts.js');
    const { addCampaignFor } = await import('../lib/data/campaigns.js');
    const { readMakerPage } = await import('../app/posts/[id]/read.js');
    const { bounded, measured } = await import('./records-bounds.mjs');
    const post = await createPostFor(OWNER, { name: 'Paint your own mug' });
    await addCampaignFor(OWNER, { name: 'Autumn classes', startsOn: '2026-10-01', endsOn: '2026-11-30' });

    const opened = await measured(() => inFlight(() => readMakerPage(OWNER, post.id, '2026-10-21')));
    bounded(opened, 'the post maker page', 10);
    assert.ok(opened.value.most <= 2, `${opened.value.most} records calls in flight at once`);
    assert.equal(opened.value.value.full.post.id, post.id);
    assert.equal(opened.value.value.campaigns.length, 1);
    assert.equal(typeof opened.value.value.linkSentence, 'string');

    const missing = await measured(() => inFlight(() => readMakerPage(OWNER, post.id + 1000, '2026-10-21')));
    assert.equal(missing.value.value, null, 'a post that is not there is a "not found" page');
    assert.ok(missing.calls.length <= 2, `${missing.calls.length} calls for a post that is not there`);
  });
});

// ---- wave 1: scheduled, sets in the share steps, the video plan ----

describe('Mark scheduled: where a version stands', () => {
  const now = Date.parse('2026-10-22T09:00:00.000Z');
  it('not marked is open; a moment still ahead is scheduled; at or before now it is shared', () => {
    assert.equal(shareMark({ sharedAt: null }, now), 'open');
    assert.equal(shareMark({ sharedAt: '' }, now), 'open');
    assert.equal(shareMark(undefined, now), 'open');
    assert.equal(shareMark({ sharedAt: '2026-10-22T09:00:00.001Z' }, now), 'scheduled');
    assert.equal(shareMark({ sharedAt: '2026-10-22T09:00:00.000Z' }, now), 'shared', 'its moment has come: the platform posted it');
    assert.equal(shareMark({ sharedAt: '2026-10-21T18:30:00.000Z' }, now), 'shared');
  });

  it('a scheduled moment reads as this computer’s day and clock time', () => {
    const at = new Date(2026, 9, 25, 18, 30).toISOString();
    assert.deepEqual(localWhen(at), { day: '2026-10-25', time: '18:30' });
    assert.deepEqual(localWhen(new Date(2026, 0, 1, 0, 5).toISOString()), { day: '2026-01-01', time: '00:05' });
    for (const value of ['', 'soon', null, 12, undefined]) assert.equal(localWhen(value), null, String(value));
  });

  it('the page assumes the same time as the app keeps for a post with none', () => {
    assert.equal(SCHEDULE_TIME, KEPT_SCHEDULE_TIME);
  });

  it('the state pill counts scheduled networks beside shared ones', () => {
    const values = (shared, scheduled, of) => ({ shared: String(shared), scheduled: String(scheduled), of: String(of) });
    assert.deepEqual(stateWordsOf({ state: 'ready', shared: 0, scheduled: 0, of: 2 }), { key: 'state.ready', values: values(0, 0, 2), mark: 'ready' });
    assert.deepEqual(stateWordsOf({ state: 'scheduled', shared: 1, scheduled: 1, of: 2 }), { key: 'state.scheduled', values: values(1, 1, 2), mark: 'scheduled' });
    assert.deepEqual(stateWordsOf({ state: 'partly', shared: 1, scheduled: 0, of: 3 }), { key: 'state.partly', values: values(1, 0, 3), mark: 'partly' });
    assert.deepEqual(stateWordsOf({ state: 'partly', shared: 0, scheduled: 1, of: 3 }), { key: 'state.someScheduled', values: values(0, 1, 3), mark: 'scheduled' });
    assert.deepEqual(stateWordsOf({ state: 'partly', shared: 1, scheduled: 1, of: 3 }), { key: 'state.partlyScheduled', values: values(1, 1, 3), mark: 'partly' });
  });

  it('the maker’s state, worked out with now, reads Scheduled once every network is marked and one is ahead', () => {
    const ahead = '2026-10-25T15:30:00.000Z';
    const versions = [{ network: 'instagram', on: true, text: 'Hi', sharedAt: ahead }, { network: 'x', on: true, text: 'Hi', sharedAt: '2026-10-20T10:00:00.000Z' }];
    const state = postState({ networks: ['instagram', 'x'], versions, hasChosenPicture: true, now });
    assert.equal(state.state, 'scheduled');
    assert.equal(postState({ networks: ['instagram', 'x'], versions, hasChosenPicture: true, now: Date.parse(ahead) }).state, 'shared');
  });
});

describe('saving a set from the share steps', () => {
  const slides = (count) => Array.from({ length: count }, (_, index) => ({ id: index + 1, source: 'words', words: 'Hi', shapes: {} }));
  it('a network that takes one picture, or a set of one, saves the one picture as before', () => {
    assert.equal(slidesFor('whatsapp', slides(6)), null);
    assert.equal(slidesFor('youtube', slides(6)), null);
    assert.equal(slidesFor('instagram', slides(1)), null);
    assert.equal(slidesFor('instagram', []), null);
    assert.equal(slidesFor('not-a-network', slides(6)), null);
  });

  it('a network takes the first of the set, as many as it takes: on its most all, one more cut', () => {
    assert.equal(slidesFor('instagram', slides(2)).length, 2);
    assert.equal(slidesFor('x', slides(4)).length, 4);
    assert.deepEqual(slidesFor('x', slides(5)).map((item) => item.id), [1, 2, 3, 4]);
    assert.equal(slidesFor('instagram', slides(20)).length, 20);
  });

  it('a set rests with its reason while a card waits for its customer’s yes or a picture cannot be made', () => {
    assert.deepEqual(setSavable(slides(3), 'portrait'), { ok: true });
    assert.deepEqual(setSavable([...slides(2), { id: 9, source: 'card', cardRefused: true, card: null, shapes: {} }], 'portrait'), { ok: false, reason: 'share.setRefused' });
    const kept = { id: 8, source: 'photo', original: null, shapes: { portrait: 'aaaaaaaaaaaa' } };
    assert.deepEqual(setSavable([kept], 'portrait'), { ok: true }, 'a kept copy is enough');
    assert.deepEqual(setSavable([kept], 'square'), { ok: false, reason: 'pictures.notReady' });
  });

  it('the files in the zip sort in the set’s order and keep their kind', () => {
    assert.equal(setFileName(0, 'image/webp'), '01.webp');
    assert.equal(setFileName(8, 'image/jpeg'), '09.jpg');
    assert.equal(setFileName(9, 'image/png; charset=binary'), '10.png');
    assert.equal(setFileName(19, ''), '20.webp');
    assert.equal(setFileName(0, 'text/html'), '01.webp');
  });
});

describe('the video plan panel', () => {
  const plan = { hook: 'A plain cup an hour ago', shots: [{ what: 'Brush in paint', seconds: 3 }, { what: 'Hands painting', seconds: 8 }], onScreen: ['Paint your own mug'], cover: 'The finished mug' };
  const kept = JSON.stringify(plan);

  it('shows open for a video network or a kept plan; else behind Plan a video', () => {
    assert.deepEqual(VIDEO_NETWORKS, ['tiktok', 'youtube']);
    assert.equal(videoPanelOpen('', ['instagram', 'tiktok']), true);
    assert.equal(videoPanelOpen('', ['youtube']), true);
    assert.equal(videoPanelOpen('', ['instagram', 'x']), false);
    assert.equal(videoPanelOpen(kept, ['instagram']), true);
    assert.equal(videoPanelOpen('{not a plan', ['instagram']), false);
  });

  it('a kept plan becomes the panel’s draft and reads back as the same plan', () => {
    const draft = draftOf(kept);
    assert.deepEqual(draft.shots[1], { what: 'Hands painting', seconds: '8' });
    const read = readDraft(draft);
    assert.equal(read.ok, true);
    assert.equal(read.value, kept);
    assert.equal(draftOf(''), null);
  });

  it('seconds are whole numbers typed with digits; the plan’s reader keeps 1 to 60', () => {
    assert.equal(secondsOf(' 5 '), 5);
    for (const text of ['', '5.5', '-3', 'five', '1e1', '1234']) assert.ok(Number.isNaN(secondsOf(text)), text);
    const draft = draftOf(kept);
    const withSeconds = (seconds) => readDraft({ ...draft, shots: [{ what: 'Shot', seconds }] });
    assert.equal(withSeconds('1').ok, true);
    assert.equal(withSeconds('60').ok, true);
    assert.deepEqual(withSeconds('0'), { ok: false, problem: 'refuse.post.videoPlan' });
    assert.deepEqual(withSeconds('61'), { ok: false, problem: 'refuse.post.videoPlan' });
    assert.deepEqual(withSeconds(''), { ok: false, problem: 'refuse.post.videoPlan' });
    assert.equal(readDraft({ ...draft, shots: [{ what: '  ', seconds: '3' }] }).ok, false, 'a shot needs words');
  });

  it('a shot or a line on screen is added up to six', () => {
    const shots = (count) => ({ shots: Array.from({ length: count }, () => ({ what: 'a', seconds: '1' })), onScreen: Array.from({ length: count }, () => 'b') });
    assert.equal(canAdd(shots(5), 'shots'), true);
    assert.equal(canAdd(shots(6), 'shots'), false);
    assert.equal(canAdd(shots(5), 'onScreen'), true);
    assert.equal(canAdd(shots(6), 'onScreen'), false);
  });

  it('Copy as text holds every part with its seconds, and leaves out the parts with no words', () => {
    const text = planText(plan, 'en');
    assert.ok(text.includes('A plain cup an hour ago'));
    assert.ok(text.includes('1. Brush in paint'));
    assert.ok(text.includes('2. Hands painting'));
    assert.ok(text.includes('- Paint your own mug'));
    assert.ok(text.includes('The finished mug'));
    assert.equal(text.split('\n').at(-1), translate('maker.video.total', 'en', { n: '11' }), 'the length in all: 3 + 8 seconds');
    const bare = planText({ hook: '', shots: [{ what: 'Brush', seconds: 2 }], onScreen: [], cover: '' }, 'en');
    assert.ok(!bare.includes('- '), 'no lines on screen');
    assert.equal(bare.split('\n')[1], `1. Brush (${translate('maker.video.seconds', 'en', { n: '2' })})`);
    assert.equal(bare.split('\n').length, 4, 'shots and the length only');
    assert.equal(planText(null, 'en'), '');
  });
});
