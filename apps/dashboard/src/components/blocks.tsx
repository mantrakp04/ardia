import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SparkChart } from "@/components/ruixen/spark-chart";
import { SourceBadges, type Source } from "@/components/source-badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBucket, formatCount, formatDelta, formatExact, formatPercent } from "@/lib/format";
import type { Step } from "@/lib/range";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  source,
}: {
  title: ReactNode;
  description?: ReactNode;
  source?: Source | Source[];
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0 shadow-none", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.95rem] font-semibold tracking-[-0.01em]">
            {title}
            <SourceBadges source={source} />
          </h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className={cn("px-4 pb-4 sm:px-5", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function Delta({ value, previous, format, goodWhenUp = true }: { value: number | null; previous: number | null; format: "count" | "percent"; goodWhenUp?: boolean }) {
  const delta = formatDelta(value, previous, format);
  if (!delta) return null;
  const good = delta.direction === 0 ? null : (delta.direction > 0) === goodWhenUp;
  const Icon = delta.direction > 0 ? ArrowUpRight : delta.direction < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap tnum",
        good === null ? "bg-muted text-muted-foreground" : good ? "bg-good/12 text-good" : "bg-bad/12 text-bad",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {delta.text}
    </span>
  );
}

export type KpiData = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  display?: string;
  format: "count" | "percent";
  goodWhenUp: boolean;
  spark: number[];
  sparkStep: Step;
  hint: string;
};

export function KpiTile({ kpi, buckets, color, compareLabel, source }: { kpi: KpiData; buckets: number[]; color: string; compareLabel: string; source: Source | Source[] }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const fmt = (n: number | null) => (kpi.format === "percent" ? formatPercent(n) : formatCount(n));
  const sparkBuckets = buckets.slice(buckets.length - kpi.spark.length);
  const scrubValue = scrub === null ? null : kpi.spark[scrub];
  return (
    <Card className="relative gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <span className="label-mono min-w-0 text-muted-foreground">{kpi.label}</span>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button type="button" className="mt-px shrink-0 rounded-full text-muted-foreground/60 hover:text-foreground" aria-label={`About ${kpi.label}`}>
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-xs">
            {kpi.hint}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-[3.25rem] items-start gap-2 px-4 pt-1.5">
        {scrubValue !== null && scrubValue !== undefined ? (
          <div className="grid min-w-0">
            <span className="text-[1.7rem] leading-none font-semibold tracking-[-0.02em] tnum">{fmt(scrubValue)}</span>
            <span className="mt-1 text-[11px] text-muted-foreground">{formatBucket(sparkBuckets[scrub!] ?? 0, kpi.sparkStep)}</span>
          </div>
        ) : (
          <div className="grid min-w-0">
            <span className="text-[1.7rem] leading-none font-semibold tracking-[-0.02em]">{kpi.display ?? fmt(kpi.value)}</span>
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Delta value={kpi.value} previous={kpi.previous} format={kpi.format} goodWhenUp={kpi.goodWhenUp} />
              {kpi.previous !== null ? <span className="truncate">vs {fmt(kpi.previous)} {compareLabel}</span> : <span>&nbsp;</span>}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1 px-4 pt-2">
        <SourceBadges source={source} />
      </div>
      <SparkChart data={kpi.spark} color={color} height={46} onScrub={setScrub} className="mt-2" label={`${kpi.label} trend`} />
    </Card>
  );
}

export function KpiTileSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none" aria-busy="true">
      <div className="px-4 pt-4">
        <Skeleton className="h-2.5 w-24" />
      </div>
      <div className="grid gap-2 px-4 pt-3">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-[18px] w-16" />
      </div>
      <Skeleton className="mx-0 mt-3 h-[46px] rounded-none opacity-50" />
    </Card>
  );
}

export function Stat({ label, value, sub, delta, source }: { label: string; value: ReactNode; sub?: ReactNode; delta?: ReactNode; source?: Source | Source[] }) {
  return (
    <div className="grid content-start gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="label-mono text-muted-foreground">{label}</span>
        <SourceBadges source={source} />
      </span>
      <span className="text-2xl leading-none font-semibold tracking-[-0.02em]">{value}</span>
      {sub || delta ? (
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {delta}
          {sub}
        </span>
      ) : null}
    </div>
  );
}

const FUNNEL_RAMP = ["var(--chart-1)", "color-mix(in oklab, var(--chart-1) 78%, var(--card))", "color-mix(in oklab, var(--chart-1) 58%, var(--card))", "color-mix(in oklab, var(--chart-1) 42%, var(--card))"];

export type FunnelStep = { key: string; label: string; value: number | null; display?: string; previous?: number | null; source?: Source | Source[] };

export function Funnel({ steps, note }: { steps: FunnelStep[]; note?: ReactNode }) {
  const first = steps[0]?.value ?? 0;
  return (
    <div className="grid gap-3">
      <ol className="grid gap-2.5">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1]!.value : null;
          const share = first && step.value !== null ? step.value / first : null;
          const conversion = prev && step.value !== null ? step.value / prev : null;
          const before = i > 0 ? steps[i - 1]!.previous : null;
          const previousConversion = before && step.previous != null ? step.previous / before : null;
          return (
            <li key={step.key} className="grid gap-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{step.label}</span>
                  <SourceBadges source={step.source} />
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 tnum sm:gap-3">
                  {i > 0 && previousConversion !== null ? <Delta value={conversion} previous={previousConversion} format="percent" /> : null}
                  {i > 0 ? <span className="text-xs text-muted-foreground">{formatPercent(conversion)}<span className="hidden sm:inline"> of previous</span></span> : null}
                  <span className="font-semibold">{step.display ?? formatExact(step.value)}</span>
                </span>
              </div>
              <Tooltip delayDuration={80}>
                <TooltipTrigger asChild>
                  <div tabIndex={0} className="h-6 w-full rounded-md bg-muted/70 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <div
                      className="h-full rounded-md"
                      style={{ width: `${Math.max(share ?? 0, 0.006) * 100}%`, backgroundColor: FUNNEL_RAMP[Math.min(i, FUNNEL_RAMP.length - 1)] }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <span className="font-semibold tnum">{step.display ?? formatExact(step.value)}</span> {step.label.toLowerCase()} · {formatPercent(share)} of the first step
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function SplitBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="grid gap-2.5">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
        {parts.map((part) =>
          part.value > 0 ? (
            <Tooltip key={part.key} delayDuration={80}>
              <TooltipTrigger asChild>
                <div tabIndex={0} className="h-full first:rounded-l-full last:rounded-r-full outline-none" style={{ width: `${(part.value / total) * 100}%`, backgroundColor: part.color }} />
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                <span className="font-semibold tnum">{formatExact(part.value)}</span> {part.label} · {formatPercent(part.value / total)}
              </TooltipContent>
            </Tooltip>
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: part.color }} />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="font-medium tnum">{formatExact(part.value)}</span>
            <span className="text-muted-foreground tnum">{formatPercent(total ? part.value / total : null)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[1.7rem]" style={{ fontStretch: "92%" }}>
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
