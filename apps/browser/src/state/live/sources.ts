import { CONFLUENCE_CQL, DRIVE_QUERY, mapBitbucket, mapConfluence, mapDrive, mapNotion, NOTION_SEARCH_BODY, type BitbucketPR, type BitbucketStatuses, type ConfluenceSearch, type DriveFiles, type NotionSearch, type NotionUsers } from "./documents";
import { DETAILS_PAGE, detailIds, detailNodes, GITHUB_DETAILS_QUERY, GITHUB_QUERY, GITHUB_STATE_QUERY, GITHUB_VARIABLES, mapGithub, VIEWER_QUERY, withDetails, type DetailsResponse, type GithubResponse } from "./github";
import { basic, deleteSecret, endpoints, form, getSecret, request, setSecret } from "./net";
import { useBrowser } from "../browser/store";
import { accountOf, live, removeProfileAccounts, saveLiveDurably, setAccount, setLegacyAccount, updateConfig } from "./store";
import { LiveError, type CompletionState, type LiveAccount, type LiveFolder, type LiveItem, type LiveSourceId } from "./types";
import { symbolIcon } from "../../lib/customIcon";

export type LiveSource = {
  id: LiveSourceId;
  name: string;
  kind: LiveFolder["kind"];
  site: string;
  fetch(folder: LiveFolder): Promise<LiveItem[]>;
  resolveGone?(folder: LiveFolder, items: LiveItem[]): Promise<Record<string, CompletionState>>;
};

async function secret(source: LiveSourceId, profileId: string): Promise<string> {
  const value = await getSecret(source, profileId);
  if (!value) throw new LiveError(accountOf(profileId, source) ? "signedOut" : "notConfigured", "Not signed in");
  return value;
}

function connected(source: LiveSourceId, profileId: string): LiveAccount {
  const account = accountOf(profileId, source);
  if (!account) throw new LiveError("notConfigured", "Not signed in");
  return account;
}

async function githubGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const json = await request<T & { errors?: { type?: string; message: string }[] }>(endpoints.githubGraphql, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const error = json.errors?.[0];
  if (error && !(json as { data?: unknown }).data) throw new LiveError(error.type === "RATE_LIMITED" ? "rateLimited" : "other", error.message);
  return json;
}

const github: LiveSource = {
  id: "github",
  name: "GitHub",
  kind: "pullRequests",
  site: "https://github.com",
  async fetch(folder) {
    const token = await secret("github", folder.profileId);
    const json = await githubGraphql<GithubResponse>(token, GITHUB_QUERY, GITHUB_VARIABLES);
    const ids = detailIds(json, folder.filters);
    const pages = Array.from({ length: Math.ceil(ids.length / DETAILS_PAGE) }, (_, i) => ids.slice(i * DETAILS_PAGE, (i + 1) * DETAILS_PAGE));
    const page = async (ids: string[]) => detailNodes(ids, await githubGraphql<DetailsResponse>(token, GITHUB_DETAILS_QUERY, { ids }));
    const retry = (ids: string[]) => (error: unknown) =>
      error instanceof LiveError && (error.kind === "other" || error.kind === "network") ? page(ids) : Promise.reject(error);
    const details = await Promise.all(pages.map((ids) => page(ids).catch(retry(ids))));
    return mapGithub(withDetails(json, details.flat()), folder.filters);
  },
  async resolveGone(folder, items) {
    const prs = items.filter((it) => it.source === "github");
    if (!prs.length) return {};
    const token = await secret("github", folder.profileId);
    const ids = prs.map((it) => it.id.slice("github:".length));
    const json = await githubGraphql<{ data?: { nodes: ({ id: string; state: string } | null)[] } }>(token, GITHUB_STATE_QUERY, { ids });
    const out: Record<string, CompletionState> = {};
    for (const n of json.data?.nodes ?? []) {
      if (!n) continue;
      const item = prs.find((it) => it.id === `github:${n.id}`);
      if (!item) continue;
      if (n.state === "MERGED") out[item.id] = "merged";
      else if (n.state === "CLOSED") out[item.id] = "closed";
      else if (item.section === "review" || item.section === "team") out[item.id] = "reviewed";
    }
    return out;
  },
};

const BITBUCKET_STATE_BATCH = 10;

const bitbucketAuth = async (profileId: string) => basic(connected("bitbucket", profileId).user ?? "", await secret("bitbucket", profileId));

