"use client"

/**
 * A list of entries a person can look through: search it, sort it, page by page.
 *
 * Tellop wrote this one. shadcn and ReUI both ship the parts it is made of -
 * `table`, `input`, `button`, `empty` next door - and neither ships the thing
 * made out of them, so `components/PROVENANCE.json` records this file under the
 * `tellop` source with no licence text beside it: a generated app belongs to the
 * person who made it, and Tellop claims nothing inside one.
 *
 * ## What it does, and what it deliberately does not
 *
 * Searching, sorting and paging all happen in the browser over the entries it
 * was handed. It asks for nothing: there is no request, no upload, no address
 * named anywhere in this file. An app with more entries than fit in one page
 * load should search and sort them on the server and hand this piece one page
 * at a time - the props below still describe that page honestly.
 *
 * ## Two things it needs from whoever uses it
 *
 * `columns` and `data` are better off keeping the same identity between renders
 * - module scope, `useMemo`, or a query result, rather than an array written
 * inline in the render. Everything shown is computed from them, so a fresh array
 * every render is a fresh computation every render. That is a cost and no longer
 * a trap: measured 2026-09-02, an inline `data` used to send a person reading
 * page three back to page one on any unrelated re-render of the page around
 * them. See "Which page a person is on" below for what replaced it.
 *
 * A definition is `{ accessorKey, header, cell }`, or `{ accessorFn, id, header,
 * cell }` where the value has to be worked out rather than read off a field -
 * measured, the search reaches both of those. What it cannot reach is a
 * display-only definition, which has no value to read.
 *
 * ## Which page a person is on
 *
 * Paging is left where the person put it, and goes back to the first page in
 * three data/search cases (and when a filter choice changes): the number of entries changed, `resetKey` changed, or the
 * search words changed. The machinery underneath would otherwise start again at
 * the first page every time `data` arrives as a new array, which for an app that
 * writes its entries inline is every single render - hence `autoResetPageIndex`
 * being off below, with the three honest cases done by hand instead. `resetKey`
 * is how an app says "these are different entries" when the count happens to be
 * the same: a chosen category, a chosen person, a chosen day.
 *
 * ## The words
 *
 * Labels default to the app locale; a page may pass its own words. `pageLabel` is a function rather than a sentence with
 * holes in it, because the two numbers fall in a different order in different
 * languages.
 */

import * as React from "react"
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  filterFn_equalsString,
  filterFn_includesString,
  sortFn_alphanumeric,
  sortFn_text,
  sortFn_datetime,
  sortFn_basic,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  InboxIcon,
  SearchIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { getLocale, t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/*
 * Registered once, outside the component: this is a description of which parts
 * of the machinery exist, not state, and building it inside the render would
 * rebuild the whole pipeline on every keystroke.
 */
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filterFns: { includesString: filterFn_includesString, equalsString: filterFn_equalsString },
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime, basic: sortFn_basic },
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

/** What a heading looks like when it can be sorted, and how it is sorted now. */
function SortMark({ direction }) {
  if (direction === "asc") return <ArrowUpIcon aria-hidden="true" />
  if (direction === "desc") return <ArrowDownIcon aria-hidden="true" />
  return <ArrowUpDownIcon aria-hidden="true" className="opacity-50" />
}

/** What a browser reads out for a heading that is sorted one way or the other. */
function sortedAs(direction) {
  if (direction === "asc") return "ascending"
  if (direction === "desc") return "descending"
  return "none"
}

/** filters: {columnId, label, allLabel?, options:[{value,label}] }[].
 * Values are exact string choices by default; an explicit column.filterFn wins.
 * Compact cells stay on one line. Keep working columns short; constrain a long
 * name inside its cell, and reserve space for status/actions instead of hiding them.
 */
