import { count, sqlString, text, time, triageDatabase, triageExec, triageRows } from "./connection";

export const REPLY_STATUSES = ["drafted", "sent", "skipped"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];
export const RECHECK_ACTION = "recheck";

const ACTIONS_TABLE = "ardia_reply_actions";

let actionsReady: Promise<void> | null = null;

export function ensureReplyActions(signal?: AbortSignal): Promise<void> {
  actionsReady ??= triageExec(
    `CREATE TABLE IF NOT EXISTS ${triageDatabase()}.${ACTIONS_TABLE} (
       reply_id UInt32, status LowCardinality(String), at DateTime64(3, 'UTC'), actor String
     ) ENGINE = MergeTree ORDER BY (reply_id, at)`,
    signal,
  ).catch((error) => {
    actionsReady = null;
    throw error;
  });
  return actionsReady;
}

export function effectiveRepliesSql() {
  const db = triageDatabase();
  const fromSource = "a.last_status IS NULL OR (rp.status != 'drafted' AND rp.status_at > a.last_at)";
  return `SELECT rp.*,
       if(${fromSource}, rp.status, a.last_status) AS effective_status,
       if(${fromSource}, rp.status_at, a.last_at) AS effective_at,
       a.last_actor AS actor
     FROM ${db}.ardia_replies AS rp FINAL
     LEFT JOIN (SELECT reply_id, argMax(status, at) AS last_status, max(at) AS last_at, argMax(actor, at) AS last_actor
                FROM ${db}.${ACTIONS_TABLE} WHERE status != '${RECHECK_ACTION}' GROUP BY reply_id) AS a ON a.reply_id = rp.id`;
}

export async function loadReplies(signal?: AbortSignal) {
  await ensureReplyActions(signal);
  const db = triageDatabase();
  const rows = await triageRows(
    `SELECT e.id AS id, e.ext_id AS ext_id, e.platform AS platform, e.target_url AS target_url, e.intent_url AS intent_url,
            e.requester AS requester, e.topic AS topic, e.asked AS asked, e.ref AS ref, e.text AS text,
            e.effective_status AS status, e.effective_at AS status_at, e.actor AS actor, e.note AS note, e.created_at AS created_at,
            e.request_id AS request_id, r.title AS request_title, r.status AS request_status,
            e.person_id AS person_id, p.display_name AS person_name, p.x_handle AS x_handle,
            e.needs_recheck AS needs_recheck, e.recheck_requested_at AS recheck_requested_at, e.last_checked_at AS last_checked_at,
            rc.pressed_at AS recheck_pressed_at, rc.pressed_by AS recheck_pressed_by
     FROM (${effectiveRepliesSql()}) AS e
     LEFT JOIN (SELECT reply_id, max(at) AS pressed_at, argMax(actor, at) AS pressed_by
                FROM ${db}.${ACTIONS_TABLE} WHERE status = '${RECHECK_ACTION}' GROUP BY reply_id) AS rc ON rc.reply_id = e.id
     LEFT JOIN (SELECT id, title, status FROM ${db}.ardia_requests FINAL) AS r ON r.id = e.request_id
     LEFT JOIN (SELECT id, display_name, x_handle FROM ${db}.ardia_people FINAL) AS p ON p.id = e.person_id
     ORDER BY e.id`,
    signal,
  );
  return rows.map((r) => {
    const lastCheckedAt = time(r.last_checked_at);
    const recheckPressedAt = time(r.recheck_pressed_at);
    const recheckQueued = count(r.needs_recheck) > 0 || (recheckPressedAt != null && (lastCheckedAt == null || recheckPressedAt > lastCheckedAt));
    return {
      id: count(r.id),
      extId: text(r.ext_id),
      platform: text(r.platform) ?? "other",
      targetUrl: text(r.target_url),
      intentUrl: text(r.intent_url),
      requester: text(r.requester),
      topic: text(r.topic),
      asked: text(r.asked),
      ref: text(r.ref),
      text: text(r.text) ?? "",
      status: (text(r.status) ?? "drafted") as ReplyStatus,
      statusAt: time(r.status_at),
      actor: text(r.actor),
      note: text(r.note),
      createdAt: time(r.created_at),
      requestId: r.request_id == null ? null : count(r.request_id),
      requestTitle: text(r.request_title),
      requestStatus: text(r.request_status),
      personId: r.person_id == null ? null : count(r.person_id),
      personName: text(r.person_name),
      xHandle: text(r.x_handle),
      lastCheckedAt,
      recheckQueued,
      recheckRequestedAt: recheckQueued ? (recheckPressedAt ?? time(r.recheck_requested_at)) : null,
      recheckRequestedBy: recheckQueued ? text(r.recheck_pressed_by) : null,
    };
  });
}

export async function setReplyStatus(id: number, status: ReplyStatus, actor: string, signal?: AbortSignal) {
  await ensureReplyActions(signal);
  const db = triageDatabase();
  const exists = await triageRows(`SELECT count() AS n FROM ${db}.ardia_replies FINAL WHERE id = ${id}`, signal);
  if (!count(exists[0]?.n)) throw new Error(`Reply ${id} doesn't exist`);
  const stamp = await triageRows(`SELECT toString(now64(3, 'UTC')) AS at`, signal);
  const at = sqlString(String(stamp[0]?.at));
  await triageExec(
    `INSERT INTO ${db}.${ACTIONS_TABLE} (reply_id, status, at, actor) VALUES (${id}, ${sqlString(status)}, ${at}, ${sqlString(actor)})`,
    signal,
  );
  await triageExec(
    `INSERT INTO ${db}.ardia_replies
     SELECT * REPLACE (${sqlString(status)} AS status, toDateTime64(${at}, 3, 'UTC') AS status_at, toDateTime64(${at}, 3, 'UTC') AS synced_at)
     FROM ${db}.ardia_replies FINAL WHERE id = ${id}`,
    signal,
  );
  return { id, status, at: time(stamp[0]?.at) };
}

export async function requestRecheck(ids: number[], actor: string, signal?: AbortSignal) {
  await ensureReplyActions(signal);
  const db = triageDatabase();
  const unique = [...new Set(ids)];
  if (!unique.length) return { ids: [] as number[], at: null };
  const known = await triageRows(`SELECT id FROM ${db}.ardia_replies FINAL WHERE id IN (${unique.join(", ")})`, signal);
  const found = new Set(known.map((r) => count(r.id)));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`Repl${missing.length === 1 ? "y" : "ies"} ${missing.join(", ")} don't exist`);
  const stamp = await triageRows(`SELECT toString(now64(3, 'UTC')) AS at`, signal);
  const at = sqlString(String(stamp[0]?.at));
  const values = unique.map((id) => `(${id}, '${RECHECK_ACTION}', ${at}, ${sqlString(actor)})`).join(", ");
  await triageExec(`INSERT INTO ${db}.${ACTIONS_TABLE} (reply_id, status, at, actor) VALUES ${values}`, signal);
  return { ids: unique, at: time(stamp[0]?.at) };
}
