import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluate, launch, quit } from "./perf/js-bench.mjs";

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { bundle: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
if (!positionals[0]) {
  console.error("usage: node window-toolbar-test.mjs <Ardia.app> [--bundle <main.jsbundle>] [--out <dir>] [--port 9796]");
  process.exit(2);
}
const out = resolve(flags.out ?? join(tmpdir(), "ac-window-toolbar"));
mkdirSync(out, { recursive: true });
let app = resolve(positionals[0]);
if (flags.bundle) {
  const clone = join(out, "app", "Ardia.app");
  rmSync(dirname(clone), { recursive: true, force: true });
  mkdirSync(dirname(clone), { recursive: true });
  execFileSync("cp", ["-cR", app, clone]);
  cpSync(resolve(flags.bundle), join(clone, "Contents/Resources/main.jsbundle"));
  const identity = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr.match(/^Authority=(.+)$/m)?.[1] ?? "-";
  writeFileSync(`${clone}.entitlements.plist`, execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8" }));
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime", "--entitlements", `${clone}.entitlements.plist`, clone], { stdio: "inherit" });
  app = clone;
}

const data = join(out, "data");
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
const page = (name, color) => `data:text/html,<title>${name}</title><meta name="theme-color" content="${color}"><p>${name}</p>`;
const tab = (id, url) => ({ id, url, title: id, favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, navigation: null, openerId: null, createdAt: Date.now(), lastActiveAt: Date.now() });
const pages = { a: page("Tab-a", "#C0392B"), b: page("Tab-b", "#2471A3"), c: "https://example.com/c", d: "https://example.org/d" };
const ids = Object.keys(pages);
writeFileSync(
  join(data, "session.json"),
  JSON.stringify({
    version: 2,
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    profileOrder: ["default"],
    orphanedProfileData: [],
    settings: { searchSuggestions: false, warnBeforeClosingLastTab: false, warnBeforeClosingWindow: false },
    windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ids, activeTabIds: { default: "a" }, sidebarOpen: true, frame: [100, 100, 1200, 800], createdAt: 0 }],
    windowOrder: ["w1"],
    focusedWindowId: "w1",
    tabs: ids.map((id) => ({ ...tab(id, pages[id]), windowId: "w1", profileId: "default" })),
    groups: [],
    splits: [],
    closedTabs: [],
    closedWindows: [],
  }),
);
writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
writeFileSync(join(data, "perf-probe"), "");

