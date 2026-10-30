'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { t } from '../lib/i18n/index.js';
import { LIMITS } from '../lib/plan/limits.js';

import { useRights } from './rights.jsx';
import { send } from './send.js';

/**
 * Makes a new post (on `day` when one is given, with `extra` fields such as
 * its campaign) and opens it in the post maker. Nothing is made until the
 * press; a refusal shows its words beside the button and the person can
 * press again.
 *
 * Drawn only for a person who may add (`useRights`). A Member may add a post
 * but not change one afterwards (the app cannot tell which posts they added),
 * so for them the press opens a small window first: the post's name and what
 * it should say, kept in the same press, so the post they add is not empty.
 *
 * @param {{ locale: string, day?: string, extra?: Record<string, unknown>, label?: string, className?: string, variant?: string }} props
 */
export function NewPostButton({ locale, day, extra, label, className, variant = 'default' }) {
  const router = useRouter();
  const { add, change } = useRights();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [asking, setAsking] = useState(false);
  const fields = { ...(extra ?? {}), ...(day ? { day } : {}) };

  /** Sends the new post; answers its words key when it was not made. @param {Record<string, unknown>} body */
  async function make(body) {
    const sent = await send('/api/posts', 'POST', body);
    if (!sent.ok || typeof sent.value?.post?.id !== 'number') return sent.ok ? 'error.saveFailed' : sent.problem;
    router.push(`/posts/${sent.value.post.id}`);
    return null;
  }

  async function press() {
    if (!change) {
      setProblem(null);
      setAsking(true);
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      setProblem(await make(fields));
    } finally {
      setPending(false);
    }
  }

  if (!add) return null;
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant={variant} className={className} disabled={pending} onClick={press}>
        <Plus aria-hidden="true" />
        {label ?? t('shell.newPost', locale)}
      </Button>
      {problem && <p role="alert" className="text-xs text-destructive">{t(problem, locale)}</p>}
      {!change && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
            <DialogHeader>
              <DialogTitle>{label ?? t('shell.newPost', locale)}</DialogTitle>
            </DialogHeader>
            {asking && <NewPostForm locale={locale} onMake={(words) => make({ ...fields, ...words })} />}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The window's form: the post's name and what it should say. It unmounts as
 * the window closes, so a closed window forgets what was typed; a refusal
 * keeps every word.
 *
 * @param {{ locale: string, onMake: (words: { name: string, mainText: string }) => Promise<string | null> }} props
 */
function NewPostForm({ locale, onMake }) {
  const id = useId();
  const [name, setName] = useState('');
  const [mainText, setMainText] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function save(event) {
    event.preventDefault();
    if (pending || name.trim() === '') return;
    setPending(true);
    setProblem(null);
    const refused = await onMake({ name, mainText });
    setPending(false);
    setProblem(refused);
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>{t('maker.name', locale)}</FieldLabel>
          <Input id={`${id}-name`} value={name} onValueChange={setName} maxLength={LIMITS.name} required autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-words`}>{t('maker.say', locale)}</FieldLabel>
          <Textarea id={`${id}-words`} value={mainText} onChange={(event) => setMainText(event.target.value)} maxLength={LIMITS.mainText} rows={4} />
        </Field>
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || name.trim() === ''}>{t('newPost.add', locale)}</Button>
      </DialogFooter>
    </form>
  );
}
