import { withStacks } from "./github";
import type { CheckState, CompletionState, LiveItem, PullRequestCheck, PullRequestInfo, PullRequestSection } from "./types";

export const GITEA_SCOPES = "read:issue read:repository read:user";
export const GITEA_SEARCH = "/repos/issues/search?type=pulls&state=open";
export const GITEA_DEFAULT_SITE = "https://gitea.com";
export const GITEA_PAGE = 50;
const GITEA_MAX_PAGES = 20;

type GiteaUser = { id: number; login: string; full_name?: string; avatar_url?: string };

export type GiteaIssue = { number: number; repository: { full_name: string } };

export type GiteaPull = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged: boolean;
  draft?: boolean;
  mergeable?: boolean;
  updated_at: string;
  user: GiteaUser | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  comments?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  requested_reviewers?: GiteaUser[] | null;
  requested_reviewers_teams?: unknown[] | null;
};

export type GiteaReview = { id: number; state: string; official?: boolean; dismissed?: boolean; user: GiteaUser | null };

export type GiteaCombinedStatus = { statuses: { context: string; status: string; target_url?: string | null }[] | null };

export type GiteaPullRef = { repo: string; number: number; section: "authored" | "review" };

export type GiteaDetails = GiteaPullRef & { pull: GiteaPull; reviews: GiteaReview[] | null; status: GiteaCombinedStatus | null; requiredApprovals: number | null };

const WORK_IN_PROGRESS = /^\s*(wip:|\[wip\])/i;

const CHECK_STATES: Record<string, CheckState> = { success: "success", failure: "failure", error: "failure", pending: "pending", warning: "neutral", skipped: "neutral" };

export async function giteaPages<B, T>(load: (page: number) => Promise<{ body: B; total: number | null }>, items: (body: B) => T[]): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= GITEA_MAX_PAGES; page++) {
    const { body, total } = await load(page);
    const found = items(body);
    out.push(...found);
    if (!found.length || out.length >= (total ?? Infinity)) break;
  }
  return out;
}

export function giteaRefs(authored: GiteaIssue[], review: GiteaIssue[]): GiteaPullRef[] {
  const seen = new Set<string>();
  const refs: GiteaPullRef[] = [];
  for (const [section, issues] of [["authored", authored], ["review", review]] as const) {
    for (const issue of issues) {
      const key = `${issue.repository.full_name}#${issue.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ repo: issue.repository.full_name, number: issue.number, section });
    }
  }
  return refs;
}

export function giteaLink(site: string, target: string | null | undefined): string | null {
  if (!target) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  if (target.startsWith("/")) return `${site.match(/^[a-z]+:\/\/[^/]+/i)?.[0] ?? site}${target}`;
  return `${site}/${target}`;
}

export function giteaReview(pull: GiteaPull, reviews: GiteaReview[] | null, requiredApprovals: number | null): PullRequestInfo["review"] {
  const latest = new Map<number, GiteaReview>();
  for (const r of [...(reviews ?? [])].sort((a, b) => a.id - b.id)) {
    if (r.user && !r.dismissed && (r.state === "APPROVED" || r.state === "REQUEST_CHANGES")) latest.set(r.user.id, r);
  }
  const decisions = [...latest.values()];
  if (decisions.some((r) => r.state === "REQUEST_CHANGES")) return "changesRequested";
  const approvals = decisions.filter((r) => r.state === "APPROVED");
  if (requiredApprovals) return approvals.filter((r) => r.official !== false).length >= requiredApprovals ? "approved" : "required";
  if (approvals.length) return "approved";
  return pull.requested_reviewers?.length || pull.requested_reviewers_teams?.length ? "required" : null;
}

function mapPull(site: string, me: string, { repo, number, section, pull, reviews, status, requiredApprovals }: GiteaDetails): LiveItem {
  const draft = pull.draft ?? WORK_IN_PROGRESS.test(pull.title);
  const direct = !!pull.requested_reviewers?.some((u) => u.login === me);
  const checks: PullRequestCheck[] = (status?.statuses ?? []).map((s) => ({ name: s.context, state: CHECK_STATES[s.status] ?? "neutral", url: giteaLink(site, s.target_url) }));
  const prSection: PullRequestSection = section === "authored" ? "authored" : direct ? "review" : "team";
  return {
    id: `gitea:${repo}#${number}`,
    source: "gitea",
    url: pull.html_url,
    title: pull.title,
    subtitle: `${repo} #${number}`,
    icon: null,
    updatedAt: Date.parse(pull.updated_at) || 0,
    section: prSection,
    pr: {
      number,
      repo,
      author: pull.user?.login ?? "ghost",
      authorAvatar: pull.user?.avatar_url || null,
      draft,
      headRef: pull.head.ref,
      baseRef: pull.base.ref,
      review: giteaReview(pull, reviews, requiredApprovals),
      mergeable: draft || pull.mergeable === undefined ? "unknown" : pull.mergeable ? "mergeable" : "conflicting",
      checks,
      comments: pull.comments ?? 0,
      unresolvedThreads: 0,
      additions: pull.additions ?? 0,
      deletions: pull.deletions ?? 0,
      changedFiles: pull.changed_files ?? 0,
    },
  };
}

export function mapGitea(site: string, me: string, details: GiteaDetails[]): LiveItem[] {
  return withStacks(details.filter((d) => d.pull.state === "open" && !d.pull.merged).map((d) => mapPull(site, me, d)));
}

export function giteaCompletion(pull: Pick<GiteaPull, "state" | "merged">, section: LiveItem["section"]): CompletionState | null {
  if (pull.merged) return "merged";
  if (pull.state === "closed") return "closed";
  return section === "review" || section === "team" ? "reviewed" : null;
}
