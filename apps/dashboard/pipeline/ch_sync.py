#!/usr/bin/env python3
"""Mirror the Ardia SQLite triage DB into ClickHouse (sandbox.ardia_*).

Usage:
  python3 ch_sync.py                 # ensure schema + views, full sync of every table
  python3 ch_sync.py replies items   # sync only the named tables (used by the dashboard)
  python3 ch_sync.py --verify        # compare SQLite vs ClickHouse row counts, exit 1 on mismatch

Strategy: every table is small, so each sync is TRUNCATE + INSERT (JSONEachRow) per table,
which also propagates deletions. Tables are ReplacingMergeTree ordered by the source primary key,
and the views read with FINAL, so a duplicate insert (e.g. two concurrent syncs) never double counts.
Before any TRUNCATE, actions recorded by the deployed dashboard in sandbox.ardia_reply_actions (never modified
here) that are newer than a reply's SQLite status_at are applied to SQLite replies (and items.replied on 'sent');
a 'recheck' action leaves status alone and sets replies.needs_recheck=1 / recheck_requested_at (see recheck_replies.py);
a 'snooze' / 'unsnooze' action leaves status alone and sets / clears replies.snoozed_until (action time + 24h), stamped
with snooze_changed_at; snoozed_until is mirrored back to ClickHouse ardia_replies.snoozed_until;
the newest action seen is kept in state.ch_reply_actions_applied_at.
Records state.ch_last_sync (full sync) / state.ch_last_sync.<table> in SQLite and exits non-zero on failure.

Env: CLICKHOUSE_PASSWORD (required), CLICKHOUSE_URL (default https://netnyahoo.com/_ch/),
     CLICKHOUSE_USER / CLICKHOUSE_DB (default sandbox).
"""
import base64, datetime, fcntl, json, os, sqlite3, sys, urllib.error, urllib.parse, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import db  # noqa: E402
import leads as _leads  # noqa: E402
import attention as _attention  # noqa: E402

CH_URL = os.environ.get("CLICKHOUSE_URL", "https://netnyahoo.com/_ch/")
CH_USER = os.environ.get("CLICKHOUSE_USER", "sandbox")
CH_DB = os.environ.get("CLICKHOUSE_DB", "sandbox")
PREFIX = "ardia_"
LOCK = os.path.join(BASE, ".ch_sync.lock")

LC = "LowCardinality(String)"
NLC = "LowCardinality(Nullable(String))"
NS = "Nullable(String)"
TS = "DateTime64(3, 'UTC')"
NTS = "Nullable(DateTime64(3, 'UTC'))"
NTS6 = "Nullable(DateTime64(6, 'UTC'))"
TS6 = "DateTime64(6, 'UTC')"

