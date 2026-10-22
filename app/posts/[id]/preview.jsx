'use client';

import { Bookmark, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Ellipsis, Heart, Info, LoaderCircle, MessageCircle, Pencil, Send, Video } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusRow } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { normaliseHashtags } from '../../../lib/plan/fit.js';
import { LIMITS } from '../../../lib/plan/limits.js';
import { networkByKey } from '../../../lib/plan/networks.js';
import { PictureThumb } from '../../pictures/thumb.jsx';

import { aspectOf, countLine, editorBody, editorChanged, editorFields, numberText, previewLink, previewWords, shapeOf, withLinkSentence } from './rules.js';
import { send } from '../../send.js';
import { versionAddress } from './addresses.js';
import { PAUSE_MS, useLeaveSave } from './words-box.jsx';

/**
 * One network's post as a feed shows it (generic: no network's logo, colours
 * or layout): the business's initials and name, the chosen picture in the
 * network's shape (a video network shows it as a cover with a video mark),
 * the action icons, the words and the hashtags. The pencil turns the words
 * into a box (words, hashtags; link and first comment behind More) that saves
 * itself as the person's own edit (`VersionEditor`). Under it: the count, only
 * near the limit or over it, and the checks, one short line each, only when
 * present.
 *
 * On a network that takes a set, with a swipe set (`slides`: the pictures
 * this network takes, the cover first), the picture pages through them
 * (previous, next, "2 / 6"). On a network with stories and a story set
 * (`stories`), **Post** and **Story** above the preview switch to the
 * story's frames in the story shape. `placeOf(picture)` is a tip's number.
 *
 * @param {{
 *   locale: string, postId: number, network: string, version: any, picture: any, business: string,
 *   initials: string, themeColour: number | null, checks: { key: string, level: string, fix?: string }[],
 *   slides?: any[], stories?: any[], placeOf?: (picture: any) => number | null,
 *   linkSentence: string, onVersion: (version: any) => void, onPicture: (picture: any) => void,
 *   onEditor?: (handle: { flush: () => Promise<{ ok: boolean }> } | null) => void,
 *   tracking?: import('../../../lib/plan/share.js').Tracking,
 * }} props `tracking`: the post's link tracking: the words, the link line and the count show the tracked addresses Copy gives
 */
