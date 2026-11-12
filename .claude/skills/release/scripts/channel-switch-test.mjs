#!/usr/bin/env node
// Channel switch: hidden copies of <installed app> switched between Stable and Nightly while Sparkle holds a nightly
// (staged for install on quit, downloading, shown in its window, waiting on the prewarm), then quit; each check says
// whether the nightly installed, how long quit took, and that quit ended on its own.
//
//   channel-switch-test.mjs <installed app> [--candidate APP] [--scratch DIR] [--only a,b] [--jobs N] [--keep] [--list]
//
// The candidate (default: the installed app) becomes build +1 on the nightly channel. Every copy gets the bundle id
// com.ardia.browser.switchtest.<run>.<n>, the run's own EdDSA key, this run's local feed in its Info.plist and in
// ARDIA_INSTANCE updateFeed, and an LSEnvironment that keeps any relaunch hidden in its scratch dir. A copy that fails
// any of that isn't launched. Cleanup touches only those ids, their launchd jobs and processes run from the run's dirs.
// Scratch: --scratch (default ~/ardia-scratch/channel-switch-test). Needs an Apple Development identity, swiftc,
// python3 and Accessibility for this terminal (the window checks press Sparkle's buttons by pid, never by focus).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const { launch, launchVariables, isAlive, processInfo, sleep } = await import(join(root, "scripts/lib/instance.mjs"));

const argv = process.argv.slice(2);
if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(argv.length ? 0 : 64);
}
const flags = {}, positional = [];
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) positional.push(argv[i]);
  else if (["--keep", "--list"].includes(argv[i])) flags[argv[i].slice(2)] = true;
  else flags[argv[i].slice(2)] = argv[++i];
}

const uid = process.getuid();
const home = realpathSync(homedir());
const plist = (file, ...commands) =>
  execFileSync("/usr/libexec/PlistBuddy", commands.flatMap((c) => ["-c", c]).concat(file), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const info = (app, key) => {
  try {
    return plist(join(app, "Contents/Info.plist"), `Print :${key}`);
  } catch {
    return null;
  }
};
const harness = (script, ...args) =>
  execFileSync("bash", ["-c", `set -euo pipefail; . "${here}/lib/harness.sh"; ${script}`, "harness", ...args], { encoding: "utf8" }).trim();
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

class Failure extends Error {}
const check = (ok, message) => {
  if (!ok) throw new Failure(message);
};
async function until(test, ms, what, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > end) throw new Failure(`${what} (waited ${Math.round(ms / 1000)} s)`);
    await sleep(every);
  }
}

const THROTTLED_SECONDS = 30;
const QUIT_HOLD_LIMIT = 9500;

