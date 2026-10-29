import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIND_WORD } from "../lib/fixtures.mjs";
import { restartBrowser, startBrowser, waitPageViewport } from "../lib/flows.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { FIXTURE_NAME, prepareExtension } from "./f09-extensions.mjs";

async function openWindow(state, body, label) {
  const windowId = await state.shell.state(body);
  if (typeof windowId !== "string") throw new Error(`${label} returned ${JSON.stringify(windowId)}`);
  const shell = await state.app.shell(windowId, { timeout: 25000 });
  return { windowId, shell };
}

const openPrivate = (state) => openWindow(state, `return s.createWindow({ kind: "private", profileId: "default" });`, "private window");

async function closeWindow(state, windowId) {
  const closing = await state.app.shell(windowId, { timeout: 10000 });
  await closing.state("s.updateSettings({ warnBeforeClosingWindow: false }); return true;");
  await state.shell.state(`s.closeWindow(${js(windowId)}); return true;`);
  await until(async () => !(await state.app.shells()).some((s) => s.windowId === windowId), { timeout: 15000, label: `${windowId} to close` });
}

async function ok(shell, name, args, profile) {
  const reply = await shell.call(name, args, profile);
  if (!reply.ok) throw new Error(`${name} failed: ${reply.code} ${reply.message}`);
  return reply.value;
}

async function refused(shell, name, args, profile, code) {
  const reply = await shell.call(name, args, profile);
  if (reply.ok || reply.code !== code) throw new Error(`${name} answered ${JSON.stringify(reply)} instead of ${code}`);
  return reply.code;
}

const downloadsOf = (shell) => shell.state("return s.downloads ?? [];");

const answerFileChooser = (state, path) => writeFile(join(state.scratch, "file-chooser.txt"), `${path}\n`);

async function waitDownload(shell, test, label, timeout = 25000) {
  return until(async () => (await downloadsOf(shell)).find(test) ?? false, { timeout, label });
}

async function readPreferences(scratch, directory) {
  try {
    return JSON.parse(await readFile(join(scratch, directory, "Preferences"), "utf8"));
  } catch {
    return null;
  }
}

const autoPip = (preferences) => preferences?.profile?.default_content_setting_values?.auto_picture_in_picture;

export const privateServices = {
  id: "F02-88",
  issue: 88,
  title: "Private-window site settings and zoom act on the off-the-record session only",
  deadline: 300000,
  async run(t) {
    const run = nonce("pv88");
    const state = await startBrowser(t, { name: "private-services" });
    const origin = new URL(t.fixtures.url.isolation(`settings-${run}.ardia.test`)).origin;
    const host = new URL(origin).hostname;
    let priv;
    await t.check("a private window's site setting reaches only its own session", async () => {
      priv = await openPrivate(state);
      const profile = priv.shell.pageProfile;
      await ok(priv.shell, "sites.setSetting", { origin, type: "camera", value: "allow", engine: "chromium" }, profile);
      const own = await ok(priv.shell, "sites.settings", { origin, engine: "chromium" }, profile);
      const regular = await ok(state.shell, "sites.settings", { origin, engine: "chromium" });
      if (own.camera?.value !== "allow") throw new Error(`private session reads ${JSON.stringify(own.camera)}`);
      if (regular.camera?.value === "allow" || regular.camera?.isDefault !== true) throw new Error(`regular profile reads ${JSON.stringify(regular.camera)}`);
      const origins = await ok(state.shell, "sites.origins", {});
      if (origins.includes(origin)) throw new Error("the private exception is listed by the regular profile");
      return { profile, own: own.camera, regular: regular.camera };
    }, { critical: true });
    await t.check("private zoom stays in the private session", async () => {
      await ok(priv.shell, "sites.setZoom", { host, zoom: 1.5 }, priv.shell.pageProfile);
      const own = await ok(priv.shell, "sites.zoomLevels", {}, priv.shell.pageProfile);
      const regular = await ok(state.shell, "sites.zoomLevels", {});
      if (own[host] !== 1.5) throw new Error(`private zoom ${JSON.stringify(own)}`);
      if (host in regular) throw new Error("the private zoom reached the regular profile");
      return { own: own[host] };
    });
    await t.check("services that keep no private data refuse explicitly", async () => {
      const history = await refused(priv.shell, "history.query", { text: "", maxResults: 5 }, priv.shell.pageProfile, "ERR_PROFILE_PRIVATE");
      const clearing = await refused(priv.shell, "profiles.clearBrowsingData", { types: ["cache"] }, priv.shell.pageProfile, "ERR_PROFILE_PRIVATE");
      return { history, clearing };
    });
    await t.check("a regular window cannot act on the private session", async () => {
      return refused(state.shell, "sites.settings", { origin, engine: "chromium" }, priv.shell.pageProfile, "ERR_PROFILE_WINDOW");
    });
    await t.check("the private session's settings end with its last window", async () => {
      await closeWindow(state, priv.windowId);
      const again = await openPrivate(state);
      const settings = await ok(again.shell, "sites.settings", { origin, engine: "chromium" }, again.shell.pageProfile);
      const zoom = await ok(again.shell, "sites.zoomLevels", {}, again.shell.pageProfile);
      await closeWindow(state, again.windowId);
      if (settings.camera?.value === "allow" || host in zoom) throw new Error(`private state survived ${JSON.stringify({ settings: settings.camera, zoom })}`);
      return { camera: settings.camera };
    });
  },
};

