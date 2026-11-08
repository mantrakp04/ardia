import { evaluate } from "../lib/cdp.mjs";
import { percentText, zoomAgreement } from "../lib/assertions.mjs";
import { navigateTab, restartBrowser, startBrowser, waitCommitted } from "../lib/flows.mjs";
import { chooseHistoryEntry, clickLabel, revealToolbar, visibleByLabel } from "../lib/ui.mjs";
import { js, nonce, until } from "../lib/util.mjs";

async function pageRatio(app, url) {
  const target = await app.pageTarget((t) => t.type === "page" && t.url === url, { label: `page ${url}` });
  const session = await app.connect(target);
  return evaluate(session, "devicePixelRatio");
}

async function waitZoom(shell, tabId, want) {
  return until(async () => {
    const zoom = await shell.state(`return s.tabs[${js(tabId)}]?.zoom ?? null;`);
    return typeof zoom === "number" && Math.abs(zoom - want) < 0.005 ? zoom : false;
  }, { timeout: 10000, label: `tab zoom ${want}` });
}

async function zoomIndicator(shell, zoom) {
  await revealToolbar(shell);
  return until(() => visibleByLabel(shell, `Zoom: ${percentText(zoom)}`), { timeout: 6000, label: `the ${percentText(zoom)} zoom indicator` });
}

async function nondefaultIndicators(shell) {
  await revealToolbar(shell);
  return (await shell.labels()).filter((l) => /^Zoom: \d+%/.test(l ?? ""));
}

async function zoomLevels(shell) {
  const reply = await shell.call("sites.zoomLevels", {});
  if (!reply.ok) throw new Error(`sites.zoomLevels failed: ${reply.code} ${reply.message}`);
  return reply.value;
}

const hostListed = (levels, host) => JSON.stringify(levels ?? null).includes(host);

