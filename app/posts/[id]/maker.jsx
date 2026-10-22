'use client';

import { CalendarClock, Check } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

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
import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { checksFor, mustFixOf } from '../../../lib/plan/checks.js';
import { keepShapes } from '../../../lib/plan/draw.js';
import { networkByKey } from '../../../lib/plan/networks.js';
import { trackingFor } from '../../../lib/plan/share.js';
import { isAhead, postState } from '../../../lib/plan/state.js';
import { PictureStrip } from '../../pictures/picture-strip.jsx';
import { aiStopOf, canDraw, chosenOf, missingShapes, postFullOf, postNetworks, setOf, shapesFor, tipPlace } from '../../pictures/rules.js';
import { printPage, usePrintLight } from '../print-light.js';

import { MakerHeader } from './header.jsx';
import { Preview } from './preview.jsx';
import { PrintSlides, PrintVideoPlan } from './print-sets.jsx';
import { PrintVersions } from './print-view.jsx';
import {
  askNeedsMake,
  hasWords,
  isRemembrance,
  keepNetwork,
  listNames,
  makeBody,
  makeRest,
  shareMark,
  shownChecks,
  slidesFor,
  versionOf,
  withPicture,
  withVersion,
} from './rules.js';
import { send } from '../../send.js';
import { postAddress } from './addresses.js';
import { ShareSteps } from './share.jsx';
import { VideoPlan } from './video-plan.jsx';
import { WordsBox } from './words-box.jsx';

/** The words key a thrown problem carries, else `fallback`. */
function keyOf(error, fallback) {
  return typeof error?.messageKey === 'string' ? error.messageKey : fallback;
}

/** The problem a shape drawing answers: no room on the computer, else "could not be made ready". */
function drawProblem(error) {
  return keyOf(error, '') === 'error.fileRoom' ? 'error.fileRoom' : 'pictures.notReady';
}

/**
 * The post maker, as drawn: the top line; on the left the words box, Make my
 * post and the pictures; on the right the networks, the preview of the chosen
 * one and the share steps. On a narrow window the two sides stack (words and
 * pictures first).
 *
 * It holds the post as the app last confirmed it (`PostFull`) and redraws
 * from it; every part saves through the post's addresses and hands back what
 * the app answered.
 *
 * @param {{
 *   locale: string, initial: any, networks: string[], themes: { id: number, name: string, colour: number, archived: boolean }[],
 *   campaigns: { id: number, name: string, status: string }[], business: string, initials: string, linkSentence: string,
 *   today: string, showDays: string, hiddenDays: string[], trackLinks?: boolean | null, profileLink?: string,
 * }} props
 */
