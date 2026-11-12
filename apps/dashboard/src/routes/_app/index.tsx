import { createFileRoute } from "@tanstack/react-router";
import { Delta, PageHeader, Stat } from "@/components/blocks";
import { Loaded, StatsSkeleton, useRange, useSection } from "@/components/section";
import { AttentionBoard } from "@/components/attention-board";
import { Card } from "@/components/ui/card";
import { compareLabel } from "@/lib/compare";
import { formatExact, formatPercent } from "@/lib/format";
import type { SectionData } from "@/server/sections";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Needs attention · Ardia" }] }),
  component: Overview,
});
type Attention = SectionData<"attention">;
function Overview() {
  const data = useSection("attention");
  return <>
    <PageHeader title="Needs attention" description="A quick look at what needs you. Open a card for the report. Pin it to track a goal." />
    <Loaded query={data} skeleton={<p className="p-8 text-sm text-muted-foreground">Loading tasks…</p>}>
      {(d) => <AttentionBoard items={d.items} />}
    </Loaded>
    <details className="rounded-xl border bg-card px-4 py-3"><summary className="cursor-pointer text-sm text-muted-foreground">Key numbers</summary><div className="mt-4"><Kpis data={data.data} loading={data.isLoading} /></div></details>
  </>;
}

function Kpis({ data, loading }: { data: Attention | undefined; loading: boolean }) {
  const range = useRange();
  const compare = compareLabel(range);
  const k = data?.kpis;
  return (
    <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 xl:grid-cols-6">
      {loading || !k ? (
        <StatsSkeleton count={6} />
      ) : (
        <>
          <Stat
            source="daily"
            label="Daily active, counted"
            value={k.daily ? formatExact(k.daily.dau) : "–"}
            sub={k.daily ? `yesterday · of about ${formatExact(k.daily.totalLow)}–${formatExact(k.daily.totalHigh)} running` : "no complete day yet"}
          />
          <Stat
            source="daily"
            label="Daily count covers"
            value={k.daily ? `${Math.round(k.daily.coverageLow * 100)}–${Math.round(k.daily.coverageHigh * 100)}%` : "–"}
            sub={k.dailySince ? `only ${k.dailySince}+ sends it` : undefined}
          />
          <Stat
            source={["daily", "feed"]}
            label="New installs"
            value={k.installs ? formatExact(k.installs.newInstalls.value) : "–"}
            sub={k.installs ? `${formatExact(k.installs.firstLaunches.value)} first launches (update checks)` : undefined}
          />
          <Stat
            source="site"
            label="Mac download rate"
            value={formatPercent(k.macRate?.value)}
            delta={k.macRate ? <Delta value={k.macRate.value} previous={k.macRate.previous} format="percent" /> : null}
            sub={k.macRate?.previous != null ? `vs ${formatPercent(k.macRate.previous)} ${compare}` : undefined}
          />
          <Stat
            source="app"
            label="D1 retention, opted-in"
            value={formatPercent(k.d1?.value, 0)}
            sub={k.d1 ? `${k.d1.cohorts} cohorts, ${formatExact(k.d1.people)} people` : undefined}
          />
          <Stat
            source="app"
            label={k.unclean ? `Unclean exits, ${k.unclean.version}` : "Unclean exits"}
            value={formatPercent(k.unclean?.value)}
            delta={k.unclean ? <Delta value={k.unclean.value} previous={k.unclean.previous} format="percent" goodWhenUp={false} /> : null}
            sub={k.unclean?.previousVersion ? `vs ${formatPercent(k.unclean.previous)} on ${k.unclean.previousVersion}` : undefined}
          />
        </>
      )}
    </Card>
  );
}
