/**
 * Whose plan this is. The app has one person on one computer and no sign-in,
 * so the owner is one fixed name chosen here on the server. A request never
 * chooses an owner: every read, save and delete names this one.
 */
export const OWNER = 'local-owner';
