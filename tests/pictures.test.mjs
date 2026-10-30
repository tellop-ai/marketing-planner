/**
 * Pictures in the post maker: how words wrap and size on a drawn card, the
 * picture strip's rules, and how a picture's shapes are drawn and kept.
 *
 * The drawing runs against a small stand-in page (a canvas that records what
 * is drawn, the look's values by name, and the app's addresses), so the
 * checks call `drawShape` and `keepShapes` themselves; nothing reaches the
 * network and no AI is called.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  CARD_LAYOUTS,
  COMMENT_CARD,
  ELLIPSIS,
  HTML_SIZE_STEP,
  LAYOUT_PARTS,
  TILE_WORDS_TOP,
  WORDS_CARD,
  cardParts,
  clipLine,
  commentCardBox,
  commentCardSize,
  estimateWidth,
  graphemes,
  inkFor,
  layoutOf,
  logoAddress,
  logoBox,
  NO_BRAND,
  layoutWords,
  themeIndex,
  wordsCardBox,
  wordsCardSize,
} from '../lib/plan/card-layout.js';
import { DrawProblem, NOT_READY, currentPageBrand, drawShape, keepShapes, rectPath, setPageBrand, themeToken } from '../lib/plan/draw.js';
import { LIMITS } from '../lib/plan/limits.js';
import { SET_LIMITS } from '../lib/plan/networks.js';
import { unzipStored } from '../lib/plan/zip.js';
import { SET_LEAST_ROOM, setRoom } from '../lib/plan/ai-sets.js';
import { BundleProblem, bundleSet } from '../app/posts/[id]/bundle.js';
import { SHAPES, SHAPE_KEYS, fillCut, fitPlace } from '../lib/plan/shapes.js';
import {
  FOCUS_STEPS,
  LASTING_AI_PROBLEMS,
  MAKE_SET,
  addToSet,
  aiStopOf,
  canMakeSet,
  canDraw,
  canSendChange,
  chosenOf,
  fileAddress,
  firstSentence,
  focusStep,
  hasOriginal,
  hasRoom,
  makeRoom,
  makingLine,
  missingShapes,
  moveInSet,
  pictureWords,
  postFullOf,
  postNetworks,
  problemOf,
  setChoices,
  setCutLines,
  setFull,
  setOf,
  shapesFor,
  slideNetworks,
  stepFocus,
  storyNetworks,
  takeOutOfSet,
  thumbSources,
  tipPlace,
  wordsChanges,
} from '../app/pictures/rules.js';

/** Every character is half its size wide: a measure the checks can count by hand. */
const half = (text, size) => graphemes(text).length * size * 0.5;

describe('layoutWords', () => {
  test('no words answer no lines at the largest size', () => {
    for (const words of ['', '   ', '\n\n', null, undefined]) {
      assert.deepEqual(layoutWords(words, { width: 100, height: 100, maxSize: 40, minSize: 10 }), { lines: [], size: 40, cut: false });
    }
  });

  test('lines break at spaces and every line fits the width', () => {
    // At size 10 a character is 5 wide: 20 characters to a line of 100.
    const layout = layoutWords('aaaa bbbb cccc dddd eeee', { width: 100, height: 1000, maxSize: 10, minSize: 10, measure: half });
    assert.deepEqual(layout.lines, ['aaaa bbbb cccc dddd', 'eeee']);
    for (const line of layout.lines) assert.ok(half(line, layout.size) <= 100);
  });

  test('a word longer than a line is cut into pieces that fit', () => {
    const word = 'x'.repeat(45);
    const layout = layoutWords(`go ${word} now`, { width: 100, height: 1000, maxSize: 10, minSize: 10, measure: half });
    assert.deepEqual(layout.lines, ['go', 'x'.repeat(20), 'x'.repeat(20), 'x'.repeat(5) + ' now']);
    assert.equal(layout.cut, false);
  });

  test('a word is cut only when no size keeps it whole: a smaller size that keeps it whole wins', () => {
    // At 10 a character is 5 (20 to a line): 25 x would need cutting. At 8 it is 4: 25 fit whole.
    const layout = layoutWords(`go ${'x'.repeat(25)}`, { width: 100, height: 1000, maxSize: 10, minSize: 5, measure: half });
    assert.equal(layout.size, 8);
    assert.deepEqual(layout.lines, ['go', 'x'.repeat(25)]);
    // One character longer than fits whole at the smallest size: cut, at the largest size that fits with pieces.
    const cut = layoutWords('x'.repeat(41), { width: 100, height: 1000, maxSize: 10, minSize: 5, measure: half });
    assert.equal(cut.size, 10);
    assert.deepEqual(cut.lines, ['x'.repeat(20), 'x'.repeat(20), 'x']);
    const whole = layoutWords('x'.repeat(40), { width: 100, height: 1000, maxSize: 10, minSize: 5, measure: half });
    assert.equal(whole.size, 5);
    assert.deepEqual(whole.lines, ['x'.repeat(40)]);
  });

  test('a word exactly one line long stays whole; one character more is cut', () => {
    const exact = layoutWords('y'.repeat(20), { width: 100, height: 1000, maxSize: 10, minSize: 10, measure: half });
    assert.deepEqual(exact.lines, ['y'.repeat(20)]);
    const over = layoutWords('y'.repeat(21), { width: 100, height: 1000, maxSize: 10, minSize: 10, measure: half });
    assert.deepEqual(over.lines, ['y'.repeat(20), 'y']);
  });

  test('a long word is cut between the characters a person sees, never inside one', () => {
    const family = '👩‍👩‍👧';
    const layout = layoutWords(family.repeat(5), { width: 10, height: 1000, maxSize: 10, minSize: 10, measure: half });
    assert.deepEqual(layout.lines, [family.repeat(2), family.repeat(2), family]);
  });

  test('a line break the person typed starts a new line', () => {
    const layout = layoutWords('one\ntwo\r\n\r\nthree', { width: 1000, height: 1000, maxSize: 10, minSize: 10, measure: half });
    assert.deepEqual(layout.lines, ['one', 'two', 'three']);
  });

  test('everything fitting at the largest size keeps the largest size', () => {
    const layout = layoutWords('Last call', { width: 400, height: 400, maxSize: 56, minSize: 20, measure: half });
    assert.equal(layout.size, 56);
    assert.deepEqual(layout.lines, ['Last call']);
  });

  test('the size is the largest whose lines fit: on the edge it fits, just under it steps down', () => {
    // 'aaaa bbbb' at size 20: 9 characters x 10 = 90, one line in a width of 100.
    const box = { width: 100, maxSize: 20, minSize: 10, lineHeight: 1, measure: half };
    assert.equal(layoutWords('aaaa bbbb', { ...box, height: 20 }).size, 20);
    assert.equal(layoutWords('aaaa bbbb', { ...box, height: 19.99 }).size, 19);
    assert.equal(layoutWords('aaaa bbbb', { ...box, height: 19 }).size, 19);
  });

  test('a larger size that needs more lines gives way to a smaller one that fits', () => {
    // At 20 a character is 10: 'aaaa bbbb' (90) fits one line; at 21 it needs two.
    const layout = layoutWords('aaaa bbbb', { width: 90, height: 21, maxSize: 30, minSize: 10, lineHeight: 1, measure: half });
    assert.equal(layout.size, 20);
    assert.deepEqual(layout.lines, ['aaaa bbbb']);
    const larger = layoutWords('aaaa bbbb', { width: 90, height: 21, maxSize: 30, minSize: 10, lineHeight: 1, measure: half, step: 1 });
    assert.equal(larger.size, 20);
  });

  test('the sizes go down by the step and the smallest size is always tried', () => {
    const tried = [];
    const measure = (text, size) => {
      if (!tried.includes(size)) tried.push(size);
      return half(text, size);
    };
    layoutWords('aaaa', { width: 1, height: 1, maxSize: 10, minSize: 5, step: 2, measure });
    assert.deepEqual(tried, [10, 8, 6, 5]);
  });

  test('words that do not fit even at the smallest size keep the lines that fit and end with the cut mark', () => {
    const words = 'one two three four five six seven eight nine ten';
    const layout = layoutWords(words, { width: 50, height: 25, maxSize: 20, minSize: 10, lineHeight: 1, measure: half });
    assert.equal(layout.size, 10);
    assert.equal(layout.cut, true);
    assert.equal(layout.lines.length, 2);
    assert.ok(layout.lines[1].endsWith(ELLIPSIS));
    for (const line of layout.lines) assert.ok(half(line, 10) <= 50);
  });

  test('a box too small for one line still answers one line, cut', () => {
    const layout = layoutWords('everything here', { width: 50, height: 2, maxSize: 20, minSize: 10, measure: half });
    assert.equal(layout.lines.length, 1);
    assert.equal(layout.cut, true);
  });

  test('a box or sizes that make no sense are refused', () => {
    const box = { width: 100, height: 100, maxSize: 20, minSize: 10 };
    assert.throws(() => layoutWords('a', { ...box, width: 0 }), TypeError);
    assert.throws(() => layoutWords('a', { ...box, height: -1 }), TypeError);
    assert.throws(() => layoutWords('a', { ...box, minSize: Number.NaN }), TypeError);
    assert.throws(() => layoutWords('a', { ...box, maxSize: 9 }), TypeError);
    assert.throws(() => layoutWords('a', { ...box, step: 0 }), TypeError);
    assert.doesNotThrow(() => layoutWords('a', { ...box, maxSize: 10 }));
  });

  test('the estimate is wider for broad letters and grows with the size', () => {
    assert.ok(estimateWidth('iii', 10) < estimateWidth('mmm', 10));
    assert.ok(estimateWidth('MMM', 10) > estimateWidth('nnn', 10));
    assert.equal(estimateWidth('abc', 20), estimateWidth('abc', 10) * 2);
    assert.equal(estimateWidth('', 10), 0);
  });
});

