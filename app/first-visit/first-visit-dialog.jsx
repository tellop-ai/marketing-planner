'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { NETWORKS, isNetworkKey } from '../../lib/plan/networks.js';

import { send, sendUnconfirmed } from '../send.js';
import { freshStart, makeFirstPosts } from './first-posts.js';
import { browserStorage, closeStart, FIRST_IDEAS, IDEA_KEYS, isSkipped, START_MOST } from './rules.js';

const STEPS = 3;
const CHIP = 'h-8 rounded-4xl bg-card px-3 text-foreground/70 ring-1 ring-foreground/10 hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-0 aria-pressed:hover:bg-primary/80';

/** The start closed while this page was open (Skip, Escape or the window's close): it stays closed for this visit. */
let closedHere = false;

/**
 * The first-visit start: one dialog over the calendar, three short steps
 * (the business's name; two platforms; three themes from the theme ideas),
 * then **Make my first four posts** (`./first-posts.js`: the start saved,
 * Fill my month for the next seven days, four of them kept as idea posts),
 * and the calendar reads again. When the AI cannot, its problem shows with **Make
 * them without AI**. A step that failed is not done twice when pressed again,
 * and once the start is saved its answers no longer change (no Back).
 * **Skip** closes it on this computer for good (browser storage, never a
 * record); Escape or the window's close leave it for this visit only
 * (`closeStart`). Shown only by `./first-visit.jsx`.
 *
 * @param {{ locale: string, today: string, networks: string[] }} props
 */
