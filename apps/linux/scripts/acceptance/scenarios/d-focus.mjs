import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectCdp, evaluate, fetchJson } from "../lib/cdp.mjs";
import { SOFTWARE_GL, focusShellWindow, pointAt, visibleField } from "../lib/desktopSession.mjs";
import { liveRequest, openLiveHyprland } from "../lib/liveHyprland.mjs";
import { commandBarText, desktopShot, desktopUnavailable, hasFocus, newWindow, openDesktop, startDesktopBrowser, waitFocused, waitTyped } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const PAGE_TITLE = (n) => `Acceptance page ${n}`;

async function focusWindow(desktop, window, shell) {
  await desktop.raise(window).catch(() => {});
  const field = shell ? await visibleField(shell) : null;
  if (field) await pointAt(desktop, window, field);
  await delay(300);
}


async function clickedIntoFocus(desktop, shell) {
  if (await hasFocus(shell)) return;
  const window = await desktop.focused();
  if (!window) throw new Error("no window is focused in the compositor");
  await focusWindow(desktop, window, shell);
  await until(() => hasFocus(shell), { timeout: 5000, label: "focus after clicking into the window" }).catch(() => {});
}

export const CALIBRATION_UNAVAILABLE = "stock Chromium isn't installed (set ARDIA_ACCEPTANCE_CHROMIUM), so a failing check here can't be told apart from a harness fault";

export async function calibrate(t, desktop, label, { ctrlN = false } = {}) {
  const chromium = process.env.ARDIA_ACCEPTANCE_CHROMIUM ?? "/usr/bin/chromium";
  if (!(await access(chromium, constants.X_OK).then(() => true, () => false))) {
    t.manual(`${label}: calibration with stock Chromium`, ["Install Chromium and rerun: stock Chromium must take focus at launch and receive typing in the same session."], CALIBRATION_UNAVAILABLE);
    return;
  }
  const dir = await t.scratch("calibration");
  const proc = desktop.spawn(chromium, [`--user-data-dir=${dir}`, `--ozone-platform=${desktop.kind === "x11" ? "x11" : "wayland"}`, "--no-first-run", "--no-default-browser-check", "--password-store=basic", "--disable-extensions", "--remote-debugging-port=0", ...SOFTWARE_GL, "data:text/html,<title>calibration</title><input autofocus>"], { name: "calibration-chromium", env: { HOME: join(dir, "home") } });
  const stopChromium = async () => {
    try { process.kill(-proc.child.pid, "SIGTERM"); } catch {}
    for (let waited = 0; !proc.state.exited && waited < 3000; waited += 100) await delay(100);
    try { process.kill(-proc.child.pid, "SIGKILL"); } catch {}
  };
  t.defer(stopChromium);
  const pages = async () => {
    const port = await until(() => readFile(join(dir, "DevToolsActivePort"), "utf8").then((text) => text.split("\n")[0] || false, () => false), { timeout: 20000, label: "stock Chromium's DevTools port" });
    return fetchJson(`http://127.0.0.1:${port}/json/list`, 3000);
  };
  try {
    await t.check(`${label}: calibration: stock Chromium in the same session takes focus at launch and receives typing`, async () => {
      const page = await until(async () => (await pages()).find((p) => p.type === "page" && p.url.startsWith("data:")) ?? false, { timeout: 20000, label: "stock Chromium's page" });
      const session = await connectCdp(page.webSocketDebuggerUrl);
      try {
        await until(() => evaluate(session, "document.hasFocus()", { userGesture: false }), { timeout: 10000, label: "stock Chromium's focus at launch" });
        await desktop.type("cal");
        const value = await until(() => evaluate(session, "document.querySelector('input').value", { userGesture: false }).then((v) => v === "cal" && v), { timeout: 5000, label: "typing in stock Chromium" });
        return { value };
      } finally {
        await session.close().catch(() => {});
      }
    });
    if (ctrlN) {
      await t.check(`${label}: calibration: stock Chromium's Ctrl+N window takes typing once the compositor focuses it`, async () => {
        const known = await desktop.windows();
        await desktop.key("ctrl+n");
        const window = await newWindow(desktop, known, { label: "stock Chromium's Ctrl+N window" });
        await waitFocused(desktop, (w) => w.id === window.id, { label: "stock Chromium's Ctrl+N window focused" });
        await desktop.type("data:text/html,<title>calnew</title>");
        await desktop.tap("return");
        const page = await until(async () => (await pages()).find((p) => p.type === "page" && p.title === "calnew") ?? false, { timeout: 10000, label: "the address typed into the new window to load" });
        return { title: page.title };
      });
    }
  } finally {
    await stopChromium();
  }
}

