/**
 * The hashtag sets kept in Ready words, as choices for a theme's hashtags on
 * My plan (pure: the page reads the ready words, this picks the sets).
 */

import { normaliseHashtags } from '../../lib/plan/fit.js';

/**
 * Each ready word of the kind `hashtags` that holds at least one hashtag, in
 * Ready words' order: its id, its title and its hashtags as a theme keeps
 * them (cleaned, at most the most a post takes, one space between), so
 * choosing one fills the theme's field with words its Save accepts.
 *
 * @param {Array<{ id: number, kind: string, title: string, text: string }>} readyWords
 * @returns {Array<{ id: number, title: string, hashtags: string }>}
 */
export function hashtagSetsOf(readyWords) {
  const sets = [];
  for (const word of readyWords ?? []) {
    if (word?.kind !== 'hashtags') continue;
    const hashtags = normaliseHashtags(word.text).join(' ');
    if (hashtags !== '') sets.push({ id: word.id, title: word.title, hashtags });
  }
  return sets;
}