export const privateDownloads = {
  id: "F02-72",
  issue: 72,
  title: "Private-window downloads show only in that window and are never kept",
  deadline: 360000,
  manual: [
    { name: "The private window's Downloads popover", steps: ["Open a private window and download a file.", "Ctrl+J in that window lists it; Ctrl+J in a regular window does not.", "Close every private window: the regular window's list still lacks it."], reason: "needs a visible window to read the popover" },
  ],
  async run(t) {
    const run = nonce("pv72");
    const folder = await t.scratch("downloads");
    let state = await startBrowser(t, { name: "private-downloads", preferences: { downloads: folder }, extraArgs: [`--ardia-downloads-dir=${folder}`] });
    const priv = await openPrivate(state);
    const page = t.fixtures.url.page(1, run);
    const tabId = await priv.shell.newTab(page);
    await priv.shell.waitTabUrl(tabId, (u) => u === page);
    const name = `private-${run}.bin`;
    let finished;
    await t.check("a private download asks where to save, as Chrome's incognito does, and reaches the private window's list as off the record", async () => {
      await answerFileChooser(state, join(folder, name));
      await priv.shell.navigate(tabId, t.fixtures.url.download(name, 32768));
      finished = await waitDownload(priv.shell, (d) => d.filename?.endsWith(name) && d.state === "finished", "private download to finish");
      if (finished.offTheRecord !== true) throw new Error(`entry ${JSON.stringify(finished)}`);
      if (!/save file dialog \(background run, not shown\)/.test(await state.app.logText())) throw new Error("the private download never asked where to save");
      const listed = await ok(priv.shell, "downloads.list", {});
      if (!listed.some((d) => d.id === finished.id)) throw new Error("downloads.list from the private window lacks it");
      return { id: finished.id, profile: finished.profile, path: finished.path };
    }, { critical: true });
    await t.check("regular windows never see or control it", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if ((await downloadsOf(state.shell)).some((d) => d.id === finished.id)) throw new Error("the regular renderer received the private download");
      const listed = await ok(state.shell, "downloads.list", {});
      if (listed.some((d) => d.id === finished.id)) throw new Error("the regular list holds the private download");
      const removal = await state.shell.call("downloads.remove", { id: finished.id });
      if (removal.ok) throw new Error("a regular window removed the private download");
      return { removal: removal.code };
    });
    await t.check("a slow private download pauses, resumes and cancels from its window", async () => {
      const slow = `private-slow-${run}.bin`;
      await answerFileChooser(state, join(folder, slow));
      await priv.shell.navigate(tabId, t.fixtures.url.slow(slow, 6 << 20));
      const live = await waitDownload(priv.shell, (d) => d.filename?.endsWith(slow) && d.state === "downloading" && d.received > 0, "private slow download progress");
      const foreign = await state.shell.call("downloads.pause", { id: live.id });
      if (foreign.ok) throw new Error("a regular window paused the private download");
      await ok(priv.shell, "downloads.pause", { id: live.id });
      await waitDownload(priv.shell, (d) => d.id === live.id && d.paused === true, "paused private download");
      await ok(priv.shell, "downloads.resume", { id: live.id });
      await ok(priv.shell, "downloads.cancel", { id: live.id });
      await waitDownload(priv.shell, (d) => d.id === live.id && d.state === "cancelled", "cancelled private download");
      return { id: live.id, foreign: foreign.code };
    });
    await t.check("nothing of it remains after the private window closes or a restart", async () => {
      await closeWindow(state, priv.windowId);
      const listed = await ok(state.shell, "downloads.list", {});
      if (listed.some((d) => d.id === finished.id)) throw new Error("the regular list holds the private download after close");
      state = await restartBrowser(t, state);
      const after = await ok(state.shell, "downloads.list", {});
      if (after.some((d) => d.id === finished.id || d.filename?.endsWith(name))) throw new Error("Chromium's history kept the private download");
      return { listed: after.length };
    });
  },
};

