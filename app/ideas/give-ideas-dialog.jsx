'use client';

import { Sparkles } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';

import { t } from '../../lib/i18n/index.js';
import { send } from '../send.js';

import { STARTER_KINDS, starterKeys, themeKey } from './groups.js';

/** The most ideas one press keeps (the address's limit). */
const KEEP_MOST = 20;

/**
 * The ideas the AI gave, each with a check box. At most `KEEP_MOST` can be
 * ticked at once (the address's limit).
 *
 * @param {{ ideas: string[], picked: Set<number>, disabled?: boolean, idPrefix: string, label: string,
 *   onToggle: (index: number, on: boolean) => void }} props
 */
export function IdeaChecklist({ ideas, picked, disabled = false, idPrefix, label, onToggle }) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {ideas.map((idea, index) => (
        <li key={`${index}-${idea}`}>
          <FieldLabel htmlFor={`${idPrefix}-idea-${index}`}>
            <Field orientation="horizontal">
              <Checkbox
                id={`${idPrefix}-idea-${index}`}
                checked={picked.has(index)}
                disabled={disabled || (!picked.has(index) && picked.size >= KEEP_MOST)}
                onCheckedChange={(on) => onToggle(index, on === true)}
              />
              <FieldContent className="break-words">{idea}</FieldContent>
            </Field>
          </FieldLabel>
        </li>
      ))}
    </ul>
  );
}

/**
 * The idea starters: six kinds of post, five starters each, in the app's
 * language. Pressing one hands its words on.
 *
 * @param {{ locale: string, idPrefix: string, onStarter: (words: string) => void }} props
 */
export function IdeaStarters({ locale, idPrefix, onStarter }) {
  return (
    <section aria-labelledby={`${idPrefix}-starters`} className="flex flex-col gap-3">
      <h3 id={`${idPrefix}-starters`} className="text-sm font-semibold">{t('ideas.starters', locale)}</h3>
      {STARTER_KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-1.5">
          <h4 className="text-xs text-muted-foreground">{t(`ideas.kind.${kind}`, locale)}</h4>
          <div className="flex flex-wrap gap-1.5">
            {starterKeys(kind).map((key) => (
              <Button key={key} type="button" variant="outline" size="sm" onClick={() => onStarter(t(key, locale))}>
                {t(key, locale)}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * The theme a fresh window starts on: the page's theme when it is one of
 * those offered, else the first one, else none.
 *
 * @param {{ id: number }[]} themes
 * @param {number | null} themeId
 */
function startingTheme(themes, themeId) {
  if (themes.some((item) => item.id === themeId)) return themeKey(themeId);
  return themes.length > 0 ? themeKey(themes[0].id) : 'none';
}

/**
 * What the window holds. It unmounts when the window closes, so a closed
 * window forgets its ideas and picks (AGENTS.md rule 6d).
 *
 * @param {{ locale: string, themes: { id: number, name: string }[], themeId: number | null,
 *   onKept: (count: number) => void, onStarter: (words: string, themeId: number | null) => void }} props
 */
export function GiveIdeas({ locale, themes, themeId, onKept, onStarter }) {
  const id = useId();
  const [chosen, setChosen] = useState(() => startingTheme(themes, themeId));
  const [asking, setAsking] = useState(false);
  const [ideas, setIdeas] = useState(/** @type {string[] | null} */ (null));
  const [picked, setPicked] = useState(() => new Set());
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [keeping, setKeeping] = useState(false);
  const [keepProblem, setKeepProblem] = useState(/** @type {string | null} */ (null));
  const theme = chosen === 'none' ? null : Number(chosen);

  async function ask() {
    setAsking(true);
    setProblem(null);
    setKeepProblem(null);
    const sent = await send('/api/ai/ideas', 'POST', { themeId: theme });
    setAsking(false);
    if (!sent.ok || !Array.isArray(sent.value?.ideas)) {
      setIdeas(null);
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    const fresh = sent.value.ideas.filter((idea) => typeof idea === 'string' && idea.trim() !== '');
    setIdeas(fresh);
    setPicked(new Set());
    if (fresh.length === 0) setProblem('ideas.give.none');
  }

  /** @param {number} index @param {boolean} on */
  function toggle(index, on) {
    setPicked((before) => {
      const next = new Set(before);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function keep(event) {
    event.preventDefault();
    if (ideas === null || picked.size === 0) return;
    setKeeping(true);
    setKeepProblem(null);
    const names = ideas.filter((_, index) => picked.has(index));
    const sent = await send('/api/ideas/keep', 'POST', { names, themeId: theme });
    setKeeping(false);
    if (!sent.ok || !Array.isArray(sent.value?.posts) || sent.value.posts.length !== names.length) {
      setKeepProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    onKept(names.length);
  }

  return (
    <form onSubmit={keep} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor={`${id}-theme`}>{t('ideas.theme.label', locale)}</FieldLabel>
          <NativeSelect id={`${id}-theme`} value={chosen} className="w-full" disabled={asking} onChange={(event) => setChosen(event.target.value)}>
            {themes.map((item) => <NativeSelectOption key={item.id} value={String(item.id)}>{item.name}</NativeSelectOption>)}
            {themes.length === 0 && <NativeSelectOption value="none">{t('ideas.theme.none', locale)}</NativeSelectOption>}
          </NativeSelect>
        </Field>
        <Button type="button" variant="secondary" disabled={asking || keeping} onClick={ask}>
          {asking ? <Spinner aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {t(ideas === null ? 'ideas.give' : 'ideas.give.more', locale)}
        </Button>
      </div>

      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
        {ideas !== null && ideas.length > 0 && (
          <IdeaChecklist ideas={ideas} picked={picked} disabled={keeping} idPrefix={id} label={t('ideas.give', locale)} onToggle={toggle} />
        )}
        {problem && problem !== 'ideas.give.none' && (
          <IdeaStarters locale={locale} idPrefix={id} onStarter={(words) => onStarter(words, theme)} />
        )}
      </div>

      {ideas !== null && ideas.length > 0 && (
        <DialogFooter className="items-center">
          {keepProblem && <p role="alert" className="text-sm text-destructive sm:mr-auto">{t(keepProblem, locale)}</p>}
          <Button type="submit" disabled={keeping || picked.size === 0}>
            {t('ideas.give.keep', locale)}
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}

/**
 * Give me ideas: choose a theme, ask the AI for ideas (nothing is saved),
 * tick the ones to keep, Add the ones I picked. When the AI cannot answer,
 * its words show with the idea starters; pressing a starter puts it in the
 * New idea line.
 *
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, locale: string,
 *   themes: { id: number, name: string }[], themeId: number | null,
 *   onKept: (count: number) => void, onStarter: (words: string, themeId: number | null) => void }} props
 */
export function GiveIdeasDialog({ open, onOpenChange, locale, themes, themeId, onKept, onStarter }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ideas.give', locale)}</DialogTitle>
        </DialogHeader>
        {open && <GiveIdeas locale={locale} themes={themes} themeId={themeId} onKept={onKept} onStarter={onStarter} />}
      </DialogContent>
    </Dialog>
  );
}
