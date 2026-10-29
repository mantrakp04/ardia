import { ardiaWindow, pageFixtures, paneRect, shot, titledSeed } from "../lib/desktopPages.mjs";
import { fractionNear } from "../lib/desktopPixels.mjs";
import { currentRect, desktopUnavailable, openDesktop, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { until } from "../lib/util.mjs";

const PAGE_COLOR = [0x22, 0xaa, 0x66];

export function peekRegions(frame, pane) {
  return {
    peek: { x: frame.x + 30, y: frame.y + 420, width: 120, height: 200 },
    beside: { x: frame.x + pane.left + 320, y: frame.y + pane.top + 280, width: 240, height: 240 },
  };
}

export function peekVerdict(image, regions) {
  const peek = fractionNear(image, regions.peek, PAGE_COLOR, 30);
  const beside = fractionNear(image, regions.beside, PAGE_COLOR, 30);
  return { peekShown: peek < 0.2, pageShown: beside > 0.9, peek: Number(peek.toFixed(3)), beside: Number(beside.toFixed(3)) };
}

export const f25Peek = {
  id: "F25P",
  issue: 35,
  desktop: true,
  title: "Auto-Hide Tabs (#304): with the sidebar hidden, the left-edge peek shows the sidebar beside a page that stays painted, measured in pixels in a private sway session",
  deadline: 180000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("The sidebar peek keeps the page visible", ["Hide the sidebar with Ctrl+S, then move the pointer to the window's left edge.", "The sidebar slides in over the page's left edge and the rest of the page stays visible; moving away hides the peek."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t);
    const url = pages.http("links", "?title=Peek+page&bg=22aa66&top=700&to=about%3Ablank");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "peek", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [url] }] }), { [url]: "Peek page" }) });
    const window = await ardiaWindow(desktop);
    const tabId = await shell.activeTabId();
    const measure = async () => {
      const frame = await currentRect(desktop, window);
      const pane = await paneRect(shell, tabId);
      const regions = peekRegions(frame, pane);
      return { regions, ...peekVerdict(await desktop.capture(), regions) };
    };
    await t.check("hiding the sidebar leaves the page painted across the window", async () => {
      await until(async () => (await measure()).pageShown, { timeout: 15000, label: "the page painted" });
      await shell.state("s.toggleSidebar(windowId); return true;");
      await until(() => shell.state("return s.windows[windowId].sidebarOpen === false;"), { timeout: 5000, label: "the sidebar hidden" });
      const hidden = await until(async () => { const m = await measure(); return m.pageShown && !m.peekShown ? m : false; }, { timeout: 8000, label: "the page under the hidden sidebar's place" });
      await shot(t, desktop, "peek-hidden");
      return hidden;
    });
    await t.check("pointing at the window's left edge peeks the sidebar while the page beside it stays painted", async () => {
      const frame = await currentRect(desktop, window);
      const approach = async () => {
        for (let x = 80; x >= 0; x -= 4) {
          await desktop.pointerMove(frame.x + x, frame.y + 500);
          await delay(30);
        }
      };
      const peekOpen = () => shell.eval("!!document.querySelector('[data-testid=\"ardia-sidebar-peek\"]') || [...document.querySelectorAll('*')].some((n) => n.innerText?.trim() === 'Peek page' && n.getBoundingClientRect().left >= 0 && n.getBoundingClientRect().width > 0)");
      for (let attempt = 0; attempt < 4 && !(await until(peekOpen, { timeout: 1500, label: "the peek" }).catch(() => false)); attempt++) await approach();
      let last = null;
      const peeked = await until(async () => { last = await measure(); return last.peekShown && last.pageShown ? last : false; }, { timeout: 6000, label: "the peek beside a painted page" }).catch(async (error) => {
        await shot(t, desktop, "peek-failed");
        throw new Error(`${error.message}: ${JSON.stringify(last)}`);
      });
      await shot(t, desktop, "peek-open");
      return peeked;
    });
    await t.check("moving the pointer away closes the peek and the page fills its place again", async () => {
      const frame = await currentRect(desktop, window);
      await desktop.pointerMove(frame.x + frame.width * 0.75, frame.y + frame.height / 2);
      return until(async () => { const m = await measure(); return m.pageShown && !m.peekShown ? m : false; }, { timeout: 6000, label: "the peek closed over a painted page" });
    });
    await t.stop(app);
  },
};
