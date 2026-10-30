/**
 * A refusal a person can be shown, shared by `index.js` (records) and
 * `files.js` (a person's own files) so that an address answers both the same
 * way. `messageKey` indexes `lib/i18n/locales`, so the words are translated
 * where they are displayed and never assembled here.
 *
 * Nothing here imports anything, so `files.js` can be loaded on its own.
 */
export class DataError extends Error {
  /**
   * @param {string} messageKey
   * @param {string} [reason] the host's closed word for a refused change (such as `nested-write`), for the app's
   *   code and its logs only: a person reads `messageKey`'s words, never this.
   */
  constructor(messageKey, reason) {
    super(messageKey);
    this.name = 'DataError';
    /** @type {string} */
    this.messageKey = messageKey;
    /** @type {string | undefined} */
    if (reason !== undefined) this.reason = reason;
  }
}
