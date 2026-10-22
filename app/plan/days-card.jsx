'use client';

import { enUS, tr } from 'date-fns/locale';
import { EyeOff, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { Field, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { StatusRow } from '@/components/ui/toggle-group';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { ResultLine } from './result-line.jsx';
import { send } from '../send.js';

const PLACES = Object.freeze(['tr', 'world', 'both']);

/** @typedef {{ key: string, where: 'tr' | 'world', nameKey: string }} BuiltInDay */
/** @typedef {{ id: number, name: string, date: string, yearly: boolean, note: string }} OwnDay */

/** @param {unknown} value */
function dayList(value) {
  return typeof value === 'string' ? value.split(',').map((key) => key.trim()).filter(Boolean) : [];
}

/**
 * The day an own day falls on next (a yearly day this year, or next year once
 * it has passed; 29 February on the 28th in a common year), as a civil day.
 *
 * @param {OwnDay} day
 * @param {string} today
 */
function nextDate(day, today) {
  if (!day.yearly) return day.date;
  const [month, date] = day.date.split('-').map(Number);
  const on = (year) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(date, last)).padStart(2, '0')}`;
  };
  const year = Number(today.slice(0, 4));
  return on(year) >= today ? on(year) : on(year + 1);
}

/**
 * Special days: which places' days show (Turkey, worldwide, both), the
 * built-in days the person hid (with "Show again", and a way to hide one), and
 * the person's own days. Each press saves on its own.
 *
 * @param {{ locale: string, profile: { showDays: string, hiddenDays: string }, ownDays: OwnDay[],
 *   builtInDays: BuiltInDay[], today: string, lastMovingYear: number, movingOutdated: boolean }} props
 */
export function DaysCard({ locale, profile, ownDays: firstDays, builtInDays, today, lastMovingYear, movingOutdated }) {
  const [showDays, setShowDays] = useState(profile.showDays);
  const [hidden, setHidden] = useState(() => dayList(profile.hiddenDays));
  const [ownDays, setOwnDays] = useState(firstDays);
  const [toHide, setToHide] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [yearly, setYearly] = useState(true);
  const [dateReset, setDateReset] = useState(0);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(/** @type {{ saved?: boolean, done?: string, problem?: string, field?: string } | null} */ (null));

  const known = new Map(builtInDays.map((day) => [day.key, day]));
  const shown = builtInDays.filter((day) => (showDays === 'both' || day.where === showDays) && !hidden.includes(day.key));

  /** @param {Record<string, unknown>} change */
  async function saveProfile(change) {
    setPending(true);
    setResult(null);
    const sent = await send('/api/plan', 'PUT', change);
    setPending(false);
    if (!sent.ok) {
      setResult(sent);
      return false;
    }
    setShowDays(sent.value.profile.showDays);
    setHidden(dayList(sent.value.profile.hiddenDays));
    setResult({ saved: true });
    return true;
  }

  async function addDay() {
    setPending(true);
    setResult(null);
    const sent = await send('/api/special-days', 'POST', { name, date, yearly });
    setPending(false);
    if (!sent.ok) {
      setResult(sent);
      return;
    }
    setOwnDays((before) => [...before, sent.value.day]);
    setName('');
    setDate('');
    setYearly(true);
    setDateReset((count) => count + 1);
    setResult({ saved: true });
  }

  /** @param {OwnDay} day */
  async function removeDay(day) {
    setPending(true);
    setResult(null);
    const sent = await send(`/api/special-days/${day.id}`, 'DELETE');
    setPending(false);
    if (!sent.ok) {
      setResult(sent);
      return;
    }
    setOwnDays((before) => before.filter((item) => item.id !== day.id));
    setResult({ done: 'plan.removed' });
  }

  const ordered = [...ownDays].sort((a, b) => nextDate(a, today).localeCompare(nextDate(b, today)) || a.id - b.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan.days.title', locale)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <StatusRow
          label={t('plan.days.title', locale)}
          options={PLACES.map((place) => ({ value: place, label: t(`plan.days.${place}`, locale) }))}
          value={showDays}
          disabled={pending}
          onValueChange={(place) => saveProfile({ showDays: place })}
        />
        {movingOutdated && <p className="text-sm text-muted-foreground">{t('plan.days.movingOutdated', locale, { year: String(lastMovingYear) })}</p>}

        <div className="flex flex-col gap-2">
          <FieldTitle>{t('plan.days.hidden', locale)}</FieldTitle>
          {hidden.filter((key) => known.has(key)).length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {hidden.filter((key) => known.has(key)).map((key) => (
                <li key={key} className="inline-flex h-8 items-center gap-1 rounded-4xl bg-muted pr-1 pl-3 text-sm">
                  {t(known.get(key).nameKey, locale)}
                  <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => saveProfile({ hiddenDays: hidden.filter((item) => item !== key) })}>
                    {t('plan.days.showAgain', locale)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {shown.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label={t('plan.days.hideWhich', locale)}
                value={toHide}
                disabled={pending}
                className="min-w-0 max-w-full"
                onChange={(event) => setToHide(event.target.value)}
              >
                <NativeSelectOption value="">{t('plan.days.hideWhich', locale)}</NativeSelectOption>
                {shown.map((day) => (
                  <NativeSelectOption key={day.key} value={day.key}>{t(day.nameKey, locale)}</NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="outline"
                disabled={pending || toHide === ''}
                onClick={async () => {
                  if (await saveProfile({ hiddenDays: [...hidden, toHide] })) setToHide('');
                }}
              >
                <EyeOff aria-hidden="true" />
                {t('plan.days.hide', locale)}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <FieldTitle>{t('plan.days.own', locale)}</FieldTitle>
          {ordered.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-foreground/10">
              {ordered.map((day) => (
                <li key={day.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{day.name}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(nextDate(day, today), locale)}</div>
                  </div>
                  {day.yearly && <Badge variant="secondary">{t('plan.days.everyYear', locale)}</Badge>}
                  <Button type="button" variant="ghost" size="icon-sm" disabled={pending} aria-label={t('plan.remove', locale)} onClick={() => removeDay(day)}>
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <Field>
              <FieldLabel htmlFor="plan-own-day-name">{t('plan.days.ownName', locale)}</FieldLabel>
              <Input
                id="plan-own-day-name"
                value={name}
                maxLength={LIMITS.name}
                aria-invalid={result?.field === 'name' || undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setResult(null);
                }}
              />
            </Field>
            <DateField
              value={date}
              resetKey={dateReset}
              label={t('plan.days.ownDate', locale)}
              words={{ choose: t('plan.days.chooseDay', locale), invalid: t('plan.days.dateInvalid', locale), failed: t('plan.days.dateInvalid', locale), saved: '' }}
              calendarLocale={locale === 'tr' ? tr : enUS}
              className="grid gap-2 text-sm [&>label]:text-sm [&>label]:font-medium [&>label]:text-foreground"
              onSave={(picked) => {
                setDate(picked);
                setResult(null);
                return picked;
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="plan-own-day-yearly" checked={yearly} onCheckedChange={(next) => setYearly(next === true)} />
              <Label htmlFor="plan-own-day-yearly">{t('plan.days.everyYear', locale)}</Label>
            </div>
            <Button type="button" variant="outline" disabled={pending || name.trim() === '' || date === ''} onClick={addDay}>
              <Plus aria-hidden="true" />
              {t('plan.days.add', locale)}
            </Button>
          </div>
        </div>
        <ResultLine locale={locale} result={result} />
      </CardContent>
    </Card>
  );
}
