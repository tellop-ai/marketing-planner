'use client';

import { enUS, tr } from 'date-fns/locale';
import { CalendarPlus, Hand, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { useRights } from '../rights.jsx';
import { sendUnconfirmed } from '../send.js';

import { afterAddressChange, CHANNELS, CONSENT_FIELD, channelGate, emailOf, phoneOf, phoneText } from './rules.js';

/**
 * A DateField's look in this form. A grid, not a flex column: the kit's
 * `label:not([data-slot])` rule gives the field's bare label `flex: 1 1 16rem`,
 * which a flex column turns into 16rem of height (as in the customer forms).
 */
const DATE_FIELD = 'grid content-start gap-2 text-sm font-medium [&_label]:text-sm [&_label]:text-foreground [&_p]:text-xs [&_p]:font-normal [&_p]:text-destructive [&_p:empty]:hidden';

/** The most letters "how they said yes" holds (the records refuse more: `refuse.contacts.how`). */
const HOW_MOST = 200;

/** The words each channel's yes field is labelled with. */
const YES_LABEL = Object.freeze({ whatsapp: 'contacts.field.whatsappYes', email: 'contacts.field.emailYes' });

/** Why a channel's kept yes goes when its number or address changes. */
const NEW_ADDRESS = Object.freeze({ whatsapp: 'contacts.line.newNumber', email: 'contacts.line.newEmail' });

/** A channel's name as the person reads it. @param {string} channel @param {string} locale */
export function channelName(channel, locale) {
  return t(`contacts.channel.${channel}`, locale);
}

/**
 * Add or change one contact, in a window. A contact that exists is read
 * first (its notes and "how" are not in the list). The draft lives inside the
 * window's content, so closing the window forgets it (AGENTS.md rule 6d); the
 * page shows "Saved" only after the app confirms (rule 4a).
 *
 * For each channel the yes day is a day or none: none shows "Add the day"
 * (today), a day shows the day field; a yes the app keeps has **They said
 * stop** beside it, which clears it at once (and the İYS day, unless that
 * still covers the other channel's yes) and says to report the stop to İYS
 * within three business days. A new yes not kept yet has × instead.
 *
 * A yes belongs to its number or address: while the kept number (or
 * address) is changed in the form, that channel's yes rests with the words
 * "A new number needs a new yes." and Save drops it (`afterAddressChange`);
 * the new yes is added after the save. The İYS day rests while no yes day is
 * filled (it records when the yeses went into İYS).
 *
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, contactId: number | null, title: string | null,
 *   locale: string, today: string, onDone: (key: string) => void, onChanged: () => void }} props
 */
export function ContactDialog({ open, onOpenChange, contactId, title, locale, today, onDone, onChanged }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{title ?? t('contacts.addTitle', locale)}</DialogTitle>
        </DialogHeader>
        {open && (contactId === null
          ? <ContactForm key="new" contact={null} locale={locale} today={today} onDone={onDone} onChanged={onChanged} />
          : <ContactLoader key={contactId} contactId={contactId} locale={locale} today={today} onDone={onDone} onChanged={onChanged} />)}
      </DialogContent>
    </Dialog>
  );
}

/** Reads one contact, then shows its form. Reading saves nothing. */
function ContactLoader({ contactId, locale, today, onDone, onChanged }) {
  const [read, setRead] = useState(/** @type {{ contact?: object, problem?: string } | null} */ (null));

  useEffect(() => {
    let current = true;
    sendUnconfirmed(`/api/contacts/${contactId}`, 'GET').then((answer) => {
      if (!current) return;
      if (answer.ok && typeof answer.value?.contact?.id === 'number') setRead({ contact: answer.value.contact });
      else setRead({ problem: answer.ok ? 'error.storageUnreadable' : answer.problem });
    });
    return () => { current = false; };
  }, [contactId]);

  if (read === null) return <Spinner aria-label={t('contacts.loading', locale)} className="text-muted-foreground" />;
  if (read.problem) return <p role="alert" className="text-sm text-destructive">{t(read.problem, locale)}</p>;
  return <ContactForm contact={read.contact} locale={locale} today={today} onDone={onDone} onChanged={onChanged} />;
}

/**
 * One day of the consent block: "Add the day" when there is none, else the
 * day field with × (a day not kept yet) or the stop press (a kept yes).
 * `readOnly`: the day only, or "None" (a contact to read, not to change).
 *
 * @param {{ id: string, label: string, value: string | null, onChange: (day: string | null) => void, locale: string, today: string,
 *   stop?: { onStop: () => void, busy: boolean } | null, rest?: string | null, readOnly?: boolean }} props
 */
