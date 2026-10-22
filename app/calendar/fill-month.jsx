'use client';

import { Sparkles } from 'lucide-react';
import { useId, useState } from 'react';

import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/reui/number-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Toggle } from '@/components/ui/toggle';

import { formatMonth } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { sendUnconfirmed } from '../send.js';
import { bringBackWords } from './proposals.js';
import { ThemeDot } from './tiles.jsx';

const [LEAST, MOST] = LIMITS.postsPerWeek;

/**
 * Fill my month: posts a week (My plan's number already set) and the themes
 * (all on), then **Make the plan**. The AI names an idea for each empty slot;
 * when the AI cannot, the problem shows with **Plan without AI**, which
 * spreads the themes over the same slots. Either way up to two "bring back"
 * proposals come with them: posts that brought customers, each shown as
 * "Brought back: <name> (3 customers)" (that line rides in the proposal's
 * name, which Keep these never keeps for a copy). Nothing is saved here: the
 * proposals go back to the calendar, which keeps them only on Keep these.
 *
 * @param {{ locale: string, open: boolean, onOpenChange: (open: boolean) => void, month: string, perWeek: number,
 *   themes: Array<{ id: number, name: string, colour: number }>, networks: string[],
 *   onProposals: (found: { proposals: Array<{ day: string, name: string, themeId: number | null, specialDay?: string }>, madeBy: 'ai' | 'person' }) => void }} props
 */
export function FillMonthDialog({ locale, open, onOpenChange, month, perWeek, themes, networks, onProposals }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t('calendar.fill', locale)} · {formatMonth(month, locale)}</DialogTitle>
        </DialogHeader>
        {open && (
          <FillForm
            locale={locale}
            month={month}
            perWeek={perWeek}
            themes={themes}
            networks={networks}
            onProposals={(found) => {
              onProposals(found);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function FillForm({ locale, month, perWeek, themes, networks, onProposals }) {
  const id = useId();
  const [count, setCount] = useState(/** @type {number | null} */ (Math.min(Math.max(perWeek, LEAST), MOST)));
  const [chosen, setChosen] = useState(() => new Set(themes.map((theme) => theme.id)));
  const [pending, setPending] = useState(/** @type {'ai' | 'person' | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [aiProblem, setAiProblem] = useState(false);
  const [none, setNone] = useState(false);
  const themeIds = themes.map((theme) => theme.id).filter((themeId) => chosen.has(themeId));
  const ready = count !== null && count >= LEAST && count <= MOST;

  /** @param {number} themeId @param {boolean} on */
  function turn(themeId, on) {
    setChosen((before) => {
      const next = new Set(before);
      if (on) next.add(themeId);
      else next.delete(themeId);
      return next;
    });
  }

  /** @param {'ai' | 'person'} madeBy */
  async function make(madeBy) {
    if (!ready || pending) return;
    setPending(madeBy);
    setProblem(null);
    setNone(false);
    const sent = madeBy === 'ai'
      ? await sendUnconfirmed('/api/ai/fill-month', 'POST', { month, perWeek: count, themeIds, networks })
      : await sendUnconfirmed('/api/month/plan', 'POST', { month, perWeek: count, themeIds });
    setPending(null);
    if (!sent.ok || !Array.isArray(sent.value?.proposals)) {
      setProblem(sent.ok ? 'error.storageUnreadable' : sent.problem);
      if (madeBy === 'ai') setAiProblem(true);
      return;
    }
    const untitled = t('post.untitled', locale);
    const proposals = sent.value.proposals
      .filter((item) => typeof item?.day === 'string' && typeof item?.name === 'string')
      .map((item) => {
        if (!Number.isSafeInteger(item.fromPostId) || item.fromPostId < 1) return item;
        const words = bringBackWords(item, untitled);
        return { ...item, name: t(words.key, locale, words.values) };
      });
    if (proposals.length === 0) {
      setNone(true);
      return;
    }
    onProposals({ proposals, madeBy });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        make('ai');
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={`${id}-count`}>{t('month.fill.perWeek', locale)}</FieldLabel>
          <div>
            <NumberField id={`${id}-count`} className="w-36" value={count} min={LEAST} max={MOST} step={1} onValueChange={setCount}>
              <NumberFieldGroup>
                <NumberFieldDecrement aria-label={t('month.fill.fewer', locale)} />
                <NumberFieldInput />
                <NumberFieldIncrement aria-label={t('month.fill.more', locale)} />
              </NumberFieldGroup>
            </NumberField>
          </div>
        </Field>
        {themes.length > 0 && (
          <Field>
            <FieldTitle>{t('month.fill.themes', locale)}</FieldTitle>
            <div role="group" aria-label={t('month.fill.themes', locale)} className="flex flex-wrap gap-2">
              {themes.map((theme) => (
                <Toggle
                  key={theme.id}
                  pressed={chosen.has(theme.id)}
                  onPressedChange={(on) => turn(theme.id, on)}
                  className="h-8 max-w-full gap-2 rounded-4xl bg-card px-3 font-normal text-foreground/70 ring-1 ring-foreground/10 hover:bg-muted aria-pressed:bg-secondary aria-pressed:text-secondary-foreground aria-pressed:ring-primary/40"
                >
                  <ThemeDot colour={theme.colour} />
                  <span className="truncate">{theme.name}</span>
                </Toggle>
              ))}
            </div>
          </Field>
        )}
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
        {none && <p role="status" className="text-sm text-muted-foreground">{t('month.fill.none', locale)}</p>}
      </div>
      <DialogFooter className="flex-wrap">
        {aiProblem && (
          <Button type="button" variant="outline" disabled={!ready || pending !== null} onClick={() => make('person')}>
            {t('month.fill.noAi', locale)}
          </Button>
        )}
        <Button type="submit" disabled={!ready || pending !== null}>
          <Sparkles aria-hidden="true" />
          {t('month.fill.make', locale)}
        </Button>
      </DialogFooter>
    </form>
  );
}
