'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PictureField } from '@/components/ui/picture-field';
import { Textarea } from '@/components/ui/textarea';

import { t } from '../../lib/i18n/index.js';
import { pictureAddress } from '../../lib/pictures.js';
import { appendPicture } from '../../lib/send-file.js';

import { refusedHere, useAutoSave } from './auto-save.js';
import { ResultLine } from './result-line.jsx';
import { useRights } from '../rights.jsx';
import { sendForm } from '../send.js';

const PLAN_ADDRESS = '/api/plan';
const LOGO_ADDRESS = '/api/plan/logo';

/** The words fields of this card, in the order they show, and how each is written. */
const FIELDS = Object.freeze([
  { name: 'businessName', label: 'plan.business.name', box: 'line' },
  { name: 'offer', label: 'plan.business.offer', box: 'lines' },
  { name: 'audience', label: 'plan.business.audience', box: 'lines' },
  { name: 'goal', label: 'plan.business.goal', box: 'line' },
  { name: 'voice', label: 'plan.business.voice', box: 'line', hint: 'plan.business.voiceHint' },
  { name: 'pictureStyle', label: 'plan.business.pictureStyle', box: 'line', hint: 'plan.business.pictureStyleHint' },
]);

/** @param {Record<string, unknown>} profile */
function wordsOf(profile) {
  return Object.fromEntries(FIELDS.map(({ name }) => [name, String(profile[name] ?? '')]));
}

/** @param {string | null} tag */
function logoValue(tag) {
  return tag ? { saved: pictureAddress(LOGO_ADDRESS, tag) } : null;
}

/**
 * The kept logo, to look at only (a person who may not change My plan): the
 * picture, or one line when there is none or this browser cannot show it.
 *
 * @param {{ address: string | null, locale: string }} props
 */
function LogoToRead({ address, locale }) {
  const [broken, setBroken] = useState(false);
  if (address === null) return <p className="text-sm text-muted-foreground">{t('plan.business.noLogo', locale)}</p>;
  if (broken) return <p className="text-sm text-muted-foreground">{t('plan.business.logoUnshown', locale)}</p>;
  return (
    <img
      src={address}
      alt={t('plan.business.logo', locale)}
      onError={() => setBroken(true)}
      className="aspect-4/3 w-full max-w-64 rounded-lg border border-border bg-muted object-cover"
    />
  );
}

/**
 * Your business: its name, what it sells, who it is for, the goal for now, how
 * it sounds, how its pictures look, and its logo. Each field saves by itself:
 * words when the person stops typing or leaves the field, the logo as soon as
 * it is picked or removed (kept, then named by its digest). One quiet line
 * says "Saved" or why not; a refusal keeps every word the person typed. A
 * new logo reads the page again, so the Brand card knows it is there.
 *
 * @param {{ locale: string, profile: Record<string, any> }} props
 */
export function BusinessCard({ locale, profile }) {
  const router = useRouter();
  const { change: canChange } = useRights();
  const [words, setWords] = useState(() => wordsOf(profile));
  const [logo, setLogo] = useState(() => logoValue(profile.logo));
  const [logoPending, setLogoPending] = useState(false);
  const { queue, result, setResult } = useAutoSave();

  /** @param {{ file?: File, removed?: boolean, saved?: string } | null} next */
  async function keepLogo(next) {
    setLogo(next);
    if (!next?.file && !next?.removed) return;
    setLogoPending(true);
    setResult(null);
    try {
      const form = new FormData();
      try {
        await appendPicture(form, 'logo', next);
      } catch (error) {
        setResult({ problem: typeof error?.messageKey === 'string' ? error.messageKey : 'error.fileNotKept', field: 'logo', address: LOGO_ADDRESS });
        return;
      }
      const kept = await sendForm(LOGO_ADDRESS, form);
      if (!kept.ok) {
        setResult({ ...kept, field: 'logo', address: LOGO_ADDRESS });
        return;
      }
      setLogo(logoValue(kept.value.profile?.logo ?? null));
      setResult({ saved: true });
      router.refresh();
    } finally {
      setLogoPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.business.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `plan-${field.name}`;
          const Box = field.box === 'lines' ? Textarea : Input;
          return (
            <Field key={field.name} className={field.box === 'lines' ? 'sm:col-span-2' : undefined}>
              <FieldLabel htmlFor={id}>{t(field.label, locale)}</FieldLabel>
              <Box
                id={id}
                value={words[field.name]}
                placeholder={field.hint ? t(field.hint, locale) : undefined}
                aria-invalid={refusedHere(result, PLAN_ADDRESS, field.name)}
                onChange={(event) => {
                  const value = event.target.value;
                  setWords((before) => ({ ...before, [field.name]: value }));
                  setResult(null);
                  queue.change(PLAN_ADDRESS, 'PUT', field.name, value);
                }}
                onBlur={() => queue.flush()}
              />
            </Field>
          );
        })}
        <Field className="sm:col-span-2">
          <FieldTitle>{t('plan.business.logo', locale)}</FieldTitle>
          {canChange ? (
            <PictureField
              value={logo}
              locale={locale}
              alt={t('plan.business.logo', locale)}
              disabled={logoPending}
              onChange={(next) => void keepLogo(next)}
            />
          ) : (
            <LogoToRead address={logo?.saved ?? null} locale={locale} />
          )}
        </Field>
        <ResultLine locale={locale} result={result} />
      </CardContent>
    </Card>
  );
}
