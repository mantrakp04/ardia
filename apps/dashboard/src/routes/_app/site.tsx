import { Link, createFileRoute } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, CircleDot, Play } from "lucide-react";
import { BarList } from "@/components/bar-list";
import { Delta, PageHeader, Panel, Stat } from "@/components/blocks";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { Card } from "@/components/ui/card";
import { ChartSkeleton, ListSkeleton, Loaded, StatsSkeleton, TableSkeleton, useRange, useSection } from "@/components/section";
import type { SectionData } from "@/server/sections";
import { SourceBadge } from "@/components/source-badge";
import { compareLabel, compareSentence, rangeSentence } from "@/lib/compare";
import { formatAgo, formatExact, formatMs, formatPercent } from "@/lib/format";
import { windowFor } from "@/lib/range";
import { THRESHOLDS } from "@/lib/thresholds";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/site")({
  head: () => ({ meta: [{ title: "Site · Ardia" }] }),
  component: SitePage,
});

type Clicks = SectionData<"site.clicks">;
type FrictionData = SectionData<"site.friction">;

function SitePage() {
  const range = useRange();
  const w = windowFor(range);
  const compare = compareLabel(range);
  const traffic = useSection("site.traffic");
  const breakdowns = useSection("site.breakdowns");
  const clicks = useSection("site.clicks");
  const friction = useSection("site.friction");
  const experiment = useSection("site.experiment");
  const vitals = useSection("site.vitals");

  return (
    <>
      <PageHeader title="Site" description={`ardia.dev, from always-on, anonymous site analytics. ${rangeSentence(range)}${compareSentence(range)}. Times in UTC.`} />

      <Card className="relative px-4 py-4 shadow-none sm:px-5">
        <div className="absolute top-3 right-3"><SourceBadge source="site" /></div>
        <Loaded query={traffic} skeleton={<div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5"><StatsSkeleton count={5} /></div>}>
          {(d) => (
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "Visitors", ...d.kpis.visitors },
                { label: "Page views", ...d.kpis.pageviews },
                { label: "Sessions", ...d.kpis.sessions },
                { label: "Mac visitors", ...d.kpis.mac },
                { label: "Phone visitors", ...d.kpis.phones },
              ].map((s) => (
                <Stat
                  key={s.label}
                  label={s.label}
                  value={formatExact(s.value)}
                  delta={<Delta value={s.value} previous={s.previous} format="count" />}
                  sub={s.previous !== null ? <span className="tnum">vs {formatExact(s.previous)} {compare}</span> : null}
                />
              ))}
            </div>
          )}
        </Loaded>
      </Card>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-5">
        <Panel source="site" className="xl:col-span-3" title="Visitors over time" description={`Distinct visitors per ${w.step === "hour" ? "hour" : "day"}.`}>
          <Loaded query={traffic} skeleton={<ChartSkeleton height={260} legend />}>
            {(d) => <TimeSeriesChart buckets={d.window.buckets} series={d.trend} step={d.window.step} height={260} />}
          </Loaded>
        </Panel>
        <Panel source="site" className="xl:col-span-2" title="Where they clicked Download" description="Download clicks by the button's place on the page. The Mac funnel is on Funnels.">
          <Loaded query={clicks} skeleton={<ListSkeleton rows={6} />}>
            {(d) => <BarList items={d.locations} dimension="Location" valueLabel="People" secondaryLabel="Clicks" color="var(--chart-2)" limit={8} />}
          </Loaded>
        </Panel>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {(
          [
            ["pages", "Top pages", undefined, "Path", true, "var(--chart-1)", undefined],
            ["referrers", "Referrers", "Referring domain of each page view.", "Source", true, "var(--chart-1)", undefined],
            ["countries", "Countries", undefined, "Country", true, "var(--chart-1)", undefined],
            ["devices", "Devices", undefined, "Device", false, "var(--chart-4)", undefined],
            ["browsers", "Browsers", undefined, "Browser", false, "var(--chart-4)", undefined],
            ["utm", "Campaigns", "utm_source / medium / campaign, from the page or the session's entry.", "Source / medium / campaign", true, "var(--chart-1)", "No tagged traffic in this range"],
          ] as const
        ).map(([key, title, description, dimension, views, color, empty]) => (
          <Panel source="site" key={key} title={title} description={description}>
            <Loaded query={breakdowns} skeleton={<ListSkeleton />}>
              {(d) => <BarList items={d[key]} dimension={dimension} secondaryLabel={views ? "Views" : undefined} color={color} empty={empty} />}
            </Loaded>
          </Panel>
        ))}
      </div>

      <Panel
        source={["site", "replay"]}
        title="Rage and dead clicks"
        description={`Rage clicks, dead clicks and dead swipes by element and page, per 100 visitors of that page. A click followed by a tracked event within ${THRESHOLDS.frictionWindowMs / 1000} s did something, so it's left out.`}
      >
        <Loaded query={friction} skeleton={<TableSkeleton rows={8} columns={7} />}>
          {(d) => <Friction data={d} />}
        </Loaded>
      </Panel>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <Panel source="site" title="Clicks" description={`Tracked clicks. Change compares people with ${compare || "the period before"}.`}>
          <Loaded query={clicks} skeleton={<TableSkeleton rows={8} columns={4} />}>
            {(d) => <ClicksTable rows={d.clicks} />}
          </Loaded>
        </Panel>
        <Panel source="site" title="Experiment: download-band" description="Mac visitors exposed to each variant in the range, and how many clicked Download after exposure. Stop at 300+ per variant and 7+ days.">
          <Loaded query={experiment} skeleton={<TableSkeleton rows={2} columns={5} />}>
            {(d) => <Experiment data={d} />}
          </Loaded>
        </Panel>
      </div>

      <Panel source="site" title="Web vitals" description="75th percentile of real visits in the range, against Google's thresholds.">
        <Loaded query={vitals} skeleton={<div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4"><StatsSkeleton count={4} /></div>}>
          {(d) => <Vitals rows={d} />}
        </Loaded>
      </Panel>
    </>
  );
}

