import { evaluate } from "../lib/cdp.mjs";
import { navigateTab, startBrowser } from "../lib/flows.mjs";
import { openPage, waitPage } from "../lib/pages.mjs";
import { js, nonce, until } from "../lib/util.mjs";

export const TINTS = [
  { kind: "header", source: "header", color: "#aa2244" },
  { kind: "background", source: "background", color: "#22aa66" },
  { kind: "meta", source: "meta", color: "#336699" },
  { kind: "plain", source: "background", color: "#ffffff" },
];

const themeOf = (shell, tabId) => shell.state(`return s.live[${js(tabId)}]?.themeColor ?? null;`);
const scrolledDown = (shell, tabId) => shell.eval(`!!ardiaLinux.toolbar.getState().scrolledDown[${js(tabId)}]`);

async function wheel(session, deltaY) {
  await session.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 200, y: 300, deltaX: 0, deltaY });
}

export default {
  id: "F25",
  issue: 35,
  title: "Website tint from meta, header and background colors and scroll-driven toolbar hiding",
  deadline: 240000,
  async run(t) {
    const run = nonce("f25");
    const state = await startBrowser(t, { name: "tint-toolbar" });
    const { shell } = state;
    const { url } = t.fixtures;
    let tabId;
    await t.check("the toolbar store is reachable from the shell", async () => {
      const ok = await shell.eval("typeof ardiaLinux.toolbar?.getState === 'function'");
      if (!ok) throw new Error("ardiaLinux.toolbar is missing");
      tabId = (await openPage(shell, url.tint("header"))).tabId;
      return { tabId };
    }, { critical: true });

    for (const [index, tint] of TINTS.entries()) {
      await t.check(`a ${tint.kind} page tints with ${tint.color} from its ${tint.source} and the previous tint does not stay`, async () => {
        if (index > 0) await navigateTab(shell, tabId, url.tint(tint.kind));
        const page = await waitPage(shell, tabId, (p) => p.themeColorSource === tint.source, { label: `${tint.kind} tint source` });
        const color = await until(async () => { const c = await themeOf(shell, tabId); return c && c.toLowerCase() === tint.color ? c : false; }, { timeout: 10000, label: `${tint.kind} tint color` });
        if (index === 0) await t.screenshot(shell, "header-tint");
        return { source: page.themeColorSource, color };
      });
    }

    await t.check("scrolling a long page down hides the toolbar and scrolling back to the top shows it", async () => {
      const page = await openPage(shell, url.gestures(run));
      await until(() => evaluate(page.session, "document.readyState === 'complete'"), { timeout: 8000, label: "the long page" });
      for (let i = 0; i < 6; i++) await wheel(page.session, 400);
      await until(() => scrolledDown(shell, page.tabId), { timeout: 10000, label: "the toolbar to hide" });
      await t.screenshot(shell, "toolbar-hidden");
      await evaluate(page.session, "window.scrollTo(0, 0), true");
      for (let i = 0; i < 3; i++) await wheel(page.session, -400);
      await until(async () => !(await scrolledDown(shell, page.tabId)), { timeout: 10000, label: "the toolbar to return" });
      return true;
    });
  },
};
