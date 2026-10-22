import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countLine } from '../app/posts/[id]/rules.js';
import { CHECKS, checksFor, mustFixOf, wordsChecks } from '../lib/plan/checks.js';
import { countFor, hashtagText } from '../lib/plan/count.js';
import { NETWORKS, networkByKey } from '../lib/plan/networks.js';
import { fitWords } from '../lib/plan/fit.js';
import {
  linkAfterWords, safeLinkOf, shareFor, sharedWords, TRACK_SLUG_MOST, trackCampaign, trackedLink, trackedWords, trackingFor, trackSlug,
} from '../lib/plan/share.js';
import { postState } from '../lib/plan/state.js';

const LINK = 'https://blueclay.example/book';
const keysOf = (checks) => checks.map((check) => check.key);
const pressable = NETWORKS.filter((item) => item.links === 'pressable').map((item) => item.key);
const notInWords = NETWORKS.filter((item) => item.links !== 'pressable').map((item) => item.key);

describe('sharedWords: the words a network carries, with the link where links can be pressed', () => {
  it('words, a blank line and the link, then a blank line and the hashtags, on every network where links can be pressed', () => {
    assert.deepEqual(pressable, ['facebook', 'linkedin', 'x', 'threads', 'bluesky', 'youtube', 'whatsapp', 'telegram']);
    for (const network of pressable) {
      assert.equal(sharedWords(network, { text: 'Paint a mug.', hashtags: '#mug #çay', link: LINK }), `Paint a mug.\n\n${LINK}\n\n#mug #çay`, network);
    }
  });

  it('never in the words where a link cannot be pressed or has a field of its own', () => {
    assert.deepEqual(notInWords, ['instagram', 'tiktok', 'pinterest', 'google']);
    for (const network of notInWords) {
      assert.equal(sharedWords(network, { text: 'Paint a mug.', hashtags: '#mug', link: LINK }), 'Paint a mug.\n\n#mug', network);
    }
  });

  it('each part is left out when empty', () => {
    assert.equal(sharedWords('x', { text: 'Words', link: LINK }), `Words\n\n${LINK}`);
    assert.equal(sharedWords('x', { text: '', hashtags: '#a', link: LINK }), `${LINK}\n\n#a`);
    assert.equal(sharedWords('x', { text: 'Words', hashtags: ['#a', '#b'] }), 'Words\n\n#a #b');
    assert.equal(sharedWords('x', {}), '');
  });

  it('only a safe https link, in its kept form; anything else is as if there were none', () => {
    assert.equal(sharedWords('x', { text: 'Words', link: 'https://blueclay.example' }), 'Words\n\nhttps://blueclay.example/');
    for (const link of ['http://blueclay.example', 'javascript:alert(1)', 'blueclay.example', 'https://user@blueclay.example', 'https://:pw@blueclay.example', 42, null]) {
      assert.equal(sharedWords('x', { text: 'Words', link }), 'Words', String(link));
    }
  });

  it('a link the words already hold is not added again (as written, with www., or in its kept form)', () => {
    assert.equal(sharedWords('x', { text: `Book: ${LINK}.`, link: LINK }), `Book: ${LINK}.`);
    assert.equal(sharedWords('x', { text: 'Book: https://blueclay.example', link: 'https://blueclay.example/' }), 'Book: https://blueclay.example');
    assert.equal(sharedWords('x', { text: 'Book: www.blueclay.example/book', link: 'https://www.blueclay.example/book' }), 'Book: www.blueclay.example/book');
    // Another address in the words is not this link: the link still goes after them.
    assert.equal(sharedWords('x', { text: 'See https://other.example', link: LINK }), `See https://other.example\n\n${LINK}`);
    assert.equal(linkAfterWords('x', `Book: ${LINK}/more`, LINK), LINK);
  });

  it('Windows line ends in the words read as one line end; an unknown network adds no link', () => {
    assert.equal(sharedWords('x', { text: 'One\r\nTwo', link: LINK }), `One\nTwo\n\n${LINK}`);
    assert.equal(sharedWords('myspace', { text: 'Words', link: LINK }), 'Words');
    assert.equal(safeLinkOf(LINK), LINK);
    assert.equal(safeLinkOf('http://a.example'), '');
    assert.equal(hashtagText([' #a', 3, '#b ']), '#a #b');
    assert.equal(hashtagText(7), '');
  });
});

