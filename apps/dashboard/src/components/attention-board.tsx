import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pin, X, Clock, ChevronRight } from "lucide-react";
import type { SectionData } from "@/server/sections";
import { updateAttention } from "@/lib/attention-api";
import { effectiveAttention, overlayAttentionAction, goalReady, isGoal, previewDocument, safeSource, type AttentionItem, type AttentionStatus } from "@/lib/attention-model";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

function Preview({ html, label }: { html: string; label: string }) {
  return <iframe title={`${label} preview`} sandbox="" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={previewDocument(html)} className="pointer-events-none h-full min-h-28 w-full border-0" />;
}
const trackedTime = (s: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(s)) + " PT";

export function AttentionBoard({ items }: { items: AttentionItem[] }) {
  const [tab, setTab] = useState<"tasks" | "pinned">("tasks");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const rows = items.map((item) => effectiveAttention(item, now));
  const tasks = rows.filter((r) => r.status === "open");
  const pinned = rows.filter((r) => r.status === "pinned");
  const settled = rows.filter((r) => r.status === "done" || r.status === "dismissed");
  const sleeping = rows.filter((r) => r.status === "snoozed");
  const current = rows.find((r) => r.id === selected);
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (data: { item: AttentionItem; status: AttentionStatus; until?: string }) => updateAttention({ data }),
    onSuccess: (result, data) => {
      queryClient.setQueriesData<SectionData<"attention">>({ queryKey: ["section", "attention"] }, (old) => old ? {
        ...old, items: old.items.map((r) => r.id === result.id ? effectiveAttention(overlayAttentionAction(r, data.item, result.status, result.at, data.until || null)) : r),
      } : old);
      void queryClient.invalidateQueries({ queryKey: ["section", "attention"] });
    },
  });
  const act = (item: AttentionItem, status: AttentionStatus, until?: string) => action.mutate({ item, status, until });
  const display = (item: AttentionItem) => {
    const goal = isGoal(item) || ((item.status === "done" || item.status === "dismissed") && goalReady(item));
    const ready = goal && goalReady(item);
    return {
      label: ready ? item.goal_label! : goal ? "Set a goal: " + item.label.slice(0, 38) : item.label,
      preview: ready ? item.goal_preview_html! : goal ? '<span class="chip">New goal</span><h2>Tracking starts next run</h2><p>The routine will rewrite this as a goal, then check its progress each run.</p>' : item.preview_html,
      report: ready ? item.goal_report! : goal ? "Tracking starts next run. The routine will turn this task into an outcome, with progress and the next step.\n\nOriginal task\n" + item.report : item.report,
    };
  };
  const controls = (item: AttentionItem) => <Actions item={item} busy={action.isPending} onAction={act} />;
  const card = (item: AttentionItem) => {
    const view = display(item);
    return <article key={item.id} className="flex aspect-square flex-col overflow-hidden rounded-xl border bg-card shadow-none">
      <button type="button" onClick={() => setSelected(item.id)} className="group flex min-h-0 flex-1 flex-col text-left outline-none hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`Open report: ${view.label}`}>
        <div className="flex w-full items-start justify-between gap-2 px-4 pt-4"><h2 className="line-clamp-2 text-sm font-semibold">{view.label}</h2><ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /></div>
        <div className="min-h-0 w-full flex-1 overflow-hidden"><Preview html={view.preview} label={view.label} /></div>
        {isGoal(item) ? <p className="px-4 pb-2 text-[11px] text-muted-foreground">{goalReady(item) && item.last_tracked_at ? `Checked ${trackedTime(item.last_tracked_at)}` : "Waiting for the next routine run"}{item.progress != null ? ` · ${item.progress}%` : ""}</p> : null}
      </button>
      <div className="border-t px-3 py-2">{controls(item)}</div>
    </article>;
  };
  return <section aria-label="Attention tasks and goals" className="grid gap-4">
    <div role="tablist" aria-label="Needs attention views" className="flex w-fit gap-1 rounded-lg border bg-card p-1">
      {([['tasks', `Tasks · ${tasks.length}`], ['pinned', `Pinned · ${pinned.length}`]] as const).map(([id, title]) => <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)} className={`rounded-md px-4 py-2 text-sm ${tab === id ? "bg-accent font-semibold" : "text-muted-foreground"}`}>{title}</button>)}
    </div>
    {action.isError ? <p role="alert" className="text-sm text-bad">Could not save. {action.error instanceof Error ? action.error.message : "Try again."}</p> : null}
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {(tab === "tasks" ? tasks : pinned).length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">{(tab === "tasks" ? tasks : pinned).map(card)}</div> : <p className="rounded-xl border p-8 text-sm text-muted-foreground">{tab === "tasks" ? "Nothing needs a look right now." : "Pin a task to track it as a goal."}</p>}
    </div>
    {tab === "tasks" ? <>
      <details className="rounded-xl border bg-card px-4 py-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Snoozed · {sleeping.length}</summary><ul className="mt-3 grid gap-3">{sleeping.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2"><button className="text-left underline" onClick={() => setSelected(r.id)}>{display(r).label}</button><span className="text-xs text-muted-foreground">Back {r.snooze_until ? trackedTime(r.snooze_until) : "later"}</span><Button size="sm" variant="outline" disabled={action.isPending} onClick={() => act(r, r.resume_status === "pinned" ? "pinned" : "open")}>Wake now</Button></li>)}</ul></details>
      <details className="rounded-xl border bg-card px-4 py-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Settled · {settled.length}</summary><ul className="mt-3 divide-y">{settled.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-3 py-3"><span className={r.status === "done" ? "text-good" : "text-muted-foreground"}>{r.status === "done" ? <Check className="inline size-4" aria-hidden /> : <X className="inline size-4" aria-hidden />} {r.status === "done" ? "Done" : "Dismissed"}</span><button className="flex-1 text-left underline" onClick={() => setSelected(r.id)}>{display(r).label}</button><Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => act(r, "open")}>Reopen</Button></li>)}</ul></details>
    </> : null}
    <Sheet open={!!current} onOpenChange={(open) => !open && setSelected(null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {current ? <><SheetHeader className="pr-10"><SheetTitle>{display(current).label}</SheetTitle><SheetDescription>{isGoal(current) ? "Goal · progress and next step" : "Task · what needs a look"}</SheetDescription></SheetHeader>
          <div className="grid gap-5 px-4 pb-8">
            <div className="h-48 rounded-lg border"><Preview html={display(current).preview} label={display(current).label} /></div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{display(current).report}</div>
            <nav aria-label="Report sources" className="flex flex-wrap gap-3">{current.source_links.filter((l) => safeSource(l.url)).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">{l.label}</a>)}</nav>
            {controls(current)}
            {isGoal(current) && goalReady(current) ? <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs text-muted-foreground">Original task</summary><p className="mt-3 whitespace-pre-wrap text-sm">{current.report}</p></details> : null}
          </div></> : null}
      </SheetContent>
    </Sheet>
  </section>;
}

function Actions({ item, busy, onAction }: { item: AttentionItem; busy: boolean; onAction: (item: AttentionItem, status: AttentionStatus, until?: string) => void }) {
  const [snoozing, setSnoozing] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const snooze = (until: string) => { if (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()) { setError("Choose a future time."); return; } setError(""); onAction(item, "snoozed", until); setSnoozing(false); };
  return <div className="grid gap-2"><div className="flex flex-wrap items-center gap-1">
    {item.status !== "pinned" ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction(item, "pinned")}><Pin className="size-3" />Pin</Button> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction(item, "open")}>Unpin</Button>}
    <Button variant="ghost" size="sm" disabled={busy || item.status === "done"} onClick={() => onAction(item, "done")}><Check className="size-3" />Done</Button>
    <Button variant="ghost" size="sm" disabled={busy || item.status === "dismissed"} onClick={() => onAction(item, "dismissed")}><X className="size-3" />Dismiss</Button>
    <Popover.Root open={snoozing} onOpenChange={setSnoozing}><Popover.Trigger asChild><Button variant="ghost" size="sm" disabled={busy}><Clock className="size-3" />Snooze</Button></Popover.Trigger>
    <Popover.Portal><Popover.Content align="end" sideOffset={8} className="z-[70] grid w-72 gap-2 rounded-lg border bg-background p-3 text-xs shadow-lg" aria-label="Snooze task">
    <div className="flex flex-wrap gap-1">{[[1, "1 day"], [3, "3 days"], [7, "1 week"]].map(([days, title]) => <Button key={days} variant="outline" size="sm" disabled={busy} onClick={() => snooze(new Date(Date.now() + Number(days) * 86_400_000).toISOString())}>{title}</Button>)}</div>
    <label className="grid gap-1">Custom time (your local time)<input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="min-w-0 rounded border bg-background p-2" /></label>
    <Button size="sm" variant="outline" disabled={busy || !custom} onClick={() => { const date = new Date(custom); if (!Number.isFinite(date.getTime())) { setError("Choose a time."); return; } snooze(date.toISOString()); }}>Set time</Button>
    {error ? <p role="alert">{error}</p> : null}
    </Popover.Content></Popover.Portal></Popover.Root>
  </div></div>;
}
