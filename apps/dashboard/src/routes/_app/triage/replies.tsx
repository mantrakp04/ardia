import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlarmClock, AlarmClockOff, Check, RefreshCw, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Panel } from "@/components/blocks";
import { ListSkeleton, Loaded } from "@/components/section";
import { ActionLink, CopyButton, Pill, SearchBox, SyncedNote, Toolbar, matches, platformLabel, useTriage } from "@/components/triage/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAgo, formatExact } from "@/lib/format";
import { requestReplyRecheck, snoozeReply, updateReplyStatus } from "@/lib/triage-api";
import { xReplyIntent } from "@/lib/triage-links";
import { cn } from "@/lib/utils";
import type { TriageData } from "@/server/triage/load";

export const Route = createFileRoute("/_app/triage/replies")({
  component: TriageReplies,
});

type Reply = TriageData<"replies">["replies"][number];
type Status = Reply["status"];

const PLATFORM_ORDER = ["x", "discord", "github"];
const FILTERS = [
  ["drafted", "Waiting"],
  ["snoozed", "Snoozed"],
  ["sent", "Sent"],
  ["skipped", "Skipped"],
  ["all", "All"],
] as const;

type Filter = (typeof FILTERS)[number][0];

// A snoozed draft leaves the Waiting view until its snooze runs out, then shows up there again by itself.
const isSnoozed = (r: Reply, now: number) => r.status === "drafted" && r.snoozedUntil != null && r.snoozedUntil > now;
const queueStatus = (r: Reply, now: number): Exclude<Filter, "all"> => (isSnoozed(r, now) ? "snoozed" : r.status);

const formatUntil = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// re-render once a minute so expired snoozes drop back into Waiting without a reload
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function useRecheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => requestReplyRecheck({ data: { ids } }),
    onSuccess: (result) => {
      const rechecked = new Set(result.ids);
      queryClient.setQueryData<TriageData<"replies">>(["triage", "replies"], (old) =>
        old ? { ...old, replies: old.replies.map((r) => (rechecked.has(r.id) ? { ...r, recheckQueued: true, recheckRequestedAt: result.at, recheckRequestedBy: null } : r)) } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["triage"], refetchType: "none" });
    },
  });
}

