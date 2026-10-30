'use client';

import { enUS, tr } from 'date-fns/locale';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { PictureField } from '@/components/ui/picture-field';
import { Textarea } from '@/components/ui/textarea';
import { StatusRow } from '@/components/ui/toggle-group';

import { t } from '../../lib/i18n/index.js';
import { pictureAddress } from '../../lib/pictures.js';
import { appendPicture } from '../../lib/send-file.js';

import { PERMISSIONS, channelLabel, permissionLabel, sourceChoices } from './choices.js';
import { useRights } from '../rights.jsx';
import { sendUnconfirmed } from '../send.js';

const STARS = Object.freeze([1, 2, 3, 4, 5]);

/** The address that shows a comment's screenshot, changing when the picture does. */
export function screenshotAddress(comment, download = false) {
  const address = `/api/comments/${comment.id}/screenshot${download ? '?download=1' : ''}`;
  return download ? address : pictureAddress(address, comment.screenshot);
}

/**
 * Add or change one thing a customer said, with its screenshot (AGENTS.md
 * rule 6c: the picture belongs to the form, is kept as picked by
 * `appendPicture`, and only a press of Remove takes it away). The draft lives
 * inside the window's content, so closing the window forgets it.
 *
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, comment: object | null, locale: string,
 *   today: string, networks: string[], onDone: (key: string) => void }} props
 */
