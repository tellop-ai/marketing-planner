/**
 * A person's own files and pictures, sent from the browser: the half of
 * `AGENTS.md` rule 6c that runs in the page when a form is saved. The pieces of
 * the kit (`components/ui/picture-field.jsx`, `file-upload.jsx`) never reach the
 * network; the form calls these, and `app/api/files/route.js` keeps what they
 * send (`lib/data/files.js`).
 *
 * ## `sendFile(file)`
 *
 * Keeps one file, exactly as it is and of any size, and answers
 * `{ file, size, kind, shows }`, where `file` is the digest a record keeps. It
 * goes to `FILE_ADDRESS` in pieces, each its own request (online a request
 * carries at most 100 MB, and an app online reads each request whole): the
 * first piece's answer names the upload and the size of every later piece
 * (`{ upload, size, pieceBytes }`), each later piece names the upload again,
 * and the last answers the file. Inside Tellop's window the first piece is
 * `FILE_PIECE_BYTES`; anywhere else it is `FILE_FIRST_PIECE_BYTES`, small
 * enough for an app online, so a file larger than that never goes whole
 * there. The browser sends each piece from the disk, so the file is never read
 * whole here and never put inside a form. Inside Tellop's window a piece goes
 * as a stream, which Tellop reads piece by piece; anywhere else it goes as the
 * piece itself, because a browser refuses a streamed send to an ordinary web
 * address. A piece lost on the way (no answer, an answer that is not the app's
 * own, or `error.fileExpired`) sends the whole file once more from its first
 * piece, which names the upload it gives up (`&previous=`) so the app ends
 * that one first; the same bytes are kept once. A refusal throws a
 * `FileProblem` whose `messageKey` the form shows.
 *
 * ## `appendPicture(form, name, value, options)`: the original, unless asked
 *
 * Keeps a picture field's chosen picture and puts its digest into the form
 * under `name`; `PICTURE_REMOVED` only for `{ removed: true }`; nothing at all
 * for `null` or a saved one, which the server then keeps. By default the
 * picture is the photo the person picked, byte for byte: never drawn again,
 * never made smaller, with everything a phone wrote into it, where it was taken
 * included. Use these two only when the app's person asked for them:
 *
 *  - `smaller: true` keeps a smaller copy in place of the original, at most
 *    `PICTURE_LONGEST_SIDE` pixels on its longest side;
 *  - `withoutLocation: true` keeps a copy drawn again at the same size, which
 *    leaves behind where it was taken and the other hidden details.
 *
 * A gallery, or any list that shows many, keeps the original and shows a
 * second copy (`AGENTS.md` rule 6c), with no need for the person to ask:
 *
 *  - `displayCopy: 'photoSmall'` keeps the original under `name` and a copy at
 *    most `PICTURE_LONGEST_SIDE` (1280) pixels on its longest side beside it,
 *    under that second name. Never `smaller` for this: it replaces the original.
 *
 * A copy is written as WebP, or as JPEG (on white, as JPEG has no see-through
 * parts) where the browser cannot write WebP. A picture this browser cannot
 * draw for a copy throws a `PictureProblem`.
 */

import { PICTURE_LONGEST_SIDE, PICTURE_REMOVED } from "./pictures.js"

/** The kit's own address that keeps a file (`app/api/files/route.js`). */
const FILE_ADDRESS = "/api/files"

/** The most one request carries of a file: 50 MiB, half of what a request online may carry. */
const FILE_PIECE_BYTES = 50 * 1024 * 1024

/**
 * The first piece outside Tellop's window: 10 MiB. An app online reads each request whole before the app's own code
 * sees it, so a piece there stays this small; its first answer names the size of the rest (`pieceBytes`).
 */
const FILE_FIRST_PIECE_BYTES = 10 * 1024 * 1024

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

/** A piece that never reached the app, or whose upload the app no longer holds: the file goes again. */
class LostPiece extends Error {
  constructor(messageKey) {
    super(messageKey)
    this.messageKey = messageKey
  }
}