async function ctrlNFocused(desktop) {
  const known = await desktop.windows();
  await desktop.key("ctrl+n");
  const window = await newWindow(desktop, known, { label: "the Ctrl+N window in the compositor" });
  await waitFocused(desktop, (w) => w.id === window.id, { label: "the Ctrl+N window focused in the compositor" });
  return window;
}

async function newShell(app, known, { timeout = 30000 } = {}) {
  const id = await until(async () => {
    const shells = (await app.shells()).filter((s) => s.ready && !known.includes(s.windowId));
    return shells[0]?.windowId ?? false;
  }, { timeout, label: "the new window's renderer", abort: () => app.exitReason() });
  return app.shell(id, { timeout });
}

async function liveIds(app) {
  return (await app.shells()).map((s) => s.windowId);
}

function focusChecks({ x11, open, label: named, backgroundWindow = true }) {
  const label = named ?? (x11 ? "X11" : "sway");
  return async (t) => {
    const desktop = open ? await open(t) : await openDesktop(t, { x11 });
    await calibrate(t, desktop, label, { ctrlN: true });
    const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "second", urls: [t.fixtures.url.page(2)] }], focused: "main" });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "focus", session });
    const second = await app.shell("second", { timeout: 25000 });
    let mainWindow;
    await t.check(`${label}: the focused window of a restored session comes to the front and the back window stays behind`, async () => {
      mainWindow = await waitFocused(desktop, (w) => w.title.includes(PAGE_TITLE(1)), { timeout: 15000, label: `${PAGE_TITLE(1)} focused in the compositor` });
      await until(() => hasFocus(shell), { timeout: 8000, label: "document focus in the restored focused window" });
      if (await hasFocus(second)) throw new Error("the back window reports focus too");
      await desktopShot(t, desktop, `${label}-restored`);
      return { focused: mainWindow.title, windows: (await desktop.windows()).map((w) => w.title) };
    });
    mainWindow ??= (await desktop.windows()).find((w) => w.title.includes(PAGE_TITLE(1)));
    let created;
    let createdWindow;
    await t.check(`${label}: Ctrl+N opens a window the compositor focuses`, async () => {
      await focusWindow(desktop, mainWindow, shell);
      await waitFocused(desktop, (w) => w.id === mainWindow.id, { label: "the first window focused in the compositor after clicking it" });
      const known = await desktop.windows();
      const ids = await liveIds(app);
      await desktop.key("ctrl+n");
      createdWindow = await newWindow(desktop, known, { label: "the Ctrl+N window in the compositor" });
      await waitFocused(desktop, (w) => w.id === createdWindow.id, { label: "the Ctrl+N window focused in the compositor" });
      await desktop.type("abc");
      created = await newShell(app, ids);
      return { window: created.windowId, title: createdWindow.title };
    }, { critical: true });
    await t.check(`${label}: typing as soon as the compositor focuses the Ctrl+N window lands in its command bar`, async () => {
      const typed = await waitTyped(created, "abc").catch(async (error) => {
        throw new Error(`${error.message}; new window ${JSON.stringify(await commandBarText(created))} (document focus ${await hasFocus(created)}), first window ${JSON.stringify(await commandBarText(shell))}`);
      });
      const old = await commandBarText(shell);
      if (old.fields.some((f) => f.includes("abc"))) throw new Error(`the first window received the keys: ${JSON.stringify(old)}`);
      if (await hasFocus(shell)) throw new Error("the first window still reports focus");
      return { typed: typed.active };
    });
    await desktopShot(t, desktop, `${label}-ctrl-n`);
    if (backgroundWindow) await t.check(`${label}: a window the app opens in the background takes no focus`, async () => {
      await clickedIntoFocus(desktop, created);
      const before = await desktop.focused();
      const known = await desktop.windows();
      const id = await created.state("return s.createWindow({ background: true });");
      const background = await app.shell(id, { timeout: 20000 });
      const window = await newWindow(desktop, known, { label: "the background window in the compositor" });
      await delay(1500);
      const after = await desktop.focused();
      if (after?.id === window.id) throw new Error("the compositor focused the background window");
      if (await hasFocus(background)) throw new Error("the background window reports focus");
      if (after?.id !== before?.id) throw new Error(`focus moved from ${before?.title} to ${after?.title}`);
      if (!(await hasFocus(created))) throw new Error("the focused window lost document focus");
      return { id, focused: after?.title ?? null };
    });
    await t.check(`${label}: Settings opens in front with keyboard focus and reopening focuses it`, async () => {
      await clickedIntoFocus(desktop, created);
      const known = await desktop.windows();
      await desktop.key("ctrl+comma");
      const settings = await app.shell("settings", { timeout: 20000 });
      const window = await newWindow(desktop, known, { label: "the Settings window in the compositor" });
      await waitFocused(desktop, (w) => w.id === window.id, { label: "Settings focused in the compositor" });
      await until(() => hasFocus(settings), { timeout: 8000, label: "document focus in Settings (the compositor focused it)" });
      const back = (await desktop.windows()).find((w) => w.title.includes(PAGE_TITLE(1))) ?? mainWindow;
      await focusWindow(desktop, back, shell);
      await until(() => hasFocus(shell), { timeout: 5000, label: "focus back in the first window" });
      const count = (await desktop.windows()).length;
      await desktop.key("ctrl+comma");
      await waitFocused(desktop, (w) => w.id === window.id, { label: "Settings focused again" });
      await until(() => hasFocus(settings), { timeout: 8000, label: "document focus in Settings again" });
      if ((await desktop.windows()).length !== count) throw new Error("reopening Settings opened another window");
      await desktopShot(t, desktop, `${label}-settings`);
      return { settings: window.title };
    });
    if (desktop.kind === "x11") await t.check(`${label}: a background instance never activates`, async () => {
      const before = await desktop.focused();
      const hidden = await startDesktopBrowser(t, desktop, { name: "hidden", background: true });
      await delay(3000);
      const after = await desktop.focused();
      if (after?.id !== before?.id) throw new Error(`focus moved from ${before?.title} to ${after?.title}`);
      if (await hasFocus(hidden.shell)) throw new Error("the background instance's window reports focus");
      await t.stop(hidden.app);
      return { focused: after?.title ?? null };
    });
  };
}

