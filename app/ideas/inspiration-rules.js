/**
 * The rules of the Ideas page's "Saved for inspiration" section, pure (the
 * browser loads it too; the checks call it directly).
 */

import { INSPIRATION_NOTE_MOST } from '../../lib/plan/ai-words.js';

/** How many notes show before Show all: one row on a wide window. */
export const FOLDED = 3;

/** The longest note, in characters. */
export const NOTE_MOST = INSPIRATION_NOTE_MOST;

/**
 * Whether a note can be saved: it holds a link or some words (the address
 * refuses one with neither, so Save rests until one is typed).
 *
 * @param {string} link
 * @param {string} words
 */
export function canSaveNote(link, words) {
  return (typeof link === 'string' && link.trim() !== '') || (typeof words === 'string' && words.trim() !== '');
}

/**
 * The themes a note can be given: the themes in use, in the plan's order;
 * while editing a note whose theme is no longer in use, that theme too (last),
 * so saving the note's words keeps its theme.
 *
 * @template {{ id: number }} T
 * @param {T[]} themes in use
 * @param {T[]} archivedThemes
 * @param {number | null} current the note's theme
 * @returns {T[]}
 */
export function noteThemeChoices(themes, archivedThemes, current) {
  if (current === null || themes.some((theme) => theme.id === current)) return [...themes];
  const archived = archivedThemes.find((theme) => theme.id === current);
  return archived === undefined ? [...themes] : [...themes, archived];
}

/**
 * The theme a note shows (one of the plan's themes, in use or not), or null
 * when it has none or its theme is gone.
 *
 * @template {{ id: number }} T
 * @param {{ themeId: number | null }} note
 * @param {T[]} themes
 * @returns {T | null}
 */
export function noteThemeOf(note, themes) {
  if (note.themeId === null) return null;
  return themes.find((theme) => theme.id === note.themeId) ?? null;
}

/**
 * The notes shown: all of them, or only the newest `FOLDED` until Show all.
 *
 * @template T
 * @param {T[]} notes newest first
 * @param {boolean} showAll
 * @returns {T[]}
 */
export function shownNotes(notes, showAll) {
  return showAll ? notes : notes.slice(0, FOLDED);
}
