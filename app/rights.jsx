'use client';

import { createContext, useContext } from 'react';

/**
 * What the person on this page may press (`lib/plan/roles.js`), handed down
 * from the server page through `Shell`. A part drawn outside a page's
 * `Shell` gets nothing that saves.
 */
const Rights = createContext(Object.freeze({ add: false, change: false, preview: false, unknown: false }));

/** @param {{ rights: { add: boolean, change: boolean, preview: boolean, unknown: boolean }, children: React.ReactNode }} props */
export function RightsProvider({ rights, children }) {
  return <Rights.Provider value={rights}>{children}</Rights.Provider>;
}

/** @returns {{ add: boolean, change: boolean, preview: boolean, unknown: boolean }} */
export function useRights() {
  return useContext(Rights);
}
