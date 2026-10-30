'use client';

import { enUS, tr } from 'date-fns/locale';
import { CalendarPlus, Check, CircleCheck, Copy, Plus, Printer, Square, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateField } from '@/components/ui/date-field';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';

import { formatDate } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { PLAN_KINDS } from '../../lib/plan/campaign-plans.js';
import { LIMITS } from '../../lib/plan/limits.js';

import { shortDay } from './format.js';
import { colourOf, planAsk, planRest } from './rules.js';
import { NewPostButton } from '../new-post-button.jsx';
import { useRights } from '../rights.jsx';
import { sendUnconfirmed } from '../send.js';
import { PostTile, stateWords } from './tiles.jsx';

/**
 * The DateField's look in a form. A grid, not a flex column: the kit's
 * `label:not([data-slot])` rule gives a bare label `flex: 1 1 16rem`, which a
 * flex column turns into 16rem of height.
 */
const DATE_FIELD = 'grid content-start gap-2 text-sm font-medium [&_p]:text-xs [&_p]:font-normal [&_p]:text-destructive [&_p:empty]:hidden';

/** @param {string} locale */
function dateWords(locale) {
  return { choose: t('calendar.date.choose', locale), invalid: t('calendar.date.invalid', locale), failed: t('calendar.date.invalid', locale), saved: '' };
}

/** The most letters and digits an offer code holds. */
const CODE_MOST = 24;

/**
 * What Plan the posts says once the app confirmed it: how many posts it
 * added, the days it left out (each kind in one line, with the days) and an
 * AI problem when the names were written without AI. Each line is
 * `{ key, values?, quiet? }`; `quiet` lines are muted.
 *
 * @param {{ posts?: unknown[], skipped?: Array<{ day: string, reason: string }>, aiProblem?: string }} answer
 * @param {(day: string) => string} dayWords
 * @returns {Array<{ key: string, values?: Record<string, string>, quiet?: boolean }>}
 */
export function planResultLines(answer, dayWords) {
  const made = Array.isArray(answer?.posts) ? answer.posts.length : 0;
  const lines = [made === 0 ? { key: 'campaign.plan.none' } : made === 1 ? { key: 'campaign.plan.made.one' } : { key: 'campaign.plan.made', values: { count: String(made) } }];
  const skipped = Array.isArray(answer?.skipped) ? answer.skipped : [];
  for (const [reason, key] of [['taken', 'campaign.plan.skipped.taken'], ['remembrance', 'campaign.plan.skipped.quiet']]) {
    const days = skipped.filter((item) => item?.reason === reason).map((item) => dayWords(item.day));
    if (days.length > 0) lines.push({ key, values: { days: days.join(', ') } });
  }
  if (typeof answer?.aiProblem === 'string' && answer.aiProblem !== '') lines.push({ key: answer.aiProblem, quiet: true });
  return lines;
}

/** The day a new post of a campaign goes on: today while the campaign runs, else its first day. */
function newPostDay(campaign, today) {
  return today >= campaign.startsOn && today <= campaign.endsOn ? today : campaign.startsOn;
}

/**
 * What printing a campaign puts on paper: the campaign as its sheet shows it,
 * its steps and its posts.
 *
 * @typedef {{ campaign: { name: string, startsOn: string, endsOn: string, goal: string, offer: string, status: string },
 *   steps: Array<{ id: number, text: string, done: boolean }>, posts: object[] }} CampaignPaper
 */

/**
 * A campaign in a sheet: its name, days, goal, offer and offer code (saved
 * with Save; a saved code has Copy), its steps (done marks, add, remove),
 * **Plan the posts** (launch, event or sale: dated idea posts across its days
 * left, then a line that says what was added and skipped), all its posts as
 * tiles, **New post in this campaign**, **Print this campaign** and Remove
 * campaign (asked once). It reads the campaign, its steps and its posts when
 * it opens (a read only).
 *
 * The sheet itself never prints: Print this campaign hands the campaign to
 * the calendar (`onPrint`), which prints it as a page (`CampaignPrint`).
 *
 * @param {{ locale: string, today: string, campaignId: number | null, onClose: () => void,
 *   colours: Map<number, number>, business: string, onPrint: (paper: CampaignPaper) => void }} props
 */
