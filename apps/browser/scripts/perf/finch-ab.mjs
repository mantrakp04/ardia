#!/usr/bin/env node
// A/B of Google Chrome's field-trial features (Finch) in Ardia on xbench's rows. Chrome's runs in xbench use the
// variations seed its template profile fetched; Ardia has none (disable_fieldtrial_testing_config, no seed). This
// reads the features Chrome actually runs with and gives them to Ardia through ARDIA_INSTANCE chromiumSwitches (a scratch
// data dir forwards them), merged with Ardia's own --enable-features. Run only with the Mac quiet.
//
//   node apps/browser/scripts/perf/finch-ab.mjs features --out <dir> [--chrome <app>] [--template <dir>]
//       launches the Chrome copy hidden on a clone of xbench's Chrome template, reads chrome://version's variations
//       command line, writes <dir>/chrome-variations.txt and <dir>/arms.json (all of it, and the perf subset)
//   node apps/browser/scripts/perf/finch-ab.mjs run --out <dir> [--app <Ardia.app>] [--arms all,perf] [-- <more xbench options>]
//       xbench run --browsers ardia,ardia-finch[,ardia-perf] with each arm's switches, rows session,restore,link,
//       then xbench report into <dir>/table.md
//
//     --chrome <path>    a background-only Chrome copy that can't take focus (default
//                        /tmp/ac-xbench/apps/chrome-bg/Google Chrome.app, made by xbench.mjs prepare-bg)
//     --template <dir>   xbench's Chrome template (default /tmp/ac-xbench/final/templates/chrome)
//     --app <path>       the Ardia copy (default /tmp/ac-xbench/apps/ardia/Ardia.app)
//     --port <n>         CDP port for the Chrome launch (default 9471)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { devtools, sleep } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const split = process.argv.indexOf("--");
const own = split < 0 ? process.argv.slice(2) : process.argv.slice(2, split);
const more = split < 0 ? [] : process.argv.slice(split + 1);
const { values: opt, positionals } = parseArgs({
  args: own,
  allowPositionals: true,
  options: {
    out: { type: "string" },
    chrome: { type: "string", default: "/tmp/ac-xbench/apps/chrome-bg/Google Chrome.app" },
    template: { type: "string", default: "/tmp/ac-xbench/final/templates/chrome" },
    app: { type: "string", default: "/tmp/ac-xbench/apps/ardia/Ardia.app" },
    arms: { type: "string", default: "all,perf" },
    port: { type: "string", default: "9471" },
    help: { type: "boolean", short: "h" },
  },
});
if (opt.help || !positionals[0] || !opt.out) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(opt.help ? 0 : 64);
}

const out = resolve(opt.out);
const port = Number(opt.port);
const PERF = /Memory|Purge|PartitionAlloc|Quarantine|V8|Heap|GC|Throttl|Freez|Background|Priority|Wake|Timer|Idle|Discard|Raster|Tile|Compositor|Frame|Paint|Renderer|Process|Spare|Warm|Scheduler|Pump|Mojo|Vouchers|Thread|Cache/;

function switchValue(cmd, name) {
  const m = cmd.match(new RegExp(`--${name}=(?:"([^"]*)"|(\\S+))`));
  return m?.[1] ?? m?.[2] ?? "";
}