describe('clipLine', () => {
  test('words that fit come back whole, on the edge too', () => {
    assert.equal(clipLine('abcd', 20, { size: 10, measure: half }), 'abcd');
    assert.equal(clipLine('abcde', 20, { size: 10, measure: half }), 'abc' + ELLIPSIS);
  });

  test('words a little too long are cut with the mark, and the result fits', () => {
    const line = clipLine('Blue Clay Studio and Gallery', 60, { size: 10, measure: half });
    assert.ok(line.endsWith(ELLIPSIS));
    assert.ok(half(line, 10) <= 60);
    assert.ok(!line.includes(` ${ELLIPSIS}`), 'no space before the mark');
  });
});

describe('the card boxes', () => {
  test('on the 400 card they are where the drawing puts them', () => {
    const words = wordsCardBox(400, 400);
    assert.equal(words.unit, 1);
    assert.equal(words.top, WORDS_CARD.top);
    assert.equal(words.width, 328);
    assert.equal(words.height, 400 - 92 - 36 - 17 - 24);
    assert.equal(words.nameY, 364);
    assert.equal(words.middle, false);
    const comment = commentCardBox(400, 400);
    assert.equal(comment.nameY, 344);
    assert.equal(comment.stars.y, 280);
    assert.equal(comment.top, COMMENT_CARD.top);
  });

  test('in every shape the parts stay inside the card, and only taller shapes centre the words', () => {
    for (const key of SHAPE_KEYS) {
      const { width, height } = SHAPES[key];
      const words = wordsCardBox(width, height);
      assert.ok(words.height > 0 && words.width > 0, key);
      assert.ok(words.top + words.height < words.nameY - words.nameSize, key);
      assert.ok(words.nameY < height && words.x > 0, key);
      assert.ok(words.minSize <= words.maxSize, key);
      assert.equal(words.middle, height > width, key);
      const comment = commentCardBox(width, height);
      assert.ok(comment.height > 0, key);
      assert.ok(comment.quote.y + comment.quote.size < comment.top, key);
      assert.ok(comment.top + comment.height < comment.stars.y, key);
      assert.ok(comment.stars.y + comment.stars.size < comment.nameY - comment.nameSize, key);
      assert.ok(comment.x + 5 * comment.stars.size + 4 * comment.stars.gap < width, key);
    }
  });

  test('the HTML cards take a size on their steps: short words the largest, long words smaller', () => {
    assert.equal(wordsCardSize('Last call'), 56);
    const long = wordsCardSize('word '.repeat(LIMITS.pictureWords / 5));
    assert.ok(long < 56 && long >= 20);
    for (const words of ['a', 'Three places left this Saturday', 'x'.repeat(300), 'word '.repeat(60)]) {
      const size = wordsCardSize(words);
      assert.equal((56 - size) % HTML_SIZE_STEP, 0, words);
      assert.ok(size >= 20 && size <= 56);
    }
    assert.equal(commentCardSize('Lovely.'), 32);
    for (const line of ['The nicest Saturday I have had in months.', 'y'.repeat(300), '']) {
      const size = commentCardSize(line);
      assert.equal((32 - size) % HTML_SIZE_STEP, 0);
      assert.ok(size >= 16 && size <= 32);
    }
  });

  test('a theme colour is a whole number from 0 to 4', () => {
    assert.equal(themeIndex(0), 0);
    assert.equal(themeIndex(4), 4);
    for (const value of [-1, 5, 1.5, '1', null, undefined, Number.NaN]) assert.equal(themeIndex(value), null);
    assert.equal(themeToken(0), '--chart-1');
    assert.equal(themeToken(4), '--chart-5');
    assert.equal(themeToken(5), '--primary');
    assert.equal(themeToken(null), '--primary');
  });
});

const NO_SHAPES = Object.freeze({ square: null, portrait: null, story: null, wide: null, landscape: null, tall: null, gbp: null });

function pictureOf(fields) {
  return {
    id: 7,
    postId: 3,
    source: 'words',
    chosen: true,
    description: '',
    words: '',
    commentId: null,
    position: 1,
    width: 0,
    height: 0,
    focusX: 0.5,
    focusY: 0.5,
    fit: 'auto',
    original: null,
    shapes: { ...NO_SHAPES },
    canChange: false,
    card: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    ...fields,
  };
}

function postOf(pictures = [], versions = []) {
  return { post: { id: 3, name: 'Paint your own mug', mainText: '' }, versions, pictures };
}

