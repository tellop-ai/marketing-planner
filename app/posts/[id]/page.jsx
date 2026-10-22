import { notFound } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../../lib/data/index.js';
import { idFromPath } from '../../../lib/data/posts.js';
import { getLocale, t } from '../../../lib/i18n/index.js';
import { todayCivil } from '../../../lib/plan/days.js';
import { pictureBrandOf } from '../../../lib/plan/card-layout.js';
import { OWNER } from '../../../lib/plan/owner.js';
import { PictureBrand } from '../../pictures/brand.jsx';
import { initialsOf, Shell } from '../../shell.jsx';

import { PostMaker } from './maker.jsx';
import { readMakerPage } from './read.js';

/**
 * The post maker: one post's words, pictures, preview for each network and
 * the steps to share it. Opening it only reads (rule 4a): the post, the plan
 * (business, networks, themes), the "link in profile" sentence and the
 * campaigns, one after another (`readMakerPage`: Tellop answers at most 4
 * records calls at once in a request), at most ten records calls. A post that
 * is not there is a "not found" page. Every change is saved by a press or by
 * the words box, through the post's addresses.
 */
export const dynamic = 'force-dynamic';

/** @param {{ params: Promise<{ id: string }> }} props */
export default async function PostPage({ params }) {
  const locale = getLocale();
  const id = idFromPath((await params)?.id);
  if (id === null) notFound();
  const today = todayCivil();

  let read;
  try {
    read = (await readMakerPage(OWNER, id, today)) ?? { full: null };
  } catch (error) {
    read = { problem: error instanceof DataError ? error.messageKey : 'error.storageUnreadable' };
  }

  if (read.problem) {
    return (
      <Shell locale={locale} path="/posts">
        <h1 className="text-xl font-semibold">{t('post.untitled', locale)}</h1>
        <Alert variant="destructive">
          <AlertDescription>{t(read.problem, locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  if (read.full === null) notFound();

  const { full, plan, linkSentence, campaigns, bestTimes = null } = read;
  const business = plan.profile.businessName;
  const themes = [...plan.themes, ...plan.archivedThemes].map((theme) => ({
    id: theme.id,
    name: theme.name,
    colour: theme.colour,
    archived: theme.archived,
  }));
  return (
    <Shell locale={locale} path="/posts" business={business}>
      <PictureBrand brand={pictureBrandOf(plan.profile)} />
      <PostMaker
        locale={locale}
        initial={full}
        networks={plan.networks}
        themes={themes}
        campaigns={campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, status: campaign.status }))}
        business={business}
        initials={initialsOf(business, locale)}
        linkSentence={linkSentence}
        today={today}
        showDays={plan.profile.showDays}
        hiddenDays={plan.hiddenDays}
        trackLinks={plan.profile.trackLinks}
        profileLink={plan.profile.profileLink}
        bestTimes={bestTimes}
      />
    </Shell>
  );
}
