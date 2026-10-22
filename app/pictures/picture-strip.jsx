'use client';

import { ArrowUp, Check, Crosshair, Ellipsis, FileText, ImagePlus, LoaderCircle, PencilLine, Sparkles, Trash2, Type, WandSparkles } from 'lucide-react';
import { useId, useRef, useState } from 'react';

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { PictureField } from '@/components/ui/picture-field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { StatusRow, ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import { t } from '../../lib/i18n/index.js';
import { CARD_LAYOUTS, CARD_SUBLINE_MOST, SUBLINE_KINDS, layoutOf } from '../../lib/plan/card-layout.js';
import { keepShapes, readPictureSize } from '../../lib/plan/draw.js';
import { LIMITS } from '../../lib/plan/limits.js';
import { sendFile } from '../../lib/send-file.js';
import { send } from '../send.js';

import {
  FOCUS_STEPS,
  aiStopOf,
  canDraw,
  canSendChange,
  chosenOf,
  fileAddress,
  firstSentence,
  focusStep,
  hasOriginal,
  hasRoom,
  makingLine,
  missingShapes,
  pictureWords,
  postFullOf,
  shapesFor,
  canMakeSet,
  slideNetworks,
  stepFocus,
  storyNetworks,
  tipPlace,
  wordsChanges,
} from './rules.js';
import { usePictureBrand } from './brand.jsx';
import { PictureSet } from './sets.jsx';
import { PictureThumb } from './thumb.jsx';
import { LayoutSample } from './words-picture.jsx';

/** The steps of the focus grid, across and down. */
const STEPS = Object.freeze(Array.from({ length: FOCUS_STEPS }, (_, step) => step));

/** How a picture fills a shape, in the order offered. */
const FIT_CHOICES = Object.freeze([
  { value: 'auto', key: 'pictures.fitAuto' },
  { value: 'fill', key: 'pictures.fitFill' },
  { value: 'fit', key: 'pictures.fitFit' },
]);

/** Each layout's name, and the name of the line under its words where it draws one. */
const LAYOUT_NAMES = Object.freeze({
  words: 'pictures.layoutWords',
  tip: 'pictures.layoutTip',
  quote: 'pictures.layoutQuote',
  offer: 'pictures.layoutOffer',
  event: 'pictures.layoutEvent',
});
const SUBLINE_NAMES = Object.freeze({ price: 'pictures.sublinePrice', date: 'pictures.sublineDate', name: 'pictures.sublineName' });

/** The words key a thrown problem carries, else `fallback`. */
function keyOf(error, fallback) {
  return typeof error?.messageKey === 'string' ? error.messageKey : fallback;
}

/** The picture an address answered (`{ picture }`), or null. */
function pictureOf(answer) {
  const picture = answer?.picture;
  return picture && typeof picture === 'object' && picture.id !== undefined ? picture : null;
}