describe('shareFor: the copied words and the share address carry the link', () => {
  const version = { text: 'Paint your own mug & tea? 50% off', hashtags: '#mug #çay', link: LINK };
  const copyText = `Paint your own mug & tea? 50% off\n\n${LINK}\n\n#mug #çay`;

  it('X, Threads, Bluesky and WhatsApp: the address carries the words with the link', () => {
    for (const network of ['x', 'threads', 'bluesky', 'whatsapp']) {
      const share = shareFor(network, version);
      assert.equal(share.kind, 'address', network);
      assert.equal(share.copyText, copyText, network);
      assert.equal(new URL(share.address).searchParams.get('text'), copyText, network);
    }
  });

  it('Telegram: the link in its own place, the words and hashtags beside it; the copy holds all three', () => {
    const share = shareFor('telegram', version);
    assert.equal(share.kind, 'address');
    assert.equal(share.copyText, copyText);
    const address = new URL(share.address);
    assert.equal(address.searchParams.get('url'), LINK);
    assert.equal(address.searchParams.get('text'), 'Paint your own mug & tea? 50% off\n\n#mug #çay');
  });

  it('Facebook, LinkedIn and YouTube: the copied words hold the link', () => {
    for (const network of ['facebook', 'linkedin', 'youtube']) assert.equal(shareFor(network, version).copyText, copyText, network);
    assert.equal(new URL(shareFor('facebook', version).address).searchParams.get('u'), LINK);
  });

  it('Instagram, TikTok, Pinterest and Google: the copied words never hold it', () => {
    for (const network of notInWords) assert.equal(shareFor(network, version).copyText, 'Paint your own mug & tea? 50% off\n\n#mug #çay', network);
  });
});

describe('the count and the checks count the link as the network does', () => {
  const a = (n) => 'a'.repeat(n);

  it('X counts the link 23 after a blank line: 255 letters fit, 256 are over', () => {
    const long = `https://blueclay.example/${'p'.repeat(200)}`;
    assert.equal(countFor('x', sharedWords('x', { text: a(255), link: long })), 280);
    assert.deepEqual(countLine('x', { text: a(255), link: long }), { count: 280, limit: 280, over: false });
    assert.deepEqual(countLine('x', { text: a(256), link: long }), { count: 281, limit: 280, over: true });
    assert.ok(!keysOf(checksFor({ network: 'x', text: a(255), link: long })).includes('check.overLimit'));
    assert.ok(keysOf(checksFor({ network: 'x', text: a(256), link: long })).includes('check.overLimit'));
    assert.deepEqual(mustFixOf({ network: 'x', text: a(256), link: long }), { mustFix: true, mustFixWithPicture: true }, 'the records keep the same answer');
    assert.deepEqual(mustFixOf({ network: 'x', text: a(255), link: long }), { mustFix: false, mustFixWithPicture: false });
  });

  it('Bluesky counts the whole link: one letter more is over', () => {
    const limit = networkByKey('bluesky').limit;
    const room = limit - LINK.length - 2;
    assert.deepEqual(countLine('bluesky', { text: a(room), link: LINK }), { count: limit, limit, over: false });
    assert.ok(keysOf(wordsChecks({ network: 'bluesky', text: a(room + 1), link: LINK })).includes('check.overLimit'));
    assert.ok(!keysOf(wordsChecks({ network: 'bluesky', text: a(room), link: LINK })).includes('check.overLimit'));
  });

  it('where a link cannot be pressed it is not counted; nor is a link that is not safe', () => {
    assert.equal(countLine('instagram', { text: a(2200), link: LINK }).count, 2200);
    assert.equal(countLine('x', { text: a(280), link: 'http://blueclay.example' }).count, 280);
    assert.ok(keysOf(checksFor({ network: 'x', text: 'Words', link: 'http://blueclay.example' })).includes('check.badLink'));
  });

  it('a link the words already hold is counted once', () => {
    assert.equal(countLine('x', { text: `${a(255)} ${LINK}`, link: LINK }).count, 279);
  });
});

