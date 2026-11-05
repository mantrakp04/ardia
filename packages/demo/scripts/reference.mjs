#!/usr/bin/env node
// Captures the real Ardia app in the demo's seeded state, for compare.mjs.
//
//   node packages/demo/scripts/reference.mjs [--app <Debug Ardia.app>] [--out DIR] [--themes light,dark]
//                                        [--states idle,command,ntp,hover,menu,profile,field] [--favicons] [--keep]
//                                        [--data DIR]
//
// The app runs hidden from a clone in the scratch dir (cp -c of the train's or the newest Debug build), on the
// shared Metro, with the session seed.ts gives the demo. Each state is captured at 2x with `screencapture -l`
// (20 s timeout), falling back to ac.shell.devSnapshotWindow; Metal views are also written by
// ArdiaAreaLight.debugSnapshot. --favicons writes the favicons the app shows into packages/demo/public/favicons.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "../../../scripts/lib/instance.mjs";
import { COMMAND_QUERY, DEMO_WINDOW, fieldScript, HOVER_ROW, newTabScript, profileScript, realLayoutScript, resetScript, STATES, THEMES } from "./states.mjs";
import { referenceSession } from "./seedSession.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const scratch = realpathSync("/tmp") + "/ardia-demo-layout";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(option("out", `${scratch}/ref`));
const themes = option("themes", THEMES.join(",")).split(",");
const states = option("states", STATES.join(",")).split(",");

