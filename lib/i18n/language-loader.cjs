const { readFileSync } = require('node:fs');
const path = require('node:path');

// JSON remains text until getLocale parses it, including when it is broken.
module.exports = function languageLoader() {
  const file = path.join(path.dirname(this.resourcePath), 'language.json');
  let text = '';
  this.addDependency(file);
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // Watching the absent path lets creating it update the browser as well.
    this.addMissingDependency(file);
  }
  return `export function readLanguage() { return ${JSON.stringify(text)}; }`;
};