describe('a comment card whose customer has not said yes', () => {
  const refused = { source: 'card', card: null, cardRefused: true, description: '' };

  it('is a must-fix line, after the picture check, and asks for no description', () => {
    assert.deepEqual(CHECKS.cardRefused, { key: 'check.cardRefused', level: 'must' });
    assert.deepEqual(checksFor({ network: 'facebook', text: 'Words', chosenPicture: refused }), [{ key: 'check.cardRefused', level: 'must' }]);
    assert.deepEqual(keysOf(checksFor({ network: 'x', text: '', link: 'http://a.example', chosenPicture: refused })), ['check.noWords', 'check.cardRefused', 'check.badLink']);
    assert.ok(!keysOf(checksFor({ network: 'instagram', text: 'Words', chosenPicture: refused })).includes('check.needsPicture'));
  });

  it('a card the customer said yes to is no check', () => {
    const card = { source: 'card', card: { bestLine: 'Lovely', text: 'Lovely', name: 'Ayşe', stars: 5 }, cardRefused: false, description: 'A card' };
    assert.deepEqual(checksFor({ network: 'facebook', text: 'Words', chosenPicture: card }), []);
  });

  it('holds the post back from Ready in the maker; a tile, which never reads comments, does not pass it', () => {
    const post = { networks: ['facebook'], versions: [{ network: 'facebook', on: true, text: 'Words' }], hasChosenPicture: true };
    assert.equal(postState(post).state, 'ready');
    assert.equal(postState({ ...post, pictureRefused: false }).state, 'ready');
    assert.equal(postState({ ...post, pictureRefused: true }).state, 'draft');
    assert.equal(postState({ ...post, hasChosenPicture: false, pictureRefused: true }).state, 'ready', 'only a chosen picture can be refused');
    assert.equal(postState({ ...post, versions: [{ ...post.versions[0], sharedAt: '2026-10-21T10:00:00.000Z' }], pictureRefused: true }).state, 'shared');
  });
});