/**
 * The post maker's pictures (the drawing's left column, under Make my post):
 * the post's pictures as tiles, the chosen one ringed with a check, a press on
 * another choosing it; then **New picture** (AI, one press, one picture, by
 * `POST /api/posts/[id]/pictures/new`), **Your photo** (the kit's picture
 * place) and **Words picture** (the person's words drawn on the theme's
 * colour, no AI); under them **Change this picture…** (AI, by
 * `POST /api/pictures/[id]/change`) when the chosen picture is one the AI drew.
 * Each tile has a menu: Change words (a words picture: its words, layout and
 * the line under them), its description, its focus and fit, and Remove.
 *
 * While a picture is made (New picture, Change this picture, or the maker's
 * Make my post when `making` is true), a busy tile with the kit's spinner
 * stands where the new picture will appear, after the post's pictures; the
 * rest of the strip stays in view, resting.
 *
 * After every change it reads the post again (`GET /api/posts/[id]`) and
 * keeps the chosen picture's copies for the shapes of the networks the post
 * goes to (`networks`, My plan's list, less the ones switched off for this
 * post), drawn in this page (`lib/plan/draw.js`). A picture added here
 * becomes the chosen one. Then `onChange(post)` hands the maker the post as
 * saved (a `PostFull`); when the post could not be read again it hands the
 * picture that changed (a `PictureSummary`) instead.
 *
 * One thing at a time: while one press works, the others rest; they also
 * rest while the maker works (`making` or `disabled`).
 *
 * After an AI problem that keeps refusing (`aiStopOf`: from Make my post, or
 * from New picture or Change this picture here, handed up by `onAiStop`),
 * New picture and Change this picture rest, and the reason (`aiStop`, a words
 * key) shows under the strip until AI answers again.
 *
 * Under the pictures, the post's sets (`PictureSet`): the **Swipe post**
 * when a network the post goes to takes more than one picture a post, and
 * the **Story** when one has stories. Their presses run here, one at a time
 * with the strip's own: a new order is sent (`PUT /api/posts/[id]/sets/<kind>`),
 * and Make slides / Make a story asks the app to write the set
 * (`POST /api/posts/[id]/slides` or `/stories`); each answers the post,
 * which is settled as after any change (the cover may be a new chosen
 * picture). `hasWords`: whether the post has words yet (Make rests without).
 *
 * @param {{ post: { post: { id: number, mainText?: string, name?: string }, versions: object[], pictures: object[] },
 *   networks?: string[], themeColour?: number | null, business?: string, locale: string, hasWords?: boolean,
 *   making?: boolean, disabled?: boolean, aiStop?: string | null, onAiStop?: (problem: string) => void,
 *   onChange?: (next: object) => void }} props
 */
