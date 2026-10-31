import { mapBitbucket, mapConfluence, mapDrive, mapNotion, type BitbucketPR, type BitbucketStatuses, type ConfluenceSearch, type DriveFiles, type NotionSearch, type NotionUsers } from "../../browser/src/state/live/documents";
import { DETAILS_PAGE, detailIds, detailNodes, GITHUB_DETAILS_QUERY, GITHUB_QUERY, GITHUB_STATE_QUERY, GITHUB_VARIABLES, mapGithub, withDetails, type DetailsResponse, type GithubResponse } from "../../browser/src/state/live/github";
import { live, setAccount, updateConfig } from "../../browser/src/state/live/store";
import { LiveError, type CompletionState, type LiveAccount, type LiveFolder, type LiveItem, type LiveSourceId } from "../../browser/src/state/live/types";
import { hostLiveClient, type LiveClient } from "./hostLive.ts";

export type LiveSource = {
  id: LiveSourceId;
  name: string;
  kind: LiveFolder["kind"];
  site: string;
  fetch(folder: LiveFolder): Promise<LiveItem[]>;
  resolveGone?(items: LiveItem[]): Promise<Record<string, CompletionState>>;
};

export type DeviceFlow = { userCode: string; verificationUri: string; expiresAt: number; done: Promise<void>; cancel(): void };

type Viewer = { login: string; name: string | null; avatarUrl: string };
type DevicePoll = { status: "pending" } | { status: "slowDown"; interval?: number } | { status: "connected"; viewer: Viewer | null };

const BITBUCKET_STATE_BATCH = 10;

const account = (login: string, name: string | null, avatar: string | null): LiveAccount => ({ login, name, avatar, connectedAt: Date.now() });

export function normalizeConfluenceSite(site: string): string {
  return site.trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
}

