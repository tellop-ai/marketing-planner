'use client';

import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileUpload } from '@/components/ui/file-upload';

import { formatDate, formatDecimal } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { isCivilDay } from '../../lib/plan/days.js';
import { problemOf } from '../../lib/plan/picture-rules.js';
import { FILE_ACCEPT, FILE_TYPES, kindOfFile, sendKind, START_BYTES, startOf } from '../../lib/plan/result-kinds.js';

const ADDRESS = '/api/results/import';

/** A file's first bytes, or null when the browser cannot read them. @param {File} file */
async function firstBytes(file) {
  try {
    return new Uint8Array(await file.slice(0, START_BYTES).arrayBuffer());
  } catch {
    return null;
  }
}

/** A whole count read from an answer (0 when none). @param {unknown} value */
const countOf = (value) => (Number.isSafeInteger(value) && /** @type {number} */ (value) > 0 ? /** @type {number} */ (value) : 0);

/**
 * Read a numbers file (Results, beside the download): a press opens a window
 * where the person picks the posts file Meta Business Suite or LinkedIn gave
 * them, and **Read the file** sends it to the app, which fills the results
 * of the shared posts its rows match. The window then says what happened
 * (rows filled, rows that matched no shared post with their first days, rows
 * that could not be read) and the page reads its figures again. A refusal
 * shows as a line and keeps the file. Closing the window forgets the file.
 *
 * @param {{ locale: string }} props
 */
export function ImportDialog({ locale }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet aria-hidden="true" />
        {t('results.import.open', locale)}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(false);
        }}
      >
        {open && <ImportWindow locale={locale} busy={busy} onBusy={setBusy} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

/**
 * The window's content (`ImportDialog` draws it only while open, so its
 * state, the picked file included, goes when it closes).
 *
 * @param {{ locale: string, busy: boolean, onBusy: (busy: boolean) => void, onClose: () => void }} props
 */
export function ImportWindow({ locale, busy, onBusy, onClose }) {
  const router = useRouter();
  const [files, setFiles] = useState(/** @type {File[]} */ ([]));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [answer, setAnswer] = useState(/** @type {any} */ (null));

  async function readFile() {
    const file = files[0];
    if (busy || !file) return;
    onBusy(true);
    setProblem(null);
    const named = kindOfFile(file.name);
    const sending = sendKind(named, named === 'csv' || named === null ? 'other' : startOf(await firstBytes(file)));
    if ('problem' in sending) {
      onBusy(false);
      setProblem(sending.problem);
      return;
    }
    let response = null;
    try {
      response = await fetch(ADDRESS, { method: 'POST', cache: 'no-store', headers: { 'content-type': FILE_TYPES[sending.kind] }, body: file });
    } catch {
      response = null;
    }
    const value = response === null ? null : await response.json().catch(() => null);
    onBusy(false);
    if (response === null || !response.ok || value === null || typeof value !== 'object' || !Number.isSafeInteger(value.filled)) {
      // No answer means the app may or may not have filled some rows.
      setProblem(problemOf(value, response === null || value === null ? 'error.saveUnconfirmed' : 'error.saveFailed'));
      if (countOf(value?.filled) > 0) {
        setAnswer({ filled: value.filled });
        router.refresh();
      }
      return;
    }
    setAnswer(value);
    setFiles([]);
    router.refresh();
  }

  const days = Array.isArray(answer?.notMatchedDays)
    ? answer.notMatchedDays.filter((day) => isCivilDay(day)).map((day) => formatDate(day, locale)).join(' · ')
    : '';
  const whole = (value) => formatDecimal(String(value), locale);
  const lines = answer === null ? [] : [
    { key: 'filled', words: t(countOf(answer.filled) === 1 ? 'results.import.filled.one' : 'results.import.filled.other', locale, { count: whole(countOf(answer.filled)) }), strong: true },
    ...(countOf(answer.notMatched) > 0
      ? [{ key: 'notMatched', words: t(answer.notMatched === 1 ? 'results.import.notMatched.one' : 'results.import.notMatched.other', locale, { count: whole(answer.notMatched) }), more: days === '' ? '' : t('results.import.days', locale, { days }) }]
      : []),
    ...(countOf(answer.skipped) > 0
      ? [{ key: 'skipped', words: t(answer.skipped === 1 ? 'results.import.skipped.one' : 'results.import.skipped.other', locale, { count: whole(answer.skipped) }) }]
      : []),
    ...(countOf(answer.left) > 0 && isCivilDay(answer.leftBefore)
      ? [{ key: 'left', words: t(answer.left === 1 ? 'results.import.left.one' : 'results.import.left.other', locale, { count: whole(answer.left), day: formatDate(answer.leftBefore, locale) }) }]
      : []),
  ];

  return (
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileSpreadsheet aria-hidden="true" className="size-4 text-muted-foreground" />
          {t('results.import.open', locale)}
        </DialogTitle>
      </DialogHeader>
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        {answer === null && (
          <FileUpload
            accept={FILE_ACCEPT}
            files={files}
            onFiles={(next) => {
              setFiles(next);
              setProblem(null);
            }}
            label={t('results.import.drop', locale)}
            chooseLabel={t('results.import.choose', locale)}
            removeLabel={t('results.import.takeOut', locale)}
            rejectedLabel={t('results.import.wrongKind', locale)}
            tooManyLabel={t('results.import.oneFile', locale)}
          />
        )}
        {lines.length > 0 && (
          <ul role="status" className="flex flex-col gap-1.5 text-sm">
            {lines.map((line) => (
              <li key={line.key} className={line.strong ? 'font-medium' : 'text-muted-foreground'}>
                {line.words}
                {line.more ? <span className="text-muted-foreground"> {line.more}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {answer !== null && countOf(answer.notMatched) > 0 && (
          <p className="text-xs text-muted-foreground">{t('results.import.howMatch', locale)}</p>
        )}
        {problem !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t(problem, locale)}
          </p>
        )}
      </div>
      <DialogFooter>
        {answer === null ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('results.import.cancel', locale)}
            </Button>
            <Button type="button" disabled={busy || files.length === 0} onClick={readFile}>
              {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {t('results.import.read', locale)}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={onClose}>
            {t('results.import.done', locale)}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
