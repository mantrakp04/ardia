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

const PEEK_EDGE_RECORDER = `(() => {
  if (globalThis.__ardiaPeekEdge) return true;
  const started = performance.now();
  const record = { started, log: [] };
  globalThis.__ardiaPeekEdge = record;
  let last = null;
  const tick = () => {
    const peek = document.querySelector('[data-testid="ardia-sidebar-peek"]');
    const right = peek ? Math.round(peek.getBoundingClientRect().right) : -1;
    if (right !== last) record.log.push([Math.round(performance.now() - started), right]);
    last = right;
    requestAnimationFrame(tick);
  };
  tick();
  return true;
})()`;

export function peekTimeline(log, since) {
  const after = log.filter(([at]) => at >= since);
  const opened = after.findIndex(([, right]) => right > 0);
  const rehid = opened >= 0 && after.slice(opened).some(([, right]) => right === -1);
  const closedAt = after.find(([, right]) => right === -1)?.[0];
  return { opened: opened >= 0, rehid, closedAfter: closedAt === undefined ? null : closedAt - since };
}

export const f25Edge = {
  id: "F25EX",
  issue: 35,
  desktop: true,
  title: "Auto-Hide Tabs (#368): the left-edge zone reveals the hidden sidebar from the window's outermost pixel and on an overshoot past the edge, never re-hides it while the pointer moves into it, holds it 24 px past its edge and dismisses it after 120 ms, with a real X11 pointer",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable({ x11: true });
    if (missing) {
      t.manual("The left-edge zone reveals the sidebar every time", ["Hide the sidebar with Ctrl+S.", "Throw the pointer at the window's left edge, past it, and onto its outermost pixel: the sidebar slides in each time.", "Move straight into it while it slides: it never slides back out.", "Rest just right of it: it stays; move well away: it leaves after a short beat."], missing);
      return;
    }
    const desktop = await openDesktop(t, { x11: true });
    const pages = await pageFixtures(t);
    const url = pages.http("links", "?title=Edge+page&bg=22aa66&top=700&to=about%3Ablank");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "edge", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [url] }] }), { [url]: "Edge page" }) });
    const window = await until(async () => (await desktop.windows()).find((w) => /Edge page|Ardia/.test(w.title)) ?? false, { timeout: 15000, label: "the Ardia window" });
    await shell.state("s.toggleSidebar(windowId); return true;");
    await until(() => shell.state("return s.windows[windowId].sidebarOpen === false;"), { timeout: 5000, label: "the sidebar hidden" });
    await delay(1200);
    await shell.eval(PEEK_EDGE_RECORDER);
    const frame = await currentRect(desktop, window);
    const move = (x, y = Math.round(frame.height / 2)) => desktop.pointerMove(frame.x + x, frame.y + y);
    const shown = () => shell.eval("!!document.querySelector('[data-testid=\"ardia-sidebar-peek\"]')");
    const now = () => shell.eval("Math.round(performance.now() - __ardiaPeekEdge.started)");
    const timeline = async (since) => peekTimeline(await shell.eval("__ardiaPeekEdge.log"), since);
    const away = Math.round(frame.width * 0.6);
    const closed = async () => {
      await move(away);
      await delay(100);
      await move(away + 5);
      await until(async () => !(await shown()), { timeout: 4000, label: "the peek closed" });
      await delay(300);
    };
    const opens = async (label) => until(shown, { timeout: 1500, label });
    await t.check("the peek opens with the pointer on the window's outermost pixel, over the frame's resize border", async () => {
      await closed();
      await move(0);
      return opens("the peek from the outermost pixel");
    });
    await t.check("a fast move that overshoots the window's left edge reveals the sidebar", async () => {
      if (frame.x < 30) throw new Error(`the window sits at x ${frame.x}, too close to the screen edge to overshoot`);
      const runs = [];
      for (let run = 0; run < 3; run++) {
        await closed();
        for (let x = away; x > -20; x -= 60) {
          await move(x);
          await delay(8);
        }
        await move(-20);
        runs.push(await opens(`the peek after overshoot ${run + 1}`));
      }
      return runs;
    });
    await t.check("moving straight into the sliding peek never slides it back out", async () => {
      const runs = [];
      for (let run = 0; run < 3; run++) {
        await closed();
        const since = await now();
        await move(2);
        for (let x = 2; x < 120; x += 8) {
          await move(x);
          await delay(16);
        }
        await delay(900);
        const seen = await timeline(since);
        if (!seen.opened || seen.rehid || !(await shown())) throw new Error(`run ${run + 1}: ${JSON.stringify(seen)}`);
        runs.push(seen);
      }
      return runs;
    });
    await t.check("the peek stays out with the pointer resting 12 px past its edge, over the page", async () => {
      await closed();
      await move(2);
      await opens("the peek");
      await delay(400);
      const right = await shell.eval("Math.round(document.querySelector('[data-testid=\"ardia-sidebar-peek\"]').getBoundingClientRect().right)");
      await move(right + 12);
      await delay(800);
      if (!(await shown())) throw new Error(`the peek closed with the pointer at ${right + 12}, 12 px past its edge at ${right}`);
      return { right };
    });
    await t.check("leaving the hold column dismisses the peek after macOS's 120 ms delay", async () => {
      await closed();
      await move(2);
      await opens("the peek");
      await move(100);
      await delay(400);
      const since = await now();
      await move(away);
      await until(async () => !(await shown()), { timeout: 3000, label: "the peek dismissed" });
      const seen = await timeline(since);
      if (seen.closedAfter === null || seen.closedAfter < 100) throw new Error(`the peek left ${seen.closedAfter} ms after the pointer`);
      return seen;
    });
    await shot(t, desktop, "edge-end");
    await t.stop(app);
  },
};
