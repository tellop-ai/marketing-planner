"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { format } from "date-fns"
import { enUS, tr } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getLocale, t } from "@/lib/i18n"
import { formatMonth } from "@/lib/format"

// Dates are local civil days, never UTC instants. Strings must be real YYYY-MM-DD
// dates (years 0001..9999); Date inputs use local fields and are never mutated.
function civilDate(value) {
  let year, month, day
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    year = value.getFullYear(); month = value.getMonth() + 1; day = value.getDate()
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    [year, month, day] = value.split("-").map(Number)
  } else throw new RangeError("Expected a local Date or YYYY-MM-DD")
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  if (year < 1 || year > 9999 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new RangeError("Invalid civil date")
  return date
}
function dayKey(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
/**
 * Uncontrolled month view: initialMonth is read on mount; remount to reset it.
 * Entries: {id, date, name, kind, status}; name/kind/status are app-localized text.
 * today may be fixed for a report. Omitted dates resolve locally after hydration.
 * Without initialMonth, SSR shows a stable empty shell until the client mounts.
 * locale comes from lib/i18n by default; calendarLocale may supply its date-fns locale.
 * onMonthChange receives the first civil day as YYYY-MM-DD after a navigation press.
 * Invalid dates throw rather than silently moving an entry to another day.
 */
function MonthPlanner({ entries = [], initialMonth, today, locale = getLocale(), calendarLocale, onMonthChange, className }) {
  const [localToday, setLocalToday] = React.useState(null)
  const [month, setMonth] = React.useState(() => { if (initialMonth == null) return null; const date = civilDate(initialMonth); date.setDate(1); return date })
  React.useEffect(() => {
    const date = civilDate(new Date())
    setLocalToday(date)
    if (initialMonth == null) setMonth(current => { if (current) return current; const first = new Date(date.getTime()); first.setDate(1); return first })
  }, [])
  const dateLocale = calendarLocale ?? (locale === "tr" ? tr : enUS)
  const mondayFirst = locale === "tr"
  const todayKey = today == null ? (localToday && dayKey(localToday)) : dayKey(civilDate(today))
  if (!month) return <section data-slot="month-planner" className={cn("rounded-lg border border-border bg-background text-foreground", className)} />
  const byDay = new Map()
  for (const entry of entries) {
    const key = dayKey(civilDate(entry.date))
    byDay.set(key, [...(byDay.get(key) ?? []), entry])
  }
  const year = month.getFullYear(), index = month.getMonth()
  const days = civilDate(`${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}-01`)
  days.setMonth(index + 1, 0)
  const offset = (month.getDay() + (mondayFirst ? 6 : 0)) % 7
  const cells = Math.ceil((offset + days.getDate()) / 7) * 7
  function navigate(delta) {
    const next = new Date(month.getTime())
    next.setMonth(next.getMonth() + delta)
    setMonth(next)
    onMonthChange?.(dayKey(next))
  }
  return (
    <section data-slot="month-planner" className={cn("rounded-lg border border-border bg-background text-foreground", className)} aria-label={calendarLocale ? format(month, "LLLL yyyy", { locale: dateLocale }) : formatMonth(dayKey(month), locale)}>
      <div className="flex items-center justify-between gap-2 p-3">
        <h2 className="font-semibold" aria-live="polite">{calendarLocale ? format(month, "LLLL yyyy", { locale: dateLocale }) : formatMonth(dayKey(month), locale)}</h2>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon" data-month-action="previous" aria-label={t("planner.previous", locale)} disabled={year === 1 && index === 0} onClick={() => navigate(-1)}><ChevronLeft /></Button>
          <Button type="button" variant="outline" size="icon" data-month-action="next" aria-label={t("planner.next", locale)} disabled={year === 9999 && index === 11} onClick={() => navigate(1)}><ChevronRight /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-t border-border">
        {Array.from({ length: 7 }, (_, day) => {
          const date = new Date(2026, 0, 4 + day + (mondayFirst ? 1 : 0), 12)
          return <div key={day} className="p-2 text-center text-xs text-muted-foreground" aria-label={format(date, "EEEE", { locale: dateLocale })}>{format(date, "EEE", { locale: dateLocale })}</div>
        })}
        {Array.from({ length: cells }, (_, cell) => {
          const day = cell - offset + 1
          if (day < 1 || day > days.getDate()) return <div key={cell} aria-hidden="true" className="min-h-24 border-t border-border bg-muted/30" />
          const date = new Date(month.getTime()); date.setDate(day)
          const key = dayKey(date), items = byDay.get(key) ?? [], isToday = key === todayKey
          return <div key={cell} data-date={key} className="min-w-0 min-h-24 border-t border-border p-2">
            <time dateTime={key} aria-current={isToday ? "date" : undefined} className={cn("inline-flex size-6 items-center justify-center rounded-lg text-xs", isToday && "bg-primary text-primary-foreground")} aria-label={isToday ? t("planner.today", locale) : undefined}>{day}</time>
            <ul className="mt-1 space-y-1">
              {items.slice(0, 3).map((entry, position) => <li key={entry.id ?? position} className="min-w-0 rounded-lg bg-muted p-1 text-xs">
                <div className="truncate font-medium" title={entry.name}>{entry.name}</div>
                <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                  <span data-planner-kind className="min-w-0 truncate" title={entry.kind}>{entry.kind}</span>
                  <span data-planner-status className="min-w-0 truncate" title={entry.status}>{entry.status}</span>
                </div>
              </li>)}
            </ul>
            {items.length > 3 && <p className="mt-1 text-xs text-muted-foreground" aria-label={t("planner.remaining", locale, { count: String(items.length - 3) })}>+{items.length - 3}</p>}
          </div>
        })}
      </div>
    </section>
  )
}

export { MonthPlanner, civilDate }