const bitbucket: LiveSource = {
  id: "bitbucket",
  name: "Bitbucket",
  kind: "pullRequests",
  site: "https://bitbucket.org",
  async fetch(folder) {
    if (!folder.filters.authored) return [];
    const auth = await bitbucketAuth(folder.profileId);
    const me = connected("bitbucket", folder.profileId);
    const page = await request<{ values: BitbucketPR[] }>(`${endpoints.bitbucket}/pullrequests/${encodeURIComponent(me.login)}?state=OPEN&pagelen=50`, {
      headers: { Authorization: auth },
    });
    return Promise.all(
      page.values.map(async (pr) => {
        const repo = pr.destination.repository.full_name;
        const statuses = await request<BitbucketStatuses>(`${endpoints.bitbucket}/repositories/${repo}/pullrequests/${pr.id}/statuses?pagelen=50`, {
          headers: { Authorization: auth },
        }).catch(() => null);
        return mapBitbucket(pr, statuses);
      }),
    );
  },
  async resolveGone(folder, items) {
    const auth = await bitbucketAuth(folder.profileId);
    const out: Record<string, CompletionState> = {};
    const prs = items.flatMap((it) => (it.pr ? [{ id: it.id, repo: it.pr.repo, number: it.pr.number }] : []));
    for (let i = 0; i < prs.length; i += BITBUCKET_STATE_BATCH) {
      await Promise.all(
        prs.slice(i, i + BITBUCKET_STATE_BATCH).map(async ({ id, repo, number }) => {
          const pr = await request<{ state: string }>(`${endpoints.bitbucket}/repositories/${repo}/pullrequests/${number}`, { headers: { Authorization: auth } }).catch(() => null);
          if (pr?.state === "MERGED") out[id] = "merged";
          else if (pr?.state === "DECLINED" || pr?.state === "SUPERSEDED") out[id] = "closed";
        }),
      );
    }
    return out;
  },
};

const notionHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" });

const notion: LiveSource = {
  id: "notion",
  name: "Notion",
  kind: "documents",
  site: "https://www.notion.so",
  async fetch(folder) {
    const token = await secret("notion", folder.profileId);
    const [pages, users] = await Promise.all([
      request<NotionSearch>(`${endpoints.notion}/search`, { method: "POST", headers: notionHeaders(token), body: JSON.stringify(NOTION_SEARCH_BODY) }),
      request<NotionUsers>(`${endpoints.notion}/users?page_size=100`, { headers: notionHeaders(token) }).catch(() => null),
    ]);
    return mapNotion(pages, users, accountOf(folder.profileId, "notion")?.name ?? null);
  },
};

const confluence: LiveSource = {
  id: "confluence",
  name: "Confluence",
  kind: "documents",
  site: "https://www.atlassian.com",
  async fetch(folder) {
    const { site: confluenceSite, user: confluenceEmail } = connected("confluence", folder.profileId);
    if (!confluenceSite) throw new LiveError("notConfigured", "No Confluence site");
    const auth = basic(confluenceEmail ?? "", await secret("confluence", folder.profileId));
    const url = `${endpoints.confluence(confluenceSite)}/wiki/rest/api/content/search?limit=30&expand=space,history.lastUpdated&cql=${encodeURIComponent(CONFLUENCE_CQL)}`;
    return mapConfluence(await request<ConfluenceSearch>(url, { headers: { Authorization: auth } }), confluenceSite);
  },
};

type GoogleTokens = { access_token: string; refresh_token: string; expires_at: number; client_secret: string; client_id?: string };

async function googleAccessToken(profileId: string): Promise<string> {
  const raw = await secret("gdrive", profileId);
  const stored = JSON.parse(raw) as GoogleTokens;
  if (stored.expires_at > Date.now() + 60_000) return stored.access_token;
  const json = await request<{ access_token: string; expires_in: number }>(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: stored.client_id ?? accountOf(profileId, "gdrive")?.clientId ?? live().config.googleClientId, client_secret: stored.client_secret, refresh_token: stored.refresh_token, grant_type: "refresh_token" }),
  });
  const refreshed = JSON.stringify({ ...stored, access_token: json.access_token, expires_at: Date.now() + json.expires_in * 1000 });
  const kept = await locked("gdrive", profileId, async () => {
    if (!profileExists(profileId) || !accountOf(profileId, "gdrive")) throw new LiveError("notConfigured", "Not signed in");
    if ((await getSecret("gdrive", profileId)) !== raw) return false;
    await setSecret("gdrive", profileId, refreshed);
    return true;
  });
  return kept ? json.access_token : googleAccessToken(profileId);
}

