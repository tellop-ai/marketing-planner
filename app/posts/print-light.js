/**
 * Printing a page in the look's light colours, for a page that prints from
 * its own menu rather than from the kit's `app/print-button.jsx` (whose
 * button and words do not fit a menu item). The same rule as that button:
 * while the browser prints, the page drops the person's dark choice, and puts
 * it back after (dark is kept only on `html`: the kit's AGENTS.md, "To offer
 * a PDF, print the real page").
 *
 * Browser only: nothing runs when this file loads. One helper for every page
 * that prints (the post maker, the calendar).
 */

import { useEffect } from 'react';

/** While the page prints, the light colours; after, the person's dark choice again. */
export function usePrintLight() {
  useEffect(() => {
    let restoreDark = false;
    const before = () => {
      restoreDark ||= document.documentElement.classList.contains('dark');
      document.documentElement.classList.remove('dark');
    };
    const after = () => {
      if (restoreDark) document.documentElement.classList.add('dark');
      restoreDark = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      after();
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

/** Prints the page once its local fonts are ready (as the kit's print button does). */
export async function printPage() {
  await document.fonts?.ready;
  window.print();
}
