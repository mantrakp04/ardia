import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { createContext, useContext, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { Legend } from "@/components/charts";
import { SparkChart } from "@/components/ruixen/spark-chart";
import { ChartSkeleton, SectionError, useRange } from "@/components/section";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { rangeSentence } from "@/lib/compare";
import { formatBucket, formatExact, formatTick } from "@/lib/format";
import { getPerformanceTrend, type PerformanceTrend, type TrendFamily, type TrendSeries } from "@/lib/performance-trends";
import type { RangeKey, Step } from "@/lib/range";
import { THRESHOLDS } from "@/lib/thresholds";
import { viewerZone, zoneLabel } from "@/lib/zone";
import { cn } from "@/lib/utils";

export type Quantiles = { count: number; p50: number; p90: number; p99: number };
export type TrendOption = { group: string; label: string; summary: Quantiles | null };
export type TrendSpec = {
  family: TrendFamily;
  group: string;
  context: string;
  color: string;
  format: (n: number) => string;
  options: TrendOption[];
  counts?: boolean;
  tickUnit?: number;
  tick?: (n: number) => string;
};

type Scale = "linear" | "log";
type QuantileKey = "p50" | "p90" | "p99";

const shade = (color: string, percent: number) => (percent >= 100 ? color : `color-mix(in oklab, ${color} ${percent}%, var(--card))`);

const LINES: { key: QuantileKey; mix: number; width: number }[] = [
  { key: "p99", mix: 50, width: 1.5 },
  { key: "p90", mix: 72, width: 1.5 },
  { key: "p50", mix: 100, width: 2 },
];

const LEGEND_ORDER: QuantileKey[] = ["p50", "p90", "p99"];

const labelOf = (spec: TrendSpec, group = spec.group) => spec.options.find((o) => o.group === group)?.label ?? group;
const summaryOf = (spec: TrendSpec, group = spec.group) => spec.options.find((o) => o.group === group)?.summary ?? null;
const fewSamples = (n: number) => n > 0 && n < THRESHOLDS.minPerfSamples;

export function useTrend(family: TrendFamily, range: RangeKey, enabled: boolean): UseQueryResult<PerformanceTrend> {
  return useQuery({
    queryKey: ["performance-trend", family, range, viewerZone()],
    queryFn: ({ signal }) => getPerformanceTrend({ data: { family, range, zone: viewerZone() }, signal }),
    enabled,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => (previous?.family === family ? previous : undefined),
  });
}

type TrendSheet = { show: (spec: TrendSpec) => void; isOpen: () => boolean };

const OpenTrend = createContext<TrendSheet>({ show: () => undefined, isOpen: () => false });

export function TrendSheetProvider({ children }: { children: ReactElement | ReactElement[] }) {
  const [spec, setSpec] = useState<TrendSpec | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const openRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const setSheetOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
  };
  const sheet = useMemo<TrendSheet>(
    () => ({
      show: (next) => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        openRef.current = true;
        setSpec(next);
        setVersion((v) => v + 1);
        setOpen(true);
      },
      isOpen: () => openRef.current,
    }),
    [],
  );
  return (
    <OpenTrend.Provider value={sheet}>
      {children}
      <Sheet open={open} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={(e) => {
            if (!opener.current?.isConnected) return;
            e.preventDefault();
            opener.current.focus({ preventScroll: true });
          }}
        >
          {spec ? <TrendSheetBody key={version} spec={spec} /> : null}
        </SheetContent>
      </Sheet>
    </OpenTrend.Provider>
  );
}

