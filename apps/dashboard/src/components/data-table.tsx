import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  align?: "left" | "right";
  className?: string;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  empty = "Nothing in this range",
  expand,
  limit,
  dense,
  onSelect,
  selected,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; desc: boolean };
  empty?: string;
  expand?: (row: T) => ReactNode;
  limit?: number;
  dense?: boolean;
  onSelect?: (row: T) => void;
  selected?: string | null;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.key === sort.key) : null;
    if (!column?.sort || !sort) return rows;
    const get = column.sort;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, columns, sort]);

  const visible = limit && !showAll ? sorted.slice(0, limit) : sorted;

  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;

  return (
    <div className="grid gap-2">
      <div className="-mx-1 overflow-x-auto px-1">
        <Table className={cn("tnum", dense ? "text-xs" : "text-sm")}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <TableHead
                    key={column.key}
                    aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}
                    className={cn("h-9 whitespace-nowrap", column.align === "right" && "text-right", column.className)}
                  >
                    {column.sort ? (
                      <button
                        type="button"
                        onClick={() => setSort(active ? { key: column.key, desc: !sort!.desc } : { key: column.key, desc: true })}
                        className={cn(
                          "inline-flex items-center gap-1 label-mono text-muted-foreground hover:text-foreground",
                          column.align === "right" && "flex-row-reverse",
                          active && "text-foreground",
                        )}
                      >
                        {column.header}
                        {active ? sort!.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      <span className="label-mono text-muted-foreground">{column.header}</span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const key = rowKey(row);
              const isOpen = open === key;
              const activate = expand ? () => setOpen(isOpen ? null : key) : onSelect ? () => onSelect(row) : null;
              return (
                <Fragment key={key}>
                  <TableRow
                    data-state={isOpen || selected === key ? "selected" : undefined}
                    className={cn(activate && "cursor-pointer")}
                    onClick={activate ?? undefined}
                    onKeyDown={
                      activate
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              activate();
                            }
                          }
                        : undefined
                    }
                    tabIndex={activate ? 0 : undefined}
                    aria-expanded={expand ? isOpen : undefined}
                    aria-selected={onSelect ? selected === key : undefined}
                  >
                    {columns.map((column) => (
                      <TableCell key={column.key} className={cn(dense ? "py-1.5" : "py-2", column.align === "right" && "text-right", column.className)}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {expand && isOpen ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="bg-muted/40 p-0">
                        {expand(row)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {limit && rows.length > limit ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}