const scenarios = [
  {
    key: "leave-staged",
    what: "Nightly → Stable with a nightly staged: the staged copy goes, the skip keys stay exactly as they were, quit installs nothing",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      await s.switchTo("stable");
      const gone = await s.untilGone(20000);
      check(JSON.stringify(s.skipKeys()) === JSON.stringify(s.presetSkips), `skip keys changed: ${JSON.stringify(s.skipKeys())}`);
      const q = await s.quit();
      s.expectInstalled(false);
      return `dropped in ${gone} ms, quit in ${q} ms`;
    },
  },
  {
    key: "leave-staged-checks-off",
    what: "Nightly → Stable with a nightly staged and automatic checks turned off: the staged copy still goes",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      await s.eval(`return U.setAutomaticUpdateChecks(false).then(() => U.updaterState()).then((u) => u.automaticChecks);`).then((on) => check(on === false, "automatic checks didn't turn off"));
      await s.switchTo("stable");
      const gone = await s.untilGone(20000);
      const q = await s.quit();
      s.expectInstalled(false);
      return `dropped in ${gone} ms, quit in ${q} ms`;
    },
  },
  {
    key: "leave-downloading",
    what: "Nightly → Stable during an automatic download: once the download ends nothing stays staged, quit installs nothing",
    control: { throttled: true },
    async run(s) {
      await s.launch();
      await s.untilServed(1 << 20);
      await s.switchTo("stable");
      await until(() => s.zipEnded(), (THROTTLED_SECONDS + 30) * 1000, "the download never ended");
      await s.untilSettledWithoutCopy(40000);
      const q = await s.quit();
      s.expectInstalled(false);
      return `quit in ${q} ms`;
    },
  },
  {
    key: "quit-during-download",
    what: "Nightly → Stable during an automatic download and quit at once (Sparkle busy, nothing in its folder): quit holds the unresolved switch until the deadline",
    alone: true,
    control: { throttled: true },
    async run(s) {
      await s.launch();
      await s.untilServed(1 << 20);
      await s.switchTo("stable");
      check(!s.staged().length, "Sparkle had already put a copy in its Installation folder; this ordering wasn't reached");
      const q = await s.quit(QUIT_HOLD_LIMIT, { settle: false });
      check(q >= 6000, `quit went at ${q} ms with the switch unresolved and Sparkle still downloading`);
      await s.untilInstallerGone();
      s.expectInstalled(false);
      return `quit held ${q} ms`;
    },
  },
  {
    key: "quit-during-extraction",
    what: "Nightly → Stable during an automatic download, then quit as it ends (before Sparkle's installer has put anything in its folder): quit waits, nothing installs",
    alone: true,
    control: { throttled: 10 },
    async run(s) {
      await s.launch();
      await s.untilServed(1 << 20);
      await s.switchTo("stable");
      await until(() => s.zipEnded(), 40000, "the download never ended", 5);
      check(!s.staged().length, "Sparkle had already put a copy in its Installation folder; this ordering wasn't reached");
      const q = await s.quit(QUIT_HOLD_LIMIT, { settle: false });
      check(q >= 1500, `quit went at ${q} ms while Sparkle was still extracting the nightly the switch left`);
      await s.untilInstallerGone();
      s.expectInstalled(false);
      check(!s.offChannelCopies().length, "the nightly stayed staged after quit");
      return `quit waited ${q} ms for Sparkle to finish, then for the drop`;
    },
  },
  {
    key: "switch-then-quit",
    what: "Nightly → Stable and quit at once: quit waits for the drop (under 9.5 s), ends on its own, installs nothing",
    alone: true,
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      await s.eval(`U.setUpdateChannel("stable"); return true;`);
      const q = await s.quit(QUIT_HOLD_LIMIT);
      s.expectInstalled(false);
      return `quit in ${q} ms`;
    },
  },
  {
    key: "twice-ends-nightly",
    what: "Nightly → Stable → Nightly in one go: it ends on Nightly and quit installs the nightly",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      await s.eval(`U.setUpdateChannel("stable"); U.setUpdateChannel("nightly"); return true;`);
      await sleep(5000);
      check((await s.state()).channel === "nightly", "didn't end on Nightly");
      const q = await s.quit();
      s.expectInstalled(true);
      return `quit in ${q} ms`;
    },
  },
  {
    key: "twice-ends-stable",
    what: "Nightly → Stable → Nightly → Stable in one go: it ends on Stable, the staged copy goes, quit installs nothing",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      await s.eval(`U.setUpdateChannel("stable"); U.setUpdateChannel("nightly"); U.setUpdateChannel("stable"); return true;`);
      const gone = await s.untilGone(25000);
      const q = await s.quit();
      s.expectInstalled(false);
      return `dropped in ${gone} ms, quit in ${q} ms`;
    },
  },
  {
    key: "enter-nightly",
    what: "Stable → Nightly: the nightly a Stable copy ignored is fetched at once, and quit installs it",
    start: { channel: "stable" },
    async run(s) {
      await s.launch();
      await until(async () => { const u = await s.state(); return u.lastCheck && !u.sessionInProgress; }, 60000, "the first check never ran");
      check(!s.offChannelCopies().length && !s.staged().length, "a Stable copy staged the nightly");
      await s.switchTo("nightly");
      const staged = await s.untilStaged(60000);
      const q = await s.quit();
      s.expectInstalled(true);
      return `staged ${staged} ms after the switch, quit in ${q} ms`;
    },
  },
  {
    key: "return-after-drop",
    what: "Back to Nightly once a drop has finished (its installer gone): the resume session saw Stable, so the nightly is fetched again at once",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.switchTo("stable");
      await s.untilGone(20000);
      await s.untilInstallerGone(30000);
      await s.untilIdle();
      await s.switchTo("nightly");
      const staged = await s.untilStaged(60000);
      const q = await s.quit();
      s.expectInstalled(true);
      return `staged again ${staged} ms after the switch back, quit in ${q} ms`;
    },
  },
  {
    key: "window-open",
    what: "Nightly → Stable with Sparkle's Update Found window open: the window is answered and closes, nothing is downloaded or skipped",
    start: { automaticDownloads: false },
    async run(s) {
      await s.launch();
      await s.untilButton("Install Update");
      await s.switchTo("stable");
      await until(() => !s.hasButton("Install Update"), 15000, "the Update Found window stayed open");
      await s.untilIdle();
      check(JSON.stringify(s.skipKeys()) === JSON.stringify(s.presetSkips), `skip keys changed: ${JSON.stringify(s.skipKeys())}`);
      check(!s.served().some((e) => e.path === "Ardia.zip"), "the nightly was downloaded");
      const q = await s.quit();
      s.expectInstalled(false);
      return `quit in ${q} ms`;
    },
  },
  {
    key: "window-return-waits",
    what: "Stable and back to Nightly inside Sparkle's own Nightly session (its window open): the next check waits for the schedule (documented gap; after a drop of ours it comes at once)",
    start: { automaticDownloads: false },
    async run(s) {
      await s.launch();
      await s.untilButton("Install Update");
      await s.eval(`U.setUpdateChannel("stable"); U.setUpdateChannel("nightly"); return true;`);
      await until(() => !s.hasButton("Install Update"), 15000, "the Update Found window stayed open");
      await s.untilIdle();
      const feeds = s.served().filter((e) => e.path === "appcast.xml").length;
      await sleep(20000);
      check(s.served().filter((e) => e.path === "appcast.xml").length === feeds, "a check ran at once (the gap is gone: update the docs)");
      const q = await s.quit();
      s.expectInstalled(false);
      return `no check in 20 s after returning, quit in ${q} ms`;
    },
  },
  {
    key: "ready-to-install",
    what: "Nightly → Stable with Ready to Install showing: its installer is cancelled and the staged copy goes",
    start: { automaticDownloads: false },
    async run(s) {
      await s.launch();
      await s.untilButton("Install Update");
      s.press("Install Update");
      await s.untilButton("Install and Relaunch", 90000);
      await s.untilStaged(30000, { idle: false });
      await s.switchTo("stable");
      const gone = await s.untilGone(20000);
      await until(() => !s.hasButton("Install and Relaunch"), 15000, "Ready to Install stayed open");
      const q = await s.quit();
      s.expectInstalled(false);
      return `dropped in ${gone} ms, quit in ${q} ms`;
    },
  },
  {
    key: "ui-download-cancel",
    what: "Nightly → Stable during a download started from Sparkle's window: the download is cancelled",
    start: { automaticDownloads: false },
    control: { throttled: true },
    async run(s) {
      await s.launch();
      await s.untilButton("Install Update");
      s.press("Install Update");
      await s.untilServed(1 << 20);
      await s.switchTo("stable");
      await until(() => s.served().some((e) => e.path === "Ardia.zip" && e.aborted), 15000, "the download wasn't cancelled");
      await s.untilSettledWithoutCopy(20000);
      const q = await s.quit();
      s.expectInstalled(false);
      return `quit in ${q} ms`;
    },
  },
  {
    key: "install-held-by-prewarm",
    what: "Nightly → Stable while Install and Relaunch waits on the prewarm: the install becomes a drop",
    start: { automaticDownloads: false },
    async run(s) {
      await s.launch();
      await s.untilButton("Install Update");
      s.press("Install Update");
      await s.untilButton("Install and Relaunch", 90000);
      await s.untilStaged(30000, { idle: false });
      await sleep(3000);
      const catcher = s.stopChild(`${s.installation}/`, 10);
      s.press("Install and Relaunch");
      const prewarm = await catcher;
      check(prewarm, "never caught the prewarm");
      try {
        await s.switchTo("stable");
        await sleep(1000);
      } finally {
        process.kill(prewarm, "SIGCONT");
      }
      const gone = await s.untilGone(30000);
      await sleep(3000);
      check(isAlive(s.app.pid), "the app quit to install the nightly");
      const q = await s.quit();
      s.expectInstalled(false);
      return `dropped in ${gone} ms, quit in ${q} ms`;
    },
  },
  {
    key: "stale-copy",
    what: "A leftover nightly copy with no installer, empty feed: quit is held at most to the deadline, nothing installs, and the copy is left for Sparkle",
    alone: true,
    start: { channel: "stable", stale: true },
    control: { feed: "empty" },
    async run(s) {
      await s.launch();
      const q = await s.quit(QUIT_HOLD_LIMIT);
      s.expectUntouched();
      s.expectInstalled(false);
      return `quit in ${q} ms, the copy left alone`;
    },
  },
  {
    key: "stale-copy-beside-residue",
    what: "A leftover nightly beside an abandoned copy with no Info.plist: quit is held at most to the deadline and both are left alone",
    alone: true,
    start: { channel: "stable", stale: true, abandoned: true },
    control: { feed: "empty" },
    async run(s) {
      await s.launch();
      const q = await s.quit(QUIT_HOLD_LIMIT);
      s.expectUntouched();
      check(existsSync(join(s.installation, "abandoned/Ardia.app/Contents")), "the abandoned copy was touched");
      s.expectInstalled(false);
      return `quit in ${q} ms, both left alone`;
    },
  },
  {
    key: "stale-copy-slow-feed",
    what: "A leftover nightly copy with no installer and a feed that answers after 20 s: quit is held to the deadline and no later, and the copy is left alone",
    alone: true,
    start: { channel: "stable", stale: true },
    control: { feed: "empty", feedDelay: 20 },
    async run(s) {
      await s.launch();
      const q = await s.quit(QUIT_HOLD_LIMIT);
      check(q >= 6000, `quit went at ${q} ms with nothing confirming the leftover's drop`);
      s.expectUntouched();
      s.expectInstalled(false);
      return `quit held ${q} ms, the copy left alone`;
    },
  },
  {
    key: "quit-without-switch",
    what: "Quit with a live staged nightly the saved channel no longer allows, no switch made: quit drops it first",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      sh("defaults", ["write", s.prefs, "ACUpdateChannel", "stable"]);
      await until(async () => (await s.state()).channel === "stable", 10000, "the app never saw the saved channel change");
      const q = await s.quit(QUIT_HOLD_LIMIT);
      s.expectInstalled(false);
      return `quit in ${q} ms`;
    },
  },
  {
    key: "switch-during-probe",
    what: "Nightly → Stable while Sparkle's interval probe runs (a session with no callback): the drop happens once it ends",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      const stopped = s.stopInstaller();
      let during;
      try {
        await s.eval(`return U.setAutomaticUpdateChecks(false).then(() => U.setAutomaticUpdateChecks(true));`);
        await until(async () => (await s.state()).sessionInProgress, 6000, "toggling automatic checks didn't start the interval probe", 50);
        during = await s.eval(`return U.setUpdateChannel("stable").then(() => U.updaterState()).then((u) => u.sessionInProgress);`);
      } finally {
        s.resume(stopped);
      }
      check(during === true, "the switch didn't land during the probe");
      const gone = await s.untilGone(30000);
      const q = await s.quit();
      s.expectInstalled(false);
      return `dropped ${gone} ms after the probe could end, quit in ${q} ms`;
    },
  },
  {
    key: "unresponsive-installer",
    what: "Nightly → Stable and quit with Sparkle's installer not answering: quit goes at the deadline, nothing is moved, and the nightly can still install (known limit)",
    alone: true,
    async run(s) {
      await s.launch();
      await s.untilStaged();
      const stopped = s.stopInstaller();
      let q;
      try {
        await s.eval(`U.setUpdateChannel("stable"); return true;`);
        q = await s.quit(QUIT_HOLD_LIMIT, { settle: false });
        s.expectUntouched();
      } finally {
        s.resume(stopped);
      }
      check(q >= 6000, `quit came early (${q} ms): something confirmed a drop that never happened`);
      await s.untilInstallerGone();
      s.expectInstalled(true);
      return `quit at ${q} ms; the installer, once it answered, installed the nightly as documented`;
    },
  },
  {
    key: "unreadable-staged-copy",
    what: "Quit with a live staged nightly whose Info.plist can't be read, the saved channel no longer Nightly: quit asks Sparkle to resume it, Sparkle's Skip reaches the installer, and quit goes well inside 8 s",
    alone: true,
    async run(s) {
      await s.launch();
      await s.untilStaged();
      for (const copy of s.staged()) chmodSync(join(copy.path, "Contents/Info.plist"), 0o000);
      sh("defaults", ["write", s.prefs, "ACUpdateChannel", "stable"]);
      await until(async () => (await s.state()).channel === "stable", 10000, "the app never saw the saved channel change");
      const drops = (s.app.output().match(/dropping update/g) ?? []).length;
      const q = await s.quit(QUIT_HOLD_LIMIT);
      check((s.app.output().match(/dropping update/g) ?? []).length > drops, "quit didn't ask Sparkle to resume the unreadable copy");
      check(!s.staged().length, "Sparkle's Skip didn't clear the unreadable copy");
      s.expectInstalled(false);
      return `Sparkle skipped it and quit went in ${q} ms`;
    },
  },
  {
    key: "cancelled-quit-then-drop",
    what: "A quit cancelled while it waits for the drop (twice, as a runtime teardown after an explicit cancel would) stays cancelled when the drop completes, and the next quit works",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      const stopped = s.stopInstaller();
      try {
        await s.eval(`U.setUpdateChannel("stable"); return true;`);
        s.sendQuit();
        await sleep(1500);
        check(isAlive(s.app.pid), "quit didn't wait for the drop");
        await s.eval(`return Q.replyToTerminate(false).then(() => Q.replyToTerminate(false));`);
      } finally {
        s.resume(stopped);
      }
      await s.untilGone(30000);
      await sleep(3000);
      check(isAlive(s.app.pid), "the cancelled quit went through when the drop completed");
      await s.eval(`return Q.replyToTerminate(false);`);
      const q = await s.quit();
      s.expectInstalled(false);
      return `still running after the drop; a new quit took ${q} ms`;
    },
  },
  {
    key: "cancelled-quit-then-deadline",
    what: "A quit cancelled while it waits for the drop stays cancelled when the wait's deadline passes",
    async run(s) {
      await s.launch();
      await s.untilStaged();
      await s.untilIdle();
      const stopped = s.stopInstaller();
      try {
        await s.eval(`U.setUpdateChannel("stable"); return true;`);
        s.sendQuit();
        await sleep(1500);
        check(isAlive(s.app.pid), "quit didn't wait for the drop");
        await s.eval(`return Q.replyToTerminate(false);`);
        await sleep(10000);
        check(isAlive(s.app.pid), "the cancelled quit went through at the deadline");
      } finally {
        s.resume(stopped);
      }
      const q = await s.quit(QUIT_HOLD_LIMIT);
      s.expectInstalled(false);
      return `still running past the deadline; a new quit took ${q} ms`;
    },
  },
];

