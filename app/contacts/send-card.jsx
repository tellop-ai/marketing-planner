'use client';

import { Check, Copy, IdCard, Info, Mail, MessageCircle, RotateCcw, SkipForward, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { contactWhatsAppAddress, emailList, emailText, endingText, lateCount, nextInQueue, phoneText, whatsAppQueue, withEnding } from './rules.js';

/** Where this browser keeps the queue's place for the session (who is shown, who was opened). */
const PLACE_STORE_NAME = 'marketing-planner.contacts.sendPlace';

/** The place kept for this browser session, or null (none, unreadable, or storage refused). */
function readPlace() {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(PLACE_STORE_NAME) ?? 'null');
    if (kept === null || typeof kept !== 'object') return null;
    const id = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);
    return {
      currentId: id(kept.currentId),
      finished: kept.finished === true,
      opened: Array.isArray(kept.opened) ? kept.opened.map(id).filter((value) => value !== null).slice(0, 2000) : [],
    };
  } catch {
    return null;
  }
}

/** Keeps the place for this browser session; a refusal (storage off, full) only means it is not kept. */
function keepPlace(place) {
  try {
    window.sessionStorage.setItem(PLACE_STORE_NAME, JSON.stringify(place));
  } catch {
    // The queue still works; a reload starts it again.
  }
}

/** Starts a copy inside the press (before a WhatsApp link opens, so the browser allows it); answers whether it worked. */
function copyText(text) {
  try {
    const writing = navigator.clipboard?.writeText(text);
    return writing ? writing.then(() => true, () => false) : Promise.resolve(false);
  } catch {
    return Promise.resolve(false);
  }
}

