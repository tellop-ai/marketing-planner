'use client';

import { enUS, tr } from 'date-fns/locale';
import {
  ArrowLeft,
  CalendarClock,
  CalendarIcon,
  CircleCheck,
  CircleDashed,
  Ellipsis,
  Globe,
  Hand,
  Lightbulb,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Phone,
  Printer,
  Repeat2,
  Share2,
  ShoppingBag,
  Ticket,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { ASKS, askOf } from '../../../lib/plan/asks.js';
import { LIMITS } from '../../../lib/plan/limits.js';
import { networkByKey } from '../../../lib/plan/networks.js';

import { themeBackground } from '../../theme-colours.js';

import { BestTimeHint } from './best-time-hint.jsx';
import { campaignChoices, dateOfDay, dayOfDate, dayText, readTimeText, stateWordsOf, timeText } from './rules.js';
import { send } from '../../send.js';
import { postAddress, versionAddress } from './addresses.js';
import { PostAgainDialog } from './post-again.jsx';

const STATE_ICONS = Object.freeze({ idea: Lightbulb, draft: CircleDashed, ready: CircleCheck, partly: CircleCheck, scheduled: CalendarClock, shared: CircleCheck });

/** Each ask's mark. */
const ASK_ICONS = Object.freeze({ message: MessageCircle, book: Ticket, buy: ShoppingBag, visit: Globe, call: Phone, comment: MessageSquare });

/**
 * The post maker's top line, as drawn: back to the calendar, the post's name
 * (a press renames it), the day and time chip, the theme chip, the ask chip
 * (what the post asks its readers to do), the state the
 * app works out, and the "⋯" menu (campaign, the networks this post goes to,
 * print, Post again, delete). Every change is saved by its own press and shown only once
 * the app confirms it. `askNote`: the ask changed on a post whose words were
 * made before, so a line under the header says that Make my post adds it.
 *
 * @param {{
 *   locale: string, post: any, themes: { id: number, name: string, colour: number, archived: boolean }[],
 *   campaigns: { id: number, name: string, status: string }[], networks: string[], postNetworks: string[],
 *   state: { state: string, shared: number, of: number }, today: string,
 *   onPost: (post: any, changed: { theme?: boolean, ask?: boolean, moment?: boolean }) => void, onVersion: (version: any) => void, onPrint: () => void,
 *   askNote?: boolean,
 * }} props
 */
export function MakerHeader({ locale, post, themes, campaigns, networks, postNetworks, state, today, onPost, onVersion, onPrint, askNote = false, bestTimes = null }) {
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [again, setAgain] = useState(false);

  /** Saves post fields; answers whether the app confirmed them. */
  async function save(fields) {
    setProblem(null);
    setWorking(true);
    try {
      const answer = await send(postAddress(post.id), 'PATCH', fields);
      if (!answer.ok || !answer.value?.post) {
        setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
        return false;
      }
      onPost(answer.value.post, {
        theme: Object.hasOwn(fields, 'themeId') && fields.themeId !== post.themeId,
        ask: Object.hasOwn(fields, 'ask') && askOf(fields.ask) !== askOf(post.ask),
        moment: Object.hasOwn(fields, 'day') || Object.hasOwn(fields, 'time'),
      });
      return true;
    } finally {
      setWorking(false);
    }
  }

  async function switchNetwork(network, on) {
    setProblem(null);
    setWorking(true);
    try {
      const answer = await send(versionAddress(post.id, network), 'PUT', { on });
      if (!answer.ok || !answer.value?.version) {
        setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
        return;
      }
      onVersion(answer.value.version);
    } finally {
      setWorking(false);
    }
  }

  const theme = themes.find((item) => item.id === post.themeId) ?? null;
  const words = stateWordsOf(state);
  const StateIcon = STATE_ICONS[words.mark] ?? CircleDashed;
  const stateWords = t(words.key, locale, words.values);

  return (
    <div data-print-hidden className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-3">
        <a href="/" aria-label={t('maker.back', locale)} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft aria-hidden="true" />
        </a>
        <PostName locale={locale} name={post.name} working={working} onSave={(name) => save({ name })} />
        <WhenChip locale={locale} day={post.day} time={post.time} today={today} working={working} onSave={save} networks={postNetworks} bestTimes={bestTimes} />
        <ThemeChip locale={locale} theme={theme} themes={themes} working={working} onSave={(themeId) => save({ themeId })} />
        <AskChip locale={locale} ask={askOf(post.ask)} working={working} onSave={(ask) => save({ ask })} />
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1 rounded-4xl bg-secondary px-2.5 text-xs font-medium whitespace-nowrap text-secondary-foreground">
            <StateIcon aria-hidden="true" className="size-3.5" />
            {stateWords}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t('maker.menu', locale)} disabled={working} />}>
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-48">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Megaphone aria-hidden="true" />
                  {t('maker.campaign', locale)}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-w-72">
                  <DropdownMenuRadioGroup
                    value={post.campaignId === null ? 'none' : String(post.campaignId)}
                    onValueChange={(value) => save({ campaignId: value === 'none' ? null : Number(value) })}
                  >
                    <DropdownMenuRadioItem value="none">{t('maker.noCampaign', locale)}</DropdownMenuRadioItem>
                    {campaignChoices(campaigns, post.campaignId).map((campaign) => (
                      <DropdownMenuRadioItem key={campaign.id} value={String(campaign.id)}>
                        <span className="truncate">{campaign.name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {networks.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Share2 aria-hidden="true" />
                    {t('maker.networks', locale)}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {networks.map((network) => {
                      const on = postNetworks.includes(network);
                      return (
                        <DropdownMenuCheckboxItem
                          key={network}
                          checked={on}
                          disabled={on && postNetworks.length === 1}
                          onCheckedChange={(next) => switchNetwork(network, next === true)}
                        >
                          {networkByKey(network)?.name ?? network}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuItem onClick={onPrint}>
                <Printer aria-hidden="true" />
                {t('maker.print', locale)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAgain(true)}>
                <Repeat2 aria-hidden="true" />
                {t('maker.again', locale)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                {t('maker.delete', locale)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {askNote && <p role="status" className="text-sm text-muted-foreground">{t('maker.askMakeAgain', locale)}</p>}
      {problem !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(problem, locale)}
        </p>
      )}
      <DeletePost locale={locale} postId={post.id} open={deleting} onClose={() => setDeleting(false)} />
      <PostAgainDialog locale={locale} postId={post.id} today={today} open={again} onClose={() => setAgain(false)} />
    </div>
  );
}

/** The post's name; a press turns it into a field that saves on Enter or on leaving it (Escape keeps the old name). */
function PostName({ locale, name, working, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  async function finish(keep) {
    const value = draft.trim();
    if (!keep || value === name) {
      setEditing(false);
      setDraft(name);
      return;
    }
    if (await onSave(value)) setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        maxLength={LIMITS.name}
        disabled={working}
        aria-label={t('maker.name', locale)}
        placeholder={t('post.untitled', locale)}
        onValueChange={setDraft}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          }
        }}
        className="h-9 w-full max-w-md min-w-0 text-xl font-semibold md:text-xl"
      />
    );
  }
  return (
    <h1 className="-mx-1 min-w-0 text-xl font-semibold">
      <Button
        type="button"
        variant="ghost"
        title={t('maker.rename', locale)}
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="h-9 max-w-full px-1 text-xl font-semibold"
      >
        <span className={cn('truncate', name === '' && 'text-muted-foreground')}>{name || t('post.untitled', locale)}</span>
      </Button>
    </h1>
  );
}

/** The day and time chip: the kit's calendar, a time field (`HH:MM`) and Clear, in a popover. */
function WhenChip({ locale, day, time, today, working, onSave, networks = [], bestTimes = null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(time ?? '');
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const timeId = useId();

  const label = day
    ? (time ? t('maker.when', locale, { day: dayText(day, locale, today), time: timeText(time, locale) }) : dayText(day, locale, today))
    : t('maker.pickDay', locale);

  async function saveTime() {
    const read = readTimeText(draft);
    if (!read.ok) {
      setProblem('refuse.post.time');
      return;
    }
    setProblem(null);
    if (read.value === time) {
      setDraft(time ?? '');
      return;
    }
    if (await onSave({ time: read.value })) setDraft(read.value ?? '');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setDraft(time ?? '');
        setProblem(null);
      }}
    >
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1.5 font-normal" disabled={working} />}>
        <CalendarIcon aria-hidden="true" className="text-muted-foreground" />
        <span className={cn(!day && 'text-muted-foreground')}>{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <Calendar
          mode="single"
          required
          selected={dateOfDay(day)}
          defaultMonth={dateOfDay(day) ?? dateOfDay(today)}
          locale={locale === 'tr' ? tr : enUS}
          onSelect={(date) => {
            const picked = dayOfDate(date);
            if (picked !== null && picked !== day) onSave({ day: picked });
          }}
        />
        <div className="flex items-end gap-2 px-2 pb-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={timeId}>{t('maker.time', locale)}</Label>
            <Input
              id={timeId}
              value={draft}
              inputMode="numeric"
              autoComplete="off"
              placeholder={t('maker.timeExample', locale)}
              aria-invalid={problem !== null || undefined}
              disabled={working}
              onValueChange={setDraft}
              onBlur={saveTime}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveTime();
                }
              }}
              className="w-24"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            className="ml-auto"
            disabled={working || (day === null && time === null)}
            onClick={async () => {
              setProblem(null);
              if (await onSave({ day: null, time: null })) {
                setDraft('');
                setOpen(false);
              }
            }}
          >
            {t('maker.clearDay', locale)}
          </Button>
        </div>
        <BestTimeHint locale={locale} networks={networks} bestTimes={bestTimes} className="max-w-64 px-2 pb-1" />
        {problem !== null && (
          <p role="alert" className="max-w-64 px-2 text-sm text-destructive">
            {t(problem, locale)}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The theme chip: the theme's dot and name; a press lists the themes (and no theme). */
function ThemeChip({ locale, theme, themes, working, onSave }) {
  const dot = themeBackground(theme?.colour);
  const choices = themes.filter((item) => !item.archived || item.id === theme?.id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1.5 font-normal" disabled={working} />}>
        <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', dot ?? 'border border-dashed border-muted-foreground')} />
        <span className={cn('max-w-48 truncate', !theme && 'text-muted-foreground')}>{theme ? theme.name : t('maker.noTheme', locale)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48">
        <DropdownMenuRadioGroup
          value={theme ? String(theme.id) : 'none'}
          onValueChange={(value) => onSave(value === 'none' ? null : Number(value))}
        >
          {choices.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={String(item.id)}>
              <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', themeBackground(item.colour))} />
              <span className="truncate">{item.name}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="none">{t('maker.noTheme', locale)}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The ask chip: what the post asks its readers to do (Message us, Book, Buy,
 * Visit, Call, Comment), or no ask. Make my post ends every network's words
 * with it.
 */
function AskChip({ locale, ask, working, onSave }) {
  const Icon = ask === '' ? Hand : ASK_ICONS[ask];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="gap-1.5 font-normal" disabled={working} aria-label={t('maker.ask.chip', locale, { ask: t(ask === '' ? 'maker.ask.none' : `maker.ask.${ask}`, locale) })} />}>
        <Icon aria-hidden="true" className="text-muted-foreground" />
        <span className={cn('max-w-48 truncate', ask === '' && 'text-muted-foreground')}>{t(ask === '' ? 'maker.ask.none' : `maker.ask.${ask}`, locale)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('maker.ask.title', locale)}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={ask === '' ? 'none' : ask} onValueChange={(value) => onSave(value === 'none' ? '' : value)}>
            {ASKS.map((key) => {
              const ItemIcon = ASK_ICONS[key];
              return (
                <DropdownMenuRadioItem key={key} value={key}>
                  <ItemIcon aria-hidden="true" />
                  {t(`maker.ask.${key}`, locale)}
                </DropdownMenuRadioItem>
              );
            })}
            <DropdownMenuRadioItem value="none">{t('maker.ask.none', locale)}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Asks once, then deletes the post with its words and pictures and goes back to the calendar. */
function DeletePost({ locale, postId, open, onClose }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function remove() {
    if (working) return;
    setWorking(true);
    setProblem(null);
    const answer = await send(postAddress(postId), 'DELETE');
    if (!answer.ok || answer.value?.ok !== true) {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      setWorking(false);
      return;
    }
    router.push('/');
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !working) {
          setProblem(null);
          onClose();
        }
      }}
    >
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('maker.deleteAsk', locale)}</AlertDialogTitle>
          <AlertDialogDescription>{t('maker.deleteNote', locale)}</AlertDialogDescription>
        </AlertDialogHeader>
        {problem !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t(problem, locale)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>{t('maker.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={working} onClick={remove}>
            {working && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {t('maker.deleteYes', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
