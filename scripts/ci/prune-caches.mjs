#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const HELP = `Frees GitHub Actions cache space, which is capped at 10 GB a repository.
Deletes the caches of pull requests that are no longer open, and for each --newest-only
key prefix every cache but the newest one.

  scripts/ci/prune-caches.mjs [--dry-run] [--repo <owner/name>] [--newest-only <key prefix>]...

--dry-run lists what would go and deletes nothing.`;

const PULL_REF = /^refs\/pull\/(\d+)\/merge$/;

export function pullNumberOf(ref) {
  const found = PULL_REF.exec(ref || "");
  return found ? Number(found[1]) : null;
}

export function plan({ caches, openPulls, newestOnly }) {
  const open = new Set(openPulls);
  const doomed = new Map();
  for (const cache of caches) {
    const number = pullNumberOf(cache.ref);
    if (number !== null && !open.has(number)) doomed.set(cache.id, { ...cache, why: `pull request #${number} is closed` });
  }
  for (const prefix of newestOnly) {
    const family = caches
      .filter((cache) => cache.key.startsWith(prefix) && !doomed.has(cache.id))
      .sort((one, other) => other.createdAt.localeCompare(one.createdAt) || other.id - one.id);
    for (const cache of family.slice(1)) doomed.set(cache.id, { ...cache, why: `a newer ${prefix} cache exists` });
  }
  return [...doomed.values()];
}

function parse(argv) {
  const options = { dryRun: false, repo: process.env.GITHUB_REPOSITORY || "", newestOnly: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    if (word === "-h" || word === "--help") options.help = true;
    else if (word === "--dry-run") options.dryRun = true;
    else if (word === "--repo") options.repo = argv[(index += 1)] || "";
    else if (word === "--newest-only") options.newestOnly.push(argv[(index += 1)] || "");
    else throw new Error(`unknown option ${word} (--help)`);
  }
  if (options.newestOnly.some((prefix) => !prefix)) throw new Error("--newest-only takes a key prefix");
  return options;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function listCaches(repo) {
  const rows = gh(["api", "--paginate", `repos/${repo}/actions/caches?per_page=100`, "--jq", ".actions_caches[] | @json"]);
  return rows
    .split("\n")
    .filter(Boolean)
    .map((row) => JSON.parse(row))
    .map((cache) => ({ id: cache.id, ref: cache.ref, key: cache.key, size: cache.size_in_bytes, createdAt: cache.created_at }));
}

function listOpenPulls(repo) {
  const rows = gh(["api", "--paginate", `repos/${repo}/pulls?state=open&per_page=100`, "--jq", ".[].number"]);
  return rows.split("\n").filter(Boolean).map(Number);
}

const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (!options.repo) options.repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  const caches = listCaches(options.repo);
  const doomed = plan({ caches, openPulls: listOpenPulls(options.repo), newestOnly: options.newestOnly });
  const total = caches.reduce((sum, cache) => sum + cache.size, 0);
  const freed = doomed.reduce((sum, cache) => sum + cache.size, 0);
  for (const cache of doomed) {
    console.log(`${options.dryRun ? "would delete" : "delete"} ${cache.key} (${megabytes(cache.size)}, ${cache.ref}): ${cache.why}`);
    if (!options.dryRun) gh(["api", "-X", "DELETE", `repos/${options.repo}/actions/caches/${cache.id}`]);
  }
  console.log(
    `${options.repo}: ${caches.length} caches, ${megabytes(total)}; ${options.dryRun ? "would free" : "freed"} ${megabytes(freed)} in ${doomed.length}, leaving ${megabytes(total - freed)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