export function Preview({ locale, postId, network, version, picture, business, initials, themeColour, checks, slides = [], stories = [], placeOf, linkSentence, onVersion, onPicture, onEditor, tracking }) {
  const [editing, setEditing] = useState(/** @type {{ text: string } | null} */ (null));
  const [describing, setDescribing] = useState(false);
  const [view, setView] = useState(/** @type {'post' | 'story'} */ ('post'));
  const story = view === 'story' && stories.length > 0;
  const item = networkByKey(network);
  const shape = shapeOf(network);
  const video = item?.needs === 'video';
  const showPicture = picture !== null || item?.needs !== null;
  const name = business.trim() || t('maker.yourBusiness', locale);
  const count = countLine(network, version, picture !== null, tracking);
  const link = previewLink(network, version, tracking);
  const words = previewWords(network, version, tracking);

  function fix(check) {
    if (check.fix === 'description' && picture !== null) setDescribing(true);
    if (check.fix === 'linkSentence') setEditing({ text: withLinkSentence(version.text, linkSentence) });
  }

  return (
    <div className="flex w-full max-w-[330px] min-w-0 shrink-0 flex-col gap-3 xl:w-[330px]">
      {stories.length > 0 && (
        <StatusRow
          label={t('maker.previewOf', locale, { network: item?.name ?? network })}
          options={[{ value: 'post', label: t('maker.viewPost', locale) }, { value: 'story', label: t('maker.viewStory', locale) }]}
          value={story ? 'story' : 'post'}
          onValueChange={(next) => {
            setEditing(null);
            setView(next === 'story' ? 'story' : 'post');
          }}
          className="w-fit"
        />
      )}
      {story ? (
        <article
          aria-label={t('maker.previewStory', locale, { network: item?.name ?? network })}
          className="w-full max-w-[250px] overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/10"
        >
          <div className="flex items-center gap-2 p-2.5">
            <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="truncate text-sm font-semibold">{name}</span>
          </div>
          <Pager locale={locale} pictures={stories} shape="story" themeColour={themeColour} business={business} placeOf={placeOf} />
        </article>
      ) : (
      <article
        aria-label={t('maker.preview', locale, { network: item?.name ?? network })}
        className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-foreground/10"
      >
        <div className="flex items-center gap-2 p-2.5">
          <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {initials}
          </span>
          <span className="truncate text-sm font-semibold">{name}</span>
          <Ellipsis aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </div>
        {slides.length > 1 ? (
          <Pager locale={locale} pictures={slides} shape={shape} themeColour={themeColour} business={business} placeOf={placeOf} />
        ) : showPicture && (
          <div className={cn('relative w-full overflow-hidden', aspectOf(shape))}>
            <PictureThumb picture={picture} shape={shape} themeColour={themeColour} business={business} locale={locale} place={placeOf?.(picture) ?? null} />
            {video && (
              <span
                role="img"
                aria-label={t('maker.videoCover', locale)}
                className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm"
              >
                <Video aria-hidden="true" className="size-4" />
              </span>
            )}
          </div>
        )}
        <div aria-hidden="true" className="flex items-center gap-3 px-3 pt-2.5">
          <Heart className="size-4" />
          <MessageCircle className="size-4" />
          <Send className="size-4" />
          <Bookmark className="ml-auto size-4" />
        </div>
        {editing === null ? (
          <div className="relative px-3 pt-1.5 pb-3 text-[13px] leading-snug">
            <p className="whitespace-pre-line [overflow-wrap:anywhere]">
              <span className="font-semibold">{name}</span> {words}
            </p>
            {link !== '' && <p className="truncate text-primary">{link}</p>}
            {version.hashtags !== '' && <p className="pr-9 text-primary [overflow-wrap:anywhere]">{version.hashtags}</p>}
            {version.firstComment !== '' && (
              <p className="mt-1.5 flex gap-1.5 pr-9 text-muted-foreground">
                <MessageCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-2 [overflow-wrap:anywhere]">{version.firstComment}</span>
              </p>
            )}
            {version.hashtags === '' && version.firstComment === '' && <div className="h-6" />}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('maker.edit', locale, { network: item?.name ?? network })}
              onClick={() => setEditing({ text: version.text })}
              className="absolute right-2 bottom-2 bg-muted text-muted-foreground hover:bg-accent"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
        ) : (
          <VersionEditor
            locale={locale}
            postId={postId}
            network={network}
            version={version}
            startText={editing.text}
            withPicture={picture !== null}
            onSaved={onVersion}
            onDone={() => setEditing(null)}
            register={onEditor}
            tracking={tracking}
          />
        )}
      </article>
      )}

      {(count !== null || checks.length > 0) && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {count !== null && (
            <li className={cn('tabular-nums', count.over ? 'text-destructive' : 'text-muted-foreground')}>
              {t('maker.count', locale, { count: numberText(count.count, locale), limit: numberText(count.limit, locale) })}
            </li>
          )}
          {checks.map((check) => {
            const Icon = check.level === 'must' ? CircleAlert : Info;
            const fixable = (check.fix === 'description' && picture !== null) || check.fix === 'linkSentence';
            return (
              <li key={check.key} className={cn('flex items-start gap-1.5', check.level === 'must' ? 'text-destructive' : 'text-muted-foreground')}>
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">{t(check.key, locale)}</span>
                {fixable && editing === null && (
                  <Button type="button" variant="outline" size="xs" onClick={() => fix(check)} className="-my-0.5">
                    {t(check.fix === 'description' ? 'maker.fixDescription' : 'maker.fixLink', locale)}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {describing && picture !== null && (
        <DescribePicture locale={locale} picture={picture} onSaved={(saved) => { setDescribing(false); onPicture(saved); }} onClose={() => setDescribing(false)} />
      )}
    </div>
  );
}

/**
 * A set's pictures one at a time in `shape`, with previous and next (each
 * only where there is one to go to) and "2 / 6". Words pictures are drawn by
 * the page, so a tip's number follows the set's order as it is now.
 */
function Pager({ locale, pictures, shape, themeColour, business, placeOf }) {
  const [at, setAt] = useState(0);
  const index = Math.min(at, pictures.length - 1);
  const picture = pictures[index] ?? null;
  return (
    <div className={cn('relative w-full overflow-hidden', aspectOf(shape))}>
      <PictureThumb picture={picture} shape={shape} themeColour={themeColour} business={business} locale={locale} wordsFirst place={placeOf?.(picture) ?? null} />
      <span className="pointer-events-none absolute right-2 bottom-2 inline-flex h-6 items-center rounded-4xl bg-background/85 px-2 text-xs font-medium text-foreground tabular-nums shadow-sm">
        {t('maker.slideOf', locale, { n: String(index + 1), of: String(pictures.length) })}
      </span>
      {index > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={t('maker.slidePrevious', locale)}
          onClick={() => setAt(index - 1)}
          className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/85 shadow-sm hover:bg-background"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
      )}
      {index < pictures.length - 1 && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={t('maker.slideNext', locale)}
          onClick={() => setAt(index + 1)}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/85 shadow-sm hover:bg-background"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * The words of one network as a box: words, hashtags, and behind More the
 * link and the first comment. Like the post's own words box it saves itself
 * after a pause of typing and when the person leaves the box, and says
 * "Saved" only after the app confirms; a refusal keeps the words and says
 * why. A link that does not read as a safe web address stays in its field
 * with its reason, while the other words still save. Words not saved yet are
 * sent before the preview shows another network (`register` hands the maker
 * a `flush`), and as the person leaves the page. Done saves what is left and
 * closes the box.
 *
 * @param {{
 *   locale: string, postId: number, network: string, version: any, startText: string, withPicture: boolean,
 *   onSaved: (version: any) => void, onDone: () => void,
 *   register?: (handle: { flush: () => Promise<{ ok: boolean }> } | null) => void,
 *   tracking?: import('../../../lib/plan/share.js').Tracking,
 * }} props
 */
export function VersionEditor({ locale, postId, network, version, startText, withPicture, onSaved, onDone, register, tracking }) {
  const [text, setText] = useState(startText);
  const [hashtags, setHashtags] = useState(version.hashtags);
  const [link, setLink] = useState(version.link);
  const [firstComment, setFirstComment] = useState(version.firstComment);
  const [more, setMore] = useState(version.link !== '' || version.firstComment !== '');
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const [linkShown, setLinkShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const id = useId();
  const draft = useRef({ text: startText, hashtags: version.hashtags, link: version.link, firstComment: version.firstComment });
  const saved = useRef(editorFields(version));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const round = useRef(0);
  const handOn = useRef(onSaved);
  handOn.current = onSaved;
  const count = countLine(network, { text, hashtags: normaliseHashtags(hashtags).join(' '), link }, withPicture, tracking);
  const linkProblem = editorBody({ text, hashtags, link, firstComment }).linkProblem;

  function stopWaiting() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  /**
   * Saves the draft when it says something the app does not keep yet.
   * Answers `ok` when every word, the link too, is kept.
   */
  async function save({ keepalive = false } = {}) {
    stopWaiting();
    const read = editorBody(draft.current);
    if (!editorChanged(read.body, saved.current)) return { ok: read.linkProblem === null };
    const mine = ++round.current;
    const answer = await send(versionAddress(postId, network), 'PUT', read.body, { keepalive });
    const latest = mine === round.current;
    if (!answer.ok || !answer.value?.version) {
      if (latest) setNote(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return { ok: false };
    }
    if (!latest) return { ok: false };
    saved.current = editorFields(answer.value.version);
    handOn.current(answer.value.version);
    const now = editorBody(draft.current);
    setNote(editorChanged(now.body, saved.current) ? null : 'maker.saved');
    return { ok: read.linkProblem === null };
  }

  const saveNow = useRef(save);
  saveNow.current = save;

  // Words the box opened with that the app does not keep (a fix the person pressed, such as the "link in profile"
  // sentence) save after a pause, as typed words do.
  useEffect(() => {
    if (editorChanged(editorBody(draft.current).body, saved.current)) timer.current = setTimeout(() => saveNow.current(), PAUSE_MS);
    return stopWaiting;
  }, []);

  useEffect(() => {
    if (typeof register !== 'function') return undefined;
    register({
      flush: async () => {
        const done = await saveNow.current();
        if (!done.ok) setLinkShown(true);
        return done;
      },
    });
    return () => register(null);
  }, [register]);

  const leaving = useRef(() => {});
  leaving.current = () => {
    if (editorChanged(editorBody(draft.current).body, saved.current)) saveNow.current({ keepalive: true });
  };
  useLeaveSave(leaving);

  function change(field, value) {
    draft.current = { ...draft.current, [field]: value };
    setNote(null);
    stopWaiting();
    timer.current = setTimeout(() => saveNow.current(), PAUSE_MS);
  }

  async function done() {
    if (closing) return;
    setClosing(true);
    const result = await save();
    setClosing(false);
    if (result.ok) onDone();
    else setLinkShown(true);
  }

  const problem = note !== null && note !== 'maker.saved';
  const showLink = linkShown && linkProblem !== null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        done();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(/** @type {Node | null} */ (event.relatedTarget))) save();
      }}
      className="flex flex-col gap-2.5 px-3 pt-2 pb-3"
    >
      <Textarea
        autoFocus
        value={text}
        maxLength={LIMITS.versionText}
        aria-label={t('maker.words', locale)}
        aria-invalid={problem || undefined}
        onChange={(event) => {
          setText(event.target.value);
          change('text', event.target.value);
        }}
        className="min-h-32 text-[13px] leading-snug md:text-[13px]"
      />
      <Input
        value={hashtags}
        aria-label={t('maker.hashtags', locale)}
        placeholder={t('maker.hashtagsExample', locale)}
        onValueChange={(value) => {
          setHashtags(value);
          change('hashtags', value);
        }}
        className="text-[13px] text-primary md:text-[13px]"
      />
      {more ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-link`}>{t('maker.link', locale)}</Label>
            <Input
              id={`${id}-link`}
              value={link}
              inputMode="url"
              maxLength={LIMITS.link}
              placeholder="https://"
              aria-invalid={showLink || undefined}
              aria-describedby={showLink ? `${id}-link-problem` : undefined}
              onValueChange={(value) => {
                setLink(value);
                change('link', value);
              }}
              onBlur={() => setLinkShown(true)}
            />
            {showLink && (
              <p id={`${id}-link-problem`} role="alert" className="text-sm text-destructive">
                {t(linkProblem, locale)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-comment`}>{t('maker.firstComment', locale)}</Label>
            <Textarea
              id={`${id}-comment`}
              value={firstComment}
              maxLength={LIMITS.firstComment}
              onChange={(event) => {
                setFirstComment(event.target.value);
                change('firstComment', event.target.value);
              }}
              className="min-h-16"
            />
          </div>
        </>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setMore(true)} className="w-fit text-muted-foreground">
          <ChevronDown aria-hidden="true" />
          {t('maker.moreFields', locale)}
        </Button>
      )}
      {count !== null && (
        <p className={cn('text-sm tabular-nums', count.over ? 'text-destructive' : 'text-muted-foreground')}>
          {t('maker.count', locale, { count: numberText(count.count, locale), limit: numberText(count.limit, locale) })}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {t(note, locale)}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <p role="status" className="mr-auto text-xs text-muted-foreground empty:hidden">
          {note === 'maker.saved' ? t('maker.saved', locale) : ''}
        </p>
        <Button type="submit" disabled={closing}>
          {closing && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {t('maker.done', locale)}
        </Button>
      </div>
    </form>
  );
}

/** The chosen picture's description (for people who cannot see it), saved on Save. */
function DescribePicture({ locale, picture, onSaved, onClose }) {
  const [words, setWords] = useState(String(picture.description ?? ''));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function save(event) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setProblem(null);
    const answer = await send(`/api/pictures/${encodeURIComponent(String(picture.id))}`, 'PATCH', { description: words.trim() });
    setWorking(false);
    if (!answer.ok || !answer.value?.picture) {
      setProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
      return;
    }
    onSaved(answer.value.picture);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t('pictures.describe', locale)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
            <Textarea
              autoFocus
              value={words}
              maxLength={LIMITS.description}
              aria-label={t('pictures.describe', locale)}
              onChange={(event) => setWords(event.target.value)}
              className="min-h-24"
            />
            {problem !== null && (
              <p role="alert" className="text-sm text-destructive">
                {t(problem, locale)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working || words.trim() === ''}>
              {working && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {t('maker.save', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
