import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Download, MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader, Panel } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, TableSkeleton, useRange } from "@/components/section";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getReplays } from "@/lib/api";
import { rangeSentence } from "@/lib/compare";
import { formatAgo, formatDateTime, formatExact } from "@/lib/format";
import { cn } from "@/lib/utils";

type ReplaySearch = { page?: number; min?: number; clicks?: boolean; device?: string; url?: string; download?: "yes" | "no"; sort?: "longest" | "clicks" };

const MIN_DURATIONS = [
  [0, "Any length"],
  [10, "10 s +"],
  [30, "30 s +"],
  [60, "1 min +"],
  [300, "5 min +"],
] as const;

export const Route = createFileRoute("/_app/replays/")({
  validateSearch: (search: Record<string, unknown>): ReplaySearch => {
    const out: ReplaySearch = {};
    const page = Math.floor(Number(search.page));
    if (page > 1) out.page = page;
    const min = Math.floor(Number(search.min));
    if (min > 0) out.min = Math.min(min, 86_400);
    if (search.clicks === true || search.clicks === "true" || search.clicks === "1") out.clicks = true;
    if (typeof search.device === "string" && search.device) out.device = search.device.slice(0, 40);
    if (typeof search.url === "string" && search.url) out.url = search.url.slice(0, 200);
    if (search.download === "yes" || search.download === "no") out.download = search.download;
    if (search.sort === "longest" || search.sort === "clicks") out.sort = search.sort;
    return out;
  },
  head: () => ({ meta: [{ title: "Replays · Ardia" }] }),
  component: ReplaysPage,
});

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
  const [urlDraft, setUrlDraft] = useState(search.url ?? "");

  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.url ?? "") !== urlDraft) navigate({ search: (prev) => ({ ...prev, url: urlDraft || undefined, page: undefined }), replace: true });
    }, 350);
    return () => clearTimeout(id);
  }, [urlDraft, search.url, navigate]);

  const input = { range, page: search.page ?? 1, minDuration: search.min ?? 0, clicks: search.clicks ?? false, device: search.device ?? "", url: search.url ?? "", download: search.download ?? "", sort: search.sort ?? "newest" };
  const query = useQuery({
    queryKey: ["replays", input],
    queryFn: ({ signal }) => getReplays({ data: input, signal }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const set = (patch: Partial<ReplaySearch>) => navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) });

  return (
    <>
      <PageHeader
        title="Replays"
        description={`Always-on, anonymous recordings of ardia.dev sessions. ${rangeSentence(range)}, up to the 30 days replays are kept. Inputs and private text are masked at record time.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Minimum length"
          value={search.min ?? 0}
          onChange={(e) => set({ min: Number(e.target.value) || undefined })}
          className="h-8 rounded-lg border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {MIN_DURATIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Device"
          value={search.device ?? ""}
          onChange={(e) => set({ device: e.target.value || undefined })}
          className="h-8 rounded-lg border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="">All devices</option>
          {(query.data?.devices ?? (search.device ? [search.device] : [])).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          aria-label="Download"
          value={search.download ?? ""}
          onChange={(e) => set({ download: (e.target.value || undefined) as ReplaySearch["download"] })}
          className="h-8 rounded-lg border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="">Any download</option>
          <option value="yes">Clicked download</option>
          <option value="no">No download</option>
        </select>
        <button
          type="button"
          aria-pressed={search.clicks ?? false}
          onClick={() => set({ clicks: search.clicks ? undefined : true })}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs",
            search.clicks && "border-foreground/30 bg-foreground text-background",
          )}
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
          className="h-8 w-44 rounded-lg border bg-card px-2.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-56"
        />
        <ToggleGroup
          type="single"
          value={search.sort ?? "newest"}
          onValueChange={(v) => v && set({ sort: v === "newest" ? undefined : (v as ReplaySearch["sort"]) })}
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

      <Panel
        source="replay"
        title="Sessions"
        description={query.data ? `${formatExact(query.data.total)} sessions match. Click one to watch it.` : "Loading sessions…"}
        bodyClassName="px-0 sm:px-0"
      >
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={9} /></div>}>
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
