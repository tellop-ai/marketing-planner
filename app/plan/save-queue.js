/**
 * How My plan saves each field by itself, without React (the cards use it
 * through `./auto-save.js`; the checks drive it directly with a fake `send`
 * and fake timers). Nothing runs when this file loads.
 *
 * Each change is one field of one address. Typing waits `TYPING_WAIT`
 * milliseconds after the last key (`'typing'`); a chip or a switch goes at
 * once (`'now'`); a value that cannot be saved yet (half a link, half a
 * colour) waits for the field to be left (`'held'`, sent by `flush`). Each
 * field is its own request, so a refused field never stops the others, and
 * the requests go one after another, in the order they were made: the last
 * words typed are the last saved.
 *
 * A failed save keeps the person's words: the field waits again (unless a
 * newer change replaced it) and goes with the next save, and the card's line
 * says why (`{ problem, field, address }`). A save that starts clears the
 * line first; it says "Saved" (`{ saved: true }`) only after every request
 * of that save was confirmed (the kit's AGENTS.md rule 4a).
 */

/** How long typing rests before its words are saved (milliseconds). */
export const TYPING_WAIT = 800;

/** @param {string} address @param {string} field */
function keyOf(address, field) {
  return `${address}\n${field}`;
}

/**
 * @typedef {{ address: string, method: 'PUT' | 'PATCH', field: string, value: unknown, held: boolean }} Change
 * @typedef {{ saved: true } | { problem: string, field?: string, address: string }} Outcome
 * @typedef {(address: string, method: string, body: unknown, options?: { keepalive?: boolean }) =>
 *   Promise<{ ok: true, value: any } | { ok: false, problem: string, field?: string }>} Send
 */

export class SaveQueue {
  /** @type {Send} */ #send;
  /** @type {(outcome: Outcome | null) => void} */ #onResult;
  /** @type {(change: Change, value: any) => void} */ #onSaved;
  #wait;
  #setTimer;
  #clearTimer;
  /** @type {Map<string, Change>} */ #pending = new Map();
  /** @type {unknown} */ #timer = null;
  /** @type {Promise<void>} */ #chain = Promise.resolve();

  /**
   * @param {{ send: Send, onResult?: (outcome: Outcome | null) => void, onSaved?: (change: Change, value: any) => void,
   *   wait?: number, setTimer?: (run: () => void, wait: number) => unknown, clearTimer?: (timer: unknown) => void }} options
   */
  constructor({ send, onResult = () => {}, onSaved = () => {}, wait = TYPING_WAIT, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.#send = send;
    this.#onResult = onResult;
    this.#onSaved = onSaved;
    this.#wait = wait;
    // Called as plain functions: a browser's own timers refuse any other `this` ("Illegal invocation").
    this.#setTimer = (run, wait) => setTimer(run, wait);
    this.#clearTimer = (timer) => clearTimer(timer);
  }

  /**
   * One field changed. `'now'` saves it (with everything else waiting that is
   * not held) at once; `'typing'` after the person stops typing; `'held'`
   * only when the field is left (`flush`).
   *
   * @param {string} address
   * @param {'PUT' | 'PATCH'} method
   * @param {string} field
   * @param {unknown} value
   * @param {'now' | 'typing' | 'held'} [mode]
   * @returns {Promise<void>} settles when this change's save (if one started) ended
   */
  change(address, method, field, value, mode = 'typing') {
    this.#pending.set(keyOf(address, field), { address, method, field, value, held: mode === 'held' });
    if (mode === 'now') return this.#run(false);
    if (mode === 'typing') this.#schedule();
    return this.#chain;
  }

  /** Saves everything waiting now, held fields too (a field was left). */
  flush() {
    return this.#run(true);
  }

  /** Forgets every change of `address` that waits (the thing it changes is gone). @param {string} address */
  drop(address) {
    for (const [key, change] of this.#pending) if (change.address === address) this.#pending.delete(key);
  }

  /**
   * The page is going: every change that waits and is not held goes now with
   * `keepalive` (the browser finishes it after the page left), with no line
   * to show. A held field is never sent this way: it was not ready.
   */
  leave() {
    this.#clearTimer(this.#timer);
    this.#timer = null;
    for (const [key, change] of this.#pending) {
      if (change.held) continue;
      this.#pending.delete(key);
      void this.#send(change.address, change.method, { [change.field]: change.value }, { keepalive: true }).catch(() => undefined);
    }
  }

  /** The changes that wait, oldest first (for the checks). */
  get waiting() {
    return [...this.#pending.values()].map((change) => ({ ...change }));
  }

  /** Settles when every save started so far ended. */
  settled() {
    return this.#chain;
  }

  #schedule() {
    this.#clearTimer(this.#timer);
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      void this.#run(false);
    }, this.#wait);
  }

  /** @param {boolean} withHeld */
  #run(withHeld) {
    const taken = [...this.#pending.entries()].filter(([, change]) => withHeld || !change.held);
    if (taken.length === 0) return this.#chain;
    for (const [key] of taken) this.#pending.delete(key);
    // Nothing that waits for the timer is left: every change not held was taken.
    this.#clearTimer(this.#timer);
    this.#timer = null;
    const changes = taken.map(([, change]) => change);
    this.#chain = this.#chain.then(() => this.#save(changes));
    return this.#chain;
  }

  /** @param {Change[]} changes */
  async #save(changes) {
    this.#onResult(null);
    /** @type {Outcome} */
    let outcome = { saved: true };
    for (const change of changes) {
      let sent;
      try {
        sent = await this.#send(change.address, change.method, { [change.field]: change.value });
      } catch {
        sent = { ok: false, problem: 'error.saveFailed' };
      }
      if (sent.ok) {
        this.#onSaved(change, sent.value);
        continue;
      }
      const key = keyOf(change.address, change.field);
      // Kept for the next save, unless the person changed the field again meanwhile.
      if (!this.#pending.has(key)) this.#pending.set(key, { ...change, held: false });
      outcome = { problem: sent.problem, field: sent.field ?? change.field, address: change.address };
    }
    this.#onResult(outcome);
  }
}
