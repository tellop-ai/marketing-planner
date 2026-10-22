'use client';

import { Clapperboard, Copy, LoaderCircle, Plus, Printer, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { VIDEO_PLAN, videoPlanSeconds } from '../../../lib/plan/video-plan.js';
import { aiStopOf, postFullOf } from '../../pictures/rules.js';
import { send } from '../../send.js';

import { postAddress } from './addresses.js';
import { canAdd, draftOf, planText, readDraft, videoPanelOpen } from './video-rules.js';
import { PAUSE_MS, useLeaveSave } from './words-box.jsx';

/**
 * One line of the plan's words that wraps as it grows, so a long shot stays in
 * view on a phone: Enter adds no line, and a line break pasted in becomes a space.
 */
function LineBox({ value, onValue, className, ...rest }) {
  return (
    <Textarea
      {...rest}
      rows={1}
      value={value}
      onChange={(event) => onValue(event.target.value.replace(/[\r\n]+/gu, ' '))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault();
      }}
      className={cn('min-h-9 resize-none py-1.5', className)}
    />
  );
}

/** The post a video plan address answered: the post's own fields (`{ post }`, or a whole post read). */
function savedPostOf(value) {
  const full = postFullOf(value);
  const post = full !== null ? full.post : value?.post;
  return post && typeof post === 'object' && typeof post.videoPlan === 'string' ? post : null;
}

/**
 * The video plan (words only, the app edits no video): open
 * for a post that goes to TikTok or YouTube or already has a plan, else
 * behind **Plan a video**. **Make a video plan** asks the app for one (the AI,
 * else a fixed plan; `POST /api/posts/[id]/video-plan`). The plan's hook,
 * shots (what to film, seconds), lines on screen and cover are fields that
 * save themselves like the words box (`PATCH /api/posts/[id] { videoPlan }`,
 * after a pause of typing, when the panel is left, and as the person leaves
 * the page), saying "Saved" only after the app confirms; a draft the app
 * would refuse is kept in the fields with its reason. **Copy as text** and
 * **Print** hand the plan on; **Make again** replaces it after a yes.
 *
 * @param {{ locale: string, post: any, goesTo: string[], disabled?: boolean, onPost: (post: any) => void,
 *   onPrint: () => void, onAiStop?: (problem: string) => void }} props
 */
export function VideoPlan({ locale, post, goesTo, disabled = false, onPost, onPrint, onAiStop }) {
  const [opened, setOpened] = useState(false);
  const open = opened || videoPanelOpen(post.videoPlan, goesTo);
  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpened(true)} className="w-fit text-muted-foreground">
        <Clapperboard aria-hidden="true" />
        {t('maker.video.open', locale)}
      </Button>
    );
  }
  return <VideoPanel locale={locale} post={post} disabled={disabled} onPost={onPost} onPrint={onPrint} onAiStop={onAiStop} />;
}