function DataTable({
  columns,
  data,
  resetKey,
  locale = getLocale(),
  filters = [],
  compact = true,
  searchPlaceholder = t("table.search", locale),
  emptyTitle = t("table.emptyTitle", locale),
  emptyDescription = t("table.emptyDescription", locale),
  noMatchTitle = t("table.noMatchTitle", locale),
  noMatchDescription = t("table.noMatchDescription", locale),
  previousLabel = t("table.previous", locale),
  nextLabel = t("table.next", locale),
  pageLabel = (page, pages) => t("table.page", locale, { page: String(page), pages: String(pages) }),
  pageSize = 10,
  className,
}) {
  /*
   * The starting page size only. Handing a new one later does not move a person
   * who is already three pages in, which is the behaviour we want and also what
   * the machinery underneath guarantees.
   */
  const initialState = React.useMemo(
    () => ({ pagination: { pageIndex: 0, pageSize } }),
    [pageSize],
  )
  const filterIds = new Set(filters.map(filter => filter.columnId))
  const preparedColumns = React.useMemo(() => {
    function prepare(definitions) {
      return definitions.map(column => column.columns ? { ...column, columns: prepare(column.columns) } :
        filterIds.has(column.id ?? column.accessorKey) && column.filterFn == null ? { ...column, filterFn: "equalsString" } : column)
    }
    return prepare(columns)
  }, [columns, filters])
  const table = useTable({
    features,
    columns: preparedColumns,
    data,
    initialState,
    /*
     * Off, because the machinery watches `data`'s identity rather than what is
     * in it: a fresh array carrying the very same entries counted as a change,
     * and paging started over. The three cases that genuinely mean "start
     * again" are done deliberately - just below, and beside the search field.
     */
    autoResetPageIndex: false,
  })

  /*
   * More entries, fewer entries, or an app saying outright that these are
   * different ones. Counting rather than comparing identity is the whole point:
   * `data.length` moves when the entries really did.
   */
  const entryCount = Array.isArray(data) ? data.length : 0
  const paging = React.useRef({ entryCount, resetKey })
  React.useEffect(() => {
    if (paging.current.entryCount === entryCount && paging.current.resetKey === resetKey) {
      return
    }
    paging.current = { entryCount, resetKey }
    table.setPageIndex(0)
  }, [entryCount, resetKey, table])

  const searchText = table.state.globalFilter ?? ""
  const hasFilter = searchText !== "" || table.state.columnFilters.length > 0
  const shown = table.getRowModel().rows
  const pages = Math.max(table.getPageCount(), 1)
  const page = table.state.pagination.pageIndex + 1
  const across = Math.max(table.getAllLeafColumns().length, 1)

  return (
    <div data-slot="data-table" data-compact={compact} className={cn("flex w-full min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <SearchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <Input
          value={searchText}
          onValueChange={(next) => {
            table.setGlobalFilter(next)
            // The words decide what there is to page through, so the first page
            // is the only place it makes sense to be standing afterwards.
            table.setPageIndex(0)
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="max-w-xs"
        />
      </div>

      {filters.map(filter => {
        const column = table.getColumn(filter.columnId)
        if (!column?.getCanFilter()) return null
        const selected = column.getFilterValue()
        return <div key={filter.columnId} role="group" aria-label={filter.label} className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm text-muted-foreground">{filter.label}</span>
          {[{ value: undefined, label: filter.allLabel ?? t("table.all", locale) }, ...filter.options].map((option, index) =>
            <Button key={index} type="button" size="sm" variant={Object.is(selected, option.value) ? "secondary" : "outline"}
              aria-pressed={Object.is(selected, option.value)} data-filter-column={filter.columnId} data-filter-value={option.value ?? ""}
              onClick={() => { column.setFilterValue(option.value); table.setPageIndex(0) }}>{option.label}</Button>)}
        </div>
      })}

      <Table className={cn(compact && "[&_td]:py-1.5 [&_td]:whitespace-nowrap")}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const direction = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={sortable ? sortedAs(direction) : undefined}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2.5"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <SortMark direction={direction} />
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {shown.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={across} className="p-0">
                <Empty className="border-0 py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {!hasFilter ? (
                        <InboxIcon aria-hidden="true" />
                      ) : (
                        <SearchIcon aria-hidden="true" />
                      )}
                    </EmptyMedia>
                    <EmptyTitle>
                      {!hasFilter ? emptyTitle : noMatchTitle}
                    </EmptyTitle>
                    <EmptyDescription>
                      {!hasFilter ? emptyDescription : noMatchDescription}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : (
            shown.map((entry) => (
              <TableRow key={entry.id}>
                {entry.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {pageLabel(page, pages)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {previousLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {nextLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { DataTable }
