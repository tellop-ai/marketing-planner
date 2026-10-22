"use client"

/**
 * One picture a person keeps with a record: the picture that is there now, a
 * way to choose another, and a way to take it away.
 *
 * Tellop wrote this one, like `file-upload.jsx` beside it, and it is recorded
 * in `components/PROVENANCE.json` under the `tellop` source with no licence
 * text, because a generated app belongs to the person who made it. Where the
 * picture is kept, and why there, is `AGENTS.md` rule 6c; it is sent by
 * `lib/send-file.js`, and the server's half is `readPicture()` and
 * `fileResponse()` in `lib/data/files.js`.
 *
 * ## The form holds the picture, never this piece
 *
 * `value` and `onChange` are the whole of its state, and `value` is one of:
 *
 *  - `null`: nothing chosen here. Saving sends nothing, so a new record gets
 *    no picture and a record being edited keeps the picture it has, even one
 *    this form never loaded;
 *  - `{ saved: address }`: the picture already kept with the record, shown
 *    from the app's own address (`pictureAddress()` in `lib/pictures.js`);
 *  - `{ file }`: a picture chosen just now, shown the moment it is chosen;
 *  - `{ removed: true }`: the person pressed Remove. This is the only value
 *    that takes a kept picture away when the form is saved.
 *
 * "No picture here" never means "delete the picture": only a press on Remove
 * does, so a form that forgot to load the saved picture loses nothing.
 *
 * There is no file hidden inside: what this shows is exactly what the form
 * holds, so the form's own reset (closing, cancelling, saving) is the reset of
 * this field too, and a picture can never travel unseen onto the next record.
 * A form that forgot its reset would show the old picture, not send it
 * silently.
 *
 * ## Kept as picked, by the form
 *
 * This piece never sends anything: a piece of the kit never reaches the
 * network. When the form is saved, `await appendPicture(form, name, value)`
 * from `lib/send-file.js` keeps the picture the person picked, byte for byte,
 * and puts its digest into the form (`AGENTS.md` rule 6c).
 *
 * ## The one raw control, named
 *
 * `<input type="file">` is written here by hand for the same reason as in
 * `file-upload.jsx`: only that element opens the operating system's own file
 * chooser. It is hidden from sight and from the tab order, and the kit
 * buttons are what a person presses.
 *
 * ## The words
 *
 * Every word comes from `lib/i18n/locales/` in the app's language (`locale`,
 * or the app's own when none is passed), so this needs no words handed in.
 */

import * as React from "react"
import { ImageIcon, UploadIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { getLocale, t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

function PictureField({
  value = null,
  onChange,
  locale = getLocale(),
  alt,
  disabled = false,
  className,
}) {
  const chooser = React.useRef(null)
  const chosen = value?.file ?? null
  const [shown, setShown] = React.useState(null)
  /*
   * The words under the picture, with the value they were said about: a
   * different value (the form moved on) hides them, so an old refusal is never
   * left standing under a new picture or an empty field.
   */
  const [problem, setProblem] = React.useState(null)
  /** What the field held just before a choice, so a choice that cannot be shown goes back to it. */
  const before = React.useRef(null)

  /*
   * A chosen picture is shown from an address this browser makes for it, which
   * is given back whenever the picture changes or the field goes away.
   */
  React.useEffect(() => {
    if (chosen === null) {
      setShown(null)
      return undefined
    }
    const address = URL.createObjectURL(chosen)
    setShown(address)
    return () => URL.revokeObjectURL(address)
  }, [chosen])

  const source = chosen !== null ? shown : (value?.saved ?? null)
  const holding = chosen !== null || Boolean(value?.saved)

  const choose = (files) => {
    const file = files?.[0]
    if (!file) return
    before.current = value
    setProblem(null)
    onChange?.({ file })
  }

  const remove = () => {
    setProblem(null)
    onChange?.({ removed: true })
  }

  /* The browser could not draw what was chosen: go back to what was there, and say so. */
  const unreadable = () => {
    if (chosen === null) return
    const back = before.current ?? null
    setProblem({ key: "error.pictureUnreadable", value: back })
    onChange?.(back)
  }

  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      {holding ? (
        <div className="relative aspect-4/3 w-full max-w-64 overflow-hidden rounded-lg border border-border bg-muted">
          {source ? (
            <img
              src={source}
              alt={alt ?? t("picture.shown", locale)}
              onError={unreadable}
              className="size-full object-cover"
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => chooser.current?.click()}
        >
          {holding ? (
            <UploadIcon aria-hidden="true" />
          ) : (
            <ImageIcon aria-hidden="true" />
          )}
          {holding ? t("picture.change", locale) : t("picture.choose", locale)}
        </Button>
        {holding ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={remove}
          >
            <XIcon aria-hidden="true" />
            {t("picture.remove", locale)}
          </Button>
        ) : null}
        {/*
          The one raw control, explained in this file's opening comment. Any
          picture is offered, because the browser can often open more kinds
          than it names, and the server keeps the one picked as it is.
        */}
        <input
          ref={chooser}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onChange={(event) => {
            choose(event.target.files)
            // Cleared so that choosing the same picture again is still a change.
            event.target.value = ""
          }}
        />
      </div>

      <div role="status" className="flex flex-col gap-1 empty:hidden">
        {problem !== null && problem.value === value ? (
          <p className="text-sm text-destructive">{t(problem.key, locale)}</p>
        ) : null}
      </div>
    </div>
  )
}

export { PictureField }
