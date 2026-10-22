/**
 * The one way a page sends a request to the app's own addresses and reads the
 * answer (browser only; nothing runs when this file loads).
 *
 * An answer is `{ ok: true, value }` only when the address answered with a
 * success and an object. Anything else is `{ ok: false, problem, field?,
 * value }`: the refusal's words key (`problem`, or an AI problem's
 * `aiProblem`, read by `problemOf`), the field it is about when the address
 * names one, and the answer itself (null when none could be read). With no
 * readable refusal (no answer, an unreadable one, or one without a key) the
 * problem is `unanswered`. Nothing here claims a save: the caller shows what
 * happened only when `ok` is true, and keeps what the person typed when it is
 * not (the kit's AGENTS.md rule 4a).
 */

import { problemOf } from '../lib/plan/picture-rules.js';

/** The most bytes a request sent with `keepalive` may carry, a little under the browser's 64 KB. */
const KEEPALIVE_MOST = 60_000;

/**
 * Sends one JSON request (or a read, `GET`, with no body).
 *
 * `keepalive`: the request goes on after the page is left (a save sent as the
 * person leaves). The browser takes such a request only up to 64 KB, so a
 * larger one is sent as an ordinary request.
 *
 * @param {string} address
 * @param {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} method
 * @param {unknown} [body]
 * @param {{ keepalive?: boolean, unanswered?: string }} [options] `unanswered`: the words key when no readable refusal came back (`error.saveFailed`)
 * @returns {Promise<{ ok: true, value: any } | { ok: false, problem: string, field?: string, value: any }>}
 */
export async function send(address, method, body, { keepalive = false, unanswered = 'error.saveFailed' } = {}) {
  let response;
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    response = await fetch(address, {
      method,
      cache: 'no-store',
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload,
      keepalive: keepalive && (payload === undefined || new TextEncoder().encode(payload).length <= KEEPALIVE_MOST),
    });
  } catch {
    return { ok: false, problem: unanswered, value: null };
  }
  return readAnswer(response, unanswered);
}

/**
 * `send` for the calendar and the customers pages, which say that a request
 * without a readable answer is unconfirmed: a change may or may not have been
 * kept (`error.saveUnconfirmed`), a read found nothing it can trust
 * (`error.storageUnreadable`).
 *
 * @param {string} address
 * @param {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} method
 * @param {unknown} [body]
 */
export function sendUnconfirmed(address, method, body) {
  return send(address, method, body, { unanswered: method === 'GET' ? 'error.storageUnreadable' : 'error.saveUnconfirmed' });
}

/**
 * Sends a form (a picture's digest, never the picture: `appendPicture` keeps
 * it first) and reads the answer as `send` does.
 *
 * @param {string} address
 * @param {FormData} form
 */
export async function sendForm(address, form) {
  let response;
  try {
    response = await fetch(address, { method: 'POST', body: form });
  } catch {
    return { ok: false, problem: 'error.saveFailed', value: null };
  }
  return readAnswer(response, 'error.saveFailed');
}

/** @param {Response} response @param {string} unanswered */
async function readAnswer(response, unanswered) {
  const value = await response.json().catch(() => null);
  if (!response.ok || value === null || typeof value !== 'object') {
    return {
      ok: false,
      problem: problemOf(value, unanswered),
      ...(typeof value?.field === 'string' ? { field: value.field } : {}),
      value,
    };
  }
  return { ok: true, value };
}
