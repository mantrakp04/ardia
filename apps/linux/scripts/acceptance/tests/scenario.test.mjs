import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildReport, exitCode, formatLine, scenarioStatus } from "../lib/report.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { runScenario, runScenarios } from "../lib/scenario.mjs";
import { until } from "../lib/util.mjs";
import { SCENARIOS, selectScenarios } from "../scenarios/index.mjs";

const exists = (path) => access(path).then(() => true, () => false);

describe("scenario runner", () => {
  let root;
  before(async () => { root = await mkdtemp(join(tmpdir(), "ardia-acceptance-runner-")); });
  after(() => rm(root, { recursive: true, force: true }));

  const fakeLaunch = (closed) => async ({ scratch, label }) => ({ scratch, label, close: async () => { closed.push(label); return true; } });
  const run = (scenario, extra = {}) => {
    const closed = [];
    const promise = runScenario(scenario, { options: { executable: "/x" }, fixtures: { chromiumArgs: ["--fixture"] }, resultsDir: join(root, "results"), scratchRoot: join(root, "scratch"), launch: fakeLaunch(closed), ...extra });
    return { closed, promise };
  };

  it("keeps running after a failed check and reports the issue as failed", async () => {
    const { closed, promise } = run({ id: "T01", issue: 901, title: "mixed",
      async run(t) {
        const scratch = await t.scratch("one");
        await t.launch({ scratch, label: "first" });
        await t.check("fails", () => { throw new Error("nope"); });
        await t.check("passes", () => ({ ok: 1 }));
        await t.evidence("data", { a: 1 });
      },
    });
    const result = await promise;
    assert.equal(result.status, "fail");
    assert.deepEqual(result.checks.map((c) => [c.name, c.status]), [["fails", "fail"], ["passes", "pass"]]);
    assert.deepEqual(closed, ["first"]);
    assert.ok(result.scratch?.length === 1 && (await exists(result.scratch[0])), "a failing scenario keeps its scratch profile");
    assert.deepEqual(JSON.parse(await readFile(join(result.evidence, "data.json"), "utf8")), { a: 1 });
  });

  it("stops at a failed critical check and still adds declared manual steps", async () => {
    const { promise } = run({ id: "T02", issue: 902, title: "critical",
      manual: [{ name: "by hand", steps: ["do it"] }],
      async run(t) {
        await t.check("gate", () => { throw new Error("blocked"); }, { critical: true });
        await t.check("never", () => true);
      },
    });
    const result = await promise;
    assert.equal(result.status, "fail");
    assert.match(result.error, /gate: blocked/);
    assert.deepEqual(result.checks.map((c) => c.name), ["gate", "by hand"]);
    assert.deepEqual(result.manual, [{ name: "by hand", steps: ["do it"], reason: "needs physical input or a desktop session" }]);
  });

  it("enforces check and scenario deadlines and closes what it started", async () => {
    const { closed, promise } = run({ id: "T03", issue: 903, title: "slow",
      deadline: 400,
      async run(t) {
        await t.launch({ scratch: await t.scratch(), label: "slow" });
        await t.check("hangs", ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), { timeout: 100 });
        await new Promise(() => {});
      },
    }, { drainTimeout: 100 });
    const result = await promise;
    assert.equal(result.status, "fail");
    assert.match(result.checks[0].detail, /100 ms deadline/);
    assert.match(result.error, /400 ms deadline/);
    assert.deepEqual(closed, ["slow"]);
  });

  it("lets a timed-out scenario stop before it returns, and refuses new work after the stop", async () => {
    const events = [];
    const { promise } = run({ id: "T06", issue: 906, title: "late",
      deadline: 100,
      async run(t) {
        await t.launch({ scratch: await t.scratch(), label: "late" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        events.push("body finished");
        await t.scratch("after").catch((error) => events.push(error.constructor.name));
      },
    }, { drainTimeout: 5000 });
    const result = await promise;
    events.push("runner returned");
    assert.match(result.error, /100 ms deadline/);
    assert.deepEqual(events, ["body finished", "ScenarioAbort", "runner returned"]);
  });

  it("cancels a timed-out check and lets it stop before the next check starts", async () => {
    const events = [];
    const result = await run({ id: "T08", issue: 908, title: "overlap",
      async run(t) {
        await t.check("slow", () => until(() => { events.push("slow poll"); return false; }, { timeout: 5000, interval: 20 }), { timeout: 100 });
        await t.check("next", async ({ signal }) => { events.push("next started"); await new Promise((resolve) => setTimeout(resolve, 200)); return !signal.aborted; });
      },
    }).promise;
    assert.deepEqual(result.checks.map((c) => [c.name, c.status]), [["slow", "fail"], ["next", "pass"]]);
    assert.match(result.checks[0].detail, /100 ms deadline/);
    assert.ok(events.includes("slow poll"));
    assert.deepEqual(events.slice(events.indexOf("next started")), ["next started"]);
  });

  it("stops the scenario when a timed-out check ignores cancellation", async () => {
    const events = [];
    const result = await run({ id: "T09", issue: 909, title: "deaf check",
      async run(t) {
        await t.check("deaf", () => new Promise((resolve) => setTimeout(resolve, 600)), { timeout: 50 });
        await t.check("never", () => events.push("never"));
      },
    }, { drainTimeout: 100 }).promise;
    assert.equal(result.status, "fail");
    assert.match(result.error, /deaf was still running 100 ms after it failed/);
    assert.deepEqual(result.checks.map((c) => c.name), ["deaf"]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(events, []);
  });

  it("stops the suite instead of starting a scenario that unfinished work could overlap", async () => {
    const events = [];
    const deaf = { id: "T10", issue: 910, title: "deaf", deadline: 50, async run() { await new Promise((resolve) => setTimeout(resolve, 600)); events.push("T10 resumed"); } };
    const next = { id: "T11", issue: 911, title: "next", async run(t) { events.push("T11 started"); await t.check("a", () => true); } };
    const { results, halted } = await runScenarios([deaf, next], { options: { executable: "/x" }, fixtures: {}, resultsDir: join(root, "results"), scratchRoot: join(root, "scratch"), launch: fakeLaunch([]), drainTimeout: 100 });
    assert.equal(halted, true);
    assert.deepEqual(results.map((r) => [r.finding, r.status]), [["T10", "fail"], ["T11", "fail"]]);
    assert.deepEqual(results[0].unfinished, ["the scenario body"]);
    assert.match(results[0].error, /the scenario body still running 100 ms after T10 stopped/);
    assert.match(results[1].error, /not run: T10 left work running/);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(events, ["T10 resumed"]);
  });

  it("runs every scenario when each one stops cleanly", async () => {
    const { results, halted } = await runScenarios([
      { id: "T12", issue: 912, title: "slow but cooperative", deadline: 50, run: () => until(() => false, { timeout: 5000, interval: 20 }) },
      { id: "T13", issue: 913, title: "next", async run(t) { await t.check("a", () => true); } },
    ], { options: { executable: "/x" }, fixtures: {}, resultsDir: join(root, "results"), scratchRoot: join(root, "scratch"), launch: fakeLaunch([]), drainTimeout: 1000 });
    assert.equal(halted, false);
    assert.deepEqual(results.map((r) => [r.finding, r.status]), [["T12", "fail"], ["T13", "pass"]]);
    assert.equal(results[0].unfinished, undefined);
  });

  it("bounds the wait for a scenario that never stops", async () => {
    const started = Date.now();
    const result = await run({ id: "T07", issue: 907, title: "stuck", deadline: 50, run: () => new Promise(() => {}) }, { drainTimeout: 200 }).promise;
    assert.match(result.error, /50 ms deadline/);
    assert.ok(Date.now() - started < 2000);
  });

  it("passes with automated checks only, and is manual when steps remain", async () => {
    const pass = await run({ id: "T04", issue: 904, title: "ok", async run(t) { await t.check("a", () => true); } }).promise;
    assert.equal(pass.status, "pass");
    assert.equal(pass.scratch, null);
    const manual = await run({ id: "T05", issue: 905, title: "half", manual: [{ name: "m", steps: ["x"] }], async run(t) { await t.check("a", () => true); } }).promise;
    assert.equal(manual.status, "manual");
  });
});

describe("browser start", () => {
  let root;
  before(async () => { root = await mkdtemp(join(tmpdir(), "ardia-acceptance-start-")); });
  after(() => rm(root, { recursive: true, force: true }));

  const fakeContext = () => {
    const blockerQueries = [];
    const shell = { call: async (method) => { blockerQueries.push(method); return { ok: true, value: { stats: { ready: true } } }; } };
    const app = { mainShell: async () => shell, logText: async () => "", exitReason: () => null };
    let made = 0;
    return { blockerQueries, t: { scratch: async (name) => { const dir = join(root, `${name}-${made++}`); await mkdir(dir, { recursive: true }); return dir; }, launch: async () => app } };
  };

  it("waits for the blocker's navigation hold on a new profile even when it seeds Chromium preferences", async () => {
    const { t, blockerQueries } = fakeContext();
    const started = await startBrowser(t, { name: "seeded", preferences: { downloads: join(root, "downloads") } });
    assert.ok(await exists(join(started.scratch, "Default", "Preferences")));
    assert.equal(started.hold, "ready");
    assert.deepEqual(blockerQueries, ["contentBlocker.state"]);
  });

  it("skips the wait when it restarts a profile that has already run", async () => {
    const { t, blockerQueries } = fakeContext();
    const first = await startBrowser(t, { name: "again", preferences: {} });
    blockerQueries.length = 0;
    const restarted = await startBrowser(t, { scratch: first.scratch });
    assert.equal(restarted.hold, null);
    assert.deepEqual(blockerQueries, []);
  });
});

describe("report", () => {
  const result = (issue, status) => ({ issue, finding: `F${issue}`, status, automated: { pass: 1, fail: status === "fail" ? 1 : 0 }, manual: status === "manual" ? [{ name: "m" }] : [], error: null });

  it("rolls checks up into one status", () => {
    assert.equal(scenarioStatus({ checks: [] }), "fail");
    assert.equal(scenarioStatus({ checks: [{ status: "pass" }] }), "pass");
    assert.equal(scenarioStatus({ checks: [{ status: "pass" }, { status: "manual" }] }), "manual");
    assert.equal(scenarioStatus({ checks: [{ status: "manual" }, { status: "fail" }] }), "fail");
    assert.equal(scenarioStatus({ checks: [{ status: "pass" }], error: "crashed" }), "fail");
  });

  it("summarizes per issue and lists only fully passing issues as closable", () => {
    const report = buildReport({ executable: "/x", startedAt: "a", finishedAt: "b", results: [result(11, "pass"), result(12, "fail"), result(13, "manual")] });
    assert.deepEqual(report.summary, { pass: [11], fail: [12], manual: [13] });
    assert.deepEqual(report.closable, [11]);
    assert.equal(exitCode(report), 1);
    assert.equal(exitCode(buildReport({ executable: "/x", results: [result(13, "manual")] })), 0);
    assert.match(formatLine(result(13, "manual")), /^#13 F13 MANUAL \(1 passed, 0 failed, 1 manual\)$/);
  });
});

describe("scenario catalogue", () => {
  it("holds the headless scenarios once each, with runnable checks and complete manual steps", () => {
    assert.deepEqual(SCENARIOS.map((s) => s.id), ["F01", "F02", "F03", "F23", "F08", "F09", "F10", "F26", "F27"]);
    assert.equal(new Set(SCENARIOS.map((s) => s.issue)).size, SCENARIOS.length);
    for (const s of SCENARIOS) {
      assert.equal(typeof s.run, "function", s.id);
      for (const m of s.manual ?? []) assert.ok(m.name && m.steps?.length, `${s.id} manual steps`);
    }
  });

  it("selects by finding or issue number", () => {
    assert.deepEqual(selectScenarios(["f01", "#33", "18"]).map((s) => s.id), ["F01", "F23", "F08"]);
    assert.equal(selectScenarios([]).length, SCENARIOS.length);
    assert.throws(() => selectScenarios(["F99"]), /Unknown scenario F99/);
  });
});
