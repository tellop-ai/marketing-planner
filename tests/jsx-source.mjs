/**
 * A reader of this app's own JavaScript and JSX for checks about its source
 * (not a test file itself: `node --test` runs only `*.test.mjs`).
 *
 * A check that cuts text from an anchor to the next `>` widens or narrows
 * silently when the code around it moves, and keeps passing. So this walks a
 * file as the language reads it, with no package: comments, strings, template
 * literals, regular expressions and brackets in the code; JSX elements, their
 * attributes (with the code inside braces) and their children. It hands back
 * every JSX element it met with its own attribute names, so a check is about
 * one element's opening tag and nothing else: words in a comment or a string,
 * and an attribute of a child element, never count.
 *
 * It refuses rather than guesses: a file it cannot read to its end (a string,
 * comment, template or element left open, a closing tag that does not match,
 * a bracket that does not close) throws with the file and the line, so a
 * reader that lost its place fails the check instead of finding nothing.
 */

const WORD = /[\w$]/u;
const NAME_START = /[A-Za-z_$]/u;
/** After one of these characters (or nothing), a `/` starts a regular expression and a `<` an element. */
const EXPRESSION_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const EXPRESSION_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const CLOSERS = Object.freeze({ '(': ')', '[': ']', '{': '}' });

/**
 * Every JSX element in `text`, in the order its opening tag starts: its name
 * (`''` for a fragment), its own attribute names, whether it spreads an
 * object into its attributes, and its line.
 *
 * @param {string} text
 * @param {string} [fileName]
 * @returns {Array<{ name: string, attributes: string[], spread: boolean, line: number }>}
 */