export function PictureStrip({ post, networks = [], themeColour, business, locale, hasWords = false, making = false, disabled = false, aiStop = null, onAiStop, onChange }) {
  const postId = post?.post?.id;
  const pictures = post?.pictures ?? [];
  const chosen = chosenOf(post);
  const room = hasRoom(post);
  const titleId = useId();

  const busy = useRef(false);
  const [work, setWork] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [change, setChange] = useState('');
  const [dialog, setDialog] = useState(/** @type {{ kind: string, id?: number } | null} */ (null));
  // A set made without AI: which set, and the AI's problem (a words key).
  const [setNote, setSetNote] = useState(/** @type {{ kind: string, problem: string } | null} */ (null));
  const working = work !== null;
  const resting = working || making || disabled;
  const stopped = typeof aiStop === 'string' && aiStop !== '';
  const madeLine = makingLine(work, making);

  /** An AI press's refusal: a lasting one rests AI pictures with its reason (no problem line); else it is the problem. */
  function aiRefusal(problem) {
    const stop = aiStopOf(problem);
    if (stop === null) return problem;
    onAiStop?.(stop);
    return null;
  }

  function begin(kind) {
    if (busy.current || making || disabled) return false;
    busy.current = true;
    setWork(kind);
    setProblem(null);
    return true;
  }

  function end() {
    busy.current = false;
    setWork(null);
  }

  async function readPost() {
    const answer = await send(`/api/posts/${encodeURIComponent(String(postId))}`, 'GET');
    return answer.ok ? postFullOf(answer.value) : null;
  }

  /**
   * After a change: read the post (unless the address answered it: `given`),
   * keep the chosen picture's missing shapes, and hand the maker the post.
   * Answers the words key of a problem, or null.
   */
  async function settle(changed, given = null) {
    const full = given ?? (await readPost());
    if (full === null) {
      if (changed) {
        onChange?.(changed);
        return null;
      }
      return 'error.saveUnconfirmed';
    }
    const picture = chosenOf(full);
    const wanted = missingShapes(picture, shapesFor(full, networks));
    if (picture === null || wanted.length === 0 || !canDraw(picture)) {
      onChange?.(full);
      return null;
    }
    let kept;
    try {
      kept = await keepShapes(picture, wanted, { themeColour, business, place: tipPlace(full, picture) });
    } catch (error) {
      onChange?.(full);
      return keyOf(error, '') === 'error.fileRoom' ? 'error.fileRoom' : 'pictures.notReadyPress';
    }
    onChange?.({ ...full, pictures: full.pictures.map((item) => (item.id === kept.id ? kept : item)) });
    return null;
  }

  /** A picture just added or made: choose it, then settle. */
  async function chooseAndSettle(picture) {
    if (picture.chosen === true) return settle(picture);
    const chosenAnswer = await send(`/api/pictures/${encodeURIComponent(String(picture.id))}`, 'PATCH', { chosen: true });
    if (!chosenAnswer.ok) {
      const trouble = await settle(picture);
      return chosenAnswer.problem ?? trouble;
    }
    return settle(pictureOf(chosenAnswer.value) ?? picture);
  }

  /** Runs one press's work, showing its problem under the strip. */
  async function act(kind, task) {
    if (!begin(kind)) return;
    try {
      const trouble = await task();
      if (trouble) setProblem(trouble);
    } catch (error) {
      setProblem(keyOf(error, 'error.saveFailed'));
    } finally {
      end();
    }
  }

  /** Runs a dialog's work: its problem goes back to the dialog, which stays open; success closes it. */
  async function fromDialog(kind, task) {
    if (!begin(kind)) return null;
    try {
      const outcome = await task();
      if (outcome.problem) return outcome.problem;
      setDialog(null);
      const trouble = await outcome.after();
      if (trouble) setProblem(trouble);
      return null;
    } catch (error) {
      return keyOf(error, 'error.saveFailed');
    } finally {
      end();
    }
  }

  function choose(picture) {
    if (picture.chosen) {
      // The chosen one again: only when its shapes are not all kept yet, to try again.
      if (!canDraw(picture) || missingShapes(picture, shapesFor(post, networks)).length === 0) return;
      act(`choose:${picture.id}`, () => settle(picture));
      return;
    }
    act(`choose:${picture.id}`, async () => {
      const answer = await send(`/api/pictures/${encodeURIComponent(String(picture.id))}`, 'PATCH', { chosen: true });
      if (!answer.ok) return answer.problem;
      return settle(pictureOf(answer.value) ?? picture);
    });
  }

  function makeNew() {
    act('new', async () => {
      const answer = await send(`/api/posts/${encodeURIComponent(String(postId))}/pictures/new`, 'POST', {});
      const picture = answer.ok ? pictureOf(answer.value) : null;
      if (picture === null) return answer.ok ? 'error.saveFailed' : aiRefusal(answer.problem);
      return chooseAndSettle(picture);
    });
  }

  function sendChange(event) {
    event.preventDefault();
    const words = change.trim();
    if (!canSendChange(change, resting || stopped) || !chosen?.canChange) return;
    const from = chosen;
    act('change', async () => {
      const answer = await send(`/api/pictures/${encodeURIComponent(String(from.id))}/change`, 'POST', { change: words });
      const picture = answer.ok ? pictureOf(answer.value) : null;
      if (picture === null) return answer.ok ? 'error.saveFailed' : aiRefusal(answer.problem);
      setChange('');
      return chooseAndSettle(picture);
    });
  }

  /** Adds a picture from a dialog (`body` answers what `POST /api/posts/[id]/pictures` takes). */
  function addPicture(body) {
    return fromDialog('add', async () => {
      const answer = await send(`/api/posts/${encodeURIComponent(String(postId))}/pictures`, 'POST', await body());
      const picture = answer.ok ? pictureOf(answer.value) : null;
      if (picture === null) return { problem: answer.ok ? 'error.saveFailed' : answer.problem };
      return { after: () => chooseAndSettle(picture) };
    });
  }

  function addPhoto(file) {
    return addPicture(async () => {
      const size = await readPictureSize(file);
      const kept = await sendFile(file);
      return { source: 'photo', file: kept.file, width: size.width, height: size.height };
    });
  }

  function addWords(words) {
    return addPicture(async () => ({ source: 'words', words }));
  }

  function updatePicture(picture, fields) {
    return fromDialog('save', async () => {
      const answer = await send(`/api/pictures/${encodeURIComponent(String(picture.id))}`, 'PATCH', fields);
      const updated = answer.ok ? pictureOf(answer.value) : null;
      if (updated === null) return { problem: answer.ok ? 'error.saveFailed' : answer.problem };
      return { after: () => settle(updated) };
    });
  }

  function removePicture(picture) {
    return fromDialog('remove', async () => {
      const answer = await send(`/api/pictures/${encodeURIComponent(String(picture.id))}`, 'DELETE');
      if (!answer.ok) return { problem: answer.problem };
      return { after: () => settle(null) };
    });
  }

  /** A set's new order (`ids`, from the set's own rules; null when nothing can change). */
  function orderSet(kind, ids) {
    if (!Array.isArray(ids)) return;
    act(`set:${kind}`, async () => {
      const answer = await send(`/api/posts/${encodeURIComponent(String(postId))}/sets/${kind}`, 'PUT', { pictureIds: ids });
      const full = answer.ok ? postFullOf(answer.value) : null;
      if (full === null) return answer.ok ? 'error.saveUnconfirmed' : answer.problem;
      return settle(null, full);
    });
  }

  /**
   * Make slides (`slide`) or Make a story (`story`): the app writes the set's words pictures, as many as it
   * makes (6 slides, 4 frames) or as fit the post's room.
   */
  function makeSet(kind) {
    act(`make:${kind}`, async () => {
      setSetNote(null);
      const address = `/api/posts/${encodeURIComponent(String(postId))}/${kind === 'story' ? 'stories' : 'slides'}`;
      const answer = await send(address, 'POST', {});
      const full = answer.ok ? postFullOf(answer.value) : null;
      if (full === null) return answer.ok ? 'error.saveUnconfirmed' : aiRefusal(answer.problem);
      const problem = answer.value?.ai === false && typeof answer.value?.aiProblem === 'string' ? answer.value.aiProblem : null;
      if (problem !== null) {
        const stop = aiStopOf(problem);
        if (stop !== null) onAiStop?.(stop);
        setSetNote({ kind, problem });
      }
      return settle(null, full);
    });
  }

  /** The line under a set made without AI: a lasting problem is said once, under the strip. */
  function setNoteFor(kind) {
    if (setNote === null || setNote.kind !== kind) return null;
    const without = t('maker.withoutAi', locale);
    return setNote.problem === aiStop ? without : `${without} ${t(setNote.problem, locale)}`;
  }

  const showSlides = slideNetworks(post, networks).length > 0;
  const showStory = storyNetworks(post, networks).length > 0;
  // Make's reason is said once: under the swipe set when both show the same.
  const slideMake = canMakeSet(post, 'slide', hasWords);
  const storyMake = canMakeSet(post, 'story', hasWords);
  const storyQuiet = showSlides && !slideMake.ok && !storyMake.ok && slideMake.reason === storyMake.reason;
  const open = dialog?.id === undefined ? null : (pictures.find((picture) => picture.id === dialog.id) ?? null);
  const close = () => setDialog(null);

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <h2 id={titleId} className="font-sans text-sm font-medium">
        {t('pictures.title', locale)}
      </h2>

      <div className="grid grid-cols-3 gap-3">
        {pictures.map((picture, index) => {
          const words = pictureWords(picture);
          const label = words === ''
            ? t('pictures.number', locale, { n: String(index + 1) })
            : t('pictures.numberWith', locale, { n: String(index + 1), description: words });
          return (
            <div key={picture.id} className="group/tile relative aspect-square min-w-0">
              <Button
                type="button"
                variant="ghost"
                aria-pressed={picture.chosen === true}
                aria-label={label}
                disabled={resting}
                onClick={() => choose(picture)}
                className={cn(
                  'size-full overflow-hidden rounded-xl p-0 hover:bg-transparent',
                  picture.chosen ? 'ring-[3px] ring-primary' : 'ring-1 ring-foreground/10',
                )}
              >
                <PictureThumb picture={picture} themeColour={themeColour} business={business} locale={locale} alt="" tile place={tipPlace(post, picture)} />
              </Button>
              {picture.chosen && (
                <span aria-hidden="true" className="pointer-events-none absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" />
                </span>
              )}
              {work === `choose:${picture.id}` && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <LoaderCircle className="size-6 animate-spin text-primary-foreground drop-shadow-sm" />
                </span>
              )}
              {!resting && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-xs"
                        aria-label={t('pictures.menu', locale, { n: String(index + 1) })}
                        className="absolute right-1.5 bottom-1.5 rounded-full shadow-sm opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                      />
                    }
                  >
                    <Ellipsis aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto">
                    {picture.source === 'words' && (
                      <DropdownMenuItem onClick={() => setDialog({ kind: 'changeWords', id: picture.id })}>
                        <PencilLine aria-hidden="true" />
                        {t('pictures.changeWords', locale)}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setDialog({ kind: 'description', id: picture.id })}>
                      <FileText aria-hidden="true" />
                      {t('pictures.description', locale)}
                    </DropdownMenuItem>
                    {hasOriginal(picture) && (
                      <DropdownMenuItem onClick={() => setDialog({ kind: 'focus', id: picture.id })}>
                        <Crosshair aria-hidden="true" />
                        {t('pictures.focus', locale)}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: 'remove', id: picture.id })}>
                      <Trash2 aria-hidden="true" />
                      {t('pictures.remove', locale)}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}

        {madeLine !== null && (
          <div aria-hidden="true" className="flex aspect-square min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl bg-muted px-1.5 text-center text-sm font-medium text-muted-foreground ring-1 ring-foreground/10">
            <Spinner role="presentation" aria-label={undefined} className="size-5 text-primary" />
            <span className="max-w-full truncate">{t('pictures.making', locale)}</span>
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          disabled={resting || !room || stopped}
          onClick={makeNew}
          className="aspect-square h-auto w-full min-w-0 flex-col gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-accent/40 text-sm font-medium text-primary hover:text-primary"
        >
          <Sparkles aria-hidden="true" className="size-5" />
          {t('pictures.new', locale)}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={resting || !room}
          onClick={() => setDialog({ kind: 'photo' })}
          className="aspect-square h-auto w-full min-w-0 flex-col gap-1.5 rounded-xl border-2 border-dashed border-input text-sm font-medium text-muted-foreground"
        >
          <ImagePlus aria-hidden="true" className="size-5" />
          {t('pictures.photo', locale)}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={resting || !room}
          onClick={() => setDialog({ kind: 'words' })}
          className="aspect-square h-auto w-full min-w-0 flex-col gap-1.5 rounded-xl border-2 border-dashed border-input text-sm font-medium text-muted-foreground"
        >
          <Type aria-hidden="true" className="size-5" />
          {t('pictures.words', locale)}
        </Button>
      </div>

      {chosen?.canChange === true && (
        <form onSubmit={sendChange}>
          {/* An empty box rests only its send button: the kit greys a whole group holding a disabled control, so the
              group keeps its ready look until the strip itself rests. */}
          <InputGroup className={cn('h-9 bg-card', !resting && !stopped && 'has-disabled:bg-card has-disabled:opacity-100')}>
            <InputGroupAddon>
              <WandSparkles aria-hidden="true" className="text-primary" />
            </InputGroupAddon>
            <InputGroupInput
              value={change}
              onChange={(event) => setChange(event.target.value)}
              placeholder={t('pictures.change', locale)}
              aria-label={t('pictures.change', locale)}
              maxLength={LIMITS.change}
              disabled={resting || stopped}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" size="icon-xs" aria-label={t('pictures.changeSend', locale)} disabled={!canSendChange(change, resting || stopped)}>
                <ArrowUp aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      )}

      {/* Said to people who hear the page: always here, so the line is read when it changes. */}
      <p role="status" className="sr-only">{madeLine === null ? '' : t(madeLine, locale)}</p>
      {stopped && <p className="text-sm text-muted-foreground">{t(aiStop, locale)}</p>}
      {!room && <p className="text-sm text-muted-foreground">{t('pictures.most', locale, { n: String(LIMITS.picturesPerPost) })}</p>}
      {problem !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(problem, locale)}
        </p>
      )}

      {(showSlides || showStory) && (
        <div className="flex flex-col gap-4 pt-1">
          {showSlides && (
            <PictureSet
              kind="slide"
              post={post}
              networks={networks}
              hasWords={hasWords}
              themeColour={themeColour}
              business={business}
              locale={locale}
              resting={resting}
              work={work}
              note={setNoteFor('slide')}
              onOrder={orderSet}
              onMake={makeSet}
            />
          )}
          {showStory && (
            <PictureSet
              kind="story"
              post={post}
              networks={networks}
              hasWords={hasWords}
              themeColour={themeColour}
              business={business}
              locale={locale}
              resting={resting}
              work={work}
              note={setNoteFor('story')}
              quiet={storyQuiet}
              onOrder={orderSet}
              onMake={makeSet}
            />
          )}
        </div>
      )}

      {dialog?.kind === 'photo' && <PhotoDialog locale={locale} working={working} onAdd={addPhoto} onClose={close} />}
      {dialog?.kind === 'words' && (
        <WordsDialog locale={locale} start={firstSentence(post?.post?.mainText || post?.post?.name || '')} working={working} onAdd={addWords} onClose={close} />
      )}
      {dialog?.kind === 'changeWords' && open !== null && (
        <ChangeWordsDialog picture={open} themeColour={themeColour} locale={locale} working={working} onSave={(fields) => updatePicture(open, fields)} onClose={close} />
      )}
      {dialog?.kind === 'description' && open !== null && (
        <DescriptionDialog picture={open} locale={locale} working={working} onSave={(fields) => updatePicture(open, fields)} onClose={close} />
      )}
      {dialog?.kind === 'focus' && open !== null && (
        <FocusDialog picture={open} locale={locale} working={working} onSave={(fields) => updatePicture(open, fields)} onClose={close} />
      )}
      {dialog?.kind === 'remove' && open !== null && (
        <RemoveDialog locale={locale} working={working} onRemove={() => removePicture(open)} onClose={close} />
      )}
    </section>
  );
}

/** A dialog's problem line, shown only after a press that failed. */
function DialogProblem({ problem, locale }) {
  if (problem === null) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t(problem, locale)}
    </p>
  );
}

