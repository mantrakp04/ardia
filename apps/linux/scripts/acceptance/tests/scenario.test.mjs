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
    const { closed, promise } = run({
      id: "T01",
      issue: 901,
      title: "mixed",
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
    const { promise } = run({
      id: "T02",
      issue: 902,
      title: "critical",
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
    const { closed, promise } = run({
      id: "T03",
      issue: 903,
      title: "slow",
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

  it("passes the fixture launch arguments to every browser", async () => {
    let seen;
    await runScenario({ id: "T06", issue: 906, title: "args", async run(t) { await t.launch({ scratch: await t.scratch(), extraArgs: ["--own"] }); await t.check("a", () => true); } }, {
      options: { executable: "/x", uiDir: "/ui" },
      fixtures: { chromiumArgs: ["--fixture"] },
      resultsDir: join(root, "results"),
      scratchRoot: join(root, "scratch"),
      launch: async (options) => { seen = options; return { close: async () => true }; },
    });
    assert.deepEqual(seen.extraArgs, ["--fixture", "--own"]);
    assert.equal(seen.executable, "/x");
    assert.equal(seen.uiDir, "/ui");
    assert.equal(seen.background, true);
  });

  it("checks focus only in the private desktop sessions, which carry F22's manual steps", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    assert.ok(!ids.includes("F22"));
    for (const id of ["F22D", "F22X"]) {
      const scenario = SCENARIOS.find((candidate) => candidate.id === id);
      assert.equal(scenario.issue, 32);
      assert.deepEqual(scenario.manual.map((item) => item.name), ["A link from another app doesn't steal focus", "Import comes to the front"]);
    }
    assert.deepEqual(selectScenarios(["#32"], SCENARIOS).map((scenario) => scenario.id), ["F22D", "F22X", "F22H"]);
    const live = SCENARIOS.find((candidate) => candidate.id === "F22H");
    assert.deepEqual(live.manual.map((item) => item.name), ["A link from another app doesn't steal focus", "Import comes to the front", "Hyprland: a window the app opens in the background takes no focus"]);
    assert.match(live.manual[2].reason, /Hyprland focuses every newly mapped toplevel/);
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
  it("covers every issue #81 names and the later feature issues, once each", () => {
    const headless = SCENARIOS.filter((s) => !s.desktop);
    const desktopOnly = [32];
    assert.deepEqual(headless.map((s) => s.issue).sort((a, b) => a - b), [11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 33, 34, 35, 36, 37, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 88, 89, 92, 97, 98, 99, 100, 101, 102, 104, 105, 106, 107, 108, 109, 110, 111, 114, 137, 148, 149, 150, 156, 172, 173, 221]);
    assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
    for (const s of SCENARIOS.filter((x) => x.desktop)) assert.ok(desktopOnly.includes(s.issue) || headless.some((h) => h.issue === s.issue), `${s.id} adds desktop checks to an issue the headless suite covers`);
    for (const issue of desktopOnly) assert.ok(SCENARIOS.some((s) => s.desktop && s.issue === issue) && !headless.some((h) => h.issue === issue), `#${issue} is checked in desktop sessions only`);
    for (const s of SCENARIOS) {
      assert.equal(typeof s.run, "function", s.id);
      for (const m of s.manual ?? []) assert.ok(m.name && m.steps?.length, `${s.id} manual steps`);
    }
  });

  it("drives media and policy checks through the shell's page handles with a stable PiP probe", async () => {
    const { readFile } = await import("node:fs/promises");
    const { PIP_PROBE, AUTOPLAY_ARGS } = await import("../scenarios/f15-media.mjs");
    const scripts = await readFile(new URL("../../../src/hostPageScripts.ts", import.meta.url), "utf8");
    assert.ok(scripts.includes(`'${PIP_PROBE}'`));
    assert.deepEqual(AUTOPLAY_ARGS, ["--autoplay-policy=no-user-gesture-required"]);
    const main = await readFile(new URL("../../../src/main.tsx", import.meta.url), "utf8");
    for (const seam of ["webviews", "media: useMedia", "lifecycle: { state: useLifecycle }"]) assert.ok(main.includes(seam), seam);
    assert.deepEqual(selectScenarios(["#25", "F18"]).map((s) => s.id), ["F15", "F18", "F15D"]);
  });

  it("drives page messaging, selection, tint and toolbar checks through the shell's seams", async () => {
    const { readFile } = await import("node:fs/promises");
    const { SHIFT, ALT } = await import("../scenarios/f16-page-messaging.mjs");
    const { TINTS } = await import("../scenarios/f25-tint-toolbar.mjs");
    assert.deepEqual([SHIFT, ALT], [8, 1]);
    assert.deepEqual(TINTS.map((t) => t.source), ["header", "background", "meta", "background"]);
    const main = await readFile(new URL("../../../src/main.tsx", import.meta.url), "utf8");
    for (const seam of ["toolbar: useToolbarAutoHide", "state: usePageSelection", "jump: jumpToSelection", "copyQuoteLink: copyLinkToSelection", "replaceInField }"]) assert.ok(main.includes(seam), seam);
    assert.deepEqual(selectScenarios(["#26", "F25"]).map((s) => s.id), ["F16", "F25", "F16D"]);
  });

  it("names the same tab-policy lock as the Linux shell", async () => {
    const { readFile } = await import("node:fs/promises");
    const { POLICY_LOCK } = await import("../scenarios/f18-policies.mjs");
    const policies = await readFile(new URL("../../../src/hostPolicies.ts", import.meta.url), "utf8");
    assert.ok(policies.includes(`export const TAB_POLICY_LOCK = "${POLICY_LOCK}";`));
  });

  it("expects the quit prompt in the same words the shell asks and the background dialog log writes", async () => {
    const { readFile } = await import("node:fs/promises");
    const { QUIT_BACKGROUND_ANSWER } = await import("../scenarios/q221-quit-warning.mjs");
    const quit = await readFile(new URL("../../../src/quit.ts", import.meta.url), "utf8");
    const views = await readFile(new URL("../../../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_dialog_views.cc", import.meta.url), "utf8");
    assert.equal(QUIT_BACKGROUND_ANSWER, '[ardiacore] dialog (background run, not shown): "Are you sure you want to quit Ardia?" (Quit / Cancel): Cancel');
    for (const text of ["title: `Are you sure you want to quit ${app}?`", 'confirmTitle: "Quit"', 'cancelTitle: "Cancel"', 'appName: () => "Ardia"']) assert.ok(quit.includes(text), text);
    assert.ok(views.includes('"[ardiacore] dialog (background run, not shown): \\""'));
    assert.deepEqual(selectScenarios(["#221"]).map((s) => s.id), ["Q221", "Q221D"]);
  });

  it("selects by finding or issue number", () => {
    assert.deepEqual(selectScenarios(["f01", "#33", "18"]).map((s) => s.id), ["F01", "F23", "F08", "F08D"]);
    assert.equal(selectScenarios([]).length, SCENARIOS.length);
    assert.throws(() => selectScenarios(["F99"]), /Unknown scenario F99/);
  });
});
