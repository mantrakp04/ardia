import { createFileRoute } from "@tanstack/react-router";
import { BarList } from "@/components/bar-list";
import { Funnel, PageHeader, Panel, Stat } from "@/components/blocks";
import { ListSkeleton, Loaded, TableSkeleton, useRange, useSection } from "@/components/section";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { compareSentence, rangeSentence } from "@/lib/compare";
import { formatDate, formatExact, formatPercent } from "@/lib/format";
import { THRESHOLDS } from "@/lib/thresholds";
import { cn } from "@/lib/utils";
import type { SectionData } from "@/server/sections";

export const Route = createFileRoute("/_app/funnels")({
  head: () => ({ meta: [{ title: "Funnels · Ardia" }] }),
  component: FunnelsPage,
});

type Site = SectionData<"funnels.site">;

function FunnelsPage() {
  const range = useRange();
  const site = useSection("funnels.site");
  const installs = useSection("funnels.installs");
  const retention = useSection("funnels.retention");

  return (
    <>
      <PageHeader
        title="Funnels"
        description={`Distinct people at each step. ${rangeSentence(range)}${compareSentence(range)}: the badge beside a step is its conversion against the period before. Site steps are always on; retention is opt-in.`}
      />

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <Panel title="Mac: visit to running" description="Mac desktop visitors, those of them who clicked Download, then installs from update checks and opted-in people seen for the first time.">
          <Loaded query={site} skeleton={<ListSkeleton rows={4} />}>
            {(s) => (
              <Funnel
                steps={[
                  { key: "mac", label: "Mac visitors", value: s.current.macVisitors, previous: s.previous?.macVisitors, source: "site" },
                  { key: "click", label: "Clicked Download", value: s.current.macClickers, previous: s.previous?.macClickers, source: "site" },
                  { key: "first", label: "First launches", value: installs.data?.firstLaunches ?? null, previous: installs.data?.previousFirstLaunches, source: "feed" },
                  { key: "opted", label: "Opted in, first seen", value: retention.data?.newOptedIn ?? null, source: "app" },
                ]}
                note={
                  installs.data ? (
                    <>
                      First launches include copies downloaded from GitHub directly. All time since 0.2.14:{" "}
                      <span className="font-medium text-foreground tnum">{formatExact(installs.data.allTime.dmg)}</span> stable DMG downloads,{" "}
                      <span className="font-medium text-foreground tnum">{formatExact(installs.data.allTime.first)}</span> first launches (
                      {formatPercent(installs.data.allTime.dmg ? installs.data.allTime.first / installs.data.allTime.dmg : null, 0)}).
                    </>
                  ) : undefined
                }
              />
            )}
          </Loaded>
        </Panel>

        <Panel source="app" title="Retention" description="Opted-in installs by the day they were first seen: the share active again exactly 1, 3 and 7 days later (launch, memory sample or usage count).">
          <Loaded query={retention} skeleton={<TableSkeleton rows={7} columns={5} />}>
            {(r) => <Cohorts data={r} />}
          </Loaded>
        </Panel>
      </div>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <Panel source="site" title="Phones: Send to my Mac" description="Phone visitors can't install, so the page offers to send the link to their Mac. People who did each at least once.">
          <Loaded query={site} skeleton={<ListSkeleton rows={4} />}>
            {(s) => <Phones s={s} />}
          </Loaded>
        </Panel>
        <Panel source="site" title="Demo: customize to download" description="The interactive demo on the landing page: people who customized it, saw the setup code, copied it, and clicked Download.">
          <Loaded query={site} skeleton={<ListSkeleton rows={4} />}>
            {(s) => (
              <Funnel
                steps={[
                  { key: "customize", label: "Customized the demo", value: s.current.demoCustomize, previous: s.previous?.demoCustomize },
                  { key: "shown", label: "Saw the setup code", value: s.current.demoShown, previous: s.previous?.demoShown },
                  { key: "copied", label: "Copied the setup code", value: s.current.demoCopied, previous: s.previous?.demoCopied },
                ]}
                note={
                  <>
                    <span className="font-medium text-foreground tnum">{formatExact(s.current.demoDownload)}</span> of the {formatExact(s.current.demoCustomize)} who customized also clicked Download (
                    {formatPercent(s.current.demoCustomize ? s.current.demoDownload / s.current.demoCustomize : null, 0)}), in either order.
                  </>
                }
              />
            )}
          </Loaded>
        </Panel>
      </div>
    </>
  );
}

