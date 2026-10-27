import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, TableSkeleton } from "@/components/section";
import { Ext, FilterSelect, Pill, Platforms, SearchBox, SyncedNote, Toolbar, matches, optionsOf, platformLabel, useTriage } from "@/components/triage/shared";
import { formatDate, formatExact } from "@/lib/format";
import { commitShas, commitUrl, issueUrl, pullNumbers, pullUrl, releaseUrl } from "@/lib/triage-links";
import type { TriageData } from "@/server/triage/load";

export const Route = createFileRoute("/_app/triage/requests")({
  component: TriageRequests,
});

type Request = TriageData<"requests">["requests"][number];

function TriageRequests() {
  const query = useTriage("requests");
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const rows = query.data?.requests ?? [];
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || r.status === status) &&
          (!type || r.type === type) &&
          (!platform || r.platforms.includes(platform)) &&
          matches(search, r.title, r.key, r.note, r.issueTitle, r.fixCommit, r.releaseTag, r.issueNumber ? `#${r.issueNumber}` : null, ...r.items.map((i) => i.text)),
      ),
    [rows, status, type, platform, search],
  );
  const platforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const p of r.platforms) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts].map(([value, n]) => ({ value, label: platformLabel(value), n }));
  }, [rows]);
  return (
    <>
      <Toolbar>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={optionsOf(rows, (r) => r.status)} />
        <FilterSelect label="Type" value={type} onChange={setType} options={optionsOf(rows, (r) => r.type)} />
        <FilterSelect label="Platform" value={platform} onChange={setPlatform} options={platforms} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search title, issue, commit, feedback…" />
      </Toolbar>
      <Panel
        title="Requests"
        description={
          query.data ? (
            <>
              {formatExact(filtered.length)} of {formatExact(rows.length)} requests. Click one for the feedback behind it. <SyncedNote at={query.data.syncedAt} />
            </>
          ) : (
            "Loading requests…"
          )
        }
        bodyClassName="px-0 sm:px-0"
      >
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={8} /></div>}>
          {() => (
            <div className="px-2 sm:px-3">
              <DataTable
                dense
                rows={filtered}
                rowKey={(r) => String(r.id)}
                limit={60}
                empty="No requests match these filters"
                initialSort={{ key: "requesters", desc: true }}
                expand={(r) => <RequestDetail request={r} />}
                columns={[
                  { key: "id", header: "#", sort: (r) => r.id, cell: (r) => <span className="font-mono text-muted-foreground">{r.id}</span> },
                  {
                    key: "title",
                    header: "Request",
                    sort: (r) => r.title,
                    cell: (r) => (
                      <span className="grid min-w-56 gap-0.5">
                        <span className="line-clamp-2 font-medium">{r.title}</span>
                        {r.key ? <span className="font-mono text-[10.5px] text-muted-foreground">{r.key}</span> : null}
                      </span>
                    ),
                  },
                  { key: "status", header: "Status", sort: (r) => r.status ?? "", cell: (r) => <Pill value={r.status} /> },
                  { key: "type", header: "Type", sort: (r) => r.type ?? "", cell: (r) => <Pill value={r.type} /> },
                  { key: "platforms", header: "From", cell: (r) => <Platforms platforms={r.platforms} /> },
                  { key: "requesters", header: "People", align: "right", sort: (r) => r.requesters, cell: (r) => <span className="font-medium">{formatExact(r.requesters)}</span> },
                  {
                    key: "issue",
                    header: "Issue",
                    sort: (r) => r.issueNumber ?? 0,
                    cell: (r) =>
                      r.issueNumber ? (
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Ext href={r.issueUrl ?? issueUrl(r.issueNumber)} className="font-mono">#{r.issueNumber}</Ext>
                          {r.issueState ? <Pill value={r.issueState} /> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      ),
                  },
                  { key: "fix", header: "Fix", cell: (r) => <FixLinks request={r} /> },
                  {
                    key: "release",
                    header: "Release",
                    sort: (r) => r.releaseTag ?? "",
                    cell: (r) =>
                      r.releaseTag ? (
                        <span className="grid gap-0.5 font-mono text-[11px] whitespace-nowrap">
                          <Ext href={releaseUrl(r.releaseTag)}>{r.releaseTag}</Ext>
                          {r.stableTag && r.stableTag !== r.releaseTag ? <Ext href={releaseUrl(r.stableTag)} className="text-muted-foreground">stable {r.stableTag}</Ext> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      ),
                  },
                  { key: "waiting", header: "Replies", align: "right", sort: (r) => r.waiting, cell: (r) => (r.waiting ? <span className="text-chart-3">{r.waiting} waiting</span> : <span className="text-muted-foreground">–</span>) },
                  { key: "last", header: "Last asked", sort: (r) => r.lastSeen ?? 0, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.lastSeen ? formatDate(r.lastSeen) : "–"}</span> },
                ]}
              />
            </div>
          )}
        </Loaded>
      </Panel>
    </>
  );
}

function FixLinks({ request }: { request: Request }) {
  const shas = commitShas(request.fixCommit);
  const pulls = pullNumbers(request.fixPr);
  if (!shas.length && !pulls.length) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex flex-wrap gap-x-1.5 font-mono text-[11px]">
      {shas.map((sha) => (
        <Ext key={sha} href={commitUrl(sha)}>{sha.slice(0, 7)}</Ext>
      ))}
      {pulls.map((n) => (
        <Ext key={n} href={pullUrl(n)}>#{n}</Ext>
      ))}
    </span>
  );
}

function RequestDetail({ request }: { request: Request }) {
  return (
    <div className="grid gap-3 px-4 py-3 text-xs sm:px-5">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
        {request.triageStatus ? <span>Ledger: {request.triageStatus}</span> : null}
        {request.issueTitle ? <span>Issue: {request.issueTitle}</span> : null}
        {request.labels.length ? <span>Labels: {request.labels.join(", ")}</span> : null}
        {request.firstSeen ? <span>First asked {formatDate(request.firstSeen)}</span> : null}
        {request.commentUrl ? <Ext href={request.commentUrl}>GitHub comment</Ext> : null}
      </div>
      {request.note ? <p className="whitespace-pre-wrap text-foreground/80">{request.note}</p> : null}
      <ul className="grid gap-2">
        {request.items.map((item) => (
          <li key={item.id} className="grid gap-0.5 rounded-lg border bg-card px-3 py-2">
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <Platforms platforms={[item.platform]} />
              <span>{item.author ?? "unknown"}</span>
              {item.createdAt ? <span>{formatDate(item.createdAt)}</span> : null}
              {item.url ? <Ext href={item.url} className="ml-auto">Open post</Ext> : null}
            </span>
            <span className="line-clamp-4 whitespace-pre-wrap text-foreground/90">{item.text}</span>
          </li>
        ))}
        {!request.items.length ? <li className="text-muted-foreground">No linked feedback items.</li> : null}
      </ul>
    </div>
  );
}
