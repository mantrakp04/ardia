import { ChevronLeft, ChevronRight, CircleDot, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const selectClass = "h-8 rounded-lg border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const pill = "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-medium whitespace-nowrap";

export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <ToggleGroup type="single" value={value || "__all"} onValueChange={(v) => v && onChange((v === "__all" ? "" : v) as T)} aria-label={label} className={cn("rounded-lg border bg-card p-0.5", className)}>
      {options.map(([v, text]) => (
        <ToggleGroupItem key={v || "__all"} value={v || "__all"} className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Pager({ page, pageCount, onPage, children }: { page: number; pageCount: number; onPage: (page: number) => void; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 pt-3 text-xs sm:px-5">
      <span className="text-muted-foreground">
        {children ?? (
          <>
            Page {page} of {pageCount}
          </>
        )}
      </span>
      <span className="flex gap-1.5">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 disabled:opacity-40">
          <ChevronLeft className="size-3.5" aria-hidden />
          Previous
        </button>
        <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 disabled:opacity-40">
          Next
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </span>
    </div>
  );
}

export function VersionTag({ version, channel, className }: { version: string; channel?: string; className?: string }) {
  if (!version) return <span className="text-muted-foreground">–</span>;
  const nightly = (channel || (version.includes("-nightly") ? "nightly" : "stable")) === "nightly";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className="font-mono text-[11.5px]">{version}</span>
      <span className={cn(pill, "h-4 px-1 text-[9.5px] tracking-wide uppercase", nightly ? "border-chart-4/30 bg-chart-4/10 text-chart-4" : "border-chart-1/30 bg-chart-1/10 text-chart-1")}>{nightly ? "nightly" : "stable"}</span>
    </span>
  );
}

export function SourcePill({ source }: { source: "app" | "cli" | "site" }) {
  return (
    <span className={cn(pill, "h-[18px] rounded-[5px] font-mono text-[9.5px] tracking-[0.04em] uppercase", source === "cli" ? "border-chart-5/40 text-chart-5" : source === "app" ? "border-chart-3/40 text-chart-3" : "border-chart-2/40 text-chart-2")}>
      {source}
    </span>
  );
}

const KIND_LOOK: Record<string, string> = {
  bug: "border-bad/30 bg-bad/10 text-bad",
  slow: "border-chart-5/35 bg-chart-5/10 text-chart-5",
  idea: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  agent: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  other: "border-border bg-muted/60 text-muted-foreground",
};

export function KindPill({ kind }: { kind: string }) {
  return <span className={cn(pill, "capitalize", KIND_LOOK[kind] ?? KIND_LOOK.other)}>{kind}</span>;
}

export const watchDaysLeft = (watchUntil: number | null | undefined, now = Date.now()) => (watchUntil && watchUntil > now ? Math.ceil((watchUntil - now) / 86_400_000) : 0);

export function IssueChip({ number, url, state, watchUntil }: { number: number | null; url: string; state?: "open" | "closed" | null; watchUntil?: number | null }) {
  if (!number) return <span className="text-muted-foreground">–</span>;
  const Icon = state === "closed" ? CircleCheck : CircleDot;
  const watching = state === "closed" ? watchDaysLeft(watchUntil) : 0;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(pill, "hover:bg-accent", state === "closed" ? "border-chart-4/30 text-chart-4" : state === "open" ? "border-good/30 text-good" : "text-muted-foreground")}
    >
      <Icon className="size-3" aria-hidden />#{number}
      {state ? <span className="font-normal opacity-80">· {state}</span> : null}
      {watching ? <span className="font-normal opacity-80">· watching {watching} {watching === 1 ? "day" : "days"}</span> : null}
    </a>
  );
}

const STATUS_LOOK: Record<string, string> = {
  "no-issue": "border-border bg-muted/50 text-muted-foreground",
  open: "border-chart-5/35 bg-chart-5/10 text-chart-5",
  "not-planned": "border-border bg-muted/50 text-muted-foreground",
  unreleased: "border-chart-2/30 bg-chart-2/10 text-chart-2",
  fixed: "border-good/30 bg-good/10 text-good",
  "not-seen": "border-good/40 bg-good/15 text-good",
  "came-back": "border-bad/50 bg-bad/15 font-semibold text-bad",
};

export const STATUS_HINT: Record<string, string> = {
  "no-issue": "No GitHub issue was opened for this report.",
  open: "The linked issue is still open.",
  "not-planned": "The issue was closed as not planned.",
  unreleased: "The issue is closed but no release has shipped since.",
  fixed: "The first release on this report's channel published after the issue closed.",
  "not-seen": "This install runs the fix and hasn't sent the report's error types since.",
  "came-back": "This install sent one of the report's error types again on the fixed version or later.",
};

export function StatusPill({ state, label, hint }: { state: string; label: string; hint?: string }) {
  const body = (
    <span className={cn(pill, STATUS_LOOK[state] ?? STATUS_LOOK["no-issue"])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
  if (!hint) return body;
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{body}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

export function Signals({ recording, trace, watchUntil, files }: { recording: boolean; trace: boolean; watchUntil: number | null; files: number }) {
  const watching = watchDaysLeft(watchUntil);
  const others = files - (recording ? 1 : 0) - (trace ? 1 : 0);
  if (!recording && !trace && !watching && others <= 0) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {recording ? (
        <span className={cn(pill, "border-border bg-muted/50 text-foreground/80")}>
          <span className="size-1.5 rounded-full bg-bad" aria-hidden />
          recording
        </span>
      ) : null}
      {trace ? <span className={cn(pill, "border-border bg-muted/50 text-foreground/80")}>trace</span> : null}
      {watching ? (
        <span className={cn(pill, "border-good/30 bg-good/10 text-good")} title={`Watching until ${formatDate(watchUntil!)}`}>
          watching {watching} d
        </span>
      ) : null}
      {others > 0 ? <span className="text-[11px] text-muted-foreground">+{others}</span> : null}
    </span>
  );
}

export const formatBytes = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <span className="label-mono text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm break-words">{children}</span>
    </div>
  );
}
