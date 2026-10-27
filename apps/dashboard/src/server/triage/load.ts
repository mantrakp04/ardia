import { count, list, text, time, triageDatabase, triageRows } from "./connection";
import { effectiveRepliesSql, ensureReplyActions, loadReplies } from "./replies";

const optionalId = (value: unknown) => (value == null ? null : count(value));

function requestAggregates(db: string) {
  return `SELECT ri.request_id AS request_id, uniqExact(it.person_id) AS requesters, uniqExact(it.id) AS n_items,
            arraySort(groupUniqArray(it.platform)) AS platforms, min(it.created_at) AS first_seen, max(it.created_at) AS last_seen
          FROM ${db}.ardia_request_items AS ri FINAL
          INNER JOIN (SELECT id, person_id, platform, created_at FROM ${db}.ardia_items FINAL) AS it ON it.id = ri.item_id
          GROUP BY ri.request_id`;
}

async function lastSync(signal?: AbortSignal) {
  const rows = await triageRows(`SELECT value FROM ${triageDatabase()}.ardia_state FINAL WHERE key = 'ch_last_sync'`, signal);
  return time(String(rows[0]?.value ?? "").replace("T", " ").replace("Z", ""));
}

export async function loadOverview(signal?: AbortSignal) {
  await ensureReplyActions(signal);
  const db = triageDatabase();
  const [dimensions, replies, releases, top, syncedAt] = await Promise.all([
    triageRows(`SELECT dimension, value, n FROM ${db}.ardia_v_overview WHERE dimension NOT IN ('reply_status', 'drafted_reply_platform')`, signal),
    triageRows(`SELECT ifNull(toString(platform), 'other') AS platform, toString(effective_status) AS status, count() AS n FROM (${effectiveRepliesSql()}) GROUP BY platform, status`, signal),
    triageRows(
      `SELECT rel.tag AS tag, rel.name AS name, rel.channel AS channel, rel.published_at AS published_at, rel.url AS url, rel.x_post_url AS x_post_url,
              ifNull(s.fixed_requests, 0) AS fixed, ifNull(t.tagged, 0) AS tagged, ifNull(an.announcements, 0) AS announcements
       FROM ${db}.ardia_releases AS rel FINAL
       LEFT JOIN (SELECT release_tag, fixed_requests FROM ${db}.ardia_v_shipped) AS s ON s.release_tag = rel.tag
       LEFT JOIN (SELECT release_tag, uniqExact(discord_id) AS tagged FROM ${db}.ardia_tags FINAL GROUP BY release_tag) AS t ON t.release_tag = rel.tag
       LEFT JOIN (SELECT release_tag, count() AS announcements FROM ${db}.ardia_announcements FINAL GROUP BY release_tag) AS an ON an.release_tag = rel.tag
       ORDER BY rel.published_at DESC NULLS LAST LIMIT 8`,
      signal,
    ),
    triageRows(
      `SELECT request_id, title, type, requester_count, platforms, issue_number, issue_url, replies_waiting
       FROM ${db}.ardia_v_open_requests ORDER BY requester_count DESC, request_id LIMIT 10`,
      signal,
    ),
    lastSync(signal),
  ]);
  return {
    syncedAt,
    dimensions: dimensions.map((r) => ({ dimension: String(r.dimension), value: String(r.value), n: count(r.n) })),
    replies: replies.map((r) => ({ platform: String(r.platform), status: String(r.status), n: count(r.n) })),
    releases: releases.map((r) => ({
      tag: String(r.tag),
      name: text(r.name),
      channel: text(r.channel),
      publishedAt: time(r.published_at),
      url: text(r.url),
      xPostUrl: text(r.x_post_url),
      fixed: count(r.fixed),
      tagged: count(r.tagged),
      announcements: count(r.announcements),
    })),
    topOpen: top.map((r) => ({
      id: count(r.request_id),
      title: String(r.title),
      type: text(r.type),
      requesters: count(r.requester_count),
      platforms: list(r.platforms),
      issueNumber: optionalId(r.issue_number),
      issueUrl: text(r.issue_url),
      waiting: count(r.replies_waiting),
    })),
  };
}

