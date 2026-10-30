'use client';

import { Check, Clock, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CountsLine } from '@/components/ui/counts-line';
import { DataTable } from '@/components/ui/data-table';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';

import { useRights } from '../rights.jsx';

import { ContactDialog } from './contact-dialog.jsx';
import { channelGate, emailList, phoneText, whatsAppQueue } from './rules.js';
import { SendCard } from './send-card.jsx';

/**
 * The list's look: on a narrow window only the first column shows, and each
 * contact reads as a stacked row (name, then WhatsApp, email and İYS); from
 * `sm` up, the columns.
 */
const NARROW_LIST = 'max-sm:[&_th:not(:first-child)]:hidden max-sm:[&_td:not(:first-child)]:hidden';

/** How a gate sorts in its column: those who can get a message first. */
const GATE_ORDER = Object.freeze({ ok: 0, remind: 1, late: 2, noAddress: 3, noConsent: 4 });

/**
 * One channel's state for a contact in the list: the yes day (with a clock
 * and the İYS deadline while it waits for its İYS day), "Not in İYS" once that
 * passed, "No number"/"No address" for a yes with nowhere to send, a dash for
 * no yes.
 *
 * @param {{ contact: object, channel: 'whatsapp' | 'email', today: string, locale: string }} props
 */
function GateCell({ contact, channel, today, locale }) {
  const gate = channelGate(contact, channel, today);
  if (gate.state === 'noConsent') {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{t('contacts.state.no', locale)}</span>
      </span>
    );
  }
  if (gate.state === 'noAddress') return <Badge variant="outline">{t(channel === 'whatsapp' ? 'contacts.state.noPhone' : 'contacts.state.noEmail', locale)}</Badge>;
  if (gate.state === 'late') return <Badge variant="destructive">{t('contacts.state.late', locale)}</Badge>;
  if (gate.state === 'remind') {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />
        {t('contacts.state.remind', locale, { day: formatDate(gate.deadline, locale) })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Check aria-hidden="true" className="size-3.5 text-primary" />
      {formatDate(gate.consentOn, locale)}
    </span>
  );
}

/**
 * A contact's states under its name on a narrow window: WhatsApp, email and
 * the İYS day, one line each.
 *
 * @param {{ contact: object, today: string, locale: string }} props
 */
function StackedStates({ contact, today, locale }) {
  return (
    <dl className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs whitespace-normal sm:hidden">
      {['whatsapp', 'email'].map((channel) => (
        <div key={channel} className="contents">
          <dt className="text-muted-foreground">{t(`contacts.channel.${channel}`, locale)}</dt>
          <dd><GateCell contact={contact} channel={channel} today={today} locale={locale} /></dd>
        </div>
      ))}
      <dt className="text-muted-foreground">{t('contacts.col.iys', locale)}</dt>
      <dd>{contact.iysOn ? formatDate(contact.iysOn, locale) : <span aria-hidden="true" className="text-muted-foreground">–</span>}</dd>
    </dl>
  );
}

/**
 * The Contacts page: its counts, Message one by one, and the list (name,
 * WhatsApp, email, İYS day; search reaches numbers and addresses too; on a
 * narrow window each contact is a stacked row). A name opens its window; Add
 * opens an empty one; `openId` (from `?open=<id>`) opens that contact's
 * window once, as Customers' "Add to contacts" asks. Add is drawn only for a
 * person who may add (`useRights`); a contact's window is read only for a
 * person who may not change it (`ContactForm`).
 *
 * @param {{ locale: string, today: string, business: string, contacts: import('../../lib/data/contacts.js').ContactSummary[],
 *   answers: Array<{ id: number, kind: string, title: string, text: string }>, openId: number | null }} props
 */
export function ContactsView({ locale, today, business, contacts, answers, openId }) {
  const router = useRouter();
  const { add: canAdd } = useRights();
  const [editing, setEditing] = useState(/** @type {{ id: number | null, title: string | null } | null} */ (null));
  const [notice, setNotice] = useState(/** @type {string | null} */ (null));

  // The list by name as the language sorts it (the records sort letters by their codes).
  const sorted = useMemo(() => [...contacts].sort((a, b) => a.name.localeCompare(b.name, locale) || a.id - b.id), [contacts, locale]);

  useEffect(() => {
    if (openId === null) return;
    const found = contacts.find((contact) => contact.id === openId);
    if (found) setEditing({ id: found.id, title: found.name });
    // The address opens it once: a refresh shows the list.
    try {
      const address = new URL(window.location.href);
      address.searchParams.delete('open');
      window.history.replaceState(window.history.state, '', address);
    } catch {
      // The window still opens; only a refresh would open it again.
    }
    // Only the first `openId` the page was opened with.
  }, []);

  /** @param {string} key what the window confirmed */
  function done(key) {
    setEditing(null);
    setNotice(key);
    router.refresh();
  }

  const counts = useMemo(() => [
    { key: 'people', label: t('contacts.count.people', locale), value: contacts.length },
    // As Message one by one counts them: one number, one address once.
    { key: 'whatsapp', label: t('contacts.count.whatsapp', locale), value: whatsAppQueue(contacts, today).length },
    { key: 'email', label: t('contacts.count.email', locale), value: emailList(contacts, today).length },
  ], [contacts, locale, today]);

  const columns = useMemo(() => [
    {
      id: 'name',
      // Search reaches the number and the address; the cell shows the name.
      accessorFn: (row) => `${row.name} ${row.phone} ${phoneText(row.phone)} ${row.email}`,
      header: t('contacts.field.name', locale),
      cell: ({ row }) => (
        <div className="min-w-0">
          <Button type="button" variant="link" size="sm" className="max-w-56 justify-start px-0" onClick={() => { setNotice(null); setEditing({ id: row.original.id, title: row.original.name }); }}>
            <span className="truncate">{row.original.name}</span>
          </Button>
          <StackedStates contact={row.original} today={today} locale={locale} />
        </div>
      ),
    },
    ...['whatsapp', 'email'].map((channel) => ({
      id: channel,
      accessorFn: (row) => GATE_ORDER[channelGate(row, channel, today).state],
      header: t(`contacts.channel.${channel}`, locale),
      cell: ({ row }) => <GateCell contact={row.original} channel={channel} today={today} locale={locale} />,
    })),
    {
      id: 'iysOn',
      accessorFn: (row) => row.iysOn ?? '',
      header: t('contacts.col.iys', locale),
      cell: ({ row }) => (row.original.iysOn ? formatDate(row.original.iysOn, locale) : <span aria-hidden="true" className="text-muted-foreground">–</span>),
    },
  ], [locale, today]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('contacts.title', locale)}</h1>
        {canAdd && (
          <Button type="button" className="ml-auto" onClick={() => { setNotice(null); setEditing({ id: null, title: null }); }}>
            <Plus aria-hidden="true" />
            {t('contacts.add', locale)}
          </Button>
        )}
      </header>
      {notice && <p role="status" className="text-sm text-muted-foreground">{t(notice, locale)}</p>}
      <CountsLine items={counts} />
      <SendCard locale={locale} today={today} business={business} contacts={sorted} answers={answers} />
      <DataTable
        className={NARROW_LIST}
        columns={columns}
        data={sorted}
        locale={locale}
        searchPlaceholder={t('contacts.search', locale)}
        emptyTitle={t('contacts.empty', locale)}
        emptyDescription={null}
      />
      <ContactDialog
        open={editing !== null}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        contactId={editing?.id ?? null}
        title={editing?.title ?? null}
        locale={locale}
        today={today}
        onDone={done}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
