import type { AttentionItem, AttentionStatus } from "../lib/attention-model";
import { effectiveAttention, overlayAttentionAction } from "../lib/attention-model";
import { triageDatabase, triageRows, triageExec, sqlString } from "./triage/connection";

let ready: Promise<void> | null = null;
export function ensureAttentionActions(signal?: AbortSignal) {
  ready ??= triageExec(`CREATE TABLE IF NOT EXISTS ${triageDatabase()}.ardia_attention_actions (
    id String, status String, at DateTime64(3,'UTC'), actor String, snooze_until String, snapshot String
  ) ENGINE=MergeTree ORDER BY (id,at)`, signal).catch((e) => { ready = null; throw e; });
  return ready;
}
const iso = (v: unknown): string | null => v == null || v === "" ? null : String(v).replace(" ", "T").replace(/Z?$/, "Z");
export async function loadAttentionItems(live: AttentionItem[] = [], signal?: AbortSignal) {
  await ensureAttentionActions(signal);
  const db = triageDatabase();
  const [rows, actions] = await Promise.all([
    triageRows(`SELECT * FROM ${db}.ardia_attention FINAL`, signal),
    triageRows(`SELECT id,argMax(tuple(status,toString(at),snooze_until,snapshot),at) AS action FROM ${db}.ardia_attention_actions GROUP BY id`, signal),
  ]);
  const map = new Map<string, AttentionItem>();
  for (const r of rows) {
    let source_links: AttentionItem["source_links"] = [];
    try { source_links = JSON.parse(String(r.source_links || "[]")); } catch {  }
    map.set(String(r.id), { ...r, source_links, snooze_until: iso(r.snooze_until),
      created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!, status_at: iso(r.status_at)!,
      pinned_at: iso(r.pinned_at), last_tracked_at: iso(r.last_tracked_at),
    } as AttentionItem);
  }
  for (const item of live) {
    const saved = map.get(item.id);
    map.set(item.id, saved ? { ...saved, label: item.label, preview_html: item.preview_html, report: item.report, source_links: item.source_links } : item);
  }
  for (const row of actions) {
    const [status, at, until, snapshot] = row.action as [string, string, string, string];
    let saved = map.get(String(row.id));
    if (!saved) {
      try { saved = JSON.parse(snapshot) as AttentionItem; } catch { continue; }
    }
    const stamp = iso(at)!;
    let before = saved;
    try { before = JSON.parse(snapshot) as AttentionItem; } catch {  }
    saved = overlayAttentionAction(saved, before, status as AttentionStatus, stamp, until || null);
    map.set(String(row.id), saved);
  }
  return [...map.values()].map((r) => effectiveAttention(r));
}
export async function setAttentionStatus(item: AttentionItem, status: AttentionStatus, actor: string, until?: string) {
  await ensureAttentionActions();
  const db = triageDatabase();
  const stamp = (await triageRows("SELECT toString(now64(3,'UTC')) AS at"))[0]?.at;
  if (!stamp) throw new Error("Could not save task time");
  await triageExec(`INSERT INTO ${db}.ardia_attention_actions (id,status,at,actor,snooze_until,snapshot)
    VALUES (${sqlString(item.id)},${sqlString(status)},toDateTime64(${sqlString(String(stamp))},3,'UTC'),${sqlString(actor)},${sqlString(until || "")},${sqlString(JSON.stringify(item))})`);
  return { id: item.id, status, at: iso(stamp)! };
}
