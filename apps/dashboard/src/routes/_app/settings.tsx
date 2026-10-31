import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { OTHER_COLOR, SERIES_COLORS, StackedAreaChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { SparkChart } from "@/components/ruixen/spark-chart";
import { ChartSkeleton, Loaded, StatsSkeleton, TableSkeleton, useRange, useSection } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { rangeSentence } from "@/lib/compare";
import { formatBucket, formatExact, formatPercent, formatTick } from "@/lib/format";
import { OTHER_VALUE, SETTINGS_SINCE, TINT_KEY, TINT_SWITCH_KEY, settingValueLabel } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { SectionData } from "@/server/sections";

type SettingsSearch = { setting?: string };

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch =>
    typeof search.setting === "string" && search.setting ? { setting: search.setting.slice(0, 64) } : {},
  head: () => ({ meta: [{ title: "Settings · Ardia" }] }),
  component: SettingsPage,
});

type Overview = SectionData<"settings">;
type Tint = SectionData<"settings.tint">;

const percentTick = (n: number) => `${Math.round(n * 100)}%`;
const shareFormat = (n: number) => formatPercent(n, 1);
const amount = (n: number | null) => (n === null ? "–" : n.toFixed(2));

function SettingsPage() {
  const range = useRange();
  const overview = useSection("settings");
  const tint = useSection("settings.tint");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const select = (key: string | undefined) => navigate({ search: (prev) => ({ ...prev, setting: key }), replace: true, resetScroll: false });

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${rangeSentence(range)}. What opted-in users set: each install sends its settings at most once a UTC day, as values and that build's defaults. Counts use each install's latest snapshot in the range; text settings are never sent.`}
      />
      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:px-5 xl:grid-cols-4">
        <Loaded query={overview} skeleton={<StatsSkeleton count={4} />} className="contents">
          {(o) => <Summary o={o} />}
        </Loaded>
      </Card>
      <Loaded query={overview} skeleton={<OverviewPanel skeleton />}>
        {(o) =>
          o.settings.length ? (
            <>
              <OverviewPanel o={o} selected={search.setting ?? null} onSelect={(key) => select(search.setting === key ? undefined : key)} />
              <Detail o={o} settingKey={search.setting ?? null} onClose={() => select(undefined)} />
            </>
          ) : (
            <EmptyState />
          )
        }
      </Loaded>
      <Panel
        source="app"
        title="Theme tint amount"
        description={`Installs whose latest snapshot has ${TINT_SWITCH_KEY} on, and the ${TINT_KEY} they chose, to pick a default from. Buckets are 0.1 wide; 1.0 counts in the last.`}
      >
        <Loaded query={tint} skeleton={<ChartSkeleton height={220} />}>
          {(t) => <TintCard t={t} />}
        </Loaded>
      </Panel>
    </>
  );
}

function EmptyState() {
  return (
    <Panel source="app" title="No settings snapshots yet">
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing in this range. The app starts sending these from {SETTINGS_SINCE}, for people who share usage stats.
      </p>
    </Panel>
  );
}

function Summary({ o }: { o: Overview }) {
  const reported = o.settings.filter((s) => s.installs > 0);
  const mostChanged = [...reported].sort((a, b) => (a.onDefaultShare ?? 1) - (b.onDefaultShare ?? 1))[0];
  const changedDefaults = o.settings.filter((s) => s.changedIn);
  return (
    <>
      <Stat source="app" label="Installs reporting" value={formatExact(o.installs)} sub={o.newestVersion ? `newest on ${o.newestVersion}` : `from ${SETTINGS_SINCE}`} />
      <Stat source="app" label="Settings seen" value={formatExact(o.settings.length)} sub="keys come from the data" />
      <Stat
        source="app"
        label="Changed most"
        value={mostChanged && mostChanged.onDefaultShare !== null ? formatPercent(1 - mostChanged.onDefaultShare) : "–"}
        sub={mostChanged ? <span className="font-mono">{mostChanged.key}</span> : "off their default"}
      />
      <Stat
        source="app"
        label="Defaults changed"
        value={formatExact(changedDefaults.length)}
        sub={changedDefaults.length ? <span className="font-mono">{changedDefaults.slice(0, 2).map((s) => s.key).join(", ")}{changedDefaults.length > 2 ? " …" : ""}</span> : "between versions in the range"}
      />
    </>
  );
}

function ValueChip({ value, isDefault }: { value: string; isDefault?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-48 items-center truncate rounded px-1.5 py-0.5 font-mono text-[11px]", isDefault ? "bg-[var(--chart-1)]/12 text-foreground" : "bg-muted")}>
      {settingValueLabel(value)}
    </span>
  );
}

function OverviewPanel({ o, selected, onSelect, skeleton }: { o?: Overview; selected?: string | null; onSelect?: (key: string) => void; skeleton?: boolean }) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (o?.settings ?? []).filter((s) => !needle || s.key.toLowerCase().includes(needle) || s.currentDefault.toLowerCase().includes(needle));
  }, [o, filter]);
  return (
    <Panel
      source="app"
      title="Every setting"
      description="Default is the newest version's. On default: installs whose value equals their own build's default. Click a row for its history."
      action={
        <input
          type="search"
          aria-label="Filter settings"
          placeholder="Filter settings…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 w-44 rounded-lg border bg-card px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-56"
        />
      }
    >
      {skeleton || !o ? (
        <TableSkeleton rows={10} columns={6} />
      ) : (
        <DataTable
          dense
          rows={rows}
          rowKey={(r) => r.key}
          initialSort={{ key: "changed", desc: true }}
          empty={filter ? "No setting matches" : "Nothing in this range"}
          selected={selected}
          onSelect={(r) => onSelect?.(r.key)}
          columns={[
            {
              key: "key",
              header: "Setting",
              sort: (r) => r.key,
              cell: (r) => (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="font-mono text-[12px]">{r.key}</span>
                  {r.changedIn ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]" title="The default differs from the version before it">
                      default changed in {r.changedIn}
                    </Badge>
                  ) : null}
                </span>
              ),
            },
            { key: "default", header: "Default", sort: (r) => r.currentDefault, cell: (r) => <ValueChip value={r.currentDefault} isDefault /> },
            { key: "installs", header: "Installs", align: "right", sort: (r) => r.installs, cell: (r) => formatExact(r.installs) },
            {
              key: "changed",
              header: "Changed",
              align: "right",
              sort: (r) => (r.onDefaultShare === null ? -1 : 1 - r.onDefaultShare),
              cell: (r) => (
                <span className="inline-flex flex-col items-end leading-tight" title={`${formatExact(r.installs - r.onDefault)} of ${formatExact(r.installs)} off their default`}>
                  <span className="font-medium">{formatPercent(r.onDefaultShare === null ? null : 1 - r.onDefaultShare)}</span>
                  <span className="text-[10.5px] text-muted-foreground">{formatPercent(r.onDefaultShare)} on default</span>
                </span>
              ),
            },
            {
              key: "top",
              header: "Top other value",
              sort: (r) => r.topValue?.share ?? -1,
              cell: (r) =>
                r.topValue ? (
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <ValueChip value={r.topValue.value} />
                    <span className="text-muted-foreground">{formatPercent(r.topValue.share)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">–</span>
                ),
            },
            {
              key: "trend",
              header: "On default per day",
              className: "w-36 min-w-28",
              cell: (r) => (r.trend.length > 1 ? <SparkChart data={r.trend} height={24} color="var(--chart-1)" label={`${r.key}: share on default per day`} /> : <span className="text-muted-foreground">{r.trend.length ? formatPercent(r.trend[0]) : "–"}</span>),
            },
          ]}
        />
      )}
    </Panel>
  );
}

function seriesColor(value: string, isDefault: boolean, index: number) {
  if (value === OTHER_VALUE) return OTHER_COLOR;
  if (isDefault) return SERIES_COLORS[0]!;
  return SERIES_COLORS[1 + (index % (SERIES_COLORS.length - 1))]!;
}

function Detail({ o, settingKey, onClose }: { o: Overview; settingKey: string | null; onClose: () => void }) {
  const setting = settingKey ? o.settings.find((s) => s.key === settingKey) : undefined;
  if (!settingKey) return null;
  if (!setting)
    return (
      <Panel source="app" title={<span className="font-mono">{settingKey}</span>}>
        <p className="py-6 text-center text-sm text-muted-foreground">Not reported in this range.</p>
      </Panel>
    );
  let others = 0;
  const series = setting.daily.series.map((s) => {
    const isDefault = s.value === setting.currentDefault;
    const color = seriesColor(s.value, isDefault, isDefault || s.value === OTHER_VALUE ? 0 : others++);
    return { key: s.value, label: `${settingValueLabel(s.value)}${isDefault ? " (default)" : ""}`, values: s.values, color };
  });
  const colorOf = new Map(series.map((s) => [s.key, s.color]));
  return (
    <Panel
        source="app"
        title={<span className="font-mono">{setting.key}</span>}
        description={`Share of each day's reporting installs by value. Default ${settingValueLabel(setting.currentDefault)} as of ${setting.newestVersion ?? "the newest version"}${setting.daily.series.some((s) => s.value === OTHER_VALUE) ? "; values outside the top five are Other" : ""}.`}
        action={
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            Close
          </button>
        }
      >
      <div className="grid gap-5">
        <StackedAreaChart buckets={o.days} step="day" height={260} format={shareFormat} yFormat={percentTick} domain={[0, 1]} series={series} />
        <div className="grid gap-1">
          <span className="label-mono text-muted-foreground">By app version</span>
          <p className="text-xs text-muted-foreground">Each install's latest snapshot on that version, so a release that changes the default shows up as its own row.</p>
        </div>
        <DataTable
          dense
          rows={setting.versions}
          rowKey={(r) => r.version}
          limit={10}
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
                  {r.defaultChanged ? <Badge className="h-4 bg-[var(--chart-5)] px-1 text-[10px] text-white">new default</Badge> : null}
                </span>
              ),
            },
            { key: "default", header: "Default", sort: (r) => r.default, cell: (r) => <ValueChip value={r.default} isDefault /> },
            { key: "installs", header: "Installs", align: "right", sort: (r) => r.installs, cell: (r) => formatExact(r.installs) },
            { key: "onDefault", header: "On default", align: "right", sort: (r) => (r.installs ? r.onDefault / r.installs : -1), cell: (r) => formatPercent(r.installs ? r.onDefault / r.installs : null) },
            {
              key: "values",
              header: "Values",
              className: "w-[45%] min-w-40",
              cell: (r) => (
                <span className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted" title={r.values.map((v) => `${settingValueLabel(v.value)} ${formatPercent(v.installs / r.installs)}`).join(" · ")}>
                  {r.values.map((v) => (
                    <span key={v.value} className="h-full" style={{ width: `${(v.installs / r.installs) * 100}%`, backgroundColor: colorOf.get(v.value) ?? OTHER_COLOR }} />
                  ))}
                </span>
              ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}

const axisProps = { tickLine: false, axisLine: false, tick: { fontSize: 11 } } as const;

function TintCard({ t }: { t: Tint }) {
  if (!t.installs) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No one has tint with theme on in this range yet. The app starts sending settings from {SETTINGS_SINCE}, for people who share usage stats.
      </p>
    );
  }
  const histogram = t.histogram.map((b) => ({ bucket: `${b.from.toFixed(1)}–${b.to.toFixed(1)}`, installs: b.installs }));
  const mostPicked = histogram.reduce((a, b) => (b.installs > a.installs ? b : a));
  const weeks = t.weeks.map((w) => ({ t: w.week, median: w.median, installs: w.installs }));
  const config: ChartConfig = { installs: { label: "Installs", color: "var(--chart-4)" }, median: { label: "Median", color: "var(--chart-4)" } };
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        <Stat source="app" label="Median" value={amount(t.median)} sub={`of ${TINT_KEY}`} />
        <Stat source="app" label="Mean" value={amount(t.mean)} />
        <Stat source="app" label="Installs" value={formatExact(t.installs)} sub="tint with theme on" />
        <Stat source="app" label="Most picked" value={mostPicked.bucket} sub={`${formatPercent(mostPicked.installs / t.installs)} of them`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-2">
          <span className="label-mono text-muted-foreground">Installs by amount</span>
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 220 }}>
            <BarChart data={histogram} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="bucket" {...axisProps} interval={0} tickMargin={8} tickFormatter={(v: string) => v.split("–")[0]!} />
              <YAxis {...axisProps} width={40} allowDecimals={false} />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as (typeof histogram)[number] | undefined) : undefined;
                  if (!row) return null;
                  return (
                    <div className="grid gap-1 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                      <span className="label-mono text-muted-foreground">{row.bucket}</span>
                      <span>
                        <span className="font-semibold tnum">{formatExact(row.installs)}</span> <span className="text-muted-foreground">installs · {formatPercent(row.installs / t.installs)}</span>
                      </span>
                    </div>
                  );
                }}
              />
              <Bar dataKey="installs" fill="var(--color-installs)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </div>
        <div className="grid gap-2">
          <span className="label-mono text-muted-foreground">Median per week</span>
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 220 }}>
            <LineChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="t" {...axisProps} minTickGap={28} tickMargin={8} tickFormatter={(v: number) => formatTick(v, "day")} />
              <YAxis {...axisProps} width={40} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => v.toFixed(2)} />
              <ChartTooltip
                cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as (typeof weeks)[number] | undefined) : undefined;
                  if (!row) return null;
                  return (
                    <div className="grid gap-1 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                      <span className="label-mono text-muted-foreground">Week of {formatBucket(row.t, "day")}</span>
                      <span>
                        <span className="font-semibold tnum">{amount(row.median)}</span> <span className="text-muted-foreground">median · {formatExact(row.installs)} installs</span>
                      </span>
                    </div>
                  );
                }}
              />
              <Line dataKey="median" type="linear" stroke="var(--color-median)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-median)" }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </div>
      </div>
    </div>
  );
}
