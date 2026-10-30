import { readFileSync } from 'node:fs';

/** Online (workerd) no file is read while the app runs: there `readFileSync` answers "" with no error, which would
 * show English silently, so this reader throws. A build for online compiles the choice in (next.config.mjs). */
const COMPILED_ONLY = 'language.json is read at build time online: build with the kit loader (next.config.mjs)';

/** Read the single project choice. Missing or unreadable is handled by getLocale. */
export function readLanguage() {
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') throw new Error(COMPILED_ONLY);
  try {
    return readFileSync(new URL('./language.json', import.meta.url), 'utf8');
  } catch {
    return '';
  }
}
