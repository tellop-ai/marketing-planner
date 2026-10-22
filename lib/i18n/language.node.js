import { readFileSync } from 'node:fs';

/** Read the single project choice. Missing or unreadable is handled by getLocale. */
export function readLanguage() {
  try {
    return readFileSync(new URL('./language.json', import.meta.url), 'utf8');
  } catch {
    return '';
  }
}
