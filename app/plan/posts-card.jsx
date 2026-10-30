'use client';

import { useState } from 'react';

import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/reui/number-field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Toggle } from '@/components/ui/toggle';

import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { NETWORKS, parseNetworkList } from '../../lib/plan/networks.js';

import { refusedHere, useAutoSave } from './auto-save.js';
import { ResultLine } from './result-line.jsx';
import { useRights } from '../rights.jsx';

const PLAN_ADDRESS = '/api/plan';
const [LEAST, MOST] = LIMITS.postsPerWeek;

/** More platforms than this, and a quiet line says fewer done well beat more done halfway. */
export const PLATFORMS_ADVISED = 3;

/**
 * Posts: how many a week, and the platforms used, each a chip that turns on
 * and off; the list keeps the order they were turned on in. A chip saves at
 * once, the number when the person stops changing it (or leaves it). Past
 * `PLATFORMS_ADVISED` platforms a quiet line advises fewer; nothing is
 * refused.
 *
 * @param {{ locale: string, profile: { postsPerWeek: number, networks: string } }} props
 */
export function PostsCard({ locale, profile }) {
  const { change: canChange } = useRights();
  const [perWeek, setPerWeek] = useState(/** @type {number | null} */ (profile.postsPerWeek));
  const [networks, setNetworks] = useState(() => parseNetworkList(profile.networks));
  const { queue, result, setResult } = useAutoSave();

  /** @param {string} key @param {boolean} on */
  function turn(key, on) {
    const next = on ? (networks.includes(key) ? networks : [...networks, key]) : networks.filter((item) => item !== key);
    setNetworks(next);
    setResult(null);
    queue.change(PLAN_ADDRESS, 'PUT', 'networks', next, 'now');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.posts.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="plan-per-week">{t('plan.posts.perWeek', locale)}</FieldLabel>
          <div>
          {!canChange && <p className="text-sm font-medium tabular-nums">{perWeek}</p>}
          {canChange && (
            <NumberField
              id="plan-per-week"
              className="w-36"
              value={perWeek}
              min={LEAST}
              max={MOST}
              step={1}
              onValueChange={(value) => {
                setPerWeek(value);
                setResult(null);
                const whole = Number.isInteger(value) && value >= LEAST && value <= MOST;
                queue.change(PLAN_ADDRESS, 'PUT', 'postsPerWeek', value, whole ? 'typing' : 'held');
              }}
            >
              <NumberFieldGroup aria-invalid={refusedHere(result, PLAN_ADDRESS, 'postsPerWeek')} onBlur={() => queue.flush()}>
                <NumberFieldDecrement aria-label={t('plan.posts.fewer', locale)} />
                <NumberFieldInput />
                <NumberFieldIncrement aria-label={t('plan.posts.more', locale)} />
              </NumberFieldGroup>
            </NumberField>
          )}
          </div>
        </Field>
        <Field>
          <FieldTitle>{t('plan.posts.networks', locale)}</FieldTitle>
          <div role="group" aria-label={t('plan.posts.networks', locale)} className="flex flex-wrap gap-2">
            {NETWORKS.map((item) => {
              const on = networks.includes(item.key);
              return (
                <Toggle
                  key={item.key}
                  pressed={on}
                  disabled={!canChange}
                  onPressedChange={(next) => turn(item.key, next)}
                  className="h-8 rounded-4xl bg-card px-3 text-foreground/70 ring-1 ring-foreground/10 hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-0 aria-pressed:hover:bg-primary/80"
                >
                  {item.name}
                </Toggle>
              );
            })}
          </div>
          {networks.length > PLATFORMS_ADVISED && <p className="text-sm text-muted-foreground">{t('plan.posts.fewerPlatforms', locale)}</p>}
        </Field>
        <ResultLine locale={locale} result={result} />
      </CardContent>
    </Card>
  );
}