TABLES = {
    "people": ([("id", "UInt32"), ("display_name", NS), ("x_handle", NS), ("x_user_id", NS),
                ("discord_handle", NS), ("discord_id", NS), ("github_login", NS), ("link_note", NS),
                ("notes", NS), ("created_at", NTS)], "id", "synced_at"),
    "items": ([("id", "UInt32"), ("ext_id", NS), ("platform", LC), ("person_id", "Nullable(UInt32)"),
               ("author_handle", NS), ("url", NS), ("text", NS), ("detail", NS), ("kind", NLC),
               ("cluster", NS), ("channel", NLC), ("created_at", NTS6), ("replied", "Nullable(Bool)"),
               ("replied_note", NS), ("notes", NS), ("source", NLC), ("imported_at", NTS)], "id", "synced_at"),
    "requests": ([("id", "UInt32"), ("key", NS), ("title", "String"), ("type", NLC), ("status", NLC),
                  ("triage_status", NLC), ("issue_number", "Nullable(UInt32)"), ("issue_url", NS),
                  ("fix_commit", NS), ("fix_pr", NS), ("release_tag", NLC), ("stable_tag", NLC),
                  ("labels", "Array(LowCardinality(String))"), ("gh_comment_url", NS), ("note", NS),
                  ("created_at", NTS), ("updated_at", TS)], "id", "updated_at"),
    "request_items": ([("request_id", "UInt32"), ("item_id", "UInt32")], "(request_id, item_id)", "synced_at"),
    "replies": ([("id", "UInt32"), ("ext_id", NS), ("request_id", "Nullable(UInt32)"), ("item_id", "Nullable(UInt32)"),
                 ("person_id", "Nullable(UInt32)"), ("platform", NLC), ("target_url", NS), ("intent_url", NS),
                 ("requester", NS), ("topic", NS), ("asked", NS), ("ref", NS), ("text", NS), ("status", NLC),
                 ("status_at", NTS), ("note", NS), ("source", NLC), ("created_at", NTS),
                 ("last_checked_at", NTS), ("needs_recheck", "UInt8"), ("recheck_requested_at", NTS),
                 ("snoozed_until", NTS)], "id", "synced_at"),
    "tags": ([("id", "UInt32"), ("release_tag", NLC), ("thread_id", NS), ("message_id", NS), ("discord_id", "String"),
              ("username", NS), ("person_id", "Nullable(UInt32)"), ("request_id", "Nullable(UInt32)"),
              ("line_text", NS), ("tagged_at", NTS6)], "id", "synced_at"),
    "issues": ([("number", "UInt32"), ("title", NS), ("state", NLC), ("state_reason", NLC),
                ("labels", "Array(LowCardinality(String))"), ("url", NS), ("author", NS), ("created_at", NTS),
                ("closed_at", NTS), ("source_synced_at", NTS)], "number", "synced_at"),
    "releases": ([("tag", "String"), ("name", NS), ("channel", NLC), ("published_at", NTS),
                  ("is_latest", "Nullable(Bool)"), ("url", NS), ("announcement_message_id", NS), ("thread_id", NS),
                  ("x_post_url", NS), ("processed", "Nullable(Bool)")], "tag", "synced_at"),
    "announcements": ([("id", "UInt32"), ("platform", NLC), ("message_id", NS), ("channel_id", NS),
                       ("thread_id", NS), ("release_tag", NLC), ("url", NS), ("text", NS), ("thread_text", NS),
                       ("posted_at", NTS6), ("author", NLC)], "id", "synced_at"),
    "leads": ([("id", "UInt32"), ("post_id", "String"), ("url", NS), ("author_id", NS), ("author_handle", NS),
               ("author_name", NS), ("author_avatar", NS), ("author_verified", "Nullable(Bool)"),
               ("author_verified_type", NLC), ("author_followers", "Nullable(UInt64)"), ("author_bio", NS),
               ("text", NS), ("entities", NS), ("media", NS), ("created_at", NTS),
               ("likes", "Nullable(UInt64)"), ("reposts", "Nullable(UInt64)"), ("replies", "Nullable(UInt64)"),
               ("quotes", "Nullable(UInt64)"), ("views", "Nullable(UInt64)"), ("bookmarks", "Nullable(UInt64)"),
               ("in_reply_to", NS), ("conversation_id", NS), ("topic", NS), ("feature", NLC),
               ("reply_id", "Nullable(UInt32)"), ("video_url", NS), ("video_id", NLC), ("video_t", "Nullable(Float64)"),
               ("video_chapter", NS), ("video_release", NLC), ("video_note", NS), ("status", LC), ("note", NS),
               ("query", NS), ("source", NS), ("sourced_at", NTS)], "id", "synced_at"),
    "attention": ([("id", "String"), ("kind", LC), ("status", LC), ("resume_status", LC),
        ("snooze_until", NTS), ("label", "String"), ("preview_html", "String"), ("report", "String"),
        ("goal_label", NS), ("goal_preview_html", NS), ("goal_report", NS), ("last_tracked_at", NTS),
        ("progress", "Nullable(Float64)"), ("source_links", "String"), ("created_at", TS),
        ("updated_at", TS), ("status_at", TS), ("pinned_at", NTS)], "id", "synced_at"),
    "state": ([("key", "String"), ("value", NS), ("updated_at", TS)], "key", "updated_at"),
}
RENAMES = {("issues", "source_synced_at"): "synced_at"}

