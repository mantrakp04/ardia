import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllApps, killAllAppsNow } from "./lib/ardia.mjs";
import { parseArgs, USAGE, UsageError } from "./lib/cli.mjs";
import { findCompositor } from "./lib/compositor.mjs";
import { startFixtures } from "./lib/fixtures.mjs";
import { buildReport, exitCode, formatLine } from "./lib/report.mjs";
import { cleanupActiveScenarios, runScenario } from "./lib/scenario.mjs";
import { killDesktopNow } from "./lib/desktop.mjs";
import { withDeadline } from "./lib/util.mjs";
import { generateTls } from "./lib/tls.mjs";
import { SCENARIOS, selectScenarios } from "./scenarios/index.mjs";

async function validateInputs(options) {
  try {
    await access(options.executable, constants.X_OK);
    if (!(await stat(options.executable)).isFile()) throw new Error("not a file");
  } catch (error) {
    throw new UsageError(`${options.executable} is not an executable file (${error.code ?? error.message})`);
  }
  if (options.uiDir) {
    const info = await stat(options.uiDir).catch(() => null);
    if (!info?.isDirectory()) throw new UsageError(`${options.uiDir} is not a directory`);
    const names = await readdir(options.uiDir);
    if (!names.includes("index.html")) throw new UsageError(`${options.uiDir} has no index.html; pass the built apps/linux dist directory`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.list) {
    for (const s of SCENARIOS) process.stdout.write(`${s.id}\t#${s.issue}\t${s.title}\n`);
    return 0;
  }
  let scenarios;
  try {
    scenarios = selectScenarios(options.only);
    await validateInputs(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const log = options.quiet ? () => {} : (line) => process.stderr.write(`${line}\n`);
  const resultsDir = options.results ?? (await mkdtemp(join(tmpdir(), "ardia-acceptance-")));
  await mkdir(resultsDir, { recursive: true });
  const scratchRoot = join(resultsDir, "scratch");
  await mkdir(scratchRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  log(`Ardia acceptance: ${scenarios.length} scenarios, evidence in ${resultsDir}`);
  const tls = await generateTls(join(resultsDir, "tls"));
  const fixtures = await startFixtures({ tls });
  const results = [];
  let interrupted = false;
  const stop = (signal) => {
    if (interrupted) {
      killAllAppsNow();
      killDesktopNow();
      process.exit(130);
    }
    interrupted = true;
    log(`${signal}: stopping test browsers and desktop sessions`);
    void withDeadline(cleanupActiveScenarios().then(() => closeAllApps({ graceful: false })), 30000, "stopping the scenarios")
      .catch(() => {})
      .finally(() => {
        killAllAppsNow();
        killDesktopNow();
        fixtures.close().finally(() => process.exit(130));
      });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    for (const scenario of scenarios) {
      if (interrupted) break;
      log(`== ${scenario.id} #${scenario.issue}: ${scenario.title}`);
      const result = await runScenario(scenario, { options, fixtures, resultsDir, scratchRoot, log, keep: options.keep });
      results.push(result);
      log(formatLine(result));
    }
  } finally {
    await closeAllApps({ graceful: false });
    await fixtures.close();
  }
  const compositor = await findCompositor();
  const report = buildReport({
    executable: options.executable,
    uiDir: options.uiDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    environment: { node: process.version, platform: process.platform, compositor: compositor?.name ?? null, resultsDir },
  });
  await writeFile(join(resultsDir, "results.json"), JSON.stringify(report, null, 2));
  if (!(await readdir(scratchRoot)).length) await rm(scratchRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  log(`Summary: pass ${report.summary.pass.map((n) => `#${n}`).join(" ") || "none"}; fail ${report.summary.fail.map((n) => `#${n}`).join(" ") || "none"}; manual ${report.summary.manual.map((n) => `#${n}`).join(" ") || "none"}`);
  return exitCode(report);
}

process.on("exit", () => {
  killAllAppsNow();
  killDesktopNow();
});

process.exitCode = await main().catch(async (error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  killAllAppsNow();
  await withDeadline(cleanupActiveScenarios(), 30000, "stopping the scenarios").catch(() => {});
  killDesktopNow();
  return 1;
});