export async function loadRequests(signal?: AbortSignal) {
  await ensureReplyActions(signal);
  const db = triageDatabase();
  const [rows, items, syncedAt] = await Promise.all([
    triageRows(
      `SELECT r.id AS id, r.key AS key, r.title AS title, r.type AS type, r.status AS status, r.triage_status AS triage_status,
              r.issue_number AS issue_number, r.issue_url AS issue_url, i.title AS issue_title, i.state AS issue_state,
              r.fix_commit AS fix_commit, r.fix_pr AS fix_pr, r.release_tag AS release_tag, r.stable_tag AS stable_tag,
              r.labels AS labels, r.note AS note, r.gh_comment_url AS gh_comment_url, r.updated_at AS updated_at,
              ifNull(a.requesters, 0) AS requesters, ifNull(a.n_items, 0) AS n_items, a.platforms AS platforms,
              a.first_seen AS first_seen, a.last_seen AS last_seen, ifNull(w.waiting, 0) AS waiting
       FROM ${db}.ardia_requests AS r FINAL
       LEFT JOIN (${requestAggregates(db)}) AS a ON a.request_id = r.id
       LEFT JOIN (SELECT number, title, state FROM ${db}.ardia_issues FINAL) AS i ON i.number = r.issue_number
       LEFT JOIN (SELECT request_id, countIf(effective_status = 'drafted') AS waiting FROM (${effectiveRepliesSql()}) GROUP BY request_id) AS w ON w.request_id = r.id
       ORDER BY r.id`,
      signal,
    ),
    triageRows(
      `SELECT ri.request_id AS request_id, it.id AS id, it.platform AS platform, it.author_handle AS author, it.url AS url,
              substring(ifNull(it.text, ''), 1, 500) AS text, it.created_at AS created_at
       FROM ${db}.ardia_request_items AS ri FINAL
       INNER JOIN (SELECT id, platform, author_handle, url, text, created_at FROM ${db}.ardia_items FINAL) AS it ON it.id = ri.item_id
       ORDER BY it.created_at`,
      signal,
    ),
    lastSync(signal),
  ]);
  const byRequest = new Map<number, { id: number; platform: string; author: string | null; url: string | null; text: string; createdAt: number | null }[]>();
  for (const r of items) {
    const key = count(r.request_id);
    const entry = { id: count(r.id), platform: String(r.platform), author: text(r.author), url: text(r.url), text: String(r.text ?? ""), createdAt: time(r.created_at) };
    byRequest.set(key, [...(byRequest.get(key) ?? []), entry]);
  }
  return {
    syncedAt,
    requests: rows.map((r) => ({
      id: count(r.id),
      key: text(r.key),
      title: String(r.title),
      type: text(r.type),
      status: text(r.status),
      triageStatus: text(r.triage_status),
      issueNumber: optionalId(r.issue_number),
      issueUrl: text(r.issue_url),
      issueTitle: text(r.issue_title),
      issueState: text(r.issue_state),
      fixCommit: text(r.fix_commit),
      fixPr: text(r.fix_pr),
      releaseTag: text(r.release_tag),
      stableTag: text(r.stable_tag),
      labels: list(r.labels),
      note: text(r.note),
      commentUrl: text(r.gh_comment_url),
      updatedAt: time(r.updated_at),
      requesters: count(r.requesters),
      itemCount: count(r.n_items),
      platforms: list(r.platforms),
      firstSeen: time(r.first_seen),
      lastSeen: time(r.last_seen),
      waiting: count(r.waiting),
      items: byRequest.get(count(r.id)) ?? [],
    })),
  };
}

export async function loadReplyQueue(signal?: AbortSignal) {
  const [replies, syncedAt] = await Promise.all([loadReplies(signal), lastSync(signal)]);
  return { syncedAt, replies };
}

