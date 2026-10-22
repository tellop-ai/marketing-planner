'use client';

import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { t } from '../../lib/i18n/index.js';
import { LIMITS, readLink } from '../../lib/plan/limits.js';

import { refusedHere, useAutoSave } from './auto-save.js';
import { ResultLine } from './result-line.jsx';

const PLAN_ADDRESS = '/api/plan';

const FIELDS = Object.freeze([
  { name: 'profileLink', label: 'plan.links.profile' },
  { name: 'reviewLink', label: 'plan.links.review' },
]);

/** @param {Record<string, unknown>} profile */
function linksOf(profile) {
  return { profileLink: String(profile.profileLink ?? ''), reviewLink: String(profile.reviewLink ?? '') };
}

/**
 * Links: the profile link, the address where customers leave a review, and
 * whether the links the person shares carry tracking (on unless turned off).
 * A link saves by itself once it reads as a whole link (or is empty), else
 * when the field is left, where a refusal says why and keeps what the person
 * typed; the switch saves at once.
 *
 * @param {{ locale: string, profile: Record<string, unknown> }} props
 */
export function LinksCard({ locale, profile }) {
  const [links, setLinks] = useState(() => linksOf(profile));
  const [track, setTrack] = useState(() => profile.trackLinks !== false);
  const { queue, result, setResult } = useAutoSave();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.links.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <Field key={field.name}>
              <FieldLabel htmlFor={`plan-${field.name}`}>{t(field.label, locale)}</FieldLabel>
              <Input
                id={`plan-${field.name}`}
                inputMode="url"
                placeholder={t('plan.links.hint', locale)}
                maxLength={LIMITS.link}
                value={links[field.name]}
                aria-invalid={refusedHere(result, PLAN_ADDRESS, field.name)}
                onChange={(event) => {
                  const value = event.target.value;
                  setLinks((before) => ({ ...before, [field.name]: value }));
                  setResult(null);
                  queue.change(PLAN_ADDRESS, 'PUT', field.name, value, readLink(value).ok ? 'typing' : 'held');
                }}
                onBlur={() => queue.flush()}
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id="plan-track-links"
              checked={track}
              aria-describedby="plan-track-links-hint"
              onCheckedChange={(next) => {
                const on = next === true;
                setTrack(on);
                setResult(null);
                queue.change(PLAN_ADDRESS, 'PUT', 'trackLinks', on, 'now');
              }}
            />
            <Label htmlFor="plan-track-links">{t('plan.links.track', locale)}</Label>
          </div>
          <p id="plan-track-links-hint" className="text-sm text-muted-foreground">{t('plan.links.trackHint', locale)}</p>
        </div>
        <ResultLine locale={locale} result={result} />
      </CardContent>
    </Card>
  );
}