export function TrendTarget({ spec, name, side = "top", children }: { spec: TrendSpec; name?: string; side?: "top" | "bottom"; children: ReactElement }) {
  const sheet = useContext(OpenTrend);
  const range = useRange();
  const [wanted, setWanted] = useState(false);
  const [hovering, setHovering] = useState(false);
  const suppressed = useRef(false);
  const trend = useTrend(spec.family, range, wanted);
  const activate = () => {
    suppressed.current = true;
    setHovering(false);
    sheet.show(spec);
  };
  const release = () => {
    suppressed.current = false;
  };
  const releaseOnMouseLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !sheet.isOpen()) release();
  };
  const releaseOnBlur = () => {
    if (!sheet.isOpen()) release();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    activate();
  };
  return (
    <HoverCardPrimitive.Root
      open={hovering}
      openDelay={140}
      closeDelay={80}
      onOpenChange={(o) => {
        if (o && (suppressed.current || sheet.isOpen())) return;
        setHovering(o);
        if (o) setWanted(true);
      }}
    >
      <HoverCardPrimitive.Trigger
        asChild
        className="cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label={`${name ?? labelOf(spec)}: show its trend`}
        aria-haspopup="dialog"
        onPointerEnter={() => setWanted(true)}
        onPointerLeave={releaseOnMouseLeave}
        onFocus={() => setWanted(true)}
        onBlur={releaseOnBlur}
        onClick={activate}
        onKeyDown={onKeyDown}
      >
        {children}
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side={side}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-80 origin-(--radix-hover-card-content-transform-origin) rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <TrendPreview spec={spec} name={name} trend={trend} range={range} />
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

function TrendPreview({ spec, name, trend, range }: { spec: TrendSpec; name?: string; trend: UseQueryResult<PerformanceTrend>; range: RangeKey }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const data = trend.data;
  const series = data?.groups[spec.group];
  const last = series ? lastWithSamples(series) : null;
  const at = scrub ?? last;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold">{name ?? labelOf(spec)}</span>
        <span className="shrink-0 label-mono text-muted-foreground">{data ? (data.step === "hour" ? "hourly" : "daily") : rangeSentence(range)}</span>
      </div>
      {!spec.counts ? (
        <div className="flex items-center justify-between gap-3">
          <QuantileLegend color={spec.color} />
          <span className="text-[10.5px] text-muted-foreground">log scale</span>
        </div>
      ) : null}
      {trend.isError && !data ? (
        <SectionError error={trend.error} onRetry={() => trend.refetch()} />
      ) : !data ? (
        <Skeleton className="h-14 w-full" />
      ) : !series ? (
        <p className="grid h-14 place-items-center text-xs text-muted-foreground">No samples in this range</p>
      ) : spec.counts ? (
        <SparkChart data={series.count} color={spec.color} height={56} onScrub={setScrub} label={`${labelOf(spec)} per ${data.step}`} />
      ) : (
        <QuantileSpark series={series} color={spec.color} onScrub={setScrub} label={`${labelOf(spec)} trend`} />
      )}
      {data && series && at !== null ? (
        <div className="grid gap-0.5 text-xs">
          <span className="text-muted-foreground">{scrub === null && at === data.buckets.length - 1 ? `${formatBucket(data.buckets[at]!, data.step, data.zone)}, so far` : formatBucket(data.buckets[at]!, data.step, data.zone)}</span>
          <BucketReadout series={series} index={at} spec={spec} />
        </div>
      ) : null}
      <span className="border-t pt-2 text-[11px] text-muted-foreground">Click for the full chart</span>
    </div>
  );
}

function BucketReadout({ series, index, spec }: { series: TrendSeries; index: number; spec: TrendSpec }) {
  const n = series.count[index] ?? 0;
  if (!n) return <span className="text-muted-foreground">No samples</span>;
  if (spec.counts) return <span className="font-semibold tnum">{formatExact(n)}</span>;
  return (
    <span className="tnum">
      <span className="font-semibold">{spec.format(series.p50[index] ?? 0)}</span>
      <span className="text-muted-foreground">
        {" "}
        · {spec.format(series.p90[index] ?? 0)} · {spec.format(series.p99[index] ?? 0)} · {formatExact(n)} {n === 1 ? "sample" : "samples"}
      </span>
    </span>
  );
}

function lastWithSamples(series: TrendSeries): number | null {
  for (let i = series.count.length - 1; i >= 0; i--) if (series.count[i]) return i;
  return null;
}

function QuantileLegend({ color, className }: { color: string; className?: string }) {
  return <Legend className={className} items={LEGEND_ORDER.map((key) => ({ label: key, color: shade(color, LINES.find((l) => l.key === key)!.mix) }))} />;
}

const SPARK_W = 300;

function logDomain(series: TrendSeries): [number, number] {
  const seen = (values: (number | null)[]) => values.filter((v, i): v is number => v !== null && v > 0 && !!series.count[i]);
  const low = Math.min(...seen(series.p50), ...seen(series.p90), ...seen(series.p99));
  const high = Math.max(...seen(series.p99), ...seen(series.p90), ...seen(series.p50));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [1, 10];
  return high > low * 1.05 ? [low / 1.15, high * 1.15] : [low / 1.5, high * 1.5];
}

