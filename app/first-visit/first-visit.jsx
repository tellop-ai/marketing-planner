import { FirstVisitDialog } from './first-visit-dialog.jsx';
import { readFirstVisit } from './read.js';

/**
 * The first-visit start on the calendar (a server part the calendar page
 * places after its view): nothing once the profile has a business name or a
 * post exists, else the start's dialog. A read that fails shows nothing: the
 * start is never in the way of the calendar.
 *
 * @param {{ owner: string, locale: string, calendar: { today: string, business?: string, networks?: string[], tiles?: unknown[], ideas?: unknown[], due?: unknown } }} props
 */
export async function FirstVisit({ owner, locale, calendar }) {
  let first = false;
  try {
    first = await readFirstVisit(owner, calendar);
  } catch {
    first = false;
  }
  if (!first) return null;
  return <FirstVisitDialog locale={locale} today={calendar.today} networks={calendar.networks ?? []} />;
}
