import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { LeadSortControl } from "@/components/triage/lead-sort";
import { compareLeads, type LeadSort } from "@/lib/lead-sort";
import { Panel } from "@/components/blocks";
import { ListSkeleton, Loaded } from "@/components/section";
import { ReplyCard, SNOOZE_LABEL, StatusButton, queueStatus, useNow, useRecheck, type Lead, type QueueStatus, type Reply } from "@/components/triage/reply-card";
import { SearchBox, SyncedNote, Toolbar, matches, platformLabel, useTriage } from "@/components/triage/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatExact } from "@/lib/format";

export const Route = createFileRoute("/_app/triage/replies")({
  component: TriageReplies,
});

const PLATFORM_ORDER = ["x", "lead", "discord", "github"];
const FILTERS = [
  ["drafted", "Waiting"],
  ["snoozed", "Snoozed"],
  ["sent", "Sent"],
  ["skipped", "Skipped"],
  ["all", "All"],
] as const;

type Filter = (typeof FILTERS)[number][0];

const groupLabel = (group: string) => (group === "lead" ? "Leads on X" : platformLabel(group));

const groupDescription = (group: string) =>
  group === "lead"
    ? "Browser-tpot posts the triage routine sourced. Nothing is posted for you: Reply opens X's composer with the draft filled in."
    : group === "x"
      ? "Reply opens X's composer as a reply to the post, with the text filled in."
      : "Open the post, paste the copied text, then mark it sent.";

function TriageReplies() {
  const query = useTriage("replies");
  const [filter, setFilter] = useState<Filter>("drafted");
  const now = useNow();
  const [search, setSearch] = useState("");
  const [leadSort, setLeadSort] = useState<LeadSort>("newest");
  const replies = query.data?.replies ?? [];
  const leadByReply = useMemo(() => new Map<number, Lead>((query.data?.leads ?? []).filter((l) => l.replyId != null).map((l) => [l.replyId!, l])), [query.data?.leads]);
  const groups = useMemo(() => {
    const shown = replies.filter((r) => (filter === "all" || queueStatus(r, now) === filter) && matches(search, r.text, r.requester, r.topic, r.requestTitle, r.personName, leadByReply.get(r.id)?.text));
    const byGroup = new Map<string, Reply[]>();
    for (const r of shown) {
      const group = leadByReply.has(r.id) ? "lead" : r.platform;
      byGroup.set(group, [...(byGroup.get(group) ?? []), r]);
    }
    byGroup.get("lead")?.sort((a, b) => compareLeads(leadByReply.get(a.id), leadByReply.get(b.id), leadSort));
    const rank = (group: string) => (PLATFORM_ORDER.includes(group) ? PLATFORM_ORDER.indexOf(group) : PLATFORM_ORDER.length);
    return [...byGroup].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [replies, filter, search, now, leadByReply, leadSort]);
  const counts = (status: QueueStatus) => replies.filter((r) => queueStatus(r, now) === status).length;
  const recheckAll = useRecheck();
  const recheckable = groups.flatMap(([, rows]) => rows).filter((r) => r.status === "drafted" && !r.recheckQueued).map((r) => r.id);
  return (
    <>
      <Toolbar>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)} aria-label="Reply status" className="rounded-lg border bg-card p-0.5">
          {FILTERS.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">
              {label}
              {value === "all" || !query.data ? "" : ` ${formatExact(counts(value))}`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <SearchBox value={search} onChange={setSearch} placeholder="Search replies, people, requests, leads…" />
        <StatusButton
          label={`Recheck all${recheckable.length ? ` ${formatExact(recheckable.length)}` : ""}`}
          icon={<RefreshCw className="size-3" aria-hidden />}
          busy={recheckAll.isPending}
          disabled={recheckAll.isPending || !recheckable.length}
          onClick={() => recheckAll.mutate(recheckable)}
        />
        <span className="text-xs text-muted-foreground">
          <SyncedNote at={query.data?.syncedAt} /> Mark sent and Skip write a new row version to ClickHouse. Snooze hides a draft from Waiting for {SNOOZE_LABEL}, then it comes back by itself. Recheck queues a draft for the next scheduled run, which re-verifies it against the latest builds.
        </span>
        {recheckAll.isError ? <span className="text-xs text-bad">Couldn't queue rechecks: {recheckAll.error instanceof Error ? recheckAll.error.message : String(recheckAll.error)}</span> : null}
      </Toolbar>
      <Loaded
        query={query}
        className="grid gap-4 sm:gap-5"
        skeleton={
          <Panel title="Reply queue">
            <ListSkeleton rows={6} />
          </Panel>
        }
      >
        {() =>
          groups.length ? (
            <>
              {groups.map(([group, rows]) => (
                <Panel key={group} title={`${groupLabel(group)} · ${formatExact(rows.length)}`} description={groupDescription(group)}>
                  {group === "lead" ? <div className="mb-3"><LeadSortControl value={leadSort} onChange={setLeadSort} /></div> : null}
                  <ul className="grid gap-2.5">
                    {rows.map((r) => (
                      <ReplyCard key={r.id} reply={r} now={now} lead={leadByReply.get(r.id)} />
                    ))}
                  </ul>
                </Panel>
              ))}
            </>
          ) : (
            <Panel title="Reply queue">
              <p className="py-6 text-center text-sm text-muted-foreground">{filter === "drafted" ? "Nothing waiting. Every drafted reply is sent, skipped or snoozed." : filter === "snoozed" ? "Nothing snoozed." : "No replies match."}</p>
            </Panel>
          )
        }
      </Loaded>
    </>
  );
}
