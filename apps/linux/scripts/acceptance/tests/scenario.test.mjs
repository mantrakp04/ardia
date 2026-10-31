import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildReport, exitCode, formatLine, scenarioStatus } from "../lib/report.mjs";
import { runScenario } from "../lib/scenario.mjs";
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
        await t.check("hangs", () => new Promise(() => {}), { timeout: 100 });
        await new Promise(() => {});
      },
    });
    const result = await promise;
    assert.equal(result.status, "fail");
    assert.match(result.checks[0].detail, /100 ms deadline/);
    assert.match(result.error, /400 ms deadline/);
    assert.deepEqual(closed, ["slow"]);
  });

  it("passes with automated checks only, and is manual when steps remain", async () => {
    const pass = await run({ id: "T04", issue: 904, title: "ok", async run(t) { await t.check("a", () => true); } }).promise;
    assert.equal(pass.status, "pass");
    assert.equal(pass.scratch, null);
    const manual = await run({ id: "T05", issue: 905, title: "half", manual: [{ name: "m", steps: ["x"] }], async run(t) { await t.check("a", () => true); } }).promise;
    assert.equal(manual.status, "manual");
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
