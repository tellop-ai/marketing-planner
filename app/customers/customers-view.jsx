'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { t } from '../../lib/i18n/index.js';

import { CameTab } from './came-tab.jsx';
import { SaidTab } from './said-tab.jsx';

/**
 * The Customers page's two tabs: Who came and What they said. The chosen tab
 * is kept in the address (`?tab=said`) so a refresh opens it again; nothing is
 * saved by choosing one.
 *
 * Each list shows its first page (`enquiries`, `comments`) and, while
 * more come after it (`enquiriesNext`, `commentsNext`), Show more.
 *
 * @param {{ locale: string, tab: 'came' | 'said', month: string, today: string, enquiries: object[], enquiriesNext: string | null,
 *   totals: { count: number, bought: number, amount: number, byChannel: Record<string, number> },
 *   comments: object[], commentsNext: string | null, posts: { id: number, name: string, day: string }[], networks: string[],
 *   business: string, reviewLink: string }} props
 */
export function CustomersView({ locale, tab, month, today, enquiries, enquiriesNext, totals, comments, commentsNext, posts, networks, business, reviewLink }) {
  const [current, setCurrent] = useState(tab);

  /** @param {unknown} next */
  function choose(next) {
    if (next !== 'came' && next !== 'said') return;
    setCurrent(next);
    try {
      const address = new URL(window.location.href);
      if (next === 'said') address.searchParams.set('tab', 'said');
      else address.searchParams.delete('tab');
      window.history.replaceState(window.history.state, '', address);
    } catch {
      // The tab still changes; only a refresh would open the other one.
    }
  }

  return (
    <Tabs value={current} onValueChange={choose} className="gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('customers.title', locale)}</h1>
        <TabsList>
          <TabsTrigger value="came">{t('customers.tab.came', locale)}</TabsTrigger>
          <TabsTrigger value="said">{t('customers.tab.said', locale)}</TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="came">
        <CameTab locale={locale} month={month} today={today} enquiries={enquiries} next={enquiriesNext} totals={totals} posts={posts} networks={networks} />
      </TabsContent>
      <TabsContent value="said">
        <SaidTab locale={locale} today={today} comments={comments} next={commentsNext} networks={networks} business={business} reviewLink={reviewLink} />
      </TabsContent>
    </Tabs>
  );
}