function Vitals({ rows }: { rows: SectionData<"site.vitals"> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
      {rows.map((v) => {
        const rating = v.samples === 0 ? null : v.p75 <= v.good ? "good" : v.p75 <= v.poor ? "needs work" : "poor";
        const Icon = rating === "good" ? CircleCheck : rating === "poor" ? CircleAlert : CircleDot;
        return (
          <Stat
            key={v.key}
            label={`${v.key} · ${v.label}`}
            value={v.samples === 0 ? "–" : v.unit === "ms" ? formatMs(v.p75) : v.p75.toFixed(3)}
            sub={
              <span className="flex items-center gap-1.5">
                {rating ? (
                  <span className={cn("inline-flex items-center gap-1 font-medium", rating === "good" ? "text-good" : rating === "poor" ? "text-bad" : "text-amber-600 dark:text-amber-400")}>
                    <Icon className="size-3.5" aria-hidden />
                    {rating}
                  </span>
                ) : null}
                <span className="tnum">{formatExact(v.samples)} samples</span>
              </span>
            }
          />
        );
      })}
    </div>
  );
}

function ClicksTable({ rows }: { rows: Clicks["clicks"] }) {
  return (
    <DataTable
      dense
      rows={rows.filter((r) => r.count > 0 || (r.previousCount ?? 0) > 0)}
      rowKey={(r) => r.key}
      initialSort={{ key: "people", desc: true }}
      columns={[
        { key: "label", header: "Click", sort: (r) => r.label, cell: (r) => r.label },
        { key: "people", header: "People", align: "right", sort: (r) => r.people, cell: (r) => <span className="font-medium">{formatExact(r.people)}</span> },
        { key: "count", header: "Clicks", align: "right", sort: (r) => r.count, cell: (r) => formatExact(r.count) },
        {
          key: "delta",
          header: "Change",
          align: "right",
          sort: (r) => (r.previousPeople ? r.people / r.previousPeople : r.people),
          cell: (r) => <Delta value={r.people} previous={r.previousPeople} format="count" goodWhenUp={!r.key.startsWith("$")} />,
        },
      ]}
    />
  );
}