export function PostMaker({ locale, initial, networks, themes, campaigns, business, initials, linkSentence, today, showDays, hiddenDays, trackLinks = true, profileLink = '', bestTimes = null }) {
  const [full, setFullState] = useState(initial);
  const latest = useRef(initial);
  const [network, setNetwork] = useState(() => keepNetwork(null, postNetworks(initial, networks), initial.versions));
  const [making, setMaking] = useState(false);
  const [picturing, setPicturing] = useState(false);
  const [makingPicture, setMakingPicture] = useState(false);
  const [makeProblem, setMakeProblem] = useState(/** @type {string | null} */ (null));
  // The ask changed after the words were made: "Make my post again to add it to your words."
  const [askNote, setAskNote] = useState(false);
  const [pictureProblem, setPictureProblem] = useState(/** @type {string | null} */ (null));
  const [withoutAi, setWithoutAi] = useState(/** @type {string | null} */ (null));
  const [ask, setAsk] = useState(/** @type {{ text: string, changed: string[] } | null} */ (null));
  // Make my post has answered in this visit: the checks that wait for a start show from then on.
  const [made, setMade] = useState(false);
  // An AI problem that keeps refusing (`aiStopOf`): AI pictures rest with it until AI answers again.
  const [aiStop, setAiStop] = useState(/** @type {string | null} */ (null));
  // What a print press prints: the post's versions, the swipe set as a document, or the video plan.
  const [printing, setPrinting] = useState(/** @type {'post' | 'slides' | 'video'} */ ('post'));
  const keeping = useRef({ running: false, again: false });
  // The open words editor of the preview, if any: its words are saved before another network shows.
  const editor = useRef(/** @type {{ flush: () => Promise<{ ok: boolean }> } | null} */ (null));
  const registerEditor = useCallback((handle) => {
    editor.current = handle;
  }, []);
  usePrintLight();

  /** Keeps the post as the app answered it (a function gets the latest one). */
  function setFull(next) {
    const value = typeof next === 'function' ? next(latest.current) : next;
    latest.current = value;
    setFullState(value);
  }

  const post = full.post;
  const theme = themes.find((item) => item.id === post.themeId) ?? null;
  const themeColour = theme?.colour ?? null;
  // The shared link and the addresses in the words carry the tracking fields (My plan's switch, on unless switched off;
  // never the profile link): counted, checked, previewed and shared alike.
  const tracking = trackingFor(post, { trackLinks, themes, campaigns, profileLink });
  const goesTo = postNetworks(full, networks);
  const shown = keepNetwork(network, goesTo, full.versions);
  const picture = chosenOf(full);
  const pictureRefused = picture?.cardRefused === true;
  // The state from the words as they are now (a tile reads the same checks as the records kept them).
  const now = Date.now();
  const state = postState({
    networks,
    versions: full.versions.map((item) => ({ ...item, ...mustFixOf(item, tracking) })),
    hasChosenPicture: picture !== null,
    pictureRefused,
    mainText: post.mainText,
    now,
  });
  const rest = makeRest({ networks, goesTo });
  const started = made || hasWords(full);

  /**
   * Keeps the chosen picture's copies for every network the post goes to that
   * it has no copy of yet, so Save picture saves at one press. Run after a
   * press that may leave a copy missing (a new picture, a theme, a network
   * switched on); never as the page opens (kit rule 4a), where Save picture
   * makes the one copy it needs in its own press. One run at a time: a call
   * during a run runs once more after it, on the post as it is then.
   */
  async function keepMissing() {
    const run = keeping.current;
    if (run.running) {
      run.again = true;
      return;
    }
    run.running = true;
    setPicturing(true);
    try {
      do {
        run.again = false;
        const now = latest.current;
        const chosen = chosenOf(now);
        const wanted = chosen === null || !canDraw(chosen) ? [] : missingShapes(chosen, shapesFor(now, networks));
        if (wanted.length === 0) break;
        const colour = themes.find((item) => item.id === now.post.themeId)?.colour ?? null;
        const kept = await keepShapes(chosen, wanted, { themeColour: colour, business, place: tipPlace(now, chosen) });
        setFull((before) => withPicture(before, kept));
      } while (run.again);
    } catch (error) {
      setPictureProblem(drawProblem(error));
    } finally {
      run.running = false;
      run.again = false;
      setPicturing(false);
    }
  }

  /**
   * After Make my post wrote the words: one AI picture for a post with none (from the AI's picture idea when it gave
   * one), then its copies. The strip shows a busy tile while the picture is made.
   */
  async function makePicture(idea) {
    setPicturing(true);
    setMakingPicture(true);
    setPictureProblem(null);
    try {
      const answer = await send(postAddress(post.id, '/pictures/new'), 'POST', typeof idea === 'string' && idea.trim() !== '' ? { idea } : {});
      if (!answer.ok || !answer.value?.picture) {
        const stop = answer.ok ? null : aiStopOf(answer.problem);
        if (stop !== null) setAiStop(stop);
        else setPictureProblem(answer.ok ? 'error.saveUnconfirmed' : answer.problem);
        return;
      }
      const read = await send(postAddress(post.id), 'GET');
      const again = read.ok ? postFullOf(read.value) : null;
      setFull((before) => again ?? withPicture(before, answer.value.picture));
    } finally {
      setMakingPicture(false);
      setPicturing(false);
    }
    await keepMissing();
  }

  /** Make my post; `replace` answers the "replace your changes?" question (`all` or `untouched`). */
  async function make(text, replace = null) {
    if (making || picturing || rest !== null) return;
    setMaking(true);
    setAskNote(false);
    setMakeProblem(null);
    setPictureProblem(null);
    setWithoutAi(null);
    let answer;
    try {
      answer = await send(postAddress(post.id, '/make'), 'POST', makeBody(text, replace));
    } finally {
      setMaking(false);
    }
    const next = postFullOf(answer.value?.post);
    if (next !== null) setFull(next);
    const changed = Array.isArray(answer.value?.changed) ? answer.value.changed.filter((key) => networkByKey(key) !== null) : [];
    if (changed.length > 0 && replace === null) {
      setAsk({ text, changed });
      return;
    }
    if (!answer.ok) {
      setMakeProblem(answer.problem);
      return;
    }
    setMade(true);
    const aiProblem = answer.value.ai === false && typeof answer.value.aiProblem === 'string' ? answer.value.aiProblem : null;
    setWithoutAi(aiProblem);
    // AI that answered works again; a lasting problem rests AI pictures; one that may pass leaves them pressable.
    setAiStop(answer.value.ai === true ? null : aiStopOf(aiProblem));
    if (answer.value.needsPicture === true) await makePicture(answer.value.pictureIdea);
  }

  async function changePost(saved, { theme: themeChanged = false, ask: askChanged = false, moment: momentChanged = false } = {}) {
    setFull((before) => ({ ...before, post: saved }));
    // A new ask reaches the words only when Make my post writes them again: said once, until it runs.
    if (askChanged && askNeedsMake(full)) setAskNote(true);
    // A new day or time moved the versions scheduled for a moment still ahead (or ended them): read them again.
    const scheduledMoved = momentChanged && (full?.versions ?? []).some((version) => isAhead(version?.sharedAt, Date.now()));
    if (!themeChanged && !scheduledMoved) return;
    // The app cleared the copies drawn on the old theme's colour (a words picture, a whole picture on the colour):
    // read the pictures again, then keep the missing copies, as after a new picture.
    const read = await send(postAddress(post.id), 'GET');
    const again = read.ok ? postFullOf(read.value) : null;
    if (again === null) {
      setPictureProblem(read.ok ? 'pictures.notReady' : read.problem);
      return;
    }
    setFull(again);
    if (themeChanged) await keepMissing();
  }

  /** A network switched on or off in the "⋯" menu: one switched on gets the chosen picture's copy in its shape. */
  function changeVersion(saved) {
    setFull((before) => withVersion(before, saved));
    if (saved?.on === true) keepMissing();
  }

  /** Shows another network's preview, after the open words editor saved what is not kept yet. */
  async function showNetwork(key) {
    if (key === shown) return;
    const open = editor.current;
    if (open !== null) {
      const saved = await open.flush();
      if (!saved.ok) return;
    }
    setNetwork(key);
  }

  function changeStrip(next) {
    const read = postFullOf(next);
    if (read !== null) setFull(read);
    else setFull((before) => withPicture(before, next));
  }

  /**
   * Prints one part of the post: its versions (`post`), its swipe set as a
   * document (`slides`, one slide a page) or its video plan (`video`). The
   * part is put in place first, its pictures decoded, and the versions come
   * back after the print window closes.
   */
  async function printAs(mode) {
    flushSync(() => setPrinting(mode));
    const back = () => {
      window.removeEventListener('afterprint', back);
      setPrinting('post');
    };
    if (mode !== 'post') window.addEventListener('afterprint', back);
    const images = Array.from(document.querySelectorAll('[data-print-set] img'));
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    await printPage();
  }

  const version = shown === null ? null : versionOf(full, shown);
  const slideSet = setOf(full, 'slide');
  const storySet = setOf(full, 'story');
  const shownSlides = shown === null ? null : slidesFor(shown, slideSet);
  const shownStories = shown !== null && networkByKey(shown)?.storyOk === true ? storySet : [];
  const placeOf = (each) => tipPlace(full, each);
  // The swipe set as LinkedIn takes it, for Print as a document.
  const documentSlides = goesTo.includes('linkedin') ? slidesFor('linkedin', slideSet) : null;
  const checks = version === null
    ? []
    : shownChecks(checksFor({
      network: shown,
      text: version.text,
      hashtags: version.hashtags,
      link: version.link,
      chosenPicture: picture,
      day: post.day,
      today,
      remembrance: isRemembrance(post.day, { showDays, hidden: hiddenDays }),
      shared: Boolean(version.sharedAt),
      tracking,
    }), started);

  return (
    <>
      <MakerHeader
        locale={locale}
        post={post}
        themes={themes}
        campaigns={campaigns}
        networks={networks}
        postNetworks={goesTo}
        state={state}
        today={today}
        onPost={changePost}
        onVersion={changeVersion}
        onPrint={() => printAs('post')}
        askNote={askNote}
        bestTimes={bestTimes}
      />

      <div data-print-hidden className="grid items-start gap-8 lg:grid-cols-[minmax(0,372px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <WordsBox
            locale={locale}
            postId={post.id}
            mainText={post.mainText}
            making={making}
            disabled={picturing}
            rest={rest}
            onSaved={(saved) => setFull((before) => ({ ...before, post: saved }))}
            onMake={(text) => make(text)}
          >
            {withoutAi !== null && (
              <p role="status" className="text-sm text-muted-foreground">
                {/* A lasting problem is said once, beside the AI pictures it rests. */}
                {aiStop === withoutAi ? t('maker.withoutAi', locale) : `${t('maker.withoutAi', locale)} ${t(withoutAi, locale)}`}
              </p>
            )}
            {makeProblem !== null && (
              <p role="alert" className="text-sm text-destructive">
                {t(makeProblem, locale)}
              </p>
            )}
            {pictureProblem !== null && (
              <p role="alert" className="text-sm text-destructive">
                {t(pictureProblem, locale)}
              </p>
            )}
          </WordsBox>
          <PictureStrip
            post={full}
            networks={networks}
            themeColour={themeColour}
            business={business}
            locale={locale}
            hasWords={hasWords(full)}
            making={makingPicture}
            disabled={making || picturing}
            aiStop={aiStop}
            onAiStop={setAiStop}
            onChange={changeStrip}
          />
          <VideoPlan
            locale={locale}
            post={post}
            goesTo={goesTo}
            disabled={making || picturing}
            onPost={(saved) => setFull((before) => ({ ...before, post: saved }))}
            onPrint={() => printAs('video')}
            onAiStop={setAiStop}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* With no network, Make my post says why (`makeRest`): nothing to preview or share here. */}
          {shown !== null && (
            <>
              <div role="group" aria-label={t('maker.networks', locale)} className="flex flex-wrap gap-2">
                {goesTo.map((key) => {
                  const selected = key === shown;
                  const mark = shareMark(versionOf(full, key), now);
                  return (
                    <Button
                      key={key}
                      type="button"
                      variant={selected ? 'default' : 'ghost'}
                      aria-pressed={selected}
                      onClick={() => showNetwork(key)}
                      className={cn(
                        'rounded-4xl px-3',
                        !selected && 'bg-card text-foreground/70 ring-1 ring-foreground/10 hover:bg-muted',
                      )}
                    >
                      {networkByKey(key)?.name ?? key}
                      {mark === 'shared' && <Check aria-label={t('share.sharedMark', locale)} className="size-3.5" />}
                      {mark === 'scheduled' && <CalendarClock aria-label={t('state.scheduled', locale)} className="size-3.5" />}
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-col items-start gap-5 xl:flex-row">
                <Preview
                  key={shown}
                  locale={locale}
                  postId={post.id}
                  network={shown}
                  version={version}
                  picture={picture}
                  business={business}
                  initials={initials}
                  themeColour={themeColour}
                  checks={checks}
                  slides={shownSlides ?? []}
                  stories={shownStories}
                  placeOf={placeOf}
                  linkSentence={linkSentence}
                  tracking={tracking}
                  onVersion={(saved) => setFull((before) => withVersion(before, saved))}
                  onPicture={(saved) => setFull((before) => withPicture(before, saved))}
                  onEditor={registerEditor}
                />
                <ShareSteps
                  key={`share-${shown}`}
                  locale={locale}
                  postId={post.id}
                  network={shown}
                  version={version}
                  picture={picture}
                  full={full}
                  themeColour={themeColour}
                  business={business}
                  today={today}
                  onVersion={(saved) => setFull((before) => withVersion(before, saved))}
                  onPicture={(saved) => setFull((before) => withPicture(before, saved))}
                  onPrintSlides={() => printAs('slides')}
                  tracking={tracking}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <PrintVersions
        locale={locale}
        full={full}
        networks={goesTo}
        theme={theme}
        picture={picture}
        business={business}
        themeColour={themeColour}
        today={today}
        shown={printing === 'post'}
      />
      {documentSlides !== null && (
        <PrintSlides locale={locale} full={full} slides={documentSlides} themeColour={themeColour} business={business} shown={printing === 'slides'} />
      )}
      <PrintVideoPlan locale={locale} post={post} shown={printing === 'video'} />

      <AlertDialog
        open={ask !== null}
        onOpenChange={(next) => {
          if (!next) setAsk(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('maker.replaceAsk', locale, { networks: listNames((ask?.changed ?? []).map((key) => networkByKey(key)?.name ?? key), locale) })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Keep my changes: new words only for the networks the person did not change. Closing the question writes nothing. */}
            <AlertDialogCancel
              onClick={() => {
                const text = ask?.text ?? post.mainText;
                setAsk(null);
                make(text, 'untouched');
              }}
            >
              {t('maker.keepMine', locale)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const text = ask?.text ?? post.mainText;
                setAsk(null);
                make(text, 'all');
              }}
            >
              {t('maker.replace', locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
