'use client';

import { enUS, tr } from 'date-fns/locale';
import { CalendarPlus, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { StatusRow } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { addDays } from '../../lib/plan/days.js';

import { ENQUIRY_STATUSES, channelChoices, channelLabel, statusLabel } from './choices.js';
import { sendUnconfirmed } from '../send.js';
import { amountOf } from './amount.js';

/**
 * A DateField's look in this form. A grid, not a flex column: the kit's
 * `label:not([data-slot])` rule gives the field's bare label `flex: 1 1 16rem`,
 * which a flex column turned into 16rem of height (as in the campaign forms).
 */
const DATE_FIELD = 'grid content-start gap-2 text-sm font-medium [&_label]:text-sm [&_label]:text-foreground [&_p]:text-xs [&_p]:font-normal [&_p]:text-destructive [&_p:empty]:hidden';

/** The most letters an offer code holds (the records refuse more: `refuse.customers.code`). */
const CODE_MOST = 24;

/**
 * Add or change one person who came, in a window. The draft lives inside the
 * window's content, so closing the window forgets it (AGENTS.md rule 6d); the
 * page shows "Saved" only after the app confirms (rule 4a).
 *
 * **Follow up on** is a day or none: with none, one press
 * gives it tomorrow and shows the day field; the × press clears it again (the
 * day field itself always holds a whole day). **Code** is the offer code the
 * person used: 2 to 24 letters or digits, or nothing; the app checks it and a
 * refusal shows its words while the form keeps what was typed.
 *
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, enquiry: object | null, locale: string,
 *   today: string, posts: { id: number, name: string, day: string }[], networks: string[],
 *   onDone: (key: string) => void }} props
 */
export function EnquiryDialog({ open, onOpenChange, enquiry, locale, today, posts, networks, onDone }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{enquiry ? enquiry.name : t('customers.addTitle', locale)}</DialogTitle>
        </DialogHeader>
        {open && (
          <EnquiryForm key={enquiry?.id ?? 'new'} enquiry={enquiry} locale={locale} today={today} posts={posts} networks={networks} onDone={onDone} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EnquiryForm({ enquiry, locale, today, posts, networks, onDone }) {
  const router = useRouter();
  const [name, setName] = useState(enquiry?.name ?? '');
  const [contact, setContact] = useState(enquiry?.contact ?? '');
  const [channel, setChannel] = useState(enquiry?.channel ?? (networks[0] ?? 'other'));
  const [postId, setPostId] = useState(enquiry?.postId === null || enquiry?.postId === undefined ? '' : String(enquiry.postId));
  const [askedAbout, setAskedAbout] = useState(enquiry?.askedAbout ?? '');
  const [status, setStatus] = useState(enquiry?.status ?? 'new');
  const [amount, setAmount] = useState(enquiry?.amount === null || enquiry?.amount === undefined ? '' : String(enquiry.amount));
  const [day, setDay] = useState(enquiry?.receivedOn ?? today);
  const [notes, setNotes] = useState(enquiry?.notes ?? '');
  const [followUpOn, setFollowUpOn] = useState(/** @type {string | null} */ (enquiry?.followUpOn ?? null));
  const [code, setCode] = useState(enquiry?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [removing, setRemoving] = useState(false);

  const postOptions = [...posts];
  if (enquiry?.postId && !postOptions.some((post) => post.id === enquiry.postId)) {
    postOptions.unshift({ id: enquiry.postId, name: enquiry.postName ?? '', day: '' });
  }

  /** Saves the form; answers whether the app confirmed it (a refusal shows and the form keeps what was typed). */
  async function keep() {
    setProblem(null);
    const whole = amountOf(amount);
    if (whole === undefined) {
      setProblem('refuse.customers.amount');
      return false;
    }
    setBusy(true);
    const fields = { name, contact, channel, postId: postId === '' ? null : Number(postId), askedAbout, status, amount: whole, receivedOn: day, followUpOn, code, notes };
    const sent = enquiry
      ? await sendUnconfirmed(`/api/enquiries/${enquiry.id}`, 'PATCH', fields)
      : await sendUnconfirmed('/api/enquiries', 'POST', fields);
    setBusy(false);
    if (!sent.ok || typeof sent.value?.enquiry?.id !== 'number') {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return false;
    }
    return true;
  }

  /** @param {React.FormEvent} event */
  async function save(event) {
    event.preventDefault();
    if (await keep()) onDone('customers.saved');
  }

  /**
   * Add to contacts: saves the form first (so nothing typed is lost), then
   * adds the person to Contacts with their name and contact and no yes, and
   * opens their window there to fill the yes (a person already kept with that
   * number or address opens instead).
   */
  async function addToContacts() {
    if (!(await keep())) return;
    setBusy(true);
    const added = await sendUnconfirmed('/api/contacts', 'POST', { enquiryId: enquiry.id });
    if (!added.ok || typeof added.value?.contact?.id !== 'number') {
      setBusy(false);
      setProblem(added.ok ? 'error.saveUnconfirmed' : added.problem);
      return;
    }
    router.push(`/contacts?open=${added.value.contact.id}`);
  }

  async function remove() {
    setProblem(null);
    setBusy(true);
    const sent = await sendUnconfirmed(`/api/enquiries/${enquiry.id}`, 'DELETE');
    setBusy(false);
    if (!sent.ok || sent.value?.ok !== true) {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    onDone('customers.removed');
  }

  const id = (part) => `enquiry-${enquiry?.id ?? 'new'}-${part}`;

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={id('name')}>{t('customers.field.name', locale)}</FieldLabel>
          <Input id={id('name')} value={name} onValueChange={setName} required maxLength={80} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('contact')}>{t('customers.field.contact', locale)}</FieldLabel>
          <Input id={id('contact')} value={contact} onValueChange={setContact} autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id('channel')}>{t('customers.field.channel', locale)}</FieldLabel>
            <NativeSelect id={id('channel')} className="w-full" value={channel} onChange={(event) => setChannel(event.target.value)}>
              {channelChoices(networks, enquiry?.channel).map((key) => (
                <NativeSelectOption key={key} value={key}>{channelLabel(key, locale)}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={id('post')}>{t('customers.field.post', locale)}</FieldLabel>
            <NativeSelect id={id('post')} className="w-full" value={postId} onChange={(event) => setPostId(event.target.value)}>
              <NativeSelectOption value="">{t('customers.post.none', locale)}</NativeSelectOption>
              {postOptions.map((post) => (
                <NativeSelectOption key={post.id} value={String(post.id)}>
                  {(post.name || t('post.untitled', locale)) + (post.day ? ` · ${formatDate(post.day, locale)}` : '')}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={id('asked')}>{t('customers.field.askedAbout', locale)}</FieldLabel>
          <Input id={id('asked')} value={askedAbout} onValueChange={setAskedAbout} autoComplete="off" />
        </Field>
        <Field>
          <span className="text-sm font-medium">{t('customers.field.status', locale)}</span>
          <StatusRow
            label={t('customers.field.status', locale)}
            value={status}
            onValueChange={setStatus}
            options={ENQUIRY_STATUSES.map((value) => ({ value, label: statusLabel(value, locale) }))}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id('amount')}>{t('customers.field.amount', locale)}</FieldLabel>
            <Input id={id('amount')} value={amount} onValueChange={setAmount} inputMode="numeric" autoComplete="off" />
          </Field>
          <DateField
            id={id('day')}
            className={DATE_FIELD}
            label={t('customers.field.day', locale)}
            value={day}
            onSave={(next) => { setDay(next); return next; }}
            words={{ choose: t('customers.day.choose', locale), invalid: t('customers.day.invalid', locale), failed: t('customers.day.invalid', locale), saved: '' }}
            calendarLocale={locale === 'tr' ? tr : enUS}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {followUpOn === null ? (
            <Field>
              <span className="text-sm font-medium">{t('customers.field.followUpOn', locale)}</span>
              {/* In a div: the Field widens its own children to the whole row. */}
              <div>
                <Button type="button" variant="outline" onClick={() => setFollowUpOn(addDays(today, 1))}>
                  <CalendarPlus aria-hidden="true" />
                  {t('customers.followUp.add', locale)}
                </Button>
              </div>
            </Field>
          ) : (
            <div className="flex min-w-0 items-start gap-1">
              <DateField
                id={id('followUp')}
                className={cn(DATE_FIELD, 'min-w-0 flex-1')}
                label={t('customers.field.followUpOn', locale)}
                value={followUpOn}
                onSave={(next) => { setFollowUpOn(next); return next; }}
                words={{ choose: t('customers.day.choose', locale), invalid: t('customers.day.invalid', locale), failed: t('customers.day.invalid', locale), saved: '' }}
                calendarLocale={locale === 'tr' ? tr : enUS}
              />
              <Button type="button" variant="ghost" size="icon" className="mt-7" aria-label={t('customers.followUp.clear', locale)} onClick={() => setFollowUpOn(null)}>
                <X aria-hidden="true" />
              </Button>
            </div>
          )}
          <Field>
            <FieldLabel htmlFor={id('code')}>{t('customers.field.code', locale)}</FieldLabel>
            <Input id={id('code')} value={code} onValueChange={setCode} maxLength={CODE_MOST} autoComplete="off" spellCheck={false} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={id('notes')}>{t('customers.field.notes', locale)}</FieldLabel>
          <Textarea id={id('notes')} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </Field>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      <DialogFooter className="flex-wrap">
        {enquiry && !removing && (
          <Button type="button" variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => setRemoving(true)}>
            {t('customers.remove', locale)}
          </Button>
        )}
        {enquiry && !removing && (
          <Button type="button" variant="outline" disabled={busy} onClick={addToContacts}>
            <UserPlus aria-hidden="true" />
            {t('contacts.fromEnquiry', locale)}
          </Button>
        )}
        {enquiry && removing && (
          <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
            <span className="text-sm">{t('customers.removeAsk', locale)}</span>
            <Button type="button" variant="destructive" disabled={busy} onClick={remove}>{t('customers.remove', locale)}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setRemoving(false)}>{t('customers.keep', locale)}</Button>
          </div>
        )}
        <Button type="submit" disabled={busy || removing}>{t('customers.save', locale)}</Button>
      </DialogFooter>
    </form>
  );
}