describe('the strip rules', () => {
  test('a post goes to My plan networks less the ones switched off for it', () => {
    const post = postOf([], [{ network: 'facebook', on: false }, { network: 'x', on: true }]);
    assert.deepEqual(postNetworks(post, ['instagram', 'facebook', 'x', 'nowhere', 'x']), ['instagram', 'x']);
    assert.deepEqual(postNetworks(post, 'instagram'), []);
    assert.deepEqual(postNetworks(null, ['whatsapp']), ['whatsapp']);
  });

  test('the shapes kept are each network’s own shape, once', () => {
    assert.deepEqual(shapesFor(postOf(), ['instagram', 'facebook']), ['portrait']);
    assert.deepEqual(shapesFor(postOf(), ['instagram', 'x', 'bluesky', 'pinterest', 'google']), ['portrait', 'landscape', 'tall', 'gbp']);
    assert.deepEqual(shapesFor(postOf([], [{ network: 'x', on: false }]), ['x']), []);
  });

  test('only shapes with no kept copy are missing, each once, known ones only', () => {
    const picture = pictureOf({ shapes: { ...NO_SHAPES, square: 'aaaaaaaaaaaa' } });
    assert.deepEqual(missingShapes(picture, ['square', 'portrait', 'portrait', 'round']), ['portrait']);
    assert.deepEqual(missingShapes(null, ['square']), ['square']);
    assert.deepEqual(missingShapes(picture, 'square'), []);
  });

  test('a thumb shows the shape’s copy, else the original, else the drawn card, else an empty box', () => {
    const shaped = pictureOf({ id: 9, source: 'drawn', original: 'bbbbbbbbbbbb', shapes: { ...NO_SHAPES, square: 'cccccccccccc' } });
    assert.deepEqual(thumbSources(shaped, 'square').map((item) => item.address ?? item.kind), [
      '/api/pictures/9/file?shape=square&v=cccccccccccc',
      '/api/pictures/9/file?shape=original&v=bbbbbbbbbbbb',
      'empty',
    ]);
    assert.equal(thumbSources(shaped, 'story')[0].address, '/api/pictures/9/file?shape=original&v=bbbbbbbbbbbb');
    assert.equal(thumbSources(shaped, 'round')[0].address, '/api/pictures/9/file?shape=original&v=bbbbbbbbbbbb');
    assert.deepEqual(thumbSources(pictureOf({ words: 'Last call' })).map((item) => item.kind), ['words', 'empty']);
    assert.deepEqual(thumbSources(pictureOf({ words: '  ' })).map((item) => item.kind), ['empty']);
    assert.deepEqual(thumbSources(pictureOf({ source: 'card', card: { bestLine: 'Lovely', text: '', name: 'Ayşe', stars: 5 } })).map((item) => item.kind), ['card', 'empty']);
    // A tile reads a card without its comment: a plain card mark, after a kept copy when there is one.
    assert.deepEqual(thumbSources(pictureOf({ source: 'card', card: null })).map((item) => item.kind), ['cardMark', 'empty']);
    assert.deepEqual(thumbSources(pictureOf({ id: 4, source: 'card', card: null, shapes: { ...NO_SHAPES, square: 'dddddddddddd' } })).map((item) => item.address ?? item.kind), [
      '/api/pictures/4/file?shape=square&v=dddddddddddd',
      'cardMark',
      'empty',
    ]);
    assert.deepEqual(thumbSources(null), [{ kind: 'empty' }]);
  });

  test('a strip tile draws a words picture itself, before any kept copy, so the chosen mark has room above the words', () => {
    const words = pictureOf({ words: '3 places left', shapes: { ...NO_SHAPES, square: 'aaaaaaaaaaaa' } });
    assert.deepEqual(thumbSources(words, 'square', { wordsFirst: true }).map((item) => item.address ?? item.kind), ['words', '/api/pictures/7/file?shape=square&v=aaaaaaaaaaaa', 'empty']);
    assert.deepEqual(thumbSources(words, 'square').map((item) => item.address ?? item.kind), ['/api/pictures/7/file?shape=square&v=aaaaaaaaaaaa', 'words', 'empty']);
    const photo = pictureOf({ source: 'photo', original: 'bbbbbbbbbbbb' });
    assert.deepEqual(thumbSources(photo, 'square', { wordsFirst: true }), thumbSources(photo, 'square'), 'only a words picture');
    assert.deepEqual(thumbSources(pictureOf({ words: ' ' }), 'square', { wordsFirst: true }).map((item) => item.kind), ['empty']);
  });

  test('a file’s address carries the shape and the tag, written safely', () => {
    assert.equal(fileAddress(4, 'original', 'abc'), '/api/pictures/4/file?shape=original&v=abc');
    assert.equal(fileAddress('4/../x', 'square', null), '/api/pictures/4%2F..%2Fx/file?shape=square');
  });

  test('which pictures the page can draw shapes for', () => {
    assert.equal(hasOriginal(pictureOf({ source: 'photo', original: 'abc' })), true);
    assert.equal(hasOriginal(pictureOf({ source: 'photo', original: null })), false);
    assert.equal(hasOriginal(pictureOf({ source: 'words', original: 'abc' })), false);
    assert.equal(canDraw(pictureOf({ words: 'Hi' })), true);
    assert.equal(canDraw(pictureOf({ words: ' ' })), false);
    assert.equal(canDraw(pictureOf({ source: 'card', card: { bestLine: 'x' } })), true);
    assert.equal(canDraw(pictureOf({ source: 'card', card: null })), false);
    // A card whose customer has not said yes is never drawn, even if its words were somehow still at hand.
    assert.equal(canDraw(pictureOf({ source: 'card', card: null, cardRefused: true })), false);
    assert.equal(canDraw(pictureOf({ source: 'card', card: { bestLine: 'x' }, cardRefused: true })), false);
    assert.equal(canDraw(pictureOf({ source: 'card', card: { bestLine: 'x' }, cardRefused: false })), true);
    assert.equal(canDraw(pictureOf({ source: 'changed', original: 'abc' })), true);
  });

  test('a picture is described by its description, else by its words', () => {
    assert.equal(pictureWords(pictureOf({ description: ' A mug ', words: 'Hi' })), 'A mug');
    assert.equal(pictureWords(pictureOf({ words: 'Last call' })), 'Last call');
    assert.equal(pictureWords(pictureOf({ source: 'card', card: { bestLine: '', text: 'Lovely place', name: 'A' } })), 'Lovely place');
    assert.equal(pictureWords(pictureOf({ source: 'photo' })), '');
  });

  test('a words picture starts with the post’s first sentence', () => {
    assert.equal(firstSentence('Saturday mug-painting class, 2 to 4 pm. 3 places left. Bring a friend.'), 'Saturday mug-painting class, 2 to 4 pm');
    assert.equal(firstSentence('Last call! Saturday only.'), 'Last call!');
    assert.equal(firstSentence('First line\nsecond line.'), 'First line');
    assert.equal(firstSentence('Only 3.5 kg of clay left'), 'Only 3.5 kg of clay left');
    assert.equal(firstSentence('Wait for it… tomorrow.'), 'Wait for it…');
    assert.equal(firstSentence('Coming soon...'), 'Coming soon...');
    assert.equal(firstSentence(''), '');
    assert.equal(firstSentence(null), '');
  });

  test('the first sentence is cut to the most a words picture holds, at a space', () => {
    const exact = 'a'.repeat(LIMITS.pictureWords);
    assert.equal(firstSentence(exact), exact);
    const over = `${'a'.repeat(LIMITS.pictureWords - 5)} bbbbbbbb`;
    assert.equal(firstSentence(over), 'a'.repeat(LIMITS.pictureWords - 5));
    assert.equal(firstSentence('c'.repeat(LIMITS.pictureWords + 1)), 'c'.repeat(LIMITS.pictureWords));
    assert.equal(firstSentence('one two three', 7), 'one two');
  });

  test('the focus grid maps stored values to steps and back', () => {
    assert.equal(FOCUS_STEPS, 5);
    assert.equal(focusStep(0), 0);
    assert.equal(focusStep(0.1999), 0);
    assert.equal(focusStep(0.2), 1);
    assert.equal(focusStep(0.5), 2);
    assert.equal(focusStep(0.7999), 3);
    assert.equal(focusStep(0.8), 4);
    assert.equal(focusStep(1), 4);
    assert.equal(focusStep(1.5), 4);
    assert.equal(focusStep(-0.1), 0);
    assert.equal(focusStep(Number.NaN), 2);
    assert.equal(focusStep('0.1'), 2);
    assert.deepEqual([0, 1, 2, 3, 4].map(stepFocus), [0.1, 0.3, 0.5, 0.7, 0.9]);
    assert.equal(stepFocus(-1), 0.1);
    assert.equal(stepFocus(9), 0.9);
    for (let step = 0; step < FOCUS_STEPS; step += 1) assert.equal(focusStep(stepFocus(step)), step);
  });

  test('an address’s refusal is shown by its key, never as its own sentence', () => {
    assert.equal(problemOf({ problem: 'refuse.picture.tooMany' }), 'refuse.picture.tooMany');
    assert.equal(problemOf({ aiProblem: 'ai.paused' }), 'ai.paused');
    assert.equal(problemOf({ problem: 'Something broke.' }), 'error.saveFailed');
    assert.equal(problemOf({ problem: 'nodots' }, 'x.y'), 'x.y');
    assert.equal(problemOf(null), 'error.saveFailed');
  });

  test('a post read again is taken as it comes, or wrapped once', () => {
    const full = postOf([pictureOf({})]);
    assert.equal(postFullOf(full), full);
    assert.equal(postFullOf({ post: full }), full);
    assert.equal(postFullOf({ post: { id: 3 } }), null);
    assert.equal(postFullOf(null), null);
  });

  test('the chosen picture and the room for one more', () => {
    const pictures = (count) => Array.from({ length: count }, (_, index) => pictureOf({ id: index + 1, chosen: index === 1 }));
    assert.equal(chosenOf(postOf(pictures(3))).id, 2);
    assert.equal(chosenOf(postOf([])), null);
    assert.equal(hasRoom(postOf(pictures(LIMITS.picturesPerPost - 1))), true);
    assert.equal(hasRoom(postOf(pictures(LIMITS.picturesPerPost))), false);
    assert.equal(hasRoom(postOf(pictures(LIMITS.picturesPerPost + 1))), false);
  });

  test('the busy tile shows only while a picture is made, and says which', () => {
    assert.equal(makingLine('new', false), 'pictures.makingLine');
    assert.equal(makingLine(null, true), 'pictures.makingLine', 'Make my post makes the picture');
    assert.equal(makingLine('change', false), 'pictures.changing');
    assert.equal(makingLine('change', true), 'pictures.changing');
    for (const work of [null, 'add', 'save', 'remove', 'choose:4']) assert.equal(makingLine(work, false), null, String(work));
    assert.equal(makingLine(null, 'yes'), null, 'only a real true');
  });

  test('Change this picture sends words up to the most, never only spaces, never while the strip rests', () => {
    assert.equal(canSendChange('', false), false);
    assert.equal(canSendChange('   ', false), false);
    assert.equal(canSendChange('a', false), true);
    assert.equal(canSendChange(' Make the mug blue ', false), true);
    assert.equal(canSendChange('a'.repeat(LIMITS.change), false), true);
    assert.equal(canSendChange('a'.repeat(LIMITS.change + 1), false), false);
    assert.equal(canSendChange('Make the mug blue', true), false);
    assert.equal(canSendChange(null, false), false);
  });
});

// ---- a small stand-in page for the drawing ----

const TOKENS = Object.freeze({
  '--card-foreground': 'look-card-foreground',
  '--primary': 'look-primary',
  '--primary-foreground': 'look-primary-foreground',
  '--card': 'look-card',
  '--foreground': 'look-foreground',
  '--muted-foreground': 'look-muted-foreground',
  '--chart-1': 'look-chart-1',
  '--chart-2': 'look-chart-2',
  '--chart-3': 'look-chart-3',
  '--chart-4': 'look-chart-4',
  '--chart-5': 'look-chart-5',
  '--font-display': 'Display Face, sans-serif',
  '--font-body': 'Body Face, sans-serif',
  '--display-weight': '700',
});
const COLOUR_VALUES = new Set(Object.entries(TOKENS).filter(([name]) => !name.startsWith('--font') && name !== '--display-weight').map(([, value]) => value));