export const privateLinks = {
  id: "F02-71",
  issue: 71,
  title: "Chrome's Open Link in Incognito Window opens an Ardia private window",
  deadline: 120000,
  manual: [
    { name: "Open link in incognito window", steps: ["In a regular window, right-click a link and choose Open Link in Incognito Window.", "An Ardia private window (Ardia's sidebar, Incognito indicator) opens on that URL.", "No plain Chrome window appears, and the page's cookies are absent from the regular window.", "Repeat from an isolated profile's window: the private window belongs to that profile."], reason: "needs Chrome's native context menu, which a background instance only logs" },
  ],
  async run(t) {
    const state = await startBrowser(t, { name: "private-links" });
    await t.check("a regular window starts for the context-menu check", async () => {
      const ids = await state.shell.windowIds();
      if (!Array.isArray(ids) || !ids.length) throw new Error("no shell window");
      return { windows: ids.length };
    });
  },
};

export const privateWindowMenus = {
  id: "F02-89",
  issue: 89,
  title: "Regular windows list and focus private windows without reaching into them",
  deadline: 240000,
  manual: [
    { name: "Window menu entry", steps: ["Open a private window and a second regular window.", "The second window's window list shows the private window as \"Private Window\"; choosing it brings that window forward."], reason: "Linux has no Window menu yet; tracked as a follow-up" },
  ],
  async run(t) {
    const state = await startBrowser(t, { name: "private-windows" });
    const other = await openWindow(state, `return s.createWindow({ profileId: "default" });`, "second regular window");
    const priv = await openPrivate(state);
    await t.check("another regular window lists the private window by id only", async () => {
      const reply = await until(async () => {
        const answer = await other.shell.invoke("ArdiaShell.privateWindows", { args: [] });
        return answer.ok && answer.value.some((w) => w.id === priv.windowId) ? answer : false;
      }, { timeout: 15000, label: "the private window in the directory" });
      const extra = reply.value.flatMap((w) => Object.keys(w).filter((key) => key !== "id"));
      if (extra.length) throw new Error(`directory entries carry ${extra.join(", ")}`);
      if ((await other.shell.windowIds()).includes(priv.windowId)) throw new Error("windowIds exposes the private window to the startup sweep");
      return reply.value;
    }, { critical: true });
    await t.check("selecting it focuses it", async () => {
      const reply = await other.shell.invoke("ArdiaShell.focusWindow", { args: [priv.windowId] });
      if (!reply.ok) throw new Error(`focusWindow ${JSON.stringify(reply)}`);
      return reply;
    });
    await t.check("other renderers still cannot close, frame or retitle it", async () => {
      const results = {};
      for (const method of ["ArdiaShell.closeWindow", "ArdiaShell.windowFrame", "ArdiaShell.setWindowTitle", "ArdiaShell.minimizeWindow"]) {
        const reply = await other.shell.invoke(method, { args: [priv.windowId, "x"] });
        if (reply.ok) throw new Error(`${method} reached the private window`);
        results[method] = reply.message;
      }
      if (!(await state.app.shells()).some((s) => s.windowId === priv.windowId)) throw new Error("the private window closed");
      return results;
    });
    await t.check("the directory drops the window once it closes", async () => {
      await closeWindow(state, priv.windowId);
      await until(async () => {
        const answer = await other.shell.invoke("ArdiaShell.privateWindows", { args: [] });
        return answer.ok && !answer.value.some((w) => w.id === priv.windowId);
      }, { timeout: 15000, label: "the closed private window to leave the directory" });
      return true;
    });
  },
};

