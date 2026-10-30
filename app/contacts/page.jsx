import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../lib/data/index.js';
import { recordId } from '../../lib/data/customers.js';
import { getLocale, t } from '../../lib/i18n/index.js';
import { todayCivil } from '../../lib/plan/days.js';
import { OWNER } from '../../lib/plan/owner.js';
import { rightsForThisVisit } from '../../lib/plan/visitor.js';
import { Shell } from '../shell.jsx';

import { ContactsView } from './contacts-view.jsx';
import { readContactsPage } from './read.js';

/**
 * Contacts: the people the person may message, each with a yes for WhatsApp
 * and for email and the day it went into İYS; a message box that opens
 * WhatsApp for one person at a time, or copies the email addresses of those
 * with a yes. The app never sends. `?open=<id>` opens that contact's window
 * (Customers' "Add to contacts" lands here). Opening it only reads
 * (AGENTS.md rule 4a), in at most 14 records calls, one at a time.
 */
export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<Record<string, string | string[] | undefined>> }} props */
export default async function ContactsPage({ searchParams }) {
  const locale = getLocale();
  // Who is here decides what the page draws (lib/plan/roles.js); asked before any read, on its own.
  const rights = await rightsForThisVisit();
  const query = (await searchParams) ?? {};
  let read;
  try {
    read = await readContactsPage({ owner: OWNER });
  } catch (error) {
    return (
      <Shell locale={locale} path="/contacts" rights={rights}>
        <h1 className="text-xl font-semibold">{t('menu.contacts', locale)}</h1>
        <Alert variant="destructive">
          <AlertDescription>{t(error instanceof DataError ? error.messageKey : 'error.storageUnreadable', locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  return (
    <Shell locale={locale} path="/contacts" rights={rights} business={read.business}>
      <ContactsView
        locale={locale}
        today={todayCivil()}
        business={read.business}
        contacts={read.contacts}
        answers={read.answers}
        openId={recordId(typeof query.open === 'string' ? query.open : null)}
      />
    </Shell>
  );
}
