'use client';

import { CircleCheck, Copy, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { ConfirmRemove } from '../plan/confirm-remove.jsx';
import { useRights } from '../rights.jsx';
import { send } from '../send.js';

/** @typedef {{ id: number, kind: string, title: string, text: string, network: string | null, copied: number, position: number }} ReadyWord */

/**
 * The New and Edit form. It lives inside the window, so closing the window
 * forgets an unsaved draft (rule 6d); a refusal keeps every word typed.
 *
 * @param {{ locale: string, kinds: string[], editing: ReadyWord | null, onSaved: (word: ReadyWord) => void }} props
 */
function WordForm({ locale, kinds, editing, onSaved }) {
  const [kind, setKind] = useState(editing?.kind ?? kinds[0]);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [text, setText] = useState(editing?.text ?? '');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {{ problem: string, field?: string } | null} */ (null));

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function save(event) {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    const sent = editing
      ? await send(`/api/ready-words/${editing.id}`, 'PATCH', { kind, title, text })
      : await send('/api/ready-words', 'POST', { kind, title, text });
    setPending(false);
    if (!sent.ok) {
      setProblem(sent);
      return;
    }
    onSaved(sent.value.readyWord);
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-1">
        <Field>
          <FieldLabel htmlFor="ready-word-kind">{t('words.kindLabel', locale)}</FieldLabel>
          <NativeSelect id="ready-word-kind" value={kind} className="w-full" onChange={(event) => setKind(event.target.value)}>
            {kinds.map((item) => (
              <NativeSelectOption key={item} value={item}>{t(`words.kind.${item}`, locale)}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="ready-word-title">{t('words.titleLabel', locale)}</FieldLabel>
          <Input
            id="ready-word-title"
            value={title}
            maxLength={LIMITS.readyTitle}
            aria-invalid={problem?.field === 'title' || undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ready-word-text">{t('words.textLabel', locale)}</FieldLabel>
          <Textarea
            id="ready-word-text"
            value={text}
            className="min-h-32"
            aria-invalid={problem?.field === 'text' || undefined}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem.problem, locale)}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || title.trim() === '' || text.trim() === ''}>{t('plan.save', locale)}</Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Ready words grouped by kind, each with its title, its words and Copy. New
 * opens a window; Edit and Remove sit in each one's menu. Who is here
 * (`useRights`): New for a person who may add, the menu for one who may
 * change. Copy works for everyone; it counts the copy (a change to the kept
 * words) only for a person who may change them.
 *
 * @param {{ locale: string, kinds: string[], readyWords: ReadyWord[] }} props
 */
export function ReadyWordsBoard({ locale, kinds, readyWords }) {
  const { add: canAdd, change: canChange } = useRights();
  const [items, setItems] = useState(readyWords);
  const [dialog, setDialog] = useState(/** @type {{ editing: ReadyWord | null } | null} */ (null));
  const [copied, setCopied] = useState(/** @type {{ id: number, problem?: string } | null} */ (null));
  const [removing, setRemoving] = useState(/** @type {ReadyWord | null} */ (null));
  const [removeProblem, setRemoveProblem] = useState(/** @type {string | null} */ (null));
  const [pending, setPending] = useState(false);

  /** @param {ReadyWord} item */
  async function copy(item) {
    setCopied(null);
    try {
      await navigator.clipboard.writeText(item.text);
    } catch {
      setCopied({ id: item.id, problem: 'words.copyFailed' });
      return;
    }
    setCopied({ id: item.id });
    // The count is the kept words' own: a person who may not change them copies without it.
    if (!canChange) return;
    const sent = await send(`/api/ready-words/${item.id}`, 'POST', { action: 'copied' });
    if (sent.ok && typeof sent.value.copied === 'number') {
      setItems((before) => before.map((word) => (word.id === item.id ? { ...word, copied: sent.value.copied } : word)));
    }
  }

  /** @param {ReadyWord} saved */
  function keep(saved) {
    setItems((before) => (before.some((word) => word.id === saved.id) ? before.map((word) => (word.id === saved.id ? saved : word)) : [...before, saved]));
    setDialog(null);
  }

  async function remove() {
    if (removing === null) return;
    setPending(true);
    setRemoveProblem(null);
    const sent = await send(`/api/ready-words/${removing.id}`, 'DELETE');
    setPending(false);
    if (!sent.ok) {
      setRemoveProblem(sent.problem);
      return;
    }
    const gone = removing.id;
    setItems((before) => before.filter((word) => word.id !== gone));
    setRemoving(null);
  }

  const newButton = (
    <Button type="button" onClick={() => setDialog({ editing: null })}>
      <Plus aria-hidden="true" />
      {t('words.new', locale)}
    </Button>
  );

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('menu.readyWords', locale)}</h1>
        {items.length > 0 && canAdd && <div className="ml-auto">{newButton}</div>}
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">{t('words.empty', locale)}</p>
          {canAdd && newButton}
        </div>
      ) : (
        kinds.map((kind) => {
          const group = items.filter((word) => word.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} aria-labelledby={`ready-words-${kind}`} className="flex flex-col gap-3">
              <h2 id={`ready-words-${kind}`} className="text-base font-medium">{t(`words.group.${kind}`, locale)}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((word) => (
                  <li key={word.id} className="min-w-0">
                    <Card size="sm" className="h-full">
                      <CardHeader>
                        <CardTitle className="break-words">{word.title}</CardTitle>
                        {canChange && (
                          <CardAction>
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t('words.menu', locale)} />}>
                                <Ellipsis aria-hidden="true" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-auto">
                                <DropdownMenuItem onClick={() => setDialog({ editing: word })}>
                                  <Pencil aria-hidden="true" />
                                  {t('words.edit', locale)}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => {
                                    setRemoveProblem(null);
                                    setRemoving(word);
                                  }}
                                >
                                  <Trash2 aria-hidden="true" />
                                  {t('plan.remove', locale)}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </CardAction>
                        )}
                      </CardHeader>
                      <CardContent className="flex-1">
                        <p className="whitespace-pre-wrap break-words text-muted-foreground">{word.text}</p>
                      </CardContent>
                      <CardFooter className="flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => copy(word)}>
                          <Copy aria-hidden="true" />
                          {t('words.copy', locale)}
                        </Button>
                        <span role="status" className="text-sm">
                          {copied?.id === word.id &&
                            (copied.problem ? (
                              <span className="text-destructive">{t(copied.problem, locale)}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <CircleCheck aria-hidden="true" className="size-4" />
                                {t('words.copied', locale)}
                              </span>
                            ))}
                        </span>
                      </CardFooter>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <Dialog open={dialog !== null} onOpenChange={(next) => { if (!next) setDialog(null); }}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t(dialog?.editing ? 'words.editTitle' : 'words.newTitle', locale)}</DialogTitle>
          </DialogHeader>
          {dialog !== null && (
            <WordForm key={dialog.editing?.id ?? 'new'} locale={locale} kinds={kinds} editing={dialog.editing} onSaved={keep} />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmRemove
        locale={locale}
        open={removing !== null}
        title={t('words.removeTitle', locale, { title: removing?.title ?? '' })}
        pending={pending}
        problem={removeProblem}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </>
  );
}
