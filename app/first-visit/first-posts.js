/**
 * The press that ends the first-visit start, Make my first four posts, as
 * one function the dialog calls with its two ways of sending (`../send.js`)
 * and the checks call with fake ones. Nothing runs when this file loads.
 *
 * 1. The start is saved (`POST /api/plan/start`): the business's name, the
 *    platforms and a theme for each idea.
 * 2. Fill my month proposes ideas for the seven days from today only (a span
 *    `{ from, to }`, across a month's end too), in one request: the AI
 *    (`/api/ai/fill-month`), or without AI when `useAi` is false
 *    (`/api/month/plan`, named from the idea starters).
 * 3. Four of the proposals in those seven days, spread over them, are kept as
 *    idea posts on their days (`POST /api/month/keep`, one request a month).
 *
 * `done` remembers what already happened, so pressing again after a problem
 * never saves the start twice, never asks for proposals again once four were
 * picked, and never keeps a month twice.
 */

import { byMonth, inWindow, POSTS_A_WEEK, spreadPick, starterNamed, windowOf } from './rules.js';

/**
 * @typedef {(address: string, method: string, body?: unknown) => Promise<{ ok: true, value: any } | { ok: false, problem: string, field?: string }>} Sender
 * @typedef {{ day: string, name: string, themeId: number | null, specialDay?: string, madeBy: 'ai' | 'person' }} Pick
 * @typedef {{ started: { themes: Array<{ id: number, idea: string | null }> } | null, picks: Pick[] | null, kept: Set<string> }} Done
 */

/** What a start remembers before its first press. @returns {Done} */
export function freshStart() {
  return { started: null, picks: null, kept: new Set() };
}

/**
 * @param {{ send: Sender, sendUnconfirmed: Sender, today: string, businessName: string, networks: string[], ideas: string[],
 *   useAi: boolean, words: (key: string) => string, done: Done }} input
 * @returns {Promise<{ ok: true, kept: number } | { ok: false, problem: string, field?: string, aiFailed?: boolean }>}
 */
export async function makeFirstPosts({ send, sendUnconfirmed, today, businessName, networks, ideas, useAi, words, done }) {
  if (done.started === null) {
    const sent = await send('/api/plan/start', 'POST', { businessName, networks, themes: ideas });
    if (!sent.ok) return { ok: false, problem: sent.problem, ...(sent.field ? { field: sent.field } : {}) };
    done.started = sent.value;
  }
  if (done.picks === null) {
    const themes = Array.isArray(done.started?.themes) ? done.started.themes : [];
    const themeIds = themes.map((theme) => theme.id);
    const ideaOf = new Map(themes.filter((theme) => theme.idea).map((theme) => [theme.id, /** @type {string} */ (theme.idea)]));
    const { from, to } = windowOf(today);
    const sent = useAi
      ? await sendUnconfirmed('/api/ai/fill-month', 'POST', { from, to, perWeek: POSTS_A_WEEK, themeIds, networks })
      : await sendUnconfirmed('/api/month/plan', 'POST', { from, to, perWeek: POSTS_A_WEEK, themeIds });
    if (!sent.ok || !Array.isArray(sent.value?.proposals)) {
      return { ok: false, problem: sent.ok ? 'error.storageUnreadable' : sent.problem, ...(useAi ? { aiFailed: true } : {}) };
    }
    const proposals = inWindow(sent.value.proposals, today);
    const named = useAi ? proposals : starterNamed(proposals, ideaOf, words);
    /** @type {Pick[]} */
    const found = named.map((proposal) => ({ ...proposal, madeBy: /** @type {'ai' | 'person'} */ (useAi ? 'ai' : 'person') }));
    const picks = spreadPick(found);
    if (picks.length === 0) return { ok: false, problem: 'start.none' };
    done.picks = picks;
  }
  for (const { month, proposals } of byMonth(done.picks)) {
    if (done.kept.has(month)) continue;
    const sent = await sendUnconfirmed('/api/month/keep', 'POST', {
      month,
      madeBy: proposals[0].madeBy,
      proposals: proposals.map(({ day, name, themeId, specialDay }) => ({ day, name, themeId, ...(specialDay ? { specialDay } : {}) })),
    });
    if (!sent.ok) return { ok: false, problem: sent.problem };
    done.kept.add(month);
  }
  return { ok: true, kept: done.picks.length };
}
