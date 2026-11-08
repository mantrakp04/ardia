import type { RangeKey } from "../../lib/range";
import type { AttentionItem } from "../../lib/attention-model";
import { escapeHtml } from "../../lib/attention-model";
import { loadAttentionItems } from "../attention-store";
import { attention as signals, type Item } from "./attention-signals";

const LABELS: Record<string, string> = {
  coverage: "Check gaps in daily user counts", "crash-rate": "Check the rise in stable crashes",
  "unclean-stable": "Check the rise in unclean exits", "first-launch": "Speed up the first launch after updates",
  retention: "Check why fewer new users return", "perf-warm": "Check slower browser launches",
  "perf-first": "Check slower launches after updates", "perf-omnibox": "Check slower address bar results",
  "perf-switch": "Check slower profile switching", "perf-memory": "Check higher memory use",
};
export function signalItem(item: Item, range: RangeKey): AttentionItem {
  const stamp = new Date().toISOString();
  const label = (LABELS[item.key] || item.title).slice(0, 50);
  const chip = item.severity === "high" ? "Needs a fix" : item.severity === "medium" ? "Take a look" : "Worth knowing";
  let hash = 2166136261;
  for (const c of item.key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return { id: `signal:${item.rule}:${(hash >>> 0).toString(16)}`, kind: `signal-${item.rule}`, status: "open", resume_status: "open", snooze_until: null,
    label, preview_html: `<span class="chip">${chip}</span><h2>${escapeHtml(item.value)}</h2><p>${escapeHtml(item.comparison)}</p>`,
    report: `${item.title}\n\nWindow: ${range}\n\nWhat we saw\n${item.value}\n\nCompared with before\n${item.comparison}\n\nNext step\nOpen the source page. Check the affected versions and people before deciding what to change.`,
    goal_label: null, goal_preview_html: null, goal_report: null, last_tracked_at: null, progress: null,
    source_links: [{ label: "See the data", url: `${item.to}?range=${range}` }], created_at: stamp, updated_at: stamp,
    status_at: "1970-01-01T00:00:00.000Z", pinned_at: null };
}
export async function attention(range: RangeKey, signal?: AbortSignal) {
  const data = await signals(range, signal);
  const items = await loadAttentionItems(data.items.map((item) => signalItem(item, range)), signal);
  return { ...data, items };
}
