/**
 * The video plan panel's rules that need no page (a plan is
 * words only): the panel's draft and the plan it saves, whether the panel
 * shows, and the plan as plain text for Copy as text. Pure, so the checks
 * call them (`tests/maker.test.mjs`).
 */

import { t } from '../../../lib/i18n/index.js';
import { VIDEO_PLAN, readVideoPlan, videoPlanOf, videoPlanSeconds } from '../../../lib/plan/video-plan.js';

/** The networks whose posts are videos: the panel shows open for a post that goes to one. */
export const VIDEO_NETWORKS = Object.freeze(['tiktok', 'youtube']);

/**
 * Whether the panel shows open: the post has a plan, or goes to a video
 * network. Any other post shows **Plan a video**, which opens it.
 *
 * @param {string} videoPlan the post's kept plan (`''` for none)
 * @param {string[]} goesTo the networks the post goes to
 */
export function videoPanelOpen(videoPlan, goesTo) {
  return videoPlanOf(videoPlan) !== null || (Array.isArray(goesTo) && goesTo.some((key) => VIDEO_NETWORKS.includes(key)));
}

/**
 * The panel's draft of a kept plan: every line as typed text (a shot's
 * seconds too, so a field can be empty while it is typed). Null for no plan.
 *
 * @param {string} videoPlan
 * @returns {{ hook: string, shots: { what: string, seconds: string }[], onScreen: string[], cover: string } | null}
 */
export function draftOf(videoPlan) {
  const plan = videoPlanOf(videoPlan);
  if (plan === null) return null;
  return {
    hook: plan.hook,
    shots: plan.shots.map((shot) => ({ what: shot.what, seconds: String(shot.seconds) })),
    onScreen: [...plan.onScreen],
    cover: plan.cover,
  };
}

/**
 * Seconds as typed: a whole number written with digits only (spaces around
 * it allowed); anything else is not a number (the plan's reader refuses it).
 *
 * @param {unknown} text
 */
export function secondsOf(text) {
  const value = String(text ?? '').trim();
  return /^\d{1,3}$/u.test(value) ? Number(value) : Number.NaN;
}

/**
 * The draft read as the app reads a plan (`readVideoPlan`): `{ ok, value,
 * plan }` with the text the post keeps, or `{ ok: false, problem }`.
 *
 * @param {{ hook: string, shots: { what: string, seconds: string }[], onScreen: string[], cover: string }} draft
 */
export function readDraft(draft) {
  return readVideoPlan({
    hook: String(draft?.hook ?? ''),
    shots: (draft?.shots ?? []).map((shot) => ({ what: String(shot?.what ?? ''), seconds: secondsOf(shot?.seconds) })),
    onScreen: (draft?.onScreen ?? []).map((line) => String(line ?? '')),
    cover: String(draft?.cover ?? ''),
  });
}

/** Whether one more shot or one more line on screen fits the plan. */
export function canAdd(draft, part) {
  if (part === 'shots') return (draft?.shots ?? []).length < VIDEO_PLAN.shots;
  return (draft?.onScreen ?? []).length < VIDEO_PLAN.onScreen;
}

/**
 * The plan as plain text, in the person's language: the hook, the shots
 * numbered with their seconds, the lines on screen, the cover and the length
 * in all. Parts with no words are left out.
 *
 * @param {{ hook: string, shots: { what: string, seconds: number }[], onScreen: string[], cover: string } | null} plan
 * @param {string} locale
 */
export function planText(plan, locale) {
  if (plan === null || typeof plan !== 'object') return '';
  const lines = [];
  if (plan.hook) lines.push(`${t('maker.video.hook', locale)}: ${plan.hook}`);
  if (plan.shots.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`${t('maker.video.shots', locale)}:`);
    plan.shots.forEach((shot, index) => lines.push(`${index + 1}. ${shot.what} (${t('maker.video.seconds', locale, { n: String(shot.seconds) })})`));
  }
  if (plan.onScreen.length > 0) {
    lines.push('', `${t('maker.video.onScreen', locale)}:`);
    for (const line of plan.onScreen) lines.push(`- ${line}`);
  }
  if (plan.cover) lines.push('', `${t('maker.video.cover', locale)}: ${plan.cover}`);
  lines.push('', t('maker.video.total', locale, { n: String(videoPlanSeconds(plan)) }));
  return lines.join('\n');
}
