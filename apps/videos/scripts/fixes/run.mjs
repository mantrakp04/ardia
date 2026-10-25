import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.env.ARDIA_REPO ?? join(process.env.HOME, "Documents/netnyahoo");
const { appEnv, attach, binaryOf, binaryPids, launch, processInfo, sleep } = await import(join(repo, "scripts/lib/instance.mjs"));

const scratch = process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes");
const footage = join(scratch, "footage");
const recorder = join(scratch, "demo-rec");
const sitesPort = 47231;
const apps = {
  before: { app: process.env.BEFORE_APP ?? join(scratch, "before/Ardia.app"), js: "none", probe: true },
  after: { app: process.env.AFTER_APP ?? join(repo, "apps/browser/build-tester/Build/Products/Debug/Ardia.app") },
};

const args = process.argv.slice(2);
const sides = args.includes("--side") ? [args[args.indexOf("--side") + 1]] : ["before", "after"];
const names = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--side");
const prelude = readFileSync(join(here, "prelude.js"), "utf8");

if (!existsSync(recorder)) {
  const built = spawnSync("swiftc", ["-O", "-o", recorder, join(repo, "apps/browser/scripts/demo-rec.swift")], { stdio: "inherit" });
  if (built.status !== 0) throw new Error("demo-rec didn't build");
}

async function launchWithoutDevTools(app, { data, js, probe, onboarded, files = {}, session, switches = [], env = {} }) {
  mkdirSync(data, { recursive: true });
  if (session) writeFileSync(join(data, "session.json"), JSON.stringify(session));
  if (onboarded) writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  if (probe) writeFileSync(join(data, "perf-probe"), "");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(data, name), JSON.stringify(text));
  const binary = binaryOf(app);
  const log = join(data, "app.out.log");
  const vars = appEnv(app, {
    ARDIA_BACKGROUND: "1", ARDIA_DATA_DIR: data, ARDIA_CHROMIUM_SWITCHES: switches.join(" "),
    ...(js === "none" ? {} : { ARDIA_JS_LOCATION: "localhost:8081" }), ...env,
  });
  const before = binaryPids(binary);
  execFileSync("open", ["-g", "-n", ...Object.entries(vars).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "--stdout", log, "--stderr", log, app]);
  let pid = null;
  for (const end = Date.now() + 60000; !pid && Date.now() < end; await sleep(200)) pid = [...binaryPids(binary)].find((p) => !before.has(p)) ?? null;
  if (!pid) throw new Error(`${app} didn't start`);
  writeFileSync(join(data, "instance.json"), JSON.stringify({ app, binary, data, log, pid, started: processInfo(pid).started, js: { mode: js ?? "live" }, meta: {} }));
  const instance = attach(data);
  await instance.ready();
  return instance;
}

function record(pid, out) {
  const child = spawn(recorder, [String(pid), "90", out], { stdio: ["ignore", "pipe", "inherit"] });
  let text = "";
  const started = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      text += d;
      const m = /recording (\d+)/.exec(text);
      if (m && /rect /.test(text)) resolve(Number(m[1]));
    });
    child.on("exit", (code) => reject(new Error(`demo-rec exited (${code}): ${text}`)));
    setTimeout(() => reject(new Error(`demo-rec didn't start: ${text}`)), 15000);
  });
  const finished = new Promise((resolve) => child.on("exit", resolve));
  return { started, stop: () => (child.kill("SIGINT"), finished) };
}

async function shoot(scene, name, side) {
  const data = join(scratch, "runs", `${name}-${side}`);
  rmSync(data, { recursive: true, force: true });
  const sessionFile = join(scratch, scene.session ?? "session.json");
  const downloads = join(scratch, "downloads", `${name}-${side}`);
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  const { app, js, probe } = apps[side];
  const empty = join(scratch, "import-empty");
  mkdirSync(empty, { recursive: true });
  const options = {
    data, js, probe, onboarded: true, files: { "telemetry.json": { sharing: false, decidedAt: 1, askDoneAt: 1 } }, session: JSON.parse(readFileSync(sessionFile, "utf8")),
    switches: [`--host-resolver-rules=MAP *.example 127.0.0.1:${sitesPort}`],
    env: { ARDIA_IMPORT_SOURCE_DIR: empty, ARDIA_IMPORT_SAFARI_HOME: empty, ARDIA_DOWNLOADS_DIR: downloads, ...(scene.env ?? {}) },
  };
  const start = scene.withoutDevTools ? launchWithoutDevTools : launch;
  let instance = await start(app, options);
  try {
    await sleep(scene.boot ?? 6000);
    let setup = await instance.eval(`${prelude}\n${scene.setup ?? "return done();"}`, { timeout: 60000 });
    await sleep(scene.settle ?? 2500);
    if (scene.relaunch) {
      const beforeQuit = JSON.parse(await instance.eval(`${prelude}\n${scene.relaunch}`, { timeout: 60000 }));
      const quit = await instance.quit();
      const { session, onboarded, files, ...again } = options;
      instance = await start(app, again);
      await sleep(scene.boot ?? 6000);
      setup = JSON.stringify({ setup: JSON.parse(setup), beforeQuit, quit });
    }
    const prepared = scene.prepare ? await scene.prepare(instance, side) : null;
    mkdirSync(join(footage, side), { recursive: true });
    const out = join(footage, side, `${name}.mov`);
    const rec = record(instance.pid, out);
    const t0 = await rec.started;
    await sleep(700);
    const external = scene.external ? scene.external(instance, side) : null;
    const result = JSON.parse(await instance.eval(`${prelude}\nconst P = ${JSON.stringify(prepared)};\nconst SIDE = ${JSON.stringify(side)};\n${scene.act}`, { timeout: 60000 }));
    const externalEvents = (await external) ?? [];
    await sleep(scene.tail ?? 900);
    await rec.stop();
    const events = [...result.events, ...(Array.isArray(externalEvents) ? externalEvents : [])].sort((a, b) => a.t - b.t).map((e) => ({ ...e, t: Math.round(e.t - t0) / 1000 }));
    writeFileSync(join(footage, side, `${name}.json`), JSON.stringify({ ...result, events, setup: JSON.parse(setup), prepared }, null, 1));
    console.log(`${name} ${side}: ${out}, ${events.length} events, marks ${events.filter((e) => e.mark).map((e) => `${e.mark}@${e.t}`).join(" ")}`);
  } finally {
    await instance.quit();
  }
}

for (const name of names) {
  const scene = (await import(join(here, "scenes", `${name}.mjs`))).default;
  const results = await Promise.allSettled(sides.map((side) => shoot(scene, name, side)));
  for (const r of results) if (r.status === "rejected") console.error(`${name}: ${r.reason?.stack ?? r.reason}`);
}
process.exit(0);
