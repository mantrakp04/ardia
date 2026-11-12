import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Segmented, VersionTag, selectClass } from "@/components/people-ui";
import { PersonInline } from "@/components/person";
import { Loaded, StatsSkeleton, TableSkeleton } from "@/components/section";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatExact, formatMs } from "@/lib/format";
import { getRegressions } from "@/lib/people-api";
import { THRESHOLDS } from "@/lib/thresholds";
import { cn } from "@/lib/utils";

type RegressionSearch = { channel?: "stable"; latest?: string; previous?: string };

const VERSION = /^0\.\d+\.\d+(-nightly\.\d+)?$/;

export const Route = createFileRoute("/_app/regressions")({
  validateSearch: (search: Record<string, unknown>): RegressionSearch => {
    const out: RegressionSearch = {};
    if (search.channel === "stable") out.channel = "stable";
    if (typeof search.latest === "string" && VERSION.test(search.latest)) out.latest = search.latest;
    if (typeof search.previous === "string" && VERSION.test(search.previous)) out.previous = search.previous;
    return out;
  },
  head: () => ({ meta: [{ title: "Regressions · Ardia" }] }),
  component: RegressionsPage,
});

type Data = Awaited<ReturnType<typeof getRegressions>>;
type Row = Data["rows"][number];

function formatValue(unit: Row["unit"], n: number | null) {
  if (n === null) return "–";
  if (unit === "ms") return formatMs(n);
  if (unit === "mb") return n >= 1024 ? `${(n / 1024).toFixed(2)} GB` : `${Math.round(n)} MB`;
  if (unit === "bytes") return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
  if (unit === "share") return `${(n * 100).toFixed(2)}%`;
  return n.toFixed(1);
}

