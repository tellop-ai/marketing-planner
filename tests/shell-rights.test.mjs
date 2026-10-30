/**
 * Every page hands its `Shell` what the person may press (`rights=`, from
 * `rightsForThisVisit()` in `lib/plan/visitor.js`). A `Shell` drawn without
 * them draws nothing that saves: the owner loses New post there and an owner
 * looking as a Member or a Viewer loses the way back. Checked on the parsed
 * source (`./jsx-source.mjs`): each `<Shell>` element's own opening tag, never
 * a slice of text, so a comment, a string or a child's attribute never counts.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { jsxElements } from './jsx-source.mjs';

const projectRoot = path.join(import.meta.dirname, '..');

/** Every JavaScript and JSX file under `app/`, by its path from the project. */
function appFiles(folder = 'app') {
  return readdirSync(path.join(projectRoot, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return appFiles(relative);
    return /\.(?:jsx?|mjs)$/u.test(entry.name) ? [relative] : [];
  });
}

/** The `Shell` elements of one source, each with its line. */
const shellsIn = (text, name) => jsxElements(text, name).filter((element) => element.name === 'Shell');

/** Whether one element's own opening tag hands over the rights, as a named attribute (a spread could hide it). */
const handsRights = (element) => element.attributes.includes('rights') && !element.spread;

describe('every Shell gets the rights', () => {
  test('each page that draws a Shell names rights= on it', () => {
    const missing = [];
    let shells = 0;
    let importing = 0;
    for (const file of appFiles()) {
      const text = readFileSync(path.join(projectRoot, file), 'utf8');
      const found = shellsIn(text, file);
      // A file that imports the Shell and draws none is a reader that lost its place, never a pass.
      if (/^import\s*\{[^}]*\bShell\b[^}]*\}\s*from\s*'[^']*shell\.jsx';/mu.test(text)) {
        importing += 1;
        assert.ok(found.length > 0, `${file} imports the Shell and the reader found no <Shell> in it`);
      }
      shells += found.length;
      for (const shell of found) if (!handsRights(shell)) missing.push(`${file}:${shell.line}`);
    }
    // The nine pages and the two not-found pages, each with one Shell or more.
    assert.ok(importing >= 11, `only ${importing} files import the Shell`);
    assert.ok(shells >= 11, `only ${shells} <Shell> elements were found`);
    assert.deepEqual(missing, [], `a <Shell> without rights=: ${missing.join(', ')}`);
  });
});

describe('the reader of the source', () => {
  test('finds the attribute on the element\'s own opening tag only', () => {
    const [shell] = shellsIn('const page = () => <Shell locale={l} path="/"><Child rights={r} /></Shell>;');
    assert.equal(handsRights(shell), false, 'a child\'s rights= is not the Shell\'s');
    const [kept] = shellsIn('export default async function Page() {\n  return (\n    <Shell locale={l} rights={rights}>\n      <p>Hi</p>\n    </Shell>\n  );\n}\n');
    assert.equal(handsRights(kept), true);
    assert.equal(kept.line, 3);
    const [spread] = shellsIn('const x = <Shell {...props} />;');
    assert.equal(handsRights(spread), false, 'a spread may or may not carry it: refused');
  });

  test('words in a comment, a string, a template or a comparison are no element', () => {
    const text = [
      '// <Shell rights={r}>',
      '/* <Shell> */',
      "const a = '<Shell rights={r}>';",
      'const b = `<Shell ${1 < 2 ? \'rights\' : \'\'}>`;',
      'const c = Shell < limit;',
      "const d = /['\"<]Shell/u.test(a);",
      'const e = a / 2 / 3;',
    ].join('\n');
    assert.deepEqual(shellsIn(text), []);
  });

  test('JSX text with quotes and code with braces read to the end', () => {
    const text = 'const x = cond && (<Shell locale={{ a: [1, 2] }} rights={r}><p>Don\'t "stop"</p>{list.map((i) => <b key={i}>{i}</b>)}</Shell>);';
    const elements = jsxElements(text);
    assert.deepEqual(elements.map((element) => element.name), ['Shell', 'p', 'b']);
    assert.equal(handsRights(elements[0]), true);
  });

  test('a file it cannot read to its end is refused, never read as empty', () => {
    assert.throws(() => jsxElements('const x = <Shell rights={r}><p>open'), /has no closing tag/u);
    assert.throws(() => jsxElements('const x = <Shell rights={r}></Main>;'), /does not close/u);
    assert.throws(() => jsxElements("const x = 'open"), /not closed/u);
    assert.throws(() => jsxElements('const x = (1;'), /not closed/u);
    assert.throws(() => jsxElements('/* open'), /comment is not closed/u);
  });
});
