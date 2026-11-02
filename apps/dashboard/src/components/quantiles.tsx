import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatExact } from "@/lib/format";

export type QuantileRow = { key: string; label: string; count: number; p50: number; p90: number; p99: number };

export function QuantileRows({
  rows,
  format,
  dimension,
  color = "var(--chart-2)",
  empty = "No samples in this range",
}: {
  rows: QuantileRow[];
  format: (n: number) => string;
  dimension: string;
  color?: string;
  empty?: string;
}) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.p90), 1) * 1.15;
  const at = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 pb-1 label-mono text-muted-foreground sm:grid-cols-[10rem_1fr_auto]">
        <span>{dimension}</span>
        <span className="order-last col-span-2 flex items-center gap-3 normal-case tracking-normal sm:order-none sm:col-span-1">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
            p50
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-[2px] opacity-30" style={{ backgroundColor: color }} />
            to p90
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-px bg-foreground/60" />
            p99
          </span>
        </span>
        <span className="text-right sm:w-40">p50 · p90 · p99</span>
      </div>
      <ul className="grid gap-1">
        {rows.map((r) => (
          <li key={r.key}>
            <Tooltip delayDuration={80}>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-md px-0.5 py-1 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-8 sm:grid-cols-[10rem_1fr_auto] sm:py-0"
                >
                  <span className="truncate">{r.label}</span>
                  <span className="relative order-last col-span-2 h-3 sm:order-none sm:col-span-1">
                    <span className="absolute inset-y-0 left-0 rounded-[4px] opacity-25" style={{ width: at(r.p90), backgroundColor: color }} />
                    <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card" style={{ left: at(r.p50), backgroundColor: color }} />
                    <span className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/60" style={{ left: at(r.p99) }} />
                    {r.p99 > max ? <span className="absolute -top-1 right-0 text-[10px] leading-none text-muted-foreground">›</span> : null}
                  </span>
                  <span className="text-right text-xs whitespace-nowrap tnum sm:w-40">
                    <span className="font-semibold">{format(r.p50)}</span>
                    <span className="text-muted-foreground"> · {format(r.p90)} · {format(r.p99)}</span>
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="text-xs">
                {r.label}: median <span className="font-semibold tnum">{format(r.p50)}</span>, p90 {format(r.p90)}, p99 {format(r.p99)} over{" "}
                <span className="tnum">{formatExact(r.count)}</span> samples
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
