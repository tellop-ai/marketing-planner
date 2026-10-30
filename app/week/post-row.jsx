'use client';

import { Check, CircleCheck, Clock, Copy, Download, LoaderCircle, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { stateWordsOf } from '../../lib/plan/state.js';
import { shortDay, timeText } from '../calendar/format.js';
import { THEME_EDGE } from '../calendar/rules.js';
import { tipPlace } from '../pictures/rules.js';
import { PictureThumb } from '../pictures/thumb.jsx';
import { bundleSet } from '../posts/[id]/bundle.js';
import { pressStillCounts, setSavable } from '../posts/[id]/rules.js';
import { useRights } from '../rights.jsx';
import { send } from '../send.js';

import { startDownload } from './downloads.js';
import { platformLines, shareAddress, versionAddress } from './rules.js';

/** How long "Copied" shows on the press before it reads Copy words again. */
const COPIED_MS = 2500;

/** A link drawn as a small outline button (`cn` lets the outline's border win over the base's). */
const OUTLINE_SMALL = cn(buttonVariants({ variant: 'outline', size: 'sm' }));

/** A post's address. @param {number} id */
const postAddress = (id) => `/posts/${encodeURIComponent(String(id))}`;

/**
 * The post's state beside its time: Scheduled with a clock mark, Shared with
 * a check, "1 of 2 shared" (or "1 of 2 done" when one is scheduled), else
 * Idea, Draft or Ready.
 */
function StateMark({ locale, state }) {
  if (state.state === 'scheduled') {
    return (
      <Badge variant="secondary">
        <Clock aria-hidden="true" />
        {t('state.scheduled', locale)}
      </Badge>
    );
  }
  if (state.state === 'shared') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <CircleCheck aria-hidden="true" className="size-3.5 text-primary" />
        {t('state.shared', locale)}
      </span>
    );
  }
  if (state.state === 'partly') {
    const words = stateWordsOf(state);
    return <span>{t(words.key, locale, words.values)}</span>;
  }
  return <span>{t(`state.${state.state}`, locale)}</span>;
}

/**
 * Save pictures (n) for a platform that takes a swipe set: the set's first
 * pictures (as many as the platform takes) in one zip, built as the post
 * maker builds it (`bundleSet`: words pictures drawn now with their tip's
 * place, a missing copy kept on the way and handed back through
 * `onPicture`), downloaded in the same press while it still counts, else by
 * a Download press. A set the page cannot save rests the press with its
 * reason (`setSavable`).
 *
 * @param {{ locale: string, set: any[], slides: any[], shape: string, colour: number | null, business: string, onPicture: (picture: any) => void }} input
 */
function useSaveSet({ locale, set, slides, shape, colour, business, onPicture }) {
  const [working, setWorking] = useState(false);
  const [address, setAddress] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const savable = setSavable(set, shape);
  const zipName = t('share.slidesZipName', locale);

  async function save() {
    if (working || !savable.ok) return;
    const pressed = Date.now();
    setWorking(true);
    setProblem(null);
    setAddress(null);
    try {
      const kept = await bundleSet(set, shape, { themeColour: colour, business, placeOf: (each) => tipPlace({ pictures: slides }, each), onKept: onPicture });
      if (pressStillCounts(navigator.userActivation, Date.now() - pressed)) startDownload(kept, zipName);
      else setAddress(kept);
    } catch (error) {
      setProblem(typeof error?.messageKey === 'string' ? error.messageKey : 'pictures.notReady');
    } finally {
      setWorking(false);
    }
  }

  return { working, address, problem, savable, zipName, save, clearAddress: () => setAddress(null) };
}

/**
 * One platform's line: its name and the post's day and time (to type into the
 * platform's own scheduler); then, until it is marked, **Copy words** (the
 * words as the platform carries them, copied in the press; where the browser
 * refuses, a box to select them from), **Save picture** (the kept copy in the
 * platform's shape; "Open the post" where the copy is not kept yet), or
 * **Save pictures (n)** where the platform takes the post's swipe set, and
 * **Mark scheduled** (I shared it once the post's moment has passed). Once
 * marked: Scheduled or Shared, and Undo. Marking, Undo and Save pictures (n)
 * (which keeps a missing copy on the post's picture) change the post, so a
 * person who may not change it (`useRights`) gets Copy words, Save picture
 * and Open the post, and reads the marks.
 *
 * @param {{ locale: string, postId: number, day: string, time: string | null, line: ReturnType<typeof platformLines>[number],
 *   slides: any[], colour: number | null, business: string, onVersion: (postId: number, version: any) => void,
 *   onPicture: (postId: number, picture: any) => void }} props
 */