def _ts(v, nullable=True):
    if v is None or v == "":
        return None
    d = datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")

def convert(table, ch_type, v, warnings):
    base = ch_type.replace("LowCardinality(", "").replace("Nullable(", "")
    nullable = "Nullable" in ch_type
    if base.startswith("DateTime64"):
        try:
            r = _ts(v)
        except ValueError:
            warnings.append(f"{table}: unparseable timestamp {v!r} -> NULL")
            r = None
        if r is None and not nullable:
            r = "1970-01-01 00:00:00.000000"
        return r
    if base.startswith("Array"):
        if v in (None, ""):
            return []
        try:
            a = json.loads(v)
            return [str(x) for x in a] if isinstance(a, list) else [str(a)]
        except ValueError:
            return [s.strip() for s in str(v).split(",") if s.strip()]
    if v is None:
        return None if nullable else ("" if base.startswith("String") else 0)
    if base.startswith("Float"):
        return float(v)
    if base.startswith("Bool"):
        return bool(int(v))
    if base.startswith("UInt") or base.startswith("Int"):
        return int(v)
    return str(v)

def _auth():
    pw = os.environ.get("CLICKHOUSE_PASSWORD")
    if not pw:
        raise RuntimeError("CLICKHOUSE_PASSWORD is not set")
    return "Basic " + base64.b64encode(f"{CH_USER}:{pw}".encode()).decode()

def ch(sql, data=None, **settings):
    params = {"database": CH_DB, **settings}
    if data is not None:
        params["query"] = sql
        body = data
    else:
        body = sql.encode()
    req = urllib.request.Request(CH_URL + "?" + urllib.parse.urlencode(params), data=body, method="POST",
                                 headers={"Authorization": _auth()})
    import time as _t
    for _i in range(8):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:800]
            raise RuntimeError(f"ClickHouse HTTP {e.code}: {msg.strip()}") from None
        except (urllib.error.URLError, OSError):
            if _i == 7: raise
            _t.sleep(2 + 2 * _i)

def ddl(table):
    cols, order_by, ver = TABLES[table]
    lines = [f"  `{n}` {t}" for n, t in cols] + ["  `synced_at` DateTime64(3, 'UTC')"]
    return (f"CREATE TABLE IF NOT EXISTS {CH_DB}.{PREFIX}{table} (\n" + ",\n".join(lines) +
            f"\n) ENGINE = ReplacingMergeTree({ver}) ORDER BY {order_by}")

