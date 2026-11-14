import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Bug, Download, FileText, MousePointerClick, MousePointer2, Palette, Zap } from "lucide-react";
import { Suspense, lazy, useMemo, useRef, type ComponentType } from "react";
import { Panel } from "@/components/blocks";
import { SectionError, useRange } from "@/components/section";
import type { ReplayPlayerHandle } from "@/components/replay-player";
import { Skeleton } from "@/components/ui/skeleton";
import { getReplay } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ReplayPlayer = lazy(() => import("@/components/replay-player"));

export const Route = createFileRoute("/_app/replays/$sessionId")({
  head: () => ({ meta: [{ title: "Replay · Ardia" }] }),
  component: ReplayPage,
});

type TimelineItem = { at: number; event: string; url: string; text: string; kind: string; message: string; location: string };

const EVENT_LOOK: Record<string, { label: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  $pageview: { label: "Page view", icon: FileText, tone: "text-chart-2" },
  $autocapture: { label: "Click", icon: MousePointer2, tone: "text-muted-foreground" },
  $rageclick: { label: "Rage click", icon: Zap, tone: "text-bad" },
  $dead_click: { label: "Dead click", icon: MousePointerClick, tone: "text-chart-5" },
  $exception: { label: "Exception", icon: Bug, tone: "text-bad" },
  download_clicked: { label: "Download clicked", icon: Download, tone: "text-chart-1" },
  demo_customize: { label: "Customize it clicked", icon: Palette, tone: "text-chart-3" },
};

function describe(item: TimelineItem) {
  if (item.event === "$pageview") {
    try {
      return new URL(item.url).pathname;
    } catch {
      return item.url;
    }
  }
  if (item.event === "$exception") {
    try {
      return String((JSON.parse(item.message) as unknown[])[0] ?? "");
    } catch {
      return item.message;
    }
  }
  if (item.event === "download_clicked") return item.location ? `from ${item.location}` : "";
  return item.text;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function ReplayPage() {
  const { sessionId } = Route.useParams();
  const range = useRange();
  const player = useRef<ReplayPlayerHandle>(null);
  const query = useQuery({
    queryKey: ["replay", sessionId],
    queryFn: ({ signal }) => getReplay({ data: { sessionId }, signal }),
    staleTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const events = useMemo(() => (data && data.found ? (JSON.parse(data.events) as { timestamp: number; type: number }[]) : []), [data]);
  const first = events[0]?.timestamp ?? (data && data.found ? data.start : 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <Link to="/replays" search={{ range: range !== "7d" ? range : undefined }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            All replays
          </Link>
          <h1 className="text-2xl font-semibold tracking-[-0.025em]" style={{ fontStretch: "92%" }}>
            Replay
          </h1>
          <p className="font-mono text-[11px] text-muted-foreground">{sessionId}</p>
        </div>
      </div>

      {query.isError ? (
        <SectionError error={query.error} onRetry={() => query.refetch()} />
      ) : data && !data.found ? (
        <Panel source="replay" title="This replay isn't available">
          <p className="text-sm text-muted-foreground">
            No recording was found for this session. Replays are kept for 30 days, and sessions shorter than about 4 seconds aren't recorded.
          </p>
        </Panel>
      ) : (
        <div className="grid items-start gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel source="replay" title="Recording" description={data && data.found ? `${formatDateTime(data.start)} · ${clock(data.end - data.start)} long · inactivity is skipped` : "Loading the recording…"} bodyClassName="px-3 pb-3 sm:px-4">
            {data && data.found && data.truncated ? <p className="mb-3 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{data.truncated}</p> : null}
            {data && data.found ? (
              events.length > 1 ? (
                <Suspense fallback={<Skeleton className="aspect-[16/10] w-full rounded-lg" />}>
                  <ReplayPlayer ref={player} events={events} />
                </Suspense>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">The recording has no playable events.</p>
              )
            ) : (
              <Skeleton className="aspect-[16/10] w-full rounded-lg" />
            )}
          </Panel>

          <div className="grid gap-3 sm:gap-4">
            <Panel source="replay" title="Session">
              {data && data.found ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                  {(
                    [
                      ["Started", formatDateTime(data.start)],
                      ["Device", [data.device, data.browser].filter(Boolean).join(" · ")],
                      ["Screen", data.screen || "–"],
                      ["Country", data.country || "–"],
                      ["Referrer", data.referrer === "$direct" ? "Direct" : data.referrer || "–"],
                      ["Clicks", String(data.clicks)],
                      ["Chunks", `${data.chunks} · ${(data.bytes / 1024).toFixed(0)} KB`],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 truncate">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="grid gap-2">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-3.5" />
                  ))}
                </div>
              )}
            </Panel>
            <Panel source="replay" title="Timeline" description="Click an event to jump there." bodyClassName="px-2 pb-2 sm:px-2">
              {data && data.found ? (
                data.timeline.length ? (
                  <ol className="grid max-h-[420px] gap-0.5 overflow-y-auto pr-1">
                    {data.timeline.map((item, i) => {
                      const look = EVENT_LOOK[item.event] ?? { label: item.event.replace(/_/g, " "), icon: MousePointer2, tone: "text-muted-foreground" };
                      const Icon = look.icon;
                      return (
                        <li key={`${item.at}-${i}`}>
                          <button
                            type="button"
                            onClick={() => player.current?.seek(item.at)}
                            className="grid w-full grid-cols-[2.6rem_1rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                          >
                            <span className="pt-px font-mono text-[11px] text-muted-foreground tnum">{clock(item.at - first)}</span>
                            <Icon className={cn("mt-px size-3.5", look.tone)} aria-hidden />
                            <span className="grid min-w-0">
                              <span className="font-medium">{look.label}</span>
                              {describe(item) ? <span className="truncate text-muted-foreground">{describe(item)}</span> : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="px-2 py-4 text-xs text-muted-foreground">No tracked events in this session.</p>
                )
              ) : (
                <div className="grid gap-2 px-2">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} className="h-6" />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
