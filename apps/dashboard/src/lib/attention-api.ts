import { createServerFn } from "@tanstack/react-start";
import { requireAllowed } from "./api";
import { ATTENTION_STATUSES, type AttentionItem, type AttentionStatus } from "./attention-model";

export const updateAttention = createServerFn({ method: "POST" })
  .middleware([requireAllowed])
  .validator((input: { item: AttentionItem; status: AttentionStatus; until?: string }) => {
    const item = input?.item;
    if (!item || typeof item.id !== "string" || item.id.length > 240 || !/^[\w:./-]+$/.test(item.id)) throw new Error("Invalid task");
    if (!ATTENTION_STATUSES.includes(input.status)) throw new Error("Unknown task status");
    if (!item.label?.trim() || [...item.label].length > 50 || /\n/.test(item.label)) throw new Error("Labels must be 1–50 characters");
    if (typeof item.report !== "string" || typeof item.preview_html !== "string" || JSON.stringify(item).length > 60_000) throw new Error("Invalid report");
    if (!Array.isArray(item.source_links) || item.source_links.some((link) => !link || typeof link.label !== "string" || typeof link.url !== "string")) throw new Error("Invalid sources");
    if (input.status === "snoozed" && (!input.until || !Number.isFinite(Date.parse(input.until)) || Date.parse(input.until) <= Date.now())) throw new Error("Pick a future snooze time");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { setAttentionStatus } = await import("../server/attention-store");
    return setAttentionStatus(data.item, data.status, context.email, data.until);
  });
