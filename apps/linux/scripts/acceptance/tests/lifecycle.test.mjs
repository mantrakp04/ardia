import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { desktopTools, groupAlive, killDesktopNow, startDesktop, stopGroup, trackedGroups } from "../lib/desktop.mjs";
import { cleanupActiveScenarios, createContext, runScenario, ScenarioAbort } from "../lib/scenario.mjs";

const tools = await desktopTools();

async function scratchRoot() {
  return mkdtemp(join(tmpdir(), "ardia-lifecycle-"));
}

test("a scenario past its deadline runs its deferred stops and refuses to launch, check or defer more", async () => {
  const root = await scratchRoot();
  const stopped = [];
  const launched = [];
  let after = null;
  const scenario = {
    id: "LIFE1",
    issue: 1,
    async run(t) {
      t.defer(() => stopped.push("desktop"));
      await t.check("first", () => true);
      await delay(400);
      after = await Promise.allSettled([t.launch({ scratch: root }), t.check("late", () => true)]);
      t.defer(() => stopped.push("late"));
    },
  };
  const result = await runScenario(scenario, { options: {}, fixtures: null, resultsDir: root, scratchRoot: root, launch: async () => { launched.push(1); return { close: async () => true }; }, deadline: 100 });
  await delay(700);
  assert.equal(result.status, "fail");
  assert.deepEqual(stopped, ["desktop", "late"]);
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
  t.defer(() => stopped.push("buses"));
  t.defer(() => stopped.push("compositor"));
  await cleanupActiveScenarios();
  assert.deepEqual(stopped, ["compositor", "buses"]);
  assert.ok(t.aborted);
  await assert.rejects(t.check("after", () => true), ScenarioAbort);
  await rm(root, { recursive: true, force: true });
});

const skip = !tools.dbusDaemon ? "needs dbus-daemon" : false;

test("a stopped desktop refuses new processes, and stopping a group kills children its leader left behind", { skip, timeout: 30000 }, async () => {
  const dir = await scratchRoot();
  const desktop = await startDesktop(dir, { tools, compositor: false });
  const proc = desktop.spawn("/bin/sh", ["-c", "sleep 60 & exit 0"], { name: "orphaning" });
  await delay(500);
  assert.ok(groupAlive(proc.child.pid), "the orphaned sleep keeps the group alive after its leader exited");
  await stopGroup(proc);
  assert.equal(groupAlive(proc.child.pid), false);
  await desktop.stop();
  assert.throws(() => desktop.spawn("/bin/true", [], { name: "late" }), /was stopped/);
  await rm(dir, { recursive: true, force: true });
});

test("killDesktopNow kills every group the harness started and runs the emergency stops", { skip, timeout: 30000 }, async () => {
  const dir = await scratchRoot();
  const desktop = await startDesktop(dir, { tools, compositor: false });
  const proc = desktop.spawn("/bin/sh", ["-c", "sleep 60 & sleep 60"], { name: "sleeper" });
  await delay(300);
  const pids = trackedGroups();
  assert.ok(pids.includes(proc.child.pid));
  killDesktopNow();
  await delay(300);
  for (const pid of pids) assert.equal(groupAlive(pid), false, `group ${pid}`);
  await desktop.stop();
  await rm(dir, { recursive: true, force: true });
});
