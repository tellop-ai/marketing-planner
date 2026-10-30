'use client';

import { Check, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { formatDecimal, formatMonth } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { networkByKey } from '../../lib/plan/networks.js';
import { send } from '../send.js';

import { changeOf, changeText, readFollowers } from './rows.js';

/** A whole count in the reader's language. @param {number} value @param {string} locale */
const whole = (value, locale) => formatDecimal(String(Math.max(0, Math.trunc(value))), locale);

/**
 * "Followers this month": one number field for each switched-on platform.
 * Each saves itself when the person leaves it or presses Enter
 * (`PUT /api/followers`); an empty field removes the month's number. A
 * small check shows only after the app confirms; a refusal shows its words
 * and the field keeps what was typed (AGENTS.md rule 4a). Beside a number,
 * the change from last month when both months have one. After a save the
 * page reads again, so the counts line's followers follow. A person who may
 * not change the month's numbers (`canChange` false) reads them, with their
 * change, and nothing saves: the card shows only the platforms with a number.
 *
 * @param {{ locale: string, month: string, fields: Array<{ network: string, count: number | null, last: number | null }>, canChange?: boolean }} props
 */
export function FollowersRow({ locale, month, fields, canChange = false }) {
  const shown = canChange ? fields : fields.filter((field) => field.count !== null);
  if (shown.length === 0) return null;
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>{t('results.followers.title', locale, { month: formatMonth(month, locale) })}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-3">
          {shown.map((field) => (
            <li key={`${month}-${field.network}`} className="min-w-0">
              {canChange ? <FollowersField locale={locale} month={month} field={field} /> : <FollowersNumber locale={locale} field={field} />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** One platform's number to read, with its change from last month (nothing here saves). */
function FollowersNumber({ locale, field }) {
  const name = networkByKey(field.network)?.name ?? field.network;
  const change = changeOf(field.count, field.last);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="block min-w-0 truncate text-sm text-muted-foreground">{name}</span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="font-semibold">{whole(field.count ?? 0, locale)}</span>
        {change !== null && <span className="text-xs text-muted-foreground">{changeText(change, (value) => whole(value, locale))}</span>}
      </span>
    </div>
  );
}

/** @param {{ locale: string, month: string, field: { network: string, count: number | null, last: number | null } }} props */
function FollowersField({ locale, month, field }) {
  const router = useRouter();
  const [text, setText] = useState(field.count === null ? '' : String(field.count));
  const [kept, setKept] = useState(field.count);
  const [step, setStep] = useState(/** @type {'idle' | 'saving' | 'saved'} */ ('idle'));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const id = `followers-${field.network}`;
  const name = networkByKey(field.network)?.name ?? field.network;
  const change = changeOf(kept, field.last);

  async function save() {
    const read = readFollowers(text);
    if (!read.ok) {
      setStep('idle');
      setProblem('refuse.number');
      return;
    }
    if (read.value === kept) {
      setProblem(null);
      return;
    }
    setStep('saving');
    setProblem(null);
    const sent = await send('/api/followers', 'PUT', { month, network: field.network, count: read.value }, { unanswered: 'error.saveUnconfirmed' });
    if (!sent.ok || sent.value?.network !== field.network || (sent.value?.count ?? null) !== read.value) {
      setStep('idle');
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    setKept(read.value);
    setText(read.value === null ? '' : String(read.value));
    setStep('saved');
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="block min-w-0 truncate font-normal text-muted-foreground">{name}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={text}
          onValueChange={(next) => { setText(next); setStep('idle'); }}
          onBlur={save}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={problem !== null}
          aria-describedby={`${id}-status`}
          className="w-28 tabular-nums"
        />
        <span id={`${id}-status`} role="status" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
          {step === 'saving' && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
          {step === 'saved' && <><Check aria-hidden="true" className="size-3.5" /><span className="sr-only">{t('results.followers.saved', locale)}</span></>}
          {change !== null && <span>{changeText(change, (value) => whole(value, locale))}</span>}
        </span>
      </div>
      {problem && <p role="alert" className="text-xs text-destructive">{t(problem, locale)}</p>}
    </div>
  );
}
