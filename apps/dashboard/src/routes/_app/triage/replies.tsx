import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, RotateCcw, SkipForward } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Panel } from "@/components/blocks";
import { ListSkeleton, Loaded } from "@/components/section";
import { ActionLink, CopyButton, Pill, SearchBox, SyncedNote, Toolbar, matches, platformLabel, useTriage } from "@/components/triage/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAgo, formatExact } from "@/lib/format";
import { updateReplyStatus } from "@/lib/triage-api";
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
  ["sent", "Sent"],
  ["skipped", "Skipped"],
  ["all", "All"],
] as const;

function TriageReplies() {
  const query = useTriage("replies");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("drafted");
  const [search, setSearch] = useState("");
  const replies = query.data?.replies ?? [];
  const groups = useMemo(() => {
    const shown = replies.filter((r) => (filter === "all" || r.status === filter) && matches(search, r.text, r.requester, r.topic, r.requestTitle, r.personName));
    const byPlatform = new Map<string, Reply[]>();
    for (const r of shown) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r]);
    const rank = (platform: string) => (PLATFORM_ORDER.includes(platform) ? PLATFORM_ORDER.indexOf(platform) : PLATFORM_ORDER.length);
    return [...byPlatform].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [replies, filter, search]);
  const counts = (status: Status) => replies.filter((r) => r.status === status).length;
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
        <span className="text-xs text-muted-foreground">
          <SyncedNote at={query.data?.syncedAt} /> Mark sent and Skip write a new row version to ClickHouse.
        </span>
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
                      <ReplyCard key={r.id} reply={r} />
                    ))}
                  </ul>
                </Panel>
              ))}
            </>
          ) : (
            <Panel title="Reply queue">
              <p className="py-6 text-center text-sm text-muted-foreground">{filter === "drafted" ? "Nothing waiting. Every drafted reply is sent or skipped." : "No replies match."}</p>
            </Panel>
          )
        }
      </Loaded>
    </>
  );
}

function ReplyCard({ reply }: { reply: Reply }) {
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
  const intent = reply.platform === "x" ? xReplyIntent(reply.targetUrl, reply.intentUrl, reply.text) : null;
  const pending = mutation.isPending ? mutation.variables : null;
  return (
    <li className={cn("grid gap-2 rounded-lg border bg-card px-3 py-2.5 text-xs", reply.status !== "drafted" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{reply.personName ?? reply.requester ?? "unknown"}</span>
        {reply.personName && reply.requester && reply.requester !== reply.personName ? <span className="text-muted-foreground">{reply.requester}</span> : null}
        <Pill value={reply.status} />
        {reply.requestStatus ? <Pill value={reply.requestStatus} /> : null}
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {reply.extId ?? `#${reply.id}`}
          {reply.statusAt && reply.status !== "drafted" ? ` · ${reply.status} ${formatAgo(reply.statusAt)}${reply.actor ? ` by ${reply.actor}` : ""}` : ""}
        </span>
      </div>
      {reply.topic || reply.requestTitle ? <div className="text-muted-foreground">{reply.requestTitle ?? reply.topic}</div> : null}
      {reply.asked ? <div className="text-muted-foreground">Asked: {reply.asked}</div> : null}
      <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[12.5px] whitespace-pre-wrap text-foreground">{reply.text}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {intent ? <ActionLink href={intent} primary>Reply on X</ActionLink> : null}
        {reply.targetUrl ? <ActionLink href={reply.targetUrl} primary={!intent}>Open post</ActionLink> : null}
        <CopyButton text={reply.text} />
        {reply.ref ? <span className="px-1 text-muted-foreground">Ref: {reply.ref}</span> : null}
        {reply.note ? <span className="px-1 text-muted-foreground">{reply.note}</span> : null}
        <span className="ml-auto flex gap-1.5">
          {reply.status === "drafted" ? (
            <>
              <StatusButton label="Skip" icon={<SkipForward className="size-3" aria-hidden />} busy={pending === "skipped"} disabled={mutation.isPending} onClick={() => mutation.mutate("skipped")} />
              <StatusButton label="Mark sent" icon={<Check className="size-3" aria-hidden />} busy={pending === "sent"} disabled={mutation.isPending} onClick={() => mutation.mutate("sent")} primary />
            </>
          ) : (
            <StatusButton label="Back to queue" icon={<RotateCcw className="size-3" aria-hidden />} busy={pending === "drafted"} disabled={mutation.isPending} onClick={() => mutation.mutate("drafted")} />
          )}
        </span>
      </div>
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
