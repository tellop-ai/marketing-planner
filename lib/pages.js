// Every independently opened page belongs here. wordsKey names its real locale
// message; the side menu translates it at render time. Keep routes and keys current.
// The post maker (`/posts/[id]`) opens from these pages and is not in the menu.
export const PAGES = Object.freeze([
  Object.freeze({ href: '/', wordsKey: 'menu.calendar', icon: 'calendar' }),
  Object.freeze({ href: '/week', wordsKey: 'menu.week', icon: 'week' }),
  Object.freeze({ href: '/ideas', wordsKey: 'menu.ideas', icon: 'ideas' }),
  Object.freeze({ href: '/ready-words', wordsKey: 'menu.readyWords', icon: 'words' }),
  Object.freeze({ href: '/customers', wordsKey: 'menu.customers', icon: 'customers' }),
  Object.freeze({ href: '/contacts', wordsKey: 'menu.contacts', icon: 'contacts' }),
  Object.freeze({ href: '/results', wordsKey: 'menu.results', icon: 'results' }),
  Object.freeze({ href: '/plan', wordsKey: 'menu.plan', icon: 'plan' }),
]);
