'use client';

import { ArrowDown, ArrowUp, Hash, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { refusedHere, useAutoSave } from './auto-save.js';
import { ConfirmRemove } from './confirm-remove.jsx';
import { ResultLine } from './result-line.jsx';
import { send } from '../send.js';
import { THEME_BACKGROUNDS } from '../theme-colours.js';

const ROW = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]';

/** @typedef {{ id: number, name: string, about: string, hashtags: string, colour: number, position: number, sells?: boolean }} Theme */
/** @typedef {{ id: number, title: string, hashtags: string }} HashtagSet */

/** @param {Theme} theme */
function draftOf(theme) {
  return { name: theme.name, about: theme.about, hashtags: theme.hashtags, sells: theme.sells === true };
}

/** @param {number} id */
function addressOf(id) {
  return `/api/themes/${id}`;
}

/** @param {{ colour: number, className?: string }} props */
function Dot({ colour, className = 'size-3' }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-full ${THEME_BACKGROUNDS[colour] ?? THEME_BACKGROUNDS[0]} ${className}`} />;
}

/**
 * A theme's default hashtags: what the person types, or one of the hashtag
 * sets kept in Ready words, chosen from the field's menu, which fills the
 * field and saves it at once. With no set kept, the field alone.
 *
 * @param {{ locale: string, value: string, invalid: true | undefined, sets: HashtagSet[], className: string,
 *   onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => void, onBlur: () => void, onChoose: (hashtags: string) => void }} props
 */
function HashtagsField({ locale, value, invalid, sets, className, onChange, onBlur, onChoose }) {
  const field = { value, placeholder: t('theme.hashtagsHint', locale), 'aria-label': t('theme.hashtags', locale), 'aria-invalid': invalid, onChange, onBlur };
  if (sets.length === 0) return <Input {...field} className={className} />;
  return (
    <InputGroup className={className}>
      <InputGroupInput {...field} />
      <InputGroupAddon align="inline-end">
        <DropdownMenu>
          <DropdownMenuTrigger render={<InputGroupButton size="icon-xs" aria-label={t('theme.hashtagSets', locale)} />}>
            <Hash aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
            {sets.map((set) => (
              <DropdownMenuItem key={set.id} onClick={() => onChoose(set.hashtags)} className="flex-col items-start gap-0.5">
                <span className="w-full truncate font-medium">{set.title}</span>
                <span className="w-full truncate text-xs text-muted-foreground">{set.hashtags}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * Themes: up to five rows, each a colour, a name, what its posts do, its
 * default hashtags (typed, or a hashtag set from Ready words) and whether it
 * sells (its posts ask people to buy; the calendar warns when they crowd a
 * month). Each field saves by itself: words when the person stops typing or
 * leaves the field (an empty name waits until it is left, where it is
 * refused and the line says why), a hashtag set and Sells at once. A colour,
 * a move, Add and Remove save on their own press. One quiet line says "Saved"
 * or why not.
 *
 * @param {{ locale: string, themes: Theme[], hashtagSets?: HashtagSet[] }} props
 */
export function ThemesCard({ locale, themes: first, hashtagSets = [] }) {
  const [themes, setThemes] = useState(first);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(first.map((theme) => [theme.id, draftOf(theme)])));
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(/** @type {Theme | null} */ (null));
  const [removeProblem, setRemoveProblem] = useState(/** @type {string | null} */ (null));
  const { queue, result, setResult } = useAutoSave({
    onSaved: (_change, value) => {
      const theme = value?.theme;
      if (theme && typeof theme.id === 'number') setThemes((before) => before.map((item) => (item.id === theme.id ? theme : item)));
    },
  });

  /** @param {Theme} theme @param {number} colour */
  async function paint(theme, colour) {
    setPending(true);
    setResult(null);
    const sent = await send(`/api/themes/${theme.id}`, 'PATCH', { colour });
    setPending(false);
    if (!sent.ok) {
      setResult(sent);
      return;
    }
    setThemes((before) => before.map((item) => (item.id === theme.id ? { ...item, colour: sent.value.theme.colour } : item)));
    setResult({ saved: true });
  }

  /** @param {Theme} theme @param {'up' | 'down'} direction */
  async function move(theme, direction) {
    setPending(true);
    setResult(null);
    const sent = await send(`/api/themes/${theme.id}`, 'POST', { action: 'move', direction });
    setPending(false);
    if (!sent.ok) {
      setResult(sent);
      return;
    }
    setThemes(sent.value.themes);
    setResult({ saved: true });
  }

  async function add() {
    setPending(true);
    setResult(null);
    const sent = await send('/api/themes', 'POST', { name: newName });
    setPending(false);
    if (!sent.ok) {
      setResult({ ...sent, field: 'new' });
      return;
    }
    const theme = sent.value.theme;
    setThemes((before) => [...before, theme]);
    setDrafts((before) => ({ ...before, [theme.id]: draftOf(theme) }));
    setNewName('');
    setResult({ saved: true });
  }

  async function remove() {
    if (removing === null) return;
    setPending(true);
    setRemoveProblem(null);
    // Its words that wait are not saved: the theme goes. A save already sent ends first.
    queue.drop(addressOf(removing.id));
    await queue.settled();
    const sent = await send(addressOf(removing.id), 'DELETE');
    setPending(false);
    if (!sent.ok) {
      setRemoveProblem(sent.problem);
      return;
    }
    const gone = removing.id;
    setThemes((before) => before.filter((item) => item.id !== gone));
    setRemoving(null);
    setResult({ done: 'plan.removed' });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.themes.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {themes.length > 0 && (
          <div aria-hidden="true" className={`hidden text-xs text-muted-foreground lg:grid ${ROW}`}>
            <span className="size-7" />
            <span>{t('theme.name', locale)}</span>
            <span>{t('theme.about', locale)}</span>
            <span>{t('theme.hashtags', locale)}</span>
            <span>{t('theme.sells', locale)}</span>
            <span className="w-24" />
          </div>
        )}
        <ol className="flex flex-col gap-3">
          {themes.map((theme, index) => {
            const draft = drafts[theme.id] ?? draftOf(theme);
            const address = addressOf(theme.id);
            const invalid = (name) => refusedHere(result, address, name);
            /** @param {'name' | 'about' | 'hashtags' | 'sells'} name @param {string | boolean} value @param {'typing' | 'now' | 'held'} mode */
            const put = (name, value, mode) => {
              setDrafts((before) => ({ ...before, [theme.id]: { ...(before[theme.id] ?? draft), [name]: value } }));
              setResult(null);
              queue.change(address, 'PATCH', name, value, mode);
            };
            const edit = (name) => (event) => {
              const value = event.target.value;
              put(name, value, name === 'name' && value.trim() === '' ? 'held' : 'typing');
            };
            const sellsId = `theme-${theme.id}-sells`;
            return (
              <li key={theme.id} className={`${ROW} border-b border-border pb-3 last:border-b-0 last:pb-0 lg:border-b-0 lg:pb-0`}>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button type="button" variant="ghost" size="icon-sm" disabled={pending} aria-label={t('theme.colour', locale, { name: theme.name })} />}
                  >
                    <Dot colour={theme.colour} className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-auto">
                    <DropdownMenuRadioGroup value={theme.colour} onValueChange={(value) => { if (value !== theme.colour) void paint(theme, value); }}>
                      {THEME_BACKGROUNDS.map((_, colour) => (
                        <DropdownMenuRadioItem key={colour} value={colour}>
                          <Dot colour={colour} />
                          {t('theme.colourNumber', locale, { number: String(colour + 1) })}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input
                  value={draft.name}
                  aria-label={t('theme.name', locale)}
                  aria-invalid={invalid('name')}
                  maxLength={LIMITS.name}
                  onChange={edit('name')}
                  onBlur={() => queue.flush()}
                />
                <div className="order-3 flex items-center justify-end gap-0.5 lg:order-6 lg:w-24">
                  <Button type="button" variant="ghost" size="icon-sm" disabled={pending || index === 0} aria-label={t('theme.up', locale)} onClick={() => move(theme, 'up')}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={pending || index === themes.length - 1} aria-label={t('theme.down', locale)} onClick={() => move(theme, 'down')}>
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={t('plan.remove', locale)}
                    onClick={() => {
                      setRemoveProblem(null);
                      setRemoving(theme);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <Input
                  value={draft.about}
                  placeholder={t('theme.about', locale)}
                  aria-label={t('theme.about', locale)}
                  aria-invalid={invalid('about')}
                  className="order-4 col-span-3 lg:order-3 lg:col-span-1"
                  onChange={edit('about')}
                  onBlur={() => queue.flush()}
                />
                <HashtagsField
                  locale={locale}
                  value={draft.hashtags}
                  invalid={invalid('hashtags')}
                  sets={hashtagSets}
                  className="order-5 col-span-2 lg:order-4 lg:col-span-1"
                  onChange={edit('hashtags')}
                  onBlur={() => queue.flush()}
                  onChoose={(hashtags) => put('hashtags', hashtags, 'now')}
                />
                <div className="order-6 flex items-center justify-end gap-2 lg:order-5 lg:justify-center">
                  <Switch
                    id={sellsId}
                    size="sm"
                    checked={draft.sells}
                    aria-invalid={invalid('sells')}
                    onCheckedChange={(next) => put('sells', next === true, 'now')}
                  />
                  <Label htmlFor={sellsId} className="font-normal lg:sr-only">{t('theme.sells', locale)}</Label>
                </div>
              </li>
            );
          })}
        </ol>
        {themes.length > 0 && <p className="text-sm text-muted-foreground">{t('theme.sellsHint', locale)}</p>}
        {themes.length < LIMITS.themes && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              placeholder={t('theme.newName', locale)}
              aria-label={t('theme.newName', locale)}
              aria-invalid={result?.field === 'new' || undefined}
              maxLength={LIMITS.name}
              className="max-w-xs flex-1 basis-48"
              onChange={(event) => {
                setNewName(event.target.value);
                setResult(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (newName.trim() !== '') void add();
                }
              }}
            />
            <Button type="button" variant="outline" disabled={pending || newName.trim() === ''} onClick={add}>
              <Plus aria-hidden="true" />
              {t('theme.add', locale)}
            </Button>
          </div>
        )}
        <ResultLine locale={locale} result={result} />
      </CardContent>
      <ConfirmRemove
        locale={locale}
        open={removing !== null}
        title={t('theme.removeTitle', locale, { name: removing?.name ?? '' })}
        pending={pending}
        problem={removeProblem}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </Card>
  );
}