export function CampaignSheet({ locale, today, campaignId, onClose, colours, business, onPrint }) {
  return (
    <Sheet open={campaignId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        data-print-hidden
        className="max-h-dvh w-full sm:max-w-md print:[[data-slot=sheet-overlay]:has(~&)]:hidden"
      >
        {campaignId !== null && (
          <CampaignBody
            key={campaignId}
            locale={locale}
            today={today}
            campaignId={campaignId}
            colours={colours}
            business={business}
            onClose={onClose}
            onPrint={onPrint}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CampaignBody({ locale, today, campaignId, colours, business, onClose, onPrint }) {
  const [found, setFound] = useState(/** @type {{ campaign: any, steps: any[], posts: any[] } | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    let live = true;
    sendUnconfirmed(`/api/campaigns/${campaignId}`, 'GET').then((answer) => {
      if (!live) return;
      if (answer.ok && answer.value?.campaign) {
        const { campaign, steps, posts } = answer.value;
        setFound({ campaign, steps: Array.isArray(steps) ? steps : [], posts: Array.isArray(posts) ? posts : [] });
      } else {
        setProblem(answer.ok ? 'error.storageUnreadable' : answer.problem);
      }
    });
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (!found) {
    return (
      <>
        <SheetHeader className="pr-12">
          <SheetTitle>{t('calendar.campaign.title', locale)}</SheetTitle>
        </SheetHeader>
        <div className="px-4">
          {problem ? <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p> : <Spinner className="text-muted-foreground" />}
        </div>
      </>
    );
  }
  return (
    <CampaignDetails
      locale={locale}
      today={today}
      campaign={found.campaign}
      steps={found.steps}
      posts={found.posts}
      colours={colours}
      business={business}
      onChange={(campaign) => setFound((before) => (before ? { ...before, campaign } : before))}
      onSteps={(steps) => setFound((before) => (before ? { ...before, steps } : before))}
      onPosts={(posts) => setFound((before) => (before ? { ...before, posts } : before))}
      onClose={onClose}
      onPrint={onPrint}
    />
  );
}

/**
 * One campaign in its sheet. Who is here (`useRights`): a person who may
 * change it gets its fields with Save, the done marks, step removal and
 * Remove; a person who may add gets new steps, Plan the posts and New post
 * (a Member through New post's window, `NewPostButton`); everyone reads the
 * fields, copies the code and prints.
 */
export function CampaignDetails({ locale, today, campaign, steps, posts, colours, business, onChange, onSteps, onPosts = () => {}, onClose, onPrint }) {
  const router = useRouter();
  const { add: canAdd, change: canChange } = useRights();
  const id = useId();
  const [fields, setFields] = useState({ name: campaign.name, startsOn: campaign.startsOn, endsOn: campaign.endsOn, goal: campaign.goal, offer: campaign.offer, code: campaign.code ?? '' });
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(/** @type {{ saved?: boolean, problem?: string } | null} */ (null));
  const [making, setMaking] = useState(false);
  const [makeProblem, setMakeProblem] = useState(/** @type {string | null} */ (null));
  const [removing, setRemoving] = useState(false);
  const [removeProblem, setRemoveProblem] = useState(/** @type {string | null} */ (null));
  const [busyRemove, setBusyRemove] = useState(false);

  /** @param {string} name @param {string} value */
  function edit(name, value) {
    setFields((before) => ({ ...before, [name]: value }));
    setResult(null);
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setResult(null);
    const sent = await sendUnconfirmed(`/api/campaigns/${campaign.id}`, 'PATCH', fields);
    setSaving(false);
    if (!sent.ok || !sent.value?.campaign) {
      setResult({ problem: sent.ok ? 'error.saveUnconfirmed' : sent.problem });
      return;
    }
    onChange(sent.value.campaign);
    // The code comes back in capitals, as it is kept.
    setFields((before) => ({ ...before, code: sent.value.campaign.code ?? '' }));
    setResult({ saved: true });
    router.refresh();
  }

  function copyCode() {
    setCopied(false);
    try {
      navigator.clipboard?.writeText(campaign.code)?.then(() => setCopied(true), () => setCopied(false));
    } catch {
      setCopied(false);
    }
  }

  async function newPost() {
    setMaking(true);
    setMakeProblem(null);
    const sent = await sendUnconfirmed('/api/posts', 'POST', { campaignId: campaign.id, day: newPostDay(campaign, today) });
    if (!sent.ok || typeof sent.value?.post?.id !== 'number') {
      setMakeProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      setMaking(false);
      return;
    }
    router.push(`/posts/${sent.value.post.id}`);
  }

  async function remove() {
    setBusyRemove(true);
    setRemoveProblem(null);
    const sent = await sendUnconfirmed(`/api/campaigns/${campaign.id}`, 'DELETE');
    setBusyRemove(false);
    if (!sent.ok) {
      setRemoveProblem(sent.problem);
      return;
    }
    setRemoving(false);
    onClose();
    router.refresh();
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="break-words">{campaign.name}</SheetTitle>
        <p className="text-sm text-muted-foreground">
          {formatDate(campaign.startsOn, locale)} – {formatDate(campaign.endsOn, locale)} · {t(`campaign.status.${campaign.status}`, locale)}
        </p>
      </SheetHeader>
      <div className="-mt-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4">
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{t('campaign.name', locale)}</FieldLabel>
            <Input id={`${id}-name`} value={fields.name} onValueChange={(value) => edit('name', value)} maxLength={LIMITS.name} required autoComplete="off" disabled={!canChange} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              id={`${id}-starts`}
              className={DATE_FIELD}
              label={t('campaign.startsOn', locale)}
              value={fields.startsOn}
              disabled={!canChange}
              onSave={(next) => { edit('startsOn', next); return next; }}
              words={dateWords(locale)}
              calendarLocale={locale === 'tr' ? tr : enUS}
            />
            <DateField
              id={`${id}-ends`}
              className={DATE_FIELD}
              label={t('campaign.endsOn', locale)}
              value={fields.endsOn}
              disabled={!canChange}
              onSave={(next) => { edit('endsOn', next); return next; }}
              words={dateWords(locale)}
              calendarLocale={locale === 'tr' ? tr : enUS}
            />
          </div>
          <Field>
            <FieldLabel htmlFor={`${id}-goal`}>{t('campaign.goal', locale)}</FieldLabel>
            <Input id={`${id}-goal`} value={fields.goal} onValueChange={(value) => edit('goal', value)} maxLength={LIMITS.profileField} autoComplete="off" disabled={!canChange} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-offer`}>{t('campaign.offer', locale)}</FieldLabel>
            <Input id={`${id}-offer`} value={fields.offer} onValueChange={(value) => edit('offer', value)} maxLength={LIMITS.profileField} autoComplete="off" disabled={!canChange} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-code`}>{t('campaign.code', locale)}</FieldLabel>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                id={`${id}-code`}
                value={fields.code}
                onValueChange={(value) => { edit('code', value); setCopied(false); }}
                maxLength={CODE_MOST}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1"
                disabled={!canChange}
              />
              {campaign.code !== '' && fields.code === campaign.code && (
                <Button type="button" variant="outline" onClick={copyCode} aria-label={copied ? t('campaign.codeCopied', locale) : t('campaign.copyCode', locale)}>
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  <span className="max-sm:sr-only">{copied ? t('campaign.codeCopied', locale) : t('campaign.copyCode', locale)}</span>
                </Button>
              )}
            </div>
          </Field>
          {canChange && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" disabled={saving || fields.name.trim() === ''}>{t('campaign.save', locale)}</Button>
              {result?.saved && (
                <p role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CircleCheck aria-hidden="true" className="size-4" />
                  {t('campaign.saved', locale)}
                </p>
              )}
              {result?.problem && <p role="alert" className="text-sm text-destructive">{t(result.problem, locale)}</p>}
            </div>
          )}
        </form>
        <Steps locale={locale} campaignId={campaign.id} steps={steps} onSteps={onSteps} canAdd={canAdd} canChange={canChange} />
        {canAdd && (
          <PlanPosts
            locale={locale}
            today={today}
            campaign={campaign}
            rest={planRest(campaign, fields)}
            onPosts={(next) => {
              onPosts(next);
              router.refresh();
            }}
          />
        )}
        {posts.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t('campaign.posts', locale)}</h3>
            <ul className="flex flex-col gap-2">
              {posts.map((tile) => (
                <li key={tile.id}>
                  <PostTile tile={tile} colour={colourOf(tile.themeId, colours)} business={business} locale={locale} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <SheetFooter>
        {makeProblem && <p role="alert" className="text-xs text-destructive">{t(makeProblem, locale)}</p>}
        {canChange && (
          <Button type="button" disabled={making} onClick={newPost}>
            <Plus aria-hidden="true" />
            {t('calendar.campaign.newPost', locale)}
          </Button>
        )}
        {canAdd && !canChange && (
          <NewPostButton locale={locale} day={newPostDay(campaign, today)} extra={{ campaignId: campaign.id }} label={t('calendar.campaign.newPost', locale)} />
        )}
        <Button type="button" variant="outline" onClick={() => onPrint({ campaign: { ...campaign, ...fields }, steps, posts })}>
          <Printer aria-hidden="true" />
          {t('campaign.print', locale)}
        </Button>
        {canChange && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setRemoving(true)}>
            <Trash2 aria-hidden="true" />
            {t('campaign.remove', locale)}
          </Button>
        )}
      </SheetFooter>
      <AlertDialog open={removing} onOpenChange={(open) => { if (!open) { setRemoving(false); setRemoveProblem(null); } }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">{t('campaign.removeAsk', locale)}</AlertDialogTitle>
          </AlertDialogHeader>
          {removeProblem && <p role="alert" className="text-sm text-destructive">{t(removeProblem, locale)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyRemove}>{t('calendar.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busyRemove} onClick={remove}>{t('campaign.remove', locale)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * A campaign on paper, from the sheet's Print this campaign: its name, days
 * and state, goal and offer as the sheet shows them, its steps with their done
 * marks, and its posts (day, name, state). Shown only when printing; the
 * calendar hides the rest of its page then.
 *
 * @param {{ locale: string, paper: CampaignPaper }} props
 */
export function CampaignPrint({ locale, paper }) {
  const { campaign, steps, posts } = paper;
  return (
    <section className="hidden flex-col gap-5 print:flex">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{campaign.name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(campaign.startsOn, locale)} – {formatDate(campaign.endsOn, locale)} · {t(`campaign.status.${campaign.status}`, locale)}
        </p>
      </div>
      {(campaign.goal !== '' || campaign.offer !== '' || (campaign.code ?? '') !== '') && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {campaign.goal !== '' && (
            <>
              <dt className="text-muted-foreground">{t('campaign.goal', locale)}</dt>
              <dd className="whitespace-pre-line">{campaign.goal}</dd>
            </>
          )}
          {campaign.offer !== '' && (
            <>
              <dt className="text-muted-foreground">{t('campaign.offer', locale)}</dt>
              <dd className="whitespace-pre-line">{campaign.offer}</dd>
            </>
          )}
          {(campaign.code ?? '') !== '' && (
            <>
              <dt className="text-muted-foreground">{t('campaign.code', locale)}</dt>
              <dd>{campaign.code}</dd>
            </>
          )}
        </dl>
      )}
      {steps.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold">{t('campaign.steps', locale)}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {steps.map((step) => {
              const Mark = step.done ? Check : Square;
              return (
                <li key={step.id} className="flex items-start gap-2">
                  <Mark aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className={step.done ? 'text-muted-foreground line-through' : undefined}>{step.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {posts.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold">{t('campaign.posts', locale)}</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {posts.map((post) => (
              <li key={post.id} className="flex break-inside-avoid items-baseline gap-3 py-1.5">
                <span className="w-24 shrink-0 text-muted-foreground">{post.day ? shortDay(post.day, locale) : t('state.idea', locale)}</span>
                <span className="min-w-0 flex-1 font-medium">{post.name || t('post.untitled', locale)}</span>
                <span className="shrink-0 text-muted-foreground">
                  {stateWords(post, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/**
 * Plan the posts: Launch, Event and Sale, each a press that first asks one
 * yes or no ("Add up to 6 posts to the calendar?", `planAsk`); on yes it adds
 * the kind's dated idea posts across the campaign's days left (`POST
 * /api/campaigns/[id]/plan`); once the app confirms, a line says what was
 * added and which days were skipped, and the sheet reads its posts again.
 * The three presses rest, with the reason under them (`rest`, `planRest`),
 * while the campaign is done or while the dates in the form are not saved.
 *
 * @param {{ locale: string, today: string, campaign: { id: number, status: string, startsOn: string, endsOn: string }, rest: string | null,
 *   onPosts: (posts: any[]) => void }} props
 */
function PlanPosts({ locale, today, campaign, rest, onPosts }) {
  const [working, setWorking] = useState(/** @type {string | null} */ (null));
  const [asking, setAsking] = useState(/** @type {string | null} */ (null));
  const [lines, setLines] = useState(/** @type {ReturnType<typeof planResultLines> | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const ask = asking === null ? null : planAsk(asking, campaign, today);

  /** @param {string} kind */
  async function plan(kind) {
    setAsking(null);
    if (working !== null || rest !== null) return;
    setWorking(kind);
    setLines(null);
    setProblem(null);
    const sent = await sendUnconfirmed(`/api/campaigns/${campaign.id}/plan`, 'POST', { kind });
    if (!sent.ok || !Array.isArray(sent.value?.posts)) {
      setWorking(null);
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    setLines(planResultLines(sent.value, (day) => shortDay(day, locale)));
    // The sheet's posts as the app now holds them (the tiles show the new ones).
    const read = await sendUnconfirmed(`/api/campaigns/${campaign.id}`, 'GET');
    setWorking(null);
    if (read.ok && Array.isArray(read.value?.posts)) onPosts(read.value.posts);
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t('campaign.plan.title', locale)}</h3>
      <div className="flex flex-wrap gap-2">
        {PLAN_KINDS.map((kind) => (
          <Button
            key={kind}
            type="button"
            variant="outline"
            disabled={rest !== null || working !== null}
            onClick={() => { setLines(null); setProblem(null); setAsking(kind); }}
          >
            {working === kind ? <Spinner aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
            {t(`campaign.plan.kind.${kind}`, locale)}
          </Button>
        ))}
      </div>
      {rest !== null && <p className="text-sm text-muted-foreground">{t(rest, locale)}</p>}
      <AlertDialog open={asking !== null && rest === null} onOpenChange={(open) => { if (!open) setAsking(null); }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">{ask ? t(ask.key, locale, ask.values) : ''}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('calendar.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (asking !== null) plan(asking); }}>{t('campaign.plan.yes', locale)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {lines && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {lines.map((line) => (
            <p key={line.key} className={line.quiet ? 'text-xs text-muted-foreground' : 'break-words'}>{t(line.key, locale, line.values)}</p>
          ))}
        </div>
      )}
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
    </section>
  );
}

/**
 * A campaign's steps: a done mark each, remove, and one line to add a step.
 * `canChange`: the done marks press and steps can be removed (else the marks
 * only show); `canAdd`: the line to add a step. A Viewer sees the steps alone,
 * and nothing at all while there are none.
 */
function Steps({ locale, campaignId, steps, onSteps, canAdd, canChange }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function add(event) {
    event.preventDefault();
    if (busy || text.trim() === '') return;
    setBusy(true);
    setProblem(null);
    const sent = await sendUnconfirmed(`/api/campaigns/${campaignId}/steps`, 'POST', { text });
    setBusy(false);
    if (!sent.ok || !sent.value?.step) {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    onSteps([...steps, sent.value.step]);
    setText('');
  }

  /** @param {{ id: number }} step @param {boolean} done */
  async function mark(step, done) {
    setProblem(null);
    const sent = await sendUnconfirmed(`/api/campaign-steps/${step.id}`, 'PATCH', { done });
    if (!sent.ok || !sent.value?.step) {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    onSteps(steps.map((item) => (item.id === step.id ? sent.value.step : item)));
  }

  /** @param {{ id: number }} step */
  async function drop(step) {
    setProblem(null);
    const sent = await sendUnconfirmed(`/api/campaign-steps/${step.id}`, 'DELETE');
    if (!sent.ok) {
      setProblem(sent.problem);
      return;
    }
    onSteps(steps.filter((item) => item.id !== step.id));
  }

  if (!canAdd && steps.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t('campaign.steps', locale)}</h3>
      {steps.length > 0 && (
        <ul className="flex flex-col gap-1">
          {steps.map((step) => (
            <li key={step.id} className="flex min-w-0 items-center gap-2">
              <Checkbox checked={step.done} disabled={!canChange} onCheckedChange={(on) => mark(step, on === true)} aria-label={step.text} />
              <span className={step.done ? 'min-w-0 flex-1 break-words text-muted-foreground line-through' : 'min-w-0 flex-1 break-words'}>{step.text}</span>
              {canChange && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('calendar.campaign.removeStep', locale)} onClick={() => drop(step)}>
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && steps.length < LIMITS.campaignSteps && (
        <form onSubmit={add} className="flex items-center gap-2">
          <Input id={`${id}-step`} aria-label={t('campaign.addStep', locale)} value={text} onValueChange={setText} maxLength={LIMITS.campaignStep} autoComplete="off" />
          <Button type="submit" variant="outline" disabled={busy || text.trim() === ''}>{t('calendar.add', locale)}</Button>
        </form>
      )}
      {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
    </section>
  );
}

/**
 * New campaign: a name and its first and last day. Once the app confirms, the
 * campaign opens in its sheet. Closing the window forgets the draft.
 *
 * @param {{ locale: string, today: string, open: boolean, onOpenChange: (open: boolean) => void, onCreated: (id: number) => void }} props
 */
export function NewCampaignDialog({ locale, today, open, onOpenChange, onCreated }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t('campaign.new', locale)}</DialogTitle>
        </DialogHeader>
        {open && <NewCampaignForm locale={locale} today={today} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignForm({ locale, today, onCreated }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function create(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setProblem(null);
    const sent = await sendUnconfirmed('/api/campaigns', 'POST', { name, startsOn, endsOn });
    setPending(false);
    if (!sent.ok || typeof sent.value?.campaign?.id !== 'number') {
      setProblem(sent.ok ? 'error.saveUnconfirmed' : sent.problem);
      return;
    }
    router.refresh();
    onCreated(sent.value.campaign.id);
  }

  return (
    <form onSubmit={create} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>{t('campaign.name', locale)}</FieldLabel>
          <Input id={`${id}-name`} value={name} onValueChange={setName} maxLength={LIMITS.name} required autoComplete="off" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            id={`${id}-starts`}
            className={DATE_FIELD}
            label={t('campaign.startsOn', locale)}
            value={startsOn}
            onSave={(next) => { setStartsOn(next); return next; }}
            words={dateWords(locale)}
            calendarLocale={locale === 'tr' ? tr : enUS}
          />
          <DateField
            id={`${id}-ends`}
            className={DATE_FIELD}
            label={t('campaign.endsOn', locale)}
            value={endsOn}
            onSave={(next) => { setEndsOn(next); return next; }}
            words={dateWords(locale)}
            calendarLocale={locale === 'tr' ? tr : enUS}
          />
        </div>
        {problem && <p role="alert" className="text-sm text-destructive">{t(problem, locale)}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || name.trim() === ''}>{t('calendar.campaign.create', locale)}</Button>
      </DialogFooter>
    </form>
  );
}
