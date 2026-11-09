export const ATTENTION_STATUSES = ["open", "pinned", "done", "dismissed", "snoozed"] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];
export type AttentionItem = {
  id: string; kind: string; status: AttentionStatus; resume_status: string; snooze_until: string | null;
  label: string; preview_html: string; report: string;
  goal_label: string | null; goal_preview_html: string | null; goal_report: string | null;
  last_tracked_at: string | null; progress: number | null;
  source_links: { label: string; url: string }[];
  created_at: string; updated_at: string; status_at: string; pinned_at: string | null;
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function effectiveAttention(item: AttentionItem, now = Date.now()): AttentionItem {
  if (item.status !== "snoozed" || !item.snooze_until || Date.parse(item.snooze_until) > now) return item;
  return { ...item, status: item.resume_status === "pinned" ? "pinned" : "open", snooze_until: null };
}
export function overlayAttentionAction(saved: AttentionItem, before: AttentionItem, status: AttentionStatus, stamp: string, until: string | null): AttentionItem {
  if (stamp < saved.status_at) return saved;
  const prior = before.status === "snoozed" ? before.resume_status : before.status;
  const newPin = status === "pinned" && before.status !== "pinned" && !(before.status === "snoozed" && before.resume_status === "pinned");
  return { ...saved, status, status_at: stamp,
    resume_status: status === "snoozed" ? (prior === "pinned" ? "pinned" : "open") : saved.resume_status,
    snooze_until: status === "snoozed" ? until : null,
    pinned_at: newPin ? stamp : (saved.pinned_at || before.pinned_at) };
}
export function isGoal(item: AttentionItem) {
  return item.status === "pinned" || (item.status === "snoozed" && item.resume_status === "pinned");
}
export function goalReady(item: AttentionItem) {
  return !!(item.goal_label && item.goal_preview_html && item.goal_report && item.last_tracked_at && (!item.pinned_at || item.last_tracked_at >= item.pinned_at));
}
export function safeSource(url: string) {
  return /^\/(?!\/)[a-zA-Z0-9/?#=&._%-]*$/.test(url) || /^https:\/\//i.test(url);
}
export function sanitizePreview(body: string) {
  const tags = new Set(["span", "h2", "h3", "p", "div", "ul", "ol", "li", "strong", "em", "small", "br", "progress"]);
  return body.split(/(<[^>]*>)/g).map((part) => {
    if (!part.startsWith("<")) return part.replace(/</g, "&lt;");
    const tag = /^<(\/?)([a-z0-9]+)\b([^>]*)>$/i.exec(part);
    if (!tag || !tags.has(tag[2]!.toLowerCase())) return "";
    const name = tag[2]!.toLowerCase();
    if (tag[1]) return `</${name}>`;
    const attrs = tag[3] || "";
    const cls = /\bclass=["'](chip|bar)["']/i.exec(attrs);
    const width = /\bstyle=["']width:\s*(\d{1,3}(?:\.\d+)?)%[; ]*["']/i.exec(attrs);
    const value = /\bvalue=["'](\d{1,3}(?:\.\d+)?)["']/i.exec(attrs);
    return `<${name}${cls ? ` class="${cls[1]}"` : ""}${width ? ` style="width:${Math.min(100, Number(width[1]))}%"` : ""}${name === "progress" ? ` max="100"${value ? ` value="${Math.min(100, Number(value[1]))}"` : ""}` : ""}>`;
  }).join("");
}
export function previewDocument(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:16px;font:13px/1.45 system-ui,sans-serif;color:light-dark(#242424,#e7e7e7);overflow-wrap:anywhere}h2{font-size:22px;line-height:1.2;margin:12px 0}p{margin:8px 0;opacity:.75}.chip{display:inline-block;border:1px solid #8885;border-radius:99px;padding:3px 8px;font-size:11px}progress{width:100%;accent-color:#597ded}.bar{height:8px;border-radius:8px;background:#597ded;margin:10px 0}ul{padding-left:18px}li{margin:5px 0}</style></head><body>${sanitizePreview(body)}</body></html>`;
}