export function FirstVisitDialog({ locale, today, networks: saved }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [networks, setNetworks] = useState(() => saved.filter(isNetworkKey).slice(0, START_MOST.networks));
  const [ideas, setIdeas] = useState(() => [...FIRST_IDEAS]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {{ problem: string, field?: string } | null} */ (null));
  const [aiFailed, setAiFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const done = useRef(freshStart());

  useEffect(() => {
    if (!closedHere && !isSkipped(browserStorage())) setOpen(true);
  }, []);

  /** Skip keeps the start closed on this computer; Escape or the window's close only for this visit. @param {'skip' | 'close'} how */
  function close(how) {
    if (pending) return;
    closedHere = true;
    closeStart(how, browserStorage());
    setOpen(false);
    // The start was saved before the posts could be made: the calendar shows the business's name now.
    if (done.current.started !== null) router.refresh();
  }

  /** @param {boolean} useAi */
  async function make(useAi) {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      const made = await makeFirstPosts({
        send, sendUnconfirmed, today, businessName: name, networks, ideas, useAi, words: (key) => t(key, locale), done: done.current,
      });
      setStarted(done.current.started !== null);
      if (!made.ok) {
        setProblem(made);
        if (made.aiFailed) setAiFailed(true);
        if (made.field === 'businessName') setStep(1);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <StartWindow open={open} onClose={() => close('close')}>
      <StartView
        locale={locale}
        step={step}
        name={name}
        networks={networks}
        ideas={ideas}
        pending={pending}
        problem={problem}
        aiFailed={aiFailed}
        started={started}
        onName={(value) => {
          setName(value);
          setProblem(null);
        }}
        onNetworks={setNetworks}
        onIdeas={setIdeas}
        onStep={(next) => {
          setProblem(null);
          setAiFailed(false);
          setStep(next);
        }}
        onMake={(useAi) => void make(useAi)}
        onSkip={() => close('skip')}
      />
    </StartWindow>
  );
}

/**
 * The start's window: a dialog that an outside click never closes (only
 * Skip, or Escape and the window's own close, which `onClose` takes for this
 * visit only), within the screen's height.
 *
 * @param {{ open: boolean, onClose: () => void, children: import('react').ReactNode }} props
 */
export function StartWindow({ open, onClose, children }) {
  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** @param {string[]} list @param {string} key @param {boolean} on @param {number} most */
function turned(list, key, on, most) {
  if (!on) return list.filter((item) => item !== key);
  return list.includes(key) || list.length >= most ? list : [...list, key];
}

/**
 * What the start's window shows at one step: the title and the step count,
 * the step's question, the problem line (with Make them without AI after the
 * AI could not), and Skip, Back, Next (or Make my first four posts). Every
 * press goes to the props; this holds no state.
 *
 * @param {{ locale: string, step: number, name: string, networks: string[], ideas: string[], pending: boolean,
 *   problem: { problem: string, field?: string } | null, aiFailed: boolean, started: boolean,
 *   onName: (value: string) => void, onNetworks: (change: (before: string[]) => string[]) => void,
 *   onIdeas: (change: (before: string[]) => string[]) => void, onStep: (step: number) => void,
 *   onMake: (useAi: boolean) => void, onSkip: () => void }} props
 */
export function StartView({ locale, step, name, networks, ideas, pending, problem, aiFailed, started, onName, onNetworks, onIdeas, onStep, onMake, onSkip }) {
  const id = useId();
  const ready = step === 1 ? name.trim() !== '' : step === 2 ? networks.length > 0 : ideas.length > 0;
  return (
    <>
      <DialogHeader className="flex-row items-baseline justify-between gap-3">
        <DialogTitle>{t('start.title', locale)}</DialogTitle>
        <span className="shrink-0 text-xs text-muted-foreground">{t('start.step', locale, { number: String(step), of: String(STEPS) })}</span>
      </DialogHeader>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || pending) return;
          if (step < STEPS) onStep(step + 1);
          else onMake(true);
        }}
      >
        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-0.5">
          {step === 1 && (
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>{t('start.business', locale)}</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={LIMITS.profileField}
                autoComplete="organization"
                aria-invalid={problem?.field === 'businessName' || undefined}
                disabled={pending}
                onChange={(event) => onName(event.target.value)}
              />
            </Field>
          )}
          {step === 2 && (
            <Field>
              <FieldTitle>{t('start.platforms', locale)}</FieldTitle>
              <div role="group" aria-label={t('start.platforms', locale)} className="flex flex-wrap gap-2">
                {NETWORKS.map((item) => {
                  const on = networks.includes(item.key);
                  return (
                    <Toggle
                      key={item.key}
                      pressed={on}
                      disabled={pending || (!on && networks.length >= START_MOST.networks)}
                      onPressedChange={(next) => onNetworks((before) => turned(before, item.key, next, START_MOST.networks))}
                      className={CHIP}
                    >
                      {item.name}
                    </Toggle>
                  );
                })}
              </div>
              {networks.length >= START_MOST.networks && <p className="text-sm text-muted-foreground">{t('start.platformsFull', locale)}</p>}
            </Field>
          )}
          {step === 3 && (
            <Field>
              <FieldTitle>{t('start.themes', locale)}</FieldTitle>
              <div role="group" aria-label={t('start.themes', locale)} className="flex flex-wrap gap-2">
                {IDEA_KEYS.map((key) => {
                  const on = ideas.includes(key);
                  return (
                    <Toggle
                      key={key}
                      pressed={on}
                      disabled={pending || started || (!on && ideas.length >= START_MOST.themes)}
                      onPressedChange={(next) => onIdeas((before) => turned(before, key, next, START_MOST.themes))}
                      className={CHIP}
                    >
                      {t(`start.theme.${key}`, locale)}
                    </Toggle>
                  );
                })}
              </div>
              {ideas.length >= START_MOST.themes && <p className="text-sm text-muted-foreground">{t('start.themesFull', locale)}</p>}
            </Field>
          )}
          {problem && <p role="alert" className="text-sm text-destructive">{t(problem.problem, locale)}</p>}
          {step === STEPS && aiFailed && (
            <div>
              <Button type="button" variant="outline" disabled={pending || !ready} onClick={() => onMake(false)}>{t('start.withoutAi', locale)}</Button>
            </div>
          )}
        </div>
        <DialogFooter className="sm:flex-wrap sm:items-center">
          <Button type="button" variant="ghost" disabled={pending} className="sm:mr-auto" onClick={onSkip}>{t('start.skip', locale)}</Button>
          {step > 1 && !started && (
            <Button type="button" variant="outline" disabled={pending} onClick={() => onStep(step - 1)}>{t('start.back', locale)}</Button>
          )}
          <Button type="submit" disabled={pending || !ready}>
            {pending && <Spinner aria-hidden="true" />}
            {t(step === STEPS ? 'start.make' : 'start.next', locale)}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
