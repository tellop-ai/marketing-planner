'use client';

import { enUS, tr } from 'date-fns/locale';
import { Lightbulb, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { dateOf, dayOf } from './format.js';
import { colourOf } from './rules.js';
import { sendUnconfirmed } from '../send.js';
import { ThemeDot } from './tiles.jsx';

const CHIP = 'h-8 max-w-full gap-2 rounded-4xl bg-card px-3 font-normal ring-1 ring-foreground/10';

/**
 * The ideas row under the month, as drawn: the newest ideas (posts with no
 * day) as chips with their theme's dot. A chip asks for a day with the kit's
 * calendar and moves the idea onto it; `+` adds an idea.
 *
 * @param {{ locale: string, month: string, ideas: Array<{ id: number, name: string, themeId: number | null }>, more: boolean,
 *   themes: Array<{ id: number, name: string, colour: number }>, colours: Map<number, number> }} props
 */
export function IdeasRow({ locale, month, ideas, more, themes, colours }) {
  const [adding, setAdding] = useState(false);
  return (
    <div data-print-hidden className="flex flex-wrap items-center gap-2">
      <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium">
        <Lightbulb aria-hidden="true" className="size-4 text-muted-foreground" />
        {t('menu.ideas', locale)}
      </span>
      {ideas.map((idea) => (
        <IdeaChip key={idea.id} locale={locale} month={month} idea={idea} colour={colourOf(idea.themeId, colours)} />
      ))}
      {more && (
        <Link href="/ideas" className={cn(buttonVariants({ variant: 'ghost' }), 'text-muted-foreground')}>
          {t('calendar.ideas.all', locale)}
        </Link>
      )}
      <Button type="button" variant="ghost" size="icon" aria-label={t('calendar.ideas.add', locale)} onClick={() => setAdding(true)}>
        <Plus aria-hidden="true" />
      </Button>
      <AddIdeaDialog locale={locale} open={adding} onOpenChange={setAdding} themes={themes} />
    </div>
  );
}

/** One idea: a chip that opens a small calendar to give it a day. */
function IdeaChip({ locale, month, idea, colour }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const name = idea.name || t('post.untitled', locale);

  /** @param {Date | undefined} date */
  async function pick(date) {
    if (!date || pending) return;
    setPending(true);
    setProblem(null);
    const sent = await sendUnconfirmed(`/api/posts/${idea.id}`, 'PATCH', { day: dayOf(date) });
    setPending(false);
    if (!sent.ok) {
      setProblem(sent.problem);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setProblem(null); }}>
      <PopoverTrigger render={<Button type="button" variant="ghost" className={CHIP} />}>
        <ThemeDot colour={colour} />
        <span className="truncate">{name}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <p className="max-w-64 truncate px-1 text-sm font-medium">{name}</p>
        <Calendar
          mode="single"
          locale={locale === 'tr' ? tr : enUS}
          defaultMonth={dateOf(`${month}-01`)}
          onSelect={pick}
          disabled={pending}
          aria-label={t('calendar.ideas.pickDay', locale, { name })}
        />
        {problem && <p role="alert" className="max-w-64 px-1 text-xs text-destructive">{t(problem, locale)}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** A new idea: one line and a theme, kept with no day. The draft goes when the window closes. */
function AddIdeaDialog({ locale, open, onOpenChange, themes }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t('calendar.ideas.new', locale)}</DialogTitle>
        </DialogHeader>
        {open && <AddIdeaForm locale={locale} themes={themes} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AddIdeaForm({ locale, themes, onDone }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState(themes[0] ? String(themes[0].id) : '');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function save(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setProblem(null);
    const sent = await sendUnconfirmed('/api/posts', 'POST', { name, themeId: themeId === '' ? null : Number(themeId) });
    setPending(false);
    if (!sent.ok) {
      setProblem(sent.problem);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>{t('calendar.ideas.name', locale)}</FieldLabel>
          <Input id={`${id}-name`} value={name} onValueChange={setName} maxLength={LIMITS.name} required autoComplete="off" />
        </Field>
        {themes.length > 0 && (
          <Field>
            <FieldLabel htmlFor={`${id}-theme`}>{t('calendar.ideas.theme', locale)}</FieldLabel>
            <NativeSelect id={`${id}-theme`} className="w-full" value={themeId} onChange={(event) => setThemeId(event.target.value)}>
              {themes.map((theme) => (
                <NativeSelectOption key={theme.id} value={String(theme.id)}>{theme.name}</NativeSelectOption>
              ))}
              <NativeSelectOption value="">{t('calendar.ideas.noTheme', locale)}</NativeSelectOption>
            </NativeSelect>
          </Field>
        )}
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || name.trim() === ''}>{t('calendar.ideas.save', locale)}</Button>
      </DialogFooter>
    </form>
  );
}
