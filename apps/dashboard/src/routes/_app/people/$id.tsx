import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { PageHeader, Panel } from "@/components/blocks";
import { Fact, IssueChip, KindPill, STATUS_HINT, SourcePill, StatusPill, VersionTag } from "@/components/people-ui";
import { Avatar } from "@/components/person";
import { SectionError, TableSkeleton } from "@/components/section";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAgo, formatDate, formatDateTime } from "@/lib/format";
import { identityOf } from "@/lib/identity";
import { getPerson } from "@/lib/people-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/people/$id")({
  head: () => ({ meta: [{ title: "Person · Ardia" }] }),
  component: PersonPage,
});

type Detail = NonNullable<Awaited<ReturnType<typeof getPerson>>>;
type Session = Detail["sessions"][number];
type TimelineEvent = Session["events"][number];

const TONE: Record<TimelineEvent["tone"], string> = {
  neutral: "bg-muted-foreground/40",
  good: "bg-good",
  warn: "bg-chart-5",
  bad: "bg-bad",
};

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function PersonPage() {
  const { id } = Route.useParams();
  const [pages, setPages] = useState<(number | null)[]>([null]);
  const first = useQuery({
    queryKey: ["person", id, null],
    queryFn: ({ signal }) => getPerson({ data: { id, before: null }, signal }),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const identity = identityOf(id);

  return (
    <>
      <Link to="/people" search={(prev) => ({ range: prev.range })} className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        People
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar id={id} size={56} />
        <PageHeader title={identity.name} description={<span className="font-mono text-xs">{id}</span>} />
      </div>

      {first.isError ? <SectionError error={first.error} onRetry={() => first.refetch()} /> : null}
      {first.data === null ? <Card className="px-5 py-6 text-sm text-muted-foreground shadow-none">No events from this install.</Card> : null}
      {first.data === undefined && !first.isError ? <Skeleton className="h-28 rounded-xl" /> : null}
      {first.data ? <Header d={first.data} /> : null}
      {first.data ? <Reports d={first.data} /> : null}

      <Panel source="app" title="Timeline" description="Grouped by app session ($session_id). Older events without one start a new group at each launch or after 30 minutes with no events (the hourly memory and usage reports count). Click an event for its properties. Times are local.">
        {first.data === undefined ? <TableSkeleton rows={8} columns={3} /> : null}
        {first.data ? (
          <div className="grid gap-3">
            <Sessions sessions={first.data.sessions} />
            {pages.slice(1).map((before) => (before ? <OlderPage key={before} id={id} before={before} onMore={(next) => setPages((p) => (p.includes(next) ? p : [...p, next]))} last={pages.at(-1) === before} /> : null))}
            {pages.length === 1 && first.data.before ? (
              <button type="button" onClick={() => setPages([null, first.data!.before])} className="self-start rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-accent">
                Load older events
              </button>
            ) : null}
            {!first.data.sessions.length ? <p className="py-6 text-center text-sm text-muted-foreground">No timeline events.</p> : null}
          </div>
        ) : null}
      </Panel>
    </>
  );
}

function OlderPage({ id, before, onMore, last }: { id: string; before: number; onMore: (before: number) => void; last: boolean }) {
  const query = useQuery({
    queryKey: ["person", id, before],
    queryFn: ({ signal }) => getPerson({ data: { id, before }, signal }),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  if (query.isError) return <SectionError error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return <TableSkeleton rows={4} columns={3} />;
  return (
    <>
      <Sessions sessions={query.data.sessions} />
      {last && query.data.before ? (
        <button type="button" onClick={() => onMore(query.data!.before!)} className="self-start rounded-md border bg-card px-2.5 py-1 text-xs hover:bg-accent">
          Load older events
        </button>
      ) : null}
    </>
  );
}

function Header({ d }: { d: Detail }) {
  const p = d.person;
  const now = Date.now();
  const watching = p.watchUntil && p.watchUntil > now;
  return (
    <Card className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
      <Fact label="Version now">{p.version ? <VersionTag version={p.version} channel={p.channel} /> : "–"}</Fact>
      <Fact label="Mac">
        {p.chip ? `${p.chip.replace(/^Apple /, "")}${p.memoryGb ? ` · ${p.memoryGb} GB` : ""}` : "–"}
        {d.os ? <span className="block text-xs text-muted-foreground">macOS {d.os}{d.arch ? ` · ${d.arch}` : ""}</span> : null}
      </Fact>
      <Fact label="First seen">
        {formatDate(p.firstSeen)}
        <span className="block text-xs text-muted-foreground">{formatAgo(p.firstSeen, now)}</span>
      </Fact>
      <Fact label="Last seen">
        {formatAgo(p.lastSeen, now)}
        <span className="block text-xs text-muted-foreground">{formatDateTime(p.lastSeen)}</span>
      </Fact>
      <Fact label="Sharing">
        {watching ? <span className="text-chart-2">Watching until {formatDate(p.watchUntil!)}</span> : now - p.lastSeen < 2 * 86_400_000 ? <span className="text-good">On</span> : "Quiet"}
        {p.watchReport ? <span className="block font-mono text-xs text-muted-foreground">{p.watchReport}</span> : null}
      </Fact>
      <Fact label="Crashes · reports">
        <span className={cn(p.crashes && "font-semibold text-bad")}>{p.crashes}</span> · <span>{p.reports}</span>
        {p.usesCli ? <span className="block font-mono text-xs text-muted-foreground">cli {p.cliVersion}</span> : null}
      </Fact>
      {d.versions.length ? (
        <div className="col-span-full flex flex-wrap items-center gap-1.5 text-xs">
          <span className="label-mono mr-1 text-muted-foreground">Versions</span>
          {d.versions.slice(0, 16).map((v) => (
            <span key={v.version} title={`${formatDateTime(v.first)} → ${formatDateTime(v.last)}`} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px]">
              {v.version}
            </span>
          ))}
          {d.versions.length > 16 ? <span className="text-muted-foreground">+{d.versions.length - 16}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function Reports({ d }: { d: Detail }) {
  if (!d.reports.length) return null;
  return (
    <Panel title="Reports" description="Reports this install sent, newest first.">
      <ul className="grid divide-y">
        {d.reports.map((r) => (
          <li key={r.uuid} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
            <KindPill kind={r.kind} />
            <SourcePill source={r.source} />
            <Link to="/feedback/$id" params={{ id: r.id }} search={(prev) => ({ range: prev.range })} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.title}
            </Link>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              Reported on <span className="font-mono">{r.version || "?"}</span> · {formatDate(r.at)}
            </span>
            <IssueChip number={r.issueNumber} url={r.issueUrl} state={r.issue?.state ?? null} watchUntil={r.watchUntil} />
            {r.legacy ? null : <StatusPill state={r.status.state} label={r.status.label} hint={STATUS_HINT[r.status.state]} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Sessions({ sessions }: { sessions: Session[] }) {
  return (
    <>
      {sessions.map((s) => (
        <SessionCard key={s.key} s={s} />
      ))}
    </>
  );
}

const minutes = (ms: number) => (ms < 60_000 ? "under a minute" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

function SessionCard({ s }: { s: Session }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", s.crashed && "border-bad/30")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">{formatDateTime(s.start)}</span>
        <span className="text-muted-foreground">{minutes(s.end - s.start)}</span>
        {s.versions.map((v) => (
          <span key={v} className="font-mono text-[10.5px] text-muted-foreground">
            {v}
          </span>
        ))}
        {s.crashed ? <span className="rounded-full bg-bad/12 px-1.5 py-0.5 text-[10.5px] font-medium text-bad">crashed</span> : null}
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground" title={s.session || "No session id: grouped by time"}>
          {s.session ? s.session.slice(0, 8) : "by time"}
        </span>
      </div>
      <ul className="divide-y">
        {s.events.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </ul>
    </div>
  );
}

function EventRow({ e }: { e: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(e.properties).sort(([a], [b]) => a.localeCompare(b));
  return (
    <li className={cn(e.mark && "bg-accent/30")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-accent/50">
        <span className="w-[3.8rem] shrink-0 pt-px font-mono text-[10.5px] text-muted-foreground tnum">{clock.format(e.at)}</span>
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE[e.tone])} />
        <span className="grid min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={cn("font-medium", e.tone === "bad" && "text-bad")}>{e.title}</span>
            {e.mark === "reported" ? <span className="rounded-full bg-chart-5/15 px-1.5 py-px text-[10px] font-semibold text-chart-5">reported here</span> : null}
            {e.mark === "since-report" ? <span className="rounded-full bg-good/12 px-1.5 py-px text-[10px] font-semibold text-good">first update since report</span> : null}
          </span>
          {e.detail ? <span className="truncate text-muted-foreground">{e.detail}</span> : null}
        </span>
        {open ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
      </button>
      {open ? (
        <div className="bg-muted/30 px-3 py-2">
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-0.5 font-mono text-[10.5px]">
            <dt className="text-muted-foreground">event</dt>
            <dd className="break-all">{e.event}</dd>
            {entries.map(([k, v]) => (
              <PropertyRow key={k} name={k} value={v} />
            ))}
          </dl>
        </div>
      ) : null}
    </li>
  );
}

function PropertyRow({ name, value }: { name: string; value: string }) {
  const long = value.length > 160 || name === "$exception_list";
  if (!long)
    return (
      <>
        <dt className="text-muted-foreground">{name}</dt>
        <dd className="break-all">{value}</dd>
      </>
    );
  let pretty = value;
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2);
  } catch {}
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd>
        <pre className="max-h-64 overflow-auto rounded bg-muted/60 p-2 whitespace-pre-wrap break-all">{pretty}</pre>
      </dd>
    </>
  );
}