function trainServes() {
  try {
    const pid = Number(readFileSync("/tmp/ac-train/serve.pid", "utf8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function trainApp() {
  const train = join(repo, "scripts/agent/train");
  execFileSync(train, ["request", "--as", "demo-layout", "--note", "demo reference captures"], { stdio: "inherit" });
  const done = spawnSync(train, ["wait", "--as", "demo-layout", "--timeout", "3000"], { encoding: "utf8" });
  const app = done.stdout.match(/^ok (\S+\.app)/m)?.[1];
  if (!app) throw new Error(`the train build failed: ${done.stdout}${done.stderr}`);
  return app;
}

function debugApps() {
  if (trainServes()) return [trainApp()];
  const builds = join(repo, "apps/browser");
  const out = join(builds, "build-train/out");
  const candidates = readdirSync(builds)
    .filter((d) => d.startsWith("build-"))
    .map((d) => join(builds, d, "Build/Products/Debug/Ardia.app"))
    .concat(existsSync(out) ? readdirSync(out).filter((d) => d.endsWith("-Debug")).map((d) => join(out, d, "Ardia.app")) : [])
    .filter((app) => existsSync(join(app, "Contents/MacOS/Ardia")))
    .sort((a, b) => statSync(join(b, "Contents/MacOS/Ardia")).mtimeMs - statSync(join(a, "Contents/MacOS/Ardia")).mtimeMs);
  if (!candidates.length) throw new Error("no Debug build under apps/browser/build-*");
  return candidates;
}

function cloneApp(source) {
  const target = `${scratch}/Ardia.app`;
  const stamp = `${scratch}/Ardia.app.source`;
  const sourceTime = String(statSync(join(source, "Contents/MacOS/Ardia")).mtimeMs);
  const current = existsSync(stamp) ? readFileSync(stamp, "utf8") : "";
  if (existsSync(target) && current === `${source}\n${sourceTime}`) return target;
  rmSync(target, { recursive: true, force: true });
  execFileSync("cp", ["-cR", source, target]);
  writeFileSync(stamp, `${source}\n${sourceTime}`);
  return target;
}

const appArg = option("app", null);
mkdirSync(out, { recursive: true });

const { seed, pages, ...session } = await referenceSession({ frame: [60, 60, DEMO_WINDOW.width, DEMO_WINDOW.height] });
const windowId = seed.WINDOW_ID;
const data = resolve(option("data", `${scratch}/data`));
const sources = appArg ? [resolve(appArg)] : debugApps();

async function start(theme) {
  for (const source of sources) {
    const app = appArg ? source : cloneApp(source);
    console.log(`launching ${source} (${theme})`);
    try {
      const themed = { ...session, settings: { appearance: theme } };
      const telemetry = { version: 1, sharing: false, decidedAt: 1, askDoneAt: 1, installId: null, crashCursor: 0, lastVersion: null, sessionOpen: false };
      return { app, instance: await launch(app, { data, fresh: true, session: themed, onboarded: true, files: { "telemetry.json": telemetry } }) };
    } catch (error) {
      const log = existsSync(`${data}/app.out.log`) ? readFileSync(`${data}/app.out.log`, "utf8") : "";
      if (!/Native API skew/.test(log) && !/Native API skew/.test(String(error))) throw error;
      console.log(`skipping ${source}: Native API skew`);
    }
  }
  throw new Error("every Debug build has a Native API skew");
}

const settle = (ms) => sleep(ms);
const SRGB = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";

function toSrgb(file) {
  const converted = spawnSync("sips", ["--matchTo", SRGB, file, "--out", file], { timeout: 20000 });
  if (converted.status !== 0) throw new Error(`couldn't convert ${file} to sRGB: ${converted.stderr}`);
  return true;
}
const ordered = [...states.filter((s) => s !== "profile"), ...states.filter((s) => s === "profile")];
const report = { window: DEMO_WINDOW, scale: 2, captures: [] };

for (const theme of themes) {
  const { app, instance } = await start(theme);
  report.app = app;
  const evaluate = (body, timeout = 20000) => instance.eval(body, { timeout });
  const capture = async (file) => {
    const [cgWindow] = instance.windows();
    if (cgWindow) {
      const shot = spawnSync("screencapture", ["-l", String(cgWindow), "-o", "-x", file], { timeout: 20000 });
      if (shot.status === 0 && existsSync(file) && statSync(file).size > 0) return toSrgb(file) && "screencapture";
    }
    const saved = await evaluate(`return ac.shell.devSnapshotWindow(${JSON.stringify(windowId)}, ${JSON.stringify(file)})`);
    return saved ? toSrgb(file) && "devSnapshotWindow" : "failed";
  };
  const reset = async () => {
    await evaluate(resetScript("ac.store", seed.seedTabs()));
    await evaluate(`return ac.shell.devSetPointer(${JSON.stringify(windowId)}, null);`);
    for (let i = 0; i < 100 && (await evaluate(`return Object.values(ac.store.getState().live).some((l) => l.isLoading)`)); i++) await settle(100);
    await evaluate(resetScript("ac.store", seed.seedTabs()));
  };
  const setups = {
    idle: () => reset(),
    command: async () => {
      await reset();
      await evaluate(`ac.runCommand({ command: "focusCommandBar", arg: null, windowId: ${JSON.stringify(windowId)} }); return true;`);
      await settle(400);
      await evaluate(`const id = ac.omnibox.ids().find((i) => i.startsWith(${JSON.stringify(windowId)})); const d = ac.omnibox.get(id); d.clear(); d.type(${JSON.stringify(COMMAND_QUERY)}); return id;`);
    },
    ntp: async () => {
      await reset();
      await evaluate(newTabScript("ac.store"));
    },
    hover: async () => {
      await reset();
      await settle(300);
      await evaluate(`return ac.shell.devSetPointer(${JSON.stringify(windowId)}, ${JSON.stringify(HOVER_ROW)})`);
    },
    menu: async () => {
      await reset();
      return "background instances log menus instead of showing them";
    },
    profile: async () => {
      await reset();
      await evaluate(profileScript("ac.store"));
    },
    field: async () => {
      await reset();
      await evaluate(fieldScript("ac.store"));
    },
  };
  try {
    for (let i = 0; i < 100 && !(await evaluate(`const s = ac.store.getState(); return !s.live.t_browser?.isLoading && !!s.tabs.t_browser`)); i++) await settle(100);
    await settle(2500);
    if (theme === themes[0] && flag("favicons")) report.favicons = await harvestFavicons(evaluate);
    mkdirSync(join(out, theme), { recursive: true });
    for (const state of ordered) {
      const note = await setups[state]();
      await settle(state === "profile" ? 1800 : 900);
      const file = join(out, theme, `${state}.png`);
      const how = typeof note === "string" ? "unavailable" : await capture(file);
      if (how === "unavailable") rmSync(file, { force: true });
      else writeFileSync(file.replace(/\.png$/, ".layout.json"), JSON.stringify(await evaluate(realLayoutScript, 30000)));
      report.captures.push({ theme, state, file, how, ...(typeof note === "string" ? { note } : {}) });
      console.log(`${theme} ${state}: ${how}`);
      if (state === "idle") {
        report[`metal-${theme}`] = await evaluate(`return globalThis.expo.modules.ArdiaAreaLight.debugSnapshot(${JSON.stringify(join(out, theme, "metal"))})`).catch((e) => String(e));
        for (const shot of Array.isArray(report[`metal-${theme}`]) ? report[`metal-${theme}`] : []) if (shot.ok) toSrgb(shot.file);
      }
    }
    if (flag("pages")) report[`pages-${theme}`] = await pageColors(evaluate);
  } finally {
    if (!flag("keep")) await instance.quit();
  }
}
writeFileSync(join(out, "reference.json"), JSON.stringify(report, null, 2));

async function pageColors(evaluate) {
  const pages = {};
  for (const tab of seed.seedTabs()) {
    await evaluate(`ac.store.getState().activate(${JSON.stringify(tab.id)}); return true;`);
    for (let i = 0; i < 120; i++) {
      await settle(100);
      if (await evaluate(`const l = ac.store.getState().live[${JSON.stringify(tab.id)}]; return !!l && !l.isLoading`)) break;
    }
    await settle(800);
    pages[tab.url] = await evaluate(`const s = ac.store.getState(); const p = ac.pageState.getState().pages?.[${JSON.stringify(tab.id)}] ?? null; return { live: s.live[${JSON.stringify(tab.id)}], title: s.tabs[${JSON.stringify(tab.id)}].title, url: s.tabs[${JSON.stringify(tab.id)}].url, themeColorSource: p?.themeColorSource ?? null, security: p?.security?.level ?? null }`);
  }
  await evaluate(`ac.store.getState().activate("t_browser"); return true;`);
  return pages;
}

async function harvestFavicons(evaluate) {
  const target = join(repo, "packages/demo/public/favicons");
  const found = await evaluate(`
    const tabs = Object.values(ac.store.getState().tabs);
    return Promise.all(tabs.map((t) => Promise.resolve(ac.favicons.resolveFavicon(t.url, t.favicon, t.profileId)).then((r) => [t.url, r ? r.uri : null])));
  `);
  const written = [];
  for (const [url, uri] of found) {
    if (!uri?.startsWith("data:image/png;base64,")) continue;
    const host = new URL(url).hostname;
    if (host === "html.spec.whatwg.org") continue;
    writeFileSync(join(target, `${host}.png`), Buffer.from(uri.slice(22), "base64"));
    written.push(host);
  }
  return written;
}
