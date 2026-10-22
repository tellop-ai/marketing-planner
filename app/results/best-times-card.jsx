import { Clock } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { formatDecimal } from '../../lib/format.js';
import { t } from '../../lib/i18n/index.js';
import { needOf, slotKeys } from '../../lib/plan/best-times.js';
import { isNetworkKey, networkByKey } from '../../lib/plan/networks.js';

/** A whole count in the reader's language. @param {number} value @param {string} locale */
function whole(value, locale) {
  return formatDecimal(String(Math.max(0, Math.round(value))), locale);
}

/**
 * A day and band in words ("Thursday evenings", "perşembe akşamları"), with
 * its first letter a capital when `capital` (in the reader's language: a
 * Turkish line starts "Perşembe").
 *
 * @param {{ weekday: number, band: string }} slot
 * @param {string} locale
 * @param {{ capital?: boolean }} [options]
 */
export function slotText(slot, locale, { capital = false } = {}) {
  const keys = slotKeys(slot);
  const words = t('results.bestTimes.slot', locale, { day: t(keys.day, locale), band: t(keys.band, locale) });
  if (!capital || words === '') return words;
  const first = String.fromCodePoint(/** @type {number} */ (words.codePointAt(0)));
  return `${first.toLocaleUpperCase(locale === 'tr' ? 'tr-TR' : 'en-US')}${words.slice(first.length)}`;
}

/** What a platform still needs, in one line. @param {{ morePosts: number, moreWeeks: number }} need @param {string} locale */
function needLine({ morePosts, moreWeeks }, locale) {
  const posts = t(morePosts === 1 ? 'results.bestTimes.morePosts.one' : 'results.bestTimes.morePosts.other', locale, { count: whole(morePosts, locale) });
  const weeks = t(moreWeeks === 1 ? 'results.bestTimes.moreWeeks.one' : 'results.bestTimes.moreWeeks.other', locale, { count: whole(moreWeeks, locale) });
  if (morePosts > 0 && moreWeeks > 0) return t('results.bestTimes.needBoth', locale, { posts, weeks });
  if (morePosts > 0) return t('results.bestTimes.needPosts', locale, { posts });
  return t('results.bestTimes.needWeeks', locale, { weeks });
}

/**
 * Your best times (Results): for each of the person's platforms, the days
 * and times of day their own posts did best (`bestTimesFor`): at most three,
 * the best first, each with its usual reactions (the middle value) and how
 * many posts it is drawn from. A platform without enough posts with results
 * yet says how many more it needs; one with enough but no day and time with
 * two posts says that, and one whose days and times with two posts all do
 * worse than its usual says so. One quiet line under the list says when a
 * post counts (its planned time, else the moment it was marked shared).
 * Nothing here comes from outside the person's own numbers. It only shows;
 * nothing saves.
 *
 * @param {{ locale: string, networks: string[], bestTimes: Record<string, import('../../lib/plan/best-times.js').PlatformTimes> | null }} props
 */
export function BestTimesCard({ locale, networks, bestTimes }) {
  const shown = [...new Set(Array.isArray(networks) ? networks : [])].filter((network) => isNetworkKey(network));
  if (shown.length === 0) return null;
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
          {t('results.bestTimes.title', locale)}
        </CardTitle>
      </CardHeader>
      <CardContent className="@container">
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((network) => {
            const times = bestTimes?.[network] ?? null;
            const name = networkByKey(network)?.name ?? network;
            return (
              <li key={network} className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0 @md:flex-row @md:gap-4">
                <span className="shrink-0 text-sm font-medium @md:w-28">{name}</span>
                <div className="min-w-0 flex-1 text-sm">
                  {times?.ready ? (
                    times.slots.length > 0 ? (
                      <ol className="flex flex-col gap-1">
                        {times.slots.map((slot, index) => (
                          <li key={`${slot.weekday}-${slot.band}`} className="flex flex-wrap items-baseline gap-x-2">
                            <span className={cn('break-words', index === 0 ? 'font-semibold' : 'text-foreground')}>{slotText(slot, locale, { capital: true })}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {t(Math.round(slot.median) === 1 ? 'results.bestTimes.usually.one' : 'results.bestTimes.usually.other', locale, { count: whole(slot.median, locale) })}
                              {' · '}
                              {t(slot.shares === 1 ? 'results.bestTimes.posts.one' : 'results.bestTimes.posts.other', locale, { count: whole(slot.shares, locale) })}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-muted-foreground">{t(times.steady > 0 ? 'results.bestTimes.noneBetter' : 'results.bestTimes.noneYet', locale)}</p>
                    )
                  ) : (
                    <p className="text-muted-foreground">{needLine(needOf(bestTimes, network), locale)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{t('results.bestTimes.when', locale)}</p>
      </CardContent>
    </Card>
  );
}
