'use client';

import { useEffect, useRef, useState } from 'react';

import { useRights } from '../rights.jsx';
import { send } from '../send.js';

import { SaveQueue } from './save-queue.js';

/**
 * One My plan card's saving (`./save-queue.js` says how): `queue.change(...)`
 * as the person changes a field, `queue.flush()` when a field is left, and
 * the card's one line (`result`, for `ResultLine`). What waits is sent when
 * the page is hidden or the card goes (`keepalive`), so leaving the page
 * right after typing keeps the words.
 *
 * My plan is the business's shared settings: for a person who may not change
 * them (`useRights`) nothing is ever sent from here (the page draws its
 * fields unchangeable too); a change that still reached the queue answers
 * `error.cannotChange` and stays on the page.
 *
 * @param {{ onSaved?: (change: import('./save-queue.js').Change, value: any) => void }} [options]
 */
export function useAutoSave({ onSaved } = {}) {
  const [result, setResult] = useState(/** @type {{ saved?: boolean, done?: string, problem?: string, field?: string, address?: string } | null} */ (null));
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const { change: canChange } = useRights();
  const allowed = useRef(canChange);
  allowed.current = canChange;
  const queue = useRef(/** @type {SaveQueue | null} */ (null));
  if (queue.current === null) {
    /** @type {typeof send} */
    const sendAllowed = (...args) => (allowed.current ? send(...args) : Promise.resolve({ ok: false, problem: 'error.cannotChange', value: null }));
    queue.current = new SaveQueue({ send: sendAllowed, onResult: setResult, onSaved: (change, value) => saved.current?.(change, value) });
  }

  useEffect(() => {
    const current = queue.current;
    const hidden = () => current?.leave();
    window.addEventListener('pagehide', hidden);
    return () => {
      window.removeEventListener('pagehide', hidden);
      current?.leave();
    };
  }, []);

  return { queue: queue.current, result, setResult };
}

/**
 * Whether the card's line is a refusal about this field of this address.
 *
 * @param {{ problem?: string, field?: string, address?: string } | null} result
 * @param {string} address
 * @param {string} field
 */
export function refusedHere(result, address, field) {
  return (Boolean(result?.problem) && result?.address === address && result?.field === field) || undefined;
}