export function CommentDialog({ open, onOpenChange, comment, locale, today, networks, onDone }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">
            {comment ? (comment.name || t('comments.someone', locale)) : t('comments.addTitle', locale)}
          </DialogTitle>
        </DialogHeader>
        {open && <CommentForm key={comment?.id ?? 'new'} comment={comment} locale={locale} today={today} networks={networks} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The form inside the window. A person who may not change a kept comment
 * (`useRights`) reads it, unchangeable, with no Save or Remove.
 */
function CommentForm({ comment, locale, today, networks, onDone }) {
  const { change: canChange } = useRights();
  const readOnly = Boolean(comment) && !canChange;
  const [name, setName] = useState(comment?.name ?? '');
  const [text, setText] = useState(comment?.text ?? '');
  const [bestLine, setBestLine] = useState(comment?.bestLine ?? '');
  const [stars, setStars] = useState(comment?.stars === null || comment?.stars === undefined ? '' : String(comment.stars));
  const [source, setSource] = useState(comment?.source ?? (networks[0] ?? 'other'));
  const [day, setDay] = useState(comment?.receivedOn ?? today);
  const [permission, setPermission] = useState(comment?.permission ?? 'not-asked');
  const [permissionNote, setPermissionNote] = useState(comment?.permissionNote ?? '');
  // The picture is the form's own (rule 6c): the saved one shows until the person changes or removes it.
  const [picture, setPicture] = useState(comment?.screenshot ? { saved: screenshotAddress(comment) } : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [removing, setRemoving] = useState(false);

  /** @param {React.FormEvent} event */
  async function save(event) {
    event.preventDefault();
    setProblem(null);
    setBusy(true);
    const form = new FormData();
    try {
      await appendPicture(form, 'screenshot', picture);
    } catch (error) {
      setBusy(false);
      setProblem(typeof error?.messageKey === 'string' ? error.messageKey : 'error.fileNotKept');
      return;
    }
    const screenshot = form.get('screenshot');
    const fields = {
      name, text, bestLine, stars: stars === '' ? null : Number(stars), source, receivedOn: day, permission, permissionNote,
      ...(typeof screenshot === 'string' ? { screenshot } : {}),
    };
    const sent = comment
      ? await sendUnconfirmed(`/api/comments/${comment.id}`, 'PATCH', fields)
      : await sendUnconfirmed('/api/comments', 'POST', fields);
    setBusy(false);
    if (!sent.ok || typeof sent.value?.comment?.id !== 'number') {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    setPicture(null);
    onDone('comments.saved');
  }

  async function remove() {
    setProblem(null);
    setBusy(true);
    const sent = await sendUnconfirmed(`/api/comments/${comment.id}`, 'DELETE');
    setBusy(false);
    if (!sent.ok || sent.value?.ok !== true) {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    setPicture(null);
    onDone('comments.removed');
  }

  const id = (part) => `comment-${comment?.id ?? 'new'}-${part}`;

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
      <fieldset disabled={readOnly} className="-mx-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={id('text')}>{t('comments.field.text', locale)}</FieldLabel>
          <Textarea id={id('text')} value={text} onChange={(event) => setText(event.target.value)} required rows={3} />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('best')}>{t('comments.field.bestLine', locale)}</FieldLabel>
          <Input id={id('best')} value={bestLine} onValueChange={setBestLine} autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id('name')}>{t('comments.field.name', locale)}</FieldLabel>
            <Input id={id('name')} value={name} onValueChange={setName} maxLength={80} autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor={id('stars')}>{t('comments.field.stars', locale)}</FieldLabel>
            <NativeSelect id={id('stars')} className="w-full" value={stars} onChange={(event) => setStars(event.target.value)}>
              <NativeSelectOption value="">{t('comments.stars.none', locale)}</NativeSelectOption>
              {STARS.map((count) => <NativeSelectOption key={count} value={String(count)}>{'★'.repeat(count)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={id('source')}>{t('comments.field.source', locale)}</FieldLabel>
            <NativeSelect id={id('source')} className="w-full" value={source} onChange={(event) => setSource(event.target.value)}>
              {sourceChoices(networks, comment?.source).map((key) => (
                <NativeSelectOption key={key} value={key}>{channelLabel(key, locale)}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <DateField
            id={id('day')}
            className="flex flex-col gap-2 text-sm font-medium [&_p]:text-xs [&_p]:font-normal [&_p]:text-destructive"
            label={t('comments.field.day', locale)}
            value={day}
            onSave={(next) => { setDay(next); return next; }}
            words={{ choose: t('customers.day.choose', locale), invalid: t('customers.day.invalid', locale), failed: t('customers.day.invalid', locale), saved: '' }}
            calendarLocale={locale === 'tr' ? tr : enUS}
          />
        </div>
        <Field>
          <span className="text-sm font-medium">{t('comments.field.permission', locale)}</span>
          <StatusRow
            label={t('comments.field.permission', locale)}
            value={permission}
            onValueChange={setPermission}
            disabled={readOnly}
            options={PERMISSIONS.map((value) => ({ value, label: permissionLabel(value, locale) }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={id('note')}>{t('comments.field.permissionNote', locale)}</FieldLabel>
          <Input id={id('note')} value={permissionNote} onValueChange={setPermissionNote} autoComplete="off" />
        </Field>
        {/* To read only, the screenshot shows on the comment's own card (with its download where this browser cannot show it). */}
        {!readOnly && (
          <Field>
            <span className="text-sm font-medium">{t('comments.field.screenshot', locale)}</span>
            <PictureField value={picture} onChange={setPicture} locale={locale} alt={t('comments.field.screenshot', locale)} disabled={busy} />
          </Field>
        )}
      </fieldset>
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      {!readOnly && (
        <DialogFooter className="flex-wrap">
          {comment && !removing && (
            <Button type="button" variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => setRemoving(true)}>
              {t('comments.remove', locale)}
            </Button>
          )}
          {comment && removing && (
            <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
              <span className="text-sm">{t('comments.removeAsk', locale)}</span>
              <Button type="button" variant="destructive" disabled={busy} onClick={remove}>{t('comments.remove', locale)}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRemoving(false)}>{t('customers.keep', locale)}</Button>
            </div>
          )}
          <Button type="submit" disabled={busy || removing}>{t('customers.save', locale)}</Button>
        </DialogFooter>
      )}
    </form>
  );
}