VIEWS = {
"ardia_v_reply_queue": """
SELECT rp.id AS reply_id, rp.ext_id AS ext_id, rp.platform AS platform, rp.target_url AS target_url,
       rp.intent_url AS intent_url, rp.text AS text, rp.requester AS requester, p.display_name AS requester_name,
       rp.person_id AS person_id, rp.request_id AS request_id, r.title AS request_title, r.status AS request_status,
       rp.topic AS topic, rp.asked AS asked, rp.created_at AS created_at,
       rp.needs_recheck AS needs_recheck, rp.recheck_requested_at AS recheck_requested_at,
       rp.last_checked_at AS last_checked_at, rp.snoozed_until AS snoozed_until
FROM sandbox.ardia_replies AS rp FINAL
LEFT JOIN (SELECT id, title, status FROM sandbox.ardia_requests FINAL) AS r ON r.id = rp.request_id
LEFT JOIN (SELECT id, display_name FROM sandbox.ardia_people FINAL) AS p ON p.id = rp.person_id
WHERE rp.status = 'drafted'
ORDER BY rp.id
SETTINGS join_use_nulls = 1""",
"ardia_v_open_requests": """
SELECT r.id AS request_id, r.key AS key, r.title AS title, r.type AS type, r.triage_status AS triage_status,
       ifNull(a.requesters, 0) AS requester_count, ifNull(a.n_items, 0) AS item_count, a.platforms AS platforms,
       a.first_seen AS first_seen, a.last_seen AS last_seen,
       r.issue_number AS issue_number, r.issue_url AS issue_url, i.title AS issue_title, i.state AS issue_state,
       ifNull(w.waiting, 0) AS replies_waiting, r.labels AS labels, r.note AS note
FROM sandbox.ardia_requests AS r FINAL
LEFT JOIN (
    SELECT ri.request_id AS request_id, uniqExact(it.person_id) AS requesters, uniqExact(it.id) AS n_items,
           arraySort(groupUniqArray(it.platform)) AS platforms, min(it.created_at) AS first_seen, max(it.created_at) AS last_seen
    FROM sandbox.ardia_request_items AS ri FINAL
    INNER JOIN (SELECT id, person_id, platform, created_at FROM sandbox.ardia_items FINAL) AS it ON it.id = ri.item_id
    GROUP BY ri.request_id) AS a ON a.request_id = r.id
LEFT JOIN (SELECT number, title, state FROM sandbox.ardia_issues FINAL) AS i ON i.number = r.issue_number
LEFT JOIN (SELECT request_id, count() AS waiting FROM sandbox.ardia_replies FINAL WHERE status = 'drafted'
           GROUP BY request_id) AS w ON w.request_id = r.id
WHERE r.status = 'open'
ORDER BY requester_count DESC, r.id
SETTINGS join_use_nulls = 1""",
"ardia_v_shipped": """
SELECT r.release_tag AS release_tag, rel.channel AS channel, rel.published_at AS published_at,
       count() AS fixed_requests, countIf(r.status = 'fixed-stable') AS in_stable,
       groupArray(r.id) AS request_ids, groupArray(r.title) AS titles,
       groupUniqArrayIf(r.stable_tag, r.stable_tag IS NOT NULL) AS stable_tags
FROM sandbox.ardia_requests AS r FINAL
LEFT JOIN (SELECT tag, channel, published_at FROM sandbox.ardia_releases FINAL) AS rel ON rel.tag = r.release_tag
WHERE r.status IN ('fixed-nightly', 'fixed-stable')
GROUP BY release_tag, channel, published_at
ORDER BY published_at DESC NULLS LAST, release_tag
SETTINGS join_use_nulls = 1""",
"ardia_v_overview": """
SELECT 'request_status' AS dimension, ifNull(toString(status), '(null)') AS value, count() AS n FROM sandbox.ardia_requests FINAL GROUP BY value
UNION ALL SELECT 'request_type', ifNull(toString(type), '(null)'), count() FROM sandbox.ardia_requests FINAL GROUP BY 2
UNION ALL SELECT 'open_request_type', ifNull(toString(type), '(null)'), count() FROM sandbox.ardia_requests FINAL WHERE status = 'open' GROUP BY 2
UNION ALL SELECT 'item_platform', toString(platform), count() FROM sandbox.ardia_items FINAL GROUP BY 2
UNION ALL SELECT 'item_kind', ifNull(toString(kind), '(null)'), count() FROM sandbox.ardia_items FINAL GROUP BY 2
UNION ALL SELECT 'reply_status', ifNull(toString(status), '(null)'), count() FROM sandbox.ardia_replies FINAL GROUP BY 2
UNION ALL SELECT 'drafted_reply_platform', ifNull(toString(platform), '(null)'), count() FROM sandbox.ardia_replies FINAL WHERE status = 'drafted' GROUP BY 2
UNION ALL SELECT 'issue_state', ifNull(toString(state), '(null)'), count() FROM sandbox.ardia_issues FINAL GROUP BY 2""",
}

