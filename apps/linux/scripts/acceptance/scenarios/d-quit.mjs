import { setTimeout as delay } from "node:timers/promises";
import { PROMPT_DIFF, desktopShot, desktopUnavailable, focusShellWindow, inside, openDesktop, pointAt, pressInPrompt, promptAfter, promptLike, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";
import { changedCells, regions } from "../lib/desktop.mjs";

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const QUIT_TITLE = "Are you sure you want to quit Ardia?";
const twoWindows = (t, settings) => sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "second", urls: [t.fixtures.url.page(2)] }], focused: "main", settings });
const browserWindows = async (app) => (await app.shells()).filter((s) => !s.utility).length;

async function windowTitled(desktop, text) {
  return until(async () => {
    const windows = await desktop.windows();
    return windows.find((w) => w.title.includes(text)) ?? false;
  }, { timeout: 15000, label: `the window titled ${text}` }).catch(async (error) => {
    throw new Error(`${error.message}; windows ${JSON.stringify((await desktop.windows()).map((w) => w.title))}`);
  });
}

async function quitsWithin(app, timeout = 30000) {
  await until(() => app.exited, { timeout, label: "Ardia to quit" });
  return app.exitCode;
}

export default {
  id: "Q221D",
  issue: 221,
  desktop: true,
  title: "The visible quit prompt and the downloads prompt, answered with the keyboard in a private sway session",
  deadline: 420000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("The visible quit prompt", ["In Settings › General turn on Warn before quitting, open two windows and press Ctrl+Shift+Q.", "One prompt appears over the focused window only, with Quit, Cancel and Don't ask again; pressing Ctrl+Shift+Q again raises no second prompt.", "Cancel keeps both windows; Don't ask again and Quit quits, and after relaunch both windows return with the toggle off."], missing);
      t.manual("Active downloads ask before quitting", ["Start a large download, then press Ctrl+Shift+Q: one prompt names the download in progress.", "Cancel keeps Ardia and the download running; Quit quits with no second dialog.", "With a download running, SIGTERM quits without asking and the windows restore."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const warned = await startDesktopBrowser(t, desktop, { name: "warned", session: twoWindows(t, { warnBeforeQuitting: true }) });
    await until(async () => (await browserWindows(warned.app)) >= 2, { timeout: 25000, label: "both windows", abort: () => warned.app.exitReason() });
    const main = await windowTitled(desktop, "Acceptance page 1");
    const second = await windowTitled(desktop, "Acceptance page 2");
    let prompt;
    let beforePrompt;
    await t.check("Ctrl+Shift+Q shows one quit prompt over the focused window and no per-window close prompt", async () => {
      await focusShellWindow(desktop, warned.shell, main).catch(() => {});
      const parent = await waitFocused(desktop, (w) => w.title.includes("Acceptance page"), { label: "a browser window focused" });
      const { region, before } = await promptAfter(desktop, () => desktop.key("ctrl+shift+q"), { settle: 2000 });
      beforePrompt = before;
      await desktopShot(t, desktop, "quit-prompt");
      if (!promptLike(region)) throw new Error(`no prompt-sized change on screen after Ctrl+Shift+Q: ${JSON.stringify(region)}`);
      const all = await desktop.windows();
      const closePrompts = all.filter((w) => /^Close \d+ tabs\?/.test(w.title));
      if (closePrompts.length) throw new Error(`per-window close prompt: ${closePrompts.map((w) => w.title)}`);
      if (!inside(region, parent.rect)) throw new Error(`the prompt ${JSON.stringify(region)} is not over the focused window ${JSON.stringify(parent.rect)}`);
      if (warned.app.exited) throw new Error("Ardia quit without waiting for an answer");
      prompt = region;
      return { prompt: region, parent: parent.rect };
    }, { critical: true });
    await t.check("Ctrl+Shift+Q again from the other window raises no second prompt", async () => {
      const shell2 = await warned.app.shell("second", { timeout: 20000 });
      await desktop.raise(second);
      await waitFocused(desktop, (w) => w.id === second.id, { label: "the second window focused in the compositor before the shortcut" });
      const { all } = await promptAfter(desktop, () => desktop.key("ctrl+shift+q"), { settle: 2000 });
      await desktopShot(t, desktop, "quit-prompt-again");
      const secondRect = (await desktop.windows()).find((w) => w.id === second.id)?.rect ?? second.rect;
      const extra = all.filter((r) => promptLike(r) && (inside(r, secondRect) || !inside(r, prompt)));
      if (extra.length) throw new Error(`a second prompt-sized change appeared: ${JSON.stringify(extra)}`);
      if (!(await waitFocused(desktop, (w) => w.id === second.id, { timeout: 2000, label: "the second window still focused" }).catch(() => null))) throw new Error("focus left the second window, so the shortcut may not have reached it");
      return { changes: all, focus: await shell2.eval("document.hasFocus()").catch(() => null) };
    });
    await t.check("Escape cancels: the prompt closes and both windows and their tabs stay open", async () => {
      const { region } = await promptAfter(desktop, () => pressInPrompt(desktop, prompt, ["escape"]), { settle: 1500 });
      if (!region || !inside(region, { x: prompt.x - 20, y: prompt.y - 20, width: prompt.width + 40, height: prompt.height + 40 })) throw new Error(`the prompt did not close: change ${JSON.stringify(region)}`);
      const now = await desktop.capture();
      const leftover = regions(changedCells(beforePrompt, now, PROMPT_DIFF), PROMPT_DIFF).filter((r) => overlaps(r, prompt));
      if (leftover.length) throw new Error(`the prompt's area still differs from before the prompt: ${JSON.stringify(leftover)}`);
      if (warned.app.exited) throw new Error(warned.app.exitReason());
      const windows = await browserWindows(warned.app);
      if (windows < 2) throw new Error(`${windows} browser windows after Cancel`);
      if (!(await warned.shell.state("return s.settings.warnBeforeQuitting"))) throw new Error("Cancel changed the setting");
      return { windows };
    });
    await t.check("Don't ask again and Quit quits; both windows restore and the warning is off", async () => {
      await focusShellWindow(desktop, warned.shell, main).catch(() => {});
      const { region } = await promptAfter(desktop, () => desktop.key("ctrl+shift+q"), { settle: 2000 });
      if (!promptLike(region)) throw new Error(`no prompt after Ctrl+Shift+Q: ${JSON.stringify(region)}`);
      await pressInPrompt(desktop, region, ["shift+tab", "shift+tab", "space"]);
      await desktopShot(t, desktop, "quit-prompt-suppressed");
      await desktop.key("tab");
      await desktop.key("tab");
      await desktop.key("return");
      const code = await quitsWithin(warned.app);
      await t.stop(warned.app);
      const again = await startDesktopBrowser(t, desktop, { scratch: warned.scratch, label: "relaunch" });
      await until(async () => (await browserWindows(again.app)) >= 2, { timeout: 25000, label: "both windows to restore", abort: () => again.app.exitReason() });
      const warning = await again.shell.state("return s.settings.warnBeforeQuitting");
      await t.stop(again.app);
      if (warning !== false) throw new Error(`warnBeforeQuitting is ${warning} after Don't ask again`);
      return { exitCode: code };
    });
    const folder = await t.scratch("downloads");
    const busy = await startDesktopBrowser(t, desktop, { name: "downloads", session: twoWindows(t, { warnBeforeQuitting: false }), preferences: { downloads: folder }, extraArgs: [`--ardia-downloads-dir=${folder}`] });
    const slowName = `quit-${Date.now()}.bin`;
    await t.check("with a download running, Ctrl+Shift+Q asks once and Cancel keeps Ardia and the download running", async () => {
      const tab = await busy.shell.activeTabId();
      await busy.shell.navigate(tab, t.fixtures.url.slow(slowName, 8 << 20));
      await until(async () => (await busy.shell.invoke("ArdiaShell.downloadsInProgress", { args: [] }))?.value === 1, { timeout: 20000, label: "one download in progress" });
      const window = await windowTitled(desktop, "Acceptance page 2");
      const shell2 = await busy.app.shell("second", { timeout: 20000 });
      await focusShellWindow(desktop, shell2, window).catch(() => {});
      const { region } = await promptAfter(desktop, () => desktop.key("ctrl+shift+q"), { settle: 2000 });
      await desktopShot(t, desktop, "downloads-prompt");
      if (!promptLike(region)) throw new Error(`no prompt-sized change after Ctrl+Shift+Q: ${JSON.stringify(region)}`);
      if (!inside(region, window.rect)) throw new Error(`the prompt ${JSON.stringify(region)} is not over the focused window`);
      await pressInPrompt(desktop, region, ["escape"]);
      await delay(1500);
      if (busy.app.exited) throw new Error(busy.app.exitReason());
      const count = await busy.shell.invoke("ArdiaShell.downloadsInProgress", { args: [] });
      if (count?.value !== 1) throw new Error(`downloads in progress after Cancel: ${JSON.stringify(count)}`);
      return { downloads: count.value };
    });
    await t.check("Quit from the downloads prompt quits with no second download dialog", async () => {
      const window = (await desktop.windows()).find((w) => w.title.includes("Acceptance page 2")) ?? (await desktop.windows())[0];
      const shell2 = await busy.app.shell("second", { timeout: 20000 });
      await desktop.raise(window);
      await desktop.key("escape");
      await focusShellWindow(desktop, shell2, window).catch(() => {});
      const before = new Set((await desktop.windows()).map((w) => w.id));
      const { region } = await promptAfter(desktop, () => desktop.key("ctrl+shift+q"), { settle: 2000 });
      if (!promptLike(region)) throw new Error(`no prompt-sized change after Ctrl+Shift+Q: ${JSON.stringify(region)}`);
      await desktopShot(t, desktop, "downloads-quit-prompt");
      await pressInPrompt(desktop, region, ["return"]);
      await delay(1000);
      await desktopShot(t, desktop, "downloads-quit-answered");
      const seen = [];
      const watching = (async () => {
        while (!busy.app.exited) {
          for (const w of await desktop.windows().catch(() => [])) if (!before.has(w.id) && !seen.some((s) => s.id === w.id)) seen.push(w);
          await delay(100);
        }
      })();
      const code = await quitsWithin(busy.app, 15000).catch(async (error) => {
        await desktopShot(t, desktop, "downloads-quit-stuck");
        const left = await busy.shell.invoke("ArdiaShell.downloadsInProgress", { args: [] }).catch(() => null);
        throw new Error(`${error.message}; prompt at ${JSON.stringify(region)}, downloads in progress ${JSON.stringify(left?.value ?? left)}, windows ${await browserWindows(busy.app).catch(() => "?")}`);
      });
      await watching;
      await t.stop(busy.app);
      if (seen.length) throw new Error(`another window appeared while quitting: ${seen.map((w) => w.title).join(", ")}`);
      return { exitCode: code };
    });
    await t.check("SIGTERM with a download running quits without asking and restores both windows", async () => {
      if (!busy.app.exited) await t.stop(busy.app);
      const again = await startDesktopBrowser(t, desktop, { scratch: busy.scratch, label: "sigterm", preferences: { downloads: folder }, extraArgs: [`--ardia-downloads-dir=${folder}`] });
      await until(async () => (await browserWindows(again.app)) >= 2, { timeout: 25000, label: "both windows", abort: () => again.app.exitReason() });
      const tab = await again.shell.activeTabId();
      await again.shell.navigate(tab, t.fixtures.url.slow(`term-${slowName}`, 8 << 20));
      await until(async () => (await again.shell.invoke("ArdiaShell.downloadsInProgress", { args: [] }))?.value === 1, { timeout: 20000, label: "one download in progress" });
      process.kill(again.app.child.pid, "SIGTERM");
      const code = await quitsWithin(again.app, 15000).catch(async (error) => {
        await desktopShot(t, desktop, "sigterm-stuck");
        throw error;
      });
      await t.stop(again.app);
      const restored = await startDesktopBrowser(t, desktop, { scratch: busy.scratch, label: "after-sigterm" });
      await until(async () => (await browserWindows(restored.app)) >= 2, { timeout: 25000, label: "both windows to restore", abort: () => restored.app.exitReason() });
      await t.stop(restored.app);
      return { exitCode: code };
    });
  },
};
