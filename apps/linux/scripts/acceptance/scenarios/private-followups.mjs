import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "../lib/cdp.mjs";
import { startBrowser } from "../lib/flows.mjs";
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

const recordRemovals = (shell) => shell.eval(`(() => { globalThis.__removals = []; globalThis.__removalStop?.(); globalThis.__removalStop = __ardiaHost.onEvent((module, event, payload) => { if (module === "ArdiaDownloads" && payload?.name === "downloads.removed") globalThis.__removals.push(payload.data?.id ?? null); }); return true; })()`);
const removals = (shell) => shell.eval("globalThis.__removals ?? []");

const menuItems = (shell) => shell.eval(`[...document.querySelectorAll(".ardia-menu .ardia-menu-item")].map((row) => ({ title: row.querySelector(".ardia-menu-title")?.textContent ?? "", checked: row.querySelector(".ardia-menu-check")?.textContent === "✓", enabled: !row.classList.contains("disabled") }))`);

export const windowMenu = {
  id: "F02-148",
  issue: 148,
  title: "The Linux Window menu lists regular windows by title and private windows by number, and focuses the one chosen",
  deadline: 240000,
  manual: [
    { name: "Window menu from the window controls", steps: ["Open a second regular window and a private window with a tab on any site.", "Right-click the window controls (close, minimise, maximise) of the second window: the Window menu opens.", "It lists both regular windows by title (this one ticked) and \"Private Window\" without its tab title; choosing it brings the private window forward."], reason: "needs a visible compositor to see the menu and the focus change" },
  ],
  async run(t) {
    const run = nonce("pv148");
    const state = await startBrowser(t, { name: "window-menu" });
    const other = await openWindow(state, `return s.createWindow({ profileId: "default" });`, "second regular window");
    const priv = await openPrivate(state);
    const secret = t.fixtures.url.page(3, `secret-${run}`);
    const tabId = await priv.shell.newTab(secret);
    await priv.shell.waitTabUrl(tabId, (u) => u === secret);
    let items;
    await t.check("a regular window's Window menu lists the other regular window by title and the private window by number only", async () => {
      await other.shell.eval(`(() => { globalThis.__windowMenu = ardiaLinux.windowMenu.open(${js(other.windowId)}); return true; })()`);
      items = await until(async () => { const rows = await menuItems(other.shell); return rows.length ? rows : false; }, { timeout: 10000, label: "the Window menu to open" });
      const titles = items.map((row) => row.title);
      if (!titles.includes("Private Window")) throw new Error(`entries ${JSON.stringify(titles)}`);
      if (!items.some((row) => row.checked)) throw new Error("the window's own entry is not ticked");
      if (titles.some((title) => title.includes(run) || title.includes("secret"))) throw new Error("the private window's page reached the menu");
      const fixed = ["Minimize", "Maximize", "Downloads", "Task Manager", "Merge All Windows"];
      for (const label of fixed.filter((label) => label !== "Task Manager")) if (!titles.includes(label)) throw new Error(`missing ${label}`);
      const regular = titles.filter((title) => !fixed.includes(title) && title !== "Private Window");
      if (regular.length !== 2) throw new Error(`regular entries ${JSON.stringify(regular)}`);
      return { titles };
    }, { critical: true });
    await t.check("choosing the private entry focuses it and closes the menu", async () => {
      await other.shell.eval(`(() => { const row = [...document.querySelectorAll(".ardia-menu .ardia-menu-item")].find((r) => r.querySelector(".ardia-menu-title")?.textContent === "Private Window"); row?.click(); return !!row; })()`);
      const shown = await other.shell.eval("globalThis.__windowMenu.then((value) => value)");
      if (shown !== true) throw new Error(`open() answered ${JSON.stringify(shown)}`);
      if ((await menuItems(other.shell)).length) throw new Error("the menu stayed open");
      if (!(await state.app.shells()).some((s) => s.windowId === priv.windowId)) throw new Error("the private window closed");
      return true;
    });
    await t.check("the private window's own menu lists the regular windows and itself, ticked", async () => {
      await priv.shell.eval(`(() => { globalThis.__windowMenu = ardiaLinux.windowMenu.open(${js(priv.windowId)}); return true; })()`);
      const rows = await until(async () => { const found = await menuItems(priv.shell); return found.length ? found : false; }, { timeout: 10000, label: "the private window's menu" });
      await priv.shell.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); globalThis.__windowMenu.then(() => true)`);
      if (rows.filter((row) => row.checked).length !== 1) throw new Error(`ticks ${JSON.stringify(rows)}`);
      return rows.map((row) => row.title);
    });
  },
};

export const privateExtensionToolbar = {
  id: "F02-149",
  issue: 149,
  title: "Spanning-mode extensions allowed in incognito show and update live in private windows",
  deadline: 300000,
  manual: [
    { name: "Spanning extension button and popup in a private window", steps: ["Allow a spanning-mode extension in incognito and pin it.", "Its button shows in a private window; its popup opens there and runs in the regular profile (chrome://extensions lists one background context)."], reason: "needs a visible window and real input" },
  ],
  async run(t) {
    const run = nonce("pv149");
    const fixture = await prepareExtension(await t.scratch("spanning-extension"));
    const manifestPath = join(fixture, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.incognito;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const state = await startBrowser(t, { name: "private-extension-toolbar", extensions: true, extraArgs: [`--load-extension=${fixture}`] });
    const ext = await until(async () => {
      const reply = await state.shell.call("extensions.list", {});
      return (reply.ok ? reply.value.extensions ?? [] : []).find((x) => x.name === FIXTURE_NAME) ?? false;
    }, { timeout: 20000, label: "the fixture extension" });
    const regularPage = t.fixtures.url.page(1, `${run}-regular`);
    const regularTab = await state.shell.newTab(regularPage);
    await state.shell.waitTabUrl(regularTab, (u) => u === regularPage);
    const priv = await openPrivate(state);
    const page = t.fixtures.url.page(2, `${run}-private`);
    const tabId = await priv.shell.newTab(page);
    await priv.shell.waitTabUrl(tabId, (u) => u === page);
    const actionIn = (shell, tab) => shell.eval(`ardiaLinux.extensions.getState().actions[${js(tab)}]?.[${js(ext.id)}] ?? null`);
    await t.check("a pinned spanning extension allowed in incognito gets its toolbar state in the private window", async () => {
      if (ext.incognitoSplit !== false) throw new Error(`incognitoSplit ${ext.incognitoSplit}`);
      await ok(state.shell, "extensions.configure", { id: ext.id, options: { incognito: true, pinned: true } });
      const shown = await until(async () => (await actionIn(priv.shell, tabId)) ?? false, { timeout: 20000, label: "action state for the spanning extension in the private window" });
      return { shown };
    }, { critical: true });
    await t.check("its popup opens from the private window", async () => {
      const view = await priv.shell.invoke("extensionView.create", { kind: "popup", url: `chrome-extension://${ext.id}/popup.html`, profile: priv.shell.pageProfile });
      if (!view.ok) throw new Error(`popup ${JSON.stringify(view)}`);
      await priv.shell.invoke("extensionView.release", { id: view.value.id });
      return view.value;
    });
    await t.check("a badge set on the private tab appears there without a manual refresh and never in the regular window", async () => {
      const targets = await state.app.targets();
      const target = targets.find((x) => x.type === "service_worker" && x.url.startsWith(`chrome-extension://${ext.id}/`));
      if (!target) throw new Error("no service worker for the fixture");
      const sw = await state.app.connect(target);
      await evaluate(sw, `chrome.tabs.query({ url: ${js(page)} }).then(([tab]) => chrome.action.setBadgeText({ tabId: tab.id, text: "9" })).then(() => true)`);
      const badge = await until(async () => { const s = await actionIn(priv.shell, tabId); return s?.badgeText === "9" ? s : false; }, { timeout: 8000, label: "the badge in the private window" }).catch(async (error) => {
        const engine = await evaluate(sw, `chrome.tabs.query({ url: ${js(page)} }).then(([tab]) => tab ? chrome.action.getBadgeText({ tabId: tab.id }).then((badge) => ({ tab: tab.id, incognito: tab.incognito, badge })) : null)`).catch((e) => String(e?.message ?? e));
        const renderer = await priv.shell.eval(`({ visibility: document.visibilityState, action: ardiaLinux.extensions.getState().actions[${js(tabId)}]?.[${js(ext.id)}] ?? null })`).catch((e) => String(e?.message ?? e));
        throw new Error(`${error.message}; engine ${JSON.stringify(engine)}; renderer ${JSON.stringify(renderer)}`);
      });
      const regular = await actionIn(state.shell, regularTab);
      if (regular?.badgeText === "9") throw new Error("the private badge reached the regular window");
      return { badge: badge.badgeText, regular: regular?.badgeText ?? null };
    });
  },
};

