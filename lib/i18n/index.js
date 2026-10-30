/**
 * Every word a person reads comes from here.
 *
 * Two rules, and a conformance check in Tellop's own suite enforces both:
 *
 *  1. No sentence is written directly into a component. A string that is not in
 *     `locales/` cannot be translated, and the app ships in Turkish and English
 *     from day one - not "English now, Turkish later".
 *  2. `en.json` and `tr.json` always carry exactly the same keys. A key present
 *     in one and missing from the other is how half an app silently reverts to
 *     the other language.
 *
 * The project chooses its language in `language.json`. Node reads the file;
 * Next compiles its raw text for the server and browser through the kit loader.
 * Parsing happens here so a damaged file still gives English. Online (workerd)
 * nothing reads the file: a build without the loader throws, never English.
 */

import { readLanguage } from '#project-language';

import en from './locales/en.json' with { type: 'json' };
import tr from './locales/tr.json' with { type: 'json' };

/** @typedef {'en' | 'tr'} Locale */

/** @type {readonly Locale[]} */
export const LOCALES = Object.freeze(['en', 'tr']);

/** @type {Locale} */
export const DEFAULT_LOCALE = 'en';

/** @type {Readonly<Record<Locale, Readonly<Record<string, string>>>>} */
export const MESSAGES = Object.freeze({ en: Object.freeze(en), tr: Object.freeze(tr) });

/**
 * The project's language, or English when nothing valid was chosen.
 *
 * @returns {Locale}
 */
export function getLocale() {
  // Outside the try: online, a build that never compiled the choice in throws here, loudly, never English.
  const text = readLanguage();
  try {
    const chosen = JSON.parse(text).language;
    return chosen === 'tr' || chosen === 'en' ? chosen : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Look up a string, substituting `{name}`-style placeholders.
 *
 * A missing key returns the key itself rather than an empty string: a visible
 * `notes.heading` on screen is a bug somebody fixes, and a blank space is a bug
 * nobody notices.
 *
 * @param {string} key
 * @param {Locale} [locale]
 * @param {Readonly<Record<string, string>>} [values]
 * @returns {string}
 */
export function t(key, locale = getLocale(), values = {}) {
  const table = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const template = table[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(values, name) ? values[name] : whole,
  );
}
