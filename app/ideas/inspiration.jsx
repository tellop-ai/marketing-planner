'use client';

import { Bookmark, Lightbulb, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { ConfirmRemove } from '../plan/confirm-remove.jsx';
import { send } from '../send.js';

import { dotClass } from './groups.js';
import { FOLDED, NOTE_MOST, canSaveNote, noteThemeChoices, noteThemeOf, shownNotes } from './inspiration-rules.js';

/**
 * @typedef {{ id: number, link: string, host: string, note: string, themeId: number | null, createdAt: string }} Note
 * @typedef {{ id: number, name: string, colour: number }} Theme
 */

/**
 * One saved note: its words, its theme and its link's host (pressing it opens
 * the link in the browser; the app never reads the page), then Make it a post
 * idea, Edit and Remove.
 *
 * @param {{ note: Note, theme: Theme | null, locale: string, making: boolean, problem: string | null,
 *   onMake: (note: Note) => void, onEdit: (note: Note) => void, onRemove: (note: Note) => void }} props
 */
export function InspirationCard({ note, theme, locale, making, problem, onMake, onEdit, onRemove }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-input bg-card p-3">
      {note.note !== '' && <p className="line-clamp-4 text-sm break-words whitespace-pre-line">{note.note}</p>}
      {(theme !== null || note.host !== '') && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {theme !== null && (
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', dotClass(theme.colour))} />
              <span className="truncate">{theme.name}</span>
            </span>
          )}
          {note.host !== '' && (
            <a
              href={note.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('inspiration.openLink', locale, { host: note.host })}
              className="flex min-w-0 items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
            >
              <Link2 aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{note.host}</span>
            </a>
          )}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1">
        <Button type="button" variant="outline" size="sm" disabled={making} onClick={() => onMake(note)}>
          {making ? <Spinner aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}
          {t('inspiration.makePost', locale)}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground"
          aria-label={t('inspiration.edit', locale)}
          disabled={making}
          onClick={() => onEdit(note)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t('inspiration.remove', locale)}
          disabled={making}
          onClick={() => onRemove(note)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
    </li>
  );
}

/**
 * The note's fields: a link, the note and a theme. It unmounts when the
 * window closes, so a closed window forgets what was typed (AGENTS.md rule
 * 6d). A refusal shows under the field it names and keeps the person's words.
 *
 * @param {{ locale: string, note: Note | null, themes: Theme[], archivedThemes: Theme[], onSaved: (key: string) => void }} props
 */
export function NoteForm({ locale, note, themes, archivedThemes, onSaved }) {
  const id = useId();
  const [link, setLink] = useState(note?.link ?? '');
  const [words, setWords] = useState(note?.note ?? '');
  const choices = noteThemeChoices(themes, archivedThemes, note?.themeId ?? null);
  const [theme, setTheme] = useState(() => (choices.some((item) => item.id === note?.themeId) ? String(note?.themeId) : 'none'));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {{ key: string, field?: string } | null} */ (null));
  const fieldProblem = (field) => (problem?.field === field ? problem.key : null);

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function save(event) {
    event.preventDefault();
    if (busy || !canSaveNote(link, words)) return;
    setBusy(true);
    setProblem(null);
    const fields = { link: link.trim(), note: words, themeId: theme === 'none' ? null : Number(theme) };
    const sent = note === null
      ? await send('/api/inspiration', 'POST', fields)
      : await send(`/api/inspiration/${note.id}`, 'PATCH', fields);
    setBusy(false);
    if (!sent.ok || typeof sent.value?.note?.id !== 'number') {
      setProblem(sent.ok ? { key: 'error.saveUnconfirmed' } : { key: sent.problem, field: sent.field });
      return;
    }
    onSaved('inspiration.saved');
  }

  const linkProblem = fieldProblem('link');
  const noteProblem = fieldProblem('note');
  const themeProblem = fieldProblem('themeId');
  const otherProblem = problem !== null && linkProblem === null && noteProblem === null && themeProblem === null ? problem.key : null;

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>{t('inspiration.note', locale)}</FieldLabel>
          <Textarea
            id={`${id}-note`}
            value={words}
            rows={4}
            maxLength={NOTE_MOST}
            placeholder={t('inspiration.note.placeholder', locale)}
            aria-invalid={noteProblem !== null || undefined}
            aria-describedby={noteProblem !== null ? `${id}-note-problem` : undefined}
            onChange={(event) => { setWords(event.target.value); setProblem(null); }}
          />
          {noteProblem && <p id={`${id}-note-problem`} role="alert" className="text-sm text-destructive">{t(noteProblem, locale)}</p>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-link`}>{t('inspiration.link', locale)}</FieldLabel>
          <Input
            id={`${id}-link`}
            value={link}
            inputMode="url"
            autoComplete="off"
            maxLength={LIMITS.link}
            placeholder="https://"
            aria-invalid={linkProblem !== null || undefined}
            aria-describedby={linkProblem !== null ? `${id}-link-problem` : undefined}
            onChange={(event) => { setLink(event.target.value); setProblem(null); }}
          />
          {linkProblem && <p id={`${id}-link-problem`} role="alert" className="text-sm text-destructive">{t(linkProblem, locale)}</p>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-theme`}>{t('ideas.theme.label', locale)}</FieldLabel>
          <NativeSelect
            id={`${id}-theme`}
            value={theme}
            className="w-full"
            aria-invalid={themeProblem !== null || undefined}
            onChange={(event) => { setTheme(event.target.value); setProblem(null); }}
          >
            {choices.map((item) => <NativeSelectOption key={item.id} value={String(item.id)}>{item.name}</NativeSelectOption>)}
            <NativeSelectOption value="none">{t('ideas.theme.none', locale)}</NativeSelectOption>
          </NativeSelect>
          {themeProblem && <p role="alert" className="text-sm text-destructive">{t(themeProblem, locale)}</p>}
        </Field>
      </div>
      <DialogFooter className="sm:items-center">
        {otherProblem && <p role="alert" className="text-sm text-destructive sm:mr-auto">{t(otherProblem, locale)}</p>}
        <Button type="submit" disabled={busy || !canSaveNote(link, words)}>
          {busy && <Spinner aria-hidden="true" />}
          {t('inspiration.save', locale)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Saved for inspiration: the person's notes (a link, a note, a theme), newest
 * first, the newest few shown until Show all. Add a note and Edit open a
 * window; Remove asks first; Make it a post idea makes an idea post from the
 * note (the note stays). What the app confirmed shows as one short line.
 *
 * @param {{ locale: string, notes: Note[], full: boolean, themes: Theme[], archivedThemes: Theme[] }} props
 */
export function InspirationSection({ locale, notes, full, themes, archivedThemes }) {
  const router = useRouter();
  const titleId = useId();
  const [gone, setGone] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(/** @type {{ note: Note | null } | null} */ (null));
  const [removing, setRemoving] = useState(/** @type {Note | null} */ (null));
  const [removePending, setRemovePending] = useState(false);
  const [removeProblem, setRemoveProblem] = useState(/** @type {string | null} */ (null));
  const [making, setMaking] = useState(/** @type {number | null} */ (null));
  const [makeProblem, setMakeProblem] = useState(/** @type {{ id: number, key: string } | null} */ (null));
  const [notice, setNotice] = useState(/** @type {{ key: string, values?: Record<string, string>, postId?: number } | null} */ (null));

  const kept = notes.filter((note) => !gone.has(note.id));
  const shown = shownNotes(kept, showAll);
  const allThemes = [...themes, ...archivedThemes];

  /** @param {{ key: string, values?: Record<string, string>, postId?: number }} said */
  function confirmed(said) {
    setNotice(said);
    router.refresh();
  }

  /** @param {Note} note */
  async function make(note) {
    if (making !== null) return;
    setMaking(note.id);
    setMakeProblem(null);
    setNotice(null);
    const sent = await send(`/api/inspiration/${note.id}`, 'POST', { action: 'post' });
    setMaking(null);
    if (!sent.ok || typeof sent.value?.post?.id !== 'number') {
      setMakeProblem({ id: note.id, key: sent.ok ? 'error.saveUnconfirmed' : sent.problem });
      return;
    }
    const post = sent.value.post;
    confirmed({ key: 'inspiration.made', values: { name: post.name || t('post.untitled', locale) }, postId: post.id });
  }

  async function remove() {
    if (removing === null) return;
    setRemovePending(true);
    setRemoveProblem(null);
    const sent = await send(`/api/inspiration/${removing.id}`, 'DELETE');
    setRemovePending(false);
    if (!sent.ok || sent.value?.ok !== true) {
      setRemoveProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    const id = removing.id;
    setRemoving(null);
    setGone((before) => new Set(before).add(id));
    confirmed({ key: 'inspiration.removed' });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Bookmark aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t('inspiration.title', locale)}</span>
          {kept.length > 0 && <span className="font-normal text-muted-foreground tabular-nums">{kept.length}</span>}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => { setNotice(null); setMakeProblem(null); setEditing({ note: null }); }}
        >
          <Plus aria-hidden="true" />
          {t('inspiration.add', locale)}
        </Button>
      </div>

      {notice && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>{t(notice.key, locale, notice.values)}</span>
          {notice.postId !== undefined && (
            <a href={`/posts/${notice.postId}`} className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto px-0')}>
              {t('ideas.open', locale)}
            </a>
          )}
        </p>
      )}

      {kept.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('inspiration.empty', locale)}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((note) => (
            <InspirationCard
              key={note.id}
              note={note}
              theme={noteThemeOf(note, allThemes)}
              locale={locale}
              making={making === note.id}
              problem={makeProblem?.id === note.id ? makeProblem.key : null}
              onMake={make}
              onEdit={(chosen) => { setNotice(null); setMakeProblem(null); setEditing({ note: chosen }); }}
              onRemove={(chosen) => { setNotice(null); setMakeProblem(null); setRemoveProblem(null); setRemoving(chosen); }}
            />
          ))}
        </ul>
      )}

      {kept.length > FOLDED && (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setShowAll((before) => !before)}>
          {showAll ? t('inspiration.fewer', locale) : t('inspiration.all', locale, { count: String(kept.length) })}
        </Button>
      )}
      {full && showAll && <p className="text-xs text-muted-foreground">{t('inspiration.newest', locale, { count: String(notes.length) })}</p>}

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(editing?.note ? 'inspiration.editTitle' : 'inspiration.new', locale)}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <NoteForm
              key={editing.note?.id ?? 'new'}
              locale={locale}
              note={editing.note}
              themes={themes}
              archivedThemes={archivedThemes}
              onSaved={(key) => { setEditing(null); confirmed({ key }); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmRemove
        locale={locale}
        open={removing !== null}
        title={t('inspiration.removeAsk', locale)}
        pending={removePending}
        problem={removeProblem}
        onClose={() => { if (!removePending) setRemoving(null); }}
        onConfirm={remove}
      />
    </section>
  );
}