export async function loadPeople(signal?: AbortSignal) {
  await ensureReplyActions(signal);
  const db = triageDatabase();
  const rows = await triageRows(
    `SELECT p.id AS id, p.display_name AS display_name, p.x_handle AS x_handle, p.discord_handle AS discord_handle, p.github_login AS github_login,
            p.notes AS notes, ifNull(it.n, 0) AS items, it.platforms AS platforms, it.last_seen AS last_seen, ifNull(rq.n, 0) AS requests,
            ifNull(rp.drafted, 0) AS drafted, ifNull(rp.sent, 0) AS sent, ifNull(tg.n, 0) AS tags
     FROM ${db}.ardia_people AS p FINAL
     LEFT JOIN (SELECT person_id, count() AS n, arraySort(groupUniqArray(platform)) AS platforms, max(created_at) AS last_seen
                FROM ${db}.ardia_items FINAL WHERE person_id IS NOT NULL GROUP BY person_id) AS it ON it.person_id = p.id
     LEFT JOIN (SELECT it.person_id AS person_id, uniqExact(ri.request_id) AS n FROM ${db}.ardia_request_items AS ri FINAL
                INNER JOIN (SELECT id, person_id FROM ${db}.ardia_items FINAL WHERE person_id IS NOT NULL) AS it ON it.id = ri.item_id
                GROUP BY person_id) AS rq ON rq.person_id = p.id
     LEFT JOIN (SELECT person_id, countIf(effective_status = 'drafted') AS drafted, countIf(effective_status = 'sent') AS sent
                FROM (${effectiveRepliesSql()}) WHERE person_id IS NOT NULL GROUP BY person_id) AS rp ON rp.person_id = p.id
     LEFT JOIN (SELECT person_id, count() AS n FROM ${db}.ardia_tags FINAL WHERE person_id IS NOT NULL GROUP BY person_id) AS tg ON tg.person_id = p.id
     ORDER BY items DESC, p.id`,
    signal,
  );
  return {
    people: rows.map((r) => ({
      id: count(r.id),
      name: text(r.display_name),
      xHandle: text(r.x_handle),
      discordHandle: text(r.discord_handle),
      githubLogin: text(r.github_login),
      notes: text(r.notes),
      items: count(r.items),
      platforms: list(r.platforms),
      lastSeen: time(r.last_seen),
      requests: count(r.requests),
      drafted: count(r.drafted),
      sent: count(r.sent),
      tags: count(r.tags),
    })),
  };
}