const MANUAL_LINK = { name: "A link from another app doesn't steal focus", steps: ["With another app focused, open a link in Ardia from it (xdg-open).", "Ardia opens the link without taking focus, unless it needs a new foreground window."], reason: "needs a second desktop application handing Ardia a link through its own activation token" };
const MANUAL_IMPORT = { name: "Import comes to the front", steps: ["With a browser window focused, open File › Import.", "It opens in front and has keyboard focus."], reason: "Import has no keyboard route to drive, only a menu row" };
const MANUAL_HYPRLAND_BACKGROUND_WINDOW = { name: "Hyprland: a window the app opens in the background takes no focus", steps: ["On the logged-in Hyprland, focus an Ardia window and have it open a window in the background (the store's createWindow({ background: true }), as F22D does).", "Expected on Hyprland: the compositor may focus the new window when it maps. Record where keyboard focus ends up; on sway and X11 it stays in the window you were using."], reason: "Hyprland focuses every newly mapped toplevel and a Wayland client can't refuse it, so this isn't asserted live; F22D and F22X check it on sway and X11" };

function focusScenario({ id, x11 }) {
  return {
    id,
    issue: 32,
    desktop: true,
    title: `New windows take focus and keyboard input in a private ${x11 ? "Xvfb X11" : "headless sway"} session`,
    deadline: 300000,
    manual: [MANUAL_LINK, MANUAL_IMPORT],
    async run(t) {
      const missing = await desktopUnavailable({ x11 });
      if (missing) {
        t.manual(`${x11 ? "X11" : "sway"}: new windows take focus and typing`, ["Press Ctrl+N and type 'abc' at once: the new window is in front and holds 'abc'.", "A restored back window stays behind on relaunch, an ARDIA_BACKGROUND=1 instance never activates, and Settings opens in front with keyboard focus."], missing);
        return;
      }
      await focusChecks({ x11 })(t);
    },
  };
}

export const f22Sway = focusScenario({ id: "F22D", x11: false });
export const f22X11 = focusScenario({ id: "F22X", x11: true });

const LIVE_REASON = "a live-session check: set ARDIA_ACCEPTANCE_LIVE_HYPRLAND to the Hyprland instance signature to run it on an empty workspace of the logged-in session";

export const f22Hyprland = {
  id: "F22H",
  issue: 32,
  desktop: true,
  live: true,
  title: "New windows take focus and keyboard input on the logged-in Hyprland (workspace 9, private buses)",
  deadline: 300000,
  manual: [MANUAL_LINK, MANUAL_IMPORT, MANUAL_HYPRLAND_BACKGROUND_WINDOW],
  async run(t) {
    const request = liveRequest();
    if (!request) {
      t.manual("Hyprland: new windows take focus and typing", ["On Hyprland, press Ctrl+N and type 'abc' at once: the new window is in front and holds 'abc'.", "A restored back window stays behind, a background instance never activates, and Settings opens in front with keyboard focus."], LIVE_REASON);
      return;
    }
    await focusChecks({ open: (t2) => openLiveHyprland(t2, request), label: "Hyprland", backgroundWindow: false })(t);
  },
};