/** The save button's busy mark. */
function Busy({ working }) {
  return working ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null;
}

/** Your photo: the kit's picture place and Add. The picked picture belongs to this dialog and goes when it closes. */
function PhotoDialog({ locale, working, onAdd, onClose }) {
  const [picture, setPicture] = useState(/** @type {{ file: File } | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function add(event) {
    event.preventDefault();
    if (!picture?.file || working) return;
    setProblem(null);
    const trouble = await onAdd(picture.file);
    if (trouble) setProblem(trouble);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next || working) return;
        setPicture(null);
        onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader>
          <DialogTitle>{t('pictures.photo', locale)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={add} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
            <PictureField
              value={picture}
              onChange={(next) => {
                setPicture(next?.file ? next : null);
                setProblem(null);
              }}
              locale={locale}
              disabled={working}
            />
            <DialogProblem problem={problem} locale={locale} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working || !picture?.file}>
              <Busy working={working} />
              {t('pictures.add', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Words picture: the words to draw, starting with the post's first sentence. */
function WordsDialog({ locale, start, working, onAdd, onClose }) {
  const [words, setWords] = useState(start);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function add(event) {
    event.preventDefault();
    const value = words.trim();
    if (value === '' || working) return;
    setProblem(null);
    const trouble = await onAdd(value);
    if (trouble) setProblem(trouble);
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
          <DialogTitle>{t('pictures.wordsTitle', locale)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={add} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
            <Textarea
              aria-label={t('pictures.wordsTitle', locale)}
              value={words}
              onChange={(event) => setWords(event.target.value)}
              maxLength={LIMITS.pictureWords}
              disabled={working}
              className="min-h-24"
            />
            <DialogProblem problem={problem} locale={locale} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working || words.trim() === ''}>
              <Busy working={working} />
              {t('pictures.add', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Change words: a words picture's words, its layout (each with a drawn
 * sample of 56 points in the picture's own colours, its mark large:
 * `LayoutSample`) and the line under its words, named
 * by its layout (an offer's price, an event's date, who said a quote; none
 * for plain words and a tip). Saves only what changed; the app then clears
 * the picture's kept copies, and the strip keeps the missing ones again.
 */
export function ChangeWordsDialog({ picture, themeColour, locale, working, onSave, onClose }) {
  const [words, setWords] = useState(String(picture.words ?? ''));
  const [layout, setLayout] = useState(layoutOf(picture.layout));
  const [subline, setSubline] = useState(String(picture.subline ?? ''));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const id = useId();
  // The samples take the page's brand colours, never its logo (too small to show at their size).
  const { colour, colour2 } = usePictureBrand();
  const line = SUBLINE_KINDS[/** @type {keyof typeof SUBLINE_KINDS} */ (layout)] ?? null;

  async function save(event) {
    event.preventDefault();
    if (working) return;
    const changes = wordsChanges(picture, { words, layout, subline });
    if (changes === null) return;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setProblem(null);
    const trouble = await onSave(changes);
    if (trouble) setProblem(trouble);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pictures.changeWords', locale)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-1">
            <Field>
              <FieldLabel htmlFor={`${id}-words`}>{t('pictures.wordsField', locale)}</FieldLabel>
              <Textarea
                id={`${id}-words`}
                value={words}
                onChange={(event) => setWords(event.target.value)}
                maxLength={LIMITS.pictureWords}
                disabled={working}
                className="min-h-24"
              />
            </Field>
            <FieldSet className="gap-0">
              <FieldLegend variant="label">{t('pictures.layoutLabel', locale)}</FieldLegend>
              <ToggleGroup
                multiple={false}
                value={[layout]}
                onValueChange={(values) => {
                  if (values.length > 0) setLayout(layoutOf(values[0]));
                }}
                disabled={working}
                variant="outline"
                className="grid w-full grid-cols-3 gap-2 sm:grid-cols-5"
              >
                {CARD_LAYOUTS.map((kind) => (
                  <ToggleGroupItem key={kind} value={kind} className="h-auto w-full min-w-0 flex-col gap-1 px-1 py-1.5 text-xs">
                    <LayoutSample layout={kind} themeColour={themeColour} brand={{ colour, colour2 }} />
                    {t(LAYOUT_NAMES[kind], locale)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>
            {line !== null && (
              <Field>
                <FieldLabel htmlFor={`${id}-line`}>{t(SUBLINE_NAMES[line], locale)}</FieldLabel>
                <Input id={`${id}-line`} value={subline} onValueChange={setSubline} maxLength={CARD_SUBLINE_MOST} autoComplete="off" disabled={working} />
              </Field>
            )}
            <DialogProblem problem={problem} locale={locale} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working || words.trim() === ''}>
              <Busy working={working} />
              {t('pictures.save', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A picture's description, for people who cannot see it. */
function DescriptionDialog({ picture, locale, working, onSave, onClose }) {
  const [words, setWords] = useState(String(picture.description ?? ''));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function save(event) {
    event.preventDefault();
    if (working) return;
    const value = words.trim();
    if (value === String(picture.description ?? '').trim()) {
      onClose();
      return;
    }
    setProblem(null);
    const trouble = await onSave({ description: value });
    if (trouble) setProblem(trouble);
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
              aria-label={t('pictures.describe', locale)}
              value={words}
              onChange={(event) => setWords(event.target.value)}
              maxLength={LIMITS.description}
              disabled={working}
              className="min-h-24"
            />
            <DialogProblem problem={problem} locale={locale} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working}>
              <Busy working={working} />
              {t('pictures.save', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Focus and fit: the picture with a grid over it (a press keeps that part in
 * view when a shape is cut from it), and how it fills a shape.
 */
function FocusDialog({ picture, locale, working, onSave, onClose }) {
  const [across, setAcross] = useState(() => focusStep(picture.focusX));
  const [down, setDown] = useState(() => focusStep(picture.focusY));
  const [fit, setFit] = useState(['auto', 'fill', 'fit'].includes(picture.fit) ? picture.fit : 'auto');
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const words = pictureWords(picture);

  async function save(event) {
    event.preventDefault();
    if (working) return;
    const fields = {};
    if (across !== focusStep(picture.focusX)) fields.focusX = stepFocus(across);
    if (down !== focusStep(picture.focusY)) fields.focusY = stepFocus(down);
    if (fit !== picture.fit) fields.fit = fit;
    if (Object.keys(fields).length === 0) {
      onClose();
      return;
    }
    setProblem(null);
    const trouble = await onSave(fields);
    if (trouble) setProblem(trouble);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pictures.focus', locale)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
            <p className="text-sm text-muted-foreground">{t('pictures.focusHint', locale)}</p>
            <div className="relative mx-auto w-fit overflow-hidden rounded-lg">
              <img
                src={fileAddress(picture.id, 'original', picture.original)}
                alt={words || t('pictures.alt', locale)}
                draggable={false}
                className="block h-auto max-h-[45dvh] max-w-full"
              />
              <div className="absolute inset-0 grid grid-cols-5 grid-rows-5">
                {STEPS.map((row) =>
                  STEPS.map((column) => {
                    const here = row === down && column === across;
                    return (
                      <Button
                        key={`${row}-${column}`}
                        type="button"
                        variant="ghost"
                        aria-pressed={here}
                        aria-label={t('pictures.focusAt', locale, {
                          across: String(Math.round(stepFocus(column) * 100)),
                          down: String(Math.round(stepFocus(row) * 100)),
                        })}
                        disabled={working}
                        onClick={() => {
                          setAcross(column);
                          setDown(row);
                        }}
                        className="size-full rounded-none p-0 hover:bg-foreground/10"
                      >
                        {here && (
                          <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                            <Crosshair className="size-4" />
                          </span>
                        )}
                      </Button>
                    );
                  }),
                )}
              </div>
            </div>
            <StatusRow
              label={t('pictures.fitLabel', locale)}
              options={FIT_CHOICES.map((choice) => ({ value: choice.value, label: t(choice.key, locale) }))}
              value={fit}
              onValueChange={setFit}
              disabled={working}
            />
            <DialogProblem problem={problem} locale={locale} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={working}>
              <Busy working={working} />
              {t('pictures.save', locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Remove, after a yes. */
function RemoveDialog({ locale, working, onRemove, onClose }) {
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  async function remove() {
    if (working) return;
    setProblem(null);
    const trouble = await onRemove();
    if (trouble) setProblem(trouble);
  }

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('pictures.removeTitle', locale)}</AlertDialogTitle>
        </AlertDialogHeader>
        <DialogProblem problem={problem} locale={locale} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>{t('pictures.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={working} onClick={remove}>
            <Busy working={working} />
            {t('pictures.remove', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
