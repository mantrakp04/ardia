import { Link, createFileRoute } from "@tanstack/react-router";
import { BarList } from "@/components/bar-list";
import { Panel, Stat } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { ListSkeleton, Loaded, StatsSkeleton, TableSkeleton } from "@/components/section";
import { Ext, Pill, Platforms, SyncedNote, platformLabel, useTriage } from "@/components/triage/shared";
import { Card } from "@/components/ui/card";
import { formatDate, formatExact } from "@/lib/format";
import { issueUrl } from "@/lib/triage-links";
import type { TriageData } from "@/server/triage/load";

export const Route = createFileRoute("/_app/triage/")({
  component: TriageOverview,
});

function TriageOverview() {
  const query = useTriage("overview");
  return (
    <Loaded
      query={query}
      className="grid gap-4 sm:gap-5"
      skeleton={
        <div className="grid gap-4 sm:gap-5">
          <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
            <StatsSkeleton count={6} />
          </Card>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
            {["Requests by status", "Open requests by type", "Replies waiting"].map((t) => (
              <Panel key={t} title={t}>
                <ListSkeleton rows={4} />
              </Panel>
            ))}
          </div>
          <Panel title="Latest releases">
            <TableSkeleton rows={6} columns={6} />
          </Panel>
        </div>
      }
    >
      {(data) => <OverviewBody data={data} />}
    </Loaded>
  );
}

function OverviewBody({ data }: { data: TriageData<"overview"> }) {
  const dim = (name: string) => data.dimensions.filter((d) => d.dimension === name).sort((a, b) => b.n - a.n);
  const n = (name: string, value: string) => data.dimensions.find((d) => d.dimension === name && d.value === value)?.n ?? 0;
  const total = (name: string) => dim(name).reduce((s, d) => s + d.n, 0);
  const waiting = data.replies.filter((r) => r.status === "drafted").sort((a, b) => b.n - a.n);
  const waitingTotal = waiting.reduce((s, r) => s + r.n, 0);
  const sent = data.replies.filter((r) => r.status === "sent").reduce((s, r) => s + r.n, 0);
  return (
    <>
      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
        <Stat label="Open requests" value={formatExact(n("request_status", "open"))} sub={`of ${formatExact(total("request_status"))} tracked`} />
        <Stat label="Fixed in nightly" value={formatExact(n("request_status", "fixed-nightly"))} sub="not in a stable yet" />
        <Stat label="Fixed in stable" value={formatExact(n("request_status", "fixed-stable"))} />
        <Stat label="Replies waiting" value={formatExact(waitingTotal)} sub={`${formatExact(sent)} sent`} />
        <Stat label="Feedback items" value={formatExact(total("item_platform"))} sub={dim("item_platform").map((d) => `${platformLabel(d.value)} ${formatExact(d.n)}`).join(" · ")} />
        <Stat label="Open issues" value={formatExact(n("issue_state", "open"))} sub={`${formatExact(n("issue_state", "closed"))} closed`} />
      </Card>
      <p className="-mt-2 text-xs text-muted-foreground">
        <SyncedNote at={data.syncedAt} />
      </p>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <Panel title="Requests by status">
          <BarList items={dim("request_status").map((d) => ({ key: d.value, label: d.value, value: d.n }))} dimension="Status" valueLabel="Requests" color="var(--chart-2)" />
        </Panel>
        <Panel title="Open requests by type">
          <BarList items={dim("open_request_type").map((d) => ({ key: d.value, label: d.value, value: d.n }))} dimension="Type" valueLabel="Open" color="var(--chart-4)" />
        </Panel>
        <Panel title="Replies waiting" description={<Link to="/triage/replies" search={(prev) => ({ range: prev.range })} className="underline underline-offset-2 hover:text-foreground">Open the reply queue</Link>}>
          <BarList items={waiting.map((r) => ({ key: r.platform, label: platformLabel(r.platform), value: r.n }))} dimension="Platform" valueLabel="Drafted" color="var(--chart-3)" empty="Nothing waiting" />
        </Panel>
      </div>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-2">
        <Panel title="Latest releases" description="Fixed requests, Discord announcements and tagged people per release.">
          <DataTable
            dense
            rows={data.releases}
            rowKey={(r) => r.tag}
            columns={[
              { key: "tag", header: "Release", cell: (r) => <Ext href={r.url} className="font-mono text-[12px]">{r.tag}</Ext> },
              { key: "channel", header: "Channel", cell: (r) => <Pill value={r.channel} /> },
              { key: "published", header: "Published", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.publishedAt ? formatDate(r.publishedAt) : "–"}</span> },
              { key: "fixed", header: "Fixed", align: "right", cell: (r) => formatExact(r.fixed) },
              { key: "tagged", header: "Tagged", align: "right", cell: (r) => formatExact(r.tagged) },
              { key: "announced", header: "Announced", align: "right", cell: (r) => (r.announcements || r.xPostUrl ? <Ext href={r.xPostUrl}>{r.announcements + (r.xPostUrl ? 1 : 0)}</Ext> : <span className="text-muted-foreground">–</span>) },
            ]}
          />
        </Panel>
        <Panel title="Most-asked open requests" description={<Link to="/triage/requests" search={(prev) => ({ range: prev.range })} className="underline underline-offset-2 hover:text-foreground">All requests</Link>}>
          <DataTable
            dense
            rows={data.topOpen}
            rowKey={(r) => String(r.id)}
            empty="No open requests"
            columns={[
              { key: "title", header: "Request", cell: (r) => <span className="line-clamp-2 min-w-48">{r.title}</span> },
              { key: "type", header: "Type", cell: (r) => <Pill value={r.type} /> },
              { key: "platforms", header: "From", cell: (r) => <Platforms platforms={r.platforms} /> },
              { key: "requesters", header: "People", align: "right", cell: (r) => <span className="font-medium">{formatExact(r.requesters)}</span> },
              { key: "issue", header: "Issue", cell: (r) => (r.issueNumber ? <Ext href={r.issueUrl ?? issueUrl(r.issueNumber)}>#{r.issueNumber}</Ext> : <span className="text-muted-foreground">–</span>) },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