export const privatePageCommands = {
  id: "F02-101",
  issue: 101,
  title: "Find, Print, Save Page and DevTools in isolated and private windows",
  deadline: 360000,
  manual: [
    { name: "Print and Save Page in isolated and private windows", steps: ["In an isolated profile's window and in a private window, press Ctrl+P: the print preview opens for that page.", "Press Ctrl+S: the save dialog opens; saving writes the page."], reason: "needs the native print preview and file dialog" },
  ],
  async run(t) {
    const run = nonce("pv101");
    const background = await startBrowser(t, { name: "page-commands-background" });
    const findIn = async (shell, count, label) => {
      const url = t.fixtures.url.find(count, `${label}-${run}`);
      const tabId = await shell.newTab(url);
      await shell.waitTabUrl(tabId, (u) => u === url);
      await waitPageViewport(shell.app, await shell.app.pageLoaded(url));
      await shell.state(`s.activate(${js(tabId)}); s.setFind(${js(tabId)}, { open: true, query: ${js(FIND_WORD)}, focusRequest: Date.now() }); return true;`);
      return until(async () => {
        const f = await shell.state(`return s.find[${js(tabId)}] ?? null;`);
        return f?.count === count ? f : false;
      }, { timeout: 15000, label: `find count ${count} in ${label}` });
    };
    await t.check("Find works in an isolated profile's window", async () => {
      const profileId = await background.shell.state(`return s.createProfile({ name: ${js(`Isolated ${run}`)} });`);
      const isolated = await openWindow(background, `return s.createWindow({ profileId: ${js(profileId)} });`, "isolated window");
      return { pageProfile: isolated.shell.pageProfile, find: await findIn(isolated.shell, 3, "isolated") };
    });
    await t.check("Find works in a private window", async () => {
      const priv = await openPrivate(background);
      return { pageProfile: priv.shell.pageProfile, find: await findIn(priv.shell, 4, "private") };
    });
    await t.stop(background.app);
    await t.check("DevTools opens for a private window's page", async () => {
      const native = await startBrowser(t, { name: "page-commands-native", background: false });
      const priv = await openPrivate(native);
      const url = t.fixtures.url.find(2, `devtools-${run}`);
      const tabId = await priv.shell.newTab(url);
      await priv.shell.waitTabUrl(tabId, (u) => u === url);
      await priv.shell.app.pageLoaded(url);
      await priv.shell.command("devTools");
      const frontend = await until(async () => (await native.app.targets()).find((target) => target.url?.startsWith("devtools://")) ?? false, { timeout: 15000, label: "a DevTools frontend" });
      await t.stop(native.app);
      return { frontend: frontend.url.split("?")[0] };
    });
  },
};

export const autoPipProfiles = {
  id: "F02-73",
  issue: 73,
  title: "The automatic PiP preference applies to every loaded profile",
  deadline: 240000,
  async run(t) {
    const run = nonce("pv73");
    const state = await startBrowser(t, { name: "auto-pip-profiles" });
    let isolatedDirectory;
    await t.check("turning it off reaches the default profile and an isolated profile loaded later", async () => {
      await state.shell.state("s.updateSettings({ autoPictureInPicture: false }); return true;");
      const profileId = await state.shell.state(`return s.createProfile({ name: ${js(`Pip ${run}`)} });`);
      const isolated = await openWindow(state, `return s.createWindow({ profileId: ${js(profileId)} });`, "isolated window");
      isolatedDirectory = `Profile ${isolated.shell.pageProfile}`;
      await until(async () => autoPip(await readPreferences(state.scratch, isolatedDirectory)) === 2, { timeout: 30000, label: "the isolated profile's auto-PiP default to be BLOCK" });
      await until(async () => autoPip(await readPreferences(state.scratch, "Default")) === 2, { timeout: 30000, label: "the default profile's auto-PiP default to be BLOCK" });
      return { isolatedDirectory };
    }, { critical: true });
    await t.check("turning it on reaches every loaded profile", async () => {
      await state.shell.state("s.updateSettings({ autoPictureInPicture: true }); return true;");
      await until(async () => autoPip(await readPreferences(state.scratch, isolatedDirectory)) === 1, { timeout: 30000, label: "the isolated profile's auto-PiP default to be ALLOW" });
      await until(async () => autoPip(await readPreferences(state.scratch, "Default")) === 1, { timeout: 30000, label: "the default profile's auto-PiP default to be ALLOW" });
      return true;
    });
  },
};

