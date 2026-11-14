import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, AlarmClockOff, Check, Film, RefreshCw, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ActionLink, CopyButton, Ext, Pill } from "@/components/triage/shared";
import { TweetCard } from "@/components/triage/tweet-card";
import { formatAgo } from "@/lib/format";
import { requestReplyRecheck, snoozeReply, updateReplyStatus } from "@/lib/triage-api";
import { xReplyIntent } from "@/lib/triage-links";
import { videoTimestampLabel } from "@/lib/tweet-text";
import { cn } from "@/lib/utils";
import type { TriageData } from "@/server/triage/load";

export type Reply = TriageData<"replies">["replies"][number];
export type Lead = TriageData<"replies">["leads"][number];
type Status = Reply["status"];
export type QueueStatus = "drafted" | "snoozed" | "sent" | "skipped";

export const isSnoozed = (r: Reply, now: number) => r.status === "drafted" && r.snoozedUntil != null && r.snoozedUntil > now;
export const queueStatus = (r: Reply, now: number): QueueStatus => (isSnoozed(r, now) ? "snoozed" : r.status);

const formatUntil = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useRecheck() {
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

export const SNOOZE_LABEL = "1 day";

export function ReplyCard({ reply, now, lead }: { reply: Reply; now: number; lead?: Lead | null }) {
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
        {lead ? <Pill value="lead" /> : null}
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
      {lead ? <TweetCard post={lead} /> : reply.asked ? <div className="text-muted-foreground">Asked: {reply.asked}</div> : null}
      {lead ? <LeadVideo lead={lead} /> : null}
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
        <CopyButton text={reply.text} label={lead ? "Copy reply" : "Copy text"} />
        {reply.ref && !lead ? <span className="px-1 text-muted-foreground">Ref: {reply.ref}</span> : null}
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

export function StatusButton({ label, icon, onClick, disabled, busy, primary }: { label: string; icon: ReactNode; onClick: () => void; disabled: boolean; busy: boolean; primary?: boolean }) {
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

export function LeadVideo({ lead }: { lead: Lead }) {
  const label = videoTimestampLabel(lead.video?.t);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
      <Film className="size-3.5 shrink-0" aria-hidden />
      {lead.video ? (
        <>
          <Ext href={lead.video.url} className="font-medium text-foreground">
            {lead.video.chapter ?? lead.video.id ?? "Release video"}
            {label ? ` at ${label}` : ""}
          </Ext>
          {lead.video.release ? <span className="font-mono text-[10.5px]">{lead.video.release}</span> : null}
          {label ? null : <span>(no timestamp)</span>}
        </>
      ) : (
        <span>No release video covers this</span>
      )}
      {lead.feature ? <Pill value={lead.feature} /> : null}
      {lead.videoNote ? (
        <span className="basis-full text-[11px]" title={lead.videoNote}>
          {lead.videoNote}
        </span>
      ) : null}
    </div>
  );
}