function VideoPanel({ locale, post, disabled, onPost, onPrint, onAiStop }) {
  const id = useId();
  const [draft, setDraftState] = useState(() => draftOf(post.videoPlan));
  const [making, setMaking] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const [shown, setShown] = useState(false);
  const [withoutAi, setWithoutAi] = useState(/** @type {string | null} */ (null));
  const [copied, setCopied] = useState(/** @type {'copied' | 'refused' | null} */ (null));
  const current = useRef(draft);
  const saved = useRef(post.videoPlan);
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const round = useRef(0);
  const handOn = useRef(onPost);
  handOn.current = onPost;

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  function stopWaiting() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  /** Saves the draft when it reads as a plan the app does not keep yet; a draft it would refuse stays, with its reason. */
  async function save({ keepalive = false, show = false } = {}) {
    stopWaiting();
    const now = current.current;
    if (now === null) return;
    const read = readDraft(now);
    if (!read.ok) {
      setNote(read.problem);
      if (show) setShown(true);
      return;
    }
    if (read.value === saved.current) return;
    const mine = ++round.current;
    const answer = await send(postAddress(post.id), 'PATCH', { videoPlan: read.plan }, { keepalive });
    if (mine !== round.current) return;
    if (!answer.ok || !answer.value?.post) {
      setNote(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      setShown(true);
      return;
    }
    saved.current = answer.value.post.videoPlan;
    handOn.current(answer.value.post);
    const again = readDraft(current.current);
    setNote(again.ok && again.value === saved.current ? 'maker.saved' : null);
  }

  const saveNow = useRef(save);
  saveNow.current = save;
  const leaving = useRef(() => {});
  leaving.current = () => {
    const now = current.current;
    if (now === null) return;
    const read = readDraft(now);
    if (read.ok && read.value !== saved.current) saveNow.current({ keepalive: true });
  };
  useLeaveSave(leaving);

  /** One change to the draft: kept at once, saved after a pause. */
  function change(next) {
    current.current = next;
    setDraftState(next);
    setNote(null);
    setShown(false);
    setCopied(null);
    stopWaiting();
    timer.current = setTimeout(() => saveNow.current(), PAUSE_MS);
  }

  async function make() {
    if (making || disabled) return;
    setAsking(false);
    stopWaiting();
    round.current += 1;
    setMaking(true);
    setNote(null);
    setShown(false);
    setWithoutAi(null);
    setCopied(null);
    try {
      const answer = await send(postAddress(post.id, '/video-plan'), 'POST', {});
      const madePost = answer.ok ? savedPostOf(answer.value) : null;
      if (madePost === null) {
        // The AI could not make a new plan: the plan before stays; a lasting stop is said once, by the page.
        const stop = answer.ok ? null : aiStopOf(answer.problem);
        if (stop !== null) {
          onAiStop?.(stop);
          return;
        }
        setNote(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
        setShown(true);
        return;
      }
      saved.current = madePost.videoPlan;
      const next = draftOf(madePost.videoPlan);
      current.current = next;
      setDraftState(next);
      handOn.current(madePost);
      const problem = answer.value?.ai === false && typeof answer.value?.aiProblem === 'string' ? answer.value.aiProblem : null;
      setWithoutAi(problem);
      const stop = aiStopOf(problem);
      if (stop !== null) onAiStop?.(stop);
    } finally {
      setMaking(false);
    }
  }

  async function copy() {
    const read = draft === null ? null : readDraft(draft);
    if (read === null || !read.ok) return;
    setCopied(null);
    try {
      await navigator.clipboard.writeText(planText(read.plan, locale));
      setCopied('copied');
    } catch {
      setCopied('refused');
    }
  }

  const read = draft === null ? null : readDraft(draft);
  const seconds = read !== null && read.ok ? videoPlanSeconds(read.plan) : null;
  const problem = note !== null && note !== 'maker.saved' && (shown || !note.startsWith('refuse.'));
  const resting = making || disabled;

  return (
    <section
      aria-labelledby={`${id}-title`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(/** @type {Node | null} */ (event.relatedTarget))) save({ show: true });
      }}
      className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-2">
        <Clapperboard aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 id={`${id}-title`} className="font-sans text-sm font-medium">
          {t('maker.video.title', locale)}
        </h2>
        {seconds !== null && <span className="text-xs text-muted-foreground tabular-nums">{t('maker.video.total', locale, { n: String(seconds) })}</span>}
        <p role="status" className="ml-auto text-xs text-muted-foreground empty:hidden">
          {note === 'maker.saved' ? t('maker.saved', locale) : ''}
        </p>
      </div>

      {draft === null ? (
        <Button type="button" variant="outline" disabled={resting} onClick={make} className="w-full">
          {making ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
          {making ? t('maker.video.making', locale) : t('maker.video.make', locale)}
        </Button>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-hook`}>{t('maker.video.hook', locale)}</Label>
            <LineBox
              id={`${id}-hook`}
              value={draft.hook}
              maxLength={VIDEO_PLAN.letters}
              disabled={making}
              onValue={(value) => change({ ...draft, hook: value })}
            />
          </div>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t('maker.video.shots', locale)}</legend>
            {draft.shots.map((shot, index) => (
              // A shot has no lasting name of its own: its place is its name while the panel shows.
              <div key={index} className="flex min-w-0 items-start gap-2">
                <span aria-hidden="true" className="w-4 shrink-0 pt-2 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                <LineBox
                  value={shot.what}
                  maxLength={VIDEO_PLAN.letters}
                  disabled={making}
                  aria-label={t('maker.video.shotWhat', locale, { n: String(index + 1) })}
                  onValue={(value) => change({ ...draft, shots: draft.shots.map((item, at) => (at === index ? { ...item, what: value } : item)) })}
                  className="min-w-0 flex-1"
                />
                <div className="flex h-9 shrink-0 items-center gap-1">
                  <Input
                    value={shot.seconds}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={2}
                    disabled={making}
                    aria-label={t('maker.video.shotSeconds', locale, { n: String(index + 1) })}
                    onValueChange={(value) => change({ ...draft, shots: draft.shots.map((item, at) => (at === index ? { ...item, seconds: value } : item)) })}
                    className="w-12 text-right tabular-nums"
                  />
                  <span aria-hidden="true" className="text-xs text-muted-foreground">{t('maker.video.secondsMark', locale)}</span>
                </div>
                {draft.shots.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={resting}
                    aria-label={t('maker.video.removeShot', locale, { n: String(index + 1) })}
                    onClick={() => change({ ...draft, shots: draft.shots.filter((_, at) => at !== index) })}
                    className="mt-1.5 shrink-0 text-muted-foreground"
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
            {canAdd(draft, 'shots') && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resting}
                onClick={() => change({ ...draft, shots: [...draft.shots, { what: '', seconds: '3' }] })}
                className="w-fit text-muted-foreground"
              >
                <Plus aria-hidden="true" />
                {t('maker.video.addShot', locale)}
              </Button>
            )}
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t('maker.video.onScreen', locale)}</legend>
            {draft.onScreen.map((line, index) => (
              <div key={index} className="flex min-w-0 items-start gap-2">
                <LineBox
                  value={line}
                  maxLength={VIDEO_PLAN.letters}
                  disabled={making}
                  aria-label={t('maker.video.line', locale, { n: String(index + 1) })}
                  onValue={(value) => change({ ...draft, onScreen: draft.onScreen.map((item, at) => (at === index ? value : item)) })}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={resting}
                  aria-label={t('maker.video.removeLine', locale, { n: String(index + 1) })}
                  onClick={() => change({ ...draft, onScreen: draft.onScreen.filter((_, at) => at !== index) })}
                  className="mt-1.5 shrink-0 text-muted-foreground"
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ))}
            {canAdd(draft, 'onScreen') && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resting}
                onClick={() => change({ ...draft, onScreen: [...draft.onScreen, ''] })}
                className="w-fit text-muted-foreground"
              >
                <Plus aria-hidden="true" />
                {t('maker.video.addLine', locale)}
              </Button>
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-cover`}>{t('maker.video.cover', locale)}</Label>
            <LineBox
              id={`${id}-cover`}
              value={draft.cover}
              maxLength={VIDEO_PLAN.letters}
              disabled={making}
              onValue={(value) => change({ ...draft, cover: value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={resting || read === null || !read.ok} onClick={copy} className="text-muted-foreground">
              <Copy aria-hidden="true" />
              {t('maker.video.copy', locale)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={resting || read === null || !read.ok}
              onClick={async () => {
                // The paper shows the plan as kept: what is typed is saved first.
                await save();
                onPrint();
              }}
              className="text-muted-foreground"
            >
              <Printer aria-hidden="true" />
              {t('maker.print', locale)}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={resting} onClick={() => setAsking(true)} className="text-muted-foreground">
              {making ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
              {making ? t('maker.video.making', locale) : t('maker.video.again', locale)}
            </Button>
          </div>
        </>
      )}

      {withoutAi !== null && <p role="status" className="text-sm text-muted-foreground">{`${t('maker.withoutAi', locale)} ${t(withoutAi, locale)}`}</p>}
      {copied === 'copied' && <p role="status" className="text-sm text-muted-foreground">{t('maker.video.copied', locale)}</p>}
      {copied === 'refused' && <p role="alert" className="text-sm text-muted-foreground">{t('maker.video.copyRefused', locale)}</p>}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {t(note, locale)}
        </p>
      )}

      <AlertDialog
        open={asking}
        onOpenChange={(next) => {
          if (!next) setAsking(false);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('maker.video.replaceAsk', locale)}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('maker.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction onClick={make}>{t('maker.replace', locale)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
