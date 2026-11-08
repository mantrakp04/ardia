import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel } from "@/components/blocks";
import { ListSkeleton, Loaded } from "@/components/section";
import { LeadVideo, ReplyCard, queueStatus, useNow, type Lead, type QueueStatus, type Reply } from "@/components/triage/reply-card";
import { FilterSelect, SearchBox, SyncedNote, Toolbar, matches, optionsOf, useTriage } from "@/components/triage/shared";
import { LeadSortControl } from "@/components/triage/lead-sort";
import { compareLeads, type LeadSort } from "@/lib/lead-sort";
import { TweetCard } from "@/components/triage/tweet-card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatExact } from "@/lib/format";

export const Route = createFileRoute("/_app/triage/leads")({
  component: TriageLeads,
});

const FILTERS = [
  ["drafted", "Waiting"],
  ["snoozed", "Snoozed"],
  ["sent", "Sent"],
  ["skipped", "Skipped"],
  ["all", "All"],
] as const;

type Filter = (typeof FILTERS)[number][0];

const leadStatus = (lead: Lead, reply: Reply | undefined, now: number): QueueStatus =>
  reply ? queueStatus(reply, now) : lead.status === "dismissed" ? "skipped" : "drafted";

function TriageLeads() {
  const query = useTriage("replies");
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("drafted");
  const [sort, setSort] = useState<LeadSort>("newest");
  const [feature, setFeature] = useState("");
  const [search, setSearch] = useState("");
  const leads = query.data?.leads ?? [];
  const replyById = useMemo(() => new Map((query.data?.replies ?? []).map((r) => [r.id, r])), [query.data?.replies]);
  const replyOf = (lead: Lead) => (lead.replyId == null ? undefined : replyById.get(lead.replyId));
  const shown = useMemo(() => {
    const rows = leads.filter(
      (l) =>
        (filter === "all" || leadStatus(l, replyOf(l), now) === filter) &&
        (!feature || l.feature === feature) &&
        matches(search, l.text, l.author.handle, l.author.name, l.topic, replyOf(l)?.text),
    );
    return rows.sort((a, b) => compareLeads(a, b, sort));
  }, [leads, replyById, filter, feature, search, sort, now]);
  const counts = (status: QueueStatus) => leads.filter((l) => leadStatus(l, replyOf(l), now) === status).length;
  const withVideo = leads.filter((l) => l.video).length;
  const timestamped = leads.filter((l) => l.video?.t != null).length;
  return (
    <>
      <Toolbar>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} aria-label="Lead status" className="rounded-lg border bg-card p-0.5">
          {FILTERS.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background">
              {label}
              {value === "all" || !query.data ? "" : ` ${formatExact(counts(value))}`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <LeadSortControl value={sort} onChange={setSort} />
        <FilterSelect label="Feature" value={feature} onChange={setFeature} options={optionsOf(leads, (l) => l.feature)} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search posts, handles, drafts…" />
        <span className="text-xs text-muted-foreground">
          <SyncedNote at={query.data?.syncedAt} /> Every lead is also in the Reply queue. Drafts are never posted for you.
        </span>
      </Toolbar>
      <Loaded
        query={query}
        className="grid gap-4 sm:gap-5"
        skeleton={
          <Panel title="Leads">
            <ListSkeleton rows={6} />
          </Panel>
        }
      >
        {() => (
          <Panel
            title={`Leads · ${formatExact(shown.length)}`}
            description={`Posts from the browser crowd on X (Arc's shutdown, Dia, Zen, Comet, Atlas, people asking what to switch to), sourced by the triage routine with a drafted reply. ${formatExact(withVideo)} of ${formatExact(leads.length)} link a release video, ${formatExact(timestamped)} at the feature's timestamp.`}
          >
            {shown.length ? (
              <ul className="grid gap-3">
                {shown.map((lead) => {
                  const reply = replyOf(lead);
                  return reply ? (
                    <ReplyCard key={lead.id} reply={reply} now={now} lead={lead} />
                  ) : (
                    <li key={lead.id} className="grid gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs">
                      <TweetCard post={lead} />
                      <LeadVideo lead={lead} />
                      <p className="text-muted-foreground">No drafted reply yet.</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {leads.length ? "No leads match." : "No leads yet. The triage routine adds them as it finds browser-tpot posts on X."}
              </p>
            )}
          </Panel>
        )}
      </Loaded>
    </>
  );
}
