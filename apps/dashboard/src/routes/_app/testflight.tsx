import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, StatsSkeleton, TableSkeleton } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAgo, formatDateTime, formatExact } from "@/lib/format";
import { clearTestflightJunk, getTestflightSignups, removeTestflightSignup } from "@/lib/testflight-api";
import { cn } from "@/lib/utils";
import type { TestflightList, TestflightSignup } from "@/server/testflight";
import type { JunkReason } from "@/server/testflight-signups";

const WEEK_MS = 7 * 86_400_000;
const QUERY_KEY = ["testflight"] as const;

const JUNK_LABEL: Record<JunkReason, string> = {
  honeypot: "Bots that filled the hidden field",
  "bad-email": "Not a valid email",
  "no-email": "No email in it",
  "not-object": "JSON, but not a form",
  "not-json": "Not JSON",
  empty: "Empty",
  "too-large": "Over 1 KB",
};

export const Route = createFileRoute("/_app/testflight")({
  head: () => ({ meta: [{ title: "TestFlight · Ardia" }] }),
  component: TestflightPage,
});

type Ready = Extract<TestflightList, { configured: true }>;

function TestflightPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getTestflightSignups({ data: {}, signal }),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const refresh = useMutation({
    mutationFn: () => getTestflightSignups({ data: { fresh: true } }),
    onSuccess: (data) => queryClient.setQueryData(QUERY_KEY, data),
  });

  return (
    <>
      <PageHeader title="TestFlight" description="People who left their email on ardia.dev to try the iPhone app. Copy the list into App Store Connect to invite them." />
      <Loaded query={query} skeleton={<Skeletons />}>
        {(data) => (data.configured ? <SignupView data={data} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} refreshError={refresh.error} /> : <NotConfigured hint={data.hint} />)}
      </Loaded>
    </>
  );
}

function Skeletons() {
  return (
    <div className="grid gap-4 sm:gap-5">
      <Card className="grid grid-cols-3 gap-x-4 px-4 py-4 shadow-none sm:px-5">
        <StatsSkeleton count={3} />
      </Card>
      <Card className="px-4 py-4 shadow-none sm:px-5">
        <TableSkeleton rows={8} columns={3} />
      </Card>
    </div>
  );
}