export function linuxLiveSources(client: LiveClient) {
  async function githubGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const json = await client.request<T & { errors?: { type?: string; message: string }[] }>("github", "graphql", { query, variables });
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
      const json = await githubGraphql<GithubResponse>(GITHUB_QUERY, GITHUB_VARIABLES);
      const ids = detailIds(json, folder.filters);
      const pages = Array.from({ length: Math.ceil(ids.length / DETAILS_PAGE) }, (_, i) => ids.slice(i * DETAILS_PAGE, (i + 1) * DETAILS_PAGE));
      const page = async (ids: string[]) => detailNodes(ids, await githubGraphql<DetailsResponse>(GITHUB_DETAILS_QUERY, { ids }));
      const retry = (ids: string[]) => (error: unknown) =>
        error instanceof LiveError && (error.kind === "other" || error.kind === "network") ? page(ids) : Promise.reject(error);
      const details = await Promise.all(pages.map((ids) => page(ids).catch(retry(ids))));
      return mapGithub(withDetails(json, details.flat()), folder.filters);
    },
    async resolveGone(items) {
      const prs = items.filter((it) => it.source === "github");
      if (!prs.length) return {};
      const ids = prs.map((it) => it.id.slice("github:".length));
      const json = await githubGraphql<{ data?: { nodes: ({ id: string; state: string } | null)[] } }>(GITHUB_STATE_QUERY, { ids });
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

  const bitbucket: LiveSource = {
    id: "bitbucket",
    name: "Bitbucket",
    kind: "pullRequests",
    site: "https://bitbucket.org",
    async fetch(folder) {
      if (!folder.filters.authored) return [];
      const me = live().accounts.bitbucket;
      if (!me) throw new LiveError("signedOut", "Not signed in");
      const page = await client.request<{ values: BitbucketPR[] }>("bitbucket", "pullRequests", { user: me.login });
      return Promise.all(
        page.values.map(async (pr) => {
          const repo = pr.destination.repository.full_name;
          const statuses = await client.request<BitbucketStatuses>("bitbucket", "statuses", { repo, id: pr.id }).catch(() => null);
          return mapBitbucket(pr, statuses);
        }),
      );
    },
    async resolveGone(items) {
      const out: Record<string, CompletionState> = {};
      const prs = items.flatMap((it) => (it.pr ? [{ id: it.id, repo: it.pr.repo, number: it.pr.number }] : []));
      for (let i = 0; i < prs.length; i += BITBUCKET_STATE_BATCH) {
        await Promise.all(
          prs.slice(i, i + BITBUCKET_STATE_BATCH).map(async ({ id, repo, number }) => {
            const pr = await client.request<{ state: string }>("bitbucket", "pullRequest", { repo, id: number }).catch(() => null);
            if (pr?.state === "MERGED") out[id] = "merged";
            else if (pr?.state === "DECLINED" || pr?.state === "SUPERSEDED") out[id] = "closed";
          }),
        );
      }
      return out;
    },
  };

  const notion: LiveSource = {
    id: "notion",
    name: "Notion",
    kind: "documents",
    site: "https://www.notion.so",
    async fetch() {
      const [pages, users] = await Promise.all([
        client.request<NotionSearch>("notion", "search"),
        client.request<NotionUsers>("notion", "users").catch(() => null),
      ]);
      return mapNotion(pages, users, live().accounts.notion?.name ?? null);
    },
  };

  const confluence: LiveSource = {
    id: "confluence",
    name: "Confluence",
    kind: "documents",
    site: "https://www.atlassian.com",
    async fetch() {
      const { confluenceSite } = live().config;
      if (!confluenceSite) throw new LiveError("notConfigured", "No Confluence site");
      return mapConfluence(await client.request<ConfluenceSearch>("confluence", "search"), confluenceSite);
    },
  };

  const gdrive: LiveSource = {
    id: "gdrive",
    name: "Google Drive",
    kind: "documents",
    site: "https://drive.google.com",
    async fetch() {
      return mapDrive(await client.request<DriveFiles>("gdrive", "files"));
    },
  };

  const SOURCES: Record<LiveSourceId, LiveSource> = { github, bitbucket, notion, confluence, gdrive };

  async function connectGithub(token: string) {
    const json = await client.connect<{ data?: { viewer?: Viewer } }>("github", { token: token.trim() });
    const viewer = json.data?.viewer;
    if (!viewer) throw new LiveError("signedOut", "GitHub didn't accept the token");
    setAccount("github", account(viewer.login, viewer.name, viewer.avatarUrl));
  }

  async function startGithubDeviceFlow(clientId: string): Promise<DeviceFlow> {
    const code = await client.request<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>("github", "deviceCode", { clientId });
    const abort = new AbortController();
    let interval = Math.max(code.interval, 1) * 1000;
    const expiresAt = Date.now() + code.expires_in * 1000;
    const done = (async () => {
      while (!abort.signal.aborted && Date.now() < expiresAt) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, interval);
          abort.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
        if (abort.signal.aborted) break;
        const poll = await client.connect<DevicePoll>("github", { clientId, deviceCode: code.device_code }, { signal: abort.signal }).catch((error: unknown) => {
          if (abort.signal.aborted) return null;
          throw error;
        });
        if (!poll) break;
        if (poll.status === "connected") {
          if (!poll.viewer) throw new LiveError("signedOut", "GitHub didn't accept the token");
          setAccount("github", account(poll.viewer.login, poll.viewer.name, poll.viewer.avatarUrl));
          return;
        }
        if (poll.status === "slowDown") interval = (poll.interval ?? interval / 1000 + 5) * 1000;
      }
      throw new LiveError("signedOut", abort.signal.aborted ? "Cancelled" : "The code expired");
    })();
    return { userCode: code.user_code, verificationUri: code.verification_uri, expiresAt, done, cancel: () => abort.abort() };
  }

  async function connectBitbucket(user: string, token: string) {
    const me = await client.connect<{ account_id: string; display_name: string; links?: { avatar?: { href: string } } }>("bitbucket", { user: user.trim(), token: token.trim() });
    updateConfig({ bitbucketUser: user.trim() });
    setAccount("bitbucket", account(me.account_id, me.display_name, me.links?.avatar?.href ?? null));
  }

  async function connectNotion(token: string) {
    const me = await client.connect<{ name?: string; bot?: { workspace_name?: string } }>("notion", { token: token.trim() });
    setAccount("notion", account(me.bot?.workspace_name ?? me.name ?? "Notion", me.bot?.workspace_name ?? null, null));
  }

  async function connectConfluence(site: string, email: string, token: string) {
    const base = normalizeConfluenceSite(site);
    const me = await client.connect<{ accountId: string; displayName: string }>("confluence", { site: base, email: email.trim(), token: token.trim() });
    updateConfig({ confluenceSite: base, confluenceEmail: email.trim() });
    setAccount("confluence", account(me.accountId, me.displayName, null));
  }

  async function connectGoogle(clientId: string, clientSecret: string, code: string, verifier: string, redirectUri: string) {
    const reply = await client.connect<{ about: { user?: { displayName: string; emailAddress: string; photoLink?: string } } | null }>("gdrive", { clientId, clientSecret, code, verifier, redirectUri });
    const about = reply.about;
    updateConfig({ googleClientId: clientId });
    setAccount("gdrive", account(about?.user?.emailAddress ?? "Google Drive", about?.user?.displayName ?? null, about?.user?.photoLink ?? null));
  }

  async function disconnect(source: LiveSourceId) {
    await client.disconnect(source);
    setAccount(source, null);
  }

  function liveFolderIcon(folder: LiveFolder): { site: string; icon: string | null } {
    return { site: SOURCES[folder.sources[0] ?? "github"].site, icon: folder.icon ?? (folder.sources.length > 1 && folder.kind === "documents" ? "symbol:doc.text" : null) };
  }

  return { SOURCES, connectGithub, startGithubDeviceFlow, connectBitbucket, connectNotion, connectConfluence, connectGoogle, disconnect, liveFolderIcon };
}

const linux = linuxLiveSources(hostLiveClient(undefined, (source) => !!live().accounts[source]));

export const SOURCES = linux.SOURCES;
export const connectGithub = linux.connectGithub;
export const startGithubDeviceFlow = linux.startGithubDeviceFlow;
export const connectBitbucket = linux.connectBitbucket;
export const connectNotion = linux.connectNotion;
export const connectConfluence = linux.connectConfluence;
export const connectGoogle = linux.connectGoogle;
export const disconnect = linux.disconnect;
export const liveFolderIcon = linux.liveFolderIcon;
