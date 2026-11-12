import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Source = "site" | "replay" | "feed" | "daily" | "app" | "github";

const LOOK: Record<Source, { label: string; title: string; detail: string }> = {
  site: {
    label: "Always on",
    title: "Always collected, anonymous",
    detail: "Every ardia.dev visitor. The site sends this for everyone, with no consent step, and doesn't read Do Not Track or GPC.",
  },
  replay: {
    label: "Always on",
    title: "Always collected, anonymous",
    detail: "Every ardia.dev session longer than about 4 s is recorded, with inputs and private text masked in the browser. Kept 30 days.",
  },
  feed: {
    label: "Always on",
    title: "Always collected, anonymous",
    detail: "Every installed copy's Sparkle update checks to ardia.dev/appcast.xml, counted by nginx with no IP or id. Copies with automatic checks turned off only count when someone checks by hand; 0.2.13 and older aren't counted.",
  },
  daily: {
    label: "Always on",
    title: "Always collected, anonymous",
    detail: "The daily count: one ping per copy per UTC day, sharing on or off, with no persistent ID. Only 0.2.41-nightly.3 and later send it, so it counts part of the copies until older versions are gone.",
  },
  app: {
    label: "Opt-in",
    title: "Opt-in only",
    detail: "Only from Mac app users who turned on usage sharing (Settings › Privacy, onboarding, or the new-tab ask). It's off by default, so this undercounts.",
  },
  github: {
    label: "Public",
    title: "Public",
    detail: "GitHub's public API: stars, forks, issues and release download counts.",
  },
};

export function SourceBadge({ source, className }: { source: Source | Source[]; className?: string }) {
  const list = Array.isArray(source) ? source : [source];
  const look = LOOK[list[0]!];
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex h-[18px] shrink-0 cursor-default items-center rounded-[5px] border border-border bg-muted/50 px-1.5 font-mono text-[9.5px] font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            className,
          )}
        >
          {look.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="grid max-w-72 gap-1.5 text-xs">
        {list.map((s) => (
          <span key={s}>
            <span className="font-semibold">{LOOK[s].title}.</span> {LOOK[s].detail}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export const SOURCE_SENTENCE: Record<Source, string> = {
  site: "Always-on, anonymous site analytics",
  replay: "Always-on, anonymous session recordings",
  feed: "Always-on, anonymous update checks",
  daily: "Always-on, anonymous daily count",
  app: "Opt-in app telemetry",
  github: "Public GitHub data",
};

export function SourceBadges({ source }: { source?: Source | Source[] }) {
  if (!source) return null;
  const byLabel = new Map<string, Source[]>();
  for (const s of new Set(Array.isArray(source) ? source : [source])) byLabel.set(LOOK[s].label, [...(byLabel.get(LOOK[s].label) ?? []), s]);
  return (
    <>
      {[...byLabel].map(([label, list]) => (
        <SourceBadge key={label} source={list} />
      ))}
    </>
  );
}