const STAND_INS = ['document', 'getComputedStyle', 'Path2D', 'Image', 'fetch'];
const before = Object.fromEntries(STAND_INS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

afterEach(() => {
  for (const name of STAND_INS) {
    if (before[name]) Object.defineProperty(globalThis, name, before[name]);
    else delete globalThis[name];
  }
});

/**
 * Puts a page in place: a canvas whose 2D context records its fills, words
 * and pictures; the look's values by name; and the app's two addresses
 * (`/api/files` answers a digest per file, `PATCH /api/pictures/[id]` saves).
 * A picture whose address `unreadable` names does not open.
 */
function standInPage({ tokens = TOKENS, failFileAt = null, refusePatch = false, webp = true, noContext = false, unreadable = () => false } = {}) {
  const seen = { files: [], patches: [], fills: [], texts: [], images: [], sources: [], canvases: [], requests: 0 };
  const context = (canvas) => {
    let fill = null;
    return {
      get fillStyle() {
        return fill;
      },
      set fillStyle(value) {
        fill = value;
        seen.fills.push(value);
      },
      strokeStyle: null,
      font: '10px x',
      globalAlpha: 1,
      textBaseline: 'alphabetic',
      textAlign: 'start',
      lineWidth: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      fillRect() {},
      save() {},
      restore() {},
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      translate() {},
      scale() {},
      fillText(text, x, y) {
        seen.texts.push({ text, x, y, font: this.font, fill: this.fillStyle, canvas });
      },
      measureText(text) {
        return { width: half(text, Number(/([\d.]+)px/u.exec(this.font)[1])) };
      },
      drawImage(...args) {
        seen.images.push({ args: args.slice(1), canvas, fill });
      },
    };
  };
  globalThis.document = {
    documentElement: {},
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext: (kind) => (kind === '2d' && !noContext ? context(canvas) : null),
        toBlob(done, type) {
          const blob = type === 'image/webp' && !webp ? null : new Blob([`drawn ${canvas.width}x${canvas.height}`], { type });
          queueMicrotask(() => done(blob));
        },
      };
      seen.canvases.push(canvas);
      return canvas;
    },
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => tokens[name] ?? '' });
  globalThis.Path2D = class {
    constructor(d) {
      this.d = d;
    }
  };
  globalThis.Image = class {
    naturalWidth = 1536;
    naturalHeight = 1024;
    #src = '';
    set src(value) {
      this.#src = value;
      seen.sources.push(value);
    }
    decode() {
      return unreadable(this.#src) ? Promise.reject(new Error('unreadable')) : Promise.resolve();
    }
  };
  globalThis.fetch = async (address, init = {}) => {
    seen.requests += 1;
    // The kit's `sendFile` sends a file in pieces, each naming its place (`?size=&from=&to=`); these files are one piece.
    if (String(address).split('?')[0] === '/api/files' && init.method === 'POST') {
      const number = seen.files.length + 1;
      if (number === failFileAt) {
        seen.files.push({ failed: true });
        return Response.json({ problem: 'error.fileNotKept' }, { status: 500 });
      }
      const file = `${'d'.repeat(63)}${number}`;
      seen.files.push({ file, type: init.body.type });
      return Response.json({ file, size: init.body.size, kind: 'picture', shows: 'picture' });
    }
    const match = /^\/api\/pictures\/(\d+)$/u.exec(address);
    if (match && init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      seen.patches.push({ id: Number(match[1]), body });
      if (refusePatch) return Response.json({ problem: 'refuse.picture.shape' }, { status: 400 });
      const shapes = Object.fromEntries(Object.entries(body.shapes).map(([key, file]) => [key, file.slice(0, 12)]));
      return Response.json({ picture: pictureOf({ id: Number(match[1]), shapes: { ...NO_SHAPES, ...shapes } }) });
    }
    throw new Error(`no such address in the check: ${init.method} ${address}`);
  };
  return seen;
}

const WORDS = pictureOf({ words: 'Three places left this Saturday', chosen: true });

describe('drawing and keeping shapes', () => {
  test('without a page, nothing is drawn or kept and the page’s words say so', async () => {
    await assert.rejects(drawShape(WORDS, 'square'), (error) => error instanceof DrawProblem && error.messageKey === NOT_READY);
    await assert.rejects(keepShapes(WORDS, ['square']), (error) => error instanceof DrawProblem && error.messageKey === NOT_READY);
  });

  test('every shape is kept, then named in the record by one save with exactly the kept files', async () => {
    const seen = standInPage();
    const kept = await keepShapes(WORDS, ['portrait', 'square', 'story', 'portrait'], { themeColour: 4, business: 'Blue Clay Studio' });
    assert.equal(seen.files.length, 3);
    assert.equal(seen.patches.length, 1);
    assert.deepEqual(seen.patches[0], {
      id: 7,
      body: { shapes: { portrait: seen.files[0].file, square: seen.files[1].file, story: seen.files[2].file } },
    });
    assert.deepEqual(seen.canvases.map((canvas) => `${canvas.width}x${canvas.height}`), ['1080x1350', '1080x1080', '1080x1920']);
    assert.equal(seen.files[0].type, 'image/webp');
    assert.equal(kept.shapes.portrait, seen.files[0].file.slice(0, 12));
  });

  test('a file that is not kept half-way leaves the record untouched', async () => {
    const seen = standInPage({ failFileAt: 2 });
    await assert.rejects(keepShapes(WORDS, ['square', 'portrait', 'story'], { themeColour: 0 }), (error) => error.messageKey === 'error.fileNotKept');
    assert.equal(seen.files.length, 2, 'the third shape is not drawn after the second failed');
    assert.equal(seen.patches.length, 0, 'no shape field names anything');
  });

  test('a refused save throws the app’s own words', async () => {
    const seen = standInPage({ refusePatch: true });
    await assert.rejects(keepShapes(WORDS, ['square']), (error) => error instanceof DrawProblem && error.messageKey === 'refuse.picture.shape');
    assert.equal(seen.patches.length, 1);
  });

  test('a canvas that cannot draw, or a look value that is missing, keeps nothing and saves nothing', async () => {
    let seen = standInPage({ noContext: true });
    await assert.rejects(keepShapes(WORDS, ['square']), (error) => error.messageKey === NOT_READY);
    assert.equal(seen.requests, 0);
    seen = standInPage({ tokens: { ...TOKENS, '--chart-5': '' } });
    await assert.rejects(keepShapes(WORDS, ['square'], { themeColour: 4 }), (error) => error.messageKey === NOT_READY);
    assert.equal(seen.requests, 0);
  });

  test('shapes already kept are not drawn again', async () => {
    const shaped = { ...WORDS, shapes: { ...NO_SHAPES, square: 'eeeeeeeeeeee' } };
    let seen = standInPage();
    assert.equal(await keepShapes(shaped, ['square']), shaped);
    assert.equal(seen.requests, 0);
    seen = standInPage();
    await keepShapes(shaped, ['square', 'portrait']);
    assert.deepEqual(Object.keys(seen.patches[0].body.shapes), ['portrait']);
  });

  test('where the browser writes no WebP, the shape is written as JPEG', async () => {
    const seen = standInPage({ webp: false });
    await keepShapes(WORDS, ['square']);
    assert.equal(seen.files[0].type, 'image/jpeg');
  });

  test('a words picture is drawn in the look’s colours, inside the card, with the business at its foot', async () => {
    const seen = standInPage();
    const blob = await drawShape(WORDS, 'story', { themeColour: 2, business: 'Blue Clay Studio' });
    assert.equal(blob.type, 'image/webp');
    for (const fill of seen.fills) assert.ok(COLOUR_VALUES.has(fill), `a colour from the look, not ${fill}`);
    assert.equal(seen.fills[0], 'look-chart-3');
    const box = wordsCardBox(1080, 1920);
    const name = seen.texts.at(-1);
    assert.equal(name.text, 'Blue Clay Studio');
    assert.equal(name.y, box.nameY);
    const lines = seen.texts.slice(0, -1);
    assert.equal(lines.map((line) => line.text).join(' '), WORDS.words);
    for (const line of lines) {
      assert.match(line.font, /Display Face/u);
      const size = Number(/([\d.]+)px/u.exec(line.font)[1]);
      assert.ok(line.x + half(line.text, size) <= box.x + box.width + 0.001, line.text);
      assert.ok(line.y >= box.top && line.y + size <= box.top + box.height, line.text);
    }
  });

  test('a picture with no theme is drawn on the look’s main colour', async () => {
    const seen = standInPage();
    await drawShape(WORDS, 'square', { themeColour: null });
    assert.equal(seen.fills[0], 'look-primary');
  });

  test('a comment card is drawn with its best line, its stars and the name', async () => {
    const seen = standInPage();
    const card = pictureOf({ source: 'card', card: { bestLine: 'The nicest Saturday I have had in months.', text: '', name: 'Ayşe K.', stars: 4 } });
    await drawShape(card, 'square');
    for (const fill of seen.fills) assert.ok(COLOUR_VALUES.has(fill), `a colour from the look, not ${fill}`);
    assert.equal(seen.texts.map((line) => line.text).slice(0, -1).join(' '), 'The nicest Saturday I have had in months.');
    assert.equal(seen.texts.at(-1).text, 'Ayşe K.');
    assert.equal(seen.fills.filter((fill) => fill === 'look-chart-1').length, 4, 'four filled stars');
  });

  test('a photo fills a shape around its focus point, or fits whole on the theme’s colour', async () => {
    const photo = pictureOf({ id: 8, source: 'photo', original: 'abcdef012345', focusX: 0.9, focusY: 0.5, fit: 'auto' });
    const seen = standInPage();
    await drawShape(photo, 'square', { themeColour: 1 });
    assert.deepEqual(seen.sources, ['/api/pictures/8/file?shape=original&v=abcdef012345']);
    const cut = fillCut({ width: 1536, height: 1024, focusX: 0.9, focusY: 0.5 }, 'square');
    assert.deepEqual(seen.images[0].args, [cut.x, cut.y, cut.width, cut.height, 0, 0, 1080, 1080]);
    assert.equal(cut.x, 1536 - 1024, 'the focus near the right edge keeps the right edge');

    await drawShape(photo, 'story', { themeColour: 1 });
    const place = fitPlace({ width: 1536, height: 1024 }, 'story');
    assert.deepEqual(seen.images[1].args, [place.x, place.y, place.width, place.height]);
    assert.equal(seen.images[1].fill, 'look-chart-2', 'drawn on the theme’s colour');

    await drawShape({ ...photo, fit: 'fill' }, 'story');
    assert.equal(seen.images[2].args.length, 8, 'a chosen fill cuts the tall shape too');
  });

  test('a photo with no kept original cannot be drawn', async () => {
    const seen = standInPage();
    await assert.rejects(drawShape(pictureOf({ source: 'photo', original: null }), 'square'), (error) => error.messageKey === NOT_READY);
    await assert.rejects(drawShape(WORDS, 'round'), (error) => error.messageKey === NOT_READY);
    assert.equal(seen.requests, 0);
  });
});

