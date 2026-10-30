'use client';

import { enUS, tr } from 'date-fns/locale';
import { Lightbulb, Plus, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { ConfirmRemove } from '../plan/confirm-remove.jsx';
import { useRights } from '../rights.jsx';
import { send } from '../send.js';

import { GiveIdeasDialog } from './give-ideas-dialog.jsx';
import { dotClass, groupIdeas, themeKey } from './groups.js';
import { IdeaCard } from './idea-card.jsx';
import { InspirationSection } from './inspiration.jsx';

/**
 * @typedef {{ id: number, name: string, themeId: number | null }} Idea
 * @typedef {{ id: number, name: string, colour: number }} Theme
 */

/**
 * The Ideas page: Give me ideas, the New idea line (one line and a theme),
 * Saved for inspiration (the person's notes and links), the themes as a row
 * of chips that filter the ideas, and the ideas grouped by theme. What the
 * app confirmed shows as one short line; a refusal keeps the person's words.
 * Who is here (`useRights`): Give me ideas and the New idea line only for a
 * person who may add; Pick a day and Remove only for one who may change.
 *
 * @param {{ locale: string, today: string, ideas: Idea[], themes: Theme[], archivedThemes: Theme[], full: boolean,
 *   notes?: import('./inspiration.jsx').Note[], notesFull?: boolean }} props
 */
export function IdeasBoard({ locale, today, ideas, themes, archivedThemes, full, notes = [], notesFull = false }) {
  const router = useRouter();
  const { add: canAdd, change: canChange } = useRights();
  const calendarLocale = locale === 'tr' ? tr : enUS;
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [gone, setGone] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(/** @type {{ key: string, values?: Record<string, string> } | null} */ (null));
  const [draft, setDraft] = useState('');
  const [draftTheme, setDraftTheme] = useState(() => (themes.length > 0 ? themeKey(themes[0].id) : 'none'));
  const [adding, setAdding] = useState(false);
  const [addProblem, setAddProblem] = useState(/** @type {string | null} */ (null));
  const [giving, setGiving] = useState(false);
  const [removing, setRemoving] = useState(/** @type {Idea | null} */ (null));
  const [removePending, setRemovePending] = useState(false);
  const [removeProblem, setRemoveProblem] = useState(/** @type {string | null} */ (null));

  const allThemes = useMemo(() => [...themes, ...archivedThemes], [themes, archivedThemes]);
  const shown = useMemo(() => ideas.filter((idea) => !gone.has(idea.id)), [ideas, gone]);
  const groups = useMemo(() => groupIdeas(shown, allThemes), [shown, allThemes]);
  const current = groups.some((group) => group.key === filter) ? filter : 'all';
  const visible = current === 'all' ? groups : groups.filter((group) => group.key === current);
  const filterTheme = current === 'all' || current === 'none' ? null : Number(current);

  /** @param {string} key @param {Record<string, string>} [values] */
  function confirmed(key, values) {
    setNotice({ key, values });
    router.refresh();
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function addIdea(event) {
    event.preventDefault();
    const name = draft.trim();
    if (name === '' || adding) return;
    setAdding(true);
    setAddProblem(null);
    setNotice(null);
    const sent = await send('/api/posts', 'POST', { name, themeId: draftTheme === 'none' ? null : Number(draftTheme) });
    setAdding(false);
    if (!sent.ok || typeof sent.value?.post?.id !== 'number') {
      setAddProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    setDraft('');
    confirmed('ideas.new.added');
  }

  /** @param {Idea} idea @param {string} day */
  function moved(idea, day) {
    setGone((before) => new Set(before).add(idea.id));
    confirmed('ideas.moved', { name: idea.name || t('post.untitled', locale), day: formatDate(day, locale) });
  }

  async function remove() {
    if (removing === null) return;
    setRemovePending(true);
    setRemoveProblem(null);
    const sent = await send(`/api/posts/${removing.id}`, 'DELETE');
    setRemovePending(false);
    if (!sent.ok || sent.value?.ok !== true) {
      setRemoveProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    const id = removing.id;
    setRemoving(null);
    setGone((before) => new Set(before).add(id));
    confirmed('ideas.removed');
  }

  /** @param {number} count */
  function kept(count) {
    setGiving(false);
    confirmed('ideas.give.added', { count: String(count) });
  }

  /** @param {string} words @param {number | null} themeId */
  function starter(words, themeId) {
    setGiving(false);
    setDraft(Array.from(words).slice(0, LIMITS.name).join(''));
    if (themeId === null || themes.some((theme) => theme.id === themeId)) setDraftTheme(themeKey(themeId));
    setAddProblem(null);
    // The window gives the focus back to Give me ideas as it closes; the line takes it after that.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('menu.ideas', locale)}</h1>
        {canAdd && (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => { setNotice(null); setGiving(true); }}>
              <Sparkles aria-hidden="true" />
              {t('ideas.give', locale)}
            </Button>
          </div>
        )}
      </header>

      {canAdd && (
        <form onSubmit={addIdea} className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-[1_1_16rem]">
            <Input
              ref={inputRef}
              value={draft}
              maxLength={LIMITS.name}
              aria-label={t('ideas.new.label', locale)}
              placeholder={t('ideas.new.placeholder', locale)}
              aria-invalid={addProblem !== null || undefined}
              onChange={(event) => { setDraft(event.target.value); setAddProblem(null); }}
            />
          </div>
          <NativeSelect aria-label={t('ideas.theme.label', locale)} value={draftTheme} onChange={(event) => setDraftTheme(event.target.value)}>
            {themes.map((theme) => <NativeSelectOption key={theme.id} value={themeKey(theme.id)}>{theme.name}</NativeSelectOption>)}
            <NativeSelectOption value="none">{t('ideas.theme.none', locale)}</NativeSelectOption>
          </NativeSelect>
          <Button type="submit" disabled={adding || draft.trim() === ''}>
            <Plus aria-hidden="true" />
            {t('ideas.new.add', locale)}
          </Button>
        </form>
      )}

      {addProblem && <p role="alert" className="-mt-3 text-sm text-destructive">{t(addProblem, locale)}</p>}
      {notice && <p role="status" className="-mt-2 text-sm text-muted-foreground">{t(notice.key, locale, notice.values)}</p>}

      <InspirationSection locale={locale} notes={notes} full={notesFull} themes={themes} archivedThemes={archivedThemes} />

      {groups.length > 1 && (
        <ToggleGroup
          aria-label={t('ideas.filter', locale)}
          multiple={false}
          value={[current]}
          onValueChange={(values) => { if (values.length > 0) setFilter(values[0]); }}
          spacing={2}
          className="max-w-full flex-wrap"
        >
          <ToggleGroupItem value="all" className="h-8 rounded-4xl bg-card px-3 ring-1 ring-foreground/10 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/80 aria-pressed:hover:text-primary-foreground">
            {t('ideas.filter.all', locale)}
          </ToggleGroupItem>
          {groups.map((group) => (
            <ToggleGroupItem
              key={group.key}
              value={group.key}
              className="h-8 max-w-60 gap-2 rounded-4xl bg-card px-3 ring-1 ring-foreground/10 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/80 aria-pressed:hover:text-primary-foreground"
            >
              <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', dotClass(group.colour))} />
              <span className="truncate">{group.name ?? t('ideas.theme.none', locale)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
          <Lightbulb aria-hidden="true" className="size-5" />
          <p>{t('ideas.empty', locale)}</p>
        </div>
      ) : (
        visible.map((group) => (
          <section key={group.key} aria-labelledby={`ideas-group-${group.key}`} className="flex flex-col gap-2.5">
            <h2 id={`ideas-group-${group.key}`} className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span aria-hidden="true" className={cn('inline-block size-2.5 shrink-0 rounded-full', dotClass(group.colour))} />
              <span className="truncate">{group.name ?? t('ideas.theme.none', locale)}</span>
              <span className="font-normal text-muted-foreground tabular-nums">{group.ideas.length}</span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.ideas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  colour={group.colour}
                  locale={locale}
                  today={today}
                  calendarLocale={calendarLocale}
                  canChange={canChange}
                  onMoved={moved}
                  onDelete={(chosen) => { setRemoveProblem(null); setNotice(null); setRemoving(chosen); }}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {full && <p className="text-xs text-muted-foreground">{t('ideas.newest', locale, { count: String(ideas.length) })}</p>}

      <GiveIdeasDialog
        open={giving}
        onOpenChange={setGiving}
        locale={locale}
        themes={themes}
        themeId={filterTheme}
        onKept={kept}
        onStarter={starter}
      />

      <ConfirmRemove
        locale={locale}
        open={removing !== null}
        title={t('ideas.removeAsk', locale, { name: removing?.name || t('post.untitled', locale) })}
        pending={removePending}
        problem={removeProblem}
        onClose={() => { if (!removePending) setRemoving(null); }}
        onConfirm={remove}
      />
    </div>
  );
}