export default {
  id: "F23",
  issue: 33,
  title: "History jumps of two or more and zoom feedback, reset and per-site persistence",
  deadline: 360000,
  manual: [
    { name: "Pinch zoom agrees with the indicator", steps: ["On a touchpad, pinch-zoom a page.", "The toolbar indicator and site panel percentage follow the native page scale and Reset returns to 100%."], reason: "needs touchpad input" },
  ],
  async run(t) {
    const run = nonce("f23");
    let state = await startBrowser(t, { name: "history-zoom" });
    const { url } = t.fixtures;
    const pages = [1, 2, 3, 4].map((n) => url.page(n, run));
    const tabId = await state.shell.newTab(pages[0]);
    await state.shell.waitTabUrl(tabId, (u) => u === pages[0]);
    await waitCommitted(state.shell, tabId, (u) => u === pages[0], { label: pages[0] });
    await t.check("four pages build back history", async () => {
      for (const page of pages.slice(1)) await navigateTab(state.shell, tabId, page, { committed: true });
      return until(() => state.shell.state(`const l = s.live[${js(tabId)}]; return l?.canGoBack && !l.canGoForward ? l : false;`), { timeout: 8000, label: "back available" });
    }, { critical: true });
    await t.check("history menu jumps back two pages", async () => {
      await chooseHistoryEntry(state.shell, -1, "Acceptance page 2");
      await state.shell.waitTabUrl(tabId, (u) => u === pages[1], { label: "page 2 after a two-step jump" });
      return until(() => state.shell.state(`const l = s.live[${js(tabId)}]; return l?.canGoBack && l.canGoForward ? l : false;`), { timeout: 8000, label: "back and forward both available" });
    });
    await t.check("history menu jumps forward two pages", async () => {
      await chooseHistoryEntry(state.shell, 1, "Acceptance page 4");
      await state.shell.waitTabUrl(tabId, (u) => u === pages[3], { label: "page 4 after a two-step forward jump" });
      return true;
    });
    await t.check("history menu jumps back three pages", async () => {
      await chooseHistoryEntry(state.shell, -1, "Acceptance page 1");
      await state.shell.waitTabUrl(tabId, (u) => u === pages[0], { label: "page 1 after a three-step jump" });
      return true;
    });

    const twoPageTab = async () => {
      const id = await state.shell.newTab(pages[0]);
      await waitCommitted(state.shell, id, (u) => u === pages[0], { label: pages[0] });
      await navigateTab(state.shell, id, pages[1], { committed: true });
      return id;
    };
    const reopenClosedTabOn = async (page) => {
      const before = await state.shell.state(`return Object.keys(s.tabs);`);
      await state.shell.command("reopenClosedTab");
      return until(() => state.shell.state(`const before = new Set(${js(before)}); return Object.values(s.tabs).find((t) => t.windowId === windowId && t.url === ${js(page)} && !before.has(t.id))?.id ?? false;`), { timeout: 8000, label: `a newly reopened tab on ${page}` });
    };
    const hasBackHistory = (id) => until(() => state.shell.state(`const l = s.live[${js(id)}]; return l?.canGoBack ? l : false;`), { timeout: 8000, label: `back history in ${id}` });
    let reopened;
    await t.check("a closed tab reopens on its page", async () => {
      const closing = await twoPageTab();
      await state.shell.state(`s.closeTab(${js(closing)}); return true;`);
      await until(() => state.shell.state(`return !s.tabs[${js(closing)}];`), { timeout: 8000, label: "the tab to close" });
      reopened = await reopenClosedTabOn(pages[1]);
      return waitCommitted(state.shell, reopened, (u) => u === pages[1], { label: `${pages[1]} in the reopened tab` });
    });
    await t.check("a reopened tab keeps its back history", async () => {
      if (!reopened) throw new Error("no reopened tab");
      return hasBackHistory(reopened);
    });
    await t.check("a duplicated tab opens on its page with its back history", async () => {
      const source = await twoPageTab();
      const copy = await state.shell.state(`return s.duplicateTab(${js(source)});`);
      await waitCommitted(state.shell, copy, (u) => u === pages[1], { label: `${pages[1]} in the duplicate` });
      const history = await hasBackHistory(copy);
      await state.shell.state(`s.activate(${js(tabId)}); return true;`);
      return history;
    });

    await t.check("a discarded tab reopens with its back history", async () => {
      const id = await twoPageTab();
      const other = await state.shell.newTab(pages[3]);
      await state.shell.waitTabUrl(other, (u) => u === pages[3]);
      const discarded = await state.shell.eval(`(async () => { const view = ardiaLinux.webviews.get(${js(id)}); return view ? await view.discard() : "no web view"; })()`);
      if (discarded !== "discarded") throw new Error(`the background tab wasn't discarded: ${discarded}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await state.shell.state(`s.closeTab(${js(id)}); return true;`);
      await until(() => state.shell.state(`return !s.tabs[${js(id)}];`), { timeout: 8000, label: "the discarded tab to close" });
      const back = await reopenClosedTabOn(pages[1]);
      await waitCommitted(state.shell, back, (u) => u === pages[1], { label: `${pages[1]} in the reopened discarded tab` });
      const live = await hasBackHistory(back);
      await state.shell.state(`s.activate(${js(tabId)}); return true;`);
      return { discarded, live };
    });
    const zoomUrl = url.zoom("zoom.ardia.test") + `?run=${run}`;
    let base;
    await t.check("zoom in agrees across page scale, percentage and indicator", async () => {
      await navigateTab(state.shell, tabId, zoomUrl, { committed: true });
      base = await pageRatio(state.app, zoomUrl);
      await state.shell.command("zoomIn");
      const zoom = await waitZoom(state.shell, tabId, 1.1);
      const ratio = await until(async () => {
        const r = await pageRatio(state.app, zoomUrl);
        return zoomAgreement({ storeZoom: zoom, pageRatio: r, baseRatio: base }).ok ? r : false;
      }, { timeout: 8000, label: "page scale 110%" });
      const indicator = await zoomIndicator(state.shell, zoom);
      return { zoom, ratio, base, indicator: indicator.label };
    });
    await t.check("the zoom popover shows the percentage and its Reset restores 100%", async () => {
      await clickLabel(state.shell, "Zoom: 110%");
      await until(async () => (await state.shell.text()).includes("Zoom: 110%"), { timeout: 6000, label: "Zoom: 110% in the popover" });
      await state.shell.clickText("Reset", { timeout: 6000 });
      const zoom = await waitZoom(state.shell, tabId, 1);
      await until(async () => zoomAgreement({ storeZoom: 1, pageRatio: await pageRatio(state.app, zoomUrl), baseRatio: base }).ok, { timeout: 8000, label: "page scale 100%" });
      await state.shell.key("Escape", { code: "Escape", keyCode: 27 });
      const stale = await until(async () => {
        const left = await nondefaultIndicators(state.shell);
        return left.length ? false : left;
      }, { timeout: 5000, label: "the zoom indicator to disappear" }).catch(async () => nondefaultIndicators(state.shell));
      if (stale.length) throw new Error(`a nondefault zoom indicator is still visible: ${stale.join(", ")}`);
      return { zoom };
    });
    await t.check("zoom out then the reset command agree with page scale", async () => {
      await state.shell.command("zoomOut");
      const zoom = await waitZoom(state.shell, tabId, 0.9);
      await until(async () => zoomAgreement({ storeZoom: zoom, pageRatio: await pageRatio(state.app, zoomUrl), baseRatio: base }).ok, { timeout: 8000, label: "page scale 90%" });
      await zoomIndicator(state.shell, zoom);
      await state.shell.command("zoomReset");
      await waitZoom(state.shell, tabId, 1);
      await until(async () => zoomAgreement({ storeZoom: 1, pageRatio: await pageRatio(state.app, zoomUrl), baseRatio: base }).ok, { timeout: 8000, label: "page scale 100%" });
      return { zoomedOut: zoom };
    });

    const persistUrl = url.zoom("persist.ardia.test") + `?run=${run}`;
    await t.check("per-site zoom is saved for the site", async () => {
      await navigateTab(state.shell, tabId, persistUrl, { committed: true });
      await state.shell.command("zoomIn");
      await waitZoom(state.shell, tabId, 1.1);
      await state.shell.command("zoomIn");
      await waitZoom(state.shell, tabId, 1.25);
      const levels = await until(async () => {
        const l = await zoomLevels(state.shell);
        return hostListed(l, "persist.ardia.test") ? l : false;
      }, { timeout: 8000, label: "persist.ardia.test in sites.zoomLevels" });
      return { levels };
    });
    await t.check("per-site zoom survives restart", async () => {
      state = await restartBrowser(t, state);
      const again = await state.shell.newTab(`${persistUrl}&after=restart`);
      await state.shell.waitTabUrl(again, (u) => u.startsWith(persistUrl));
      const zoom = await waitZoom(state.shell, again, 1.25);
      const ratio = await pageRatio(state.app, `${persistUrl}&after=restart`);
      const freshBase = await (async () => {
        const plain = url.page(9, `${run}-base`);
        const id = await state.shell.newTab(plain);
        await state.shell.waitTabUrl(id, (u) => u === plain);
        return pageRatio(state.app, plain);
      })();
      const agreement = zoomAgreement({ storeZoom: zoom, pageRatio: ratio, baseRatio: freshBase });
      if (!agreement.ok) throw new Error(agreement.problem);
      await state.shell.state(`s.activate(${js(again)}); return true;`);
      await state.shell.command("zoomReset");
      await waitZoom(state.shell, again, 1);
      const levels = await until(async () => {
        const l = await zoomLevels(state.shell);
        return hostListed(l, "persist.ardia.test") ? false : l ?? [];
      }, { timeout: 8000, label: "persist.ardia.test removed from sites.zoomLevels" });
      await navigateTab(state.shell, again, `${persistUrl}&after=reset`);
      const after = await waitZoom(state.shell, again, 1);
      return { restored: zoom, ratio, freshBase, levels, after };
    });
  },
};
