import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Download, ExternalLink, Paperclip } from "lucide-react";
import { Panel } from "@/components/blocks";
import { Fact, IssueChip, KindPill, STATUS_HINT, SourcePill, StatusPill, VersionTag, formatBytes } from "@/components/people-ui";
import { PersonName } from "@/components/person";
import { SectionError } from "@/components/section";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAgo, formatDate, formatDateTime } from "@/lib/format";
import { getFeedbackReport } from "@/lib/people-api";

export const Route = createFileRoute("/_app/feedback/$id")({
  head: () => ({ meta: [{ title: "Report · Ardia" }] }),
  component: ReportPage,
});

type Report = NonNullable<Awaited<ReturnType<typeof getFeedbackReport>>>;

function ReportPage() {
  const { id } = Route.useParams();
  const query = useQuery({
    queryKey: ["feedback", id],
    queryFn: ({ signal }) => getFeedbackReport({ data: { id }, signal }),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return (
    <>
      <Link to="/feedback" search={(prev) => ({ range: prev.range })} className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        Feedback
      </Link>
      {query.isError ? <SectionError error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.data === undefined && !query.isError ? (
        <div className="grid gap-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : null}
      {query.data === null ? <Card className="px-5 py-6 text-sm text-muted-foreground shadow-none">No report {id}.</Card> : null}
      {query.data ? <ReportBody r={query.data} /> : null}
    </>
  );
}

function ReportBody({ r }: { r: Report }) {
  const recording = r.attachments.find((a) => a.name === "recording.mp4");
  const trace = r.attachments.find((a) => a.name.startsWith("trace."));
  let diagnostics = r.diagnostics;
  try {
    diagnostics = diagnostics ? JSON.stringify(JSON.parse(diagnostics), null, 2) : "";
  } catch {}
  return (
    <>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <KindPill kind={r.kind} />
          <SourcePill source={r.source} />
          {r.legacy ? null : <span className="font-mono text-xs text-muted-foreground">{r.id}</span>}
          <span className="text-xs text-muted-foreground">· {formatDateTime(r.at)} · {formatAgo(r.at)}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[1.7rem]" style={{ fontStretch: "92%" }}>
          {r.title}
        </h1>
      </div>

      <Card className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 lg:grid-cols-5">
        <Fact label="Person">
          <PersonName id={r.person} size={24} />
        </Fact>
        <Fact label="Version">{r.version ? <VersionTag version={r.version} channel={r.channel} /> : "–"}{r.build ? <span className="block font-mono text-xs text-muted-foreground">build {r.build}</span> : null}</Fact>
        <Fact label="Mac">{r.os ? `macOS ${r.os}` : "–"}{r.arch ? <span className="block text-xs text-muted-foreground">{r.arch}</span> : null}</Fact>
        <Fact label="Issue">
          <span className="flex flex-wrap items-center gap-1.5">
            <IssueChip number={r.issueNumber} url={r.issueUrl} state={r.issue?.state ?? null} watchUntil={r.watchUntil} />
            {r.issue?.closedAt ? <span className="text-xs text-muted-foreground">closed {formatDate(r.issue.closedAt)}</span> : null}
          </span>
        </Fact>
        <Fact label="Status">
          {r.legacy ? "–" : <StatusPill state={r.status.state} label={r.status.label} hint={STATUS_HINT[r.status.state]} />}
          {r.status.errorTypes.length ? <span className="block truncate font-mono text-[10.5px] text-muted-foreground" title={r.status.errorTypes.join(", ")}>tracks {r.status.errorTypes.join(", ")}</span> : null}
        </Fact>
        {r.watchUntil ? <Fact label="Watch">{r.watchUntil > Date.now() ? `until ${formatDate(r.watchUntil)}` : `ended ${formatDate(r.watchUntil)}`}</Fact> : null}
        {r.contact ? <Fact label="Contact"><span className="break-all">{r.contact}</span></Fact> : null}
        {r.pageAddress ? (
          <Fact label="Page address">
            <span className="font-mono text-xs break-all">{r.pageAddress}</span>
          </Fact>
        ) : null}
        {r.legacy ? <Fact label="Agent">{r.agent}</Fact> : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Panel title="What happened">
            <p className="text-sm whitespace-pre-wrap break-words">{r.description || <span className="text-muted-foreground">No description.</span>}</p>
            {r.command ? <p className="mt-3 font-mono text-xs break-all text-muted-foreground">{r.command}</p> : null}
            {r.recent.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <span className="text-muted-foreground">Before it</span>
                {r.recent.map((name, i) => (
                  <span key={i} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px]">
                    {name}
                  </span>
                ))}
              </div>
            ) : null}
          </Panel>
          {recording ? (
            <Panel title="Recording" description={`${formatBytes(recording.bytes)} · Ardia's windows only, web pages blacked out unless the reporter included them.`}>
              <video controls preload="metadata" src={recording.url} className="aspect-video w-full rounded-lg border bg-black" />
            </Panel>
          ) : null}
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Attachments" description={r.attachments.length ? "Private: never sent to GitHub." : undefined}>
            {r.attachments.length ? (
              <ul className="grid divide-y text-sm">
                {r.attachments.map((a) => (
                  <li key={a.name} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{a.name}</span>
                    <span className="text-xs text-muted-foreground tnum">{formatBytes(a.bytes)}</span>
                    <a href={a.url} download={a !== recording} target={a === recording ? "_blank" : undefined} rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs hover:bg-accent">
                      {a === recording ? <ExternalLink className="size-3" aria-hidden /> : <Download className="size-3" aria-hidden />}
                      {a === trace ? "Trace" : a === recording ? "Open" : "Get"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing attached.</p>
            )}
          </Panel>
          {diagnostics ? (
            <Panel title="Diagnostics">
              <pre className="max-h-96 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-all">{diagnostics}</pre>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