describe('AI pictures rest after an AI problem that keeps refusing', () => {
  test('a lasting problem rests them with its reason', () => {
    for (const key of ['ai.paused', 'ai.openTellop', 'ai.needsPermission', 'ai.signedOut', 'ai.accountChanged', 'ai.allowance', 'ai.unavailable', 'ai.practice', 'ai.appAiOff', 'ai.dailyLimit', 'ai.appPaused']) {
      assert.equal(aiStopOf(key), key, key);
    }
    assert.equal(LASTING_AI_PROBLEMS.length, 11);
  });

  test('a problem that may pass at the next press leaves them pressable', () => {
    for (const key of ['ai.busy', 'ai.offline', 'ai.refused', 'aiplan.unreadable', 'ai.notDrawnHere', 'error.fileRoom', 'error.saveFailed', '', null, undefined, 3]) {
      assert.equal(aiStopOf(key), null, String(key));
    }
  });

  test('keeping a refused card’s shapes draws nothing and sends nothing', async () => {
    const seen = standInPage();
    const refused = pictureOf({ source: 'card', card: null, cardRefused: true });
    await assert.rejects(keepShapes(refused, ['square']), (error) => error instanceof DrawProblem && error.messageKey === NOT_READY);
    assert.equal(seen.requests, 0);
    assert.equal(seen.canvases.length, 0);
  });
});

// ---- wave 1: layouts, sets of pictures, saving a set as one zip ----

describe('a words picture’s layouts', () => {
  test('a stored layout is one the card knows, else plain words', () => {
    assert.deepEqual(CARD_LAYOUTS, ['words', 'tip', 'quote', 'offer', 'event']);
    for (const layout of CARD_LAYOUTS) assert.equal(layoutOf(layout), layout);
    for (const value of ['', 'Tip', 'list', null, undefined, 3]) assert.equal(layoutOf(value), 'words', String(value));
  });

  test('a tip shows its number only with a place from 1; a price or a date only with a subline', () => {
    assert.equal(cardParts({ layout: 'tip', place: 1 }).badge, '1');
    assert.equal(cardParts({ layout: 'tip', place: 12 }).badge, '12');
    for (const place of [0, -1, 1.5, '2', null, undefined]) assert.equal(cardParts({ layout: 'tip', place }).badge, null, String(place));
    assert.equal(cardParts({ layout: 'words', place: 2 }).badge, null, 'only a tip carries a number');
    assert.equal(cardParts({ layout: 'quote' }).quote, true);
    assert.equal(cardParts({ layout: 'offer', subline: '  ₺450\n a person ' }).price, '₺450 a person', 'one line, spaces kept single');
    assert.equal(cardParts({ layout: 'offer', subline: '   ' }).price, null);
    assert.equal(cardParts({ layout: 'event', subline: 'Sat 14:00' }).date, 'Sat 14:00');
    assert.equal(cardParts({ layout: 'event', subline: 'Sat 14:00' }).price, null, 'an event’s subline is a date, never a price');
    assert.equal(cardParts({ layout: 'words', subline: 'Sat 14:00' }).date, null);
  });

  test('on the 400 card each layout’s parts are where they are drawn, and the words make room', () => {
    const plain = wordsCardBox(400, 400);
    const tip = wordsCardBox(400, 400, { layout: 'tip', place: 2 });
    assert.deepEqual(tip.badge, { x: 36, y: 36, size: 52, numberSize: 26 });
    assert.equal(tip.top, LAYOUT_PARTS.markedTop);
    assert.equal(tip.top + tip.height, plain.top + plain.height, 'the words end where plain words end');
    assert.equal(wordsCardBox(400, 400, { layout: 'tip' }).top, WORDS_CARD.top, 'a tip with no number keeps the plain top');
    const quote = wordsCardBox(400, 400, { layout: 'quote' });
    assert.deepEqual(quote.quote, { x: 36, y: 36, size: 56 });
    assert.equal(quote.top, 108);
    const offer = wordsCardBox(400, 400, { layout: 'offer', subline: '₺450' });
    assert.equal(offer.price.y, 364 - 17 - 20 - 52);
    assert.equal(offer.top + offer.height, offer.price.y - 20);
    const event = wordsCardBox(400, 400, { layout: 'event', subline: 'Sat' });
    assert.equal(event.date.y, 364 - 17 - 20 - 30);
    assert.equal(event.top + event.height, event.date.y - 20);
    const noPrice = wordsCardBox(400, 400, { layout: 'offer' });
    assert.deepEqual([noPrice.top, noPrice.height, noPrice.price, noPrice.badge], [plain.top, plain.height, null, null], 'an offer with no price is plain words');
  });

  test('in every shape a layout’s parts stay inside the card and never cover the words or the name', () => {
    for (const key of SHAPE_KEYS) {
      const { width, height } = SHAPES[key];
      for (const options of [{ layout: 'tip', place: 3 }, { layout: 'quote' }, { layout: 'offer', subline: '₺450' }, { layout: 'event', subline: 'Sat 14:00' }]) {
        const box = wordsCardBox(width, height, options);
        const label = `${key} ${options.layout}`;
        assert.ok(box.height > 0, label);
        const mark = box.badge ?? box.quote;
        if (mark) assert.ok(mark.y + mark.size < box.top, label);
        const line = box.price ?? box.date;
        if (line) {
          assert.ok(box.top + box.height < line.y, label);
          assert.ok(line.y + line.height < box.nameY - box.nameSize, label);
          assert.ok(line.x + line.maxWidth < width, label);
        }
      }
    }
  });

  test('a tile’s words start no higher than the room it keeps for its mark', () => {
    assert.equal(wordsCardBox(400, 400, { minTop: TILE_WORDS_TOP }).top, TILE_WORDS_TOP);
    assert.equal(wordsCardBox(400, 400, { minTop: 50 }).top, WORDS_CARD.top, 'a lower floor leaves the card’s own top');
    assert.ok(wordsCardSize('Saturday class at the studio', { minTop: TILE_WORDS_TOP }) <= wordsCardSize('Saturday class at the studio'));
  });

  test('the HTML card sizes its words for the room its layout leaves', () => {
    const words = 'Two hours, all paints and tea, every Saturday at the studio';
    const plain = wordsCardSize(words);
    for (const options of [{ layout: 'offer', subline: '₺450' }, { layout: 'event', subline: 'Sat' }, { layout: 'quote' }, { layout: 'tip', place: 1 }]) {
      const size = wordsCardSize(words, options);
      assert.ok(size <= plain, options.layout);
      assert.equal((56 - size) % HTML_SIZE_STEP, 0, options.layout);
    }
    assert.ok(wordsCardSize(words, { layout: 'offer', subline: '₺450' }) < plain, 'a price takes room from long words');
  });

  test('a rounded box’s outline is drawn as path words, its corners at most half its side', () => {
    assert.equal(rectPath({ x: 1, y: 2, width: 10, height: 4 }), 'M1 2h10v4h-10Z');
    const round = rectPath({ x: 0, y: 0, width: 10, height: 4, rx: 9 });
    assert.match(round, /^M2 0h6a2 2 0 0 1 2 2/u, 'a corner larger than half the height is cut to 2');
    assert.equal(rectPath({ x: '3', y: '3', width: '18', height: '18', rx: '2' }).startsWith('M5 3h14a2 2'), true, 'an icon’s own values are text');
  });
});

