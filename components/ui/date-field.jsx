"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

// Whole day-first text only; UTC round-trip rejects impossible days, including leap days.
function parseDateText(text) {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) return null
  const [day, month, year] = text.split(".").map(Number)
  if (year < 1) return null
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}
function dateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value.split("-").reverse().join(".") : ""
}
function calendarDate(value) {
  if (!parseDateText(dateText(value))) return undefined
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(12, 0, 0, 0)
  return date
}

// onSave(ISO date) must resolve to the exact persisted ISO date (not a success flag).
// Writes are serialized; while one runs, only the latest submitted date is queued.
// A value matching one of the last 64 submissions is an own-save acknowledgment.
// Change resetKey to replace a record even when its date matches a recent submission;
// otherwise an unmatched value replaces the draft. Older evicted echoes need parent ordering.
// words comes from the app's i18n; calendarLocale is Calendar's date-fns locale.
/**
 * @param {{ value?: string, onSave: (date: string) => string | Promise<string>,
 *   label: string, words: { choose: string, invalid: string, failed: string, saved: string },
 *   calendarLocale?: import("date-fns").Locale, resetKey?: unknown, id?: string,
 *   disabled?: boolean, className?: string }} props
 */
function DateField({ value, onSave, label, words, calendarLocale, resetKey, id, disabled = false, className }) {
  const [text, setText] = React.useState(() => dateText(value))
  const [message, setMessage] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const confirmed = React.useRef(value)
  const revision = React.useRef(0)
  const request = React.useRef(0)
  const generation = React.useRef(0)
  const running = React.useRef(null)
  const queued = React.useRef(null)
  const acknowledgments = React.useRef([])
  const observed = React.useRef({ value, resetKey })
  const mounted = React.useRef(true)
  const inputId = React.useId()
  const fieldId = id ?? inputId
  React.useEffect(() => {
    const reset = observed.current.resetKey !== resetKey
    const changed = observed.current.value !== value
    observed.current = { value, resetKey }
    if (!reset && (!changed || acknowledgments.current.some(entry => entry.date === value))) return
    confirmed.current = value
    revision.current++
    request.current++
    generation.current++
    queued.current = null
    setBusy(Boolean(running.current))
    setText(dateText(value))
    setMessage("")
  }, [value, resetKey])
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      queued.current = null
    }
  }, [])
  async function persist(job) {
    running.current = job
    acknowledgments.current = [...acknowledgments.current.filter(entry => entry.date !== job.date), { date: job.date, token: job.token }].slice(-64)
    try {
      const answer = await job.onSave(job.date)
      if (!mounted.current || job.generation !== generation.current) return
      if (answer === job.date) confirmed.current = job.date
      if (job.token !== request.current || job.edit !== revision.current) return
      setMessage(answer === job.date ? job.words.saved : job.words.failed)
    } catch {
      if (mounted.current && job.generation === generation.current && job.token === request.current && job.edit === revision.current) setMessage(job.words.failed)
    } finally {
      running.current = null
      if (mounted.current) {
        const next = queued.current
        queued.current = null
        if (next) void persist(next)
        else setBusy(false)
      }
    }
  }
  function save(next) {
    const pending = queued.current ?? running.current
    if (disabled || !next || (next === confirmed.current && !pending) || (pending?.date === next && pending.generation === generation.current)) return
    const job = { date: next, token: ++request.current, edit: revision.current, generation: generation.current, onSave, words }
    // One running write, one queued intent and a fixed-size echo ledger: none grow with typing.
    setBusy(true)
    setMessage("")
    if (running.current) queued.current = job
    else void persist(job)
  }
  function finish() {
    const next = parseDateText(text)
    if (!next) { setMessage(words.invalid); return }
    void save(next)
  }
  return (
    <div className={className} data-slot="date-field" aria-busy={busy}>
      <label htmlFor={fieldId}>{label}</label>
      <div className="flex items-center gap-2">
        <Input id={fieldId} type="text" inputMode="numeric" placeholder="DD.MM.YYYY"
          value={text} disabled={disabled} aria-invalid={message === words.invalid}
          aria-describedby={`${fieldId}-status`}
          onChange={event => { revision.current++; setText(event.target.value); setMessage("") }}
          onBlur={finish} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); finish() } }} />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button type="button" variant="outline" size="icon" disabled={disabled} aria-label={words.choose} />}>
            <CalendarIcon />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar mode="single" locale={calendarLocale} selected={calendarDate(parseDateText(text))}
              defaultMonth={calendarDate(parseDateText(text))} onSelect={date => {
                if (!date) return
                const nextText = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getFullYear()).padStart(4, "0")}`
                const next = parseDateText(nextText)
                if (!next) return
                revision.current++
                setText(nextText)
                setMessage("")
                setOpen(false)
                void save(next)
              }} />
          </PopoverContent>
        </Popover>
      </div>
      <p id={`${fieldId}-status`} role="status">{message}</p>
    </div>
  )
}

export { DateField, parseDateText }
