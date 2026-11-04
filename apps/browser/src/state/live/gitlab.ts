import { withStacks } from "./github";
import { type CheckState, LiveError, type LiveItem, type LiveSourceId, type PullRequestCheck, type PullRequestInfo, type PullRequestSection } from "./types";

export type RawPipeline = { id: number; status: string; web_url: string | null } | null;

export type RawMR = {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  web_url: string;
  state: "opened" | "closed" | "merged" | "locked";
  draft: boolean | null;
  source_branch: string;
  target_branch: string;
  has_conflicts: boolean | null;
  detailed_merge_status: string | null;
  user_notes_count: number;
  changes_count: string | null;
  updated_at: string;
  author: { username: string; name: string; avatar_url: string | null } | null;
  references: { full: string };
  head_pipeline: RawPipeline;
};

export type Approvals = { approvals_required: number; approvals_left: number };

export const GITLAB_PAGE_SIZE = 100;
export const GITLAB_BATCH = 10;

const GITLAB_SOURCE: LiveSourceId = "gitlab";

export function normalizeGitlabSite(site: string): string {
  let normalized = site.trim();
  if (!normalized) return "https://gitlab.com";
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  normalized = normalized.replace(/\/+$/, "");
  normalized = normalized.replace(/\/api\/v4$/i, "");
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}

export function projectPath(raw: RawMR): string {
  const full = raw.references.full;
  const index = full.lastIndexOf("!");
  return index === -1 ? full : full.slice(0, index);
}

export function itemId(raw: RawMR): string {
  return `gitlab:${raw.project_id}:${raw.iid}`;
}

function mrKey(raw: RawMR): string {
  return `${raw.project_id}:${raw.iid}`;
}

export function pipelineChecks(raw: RawMR): PullRequestCheck[] {
  const p = raw.head_pipeline;
  if (!p) return [];
  let state: CheckState;
  switch (p.status) {
    case "success":
      state = "success";
      break;
    case "failed":
    case "canceled":
      state = "failure";
      break;
    case "skipped":
    case "manual":
      state = "neutral";
      break;
    case "running":
    case "pending":
    case "blocked":
    case "waiting_for_resource":
      state = "pending";
      break;
    case "created":
    case "preparing":
    case "scheduled":
      state = "queued";
      break;
    default:
      state = "failure";
  }
  return [{ name: `Pipeline #${p.id}`, state, url: p.web_url }];
}

export function parseChangesCount(value: string | null | undefined): number {
  if (!value) return 0;
  const match = value.match(/^\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export function reviewFromApprovals(approvals: Approvals | null | undefined): PullRequestInfo["review"] {
  if (!approvals) return null;
  if (approvals.approvals_required > 0 && approvals.approvals_left === 0) return "approved";
  if (approvals.approvals_left > 0) return "required";
  return null;
}

export function mergeableFrom(raw: RawMR): PullRequestInfo["mergeable"] {
  if (raw.has_conflicts === true || raw.detailed_merge_status === "conflict") return "conflicting";
  if (["mergeable", "not_approved", "ci_must_pass", "discussions_not_resolved"].includes(raw.detailed_merge_status ?? "")) return "mergeable";
  return "unknown";
}

function mapMR(raw: RawMR, section: PullRequestSection, approvals: Record<string, Approvals>): LiveItem {
  const repo = projectPath(raw);
  const pr: PullRequestInfo = {
    number: raw.iid,
    repo,
    author: raw.author?.username ?? "ghost",
    authorAvatar: raw.author?.avatar_url ?? null,
    draft: Boolean(raw.draft),
    headRef: raw.source_branch,
    baseRef: raw.target_branch,
    review: reviewFromApprovals(approvals[mrKey(raw)]),
    mergeable: mergeableFrom(raw),
    checks: pipelineChecks(raw),
    comments: raw.user_notes_count,
    unresolvedThreads: 0,
    additions: 0,
    deletions: 0,
    changedFiles: parseChangesCount(raw.changes_count),
  };
  return {
    id: itemId(raw),
    source: GITLAB_SOURCE,
    url: raw.web_url,
    title: raw.title,
    subtitle: `${repo} !${raw.iid}`,
    icon: null,
    updatedAt: Date.parse(raw.updated_at) || 0,
    section,
    pr,
  };
}

export function mapGitlab(authored: RawMR[], review: RawMR[], approvals: Record<string, Approvals>): LiveItem[] {
  const items: LiveItem[] = [];
  const seen = new Set<string>();
  for (const raw of authored) {
    const key = mrKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(mapMR(raw, "authored", approvals));
  }
  for (const raw of review) {
    const key = mrKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(mapMR(raw, "review", approvals));
  }
  return withStacks(items);
}

export function mergeRequestsQuery(scope: string): string {
  const body = scope.replace(/^scope=/, "");
  return `scope=${body}&state=opened&per_page=${GITLAB_PAGE_SIZE}&order_by=updated_at&sort=desc`;
}

export function stopsApprovalProbe(error: unknown): boolean {
  return error instanceof LiveError && (error.status === 403 || error.status === 404);
}
