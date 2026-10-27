import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { Delta, PageHeader, Stat } from "@/components/blocks";
import { Loaded, StatsSkeleton, useRange, useSection } from "@/components/section";
import { SourceBadges, type Source } from "@/components/source-badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { compareLabel, compareSentence, rangeSentence } from "@/lib/compare";
import { formatExact, formatPercent } from "@/lib/format";
import { RULES } from "@/lib/thresholds";
import { cn } from "@/lib/utils";
import type { SectionData } from "@/server/sections";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Needs attention · Ardia" }] }),
  component: Overview,
});

type Attention = SectionData<"attention">;
type Item = Attention["items"][number];

const PAGE_LABEL: Record<Item["to"], string> = {
  "/users": "Users",
  "/funnels": "Funnels",
  "/health": "Health",
  "/performance": "Performance",
  "/site": "Site",
  "/errors": "Errors",
};

const RULE_SOURCE: Record<Item["rule"], Source[]> = {
  coverage: ["daily", "feed"],
  "crash-new": ["app"],
  "crash-rate": ["app"],
  unclean: ["app"],
  perf: ["app"],
  "first-launch": ["app"],
  funnel: ["site"],
  retention: ["app"],
  friction: ["site"],
  errors: ["site", "app"],
  unavailable: [],
};

const SEVERITY = {
  high: { icon: OctagonAlert, label: "Fix", tone: "text-bad bg-bad/10" },
  medium: { icon: TriangleAlert, label: "Look", tone: "text-amber-700 bg-amber-500/12 dark:text-amber-300" },
  low: { icon: Info, label: "Know", tone: "text-muted-foreground bg-muted" },
} as const;

function Overview() {
  const range = useRange();
  const data = useSection("attention");
  return (
    <>
      <PageHeader
        title="Needs attention"
        description={`${rangeSentence(range)}${compareSentence(range)}, worked out from every page. Ranked by how much it needs a fix: crashes and exits first, then regressions, funnels and the site. Times in UTC.`}
      />
      <Kpis data={data.data} loading={data.isLoading} />
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <Loaded query={data} skeleton={<ItemsSkeleton />}>
          {(d) => (d.items.length ? <ul className="divide-y">{d.items.map((item) => <AttentionRow key={item.key} item={item} />)}</ul> : <AllClear />)}
        </Loaded>
      </Card>
      <details className="group rounded-xl border bg-card/60 px-4 py-3 text-sm sm:px-5">
        <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground select-none hover:text-foreground">
          <span className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            What puts something on this list
          </span>
        </summary>
        <ul className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
          {RULES.map((r) => (
            <li key={r.key} className="flex gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              {r.text}.
            </li>
          ))}
          <li className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            Newest and previous stable are the two highest stable versions with enough data in the range. Nightlies are compared on their own.
          </li>
        </ul>
      </details>
    </>
  );
}

function AttentionRow({ item }: { item: Item }) {
  const look = SEVERITY[item.severity];
  const Icon = look.icon;
  return (
    <li>
      <Link
        to={item.to}
        search={(prev) => ({ range: prev.range })}
        className="group grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3.5 outline-none hover:bg-accent/40 focus-visible:bg-accent/50 sm:gap-4 sm:px-5"
      >
        <span className={cn("mt-0.5 inline-flex h-6 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-semibold sm:w-[3.75rem] sm:justify-start", look.tone)}>
          <Icon className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{look.label}</span>
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium tracking-[-0.005em]">{item.title}</span>
            <SourceBadges source={item.origin ?? RULE_SOURCE[item.rule]} />
          </span>
          <span className="text-sm break-words text-foreground/85 tnum">{item.value}</span>
          <span className="text-xs break-words text-muted-foreground tnum">{item.comparison}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-0.5 text-xs text-muted-foreground group-hover:text-foreground">
          <span className="hidden sm:inline">{PAGE_LABEL[item.to]}</span>
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

function AllClear() {
  return (
    <div className="flex items-center gap-3 px-5 py-8 text-sm">
      <CircleCheck className="size-5 text-good" aria-hidden />
      Nothing crossed a threshold in this range.
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-4 px-5 py-4">
          <Skeleton className="h-6 w-12" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
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
