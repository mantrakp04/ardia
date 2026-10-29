import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { REPO } from "../lib/repo.mjs";

const TRAFFIC_CACHE = join(homedir(), ".cache/ardia/github-traffic.json");
const RELEASES_CACHE = join(homedir(), ".cache/ardia/github-older-releases.json");

export function readCache(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

export const downloadsOf = (assets, ext) => assets.find((a) => a.name.endsWith(ext))?.downloads ?? 0;

export async function releaseDownloads() {
  const token = process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  return (await res.json()).map((release) => ({
    version: release.tag_name.replace(/^v/, ""),
    published: release.published_at ?? "",
    assets: release.assets.map((a) => ({ name: a.name, downloads: a.download_count })),
  }));
}

const githubQuery = (releases, after) => `{ repository(owner: "${REPO.split("/")[0]}", name: "${REPO.split("/")[1]}") { stargazerCount forkCount issues(states: OPEN) { totalCount }
  stargazers(last: 100) { edges { starredAt } }
  releases(first: ${releases}${after ? `, after: "${after}"` : ""}, orderBy: { field: CREATED_AT, direction: DESC }) { pageInfo { endCursor }
    nodes { tagName isDraft isPrerelease publishedAt releaseAssets(first: 20) { nodes { name downloadCount } } } } } }`;
const LIVE_RELEASES = 5;
export async function github({ now, since }) {
  const token = process.env.GH_TOKEN ?? (await promisify(execFile)("gh", ["auth", "token"])).stdout.trim();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const graphql = async (query) => {
    const res = await fetch("https://api.github.com/graphql", { method: "POST", headers, body: JSON.stringify({ query }) });
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(`GitHub GraphQL: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 160)}`);
    return body.data.repository;
  };
  const rest = (path) => fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers }).then((r) => (r.ok ? r.json() : null));
  const cachedFor = async (file, maxAge, load) => {
    const cached = readCache(file);
    if (cached && now - cached.at < maxAge) return cached;
    const fresh = load().then((value) => {
      const entry = { ...value, at: Date.now() };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(entry));
      return entry;
    });
    if (!cached) return fresh;
    return Promise.race([fresh.catch(() => cached), new Promise((resolve) => setTimeout(resolve, 800, cached))]);
  };
  const repoPromise = graphql(githubQuery(LIVE_RELEASES));
  const [repo, older, { views, referrers }] = await Promise.all([
    repoPromise,
    repoPromise.then((r) =>
      cachedFor(RELEASES_CACHE, 3600e3, async () => ({ after: r.releases.pageInfo.endCursor, nodes: (await graphql(githubQuery(100, r.releases.pageInfo.endCursor))).releases.nodes })),
    ),
    cachedFor(TRAFFIC_CACHE, 3600e3, async () => {
      const [views, referrers] = await Promise.all([rest("traffic/views"), rest("traffic/popular/referrers")]);
      return { views, referrers };
    }),
  ]);
  const liveTags = new Set(repo.releases.nodes.map((r) => r.tagName));
  const releases = { nodes: [...repo.releases.nodes, ...older.nodes.filter((r) => !liveTags.has(r.tagName))] };
  const starTimes = repo.stargazers.edges.map((e) => Date.parse(e.starredAt));
  const count = (release, ext) => downloadsOf(release.releaseAssets.nodes.map((a) => ({ name: a.name, downloads: a.downloadCount })), ext);
  const latest = releases.nodes.find((r) => !r.isDraft && !r.isPrerelease);
  return {
    stars: repo.stargazerCount,
    starsInWindow: starTimes.filter((t) => t >= since).length,
    stars24h: starTimes.filter((t) => t >= now - 864e5).length,
    forks: repo.forkCount,
    openIssues: repo.issues.totalCount,
    dmg: releases.nodes.reduce((sum, r) => sum + count(r, ".dmg"), 0),
    zips: releases.nodes.reduce((sum, r) => sum + count(r, ".zip"), 0),
    latest: latest && { version: latest.tagName.replace(/^v/, ""), dmg: count(latest, ".dmg"), zip: count(latest, ".zip"), published: latest.publishedAt },
    views: views && { count: views.count, uniques: views.uniques },
    referrers: (referrers ?? []).slice(0, 3).map((r) => [r.referrer, r.uniques]),
  };
}
