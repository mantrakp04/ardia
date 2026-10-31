import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { cleanupActiveScenarios, createContext, runScenario, ScenarioAbort } from "../lib/scenario.mjs";

const scratchRoot = () => mkdtemp(join(tmpdir(), "ardia-lifecycle-"));

test("a scenario past its deadline runs its deferred stops and refuses to launch, check or defer more", async () => {
  const root = await scratchRoot();
  const stopped = [];
  const launched = [];
  let after = null;
  const scenario = {
    id: "LIFE1",
    issue: 1,
    async run(t) {
      t.defer(() => stopped.push("first"));
      await t.check("first", () => true);
      await delay(400);
      after = await Promise.allSettled([t.launch({ scratch: root }), t.check("late", () => true)]);
      t.defer(() => stopped.push("late"));
    },
  };
  const result = await runScenario(scenario, { options: {}, fixtures: null, resultsDir: root, scratchRoot: root, launch: async () => { launched.push(1); return { close: async () => true }; }, deadline: 100 });
  await delay(700);
  assert.equal(result.status, "fail");
  assert.deepEqual(stopped, ["first", "late"]);
  assert.equal(launched.length, 0);
  assert.ok(after.every((r) => r.status === "rejected" && r.reason instanceof ScenarioAbort), JSON.stringify(after));
  assert.ok(!result.checks.some((c) => c.name === "late"));
  await rm(root, { recursive: true, force: true });
});

test("a browser that finishes starting after the scenario stopped is closed, not kept", async () => {
  const root = await scratchRoot();
  let closed = false;
  const t = createContext({ scenario: { id: "LIFE2" }, options: {}, fixtures: null, resultsDir: root, scratchRoot: root, launch: async () => { await delay(200); return { close: async () => { closed = true; return true; } }; } });
  const starting = t.launch({ scratch: root });
  await t.cleanup();
  await assert.rejects(starting, ScenarioAbort);
  assert.ok(closed);
  await rm(root, { recursive: true, force: true });
});

test("cleanupActiveScenarios runs the deferred stops of every scenario still running", async () => {
  const root = await scratchRoot();
  const stopped = [];
  const t = createContext({ scenario: { id: "LIFE3" }, options: {}, fixtures: null, resultsDir: root, scratchRoot: root });
  t.defer(() => stopped.push("fixtures"));
  t.defer(() => stopped.push("browser"));
  await cleanupActiveScenarios();
  assert.deepEqual(stopped, ["browser", "fixtures"]);
  assert.ok(t.aborted);
  await assert.rejects(t.check("after", () => true), ScenarioAbort);
  await rm(root, { recursive: true, force: true });
});
