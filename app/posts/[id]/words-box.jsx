'use client';

import { LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { t } from '../../../lib/i18n/index.js';
import { LIMITS } from '../../../lib/plan/limits.js';

import { keptText as kept } from './rules.js';
import { send } from '../../send.js';
import { postAddress } from './addresses.js';

/** How long the box waits after the last key before it saves. */
export const PAUSE_MS = 900;

/**
 * Runs `flush` when the person leaves the page (it closes, reloads or goes to
 * another address) and when the part holding it goes away (the app moves to
 * another page). `flush` sends what is not saved yet with `keepalive`, so the
 * save goes on after the page is gone.
 *
 * @param {{ current: () => void }} flush a ref to the latest flush
 */
export function useLeaveSave(flush) {
  useEffect(() => {
    const leave = () => flush.current();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      flush.current();
    };
  }, [flush]);
}

/**
 * What the post should say, in the person's own words, and **Make my post**.
 * The box saves itself after a pause of typing and when the person leaves it,
 * and says "Saved" only after the app confirms; a refusal keeps the words and
 * says why; words not saved yet are sent as the person leaves the page. Make
 * my post hands the box's words to `onMake` (which saves them with the post),
 * after stopping a save that is still waiting. `rest` (from `makeRest`) rests
 * Make my post and says why under it.
 *
 * @param {{ locale: string, postId: number, mainText: string, making: boolean, disabled?: boolean,
 *   rest?: { key: string, href?: string } | null,
 *   onSaved: (post: any) => void, onMake: (text: string) => void, children?: React.ReactNode }} props
 */
export function WordsBox({ locale, postId, mainText, making, disabled = false, rest = null, onSaved, onMake, children }) {
  const [text, setText] = useState(mainText);
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const saved = useRef(kept(mainText));
  const current = useRef(mainText);
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const round = useRef(0);

  // What the app keeps changes with Make my post: that is now the saved text.
  useEffect(() => {
    saved.current = kept(mainText);
  }, [mainText]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  function stopWaiting() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  async function save(value, { keepalive = false } = {}) {
    stopWaiting();
    if (kept(value) === saved.current) return;
    const mine = ++round.current;
    const answer = await send(postAddress(postId), 'PATCH', { mainText: value }, { keepalive });
    if (mine !== round.current) return;
    if (!answer.ok || !answer.value?.post) {
      setNote(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    saved.current = kept(answer.value.post.mainText);
    onSaved(answer.value.post);
    setNote(kept(current.current) === saved.current ? 'maker.saved' : null);
  }

  const leaving = useRef(() => {});
  leaving.current = () => {
    if (kept(current.current) !== saved.current) save(current.current, { keepalive: true });
  };
  useLeaveSave(leaving);

  function change(value) {
    setText(value);
    current.current = value;
    setNote(null);
    stopWaiting();
    timer.current = setTimeout(() => save(value), PAUSE_MS);
  }

  function make() {
    stopWaiting();
    round.current += 1;
    setNote(null);
    onMake(current.current);
  }

  const problem = note !== null && note !== 'maker.saved';
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Textarea
          value={text}
          maxLength={LIMITS.mainText}
          aria-label={t('maker.say', locale)}
          placeholder={t('maker.say', locale)}
          aria-invalid={problem || undefined}
          onChange={(event) => change(event.target.value)}
          onBlur={() => save(current.current)}
          className="min-h-24 bg-card pb-6 text-[15px]"
        />
        <p role="status" className="pointer-events-none absolute right-6 bottom-1.5 text-xs text-muted-foreground empty:hidden">
          {note === 'maker.saved' ? t('maker.saved', locale) : ''}
        </p>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {t(note, locale)}
        </p>
      )}
      <Button type="button" size="lg" disabled={making || disabled || rest !== null || text.trim() === ''} onClick={make} className="w-full text-[15px]">
        {making ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
        {making ? t('maker.making', locale) : t('maker.make', locale)}
      </Button>
      {rest !== null && (rest.href ? (
        <a href={rest.href} className="text-sm text-primary underline-offset-4 hover:underline">
          {t(rest.key, locale)}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">{t(rest.key, locale)}</p>
      ))}
      {children}
    </div>
  );
}
