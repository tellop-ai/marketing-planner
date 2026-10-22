"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { t, MESSAGES } from "@/lib/i18n"

// reviewKey identifies an immutable, server-held review for the current actor.
// onSave(reviewKey) resolves to { savedCount, receipt } from confirmed saveRows.
// receipt is an opaque server-held undo grant, never client-provided saved IDs.
// onUndo(receipt) resolves to { removedCount } from confirmed undoRows.
// Replace reviewKey whenever the file, mappings or reviewed rows change.
/** checked/headings are the bounded server review outputs, never a generated client.
 * reviewKey and receipt are bounded opaque grants authorized by the server.
 */
function ImportCheck({ reviewKey, checked, headings = { unread: [], missing: [] },
  locale, fieldLabels = {}, onSave, onUndo, errorKey, className }) {
  const [result, setResult] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [uncertain, setUncertain] = React.useState(false)
  const active = React.useRef(null)
  const current = React.useRef(reviewKey)
  const mounted = React.useRef(true)
  current.current = reviewKey
  React.useEffect(() => {
    setResult(null)
    setUncertain(false)
  }, [reviewKey])
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const own = result?.reviewKey === reviewKey ? result : null
  const words = (key, values) => t(key, locale, values)
  const safeReason = key => Object.hasOwn(MESSAGES.en, key ?? "") ? words(key) : words("import.problemRows")
  const rows = checked?.rows ?? []
  // Counts come from the reviewed rows, never a predicted database save count.
  const fresh = rows.filter(row => row.status === "new")
  const existing = rows.filter(row => row.status === "already-there")
  const problems = rows.filter(row => row.status === "problem")
  async function act(kind) {
    if (active.current || uncertain || (kind === "save" && own)) return
    const job = { reviewKey, kind }
    active.current = job
    setBusy(true)
    try {
      const answer = kind === "save" ? await onSave(reviewKey) : await onUndo(own.receipt)
      if (!mounted.current || current.current !== job.reviewKey) return
      if (kind === "save") {
        if (!answer || answer.savedCount !== fresh.length || !Number.isSafeInteger(answer.savedCount) ||
          typeof answer.receipt !== "string" || !answer.receipt || answer.receipt.length > 128) throw new Error()
        setResult({ reviewKey, savedCount: answer.savedCount, receipt: answer.receipt })
      } else {
        if (!answer || !Number.isSafeInteger(answer.removedCount) || answer.removedCount < 0 || answer.removedCount > own.savedCount) throw new Error()
        setResult({ reviewKey, savedCount: own.savedCount, removedCount: answer.removedCount })
      }
    } catch {
      if (mounted.current && current.current === job.reviewKey) setUncertain(true)
    } finally {
      active.current = null
      if (mounted.current) setBusy(false)
    }
  }
  const renderRows = items => <ol className="space-y-2">{items.map(entry => <li key={entry.index} className="rounded-md border p-3">
    <p>{words("import.row", { count: String(entry.index + 2) })}{entry.reason ? `: ${safeReason(entry.reason)}` : ""}</p>
    <dl className="grid grid-cols-2 gap-x-4">{Object.entries(entry.row ?? {}).map(([key, value]) => <React.Fragment key={key}>
      <dt className="font-medium">{fieldLabels[key] ?? key}</dt><dd className="break-words">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</dd>
    </React.Fragment>)}</dl>
  </li>)}</ol>
  return <section className={className} data-slot="import-check" aria-busy={busy}>
    <p className="mb-4 whitespace-nowrap font-medium">{words("import.counts", { fresh: String(fresh.length), existing: String(existing.length), problems: String(problems.length) })}</p>
    {headings.unread.length > 0 && <div className="mb-4"><h3>{words("import.unreadHeadings")}</h3><ul>{headings.unread.map(entry => <li key={entry.index}>{entry.heading}: {safeReason(entry.reason)}</li>)}</ul></div>}
    {headings.missing.length > 0 && <p className="mb-4">{words("import.missingFields", { fields: headings.missing.map(key => fieldLabels[key] ?? key).join(", ") })}</p>}
    {errorKey && <p role="alert">{safeReason(errorKey)}</p>}
    <div className="max-h-96 overflow-y-auto space-y-4">
      {renderRows([...fresh, ...problems].sort((a, b) => a.index - b.index))}
      {existing.length > 0 && <details><summary>{words("import.existingRows", { count: String(existing.length) })}</summary>{renderRows(existing)}</details>}
    </div>
    <p role="status" className="my-4">{uncertain ? words("import.saveUnconfirmed") : own?.removedCount !== undefined ? words("import.removed", { count: String(own.removedCount) }) : own ? words("import.saved", { count: String(own.savedCount) }) : busy ? words("import.working") : ""}</p>
    <div className="flex gap-2">
      <Button type="button" disabled={busy || uncertain || Boolean(own) || !fresh.length || problems.length > 0 || headings.missing.length > 0 || Boolean(errorKey) || typeof reviewKey !== "string" || !reviewKey || reviewKey.length > 128 || typeof onSave !== "function"} onClick={() => void act("save")}>{words("import.save")}</Button>
      {own?.receipt && <Button type="button" variant="outline" disabled={busy || uncertain || typeof onUndo !== "function"} onClick={() => void act("undo")}>{words("import.undo")}</Button>}
    </div>
  </section>
}
export { ImportCheck }
