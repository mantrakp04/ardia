import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareApp } from "../../../scripts/lib/app-copy.mjs";
import { launch, sleep } from "../../../scripts/lib/instance.mjs";
import { writeSeed } from "./perf/seed.mjs";

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { bundle: { type: "string" }, runs: { type: "string" }, out: { type: "string" } } });
const appArg = positionals[0];
if (!appArg) {
  console.error("usage: node layout-shift-test.mjs <Ardia.app> [--bundle <main.jsbundle>] [--runs 3] [--out <dir>]");
  process.exit(2);
}
const out = resolve(flags.out ?? join(tmpdir(), "ac-layout-shift"));
mkdirSync(out, { recursive: true });
const app = flags.bundle ? prepareApp(appArg, join(out, "app"), { bundle: resolve(flags.bundle) }) : resolve(appArg);

let failed = 0;
const runs = Number(flags.runs ?? 3);
for (let r = 0; r <= runs; r++) {
  const editing = r === runs;
  const data = join(out, `data-${r}`);
  rmSync(data, { recursive: true, force: true });
  writeSeed(data, "http://127.0.0.1:9", "");
  writeFileSync(join(data, "perf-probe"), editing ? "layout layoutEdit" : "layout");
  const instance = await launch(app, { data, ready: false });
  const file = join(data, "layout-watch.json");
  try {
    for (const end = Date.now() + 60_000; !existsSync(file) && Date.now() < end && !instance.exited; await sleep(200));
  } finally {
    await instance.quit();
  }
  if (!existsSync(file)) {
    console.log(`run ${r}: no layout-watch.json (the probe's layout option never ran)`);
    failed++;
    continue;
  }
  const watch = JSON.parse(readFileSync(file, "utf8"));
  const ok = watch.shown > 0 && watch.missing.length === 0 && (editing || watch.moves.length === 0);
  if (!ok) failed++;
  const what = editing ? `edited while filling (${watch.edits.join(", ")})` : "launch";
  console.log(`run ${r} ${what}: ${ok ? "ok" : "FAIL"}  ${watch.commits} commits, ${watch.rows} rows measured, ${watch.shown} on screen, ${watch.moves.length} moved, ${watch.missing.length} missing`);
  if (watch.missing.length) console.log(`  missing: ${watch.missing.slice(0, 10).join(" ")}`);
  if (editing) continue;
  for (const m of watch.moves.slice(0, 10)) console.log(`  ${m.row}: (${m.from.x}, ${m.from.y}) at commit ${m.from.commit} -> (${m.to.x}, ${m.to.y}) at commit ${m.to.commit}`);
}
process.exit(failed ? 1 : 0);
