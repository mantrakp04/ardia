import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { TrendSheetProvider, TrendTarget, type TrendOption, type TrendSpec } from "@/components/perf-trend";
import { QuantileRows } from "@/components/quantiles";
import { ListSkeleton, Loaded, StatsSkeleton, TableSkeleton, useRange, useSection } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { rangeSentence } from "@/lib/compare";
import { formatExact, formatMs } from "@/lib/format";
import { THRESHOLDS } from "@/lib/thresholds";
import { cn } from "@/lib/utils";
import { compareVersions } from "@/lib/versions";
import type { SectionData } from "@/server/sections";

export const Route = createFileRoute("/_app/performance")({
  head: () => ({ meta: [{ title: "Performance · Ardia" }] }),
  component: PerformancePage,
});

type Perf = SectionData<"performance">;
type Row = Perf["versions"][number];
type Q = { count: number; p50: number; p90: number; p99: number } | null;
type Group = { group: string; count: number; p50: number; p90: number; p99: number };

const LAUNCH_LABEL: Record<string, string> = { warm: "Normal", cold: "Cold, after reboot", first: "First after update", "first-cold": "First after update, cold" };
const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${formatExact(Math.round(n))} MB`);
const mbTick = (n: number) => (n >= 1024 ? `${Number((n / 1024).toFixed(1))} GB` : `${Math.round(n)} MB`);
const profilesLabel = (g: string) => `${g} ${g === "1" ? "profile" : "profiles"}`;

const pick = (q: Q) => (q ? { count: q.count, p50: q.p50, p90: q.p90, p99: q.p99 } : null);
const options = (groups: Group[], label: (g: string) => string, all: Q, allLabel: string): TrendOption[] => [
  { group: "all", label: allLabel, summary: pick(all) },
  ...groups.map((g) => ({ group: g.group, label: label(g.group), summary: pick(g) })),
];

function specs(p: Perf) {
  const launch = options(p.launch, (g) => LAUNCH_LABEL[g] ?? g, p.overall.launch, "All launches");
  const switching = options(p.switching, profilesLabel, p.overall.switching, "All profile switches");
  const memory = options(p.memory, (g) => `${g} tabs`, p.overall.memory, "All memory samples");
  const omnibox: TrendOption[] = [
    { group: "p50", label: "Omnibox p50 per session", summary: pick(p.overall.omnibox50) },
    { group: "p95", label: "Omnibox p95 per session", summary: pick(p.overall.omnibox95) },
  ];
  const launchSpec = (group: string): TrendSpec => ({ family: "launch", group, context: "Launch to a usable window", color: "var(--chart-2)", format: formatMs, options: launch });
  return {
    launch: launchSpec,
    switching: (group: string): TrendSpec => ({ family: "switch", group, context: "Profile switch time", color: "var(--chart-4)", format: formatMs, options: switching }),
    memory: (group: string): TrendSpec => ({ family: "memory", group, context: "Memory across all Ardia processes", color: "var(--chart-5)", format: mb, tickUnit: 1024, tick: mbTick, options: memory }),
    omnibox: (group: string): TrendSpec => ({ family: "omnibox", group, context: "Omnibox time, one value per session", color: "var(--chart-2)", format: formatMs, options: omnibox }),
    launchCount: (): TrendSpec => ({
      family: "launch",
      group: "all",
      context: "Launches timed",
      color: "var(--chart-2)",
      format: formatExact,
      counts: true,
      options: [{ group: "all", label: "Launches timed", summary: pick(p.overall.launch) }, ...launch.slice(1)],
    }),
  };
}

function TrendTile({ spec, name, children }: { spec: TrendSpec; name: string; children: ReactNode }) {
  return (
    <div className="relative -m-2 rounded-lg p-2 transition-colors hover:bg-accent/50 [&_[data-slot=tooltip-trigger]]:relative [&_[data-slot=tooltip-trigger]]:z-10">
      <TrendTarget spec={spec} name={name} side="bottom">
        <div className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
      </TrendTarget>
      {children}
    </div>
  );
}

function PerformancePage() {
  const range = useRange();
  const perf = useSection("performance");
  return (
    <TrendSheetProvider>
      <PageHeader
        title="Performance"
        description={`${rangeSentence(range)}. Opt-in timings from real copies: launch to a usable window, the omnibox's own per-session p50 and p95, profile switches and memory across all processes.`}
      />
      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 xl:grid-cols-6">
        <Loaded query={perf} skeleton={<StatsSkeleton count={6} />} className="contents">
          {(p) => <Summary p={p} />}
        </Loaded>
      </Card>
      <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <Panel source="app" title="Launch to usable" description="Split by whether it's the first launch of a new version (after an update) and whether it's the first since a reboot.">
          <Loaded query={perf} skeleton={<ListSkeleton rows={4} />}>
            {(p) => (
              <QuantileRows
                dimension="Launch"
                format={formatMs}
                rows={p.launch.map((g) => ({ key: g.group, label: LAUNCH_LABEL[g.group] ?? g.group, ...g }))}
                wrapRow={(r, node) => <TrendTarget spec={specs(p).launch(r.key)}>{node}</TrendTarget>}
              />
            )}
          </Loaded>
        </Panel>
        <Panel source="app" title="Profile switch" description="Time to switch profiles, by how many profiles the person has.">
          <Loaded query={perf} skeleton={<ListSkeleton rows={6} />}>
            {(p) => (
              <QuantileRows
                dimension="Profiles"
                format={formatMs}
                color="var(--chart-4)"
                rows={p.switching.map((g) => ({ key: g.group, label: profilesLabel(g.group), ...g }))}
                wrapRow={(r, node) => <TrendTarget spec={specs(p).switching(r.key)}>{node}</TrendTarget>}
              />
            )}
          </Loaded>
        </Panel>
      </div>
      <Panel source="app" title="Memory against tabs" description="All Ardia processes in a memory sample, by how many tabs were open then.">
        <Loaded query={perf} skeleton={<ListSkeleton rows={5} />}>
          {(p) => (
            <QuantileRows
              dimension="Open tabs"
              format={mb}
              color="var(--chart-5)"
              rows={p.memory.map((g) => ({ key: g.group, label: `${g.group} tabs`, ...g }))}
              wrapRow={(r, node) => <TrendTarget spec={specs(p).memory(r.key)}>{node}</TrendTarget>}
            />
          )}
        </Loaded>
      </Panel>
      <Panel
        source="app"
        title="By version"
        description={`Medians per version. Red: ${Math.round(THRESHOLDS.perfWorse * 100)}%+ worse than the previous version on the same channel and by more than rounding (${D.launch} ms launch, ${D.omnibox} ms omnibox, ${D.switch} ms switch, ${D.memory} MB), both with ${THRESHOLDS.minPerfSamples}+ samples. Faded: under ${THRESHOLDS.minPerfSamples} samples.`}
      >
        <Loaded query={perf} skeleton={<TableSkeleton rows={10} columns={7} />}>
          {(p) => <Versions rows={p.versions} />}
        </Loaded>
      </Panel>
    </TrendSheetProvider>
  );
}

