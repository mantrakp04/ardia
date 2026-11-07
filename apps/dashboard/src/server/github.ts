import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isDev, serverEnv } from "./env";

const REPO = "mantrakp04/ardia";
const TTL_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

export type Release = {
  tag: string;
  version: string;
  name: string;
  published: string;
  prerelease: boolean;
  url: string;
  dmg: number;
  zip: number;
  appcast: number;
  total: number;
  assets: { name: string; downloads: number }[];
};

export type GitHubData = {
  fetchedAt: number;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  pushedAt: string;
  releases: Release[];
  starDays: { day: number; count: number }[] | null;
  rateLimitRemaining: number | null;
  error: string | null;
};

let cached: { at: number; data: Promise<GitHubData> } | null = null;

let devToken: Promise<string | undefined> | null = null;

function token(): Promise<string | undefined> {
  const fromEnv = serverEnv("GITHUB_TOKEN");
  if (fromEnv || !isDev) return Promise.resolve(fromEnv);
  devToken ??= promisify(execFile)("gh", ["auth", "token"], { timeout: 5000 })
    .then((r) => r.stdout.trim() || undefined)
    .catch(() => undefined);
  return devToken;
}

async function gh(path: string, accept = "application/vnd.github+json") {
  const auth = await token();
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: accept,
      "User-Agent": "ardia-dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path.split("?")[0]}`);
  return { body: (await res.json()) as unknown, remaining: Number(res.headers.get("x-ratelimit-remaining") ?? NaN) };
}

type RawRelease = {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  assets: { name: string; download_count: number }[];
};

async function load(): Promise<GitHubData> {
  const [repo, releasePages] = await Promise.all([
    gh(`repos/${REPO}`),
    Promise.all([1, 2, 3].map((page) => gh(`repos/${REPO}/releases?per_page=100&page=${page}`).catch(() => null))),
  ]);
  const releases = { body: releasePages.flatMap((p) => (p ? (p.body as RawRelease[]) : [])), remaining: releasePages[0]?.remaining ?? NaN };
  const r = repo.body as { stargazers_count: number; forks_count: number; subscribers_count: number; open_issues_count: number; pushed_at: string };
  let starDays: GitHubData["starDays"] = null;
  try {
    const weeks = (await gh(`repos/${REPO}/stargazers/history`)).body as { week: number; days: number[] }[];
    starDays = weeks
      .flatMap((w) => w.days.map((count, i) => ({ day: w.week * 1000 + i * DAY_MS, count })))
      .sort((a, b) => a.day - b.day);
  } catch {
    starDays = null;
  }
  const count = (assets: RawRelease["assets"], test: (name: string) => boolean) =>
    assets.filter((a) => test(a.name)).reduce((s, a) => s + a.download_count, 0);
  return {
    fetchedAt: Date.now(),
    stars: r.stargazers_count,
    forks: r.forks_count,
    watchers: r.subscribers_count,
    openIssues: r.open_issues_count,
    pushedAt: r.pushed_at,
    releases: releases.body
      .filter((rel) => !rel.draft)
      .map((rel) => {
        const dmg = count(rel.assets, (n) => n.endsWith(".dmg"));
        const zip = count(rel.assets, (n) => n.endsWith(".zip"));
        return {
          tag: rel.tag_name,
          version: rel.tag_name.replace(/^v/, ""),
          name: rel.name ?? rel.tag_name,
          published: rel.published_at ?? "",
          prerelease: rel.prerelease,
          url: rel.html_url,
          dmg,
          zip,
          appcast: count(rel.assets, (n) => n === "appcast.xml"),
          total: dmg + zip,
          assets: rel.assets.map((a) => ({ name: a.name, downloads: a.download_count })).sort((a, b) => b.downloads - a.downloads),
        };
      }),
    starDays,
    rateLimitRemaining: Number.isFinite(releases.remaining) ? releases.remaining : null,
    error: null,
  };
}

export function github(): Promise<GitHubData> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const previous = cached;
  const data = load().catch(async (error: unknown) => {
    if (previous) {
      const stale = await previous.data;
      return { ...stale, error: String((error as Error).message ?? error) };
    }
    throw error;
  });
  cached = { at: Date.now(), data };
  data.catch(() => {
    if (cached?.data === data) cached = null;
  });
  return data;
}

export async function githubPage() {
  return github();
}
