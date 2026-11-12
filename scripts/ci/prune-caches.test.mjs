import test from "node:test";
import assert from "node:assert/strict";
import { plan, pullNumberOf } from "./prune-caches.mjs";

const cache = (id, key, ref, createdAt) => ({ id, key, ref, size: 100, createdAt });
const MAIN = "refs/heads/main";

test("a pull request ref names its number; a branch names none", () => {
  assert.equal(pullNumberOf("refs/pull/1116/merge"), 1116);
  assert.equal(pullNumberOf(MAIN), null);
  assert.equal(pullNumberOf("refs/pull/7/head"), null);
});

test("the caches of closed pull requests go; those of open ones and of branches stay", () => {
  const caches = [
    cache(1, "node-cache-Windows-x64-pnpm-aa", "refs/pull/10/merge", "2026-11-01T00:00:00Z"),
    cache(2, "node-cache-Windows-x64-pnpm-aa", "refs/pull/11/merge", "2026-11-02T00:00:00Z"),
    cache(3, "node-cache-Windows-x64-pnpm-aa", MAIN, "2026-11-03T00:00:00Z"),
  ];
  const doomed = plan({ caches, openPulls: [11], newestOnly: [] });
  assert.deepEqual(doomed.map((item) => item.id), [1]);
  assert.match(doomed[0].why, /#10 is closed/);
});

test("a newest-only prefix keeps its newest cache and nothing of another prefix is touched", () => {
  const caches = [
    cache(1, "xcode-cas-release-27A-2026-11-aaa", MAIN, "2026-11-01T00:00:00Z"),
    cache(2, "xcode-cas-release-27A-2026-11-bbb", MAIN, "2026-11-05T00:00:00Z"),
    cache(3, "xcode-cas-release-27A-2026-11-ccc", MAIN, "2026-11-03T00:00:00Z"),
    cache(4, "pods-abc", MAIN, "2026-10-01T00:00:00Z"),
    cache(5, "pods-def", MAIN, "2026-10-02T00:00:00Z"),
  ];
  const doomed = plan({ caches, openPulls: [], newestOnly: ["xcode-cas-release-"] });
  assert.deepEqual(doomed.map((item) => item.id).sort(), [1, 3]);
});

test("the newest cache is chosen among those that survive the closed pull requests", () => {
  const caches = [
    cache(1, "swiftpm-xcode-27.1-aaa", MAIN, "2026-11-01T00:00:00Z"),
    cache(2, "swiftpm-xcode-27.1-bbb", "refs/pull/9/merge", "2026-11-09T00:00:00Z"),
  ];
  const doomed = plan({ caches, openPulls: [], newestOnly: ["swiftpm-xcode-"] });
  assert.deepEqual(doomed.map((item) => item.id), [2]);
});

test("nothing is listed twice", () => {
  const caches = [
    cache(1, "turbo-aaa", "refs/pull/9/merge", "2026-11-01T00:00:00Z"),
    cache(2, "turbo-bbb", MAIN, "2026-11-02T00:00:00Z"),
    cache(3, "turbo-ccc", MAIN, "2026-11-03T00:00:00Z"),
  ];
  const doomed = plan({ caches, openPulls: [], newestOnly: ["turbo-", "turbo-"] });
  assert.deepEqual(doomed.map((item) => item.id).sort(), [1, 2]);
});

test("each branch keeps its own newest cache, since main cannot restore a branch's", () => {
  const caches = [
    cache(1, "xcode-cas-release-27A-2026-11-aaa", MAIN, "2026-11-01T00:00:00Z"),
    cache(2, "xcode-cas-release-27A-2026-11-bbb", MAIN, "2026-11-02T00:00:00Z"),
    cache(3, "xcode-cas-release-27A-2026-11-ccc", "refs/heads/release-dry-run", "2026-11-05T00:00:00Z"),
  ];
  const doomed = plan({ caches, openPulls: [], newestOnly: ["xcode-cas-release-"] });
  assert.deepEqual(doomed.map((item) => item.id), [1]);
});
