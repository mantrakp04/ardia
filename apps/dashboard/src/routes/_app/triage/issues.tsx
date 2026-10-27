import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, TableSkeleton } from "@/components/section";
import { Ext, FilterSelect, Pill, SearchBox, Toolbar, matches, optionsOf, useTriage } from "@/components/triage/shared";
import { formatDate, formatExact } from "@/lib/format";
import { issueUrl } from "@/lib/triage-links";

export const Route = createFileRoute("/_app/triage/issues")({
  component: TriageIssues,
});

function TriageIssues() {
  const query = useTriage("issues");
  const [state, setState] = useState("open");
  const [linked, setLinked] = useState("");
  const [search, setSearch] = useState("");
  const rows = query.data?.issues ?? [];
  const filtered = useMemo(
    () =>
      rows.filter(
        (i) =>
          (!state || i.state === state) &&
          (!linked || (linked === "yes") === i.requests.length > 0) &&
          matches(search, i.title, `#${i.number}`, i.author, ...i.labels, ...i.requests.map((r) => r.title)),
      ),
    [rows, state, linked, search],
  );
  return (
    <>
      <Toolbar>
        <FilterSelect label="State" value={state} onChange={setState} options={optionsOf(rows, (i) => i.state)} />
        <FilterSelect
          label="Linked request"
          value={linked}
          onChange={setLinked}
          options={[
            { value: "yes", label: "Has a request", n: rows.filter((i) => i.requests.length).length },
            { value: "no", label: "No request", n: rows.filter((i) => !i.requests.length).length },
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search issues…" />
      </Toolbar>
      <Panel title="Issues" description={query.data ? `${formatExact(filtered.length)} of ${formatExact(rows.length)} GitHub issues, with the triage requests that point at them.` : "Loading issues…"} bodyClassName="px-0 sm:px-0">
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={7} /></div>}>
          {() => (
            <div className="px-2 sm:px-3">
              <DataTable
                dense
                rows={filtered}
                rowKey={(i) => String(i.number)}
                limit={60}
                empty="No issues match"
                columns={[
                  { key: "number", header: "#", sort: (i) => i.number, cell: (i) => <Ext href={i.url ?? issueUrl(i.number)} className="font-mono">#{i.number}</Ext> },
                  { key: "title", header: "Title", sort: (i) => i.title, cell: (i) => <span className="line-clamp-2 min-w-56">{i.title}</span> },
                  {
                    key: "state",
                    header: "State",
                    sort: (i) => i.state ?? "",
                    cell: (i) => (
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <Pill value={i.state} />
                        {i.stateReason ? <span className="text-[10.5px] text-muted-foreground lowercase">{i.stateReason.replace(/_/g, " ")}</span> : null}
                      </span>
                    ),
                  },
                  { key: "labels", header: "Labels", cell: (i) => (i.labels.length ? <span className="text-muted-foreground">{i.labels.join(", ")}</span> : <span className="text-muted-foreground">–</span>) },
                  { key: "author", header: "Author", sort: (i) => i.author ?? "", cell: (i) => (i.author ? <Ext href={`https://github.com/${i.author}`}>{i.author}</Ext> : "–") },
                  {
                    key: "requests",
                    header: "Requests",
                    sort: (i) => i.requests.length,
                    cell: (i) =>
                      i.requests.length ? (
                        <span className="grid gap-0.5" title={i.requests.map((r) => r.title).join("\n")}>
                          {i.requests.slice(0, 2).map((r) => (
                            <span key={r.id} className="line-clamp-1 max-w-64">
                              <span className="font-mono text-muted-foreground">#{r.id}</span> {r.title}
                            </span>
                          ))}
                          {i.requests.length > 2 ? <span className="text-muted-foreground">+{i.requests.length - 2} more</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      ),
                  },
                  { key: "people", header: "People", align: "right", sort: (i) => i.requesters, cell: (i) => (i.requesters ? formatExact(i.requesters) : <span className="text-muted-foreground">–</span>) },
                  { key: "created", header: "Opened", sort: (i) => i.createdAt ?? 0, cell: (i) => <span className="whitespace-nowrap text-muted-foreground">{i.createdAt ? formatDate(i.createdAt) : "–"}</span> },
                ]}
              />
            </div>
          )}
        </Loaded>
      </Panel>
    </>
  );
}