const { pid } = await launch(app, data, Number(flags.port ?? 9796));
const ac = (body, ms) => evaluate(data, pid, body, ms);
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) ready = await ac("return !!ac.store.getState().windows.w1;", 2000).then((v) => v, () => false);
  if (!ready) throw new Error("the dev harness never answered");
  await ac(`
    globalThis.wt = {
      frames: (n) => new Promise((r) => { let k = n || 3; const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }),
      fibers: (name) => acPerf.findFibers(name, 500).filter((f) => f.memoizedProps),
      inPane: (f) => { for (let p = f.return; p; p = p.return) if (p.type?.type?.name === "TabPane" || p.type?.name === "TabPane" || p.elementType?.type?.name === "TabPane") return p.memoizedProps.tabId; return null; },
      state: () => {
        const toolbars = wt.fibers("Toolbar").map((f) => ({ tabId: f.memoizedProps.tabId, bare: !!f.memoizedProps.bare, pane: wt.inPane(f) }));
        const auto = wt.fibers("AutoHideToolbar").map((f) => ({ tabId: f.memoizedProps.tabId, mode: f.memoizedProps.mode, pane: wt.inPane(f) }));
        const backdrops = [...wt.fibers("AutoHideBackdrop"), ...wt.fibers("ToolbarBackdrop")].map((f) => ({ tabId: f.memoizedProps.tabId, pane: wt.inPane(f) }));
        const hosts = wt.fibers("ToolbarUrlField").map((f) => f.memoizedProps.tab?.url);
        const w = ac.store.getState().windows.w1;
        return { active: w.activeTabIds[w.profileId], toolbars, auto, backdrops, hosts };
      },
      until: (test, ms) => new Promise((r) => { const end = Date.now() + (ms || 15000); const poll = () => (test() ? r(true) : Date.now() > end ? r(false) : setTimeout(poll, 50)); poll(); }),
    };
    return true;`);
  const S = "const S = () => ac.store.getState();";
  const switchTo = (id) => ac(`${S} acPerf.reset(); S().activate(${JSON.stringify(id)}); return wt.frames(4).then(() => ({ ...wt.state(), mounted: acPerf.read().mounts.Toolbar ?? 0, commits: acPerf.read().commits }));`);

  for (const mode of ["auto-hide", "always shown"]) {
    if (mode === "always shown") await ac(`${S} S().updateSettings({ hideToolbarWhileScrolling: false }); return wt.frames(4).then(() => true);`);
    const first = await switchTo("a");
    check(`${mode}: the perf probe sees React commits, so the mount counts below mean something`, first.commits > 0 && first.toolbars.length > 0, `commits ${first.commits}, toolbars ${first.toolbars.length}`);
    for (const id of ["b", "c", "d", "a"]) {
      const st = await switchTo(id);
      const windowBars = st.toolbars.filter((t) => !t.pane);
      check(`${mode}: switching to ${id}, the window's one toolbar shows ${id}`, windowBars.length === 1 && windowBars[0].tabId === id && st.toolbars.length === 1 && windowBars[0].bare, JSON.stringify(st.toolbars));
      check(`${mode}: switching to ${id}, the toolbar is kept, not mounted again`, st.mounted === 0, `Toolbar mounts ${st.mounted}`);
      const url = await ac(`${S} return S().tabs[${JSON.stringify(id)}].url;`);
      check(`${mode}: switching to ${id}, the address field shows ${id}'s address`, st.hosts.length === 1 && st.hosts[0] === url, JSON.stringify(st.hosts));
      check(`${mode}: switching to ${id}, the band behind it is ${id}'s pane's`, st.backdrops.length === 1 && st.backdrops[0].tabId === id && st.backdrops[0].pane === id, JSON.stringify(st.backdrops));
    }
  }
  await ac(`${S} S().updateSettings({ hideToolbarWhileScrolling: true }); return wt.frames(4).then(() => true);`);

  await switchTo("c");
  const collapsed = await ac(`${S} ac.toolbarAutoHide.noteScroll("c", "down"); return wt.frames(4).then(() => wt.state());`);
  check("auto-hide: scrolling down collapses the window's bar for the shown tab", collapsed.auto.length === 1 && collapsed.auto[0].tabId === "c" && collapsed.auto[0].mode === "collapsed", JSON.stringify(collapsed.auto));
  const other = await switchTo("d");
  check("auto-hide: the next tab's bar is shown", other.auto[0]?.tabId === "d" && other.auto[0]?.mode === "shown", JSON.stringify(other.auto));
  const back = await switchTo("c");
  check("auto-hide: back on the scrolled tab, its bar is revealed", back.auto[0]?.tabId === "c" && back.auto[0]?.mode === "shown", JSON.stringify(back.auto));

  const opened = await ac(`${S} const id = S().newTab("w1"); return wt.frames(6).then(() => ({ id, ...wt.state() }));`);
  check("a new tab: the window's toolbar follows it", opened.toolbars.length === 1 && opened.toolbars[0].tabId === opened.id && opened.active === opened.id, JSON.stringify(opened.toolbars));
  const closed = await ac(`${S} S().closeTab(${JSON.stringify(opened.id)}); return wt.frames(6).then(() => wt.state());`);
  check("closing it: the toolbar shows the tab shown after it", closed.toolbars.length === 1 && closed.toolbars[0].tabId === closed.active && closed.active !== opened.id, JSON.stringify(closed));

  const split = await ac(`${S} S().createSplit(["a", "b"]); S().activate("a"); return wt.frames(6).then(() => wt.state());`);
  const paneBars = split.auto.filter((t) => t.pane).map((t) => t.tabId).sort();
  check("a split: each pane has its own toolbar, the window has none", split.auto.every((t) => t.pane) && paneBars.join() === "a,b", JSON.stringify(split.auto));
  const unsplit = await ac(`${S} for (const id of Object.keys(S().splits)) S().separateSplit(id); S().activate("d"); return wt.frames(6).then(() => wt.state());`);
  check("out of the split: back to one window toolbar", unsplit.auto.length === 1 && !unsplit.auto[0].pane && unsplit.auto[0].tabId === "d", JSON.stringify(unsplit.auto));
} catch (e) {
  check("run", false, e.message);
} finally {
  await quit(pid);
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
