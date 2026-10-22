/**
 * Recording a voice clip in the page: a person's own sound to keep, such as a voice note (AGENTS.md rule 6c), or
 * one for `transcribe` in `lib/ai.js` to write down (AGENTS.md rule 3a).
 *
 * A recording is the person's file, kept whole like a photo: the page sends it
 * with `sendFile` (`lib/send-file.js`), the server keeps it with `keepFile`, and
 * a record names it by its digest in a field ending `File`. To write it down,
 * the server calls `transcribe({ file })` with that digest when a press asks.
 * Record only between the person's own start and stop presses.
 *
 * Tellop measures a recording's length on the Mac before AI writes it down, and
 * it reads only AAC in MP4, at most 1.5 MiB. A browser left to choose often
 * records WebM, which Tellop cannot read, so always record in the type
 * `recordingType()` picks, pass `RECORDING_BITS_PER_SECOND` as
 * `audioBitsPerSecond` (Chromium's AAC encoder on a Mac fails to start below
 * 48 kbit/s), and stop by four minutes, which keeps a recording under 1.5 MiB:
 *
 *     const type = recordingType();
 *     // No type: this browser cannot make a recording Tellop reads. Rest the
 *     // record button and say so beside it, in words from the locale files.
 *     const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
 *     // Stop it on the person's stop press, or after four minutes at the latest.
 *     // ...then send new Blob(parts, { type }) with sendFile (lib/send-file.js)
 *     // and keep its digest with the record (rule 6c).
 *
 * Nothing here imports anything, so the browser and a check can both load it
 * (`lib/ai.js` reads the server's files, so the page cannot import it).
 */

/** AAC in MP4, the type Tellop's own window records, then a bare MP4 (Safari's AAC). Never WebM or Ogg. */
export const RECORDING_TYPES = Object.freeze(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']);

/** The rate to record at: Chromium's AAC encoder on a Mac fails to start below 48 kbit/s. */
export const RECORDING_BITS_PER_SECOND = 48000;

/** A browser that can record Opus in MP4 may answer a bare MP4 with Opus, which Tellop cannot read either. */
const OPUS_IN_MP4 = 'audio/mp4;codecs=opus';

function supports(recorder, type) {
  try {
    return recorder.isTypeSupported(type) === true;
  } catch {
    return false;
  }
}

/**
 * The type to record in, or `undefined` when this browser records nothing Tellop
 * can read (then rest the record button and say so beside it).
 */
export function recordingType(recorder = globalThis.MediaRecorder) {
  if (typeof recorder?.isTypeSupported !== 'function') return undefined;
  if (supports(recorder, RECORDING_TYPES[0])) return RECORDING_TYPES[0];
  if (supports(recorder, RECORDING_TYPES[1]) && !supports(recorder, OPUS_IN_MP4)) return RECORDING_TYPES[1];
  return undefined;
}
