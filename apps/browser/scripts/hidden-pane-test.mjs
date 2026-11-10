import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareApp } from "../../../scripts/lib/app-copy.mjs";
import { launch, session } from "../../../scripts/lib/instance.mjs";

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { bundle: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
if (!positionals[0]) {
  console.error("usage: node hidden-pane-test.mjs <Ardia.app> [--bundle <main.jsbundle>] [--out <dir>]");
  process.exit(2);
}
const out = resolve(flags.out ?? join(tmpdir(), "ac-hidden-pane"));
mkdirSync(out, { recursive: true });
const app = flags.bundle ? prepareApp(positionals[0], join(out, "app"), { bundle: resolve(flags.bundle) }) : resolve(positionals[0]);

const page = (name) => `data:text/html,<title>${name}</title><p>${name}-findme</p>`;
const instance = await launch(app, {
  data: join(out, "data"),
  fresh: true,
  port: flags.port,
  onboarded: true,
  probe: true,
  session: session({
    windows: [{ id: "w1", frame: [100, 100, 1200, 800] }],
    tabs: ["a", "b", "c", "d"].map((id) => ({ id, url: page(`Tab-${id}`), title: id })),
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
    globalThis.audit = {
      frames: (n) => new Promise((r) => { let k = n || 2; const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }),
      props: (name, tabId) => acPerf.findFibers(name, 500).filter((f) => !tabId || f.memoizedProps?.tabId === tabId || f.memoizedProps?.tab?.id === tabId).map((f) => ({ props: f.memoizedProps, rendered: !!f.child })),
      until: (test, ms) => new Promise((r) => { const end = Date.now() + (ms || 15000); const poll = () => (test() ? r(true) : Date.now() > end ? r(false) : setTimeout(poll, 50)); poll(); }),
    };
    return true;`);
  const S = "const S = () => ac.store.getState();";

  const loaded = await ac(`${S}
    S().activate("b");
    return audit.until(() => S().tabs.b.title === "Tab-b" && ac.webviews.has("b"))
      .then(() => { S().activate("a"); return audit.frames(3); })
      .then(() => ({ b: ac.webviews.has("b"), shown: S().windows.w1.activeTabIds.default }));`, 60_000);
  check("tab B's pane stays mounted while hidden", loaded.b && loaded.shown === "a", JSON.stringify(loaded));

  const hiddenChanges = await ac(`${S}
    const url = ${JSON.stringify(page("HiddenLoad"))};
    S().updateTab("b", { page: { kind: "loaded", nav: { url, seq: Date.now() } } });
    let ok = false;
    return audit.until(() => S().tabs.b.title === "HiddenLoad").then((loadedIt) => {
      ok = loadedIt;
      S().updateTab("b", { zoom: 1.5 });
      S().setFind("b", { open: true, query: "findme" });
      ac.pageState.setState((p) => ({ pages: { ...p.pages, b: { ...(p.pages.b || {}), permission: { id: "audit", tabId: "b", origin: "https://example.com", permissions: ["notifications"] } } } }));
      S().updateLive("b", { isLoading: true });
      return audit.frames(3);
    }).then(() => ({ ok, url: S().tabs.b.url, title: S().tabs.b.title, renderedB: audit.props("ToolbarUrlField", "b").length }));`, 60_000);
  check("a hidden tab loads what it's sent to (its own tab's navigation)", hiddenChanges.ok, `${hiddenChanges.url} "${hiddenChanges.title}"`);
  check("nothing of B's toolbar renders while it's hidden", hiddenChanges.renderedB === 0);

  const shown = await ac(`${S}
    S().activate("b");
    return audit.frames(3).then(() => ({
      url: audit.props("ToolbarUrlField", "b")[0]?.props.tab.url,
      zoom: audit.props("ZoomIndicator", "b")[0]?.props.zoom,
      loading: audit.props("ReloadButton", "b")[0]?.props.loading,
      find: audit.props("FindBar", "b")[0]?.rendered,
      prompt: audit.props("PermissionPrompt", "b")[0]?.rendered,
    }));`);
  check("shown: the URL it loaded while hidden", typeof shown.url === "string" && shown.url.includes("HiddenLoad"), shown.url);
  check("shown: its zoom", shown.zoom === 1.5, String(shown.zoom));
  check("shown: loading", shown.loading === true, String(shown.loading));
  check("shown: the find bar opened while hidden", shown.find === true);
  check("shown: the permission prompt that came while hidden", shown.prompt === true);

  const panes = await ac(`${S}
    const want = () => S().windows.w1.tabIds.filter((id) => S().tabs[id]?.page.nav || S().tabs[id]?.page.adopt).sort().join(",");
    const have = () => [...ac.webviews.keys()].filter((id) => S().tabs[id]?.windowId === "w1").sort().join(",");
    const steps = [];
    let e;
    const settle = (name) => audit.until(() => want() === have(), 8000).then(() => steps.push([name, want(), have()]));
    e = S().newTab("w1", { url: ${JSON.stringify(page("Tab-e"))}, background: true });
    return settle("open")
      .then(() => { S().closeTab("c"); return settle("close"); })
      .then(() => { S().updateTab(e, { title: "Retitled" }); S().activate(e); return settle("switch"); })
      .then(() => steps);`, 60_000);
  for (const [step, want, have] of panes) check(`mounted panes after ${step}`, want === have, `want ${want} have ${have}`);
} finally {
  await instance.quit();
}
process.exit(results.every(Boolean) ? 0 : 1);
