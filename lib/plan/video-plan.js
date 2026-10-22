/**
 * A post's video plan: words only, never a video. The app
 * edits no video; the plan says what to film and what to write on screen:
 *
 * - `hook`: the first second's words, what stops the scroll;
 * - `shots`: 1 to `VIDEO_PLAN.shots` shots, each `{ what, seconds }` (what to
 *   film, one line; 1 to 60 seconds);
 * - `onScreen`: at most `VIDEO_PLAN.onScreen` lines of words shown on the video;
 * - `cover`: what the cover picture shows.
 *
 * Each text holds at most `VIDEO_PLAN.letters` letters. A post keeps the plan
 * as JSON text (`Post.videoPlan`) of at most `VIDEO_PLAN.bytes` UTF-8 bytes;
 * `''` is no plan. Pure: the browser loads it too.
 */

import { readWords } from './limits.js';

export const VIDEO_PLAN = Object.freeze({ shots: 6, onScreen: 6, letters: 300, seconds: [1, 60], bytes: 4000 });

/** The refusal key for a plan whose shape is not one (the limit readers add `refuse.text.*`). */
export const VIDEO_PLAN_REFUSAL = 'refuse.post.videoPlan';

/** @param {unknown} value */
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * One line of the plan's words, through `readWords` (one line, at most
 * `VIDEO_PLAN.letters`). Not text at all: the plan's own refusal.
 *
 * @param {unknown} value
 * @param {{ required?: boolean }} [options]
 */
function line(value, { required = false } = {}) {
  if (value !== undefined && value !== null && typeof value !== 'string') return { ok: false, problem: VIDEO_PLAN_REFUSAL };
  return readWords(value, VIDEO_PLAN.letters, { required });
}

/**
 * A video plan as the post maker sends it, read and turned into the text a
 * post keeps:
 *
 * - `''` or `null`: no plan (`value` is `''`);
 * - an object `{ hook?, shots, onScreen?, cover? }`: kept as JSON with only
 *   those fields, each line trimmed; empty on-screen lines are left out.
 *
 * Refused: another shape, no shot or more than six, a shot's seconds not a
 * whole number from 1 to 60, more than six lines on screen
 * (`refuse.post.videoPlan`); a shot with no words (`refuse.text.missing`); a
 * line over 300 letters or a plan over 4,000 bytes (`refuse.text.long`).
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string, plan: { hook: string, shots: Array<{ what: string, seconds: number }>, onScreen: string[], cover: string } | null }
 *   | { ok: false, problem: string }}
 */
export function readVideoPlan(value) {
  if (value === '' || value === null) return { ok: true, value: '', plan: null };
  if (!isPlain(value)) return { ok: false, problem: VIDEO_PLAN_REFUSAL };
  const input = /** @type {Record<string, unknown>} */ (value);
  const hook = line(input.hook);
  if (!hook.ok) return hook;
  const cover = line(input.cover);
  if (!cover.ok) return cover;
  if (!Array.isArray(input.shots) || input.shots.length === 0 || input.shots.length > VIDEO_PLAN.shots) return { ok: false, problem: VIDEO_PLAN_REFUSAL };
  const shots = [];
  for (const shot of input.shots) {
    if (!isPlain(shot)) return { ok: false, problem: VIDEO_PLAN_REFUSAL };
    const what = line(shot.what, { required: true });
    if (!what.ok) return what;
    const [least, most] = VIDEO_PLAN.seconds;
    if (typeof shot.seconds !== 'number' || !Number.isInteger(shot.seconds) || shot.seconds < least || shot.seconds > most) return { ok: false, problem: VIDEO_PLAN_REFUSAL };
    shots.push({ what: what.value, seconds: shot.seconds });
  }
  const sentLines = input.onScreen === undefined || input.onScreen === null ? [] : input.onScreen;
  if (!Array.isArray(sentLines) || sentLines.length > VIDEO_PLAN.onScreen) return { ok: false, problem: VIDEO_PLAN_REFUSAL };
  const onScreen = [];
  for (const item of sentLines) {
    const read = line(item);
    if (!read.ok) return read;
    if (read.value !== '') onScreen.push(read.value);
  }
  const plan = { hook: hook.value, shots, onScreen, cover: cover.value };
  const text = JSON.stringify(plan);
  if (new TextEncoder().encode(text).length > VIDEO_PLAN.bytes) return { ok: false, problem: 'refuse.text.long' };
  return { ok: true, value: text, plan };
}

/**
 * The plan a post keeps (`Post.videoPlan`, the text `readVideoPlan` made), or
 * null when it has none or its text is not a plan.
 *
 * @param {unknown} text
 */
export function videoPlanOf(text) {
  if (typeof text !== 'string' || text === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const read = readVideoPlan(parsed);
  return read.ok ? read.plan : null;
}

/** A plan's length in seconds: its shots added up (0 for none). @param {{ shots?: Array<{ seconds: number }> } | null} plan */
export function videoPlanSeconds(plan) {
  return (plan?.shots ?? []).reduce((sum, shot) => sum + (Number.isInteger(shot?.seconds) ? shot.seconds : 0), 0);
}
