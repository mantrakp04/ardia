import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareApp } from "../../../scripts/lib/app-copy.mjs";
import { launch, session } from "../../../scripts/lib/instance.mjs";

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { bundle: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
if (!positionals[0]) {
  console.error("usage: node window-toolbar-test.mjs <Ardia.app> [--bundle <main.jsbundle>] [--out <dir>] [--port <n>]");
  process.exit(2);
}
const out = resolve(flags.out ?? join(tmpdir(), "ac-window-toolbar"));
mkdirSync(out, { recursive: true });
const app = flags.bundle ? prepareApp(positionals[0], join(out, "app"), { bundle: resolve(flags.bundle) }) : resolve(positionals[0]);

const page = (name, color) => `data:text/html,<title>${name}</title><meta name="theme-color" content="${color}"><p>${name}</p>`;
const pages = { a: page("Tab-a", "#C0392B"), b: page("Tab-b", "#2471A3"), c: "https://example.com/c", d: "https://example.org/d" };
const instance = await launch(app, {
  data: join(out, "data"),
  fresh: true,
  port: flags.port,
  onboarded: true,
  probe: true,
  session: session({
    windows: [{ id: "w1", frame: [100, 100, 1200, 800] }],
    tabs: Object.entries(pages).map(([id, url]) => ({ id, url, title: id })),
    settings: { searchSuggestions: false, warnBeforeClosingLastTab: false, warnBeforeClosingWindow: false },
  }),
  ready: { timeout: 120_000, test: "return !!ac.store.getState().windows.w1;" },
});
const ac = (body, ms = 120_000) => instance.eval(body, { timeout: ms });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
try {
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
  await instance.quit();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