function formatChange(row: Row) {
  if (row.change === null) return row.previous === 0 && (row.latest ?? 0) > 0 ? "new" : "–";
  if (row.unit === "share") return `${row.change >= 0 ? "+" : "−"}${Math.abs(row.change * 100).toFixed(2)} pts`;
  const pct = Math.round(row.change * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`;
}

function RegressionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const channel = search.channel ?? "nightly";
  const input = { channel, latest: search.latest, previous: search.previous };
  const query = useQuery({
    queryKey: ["regressions", input],
    queryFn: ({ signal }) => getRegressions({ data: input, signal }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const d = query.data;

  return (
    <>
      <PageHeader
        title="Regressions"
        description={`Each tracked number on the latest ${channel} against the one before it on the same channel. Red is worse by ${Math.round(THRESHOLDS.perfWorse * 100)}%+ for timings and sizes (${THRESHOLDS.minPerfSamples}+ samples each), 25%+ for per-session rates (10+ events), or 0.5+ points of crash-free sessions. Opt-in telemetry from the last 120 days.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Channel" value={channel} options={[["nightly", "Nightly"], ["stable", "Stable"]] as const} onChange={(v) => navigate({ search: { channel: v === "stable" ? "stable" : undefined } })} />
          {d && d.versions.length > 1 ? (
            <>
              <select aria-label="Latest version" value={d.latest ?? ""} onChange={(e) => navigate({ search: (prev) => ({ ...prev, latest: e.target.value, previous: undefined }) })} className={selectClass}>
                {d.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">vs</span>
              <select aria-label="Previous version" value={d.previous ?? ""} onChange={(e) => navigate({ search: (prev) => ({ ...prev, previous: e.target.value }) })} className={selectClass}>
                {d.versions
                  .filter((v) => v.version !== d.latest)
                  .map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                    </option>
                  ))}
              </select>
            </>
          ) : null}
        </div>
      </PageHeader>

      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-4 sm:px-5">
        <Loaded query={query} skeleton={<StatsSkeleton count={4} />} className="contents">
          {(r) => (
            <>
              <Stat source="app" label="Latest" value={r.latest ? <VersionTag version={r.latest} className="text-base" /> : "–"} sub={`${formatExact(r.people.latest)} people · ${formatExact(r.sessions.latest)} sessions`} />
              <Stat source="app" label="Against" value={r.previous ? <VersionTag version={r.previous} /> : "–"} sub={`${formatExact(r.people.previous)} people · ${formatExact(r.sessions.previous)} sessions`} />
              <Stat label="Worse" value={<span className={r.rows.some((x) => x.worse) ? "text-bad" : undefined}>{r.rows.filter((x) => x.worse).length}</span>} sub={`of ${r.rows.length} tracked numbers`} />
              <Stat label="Better" value={<span className={r.rows.some((x) => x.better) ? "text-good" : undefined}>{r.rows.filter((x) => x.better).length}</span>} sub={`${r.rows.filter((x) => !x.enough).length} without enough data`} />
            </>
          )}
        </Loaded>
      </Card>

      <Panel source="app" title="Tracked numbers" description="Click a row for the people on the latest version whose own number is past the previous version's, or who hit the event." bodyClassName="px-0 sm:px-0">
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={12} columns={6} /></div>}>
          {(r) => (
            <div className="px-2 sm:px-3">
              <DataTable
                dense
                rows={r.rows}
                rowKey={(x) => x.key}
                empty={r.latest ? "Nothing to compare" : `No ${channel} versions with enough people yet`}
                expand={(x) => <Affected row={x} />}
                columns={[
                  {
                    key: "label",
                    header: "Number",
                    cell: (x) => (
                      <span className="flex items-center gap-1.5">
                        <span className={cn("grid", x.worse && "-ml-3 border-l-[3px] border-bad pl-2.5")}>
                          <span className={cn("font-medium", x.worse && "text-bad")}>{x.label}</span>
                          {x.worse && x.affected ? (
                            <span className="text-[11px] font-medium text-bad underline decoration-bad/40 underline-offset-2">
                              {formatExact(x.affected)} {x.affected === 1 ? "person" : "people"} on {r.latest} ›
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{x.group}</span>
                          )}
                        </span>
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger asChild>
                            <button type="button" onClick={(e) => e.stopPropagation()} className="text-muted-foreground/60 hover:text-foreground" aria-label={`About ${x.label}`}>
                              <Info className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64 text-xs">{x.hint}</TooltipContent>
                        </Tooltip>
                      </span>
                    ),
                  },
                  { key: "previous", header: r.previous ?? "Previous", align: "right", cell: (x) => <span className="grid"><span>{formatValue(x.unit, x.previous)}</span><span className="text-[10.5px] text-muted-foreground">n {formatExact(x.previousN)}</span></span> },
                  { key: "latest", header: r.latest ?? "Latest", align: "right", cell: (x) => <span className="grid"><span className="font-semibold">{formatValue(x.unit, x.latest)}</span><span className="text-[10.5px] text-muted-foreground">n {formatExact(x.latestN)}</span></span> },
                  {
                    key: "change",
                    header: "Change",
                    align: "right",
                    cell: (x) => (
                      <span className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap tnum", x.worse ? "bg-bad/12 text-bad" : x.better ? "bg-good/12 text-good" : "bg-muted text-muted-foreground")}>
                        {formatChange(x)}
                      </span>
                    ),
                  },
                  { key: "affected", header: "People", align: "right", cell: (x) => (x.affected ? <span className={cn(x.worse && "font-semibold text-bad")}>{formatExact(x.affected)}</span> : <span className="text-muted-foreground">0</span>) },
                  {
                    key: "status",
                    header: "Status",
                    align: "right",
                    className: "w-px whitespace-nowrap",
                    cell: (x) => (
                      <span className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-medium", x.worse ? "border-bad/40 bg-bad/12 text-bad" : !x.enough ? "border-chart-5/30 bg-chart-5/10 text-chart-5" : "border-good/30 bg-good/10 text-good")}>
                        <span className="size-1.5 rounded-full bg-current" aria-hidden />
                        {x.worse ? "Worse" : !x.enough ? "Too few samples" : (x.unit === "share" ? -(x.change ?? 0) : x.change ?? 0) > 0 ? "Within threshold" : "Same or better"}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </Loaded>
      </Panel>
    </>
  );
}

function Affected({ row }: { row: Row }) {
  if (!row.people.length) return <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">Nobody on the latest version is past the previous number.</p>;
  return (
    <div className="grid gap-2 px-4 py-3 text-xs sm:px-5">
      <span className="text-muted-foreground">
        {formatExact(row.affected)} {row.affected === 1 ? "person" : "people"}
        {row.affected > row.people.length ? `, first ${row.people.length} shown` : ""}
      </span>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {row.people.map((p) => (
          <PersonInline key={p.id} id={p.id} />
        ))}
      </div>
    </div>
  );
}