def ensure_schema():
    for t in TABLES:
        ch(ddl(t))
    have = {}
    for l in ch(f"SELECT table, name FROM system.columns WHERE database = '{CH_DB}' AND startsWith(table, '{PREFIX}') "
                "FORMAT JSONEachRow").splitlines():
        if l.strip():
            r = json.loads(l)
            have.setdefault(r["table"], set()).add(r["name"])
    for t, (cols, _, _) in TABLES.items():
        prev = None
        for n, typ in cols:
            if n not in have.get(PREFIX + t, {n}):
                ch(f"ALTER TABLE {CH_DB}.{PREFIX}{t} ADD COLUMN IF NOT EXISTS `{n}` {typ}" + (f" AFTER `{prev}`" if prev else " FIRST"))
            prev = n
    for name, body in VIEWS.items():
        ch(f"CREATE OR REPLACE VIEW {CH_DB}.{name} AS {body.strip()}")

ACTIONS = "ardia_reply_actions"
ACTIONS_STATE = "ch_reply_actions_applied_at"
ACTIONS_OVERLAP_S = 60

def _dt(v):
    if v in (None, ""):
        return None
    d = datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    return (d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)).astimezone(datetime.timezone.utc)

def _iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"

def apply_reply_actions(conn):
    """Apply dashboard actions newer than each reply's SQLite status_at. Returns (applied, skipped)."""
    exists = ch(f"EXISTS TABLE {CH_DB}.{ACTIONS}").strip() == "1"
    if not exists:
        return 0, 0
    mark = _dt(db.get_state(conn, ACTIONS_STATE))
    where = ""
    if mark:
        since = (mark - datetime.timedelta(seconds=ACTIONS_OVERLAP_S)).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        where = f"WHERE at > toDateTime64('{since}', 3, 'UTC')"
    out = ch(f"SELECT reply_id, status, toString(at) AS at_str FROM {CH_DB}.{ACTIONS} {where} "
             f"ORDER BY at, reply_id FORMAT JSONEachRow")
    actions = [json.loads(l) for l in out.splitlines() if l.strip()]
    applied = skipped = 0
    newest = mark
    for a in actions:
        a["at"] = a.pop("at_str")
        rid, st, at = int(a["reply_id"]), a["status"], _dt(a["at"])
        newest = at if newest is None or at > newest else newest
        row = conn.execute("SELECT item_id, status_at, last_checked_at, recheck_requested_at, snooze_changed_at "
                           "FROM replies WHERE id=?", (rid,)).fetchone()
        if st not in ("drafted", "sent", "skipped", "recheck", "snooze", "unsnooze") or row is None:
            print(f"warning: ignoring reply action {rid} -> {st!r} at {a['at']} "
                  f"({'unknown status' if row else 'no such reply'})", file=sys.stderr)
            skipped += 1
            continue
        if st == "recheck":
            req, chk = _dt(row["recheck_requested_at"]), _dt(row["last_checked_at"])
            if (req is not None and at <= req) or (chk is not None and at <= chk):
                skipped += 1
                continue
            conn.execute("UPDATE replies SET needs_recheck=1, recheck_requested_at=? WHERE id=?", (_iso(at), rid))
            applied += 1
            continue
        if st in ("snooze", "unsnooze"):
            prev = _dt(row["snooze_changed_at"])
            if prev is not None and at <= prev:
                skipped += 1
                continue
            until = _iso(at + datetime.timedelta(hours=db.SNOOZE_HOURS)) if st == "snooze" else None
            db.set_reply_snooze(conn, rid, until, at=_iso(at), commit=False)
            applied += 1
            continue
        cur = _dt(row["status_at"])
        if cur is not None and at <= cur:
            skipped += 1
            continue
        conn.execute("UPDATE replies SET status=?, status_at=? WHERE id=?", (st, _iso(at), rid))
        if st == "sent" and row["item_id"]:
            conn.execute("UPDATE items SET replied=1, replied_note=COALESCE(replied_note,'reply sent via dashboard') "
                         "WHERE id=?", (row["item_id"],))
        applied += 1
    if newest is not None and newest != mark:
        db.set_state(conn, ACTIONS_STATE, _iso(newest))
    else:
        conn.commit()
    return applied, skipped

