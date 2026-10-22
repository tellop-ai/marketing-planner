'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { t } from '../../lib/i18n/index.js';
import { sendUnconfirmed } from '../send.js';

import { joinPages, moreAddress, pageOf } from './paging.js';

/**
 * A list that came in pages: the first page the page read, then each page
 * **Show more** asked for. When the page reads again (after a save), the list
 * starts over from its new first page.
 *
 * @template {{ id: number }} T
 * @param {{ first: T[], next: string | null, path: string, query?: Record<string, string> }} input
 * @returns {{ items: T[], next: string | null, pending: boolean, problem: string | null, more: () => Promise<void> }}
 */
export function usePages({ first, next, path, query = {} }) {
  const [base, setBase] = useState(first);
  const [items, setItems] = useState(first);
  const [cursor, setCursor] = useState(next);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  if (base !== first) {
    setBase(first);
    setItems(first);
    setCursor(next);
    setProblem(null);
  }

  async function more() {
    if (cursor === null || pending) return;
    setPending(true);
    setProblem(null);
    const read = await sendUnconfirmed(moreAddress(path, query, cursor), 'GET');
    setPending(false);
    const page = read.ok ? pageOf(read.value) : null;
    if (page === null) {
      setProblem(read.ok ? 'error.storageUnreadable' : read.problem);
      return;
    }
    setItems((before) => joinPages(before, page.items));
    setCursor(page.next);
  }

  return { items, next: cursor, pending, problem, more };
}

/**
 * **Show more** under a list that has more, with its problem when a page
 * could not be read. Nothing when the list is whole.
 *
 * @param {{ locale: string, pages: { next: string | null, pending: boolean, problem: string | null, more: () => Promise<void> } }} props
 */
export function ShowMore({ locale, pages }) {
  if (pages.next === null && pages.problem === null) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {pages.next !== null && (
        <Button type="button" variant="outline" disabled={pages.pending} onClick={() => void pages.more()}>
          {t('customers.showMore', locale)}
        </Button>
      )}
      {pages.problem && <p role="alert" className="text-sm text-destructive">{t(pages.problem, locale)}</p>}
    </div>
  );
}
