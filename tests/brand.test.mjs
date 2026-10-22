/**
 * The business's brand on its pictures: the ink picked for contrast on a
 * brand colour (WCAG 4.5:1, at the edge and on each side), the colours a
 * words picture is drawn in with and without a brand, the logo's box, and the
 * kept copies a change of brand clears (in the records, through Tellop's
 * bounds). The canvas drawing itself is checked in `pictures.test.mjs`.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, describe, test } from 'node:test';

import {
  CARD_SUBLINE_MOST,
  INK,
  INK_CONTRAST,
  LOGO,
  LOGO_NAME_ROOM,
  NO_BRAND,
  PICTURE_VARIABLES,
  WORDS_CARD,
  brandHex,
  cardParts,
  cardPaint,
  contrastOf,
  inkContrastOf,
  inkFor,
  logoAddress,
  logoBox,
  luminanceOf,
  pictureBrandOf,
  pictureVariables,
  readBrand,
  wordsCardBox,
} from '../lib/plan/card-layout.js';
import { SHAPES, SHAPE_KEYS } from '../lib/plan/shapes.js';

const projectRoot = path.join(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'brand-'));
const startedIn = process.cwd();
process.chdir(projectRoot);
process.env.APP_DATA_FILE = path.join(scratch, 'app.db');

const { closeStorage } = await import('../lib/data/index.js');
const plan = await import('../lib/data/plan.js');
const posts = await import('../lib/data/posts.js');
const { brandCopySteps, brandOnPictures } = await import('../lib/data/brand-copies.js');
const { OWNER } = await import('../lib/plan/owner.js');
const { bounded, measured } = await import('./records-bounds.mjs');

const OTHER = 'someone-else';

after(async () => {
  await closeStorage();
  process.chdir(startedIn);
  rmSync(scratch, { recursive: true, force: true });
});

/** A grey as `#rrggbb`. @param {number} value */
const grey = (value) => `#${value.toString(16).padStart(2, '0').repeat(3)}`;

