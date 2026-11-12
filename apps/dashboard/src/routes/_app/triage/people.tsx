import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, TableSkeleton } from "@/components/section";
import { Ext, FilterSelect, Platforms, SearchBox, Toolbar, matches, platformLabel, useTriage } from "@/components/triage/shared";
import { formatDate, formatExact } from "@/lib/format";

export const Route = createFileRoute("/_app/triage/people")({
  component: TriagePeople,
});

function TriagePeople() {
  const query = useTriage("people");
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const rows = query.data?.people ?? [];
  const filtered = useMemo(
    () => rows.filter((p) => (!platform || p.platforms.includes(platform)) && matches(search, p.name, p.xHandle, p.discordHandle, p.githubLogin, p.notes)),
    [rows, platform, search],
  );
  const platforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of rows) for (const x of p.platforms) counts.set(x, (counts.get(x) ?? 0) + 1);
    return [...counts].map(([value, n]) => ({ value, label: platformLabel(value), n }));
  }, [rows]);
  return (
    <>
      <Toolbar>
        <FilterSelect label="Platform" value={platform} onChange={setPlatform} options={platforms} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search name or handle…" />
      </Toolbar>
      <Panel title="People" description={query.data ? `${formatExact(filtered.length)} of ${formatExact(rows.length)} people who sent feedback, linked across X, Discord and GitHub.` : "Loading people…"} bodyClassName="px-0 sm:px-0">
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={8} /></div>}>
          {() => (
            <div className="px-2 sm:px-3">
              <DataTable
                dense
                rows={filtered}
                rowKey={(p) => String(p.id)}
                limit={80}
                initialSort={{ key: "items", desc: true }}
                empty="Nobody matches"
                columns={[
                  { key: "name", header: "Person", sort: (p) => p.name ?? "", cell: (p) => <span className="font-medium">{p.name ?? `#${p.id}`}</span> },
                  { key: "x", header: "X", sort: (p) => p.xHandle ?? "", cell: (p) => (p.xHandle ? <Ext href={`https://x.com/${p.xHandle.replace(/^@/, "")}`}>@{p.xHandle.replace(/^@/, "")}</Ext> : <span className="text-muted-foreground">–</span>) },
                  { key: "discord", header: "Discord", sort: (p) => p.discordHandle ?? "", cell: (p) => p.discordHandle ?? <span className="text-muted-foreground">–</span> },
                  { key: "github", header: "GitHub", sort: (p) => p.githubLogin ?? "", cell: (p) => (p.githubLogin ? <Ext href={`https://github.com/${p.githubLogin}`}>{p.githubLogin}</Ext> : <span className="text-muted-foreground">–</span>) },
                  { key: "platforms", header: "Active on", cell: (p) => <Platforms platforms={p.platforms} /> },
                  { key: "items", header: "Items", align: "right", sort: (p) => p.items, cell: (p) => <span className="font-medium">{formatExact(p.items)}</span> },
                  { key: "requests", header: "Requests", align: "right", sort: (p) => p.requests, cell: (p) => formatExact(p.requests) },
                  { key: "drafted", header: "Waiting", align: "right", sort: (p) => p.drafted, cell: (p) => (p.drafted ? <span className="text-chart-3">{p.drafted}</span> : <span className="text-muted-foreground">–</span>) },
                  { key: "sent", header: "Sent", align: "right", sort: (p) => p.sent, cell: (p) => formatExact(p.sent) },
                  { key: "tags", header: "Tagged", align: "right", sort: (p) => p.tags, cell: (p) => formatExact(p.tags) },
                  { key: "last", header: "Last seen", sort: (p) => p.lastSeen ?? 0, cell: (p) => <span className="whitespace-nowrap text-muted-foreground">{p.lastSeen ? formatDate(p.lastSeen) : "–"}</span> },
                ]}
              />
            </div>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