function DayChoice({ id, label, value, onChange, locale, today, stop = null, rest = null, readOnly = false }) {
  const words = { choose: t('contacts.day.choose', locale), invalid: t('contacts.day.invalid', locale), failed: t('contacts.day.invalid', locale), saved: '' };
  if (value === null && readOnly) {
    return (
      <Field>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{t('contacts.day.none', locale)}</span>
      </Field>
    );
  }
  if (value === null) {
    return (
      <Field>
        <span className="text-sm font-medium">{label}</span>
        {/* In a div: the Field widens its own children to the whole row. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="outline" disabled={rest !== null} onClick={() => onChange(today)}>
            <CalendarPlus aria-hidden="true" />
            {t('contacts.day.add', locale)}
          </Button>
          {rest !== null && <span className="text-xs text-muted-foreground">{rest}</span>}
        </div>
      </Field>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-x-2 gap-y-2">
      <DateField
        id={id}
        className={cn(DATE_FIELD, 'min-w-40 flex-1')}
        label={label}
        value={value}
        onSave={(next) => { onChange(next); return next; }}
        words={words}
        calendarLocale={locale === 'tr' ? tr : enUS}
        disabled={readOnly}
      />
      {readOnly ? null : stop ? (
        <Button type="button" variant="outline" disabled={stop.busy} onClick={stop.onStop}>
          <Hand aria-hidden="true" />
          {t('contacts.stop', locale)}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="icon" aria-label={t('contacts.day.clear', locale)} onClick={() => onChange(null)}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** @param {{ contact: object | null, locale: string, today: string, onDone: (key: string) => void, onChanged: () => void }} props */
export function ContactForm({ contact, locale, today, onDone, onChanged }) {
  // A person who may not change a kept contact (`useRights`) reads it, unchangeable, with no They said stop, Save or Remove.
  const { change: canChange } = useRights();
  const readOnly = Boolean(contact) && !canChange;
  const [kept, setKept] = useState(contact);
  const [name, setName] = useState(contact?.name ?? '');
  const [phone, setPhone] = useState(phoneText(contact?.phone ?? ''));
  const [email, setEmail] = useState(contact?.email ?? '');
  const [yes, setYes] = useState(() => ({ whatsapp: contact?.whatsappConsentOn ?? null, email: contact?.emailConsentOn ?? null }));
  const [consentHow, setConsentHow] = useState(contact?.consentHow ?? '');
  const [iysOn, setIysOn] = useState(/** @type {string | null} */ (contact?.iysOn ?? null));
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [stopped, setStopped] = useState(/** @type {{ channel: string, reportBy: string } | null} */ (null));
  const [removing, setRemoving] = useState(false);

  const id = (part) => `contact-${contact?.id ?? 'new'}-${part}`;
  // The days as they will be once saved: a changed kept number or address drops its channel's yes.
  const typed = { phone: phoneOf(phone, locale) ?? phone.trim(), email: emailOf(email) ?? email.trim(), whatsappConsentOn: yes.whatsapp, emailConsentOn: yes.email, iysOn };
  const after = afterAddressChange(kept ?? {}, typed);
  const draft = { ...typed, whatsappConsentOn: after.whatsappConsentOn, emailConsentOn: after.emailConsentOn, iysOn: after.iysOn };
  const anyYes = draft.whatsappConsentOn !== null || draft.emailConsentOn !== null;
  const gates = CHANNELS.map((channel) => ({ channel, gate: channelGate(draft, channel, today) }))
    .filter(({ gate }) => gate.state === 'remind' || gate.state === 'late');

  /** @param {React.FormEvent} event */
  async function save(event) {
    event.preventDefault();
    setProblem(null);
    setBusy(true);
    const fields = { name, phone, email, whatsappConsentOn: draft.whatsappConsentOn, emailConsentOn: draft.emailConsentOn, consentHow, iysOn: draft.iysOn, notes };
    const answer = contact
      ? await sendUnconfirmed(`/api/contacts/${contact.id}`, 'PATCH', fields)
      : await sendUnconfirmed('/api/contacts', 'POST', fields);
    setBusy(false);
    if (!answer.ok || typeof answer.value?.contact?.id !== 'number') {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    onDone('contacts.saved');
  }

  /** "They said stop" on one channel: kept at once, the draft follows what the app kept. @param {string} channel */
  async function stop(channel) {
    setProblem(null);
    setStopped(null);
    setBusy(true);
    const answer = await sendUnconfirmed(`/api/contacts/${contact.id}`, 'POST', { action: 'stop', channel });
    setBusy(false);
    const now = answer.ok ? answer.value?.contact : null;
    if (!answer.ok || typeof now?.id !== 'number' || typeof answer.value?.reportBy !== 'string') {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    setKept(now);
    setYes((before) => ({ ...before, [channel]: now[CONSENT_FIELD[channel]] ?? null }));
    setIysOn(now.iysOn ?? null);
    setStopped({ channel, reportBy: answer.value.reportBy });
    onChanged();
  }

  async function remove() {
    setProblem(null);
    setBusy(true);
    const answer = await sendUnconfirmed(`/api/contacts/${contact.id}`, 'DELETE');
    setBusy(false);
    if (!answer.ok || answer.value?.ok !== true) {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    onDone('contacts.removed');
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <fieldset disabled={readOnly} className="-mx-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={id('name')}>{t('contacts.field.name', locale)}</FieldLabel>
          <Input id={id('name')} value={name} onValueChange={setName} required maxLength={LIMITS.name} autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id('phone')}>{t('contacts.field.phone', locale)}</FieldLabel>
            <Input id={id('phone')} value={phone} onValueChange={setPhone} inputMode="tel" autoComplete="off" placeholder={t('contacts.field.phoneHint', locale)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={id('email')}>{t('contacts.field.email', locale)}</FieldLabel>
            <Input id={id('email')} value={email} onValueChange={setEmail} inputMode="email" autoComplete="off" spellCheck={false} />
          </Field>
        </div>
        <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('contacts.consent', locale)}</legend>
          {CHANNELS.map((channel) => (after.dropped.includes(channel) ? (
            <Field key={channel}>
              <span className="text-sm font-medium">{t(YES_LABEL[channel], locale)}</span>
              <p role="status" className="text-sm text-foreground">{t(NEW_ADDRESS[channel], locale)}</p>
            </Field>
          ) : (
            <DayChoice
              key={channel}
              id={id(channel)}
              label={t(YES_LABEL[channel], locale)}
              value={yes[channel]}
              onChange={(day) => setYes((before) => ({ ...before, [channel]: day }))}
              locale={locale}
              today={today}
              stop={kept && kept[CONSENT_FIELD[channel]] ? { onStop: () => stop(channel), busy } : null}
              readOnly={readOnly}
            />
          )))}
          <Field>
            <FieldLabel htmlFor={id('how')}>{t('contacts.field.how', locale)}</FieldLabel>
            <Input id={id('how')} value={consentHow} onValueChange={setConsentHow} maxLength={HOW_MOST} autoComplete="off" placeholder={t('contacts.field.howHint', locale)} />
          </Field>
          <DayChoice
            id={id('iys')}
            label={t('contacts.field.iys', locale)}
            value={draft.iysOn}
            onChange={setIysOn}
            locale={locale}
            today={today}
            rest={anyYes ? null : t('contacts.iys.yesFirst', locale)}
            readOnly={readOnly}
          />
          <p className="text-xs text-muted-foreground">{t('contacts.iys.outside', locale)}</p>
          {gates.map(({ channel, gate }) => (
            <p key={channel} role={gate.state === 'late' ? 'alert' : 'status'} className={cn('text-sm', gate.state === 'late' ? 'text-destructive' : 'text-foreground')}>
              {channelName(channel, locale)}: {gate.state === 'late'
                ? t('contacts.line.late', locale)
                : t('contacts.line.remind', locale, { day: formatDate(gate.deadline, locale) })}
            </p>
          ))}
          {stopped && (
            <p role="status" className="text-sm font-medium">
              {t('contacts.stopped', locale, { channel: channelName(stopped.channel, locale), day: formatDate(stopped.reportBy, locale) })}
            </p>
          )}
        </fieldset>
        <Field>
          <FieldLabel htmlFor={id('notes')}>{t('contacts.field.notes', locale)}</FieldLabel>
          <Textarea id={id('notes')} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={LIMITS.notes} />
        </Field>
      </fieldset>
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      {!readOnly && (
        <DialogFooter className="flex-wrap">
          {contact && !removing && (
            <Button type="button" variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => setRemoving(true)}>
              {t('contacts.remove', locale)}
            </Button>
          )}
          {contact && removing && (
            <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
              <span className="text-sm">{t('contacts.removeAsk', locale)}</span>
              <Button type="button" variant="destructive" disabled={busy} onClick={remove}>{t('contacts.remove', locale)}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRemoving(false)}>{t('contacts.keep', locale)}</Button>
            </div>
          )}
          <Button type="submit" disabled={busy || removing}>{t('contacts.save', locale)}</Button>
        </DialogFooter>
      )}
    </form>
  );
}
