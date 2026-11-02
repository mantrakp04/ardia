#!/usr/bin/env node
// Drives the import window through every flow against fake browser data, never a real profile.
//
//   node apps/browser/scripts/import-flow-test.mjs <Debug Ardia.app> <scratch dir> [flow…] [--record <file>] [--compare <file>] [--keep]
//
//   <scratch dir>     home/ is a copy of packages/import/fixtures/home (the fake Chrome, Arc, Dia, Firefox, Safari… data)
//                     and data/ the instance's ARDIA_DATA_DIR; both are wiped first
//   flow              chrome, chromeSkip, chromeBack, arc, firefox, dia, safariDirect, safariExport, safariBadFile
//                     (default: all of them, in that order)
//   --record <file>   writes what each flow did (the steps it passed through, counts, failures, notes, extensions and
//                     what it added to the store) as JSON
//   --compare <file>  fails each flow whose record differs from the one in <file>
//   --keep            leaves the instance running
//
// The instance is hidden, reads the fake home through ARDIA_INSTANCE importSourceDir/importSafariHome, decrypts with
// ARDIA_TEST importSecret (the fixtures' Safe Storage secret, so the Keychain is never asked), and takes Dia's open
// tabs from packages/import/fixtures/dia through ARDIA_TEST importDiaWindows, asked of <scratch dir>/FakeDia.app (a
// background-only stand-in registered with Launch Services for the run), so the real Dia is never opened. Every flow
// opens a fresh import window and drives it through globalThis.acImport. Exit code 1 if any check failed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const recordTo = flag("--record");
const compareWith = flag("--compare");
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--record" && args[i - 1] !== "--compare");
const [appArg, scratchArg, ...only] = positional;
if (args.includes("-h") || args.includes("--help") || !appArg || !scratchArg) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(args.includes("-h") || args.includes("--help") ? 0 : 64);
}

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/import/fixtures");
const SECRET = JSON.parse(readFileSync(join(FIXTURES, "secrets.json"), "utf8")).chromiumSafeStorageSecret;
const scratch = resolve(scratchArg);
const home = join(scratch, "home");
const data = join(scratch, "data");
const exportsDir = join(scratch, "exports");
for (const dir of [home, data, exportsDir]) rmSync(dir, { recursive: true, force: true });
mkdirSync(exportsDir, { recursive: true });
cpSync(join(FIXTURES, "home"), home, { recursive: true });
cpSync(join(FIXTURES, "safari/Safari Export.zip"), join(exportsDir, "Safari Export.zip"));
cpSync(join(FIXTURES, "safari/not-an-export.zip"), join(exportsDir, "not-an-export.zip"));
cpSync(join(FIXTURES, "dia/applescript-windows.json"), join(exportsDir, "dia-windows.json"));

