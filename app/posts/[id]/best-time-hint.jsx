import { Clock } from 'lucide-react';

import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { isNetworkKey, networkByKey } from '../../../lib/plan/networks.js';
import { slotText } from '../../results/best-times-card.jsx';

/**
 * The best time hint under the post's day and time: for each of the post's
 * platforms whose best times show (`bestTimesFor`: enough of the person's
 * own posts with results), one quiet line such as "Your Instagram posts do
 * best on Thursday evenings". Nothing for a platform without enough yet, and
 * nothing at all when no platform has; it only shows.
 *
 * @param {{ locale: string, networks: string[], bestTimes: Record<string, import('../../../lib/plan/best-times.js').PlatformTimes> | null, className?: string }} props
 */
export function BestTimeHint({ locale, networks, bestTimes, className }) {
  const lines = [...new Set(Array.isArray(networks) ? networks : [])]
    .filter((network) => isNetworkKey(network))
    .map((network) => ({ network, best: bestTimes?.[network]?.ready ? bestTimes[network].best : null }))
    .filter((line) => line.best !== null);
  if (lines.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-1 text-xs text-muted-foreground', className)}>
      {lines.map(({ network, best }) => (
        <p key={network} className="flex items-start gap-1.5">
          <Clock aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {t('maker.bestTime', locale, { network: networkByKey(network)?.name ?? network, when: slotText(best, locale) })}
          </span>
        </p>
      ))}
    </div>
  );
}