const gdrive: LiveSource = {
  id: "gdrive",
  name: "Google Drive",
  kind: "documents",
  site: "https://drive.google.com",
  async fetch(folder) {
    const token = await googleAccessToken(folder.profileId);
    const query = Object.entries(DRIVE_QUERY)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return mapDrive(await request<DriveFiles>(`${endpoints.drive}/files?${query}`, { headers: { Authorization: `Bearer ${token}` } }));
  },
};

export const SOURCES: Record<LiveSourceId, LiveSource> = { github, bitbucket, notion, confluence, gdrive };

const account = (login: string, name: string | null, avatar: string | null): LiveAccount => ({ login, name, avatar, connectedAt: Date.now() });

const profileExists = (profileId: string) => !!useBrowser.getState().profiles[profileId];

let adoption: Promise<void> = Promise.resolve();
export const legacyAdoption = () => adoption;

const connectionQueues = new Map<string, Promise<unknown>>();

function locked<T>(source: LiveSourceId, profileId: string, work: () => Promise<T>): Promise<T> {
  const key = `${source}:${profileId}`;
  const result = (connectionQueues.get(key) ?? Promise.resolve()).then(work);
  const settled = result.catch(() => {});
  connectionQueues.set(key, settled);
  void settled.then(() => connectionQueues.get(key) === settled && connectionQueues.delete(key));
  return result;
}

function saveConnection(profileId: string, source: LiveSourceId, value: string, connected: LiveAccount) {
  return locked(source, profileId, async () => {
    if (!profileExists(profileId)) throw new LiveError("other", "This profile was deleted");
    if (!(await setSecret(source, profileId, value))) throw new LiveError("other", "Couldn't save to the keychain");
    if (!profileExists(profileId)) return void (await deleteSecret(source, profileId));
    setAccount(profileId, source, connected);
  });
}

export async function connectGithub(profileId: string, token: string) {
  const json = await githubGraphql<{ data?: { viewer: { login: string; name: string | null; avatarUrl: string } } }>(token.trim(), VIEWER_QUERY);
  const viewer = json.data?.viewer;
  if (!viewer) throw new LiveError("signedOut", "GitHub didn't accept the token");
  await saveConnection(profileId, "github", token.trim(), account(viewer.login, viewer.name, viewer.avatarUrl));
}

export type DeviceFlow = { userCode: string; verificationUri: string; expiresAt: number; done: Promise<void>; cancel(): void };

