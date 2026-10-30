import { startBrowser } from "../lib/flows.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, until } from "../lib/util.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reloadShell(app, shell) {
  await shell.eval("setTimeout(() => location.reload(), 0), true");
  await delay(1500);
  return app.shell(shell.windowId, { timeout: 25000 });
}

async function nativeWindowState(app, shell) {
  const windowId = await shell.nativeWindowId();
  const { bounds } = await app.browser.send("Browser.getWindowBounds", { windowId });
  return bounds.windowState;
}

export const w92 = {
  id: "W92",
  issue: 92,
  title: "A new or reloaded renderer never closes live windows its bootstrap session predates",
  deadline: 240000,
  async run(t) {
    const { app, shell } = await startBrowser(t, { name: "sweep" });
    await t.check("a window opened inside the session save delay survives a reloaded renderer", async () => {
      const id = await shell.state("return s.createWindow({ background: true });");
      if (typeof id !== "string") throw new Error(`createWindow returned ${JSON.stringify(id)}`);
      const reloaded = await reloadShell(app, shell);
      await until(async () => (await app.shells()).some((s) => s.windowId === id && s.ready), { timeout: 25000, label: "the new window's renderer" });
      await delay(3000);
      const ids = await reloaded.windowIds();
      if (!ids.includes(id)) throw new Error(`the reloaded renderer closed ${id}; live windows ${JSON.stringify(ids)}`);
      return { id, ids };
    }, { critical: true });
    await t.check("a Little Ardia window survives a new window's startup sweep", async () => {
      const main = await app.shell(shell.windowId, { timeout: 20000 });
      const small = await main.state(`return s.createWindow({ kind: "small", url: ${js(t.fixtures.url.page(1))} });`);
      await until(async () => (await main.windowIds()).includes(small), { timeout: 20000, label: "the Little Ardia window" });
      const opened = await main.state("return s.createWindow();");
      await app.shell(opened, { timeout: 25000 });
      await delay(3000);
      const ids = await main.windowIds();
      if (!ids.includes(small)) throw new Error(`the new renderer closed Little Ardia ${small}`);
      return { small, opened, ids };
    });
  },
};

export const w77 = {
  id: "W77",
  issue: 77,
  title: "A window saved in fullscreen is restored to fullscreen at launch",
  deadline: 180000,
  async run(t) {
    const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "second", urls: [t.fixtures.url.page(2)] }], focused: "main" });
    session.windows.main.fullScreen = 1;
    const { app, shell } = await startBrowser(t, { name: "fullscreen", session });
    await t.check("the saved fullscreen window enters fullscreen", async () => {
      const state = await until(async () => (await nativeWindowState(app, shell)) === "fullscreen" ? "fullscreen" : false, { timeout: 20000, label: "the main window to enter fullscreen" });
      const stamp = await shell.state("return s.windows[windowId]?.fullScreen ?? null;");
      if (!stamp) throw new Error("the store lost the window's fullscreen stamp");
      return { state, stamp };
    }, { critical: true });
    await t.check("the other restored window stays windowed", async () => {
      const second = await app.shell("second", { timeout: 25000 });
      await delay(1500);
      const state = await nativeWindowState(app, second);
      if (state === "fullscreen") throw new Error("a window saved windowed was made fullscreen");
      return { state };
    });
    await t.check("a later renderer does not restore fullscreen again", async () => {
      const windowId = await shell.nativeWindowId();
      await app.browser.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await until(async () => (await nativeWindowState(app, shell)) !== "fullscreen", { timeout: 10000, label: "the window to leave fullscreen" });
      const opened = await shell.state("return s.createWindow({ background: true });");
      await app.shell(opened, { timeout: 25000 });
      await delay(2000);
      const state = await nativeWindowState(app, shell);
      if (state === "fullscreen") throw new Error("a new window's renderer restored fullscreen again");
      return { state };
    });
  },
};

