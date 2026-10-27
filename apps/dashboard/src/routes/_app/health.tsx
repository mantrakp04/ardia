import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, StatsSkeleton, TableSkeleton, useRange, useSection } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { rangeSentence } from "@/lib/compare";
import { formatAgo, formatExact, formatPercent } from "@/lib/format";
import { THRESHOLDS } from "@/lib/thresholds";
import { cn } from "@/lib/utils";
import { compareVersions } from "@/lib/versions";
import type { SectionData } from "@/server/sections";

export const Route = createFileRoute("/_app/health")({
  head: () => ({ meta: [{ title: "Health · Ardia" }] }),
  component: HealthPage,
});

type Health = SectionData<"health">;
type Version = Health["versions"][number];
type Signature = Health["signatures"][number];

function HealthPage() {
  const range = useRange();
  const health = useSection("health");
  return (
    <>
      <PageHeader
        title="Health"
        description={`${rangeSentence(range)}. Opt-in app telemetry: unclean exits come from the next launch's report on the previous session, crashes from the crash reporter. Rates are per opted-in user, so they're a sample.`}
      />
      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 xl:grid-cols-5">
        <Loaded query={health} skeleton={<StatsSkeleton count={5} />} className="contents">
          {(h) => <Summary h={h} />}
        </Loaded>
      </Card>
      <Panel
        source="app"
        title="By version"
        description={`Unclean: share of launches whose previous session didn't end cleanly. Red marks a stable ${Math.round(THRESHOLDS.uncleanPoints * 100)}+ points above the one before it, or a nightly at ${Math.round(THRESHOLDS.uncleanNightly * 100)}%+, with ${THRESHOLDS.minLaunches}+ launches.`}
      >
        <Loaded query={health} skeleton={<TableSkeleton rows={10} columns={7} />}>
          {(h) => <Versions rows={h.versions} />}
        </Loaded>
      </Panel>
      <Panel source="app" title="Crash signatures" description="Grouped by exception type and the first frames of ours (in-app, innermost first; unresolved addresses shown as module +?). JS errors are grouped by message. Click a row for its stack.">
        <Loaded query={health} skeleton={<TableSkeleton rows={8} columns={6} />}>
          {(h) => <Signatures h={h} />}
        </Loaded>
      </Panel>
    </>
  );
}

function Summary({ h }: { h: Health }) {
  const crashes = h.versions.reduce((s, v) => s + v.crashes, 0);
  const js = h.versions.reduce((s, v) => s + v.jsErrors, 0);
  return (
    <>
      <Stat source="app" label="Opted-in users" value={formatExact(h.users)} sub={`${formatExact(h.launches)} launches`} />
      <Stat source="app" label="Unclean exits" value={formatPercent(h.launches ? h.unclean / h.launches : null)} sub={`${formatExact(h.unclean)} launches after one`} />
      <Stat source="app" label="Crashes" value={formatExact(crashes)} sub={`${h.signatures.filter((s) => s.native).length} signatures`} />
      <Stat source="app" label="Crashes per 100 users" value={h.users ? ((100 * crashes) / h.users).toFixed(1) : "–"} sub="all versions in the range" />
      <Stat source="app" label="JS errors" value={formatExact(js)} sub={`${h.signatures.filter((s) => !s.native).length} groups`} />
    </>
  );
}

function flagged(rows: Version[]) {
  const out = new Set<string>();
  const stable = rows.filter((r) => !r.nightly && r.launches >= THRESHOLDS.minLaunches).sort((a, b) => compareVersions(a.version, b.version));
  for (let i = 1; i < stable.length; i++) {
    const a = stable[i]!;
    const b = stable[i - 1]!;
    if ((a.uncleanRate ?? 0) - (b.uncleanRate ?? 0) >= THRESHOLDS.uncleanPoints) out.add(a.version);
  }
  for (const r of rows) if (r.nightly && r.launches >= THRESHOLDS.minLaunches && (r.uncleanRate ?? 0) >= THRESHOLDS.uncleanNightly) out.add(r.version);
  return out;
}