export const privateExtensions = {
  id: "F02-99",
  issue: 99,
  title: "Extensions in private windows follow Chrome's incognito rules",
  deadline: 300000,
  manual: [
    { name: "Toolbar, popup and side panel in a private window", steps: ["Allow a split-mode extension in incognito: its button shows in a private window, its popup and side panel open there.", "A spanning-mode extension stays hidden there until the shared toolbar shows spanning extensions (follow-up)."], reason: "needs a visible window and real input" },
  ],
  async run(t) {
    const run = nonce("pv99");
    const fixture = await prepareExtension(await t.scratch("split-extension"));
    const manifestPath = join(fixture, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, incognito: "split" }, null, 2));
    const state = await startBrowser(t, { name: "private-extensions", extensions: true, extraArgs: [`--load-extension=${fixture}`] });
    const ext = await until(async () => {
      const reply = await state.shell.call("extensions.list", {});
      return (reply.ok ? reply.value.extensions ?? [] : []).find((x) => x.name === FIXTURE_NAME) ?? false;
    }, { timeout: 20000, label: "the fixture extension" });
    const priv = await openPrivate(state);
    const url = t.fixtures.url.page(2, run);
    const tabId = await priv.shell.newTab(url);
    await priv.shell.waitTabUrl(tabId, (u) => u === url);
    const popup = { kind: "popup", url: `chrome-extension://${ext.id}/popup.html`, profile: priv.shell.pageProfile };
    await t.check("without incognito access the private window gets no action state or popup", async () => {
      const states = await ok(priv.shell, "extensions.actionStates", { tabId, ids: [ext.id] });
      if (states[ext.id]) throw new Error("action state for an extension without incognito access");
      const view = await priv.shell.invoke("extensionView.create", popup);
      if (view.ok || view.code !== "ERR_EXTENSION_PRIVATE") throw new Error(`popup ${JSON.stringify(view)}`);
      return { incognitoSplit: ext.incognitoSplit, view: view.code };
    }, { critical: true });
    await t.check("with incognito access its state and popup run in the private window", async () => {
      await ok(state.shell, "extensions.configure", { id: ext.id, options: { incognito: true } });
      await until(async () => (await priv.shell.eval(`(ardiaLinux.extensions.getState().lists[""] ?? []).some((x) => x.id === ${js(ext.id)} && x.incognito === true)`)) || false,
        { timeout: 15000, label: "the private renderer to learn the extension is allowed" });
      const states = await until(async () => {
        const reply = await priv.shell.call("extensions.actionStates", { tabId, ids: [ext.id] });
        return reply.ok && reply.value[ext.id] ? reply.value : false;
      }, { timeout: 15000, label: "action state in the private window" });
      const view = await priv.shell.invoke("extensionView.create", popup);
      if (!view.ok) throw new Error(`popup ${JSON.stringify(view)}`);
      await priv.shell.invoke("extensionView.release", { id: view.value.id });
      return { state: states[ext.id], view: view.value };
    });
    await t.check("management stays in regular windows", async () => {
      return refused(priv.shell, "extensions.setEnabled", { id: ext.id, enabled: false }, priv.shell.pageProfile, "ERR_PROFILE_PRIVATE");
    });
  },
};

export default [privateServices, privateDownloads, privateLinks, privateWindowMenus, privatePageCommands, autoPipProfiles, privateExtensions];
