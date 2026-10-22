/**
 * The post maker's addresses: a post's, and a network's version of it. The
 * pages send to them through the one shared helper (`app/send.js`).
 */

/** A post's address, with the parts after it. @param {number} id @param {string} [rest] */
export function postAddress(id, rest = '') {
  return `/api/posts/${encodeURIComponent(String(id))}${rest}`;
}

/** A network's version address of a post. @param {number} id @param {string} network */
export function versionAddress(id, network) {
  return postAddress(id, `/versions/${encodeURIComponent(network)}`);
}