function launchTypingScenario({ id, x11, live = false }) {
  const label = live ? "Hyprland" : x11 ? "X11" : "sway";
  return {
    id,
    issue: 79,
    desktop: true,
    title: `Typing at launch and right after Ctrl+N reaches the new window's command bar (${label})`,
    deadline: 240000,
    async run(t) {
      const request = live ? liveRequest() : null;
      const missing = live ? (request ? null : LIVE_REASON) : await desktopUnavailable({ x11 });
      if (missing) {
        t.manual(`${label}: typing at launch`, ["Launch Ardia and type at once: the command bar holds the text."], missing);
        return;
      }
      const desktop = live ? await openLiveHyprland(t, request) : await openDesktop(t, { x11 });
      await calibrate(t, desktop, label, { ctrlN: true });
      const launching = startDesktopBrowser(t, desktop, { name: "launch-typing", session: sessionSeed() });
      await t.check(`${label}: typing at launch reaches the first window's command bar`, async () => {
        await until(async () => (await desktop.windows()).length > 0, { timeout: 30000, interval: 50, label: "the first window to map" });
        await desktop.type("xyz");
        const { shell } = await launching;
        const typed = await waitTyped(shell, "xyz").catch(async (error) => {
          throw new Error(`${error.message}; ${JSON.stringify(await commandBarText(shell))}, document focus ${await hasFocus(shell)}, compositor focus ${JSON.stringify(await desktop.focused())}`);
        });
        await desktopShot(t, desktop, `${label}-launch-typing`);
        return { typed: typed.active };
      });
      const { app, shell } = await launching;
      const firstWindow = (await desktop.windows())[0];
      await t.check(`${label}: typing as soon as the compositor focuses the Ctrl+N window reaches its command bar`, async () => {
        await clickedIntoFocus(desktop, shell);
        const ids = await liveIds(app);
        await ctrlNFocused(desktop);
        await desktop.type("abc");
        const created = await newShell(app, ids);
        const typed = await waitTyped(created, "abc").catch(async (error) => {
          throw new Error(`${error.message}; new window ${JSON.stringify(await commandBarText(created))}, first window ${JSON.stringify(await commandBarText(shell))}`);
        });
        return { typed: typed.active };
      });
      if (x11) return;
      const keyLabel = live ? "Hyprland" : "sway";
      const composed = async (shellTo, keymap, keys) => {
        await desktop.keymap(keymap);
        try {
          for (const key of keys) await desktop.tap(key);
          return await waitTyped(shellTo, "é", { timeout: 5000 }).then((state) => state.active, async () => JSON.stringify(await commandBarText(shellTo)));
        } finally {
          await desktop.keymap({});
        }
      };
      await t.check(`${keyLabel}: a dead key and a compose sequence each type é once in a clicked command bar`, async () => {
        const target = shell;
        await focusShellWindow(desktop, target, firstWindow);
        await focusWindow(desktop, firstWindow, target);
        await desktop.key("ctrl+a");
        await desktop.tap("backspace");
        const dead = await composed(target, { layout: "us", variant: "intl" }, ["apostrophe", "e"]);
        await desktop.key("ctrl+a");
        await desktop.tap("backspace");
        const compose = await composed(target, { layout: "us", options: "compose:ralt" }, ["ralt", "apostrophe", "e"]);
        if (dead !== "é" || compose !== "é") throw new Error(`dead key gave ${dead}, compose gave ${compose}`);
        return { dead, compose };
      });
      await t.check(`${keyLabel}: a dead key as soon as the compositor focuses the Ctrl+N window puts é exactly once in its command bar`, async () => {
        await focusShellWindow(desktop, shell, firstWindow);
        const ids = await liveIds(app);
        await desktop.keymap({ layout: "us", variant: "intl" });
        try {
          await ctrlNFocused(desktop);
          await desktop.tap("apostrophe");
          await desktop.tap("e");
        } finally {
          await desktop.keymap({});
        }
        const created = await newShell(app, ids);
        const typed = await waitTyped(created, "é").catch(async (error) => {
          throw new Error(`${error.message}; new window ${JSON.stringify(await commandBarText(created))}, first window ${JSON.stringify(await commandBarText(shell))}`);
        });
        if (typed.active !== "é") throw new Error(`the new field holds ${JSON.stringify(typed.active)}`);
        return { typed: typed.active };
      });
    },
  };
}

export const w79Sway = launchTypingScenario({ id: "W79D", x11: false });
export const w79X11 = launchTypingScenario({ id: "W79X", x11: true });
export const w79Hyprland = { ...launchTypingScenario({ id: "W79H", x11: false, live: true }), live: true, title: "Typing at launch, after Ctrl+N and with dead and compose keys on the logged-in Hyprland (workspace 9, private buses)" };
