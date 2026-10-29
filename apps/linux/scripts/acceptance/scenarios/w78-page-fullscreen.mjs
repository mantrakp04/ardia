import { startBrowser } from "../lib/flows.mjs";
import { gesture, openPage, waitPage } from "../lib/pages.mjs";
import { nonce, until } from "../lib/util.mjs";

async function windowFullScreen(shell) {
  return shell.state("return s.windows[windowId]?.fullScreen ?? null;");
}

async function setWindowState(app, shell, windowState) {
  const windowId = await shell.nativeWindowId();
  await app.browser.send("Browser.setWindowBounds", { windowId, bounds: { windowState } });
}

export default {
  id: "W78",
  issue: 78,
  title: "Page fullscreen is kept apart from window fullscreen and exiting it restores the window",
  deadline: 240000,
  async run(t) {
    const run = nonce("w78");
    const state = await startBrowser(t, { name: "page-fullscreen" });
    const { shell, app } = state;
    let page;
    await t.check("page fullscreen does not report window fullscreen", async () => {
      page = await openPage(shell, t.fixtures.url.fullscreen(run));
      await gesture(page.session, "document.documentElement.requestFullscreen().then(() => true)");
      await waitPage(shell, page.tabId, (p) => p.fullscreen === true, { label: "page fullscreen" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const window = await windowFullScreen(shell);
      if (window) throw new Error(`window fullScreen was set to ${window}`);
      return { window };
    }, { critical: true });
    await t.check("leaving page fullscreen restores a normal window", async () => {
      await gesture(page.session, "document.exitFullscreen().then(() => true)");
      await waitPage(shell, page.tabId, (p) => p.fullscreen === false, { label: "page fullscreen to end" });
      const window = await windowFullScreen(shell);
      if (window) throw new Error(`window fullScreen was left at ${window}`);
      return { window };
    });
    await t.check("page fullscreen inside a fullscreen window returns to the fullscreen window", async () => {
      await setWindowState(app, shell, "fullscreen");
      const entered = await until(() => windowFullScreen(shell), { timeout: 10000, label: "window fullscreen" });
      await gesture(page.session, "document.documentElement.requestFullscreen().then(() => true)");
      await waitPage(shell, page.tabId, (p) => p.fullscreen === true, { label: "page fullscreen in a fullscreen window" });
      await gesture(page.session, "document.exitFullscreen().then(() => true)");
      await waitPage(shell, page.tabId, (p) => p.fullscreen === false, { label: "page fullscreen to end" });
      const still = await windowFullScreen(shell);
      if (still !== entered) throw new Error(`window fullScreen changed from ${entered} to ${still}`);
      await setWindowState(app, shell, "normal");
      await until(async () => !(await windowFullScreen(shell)), { timeout: 10000, label: "the window to leave fullscreen" });
      return { entered, still };
    });
  },
};
