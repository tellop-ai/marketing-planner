import { Alert, AlertDescription } from '@/components/ui/alert';

import { DataError } from '../../lib/data/index.js';
import { getLocale, t } from '../../lib/i18n/index.js';
import { todayCivil } from '../../lib/plan/days.js';
import { OWNER } from '../../lib/plan/owner.js';
import { BUILT_IN_DAYS, LAST_MOVING_YEAR } from '../../lib/plan/special-days.js';
import { Shell } from '../shell.jsx';

import { BrandCard } from './brand-card.jsx';
import { BusinessCard } from './business-card.jsx';
import { DaysCard } from './days-card.jsx';
import { LinksCard } from './links-card.jsx';
import { PostsCard } from './posts-card.jsx';
import { readPlanPage } from './read.js';
import { ThemesCard } from './themes-card.jsx';

/**
 * My plan: the business, its brand, its posts and platforms, its themes, its
 * special days and its links. Opening it only reads (rule 4a); every field
 * saves by itself when the person changes it (no Save buttons: `./auto-save.js`),
 * with one quiet line a card. The hashtag sets kept in Ready words are
 * offered as choices for a theme's hashtags. What it reads, and in how many
 * records calls: `readPlanPage` (`./read.js`).
 */
export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const locale = getLocale();
  let read;
  try {
    read = await readPlanPage(OWNER);
  } catch (error) {
    read = { problem: error instanceof DataError ? error.messageKey : 'error.storageUnreadable' };
  }
  const title = <h1 className="text-xl font-semibold">{t('menu.plan', locale)}</h1>;
  if (!read.plan) {
    return (
      <Shell locale={locale} path="/plan">
        {title}
        <Alert variant="destructive">
          <AlertDescription>{t(read.problem, locale)}</AlertDescription>
        </Alert>
      </Shell>
    );
  }
  const { plan, ownDays, hashtagSets } = read;
  const today = todayCivil();
  const builtInDays = BUILT_IN_DAYS.map((day) => ({ key: day.key, where: day.where, nameKey: day.nameKey }));
  return (
    <Shell locale={locale} path="/plan" business={plan.profile.businessName}>
      {title}
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <BusinessCard locale={locale} profile={plan.profile} />
        <BrandCard locale={locale} profile={plan.profile} />
        <PostsCard locale={locale} profile={plan.profile} />
        <ThemesCard locale={locale} themes={plan.themes} hashtagSets={hashtagSets} />
        <DaysCard
          locale={locale}
          profile={plan.profile}
          ownDays={ownDays}
          builtInDays={builtInDays}
          today={today}
          lastMovingYear={LAST_MOVING_YEAR}
          movingOutdated={Number(today.slice(0, 4)) > LAST_MOVING_YEAR}
        />
        <LinksCard locale={locale} profile={plan.profile} />
      </div>
    </Shell>
  );
}