export async function loadReleases(signal?: AbortSignal) {
  const db = triageDatabase();
  const [releases, announcements, tags, shipped] = await Promise.all([
    triageRows(`SELECT tag, name, channel, published_at, is_latest, url, announcement_message_id, thread_id, x_post_url, processed FROM ${db}.ardia_releases FINAL ORDER BY published_at DESC NULLS LAST`, signal),
    triageRows(`SELECT id, platform, release_tag, url, text, thread_id, posted_at FROM ${db}.ardia_announcements FINAL ORDER BY posted_at`, signal),
    triageRows(
      `SELECT t.release_tag AS release_tag, t.thread_id AS thread_id, t.message_id AS message_id, t.username AS username, p.display_name AS person_name,
              t.request_id AS request_id, t.line_text AS line_text, t.tagged_at AS tagged_at
       FROM ${db}.ardia_tags AS t FINAL
       LEFT JOIN (SELECT id, display_name FROM ${db}.ardia_people FINAL) AS p ON p.id = t.person_id
       ORDER BY t.tagged_at, t.id`,
      signal,
    ),
    triageRows(`SELECT release_tag, request_ids, titles FROM ${db}.ardia_v_shipped`, signal),
  ]);
  const guild = announcements.map((a) => /discord\.com\/channels\/(\d+)\//.exec(String(a.url ?? ""))?.[1]).find(Boolean) ?? null;
  const discordLink = (thread: string | null, message?: string | null) => (guild && thread ? `https://discord.com/channels/${guild}/${thread}${message ? `/${message}` : ""}` : null);
  const group = <T,>(rows: T[], key: (row: T) => string | null) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const k = key(row);
      if (k) map.set(k, [...(map.get(k) ?? []), row]);
    }
    return map;
  };
  const announcementsByTag = group(announcements, (a) => text(a.release_tag));
  const tagsByTag = group(tags, (t) => text(t.release_tag));
  const shippedByTag = new Map(shipped.map((s) => [String(s.release_tag), s]));
  return {
    releases: releases.map((r) => {
      const tag = String(r.tag);
      const fixes = shippedByTag.get(tag);
      const ids = list(fixes?.request_ids);
      const titles = list(fixes?.titles);
      return {
        tag,
        name: text(r.name),
        channel: text(r.channel),
        publishedAt: time(r.published_at),
        isLatest: r.is_latest === true || r.is_latest === 1,
        processed: r.processed === true || r.processed === 1,
        url: text(r.url),
        xPostUrl: text(r.x_post_url),
        threadUrl: discordLink(text(r.thread_id)),
        announcements: (announcementsByTag.get(tag) ?? []).map((a) => ({
          id: count(a.id),
          platform: text(a.platform),
          url: text(a.url),
          text: text(a.text) ?? "",
          postedAt: time(a.posted_at),
        })),
        tagged: (tagsByTag.get(tag) ?? []).map((t) => ({
          username: text(t.username),
          personName: text(t.person_name),
          requestId: optionalId(t.request_id),
          line: text(t.line_text),
          url: discordLink(text(t.thread_id), text(t.message_id)),
          taggedAt: time(t.tagged_at),
        })),
        fixes: ids.map((id, i) => ({ id: count(id), title: titles[i] ?? "" })),
      };
    }),
  };
}

export async function loadIssues(signal?: AbortSignal) {
  const db = triageDatabase();
  const rows = await triageRows(
    `SELECT i.number AS number, i.title AS title, i.state AS state, i.state_reason AS state_reason, i.labels AS labels, i.url AS url,
            i.author AS author, i.created_at AS created_at, i.closed_at AS closed_at, r.ids AS request_ids, r.titles AS request_titles, ifNull(r.requesters, 0) AS requesters
     FROM ${db}.ardia_issues AS i FINAL
     LEFT JOIN (SELECT q.issue_number AS issue_number, groupArray(q.id) AS ids, groupArray(q.title) AS titles, sum(ifNull(a.requesters, 0)) AS requesters
                FROM ${db}.ardia_requests AS q FINAL
                LEFT JOIN (${requestAggregates(db)}) AS a ON a.request_id = q.id
                WHERE q.issue_number IS NOT NULL GROUP BY q.issue_number) AS r ON r.issue_number = i.number
     ORDER BY i.number DESC`,
    signal,
  );
  return {
    issues: rows.map((r) => {
      const ids = list(r.request_ids);
      const titles = list(r.request_titles);
      return {
        number: count(r.number),
        title: text(r.title) ?? "",
        state: text(r.state),
        stateReason: text(r.state_reason),
        labels: list(r.labels),
        url: text(r.url),
        author: text(r.author),
        createdAt: time(r.created_at),
        closedAt: time(r.closed_at),
        requesters: count(r.requesters),
        requests: ids.map((id, i) => ({ id: count(id), title: titles[i] ?? "" })),
      };
    }),
  };
}

export const triageViews = {
  overview: loadOverview,
  requests: loadRequests,
  replies: loadReplyQueue,
  people: loadPeople,
  releases: loadReleases,
  issues: loadIssues,
} satisfies Record<string, (signal?: AbortSignal) => Promise<unknown>>;

export type TriageViews = typeof triageViews;
export type TriageView = keyof TriageViews;
export type TriageData<V extends TriageView> = Awaited<ReturnType<TriageViews[V]>>;
