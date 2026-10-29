import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REPO } from "./repo.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("every place that names the GitHub repo names the same one", () => {
  assert.equal(/^REPO="([^"]+)"$/m.exec(read("scripts/lib/releases.sh"))?.[1], REPO);
  assert.equal(/^export const REPO_SLUG = "([^"]+)";$/m.exec(read("apps/site/src/data/release.ts"))?.[1], REPO);
  const nginx = [...read("infra/site/nginx.conf").matchAll(/github(?:usercontent)?\.com\/([\w-]+\/[\w-]+)\//g)].map((m) => m[1]);
  assert.ok(nginx.length >= 3);
  assert.deepEqual([...new Set(nginx)], [REPO]);
});
