import { IMPORT_LIMITS as L, bounded, refuse } from './limits.js';
function entities(text) {
  return text.replace(/&([^;]*);|&/g, (whole, name) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name && Object.hasOwn(known, name)) return known[name];
    if (!name || !/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) refuse('import.xml');
    const n = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (!Number.isSafeInteger(n) || n < 1 || n > 0x10ffff || n === 0xfffe || n === 0xffff || (n >= 0xd800 && n <= 0xdfff) || (n < 32 && ![9, 10, 13].includes(n))) refuse('import.xml');
    return String.fromCodePoint(n);
  });
}
/** Strict bounded XML subset: no DTD, declarations, entity expansion or fetching. */
export function xml(text) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text)) refuse('import.xml');
  text = text.replace(/^\uFEFF/, '').replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?(?:\s+standalone=["'](?:yes|no)["'])?\s*\?>/i, '');
  const root = { name: '', attrs: {}, children: [], text: '' }, stack = [root];
  let pos = 0, nodes = 0;
  while (pos < text.length) {
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4); if (end < 0 || text.slice(pos + 4, end).includes('--')) refuse('import.xml');
      pos = end + 3; continue;
    }
    if (text[pos] !== '<') {
      const end = text.indexOf('<', pos), stop = end < 0 ? text.length : end;
      const value = text.slice(pos, stop); if (value.includes(']]>')) refuse('import.xml');
      const current = stack.at(-1); current.text += entities(value); bounded(current.text.length, L.stringLength);
      pos = stop; continue;
    }
    const match = /^<(\/)?([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)([^<>]*?)(\/?)>/.exec(text.slice(pos));
    if (!match) refuse('import.xml');
    const [, closing, name, raw, self] = match; pos += match[0].length;
    if (closing) { if (raw.trim() || self || stack.length < 2 || stack.at(-1).name !== name) refuse('import.xml'); stack.pop(); continue; }
    const attrs = Object.create(null); let rest = raw;
    while (rest.trim()) {
      const attribute = /^\s+([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(["'])([^<>]*?)\2/.exec(rest);
      if (!attribute || Object.hasOwn(attrs, attribute[1])) refuse('import.xml');
      attrs[attribute[1]] = entities(attribute[3]); bounded(attrs[attribute[1]].length, L.stringLength);
      rest = rest.slice(attribute[0].length);
    }
    bounded(++nodes, L.xmlNodes); bounded(stack.length, L.xmlDepth);
    const node = { name, attrs, children: [], text: '' }; stack.at(-1).children.push(node);
    if (!self) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.text.trim()) refuse('import.xml');
  return root.children[0];
}
export function local(node) { return node.name.split(':').at(-1); }
export function children(node, name) { return node.children.filter((n) => local(n) === name); }
export function one(node, name) { const found = children(node, name); if (found.length !== 1) refuse('import.xml'); return found[0]; }
export function stringText(node) {
  let result = '';
  for (const child of node.children) {
    if (local(child) === 't') result += child.text;
    else if (local(child) === 'r') for (const text of children(child, 't')) result += text.text;
    bounded(result.length, L.stringLength);
  }
  return result;
}