describe('drawing a layout on the canvas', () => {
  test('a tip draws its number in the card’s own pair, and the words below it', async () => {
    const seen = standInPage();
    const tip = pictureOf({ words: 'Paint thin layers', layout: 'tip' });
    await drawShape(tip, 'square', { themeColour: 0, business: 'Blue Clay Studio', place: 3 });
    for (const fill of seen.fills) assert.ok(COLOUR_VALUES.has(fill), `a colour from the look, not ${fill}`);
    const number = seen.texts.find((item) => item.text === '3');
    assert.ok(number, 'the number is drawn');
    assert.ok(seen.fills.includes('look-card') && seen.fills.includes('look-card-foreground'));
    const box = wordsCardBox(1080, 1080, { layout: 'tip', place: 3 });
    const words = seen.texts.filter((item) => item.text !== '3' && item.text !== 'Blue Clay Studio');
    assert.ok(words.every((item) => item.y >= box.top), 'the words start under the badge');
  });

  test('a tip with no place draws no number', async () => {
    const seen = standInPage();
    await drawShape(pictureOf({ words: 'Paint thin layers', layout: 'tip' }), 'square', { business: '' });
    assert.equal(seen.texts.map((item) => item.text).join(' '), 'Paint thin layers');
    assert.ok(!seen.fills.includes('look-card-foreground'));
  });

  test('an offer draws its price in a badge, cut to the card’s width; an event its date line', async () => {
    let seen = standInPage();
    const long = '₺450 a person, tea and every paint included, Saturdays only';
    await drawShape(pictureOf({ words: 'Two hours', layout: 'offer', subline: long }), 'square', { themeColour: 1, business: 'Blue Clay Studio' });
    const box = wordsCardBox(1080, 1080, { layout: 'offer', subline: long });
    const price = seen.texts.find((item) => item.text.startsWith('₺450'));
    assert.ok(price.text.endsWith(ELLIPSIS), 'a price longer than the card is cut');
    assert.ok(price.x + half(price.text, box.price.size) <= box.x + box.price.maxWidth - box.price.padX + 0.001);
    assert.ok(seen.fills.includes('look-card-foreground'));
    seen = standInPage();
    await drawShape(pictureOf({ words: 'Saturday class', layout: 'event', subline: 'Sat 25 Oct, 14:00' }), 'story', { themeColour: 1, business: 'Blue Clay Studio' });
    const date = seen.texts.find((item) => item.text === 'Sat 25 Oct, 14:00');
    const eventBox = wordsCardBox(1080, 1920, { layout: 'event', subline: 'x' });
    assert.equal(date.y, eventBox.date.y + eventBox.date.height / 2, 'in the middle of its line');
    assert.equal(seen.texts.at(-1).text, 'Blue Clay Studio', 'the name stays at the foot');
  });

  test('keeping a tip’s shapes draws the place it is given', async () => {
    const seen = standInPage();
    await keepShapes(pictureOf({ words: 'Paint thin layers', layout: 'tip' }), ['square'], { place: 2 });
    assert.ok(seen.texts.some((item) => item.text === '2'));
  });
});

/** A post whose pictures are `ids` (the first chosen), each with its set places. */
function setPost(pictures, versions = []) {
  return postOf(pictures.map((fields, index) => pictureOf({ id: index + 1, position: index + 1, chosen: index === 0, slide: null, story: null, layout: 'words', ...fields })), versions);
}

describe('sets of pictures', () => {
  test('a set is in its places’ order, gaps allowed, then by id', () => {
    const post = setPost([{ slide: 5 }, { slide: 2 }, {}, { slide: 2 }, { story: 1 }]);
    assert.deepEqual(setOf(post, 'slide').map((item) => item.id), [2, 4, 1]);
    assert.deepEqual(setOf(post, 'story').map((item) => item.id), [5]);
    assert.deepEqual(setChoices(post, 'slide').map((item) => item.id), [3, 5]);
    assert.deepEqual(setOf(postOf([]), 'slide'), []);
  });

  test('adding to an empty swipe set starts it with the chosen picture, so the cover stays chosen', () => {
    const post = setPost([{}, {}, {}]);
    assert.deepEqual(addToSet(post, 'slide', 3), [1, 3]);
    assert.deepEqual(addToSet(post, 'slide', 1), [1], 'the chosen picture alone');
    assert.deepEqual(addToSet(post, 'story', 3), [3], 'a story has no cover');
    assert.deepEqual(addToSet(setPost([{ slide: 1 }, { slide: 2 }, {}]), 'slide', 3), [1, 2, 3]);
    assert.equal(addToSet(setPost([{ slide: 1 }, { slide: 2 }]), 'slide', 2), null, 'already in it');
    assert.equal(addToSet(post, 'slide', 99), null, 'not one of the post’s pictures');
  });

  test('a set takes up to its most: one under adds, at the most it is full', () => {
    const under = setPost(Array.from({ length: SET_LIMITS.slide }, (_, index) => (index < SET_LIMITS.slide - 1 ? { slide: index + 1 } : {})));
    assert.equal(setFull(under, 'slide'), false);
    assert.equal(addToSet(under, 'slide', SET_LIMITS.slide).length, SET_LIMITS.slide);
    const full = setPost([...Array.from({ length: SET_LIMITS.slide }, (_, index) => ({ slide: index + 1 })), {}]);
    assert.equal(setFull(full, 'slide'), true);
    assert.equal(addToSet(full, 'slide', SET_LIMITS.slide + 1), null);
    const stories = setPost([...Array.from({ length: SET_LIMITS.story }, (_, index) => ({ story: index + 1 })), {}]);
    assert.equal(setFull(stories, 'story'), true);
    assert.equal(addToSet(stories, 'story', SET_LIMITS.story + 1), null);
  });

  test('a picture moves one place either way, never past an end, and can be taken out', () => {
    const post = setPost([{ slide: 1 }, { slide: 2 }, { slide: 3 }, {}]);
    assert.deepEqual(moveInSet(post, 'slide', 2, -1), [2, 1, 3]);
    assert.deepEqual(moveInSet(post, 'slide', 2, 1), [1, 3, 2]);
    assert.equal(moveInSet(post, 'slide', 1, -1), null);
    assert.equal(moveInSet(post, 'slide', 3, 1), null);
    assert.equal(moveInSet(post, 'slide', 4, 1), null, 'not in the set');
    assert.deepEqual(takeOutOfSet(post, 'slide', 2), [1, 3]);
    assert.deepEqual(takeOutOfSet(setPost([{ slide: 1 }]), 'slide', 1), []);
    assert.equal(takeOutOfSet(post, 'slide', 4), null);
  });

  test('the swipe set shows for a network that takes several pictures; the story for one with stories', () => {
    const post = setPost([{}]);
    assert.deepEqual(slideNetworks(post, ['whatsapp', 'youtube', 'google']), []);
    assert.deepEqual(slideNetworks(post, ['whatsapp', 'x']), ['x']);
    assert.deepEqual(storyNetworks(post, ['x', 'linkedin']), []);
    assert.deepEqual(storyNetworks(post, ['x', 'whatsapp']), ['whatsapp']);
    const off = setPost([{}], [{ network: 'x', on: false }]);
    assert.deepEqual(slideNetworks(off, ['x']), [], 'a network switched off for this post');
  });

  test('a network that takes fewer pictures than the set says so: at its most no line, one more a line', () => {
    const four = setPost([1, 2, 3, 4].map((slide) => ({ slide })));
    assert.deepEqual(setCutLines(four, ['x', 'bluesky', 'instagram']), [], 'X and Bluesky take 4');
    const five = setPost([1, 2, 3, 4, 5].map((slide) => ({ slide })));
    assert.deepEqual(setCutLines(five, ['x', 'instagram', 'bluesky', 'whatsapp', 'youtube']), [
      { most: 1, networks: ['whatsapp', 'youtube'] },
      { most: 4, networks: ['x', 'bluesky'] },
    ]);
    assert.deepEqual(setCutLines(setPost([{ slide: 1 }]), ['whatsapp']), [], 'one picture is no set');
  });

  test('a tip’s number is its place among the tips of its set', () => {
    const post = setPost([
      { slide: 1, source: 'photo', original: 'aaaaaaaaaaaa' },
      { slide: 2, layout: 'tip' },
      { slide: 4, layout: 'quote' },
      { slide: 3, layout: 'tip' },
      { story: 1, layout: 'tip' },
      { layout: 'tip' },
    ]);
    const [cover, first, quote, second, story, loose] = post.pictures;
    assert.equal(tipPlace(post, first), 1);
    assert.equal(tipPlace(post, second), 2);
    assert.equal(tipPlace(post, quote), null);
    assert.equal(tipPlace(post, cover), null);
    assert.equal(tipPlace(post, story), 1, 'the story set counts its own tips');
    assert.equal(tipPlace(post, loose), null, 'a tip in no set has no number');
  });

  test('Make rests without words, and without room for two new pictures (the least the app makes)', () => {
    assert.equal(MAKE_SET.least, SET_LEAST_ROOM, 'the page rests where the app refuses');
    const empty = setPost([]);
    assert.deepEqual(canMakeSet(empty, 'slide', false), { ok: false, reason: 'pictures.setNeedsWords' });
    assert.deepEqual(canMakeSet(empty, 'slide', true), { ok: true });
    const room = (left) => setPost(Array.from({ length: LIMITS.picturesPerPost - left }, () => ({ source: 'photo', original: 'aaaaaaaaaaaa' })));
    assert.equal(makeRoom(room(5), 'slide'), 5);
    for (const kind of ['slide', 'story']) {
      assert.deepEqual(canMakeSet(room(3), kind, true), { ok: true }, kind);
      assert.deepEqual(canMakeSet(room(2), kind, true), { ok: true }, kind);
      assert.deepEqual(canMakeSet(room(1), kind, true), { ok: false, reason: 'pictures.setNoRoom' }, kind);
    }
  });

  test('the page counts room as the app does', () => {
    const posts = [
      setPost([]),
      setPost(Array.from({ length: 19 }, (_, index) => ({ slide: index + 1 }))),
      setPost([{ slide: 1, source: 'photo', original: 'aaaaaaaaaaaa' }, { slide: 2 }, { slide: 3, story: 1 }, { story: 2 }, {}]),
      setPost(Array.from({ length: LIMITS.picturesPerPost }, (_, index) => ({ slide: index + 1 }))),
    ];
    for (const [index, post] of posts.entries()) {
      for (const kind of ['slide', 'story']) {
        assert.equal(makeRoom(post, kind), setRoom(post, kind, { picturesPerPost: LIMITS.picturesPerPost, setMost: SET_LIMITS[kind] }), `post ${index} ${kind}`);
      }
    }
  });

  test('a new set counts the words pictures it replaces as room, never the chosen one or one in the other set', () => {
    const pictures = [
      ...Array.from({ length: 16 }, () => ({ source: 'photo', original: 'aaaaaaaaaaaa' })),
      { slide: 2, source: 'words' },
      { slide: 3, source: 'words', story: 1 },
      { slide: 4, source: 'photo', original: 'aaaaaaaaaaaa' },
      { slide: 5, source: 'words' },
    ];
    const post = setPost(pictures);
    assert.equal(post.pictures.length, LIMITS.picturesPerPost);
    assert.equal(makeRoom(post, 'slide'), 2, 'the two words slides in no story');
    assert.deepEqual(canMakeSet(post, 'slide', true), { ok: true });
    assert.equal(makeRoom(post, 'story'), 0, 'the story’s frame is also a slide: it stays');
    assert.deepEqual(canMakeSet(post, 'story', true), { ok: false, reason: 'pictures.setNoRoom' });
  });
});