export const w79 = {
  id: "W79",
  issue: 79,
  title: "Keys typed before a new window's UI is ready are kept and replayed",
  deadline: 120000,
  manual: [
    { name: "Ctrl+N then composed input (#154)", steps: ["With ibus or fcitx5 (X11) and with fcitx5 through text-input on Hyprland, enable a Japanese input method and focus an Ardia window.", "Press Ctrl+N and immediately type 'nihon', Space and Enter; repeat with a compose sequence (Compose, ', e) and a dead key (dead acute, e).", "The new tab's field holds the converted text, é and é exactly once each, nothing is doubled or garbled, and no IME candidate window opened before the field was ready. On Wayland with a compositor-side input method, keys typed before the field was ready arrive as the typed characters, not converted."], reason: "needs a real input method and keyboard" },
  ],
  async run(t) {
    const { app, shell } = await startBrowser(t, { name: "typeahead" });
    await t.check("text typed into the command bar right after launch stays in the field", async () => {
      const text = "ardia typed at launch";
      await shell.state("s.openPanel(windowId, ''); return true;");
      await shell.waitFor("document.activeElement?.tagName === 'INPUT'", { timeout: 6000, label: "command bar focus" });
      await shell.insertText(text);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const value = await shell.eval("document.activeElement?.value ?? null");
      if (value !== text) throw new Error(`the command bar holds ${JSON.stringify(value)} instead of ${JSON.stringify(text)}`);
      await shell.state("s.closePanel(windowId); return true;");
      return { value };
    });
    await t.check("new windows advertise held typeahead and report readiness", async () => {
      const id = await shell.state("return s.createWindow();");
      const created = await app.shell(id, { timeout: 25000 });
      const advertised = await created.eval("__ardiaHost.bootstrap.capabilities.includes('ArdiaShell.typeaheadReady')");
      if (!advertised) throw new Error("the host does not advertise ArdiaShell.typeaheadReady");
      const again = await created.invoke("ArdiaShell.typeaheadReady", { args: [false] });
      if (!again.ok) throw new Error(`typeaheadReady failed: ${again.code} ${again.message}`);
      return { id };
    });
    await t.check("Settings does not hold keys", async () => {
      await shell.command("openSettings");
      const settings = await app.shell("settings", { timeout: 20000 });
      const reply = await settings.invoke("ArdiaShell.typeaheadReady", { args: [false] });
      if (reply.ok) throw new Error("a utility window accepted typeaheadReady");
      return { code: reply.code, message: reply.message };
    });
  },
};

export const w114 = {
  id: "W114",
  issue: 114,
  title: "Site zoom levels are read and reset for the named profile, never a private one",
  deadline: 180000,
  async run(t) {
    const { app, shell } = await startBrowser(t, { name: "zoom" });
    const host = "zoom.ardia.test";
    let work;
    await t.check("an isolated profile's zoom is set and listed from Settings", async () => {
      work = await shell.state("return s.createProfile({ name: 'Work' });");
      await shell.command("openSettings");
      const settings = await app.shell("settings", { timeout: 20000 });
      const set = await settings.call("sites.setZoom", { host, zoom: 1.5 }, work);
      if (!set.ok) throw new Error(`setZoom for ${work} failed: ${set.code} ${set.message}`);
      const listed = await settings.call("sites.zoomLevels", {}, work);
      if (!listed.ok || listed.value[host] !== 1.5) throw new Error(`zoomLevels for ${work}: ${JSON.stringify(listed)}`);
      const regular = await settings.call("sites.zoomLevels", {}, "");
      if (!regular.ok || regular.value[host] !== undefined) throw new Error(`the default profile sees ${JSON.stringify(regular)}`);
      const reset = await settings.call("sites.setZoom", { host, zoom: 1 }, work);
      if (!reset.ok) throw new Error(`reset failed: ${reset.code}`);
      const after = await settings.call("sites.zoomLevels", {}, work);
      if (after.value[host] !== undefined) throw new Error(`reset left ${after.value[host]}`);
      return { work, listed: listed.value, regular: regular.value };
    }, { critical: true });
    await t.check("private profiles are refused for listing and writing", async () => {
      const name = "incognito:w-private@";
      const listed = await shell.call("sites.zoomLevels", {}, name);
      const written = await shell.call("sites.setZoom", { host, zoom: 2 }, name);
      if (listed.ok || written.ok) throw new Error(`a private profile was served: ${JSON.stringify({ listed, written })}`);
      for (const reply of [listed, written]) {
        const text = `${reply.code ?? ""} ${reply.message ?? ""}`;
        if (!/ERR_PROFILE_(PRIVATE|INVALID|WINDOW)/.test(text)) throw new Error(`unexpected refusal ${text}`);
      }
      return { listed: listed.code ?? listed.message, written: written.code ?? written.message };
    });
  },
};
