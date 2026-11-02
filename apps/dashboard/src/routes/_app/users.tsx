import { createFileRoute } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { BarList } from "@/components/bar-list";
import { Delta, PageHeader, Panel, Stat } from "@/components/blocks";
import { CoverageChart, OTHER_COLOR, SERIES_COLORS, StackedAreaChart, TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { ChartSkeleton, ListSkeleton, Loaded, StatsSkeleton, TableSkeleton, useRange, useSection } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { compareLabel, rangeSentence } from "@/lib/compare";
import { formatAgo, formatDate, formatExact, formatPercent } from "@/lib/format";
import { THRESHOLDS } from "@/lib/thresholds";
import type { SectionData } from "@/server/sections";

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "Users · Ardia" }] }),
  component: UsersPage,
});

type Active = SectionData<"users.active">;

const percentTick = (n: number) => `${Math.round(n * 100)}%`;
const shareFormat = (n: number) => formatPercent(n, 1);

function UsersPage() {
  const range = useRange();
  const compare = compareLabel(range);
  const active = useSection("users.active");
  const versions = useSection("users.versions");
  const optedIn = useSection("users.optedIn");
  const usage = useSection("users.usage");
  const markers = versions.data?.markers;

  return (
    <>
      <PageHeader
        title="Users"
        description={`How many copies run and where they come from. ${rangeSentence(range)}, by UTC day. The daily count and update checks are always on and anonymous; usage below is opt-in.`}
      />

      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 xl:grid-cols-6">
        <Loaded query={active} skeleton={<StatsSkeleton count={5} />} className="contents">
          {(a) => <ActiveStats a={a} />}
        </Loaded>
        <Loaded query={optedIn} skeleton={<StatsSkeleton count={1} />} className="contents">
          {(o) => (
            <Stat
              source="app"
              label="Opted-in users"
              value={formatExact(o.value)}
              delta={<Delta value={o.value} previous={o.previous} format="count" />}
              sub={o.previous !== null ? `vs ${formatExact(o.previous)} ${compare}` : "in the range"}
            />
          )}
        </Loaded>
      </Card>

      <Loaded query={active} skeleton={null}>
        {(a) => <CoverageNote a={a} />}
      </Loaded>

      <Panel source={["daily", "feed"]} title="Copies running per day" description="The line is what the daily count measured. The band adds copies on versions that don't send it, from their update checks: each running copy checks 1–3 times a day.">
        <Loaded query={active} skeleton={<ChartSkeleton height={280} legend />}>
          {(a) => <CoverageChart days={a.days} measured={a.measured} low={a.totalLow} high={a.totalHigh} coverage={a.coverage} markers={markers} />}
        </Loaded>
      </Panel>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <Panel source={["daily", "feed"]} title="New installs" description="New installs from the daily count (its first ping) next to first launches from update checks, which every version sends.">
          <Loaded query={active} skeleton={<ChartSkeleton height={230} legend />}>
            {(a) => (
              <TimeSeriesChart
                buckets={a.days}
                step="day"
                height={230}
                area={false}
                markers={markers}
                series={[
                  { key: "first", label: "First launches (update checks)", values: a.firstLaunches, color: "var(--chart-3)", source: "feed" },
                  { key: "new", label: "New installs (daily count)", values: a.newInstalls, color: "var(--chart-1)", source: "daily" },
                ]}
              />
            )}
          </Loaded>
        </Panel>
        <Panel source="app" title="Opted-in users" description="Distinct installs sending opt-in telemetry. Sharing is off by default, so this is a sample.">
          <Loaded query={optedIn} skeleton={<ChartSkeleton height={230} />}>
            {(o) => <TimeSeriesChart buckets={o.window.buckets} step={o.window.step} height={230} series={[{ key: "opted", label: "Opted-in users", values: o.series, color: "var(--chart-4)" }]} />}
          </Loaded>
        </Panel>
      </div>

      <Loaded query={active} skeleton={<div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Card key={i} className="p-5 shadow-none"><ListSkeleton rows={4} /></Card>)}</div>}>
        {(a) => <Splits a={a} />}
      </Loaded>

      <Panel source={["feed", "github"]} title="Version adoption" description="Share of each day's update checks by the version making them, with stable releases marked. Nightlies and versions outside the five busiest are grouped.">
        <Loaded query={versions} skeleton={<ChartSkeleton height={280} legend />}>
          {(v) => (
            <StackedAreaChart
              buckets={v.days}
              step="day"
              height={280}
              format={shareFormat}
              yFormat={percentTick}
              domain={[0, 1]}
              markers={v.markers}
              series={v.adoption.map((s, i) => ({ ...s, color: s.key === "older" ? OTHER_COLOR : s.key === "nightly" ? "var(--chart-6)" : SERIES_COLORS[i] }))}
            />
          )}
        </Loaded>
      </Panel>

      <Panel
        source={["github", "feed", "daily"]}
        title="Releases"
        description="Day 1, 3 and 7: the share of that channel's update checks on the release or newer, that many days after it was published. Counted: copies the daily count saw on it yesterday."
      >
        <Loaded query={versions} skeleton={<TableSkeleton rows={10} columns={9} />}>
          {(v) => <ReleasesTable data={v} />}
        </Loaded>
      </Panel>

      <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold tracking-[-0.015em]">What opted-in users do</h2>
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <Panel source="app" title="Session length" description="From the session-ended event.">
          <Loaded query={usage} skeleton={<ListSkeleton />}>{(u) => <BarList items={u.sessionLengths} dimension="Length" valueLabel="Sessions" color="var(--chart-4)" />}</Loaded>
        </Panel>
        <Panel source="app" title="Settings sections opened">
          <Loaded query={usage} skeleton={<ListSkeleton />}>{(u) => <BarList items={u.sections} dimension="Section" valueLabel="Users" secondaryLabel="Opens" color="var(--chart-4)" />}</Loaded>
        </Panel>
        <Panel source="app" title="Omnibox suggestions chosen">
          <Loaded query={usage} skeleton={<ListSkeleton />}>{(u) => <BarList items={u.suggestions} dimension="Type" valueLabel="Users" secondaryLabel="Picks" color="var(--chart-4)" />}</Loaded>
        </Panel>
      </div>
      <div className="grid gap-3 sm:gap-4 xl:grid-cols-5">
        <Panel source="app" className="xl:col-span-3" title="Events" description="Everything the app sent in the range.">
          <Loaded query={usage} skeleton={<TableSkeleton rows={8} columns={4} />}>
            {(u) => (
              <DataTable
                dense
                rows={u.events}
                rowKey={(r) => r.key}
                initialSort={{ key: "count", desc: true }}
                limit={10}
                columns={[
                  {
                    key: "label",
                    header: "Event",
                    sort: (r) => r.label,
                    cell: (r) => (
                      <span className="grid">
                        <span>{r.label}</span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">{r.key}</span>
                      </span>
                    ),
                  },
                  { key: "count", header: "Count", align: "right", sort: (r) => r.count, cell: (r) => <span className="font-medium">{formatExact(r.count)}</span> },
                  { key: "people", header: "Users", align: "right", sort: (r) => r.people, cell: (r) => formatExact(r.people) },
                  { key: "last", header: "Last", align: "right", sort: (r) => r.lastSeen, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatAgo(r.lastSeen)}</span> },
                ]}
              />
            )}
          </Loaded>
        </Panel>
        <Panel source="app" className="xl:col-span-2" title="Updates" description="From version → to version, as the app reported after updating.">
          <Loaded query={usage} skeleton={<TableSkeleton rows={8} columns={3} />}>
            {(u) => (
              <DataTable
                dense
                rows={u.updates}
                rowKey={(r) => `${r.from}>${r.to}`}
                initialSort={{ key: "count", desc: true }}
                limit={10}
                empty="No updates in this range"
                columns={[
                  {
                    key: "path",
                    header: "Update",
                    sort: (r) => r.to,
                    cell: (r) => (
                      <span className="font-mono text-[11.5px] whitespace-nowrap">
                        {r.from} <span className="text-muted-foreground">→</span> {r.to}
                      </span>
                    ),
                  },
                  { key: "count", header: "Count", align: "right", sort: (r) => r.count, cell: (r) => formatExact(r.count) },
                  { key: "people", header: "Users", align: "right", sort: (r) => r.people, cell: (r) => formatExact(r.people) },
                ]}
              />
            )}
          </Loaded>
        </Panel>
      </div>
    </>
  );
}

