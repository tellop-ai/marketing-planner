import { Spinner } from '@/components/ui/spinner';

import { getLocale, t } from '../lib/i18n/index.js';

/**
 * What a person sees while a page is still on its way.
 *
 * Next shows this file in place of a page that has not finished reading what it
 * needs: the first visit to a slow page, and every move to another page until
 * the new one is ready. Without it the old page just sits there after a click,
 * and a person clicks again because nothing seemed to happen.
 *
 * It is a server component, like `layout.jsx`, and reads the project's language
 * the same way, so the words are in the app's own language from the first moment.
 *
 * Four things here are deliberate:
 *
 *  - It waits a moment before it shows (`delay-300` with `fill-mode-backwards`
 *    holds it invisible until then). Most pages are ready sooner, and a spinner
 *    that flashes for a blink is noise rather than news. A slow page fades it in
 *    gently. A fade is not movement, so it stays for people who turn motion off.
 *  - The Spinner's words come from the locale files. The kit's Spinner names
 *    itself "Loading" in English for screen readers; the `aria-label` passed here
 *    replaces that with this app's own words. Do not edit the Spinner itself: its
 *    exact bytes are recorded in `components/PROVENANCE.json`.
 *  - For people who turn motion off the spinner stops turning
 *    (`motion-reduce:animate-none`). The words under it still say the page is on
 *    its way, so nothing is lost. Screen readers hear those words once, from the
 *    Spinner, which is why the visible line is hidden from them.
 *  - It carries no `data-tellop-app-marker`. That mark says the page itself has
 *    appeared; this is the moment before it.
 *
 * A screen that wants a waiting state of its own, such as a skeleton shaped like
 * its own list, gets one by putting a `loading.jsx` in its own folder: the
 * nearest one wins.
 */
export default function Loading() {
  const locale = getLocale();
  const words = t('app.loading', locale);
  return (
    <div className="flex min-h-64 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-muted-foreground animate-in fade-in duration-300 delay-300 fill-mode-backwards">
        <Spinner className="size-6 motion-reduce:animate-none" aria-label={words} />
        <p className="text-sm" aria-hidden="true">{words}</p>
      </div>
    </div>
  );
}