function logTicks([lo, hi]: [number, number], unit = 1): number[] | undefined {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) out.push(m * 10 ** e);
  if (unit > 1) for (let e = 0; e <= Math.ceil(Math.log10(hi / unit)); e++) for (const m of [1, 2, 5]) out.push(m * 10 ** e * unit);
  const inside = [...new Set(out.filter((t) => t >= lo && t <= hi && (unit === 1 || t < unit || t % unit === 0)))].sort((a, b) => a - b);
  if (inside.length < 2) return undefined;
  return inside.length > 6 ? inside.filter((t) => String(t).startsWith("1") || String(t).startsWith("5")) : inside;
}

function QuantileSpark({ series, color, onScrub, label, height = 56 }: { series: TrendSeries; color: string; onScrub: (i: number | null) => void; label: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const n = series.count.length;
  const [lo, hi] = logDomain(series);
  const x = (i: number) => (n <= 1 ? SPARK_W / 2 : (i / (n - 1)) * SPARK_W);
  const y = (v: number) => 3 + (1 - (Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (height - 6);
  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null || v <= 0 || !series.count[i]) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"} ${x(i)} ${y(v)} `;
      pen = true;
    });
    return d.trim();
  };
  const move = (e: PointerEvent) => {
    const el = ref.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    const i = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (n - 1));
    setActive(i);
    onScrub(i);
  };
  const leave = () => {
    setActive(null);
    onScrub(null);
  };
  const p50 = active !== null && series.count[active] ? series.p50[active] : null;
  const dot = p50 !== null && p50 !== undefined && p50 > 0 ? p50 : null;
  return (
    <div ref={ref} role="img" aria-label={label} className="relative select-none touch-pan-y" style={{ height }} onPointerMove={move} onPointerDown={move} onPointerLeave={leave}>
      <svg viewBox={`0 0 ${SPARK_W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-hidden">
        <line x1={0} x2={SPARK_W} y1={height - 0.5} y2={height - 0.5} stroke="var(--grid)" vectorEffect="non-scaling-stroke" />
        {LINES.map((l) => (
          <path
            key={l.key}
            d={path(series[l.key])}
            fill="none"
            stroke={shade(color, l.mix)}
            strokeWidth={l.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {active !== null ? <div className="pointer-events-none absolute top-0 bottom-0 w-px -translate-x-1/2 bg-foreground/20" style={{ left: `${(x(active) / SPARK_W) * 100}%` }} /> : null}
      {active !== null && dot !== null ? (
        <div
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(x(active) / SPARK_W) * 100}%`, top: `${(y(dot ?? 0) / height) * 100}%`, backgroundColor: color, boxShadow: "0 0 0 2px var(--popover)" }}
        />
      ) : null}
    </div>
  );
}

