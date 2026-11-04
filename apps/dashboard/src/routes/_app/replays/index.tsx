import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Download, MousePointerClick, Palette } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Panel } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { AddCondition, ConditionChips } from "@/components/replay-filters";
import { Loaded, TableSkeleton, useRange } from "@/components/section";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getReplays } from "@/lib/api";
import { rangeSentence } from "@/lib/compare";
import { formatAgo, formatDateTime, formatExact } from "@/lib/format";
import {
  legacyConditions,
  parseConditions,
  presetValue,
  toTuples,
  withPreset,
  type ConditionTuple,
  type ReplayCondition,
  type ReplayField,
  type ReplayMatch,
  type ReplayOp,
} from "@/lib/replay-query";
import { cn } from "@/lib/utils";

type LegacySearch = { min?: undefined; clicks?: undefined; device?: undefined; url?: undefined; download?: undefined };
type ReplaySearch = LegacySearch & { page?: number; f?: ConditionTuple[]; match?: "any"; sort?: "longest" | "clicks" };

const DROP_LEGACY: LegacySearch = { min: undefined, clicks: undefined, device: undefined, url: undefined, download: undefined };

const MIN_DURATIONS = [
  [0, "Any length"],
  [10, "10 s +"],
  [30, "30 s +"],
  [60, "1 min +"],
  [300, "5 min +"],
] as const;

function searchConditions(raw: unknown) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/_app/replays/")({
  validateSearch: (search: Record<string, unknown>): ReplaySearch => {
    const out: ReplaySearch = {};
    const page = Math.floor(Number(search.page));
    if (page > 1) out.page = Math.min(page, 10_000);
    const fromUrl = searchConditions(search.f);
    const conditions = parseConditions([...(Array.isArray(fromUrl) ? fromUrl : []), ...legacyConditions(search)]);
    if (conditions.length) out.f = toTuples(conditions);
    if (search.match === "any") out.match = "any";
    if (search.sort === "longest" || search.sort === "clicks") out.sort = search.sort;
    return out;
  },
  head: () => ({ meta: [{ title: "Replays · Ardia" }] }),
  component: ReplaysPage,
});

const selectClass = "h-8 rounded-lg border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const formatDuration = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const formatBytes = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
};

