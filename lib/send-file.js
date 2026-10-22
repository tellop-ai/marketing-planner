/**
 * A person's own files and pictures, sent from the browser: the half of
 * `AGENTS.md` rule 6c that runs in the page when a form is saved. The pieces of
 * the kit (`components/ui/picture-field.jsx`, `file-upload.jsx`) never reach the
 * network; the form calls these, and `app/api/files/route.js` keeps what they
 * send (`lib/data/files.js`).
 *
 * ## `sendFile(file)`
 *
 * Keeps one file, exactly as it is and of any size, as its own request to
 * `FILE_ADDRESS`, and answers `{ file, size, kind, shows }`, where `file` is
 * the digest a record keeps. The browser sends it from the disk, so it is never
 * read whole here and never put inside a form. Inside Tellop's window it goes
 * as a stream, which Tellop reads piece by piece; anywhere else it goes as the
 * file itself, because a browser refuses a streamed send to an ordinary web
 * address. A refusal throws a `FileProblem` whose `messageKey` the form shows.
 *
 * ## `appendPicture(form, name, value, options)`: the original, unless asked
 *
 * Keeps a picture field's chosen picture and puts its digest into the form
 * under `name`; `PICTURE_REMOVED` only for `{ removed: true }`; nothing at all
 * for `null` or a saved one, which the server then keeps. By default the
 * picture is the photo the person picked, byte for byte: never drawn again,
 * never made smaller, with everything a phone wrote into it, where it was taken
 * included. Use an option only when the app's person asked for it:
 *
 *  - `smaller: true` keeps a smaller copy in place of the original, at most
 *    `PICTURE_LONGEST_SIDE` pixels on its longest side;
 *  - `withoutLocation: true` keeps a copy drawn again at the same size, which
 *    leaves behind where it was taken and the other hidden details;
 *  - `displayCopy: 'photoSmall'` keeps the original under `name` and a smaller
 *    copy beside it under that second name, for a list that shows many.
 *
 * A copy is written as WebP, or as JPEG (on white, as JPEG has no see-through
 * parts) where the browser cannot write WebP. A picture this browser cannot
 * draw for a copy throws a `PictureProblem`.
 */

import { PICTURE_LONGEST_SIDE, PICTURE_REMOVED } from "./pictures.js"

/** The kit's own address that keeps a file (`app/api/files/route.js`). */
const FILE_ADDRESS = "/api/files"

/** A file that could not be kept; `messageKey` says why, in `lib/i18n/locales`. */
class FileProblem extends Error {
  constructor(messageKey) {
    super(messageKey)
    this.name = "FileProblem"
    this.messageKey = messageKey
  }
}

/** Tellop's window, where a file sent whole would be read into memory before the app sees a piece of it. */
function inTellopWindow() {
  return typeof location !== "undefined" && location.protocol === "tellop-run:"
}

/** Keeps one file; this file's opening comment says how. */
async function sendFile(file, { address = FILE_ADDRESS, signal } = {}) {
  const sent =
    inTellopWindow() && typeof file?.stream === "function"
      ? { body: file.stream(), duplex: "half" }
      : { body: file }
  let response
  try {
    response = await fetch(address, { method: "POST", ...sent, signal })
  } catch {
    throw new FileProblem("error.fileNotKept")
  }
  let answer = null
  try {
    answer = await response.json()
  } catch {
    // An answer that is not the app's own is a refusal like any other.
  }
  if (!response.ok || typeof answer?.file !== "string") {
    throw new FileProblem(typeof answer?.problem === "string" ? answer.problem : "error.fileNotKept")
  }
  return answer
}

/** A picture that could not be made ready to send; `messageKey` says why. */
class PictureProblem extends Error {
  constructor(messageKey) {
    super(messageKey)
    this.name = "PictureProblem"
    this.messageKey = messageKey
  }
}

/**
 * Opens the chosen file as something a canvas can draw, in its upright turn.
 * A browser that does not know the `imageOrientation` choice refuses it, so
 * each way is tried in turn, and only when all of them fail is the picture
 * one this browser cannot open.
 */
async function openPicture(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" })
    } catch {
      // Tried again below without the choice: current browsers turn it upright anyway.
    }
    try {
      return await createImageBitmap(file)
    } catch {
      // Tried once more below as a plain picture.
    }
  }
  const address = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = address
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(address)
  }
}

function written(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** The drawn picture again on white, for JPEG, which would turn see-through parts black. */
function onWhite(canvas) {
  const flat = document.createElement("canvas")
  flat.width = canvas.width
  flat.height = canvas.height
  const context = flat.getContext("2d")
  if (context === null) throw new PictureProblem("error.pictureUnreadable")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, flat.width, flat.height)
  context.drawImage(canvas, 0, 0)
  return flat
}

/**
 * The chosen picture drawn again: at most `longestSide` pixels on its longest
 * side (`PICTURE_LONGEST_SIDE` unless told otherwise; `Infinity` keeps its
 * size), never larger than it was, as WebP, or as JPEG where this browser
 * writes something else when asked for WebP. Only ever on the app's request.
 */
async function shrinkPicture(file, longestSide = PICTURE_LONGEST_SIDE) {
  let drawable
  try {
    drawable = await openPicture(file)
  } catch {
    throw new PictureProblem("error.pictureUnreadable")
  }
  const width = drawable.width
  const height = drawable.height
  if (!(width > 0 && height > 0)) throw new PictureProblem("error.pictureUnreadable")
  const scale = Math.min(1, longestSide / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext("2d")
  if (context === null) throw new PictureProblem("error.pictureUnreadable")
  context.drawImage(drawable, 0, 0, canvas.width, canvas.height)
  drawable.close?.()

  let blob = await written(canvas, "image/webp", 0.8)
  if (blob === null || blob.type !== "image/webp") {
    blob = await written(onWhite(canvas), "image/jpeg", 0.8)
  }
  if (blob === null || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) {
    throw new PictureProblem("error.pictureUnreadable")
  }
  const name = blob.type === "image/webp" ? "picture.webp" : "picture.jpg"
  return new File([blob], name, { type: blob.type })
}

/** Keeps a picture field's value into `form`; this file's opening comment says how. Await it before sending. */
async function appendPicture(form, name, value, options = {}) {
  const { smaller = false, withoutLocation = false, displayCopy, address } = options
  const copy = typeof displayCopy === "string" && displayCopy !== "" ? displayCopy : null
  if (value?.file) {
    const kept = smaller
      ? await shrinkPicture(value.file)
      : withoutLocation
        ? await shrinkPicture(value.file, Number.POSITIVE_INFINITY)
        : value.file
    form.set(name, (await sendFile(kept, { address })).file)
    if (copy !== null) form.set(copy, (await sendFile(await shrinkPicture(value.file), { address })).file)
  } else if (value?.removed === true) {
    form.set(name, PICTURE_REMOVED)
    if (copy !== null) form.set(copy, PICTURE_REMOVED)
  }
}

export { FILE_ADDRESS, FileProblem, PictureProblem, appendPicture, sendFile, shrinkPicture }
