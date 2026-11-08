import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ChartSkeleton, Loaded, StatsSkeleton, TableSkeleton, useRange, useSection } from "@/components/section";
import type { SectionData } from "@/server/sections";
import { rangeSentence } from "@/lib/compare";
import { formatAgo, formatDate, formatDateTime, formatExact } from "@/lib/format";
import { windowFor } from "@/lib/range";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/errors")({
  head: () => ({ meta: [{ title: "Errors · Ardia" }] }),
  component: ErrorsPage,
});

type Group = SectionData<"errors.exceptions">["groups"][number];

function ErrorsPage() {
  const range = useRange();
  const w = windowFor(range);
  const exceptions = useSection("errors.exceptions");
  const logs = useSection("errors.logs");
  const agentFeedback = useSection("feedback.cli");
  const [showNoise, setShowNoise] = useState(false);
  const all = exceptions.data?.groups ?? [];
  const real = all.filter((g) => !g.noise);
  const noise = all.filter((g) => g.noise);
  const sum = (list: Group[], f: (g: Group) => number) => list.reduce((s, g) => s + f(g), 0);

  return (
    <>
      <PageHeader
        title="Errors"
        description={`${rangeSentence(range)}. Exceptions from the site (always on, anonymous) and the app (opt-in only), grouped by type and message. Known noise (extensions, in-app browsers, network drops) is hidden unless you ask for it.`}
      >
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
          <input id="show-noise" type="checkbox" checked={showNoise} onChange={(e) => setShowNoise(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />
          <Label htmlFor="show-noise" className="text-xs font-normal">
            Show noise{exceptions.data ? ` (${formatExact(sum(noise, (g) => g.count))})` : ""}
          </Label>
        </div>
      </PageHeader>

      <Card className="px-4 py-4 shadow-none sm:px-5">
        <Loaded query={exceptions} skeleton={<div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4"><StatsSkeleton count={4} /></div>}>
          {() => (
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
              <Stat source="app" label="App exceptions" value={formatExact(sum(real.filter((g) => g.where === "app"), (g) => g.count))} sub={`${real.filter((g) => g.where === "app").length} groups`} />
              <Stat source="site" label="Site exceptions" value={formatExact(sum(real.filter((g) => g.where === "site"), (g) => g.count))} sub={`${real.filter((g) => g.where === "site").length} groups`} />
              <Stat source={["site", "app"]} label="New groups" value={formatExact(real.filter((g) => g.firstSeen >= w.start).length)} sub="first seen in the range" />
              <Stat source="site" label="Noise" value={formatExact(sum(noise, (g) => g.count))} sub={`${noise.length} groups, not ours`} />
            </div>
          )}
        </Loaded>
      </Card>

      <Panel title="Exceptions over time" description={`Per ${w.step === "hour" ? "hour" : "day"}.`}>
        <Loaded query={exceptions} skeleton={<ChartSkeleton height={200} legend />}>
          {(d) => (
            <TimeSeriesChart
              buckets={d.window.buckets}
              series={d.series
                .filter((s) => showNoise || s.key !== "noise")
                .map((s) => ({ ...s, source: s.key === "app" ? ("app" as const) : ("site" as const), color: s.key === "app" ? "var(--chart-3)" : s.key === "site" ? "var(--chart-2)" : "var(--chart-other)" }))}
              step={d.window.step}
              height={200}
              area={false}
            />
          )}
        </Loaded>
      </Panel>

      <Panel source={["site", "app"]} title="Groups" description="Click a row for versions and recent occurrences with their stacks.">
        <Loaded query={exceptions} skeleton={<TableSkeleton rows={6} columns={7} />}>
          {(d) => (
            <DataTable
              rows={showNoise ? d.groups : d.groups.filter((g) => !g.noise)}
              rowKey={(g) => g.id}
              initialSort={{ key: "count", desc: true }}
              empty="No exceptions in this range"
              expand={(g) => <GroupDetail group={g} />}
              columns={[
                {
                  key: "where",
                  header: "Where",
                  sort: (g) => g.where,
                  cell: (g) => (
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className={cn("h-5 px-1.5 text-[10.5px]", g.where === "app" ? "border-chart-3/40" : "border-chart-2/40")}>
                        {g.where}
                      </Badge>
                      {g.noise ? (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10.5px] font-normal text-muted-foreground">
                          {g.noise}
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "message",
                  header: "Error",
                  sort: (g) => g.message,
                  cell: (g) => (
                    <span className="grid max-w-[38rem] gap-0.5">
                      <span className="font-mono text-[11.5px] font-medium">{g.type}</span>
                      <span className="line-clamp-2 text-xs break-words text-muted-foreground">{g.message || "No message"}</span>
                    </span>
                  ),
                },
                { key: "count", header: "Count", align: "right", sort: (g) => g.count, cell: (g) => <span className="font-semibold">{formatExact(g.count)}</span> },
                { key: "people", header: "People", align: "right", sort: (g) => g.people, cell: (g) => formatExact(g.people) },
                {
                  key: "versions",
                  header: "Versions",
                  sort: (g) => g.versions[0]?.version ?? "",
                  cell: (g) => (
                    <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                      {g.versions
                        .slice(0, 2)
                        .map((v) => v.version)
                        .join(", ")}
                      {g.versions.length > 2 ? ` +${g.versions.length - 2}` : ""}
                    </span>
                  ),
                },
                { key: "first", header: "First seen", align: "right", sort: (g) => g.firstSeen, cell: (g) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(g.firstSeen)}</span> },
                { key: "last", header: "Last seen", align: "right", sort: (g) => g.lastSeen, cell: (g) => <span className="whitespace-nowrap">{formatAgo(g.lastSeen)}</span> },
              ]}
            />
          )}
        </Loaded>
      </Panel>

      <Panel source={["site", "app"]} title="Logged warnings and errors" description="Console warnings and errors sent to telemetry.logs, grouped by message. Site logs are always on; app logs come only from opted-in users.">
        <Loaded query={logs} skeleton={<TableSkeleton rows={6} columns={5} />}>
          {(rows) => (
            <DataTable
              dense
              rows={rows}
              rowKey={(r) => `${r.source}|${r.level}|${r.message}`}
              initialSort={{ key: "count", desc: true }}
              limit={12}
              empty="No logs in this range"
              columns={[
                { key: "source", header: "Source", sort: (r) => r.source, cell: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{r.source}</span> },
                { key: "level", header: "Level", sort: (r) => r.level, cell: (r) => <span className={cn("text-[11px] font-medium", r.level === "ERROR" ? "text-bad" : "text-muted-foreground")}>{r.level}</span> },
                { key: "message", header: "Message", sort: (r) => r.message, cell: (r) => <span className="line-clamp-2 max-w-[42rem] text-xs break-words">{r.message}</span> },
                { key: "count", header: "Count", align: "right", sort: (r) => r.count, cell: (r) => formatExact(r.count) },
                { key: "last", header: "Last", align: "right", sort: (r) => r.lastSeen, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatAgo(r.lastSeen)}</span> },
              ]}
            />
          )}
        </Loaded>
      </Panel>

      <Panel source="app" title="Agent feedback" description="Notes coding agents sent with ardia feedback: what got in their way using the CLI. Opt-in installs only, scrubbed and capped at 1,000 characters on the Mac.">
        <Loaded query={agentFeedback} skeleton={<TableSkeleton rows={6} columns={5} />}>
          {(rows) => (
            <DataTable
              dense
              rows={rows}
              rowKey={(r) => r.id}
              initialSort={{ key: "at", desc: true }}
              limit={20}
              empty="No agent feedback in this range"
              expand={(r) => <FeedbackDetail row={r} />}
              columns={[
                { key: "at", header: "When", sort: (r) => r.at, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatAgo(r.at)}</span> },
                { key: "agent", header: "Agent", sort: (r) => r.agent, cell: (r) => <span className="whitespace-nowrap">{r.agent}</span> },
                { key: "text", header: "Feedback", sort: (r) => r.text, cell: (r) => <span className="line-clamp-2 max-w-[42rem] text-xs break-words">{r.text}</span> },
                { key: "command", header: "Command", sort: (r) => r.command, cell: (r) => <span className="line-clamp-1 max-w-[16rem] font-mono text-[11px] break-all text-muted-foreground">{r.command || "–"}</span> },
                { key: "version", header: "CLI", sort: (r) => r.version, cell: (r) => <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{r.version}{r.environment && r.environment !== "production" ? ` · ${r.environment}` : ""}</span> },
              ]}
            />
          )}
        </Loaded>
      </Panel>
    </>
  );
}

function FeedbackDetail({ row }: { row: SectionData<"feedback.cli">[number] }) {
  return (
    <div className="grid gap-3 px-4 py-4 text-xs sm:px-5">
      <p className="text-sm whitespace-pre-wrap break-words">{row.text}{row.truncated ? " …" : ""}</p>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-muted-foreground">
        <span>{formatDateTime(row.at)}</span>
        {row.command ? <span className="font-mono break-all">{row.command}</span> : null}
        <span className="font-mono">install {row.install.slice(0, 8)}</span>
      </div>
      {row.recent.length ? (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-muted-foreground">Before it </span>
          {row.recent.map((name, i) => (
            <span key={i} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px]">
              {name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GroupDetail({ group }: { group: Group }) {
  return (
    <div className="grid gap-4 px-4 py-4 text-xs sm:px-5">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <span>
          <span className="text-muted-foreground">Total all time </span>
          <span className="font-medium tnum">{formatExact(group.total)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">First seen </span>
          {formatDateTime(group.firstSeen)}
        </span>
        <span>
          <span className="text-muted-foreground">Last seen </span>
          {formatDateTime(group.lastSeen)}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <span className="text-muted-foreground">In range by version </span>
          {group.versions.map((v) => (
            <span key={v.version} className="font-mono">
              {v.version} <span className="text-muted-foreground">×{v.count}</span>
            </span>
          ))}
        </span>
      </div>
      <div className="grid gap-3">
        {group.recent.map((o) => (
          <div key={o.id} className="grid gap-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
              <span className="text-foreground">{formatDateTime(o.at)}</span>
              {o.version ? <span className="font-mono">{o.version}</span> : null}
              {o.platform ? <span>{o.platform}</span> : null}
              {o.level ? <span>{o.level}</span> : null}
              {o.crashSignal ? <span className="font-mono">{o.crashSignal}</span> : null}
              {o.url ? <span className="truncate font-mono">{o.url}</span> : null}
            </div>
            {o.frames.length ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">{o.frames.join("\n")}</pre>
            ) : (
              <span className="text-muted-foreground">No stack.</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
