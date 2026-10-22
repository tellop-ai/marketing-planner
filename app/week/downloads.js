/**
 * The week page's two whole-week downloads, as hooks for its header (browser
 * only; nothing runs when this file loads):
 *
 * - **Save all pictures**: one press fetches every kept picture copy the
 *   week's switched-on platforms use, and draws the words pictures of each
 *   swipe set a platform takes (`picturePlan`, at most `AT_ONCE` at a
 *   time), builds one zip in the page (`lib/plan/zip.js`), keeps it through
 *   `POST /api/downloads` and downloads it in the same press while the press
 *   still counts (`pressStillCounts`), else offers a Download press. The posts whose pictures were not ready are named, to open.
 * - **Add to my calendar**: `POST /api/export/calendar { from, to }` keeps the
 *   week's calendar file in a zip, then downloads it the same way.
 *
 * Nothing here claims a save: a line shows only what the app answered.
 */

import { useMemo, useState } from 'react';

import { t } from '../../lib/i18n/index.js';
import { drawShape } from '../../lib/plan/draw.js';
import { problemOf } from '../../lib/plan/picture-rules.js';
import { zipFiles } from '../../lib/plan/zip.js';
import { pressStillCounts } from '../posts/[id]/rules.js';
import { send } from '../send.js';

import { AT_ONCE, collectPictures, joinNotReady, picturePlan, saveAllRest } from './rules.js';

/** Starts the download of an address as a press on a link would, under `name`. @param {string} address @param {string} name */
export function startDownload(address, name) {
  const link = document.createElement('a');
  link.href = address;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/** One kept picture's bytes and kind. @param {string} address */
async function fetchFile(address) {
  const response = await fetch(address);
  if (!response.ok) return { ok: false, type: null, bytes: null };
  return { ok: true, type: response.headers.get('content-type'), bytes: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * A words picture of a swipe set drawn now in a shape, with its tip's place
 * and the post's theme colour, as the post maker draws it (nothing kept).
 *
 * @param {{ picture: any, shape: string, place: number | null, themeId: number | null }} draw
 * @param {(themeId: number | null) => number | null} colourOf
 * @param {string} business
 */
async function drawFile(draw, colourOf, business) {
  const blob = await drawShape(draw.picture, draw.shape, { themeColour: colourOf(draw.themeId), business, place: draw.place });
  return { ok: true, type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

/**
 * Keeps a zip the page built and answers its download address.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ ok: true, address: string } | { ok: false, problem: string }>}
 */
async function keepZip(bytes) {
  let response;
  try {
    response = await fetch('/api/downloads', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/zip' }, body: bytes });
  } catch {
    return { ok: false, problem: 'error.saveFailed' };
  }
  const value = await response.json().catch(() => null);
  if (!response.ok || typeof value?.address !== 'string') return { ok: false, problem: problemOf(value, 'error.saveFailed') };
  return { ok: true, address: value.address };
}

/**
 * @typedef {{ address?: string, name?: string, problem?: string, notReady: Array<{ id: number, name: string, count: number }> }} PicturesResult
 */

/**
 * Save all pictures. `rest` is the reason the press rests (no picture is
 * ready yet, or more than one zip holds), else null; `none` is true when the
 * week has no picture at all (the press is then not drawn).
 *
 * @param {{ locale: string, from: string, posts: Array<{ id: number, name: string, day: string | null, networks: string[], picture: any, slides?: any[] }>,
 *   colourOf: (themeId: number | null) => number | null, business: string }} input
 */
export function useSaveAllPictures({ locale, from, posts, colourOf, business }) {
  const plan = useMemo(() => picturePlan(posts), [posts]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(/** @type {PicturesResult | null} */ (null));
  const none = plan.files.length === 0 && plan.notReady.length === 0;
  const rest = saveAllRest(plan);

  async function run() {
    if (pending || rest !== null) return;
    const pressed = Date.now();
    setPending(true);
    setResult(null);
    try {
      const got = await collectPictures(plan.files, fetchFile, AT_ONCE, (draw) => drawFile(draw, colourOf, business));
      const notReady = joinNotReady(plan.notReady, got.failed, posts);
      if (got.ready.length === 0) {
        setResult({ problem: 'week.saveAllNone', notReady });
        return;
      }
      let zip;
      try {
        zip = zipFiles(got.ready);
      } catch {
        setResult({ problem: 'week.tooMany', notReady });
        return;
      }
      const kept = await keepZip(zip);
      if (!kept.ok) {
        setResult({ problem: kept.problem, notReady });
        return;
      }
      const name = t('week.zipName', locale, { day: from });
      if (pressStillCounts(globalThis.navigator?.userActivation, Date.now() - pressed)) {
        startDownload(kept.address, name);
        setResult({ notReady });
      } else {
        setResult({ address: kept.address, name, notReady });
      }
    } finally {
      setPending(false);
    }
  }

  return { plan, pending, result, rest, none, run };
}

/**
 * Add to my calendar: the week's seven days as a calendar file, in a zip.
 *
 * @param {{ locale: string, from: string, to: string }} input
 */
export function useAddToCalendar({ locale, from, to }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(/** @type {{ address?: string, name?: string, problem?: string } | null} */ (null));

  async function run() {
    if (pending) return;
    const pressed = Date.now();
    setPending(true);
    setResult(null);
    const made = await send('/api/export/calendar', 'POST', { from, to });
    setPending(false);
    if (!made.ok || typeof made.value?.address !== 'string') {
      const problem = made.ok ? 'error.saveUnconfirmed' : made.problem;
      setResult({ problem: problem === 'calendar.export.empty' ? 'week.calendarEmpty' : problem });
      return;
    }
    const name = t('calendar.export.zipName', locale, { month: from });
    if (pressStillCounts(globalThis.navigator?.userActivation, Date.now() - pressed)) {
      startDownload(made.value.address, name);
      return;
    }
    setResult({ address: made.value.address, name });
  }

  return { pending, result, run };
}
