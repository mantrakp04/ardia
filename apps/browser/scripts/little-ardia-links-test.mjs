import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node little-ardia-links-test.mjs <Debug Ardia.app> [--only=<name,name>]");
  console.error("Sends real GURL Apple Events to a hidden instance's pid (warm) and launches it with a link (cold), with Settings › General › Open links from other apps in Little Ardia off and on, and checks where each link opens.");
  process.exit(2);
}
const app = resolve(appArg);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const root = mkdtempSync(join(tmpdir(), "little-links-"));
const gurl = join(root, "gurl");
execFileSync("swiftc", ["-O", resolve(import.meta.dirname, "../../../.claude/skills/release/scripts/gurl.swift"), "-o", gurl]);
const failures = [];

const state = (inst) =>
  inst.eval(`const s = ac.store.getState();
    const ws = s.windowOrder.map((id) => s.windows[id]).filter(Boolean);
    return { small: ws.filter((w) => w.kind === "small").map((w) => w.tabIds.map((t) => s.tabs[t]?.url ?? "")).flat(),
      main: ws.filter((w) => w.kind !== "small").map((w) => w.tabIds.map((t) => s.tabs[t]?.url ?? "")).flat() };`);

const outcome = (st, url) => (st.small.some((u) => u.startsWith(url)) ? "little" : st.main.some((u) => u.startsWith(url)) ? "tab" : "nothing");

async function settle(inst, url, ms) {
  let st;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    st = await state(inst);
    if (outcome(st, url) !== "nothing") break;
  }
  await sleep(800);
  return outcome(await state(inst), url);
}

function dataDir(name, setting, extra = {}) {
  const data = join(root, name, "data");
  mkdirSync(data, { recursive: true });
  const settings = setting === undefined ? {} : { openLinksInLittleArdia: setting };
  writeFileSync(join(data, "session.json"), JSON.stringify(session({
    profiles: extra.profiles ?? ["Personal"],
    windows: extra.windows ?? [{}],
    tabs: extra.tabs ?? [{ id: "t1", url: "about:blank" }],
    settings,
    settingsMeta: { chosen: Object.keys(settings), inferred: [] },
  })));
  writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  return data;
}

function record(name, got, want) {
  const ok = got === want;
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
}

const wanted = (name) => !only || only.includes(name);
const linkFor = (name) => `https://example.com/?little-links=${name}`;

async function warm(name, setting, prep, opts = {}) {
  if (!wanted(name)) return;
  const inst = await launch(app, { data: dataDir(name, opts.startWith ?? setting, opts), js: "live" });
  try {
    await sleep(1500);
    if (prep) await prep(inst);
    await sleep(500);
    const url = opts.url ?? linkFor(name);
    execFileSync(gurl, [String(inst.pid), url], { timeout: 15000 });
    record(name, await settle(inst, url, 8000), setting ? "little" : "tab");
  } finally {
    await inst.quit();
  }
}

async function cold(name, setting, relaunch) {
  if (!wanted(name)) return;
  const data = dataDir(name, relaunch ? undefined : setting);
  if (relaunch) {
    const first = await launch(app, { data, js: "live" });
    await sleep(1500);
    await first.eval(`ac.store.getState().updateSettings({ openLinksInLittleArdia: ${setting} }); return true`);
    await first.quit();
  }
  const url = linkFor(name);
  const inst = await launch(app, { data, js: "live", urls: [url] });
  try {
    record(name, await settle(inst, url, 15000), setting ? "little" : "tab");
  } finally {
    await inst.quit();
  }
}

const menu = (inst, title, path) => inst.eval(`return globalThis.expo.modules.ArdiaDev.devMenuItems(${JSON.stringify(title)}, ${JSON.stringify(path)}, false)`);

try {
  for (const setting of [false, true]) {
    const tag = setting ? "on" : "off";
    await cold(`cold-${tag}`, setting);
    await cold(`cold-relaunched-${tag}`, setting, true);
    await warm(`warm-${tag}`, setting);
    await warm(`warm-no-window-${tag}`, setting, (i) => i.eval(`const s = ac.store.getState(); s.windowOrder.forEach((id) => s.closeWindow(id)); return true`));
    await warm(`warm-minimized-${tag}`, setting, (i) => menu(i, "Window", ["Minimize All"]));
    await warm(`warm-hidden-${tag}`, setting, (i) => menu(i, "Ardia", ["Hide Ardia"]));
    await warm(`warm-other-profile-${tag}`, setting, (i) => i.eval(`ac.store.setState((s) => ({ ui: { ...s.ui, lastProfileId: "work" } })); return true`), {
      profiles: ["Personal", "Work"],
      windows: [{ id: "w1" }, { id: "w2", profileId: "work" }],
      tabs: [{ id: "t1", url: "about:blank", windowId: "w1" }, { id: "t2", url: "about:blank", windowId: "w2" }],
    });
    await warm(`warm-little-in-front-${tag}`, setting, (i) => i.eval(`ac.runCommand({ command: "newLittleArdia", arg: null, windowId: null }); return true`));
    await warm(`warm-toggled-live-${tag}`, setting, (i) => i.eval(`ac.store.getState().updateSettings({ openLinksInLittleArdia: ${setting} }); return true`), { startWith: !setting });
    await warm(`warm-file-${tag}`, setting, null, { url: "file:///etc/hosts" });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(failures.length ? `${failures.length} failed: ${failures.join(", ")}` : "all passed");
process.exit(failures.length ? 1 : 0);