/** The stand-in page with the picture file and downloads addresses too. */
function standInSaving({ refuse = false, ...options } = {}) {
  const seen = standInPage(options);
  const inner = globalThis.fetch;
  seen.zips = [];
  seen.reads = [];
  globalThis.fetch = async (address, init = {}) => {
    const file = /^\/api\/pictures\/(\d+)\/file\?shape=(\w+)/u.exec(address);
    if (file && (init.method ?? 'GET') === 'GET') {
      seen.reads.push(address);
      return new Response(`kept ${file[1]} ${file[2]}`, { headers: { 'content-type': 'image/jpeg' } });
    }
    if (address === '/api/downloads' && init.method === 'POST') {
      assert.equal(init.headers['content-type'], 'application/zip');
      seen.zips.push(init.body);
      if (refuse) return Response.json({ problem: 'refuse.long' }, { status: 413 });
      return Response.json({ address: `/api/downloads?file=${'f'.repeat(64)}` });
    }
    return inner(address, init);
  };
  return seen;
}

describe('saving a set as one zip', () => {
  test('each picture in order: words drawn now, a kept copy read, a missing copy kept first', async () => {
    const seen = standInSaving();
    const kept = [];
    const post = setPost([
      { slide: 1, source: 'photo', original: 'aaaaaaaaaaaa', shapes: { ...NO_SHAPES, portrait: 'bbbbbbbbbbbb' } },
      { slide: 2, source: 'words', words: 'Paint thin layers', layout: 'tip', shapes: { ...NO_SHAPES, portrait: 'cccccccccccc' } },
      { slide: 3, source: 'photo', original: 'eeeeeeeeeeee' },
    ]);
    const address = await bundleSet(setOf(post, 'slide'), 'portrait', { business: 'Blue Clay Studio', placeOf: (picture) => tipPlace(post, picture), onKept: (picture) => kept.push(picture) });
    assert.equal(address, `/api/downloads?file=${'f'.repeat(64)}`);
    const files = unzipStored(seen.zips[0]);
    assert.deepEqual(files.map((item) => item.name), ['01.jpg', '02.webp', '03.jpg']);
    assert.equal(new TextDecoder().decode(files[0].bytes), 'kept 1 portrait');
    assert.equal(new TextDecoder().decode(files[1].bytes), 'drawn 1080x1350', 'a words picture is drawn, not its kept copy');
    assert.ok(seen.texts.some((item) => item.text === '1'), 'its tip number as the set stands now');
    assert.equal(seen.patches.length, 1, 'the photo with no portrait copy kept it first');
    assert.equal(kept.length, 1);
    assert.equal(seen.reads.length, 2);
    assert.equal(seen.reads[1], '/api/pictures/3/file?shape=portrait&v=dddddddddddd', 'read at its new copy’s address');
  });

  test('a refused zip, a copy that cannot be read and too many files say why', async () => {
    standInSaving({ refuse: true });
    const words = [pictureOf({ id: 1, words: 'One' }), pictureOf({ id: 2, words: 'Two' })];
    await assert.rejects(bundleSet(words, 'square'), (error) => error instanceof BundleProblem && error.messageKey === 'refuse.long');
    const seen = standInSaving();
    const many = Array.from({ length: 201 }, (_, index) => pictureOf({ id: index + 1, words: 'Hi' }));
    await assert.rejects(bundleSet(many, 'square'), (error) => error.messageKey === 'share.zipTooBig');
    assert.equal(seen.zips.length, 0, 'nothing is sent');
    const refusedCard = pictureOf({ source: 'card', card: null, cardRefused: true });
    await assert.rejects(bundleSet([refusedCard], 'square'), (error) => error.messageKey === NOT_READY);
  });

  test('without a page nothing is gathered', async () => {
    await assert.rejects(bundleSet([WORDS], 'square'), (error) => error instanceof BundleProblem && error.messageKey === 'pictures.notReady');
  });
});

test('Make slides or Make a story asks first only when it would replace pictures the set holds', async () => {
  const { replacesSet } = await import('../app/pictures/rules.js');
  const { hasSet } = await import('../lib/plan/ai-sets.js');
  const picture = (id, fields = {}) => ({ id, source: 'words', chosen: false, slide: null, story: null, ...fields });
  // No set: nothing to replace, and the post's own sentences may make one.
  const none = { pictures: [picture(1, { chosen: true })] };
  assert.equal(replacesSet(none, 'slide'), false);
  assert.equal(replacesSet(none, 'story'), false);
  assert.equal(hasSet(none, 'slide'), false);
  // A swipe set of the cover alone: the cover stays, nothing is replaced (but it is a set).
  const cover = { pictures: [picture(1, { chosen: true, slide: 1 })] };
  assert.equal(replacesSet(cover, 'slide'), false);
  assert.equal(hasSet(cover, 'slide'), true);
  // A slide besides the cover, or any story frame (even the chosen picture): ask.
  assert.equal(replacesSet({ pictures: [picture(1, { chosen: true, slide: 1 }), picture(2, { slide: 2 })] }, 'slide'), true);
  assert.equal(replacesSet({ pictures: [picture(1, { chosen: true, story: 1 })] }, 'story'), true);
  assert.equal(replacesSet({ pictures: [picture(1, { chosen: true, story: 1 })] }, 'slide'), false, 'a story is not a swipe set');
  assert.equal(hasSet({ pictures: [picture(1, { story: 1 })] }, 'story'), true);
  assert.equal(hasSet({ pictures: [picture(1, { story: 0 }), picture(2, { story: 1.5 })] }, 'story'), false, 'only a place from 1 counts');
  assert.equal(hasSet(null, 'slide'), false);
});

