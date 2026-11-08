import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Pager, Segmented, VersionTag, selectClass } from "@/components/people-ui";
import { PersonName } from "@/components/person";
import { Loaded, StatsSkeleton, TableSkeleton } from "@/components/section";
import { Card } from "@/components/ui/card";
import { formatAgo, formatDate, formatDateTime, formatExact } from "@/lib/format";
import { getPeople, PEOPLE_FILTERS, PEOPLE_SORT_KEYS, type ChannelFilter, type PeopleFilter, type PeopleSortKey } from "@/lib/people-api";
import { cn } from "@/lib/utils";

type PeopleSearch = { q?: string; page?: number; sort?: Exclude<PeopleSortKey, "last">; channel?: Exclude<ChannelFilter, "">; only?: Exclude<PeopleFilter, ""> };

export const Route = createFileRoute("/_app/people/")({
  validateSearch: (search: Record<string, unknown>): PeopleSearch => {
    const out: PeopleSearch = {};
    if (typeof search.q === "string" && search.q.trim()) out.q = search.q.slice(0, 64);
    const page = Math.floor(Number(search.page));
    if (page > 1) out.page = Math.min(page, 10_000);
    if (PEOPLE_SORT_KEYS.includes(search.sort as PeopleSortKey) && search.sort !== "last") out.sort = search.sort as PeopleSearch["sort"];
    if (search.channel === "stable" || search.channel === "nightly") out.channel = search.channel;
    if (PEOPLE_FILTERS.includes(search.only as PeopleFilter) && search.only) out.only = search.only as PeopleSearch["only"];
    return out;
  },
  head: () => ({ meta: [{ title: "People · Ardia" }] }),
  component: PeoplePage,
});

const SORTS = [
  ["last", "Last seen"],
  ["first", "First seen"],
  ["crashes", "Crashes"],
  ["reports", "Reports"],
] as const;

const FILTERS = [
  ["", "Everyone"],
  ["crashed", "Crashed"],
  ["reported", "Reported"],
  ["watching", "Watching"],
  ["cli", "CLI"],
] as const;

function PeoplePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [draft, setDraft] = useState(search.q ?? "");
  useEffect(() => setDraft(search.q ?? ""), [search.q]);
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? "") !== draft.trim()) navigate({ search: (prev) => ({ ...prev, q: draft.trim() || undefined, page: undefined }), replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [draft, search.q, navigate]);

  const input = { search: search.q ?? "", page: search.page ?? 1, sort: search.sort ?? "last", channel: search.channel ?? "", only: search.only ?? "" };
  const query = useQuery({
    queryKey: ["people", input],
    queryFn: ({ signal }) => getPeople({ data: input, signal }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="People"
        description="Every install that ever sent opt-in telemetry, a CLI event or a report, under its anonymous name. Names and avatars are made from the install id on the fly; nothing about a person is stored beyond their events."
      />

      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 xl:grid-cols-6">
        <Loaded query={query} skeleton={<StatsSkeleton count={6} />} className="contents">
          {(d) => (
            <>
              <Stat source="app" label="Installs" value={formatExact(d.total)} sub="all time" />
              <Stat label="Seen this week" value={formatExact(d.counts.seenWeek)} sub="last 7 days" />
              <Stat label="Crashed" value={formatExact(d.counts.crashed)} sub="at least one crash" />
              <Stat label="Reported" value={formatExact(d.counts.reported)} sub="sent a report" />
              <Stat label="Watching" value={formatExact(d.counts.watching)} sub="14-day watch on" />
              <Stat label="CLI" value={formatExact(d.counts.cli)} sub="used ardia CLI" />
            </>
          )}
        </Loaded>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search by name or id"
          placeholder="Name or id prefix…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={cn(selectClass, "w-56 placeholder:text-muted-foreground sm:w-64")}
        />
        <Segmented label="Channel" value={search.channel ?? ""} options={[["", "All"], ["stable", "Stable"], ["nightly", "Nightly"]] as const} onChange={(v) => navigate({ search: (prev) => ({ ...prev, channel: v || undefined, page: undefined }) })} />
        <Segmented label="Show" value={search.only ?? ""} options={FILTERS} onChange={(v) => navigate({ search: (prev) => ({ ...prev, only: v || undefined, page: undefined }) })} />
        <select
          aria-label="Sort"
          value={search.sort ?? "last"}
          onChange={(e) => navigate({ search: (prev) => ({ ...prev, sort: e.target.value === "last" ? undefined : (e.target.value as PeopleSearch["sort"]), page: undefined }) })}
          className={cn(selectClass, "ml-auto")}
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              Sort: {label}
            </option>
          ))}
        </select>
      </div>

      <Panel
        source="app"
        title="Installs"
        description={query.data ? `${formatExact(query.data.matching)} match${query.data.matching === 1 ? "es" : ""}. Click one for its sessions, crashes and reports.` : "Loading…"}
        bodyClassName="px-0 sm:px-0"
      >
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={12} columns={8} /></div>}>
          {(d) => (
            <>
              <div className="px-2 sm:px-3">
                <DataTable
                  dense
                  rows={d.rows}
                  rowKey={(r) => r.id}
                  empty="Nobody matches"
                  onSelect={(r) => navigate({ to: "/people/$id", params: { id: r.id }, search: (prev) => ({ range: prev.range }) })}
                  columns={[
                    { key: "person", header: "Person", cell: (r) => <PersonName id={r.id} /> },
                    {
                      key: "last",
                      header: "Last seen",
                      cell: (r) => (
                        <span className="grid whitespace-nowrap" title={formatDateTime(r.lastSeen)}>
                          <span>{formatAgo(r.lastSeen, now)}</span>
                          <span className="text-[11px] text-muted-foreground">since {formatDate(r.firstSeen)}</span>
                        </span>
                      ),
                    },
                    {
                      key: "version",
                      header: "Version",
                      cell: (r) => (
                        <span className="grid gap-0.5">
                          {r.version ? <VersionTag version={r.version} channel={r.channel} /> : <span className="text-muted-foreground">no app events</span>}
                          {r.usesCli ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                              <Terminal className="size-3" aria-hidden />
                              cli {r.cliVersion}
                            </span>
                          ) : null}
                        </span>
                      ),
                    },
                    {
                      key: "mac",
                      header: "Mac",
                      cell: (r) => (r.chip ? <span className="whitespace-nowrap">{r.chip.replace(/^Apple /, "")}{r.memoryGb ? <span className="text-muted-foreground"> · {r.memoryGb} GB</span> : null}</span> : <span className="text-muted-foreground">–</span>),
                    },
                    { key: "crashes", header: "Crashes", align: "right", cell: (r) => (r.crashes ? <span className="font-semibold text-bad">{formatExact(r.crashes)}</span> : <span className="text-muted-foreground">0</span>) },
                    { key: "reports", header: "Reports", align: "right", cell: (r) => (r.reports ? <span className="font-semibold">{formatExact(r.reports)}</span> : <span className="text-muted-foreground">0</span>) },
                    {
                      key: "state",
                      header: "Sharing",
                      cell: (r) =>
                        r.watchUntil && r.watchUntil > now ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-chart-2">
                            <Eye className="size-3.5" aria-hidden />
                            until {formatDate(r.watchUntil)}
                          </span>
                        ) : now - r.lastSeen < 2 * 86_400_000 ? (
                          <span className="whitespace-nowrap text-good">active</span>
                        ) : (
                          <span className="whitespace-nowrap text-muted-foreground">quiet</span>
                        ),
                    },
                  ]}
                />
              </div>
              {d.pageCount > 1 ? <Pager page={d.page} pageCount={d.pageCount} onPage={(p) => navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })} /> : null}
            </>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
