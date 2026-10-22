'use client';

import { useEffect, useRef, useState } from 'react';

import { send } from '../send.js';

import { SaveQueue } from './save-queue.js';

/**
 * One My plan card's saving (`./save-queue.js` says how): `queue.change(...)`
 * as the person changes a field, `queue.flush()` when a field is left, and
 * the card's one line (`result`, for `ResultLine`). What waits is sent when
 * the page is hidden or the card goes (`keepalive`), so leaving the page
 * right after typing keeps the words.
 *
 * @param {{ onSaved?: (change: import('./save-queue.js').Change, value: any) => void }} [options]
 */
export function useAutoSave({ onSaved } = {}) {
  const [result, setResult] = useState(/** @type {{ saved?: boolean, done?: string, problem?: string, field?: string, address?: string } | null} */ (null));
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const queue = useRef(/** @type {SaveQueue | null} */ (null));
  if (queue.current === null) {
    queue.current = new SaveQueue({ send, onResult: setResult, onSaved: (change, value) => saved.current?.(change, value) });
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