describe('drawing in the business’s brand', () => {
  const LOGO_TAG = 'abcdef012345';
  /** Runs `work` with the page's brand set, and sets it back to none after. */
  async function withPageBrand(brand, work) {
    setPageBrand(brand);
    try {
      return await work();
    } finally {
      setPageBrand(NO_BRAND);
    }
  }

  test('a brand colour is the background and the words take the ink picked for contrast', async () => {
    for (const [colour, ink] of [['#1a237e', 'white'], ['#ffd54f', 'black'], ['#767676', 'white'], ['#777777', 'black']]) {
      const seen = standInPage();
      await drawShape(WORDS, 'square', { themeColour: 2, business: 'Blue Clay Studio', brand: { colour } });
      assert.equal(seen.fills[0], colour);
      assert.equal(inkFor(colour), ink);
      for (const line of seen.texts) assert.equal(line.fill, ink, line.text);
      assert.equal(seen.sources.length, 0, 'no logo asked for');
    }
  });

  test('without a brand the words picture is drawn exactly in the look’s colours', async () => {
    const seen = standInPage();
    await drawShape(pictureOf({ words: 'Paint thin layers', layout: 'tip' }), 'square', { themeColour: 0, business: 'Blue Clay Studio', place: 1, brand: null });
    for (const fill of seen.fills) assert.ok(COLOUR_VALUES.has(fill), `a colour from the look, not ${fill}`);
    assert.equal(seen.fills[0], 'look-chart-1');
    assert.equal(seen.texts.find((item) => item.text === '1').fill, 'look-card-foreground');
    assert.equal(seen.texts.at(-1).fill, 'look-primary-foreground');
  });

  test('the second colour is the tip’s badge, the price badge and the quote mark, with its own ink on it', async () => {
    const brand = { colour: '#1a237e', colour2: '#ffd54f' };
    let seen = standInPage();
    await drawShape(pictureOf({ words: 'Paint thin layers', layout: 'tip' }), 'square', { place: 2, brand });
    assert.ok(seen.fills.includes('#ffd54f'), 'the badge');
    assert.equal(seen.texts.find((item) => item.text === '2').fill, 'black');
    seen = standInPage();
    await drawShape(pictureOf({ words: 'Two hours', layout: 'offer', subline: '₺450' }), 'square', { brand });
    assert.equal(seen.texts.find((item) => item.text === '₺450').fill, 'black');
    assert.ok(seen.fills.includes('#ffd54f'));
    seen = standInPage();
    await drawShape(pictureOf({ words: 'The nicest Saturday', layout: 'quote' }), 'square', { brand });
    assert.ok(seen.fills.includes('#ffd54f'), 'the quote mark');
    // A brand colour alone: the badge in the words' ink, its number in the brand colour.
    seen = standInPage();
    await drawShape(pictureOf({ words: 'Paint thin layers', layout: 'tip' }), 'square', { place: 1, brand: { colour: '#1a237e' } });
    assert.equal(seen.texts.find((item) => item.text === '1').fill, '#1a237e');
    assert.ok(seen.fills.includes('white'));
  });

  test('a quote draws who said it above the business’s name', async () => {
    const seen = standInPage();
    await drawShape(pictureOf({ words: 'The nicest Saturday', layout: 'quote', subline: 'Ayşe K.' }), 'story', { business: 'Blue Clay Studio' });
    const box = wordsCardBox(1080, 1920, { layout: 'quote', subline: 'Ayşe K.' });
    const by = seen.texts.find((item) => item.text === '— Ayşe K.');
    assert.equal(by.y, box.by.y + box.by.height / 2);
    assert.equal(seen.texts.at(-1).text, 'Blue Clay Studio');
  });

  test('a photo fitted whole sits on the brand colour; a fill cut has none', async () => {
    const photo = pictureOf({ id: 8, source: 'photo', original: 'abcdef012345', fit: 'fit' });
    const seen = standInPage();
    await drawShape(photo, 'story', { themeColour: 1, brand: { colour: '#1a237e' } });
    assert.equal(seen.images[0].fill, '#1a237e');
  });

  test('with the logo, every shape carries it in its corner, opened once for all of them', async () => {
    const seen = standInPage();
    const kept = await keepShapes(WORDS, ['square', 'story'], { business: 'A business name long enough to reach the logo', brand: { logo: LOGO_TAG } });
    assert.equal(seen.sources.filter((source) => source === logoAddress(LOGO_TAG)).length, 1);
    assert.equal(seen.images.length, 2);
    for (const [index, key] of ['square', 'story'].entries()) {
      const { width, height } = SHAPES[key];
      const box = logoBox(width, height, 1536, 1024);
      assert.deepEqual(seen.images[index].args, [box.x, box.y, box.width, box.height]);
      assert.equal(seen.images[index].canvas, seen.canvases[index]);
    }
    // The name ends before the logo.
    const names = seen.texts.filter((item) => item.text.startsWith('A business'));
    assert.ok(names.every((item) => item.text.endsWith(ELLIPSIS)));
    for (const name of names) {
      const size = Number(/([\d.]+)px/u.exec(name.font)[1]);
      const { width, height } = name.canvas;
      assert.ok(name.x + half(name.text, size) < logoBox(width, height).x, 'the name stays clear of the logo');
    }
    assert.ok(kept.shapes.square && kept.shapes.story);
  });

  test('a photo and a comment card carry the logo too', async () => {
    let seen = standInPage();
    await drawShape(pictureOf({ id: 8, source: 'photo', original: 'abcdef012345', fit: 'fill' }), 'square', { brand: { logo: LOGO_TAG } });
    assert.equal(seen.images.length, 2, 'the photo, then the logo');
    const box = logoBox(1080, 1080, 1536, 1024);
    assert.deepEqual(seen.images[1].args, [box.x, box.y, box.width, box.height]);
    seen = standInPage();
    await drawShape(pictureOf({ source: 'card', card: { bestLine: 'Lovely', text: '', name: 'Ayşe', stars: 5 } }), 'square', { brand: { logo: LOGO_TAG } });
    assert.deepEqual(seen.images.at(-1).args, [box.x, box.y, box.width, box.height]);
  });

  test('a logo that does not open keeps nothing and names nothing', async () => {
    const seen = standInPage({ unreadable: (source) => source.startsWith('/api/plan/logo') });
    await assert.rejects(keepShapes(WORDS, ['square'], { brand: { logo: LOGO_TAG } }), (error) => error instanceof DrawProblem && error.messageKey === NOT_READY);
    assert.equal(seen.files.length, 0);
    assert.equal(seen.patches.length, 0);
  });

  test('without a brand in the options the page’s brand is drawn; a brand of none given draws none', async () => {
    assert.equal(currentPageBrand(), NO_BRAND);
    await withPageBrand({ colour: '#ffd54f', logo: LOGO_TAG }, async () => {
      let seen = standInPage();
      await keepShapes(WORDS, ['square'], { themeColour: 2 });
      assert.equal(seen.fills[0], '#ffd54f');
      assert.ok(seen.sources.includes(logoAddress(LOGO_TAG)));
      seen = standInPage();
      await drawShape(WORDS, 'square', { themeColour: 2, brand: null });
      assert.equal(seen.fills[0], 'look-chart-3');
      assert.equal(seen.sources.length, 0);
    });
    assert.equal(currentPageBrand(), NO_BRAND);
  });

  test('the page’s brand is read safely and changes only when it differs', () => {
    setPageBrand({ colour: '#FFD54F', colour2: 'nonsense', logo: 'not a tag' });
    try {
      const first = currentPageBrand();
      assert.deepEqual(first, { colour: '#ffd54f', colour2: '', logo: null });
      setPageBrand({ colour: '#ffd54f' });
      assert.equal(currentPageBrand(), first, 'the same brand keeps the same answer');
    } finally {
      setPageBrand(NO_BRAND);
    }
  });
});

describe('Change words', () => {
  const offer = pictureOf({ words: 'Two hours, tea included', layout: 'offer', subline: '₺450' });

  test('empty words save nothing; unchanged words, layout and line send nothing', () => {
    assert.equal(wordsChanges(offer, { words: '  \n ', layout: 'offer', subline: '₺450' }), null);
    assert.deepEqual(wordsChanges(offer, { words: ' Two hours, tea included ', layout: 'offer', subline: ' ₺450 ' }), {});
  });

  test('only what changed is sent: the words with their line breaks, the layout, the line on one line', () => {
    assert.deepEqual(wordsChanges(offer, { words: 'Two hours,\r\ntea included', layout: 'offer', subline: '₺450' }), { words: 'Two hours,\ntea included' });
    assert.deepEqual(wordsChanges(offer, { words: offer.words, layout: 'event', subline: 'Sat   25 Oct\n14:00' }), { layout: 'event', subline: 'Sat 25 Oct 14:00' });
    assert.deepEqual(wordsChanges(offer, { words: offer.words, layout: 'offer', subline: '' }), { subline: '' });
  });

  test('a layout with no line under its words leaves the kept line as it is', () => {
    assert.deepEqual(wordsChanges(offer, { words: offer.words, layout: 'tip', subline: 'typed but hidden' }), { layout: 'tip' });
    assert.deepEqual(wordsChanges(offer, { words: offer.words, layout: 'words', subline: '' }), { layout: 'words' });
    // A stored layout the card does not know reads as plain words; an unknown choice is plain words too.
    assert.deepEqual(wordsChanges(pictureOf({ words: 'Hi', layout: 'banner' }), { words: 'Hi', layout: 'nonsense', subline: '' }), {});
    assert.deepEqual(wordsChanges(pictureOf({ words: 'Hi', layout: 'words', subline: 'Ayşe' }), { words: 'Hi', layout: 'quote', subline: 'Ayşe' }), { layout: 'quote' });
  });
});
