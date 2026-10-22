'use client';

import { CalendarClock, ChartColumn, CircleCheck, Copy, Download, Ellipsis, FileText, LoaderCircle, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { keepShapes } from '../../../lib/plan/draw.js';
import { LIMITS, RESULT_COUNTS } from '../../../lib/plan/limits.js';
import { networkByKey } from '../../../lib/plan/networks.js';
import { shareFor } from '../../../lib/plan/share.js';
import { isAhead } from '../../../lib/plan/state.js';
import { fileAddress, setOf, tipPlace } from '../../pictures/rules.js';
import { dayOfInstant } from '../../results/figures.js';

import { bundleSet } from './bundle.js';
import {
  countFieldText,
  dateOfDay,
  dayText,
  localWhen,
  pressStillCounts,
  readResultsForm,
  saveStep,
  SCHEDULE_TIME,
  setSavable,
  shapeOf,
  shareLabelKey,
  shareMark,
  shortDayText,
  slidesFor,
  timeText,
} from './rules.js';
import { send } from '../../send.js';
import { versionAddress } from './addresses.js';

/** The words key of each results count's label. */
const RESULT_LABELS = Object.freeze({
  views: 'share.views',
  likes: 'share.likes',
  comments: 'share.comments',
  shares: 'share.shares',
  saves: 'share.saves',
  clicks: 'share.clicks',
});

/** A step's number, as drawn. */
function StepNumber({ n, primary = false }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        primary ? 'bg-primary-foreground/20' : 'bg-muted text-foreground',
      )}
    >
      {n}
    </span>
  );
}

/** The words key a thrown problem carries, else `fallback`. */
function keyOf(error, fallback) {
  return typeof error?.messageKey === 'string' ? error.messageKey : fallback;
}

/** A kept copy's download address: the window's pressed download (Tellop shows the save dialog). */
function downloadAddress(picture, shape) {
  return `${fileAddress(picture.id, shape, picture.shapes?.[shape])}&download=1`;
}

