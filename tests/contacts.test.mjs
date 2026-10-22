/**
 * Contacts: the consent gate (a yes day per channel, the İYS day: no message
 * before the yes is on İYS; three business days with weekends skipped for
 * the reminder), WhatsApp's address and the email copy list, the ending every
 * copied message carries, a changed number or address dropping its yes, the
 * records functions and their addresses, "They said stop", "Add to contacts"
 * from Customers, and the page's reads inside Tellop's records bounds. A throwaway store (`APP_DATA_FILE` in a temporary folder, removed
 * afterwards); rows of another owner are written straight into the store and
 * must never be read, changed or removed. Each edge is tested on the day and
 * one each side.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'contacts-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { DataError, closeStorage, modelAction } = await import('../lib/data/index.js');
const contacts = await import('../lib/data/contacts.js');
const rules = await import('../app/contacts/rules.js');
const { readContactsPage } = await import('../app/contacts/read.js');
const { whatsAppDigits } = await import('../app/calendar/follow-ups.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { LIMITS } = await import('../lib/plan/limits.js');
const { addDays, todayCivil } = await import('../lib/plan/days.js');
const { PAGES } = await import('../lib/pages.js');
const contactsRoute = await import('../app/api/contacts/route.js');
const contactRoute = await import('../app/api/contacts/[id]/route.js');
const { bounded, measured, mostInFlight } = await import('./records-bounds.mjs');

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

const OTHER = 'another-owner';
const NOW = new Date().toISOString();
const refusedWith = (key) => (error) => {
  assert.ok(error instanceof DataError, `expected a refusal, got ${String(error)}`);
  assert.equal(error.messageKey, key);
  return true;
};

async function call(handler, { url = 'http://localhost/api/contacts', method = 'GET', body, params = {} } = {}) {
  const sent = body === undefined ? undefined : JSON.stringify(body);
  const request = new Request(url, { method, headers: sent === undefined ? {} : { 'content-type': 'application/json' }, body: sent });
  const response = await handler(request, { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

/** A contact as the list carries it. */
const person = (fields = {}) => ({ id: 1, name: 'Ayşe', phone: '+905321234567', email: 'ayse@example.com',
  whatsappConsentOn: null, emailConsentOn: null, iysOn: null, ...fields });

// --- the gate -----------------------------------------------------------------------------

// 2026-10-22 is a Thursday; 2026-10-24/25 the weekend.
test('three business days skip the weekend, from any day of the week', () => {
  assert.equal(rules.isBusinessDay('2026-10-23'), true);
  assert.equal(rules.isBusinessDay('2026-10-24'), false);
  assert.equal(rules.isBusinessDay('2026-10-25'), false);
  assert.equal(rules.iysDeadline('2026-10-22'), '2026-10-27'); // Thu -> Fri, Mon, Tue
  assert.equal(rules.iysDeadline('2026-10-23'), '2026-10-28'); // Fri -> Mon, Tue, Wed
  assert.equal(rules.iysDeadline('2026-10-24'), '2026-10-28'); // Sat -> Mon, Tue, Wed
  assert.equal(rules.iysDeadline('2026-10-25'), '2026-10-28'); // Sun -> Mon, Tue, Wed
  assert.equal(rules.iysDeadline('2026-10-26'), '2026-10-29'); // Mon -> Tue, Wed, Thu
  assert.equal(rules.iysDeadline('2026-12-31'), '2027-01-05'); // across a year: Fri 1, Mon 4, Tue 5
  assert.equal(rules.businessDaysAfter('2026-10-22', 0), '2026-10-22');
});