function Summary({ p }: { p: Perf }) {
  const group = (key: string) => p.launch.find((g) => g.group === key);
  const warm = group("warm");
  const first = group("first");
  const o = p.overall;
  const s = specs(p);
  return (
    <>
      <TrendTile spec={s.launch("warm")} name="Normal launch">
        <Stat source="app" label="Normal launch" value={warm ? formatMs(warm.p50) : "–"} sub={warm ? `p90 ${formatMs(warm.p90)}` : undefined} />
      </TrendTile>
      <TrendTile spec={s.launch("first")} name="First after update">
        <Stat
          source="app"
          label="First after update"
          value={first ? formatMs(first.p50) : "–"}
          sub={first && warm?.p50 ? `${(first.p50 / warm.p50).toFixed(1)}× normal · p90 ${formatMs(first.p90)}` : undefined}
        />
      </TrendTile>
      <TrendTile spec={s.omnibox("p50")} name="Omnibox p50">
        <Stat source="app" label="Omnibox p50" value={o.omnibox50 ? formatMs(o.omnibox50.p50) : "–"} sub={o.omnibox95 ? `p95 ${formatMs(o.omnibox95.p50)} (median session)` : undefined} />
      </TrendTile>
      <TrendTile spec={s.switching("all")} name="Profile switch">
        <Stat source="app" label="Profile switch" value={o.switching ? formatMs(o.switching.p50) : "–"} sub={o.switching ? `p90 ${formatMs(o.switching.p90)} · p99 ${formatMs(o.switching.p99)}` : undefined} />
      </TrendTile>
      <TrendTile spec={s.memory("all")} name="Memory">
        <Stat source="app" label="Memory" value={o.memory ? mb(o.memory.p50) : "–"} sub={o.memory ? `p90 ${mb(o.memory.p90)} · p99 ${mb(o.memory.p99)}` : undefined} />
      </TrendTile>
      <TrendTile spec={s.launchCount()} name="Launches timed">
        <Stat source="app" label="Launches timed" value={o.launch ? formatExact(o.launch.count) : "–"} sub={o.memory ? `${formatExact(o.memory.count)} memory samples` : undefined} />
      </TrendTile>
    </>
  );
}

