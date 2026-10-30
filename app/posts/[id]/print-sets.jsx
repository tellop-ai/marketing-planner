import { cn } from '@/lib/utils';

import { t } from '../../../lib/i18n/index.js';
import { videoPlanOf, videoPlanSeconds } from '../../../lib/plan/video-plan.js';
import { pictureWords, tipPlace } from '../../pictures/rules.js';
import { PictureThumb } from '../../pictures/thumb.jsx';

/**
 * The swipe set as a document, for LinkedIn's "document" posts: one slide a
 * page, in the portrait shape, shown only on paper while the maker prints it
 * (`shown`); the person saves it as a PDF from the print window. Words
 * pictures are drawn by the page, so a tip's number follows the set's order.
 *
 * @param {{ locale: string, full: any, slides: any[], themeColour: number | null, business: string, shown: boolean }} props
 */
export function PrintSlides({ locale, full, slides, themeColour, business, shown }) {
  return (
    <section data-print-set="slides" className={cn('hidden', shown && 'print:block')}>
      {slides.map((picture) => (
        <div key={picture.id} className="aspect-[4/5] w-full break-inside-avoid break-after-page overflow-hidden last:break-after-auto">
          <PictureThumb
            picture={picture}
            shape="portrait"
            themeColour={themeColour}
            business={business}
            locale={locale}
            alt={pictureWords(picture) || t('pictures.alt', locale)}
            wordsFirst
            place={tipPlace(full, picture)}
          />
        </div>
      ))}
    </section>
  );
}

/**
 * The post's video plan as a page, shown only on paper while the maker
 * prints it (`shown`): the post's name, the plan's length, the hook, the
 * shots with their seconds, the lines on screen and the cover. `onScreen`:
 * shown on the screen too, under the post's words (`./post-view.jsx`), where
 * the post's own name above it stands for its heading.
 *
 * @param {{ locale: string, post: any, shown: boolean, onScreen?: boolean }} props
 */
export function PrintVideoPlan({ locale, post, shown, onScreen = false }) {
  const plan = videoPlanOf(post.videoPlan);
  if (plan === null) return null;
  return (
    <section className={cn('hidden flex-col gap-4 text-sm', shown && 'print:flex', onScreen && 'flex border-t border-border pt-3')}>
      {onScreen ? (
        <h2 className="text-base font-semibold">
          {t('maker.video.title', locale)} · {t('maker.video.total', locale, { n: String(videoPlanSeconds(plan)) })}
        </h2>
      ) : (
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{post.name || t('post.untitled', locale)}</h1>
          <p className="text-muted-foreground">
            {t('maker.video.title', locale)} · {t('maker.video.total', locale, { n: String(videoPlanSeconds(plan)) })}
          </p>
        </div>
      )}
      {plan.hook !== '' && (
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{t('maker.video.hook', locale)}</h2>
          <p className="whitespace-pre-line">{plan.hook}</p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{t('maker.video.shots', locale)}</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {plan.shots.map((shot, index) => (
            <li key={index}>
              {shot.what} <span className="text-muted-foreground">({t('maker.video.seconds', locale, { n: String(shot.seconds) })})</span>
            </li>
          ))}
        </ol>
      </div>
      {plan.onScreen.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{t('maker.video.onScreen', locale)}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {plan.onScreen.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.cover !== '' && (
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{t('maker.video.cover', locale)}</h2>
          <p>{plan.cover}</p>
        </div>
      )}
    </section>
  );
}