export async function startGithubDeviceFlow(profileId: string, clientId: string): Promise<DeviceFlow> {
  const code = await request<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(
    `${endpoints.githubWeb}/login/device/code`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: clientId, scope: "repo read:org" }) },
  );
  let cancelled = false;
  let interval = Math.max(code.interval, 1) * 1000;
  const expiresAt = Date.now() + code.expires_in * 1000;
  const done = (async () => {
    while (!cancelled && Date.now() < expiresAt) {
      await new Promise((r) => setTimeout(r, interval));
      if (cancelled) break;
      const json = await request<{ access_token?: string; error?: string; interval?: number }>(`${endpoints.githubWeb}/login/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: clientId, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      });
      if (json.access_token) return connectGithub(profileId, json.access_token);
      if (json.error === "slow_down") interval = (json.interval ?? interval / 1000 + 5) * 1000;
      else if (json.error && json.error !== "authorization_pending") throw new LiveError("signedOut", json.error === "access_denied" ? "Access was denied" : json.error);
    }
    throw new LiveError("signedOut", cancelled ? "Cancelled" : "The code expired");
  })();
  return { userCode: code.user_code, verificationUri: code.verification_uri, expiresAt, done, cancel: () => (cancelled = true) };
}

export async function connectBitbucket(profileId: string, user: string, token: string) {
  const me = await request<{ account_id: string; display_name: string; links?: { avatar?: { href: string } } }>(`${endpoints.bitbucket}/user`, {
    headers: { Authorization: basic(user.trim(), token.trim()) },
  });
  await saveConnection(profileId, "bitbucket", token.trim(), { ...account(me.account_id, me.display_name, me.links?.avatar?.href ?? null), user: user.trim() });
}

export async function connectNotion(profileId: string, token: string) {
  const me = await request<{ name?: string; bot?: { workspace_name?: string } }>(`${endpoints.notion}/users/me`, { headers: notionHeaders(token.trim()) });
  await saveConnection(profileId, "notion", token.trim(), account(me.bot?.workspace_name ?? me.name ?? "Notion", me.bot?.workspace_name ?? null, null));
}

export async function connectConfluence(profileId: string, site: string, email: string, token: string) {
  const base = site.trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
  const me = await request<{ accountId: string; displayName: string }>(`${endpoints.confluence(base)}/wiki/rest/api/user/current`, {
    headers: { Authorization: basic(email.trim(), token.trim()) },
  });
  await saveConnection(profileId, "confluence", token.trim(), { ...account(me.accountId, me.displayName, null), user: email.trim(), site: base });
}

export async function connectGoogle(profileId: string, clientId: string, clientSecret: string, code: string, verifier: string, redirectUri: string) {
  const json = await request<{ access_token: string; refresh_token?: string; expires_in: number }>(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  if (!json.refresh_token) throw new LiveError("signedOut", "Google didn't return a refresh token");
  const tokens: GoogleTokens = { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + json.expires_in * 1000, client_secret: clientSecret, client_id: clientId };
  const about = await request<{ user?: { displayName: string; emailAddress: string; photoLink?: string } }>(`${endpoints.drive}/about?fields=user`, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  }).catch(() => null);
  await saveConnection(profileId, "gdrive", JSON.stringify(tokens), { ...account(about?.user?.emailAddress ?? "Google Drive", about?.user?.displayName ?? null, about?.user?.photoLink ?? null), clientId });
  updateConfig({ googleClientId: clientId });
}

export function disconnect(profileId: string, source: LiveSourceId) {
  return locked(source, profileId, async () => {
    await deleteSecret(source, profileId);
    setAccount(profileId, source, null);
  });
}

export async function forgetProfileAccounts(profileId: string) {
  const sources = Object.keys(SOURCES) as LiveSourceId[];
  await Promise.all(sources.map((source) => locked(source, profileId, () => deleteSecret(source, profileId))));
  removeProfileAccounts(profileId);
}

export function adoptLegacyAccounts(profileIds: string[]): Promise<void> {
  adoption = adoption.then(() => adopt(profileIds)).catch((error) => console.warn("Couldn't move live folder accounts to profiles", error));
  return adoption;
}

function withClientId(tokens: string, clientId: string | undefined): string {
  try {
    const parsed = JSON.parse(tokens) as GoogleTokens;
    return parsed.client_id || !clientId ? tokens : JSON.stringify({ ...parsed, client_id: clientId });
  } catch {
    return tokens;
  }
}

function copyLegacy(source: LiveSourceId, profileId: string, value: string, legacy: LiveAccount): Promise<boolean> {
  return locked(source, profileId, async () => {
    if (!profileExists(profileId) || (await getSecret(source, profileId))) return true;
    if (!(await setSecret(source, profileId, value))) return false;
    if (profileExists(profileId)) setAccount(profileId, source, legacy);
    else await deleteSecret(source, profileId);
    return true;
  });
}

async function adopt(profileIds: string[]) {
  for (const source of Object.keys(live().legacyAccounts) as LiveSourceId[]) {
    const saved = await getSecret(source, null);
    if (!saved) continue;
    const { owedTo = profileIds, ...legacy } = live().legacyAccounts[source]!;
    const value = source === "gdrive" ? withClientId(saved, legacy.clientId) : saved;
    const stillOwed: string[] = [];
    for (const profileId of owedTo) if (!(await copyLegacy(source, profileId, value, legacy))) stillOwed.push(profileId);
    setLegacyAccount(source, stillOwed.length ? { ...legacy, owedTo: stillOwed } : null);
    try {
      await saveLiveDurably();
    } catch {
      continue;
    }
    if (!stillOwed.length) await deleteSecret(source, null);
  }
}

export function liveFolderIcon(folder: LiveFolder): { site: string; icon: string | null } {
  return { site: SOURCES[folder.sources[0] ?? "github"].site, icon: folder.icon ?? (folder.sources.length > 1 && folder.kind === "documents" ? symbolIcon("doc.text") : null) };
}