describe('tracking: the shared link says which platform and campaign a visit came from', () => {
  const ON = { track: true, campaign: 'Kış İndirimi', theme: 'Tips' };
  const fields = (network, campaign) => `utm_source=${network}&utm_medium=social&utm_campaign=${campaign}`;

  it('the campaign part: ASCII lowercase with hyphens, Turkish letters folded, marks off, at most 40, no hyphen at an end', () => {
    assert.equal(trackSlug('Kış İndirimi'), 'kis-indirimi');
    assert.equal(trackSlug('ÇAĞRI ÖĞLE ŞÜKÜR ığüşöç'), 'cagri-ogle-sukur-igusoc');
    assert.equal(trackSlug('Café Été 2026!'), 'cafe-ete-2026');
    assert.equal(trackSlug('  --Spring   sale--  '), 'spring-sale');
    assert.equal(trackSlug('春のセール'), '', 'nothing left in another script');
    assert.equal(trackSlug(null), '');
    assert.equal(TRACK_SLUG_MOST, 40);
    for (const length of [39, 40, 41]) assert.equal(trackSlug('a'.repeat(length)), 'a'.repeat(Math.min(length, 40)), String(length));
    assert.equal(trackSlug(`${'a'.repeat(39)} b`), 'a'.repeat(39), 'a hyphen left at the cut goes');
  });

  it('the campaign\'s name, else the theme\'s, else "post"', () => {
    assert.equal(trackCampaign({ campaign: 'Kış İndirimi', theme: 'Tips' }), 'kis-indirimi');
    assert.equal(trackCampaign({ campaign: '', theme: 'Glaze tips' }), 'glaze-tips');
    assert.equal(trackCampaign({ campaign: '春のセール', theme: 'Glaze tips' }), 'glaze-tips', 'a campaign name that leaves nothing');
    assert.equal(trackCampaign({}), 'post');
  });

  it('adds the three fields after the link\'s own query and before its # part', () => {
    assert.equal(trackedLink('instagram', LINK, ON), `${LINK}?${fields('instagram', 'kis-indirimi')}`);
    assert.equal(trackedLink('x', 'https://blueclay.example/book?day=2#top', ON), `https://blueclay.example/book?day=2&${fields('x', 'kis-indirimi')}#top`);
    assert.equal(trackedLink('x', 'https://blueclay.example/book?', ON), `https://blueclay.example/book?${fields('x', 'kis-indirimi')}`);
  });

  it('never on a link that carries a utm_ field already (any case), one that is not safe https, an unknown network, or with tracking off', () => {
    for (const link of [`${LINK}?utm_source=mail`, `${LINK}?a=1&UTM_Campaign=x`, `${LINK}?utm_=1`]) assert.equal(trackedLink('x', link, ON), link, link);
    assert.equal(trackedLink('x', `${LINK}?utmost=1`, ON), `${LINK}?utmost=1&${fields('x', 'kis-indirimi')}`, 'utmost is not a utm_ field');
    assert.equal(trackedLink('x', 'http://blueclay.example/book', ON), '');
    assert.equal(trackedLink('myspace', LINK, ON), LINK);
    assert.equal(trackedLink('x', LINK, { ...ON, track: false }), LINK);
    assert.equal(trackedLink('x', LINK), LINK, 'left out: not tracked');
  });

  it('the shared words carry the tracked link where links can be pressed; never where links cannot be pressed', () => {
    assert.equal(sharedWords('facebook', { text: 'Paint a mug.', hashtags: '#mug', link: LINK }, ON), `Paint a mug.\n\n${LINK}?${fields('facebook', 'kis-indirimi')}\n\n#mug`);
    assert.equal(sharedWords('instagram', { text: 'Paint a mug. Link in bio: https://blueclay.example', link: LINK }, ON), 'Paint a mug. Link in bio: https://blueclay.example', 'where links cannot be pressed the words stay as written');
    assert.equal(sharedWords('x', { text: `Book: ${LINK}`, link: LINK }, ON), `Book: ${LINK}?${fields('x', 'kis-indirimi')}`, 'the words hold the link: nothing is added, the address in them is tracked in place');
    assert.equal(sharedWords('pinterest', { text: 'Words', link: LINK }, ON), 'Words');
  });

  it('an address inside the words is tracked in place on every platform where links can be pressed', () => {
    assert.equal(sharedWords('facebook', { text: 'New mugs! https://shop.example' }, ON), `New mugs! https://shop.example/?${fields('facebook', 'kis-indirimi')}`);
    assert.ok(new URL(sharedWords('facebook', { text: 'New mugs! https://shop.example' }, ON).split(' ').at(-1)).searchParams.get('utm_source') === 'facebook');
    for (const network of NETWORKS.filter((item) => item.links === 'pressable').map((item) => item.key)) {
      assert.equal(trackedWords(network, 'See https://shop.example/a.', ON), `See https://shop.example/a?${fields(network, 'kis-indirimi')}.`, network);
    }
    for (const network of NETWORKS.filter((item) => item.links !== 'pressable').map((item) => item.key)) {
      assert.equal(trackedWords(network, 'See https://shop.example/a.', ON), 'See https://shop.example/a.', `${network}: as written`);
    }
    // Two addresses, punctuation around them, one already tracked, one http and one www address: only the safe https ones change.
    const text = '(https://shop.example/b), https://shop.example/c?utm_source=mail http://shop.example/d www.shop.example/e https://shop.example/f';
    assert.equal(trackedWords('threads', text, ON), `(https://shop.example/b?${fields('threads', 'kis-indirimi')}), https://shop.example/c?utm_source=mail http://shop.example/d www.shop.example/e https://shop.example/f?${fields('threads', 'kis-indirimi')}`);
    assert.equal(trackedWords('threads', text, { ...ON, track: false }), text, 'tracking off: as written');
    assert.equal(trackedWords('threads', text), text, 'left out: as written');
    assert.equal(trackedWords('threads', '', ON), '');
  });

  it('never the person\'s profile link, in the words or as the version\'s link', () => {
    const profile = trackingFor({}, { profileLink: 'https://linktr.ee/blueclay' });
    assert.equal(profile.profile, 'https://linktr.ee/blueclay');
    const mine = { ...ON, profile: profile.profile };
    assert.equal(trackedWords('facebook', 'All links: https://linktr.ee/blueclay and https://shop.example', mine), `All links: https://linktr.ee/blueclay and https://shop.example/?${fields('facebook', 'kis-indirimi')}`);
    assert.equal(sharedWords('facebook', { text: 'Hi', link: 'https://linktr.ee/blueclay' }, mine), 'Hi\n\nhttps://linktr.ee/blueclay');
    assert.equal(trackedLink('linkedin', 'https://linktr.ee/blueclay', mine), 'https://linktr.ee/blueclay');
    assert.equal(trackedLink('linkedin', 'https://linktr.ee/blueclay/shop', mine), `https://linktr.ee/blueclay/shop?${fields('linkedin', 'kis-indirimi')}`, 'another page on the same site is tracked');
    assert.equal(trackingFor({}, { profileLink: 'http://not-safe.example' }).profile, '', 'a profile link that is not safe is none');
  });

  it('the copied words, a share address and the count agree on the tracked words', () => {
    const version = { text: 'New mugs! https://shop.example', link: '' };
    const x = shareFor('x', version, ON);
    assert.equal(x.copyText, sharedWords('x', version, ON));
    assert.equal(new URL(x.address).searchParams.get('text'), x.copyText);
    const telegram = shareFor('telegram', { ...version, link: LINK }, ON);
    assert.ok(new URL(telegram.address).searchParams.get('text').includes(`https://shop.example/?${fields('telegram', 'kis-indirimi')}`), 'the words beside the link too');
    // Bluesky counts the whole address: the words fit untracked, and the tracked address in them takes them over the limit.
    const near = { text: `${'a'.repeat(250)} https://shop.example`, link: '' };
    assert.deepEqual(countLine('bluesky', near, false, ON), { count: countFor('bluesky', sharedWords('bluesky', near, ON)), limit: 300, over: true });
    assert.notEqual(countLine('bluesky', near, false, { ...ON, track: false })?.over, true);
    assert.ok(keysOf(checksFor({ network: 'bluesky', text: near.text, tracking: ON })).includes('check.overLimit'), 'the checks count it too');
  });

  it('every share address carries the tracked link', () => {
    const version = { text: 'Paint a mug', link: LINK };
    assert.equal(new URL(shareFor('facebook', version, ON).address).searchParams.get('u'), `${LINK}?${fields('facebook', 'kis-indirimi')}`);
    assert.equal(new URL(shareFor('linkedin', version, ON).address).searchParams.get('url'), `${LINK}?${fields('linkedin', 'kis-indirimi')}`);
    assert.equal(new URL(shareFor('telegram', version, ON).address).searchParams.get('url'), `${LINK}?${fields('telegram', 'kis-indirimi')}`);
    const x = shareFor('x', version, ON);
    assert.equal(new URL(x.address).searchParams.get('text'), x.copyText);
    assert.ok(x.copyText.endsWith(fields('x', 'kis-indirimi')));
    assert.equal(shareFor('facebook', version).copyText, `Paint a mug\n\n${LINK}`, 'no tracking passed: none added');
  });

  it('the plan\'s switch: on when never set, off only when switched off; names found by id, archived themes too', () => {
    const plan = { themes: [{ id: 1, name: 'Tips' }, { id: 9, name: 'Old theme' }], campaigns: [{ id: 4, name: 'Spring sale' }] };
    assert.deepEqual(trackingFor({ campaignId: 4, themeId: 1 }, { ...plan, trackLinks: null }), { track: true, campaign: 'Spring sale', theme: 'Tips', profile: '' });
    assert.deepEqual(trackingFor({ campaignId: 4, themeId: 1 }, { ...plan, trackLinks: undefined }).track, true);
    assert.deepEqual(trackingFor({ campaignId: 4, themeId: 1 }, { ...plan, trackLinks: false }).track, false);
    assert.deepEqual(trackingFor({ campaignId: 5, themeId: 9 }, plan), { track: true, campaign: '', theme: 'Old theme', profile: '' });
    assert.deepEqual(trackingFor({ campaignId: null, themeId: null }, plan), { track: true, campaign: '', theme: '', profile: '' });
    assert.deepEqual(trackingFor(null), { track: true, campaign: '', theme: '', profile: '' });
  });

  it('the count, the checks and the fit count the tracked link: Bluesky at its limit, one over; X counts any link 23', () => {
    const limit = networkByKey('bluesky').limit;
    const tracked = trackedLink('bluesky', LINK, ON);
    const room = limit - tracked.length - 2;
    const a = (n) => 'a'.repeat(n);
    assert.deepEqual(countLine('bluesky', { text: a(room), link: LINK }, false, ON), { count: limit, limit, over: false });
    assert.deepEqual(countLine('bluesky', { text: a(room + 1), link: LINK }, false, ON), { count: limit + 1, limit, over: true });
    assert.notEqual(countLine('bluesky', { text: a(room + 1), link: LINK }, false, { ...ON, track: false })?.over, true, 'untracked, the same words fit');
    assert.ok(!keysOf(checksFor({ network: 'bluesky', text: a(room), link: LINK, tracking: ON })).includes('check.overLimit'));
    assert.ok(keysOf(checksFor({ network: 'bluesky', text: a(room + 1), link: LINK, tracking: ON })).includes('check.overLimit'));
    assert.deepEqual(mustFixOf({ network: 'bluesky', text: a(room + 1), link: LINK }, ON), { mustFix: true, mustFixWithPicture: true });
    assert.deepEqual(mustFixOf({ network: 'bluesky', text: a(room), link: LINK }, ON), { mustFix: false, mustFixWithPicture: false });
    const fitted = fitWords({ network: 'bluesky', text: `${'word '.repeat(80)}end.`, link: LINK, tracking: ON });
    assert.ok(countFor('bluesky', sharedWords('bluesky', { text: fitted.text, link: LINK }, ON)) <= limit, 'the fitted words leave room for the tracked link');
    assert.equal(countFor('x', sharedWords('x', { text: a(255), link: LINK }, ON)), 280, 'X: 23 whatever the link holds');
  });
});
