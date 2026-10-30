'use client';

import { CircleCheck, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { printPage } from '../posts/print-light.js';

import { CampaignPrint, CampaignSheet, NewCampaignDialog } from './campaigns.jsx';
import { DaySheet } from './day-sheet.jsx';
import { FillMonthDialog } from './fill-month.jsx';
import { FollowUpsList } from './follow-ups-list.jsx';
import { CalendarHeader } from './header.jsx';
import { IdeasRow } from './ideas-row.jsx';
import { MonthGrid } from './month-grid.jsx';
import { CalendarFileLine, useCalendarFile } from './calendar-file.jsx';
import { useRights } from '../rights.jsx';
import { calendarFileRest, colourOf, coloursOf, mixOf, proposalsFor } from './rules.js';
import { sendUnconfirmed } from '../send.js';
import { TodayCard } from './today-card.jsx';
import { WeekView } from './week-view.jsx';

/**
 * The calendar, the app's first page: the top line, the Share today card,
 * the month (or the week), the ideas row, and the day, campaign and Fill my
 * month windows. Everything it shows was read once by the page
 * (`app/calendar/read.js`); a change is sent to its address and the page then
 * reads again (`router.refresh()`).
 *
 * Fill my month's proposals live only here until **Keep these** sends them;
 * **Remove** forgets them, and so does going to another month.
 *
 * Print this campaign (in a campaign's sheet) prints the campaign as a page
 * of its own: while it prints, the calendar's own parts stay off the paper.
 *
 * Who is here (`useRights`): a person who may add gets Fill my month, New
 * campaign, Add to my calendar and the new posts and ideas; only one who may
 * change gets the start card that leads to My plan and the presses that
 * change a kept post, follow-up or campaign. A Viewer reads, prints and opens.
 *
 * @param {{ locale: string } & Awaited<ReturnType<typeof import('./read.js').readCalendar>>} props
 */
export function CalendarView(props) {
  const { locale, view, today, business, networks, perWeek, themes, archivedThemes, tiles, ideas, moreIdeas, campaigns, specialDays, due, goal, followUps, firstVisit } = props;
  const router = useRouter();
  const rights = useRights();
  const colours = useMemo(() => coloursOf([...archivedThemes, ...themes]), [themes, archivedThemes]);
  const [openDay, setOpenDay] = useState(/** @type {string | null} */ (null));
  const [campaignId, setCampaignId] = useState(/** @type {number | null} */ (null));
  const [newCampaign, setNewCampaign] = useState(false);
  const [filling, setFilling] = useState(false);
  const [proposed, setProposed] = useState(/** @type {{ month: string, madeBy: 'ai' | 'person', proposals: any[] } | null} */ (null));
  const [keeping, setKeeping] = useState(false);
  const [keepResult, setKeepResult] = useState(/** @type {{ kept?: number, problem?: string } | null} */ (null));
  const [printing, setPrinting] = useState(/** @type {import('./campaigns.jsx').CampaignPaper | null} */ (null));
  const proposals = proposalsFor(proposed, view.month);
  const calendarFile = useCalendarFile(locale, view);

  // Another month: the proposals made for the one before are forgotten, and
  // with them the line about the last Keep these.
  useEffect(() => {
    setProposed((before) => (before !== null && before.month !== view.month ? null : before));
    setKeepResult(null);
  }, [view.month]);

  // A campaign to print: the page holds it now (`CampaignPrint`), so print,
  // then give the calendar back to the paper.
  useEffect(() => {
    if (printing === null) return undefined;
    let live = true;
    const done = () => {
      if (live) setPrinting(null);
    };
    window.addEventListener('afterprint', done);
    void printPage();
    return () => {
      live = false;
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  async function keep() {
    if (!proposed || keeping) return;
    setKeeping(true);
    setKeepResult(null);
    const sent = await sendUnconfirmed('/api/month/keep', 'POST', proposed);
    setKeeping(false);
    if (!sent.ok || !Array.isArray(sent.value?.posts)) {
      setKeepResult({ problem: sent.ok ? 'error.saveUnconfirmed' : sent.problem });
      return;
    }
    setProposed(null);
    setKeepResult({ kept: sent.value.posts.length });
    router.refresh();
  }

  return (
    <>
      {printing && <CampaignPrint locale={locale} paper={printing} />}
      <div className={cn('contents', printing && 'print:hidden')}>
        <CalendarHeader
          locale={locale}
          today={today}
          view={view}
          onFill={() => setFilling(true)}
          onNewCampaign={() => setNewCampaign(true)}
          onAddToCalendar={calendarFile.start}
          fileRest={calendarFileRest(view, tiles)}
          fileMaking={calendarFile.step === 'making'}
          mix={mixOf(view, tiles, [...themes, ...archivedThemes])}
          canAdd={rights.add}
        />
        <CalendarFileLine locale={locale} file={calendarFile} />
        {firstVisit && rights.change && (
          <Card data-print-hidden className="py-3">
            <div className="flex flex-wrap items-center gap-3 px-3">
              <Target aria-hidden="true" className="size-5 text-muted-foreground" />
              <span className="font-medium">{t('calendar.start', locale)}</span>
              <Link href="/plan" className={cn(buttonVariants(), 'sm:ml-auto')}>{t('menu.plan', locale)}</Link>
            </div>
          </Card>
        )}
        {goal && !firstVisit && (
          <TodayCard locale={locale} today={today} due={due} colour={colourOf(due?.themeId, colours)} goal={goal} business={business} followUps={followUps} />
        )}
        {firstVisit && Array.isArray(followUps) && followUps.length > 0 && (
          <Card data-print-hidden className="py-2.5">
            <FollowUpsList locale={locale} today={today} business={business} followUps={followUps} className="px-3" />
          </Card>
        )}
        {proposals.length > 0 && (
          <div data-print-hidden className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
            <Sparkles aria-hidden="true" className="size-4 text-primary" />
            <span className="font-medium">{t('month.proposals.count', locale, { count: String(proposals.length) })}</span>
            {keepResult?.problem && <span role="alert" className="text-destructive">{t(keepResult.problem, locale)}</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button type="button" variant="ghost" disabled={keeping} onClick={() => { setProposed(null); setKeepResult(null); }}>
                {t('month.proposals.remove', locale)}
              </Button>
              <Button type="button" disabled={keeping} onClick={keep}>{t('month.proposals.keep', locale)}</Button>
            </div>
          </div>
        )}
        {proposals.length === 0 && keepResult?.kept !== undefined && (
          <p data-print-hidden role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <CircleCheck aria-hidden="true" className="size-4" />
            {t('month.proposals.kept', locale, { count: String(keepResult.kept) })}
          </p>
        )}
        {view.kind === 'month' ? (
          <MonthGrid
            locale={locale}
            today={today}
            cells={view.cells}
            tiles={tiles}
            proposals={proposals}
            specialDays={specialDays}
            campaigns={campaigns}
            colours={colours}
            business={business}
            onOpenDay={setOpenDay}
            onOpenCampaign={setCampaignId}
          />
        ) : (
          <WeekView
            locale={locale}
            today={today}
            days={view.days}
            tiles={tiles}
            proposals={proposals}
            specialDays={specialDays}
            colours={colours}
            business={business}
            onOpenDay={setOpenDay}
          />
        )}
        <IdeasRow locale={locale} month={view.month} ideas={ideas} more={moreIdeas} themes={themes} colours={colours} />
      </div>
      <DaySheet
        locale={locale}
        day={openDay}
        tiles={tiles}
        proposals={proposals}
        specialDays={specialDays}
        colours={colours}
        business={business}
        onClose={() => setOpenDay(null)}
      />
      <CampaignSheet
        locale={locale}
        today={today}
        campaignId={campaignId}
        onClose={() => {
          setCampaignId(null);
          setPrinting(null);
        }}
        colours={colours}
        business={business}
        onPrint={setPrinting}
      />
      <NewCampaignDialog
        locale={locale}
        today={today}
        open={newCampaign}
        onOpenChange={setNewCampaign}
        onCreated={(id) => {
          setNewCampaign(false);
          setCampaignId(id);
        }}
      />
      <FillMonthDialog
        locale={locale}
        open={filling}
        onOpenChange={setFilling}
        month={view.month}
        perWeek={perWeek}
        themes={themes}
        networks={networks}
        onProposals={({ proposals: found, madeBy }) => {
          setKeepResult(null);
          setProposed({ month: view.month, madeBy, proposals: found });
        }}
      />
    </>
  );
}