function Experiment({ data }: { data: SectionData<"site.experiment"> }) {
  const exposedMin = Math.min(...data.variants.map((v) => v.exposed), Number.POSITIVE_INFINITY);
  const ready = data.variants.length >= 2 && exposedMin >= 300;
  return (
    <>
      <DataTable
        dense
        rows={data.variants}
        rowKey={(r) => r.variant}
        empty="No exposures in this range"
        columns={[
          { key: "variant", header: "Variant", cell: (r) => <span className="font-medium">{r.variant}</span> },
          { key: "exposed", header: "Exposed", align: "right", sort: (r) => r.exposed, cell: (r) => formatExact(r.exposed) },
          { key: "clicked", header: "Clicked", align: "right", sort: (r) => r.clicked, cell: (r) => formatExact(r.clicked) },
          { key: "rate", header: "Rate", align: "right", sort: (r) => (r.exposed ? r.clicked / r.exposed : 0), cell: (r) => <span className="font-semibold">{formatPercent(r.exposed ? r.clicked / r.exposed : null)}</span> },
          { key: "band", header: "Band clicks", align: "right", sort: (r) => r.bandClicks, cell: (r) => formatExact(r.bandClicks) },
        ]}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        {data.pValue === null ? "Not enough data for a test yet." : <>Two-sided p = <span className="font-medium text-foreground tnum">{data.pValue.toFixed(3)}</span>. </>}
        {ready ? "Both variants have 300+ exposures." : "Still under 300 exposures per variant, so don't call it yet."}
      </p>
    </>
  );
}

function Friction({ data }: { data: FrictionData }) {
  const rate = (n: number | null) => (n === null ? "–" : n.toFixed(n >= 10 ? 0 : 1));
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,15rem)_1fr]">
        <div className="grid grid-cols-2 content-start gap-x-4 gap-y-5 lg:grid-cols-1">
          <Stat label="People hit one" value={formatExact(data.people)} sub={`${rate(data.visitors ? (100 * data.people) / data.visitors : null)} per 100 visitors`} />
          <Stat label="Left out" value={formatExact(data.explained)} sub={`of ${formatExact(data.events + data.explained)} events led to a tracked click`} />
        </div>
        <div className="min-w-0">
          <div className="mb-2 label-mono text-muted-foreground">People per 100 visitors, per {data.window.step}</div>
          <TimeSeriesChart buckets={data.window.buckets} step={data.window.step} height={170} format={(n) => n.toFixed(1)} series={[{ key: "rate", label: "Per 100 visitors", values: data.series, color: "var(--chart-3)" }]} />
        </div>
      </div>
      <DataTable
        dense
        rows={data.spots}
        rowKey={(r) => `${r.kind}|${r.text}|${r.path}`}
        initialSort={{ key: "people", desc: true }}
        limit={12}
        empty="No rage or dead clicks in this range"
        columns={[
          {
            key: "kind",
            header: "Kind",
            sort: (r) => r.kind,
            cell: (r) => <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", r.kind === "Rage" ? "bg-bad/12 text-bad" : "bg-muted text-muted-foreground")}>{r.kind}</span>,
          },
          { key: "text", header: "Element", sort: (r) => r.text, cell: (r) => <span className="line-clamp-1 max-w-64 break-all">{r.text || <span className="text-muted-foreground">no text</span>}</span> },
          { key: "path", header: "Page", sort: (r) => r.path, cell: (r) => <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{r.path}</span> },
          { key: "people", header: "People", align: "right", sort: (r) => r.people, cell: (r) => <span className="font-medium">{formatExact(r.people)}</span> },
          {
            key: "rate",
            header: "Per 100",
            align: "right",
            sort: (r) => r.rate ?? -1,
            cell: (r) => (
              <span className="inline-flex items-center gap-1.5">
                {r.previousRate !== null && r.rate !== null && r.previousPeople ? <Delta value={r.rate} previous={r.previousRate} format="count" goodWhenUp={false} /> : null}
                {rate(r.rate)}
              </span>
            ),
          },
          { key: "count", header: "Events", align: "right", sort: (r) => r.count, cell: (r) => formatExact(r.count) },
          { key: "explained", header: "Left out", align: "right", sort: (r) => r.explained, cell: (r) => <span className="text-muted-foreground">{formatExact(r.explained)}</span> },
          {
            key: "replay",
            header: "Replay",
            align: "right",
            cell: (r) =>
              r.session ? (
                <Link to="/replays/$sessionId" params={{ sessionId: r.session }} className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-primary hover:underline">
                  <Play className="size-3" aria-hidden />
                  {formatAgo(r.lastSeen)}
                </Link>
              ) : (
                <span className="text-muted-foreground">–</span>
              ),
          },
        ]}
      />
      {data.hidden > 0 ? <p className="text-xs text-muted-foreground">{formatExact(data.hidden)} smaller spots aren't listed.</p> : null}
    </div>
  );
}