if (flags.list) {
  for (const def of scenarios) console.log(`${def.key.padEnd(28)} ${def.what}${def.broken ? `  [known broken: ${def.broken}]` : ""}`);
  process.exit(0);
}
const installedArg = positional[0];
check(installedArg, "usage: channel-switch-test.mjs <installed app> [--candidate APP] …");
const installedApp = realpathSync(resolve(installedArg));
const candidateApp = realpathSync(resolve(flags.candidate ?? installedApp));
for (const app of [installedApp, candidateApp])
  if (/^\/Applications\//.test(app)) throw new Error(`never an installed app: ${app}`);
const scratchRoot = resolve(flags.scratch ?? join(home, "ardia-scratch/channel-switch-test"));
mkdirSync(scratchRoot, { recursive: true });
const scratch = realpathSync(scratchRoot);
for (const banned of ["/Applications", join(home, "Library"), join(home, "Documents"), "/tmp", "/private"])
  if (scratch === banned || scratch.startsWith(`${banned}/`)) throw new Error(`scratch can't live in ${banned}: ${scratch}`);
if (!scratch.startsWith(`${home}/`)) throw new Error(`scratch must be under ${home}: ${scratch}`);
const only = flags.only ? new Set(flags.only.split(",")) : null;
const chosen = scenarios.filter((d) => !only || only.has(d.key));
check(chosen.length, `no scenario matches --only ${flags.only}`);

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const runDir = join(scratch, `run-${run}`);
const tools = join(runDir, "tools");
mkdirSync(tools, { recursive: true });
const publicKey = harness('test_signing_key "$1"', tools);
const identity = harness("signing_identity");
for (const tool of ["ax", "child-stop"]) {
  sh("swiftc", ["-O", join(here, `${tool}.swift`), "-o", join(tools, tool)]);
  check(existsSync(join(tools, tool)), `couldn't build ${tool}.swift`);
}
const installedBuild = Number(info(installedApp, "CFBundleVersion"));
const candidateBuild = installedBuild + 1;
const embeddedJs = existsSync(join(installedApp, "Contents/Resources/main.jsbundle"));
const idPattern = new RegExp(`^com\\.ardia\\.browser\\.switchtest\\.${run}\\.\\d+$`);

const feedRoot = join(runDir, "feeds");
mkdirSync(feedRoot, { recursive: true });
const server = spawn("python3", ["-I", "-c", `
import http.server, json, os, sys, time
root = sys.argv[1]
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) != 2 or '..' in parts: return self.send_error(404)
        folder = os.path.join(root, parts[0])
        try: control = json.load(open(os.path.join(folder, 'control.json')))
        except Exception: return self.send_error(404)
        log = open(os.path.join(folder, 'served.log'), 'a', buffering=1)
        def note(**kw): log.write(json.dumps(dict(t=time.time(), path=parts[1], **kw)) + '\\n')
        if parts[1] == 'appcast.xml':
            time.sleep(control.get('feedDelay', 0))
            body = open(os.path.join(folder, control.get('feed', 'full') + '.xml'), 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'application/xml'); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body); return note(bytes=len(body), done=True)
        if parts[1] != 'Ardia.zip': return self.send_error(404)
        path = os.path.join(folder, 'Ardia.zip'); size = os.path.getsize(path); rate = control.get('rate', 0)
        self.send_response(200); self.send_header('Content-Type', 'application/zip'); self.send_header('Content-Length', str(size)); self.end_headers()
        sent, mark, began = 0, 0, time.time()
        note(bytes=0, done=False)
        try:
            with open(path, 'rb') as f:
                for chunk in iter(lambda: f.read(65536), b''):
                    self.wfile.write(chunk); sent += len(chunk)
                    if sent - mark >= 1 << 20: mark = sent; note(bytes=sent, done=False)
                    if rate:
                        ahead = sent / rate - (time.time() - began)
                        if ahead > 0: time.sleep(ahead)
        except (BrokenPipeError, ConnectionResetError):
            return note(bytes=sent, done=False, aborted=True)
        note(bytes=sent, done=True)
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(server.server_port, flush=True)
server.serve_forever()
`, feedRoot], { stdio: ["ignore", "pipe", "inherit"] });
const port = await new Promise((done, fail) => {
  server.stdout.once("data", (d) => done(Number(String(d).trim())));
  server.once("exit", () => fail(new Error("the feed server didn't start")));
});

const appcast = (url, size, signature) => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
<channel><title>switch test</title>
<item><title>Nightly</title><pubDate>${new Date().toUTCString()}</pubDate>
<sparkle:version>${candidateBuild}</sparkle:version><sparkle:shortVersionString>9.9.9-nightly.${candidateBuild}</sparkle:shortVersionString>
<sparkle:channel>nightly</sparkle:channel><sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
<enclosure url="${url}" length="${size}" type="application/octet-stream" sparkle:edSignature="${signature}"/>
</item></channel></rss>
`;
const emptyAppcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>switch test</title></channel></rss>
`;
const skipDefaults = { SUSkippedVersion: "7", SUSkippedMajorVersion: "0.1.0", SUSkippedMajorSubreleaseVersion: "0.1.1" };
const plistFile = (values) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${Object.entries(values).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join("\n")}
</dict></plist>
`;

class Scenario {
  constructor(def, n) {
    this.def = def;
    this.id = `com.ardia.browser.switchtest.${run}.${n}`;
    this.dir = join(runDir, `${n}-${def.key}`);
    this.data = join(this.dir, "data");
    this.copy = join(this.dir, "installed/Ardia.app");
    this.candidate = join(this.dir, "candidate/Ardia.app");
    this.feedDir = join(feedRoot, String(n));
    this.feedUrl = `http://127.0.0.1:${port}/${n}/appcast.xml`;
    this.prefs = join(this.data, "Preferences", this.id);
    this.caches = join(home, "Library/Caches", this.id);
    this.installation = join(this.caches, "org.sparkle-project.Sparkle/Installation");
    this.labels = [`${this.id}-sparkle-updater`, `${this.id}-sparkle-progress`];
    this.presetSkips = skipDefaults;
  }

  tag(app, { build, channel, automaticDownloads }) {
    const file = join(app, "Contents/Info.plist");
    const put = (key, type, value) => {
      if (info(app, key) !== null) plist(file, `Delete :${key}`);
      if (value !== null) plist(file, `Add :${key} ${type} ${value}`);
    };
    plist(file, `Set :CFBundleIdentifier ${this.id}`);
    put("SUPublicEDKey", "string", publicKey);
    put("SUFeedURL", "string", this.feedUrl);
    put("SUEnableAutomaticChecks", "bool", "true");
    put("SUAutomaticallyUpdate", "bool", String(automaticDownloads));
    put("ACUpdateChannel", "string", channel === "nightly" ? "nightly" : null);
    put("LSEnvironment", "dict", "");
    plist(file, `Add :LSEnvironment:ARDIA_DATA_DIR string ${this.data}`, "Add :LSEnvironment:ARDIA_BACKGROUND string 1",
      `Add :LSEnvironment:ARDIA_INSTANCE string updateFeed=${this.feedUrl}`);
    if (build !== undefined) plist(file, `Set :CFBundleVersion ${build}`, `Set :CFBundleShortVersionString 9.9.9-nightly.${build}`);
    const signed = sh("codesign", ["--force", "--deep", "--timestamp=none", "--sign", identity, app]);
    check(signed.status === 0, `couldn't sign ${app}: ${signed.stderr}`);
  }

  async prepare() {
    const start = { channel: "nightly", automaticDownloads: true, ...this.def.start };
    mkdirSync(dirname(this.copy), { recursive: true });
    mkdirSync(dirname(this.candidate), { recursive: true });
    mkdirSync(join(this.data, "Preferences"), { recursive: true });
    mkdirSync(this.feedDir, { recursive: true });
    execFileSync("cp", ["-cR", installedApp, this.copy]);
    execFileSync("cp", ["-cR", candidateApp, this.candidate]);
    this.tag(this.copy, start);
    this.tag(this.candidate, { ...start, build: candidateBuild, channel: "nightly" });
    const zip = join(this.feedDir, "Ardia.zip");
    execFileSync("ditto", ["-c", "-k", "--keepParent", this.candidate, zip]);
    const size = statSync(zip).size;
    const signature = execFileSync(join(tools, "ed25519"), ["sign", zip, join(tools, "key")], { encoding: "utf8" }).trim();
    writeFileSync(join(this.feedDir, "full.xml"), appcast(`http://127.0.0.1:${port}/${basename(this.feedDir)}/Ardia.zip`, size, signature));
    writeFileSync(join(this.feedDir, "empty.xml"), emptyAppcast);
    const control = { feed: "full", ...this.def.control };
    if (control.throttled) control.rate = Math.round(size / (control.throttled === true ? THROTTLED_SECONDS : control.throttled));
    delete control.throttled;
    writeFileSync(join(this.feedDir, "control.json"), JSON.stringify(control));
    const defaultsFile = join(this.dir, "defaults.plist");
    writeFileSync(defaultsFile, plistFile(skipDefaults));
    const imported = sh("defaults", ["import", this.prefs, defaultsFile]);
    check(imported.status === 0, `couldn't import the scratch defaults: ${imported.stderr}`);
    writeFileSync(join(this.data, "perf-probe"), "");
    if (start.abandoned) mkdirSync(join(this.installation, "abandoned/Ardia.app/Contents"), { recursive: true });
    if (start.stale) {
      const folder = join(this.installation, "stale-copy");
      mkdirSync(folder, { recursive: true });
      execFileSync("cp", ["-cR", this.candidate, join(folder, "Ardia.app")]);
    }
  }

  assertIsolated() {
    const inRun = (p) => realpathSync(p).startsWith(`${runDir}/`);
    check(inRun(this.copy) && inRun(this.candidate) && inRun(this.data), "a copy or data dir resolves outside the run's scratch dir");
    check(idPattern.test(this.id), `bundle id ${this.id} isn't this run's`);
    for (const app of [this.copy, this.candidate]) {
      check(info(app, "CFBundleIdentifier") === this.id, `${app} isn't tagged ${this.id}`);
      check(info(app, "SUPublicEDKey") === publicKey, `${app} doesn't carry the run's test key`);
      check(info(app, "SUFeedURL") === this.feedUrl, `${app}'s feed isn't the local one`);
      check(info(app, "LSEnvironment:ARDIA_DATA_DIR") === this.data && info(app, "LSEnvironment:ARDIA_BACKGROUND") === "1",
        `${app} would relaunch outside its scratch dir`);
      check(sh("codesign", ["--verify", "--deep", "--strict", app]).status === 0, `${app} isn't sealed after tagging`);
    }
    check(/^http:\/\/127\.0\.0\.1:\d+\//.test(this.feedUrl), "the feed isn't local");
    check(existsSync(`${this.prefs}.plist`), "the scratch defaults aren't in place");
    check(this.caches.startsWith(join(home, "Library/Caches/com.ardia.browser.switchtest.")), "Sparkle's cache dir isn't the test id's");
  }

  async launch() {
    this.assertIsolated();
    const instance = { updateFeed: this.feedUrl };
    const variables = launchVariables({ instance }).ARDIA_INSTANCE ?? "";
    check(variables.split(",").includes(`updateFeed=${this.feedUrl}`), `the launch feed override is missing (ARDIA_INSTANCE=${variables})`);
    this.app = await launch(this.copy, { data: this.data, js: embeddedJs ? "none" : "pinned", onboarded: true, instance, startTimeout: 90000 });
    const u = await this.state();
    check(u.feedURL === this.feedUrl, `the updater's feed is ${u.feedURL}`);
  }

  eval(body, timeout = 20000) {
    const prelude = `const mods = globalThis.expo.modules; const by = (f) => mods[Object.keys(mods).find((k) => mods[k] && typeof mods[k][f] === "function")]; const U = by("setUpdateChannel"); const Q = by("replyToTerminate");\n`;
    return this.app.eval(prelude + body, { timeout });
  }
  state() { return this.eval(`return U.updaterState();`); }
  async switchTo(channel) {
    const now = await this.eval(`return U.setUpdateChannel(${JSON.stringify(channel)}).then(() => U.updaterState()).then((u) => u.channel);`);
    check(now === channel, `the switch to ${channel} didn't take (the updater says ${now})`);
  }

  staged() {
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 4) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const path = join(dir, e.name);
        if (e.name.endsWith(".app")) found.push({ path, build: Number(info(path, "CFBundleVersion")), channel: info(path, "ACUpdateChannel") });
        else walk(path, depth + 1);
      }
    };
    walk(this.installation, 0);
    return found;
  }
  offChannelCopies() { return this.staged().filter((c) => c.build === candidateBuild); }
  async untilStaged(ms = 120000, { idle = true } = {}) {
    const began = Date.now();
    await until(() => this.offChannelCopies().length && this.installerPids().length, ms, "the nightly was never staged");
    if (idle) await this.untilIdle();
    check(this.offChannelCopies().length && this.installerPids().length, "the staged nightly went away by itself");
    return Date.now() - began;
  }
  async untilGone(ms) {
    const began = Date.now();
    await until(() => !this.offChannelCopies().length, ms, "the staged nightly stayed");
    return Date.now() - began;
  }
  async untilIdle(ms = 30000) {
    let quiet = 0;
    await until(async () => ((await this.state()).sessionInProgress ? (quiet = 0) : ++quiet) >= 3, ms, "Sparkle never went idle", 300);
  }
  async untilSettledWithoutCopy(ms) {
    let quiet = 0;
    await until(async () => ((await this.state()).sessionInProgress || this.offChannelCopies().length ? (quiet = 0) : ++quiet) >= 6, ms,
      "a nightly stayed staged, or Sparkle stayed busy", 500);
  }

  served() {
    try {
      return readFileSync(join(this.feedDir, "served.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  async untilServed(bytes) {
    await until(() => this.served().some((e) => e.path === "Ardia.zip" && e.bytes >= bytes), 120000, "the download never started");
  }
  zipEnded() { return this.served().some((e) => e.path === "Ardia.zip" && (e.done || e.aborted)); }

  ax(...args) { return sh(join(tools, "ax"), [String(this.app.pid), ...args], { timeout: 15000 }); }
  hasButton(title) {
    const out = this.ax("windows");
    check(out.status !== 3, "this terminal isn't trusted for Accessibility");
    try { return JSON.parse(out.stdout).some((w) => w.buttons.includes(title)); } catch { return false; }
  }
  async untilButton(title, ms = 60000) { await until(() => this.hasButton(title), ms, `Sparkle never showed "${title}"`, 500); }
  press(title) {
    const out = this.ax("press", title);
    check(out.status === 0, `couldn't press "${title}": ${out.stderr.trim()}`);
  }

  processes() {
    return sh("ps", ["-axo", "pid=,command="]).stdout.split("\n").map((l) => l.trim().match(/^(\d+) (.*)$/)).filter(Boolean)
      .map(([, pid, command]) => ({ pid: Number(pid), command }));
  }
  stopChild(prefix, seconds) {
    return new Promise((done) => {
      const watcher = spawn(join(tools, "child-stop"), [String(this.app.pid), prefix, String(seconds)], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      watcher.stdout.on("data", (d) => (out += d));
      watcher.on("exit", (code) => done(code === 0 ? Number(out.trim()) : null));
    });
  }
  installerPids() {
    return this.labels.flatMap((label) => {
      const out = sh("launchctl", ["print", `gui/${uid}/${label}`]).stdout ?? "";
      const pid = out.match(/^\s*pid = (\d+)/m);
      return pid ? [Number(pid[1])] : [];
    });
  }
  stopInstaller() {
    const pids = this.installerPids();
    check(pids.length, "no Sparkle installer process to stop");
    for (const pid of pids) process.kill(pid, "SIGSTOP");
    this.stopped = pids;
    return pids;
  }
  resume(pids) {
    for (const pid of pids) try { process.kill(pid, "SIGCONT"); } catch {}
    this.stopped = [];
  }
  async untilInstallerGone(ms = 120000) {
    await until(() => this.labels.every((l) => sh("launchctl", ["print", `gui/${uid}/${l}`]).status !== 0), ms, "Sparkle's installer never exited");
  }

  sendQuit() {
    const sent = sh("osascript", ["-l", "JavaScript", "-e",
      `ObjC.import("AppKit"); const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${this.app.pid}); a.isNil() ? "none" : a.terminate`], { timeout: 10000 });
    check(sent.status === 0, `couldn't send quit: ${sent.stderr}`);
  }
  async quit(limit = 30000, { settle = true } = {}) {
    const marker = new Date();
    const began = Date.now();
    this.sendQuit();
    await until(() => !isAlive(this.app.pid), Math.max(limit, 30000), "the app didn't quit on its own", 25);
    const ms = Date.now() - began;
    check(ms <= limit, `quit took ${ms} ms (limit ${limit})`);
    const reports = [join(home, "Library/Logs/DiagnosticReports"), join(home, "Library/Logs/DiagnosticReports/Retired")].flatMap((d) => {
      try { return readdirSync(d).filter((f) => f.endsWith(".ips")).map((f) => join(d, f)); } catch { return []; }
    }).filter((f) => statSync(f).mtime >= marker && readFileSync(f, "utf8").includes(`"pid" : ${this.app.pid},`));
    check(!reports.length, `the app crashed on quit: ${reports[0]}`);
    if (settle) await this.untilInstallerGone();
    return ms;
  }
  expectUntouched() {
    check(this.def.start?.stale ? existsSync(join(this.installation, "stale-copy/Ardia.app/Contents/Info.plist")) : this.offChannelCopies().length,
      "Ardia moved or deleted a staged copy");
    check(!existsSync(join(this.caches, "ArdiaDiscardedUpdates")), "Ardia set staged copies aside");
  }
    expectInstalled(expected) {
    const build = Number(info(this.copy, "CFBundleVersion"));
    check(build === (expected ? candidateBuild : installedBuild), expected ? `the nightly didn't install (still ${build})` : `the nightly installed (now ${build})`);
  }
  skipKeys() {
    return Object.fromEntries(Object.keys(skipDefaults).map((k) => {
      const out = sh("defaults", ["read", this.prefs, k]);
      return [k, out.status === 0 ? out.stdout.trim() : null];
    }));
  }

  async teardown() {
    if (this.stopped?.length) this.resume(this.stopped);
    if (this.app && isAlive(this.app.pid)) await this.app.quit({ timeout: 15000 });
    const proxy = this.app?.js?.mode === "pinned" ? this.app.js.pid : null;
    if (proxy && (processInfo(proxy)?.command ?? "").includes(`--metro-proxy ${this.data} `)) process.kill(proxy);
    for (const label of this.labels) sh("launchctl", ["bootout", `gui/${uid}/${label}`]);
    const ours = this.processes().filter((p) => [`${this.dir}/`, `${this.caches}/`].some((prefix) => p.command.startsWith(prefix)));
    for (const p of ours) try { process.kill(p.pid, "SIGKILL"); } catch {}
    const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    for (const app of [this.copy, this.candidate, ...this.staged().map((c) => c.path)]) if (existsSync(app)) sh(lsregister, ["-u", app]);
    sh("defaults", ["delete", this.id]);
    for (const leftover of [this.caches, join(home, "Library/HTTPStorages", this.id), join(home, "Library/HTTPStorages", `${this.id}.binarycookies`),
      join(home, "Library/Saved Application State", `${this.id}.savedState`), join(home, "Library/Preferences", `${this.id}.plist`), join(home, "Library/WebKit", this.id)])
      if (leftover.includes(`switchtest.${run}.`)) rmSync(leftover, { recursive: true, force: true });
  }
}

const results = [];
const log = join(runDir, "results.log");
async function runScenario(def, n) {
  const s = new Scenario(def, n);
  const began = Date.now();
  let outcome, detail;
  try {
    await s.prepare();
    detail = await def.run(s);
    outcome = def.broken ? "UNEXPECTED PASS" : "PASS";
  } catch (e) {
    detail = e instanceof Failure ? e.message : e.stack ?? String(e);
    outcome = def.broken ? "KNOWN" : "FAIL";
  } finally {
    try { await s.teardown(); } catch (e) { detail += `; teardown: ${e.message}`; }
  }
  const line = `${outcome.padEnd(15)} ${def.key}: ${def.what}  (${detail}; ${Math.round((Date.now() - began) / 1000)} s)${def.broken ? ` [known broken: ${def.broken}]` : ""}`;
  console.log(line);
  appendFileSync(log, `${line}\n`);
  results.push({ outcome, def, dir: s.dir });
  if (outcome === "PASS" && !flags.keep) rmSync(s.dir, { recursive: true, force: true });
}

try {
  const numbered = chosen.map((def) => [def, scenarios.indexOf(def) + 1]);
  const pool = numbered.filter(([d]) => !d.alone);
  const jobs = Math.max(1, Number(flags.jobs ?? 3));
  await Promise.all(Array.from({ length: Math.min(jobs, pool.length) }, async () => {
    for (let next; (next = pool.shift()); ) await runScenario(...next);
  }));
  for (const next of numbered.filter(([d]) => d.alone)) await runScenario(...next);
} finally {
  server.kill();
}
const failed = results.filter((r) => r.outcome === "FAIL" || r.outcome === "UNEXPECTED PASS");
console.log(`${results.length - failed.length}/${results.length} as expected (${results.filter((r) => r.outcome === "KNOWN").length} known broken); log ${log}`);
if (!failed.length && !flags.keep) rmSync(runDir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
