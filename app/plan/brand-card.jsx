'use client';

import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';

import { refusedHere, useAutoSave } from './auto-save.js';
import { BRAND_PRESETS, colourToSave, isPreset, presetColour, swatchColour } from './brand.js';
import { ResultLine } from './result-line.jsx';
import { useRights } from '../rights.jsx';

const PLAN_ADDRESS = '/api/plan';

const FIELDS = Object.freeze([
  { name: 'brandColour', label: 'plan.brand.colour' },
  { name: 'brandColour2', label: 'plan.brand.colour2' },
]);

/**
 * A colour's small round sample beside its field. Its colour is the person's
 * value, set on the element through the CSSOM (`--swatch`) in an effect, never
 * a `style=` attribute or a class with a colour in it; with no whole colour
 * typed it shows the muted token.
 *
 * @param {{ value: string, className?: string }} props
 */
function Swatch({ value, className }) {
  const ref = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const colour = swatchColour(value);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (colour) element.style.setProperty('--swatch', colour);
    else element.style.removeProperty('--swatch');
  }, [colour]);
  return <span ref={ref} aria-hidden="true" className={cn('size-4 shrink-0 rounded-full bg-(--swatch,var(--color-muted)) ring-1 ring-foreground/15', className)} />;
}

/**
 * Brand: the brand colour and a second colour the words pictures are drawn
 * in (`#` and six letters or digits; none means the theme's colour), each
 * with a row of eight ready colours under it (`BRAND_PRESETS`: a press sets
 * the field and saves at once; the one the field holds shows pressed), Clear,
 * and Logo on pictures. A colour saves by itself once it is a whole colour (or
 * empty), else when the field is left, where a refusal says why and keeps
 * what the person typed; Clear and the switch save at once. Logo on pictures
 * rests, saying so, until a logo is kept (Your business, above).
 *
 * @param {{ locale: string, profile: { brandColour?: string, brandColour2?: string, logoOnPictures?: boolean, logo?: string | null } }} props
 */
export function BrandCard({ locale, profile }) {
  const { change: canChange } = useRights();
  const [colours, setColours] = useState(() => ({ brandColour: profile.brandColour ?? '', brandColour2: profile.brandColour2 ?? '' }));
  const [logoOn, setLogoOn] = useState(() => profile.logoOnPictures === true);
  const { queue, result, setResult } = useAutoSave();
  const hasLogo = Boolean(profile.logo);

  /** @param {'brandColour' | 'brandColour2'} name @param {string} value @param {'typing' | 'now'} mode */
  function changeColour(name, value, mode = 'typing') {
    setColours((before) => ({ ...before, [name]: value }));
    setResult(null);
    const saving = colourToSave(value);
    queue.change(PLAN_ADDRESS, 'PUT', name, saving ?? value, saving === null ? 'held' : mode);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.brand.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          {FIELDS.map((field) => (
            <Field key={field.name}>
              <FieldLabel htmlFor={`plan-${field.name}`}>{t(field.label, locale)}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Swatch value={colours[field.name]} />
                </InputGroupAddon>
                <InputGroupInput
                  id={`plan-${field.name}`}
                  value={colours[field.name]}
                  placeholder={t('plan.brand.hint', locale)}
                  maxLength={16}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  aria-invalid={refusedHere(result, PLAN_ADDRESS, field.name)}
                  onChange={(event) => changeColour(field.name, event.target.value)}
                  onBlur={() => queue.flush()}
                />
              </InputGroup>
              {canChange && (
                <div role="group" aria-label={t('plan.brand.presetsFor', locale, { field: t(field.label, locale) })} className="flex flex-wrap gap-1.5">
                  {BRAND_PRESETS.map((preset) => {
                    const on = isPreset(colours[field.name], preset);
                    return (
                      <Toggle
                        key={preset.key}
                        size="sm"
                        pressed={on}
                        aria-label={t(`plan.brand.preset.${preset.key}`, locale)}
                        title={t(`plan.brand.preset.${preset.key}`, locale)}
                        onPressedChange={() => {
                          if (!on) changeColour(field.name, presetColour(preset), 'now');
                        }}
                        className="size-7 min-w-7 rounded-full p-0 hover:bg-muted aria-pressed:bg-transparent aria-pressed:ring-2 aria-pressed:ring-foreground"
                      >
                        <Swatch value={presetColour(preset)} className="size-5" />
                      </Toggle>
                    );
                  })}
                </div>
              )}
            </Field>
          ))}
          {canChange && (colours.brandColour !== '' || colours.brandColour2 !== '') && (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  changeColour('brandColour', '', 'now');
                  changeColour('brandColour2', '', 'now');
                }}
              >
                <Eraser aria-hidden="true" />
                {t('plan.brand.clear', locale)}
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id="plan-logo-on-pictures"
              checked={hasLogo && logoOn}
              disabled={!hasLogo || !canChange}
              aria-describedby={hasLogo || !canChange ? undefined : 'plan-logo-first'}
              onCheckedChange={(next) => {
                const on = next === true;
                setLogoOn(on);
                setResult(null);
                queue.change(PLAN_ADDRESS, 'PUT', 'logoOnPictures', on, 'now');
              }}
            />
            <Label htmlFor="plan-logo-on-pictures">{t('plan.brand.logoOnPictures', locale)}</Label>
          </div>
          {!hasLogo && canChange && <p id="plan-logo-first" className="text-sm text-muted-foreground">{t('plan.brand.logoFirst', locale)}</p>}
        </div>
        <ResultLine locale={locale} result={result} />
      </CardContent>
    </Card>
  );
}
