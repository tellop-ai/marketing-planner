// The language loader replaces this text with language.json's raw bytes.
// Keep the empty fallback: malformed or missing files must not break compilation.
// Online (workerd) this text runs only when a build skipped the loader: it throws, never English silently.
export function readLanguage() {
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
    throw new Error('language.json is read at build time online: build with the kit loader (next.config.mjs)');
  }
  return '';
}