/** A line under a press: muted when it says what happened, red when it warns. */
function Line({ warn = false, children }) {
  return (
    <p role={warn ? 'alert' : 'status'} className={cn('flex items-start gap-1.5 text-sm', warn ? 'text-destructive' : 'text-muted-foreground')}>
      {warn && <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/**
 * Message one by one: the words (typed, or started from a ready answer or
 * offer), then WhatsApp for one person at a time or the email addresses of
 * everyone with a yes. The app never sends.
 *
 * Every message ends with a blank line, the business's name and a line that
 * says how to stop these messages (`withEnding`): the box shows that ending
 * under the words, so the person sees what goes out, and a line reminds that
 * the message must also name them (trade name and MERSİS number, or name and
 * tax number). With no business name every press rests and says so.
 *
 * **WhatsApp**: the people who can get it (a yes on İYS and a number; one
 * number once), in the list's order. The first shows at once; **Copy and
 * open WhatsApp** copies the message and opens WhatsApp's chat with it ready
 * (the person presses send there); **Next person** shows the next one. Both
 * rest with the reason: no words, nobody with a yes, the last one reached.
 * The place in the queue (who shows, who was opened) is kept for this
 * browser session, so a reload does not start again.
 *
 * **Email**: **Copy message** copies the message for the person's own email;
 * **Copy email addresses** copies the addresses of everyone who can get
 * email, separated by commas (into Bcc, so no one sees the others). They
 * rest while nobody can.
 *
 * People with a yes not on İYS yet rest (a line says how many), and so do
 * those whose yes was not recorded in İYS within three business days (a
 * warning says how many).
 *
 * @param {{ locale: string, today: string, business: string, contacts: object[], answers: Array<{ id: number, kind: string, title: string, text: string }> }} props
 */
export function SendCard({ locale, today, business, contacts, answers }) {
  const [words, setWords] = useState('');
  const [answerId, setAnswerId] = useState('');
  const queue = useMemo(() => whatsAppQueue(contacts, today), [contacts, today]);
  const emails = useMemo(() => emailList(contacts, today), [contacts, today]);
  const resting = useMemo(() => Object.fromEntries(['whatsapp', 'email'].map((channel) => [channel, {
    late: lateCount(contacts, channel, today, 'late'),
    waiting: lateCount(contacts, channel, today, 'remind'),
  }])), [contacts, today]);
  const [currentId, setCurrentId] = useState(/** @type {number | null} */ (null));
  const [finished, setFinished] = useState(false);
  const [opened, setOpened] = useState(() => new Set());
  const [whatsAppLine, setWhatsAppLine] = useState(/** @type {{ key: string, warn?: boolean } | null} */ (null));
  const [emailLine, setEmailLine] = useState(/** @type {{ key: string, warn?: boolean, count: number, text?: string } | null} */ (null));
  const [messageLine, setMessageLine] = useState(/** @type {{ key: string, warn?: boolean, text?: string } | null} */ (null));
  const restored = useRef(false);

  // The place this browser session kept, read once after the page shows (the server has no session).
  useEffect(() => {
    const place = readPlace();
    if (place !== null) {
      setCurrentId(place.currentId);
      setFinished(place.finished);
      setOpened(new Set(place.opened));
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (restored.current) keepPlace({ currentId, finished, opened: [...opened] });
  }, [currentId, finished, opened]);

  const at = Math.max(0, queue.findIndex((item) => item.contact.id === currentId));
  const current = finished || queue.length === 0 ? null : queue[at];
  const name = String(business ?? '').trim();
  const ending = { business: name, stop: t('contacts.send.stopLine', locale) };
  const message = words.trim() === '' || name === '' ? '' : withEnding(words, ending);
  const restLine = name === '' ? 'contacts.send.noBusiness' : 'contacts.send.wordsFirst';

  /** @param {string} value */
  function chooseAnswer(value) {
    setAnswerId(value);
    const answer = answers.find((item) => String(item.id) === value);
    if (answer) setWords(answer.text);
  }

  function next() {
    setWhatsAppLine(null);
    const id = nextInQueue(queue, current?.contact.id ?? null);
    if (id === null) setFinished(true);
    else setCurrentId(id);
  }

  function again() {
    setWhatsAppLine(null);
    setFinished(false);
    setOpened(new Set());
    setCurrentId(queue[0]?.contact.id ?? null);
  }

  function copyMessage() {
    copyText(message).then((done) => setMessageLine(done
      ? { key: 'contacts.send.messageCopied' }
      : { key: 'contacts.send.messageCopyFailed', warn: true, text: message }));
  }

  function openWhatsApp() {
    const id = current.contact.id;
    setOpened((before) => new Set(before).add(id));
    // WhatsApp opens with the words in it anyway; a failed copy only says so.
    copyText(message).then((done) => setWhatsAppLine(done ? { key: 'contacts.send.copied' } : { key: 'contacts.send.copyFailed', warn: true }));
  }

  function copyEmails() {
    const text = emailText(emails);
    copyText(text).then((done) => setEmailLine(done
      ? { key: 'contacts.send.emailCopied', count: emails.length }
      : { key: 'contacts.send.emailCopyFailed', warn: true, count: emails.length, text }));
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{t('contacts.send.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-5 px-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          {answers.length > 0 && (
            <Field>
              <FieldLabel htmlFor="contacts-answer" className="sr-only">{t('contacts.send.readyLabel', locale)}</FieldLabel>
              <NativeSelect id="contacts-answer" className="w-full" value={answerId} onChange={(event) => chooseAnswer(event.target.value)}>
                <NativeSelectOption value="">{t('contacts.send.ready', locale)}</NativeSelectOption>
                {answers.map((answer) => (
                  <NativeSelectOption key={answer.id} value={String(answer.id)}>{answer.title}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="contacts-words">{t('contacts.send.words', locale)}</FieldLabel>
            <InputGroup>
              <InputGroupTextarea id="contacts-words" value={words} onChange={(event) => setWords(event.target.value)} rows={5} maxLength={LIMITS.readyWord} />
              {name !== '' && (
                <InputGroupAddon align="block-end" aria-label={t('contacts.send.ending', locale)} className="cursor-default border-t border-border font-normal whitespace-pre-wrap">
                  {endingText(ending)}
                </InputGroupAddon>
              )}
            </InputGroup>
          </Field>
          {name === '' && <Line warn>{t('contacts.send.noBusiness', locale)}</Line>}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <IdCard aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{t('contacts.send.identity', locale)}</span>
          </p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>{t('contacts.why', locale)}</span>
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="contacts-whatsapp" className="flex min-w-0 flex-col gap-2">
            <h3 id="contacts-whatsapp" className="flex items-center gap-2 text-sm font-medium">
              <MessageCircle aria-hidden="true" className="size-4 text-muted-foreground" />
              {t('contacts.channel.whatsapp', locale)}
              <span className="font-normal text-muted-foreground">{t('contacts.send.people', locale, { count: String(queue.length) })}</span>
            </h3>
            {queue.length === 0 && resting.whatsapp.waiting + resting.whatsapp.late === 0 && <Line>{t('contacts.send.noneWhatsapp', locale)}</Line>}
            {current && (
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="truncate font-medium">{current.contact.name}</span>
                  <span className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{phoneText(current.contact.phone)}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                    {opened.has(current.contact.id) && <Check aria-label={t('contacts.send.opened', locale)} className="size-3.5 text-primary" />}
                    {t('contacts.send.of', locale, { at: String(at + 1), count: String(queue.length) })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {message === '' ? (
                    <Button type="button" disabled>
                      <MessageCircle aria-hidden="true" />
                      {t('contacts.send.open', locale)}
                    </Button>
                  ) : (
                    <a href={contactWhatsAppAddress(current.contact, message)} target="_blank" rel="noopener" onClick={openWhatsApp} className={buttonVariants()}>
                      <MessageCircle aria-hidden="true" />
                      {t('contacts.send.open', locale)}
                    </a>
                  )}
                  <Button type="button" variant="outline" onClick={next}>
                    <SkipForward aria-hidden="true" />
                    {t('contacts.send.next', locale)}
                  </Button>
                </div>
                {message === '' && name !== '' && <Line>{t(restLine, locale)}</Line>}
                {whatsAppLine && <Line warn={whatsAppLine.warn}>{t(whatsAppLine.key, locale)}</Line>}
              </div>
            )}
            {finished && queue.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Line>{t('contacts.send.last', locale)}</Line>
                <Button type="button" variant="ghost" size="sm" onClick={again}>
                  <RotateCcw aria-hidden="true" />
                  {t('contacts.send.again', locale)}
                </Button>
              </div>
            )}
            {resting.whatsapp.waiting > 0 && <Line>{t('contacts.send.waiting', locale, { count: String(resting.whatsapp.waiting) })}</Line>}
            {resting.whatsapp.late > 0 && <Line warn>{t('contacts.send.late', locale, { count: String(resting.whatsapp.late) })}</Line>}
          </section>

          <section aria-labelledby="contacts-email" className="flex min-w-0 flex-col gap-2">
            <h3 id="contacts-email" className="flex items-center gap-2 text-sm font-medium">
              <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
              {t('contacts.channel.email', locale)}
              <span className="font-normal text-muted-foreground">{t('contacts.send.people', locale, { count: String(emails.length) })}</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={emails.length === 0 || message === ''} onClick={copyMessage}>
                <Copy aria-hidden="true" />
                {t('contacts.send.copyMessage', locale)}
              </Button>
              <Button type="button" variant="outline" disabled={emails.length === 0} onClick={copyEmails}>
                <Mail aria-hidden="true" />
                {t('contacts.send.emailCopy', locale)}
              </Button>
            </div>
            {emails.length === 0 && resting.email.waiting + resting.email.late === 0 && <Line>{t('contacts.send.noneEmail', locale)}</Line>}
            {emails.length > 0 && message === '' && name !== '' && <Line>{t(restLine, locale)}</Line>}
            {messageLine && <Line warn={messageLine.warn}>{t(messageLine.key, locale)}</Line>}
            {messageLine?.text && <p className="rounded-md bg-muted px-2 py-1 text-xs whitespace-pre-wrap break-words select-all">{messageLine.text}</p>}
            {emailLine && <Line warn={emailLine.warn}>{t(emailLine.key, locale, { count: String(emailLine.count) })}</Line>}
            {emailLine?.text && <p className="rounded-md bg-muted px-2 py-1 text-xs break-all select-all">{emailLine.text}</p>}
            {resting.email.waiting > 0 && <Line>{t('contacts.send.waiting', locale, { count: String(resting.email.waiting) })}</Line>}
            {resting.email.late > 0 && <Line warn>{t('contacts.send.late', locale, { count: String(resting.email.late) })}</Line>}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
