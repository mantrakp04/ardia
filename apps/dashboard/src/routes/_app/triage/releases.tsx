import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel } from "@/components/blocks";
import { DataTable } from "@/components/data-table";
import { Loaded, TableSkeleton } from "@/components/section";
import { Ext, FilterSelect, Pill, Toolbar, optionsOf, useTriage } from "@/components/triage/shared";
import { formatDate, formatExact } from "@/lib/format";
import type { TriageData } from "@/server/triage/load";

export const Route = createFileRoute("/_app/triage/releases")({
  component: TriageReleases,
});

type Release = TriageData<"releases">["releases"][number];

function TriageReleases() {
  const query = useTriage("releases");
  const [channel, setChannel] = useState("");
  const rows = query.data?.releases ?? [];
  const filtered = useMemo(() => rows.filter((r) => !channel || r.channel === channel), [rows, channel]);
  return (
    <>
      <Toolbar>
        <FilterSelect label="Channel" value={channel} onChange={setChannel} options={optionsOf(rows, (r) => r.channel)} />
      </Toolbar>
      <Panel title="Releases" description="Each release with its announcement, its Discord thread and the people tagged in it. Click one for the details." bodyClassName="px-0 sm:px-0">
        <Loaded query={query} skeleton={<div className="px-4 sm:px-5"><TableSkeleton rows={10} columns={7} /></div>}>
          {() => (
            <div className="px-2 sm:px-3">
              <DataTable
                dense
                rows={filtered}
                rowKey={(r) => r.tag}
                limit={30}
                expand={(r) => <ReleaseDetail release={r} />}
                columns={[
                  {
                    key: "tag",
                    header: "Release",
                    sort: (r) => r.publishedAt ?? 0,
                    cell: (r) => (
                      <span className="flex items-center gap-1.5 font-mono text-[12px]">
                        <Ext href={r.url}>{r.tag}</Ext>
                        {r.isLatest ? <Pill value="latest" /> : null}
                      </span>
                    ),
                  },
                  { key: "channel", header: "Channel", sort: (r) => r.channel ?? "", cell: (r) => <Pill value={r.channel} /> },
                  { key: "published", header: "Published", sort: (r) => r.publishedAt ?? 0, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.publishedAt ? formatDate(r.publishedAt) : "–"}</span> },
                  { key: "fixes", header: "Fixed requests", align: "right", sort: (r) => r.fixes.length, cell: (r) => formatExact(r.fixes.length) },
                  {
                    key: "announcement",
                    header: "Announcement",
                    cell: (r) => (
                      <span className="flex flex-wrap gap-x-2 whitespace-nowrap">
                        {r.announcements.map((a) => (
                          <Ext key={a.id} href={a.url}>{a.platform ?? "post"}</Ext>
                        ))}
                        {r.xPostUrl ? <Ext href={r.xPostUrl}>x</Ext> : null}
                        {!r.announcements.length && !r.xPostUrl ? <span className="text-muted-foreground">–</span> : null}
                      </span>
                    ),
                  },
                  { key: "thread", header: "Thread", cell: (r) => (r.threadUrl ? <Ext href={r.threadUrl}>Discord thread</Ext> : <span className="text-muted-foreground">–</span>) },
                  { key: "tagged", header: "Tagged", align: "right", sort: (r) => r.tagged.length, cell: (r) => formatExact(r.tagged.length) },
                ]}
              />
            </div>
          )}
        </Loaded>
      </Panel>
    </>
  );
}

function ReleaseDetail({ release }: { release: Release }) {
  return (
    <div className="grid gap-4 px-4 py-3 text-xs sm:px-5 lg:grid-cols-3">
      <section className="grid content-start gap-1.5">
        <h3 className="label-mono text-muted-foreground">Fixed requests</h3>
        {release.fixes.length ? (
          <ul className="grid gap-1">
            {release.fixes.map((f) => (
              <li key={f.id}>
                <span className="font-mono text-muted-foreground">#{f.id}</span> {f.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">None recorded.</p>
        )}
      </section>
      <section className="grid content-start gap-1.5">
        <h3 className="label-mono text-muted-foreground">Tagged in the thread</h3>
        {release.tagged.length ? (
          <ul className="grid gap-1.5">
            {release.tagged.map((t, i) => (
              <li key={`${t.username}-${i}`} className="grid gap-0.5">
                <span className="font-medium">
                  <Ext href={t.url}>{t.personName ?? t.username ?? "unknown"}</Ext>
                  {t.username && t.personName && t.username !== t.personName ? <span className="font-normal text-muted-foreground"> @{t.username}</span> : null}
                </span>
                {t.line ? <span className="line-clamp-3 text-muted-foreground">{t.line.replace(/<@\d+>\s*/g, "")}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nobody tagged.</p>
        )}
      </section>
      <section className="grid content-start gap-1.5">
        <h3 className="label-mono text-muted-foreground">Announcement</h3>
        {release.announcements.length ? (
          release.announcements.map((a) => (
            <p key={a.id} className="max-h-72 overflow-y-auto rounded-md bg-card px-2.5 py-2 whitespace-pre-wrap">
              {a.text}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground">No announcement mirrored.</p>
        )}
      </section>
    </div>
  );
}