def sqlite_rows(conn, table):
    cols, order_by, _ = TABLES[table]
    src = [RENAMES.get((table, n), n) for n, _ in cols]
    return conn.execute(f"SELECT {', '.join(src)} FROM {table}").fetchall()

def sync_table(conn, table, synced_at, warnings):
    cols, _, _ = TABLES[table]
    rows = sqlite_rows(conn, table)
    lines = []
    for r in rows:
        d = {n: convert(table, t, r[i], warnings) for i, (n, t) in enumerate(cols)}
        d["synced_at"] = synced_at
        lines.append(json.dumps(d, ensure_ascii=False))
    full = f"{CH_DB}.{PREFIX}{table}"
    ch(f"TRUNCATE TABLE {full}")
    if lines:
        ch(f"INSERT INTO {full} FORMAT JSONEachRow", data=("\n".join(lines) + "\n").encode(),
           input_format_skip_unknown_fields=0)
    got = int(ch(f"SELECT count() FROM {full} FINAL").strip())
    if got != len(rows):
        raise RuntimeError(f"{table}: SQLite has {len(rows)} rows, ClickHouse has {got} after insert")
    return len(rows)

def sync(tables=None, ensure=True):
    """Sync the given tables (default: all). Returns {table: rowcount}. Raises on failure."""
    tables = list(tables or TABLES)
    bad = [t for t in tables if t not in TABLES]
    if bad:
        raise ValueError(f"unknown tables: {bad}")
    full = set(tables) == set(TABLES)
    with open(LOCK, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        if ensure:
            ensure_schema()
        conn = _leads.connect()
        _attention.ensure(conn)
        try:
            applied, skipped = apply_reply_actions(conn)
            if applied or skipped:
                print(f"reply actions: applied {applied}, skipped {skipped}", file=sys.stderr)
            attention_applied = _attention.apply_actions(conn, ch, CH_DB)
            if attention_applied:
                print(f"attention actions: applied {attention_applied}", file=sys.stderr)
            _attention.wake(conn)
            stamp = db.now()
            synced_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            warnings, counts = [], {}
            for t in [t for t in tables if t != "state"]:
                counts[t] = sync_table(conn, t, synced_at, warnings)
            db.set_state(conn, "ch_last_sync" if full else "ch_last_partial_sync", stamp)
            if full:
                db.set_state(conn, "ch_last_sync_counts", counts)
            counts["state"] = sync_table(conn, "state", synced_at, warnings)
            if not full and "state" not in tables:
                counts.pop("state")
            for w in sorted(set(warnings)):
                print("warning:", w, file=sys.stderr)
            return counts
        finally:
            conn.close()

def verify():
    conn = _leads.connect()
    _attention.ensure(conn)
    ok = True
    for t in TABLES:
        s = conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        c = int(ch(f"SELECT count() FROM {CH_DB}.{PREFIX}{t} FINAL").strip())
        ok &= s == c
        print(f"{PREFIX}{t:<15} sqlite={s:<6} clickhouse={c:<6} {'OK' if s == c else 'MISMATCH'}")
    for v in VIEWS:
        print(f"{v:<26} rows={ch(f'SELECT count() FROM {CH_DB}.{v}').strip()}")
    conn.close()
    return ok

def main(argv):
    try:
        if "--verify" in argv:
            return 0 if verify() else 1
        counts = sync([a for a in argv if not a.startswith("-")] or None)
        print("ch_sync ok: " + ", ".join(f"{PREFIX}{t}={n}" for t, n in counts.items()))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"ch_sync FAILED: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