/** A host online writes every piece but the last as whole parts of 5 MiB, so a later piece is a whole number of them. */
const FILE_PART_BYTES = 5 * 1024 * 1024

/**
 * The size of every piece after the first, as the first piece's answer named it: a whole number of
 * `FILE_PART_BYTES`, at most `FILE_PIECE_BYTES`; any other is not taken.
 */
function laterPieces(answer) {
  const named = answer?.pieceBytes
  return Number.isSafeInteger(named) && named >= FILE_PART_BYTES && named <= FILE_PIECE_BYTES && named % FILE_PART_BYTES === 0
    ? named
    : FILE_PIECE_BYTES
}

/**
 * Sends `file[from, to)` under the upload `sending.upload` (`null` for the first piece, which names
 * `sending.previous`, the upload a send before this one gave up, when there is one); answers the app's answer.
 */
async function sendPiece(file, from, to, sending, address, signal) {
  // A file of one piece goes as itself, its name and type with it.
  const piece = from === 0 && to === file.size ? file : file.slice(from, to)
  const query = new URLSearchParams({ size: String(file.size), from: String(from), to: String(to) })
  if (sending.upload !== null) query.set("upload", sending.upload)
  else if (sending.previous !== null) query.set("previous", sending.previous)
  const sent =
    inTellopWindow() && typeof piece.stream === "function"
      ? { body: piece.stream(), duplex: "half" }
      : { body: piece }
  let response
  try {
    response = await fetch(`${address}${address.includes("?") ? "&" : "?"}${query}`, { method: "POST", ...sent, signal })
  } catch {
    if (signal?.aborted) throw new FileProblem("error.fileNotKept")
    throw new LostPiece("error.fileNotKept")
  }
  let answer = null
  try {
    answer = await response.json()
  } catch {
    // An answer that is not the app's own (a proxy's, or none at all) is a lost piece.
  }
  if (typeof answer?.problem === "string") {
    if (answer.problem === "error.fileExpired") throw new LostPiece(answer.problem)
    throw new FileProblem(answer.problem)
  }
  if (!response.ok || answer === null || typeof answer !== "object") throw new LostPiece("error.fileNotKept")
  return answer
}

/** One whole send, piece after piece from the first; `sending.upload` is the upload under way, for a send after it. */
async function sendPieces(file, address, signal, sending) {
  let pieceBytes = inTellopWindow() ? FILE_PIECE_BYTES : FILE_FIRST_PIECE_BYTES
  for (let from = 0; ; ) {
    const to = Math.min(file.size, from + pieceBytes)
    const answer = await sendPiece(file, from, to, sending, address, signal)
    if (to === file.size) {
      if (typeof answer.file !== "string") throw new FileProblem("error.fileNotKept")
      return answer
    }
    if (typeof answer.upload !== "string" || answer.size !== to || (sending.upload !== null && answer.upload !== sending.upload)) {
      throw new FileProblem("error.fileNotKept")
    }
    if (sending.upload === null) pieceBytes = laterPieces(answer)
    sending.upload = answer.upload
    from = to
  }
}

/** Keeps one file; this file's opening comment says how. */
async function sendFile(file, { address = FILE_ADDRESS, signal } = {}) {
  if (typeof file?.slice !== "function" || !Number.isSafeInteger(file?.size) || file.size < 0) {
    throw new FileProblem("error.fileNotKept")
  }
  let previous = null
  for (let attempt = 1; ; attempt += 1) {
    const sending = { upload: null, previous }
    try {
      return await sendPieces(file, address, signal, sending)
    } catch (error) {
      if (error instanceof LostPiece && attempt < 2 && !signal?.aborted) {
        previous = sending.upload
        continue
      }
      throw error instanceof FileProblem ? error : new FileProblem(error?.messageKey ?? "error.fileNotKept")
    }
  }
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

export { FILE_ADDRESS, FILE_FIRST_PIECE_BYTES, FILE_PIECE_BYTES, FileProblem, PictureProblem, appendPicture, sendFile, shrinkPicture }