const FAKE_DIA_ID = "dev.ardia.fixture.dia";
const fakeDia = join(scratch, "FakeDia.app");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
rmSync(fakeDia, { recursive: true, force: true });
mkdirSync(join(fakeDia, "Contents/MacOS"), { recursive: true });
writeFileSync(join(fakeDia, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${FAKE_DIA_ID}</string><key>CFBundleExecutable</key><string>FakeDia</string>
<key>CFBundleName</key><string>FakeDia</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/>
</dict></plist>`);
writeFileSync(join(scratch, "FakeDia.swift"), `import AppKit
NSApplication.shared.setActivationPolicy(.prohibited)
DispatchQueue.main.asyncAfter(deadline: .now() + 300) { exit(0) }
NSApplication.shared.run()
`);
execFileSync("xcrun", ["swiftc", "-O", "-o", join(fakeDia, "Contents/MacOS/FakeDia"), join(scratch, "FakeDia.swift")]);
execFileSync(LSREGISTER, ["-f", fakeDia]);

const rep = reporter(join(scratch, "import-flow-test.log"), { name: "import-flow-test" });
let app = null;

const HELPERS = `
const g = () => globalThis.acImport;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = (...fns) => fns.reduce((p, f) => p.then(f), Promise.resolve());
const until = (test, ms = 30000) => new Promise((ok, no) => { const end = Date.now() + ms; const tick = () => { let v; try { v = test(); } catch {} if (v) return ok(v); if (Date.now() > end) return no(new Error("timed out: " + test)); setTimeout(tick, 40); }; tick(); });
`;
const run = (body, timeout = 90_000) => app.eval(`${HELPERS}\n${body}`, { timeout });

const storeSummary = `const s = ac.store.getState();
  const tabs = {}; for (const t of Object.values(s.tabs)) { const p = s.profiles[t.profileId]?.name ?? t.profileId; tabs[p] ??= { open: 0, pinned: 0 }; tabs[p][t.pin ? "pinned" : "open"]++; }
  return { profiles: Object.values(s.profiles).map((p) => [p.name, p.color, p.icon]).sort(), tabs, groups: Object.keys(s.groups ?? {}).length };`;

async function openWindow() {
  await run(`return steps(
    () => g() && (g().close(), until(() => !g(), 10000)),
    () => ac.runCommand({ command: "importBrowserData", arg: null, windowId: null }),
    () => until(() => g() && g().step === "choose", 30000),
    () => true);`);
}

const startWatch = `globalThis.__importSteps = []; clearInterval(globalThis.__importWatch);
  globalThis.__importStatus = null;
  globalThis.__importWatch = setInterval(() => { const st = g()?.step; const seen = globalThis.__importSteps; if (st && seen[seen.length - 1] !== st) seen.push(st); if (st === "progress") globalThis.__importStatus = g().status; }, 15); return true;`;

const outcome = `clearInterval(globalThis.__importWatch); const f = g();
  return { steps: globalThis.__importSteps, step: f.step, error: f.error, counts: f.counts, failures: f.failures, notes: f.notes, status: globalThis.__importStatus,
    extensions: { count: f.extensions.list.length, ids: f.extensions.list.map((e) => e.id).sort(), toProfile: !!f.extensions.profileId } };`;

async function flowRun(body) {
  const before = await run(storeSummary);
  await run(startWatch);
  await run(`return steps(${body}).then(() => true);`, 120_000);
  const out = await run(outcome);
  const after = await run(storeSummary);
  const added = {};
  for (const [p, c] of Object.entries(after.tabs)) {
    const b = before.tabs[p] ?? { open: 0, pinned: 0 };
    if (c.open !== b.open || c.pinned !== b.pinned) added[p] = { open: c.open - b.open, pinned: c.pinned - b.pinned };
  }
  out.store = { newProfiles: after.profiles.filter((p) => !before.profiles.some((q) => JSON.stringify(q) === JSON.stringify(p))), tabs: added, groups: after.groups - before.groups };
  return out;
}

const done = `() => until(() => g().step === "done", 90000), () => settle(300)`;
const pick = (id) => `() => g().select("${id}"), () => settle(200)`;
const next = `() => g().next()`;
const stepIs = (name) => `() => until(() => g().step === "${name}")`;
const throughProfiles = `() => until(() => g().step !== "choose"), () => settle(200),
    () => g().step === "profiles" && (g().next(), until(() => g().step !== "profiles"))`;
const throughProfilesAndUnlock = `() => until(() => g().step !== "choose"), () => settle(200),
    () => g().step === "profiles" && (g().next(), until(() => g().step !== "profiles")),
    () => g().step === "unlock" && g().unlock()`;

const FLOWS = {
  chrome: `${pick("chrome")}, ${next}, ${throughProfiles}, ${stepIs("unlock")}, () => g().unlock(), ${done}`,
  chromeSkip: `${pick("chrome")}, ${next}, ${throughProfiles}, ${stepIs("unlock")}, () => g().skipEncrypted(), ${done}`,
  chromeBack: `${pick("chrome")}, ${next}, ${throughProfiles}, ${stepIs("unlock")}, () => g().back(), ${stepIs("choose")}, () => settle(200)`,
  arc: `${pick("arc")}, ${next}, ${throughProfilesAndUnlock}, ${done}`,
  firefox: `${pick("firefox")}, () => g().setKinds(g().kinds.filter((k) => k !== "passwords")), () => settle(200), ${next}, ${throughProfilesAndUnlock}, ${done}`,
  dia: `${pick("dia")}, ${next}, ${throughProfilesAndUnlock}, ${done}`,
  safariDirect: `${pick("safari")}, ${next}, ${stepIs("safari")}, () => settle(200), () => g().importSafariDirect(), ${done}`,
  safariExport: `${pick("safari")}, ${next}, ${stepIs("safari")}, () => g().importSafari(${JSON.stringify(join(exportsDir, "Safari Export.zip"))}), ${done}`,
  safariBadFile: `${pick("safari")}, ${next}, ${stepIs("safari")}, () => g().importSafari(${JSON.stringify(join(exportsDir, "not-an-export.zip"))}),
    () => until(() => g().step === "safari" && g().error), () => settle(200)`,
};

const CHECKS = {
  chrome: (r) => {
    assert.deepEqual(r.steps.slice(-3), ["unlock", "progress", "done"]);
    assert.ok(r.counts.bookmarks > 0 && r.counts.passwords > 0, JSON.stringify(r.counts));
  },
  chromeSkip: (r) => {
    assert.deepEqual(r.steps.slice(-3), ["unlock", "progress", "done"]);
    assert.equal(r.counts.passwords, 0);
    assert.equal(r.counts.cookies, 0);
  },
  chromeBack: (r) => {
    assert.deepEqual(r.steps.slice(-2), ["unlock", "choose"]);
    assert.equal(r.error, null);
  },
  arc: (r) => {
    assert.equal(r.step, "done");
    assert.ok(r.store.newProfiles.length > 0, "Arc's spaces become profiles");
  },
  firefox: (r) => assert.equal(r.step, "done"),
  dia: (r) => {
    assert.equal(r.step, "done");
    assert.ok(r.counts.tabs > 0 && !r.notes.some((n) => n.startsWith("Dia's tabs couldn't be brought over:")), JSON.stringify(r));
  },
  safariDirect: (r) => {
    assert.deepEqual(r.steps.slice(-3), ["safari", "progress", "done"]);
    assert.ok(r.counts.bookmarks > 0, JSON.stringify(r.counts));
  },
  safariExport: (r) => {
    assert.deepEqual(r.steps.slice(-3), ["safari", "progress", "done"]);
    assert.ok(r.counts.passwords > 0, JSON.stringify(r.counts));
  },
  safariBadFile: (r) => {
    assert.equal(r.step, "safari");
    assert.ok(r.error, "the bad file shows an error");
  },
};

const wanted = only.length ? only : Object.keys(FLOWS);
const unknown = wanted.filter((f) => !FLOWS[f]);
if (unknown.length) throw new Error(`unknown flow: ${unknown.join(", ")}`);
const expected = compareWith ? JSON.parse(readFileSync(compareWith, "utf8")) : null;
const recorded = {};

try {
  app = await launch(resolve(appArg), {
    data,
    onboarded: true,
    instance: { importSourceDir: join(home, "Library/Application Support"), importSafariHome: home },
    test: { importSecret: SECRET, importDiaBundleId: FAKE_DIA_ID, importDiaWindows: join(exportsDir, "dia-windows.json") },
    ready: { timeout: 90_000, test: "return ac.store.getState().windowOrder.length > 0" },
  });
  rep.log("pid", app.pid, "cdp", app.port, "log", app.log);
  const listed = await run(`return globalThis.expo.modules.ArdiaImport.listBrowsers().then((j) => (typeof j === "string" ? JSON.parse(j) : j).map((b) => b.id));`);
  rep.log("listed:", JSON.stringify(listed));
  for (const name of wanted) {
    await rep.check(name, async () => {
      await openWindow();
      const r = await flowRun(FLOWS[name]);
      recorded[name] = r;
      rep.log(name, JSON.stringify(r));
      CHECKS[name](r);
      if (expected?.[name]) assert.deepEqual(r, expected[name], `${name} differs from ${compareWith}`);
    });
  }
} finally {
  if (recordTo) writeFileSync(recordTo, JSON.stringify(recorded, null, 2));
  if (app && !args.includes("--keep")) await app.quit();
  else if (app) rep.say(`kept pid ${app.pid}: scripts/agent/ac eval ${data} '<js>'`);
  spawnSync("pkill", ["-f", join(fakeDia, "Contents/MacOS/FakeDia")]);
  execFileSync(LSREGISTER, ["-u", fakeDia]);
}
await sleep(0);
process.exit(rep.summary() ? 0 : 1);
