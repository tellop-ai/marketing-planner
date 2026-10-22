'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { NO_BRAND, readBrand } from '../../lib/plan/card-layout.js';
import { currentPageBrand, setPageBrand, watchPageBrand } from '../../lib/plan/draw.js';

/** The server draws every picture without a brand; the page takes it from `PictureBrand` once it runs. */
const noBrand = () => NO_BRAND;

/**
 * Gives this page's pictures the business's brand from My plan (`brand`,
 * from `pictureBrandOf(profile)`): the canvas drawings (`lib/plan/draw.js`)
 * and the HTML pictures (`WordsPicture`, `PictureThumb`) all take it, so a
 * copy the page keeps and the picture it shows agree. Draws nothing; put it
 * once on a page that shows or keeps pictures. Without it a page's pictures
 * take the theme's colours and carry no logo.
 *
 * @param {{ brand: { colour?: string, colour2?: string, logo?: string | null } | null }} props
 */
export function PictureBrand({ brand }) {
  const { colour, colour2, logo } = readBrand(brand);
  useEffect(() => {
    setPageBrand({ colour, colour2, logo });
    return () => {
      // Back to none as the page closes, unless another page has set its own meanwhile.
      const now = currentPageBrand();
      if (now.colour === colour && now.colour2 === colour2 && now.logo === logo) setPageBrand(NO_BRAND);
    };
  }, [colour, colour2, logo]);
  return null;
}

/**
 * The brand a picture is drawn in: `given` when the caller names one (even
 * none, as `null`), else the page's (`PictureBrand`).
 *
 * @param {unknown} [given]
 */
export function usePictureBrand(given) {
  const page = useSyncExternalStore(watchPageBrand, currentPageBrand, noBrand);
  return given === undefined ? page : readBrand(given);
}