test('the gate: no yes rests, a yes not on İYS rests with a reminder for three business days, then the late line', () => {
  const gate = (fields, today, channel = 'whatsapp') => rules.channelGate(person(fields), channel, today);
  // No yes: rests, whatever the İYS day.
  assert.equal(gate({}, '2026-10-22').state, 'noConsent');
  assert.equal(gate({ iysOn: '2026-10-22' }, '2026-10-22').state, 'noConsent');
  // A yes after today (a clock moved back) does not count yet.
  assert.equal(gate({ whatsappConsentOn: '2026-10-23' }, '2026-10-22').state, 'noConsent');
  // A yes today, not in İYS: rests, with the reminder's last day.
  assert.deepEqual(gate({ whatsappConsentOn: '2026-10-22' }, '2026-10-22'), { state: 'remind', consentOn: '2026-10-22', deadline: '2026-10-27' });
  // Thursday's yes: the weekend does not count; Tuesday is the last day, Wednesday rests.
  assert.equal(gate({ whatsappConsentOn: '2026-10-22' }, '2026-10-25').state, 'remind');
  assert.equal(gate({ whatsappConsentOn: '2026-10-22' }, '2026-10-26').state, 'remind');
  assert.equal(gate({ whatsappConsentOn: '2026-10-22' }, '2026-10-27').state, 'remind');
  assert.deepEqual(gate({ whatsappConsentOn: '2026-10-22' }, '2026-10-28'), { state: 'late', consentOn: '2026-10-22', deadline: '2026-10-27' });
  // The İYS day filled: the yes counts for good, on the yes day and after it.
  assert.equal(gate({ whatsappConsentOn: '2026-10-22', iysOn: '2026-10-22' }, '2026-12-01').state, 'ok');
  assert.equal(gate({ whatsappConsentOn: '2026-10-22', iysOn: '2026-10-28' }, '2026-12-01').state, 'ok');
  // An İYS day before this channel's yes (it covered an earlier yes) does not cover it.
  assert.equal(gate({ whatsappConsentOn: '2026-10-22', iysOn: '2026-10-21' }, '2026-10-23').state, 'remind');
  assert.equal(gate({ whatsappConsentOn: '2026-10-22', iysOn: '2026-10-21' }, '2026-10-28').state, 'late');
  // A yes with nowhere to send.
  assert.equal(gate({ whatsappConsentOn: '2026-10-22', iysOn: '2026-10-22', phone: '' }, '2026-10-22').state, 'noAddress');
  assert.equal(gate({ emailConsentOn: '2026-10-22', iysOn: '2026-10-22', email: '' }, '2026-10-22', 'email').state, 'noAddress');
  // Each channel has its own yes.
  assert.equal(gate({ emailConsentOn: '2026-10-22', iysOn: '2026-10-22' }, '2026-10-22', 'whatsapp').state, 'noConsent');
  assert.equal(gate({ emailConsentOn: '2026-10-22', iysOn: '2026-10-22' }, '2026-10-22', 'email').state, 'ok');
  assert.equal(rules.canMessage({ state: 'ok' }), true);
  for (const state of ['remind', 'late', 'noConsent', 'noAddress']) assert.equal(rules.canMessage({ state }), false);
});

test('no message before the yes is on İYS: a yes today rests on both channels until its İYS day is filled', () => {
  const today = '2026-10-22';
  // Said yes in the shop today, not on İYS yet.
  const mehmet = person({ id: 2, name: 'Mehmet', phone: '+905339876543', email: 'mehmet@example.com', whatsappConsentOn: today, emailConsentOn: today });
  for (const channel of rules.CHANNELS) {
    assert.equal(rules.channelGate(mehmet, channel, today).state, 'remind', channel);
    assert.equal(rules.canMessage(rules.channelGate(mehmet, channel, today)), false, channel);
  }
  assert.deepEqual(rules.whatsAppQueue([mehmet], today), []);
  assert.deepEqual(rules.emailList([mehmet], today), []);
  assert.equal(rules.lateCount([mehmet], 'whatsapp', today, 'remind'), 1);
  // The İYS day a day before the yes does not cover it; on the yes day it does.
  assert.deepEqual(rules.whatsAppQueue([{ ...mehmet, iysOn: addDays(today, -1) }], today), []);
  assert.deepEqual(rules.whatsAppQueue([{ ...mehmet, iysOn: today }], today).map((item) => item.contact.id), [2]);
  assert.deepEqual(rules.emailList([{ ...mehmet, iysOn: today }], today), ['mehmet@example.com']);
  // One İYS day for both channels, checked against each channel's own yes: an email yes after it rests.
  const zeynep = person({ id: 3, phone: '+905551112233', email: 'z@example.com', whatsappConsentOn: '2026-10-20', emailConsentOn: '2026-10-21', iysOn: '2026-10-20' });
  assert.equal(rules.channelGate(zeynep, 'whatsapp', today).state, 'ok');
  assert.equal(rules.channelGate(zeynep, 'email', today).state, 'remind');
  assert.deepEqual(rules.emailList([zeynep], today), []);
});

