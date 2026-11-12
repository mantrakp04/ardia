import type { Lead } from "../server/triage/leads";
export const LEAD_SORTS = [["newest", "Newest"], ["followers", "Followers"], ["views", "Views"]] as const;
export type LeadSort = (typeof LEAD_SORTS)[number][0];
type SortableLead = Pick<Lead, "id" | "author" | "metrics" | "createdAt">;
function descending(a: number | null | undefined, b: number | null | undefined) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return b - a;
}
export function compareLeads(a: SortableLead | undefined, b: SortableLead | undefined, sort: LeadSort) {
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  const metric = sort === "followers" ? descending(a.author.followers, b.author.followers)
    : sort === "views" ? descending(a.metrics.views, b.metrics.views) : 0;
  return metric || descending(a.createdAt, b.createdAt) || b.id - a.id;
}
