import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { networkByKey } from '../../../lib/plan/networks.js';
import { PictureThumb } from '../../pictures/thumb.jsx';

import { aspectOf, dayText, shapeOf, timeText, versionOf } from './rules.js';

/**
 * The post's versions as a page, for someone who checks the words: shown only
 * on paper (the maker's controls are hidden there). The name, the day and
 * the theme, the chosen picture, then each network's words, hashtags, link
 * and first comment. `shown`: false while the maker prints something else
 * (the swipe set as a document, the video plan). `onScreen`: shown on the
 * screen too, as the post's page for a person who may not change it
 * (`./post-view.jsx`).
 *
 * @param {{ locale: string, full: any, networks: string[], theme: { name: string } | null, picture: any,
 *   business: string, themeColour: number | null, today: string, shown?: boolean, onScreen?: boolean }} props
 */
export function PrintVersions({ locale, full, networks, theme, picture, business, themeColour, today, shown = true, onScreen = false }) {
  const { post } = full;
  const day = post.day ? dayText(post.day, locale, today) : '';
  const when = day && post.time ? t('maker.when', locale, { day, time: timeText(post.time, locale) }) : day;
  const first = networks[0] ?? null;
  return (
    <section className={cn('hidden flex-col gap-5', shown && 'print:flex', onScreen && 'flex')}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{post.name || t('post.untitled', locale)}</h1>
        {(when || theme) && <p className="text-sm text-muted-foreground">{[when, theme?.name].filter(Boolean).join(' · ')}</p>}
      </div>
      {post.mainText !== '' && <p className="whitespace-pre-line text-sm">{post.mainText}</p>}
      {picture !== null && first !== null && (
        <div className={`w-48 overflow-hidden rounded-lg ${aspectOf(shapeOf(first))}`}>
          <PictureThumb picture={picture} shape={shapeOf(first)} themeColour={themeColour} business={business} locale={locale} />
        </div>
      )}
      {networks.map((network) => {
        const version = versionOf(full, network);
        return (
          <article key={network} className="flex break-inside-avoid flex-col gap-1.5 border-t border-border pt-3 text-sm">
            <h2 className="font-semibold">{networkByKey(network)?.name ?? network}</h2>
            <p className="whitespace-pre-line">{version.text || t('check.noWords', locale)}</p>
            {version.hashtags !== '' && <p className="text-primary">{version.hashtags}</p>}
            {version.link !== '' && (
              <p>
                <span className="text-muted-foreground">{t('maker.link', locale)}: </span>
                {version.link}
              </p>
            )}
            {version.firstComment !== '' && (
              <p className="whitespace-pre-line">
                <span className="text-muted-foreground">{t('maker.firstComment', locale)}: </span>
                {version.firstComment}
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
