'use client';

import { CalendarClock, Check, Copy, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { useRights } from '../rights.jsx';
import { sendUnconfirmed } from '../send.js';

import { followUpChange, followUpMessage, FOLLOW_UPS_SHOWN, listedFollowUps, whatsAppAddress, whatsAppDigits } from './follow-ups.js';
import { shortDay } from './format.js';

/**
 * The people to follow up with today, on the Today card:
 * each one's name and what they asked, and three presses. **Follow up**
 * copies a short follow-up line; for a phone contact it is a link to
 * WhatsApp's own address with the line ready, its press starting the copy
 * first (the app sends nothing). **Done** clears the follow-up day,
 * **Tomorrow** moves it to tomorrow; each says what happened only after the
 * app confirms, then the calendar reads again and the person leaves the list.
 * The first few show; "Show all" shows the rest. When more are due than the
 * card lists, "And more in Customers" links to them. Done and Tomorrow
 * change the customer's record, so only a person who may change sees them
 * (`useRights`); Follow up saves nothing and stays for everyone.
 *
 * @param {{ locale: string, today: string, business: string,
 *   followUps: Array<{ id: number, name: string, contact: string, askedAbout: string, followUpOn: string }>, className?: string }} props
 */
export function FollowUpsList({ locale, today, business, followUps, className }) {
  const router = useRouter();
  const { change: canChange } = useRights();
  const [all, setAll] = useState(false);
  const [handled, setHandled] = useState(() => new Set());
  const [working, setWorking] = useState(/** @type {number | null} */ (null));
  const [lines, setLines] = useState(/** @type {Record<number, { key: string, failed?: boolean, message?: string }>} */ ({}));

  const { people, more } = listedFollowUps(followUps);
  const open = people.filter((followUp) => !handled.has(followUp.id));
  if (open.length === 0) return null;
  const shown = all ? open : open.slice(0, FOLLOW_UPS_SHOWN);
  const say = (id, line) => setLines((before) => ({ ...before, [id]: line }));

  /** Starts the copy inside the press, before a WhatsApp link opens, so the browser allows it. */
  function copy(id, message, opensWhatsApp) {
    say(id, null);
    let writing;
    try {
      writing = navigator.clipboard?.writeText(message);
    } catch {
      writing = undefined;
    }
    // WhatsApp opens with the line in it anyway; a copy that failed shows the line to select by hand.
    const failed = () => say(id, opensWhatsApp ? { key: 'calendar.followUp.copyFailedWhatsApp', failed: true } : { key: 'calendar.followUp.copyFailed', failed: true, message });
    if (!writing) {
      failed();
      return;
    }
    writing.then(() => say(id, { key: 'calendar.followUp.copied' }), failed);
  }

  /** @param {number} id @param {'done' | 'tomorrow'} press */
  async function change(id, press) {
    if (working !== null) return;
    setWorking(id);
    say(id, null);
    const sent = await sendUnconfirmed(`/api/enquiries/${id}`, 'PATCH', followUpChange(press, today));
    setWorking(null);
    if (!sent.ok || typeof sent.value?.enquiry?.id !== 'number') {
      say(id, { key: sent.ok ? 'error.saveUnconfirmed' : sent.problem, failed: true });
      return;
    }
    setHandled((before) => new Set(before).add(id));
    router.refresh();
  }

  return (
    <section aria-label={t('calendar.followUp.title', locale)} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <MessageCircle aria-hidden="true" className="size-4 text-muted-foreground" />
        {t('calendar.followUp.title', locale)}
        <Badge variant="secondary">{more ? `${open.length}+` : open.length}</Badge>
      </h2>
      <ul className="flex min-w-0 flex-col divide-y divide-border">
        {shown.map((followUp) => {
          const message = followUpMessage(followUp, business, locale);
          const digits = whatsAppDigits(followUp.contact, locale);
          const line = lines[followUp.id];
          const late = followUp.followUpOn < today;
          const about = [followUp.askedAbout, late ? shortDay(followUp.followUpOn, locale) : ''].filter((part) => part !== '').join(' · ');
          const busy = working !== null;
          return (
            <li key={followUp.id} className="flex min-w-0 flex-col gap-1 py-2 last:pb-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate font-medium">{followUp.name}</div>
                  {about && <div className="truncate text-xs text-muted-foreground">{about}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {digits ? (
                    <a
                      href={whatsAppAddress(digits, message)}
                      target="_blank"
                      rel="noopener"
                      onClick={() => copy(followUp.id, message, true)}
                      className={buttonVariants({ size: 'sm' })}
                    >
                      <MessageCircle aria-hidden="true" />
                      {t('calendar.followUp.press', locale)}
                    </a>
                  ) : (
                    <Button type="button" size="sm" onClick={() => copy(followUp.id, message, false)}>
                      <Copy aria-hidden="true" />
                      {t('calendar.followUp.press', locale)}
                    </Button>
                  )}
                  {canChange && (
                    <>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => change(followUp.id, 'done')}>
                        <Check aria-hidden="true" />
                        {t('calendar.followUp.done', locale)}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => change(followUp.id, 'tomorrow')}>
                        <CalendarClock aria-hidden="true" />
                        {t('calendar.followUp.tomorrow', locale)}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {line && (
                <p role={line.failed ? 'alert' : 'status'} className={cn('text-xs', line.failed ? 'text-destructive' : 'text-muted-foreground')}>
                  {t(line.key, locale)}
                </p>
              )}
              {line?.message && <p className="rounded-md bg-muted px-2 py-1 text-xs whitespace-pre-line select-all">{line.message}</p>}
            </li>
          );
        })}
      </ul>
      {open.length > FOLLOW_UPS_SHOWN && (
        <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => setAll((before) => !before)}>
          {all ? t('calendar.followUp.fewer', locale) : t('calendar.followUp.all', locale, { count: String(open.length) })}
        </Button>
      )}
      {more && (
        <Link href="/customers" className="w-fit text-sm font-medium underline underline-offset-4">
          {t('calendar.followUp.more', locale)}
        </Link>
      )}
    </section>
  );
}
