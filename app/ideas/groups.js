/**
 * How the Ideas page groups and filters ideas by theme, and the idea starters,
 * pure (the browser loads it too; the checks call it directly).
 */

import { themeBackground } from '../theme-colours.js';

/** A theme's dot, by its colour (0 to 4): the theme's mark, never words on it; muted for no theme. @param {unknown} colour */
export function dotClass(colour) {
  return themeBackground(colour) ?? 'bg-muted-foreground';
}

/** The filter key of a theme (`none` for ideas with no theme). @param {number | null | undefined} themeId */
export function themeKey(themeId) {
  return themeId === null || themeId === undefined ? 'none' : String(themeId);
}

/**
 * Ideas grouped by theme: the plan's themes in their order (the ones in use,
 * then the archived ones), then ideas whose theme is gone, then ideas with no
 * theme. Only groups that hold an idea; each group keeps the list's order
 * (newest first).
 *
 * @param {{ id: number, name: string, themeId: number | null }[]} ideas
 * @param {{ id: number, name: string, colour: number }[]} themes in the plan's order
 * @returns {{ key: string, themeId: number | null, name: string | null, colour: number | null, ideas: object[] }[]}
 */
export function groupIdeas(ideas, themes) {
  const known = new Map(themes.map((theme) => [theme.id, theme]));
  /** @type {Map<string, object[]>} */
  const held = new Map();
  for (const idea of ideas) {
    const key = idea.themeId !== null && known.has(idea.themeId) ? String(idea.themeId) : 'none';
    held.set(key, [...(held.get(key) ?? []), idea]);
  }
  const groups = themes
    .filter((theme) => held.has(String(theme.id)))
    .map((theme) => ({ key: String(theme.id), themeId: theme.id, name: theme.name, colour: theme.colour, ideas: held.get(String(theme.id)) }));
  if (held.has('none')) groups.push({ key: 'none', themeId: null, name: null, colour: null, ideas: held.get('none') });
  return groups;
}

/** The kinds of idea starters, in the order the page shows them. */
export const STARTER_KINDS = Object.freeze(['behind', 'made', 'product', 'customer', 'offer', 'question']);

/** How many starters each kind has. */
export const STARTERS_EACH = 5;

/** The words keys of one kind's starters. @param {string} kind */
export function starterKeys(kind) {
  return Array.from({ length: STARTERS_EACH }, (_, index) => `ideas.starter.${kind}.${index + 1}`);
}
