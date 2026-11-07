import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { BarList } from "@/components/bar-list";
import { PageHeader, Panel, Stat } from "@/components/blocks";
import { TimeSeriesChart } from "@/components/charts";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ListSkeleton, Loaded, StatsSkeleton, TableSkeleton, useSection } from "@/components/section";
import type { SectionData } from "@/server/sections";
import { formatAgo, formatDate, formatExact } from "@/lib/format";
import { DATA_START_MS } from "@/lib/range";
import { SourceBadge } from "@/components/source-badge";

export const Route = createFileRoute("/_app/github")({
  head: () => ({ meta: [{ title: "GitHub · Ardia" }] }),
  component: GitHubPage,
});

const DAY = 86_400_000;

function GitHubPage() {
  const query = useSection("github", "7d");
  return (
    <>
      <PageHeader
        title="GitHub"
        description={
          <>
            Public data: mantrakp04/ardia from GitHub's public API. Refreshed every 10 minutes{query.data ? `; this copy is from ${formatAgo(query.data.fetchedAt)}` : ""}.
            {query.data?.error ? <span className="text-bad"> Last refresh failed: {query.data.error}</span> : null}
          </>
        }
      />
      <Loaded
        query={query}
        className="grid gap-4 sm:gap-5"
        skeleton={
          <div className="grid gap-4 sm:gap-5">
            <Card className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
              <StatsSkeleton count={6} />
            </Card>
            <Panel source="github" title="Releases">
              <TableSkeleton rows={8} columns={6} />
            </Panel>
            <Panel source="github" title="DMG downloads by release">
              <ListSkeleton />
            </Panel>
          </div>
        }
      >
        {(data) => <GitHubBody data={data} />}
      </Loaded>
    </>
  );
}

function GitHubBody({ data }: { data: SectionData<"github"> }) {
  const stableDmg = data.releases.filter((r) => !r.prerelease).reduce((s, r) => s + r.dmg, 0);
  const allZip = data.releases.reduce((s, r) => s + r.zip, 0);
  const latest = data.releases.find((r) => !r.prerelease);

  const stars = useMemo(() => {
    if (!data.starDays?.length) return null;
    const byDay = new Map<number, number>();
    for (const { day, count } of data.starDays) {
      const key = Math.floor(day / DAY) * DAY;
      byDay.set(key, (byDay.get(key) ?? 0) + count);
    }
    const first = Math.min(Math.floor(data.starDays[0]!.day / DAY) * DAY, DATA_START_MS);
    const days: number[] = [];
    for (let t = first; t <= data.fetchedAt; t += DAY) days.push(t);
    const perDay = days.map((d) => byDay.get(d) ?? 0);
    let total = 0;
    const cumulative = perDay.map((n) => (total += n));
    return { days, cumulative, perDay };
  }, [data.starDays, data.fetchedAt]);

  return (
    <>
      <Card className="relative grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-4 shadow-none sm:grid-cols-3 sm:px-5 lg:grid-cols-6">
        <div className="absolute top-3 right-3"><SourceBadge source="github" /></div>
        <Stat label="Stars" value={formatExact(data.stars)} sub={stars ? `+${formatExact(stars.perDay.slice(-7).reduce((s, x) => s + x, 0))} in 7 days` : null} />
        <Stat label="Forks" value={formatExact(data.forks)} />
        <Stat label="Open issues" value={formatExact(data.openIssues)} sub="and pull requests" />
        <Stat label="Watchers" value={formatExact(data.watchers)} />
        <Stat label="Stable DMG downloads" value={formatExact(stableDmg)} sub={latest ? `${latest.version}: ${formatExact(latest.dmg)}` : null} />
        <Stat label="Update zips" value={formatExact(allZip)} sub="Sparkle updates, all releases" />
      </Card>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-5">
        <Panel source="github" className="xl:col-span-3" title="Stars" description={stars ? "Total stars by day." : "Star history didn't load from GitHub."}>
          {stars ? (
            <TimeSeriesChart buckets={stars.days} series={[{ key: "stars", label: "Stars", values: stars.cumulative, color: "var(--chart-5)" }]} step="day" height={260} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No star history.</p>
          )}
        </Panel>
        <Panel source="github" className="xl:col-span-2" title="DMG downloads by release" description="Stable releases, newest first.">
          <BarList
            items={data.releases.filter((r) => !r.prerelease).map((r) => ({ key: r.tag, label: r.version, value: r.dmg, secondary: r.zip }))}
            dimension="Release"
            valueLabel="DMG"
            secondaryLabel="Zips"
            color="var(--chart-5)"
            limit={10}
          />
        </Panel>
      </div>

      <Panel source="github" title="Releases" description="Every published release with its assets. Click a row for the per-asset counts.">
        <DataTable
          dense
          rows={data.releases}
          rowKey={(r) => r.tag}
          limit={20}
          expand={(r) => (
            <ul className="grid gap-1 px-4 py-3 text-xs sm:px-5">
              {r.assets.map((a) => (
                <li key={a.name} className="flex justify-between gap-4">
                  <span className="truncate font-mono">{a.name}</span>
                  <span className="tnum">{formatExact(a.downloads)}</span>
                </li>
              ))}
              <li className="pt-1">
                <a href={r.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  Open on GitHub
                </a>
              </li>
            </ul>
          )}
          columns={[
            {
              key: "version",
              header: "Release",
              sort: (r) => r.published,
              cell: (r) => (
                <span className="flex items-center gap-1.5 font-mono text-[12px]">
                  {r.version}
                  {r.prerelease ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      pre
                    </Badge>
                  ) : null}
                </span>
              ),
            },
            { key: "published", header: "Published", sort: (r) => r.published, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.published ? formatDate(r.published) : "–"}</span> },
            { key: "dmg", header: "DMG", align: "right", sort: (r) => r.dmg, cell: (r) => <span className="font-medium">{formatExact(r.dmg)}</span> },
            { key: "zip", header: "Zip", align: "right", sort: (r) => r.zip, cell: (r) => formatExact(r.zip) },
            { key: "appcast", header: "Appcast", align: "right", sort: (r) => r.appcast, cell: (r) => formatExact(r.appcast) },
            { key: "assets", header: "Assets", align: "right", sort: (r) => r.assets.length, cell: (r) => formatExact(r.assets.length) },
          ]}
        />
      </Panel>
    </>
  );
}
