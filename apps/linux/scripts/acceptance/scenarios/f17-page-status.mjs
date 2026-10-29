import { startBrowser, navigateTab } from "../lib/flows.mjs";
import { gesture, openPage, pageState, waitPage } from "../lib/pages.mjs";
import { clickLabel } from "../lib/ui.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const HANG_TIMEOUT = 55000;

async function pressWithoutAck(session) {
  session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a" }, { timeout: 60000 }).catch(() => {});
}

export default {
  id: "F17",
  issue: 27,
  title: "Page fullscreen, renderer crash and hang recovery, hovered-link status and blocked pop-ups",
  deadline: 480000,
  async run(t) {
    const run = nonce("f17");
    const state = await startBrowser(t, { name: "page-status", coreDumps: false });
    const { shell } = state;
    const { url } = t.fixtures;
    await t.check("the pages store is reachable from the shell", async () => {
      const ok = await shell.eval("typeof ardiaLinux.pages?.getState === 'function'");
      if (!ok) throw new Error("ardiaLinux.pages is missing");
      return ok;
    }, { critical: true });

    await t.check("page fullscreen hides Ardia chrome without marking the window fullscreen", async () => {
      const page = await openPage(shell, url.fullscreen(run));
      const entered = await gesture(page.session, "document.documentElement.requestFullscreen().then(() => true)");
      if (entered.exceptionDetails) throw new Error(`requestFullscreen failed: ${JSON.stringify(entered.exceptionDetails)}`);
      await waitPage(shell, page.tabId, (p) => p.fullscreen === true, { label: "page fullscreen" });
      const window = await shell.state("return s.windows[windowId]?.fullScreen ?? null;");
      if (window) throw new Error(`the window was marked fullscreen at ${window}`);
      await t.screenshot(shell, "fullscreen-entered");
      await gesture(page.session, "document.exitFullscreen().then(() => true)");
      await waitPage(shell, page.tabId, (p) => p.fullscreen === false, { label: "page fullscreen to end" });
      const after = await shell.state("return s.windows[windowId]?.fullScreen ?? null;");
      if (after) throw new Error(`the window stayed fullscreen at ${after}`);
      return { tabId: page.tabId };
    });

    await t.check("a hovered link shows its URL as status and it clears when the pointer leaves", async () => {
      const page = await openPage(shell, url.hover(run));
      await page.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 120, y: 60 });
      const hovered = await waitPage(shell, page.tabId, (p) => p.status?.includes("/page/5"), { label: "status for the hovered link" });
      await page.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 500 });
      await waitPage(shell, page.tabId, (p) => p.status === "", { label: "status to clear" });
      await page.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 120, y: 60 });
      await waitPage(shell, page.tabId, (p) => p.status?.includes("/page/5"), { label: "status before navigating" });
      await navigateTab(shell, page.tabId, url.page(2, run));
      await waitPage(shell, page.tabId, (p) => p.status === "", { label: "status cleared by the navigation" });
      return { status: hovered.status };
    });

    await t.check("a blocked pop-up is listed and opens from the prompt", async () => {
      const page = await openPage(shell, url.popup(run));
      const target = url.popupTarget(run);
      const blocked = await waitPage(shell, page.tabId, (p) => p.popups?.some((x) => x.url === target), { label: "the blocked pop-up" });
      const prompt = () => until(async () => (await shell.text()).includes("Only Once"), { timeout: 4000, label: "the pop-up prompt" });
      await prompt().catch(async () => {
        await t.screenshot(shell, "popup-missing");
        await t.evidence("popup-missing", { text: await shell.text(), popover: await shell.eval("JSON.stringify(ardiaLinux.pages.getState().popover)"), active: await shell.activeTabId(), tab: page.tabId, fullscreen: await shell.state("return s.windows[windowId]?.fullScreen ?? null;") });
        await clickLabel(shell, "Pop-ups blocked on this page");
        await prompt();
      });
      await t.screenshot(shell, "popup-prompt");
      await shell.clickText("Only Once");
      const opened = await shell.waitState(`return Object.values(s.tabs).find((x) => x.url === ${js(target)})?.id ?? false;`, { timeout: 15000, label: "the pop-up tab" });
      return { popups: blocked.popups.length, opened };
    });

    await t.check("a renderer crash shows the reload state and Reload recovers the page", async () => {
      const crashUrl = url.page(3, `${run}-crash`);
      const page = await openPage(shell, crashUrl);
      await page.session.send("Page.crash", {}, { timeout: 3000 }).catch(() => {});
      const crashed = await waitPage(shell, page.tabId, (p) => !!p.crashed, { label: "the crashed state" });
      await until(async () => (await shell.text()).includes("This tab needs to reload"), { timeout: 8000, label: "the reload state" });
      await t.screenshot(shell, "crashed");
      await shell.clickText("Reload");
      await waitPage(shell, page.tabId, (p) => !p.crashed, { label: "the crash state to clear" });
      await shell.app.pageTarget((x) => x.type === "page" && x.url === crashUrl, { label: "the reloaded page" });
      return { crashed: crashed.crashed };
    });

    let busy;
    await t.check("a hung renderer shows Page Unresponsive and Wait dismisses it", async () => {
      busy = await openPage(shell, url.busy(run));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await pressWithoutAck(busy.session);
      await shell.app.disconnect(busy.target);
      await waitPage(shell, busy.tabId, (p) => p.unresponsive === true, { timeout: HANG_TIMEOUT, label: "the unresponsive state" });
      await until(async () => (await shell.text()).includes("Page Unresponsive"), { timeout: 8000, label: "the unresponsive dialog" });
      await t.screenshot(shell, "unresponsive");
      await shell.clickText("Wait");
      await waitPage(shell, busy.tabId, (p) => p.unresponsive === false, { label: "the dialog to close" });
      return true;
    }, { timeout: 75000 });

    await t.check("Exit Page ends a renderer that stays hung", async () => {
      if (!busy) throw new Error("the hung page did not open");
      await waitPage(shell, busy.tabId, (p) => p.unresponsive === true, { timeout: HANG_TIMEOUT, label: "the hang to be reported again" });
      await shell.clickText("Exit Page");
      const ended = await waitPage(shell, busy.tabId, (p) => !!p.crashed && !p.unresponsive, { timeout: 15000, label: "the hung renderer to end" });
      return { crashed: ended.crashed, page: await pageState(shell, busy.tabId) };
    }, { timeout: 75000 });
  },
};