function ardiaFeatures() {
  const host = readFileSync(join(repoRoot, "packages/ardiacore/ios/ArdiaHost+Launch.mm"), "utf8");
  const literal = host.match(/"--enable-features=([^"]*)"\s*((?:"[^"]*"\s*)*),/);
  if (!literal) throw new Error("ArdiaHost+Launch.mm's --enable-features list wasn't found");
  const rest = [...literal[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
  return [...new Set(["WebContentsDiscard", ...`${literal[1]}${rest}`.split(",")].filter(Boolean))];
}

function names(list) {
  return list.split(",").filter(Boolean).map((f) => f.replace(/^\*/, ""));
}

function armSwitches(cmd, keep) {
  const enabled = names(switchValue(cmd, "enable-features")).filter((f) => keep(f.split("<")[0].split(":")[0]));
  const disabled = names(switchValue(cmd, "disable-features")).filter((f) => keep(f.split("<")[0].split(":")[0]));
  const ours = ardiaFeatures();
  const enable = [...ours, ...enabled.filter((f) => !ours.some((o) => o.split(":")[0] === f.split("<")[0].split(":")[0]))];
  const parts = [`--enable-features=${enable.join(",")}`];
  if (disabled.length) parts.push(`--disable-features=${disabled.join(",")}`);
  const trials = switchValue(cmd, "force-fieldtrials");
  const params = switchValue(cmd, "force-fieldtrial-params");
  if (trials) parts.push(`--force-fieldtrials=${trials}`);
  if (params) parts.push(`--force-fieldtrial-params=${params}`);
  return { switches: parts.join(" "), enabled: enabled.length, disabled: disabled.length };
}

async function features() {
  const chrome = resolve(opt.chrome);
  if (!existsSync(chrome)) throw new Error(`no Chrome copy at ${chrome}: make the background-only one with xbench.mjs prepare-bg --browsers chrome`);
  if (realpathSync(chrome).startsWith("/Applications/")) throw new Error("never an installed app: pass a copy");
  const plist = spawnSync("plutil", ["-extract", "LSBackgroundOnly", "raw", join(chrome, "Contents/Info.plist")], { encoding: "utf8" }).stdout.trim();
  if (plist !== "true" && plist !== "1") throw new Error(`${chrome} isn't background-only, so it would take focus: use xbench.mjs prepare-bg's copy`);
  if (!existsSync(join(opt.template, "home/udd/Local State"))) throw new Error(`no Chrome template at ${opt.template}`);
  mkdirSync(out, { recursive: true });
  const home = join(out, "chrome-home");
  rmSync(home, { recursive: true, force: true });
  execFileSync("cp", ["-Rc", join(opt.template, "home"), home]);
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(home, "udd", f), { force: true });
  const exe = join(chrome, "Contents/MacOS/Google Chrome");
  execFileSync("open", ["-g", "-n", "--env", `HOME=${home}`, "--env", `CFFIXED_USER_HOME=${home}`, "-a", chrome, "--args",
    `--user-data-dir=${join(home, "udd")}`, `--remote-debugging-port=${port}`, "--remote-allow-origins=*", "--no-first-run",
    "--no-default-browser-check", "--password-store=basic", "--use-mock-keychain"]);
  let cmd = "";
  try {
    let version;
    for (const end = Date.now() + 60_000; !version && Date.now() < end; await sleep(250))
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
    if (!version) throw new Error("Chrome's DevTools port never answered");
    const root = await devtools({ webSocketDebuggerUrl: version.webSocketDebuggerUrl, url: "browser" });
    const { targetId } = await root.send("Target.createTarget", { url: "chrome://version/?show-variations-cmd" });
    for (const end = Date.now() + 20_000; !cmd && Date.now() < end; await sleep(250)) {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.id === targetId);
      if (!page) continue;
      const session = await devtools(page);
      cmd = (await session.eval(`document.querySelector("#variations-cmd")?.innerText ?? ""`).catch(() => "")) ?? "";
      session.close();
    }
    await root.send("Browser.close").catch(() => null);
    root.close();
  } finally {
    for (const end = Date.now() + 15_000; Date.now() < end; await sleep(250))
      if (spawnSync("pgrep", ["-f", `^${exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`]).status !== 0) break;
    const left = spawnSync("pgrep", ["-f", `^${exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`], { encoding: "utf8" }).stdout.trim();
    for (const pid of left.split("\n").filter(Boolean)) try { process.kill(Number(pid), "SIGTERM"); } catch {}
  }
  if (!cmd.includes("--")) throw new Error("chrome://version showed no variations command line");
  writeFileSync(join(out, "chrome-variations.txt"), cmd);
  const arms = { all: armSwitches(cmd, () => true), perf: armSwitches(cmd, (f) => PERF.test(f)) };
  writeFileSync(join(out, "arms.json"), JSON.stringify({ made: new Date().toISOString(), chrome, ...arms }, null, 2));
  console.log(`all: ${arms.all.enabled} enabled, ${arms.all.disabled} disabled; perf: ${arms.perf.enabled} enabled, ${arms.perf.disabled} disabled`);
}

function run() {
  const file = join(out, "arms.json");
  if (!existsSync(file)) throw new Error(`run features first (no ${file})`);
  const arms = JSON.parse(readFileSync(file, "utf8"));
  const app = resolve(opt.app);
  const wanted = opt.arms.split(",").filter((a) => arms[a]);
  const browsers = ["ardia", ...wanted.map((a) => (a === "all" ? "ardia-finch" : `ardia-${a}`))];
  const args = ["run", "--out", join(out, "bench"), "--browsers", browsers.join(","), "--app", `ardia=${app}`, "--rows", "session,restore,link"];
  for (const a of wanted) {
    const name = a === "all" ? "ardia-finch" : `ardia-${a}`;
    args.push("--app", `${name}=${app}`, "--env", `${name}=ARDIA_INSTANCE=chromiumSwitches=${arms[a].switches}`);
  }
  const xbench = join(here, "xbench.mjs");
  const r = spawnSync(process.execPath, [xbench, ...args, ...more], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  execFileSync(process.execPath, [xbench, "report", "--out", join(out, "bench"), "--json", join(out, "bench.json"), "--md", join(out, "table.md")], { stdio: "inherit" });
}

if (positionals[0] === "features") await features();
else if (positionals[0] === "run") run();
else throw new Error(`unknown command ${positionals[0]}`);
