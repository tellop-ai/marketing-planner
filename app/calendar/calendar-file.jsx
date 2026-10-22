'use client';

import { CircleCheck, Download } from 'lucide-react';
import { useEffect, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

import { t } from '../../lib/i18n/index.js';
import { pressStillCounts } from '../posts/[id]/rules.js';
import { sendUnconfirmed } from '../send.js';

import { calendarFileSpan } from './rules.js';

/**
 * What Add to my calendar asks for (`calendarFileSpan`), with the names of
 * the download and of the calendar file inside it in the person's language.
 *
 * @param {{ kind: 'month' | 'week', month: string, from: string, to: string }} view
 * @param {string} locale
 */
function calendarFileRequest(view, locale) {
  const { body, label } = calendarFileSpan(view);
  return { body, zipName: t('calendar.export.zipName', locale, { month: label }), fileName: t('calendar.export.fileName', locale, { month: label }) };
}

/** Starts a download of a kept file under `name`. @param {string} address @param {string} name */
function startDownload(address, name) {
  const link = document.createElement('a');
  link.href = address;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * **Add to my calendar**: the press asks the app to write the view's calendar
 * file (`POST /api/export/calendar`, a zip holding the `.ics` file) and then
 * downloads it in the same press while the browser still counts it as pressed
 * (`pressStillCounts`); after that it offers a Download press instead. The
 * answer resets when the view moves to another month or week.
 *
 * @param {string} locale
 * @param {{ kind: 'month' | 'week', month: string, from: string, to: string }} view
 */
export function useCalendarFile(locale, view) {
  const [state, setState] = useState(/** @type {{ step: 'idle' | 'making' | 'started' } | { step: 'ready', address: string } | { step: 'failed', problem: string }} */ ({ step: 'idle' }));
  const key = `${view.kind}:${view.from}:${view.to}`;
  useEffect(() => setState({ step: 'idle' }), [key]);

  async function start() {
    if (state.step === 'making') return;
    const pressed = Date.now();
    const asked = calendarFileRequest(view, locale);
    setState({ step: 'making' });
    const made = await sendUnconfirmed('/api/export/calendar', 'POST', asked.body);
    if (!made.ok || typeof made.value?.address !== 'string') {
      setState({ step: 'failed', problem: made.ok ? 'error.saveUnconfirmed' : made.problem });
      return;
    }
    if (pressStillCounts(globalThis.navigator?.userActivation, Date.now() - pressed)) {
      startDownload(made.value.address, asked.zipName);
      setState({ step: 'started' });
      return;
    }
    setState({ step: 'ready', address: made.value.address });
  }

  return { ...state, start, request: calendarFileRequest(view, locale) };
}

/**
 * The line under the calendar's top line after Add to my calendar: what to
 * open once the file is downloaded, the Download press when the first press
 * no longer counted, or the app's refusal.
 *
 * @param {{ locale: string, file: ReturnType<typeof useCalendarFile> }} props
 */
export function CalendarFileLine({ locale, file }) {
  if (file.step === 'failed') {
    return <p data-print-hidden role="alert" className="text-sm text-destructive">{t(file.problem, locale)}</p>;
  }
  if (file.step === 'ready') {
    return (
      <div data-print-hidden role="status" className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t('calendar.export.ready', locale)}</span>
        <a href={file.address} download={file.request.zipName} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Download aria-hidden="true" />
          {t('calendar.export.download', locale)}
        </a>
      </div>
    );
  }
  if (file.step === 'started') {
    return (
      <p data-print-hidden role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
        {t('calendar.export.started', locale, { file: file.request.fileName })}
      </p>
    );
  }
  return null;
}