function TrendSheetBody({ spec }: { spec: TrendSpec }) {
  const range = useRange();
  const [group, setGroup] = useState(spec.group);
  const [scale, setScale] = useState<Scale>("log");
  const [table, setTable] = useState(false);
  const trend = useTrend(spec.family, range, true);
  const data = trend.data;
  const series = data?.groups[group];
  const summary = summaryOf(spec, group);
  const title = labelOf(spec, group);
  return (
    <>
      <SheetHeader className="gap-1 border-b px-5 pt-5 pb-4">
        <SheetTitle className="pr-8 text-lg tracking-[-0.01em]">{title}</SheetTitle>
        <SheetDescription className="text-xs">
          {spec.context} · {rangeSentence(range)}, {data?.step === "hour" || range === "24h" ? "hourly" : "daily"} ({zoneLabel(viewerZone())})
        </SheetDescription>
        {spec.options.length > 1 ? (
          <ToggleGroup
            type="single"
            value={group}
            onValueChange={(v) => v && setGroup(v)}
            aria-label="Row"
            className="mt-2 flex w-full flex-wrap justify-start gap-1 rounded-lg p-0"
            spacing={1}
          >
            {spec.options.map((o) => (
              <ToggleGroupItem
                key={o.group}
                value={o.group}
                className="h-7 flex-none rounded-md border px-2.5 text-xs text-muted-foreground data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
              >
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </SheetHeader>
      <div className="grid gap-5 px-5 py-5">
        <RangeSummary spec={spec} summary={summary} range={range} />
        {!spec.counts ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <QuantileLegend color={spec.color} />
            <ToggleGroup type="single" value={scale} onValueChange={(v) => v && setScale(v as Scale)} aria-label="Scale" className="rounded-lg border bg-card p-0.5">
              {(
                [
                  ["log", "Log"],
                  ["linear", "Linear"],
                ] as const
              ).map(([value, label]) => (
                <ToggleGroupItem key={value} value={value} className="h-6 rounded-md px-2 text-[11px] text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}
        <div className={cn("grid gap-4 transition-opacity duration-200", trend.isPlaceholderData && "opacity-55")}>
          {trend.isError && !data ? (
            <SectionError error={trend.error} onRetry={() => trend.refetch()} />
          ) : !data ? (
            <ChartSkeleton height={280} />
          ) : !series ? (
            <p className="grid h-[280px] place-items-center text-sm text-muted-foreground">No samples in this range</p>
          ) : spec.counts ? (
            <CountChart buckets={data.buckets} series={series} step={data.step} color={spec.color} height={280} />
          ) : (
            <>
              <QuantileChart buckets={data.buckets} series={series} step={data.step} spec={spec} scale={scale} height={280} />
              <div className="grid gap-1.5">
                <span className="label-mono text-muted-foreground">Samples per {data.step}</span>
                <CountChart buckets={data.buckets} series={series} step={data.step} color={shade(spec.color, 45)} height={72} compact />
              </div>
            </>
          )}
        </div>
        {data && series ? (
          <div className="grid gap-2">
            <button type="button" onClick={() => setTable((t) => !t)} className="justify-self-start rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent" aria-expanded={table}>
              {table ? "Hide table" : "Show as table"}
            </button>
            {table ? <TrendTable buckets={data.buckets} series={series} step={data.step} spec={spec} /> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function RangeSummary({ spec, summary, range }: { spec: TrendSpec; summary: Quantiles | null; range: RangeKey }) {
  if (!summary) return null;
  const cells = spec.counts
    ? [{ label: "Samples", value: formatExact(summary.count), strong: true }]
    : [
        { label: "p50", value: spec.format(summary.p50), strong: true },
        { label: "p90", value: spec.format(summary.p90) },
        { label: "p99", value: spec.format(summary.p99) },
        { label: "Samples", value: formatExact(summary.count) },
      ];
  return (
    <div className="grid gap-1.5">
      <span className="label-mono text-muted-foreground">{rangeSentence(range)}, all together</span>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {cells.map((c) => (
          <div key={c.label} className="grid gap-0.5">
            <span className={cn("leading-none tracking-[-0.02em]", c.strong ? "text-2xl font-semibold" : "text-lg font-medium text-foreground/85")}>{c.value}</span>
            <span className="text-[11px] text-muted-foreground">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type TrendRow = { t: number; n: number; p50: number | null; p90: number | null; p99: number | null };

function rowsOf(buckets: number[], series: TrendSeries, scale: Scale): TrendRow[] {
  const keep = (v: number | null, n: number) => (!n || v === null || (scale === "log" && v <= 0) ? null : v);
  return buckets.map((t, i) => {
    const n = series.count[i] ?? 0;
    return { t, n, p50: keep(series.p50[i] ?? null, n), p90: keep(series.p90[i] ?? null, n), p99: keep(series.p99[i] ?? null, n) };
  });
}

const axisProps = { tickLine: false, axisLine: false, tick: { fontSize: 11 } } as const;
const Y_WIDTH = 60;

function partial(buckets: number[]) {
  if (buckets.length < 3) return null;
  return (
    <ReferenceArea
      x1={buckets[buckets.length - 2]}
      x2={buckets[buckets.length - 1]}
      fill="var(--foreground)"
      fillOpacity={0.035}
      strokeOpacity={0}
      label={{ value: "so far", position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }}
    />
  );
}

function TrendTooltip({ active, payload, step, spec }: { active?: boolean; payload?: { payload?: TrendRow }[]; step: Step; spec: TrendSpec }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <div className="label-mono text-muted-foreground">{formatBucket(row.t, step, viewerZone())}</div>
      {row.n && !spec.counts
        ? LEGEND_ORDER.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: shade(spec.color, LINES.find((l) => l.key === key)!.mix) }} />
              <span className="font-semibold tnum text-foreground">{row[key] === null ? "–" : spec.format(row[key]!)}</span>
              <span className="text-muted-foreground">{key}</span>
            </div>
          ))
        : null}
      <div className={cn("flex items-center gap-2", !spec.counts && "border-t pt-1.5")}>
        <span className={cn("tnum", spec.counts ? "font-semibold text-foreground" : "text-muted-foreground")}>{formatExact(row.n)}</span>
        <span className="text-muted-foreground">
          {row.n === 1 ? "sample" : "samples"}
          {fewSamples(row.n) && !spec.counts ? ", too few for a steady p99" : ""}
        </span>
      </div>
    </div>
  );
}

function QuantileChart({ buckets, series, step, spec, scale, height }: { buckets: number[]; series: TrendSeries; step: Step; spec: TrendSpec; scale: Scale; height: number }) {
  const rows = useMemo(() => rowsOf(buckets, series, scale), [buckets, series, scale]);
  const config: ChartConfig = Object.fromEntries(LINES.map((l) => [l.key, { label: l.key, color: shade(spec.color, l.mix) }]));
  const log = logDomain(series);
  const domain: [number | string, number | string] = scale === "log" ? log : [0, "auto"];
  const dots = buckets.length <= 31;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="t" {...axisProps} minTickGap={28} tickMargin={8} tickFormatter={(v: number) => formatTick(v, step, viewerZone())} />
        <YAxis
          {...axisProps}
          width={Y_WIDTH}
          scale={scale === "log" ? "log" : "auto"}
          domain={domain}
          ticks={scale === "log" ? logTicks(log, spec.tickUnit) : undefined}
          allowDataOverflow={scale === "log"}
          tickCount={5}
          tickFormatter={(v: number) => (spec.tick ?? spec.format)(v)}
        />
        {partial(buckets)}
        <ChartTooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={<TrendTooltip step={step} spec={spec} />} />
        {LINES.map((l) => (
          <Line
            key={l.key}
            dataKey={l.key}
            type="linear"
            stroke={`var(--color-${l.key})`}
            strokeWidth={l.width}
            dot={l.key === "p50" && dots ? { r: 2.5, strokeWidth: 0, fill: `var(--color-${l.key})` } : false}
            activeDot={{ r: l.key === "p50" ? 4 : 3, strokeWidth: 2, stroke: "var(--background)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

function CountChart({ buckets, series, step, color, height, compact }: { buckets: number[]; series: TrendSeries; step: Step; color: string; height: number; compact?: boolean }) {
  const rows = useMemo(() => buckets.map((t, i) => ({ t, n: series.count[i] ?? 0, p50: null, p90: null, p99: null })), [buckets, series]);
  const config: ChartConfig = { n: { label: "Samples", color } };
  const countSpec: TrendSpec = { family: "launch", group: "", context: "", color, format: formatExact, options: [], counts: true };
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={rows} margin={{ top: compact ? 2 : 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={buckets.length > 40 ? 1 : 2} accessibilityLayer>
        {!compact ? <CartesianGrid vertical={false} stroke="var(--grid)" /> : null}
        <XAxis dataKey="t" {...axisProps} hide={compact} minTickGap={28} tickMargin={8} tickFormatter={(v: number) => formatTick(v, step, viewerZone())} />
        <YAxis {...axisProps} width={Y_WIDTH} allowDecimals={false} tickCount={compact ? 2 : 5} tickFormatter={(v: number) => formatExact(v)} />
        <ChartTooltip cursor={{ fill: "var(--foreground)", fillOpacity: 0.05 }} content={<TrendTooltip step={step} spec={countSpec} />} />
        <Bar dataKey="n" fill="var(--color-n)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

function TrendTable({ buckets, series, step, spec }: { buckets: number[]; series: TrendSeries; step: Step; spec: TrendSpec }) {
  const order = buckets.map((_, i) => i).reverse();
  return (
    <div className="max-h-80 overflow-y-auto rounded-md border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>{step === "hour" ? "Hour" : "Day"}</TableHead>
            <TableHead className="text-right">Samples</TableHead>
            {!spec.counts ? LEGEND_ORDER.map((key) => <TableHead key={key} className="text-right">{key}</TableHead>) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.map((i) => {
            const n = series.count[i] ?? 0;
            return (
              <TableRow key={buckets[i]} className={cn(fewSamples(n) && "text-muted-foreground")}>
                <TableCell className="whitespace-nowrap">{formatBucket(buckets[i]!, step, viewerZone())}</TableCell>
                <TableCell className="text-right tnum">{formatExact(n)}</TableCell>
                {!spec.counts
                  ? LEGEND_ORDER.map((key) => (
                      <TableCell key={key} className={cn("text-right tnum", key === "p50" && n && "font-semibold")}>
                        {n ? spec.format(series[key][i] ?? 0) : "–"}
                      </TableCell>
                    ))
                  : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
