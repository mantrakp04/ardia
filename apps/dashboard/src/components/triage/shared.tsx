import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { fetchTriage } from "@/lib/triage-api";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TriageData, TriageView } from "@/server/triage/load";

export function useTriage<V extends TriageView>(view: V): UseQueryResult<TriageData<V>> {
  return useQuery({
    queryKey: ["triage", view],
    queryFn: ({ signal }) => fetchTriage(view, signal),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

const TABS = [
  { to: "/triage", label: "Overview" },
  { to: "/triage/requests", label: "Requests" },
  { to: "/triage/replies", label: "Reply queue" },
  { to: "/triage/people", label: "People" },
  { to: "/triage/releases", label: "Releases" },
  { to: "/triage/issues", label: "Issues" },
] as const;

export function TriageTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") });
  return (
    <nav aria-label="Triage sections" className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {TABS.map((tab) => {
        const active = pathname === tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            search={(prev) => ({ range: prev.range })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-lg border bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground",
              active && "border-foreground/30 bg-foreground text-background hover:text-background",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

const TONE: Record<string, string> = {
  open: "bg-chart-2/12 text-chart-2",
  "fixed-nightly": "bg-chart-5/14 text-chart-5",
  "fixed-stable": "bg-good/12 text-good",
  wontfix: "bg-muted text-muted-foreground",
  skip: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
  drafted: "bg-chart-3/12 text-chart-3",
  sent: "bg-good/12 text-good",
  closed: "bg-muted text-muted-foreground",
  bug: "bg-bad/10 text-bad",
  feature: "bg-chart-4/12 text-chart-4",
  "ui-ux": "bg-chart-6/12 text-chart-6",
  question: "bg-chart-2/12 text-chart-2",
  nightly: "bg-chart-5/14 text-chart-5",
  stable: "bg-good/12 text-good",
};

export function Pill({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">–</span>;
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[10.5px] font-medium whitespace-nowrap", TONE[value] ?? "bg-muted text-foreground/80", className)}>
      {value}
    </span>
  );
}

export const PLATFORM_LABEL: Record<string, string> = { x: "X", discord: "Discord", github: "GitHub", other: "Other" };

export const platformLabel = (platform: string) => PLATFORM_LABEL[platform] ?? platform;

export function Platforms({ platforms }: { platforms: string[] }) {
  if (!platforms.length) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {platforms.map((p) => (
        <span key={p} className="rounded-[5px] border bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground uppercase">
          {platformLabel(p)}
        </span>
      ))}
    </span>
  );
}

export function Ext({ href, children, className }: { href: string | null | undefined; children: ReactNode; className?: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cn("inline-flex items-center gap-1 underline-offset-2 hover:underline", className)}>
      {children}
    </a>
  );
}

export function ActionLink({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-accent",
        primary && "border-foreground/30 bg-foreground text-background hover:bg-foreground/90",
      )}
    >
      <ExternalLink className="size-3" aria-hidden />
      {children}
    </a>
  );
}

export function CopyButton({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-accent"
    >
      {copied ? <Check className="size-3 text-good" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; n?: number }[]; onChange: (value: string) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
          {o.n === undefined ? "" : ` (${o.n})`}
        </option>
      ))}
    </select>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-48 rounded-lg border bg-card px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-64"
    />
  );
}

export function optionsOf<T>(rows: T[], get: (row: T) => string | null | undefined, label: (value: string) => string = (v) => v) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = get(row);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, label: label(value), n }));
}

export const matches = (needle: string, ...haystack: (string | null | undefined)[]) => {
  const q = needle.trim().toLowerCase();
  return !q || haystack.some((h) => h?.toLowerCase().includes(q));
};

export function SyncedNote({ at }: { at: number | null | undefined }) {
  return <>{at ? `Mirrored from the triage database ${formatAgo(at)}.` : "Mirrored from the triage database."}</>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