export function jsxElements(text, fileName = 'source') {
  const elements = [];
  let at = 0;

  const lineAt = (index) => text.slice(0, index).split('\n').length;
  const refuse = (why, index = at) => {
    throw new Error(`jsx-source: ${fileName}:${lineAt(index)} ${why}`);
  };
  const skipSpace = () => {
    while (at < text.length && /\s/u.test(text[at])) at += 1;
  };

  /** A quoted string in code (no line break inside), from its opening quote. */
  function quoted() {
    const quote = text[at];
    const start = at;
    at += 1;
    while (at < text.length && text[at] !== quote) {
      if (text[at] === '\n') refuse('a string is not closed on its line', start);
      at += text[at] === '\\' ? 2 : 1;
    }
    if (at >= text.length) refuse('a string is not closed', start);
    at += 1;
  }

  /** A template literal, from its backtick; each `${` reads code to its `}`. */
  function template() {
    const start = at;
    at += 1;
    while (at < text.length && text[at] !== '`') {
      if (text[at] === '\\') {
        at += 2;
      } else if (text[at] === '$' && text[at + 1] === '{') {
        at += 2;
        code('}');
        at += 1;
      } else {
        at += 1;
      }
    }
    if (at >= text.length) refuse('a template is not closed', start);
    at += 1;
  }

  /** A regular expression, from its first `/`, with its flags. */
  function regex() {
    const start = at;
    at += 1;
    let inClass = false;
    while (at < text.length && (inClass || text[at] !== '/')) {
      if (text[at] === '\n') refuse('a regular expression is not closed on its line', start);
      if (text[at] === '\\') at += 1;
      else if (text[at] === '[') inClass = true;
      else if (text[at] === ']') inClass = false;
      at += 1;
    }
    if (at >= text.length) refuse('a regular expression is not closed', start);
    at += 1;
    while (at < text.length && WORD.test(text[at])) at += 1;
  }

  /** A comment at `at`, if one starts there; answers whether it read one. */
  function comment() {
    if (text[at] !== '/' || (text[at + 1] !== '/' && text[at + 1] !== '*')) return false;
    if (text[at + 1] === '/') {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
    } else {
      const end = text.indexOf('*/', at + 2);
      if (end === -1) refuse('a comment is not closed');
      at = end + 2;
    }
    return true;
  }

  /**
   * Code up to an unmatched `stop` (`}` for code inside braces, null for the
   * whole file), leaving `at` on it. Brackets inside must match.
   *
   * @param {string | null} stop
   */
  function code(stop) {
    const open = [];
    let last = null;
    let lastWord = '';
    const expressionNext = () => last === null || EXPRESSION_AFTER.has(last) || (last === 'w' && EXPRESSION_WORDS.has(lastWord));
    while (at < text.length) {
      const char = text[at];
      if (/\s/u.test(char)) {
        at += 1;
      } else if (comment()) {
        // read
      } else if (char === '\'' || char === '"') {
        quoted();
        last = 'v';
      } else if (char === '`') {
        template();
        last = 'v';
      } else if (char === '/') {
        if (expressionNext()) {
          regex();
          last = 'v';
        } else {
          at += 1;
          last = '/';
        }
      } else if (char === '<' && expressionNext() && (NAME_START.test(text[at + 1] ?? '') || text[at + 1] === '>')) {
        element();
        last = 'v';
      } else if (WORD.test(char)) {
        const start = at;
        while (at < text.length && WORD.test(text[at])) at += 1;
        lastWord = text.slice(start, at);
        last = 'w';
      } else if (char in CLOSERS) {
        open.push(CLOSERS[char]);
        at += 1;
        last = char;
      } else if (char === ')' || char === ']' || char === '}') {
        if (open.length === 0) {
          if (char === stop) return;
          refuse(`"${char}" closes nothing`);
        }
        if (open.pop() !== char) refuse(`"${char}" does not close the bracket open before it`);
        at += 1;
        last = char;
      } else {
        at += 1;
        last = char;
      }
    }
    if (stop !== null) refuse(`code inside braces is not closed by "${stop}"`);
    if (open.length > 0) refuse('a bracket is not closed');
  }

  /** `{` code `}` inside JSX, from its `{`. */
  function braces() {
    at += 1;
    code('}');
    at += 1;
  }

  /** A JSX element (or fragment), from its `<`, to the end of its closing tag. */
  function element() {
    const start = at;
    at += 1;
    let name = '';
    if (text[at] !== '>') {
      const from = at;
      while (at < text.length && /[\w$.:-]/u.test(text[at])) at += 1;
      name = text.slice(from, at);
    }
    const found = { name, attributes: [], spread: false, line: lineAt(start) };
    elements.push(found);
    for (;;) {
      skipSpace();
      if (at >= text.length) refuse(`<${name}> is not closed`, start);
      if (text.startsWith('/>', at)) {
        at += 2;
        return;
      }
      if (text[at] === '>') {
        at += 1;
        break;
      }
      if (text[at] === '{') {
        found.spread = true;
        braces();
        continue;
      }
      if (!NAME_START.test(text[at])) refuse(`<${name}> holds something that is no attribute`);
      const from = at;
      while (at < text.length && /[\w$:-]/u.test(text[at])) at += 1;
      found.attributes.push(text.slice(from, at));
      skipSpace();
      if (text[at] !== '=') continue;
      at += 1;
      skipSpace();
      if (text[at] === '"' || text[at] === '\'') {
        const end = text.indexOf(text[at], at + 1);
        if (end === -1) refuse(`an attribute of <${name}> is not closed`);
        at = end + 1;
      } else if (text[at] === '{') {
        braces();
      } else if (text[at] === '<') {
        element();
      } else {
        refuse(`an attribute of <${name}> has no value`);
      }
    }
    // The children, up to the closing tag of this element.
    for (;;) {
      if (at >= text.length) refuse(`<${name}> has no closing tag`, start);
      if (text.startsWith('</', at)) {
        at += 2;
        skipSpace();
        const from = at;
        while (at < text.length && /[\w$.:-]/u.test(text[at])) at += 1;
        const closing = text.slice(from, at);
        skipSpace();
        if (closing !== name || text[at] !== '>') refuse(`</${closing}> does not close <${name}>`);
        at += 1;
        return;
      }
      if (text[at] === '<') element();
      else if (text[at] === '{') braces();
      else at += 1;
    }
  }

  code(null);
  return elements;
}
