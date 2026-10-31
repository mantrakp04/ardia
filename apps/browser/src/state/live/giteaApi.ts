import { GITEA_PAGE, giteaPages, type GiteaCombinedStatus, type GiteaDetails, type GiteaPull, type GiteaPullRef, type GiteaReview } from "./gitea";
import { endpoints, form, request, requestPage } from "./net";
import { LiveError } from "./types";

export type GiteaTokens = { access: string; refresh: string; expiresAt: number };

export const GITEA_BATCH = 6;

export async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return out;
}

export function giteaApi(site: string, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const url = (path: string) => `${endpoints.gitea(site)}/api/v1${path}`;
  return {
    get: <T>(path: string) => request<T>(url(path), { headers }),
    list: <B, T>(path: string, items: (body: B) => T[]) =>
      giteaPages((page) => requestPage<B>(url(`${path}${path.includes("?") ? "&" : "?"}limit=${GITEA_PAGE}&page=${page}`), { headers }), items),
  };
}

export type GiteaApi = ReturnType<typeof giteaApi>;

function oauthRefusal(message: string): string {
  try {
    const json = JSON.parse(message.replace(/^\d+ /, "")) as { error?: string; error_description?: string };
    return json.error_description || json.error || "Gitea didn't accept the sign-in";
  } catch {
    return "Gitea didn't accept the sign-in";
  }
}

export async function giteaTokens(site: string, fields: Record<string, string>): Promise<GiteaTokens> {
  const json = await request<{ access_token: string; refresh_token: string; expires_in: number }>(`${endpoints.gitea(site)}/login/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(fields),
  }).catch((error: unknown) => {
    const refused = error instanceof LiveError && (error.kind === "signedOut" || (error.kind === "other" && /^4\d\d /.test(error.message)));
    throw refused ? new LiveError("signedOut", oauthRefusal(error.message)) : error;
  });
  return { access: json.access_token, refresh: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

const missing = (error: unknown): null => {
  if (error instanceof LiveError && error.kind === "other" && error.message.startsWith("404")) return null;
  throw error;
};

type RequiredApprovals = (repo: string, branch: string) => Promise<number | null>;

export function giteaRequiredApprovals(get: <T>(path: string) => Promise<T>): RequiredApprovals {
  const branches = new Map<string, Promise<number | null>>();
  return (repo, branch) => {
    const key = `${repo}:${branch}`;
    if (!branches.has(key)) {
      const path = `/repos/${repo}/branches/${branch.split("/").map(encodeURIComponent).join("/")}`;
      branches.set(key, get<{ required_approvals?: number }>(path).then((b) => b.required_approvals ?? 0, () => null));
    }
    return branches.get(key)!;
  };
}

export async function giteaDetails(api: GiteaApi, requiredApprovals: RequiredApprovals, ref: GiteaPullRef): Promise<GiteaDetails | null> {
  const path = `/repos/${ref.repo}/pulls/${ref.number}`;
  const pull = await api.get<GiteaPull>(path).catch(missing);
  if (!pull) return null;
  const [reviews, statuses, required] = await Promise.all([
    api.list(`${path}/reviews`, (page: GiteaReview[]) => page).catch(missing),
    api.list(`/repos/${ref.repo}/commits/${pull.head.sha}/status`, (page: GiteaCombinedStatus | null) => page?.statuses ?? []).catch(missing),
    requiredApprovals(ref.repo, pull.base.ref),
  ]);
  return { ...ref, pull, reviews, status: statuses && { statuses }, requiredApprovals: required };
}