function ReplaysPage() {
  const range = useRange();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const conditions = useMemo(() => parseConditions(search.f), [search.f]);
  const match: ReplayMatch = search.match ?? "all";
  const urlFilter = String(presetValue(conditions, "first_page", "contains") ?? "");
  const [urlDraft, setUrlDraft] = useState(urlFilter);

  const setConditions = (next: ReplayCondition[], replace = false) =>
    navigate({ search: (prev) => ({ ...prev, ...DROP_LEGACY, f: next.length ? toTuples(next) : undefined, match: next.length > 1 ? prev.match : undefined, page: undefined }), replace });
  const setPreset = (field: ReplayField, op: ReplayOp, value: string | number | undefined, replace = false) => setConditions(withPreset(conditions, field, op, value), replace);

  useEffect(() => setUrlDraft(urlFilter), [urlFilter]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (urlFilter !== urlDraft.trim()) setPreset("first_page", "contains", urlDraft.trim() || undefined, true);
    }, 350);
    return () => clearTimeout(id);
  }, [urlDraft, urlFilter, conditions]);

  const input = { range, page: search.page ?? 1, conditions: search.f ?? [], match, sort: search.sort ?? "newest" };
  const query = useQuery({
    queryKey: ["replays", input],
    queryFn: ({ signal }) => getReplays({ data: input, signal }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const minLength = Number(presetValue(conditions, "length", "gte") ?? 0);
  const deviceFilter = String(presetValue(conditions, "device", "is") ?? "");
  const download = String(presetValue(conditions, "download", "is") ?? "");
  const customize = String(presetValue(conditions, "customize", "is") ?? "");
  const hasClicks = presetValue(conditions, "clicks", "gt") === 0;
  const devices = query.data?.options.device ?? [];
  const device = devices.find((d) => d.toLowerCase() === deviceFilter.toLowerCase()) ?? deviceFilter;

  return (
    <>
      <PageHeader
        title="Replays"
        description={`Always-on, anonymous recordings of ardia.dev sessions. ${rangeSentence(range)}, up to the 30 days replays are kept. Inputs and private text are masked at record time.`}
      />

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Minimum length" value={minLength} onChange={(e) => setPreset("length", "gte", Number(e.target.value) || undefined)} className={selectClass}>
            {MIN_DURATIONS.some(([v]) => v === minLength) ? null : <option value={minLength}>{minLength} s +</option>}
            {MIN_DURATIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select aria-label="Device" value={device} onChange={(e) => setPreset("device", "is", e.target.value || undefined)} className={selectClass}>
            <option value="">All devices</option>
            {(!device || devices.includes(device) ? devices : [device, ...devices]).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select aria-label="Download" value={download} onChange={(e) => setPreset("download", "is", e.target.value || undefined)} className={selectClass}>
            <option value="">Any download</option>
            <option value="yes">Clicked download</option>
            <option value="no">No download</option>
          </select>
          <select aria-label="Customize it" value={customize} onChange={(e) => setPreset("customize", "is", e.target.value || undefined)} className={selectClass}>
            <option value="">Any Customize it</option>
            <option value="yes">Clicked Customize it</option>
            <option value="no">Didn't customize</option>
          </select>
          <button
            type="button"
            aria-pressed={hasClicks}
            onClick={() => setPreset("clicks", "gt", hasClicks ? undefined : 0)}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs", hasClicks && "border-foreground/30 bg-foreground text-background")}
          >
            <MousePointerClick className="size-3.5" aria-hidden />
            Has clicks
          </button>
          <input
            type="search"
            aria-label="First page URL contains"
            placeholder="URL contains…"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            className={cn(selectClass, "w-44 placeholder:text-muted-foreground sm:w-56")}
          />
          <AddCondition conditions={conditions} onAdd={(c) => setConditions([...conditions, c])} options={query.data?.options} />
          <ToggleGroup
            type="single"
            value={search.sort ?? "newest"}
            onValueChange={(v) => v && navigate({ search: (prev) => ({ ...prev, sort: v === "newest" ? undefined : (v as ReplaySearch["sort"]), page: undefined }) })}
            aria-label="Sort"
            className="ml-auto rounded-lg border bg-card p-0.5"
          >
            {(
              [
                ["newest", "Newest"],
                ["longest", "Longest"],
                ["clicks", "Most clicks"],
              ] as const
            ).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value} className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <ConditionChips
          conditions={conditions}
          match={match}
          onRemove={(i) => setConditions(conditions.filter((_, j) => j !== i))}
          onMatch={(m) => navigate({ search: (prev) => ({ ...prev, match: m === "any" ? "any" : undefined, page: undefined }) })}
          onClear={() => setConditions([])}
        />
      </div>

      <Panel
        source="replay"
        title="Sessions"
        description={query.data ? `${formatExact(query.data.total)} sessions match. Click one to watch it.` : "Loading sessions…"}
        bodyClassName="px-0 sm:px-0"
      >
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={10} /></div>}>
          {(d) => (
            <>
              <div className="px-2 sm:px-3">
                <DataTable
                  dense
                  rows={d.rows}
                  rowKey={(r) => r.id}
                  empty="No sessions match these filters"
                  columns={[
                    {
                      key: "start",
                      header: "Started",
                      cell: (r) => (
                        <Link to="/replays/$sessionId" params={{ sessionId: r.id }} search={{ range: range !== "7d" ? range : undefined }} className="grid hover:underline">
                          <span className="whitespace-nowrap">{formatDateTime(r.start)}</span>
                          <span className="text-[11px] text-muted-foreground">{formatAgo(r.start)}</span>
                        </Link>
                      ),
                    },
                    { key: "duration", header: "Length", align: "right", cell: (r) => <span className="whitespace-nowrap">{formatDuration(r.durationS)}</span> },
                    { key: "pages", header: "Pages", align: "right", cell: (r) => formatExact(r.pages) },
                    { key: "clicks", header: "Clicks", align: "right", cell: (r) => formatExact(r.clicks) },
                    {
                      key: "download",
                      header: "Download",
                      cell: (r) => (r.downloaded ? <Download className="size-3.5" aria-label="Clicked download" /> : <span className="text-muted-foreground">–</span>),
                    },
                    {
                      key: "customize",
                      header: "Customize",
                      cell: (r) => (r.customized ? <Palette className="size-3.5" aria-label="Clicked Customize it" /> : <span className="text-muted-foreground">–</span>),
                    },
                    {
                      key: "device",
                      header: "Device",
                      cell: (r) => (
                        <span className="whitespace-nowrap">
                          {r.device}
                          <span className="text-muted-foreground">{r.browser ? ` · ${r.browser}` : ""}</span>
                        </span>
                      ),
                    },
                    { key: "country", header: "Country", cell: (r) => <span className="font-mono text-[11px]">{r.country || "–"}</span> },
                    { key: "url", header: "First page", cell: (r) => <span className="line-clamp-1 max-w-72 font-mono text-[11px] text-muted-foreground">{pathOf(r.firstUrl) || "–"}</span> },
                    { key: "size", header: "Size", align: "right", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatBytes(r.bytes)}</span> },
                  ]}
                />
              </div>
              {d.pageCount > 1 ? (
                <div className="flex items-center justify-between gap-3 border-t px-4 pt-3 text-xs sm:px-5">
                  <span className="text-muted-foreground">
                    Page {d.page} of {d.pageCount}
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={d.page <= 1}
                      onClick={() => navigate({ search: (prev) => ({ ...prev, page: d.page - 1 > 1 ? d.page - 1 : undefined }) })}
                      className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 disabled:opacity-40"
                    >
                      <ChevronLeft className="size-3.5" aria-hidden />
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={d.page >= d.pageCount}
                      onClick={() => navigate({ search: (prev) => ({ ...prev, page: d.page + 1 }) })}
                      className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 disabled:opacity-40"
                    >
                      Next
                      <ChevronRight className="size-3.5" aria-hidden />
                    </button>
                  </span>
                </div>
              ) : null}
            </>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