function NotConfigured({ hint }: { hint: string }) {
  return (
    <Panel title="Storage is not set up" description="This dashboard can't reach the place the signups are kept.">
      <p className="text-sm text-muted-foreground">{hint}</p>
    </Panel>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-bad/25 bg-bad/[0.06] px-3 py-2.5 text-xs text-foreground/80">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-bad" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function SignupView({ data, refreshing, onRefresh, refreshError }: { data: Ready; refreshing: boolean; onRefresh: () => void; refreshError: Error | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [data.readAt]);
  const junkTotal = Object.values(data.junk).reduce((a, b) => a + b, 0);
  const newThisWeek = data.signups.filter((s) => now - s.at < WEEK_MS).length;
  const repeats = data.signups.filter((s) => s.copies > 1).length;

  return (
    <div className="grid gap-4 sm:gap-5">
      <Card className="grid grid-cols-3 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:px-5">
        <Stat label="On the list" value={formatExact(data.signups.length)} sub={repeats ? `${formatExact(repeats)} asked more than once` : "one row per email"} />
        <Stat label="New this week" value={formatExact(newThisWeek)} sub="last 7 days" />
        <Stat label="Junk dropped" value={formatExact(junkTotal)} sub="bots and broken posts" />
      </Card>

      {data.capped ? <Notice>Only the first {formatExact(data.maxObjects)} stored posts were read, so the list may be missing people.{junkTotal ? " Clear the junk below to read further." : ""}</Notice> : null}
      {data.unreadable ? <Notice>{formatExact(data.unreadable)} {data.unreadable === 1 ? "post" : "posts"} couldn't be read{data.timedOut ? " in time" : ""}. Refresh to try again.</Notice> : null}
      {refreshError ? <Notice>Couldn't refresh: {refreshError.message}</Notice> : null}

      <Panel
        title="People"
        description={`Newest first. Read ${formatAgo(data.readAt, now)}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <CopyEmails emails={data.signups.map((s) => s.email)} />
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              <RotateCw className={refreshing ? "animate-spin" : undefined} aria-hidden />
              Refresh
            </Button>
          </div>
        }
        bodyClassName="px-0 sm:px-0"
      >
        <div className="px-2 sm:px-3">
          <SignupTable signups={data.signups} />
        </div>
      </Panel>

      {junkTotal ? <JunkDetails data={data} total={junkTotal} /> : null}
    </div>
  );
}

function CopyEmails({ emails }: { emails: string[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <Button size="sm" onClick={copy} disabled={!emails.length} aria-live="polite">
      {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      {state === "copied" ? `Copied ${formatExact(emails.length)}` : state === "failed" ? "Couldn't copy" : "Copy emails"}
    </Button>
  );
}

function SignupTable({ signups }: { signups: TestflightSignup[] }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (email: string) => removeTestflightSignup({ data: { email } }),
    onSettled: () => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const outcome = useMemo(() => {
    if (remove.isError) return { bad: true, text: `Couldn't remove: ${remove.error.message}` };
    const r = remove.data;
    if (!r) return null;
    if (!r.found) return r.complete ? { bad: false, text: "That email was already gone." } : { bad: true, text: `Couldn't find ${remove.variables}, because the stored posts couldn't all be read. Refresh and try again.` };
    if (r.failed) return { bad: true, text: `Removed ${r.removed} of ${r.removed + r.failed} stored posts. Try again for the rest.` };
    if (!r.complete) return { bad: true, text: `Removed the posts found for ${remove.variables}, but the stored posts couldn't all be read, so a copy may be left. Refresh and check.` };
    return { bad: false, text: `Removed ${remove.variables}.` };
  }, [remove.data, remove.error, remove.isError, remove.variables]);

  return (
    <div className="grid gap-2">
      {outcome ? <p role="status" className={cn("px-2 pt-1 text-xs", outcome.bad ? "text-bad" : "text-muted-foreground")}>{outcome.text}</p> : null}
      <DataTable
        dense
        rows={signups}
        rowKey={(s) => s.key}
        initialSort={{ key: "at", desc: true }}
        empty="No one has asked yet."
        columns={[
          {
            key: "email",
            header: "Email",
            sort: (s) => s.key,
            cell: (s) => (
              <span className="grid min-w-0 gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="max-w-[13rem] truncate font-mono text-[11.5px] sm:max-w-[28rem]" title={s.email}>
                    {s.email}
                  </span>
                  {s.copies > 1 ? (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground" title={`Asked ${s.copies} times`}>
                      ×{s.copies}
                    </span>
                  ) : null}
                </span>
                <span className="text-[10.5px] text-muted-foreground sm:hidden">{formatDateTime(s.at)}</span>
              </span>
            ),
          },
          { key: "at", header: "Asked on", sort: (s) => s.at, className: "hidden w-px whitespace-nowrap sm:table-cell", cell: (s) => <span className="text-muted-foreground">{formatDateTime(s.at)}</span> },
          {
            key: "remove",
            header: "",
            align: "right",
            className: "w-px whitespace-nowrap",
            cell: (s) =>
              confirming === s.key ? (
                <span className="inline-flex items-center gap-1">
                  <Button variant="destructive" size="xs" disabled={remove.isPending} onClick={() => remove.mutate(s.key)}>
                    {remove.isPending ? "Removing…" : "Remove"}
                  </Button>
                  <Button variant="ghost" size="xs" disabled={remove.isPending} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${s.email}`} title="Remove" disabled={remove.isPending} onClick={() => setConfirming(s.key)}>
                  <Trash2 aria-hidden />
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}

function JunkDetails({ data, total }: { data: Ready; total: number }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const clear = useMutation({
    mutationFn: () => clearTestflightJunk(),
    onSettled: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const outcome = useMemo(() => {
    if (clear.isError) return { bad: true, text: `Couldn't clear the junk: ${clear.error.message}` };
    const r = clear.data;
    if (!r) return null;
    if (r.failed) return { bad: true, text: `Cleared ${formatExact(r.removed)} of ${formatExact(r.found)} junk posts. Clear again for the rest.` };
    if (!r.complete) return { bad: true, text: `Cleared ${formatExact(r.removed)} junk posts. The stored posts couldn't all be read, so more may be left. Refresh and clear again.` };
    return { bad: false, text: `Cleared ${formatExact(r.removed)} junk posts.` };
  }, [clear.data, clear.error, clear.isError]);
  const rows = (Object.keys(JUNK_LABEL) as JunkReason[]).filter((reason) => data.junk[reason] > 0);
  return (
    <details className="rounded-xl border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Junk dropped · {formatExact(total)}</summary>
      <p className="mt-2 text-xs text-muted-foreground">Posts that never reach the list. They stay in storage until you clear them.</p>
      <ul className="mt-3 grid max-w-md gap-1.5">
        {rows.map((reason) => (
          <li key={reason} className="flex justify-between gap-4 text-xs">
            <span>{JUNK_LABEL[reason]}</span>
            <span className="tnum text-muted-foreground">{formatExact(data.junk[reason])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{formatExact(data.scanned)} stored posts read in all.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <Button variant="destructive" size="xs" disabled={clear.isPending} onClick={() => clear.mutate()}>
              {clear.isPending ? "Clearing…" : `Delete ${formatExact(total)} junk posts`}
            </Button>
            <Button variant="ghost" size="xs" disabled={clear.isPending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="xs" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            Clear junk
          </Button>
        )}
      </div>
      {outcome ? <p role="status" className={cn("mt-2 text-xs", outcome.bad ? "text-bad" : "text-muted-foreground")}>{outcome.text}</p> : null}
    </details>
  );
}