/** Starts the download of an address as a press on a link would (`name`: the file's name, where the browser takes one). */
function startDownload(address, name = '') {
  const link = document.createElement('a');
  link.href = address;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Whether the post's planned day and time (12:00 with no time) are still ahead: Mark scheduled can keep them. */
function plannedAhead(day, time) {
  const date = dateOfDay(day);
  if (date === undefined) return false;
  const [hours, minutes] = (typeof time === 'string' && /^\d{2}:\d{2}$/u.test(time) ? time : SCHEDULE_TIME).split(':').map(Number);
  date.setHours(hours, minutes, 0, 0);
  return isAhead(date.toISOString(), Date.now());
}

/**
 * Sharing one network's post, as drawn: **1 Save picture** (a press
 * downloads the chosen picture in the network's shape; Tellop shows the save
 * dialog), **2 Copy and open** (the words go on the clipboard first, then the
 * network's site or share address opens in the person's browser), then
 * **I shared it**. Once shared: the day, Undo, and a "⋯" with Results.
 *
 * Save picture is one press: when the shape's copy is not kept yet (the page
 * never saves as it opens), the press makes it and then downloads it while
 * the press still counts (`pressStillCounts`); past that, the copy is kept
 * and Save picture downloads at the next press. A comment card whose customer
 * has not said yes rests Save picture (the preview says why).
 *
 * On a network that takes a set, with a swipe set of two or more pictures,
 * step 1 is **Save pictures (n)**: the set's first n pictures (as many as the
 * network takes) in one zip (`SaveSet`); on a network with stories and a
 * story set, **Save story (n)** too; on LinkedIn, **Print as a document**
 * (one slide a page: the person saves it as a PDF from the print window).
 *
 * Beside I shared it, **Mark scheduled** (the post's day and
 * time, 12:00 when it has no time; it rests with its reason when the post has
 * no day or that moment has passed). A scheduled version reads "Scheduled for
 * Thu 23 Oct, 18:30" with Undo; once that moment passes it reads as shared.
 *
 * @param {{
 *   locale: string, postId: number, network: string, version: any, picture: any, full: any, themeColour: number | null,
 *   business: string, today: string, onVersion: (version: any) => void, onPicture: (picture: any) => void,
 *   onPrintSlides?: () => void, tracking?: import('../../../lib/plan/share.js').Tracking,
 * }} props
 */
export function ShareSteps({ locale, postId, network, version, picture, full, themeColour, business, today, onVersion, onPicture, onPrintSlides, tracking }) {
  const [copyRefused, setCopyRefused] = useState(false);
  const [readying, setReadying] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [results, setResults] = useState(false);
  const [resultsSaved, setResultsSaved] = useState(false);
  // Mark scheduled's answer said the post had no time, so 12:00 was kept.
  const [timeAssumed, setTimeAssumed] = useState(false);

  const item = networkByKey(network);
  const shape = shapeOf(network);
  const share = shareFor(network, version, tracking);
  const labelKey = shareLabelKey(network, share);
  const slides = slidesFor(network, setOf(full, 'slide'));
  const stories = item?.storyOk === true ? setOf(full, 'story') : [];
  const step = slides !== null ? 'set' : saveStep(picture, shape);
  const hasPicture = step !== 'none';
  const marked = shareMark(version, Date.now());
  const sharedDay = marked === 'shared' ? dayOfInstant(version.sharedAt) : null;
  const scheduledAt = marked === 'scheduled' ? localWhen(version.sharedAt) : null;
  const planned = full?.post ?? { day: null, time: null };
  const canSchedule = plannedAhead(planned.day, planned.time);
  const placeOf = (each) => tipPlace(full, each);
  // Nothing to share before the network has words (unless it was marked shared already).
  const ready = version.text.trim() !== '' || marked !== 'open';

  function copyFirst() {
    setCopyRefused(false);
    try {
      const copying = navigator.clipboard?.writeText(share?.copyText ?? '');
      if (copying === undefined) setCopyRefused(true);
      else copying.catch(() => setCopyRefused(true));
    } catch {
      setCopyRefused(true);
    }
  }

  async function saveAfterDrawing() {
    if (readying || step !== 'draw') return;
    const pressed = Date.now();
    setReadying(true);
    setProblem(null);
    let kept;
    try {
      kept = await keepShapes(picture, [shape], { themeColour, business, place: tipPlace(full, picture) });
    } catch (error) {
      setProblem(keyOf(error, '') === 'error.fileRoom' ? 'error.fileRoom' : 'pictures.notReady');
      return;
    } finally {
      setReadying(false);
    }
    onPicture(kept);
    if (saveStep(kept, shape) === 'file' && pressStillCounts(navigator.userActivation, Date.now() - pressed)) startDownload(downloadAddress(kept, shape));
  }

  async function mark(body) {
    if (working) return;
    setWorking(true);
    setProblem(null);
    setResultsSaved(false);
    const answer = await send(versionAddress(postId, network), 'POST', body);
    setWorking(false);
    if (!answer.ok || !answer.value?.version) {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    setTimeAssumed(body.action === 'scheduled' && answer.value.timeAssumed === true);
    onVersion(answer.value.version);
  }

  const copyStep = hasPicture ? 2 : 1;
  return (
    <section id="share" aria-label={t('share.title', locale)} className="flex w-full max-w-[330px] min-w-0 flex-1 scroll-mt-6 flex-col gap-2.5 pt-1 xl:max-w-none">
      {ready && (
        <>
          {step === 'set' && (
            <SaveSet
              locale={locale}
              kind="slide"
              n={1}
              pictures={slides}
              shape={shape}
              themeColour={themeColour}
              business={business}
              placeOf={placeOf}
              onPicture={onPicture}
            />
          )}
          {step === 'file' && (
            <a
              href={downloadAddress(picture, shape)}
              download
              className={buttonVariants({ variant: 'outline', size: 'lg', className: 'w-full justify-start bg-card' })}
            >
              <StepNumber n={1} />
              <Download aria-hidden="true" />
              <span className="truncate">{t('share.savePicture', locale)}</span>
            </a>
          )}
          {(step === 'draw' || step === 'refused') && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={readying || step === 'refused'}
              onClick={saveAfterDrawing}
              className="w-full justify-start bg-card"
            >
              <StepNumber n={1} />
              {readying ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
              <span className="truncate">{readying ? t('share.gettingReady', locale) : t('share.savePicture', locale)}</span>
            </Button>
          )}
          {stories.length > 0 && (
            <SaveSet
              locale={locale}
              kind="story"
              n={null}
              pictures={stories}
              shape="story"
              themeColour={themeColour}
              business={business}
              placeOf={placeOf}
              onPicture={onPicture}
            />
          )}
          {network === 'linkedin' && slides !== null && typeof onPrintSlides === 'function' && (
            <Button type="button" variant="outline" size="lg" onClick={onPrintSlides} className="w-full justify-start bg-card">
              <FileText aria-hidden="true" />
              <span className="truncate">{t('share.printDocument', locale)}</span>
            </Button>
          )}
          {share !== null && labelKey !== null && (
            <a
              href={share.address}
              target="_blank"
              rel="noopener"
              onClick={copyFirst}
              className={buttonVariants({ size: 'lg', className: 'w-full justify-start' })}
            >
              <StepNumber n={copyStep} primary />
              {/* An address that carries the words needs no copy mark (and the longer names need its room). */}
              {share.kind === 'address' && labelKey.startsWith('share.openWith.') ? null : <Copy aria-hidden="true" />}
              <span className="truncate">{t(labelKey, locale)}</span>
            </a>
          )}
          {copyRefused && (
            <p role="alert" className="text-sm text-muted-foreground">
              {t('share.copyRefused', locale)}
            </p>
          )}
          <div className="my-1 border-t border-border" />
          {marked === 'open' && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                <Button type="button" variant="ghost" disabled={working} onClick={() => mark({ action: 'shared' })} className="w-fit text-muted-foreground">
                  {working ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <CircleCheck aria-hidden="true" />}
                  {t('share.shared', locale)}
                </Button>
                <Button type="button" variant="ghost" disabled={working || !canSchedule} onClick={() => mark({ action: 'scheduled' })} className="w-fit text-muted-foreground">
                  <CalendarClock aria-hidden="true" />
                  {t('share.markScheduled', locale)}
                </Button>
              </div>
              {!canSchedule && (
                <p className="text-sm text-muted-foreground">{t(planned.day ? 'share.schedulePassed' : 'share.scheduleNeedsDay', locale)}</p>
              )}
            </>
          )}
          {marked === 'scheduled' && (
            <>
              {/* The moment may be long ("Scheduled for Thu 23 Oct, 18:30"): it wraps before Undo is cut off. */}
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <span className="inline-flex min-h-8 min-w-0 items-center gap-1.5 px-2.5 py-1 text-sm font-medium">
                  <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    {t('share.scheduledFor', locale, {
                      when: scheduledAt === null ? '' : t('maker.when', locale, { day: dayText(scheduledAt.day, locale, today), time: timeText(scheduledAt.time, locale) }),
                    })}
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => mark({ action: 'unshared' })} className="shrink-0 text-muted-foreground">
                  {working ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Undo2 aria-hidden="true" />}
                  {t('share.undo', locale)}
                </Button>
              </div>
              {(timeAssumed || planned.time === null) && (
                <p className="text-sm text-muted-foreground">{t('share.timeAssumed', locale, { time: timeText(SCHEDULE_TIME, locale) })}</p>
              )}
            </>
          )}
          {marked === 'shared' && (
            <div className="flex min-w-0 items-center gap-1">
              {/* One line: the day gives way (cut short) before Undo or the "⋯" would wrap alone. */}
              <span className="inline-flex h-8 min-w-0 items-center gap-1.5 px-2.5 text-sm font-medium">
                <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 truncate">{t('share.sharedOn', locale, { day: shortDayText(sharedDay, locale, today) })}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => mark({ action: 'unshared' })} className="shrink-0 text-muted-foreground">
                {working ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Undo2 aria-hidden="true" />}
                {t('share.undo', locale)}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t('share.more', locale, { network: item?.name ?? network })} disabled={working} className="shrink-0" />}
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-40">
                  <DropdownMenuItem
                    onClick={() => {
                      setResultsSaved(false);
                      setResults(true);
                    }}
                  >
                    <ChartColumn aria-hidden="true" />
                    {t('share.results', locale)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {resultsSaved && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('share.resultsSaved', locale)}
            </p>
          )}
          {problem !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t(problem, locale)}
            </p>
          )}
        </>
      )}
      {results && (
        <ResultsDialog
          locale={locale}
          postId={postId}
          network={network}
          version={version}
          onSaved={(saved) => {
            setResults(false);
            setResultsSaved(true);
            onVersion(saved);
          }}
          onClose={() => setResults(false)}
        />
      )}
    </section>
  );
}

