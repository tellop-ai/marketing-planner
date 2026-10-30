'use client';

import { ArrowLeft, Printer, Repeat2 } from 'lucide-react';
import { useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';

import { t } from '../../../lib/i18n/index.js';
import { mustFixOf } from '../../../lib/plan/checks.js';
import { trackingFor } from '../../../lib/plan/share.js';
import { postState, stateWordsOf } from '../../../lib/plan/state.js';
import { chosenOf, postNetworks } from '../../pictures/rules.js';
import { useRights } from '../../rights.jsx';
import { printPage, usePrintLight } from '../print-light.js';

import { PostAgainDialog } from './post-again.jsx';
import { PrintVideoPlan } from './print-sets.jsx';
import { PrintVersions } from './print-view.jsx';

/**
 * One post for a person who may not change it (a Member or a Viewer: the app
 * cannot tell which posts a Member added, `lib/plan/roles.js`): the post's
 * page as it prints (`PrintVersions`: its name, day, theme, main words, chosen
 * picture and each network's words), its video plan when it has one, the
 * state the app works out, Print, and for a person who may add, Post again (a
 * copy of it on a free day, `PostAgainDialog`). Nothing here saves on its own.
 *
 * @param {{
 *   locale: string, initial: any, networks: string[], themes: { id: number, name: string, colour: number, archived: boolean }[],
 *   campaigns: { id: number, name: string, status: string }[], business: string, today: string, trackLinks?: boolean | null,
 *   profileLink?: string,
 * }} props
 */
export function PostView({ locale, initial: full, networks, themes, campaigns, business, today, trackLinks = true, profileLink = '' }) {
  const { add } = useRights();
  const [again, setAgain] = useState(false);
  usePrintLight();

  const { post } = full;
  const theme = themes.find((item) => item.id === post.themeId) ?? null;
  const tracking = trackingFor(post, { trackLinks, themes, campaigns, profileLink });
  const picture = chosenOf(full);
  const state = postState({
    networks,
    versions: full.versions.map((item) => ({ ...item, ...mustFixOf(item, tracking) })),
    hasChosenPicture: picture !== null,
    pictureRefused: picture?.cardRefused === true,
    mainText: post.mainText,
    now: Date.now(),
  });
  const words = stateWordsOf(state);

  return (
    <>
      <div data-print-hidden className="flex flex-wrap items-center gap-3">
        <a href="/" aria-label={t('maker.back', locale)} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft aria-hidden="true" />
        </a>
        <span className="inline-flex h-6 items-center rounded-4xl bg-secondary px-2.5 text-xs font-medium whitespace-nowrap text-secondary-foreground">
          {t(words.key, locale, words.values)}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void printPage()}>
            <Printer aria-hidden="true" />
            {t('maker.print', locale)}
          </Button>
          {add && (
            <Button type="button" variant="outline" onClick={() => setAgain(true)}>
              <Repeat2 aria-hidden="true" />
              {t('maker.again', locale)}
            </Button>
          )}
        </div>
      </div>
      <PrintVersions
        locale={locale}
        full={full}
        networks={postNetworks(full, networks)}
        theme={theme}
        picture={picture}
        business={business}
        themeColour={theme?.colour ?? null}
        today={today}
        onScreen
      />
      <PrintVideoPlan locale={locale} post={post} shown onScreen />
      {add && <PostAgainDialog locale={locale} postId={post.id} today={today} open={again} onClose={() => setAgain(false)} />}
    </>
  );
}