describe('the ink on a brand colour', () => {
  test('black and white are the ends of the scale', () => {
    assert.equal(luminanceOf(grey(0)), 0);
    assert.equal(luminanceOf(grey(255)), 1);
    assert.equal(contrastOf(1, 0), 21);
    assert.equal(luminanceOf('#12345'), null);
    assert.equal(luminanceOf('red'), null);
    assert.equal(inkFor(''), null);
  });

  test('at the edge: white while it keeps 4.5:1, black one step lighter', () => {
    // #767676 is the lightest grey white words keep 4.5:1 on; #777777 is one step past it.
    assert.ok(contrastOf(1, luminanceOf('#767676')) >= INK_CONTRAST);
    assert.ok(contrastOf(1, luminanceOf('#777777')) < INK_CONTRAST);
    assert.equal(inkFor('#767676'), INK.light);
    assert.equal(inkFor('#777777'), INK.dark);
    assert.ok(inkContrastOf('#777777') >= INK_CONTRAST);
    assert.equal(inkFor('#000000'), 'white');
    assert.equal(inkFor('#FFFFFF'), 'black');
  });

  test('every grey and a grid of colours get an ink with at least 4.5:1', () => {
    for (let value = 0; value <= 255; value += 1) assert.ok(inkContrastOf(grey(value)) >= INK_CONTRAST, grey(value));
    const steps = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];
    for (const red of steps) {
      for (const green of steps) {
        for (const blue of steps) {
          const hex = `#${[red, green, blue].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
          assert.ok(inkContrastOf(hex) >= INK_CONTRAST, hex);
        }
      }
    }
  });
});

describe('a brand as the pictures take it', () => {
  test('a colour is #rrggbb in small letters, anything else none', () => {
    assert.equal(brandHex('#A1B2C3'), '#a1b2c3');
    assert.equal(brandHex(' #a1b2c3 '), '#a1b2c3');
    for (const wrong of ['', '#abc', 'a1b2c3', '#a1b2c3d', null, 3, 'var(--primary)']) assert.equal(brandHex(wrong), '');
  });

  test('My plan gives the logo only while the switch is on and a logo is kept', () => {
    assert.equal(pictureBrandOf(null), NO_BRAND);
    assert.equal(pictureBrandOf({ brandColour: '', brandColour2: '', logoOnPictures: false, logo: null }), NO_BRAND);
    assert.deepEqual(pictureBrandOf({ brandColour: '#AA0000', brandColour2: '', logoOnPictures: false, logo: 'abcdefabcdef' }), { colour: '#aa0000', colour2: '', logo: null });
    // The switch can stay on after the logo is removed: no logo then.
    assert.equal(pictureBrandOf({ logoOnPictures: true, logo: null }), NO_BRAND);
    assert.deepEqual(pictureBrandOf({ logoOnPictures: true, logo: 'abcdefabcdef' }), { colour: '', colour2: '', logo: 'abcdefabcdef' });
    // Never a whole digest or an address: only a 12-character tag.
    assert.equal(readBrand({ logo: 'a'.repeat(64) }), NO_BRAND);
    assert.equal(readBrand({ logo: '../x' }), NO_BRAND);
    assert.equal(logoAddress('abcdefabcdef'), '/api/plan/logo?v=abcdefabcdef');
  });

  test('without a brand every colour is the look’s name it was drawn in before', () => {
    for (const brand of [undefined, null, NO_BRAND, { colour: 'nonsense' }]) {
      assert.deepEqual(cardPaint(2, brand), { bg: '--chart-3', ink: '--primary-foreground', accent: '--card', accentInk: '--card-foreground' });
      assert.deepEqual(cardPaint(null, brand).bg, '--primary');
      // The page's card keeps its classes: nothing is set on it.
      assert.ok(pictureVariables(4, brand).every(([, value]) => value === null));
    }
    // Only the logo: the colours stay the look's.
    assert.ok(pictureVariables(0, { logo: 'abcdefabcdef' }).every(([, value]) => value === null));
  });

  test('a brand colour is the background, the words black or white, the badges in the ink', () => {
    assert.deepEqual(cardPaint(2, { colour: '#1a237e' }), { bg: '#1a237e', ink: 'white', accent: 'white', accentInk: '#1a237e' });
    assert.deepEqual(cardPaint(2, { colour: '#ffd54f' }), { bg: '#ffd54f', ink: 'black', accent: 'black', accentInk: '#ffd54f' });
    assert.deepEqual(pictureVariables(2, { colour: '#ffd54f' }), [
      [PICTURE_VARIABLES.bg, '#ffd54f'],
      [PICTURE_VARIABLES.ink, 'black'],
      [PICTURE_VARIABLES.accent, 'black'],
      [PICTURE_VARIABLES.accentInk, '#ffd54f'],
    ]);
  });

  test('the second colour is the badges and the quote mark, its own ink on it', () => {
    assert.deepEqual(cardPaint(1, { colour: '#1a237e', colour2: '#ffd54f' }), { bg: '#1a237e', ink: 'white', accent: '#ffd54f', accentInk: 'black' });
    // A second colour alone: the theme's background and words, the brand's badges.
    assert.deepEqual(cardPaint(1, { colour2: '#1a237e' }), { bg: '--chart-2', ink: '--primary-foreground', accent: '#1a237e', accentInk: 'white' });
    assert.deepEqual(pictureVariables(1, { colour2: '#1a237e' }).map(([, value]) => value), [null, null, '#1a237e', 'white']);
  });

  test('the line under a picture’s words holds what the app keeps', async () => {
    const { SUBLINE_MOST } = await import('../lib/data/posts.js');
    assert.equal(CARD_SUBLINE_MOST, SUBLINE_MOST);
    assert.equal(cardParts({ layout: 'quote', subline: '  Ayşe   K. ' }).by, '— Ayşe K.');
    assert.equal(cardParts({ layout: 'quote' }).by, null);
    assert.equal(cardParts({ layout: 'offer', subline: 'Ayşe' }).by, null);
  });
});

describe('the logo’s box', () => {
  test('a square logo: 8% of the shorter side, 4% from both edges', () => {
    assert.deepEqual(logoBox(1000, 1000), { x: 1000 - 40 - 80, y: 1000 - 40 - 80, width: 80, height: 80 });
    // A tall shape: measured on its shorter side, in its bottom right corner.
    assert.deepEqual(logoBox(1000, 2000), { x: 880, y: 1880, width: 80, height: 80 });
    assert.deepEqual(logoBox(2000, 1000), { x: 1880, y: 880, width: 80, height: 80 });
  });

  test('a wide or tall logo keeps its proportions, pressed into the corner', () => {
    assert.deepEqual(logoBox(1000, 1000, 400, 100), { x: 880, y: 940, width: 80, height: 20 });
    assert.deepEqual(logoBox(1000, 1000, 100, 400), { x: 940, y: 880, width: 20, height: 80 });
    assert.throws(() => logoBox(1000, 1000, 0, 100), TypeError);
  });

  test('in every shape the logo stays inside the picture, and a words picture’s name ends before it', () => {
    assert.equal(LOGO_NAME_ROOM, 20);
    for (const key of SHAPE_KEYS) {
      const { width, height } = SHAPES[key];
      for (const [wide, high] of [[1, 1], [5, 1], [1, 5]]) {
        const box = logoBox(width, height, wide, high);
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, key);
        const short = Math.min(width, height);
        assert.ok(Math.abs(width - (box.x + box.width) - short * LOGO.margin) < 1e-9, key);
        assert.ok(Math.abs(height - (box.y + box.height) - short * LOGO.margin) < 1e-9, key);
      }
      const square = logoBox(width, height);
      for (const layout of ['words', 'offer', 'event', 'quote']) {
        const card = wordsCardBox(width, height, { layout, subline: 'line', logo: true });
        assert.ok(card.x + card.nameWidth < square.x, `${key} ${layout}: the name ends before the logo`);
        const plain = wordsCardBox(width, height, { layout, subline: 'line' });
        assert.equal(plain.nameWidth, plain.width);
        // A price, a date or who said it ends above the logo's box.
        const line = card.price ?? card.date ?? card.by;
        if (line) assert.ok(line.y + line.height < square.y, `${key} ${layout}: the line stays above the logo`);
      }
    }
    // On the 400 card the name keeps 20 units more room on its right.
    const card = wordsCardBox(400, 400, { logo: true });
    assert.equal(card.nameWidth, 400 - 2 * WORDS_CARD.pad - 20);
  });
});

// ---- the kept copies a change of brand clears ----

const DIGEST = (number) => number.toString(16).padStart(64, '0');
const COPIES = Object.fromEntries(SHAPE_KEYS.map((key, index) => [key, DIGEST(index + 1)]));

/** A post with a words picture, a photo cut to fill and a photo fitted whole, every copy kept. */
async function picturesWithCopies(owner) {
  const post = await posts.createPostFor(owner, { name: 'Autumn mugs' });
  const words = await posts.addPictureFor(owner, post.id, { source: 'words', words: 'Three places left' });
  const filled = await posts.addPictureFor(owner, post.id, { source: 'photo', file: DIGEST(100), width: 1200, height: 800 });
  const fitted = await posts.addPictureFor(owner, post.id, { source: 'photo', file: DIGEST(101), width: 1200, height: 800 });
  await posts.updatePictureFor(owner, filled.id, { fit: 'fill' });
  await posts.updatePictureFor(owner, fitted.id, { fit: 'fit' });
  for (const picture of [words, filled, fitted]) await posts.updatePictureFor(owner, picture.id, { shapes: COPIES });
  return { postId: post.id, ids: { words: words.id, filled: filled.id, fitted: fitted.id } };
}

/** Which shapes each picture still has a copy of. */
async function keptOf(owner, { postId, ids }) {
  const full = await posts.getPostFor(owner, postId);
  const shapes = (id) => SHAPE_KEYS.filter((key) => full.pictures.find((picture) => picture.id === id).shapes[key] !== null);
  return { words: shapes(ids.words), filled: shapes(ids.filled), fitted: shapes(ids.fitted) };
}

describe('a change of brand clears the copies drawn in the old one', () => {
  test('the steps: nothing for the same look, words and fitted copies for a colour, everything for the logo', () => {
    const none = brandOnPictures(null);
    assert.deepEqual(none, { colour: '', colour2: '', logo: null });
    assert.deepEqual(brandCopySteps('o', none, none), []);
    // The switch on without a logo kept: the pictures look the same.
    assert.deepEqual(brandOnPictures({ logoOnPictures: true, logoFile: null }), none);
    assert.deepEqual(brandCopySteps('o', none, brandOnPictures({ logoOnPictures: true })), []);
    const second = brandCopySteps('o', none, { ...none, colour2: '#112233' });
    assert.equal(second.length, 1);
    assert.deepEqual(second[0].args.where, { ownerId: 'o', source: 'words' });
    const colour = brandCopySteps('o', none, { ...none, colour: '#112233' });
    assert.ok(colour.length > 1);
    assert.ok(colour.every((step) => step.action === 'updateMany' && step.args.where.ownerId === 'o'));
    const logo = brandCopySteps('o', none, { ...none, logo: DIGEST(7) });
    assert.deepEqual(logo.map((step) => step.args.where), [{ ownerId: 'o' }]);
  });

  test('a brand colour clears every words copy and the fitted copies; the same colour again clears nothing', async () => {
    const mine = await picturesWithCopies(OWNER);
    const theirs = await picturesWithCopies(OTHER);
    const all = [...SHAPE_KEYS];
    const kept = await keptOf(OWNER, mine);
    assert.deepEqual(kept, { words: all, filled: all, fitted: all });

    const saved = await measured(() => plan.saveProfileFor(OWNER, { brandColour: '#1a237e' }));
    assert.equal(saved.value.brandColour, '#1a237e');
    bounded(saved, 'a brand colour saved', 2);
    assert.ok(saved.calls.every((call) => call.inFlight === 1), 'one call at a time');
    const after = await keptOf(OWNER, mine);
    assert.deepEqual(after.words, []);
    assert.deepEqual(after.filled, all);
    // Only the shapes a photo is fitted whole in were drawn on the colour.
    assert.ok(after.fitted.length < all.length);
    // Another owner's copies stay.
    assert.deepEqual(await keptOf(OTHER, theirs), { words: all, filled: all, fitted: all });

    await posts.updatePictureFor(OWNER, mine.ids.words, { shapes: COPIES });
    const again = await measured(() => plan.saveProfileFor(OWNER, { brandColour: '#1a237e', businessName: 'Clay & Co' }));
    assert.deepEqual((await keptOf(OWNER, mine)).words, all);
    assert.ok(again.calls.length <= 2);
  });

  test('the second colour clears only the words pictures’ copies', async () => {
    const mine = await picturesWithCopies(OWNER);
    await plan.saveProfileFor(OWNER, { brandColour2: '#ffd54f' });
    const after = await keptOf(OWNER, mine);
    assert.deepEqual(after.words, []);
    assert.deepEqual(after.filled, [...SHAPE_KEYS]);
    assert.deepEqual(after.fitted, [...SHAPE_KEYS]);
  });

  test('saving words that are not the brand reads and clears nothing', async () => {
    const mine = await picturesWithCopies(OWNER);
    const saved = await measured(() => plan.saveProfileFor(OWNER, { businessName: 'Clay & Co', trackLinks: false }));
    assert.equal(saved.calls.length, 1);
    assert.deepEqual(await keptOf(OWNER, mine), { words: [...SHAPE_KEYS], filled: [...SHAPE_KEYS], fitted: [...SHAPE_KEYS] });
  });

  test('the logo: switched on with a logo kept, a new logo and switched off each clear every copy; off, a new logo clears none', async () => {
    const all = [...SHAPE_KEYS];
    const mine = await picturesWithCopies(OWNER);
    await plan.saveProfileFor(OWNER, { logoOnPictures: false });
    // Off: a logo added changes no picture.
    await plan.saveLogoFor(OWNER, DIGEST(200));
    assert.deepEqual(await keptOf(OWNER, mine), { words: all, filled: all, fitted: all });

    const on = await measured(() => plan.saveProfileFor(OWNER, { logoOnPictures: true }));
    bounded(on, 'the logo switched on', 2);
    assert.deepEqual(await keptOf(OWNER, mine), { words: [], filled: [], fitted: [] });

    const again = await picturesWithCopies(OWNER);
    const replaced = await measured(() => plan.saveLogoFor(OWNER, DIGEST(201)));
    bounded(replaced, 'a new logo', 2);
    assert.ok(replaced.calls.every((call) => call.inFlight === 1));
    assert.deepEqual(await keptOf(OWNER, again), { words: [], filled: [], fitted: [] });

    const third = await picturesWithCopies(OWNER);
    await plan.saveProfileFor(OWNER, { logoOnPictures: false });
    assert.deepEqual(await keptOf(OWNER, third), { words: [], filled: [], fitted: [] });

    // Switched on again with the logo removed: nothing carries a logo, nothing clears.
    await plan.saveLogoFor(OWNER, null);
    const fourth = await picturesWithCopies(OWNER);
    await plan.saveProfileFor(OWNER, { logoOnPictures: true });
    assert.deepEqual(await keptOf(OWNER, fourth), { words: all, filled: all, fitted: all });
  });
});