function Phones({ s }: { s: Site }) {
  const c = s.current;
  const p = s.previous;
  return (
    <div className="grid gap-5">
      <Funnel
        steps={[
          { key: "phones", label: "Phone visitors", value: c.phoneVisitors, previous: p?.phoneVisitors },
          { key: "tap", label: "Tapped Send to my Mac", value: c.tappers, previous: p?.tappers },
          { key: "sent", label: "Shared or copied the link", value: c.succeeded, previous: p?.succeeded },
        ]}
      />
      <div className="grid grid-cols-2 gap-3 border-y py-4">
        <Stat label="Cancelled the sheet" value={formatPercent(c.tappers ? c.cancelled / c.tappers : null, 0)} sub={`${formatExact(c.cancelled)} of ${formatExact(c.tappers)} tappers`} />
        <Stat label="Macs opened a link" value={formatExact(c.macLinks)} sub="from sent links, in the range" />
      </div>
      <BarList
        dimension="Outcome, at least once"
        valueLabel="People"
        shareOf={c.tappers}
        color="var(--chart-3)"
        items={[
          { key: "cancelled", label: "Cancelled the share sheet", value: c.cancelled },
          { key: "shared", label: "Shared", value: c.shared },
          { key: "copied", label: "Copied the link", value: c.copied },
          { key: "blocked", label: "Share blocked", value: c.blocked },
          { key: "failed", label: "Share failed", value: c.failed },
        ].filter((x) => x.value > 0)}
        empty="No taps in this range"
      />
    </div>
  );
}

function Cohorts({ data }: { data: SectionData<"funnels.retention"> }) {
  const rows = data.cohorts.filter((c) => c.size > 0).reverse();
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">No new opted-in installs in this range</p>;
  const weighted = (k: "d1" | "d3" | "d7") => {
    const ready = rows.filter((c) => c[k] !== null);
    const size = ready.reduce((s, c) => s + c.size, 0);
    return size ? ready.reduce((s, c) => s + c[k]!, 0) / size : null;
  };
  const cell = (value: number | null, size: number) => {
    if (value === null) return <span className="text-muted-foreground/60">…</span>;
    const rate = size ? value / size : 0;
    return (
      <Tooltip delayDuration={80}>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex h-7 w-full min-w-12 items-center justify-end rounded-[5px] px-2 tnum outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            style={{ backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(rate * 55)}%, transparent)` }}
          >
            {formatPercent(rate, 0)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <span className="font-semibold tnum">{formatExact(value)}</span> of {formatExact(size)} came back
        </TooltipContent>
      </Tooltip>
    );
  };
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm tnum">
        <thead>
          <tr className="label-mono text-muted-foreground">
            <th className="h-8 text-left font-normal">First seen</th>
            <th className="text-right font-normal">People</th>
            <th className="w-[18%] text-right font-normal">D1</th>
            <th className="w-[18%] text-right font-normal">D3</th>
            <th className="w-[18%] text-right font-normal">D7</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-1.5 font-medium">All cohorts</td>
            <td className="text-right font-medium">{formatExact(rows.reduce((s, c) => s + c.size, 0))}</td>
            {(["d1", "d3", "d7"] as const).map((k) => (
              <td key={k} className="py-1 pl-1 text-right font-semibold">
                {formatPercent(weighted(k), 0)}
              </td>
            ))}
          </tr>
          {rows.map((c) => (
            <tr key={c.day} className={cn(c.size < THRESHOLDS.minCohort && "opacity-55")}>
              <td className="py-0.5 whitespace-nowrap">{formatDate(c.day)}</td>
              <td className="text-right">{formatExact(c.size)}</td>
              <td className="py-0.5 pl-1">{cell(c.d1, c.size)}</td>
              <td className="py-0.5 pl-1">{cell(c.d3, c.size)}</td>
              <td className="py-0.5 pl-1">{cell(c.d7, c.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Faded rows have under {THRESHOLDS.minCohort} people. … means the day hasn't finished yet. First seen is when sharing started, which is install day for people who opt in during
        onboarding.
      </p>
    </div>
  );
}