const D = THRESHOLDS.perfMinDelta;
const METRICS: { key: string; header: string; pick: (r: Row) => Q; format: (n: number) => string; minDelta: number }[] = [
  { key: "warm", header: "Normal launch", pick: (r) => r.warm, format: formatMs, minDelta: D.launch },
  { key: "first", header: "First after update", pick: (r) => r.first, format: formatMs, minDelta: D.launch },
  { key: "omnibox50", header: "Omnibox p50", pick: (r) => r.omnibox50, format: formatMs, minDelta: D.omnibox },
  { key: "omnibox95", header: "Omnibox p95", pick: (r) => r.omnibox95, format: formatMs, minDelta: D.omnibox },
  { key: "switching", header: "Profile switch", pick: (r) => r.switching, format: formatMs, minDelta: D.switch },
  { key: "memory", header: "Memory", pick: (r) => r.memory, format: mb, minDelta: D.memory },
];

function Versions({ rows }: { rows: Row[] }) {
  const enough = (q: Q) => !!q && q.count >= THRESHOLDS.minPerfSamples;
  const previousOf = (r: Row, pick: (r: Row) => Q) =>
    rows
      .filter((x) => x.nightly === r.nightly && compareVersions(x.version, r.version) < 0 && enough(pick(x)))
      .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
  const cell = (r: Row, m: (typeof METRICS)[number]): ReactNode => {
    const q = m.pick(r);
    if (!q) return <span className="text-muted-foreground">–</span>;
    const before = enough(q) ? previousOf(r, m.pick) : null;
    const prev = before ? m.pick(before) : null;
    const change = prev && prev.p50 > 0 ? q.p50 / prev.p50 - 1 : null;
    const worse = change !== null && change >= THRESHOLDS.perfWorse && q.p50 - prev!.p50 >= m.minDelta;
    return (
      <span className={cn("inline-flex flex-col items-end leading-tight", !enough(q) && "opacity-45")} title={`${formatExact(q.count)} samples${before ? `, vs ${before.version}` : ""}`}>
        <span className={cn(worse && "font-semibold text-bad")}>{m.format(q.p50)}</span>
        {change !== null && Math.abs(change) >= 0.05 ? (
          <span className={cn("text-[10.5px]", worse ? "text-bad" : change < 0 ? "text-good" : "text-muted-foreground")}>
            {change > 0 ? "+" : "−"}
            {Math.abs(Math.round(change * 100))}%
          </span>
        ) : null}
      </span>
    );
  };
  return (
    <DataTable
      dense
      rows={rows.filter((r) => r.launch || r.memory || r.switching)}
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
        { key: "launches", header: "Launches", align: "right", sort: (r) => r.launch?.count ?? 0, cell: (r) => formatExact(r.launch?.count ?? 0) },
        ...METRICS.map((m) => ({ key: m.key, header: m.header, align: "right" as const, sort: (r: Row) => m.pick(r)?.p50 ?? -1, cell: (r: Row) => cell(r, m) })),
      ]}
    />
  );
}