export const privateLinksFromSurfaces = {
  id: "F02-150",
  issue: 150,
  title: "Incognito links from extension popups, side panels and DevTools open an Ardia private window",
  deadline: 120000,
  manual: [
    { name: "Open Link in Incognito Window from an extension popup", steps: ["Open a pinned extension's popup that has a link, right-click the link and choose Open Link in Incognito Window.", "An Ardia private window of the window's profile opens on the link; no plain Chrome window appears."], reason: "needs Chrome's native context menu, which a background instance only logs" },
    { name: "Open Link in Incognito Window from DevTools", steps: ["Open DevTools on a tab, right-click a link in the Elements panel and choose Open in new tab in incognito (or the link's incognito entry).", "An Ardia private window opens; no plain Chrome window appears."], reason: "needs Chrome's native context menu" },
  ],
  async run(t) {
    const state = await startBrowser(t, { name: "private-links-surfaces" });
    await t.check("a regular window starts for the context-menu checks", async () => {
      const ids = await state.shell.windowIds();
      if (!Array.isArray(ids) || !ids.length) throw new Error("no shell window");
      return { windows: ids.length };
    });
  },
};

export const privateDownloadRemovals = {
  id: "F02-172",
  issue: 172,
  title: "A private download's removal reaches only private windows of its profile",
  deadline: 300000,
  async run(t) {
    const run = nonce("pv172");
    const folder = await t.scratch("downloads");
    const state = await startBrowser(t, { name: "private-download-removals", preferences: { downloads: folder }, extraArgs: [`--ardia-downloads-dir=${folder}`] });
    const priv = await openPrivate(state);
    await recordRemovals(state.shell);
    await recordRemovals(priv.shell);
    const page = t.fixtures.url.page(1, run);
    const tabId = await priv.shell.newTab(page);
    await priv.shell.waitTabUrl(tabId, (u) => u === page);
    const name = `private-removal-${run}.bin`;
    let id;
    await t.check("the private download finishes in the private window", async () => {
      await writeFile(join(state.scratch, "file-chooser.txt"), `${join(folder, name)}\n`);
      await priv.shell.navigate(tabId, t.fixtures.url.download(name, 16384));
      const finished = await until(async () => (await priv.shell.state("return s.downloads ?? [];")).find((d) => d.filename?.endsWith(name) && d.state === "finished") ?? false, { timeout: 25000, label: "private download to finish" });
      id = finished.id;
      return { id };
    }, { critical: true });
    await t.check("removing it reaches the private window and not the regular one", async () => {
      await ok(priv.shell, "downloads.remove", { id });
      await until(async () => (await removals(priv.shell)).includes(id), { timeout: 10000, label: "the removal in the private window" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if ((await removals(state.shell)).includes(id)) throw new Error("the regular renderer received the private removal");
      return { private: true };
    });
    await t.check("closing the private session sends the regular window no private ids", async () => {
      await closeWindow(state, priv.windowId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const seen = await removals(state.shell);
      if (seen.length) throw new Error(`the regular renderer received ${JSON.stringify(seen)}`);
      return { regular: seen.length };
    });
  },
};

export const privateAutoPip = {
  id: "F02-173",
  issue: 173,
  title: "Private windows never enter automatic PiP, as on macOS",
  deadline: 120000,
  async run(t) {
    const state = await startBrowser(t, { name: "private-auto-pip" });
    await t.check("automatic PiP is on for the regular profile while a private window is open", async () => {
      await state.shell.state("s.updateSettings({ autoPictureInPicture: true }); return true;");
      const priv = await openPrivate(state);
      await until(async () => {
        try {
          return JSON.parse(await readFile(join(state.scratch, "Default", "Preferences"), "utf8"))?.profile?.default_content_setting_values?.auto_picture_in_picture === 1;
        } catch {
          return false;
        }
      }, { timeout: 30000, label: "the regular profile's auto-PiP default to be ALLOW" });
      return { privateWindow: priv.windowId };
    });
  },
};

export default [windowMenu, privateExtensionToolbar, privateLinksFromSurfaces, privateDownloadRemovals, privateAutoPip];