/**
 * Save pictures (n) or Save story (n): the set's pictures in one zip
 * (`bundleSet`), downloaded in the same press while it still counts
 * (`pressStillCounts`), else by a Download press. A set the page cannot
 * save (a comment card waiting for the customer's yes) rests the press with
 * its reason. `n`: the share step's number (none for the story).
 */
function SaveSet({ locale, kind, n, pictures, shape, themeColour, business, placeOf, onPicture }) {
  const [working, setWorking] = useState(false);
  const [address, setAddress] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const savable = setSavable(pictures, shape);
  const zipName = t(kind === 'story' ? 'share.storyZipName' : 'share.slidesZipName', locale);
  const count = String(pictures.length);

  async function save() {
    if (working || !savable.ok) return;
    const pressed = Date.now();
    setWorking(true);
    setProblem(null);
    setAddress(null);
    try {
      const kept = await bundleSet(pictures, shape, { themeColour, business, placeOf, onKept: onPicture });
      if (pressStillCounts(navigator.userActivation, Date.now() - pressed)) startDownload(kept, zipName);
      else setAddress(kept);
    } catch (error) {
      setProblem(keyOf(error, 'pictures.notReady'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="lg" disabled={working || !savable.ok} onClick={save} className="w-full justify-start bg-card">
        {n !== null && <StepNumber n={n} />}
        {working ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
        <span className="truncate">{working ? t('share.gettingReady', locale) : t(kind === 'story' ? 'share.saveStory' : 'share.savePictures', locale, { n: count })}</span>
      </Button>
      {address !== null && (
        <a href={address} download={zipName} onClick={() => setAddress(null)} className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}>
          <Download aria-hidden="true" />
          {t('share.download', locale)}
        </a>
      )}
      {!savable.ok && <p className="text-sm text-muted-foreground">{t(savable.reason, locale)}</p>}
      {problem !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(problem, locale)}
        </p>
      )}
    </>
  );
}

/**
 * A shared network's results, all optional: the post's address there, its
 * counts and a line of words. Save keeps the address (when changed) and then
 * the results; the dialog closes only after the app confirms both.
 */
function ResultsDialog({ locale, postId, network, version, onSaved, onClose }) {
  const id = useId();
  const [address, setAddress] = useState(version.sharedLink ?? '');
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(RESULT_COUNTS.map((name) => [name, countFieldText(version[name])])),
    resultNote: version.resultNote ?? '',
  }));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(/** @type {{ key: string, field?: string } | null} */ (null));
  const item = networkByKey(network);

  async function save(event) {
    event.preventDefault();
    if (working) return;
    const read = readResultsForm(form);
    if (!read.ok) {
      setProblem({ key: read.problem, field: read.field });
      return;
    }
    setWorking(true);
    setProblem(null);
    try {
      if (address.trim() !== (version.sharedLink ?? '')) {
        const linked = await send(versionAddress(postId, network), 'POST', { action: 'shared', sharedLink: address.trim() });
        if (!linked.ok || !linked.value?.version) {
          setProblem({ key: linked.ok ? 'error.saveUnconfirmed' : linked.problem, field: 'address' });
          return;
        }
      }
      const answer = await send(versionAddress(postId, network), 'POST', { action: 'results', ...read.value });
      if (!answer.ok || !answer.value?.version) {
        setProblem({ key: answer.ok ? 'error.saveUnconfirmed' : answer.problem });
        return;
      }
      onSaved(answer.value.version);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t('share.resultsTitle', locale, { network: item?.name ?? network })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-address`}>{t('share.address', locale)}</Label>
              <Input
                id={`${id}-address`}
                value={address}
                inputMode="url"
                maxLength={LIMITS.link}
                placeholder="https://"
                aria-invalid={problem?.field === 'address' || undefined}
                onValueChange={setAddress}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {RESULT_COUNTS.map((name) => (
                <div key={name} className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor={`${id}-${name}`}>{t(RESULT_LABELS[name], locale)}</Label>
                  <Input
                    id={`${id}-${name}`}
                    value={form[name]}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={problem?.field === name || undefined}
                    onValueChange={(value) => setForm((before) => ({ ...before, [name]: value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-note`}>{t('share.note', locale)}</Label>
              <Input
                id={`${id}-note`}
                value={form.resultNote}
                maxLength={LIMITS.resultNote}
                onValueChange={(value) => setForm((before) => ({ ...before, resultNote: value }))}
              />
            </div>
            {problem !== null && (
              <p role="alert" className="text-sm text-destructive">
                {t(problem.key, locale)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working}>
              {working && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {t('share.saveResults', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
