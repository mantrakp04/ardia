import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { IssueChip, KindPill, STATUS_HINT, Segmented, Signals, SourcePill, StatusPill, selectClass } from "@/components/people-ui";
import { cn } from "@/lib/utils";
import { PersonName } from "@/components/person";
import { Loaded, StatsSkeleton, TableSkeleton } from "@/components/section";
import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime, formatExact } from "@/lib/format";
import { getFeedbackList } from "@/lib/people-api";

type Kind = "" | "bug" | "slow" | "idea" | "other" | "agent";
type StatusFilter = "" | "open" | "fixed" | "came-back";
type FeedbackSearch = { kind?: Exclude<Kind, "">; status?: Exclude<StatusFilter, "">; q?: string };

const KINDS = ["bug", "slow", "idea", "other", "agent"] as const;
const STATUSES = ["open", "fixed", "came-back"] as const;

export const Route = createFileRoute("/_app/feedback/")({
  validateSearch: (search: Record<string, unknown>): FeedbackSearch => {
    const out: FeedbackSearch = {};
    if (KINDS.includes(search.kind as (typeof KINDS)[number])) out.kind = search.kind as FeedbackSearch["kind"];
    if (STATUSES.includes(search.status as (typeof STATUSES)[number])) out.status = search.status as FeedbackSearch["status"];
    if (typeof search.q === "string" && search.q.trim()) out.q = search.q.slice(0, 80);
    return out;
  },
  head: () => ({ meta: [{ title: "Feedback · Ardia" }] }),
  component: FeedbackPage,
});

function FeedbackPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useQuery({
    queryKey: ["feedback"],
    queryFn: ({ signal }) => getFeedbackList({ signal }),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState(search.q ?? "");
  useEffect(() => setDraft(search.q ?? ""), [search.q]);
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? "") !== draft.trim()) navigate({ search: (prev) => ({ ...prev, q: draft.trim() || undefined }), replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [draft, search.q, navigate]);
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const needle = (search.q ?? "").toLowerCase();
    return all.filter((r) => {
      if (needle && ![r.title, r.description, r.name, r.id, r.person].some((t) => t.toLowerCase().includes(needle))) return false;
      if (search.kind && r.kind !== search.kind) return false;
      if (search.status === "open" && !["open", "no-issue", "unreleased"].includes(r.status.state)) return false;
      if (search.status === "fixed" && !["fixed", "not-seen"].includes(r.status.state)) return false;
      if (search.status === "came-back" && r.status.state !== "came-back") return false;
      return true;
    });
  }, [query.data, search.kind, search.status, search.q]);

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Reports sent with Report a Problem in the app and ardia feedback in the CLI, plus older agent notes. Status follows the linked GitHub issue and whether the reporter's errors came back after the fix shipped."
      />

      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-4 sm:px-5">
        <Loaded query={query} skeleton={<StatsSkeleton count={4} />} className="contents">
          {(all) => (
            <>
              <Stat label="Reports" value={formatExact(all.filter((r) => !r.legacy).length)} sub={`${formatExact(all.filter((r) => r.legacy).length)} agent notes`} />
              <Stat label="Open" value={formatExact(all.filter((r) => ["open", "no-issue", "unreleased"].includes(r.status.state) && !r.legacy).length)} sub="issue open or fix unreleased" />
              <Stat label="Fixed" value={formatExact(all.filter((r) => ["fixed", "not-seen"].includes(r.status.state)).length)} sub={`${formatExact(all.filter((r) => r.status.state === "not-seen").length)} confirmed not seen since`} />
              <Stat label="Came back" value={<span className={all.some((r) => r.status.state === "came-back") ? "text-bad" : undefined}>{formatExact(all.filter((r) => r.status.state === "came-back").length)}</span>} sub="error returned after the fix" />
            </>
          )}
        </Loaded>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search feedback" placeholder="Search feedback…" value={draft} onChange={(e) => setDraft(e.target.value)} className={cn(selectClass, "w-56 placeholder:text-muted-foreground")} />
        <Segmented
          label="Kind"
          value={search.kind ?? ""}
          options={[["", "All kinds"], ["bug", "Bug"], ["slow", "Slow"], ["idea", "Idea"], ["other", "Other"], ["agent", "Agent"]] as const}
          onChange={(v) => navigate({ search: (prev) => ({ ...prev, kind: v || undefined }) })}
        />
        <Segmented
          label="Status"
          value={search.status ?? ""}
          options={[["", "Any status"], ["open", "Open"], ["fixed", "Fixed"], ["came-back", "Came back"]] as const}
          onChange={(v) => navigate({ search: (prev) => ({ ...prev, status: v || undefined }) })}
        />
      </div>

      <Panel title="Inbox" description={query.data ? `${formatExact(rows.length)} shown. Click a report to read it, watch the recording or download the trace.` : "Loading…"} bodyClassName="px-0 sm:px-0">
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={7} /></div>}>
          {() => (
            <div className="px-2 sm:px-3">
              <DataTable
                dense
                rows={rows}
                rowKey={(r) => r.uuid}
                initialSort={{ key: "at", desc: true }}
                empty="No reports yet"
                onSelect={(r) => navigate({ to: "/feedback/$id", params: { id: r.id }, search: (prev) => ({ range: prev.range }) })}
                columns={[
                  {
                    key: "title",
                    header: "Title",
                    sort: (r) => r.title,
                    cell: (r) => (
                      <span className="grid max-w-[28rem] min-w-[14rem] gap-0.5">
                        <span className="truncate font-medium">{r.title}</span>
                        <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                          {r.legacy ? "agent note" : r.id} · {r.version || "?"}
                        </span>
                      </span>
                    ),
                  },
                  { key: "person", header: "Person", sort: (r) => r.name, className: "min-w-40 whitespace-nowrap", cell: (r) => <PersonName id={r.person} size={20} showId={false} /> },
                  {
                    key: "kind",
                    header: "Kind",
                    sort: (r) => r.kind,
                    cell: (r) => (
                      <span className="flex items-center gap-1">
                        <KindPill kind={r.kind} />
                        {r.source === "cli" ? <SourcePill source="cli" /> : null}
                      </span>
                    ),
                  },
                  { key: "signals", header: "Signals", className: "whitespace-nowrap", cell: (r) => <Signals recording={r.attachments.some((a) => a.name === "recording.mp4")} trace={r.attachments.some((a) => a.name.startsWith("trace."))} watchUntil={r.watchUntil} files={r.attachments.length} /> },
                  { key: "issue", header: "Issue", sort: (r) => r.issueNumber ?? 0, className: "whitespace-nowrap", cell: (r) => <IssueChip number={r.issueNumber} url={r.issueUrl} state={r.issue?.state ?? null} watchUntil={r.watchUntil} /> },
                  { key: "status", header: "Status", sort: (r) => r.status.state, className: "w-px whitespace-nowrap", cell: (r) => (r.legacy ? <span className="text-muted-foreground">–</span> : <StatusPill state={r.status.state} label={r.status.label} hint={STATUS_HINT[r.status.state]} />) },
                  { key: "at", header: "Sent", align: "right", sort: (r) => r.at, className: "w-px whitespace-nowrap pl-4", cell: (r) => <span className="text-muted-foreground" title={formatDateTime(r.at)}>{formatDate(r.at).replace(/, \d{4}$/, "")}</span> },
                ]}
              />
            </div>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
