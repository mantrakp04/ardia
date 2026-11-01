import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchArdia } from "./ardia.mjs";
import { summarizeScenario } from "./report.mjs";
import { errorText, settles, withDeadline, withSignal } from "./util.mjs";

export class ScenarioAbort extends Error {}

const activeContexts = new Set();

export async function cleanupActiveScenarios() {
  await Promise.all([...activeContexts].map((t) => t.cleanup({ keep: true }).catch(() => {})));
}

export function createContext({ scenario, options, fixtures, resultsDir, scratchRoot, launch = launchArdia, log = () => {}, drainTimeout = 15000 }) {
  const checks = [];
  const apps = new Set();
  const scratches = [];
  const deferred = [];
  const running = new Map();
  const stopping = new AbortController();
  let aborted = false;
  const refuseAfterAbort = (what) => {
    if (aborted) throw new ScenarioAbort(`${scenario.id} was stopped; refusing to ${what}`);
  };
  const evidenceDir = join(resultsDir, scenario.id);
  let evidenceReady;
  const ensureEvidence = () => (evidenceReady ??= mkdir(evidenceDir, { recursive: true }));
  const track = (promise, label = "scenario work") => {
    running.set(promise, label);
    const settled = () => running.delete(promise);
    promise.then(settled, settled);
    return promise;
  };
  const t = {
    scenario,
    options,
    fixtures,
    checks,
    evidenceDir,
    log: (message) => log(`[${scenario.id}] ${message}`),
    get aborted() {
      return aborted;
    },
    signal: stopping.signal,
    drainTimeout,
    get unfinished() {
      return [...running.values()];
    },
    defer(stop) {
      if (aborted) return void Promise.resolve().then(stop).catch(() => {});
      deferred.push(stop);
    },
    track,
    async scratch(name = "profile") {
      refuseAfterAbort("make a scratch directory");
      const dir = join(scratchRoot, `${scenario.id}-${name}-${scratches.length}`);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      scratches.push(dir);
      return dir;
    },
    async launch({ scratch, label = "ardia", background = true, extensions = false, extraArgs = [], env = {}, ozone, startTimeout, coreDumps } = {}) {
      if (!scratch) throw new Error("launch needs a scratch directory");
      refuseAfterAbort("launch a browser");
      const app = await launch({
        executable: options.executable,
        uiDir: options.uiDir,
        scratch,
        background,
        ozone,
        extensions,
        env,
        label,
        startTimeout,
        coreDumps,
        extraArgs: [...(fixtures?.chromiumArgs ?? []), ...extraArgs],
      });
      if (aborted) {
        await app.close({ graceful: false }).catch(() => {});
        refuseAfterAbort("keep a browser that started after the scenario stopped");
      }
      apps.add(app);
      return app;
    },
    async stop(app, options) {
      if (!app) return;
      const exited = await app.close(options);
      apps.delete(app);
      return exited;
    },
    async evidence(name, data) {
      await ensureEvidence();
      const file = join(evidenceDir, `${name}.json`);
      await writeFile(file, JSON.stringify(data, null, 2));
      return file;
    },
    async screenshot(target, name) {
      await ensureEvidence();
      return target?.screenshot ? target.screenshot(join(evidenceDir, `${name}.png`)) : null;
    },
    async check(name, body, { timeout = 60000, critical = false } = {}) {
      refuseAfterAbort(`run "${name}"`);
      const started = Date.now();
      const own = new AbortController();
      const signal = AbortSignal.any([stopping.signal, own.signal]);
      const work = track(withSignal(signal, () => Promise.resolve().then(() => body({ signal }))), `check "${name}"`);
      try {
        const detail = await withDeadline(work, timeout, name);
        checks.push({ name, status: "pass", detail: detail ?? null, durationMs: Date.now() - started });
        t.log(`pass ${name}`);
        return { ok: true, detail };
      } catch (error) {
        own.abort(error);
        const stopped = await settles(work, drainTimeout);
        checks.push({ name, status: "fail", detail: errorText(error), durationMs: Date.now() - started });
        t.log(`FAIL ${name}: ${errorText(error)}`);
        if (!stopped) throw new ScenarioAbort(`${name} was still running ${drainTimeout} ms after it failed, so the scenario stops before a later check overlaps it`);
        if (error instanceof ScenarioAbort) throw error;
        if (critical) throw new ScenarioAbort(`${name}: ${errorText(error)}`);
        return { ok: false, error };
      }
    },
    manual(name, steps, reason = "needs physical input or a desktop session") {
      checks.push({ name, status: "manual", reason, steps });
      t.log(`manual ${name}`);
    },
    async cleanup({ keep = false, failed = false } = {}) {
      aborted = true;
      stopping.abort(new ScenarioAbort(`${scenario.id} was stopped`));
      for (const app of [...apps]) {
        await app.close().catch(() => {});
        apps.delete(app);
      }
      for (const stop of deferred.splice(0).reverse()) await Promise.resolve().then(stop).catch(() => {});
      const stopped = await settles(Promise.allSettled([...running.keys()]), drainTimeout);
      activeContexts.delete(t);
      if (keep || failed || !stopped) return scratches;
      for (const dir of scratches) await rm(dir, { recursive: true, force: true }).catch(() => {});
      return [];
    },
  };
  activeContexts.add(t);
  return t;
}

export async function runScenario(scenario, { options, fixtures, resultsDir, scratchRoot, launch, log, keep = false, deadline = scenario.deadline ?? 300000, drainTimeout }) {
  const started = Date.now();
  const t = createContext({ scenario, options, fixtures, resultsDir, scratchRoot, launch, log, drainTimeout });
  let error = null;
  try {
    const running = t.track(withSignal(t.signal, () => Promise.resolve().then(() => scenario.run(t))), "the scenario body");
    running.catch(() => {});
    await withDeadline(running, deadline, `${scenario.id} scenario`);
  } catch (caught) {
    error = caught instanceof ScenarioAbort ? caught.message : errorText(caught);
    t.log(`ERROR ${error}`);
  }
  for (const item of scenario.manual ?? []) {
    if (!t.checks.some((c) => c.name === item.name)) t.manual(item.name, item.steps, item.reason);
  }
  const failed = !!error || t.checks.some((c) => c.status === "fail");
  const kept = await t.cleanup({ keep, failed });
  const unfinished = t.unfinished;
  if (unfinished.length) {
    const stuck = `${unfinished.join(" and ")} still running ${t.drainTimeout} ms after ${scenario.id} stopped`;
    error = error ? `${error}; ${stuck}` : stuck;
    t.log(`ERROR ${stuck}`);
  }
  const record = { checks: t.checks, error, durationMs: Date.now() - started, evidence: t.evidenceDir, keptScratch: kept.length ? kept : null, unfinished: unfinished.length ? unfinished : null };
  return summarizeScenario(scenario, record);
}

export async function runScenarios(scenarios, { stopped = () => false, onStart = () => {}, onResult = () => {}, ...context }) {
  const results = [];
  for (const [index, scenario] of scenarios.entries()) {
    if (stopped()) break;
    onStart(scenario);
    const result = await runScenario(scenario, context);
    results.push(result);
    onResult(result);
    if (!result.unfinished) continue;
    for (const skipped of scenarios.slice(index + 1)) {
      const notRun = summarizeScenario(skipped, { checks: [], error: `not run: ${scenario.id} left work running, so the suite stopped before it could overlap the next scenario` });
      results.push(notRun);
      onResult(notRun);
    }
    return { results, halted: true };
  }
  return { results, halted: false };
}