test('WhatsApp opens one person with a yes on İYS at a time; the email copy lists only their addresses', () => {
  const today = '2026-10-28';
  const list = [
    person({ id: 1, name: 'A', phone: '+905320000001', email: 'a@example.com', whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-01', iysOn: '2026-10-02' }),
    person({ id: 2, name: 'B', phone: '+905320000002', email: 'b@example.com', whatsappConsentOn: '2026-10-22' }), // late on both
    person({ id: 3, name: 'C', phone: '+905320000003', email: 'c@example.com', whatsappConsentOn: '2026-10-26', emailConsentOn: '2026-10-26' }), // reminds
    person({ id: 4, name: 'D', phone: '+905320000001', email: 'a@example.com', whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-01', iysOn: '2026-10-01' }), // same number and address as A
    person({ id: 5, name: 'E', phone: '', email: 'e@example.com', whatsappConsentOn: '2026-10-01', iysOn: '2026-10-01' }), // no number, no email yes
    person({ id: 6, name: 'F', phone: '+905320000006', email: '', emailConsentOn: '2026-10-01', iysOn: '2026-10-01' }), // email yes, no address
  ];
  const queue = rules.whatsAppQueue(list, today);
  assert.deepEqual(queue.map((item) => item.contact.id), [1]);
  assert.deepEqual(queue.map((item) => item.gate.state), ['ok']);
  assert.deepEqual(rules.emailList(list, today), ['a@example.com']);
  assert.equal(rules.emailText(rules.emailList(list, today)), 'a@example.com');
  assert.equal(rules.emailText(['a@example.com', 'c@example.com']), 'a@example.com, c@example.com');
  assert.equal(rules.emailText([]), '');
  assert.equal(rules.lateCount(list, 'whatsapp', today), 1);
  assert.equal(rules.lateCount(list, 'email', today), 0);
  // C's yes is not on İYS yet: it rests and is counted as waiting.
  assert.equal(rules.lateCount(list, 'whatsapp', today, 'remind'), 1);
  assert.equal(rules.lateCount(list, 'email', today, 'remind'), 1);
  // One at a time: the first, the next, then nothing after the last.
  const two = rules.whatsAppQueue([...list, person({ id: 7, phone: '+905320000007', whatsappConsentOn: '2026-10-01', iysOn: '2026-10-01' })], today);
  assert.deepEqual(two.map((item) => item.contact.id), [1, 7]);
  assert.equal(rules.nextInQueue(two, null), 1);
  assert.equal(rules.nextInQueue(two, 1), 7);
  assert.equal(rules.nextInQueue(two, 7), null);
  assert.equal(rules.nextInQueue(two, 99), 1);
  assert.equal(rules.nextInQueue([], null), null);
  // WhatsApp's own address: digits only, the words written into the address.
  assert.equal(rules.contactWhatsAppAddress({ phone: '+905321234567' }, 'Merhaba Ayşe & co?\nYeni ürün'),
    'https://wa.me/905321234567?text=Merhaba%20Ay%C5%9Fe%20%26%20co%3F%0AYeni%20%C3%BCr%C3%BCn');
});

test('after a stop, the İYS day stays only while it still covers the other channel', () => {
  const both = { whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-06' };
  assert.equal(rules.iysAfterStop(both, 'whatsapp'), '2026-10-06');
  assert.equal(rules.iysAfterStop(both, 'email'), '2026-10-06');
  // The İYS day came before the email yes: it was the WhatsApp yes's, and goes with it.
  assert.equal(rules.iysAfterStop({ whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-02' }, 'whatsapp'), null);
  // On the other yes's day exactly, it stays.
  assert.equal(rules.iysAfterStop({ whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-05' }, 'whatsapp'), '2026-10-05');
  // No other yes: it goes.
  assert.equal(rules.iysAfterStop({ whatsappConsentOn: '2026-10-01', emailConsentOn: null, iysOn: '2026-10-02' }, 'whatsapp'), null);
});

test('every copied message ends with a blank line, the business’s name and how to stop', () => {
  const stop = 'To stop these messages, reply STOP.';
  assert.equal(rules.withEnding('  Spring tulips are in!\nCome by.  ', { business: ' Lale Flowers ', stop }),
    'Spring tulips are in!\nCome by.\n\nLale Flowers\nTo stop these messages, reply STOP.');
  assert.equal(rules.endingText({ business: 'Lale Flowers', stop }), 'Lale Flowers\nTo stop these messages, reply STOP.');
  // WhatsApp's address carries the whole message, ending included.
  const address = rules.contactWhatsAppAddress({ phone: '+905321234567' }, rules.withEnding('Hi', { business: 'Lale', stop: 'Bu mesajları almak istemiyorsan “DUR” yaz.' }));
  assert.equal(decodeURIComponent(new URL(address).searchParams.get('text')), 'Hi\n\nLale\nBu mesajları almak istemiyorsan “DUR” yaz.');
});

test('a kept number shows spaced: Turkish and North American ones, others as kept', () => {
  assert.equal(rules.phoneText('+905321234567'), '+90 532 123 45 67');
  assert.equal(rules.phoneText('+14155550100'), '+1 415 555 0100');
  assert.equal(rules.phoneText('+442079460958'), '+442079460958');
  assert.equal(rules.phoneText('+9053212345678'), '+9053212345678', 'one digit too many is not spaced as Turkish');
  assert.equal(rules.phoneText(''), '');
  assert.equal(rules.phoneText(null), '');
  // What the form shows reads back as the same number.
  for (const phone of ['+905321234567', '+14155550100']) assert.equal(contacts.phoneOf(rules.phoneText(phone), 'en'), phone);
});

test('a changed number or address drops that channel’s kept yes; a first one keeps it', () => {
  const kept = { phone: '+905321234567', email: 'a@example.com', whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-06' };
  const next = (fields) => rules.afterAddressChange(kept, { ...kept, ...fields });
  assert.deepEqual(next({}), { dropped: [], whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-06' });
  // A new number: the WhatsApp yes goes, even when a yes day came with it; the İYS day still covers the email yes.
  assert.deepEqual(next({ phone: '+905321234568', whatsappConsentOn: '2026-10-01' }), { dropped: ['whatsapp'], whatsappConsentOn: null, emailConsentOn: '2026-10-05', iysOn: '2026-10-06' });
  // A new address: the email yes goes.
  assert.deepEqual(next({ email: 'b@example.com' }), { dropped: ['email'], whatsappConsentOn: '2026-10-01', emailConsentOn: null, iysOn: '2026-10-06' });
  // The number taken out drops its yes too; both changed: no yes left, so the İYS day goes.
  assert.deepEqual(next({ phone: '' }).dropped, ['whatsapp']);
  assert.deepEqual(next({ phone: '+905321234568', email: 'b@example.com' }), { dropped: ['whatsapp', 'email'], whatsappConsentOn: null, emailConsentOn: null, iysOn: null });
  // The İYS day stays only while a yes left is on or before it.
  assert.equal(rules.afterAddressChange({ ...kept, iysOn: '2026-10-02' }, { ...kept, iysOn: '2026-10-02', phone: '+905321234568' }).iysOn, null);
  assert.equal(rules.afterAddressChange({ ...kept, iysOn: '2026-10-05' }, { ...kept, iysOn: '2026-10-05', phone: '+905321234568' }).iysOn, '2026-10-05');
  // A first number on a contact that had none keeps the yes; a change with no kept yes drops nothing.
  assert.deepEqual(rules.afterAddressChange({ ...kept, phone: '' }, { ...kept, phone: '+905321234568' }).dropped, []);
  assert.deepEqual(rules.afterAddressChange({ ...kept, whatsappConsentOn: null }, { ...kept, whatsappConsentOn: null, phone: '+905321234568' }).dropped, []);
});

// --- reading what the person typed -------------------------------------------------------

test('a phone number is kept as + and its digits, by the same rule WhatsApp follow-ups use', () => {
  assert.equal(contacts.phoneOf('+90 532 123 45 67', 'en'), '+905321234567');
  assert.equal(contacts.phoneOf('0090 (532) 123-45-67', 'en'), '+905321234567');
  assert.equal(contacts.phoneOf('0532 123 45 67', 'tr'), '+905321234567');
  assert.equal(contacts.phoneOf('532 123 45 67', 'tr'), '+905321234567');
  // Without a country code in English, a landline in Turkish, letters, too short or too long: not sure, refused.
  assert.equal(contacts.phoneOf('0532 123 45 67', 'en'), null);
  assert.equal(contacts.phoneOf('0212 123 45 67', 'tr'), null);
  assert.equal(contacts.phoneOf('+90 532 CALL ME', 'en'), null);
  assert.equal(contacts.phoneOf('+1234567', 'en'), null); // 7 digits
  assert.equal(contacts.phoneOf('+12345678', 'en'), '+12345678'); // 8
  assert.equal(contacts.phoneOf('+123456789012345', 'en'), '+123456789012345'); // 15
  assert.equal(contacts.phoneOf('+1234567890123456', 'en'), null); // 16
  assert.equal(contacts.phoneOf('', 'en'), '');
  assert.equal(contacts.phoneOf('   ', 'en'), '');
  assert.equal(contacts.phoneOf(null, 'en'), '');
  for (const sample of ['+90 532 123 45 67', '0532 123 45 67', '+1 (415) 555-0100', '00 44 20 7946 0958', 'ayse@example.com']) {
    for (const locale of ['en', 'tr']) {
      const digits = whatsAppDigits(sample, locale);
      assert.equal(contacts.phoneOf(sample, locale), digits === null ? null : `+${digits}`);
    }
  }
});

test('an email address is one address, lower-cased', () => {
  assert.equal(contacts.emailOf('  Ayse.Kaya@Example.COM '), 'ayse.kaya@example.com');
  assert.equal(contacts.emailOf(''), '');
  assert.equal(contacts.emailOf(null), '');
  for (const bad of ['ayse', 'ayse@', '@example.com', 'ayse@example', 'a b@example.com', 'a@example.com, b@example.com',
    'a@example.com;b@example.com', '"a"@example.com', 'a@@example.com', 'a@example.']) {
    assert.equal(contacts.emailOf(bad), null, bad);
  }
  const local = 'a'.repeat(contacts.EMAIL_MOST - '@example.com'.length);
  assert.equal(contacts.emailOf(`${local}@example.com`), `${local}@example.com`);
  assert.equal(contacts.emailOf(`${local}a@example.com`), null);
});

// --- records ------------------------------------------------------------------------------

test('add, read, change and remove a contact; another owner\'s contact is never reached', async () => {
  const today = '2026-10-22';
  const added = await contacts.addContactFor(OWNER, {
    name: '  Ayşe Kaya ', phone: '0532 123 45 67', email: 'AYSE@Example.com', whatsappConsentOn: today, emailConsentOn: '',
    consentHow: 'Asked in the shop, written form', iysOn: null, notes: 'Likes mugs\nBlue ones',
  }, { today, locale: 'tr' });
  assert.equal(added.name, 'Ayşe Kaya');
  assert.equal(added.phone, '+905321234567');
  assert.equal(added.email, 'ayse@example.com');
  assert.equal(added.whatsappConsentOn, today);
  assert.equal(added.emailConsentOn, null);
  assert.equal(added.iysOn, null);
  assert.equal(added.notes, 'Likes mugs\nBlue ones');
  assert.deepEqual(await contacts.getContactFor(OWNER, added.id), added);

  const theirs = await modelAction('Contact', 'create', { data: { ownerId: OTHER, name: 'Not yours', phone: '+905320000000', createdAt: NOW, updatedAt: NOW } });
  assert.equal(await contacts.getContactFor(OWNER, theirs.id), null);
  assert.equal(await contacts.updateContactFor(OWNER, theirs.id, { name: 'Taken' }, { today }), null);
  assert.equal(await contacts.stopConsentFor(OWNER, theirs.id, 'whatsapp'), null);
  assert.equal(await contacts.removeContactFor(OWNER, theirs.id), false);
  assert.ok(!(await contacts.listContactsFor(OWNER)).some((contact) => contact.id === theirs.id));
  assert.equal((await modelAction('Contact', 'findFirst', { where: { id: theirs.id } })).name, 'Not yours');

  // A change reads only what it was sent; the İYS day checked against the yes days as they will be.
  const changed = await contacts.updateContactFor(OWNER, added.id, { iysOn: '2026-10-22' }, { today });
  assert.equal(changed.iysOn, '2026-10-22');
  assert.equal(changed.name, 'Ayşe Kaya');
  await assert.rejects(contacts.updateContactFor(OWNER, added.id, { whatsappConsentOn: null }, { today }), refusedWith('refuse.contacts.iys'));
  await assert.rejects(contacts.updateContactFor(OWNER, added.id, { iysOn: '2026-10-21' }, { today }), refusedWith('refuse.contacts.iys'));
  assert.equal((await contacts.getContactFor(OWNER, added.id)).iysOn, '2026-10-22');

  assert.equal(await contacts.removeContactFor(OWNER, added.id), true);
  assert.equal(await contacts.getContactFor(OWNER, added.id), null);
  assert.equal(await contacts.removeContactFor(OWNER, added.id), false);
});

test('each field at its edge: names, days up to today, the İYS day after a yes, how they said yes', async () => {
  const today = '2026-10-22';
  const add = (fields) => contacts.addContactFor(OWNER, { name: 'Edge', ...fields }, { today, locale: 'en' });
  await assert.rejects(add({ name: '  ' }), refusedWith('refuse.contacts.name'));
  assert.equal((await add({ name: 'ş'.repeat(LIMITS.name) })).name.length, LIMITS.name);
  await assert.rejects(add({ name: 'ş'.repeat(LIMITS.name + 1) }), refusedWith('refuse.contacts.name'));
  await assert.rejects(add({ phone: '0532 123 45 67' }), refusedWith('refuse.contacts.phone'));
  await assert.rejects(add({ email: 'a@example.com, b@example.com' }), refusedWith('refuse.contacts.email'));
  // A yes day: today and before, never tomorrow; a day that is not one.
  assert.equal((await add({ emailConsentOn: today })).emailConsentOn, today);
  assert.equal((await add({ emailConsentOn: addDays(today, -1) })).emailConsentOn, addDays(today, -1));
  await assert.rejects(add({ emailConsentOn: addDays(today, 1) }), refusedWith('refuse.contacts.day'));
  await assert.rejects(add({ whatsappConsentOn: '2026-02-30' }), refusedWith('refuse.contacts.day'));
  await assert.rejects(add({ iysOn: addDays(today, 1), whatsappConsentOn: today }), refusedWith('refuse.contacts.day'));
  // The İYS day: never alone, never before every yes; on the yes day it holds.
  await assert.rejects(add({ iysOn: today }), refusedWith('refuse.contacts.iys'));
  await assert.rejects(add({ whatsappConsentOn: today, iysOn: addDays(today, -1) }), refusedWith('refuse.contacts.iys'));
  assert.equal((await add({ whatsappConsentOn: today, iysOn: today })).iysOn, today);
  assert.equal((await add({ whatsappConsentOn: '2026-10-01', emailConsentOn: today, iysOn: '2026-10-02' })).iysOn, '2026-10-02');
  // How they said yes: 200 letters at most; notes 1,000.
  assert.equal((await add({ consentHow: 'ç'.repeat(contacts.CONSENT_HOW_MOST) })).consentHow.length, contacts.CONSENT_HOW_MOST);
  await assert.rejects(add({ consentHow: 'ç'.repeat(contacts.CONSENT_HOW_MOST + 1) }), refusedWith('refuse.contacts.how'));
  await assert.rejects(add({ notes: 'n'.repeat(LIMITS.notes + 1) }), refusedWith('refuse.contacts.notes'));
  await modelAction('Contact', 'deleteMany', { where: { ownerId: OWNER } });
});

test('a saved change of number or address drops that channel’s yes, through the records and the address', async () => {
  const today = '2026-10-22';
  const add = () => contacts.addContactFor(OWNER, { name: 'Changes', phone: '+905321234567', email: 'old@example.com',
    whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-06' }, { today });
  const one = await add();
  // The same number written another way is no change.
  const same = await contacts.updateContactFor(OWNER, one.id, { phone: '0532 123 45 67' }, { today, locale: 'tr' });
  assert.deepEqual([same.whatsappConsentOn, same.iysOn], ['2026-10-01', '2026-10-06']);
  const phone = await contacts.updateContactFor(OWNER, one.id, { phone: '+90 532 123 45 68', whatsappConsentOn: '2026-10-01' }, { today });
  assert.deepEqual([phone.phone, phone.whatsappConsentOn, phone.emailConsentOn, phone.iysOn], ['+905321234568', null, '2026-10-05', '2026-10-06']);
  assert.equal(rules.channelGate(phone, 'whatsapp', today).state, 'noConsent');
  const email = await contacts.updateContactFor(OWNER, one.id, { email: 'New@Example.com' }, { today });
  assert.deepEqual([email.email, email.emailConsentOn, email.iysOn], ['new@example.com', null, null], 'no yes left: the İYS day goes');
  // A new yes for the new number, saved after, holds.
  const again = await contacts.updateContactFor(OWNER, one.id, { whatsappConsentOn: today, iysOn: today }, { today });
  assert.equal(rules.channelGate(again, 'whatsapp', today).state, 'ok');

  const two = await add();
  const answer = await call(contactRoute.PATCH, { method: 'PATCH', params: { id: String(two.id) }, body: { email: 'other@example.com', emailConsentOn: '2026-10-05', iysOn: '2026-10-06' } });
  assert.equal(answer.status, 200);
  assert.deepEqual([answer.json.contact.emailConsentOn, answer.json.contact.whatsappConsentOn, answer.json.contact.iysOn], [null, '2026-10-01', '2026-10-06']);
  await modelAction('Contact', 'deleteMany', { where: { ownerId: OWNER } });
});

test('They said stop clears that channel\'s yes, and the İYS day unless it still covers the other one', async () => {
  const today = '2026-10-22';
  const both = await contacts.addContactFor(OWNER, { name: 'Both', phone: '+905321234567', email: 'both@example.com',
    whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-06' }, { today });
  const email = await contacts.stopConsentFor(OWNER, both.id, 'email');
  assert.equal(email.emailConsentOn, null);
  assert.equal(email.whatsappConsentOn, '2026-10-01');
  assert.equal(email.iysOn, '2026-10-06');
  const whatsapp = await contacts.stopConsentFor(OWNER, both.id, 'whatsapp');
  assert.equal(whatsapp.whatsappConsentOn, null);
  assert.equal(whatsapp.iysOn, null);
  assert.equal(rules.channelGate(whatsapp, 'whatsapp', today).state, 'noConsent');

  const early = await contacts.addContactFor(OWNER, { name: 'Early', phone: '+905321234568', email: 'early@example.com',
    whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-05', iysOn: '2026-10-02' }, { today });
  const stopped = await contacts.stopConsentFor(OWNER, early.id, 'whatsapp');
  assert.equal(stopped.iysOn, null, 'the İYS day was the WhatsApp yes\'s');
  assert.equal(stopped.emailConsentOn, '2026-10-05');
  // What a stop leaves is a contact the form can save again.
  assert.equal((await contacts.updateContactFor(OWNER, early.id, { name: 'Early again', emailConsentOn: '2026-10-05', iysOn: null }, { today })).name, 'Early again');
  await assert.rejects(contacts.stopConsentFor(OWNER, early.id, 'sms'), refusedWith('refuse.request'));

  // Through the address: the answer says by which day to report the stop to İYS.
  const answer = await call(contactRoute.POST, { method: 'POST', params: { id: String(early.id) }, body: { action: 'stop', channel: 'email' } });
  assert.equal(answer.status, 200);
  assert.equal(answer.json.contact.emailConsentOn, null);
  assert.equal(answer.json.reportBy, rules.businessDaysAfter(todayCivil(), 3));
  assert.equal((await call(contactRoute.POST, { method: 'POST', params: { id: String(early.id) }, body: { action: 'stop', channel: 'sms' } })).json.problem, 'refuse.request');
  assert.equal((await call(contactRoute.POST, { method: 'POST', params: { id: String(early.id) }, body: { action: 'send', channel: 'email' } })).status, 400);
  assert.equal((await call(contactRoute.POST, { method: 'POST', params: { id: '999999' }, body: { action: 'stop', channel: 'email' } })).status, 404);
  await modelAction('Contact', 'deleteMany', { where: { ownerId: OWNER } });
});

test('Add to contacts copies a person who came: name and contact, never a yes; a kept number opens that one', async () => {
  const enquiry = async (owner, contact) => modelAction('Enquiry', 'create', { data: { ownerId: owner, name: 'Mehmet', contact, receivedOn: '2026-10-20', createdAt: NOW, updatedAt: NOW } });
  const byPhone = await enquiry(OWNER, '+90 532 765 43 21');
  const first = await contacts.addFromEnquiryFor(OWNER, byPhone.id, { locale: 'en' });
  assert.equal(first.existed, false);
  assert.equal(first.contact.name, 'Mehmet');
  assert.equal(first.contact.phone, '+905327654321');
  assert.equal(first.contact.email, '');
  assert.equal(first.contact.whatsappConsentOn, null);
  assert.equal(first.contact.emailConsentOn, null);
  assert.equal(first.contact.iysOn, null);
  const again = await contacts.addFromEnquiryFor(OWNER, byPhone.id, { locale: 'en' });
  assert.deepEqual(again, { contact: first.contact, existed: true });

  const byEmail = await contacts.addFromEnquiryFor(OWNER, (await enquiry(OWNER, 'Mehmet@Example.com')).id, { locale: 'en' });
  assert.equal(byEmail.contact.email, 'mehmet@example.com');
  assert.equal(byEmail.contact.phone, '');
  const byHandle = await contacts.addFromEnquiryFor(OWNER, (await enquiry(OWNER, '@mehmet_shop on Instagram')).id, { locale: 'en' });
  assert.equal(byHandle.contact.phone, '');
  assert.equal(byHandle.contact.email, '');
  assert.equal(byHandle.contact.notes, '@mehmet_shop on Instagram');
  assert.equal(byHandle.existed, false);

  const theirs = await enquiry(OTHER, '+90 532 000 00 01');
  assert.equal(await contacts.addFromEnquiryFor(OWNER, theirs.id), null);

  // Through the address: 201 for a new one, 200 for one already kept, 404 for another owner's enquiry.
  const fresh = await enquiry(OWNER, '+44 20 7946 0958');
  const made = await call(contactsRoute.POST, { method: 'POST', body: { enquiryId: fresh.id } });
  assert.equal(made.status, 201);
  assert.equal(made.json.contact.phone, '+442079460958');
  assert.equal((await call(contactsRoute.POST, { method: 'POST', body: { enquiryId: fresh.id } })).status, 200);
  assert.equal((await call(contactsRoute.POST, { method: 'POST', body: { enquiryId: theirs.id } })).status, 404);
  assert.equal((await call(contactsRoute.POST, { method: 'POST', body: { enquiryId: 'x' } })).status, 404);
  await modelAction('Contact', 'deleteMany', { where: { ownerId: OWNER } });
});

test('the addresses: add, read, change, remove; refusals travel as keys', async () => {
  const today = todayCivil();
  const added = await call(contactsRoute.POST, { method: 'POST', body: { name: 'Zeynep', phone: '+90 533 111 22 33', whatsappConsentOn: today } });
  assert.equal(added.status, 201);
  const id = String(added.json.contact.id);
  assert.equal((await call(contactRoute.GET, { params: { id } })).json.contact.name, 'Zeynep');
  const changed = await call(contactRoute.PATCH, { method: 'PATCH', params: { id }, body: { iysOn: today, consentHow: 'Form on the website' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.contact.iysOn, today);
  assert.equal(rules.channelGate(changed.json.contact, 'whatsapp', today).state, 'ok');
  const tomorrow = await call(contactRoute.PATCH, { method: 'PATCH', params: { id }, body: { emailConsentOn: addDays(today, 1) } });
  assert.deepEqual([tomorrow.status, tomorrow.json.problem], [400, 'refuse.contacts.day']);
  const phone = await call(contactsRoute.POST, { method: 'POST', body: { name: 'No code', phone: '532 111 22 33' } });
  assert.deepEqual([phone.status, phone.json.problem], [400, 'refuse.contacts.phone']);
  assert.equal((await call(contactsRoute.POST, { method: 'POST', body: { phone: '+905331112233' } })).json.problem, 'refuse.contacts.name');
  assert.equal((await call(contactRoute.GET, { params: { id: '0' } })).status, 404);
  assert.equal((await call(contactRoute.GET, { params: { id: 'abc' } })).status, 404);
  assert.equal((await call(contactRoute.DELETE, { method: 'DELETE', params: { id } })).json.ok, true);
  assert.equal((await call(contactRoute.DELETE, { method: 'DELETE', params: { id } })).status, 404);
  // Not JSON: refused before anything is read.
  const plain = await contactsRoute.POST(new Request('http://localhost/api/contacts', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"x"}' }));
  assert.equal(plain.status, 400);
});

test('the menu lists Contacts right after Customers', () => {
  const at = PAGES.findIndex((page) => page.href === '/contacts');
  assert.equal(PAGES[at - 1].href, '/customers');
  assert.equal(PAGES[at].wordsKey, 'menu.contacts');
  assert.equal(PAGES[at].icon, 'contacts');
  assert.equal(PAGES.length, 8);
});

// --- the records bounds ----------------------------------------------------------------------

test('2,000 contacts with the longest words: the page reads them in at most 14 calls, one at a time; the 2,001st is refused', async () => {
  await modelAction('Contact', 'deleteMany', { where: { ownerId: OWNER } });
  const longest = (letters) => 'ş'.repeat(letters);
  const email = (index) => `${String(index).padStart(6, '0')}${'a'.repeat(contacts.EMAIL_MOST - 18)}@example.com`;
  for (let start = 0; start < contacts.CONTACTS_MOST; start += 500) {
    await modelAction('Contact', 'createMany', {
      data: Array.from({ length: 500 }, (_, offset) => ({
        ownerId: OWNER, name: longest(LIMITS.name), phone: `+${String(100000000000000 + start + offset)}`, email: email(start + offset),
        whatsappConsentOn: '2026-10-01', emailConsentOn: '2026-10-01', iysOn: '2026-10-01',
        consentHow: longest(contacts.CONSENT_HOW_MOST), notes: longest(LIMITS.notes), createdAt: NOW, updatedAt: NOW,
      })),
    });
  }
  assert.equal(email(1).length, contacts.EMAIL_MOST);
  await modelAction('ReadyWord', 'createMany', {
    data: Array.from({ length: LIMITS.readyWords }, (_, index) => ({
      ownerId: OWNER, kind: index % 3 === 0 ? 'bio' : 'answer', title: longest(LIMITS.readyTitle), text: longest(LIMITS.readyWord),
      position: index, createdAt: NOW, updatedAt: NOW,
    })),
  });

  const list = await measured(() => contacts.listContactsFor(OWNER));
  assert.equal(list.value.length, contacts.CONTACTS_MOST);
  assert.equal(new Set(list.value.map((contact) => contact.id)).size, contacts.CONTACTS_MOST);
  bounded(list, 'the contacts list', 9);
  assert.equal(mostInFlight(list), 1);

  const page = await measured(() => readContactsPage({ owner: OWNER }));
  bounded(page, 'the Contacts page', 14);
  assert.equal(mostInFlight(page), 1);
  assert.equal(page.value.contacts.length, contacts.CONTACTS_MOST);
  assert.equal(page.value.answers.length, LIMITS.readyWords - Math.ceil(LIMITS.readyWords / 3));
  assert.ok(page.value.answers.every((answer) => answer.kind === 'answer'));

  // Full: the next one is refused, by hand and from Customers.
  await assert.rejects(contacts.addContactFor(OWNER, { name: 'One more' }), refusedWith('refuse.contacts.full'));
  const enquiry = await modelAction('Enquiry', 'create', { data: { ownerId: OWNER, name: 'One more', contact: 'one@example.com', receivedOn: '2026-10-20', createdAt: NOW, updatedAt: NOW } });
  await assert.rejects(contacts.addFromEnquiryFor(OWNER, enquiry.id), refusedWith('refuse.contacts.full'));

  // Each function one call at a time, inside the bounds (a removal makes room for each add).
  const [someone, another] = list.value;
  for (const [what, work, most] of [
    ['get', () => contacts.getContactFor(OWNER, someone.id), 1],
    ['change', () => contacts.updateContactFor(OWNER, someone.id, { iysOn: '2026-10-02' }), 3],
    ['stop', () => contacts.stopConsentFor(OWNER, someone.id, 'email'), 3],
    ['remove', () => contacts.removeContactFor(OWNER, someone.id), 1],
    ['add', () => contacts.addContactFor(OWNER, { name: 'In the room left' }), 2],
    ['remove again', () => contacts.removeContactFor(OWNER, another.id), 1],
    ['add from an enquiry', () => contacts.addFromEnquiryFor(OWNER, enquiry.id), 4],
  ]) {
    const run = await measured(work);
    bounded(run, what, most);
    assert.equal(mostInFlight(run), 1, what);
  }
  assert.equal((await contacts.listContactsFor(OWNER)).length, contacts.CONTACTS_MOST);
  await modelAction('Contact', 'deleteMany', { where: { ownerId: OWNER } });
  await modelAction('ReadyWord', 'deleteMany', { where: { ownerId: OWNER } });
});