function PlatformLine({ locale, postId, day, time, line, slides, colour, business, onVersion, onPicture }) {
  const id = useId();
  const { change } = useRights();
  const [copy, setCopy] = useState(/** @type {'idle' | 'copied' | 'refused'} */ ('idle'));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [assumed, setAssumed] = useState(false);
  const saveSet = useSaveSet({ locale, set: line.set ?? [], slides, shape: line.shape, colour, business, onPicture: (picture) => onPicture(postId, picture) });

  useEffect(() => {
    if (copy !== 'copied') return undefined;
    const timer = setTimeout(() => setCopy('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  function copyWords() {
    try {
      const copying = navigator.clipboard?.writeText(line.words);
      if (copying === undefined) setCopy('refused');
      else copying.then(() => setCopy('copied'), () => setCopy('refused'));
    } catch {
      setCopy('refused');
    }
  }

  async function mark(action) {
    if (working) return;
    setWorking(true);
    setProblem(null);
    setAssumed(false);
    const answer = await send(versionAddress(postId, line.network), 'POST', { action });
    setWorking(false);
    if (!answer.ok || !answer.value?.version) {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    if (action === 'scheduled' && answer.value.timeAssumed === true) setAssumed(true);
    onVersion(postId, answer.value.version);
  }

  const when = time ? `${shortDay(day, locale)} · ${timeText(time, locale)}` : shortDay(day, locale);
  const spinner = <LoaderCircle aria-hidden="true" className="animate-spin" />;
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2.5">
      <div className="flex min-w-0 flex-1 basis-52 flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{line.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{when}</span>
      </div>
      {line.status === 'none' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {!line.hasWords ? (
            <>
              <span className="text-sm text-muted-foreground">{t('check.noWords', locale)}</span>
              <Link href={postAddress(postId)} className={OUTLINE_SMALL}>
                {t('week.openPost', locale)}
              </Link>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={copyWords}>
                {copy === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {t(copy === 'copied' ? 'week.copied' : 'week.copy', locale)}
              </Button>
              {line.picture === 'file' && line.pictureAddress && (
                <a href={line.pictureAddress} download className={OUTLINE_SMALL}>
                  <Download aria-hidden="true" />
                  {t('share.savePicture', locale)}
                </a>
              )}
              {line.picture === 'set' && change && (
                <Button type="button" variant="outline" size="sm" disabled={saveSet.working || !saveSet.savable.ok} onClick={saveSet.save}>
                  {saveSet.working ? spinner : <Download aria-hidden="true" />}
                  {t('share.savePictures', locale, { n: String(line.set?.length ?? 0) })}
                </Button>
              )}
              {(line.picture === 'open' || (line.picture === 'set' && !change)) && (
                <Link href={change ? shareAddress(postId) : postAddress(postId)} className={OUTLINE_SMALL}>
                  {t('week.openPost', locale)}
                </Link>
              )}
              {line.action !== null && change && (
                <Button type="button" variant="secondary" size="sm" disabled={working} onClick={() => mark(line.action)}>
                  {working ? spinner : line.action === 'scheduled' ? <Clock aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                  {t(line.action === 'scheduled' ? 'week.markScheduled' : 'share.shared', locale)}
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <span className="inline-flex h-7 items-center gap-1.5 px-1 text-sm font-medium">
            {line.status === 'scheduled' ? <Clock aria-hidden="true" className="size-4 text-primary" /> : <CircleCheck aria-hidden="true" className="size-4 text-primary" />}
            {t(line.status === 'scheduled' ? 'state.scheduled' : 'share.sharedMark', locale)}
          </span>
          {change && (
            <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => mark('unshared')} className="text-muted-foreground">
              {working ? spinner : <Undo2 aria-hidden="true" />}
              {t('share.undo', locale)}
            </Button>
          )}
        </div>
      )}
      {copy === 'refused' && line.status === 'none' && (
        <div className="flex min-w-0 basis-full flex-col gap-1.5">
          <p role="alert" className="text-sm text-muted-foreground">{t('share.copyRefused', locale)}</p>
          <Textarea
            id={`${id}-words`}
            readOnly
            value={line.words}
            aria-label={t('week.wordsFor', locale, { network: line.name })}
            onFocus={(event) => event.currentTarget.select()}
            className="max-h-40"
          />
        </div>
      )}
      {line.picture === 'set' && change && line.status === 'none' && line.hasWords && !saveSet.savable.ok && (
        <p className="basis-full text-sm text-muted-foreground">{t(saveSet.savable.reason, locale)}</p>
      )}
      {saveSet.address !== null && (
        <div role="status" className="flex basis-full flex-wrap items-center gap-2 text-sm">
          <span>{t('week.picturesReady', locale)}</span>
          <a href={saveSet.address} download={saveSet.zipName} onClick={saveSet.clearAddress} className={OUTLINE_SMALL}>
            <Download aria-hidden="true" />
            {t('week.download', locale)}
          </a>
        </div>
      )}
      {saveSet.problem !== null && <p role="alert" className="basis-full text-sm text-destructive">{t(saveSet.problem, locale)}</p>}
      {assumed && <p role="status" className="basis-full text-sm text-muted-foreground">{t('week.timeAssumed', locale)}</p>}
      {problem !== null && <p role="alert" className="basis-full text-sm text-destructive">{t(problem, locale)}</p>}
    </li>
  );
}

/**
 * One post of the week: its picture, time and state, its name (both open the
 * post), and a line for each platform it goes to. The lines wait for the
 * post's record (`record`: undefined while it is read, false when it could
 * not be).
 *
 * @param {{ locale: string, post: ReturnType<typeof import('./rules.js').weekPost>, record: any, networks: string[], now: string,
 *   colour: number | null, business: string, onVersion: (postId: number, version: any) => void,
 *   onPicture: (postId: number, picture: any) => void }} props
 */
export function PostRow({ locale, post, record, networks, now, colour, business, onVersion, onPicture }) {
  const name = post.name || t('post.untitled', locale);
  const slides = Array.isArray(post.slides) ? post.slides : [];
  const lines = record ? platformLines({ post, versions: record.versions, picture: post.picture, networks, now, slides }) : null;
  // A post with no words on any platform yet (an idea with a day) says so once, not on every line.
  const wordless = lines !== null && lines.length > 0 && lines.every((line) => !line.hasWords && line.status === 'none');
  // Why a platform still to mark offers I shared it and not Mark scheduled: said once for the post.
  // (Only for a person who may mark it: `useRights`.)
  const { change } = useRights();
  const passed = change && lines !== null && !wordless && lines.some((line) => line.status === 'none' && line.hasWords && line.action === 'shared');
  return (
    <article
      aria-label={name}
      className={cn('flex min-w-0 flex-col gap-2.5 rounded-xl border-l-[3px] bg-card p-3 ring-1 ring-foreground/10', colour === null ? 'border-l-input' : THEME_EDGE[colour])}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link href={postAddress(post.id)} tabIndex={-1} aria-hidden="true" className="size-14 shrink-0 overflow-hidden rounded-md">
          <PictureThumb picture={post.picture} themeColour={colour} business={business} locale={locale} alt="" place={tipPlace({ pictures: slides }, post.picture)} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {post.time && <span className="tabular-nums">{timeText(post.time, locale)}</span>}
            <StateMark locale={locale} state={post.state} />
          </div>
          <Link href={postAddress(post.id)} className="line-clamp-2 font-medium break-words hover:underline">
            {name}
          </Link>
        </div>
      </div>
      {record === false && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <p role="alert" className="text-sm text-muted-foreground">{t('week.unread', locale)}</p>
          <Link href={postAddress(post.id)} className={OUTLINE_SMALL}>
            {t('week.openPost', locale)}
          </Link>
        </div>
      )}
      {record === undefined && post.networks.length > 0 && (
        <ul aria-busy="true" className="flex min-w-0 flex-col gap-2.5">
          {post.networks.map((network) => (
            <li key={network} className="flex items-center gap-3 border-t border-border pt-2.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-7 w-56 max-w-1/2" />
            </li>
          ))}
        </ul>
      )}
      {(wordless || (lines !== null && lines.length === 0)) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <p className="text-sm text-muted-foreground">{t(wordless ? 'check.noWords' : 'week.noPlatforms', locale)}</p>
          <Link href={postAddress(post.id)} className={OUTLINE_SMALL}>
            {t('week.openPost', locale)}
          </Link>
        </div>
      )}
      {lines !== null && lines.length > 0 && !wordless && (
        <ul className="flex min-w-0 flex-col gap-2.5">
          {lines.map((line) => (
            <PlatformLine
              key={line.network}
              locale={locale}
              postId={post.id}
              day={post.day}
              time={post.time}
              line={line}
              slides={slides}
              colour={colour}
              business={business}
              onVersion={onVersion}
              onPicture={onPicture}
            />
          ))}
        </ul>
      )}
      {passed && <p className="border-t border-border pt-2.5 text-sm text-muted-foreground">{t('share.schedulePassed', locale)}</p>}
    </article>
  );
}
