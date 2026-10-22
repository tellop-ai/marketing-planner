/**
 * What this app asks of AI for a post's pictures. Pure functions only: the
 * addresses (`app/api/posts/[id]/pictures/new`, `app/api/pictures/[id]/change`)
 * read the records, call `lib/ai.js` and keep the picture.
 *
 * New picture: one `quick` request writes a picture prompt (in English) and a
 * description (in the app's language, for people who cannot see the picture)
 * from the post's words, its theme and special day, and My plan's picture
 * style, different from the post's earlier pictures; then the picture is made
 * from that prompt plus the fixed rules (`PICTURE_RULES`). Change this
 * picture: the person's sentence, the picture's prompt and the same rules.
 *
 * The kept prompt of a picture (`PostPicture.prompt`) is the scene only; the
 * fixed rules are added each time a picture is made or changed.
 */

import { BYTES_A_LETTER, cutText, LIMITS, wireBytes } from './limits.js';
import { CONTENT_RULE, clipText, contentBlock, languageName, oneLine, parseAnswer } from './ai-words.js';

/** The size of a picture the app makes. Every shape is cut from it in the page. */
export const PICTURE_SIZE = Object.freeze({ width: 1536, height: 1024 });

/** The fixed rules every picture request ends with. */
export const PICTURE_RULES = 'Put the main subject in the middle of the picture with plenty of room around it on every side, so the picture can be cut to a square, a tall or a wide shape. No words, letters, numbers, signs or logos anywhere in the picture. No real people\'s faces.';

/** The most characters of a kept scene prompt (well under what `lib/ai.js` sends and a picture record keeps). */
export const SCENE_MOST = 1500;

/** The most earlier prompts one request sends, and the characters of each. */
export const EARLIER_MOST = 5;
const EARLIER_LENGTH = 400;

/** The longest picture idea taken from the page. */
const IDEA_MOST = LIMITS.description;

/**
 * The request for New picture.
 *
 * @param {{
 *   words?: string,
 *   business?: Record<string, string>,
 *   theme?: Record<string, unknown> | null,
 *   specialDay?: Record<string, string> | null,
 *   pictureStyle?: string,
 *   earlierPrompts?: string[],
 *   idea?: string,
 *   locale?: string,
 * }} input
 * @returns {Array<{ role: 'system' | 'user', content: string }>}
 */
export function pictureMessages({ words = '', business = {}, theme = null, specialDay = null, pictureStyle = '', earlierPrompts = [], idea = '', locale = 'en' }) {
  const content = { words: clipText(String(words ?? '').trim(), LIMITS.mainText), business };
  if (theme) content.theme = theme;
  if (specialDay) content.specialDay = specialDay;
  const style = oneLine(pictureStyle);
  if (style !== '') content.pictureStyle = style;
  const earlier = earlierPrompts.map((prompt) => clipText(oneLine(prompt), EARLIER_LENGTH)).filter((prompt) => prompt !== '').slice(0, EARLIER_MOST);
  if (earlier.length > 0) content.earlierPrompts = earlier;
  const pictureIdea = clipText(oneLine(idea), IDEA_MOST);
  if (pictureIdea !== '') content.pictureIdea = pictureIdea;
  const system = [
    'You write one prompt for a picture-making AI: a picture for a small business\'s social media post.',
    CONTENT_RULE,
    'Write "prompt" in English, at most 600 characters: one clear scene that fits the post\'s words ("words") and the business, its theme ("theme") and special day ("specialDay") when they are given, following the picture style ("pictureStyle") when it is given. "pictureIdea", when given, is a suggestion you may use. The main subject is in the middle with plenty of room around it. No words, letters, numbers, signs or logos in the picture. No real people\'s faces; hands at work are fine.',
    'When "earlierPrompts" are given, make this picture clearly different from them: another subject, angle or setting.',
    `Write "description" in ${languageName(locale)}: one sentence, at most 200 characters, that tells a person who cannot see the picture what it shows.`,
    'Answer only with a JSON object and nothing else: {"prompt": "...", "description": "..."}.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Write the picture prompt for this content.\n${contentBlock(content)}` },
  ];
}

/**
 * The prompt and description in an answer: one line each, the prompt at most
 * `SCENE_MOST` characters, the description at most `LIMITS.description` (it
 * may be empty). Null when the answer does not read or has no prompt.
 *
 * @param {unknown} text
 * @returns {{ prompt: string, description: string } | null}
 */
export function readPictureAnswer(text) {
  const value = parseAnswer(text);
  if (value === null) return null;
  const prompt = clipText(oneLine(value.prompt), SCENE_MOST);
  if (prompt === '') return null;
  return { prompt, description: clipText(oneLine(value.description), LIMITS.description) };
}

/** What a new picture is made from: the scene and the fixed rules. @param {string} scene */
export function picturePrompt(scene) {
  return `${clipText(oneLine(scene), SCENE_MOST)}\n\n${PICTURE_RULES}`;
}

/**
 * What a picture is changed with: the person's sentence, the picture's own
 * prompt, and the fixed rules. A picture with no kept prompt is changed from
 * the sentence alone.
 *
 * @param {string} scene the picture's kept prompt
 * @param {string} change the person's sentence
 */
export function changePrompt(scene, change) {
  const shows = clipText(oneLine(scene), SCENE_MOST);
  const lines = [`Change this picture: ${oneLine(change)}`, 'Keep the rest of the picture as it is.'];
  if (shows !== '') lines.push(`The picture shows: ${shows}`);
  return `${lines.join('\n')}\n\n${PICTURE_RULES}`;
}

/**
 * The prompt kept with a changed picture: the old scene and the change, so a
 * later change builds on both. The old scene is cut first when it is long
 * (in letters or bytes), so the change always stays; the whole is at most
 * `SCENE_MOST` letters and `BYTES_A_LETTER` x `SCENE_MOST` bytes.
 *
 * @param {string} scene
 * @param {string} change
 */
export function changedScene(scene, change) {
  const tail = `Changed: ${oneLine(change)}`;
  const room = SCENE_MOST - Array.from(tail).length - 1;
  const roomBytes = BYTES_A_LETTER * SCENE_MOST - wireBytes(tail) - 1;
  const base = clipText(oneLine(scene), Math.max(0, room), Math.max(0, roomBytes));
  return cutText(base === '' ? tail : `${base} ${tail}`, SCENE_MOST);
}

/**
 * A changed picture's description, in the app's language: the old
 * description and the change (`aiplan.changedDescription`), or the change
 * alone when there was none (`aiplan.changedOnly`), at most
 * `LIMITS.description` characters.
 *
 * @param {string} description the old picture's description
 * @param {string} change the person's sentence
 * @param {(key: string, values: Record<string, string>) => string} words `t` in the app's language
 */
export function changedDescription(description, change, words) {
  const before = oneLine(description).replace(/[\s.。!?…]+$/u, '');
  const said = oneLine(change).replace(/[\s.。!?…]+$/u, '');
  const text = before === ''
    ? words('aiplan.changedOnly', { change: said })
    : words('aiplan.changedDescription', { description: before, change: said });
  return clipText(oneLine(text), LIMITS.description);
}