function TriageReplies() {
  const query = useTriage("replies");
  const [filter, setFilter] = useState<Filter>("drafted");
  const now = useNow();
  const [search, setSearch] = useState("");
  const replies = query.data?.replies ?? [];
  const groups = useMemo(() => {
    const shown = replies.filter((r) => (filter === "all" || queueStatus(r, now) === filter) && matches(search, r.text, r.requester, r.topic, r.requestTitle, r.personName));
    const byPlatform = new Map<string, Reply[]>();
    for (const r of shown) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r]);
    const rank = (platform: string) => (PLATFORM_ORDER.includes(platform) ? PLATFORM_ORDER.indexOf(platform) : PLATFORM_ORDER.length);
    return [...byPlatform].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [replies, filter, search, now]);
  const counts = (status: Exclude<Filter, "all">) => replies.filter((r) => queueStatus(r, now) === status).length;
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
        <SearchBox value={search} onChange={setSearch} placeholder="Search replies, people, requests…" />
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
              {groups.map(([platform, rows]) => (
                <Panel key={platform} title={`${platformLabel(platform)} · ${formatExact(rows.length)}`} description={platform === "x" ? "Reply opens X's composer as a reply to the post, with the text filled in." : "Open the post, paste the copied text, then mark it sent."}>
                  <ul className="grid gap-2.5">
                    {rows.map((r) => (
                      <ReplyCard key={r.id} reply={r} now={now} />
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

const SNOOZE_LABEL = "1 day";

function ReplyCard({ reply, now }: { reply: Reply; now: number }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: Status) => updateReplyStatus({ data: { id: reply.id, status } }),
    onSuccess: (result) => {
      queryClient.setQueryData<TriageData<"replies">>(["triage", "replies"], (old) =>
        old ? { ...old, replies: old.replies.map((r) => (r.id === result.id ? { ...r, status: result.status, statusAt: result.at } : r)) } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["triage"], refetchType: "none" });
    },
  });
  const snooze = useMutation({
    mutationFn: (on: boolean) => snoozeReply({ data: { id: reply.id, snooze: on } }),
    onSuccess: (result) => {
      queryClient.setQueryData<TriageData<"replies">>(["triage", "replies"], (old) =>
        old ? { ...old, replies: old.replies.map((r) => (r.id === result.id ? { ...r, snoozedUntil: result.snoozedUntil, snoozedBy: result.snoozedBy } : r)) } : old,
      );
      queryClient.invalidateQueries({ queryKey: ["triage"], refetchType: "none" });
    },
  });
  const snoozed = isSnoozed(reply, now);
  const recheck = useRecheck();
  const intent = reply.platform === "x" ? xReplyIntent(reply.targetUrl, reply.intentUrl, reply.text) : null;
  const pending = mutation.isPending ? mutation.variables : null;
  return (
    <li className={cn("grid gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs", (reply.status !== "drafted" || snoozed) && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{reply.personName ?? reply.requester ?? "unknown"}</span>
        {reply.personName && reply.requester && reply.requester !== reply.personName ? <span className="text-muted-foreground">{reply.requester}</span> : null}
        <Pill value={reply.status} />
        {snoozed && reply.snoozedUntil ? (
          <span title={`Snoozed${reply.snoozedBy ? ` by ${reply.snoozedBy}` : ""}; back in Waiting ${formatUntil(reply.snoozedUntil)}`}>
            <Pill value="snoozed" />
            <span className="ml-1 text-muted-foreground">until {formatUntil(reply.snoozedUntil)}</span>
          </span>
        ) : null}
        {reply.requestStatus ? <Pill value={reply.requestStatus} /> : null}
        {reply.recheckQueued ? (
          <span title={reply.recheckRequestedAt ? `Recheck requested ${formatAgo(reply.recheckRequestedAt)}${reply.recheckRequestedBy ? ` by ${reply.recheckRequestedBy}` : ""}` : undefined}>
            <Pill value="recheck queued" />
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {reply.extId ?? `#${reply.id}`}
          {reply.lastCheckedAt ? ` · checked ${formatAgo(reply.lastCheckedAt)}` : " · never checked"}
          {reply.statusAt && reply.status !== "drafted" ? ` · ${reply.status} ${formatAgo(reply.statusAt)}${reply.actor ? ` by ${reply.actor}` : ""}` : ""}
        </span>
      </div>
      {reply.topic || reply.requestTitle ? <div className="text-muted-foreground">{reply.requestTitle ?? reply.topic}</div> : null}
      {reply.asked ? <div className="text-muted-foreground">Asked: {reply.asked}</div> : null}
      <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[12.5px] whitespace-pre-wrap text-foreground">{reply.text}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {intent ? <ActionLink href={intent} primary>Reply on X</ActionLink> : null}
        {reply.targetUrl && !intent ? <ActionLink href={reply.targetUrl} primary>Open post</ActionLink> : null}
        {reply.status === "drafted" ? (
          <>
            <StatusButton label="Mark sent" icon={<Check className="size-3" aria-hidden />} busy={pending === "sent"} disabled={mutation.isPending} onClick={() => mutation.mutate("sent")} primary />
            <StatusButton label="Skip" icon={<SkipForward className="size-3" aria-hidden />} busy={pending === "skipped"} disabled={mutation.isPending} onClick={() => mutation.mutate("skipped")} />
            {snoozed ? (
              <StatusButton label="Unsnooze" icon={<AlarmClockOff className="size-3" aria-hidden />} busy={snooze.isPending} disabled={snooze.isPending} onClick={() => snooze.mutate(false)} />
            ) : (
              <StatusButton label="Snooze 1 day" icon={<AlarmClock className="size-3" aria-hidden />} busy={snooze.isPending} disabled={snooze.isPending} onClick={() => snooze.mutate(true)} />
            )}
          </>
        ) : null}
        {reply.targetUrl && intent ? <ActionLink href={reply.targetUrl}>Open post</ActionLink> : null}
        <CopyButton text={reply.text} />
        {reply.ref ? <span className="px-1 text-muted-foreground">Ref: {reply.ref}</span> : null}
        {reply.note ? <span className="px-1 text-muted-foreground">{reply.note}</span> : null}
        <span className="ml-auto flex gap-1.5">
          {reply.status === "drafted" ? (
            <StatusButton
              label={reply.recheckQueued ? "Recheck queued" : "Recheck"}
              icon={<RefreshCw className="size-3" aria-hidden />}
              busy={recheck.isPending}
              disabled={recheck.isPending || reply.recheckQueued}
              onClick={() => recheck.mutate([reply.id])}
            />
          ) : (
            <StatusButton label="Back to queue" icon={<RotateCcw className="size-3" aria-hidden />} busy={pending === "drafted"} disabled={mutation.isPending} onClick={() => mutation.mutate("drafted")} />
          )}
        </span>
      </div>
      {recheck.isError ? <div className="text-bad">Couldn't queue recheck: {recheck.error instanceof Error ? recheck.error.message : String(recheck.error)}</div> : null}
      {snooze.isError ? <div className="text-bad">Couldn't snooze: {snooze.error instanceof Error ? snooze.error.message : String(snooze.error)}</div> : null}
      {mutation.isError ? <div className="text-bad">Couldn't save: {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}</div> : null}
    </li>
  );
}

function StatusButton({ label, icon, onClick, disabled, busy, primary }: { label: string; icon: ReactNode; onClick: () => void; disabled: boolean; busy: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50",
        primary && "border-good/40 bg-good/12 text-good hover:bg-good/20",
      )}
    >
      {icon}
      {busy ? "Saving…" : label}
    </button>
  );
}