function Versions({ rows }: { rows: Version[] }) {
  const bad = flagged(rows);
  const maxRate = Math.max(...rows.filter((r) => r.launches >= 5).map((r) => r.uncleanRate ?? 0), 0.01);
  return (
    <DataTable
      dense
      rows={rows.filter((r) => r.users > 0)}
      rowKey={(r) => r.version}
      limit={14}
      columns={[
        {
          key: "version",
          header: "Version",
          sort: (r) => r.version,
          cell: (r) => (
            <span className="flex items-center gap-1.5 font-mono text-[12px] whitespace-nowrap">
              {r.version}
              {r.nightly ? (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  nightly
                </Badge>
              ) : null}
            </span>
          ),
        },
        { key: "users", header: "Users", align: "right", sort: (r) => r.users, cell: (r) => formatExact(r.users) },
        { key: "launches", header: "Launches", align: "right", sort: (r) => r.launches, cell: (r) => formatExact(r.launches) },
        {
          key: "unclean",
          header: "Unclean",
          sort: (r) => r.uncleanRate ?? -1,
          className: "w-[22%] min-w-36",
          cell: (r) =>
            r.uncleanRate === null ? (
              <span className="text-muted-foreground">–</span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="relative h-2 flex-1 rounded-full bg-muted">
                  <span
                    className={cn("absolute inset-y-0 left-0 rounded-full", bad.has(r.version) ? "bg-bad" : "bg-[var(--chart-3)]", r.launches < THRESHOLDS.minLaunches && "opacity-40")}
                    style={{ width: `${Math.max(2, (r.uncleanRate / maxRate) * 100)}%` }}
                  />
                </span>
                <span className={cn("w-11 text-right", bad.has(r.version) && "font-semibold text-bad")}>{formatPercent(r.uncleanRate)}</span>
              </span>
            ),
        },
        { key: "crashes", header: "Crashes", align: "right", sort: (r) => r.crashes, cell: (r) => (r.crashes ? <span className="font-medium">{formatExact(r.crashes)}</span> : <span className="text-muted-foreground">0</span>) },
        { key: "per100", header: "Per 100 users", align: "right", sort: (r) => r.crashesPer100 ?? -1, cell: (r) => (r.crashesPer100 === null ? "–" : r.crashesPer100.toFixed(1)) },
        { key: "js", header: "JS errors", align: "right", sort: (r) => r.jsErrors, cell: (r) => formatExact(r.jsErrors) },
      ]}
    />
  );
}

function Signatures({ h }: { h: Health }) {
  const newest = (nightly: boolean) => h.versions.filter((v) => v.nightly === nightly && v.users > 0).sort((a, b) => compareVersions(b.version, a.version))[0]?.version;
  const latest = new Set([newest(false), newest(true)].filter(Boolean));
  return (
    <DataTable
      dense
      rows={h.signatures}
      rowKey={(r) => r.key}
      initialSort={{ key: "count", desc: true }}
      limit={12}
      empty="No crashes or app errors in this range"
      expand={(r) => <Stack s={r} />}
      columns={[
        {
          key: "type",
          header: "Type",
          sort: (r) => r.type,
          cell: (r) => (
            <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
              <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", r.native ? "bg-bad/12 text-bad" : "bg-muted text-muted-foreground")}>{r.native ? "Crash" : "JS"}</span>
              <span className="font-mono text-[11.5px]">{r.type}</span>
              {r.signal ? <span className="font-mono text-[10.5px] text-muted-foreground">{r.signal}</span> : null}
              {latest.has(r.firstVersion) ? (
                <Badge className="h-4 bg-bad px-1 text-[10px] text-white">new in {r.firstVersion}</Badge>
              ) : null}
            </span>
          ),
        },
        { key: "signature", header: "Signature", sort: (r) => r.signature, cell: (r) => <span className="line-clamp-2 max-w-[32rem] font-mono text-[11px] break-all">{r.signature}</span> },
        { key: "count", header: "Count", align: "right", sort: (r) => r.count, cell: (r) => <span className="font-medium">{formatExact(r.count)}</span> },
        { key: "people", header: "People", align: "right", sort: (r) => r.people, cell: (r) => formatExact(r.people) },
        {
          key: "versions",
          header: "Versions",
          sort: (r) => r.versions[0]?.version ?? "",
          cell: (r) => <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{r.versions.slice(0, 3).map((v) => `${v.version}×${v.count}`).join(", ")}{r.versions.length > 3 ? " …" : ""}</span>,
        },
        { key: "last", header: "Last", align: "right", sort: (r) => r.lastSeen, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatAgo(r.lastSeen)}</span> },
      ]}
    />
  );
}

function Stack({ s }: { s: Signature }) {
  return (
    <div className="grid gap-3 px-4 py-3 text-xs">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
        <span>
          First seen on <span className="font-mono text-foreground">{s.firstVersion}</span>, {formatAgo(s.firstSeen)}
        </span>
        <span>{formatExact(s.total)} all time</span>
        {s.message ? <span className="break-all">{s.message}</span> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 label-mono text-muted-foreground">Crashing frames</div>
          <pre className="overflow-x-auto rounded-md bg-card p-2 font-mono text-[11px] leading-relaxed">{s.crashFrames.join("\n") || "none"}</pre>
        </div>
        <div>
          <div className="mb-1 label-mono text-muted-foreground">Our frames</div>
          <pre className="overflow-x-auto rounded-md bg-card p-2 font-mono text-[11px] leading-relaxed">{s.ownFrames.join("\n") || "none"}</pre>
        </div>
      </div>
      <div className="text-muted-foreground">
        Per version: <span className="font-mono">{s.versions.map((v) => `${v.version} ×${v.count}`).join(" · ")}</span>
      </div>
    </div>
  );
}