const coverageText = (c: { coverageLow: number; coverageHigh: number }) => `${Math.round(c.coverageLow * 100)}–${Math.round(c.coverageHigh * 100)}%`;

function ActiveStats({ a }: { a: Active }) {
  const y = a.yesterday;
  const full = !!y && y.coverageLow >= THRESHOLDS.coverageFull;
  return (
    <>
      <Stat source="daily" label="Daily active, counted" value={y ? formatExact(y.dau) : "–"} sub={`yesterday${a.today ? ` · ${formatExact(a.today.dau)} today so far` : ""}`} />
      <Stat source={["daily", "feed"]} label="Running yesterday, est." value={y ? `${formatExact(y.totalLow)}–${formatExact(y.totalHigh)}` : "–"} sub={y ? `${formatExact(y.silentLow)}–${formatExact(y.silentHigh)} on versions without the count` : undefined} />
      <Stat source={["daily", "feed"]} label="Count covers" value={y ? coverageText(y) : "–"} sub={`of copies, ${a.dailySince}+ only`} />
      <Stat
        source="daily"
        label="Weekly active, counted"
        value={formatExact(a.wau.value)}
        sub={full ? `vs ${formatExact(a.wau.previous)} last week` : `since ${formatDate(a.wau.since)} · not comparable with last week yet`}
      />
      <Stat source="daily" label="Monthly active, counted" value={formatExact(a.mau.value)} sub={`since ${formatDate(a.mau.since)}${full ? "" : " · rises as copies update"}`} />
    </>
  );
}

