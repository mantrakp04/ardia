import { setTimeout as delay } from "node:timers/promises";
import { desktopShot, desktopUnavailable, focusShellWindow, openDesktop, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const titled = (desktop, text) => until(async () => (await desktop.windows()).find((w) => w.title.includes(text)) ?? false, { timeout: 20000, label: `the window titled ${text}` });

export default {
  id: "W77D",
  issue: 77,
  desktop: true,
  title: "A window made fullscreen on the second output comes back fullscreen there, focused, after a relaunch (two-output sway)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Fullscreen restores on the right display", ["With two monitors, move an Ardia window to the second monitor and make it fullscreen (F11 or the window manager's key).", "Quit Ardia and launch it again.", "The window comes back fullscreen on the second monitor, and the window that had focus has it again."], missing);
      return;
    }
    const desktop = await openDesktop(t, { outputs: 2 });
    const seed = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "second", urls: [t.fixtures.url.page(2)] }], focused: "main", settings: { warnBeforeQuitting: false } });
    const first = await startDesktopBrowser(t, desktop, { name: "fullscreen", session: seed });
    let before;
    await t.check("the window moved to the second output and made fullscreen with the window manager's key is stamped fullscreen", async () => {
      const main = await titled(desktop, "Acceptance page 1");
      await desktop.command(`[con_id=${main.id}] move container to output HEADLESS-2`);
      await desktop.command(`[con_id=${main.id}] focus`);
      await focusShellWindow(desktop, first.shell, (await desktop.windows()).find((w) => w.id === main.id)).catch(() => {});
      await desktop.command(`[con_id=${main.id}] fullscreen enable`);
      before = await until(async () => {
        const w = (await desktop.windows()).find((x) => x.id === main.id);
        return w?.fullscreen && w.output === "HEADLESS-2" ? w : false;
      }, { timeout: 10000, label: "the window fullscreen on HEADLESS-2" }).catch(async (error) => {
        await desktopShot(t, desktop, "fullscreen-failed");
        throw new Error(`${error.message}; windows ${JSON.stringify(await desktop.windows())}`);
      });
      const stamp = await first.shell.waitState("return s.windows[windowId]?.fullScreen ?? null;", { timeout: 10000, label: "the store's fullscreen stamp" });
      await desktopShot(t, desktop, "before-quit");
      return { output: before.output, stamp };
    }, { critical: true });
    await t.check("quitting with Ctrl+Shift+Q saves the fullscreen window", async () => {
      await waitFocused(desktop, (w) => w.id === before.id, { label: "the fullscreen window focused before quitting" });
      await desktop.key("ctrl+shift+q");
      await until(() => first.app.exited, { timeout: 30000, label: "Ardia to quit" });
      await t.stop(first.app);
      return { exitCode: first.app.exitCode };
    }, { critical: true });
    await desktop.command("focus output HEADLESS-1");
    const again = await startDesktopBrowser(t, desktop, { scratch: first.scratch, label: "relaunch" });
    let restored;
    await t.check("after relaunch the window is fullscreen again", async () => {
      restored = await until(async () => {
        const w = (await desktop.windows()).find((x) => x.title.includes("Acceptance page 1"));
        return w?.fullscreen ? w : false;
      }, { timeout: 20000, label: "the restored window to be fullscreen" });
      await desktopShot(t, desktop, "after-relaunch");
      return { output: restored.output };
    });
    await t.check("after relaunch the fullscreen window is on the second output", async () => {
      await delay(1500);
      const w = restored ?? (await titled(desktop, "Acceptance page 1"));
      if (w.output !== "HEADLESS-2") throw new Error(`restored on ${w.output}, saved on HEADLESS-2; outputs ${JSON.stringify(await desktop.outputs())}`);
      return { output: w.output };
    });
    await t.check("after relaunch the window that had focus has it again", async () => {
      const w = await titled(desktop, "Acceptance page 1");
      const focused = await waitFocused(desktop, (x) => x.id === w.id, { timeout: 8000, label: "the restored fullscreen window focused" }).catch(async () => { throw new Error(`focused: ${(await desktop.focused())?.title}`); });
      return { focused: focused.title };
    });
    await t.stop(again.app);
  },
};