function CoverageNote({ a }: { a: Active }) {
  const y = a.yesterday;
  if (!y || y.coverageLow >= THRESHOLDS.coverageFull) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm sm:px-5">
      <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
      <p className="text-foreground/85">
        Only {a.dailySince} and later send the daily count, and it saw {coverageText(y)} of the copies running yesterday. Until older versions are gone, a rise in daily, weekly or
        monthly actives is mostly copies updating, not new users, so don't read a period's trend as growth. The split below leans nightly (
        {formatPercent(a.nightlyShare, 0)} yesterday) because nightly users update first.
      </p>
    </div>
  );
}

function Splits({ a }: { a: Active }) {
  const day = a.splits.day ? formatDate(a.splits.day) : "yesterday";
  const lists = [
    { key: "version", title: "Version", items: a.splits.version, dimension: "Version" },
    { key: "channel", title: "Channel", items: a.splits.channel, dimension: "Channel" },
    { key: "os", title: "macOS", items: a.splits.os, dimension: "Version" },
    { key: "arch", title: "Chip", items: a.splits.arch, dimension: "Chip" },
  ];
  return (
    <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
      {lists.map((l) => (
        <Panel key={l.key} source="daily" title={l.title} description={`Copies counted on ${day}.`}>
          <BarList items={l.items} dimension={l.dimension} valueLabel="Copies" color="var(--chart-1)" limit={6} empty="No complete day counted yet" />
        </Panel>
      ))}
    </div>
  );
}

function ReleasesTable({ data }: { data: SectionData<"users.versions"> }) {
  const share = (n: number | null | undefined) => (n == null ? <span className="text-muted-foreground">–</span> : formatPercent(n, 0));
  return (
    <>
      <DataTable
        dense
        rows={data.versions}
        rowKey={(r) => r.version}
        limit={15}
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
          { key: "published", header: "Published", sort: (r) => r.published ?? "", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.published ? formatDate(r.published) : "–"}</span> },
          { key: "dmg", header: "DMG", align: "right", sort: (r) => r.dmg ?? -1, cell: (r) => (r.dmg === null ? "–" : formatExact(r.dmg)) },
          { key: "first", header: "First launches", align: "right", sort: (r) => r.first, cell: (r) => <span className="font-medium">{formatExact(r.first)}</span> },
          { key: "d1", header: "Day 1", align: "right", sort: (r) => r.adoption?.[0] ?? -1, cell: (r) => share(r.adoption?.[0]) },
          { key: "d3", header: "Day 3", align: "right", sort: (r) => r.adoption?.[1] ?? -1, cell: (r) => share(r.adoption?.[1]) },
          { key: "d7", header: "Day 7", align: "right", sort: (r) => r.adoption?.[2] ?? -1, cell: (r) => share(r.adoption?.[2]) },
          { key: "checks", header: "Checks yday", align: "right", sort: (r) => r.checksYesterday, cell: (r) => formatExact(r.checksYesterday) },
          {
            key: "counted",
            header: "Counted yday",
            align: "right",
            sort: (r) => r.countedYesterday ?? -1,
            cell: (r) => (r.countedYesterday === null ? <span className="text-muted-foreground">no count</span> : formatExact(r.countedYesterday)),
          },
          { key: "last", header: "Last check", align: "right", sort: (r) => r.lastSeen, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.lastSeen ? formatDate(r.lastSeen) : "–"}</span> },
        ]}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        All time since 0.2.14: {formatExact(data.allTime.dmg)} stable DMG downloads and {formatExact(data.allTime.first)} first launches. A download isn't an install.
        {data.nightlyRelease ? ` The rolling nightly build has ${formatExact(data.nightlyRelease.dmg)} DMG downloads.` : ""}
        {data.githubError ? <span className="text-bad"> GitHub: {data.githubError}</span> : null}
      </p>
    </>
  );
}
